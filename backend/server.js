'use strict';

require('dotenv').config();

const dns = require('dns');
// Set standard public DNS resolvers (Google & Cloudflare) to prevent querySrv ECONNREFUSED
// when resolving MongoDB Atlas SRV connection records on local network DNS.
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if custom DNS servers cannot be set
}

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const Lead = require('./models/Lead');
const { verifyLead, domainFromEmail } = require('./utils/verifier');
const { scoreLead } = require('./utils/scorer');
const { findEmail } = require('./utils/emailFinder');
const { enrichDomain } = require('./utils/enrichment');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE || 500);
const DNS_CONCURRENCY = Number(process.env.DNS_CONCURRENCY || 12);

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

app.use(
  cors({
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

let dbReady = false;

async function connectDatabase() {
  if (!MONGODB_URI) {
    console.error(
      '[db] MONGODB_URI is missing. Add it to backend/.env before starting the server.'
    );
    return false;
  }

  if (!/^mongodb(\+srv)?:\/\//.test(MONGODB_URI)) {
    console.error(
      '[db] MONGODB_URI is malformed. It must start with mongodb:// or mongodb+srv://'
    );
    return false;
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(MONGODB_URI, {
      dbName: 'caprae_leadgen_db',
      serverSelectionTimeoutMS: 10000,
    });
    dbReady = true;
    console.log('[db] Connected to caprae_leadgen_db');
    return true;
  } catch (error) {
    dbReady = false;
    console.error('[db] Connection failed:', error.message);
    console.error(
      '[db] Check the connection string, the database user password and that your IP is allowed in MongoDB Atlas.'
    );
    return false;
  }
}

mongoose.connection.on('disconnected', () => {
  dbReady = false;
  console.warn('[db] Disconnected from MongoDB.');
});

mongoose.connection.on('reconnected', () => {
  dbReady = true;
  console.log('[db] Reconnected to MongoDB.');
});

function requireDatabase(req, res, next) {
  if (dbReady && mongoose.connection.readyState === 1) return next();
  return res.status(503).json({
    success: false,
    message:
      'The database is unavailable. Check MONGODB_URI in backend/.env and that the server can reach MongoDB Atlas.',
  });
}

/* ------------------------------------------------------------------ */
/* CSV parsing                                                         */
/* ------------------------------------------------------------------ */

/**
 * RFC 4180 style parser that tolerates quoted fields, embedded commas,
 * escaped quotes and both CRLF and LF line endings.
 */
function parseCsvText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('The CSV file is empty.');
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const clean = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // handled by the \n branch
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error('The CSV file has an unclosed quoted field.');
  }

  row.push(field);
  rows.push(row);

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

const HEADER_ALIASES = {
  company: ['company', 'companyname', 'company name', 'organisation', 'organization', 'account', 'business'],
  domain: ['domain', 'companydomain', 'company domain', 'site', 'url'],
  email: ['email', 'emailaddress', 'email address', 'workemail', 'work email', 'contactemail'],
  industry: ['industry', 'sector', 'vertical', 'category'],
  website: ['website', 'web', 'homepage', 'weburl'],
  firstName: ['firstname', 'first name', 'first', 'givenname', 'given name'],
  lastName: ['lastname', 'last name', 'last', 'surname', 'familyname', 'family name'],
};

function matchHeader(header) {
  const key = String(header || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  const flat = key.replace(/\s+/g, '');
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(key) || aliases.includes(flat)) return field;
  }
  return null;
}

/** Turn raw CSV text into an array of lead objects. */
function csvToLeads(text) {
  const rows = parseCsvText(text);
  if (rows.length === 0) throw new Error('The CSV file has no usable rows.');

  const header = rows[0].map(matchHeader);
  const hasEmail = header.includes('email');
  const hasNameAndDomain =
    (header.includes('firstName') || header.includes('lastName')) &&
    (header.includes('domain') || header.includes('website'));

  if (!hasEmail && !hasNameAndDomain) {
    throw new Error(
      'The CSV needs either an "email" column, or a first/last name column plus a domain or website column so an email can be discovered. Accepted headers: company, domain, email, firstName, lastName, industry, website.'
    );
  }

  return rows.slice(1).map((cells) => {
    const lead = { source: 'csv' };
    header.forEach((field, index) => {
      if (field) lead[field] = String(cells[index] || '').trim();
    });
    return lead;
  });
}

/* ------------------------------------------------------------------ */
/* Processing pipeline                                                 */
/* ------------------------------------------------------------------ */

/** Run an async mapper over a list with a fixed concurrency ceiling. */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function processLead(rawLead) {
  const workingLead = { ...rawLead };
  let emailSource = 'provided';
  let emailConfidence = null;
  let discoveryNote = null;

  const hasEmail = String(workingLead.email || '').trim().length > 0;
  const hasName = workingLead.firstName || workingLead.lastName;
  const hasDomainHint = workingLead.domain || workingLead.website;

  if (!hasEmail && hasName && hasDomainHint) {
    try {
      const discovery = await findEmail({
        domain: workingLead.domain,
        website: workingLead.website,
        firstName: workingLead.firstName,
        lastName: workingLead.lastName,
      });

      if (discovery.bestGuess) {
        workingLead.email = discovery.bestGuess.email;
        emailSource = 'pattern-guess';
        emailConfidence = discovery.bestGuess.confidence;
        discoveryNote = 'Email discovered from name and domain: ' + discovery.note;
      } else {
        discoveryNote = 'Email discovery found no candidates: ' + discovery.note;
      }
    } catch (error) {
      discoveryNote = 'Email discovery failed: ' + error.message;
    }
  }

  const verified = await verifyLead(workingLead);
  verified.emailSource = emailSource;
  verified.emailConfidence = emailConfidence;
  if (discoveryNote) verified.verificationNotes = [discoveryNote, ...verified.verificationNotes];

  const scored = scoreLead(verified);

  return {
    ...verified,
    ...scored,
    contactFirstName: String(workingLead.firstName || '').trim(),
    contactLastName: String(workingLead.lastName || '').trim(),
    source: rawLead.source === 'csv' ? 'csv' : 'manual',
  };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Caprae LeadGen Enhancement Pipeline',
    database: dbReady ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** GET /api/leads - every stored lead, newest first, with summary stats. */
app.get('/api/leads', requireDatabase, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const quality = req.query.quality;

    const filter = {};
    if (quality && ['High Quality', 'Medium', 'Low Quality'].includes(quality)) {
      filter.quality = quality;
    }

    const leads = await Lead.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

    const total = leads.length;
    const mxVerified = leads.filter((l) => l.mxVerified).length;
    const high = leads.filter((l) => l.quality === 'High Quality').length;
    const averageScore = total
      ? Math.round(leads.reduce((sum, l) => sum + (l.score || 0), 0) / total)
      : 0;

    res.json({
      success: true,
      count: total,
      stats: {
        totalLeads: total,
        mxVerifiedCount: mxVerified,
        mxVerifiedRate: total ? Math.round((mxVerified / total) * 100) : 0,
        averageScore,
        highQualityCount: high,
      },
      leads: leads.map((l) => ({ ...l, id: l._id.toString() })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/leads/process
 * Accepts any one of:
 *   { company, domain, email }              single lead
 *   { leads: [ { company, domain, email } ] } batch
 *   { csv: "company,domain,email\n..." }      raw CSV text
 */
app.post('/api/leads/process', requireDatabase, async (req, res, next) => {
  try {
    const body = req.body || {};
    let rawLeads = [];

    if (typeof body.csv === 'string' && body.csv.trim()) {
      try {
        rawLeads = csvToLeads(body.csv);
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          message: parseError.message,
        });
      }
    } else if (Array.isArray(body.leads)) {
      rawLeads = body.leads.map((l) => ({ ...l, source: l.source || 'manual' }));
    } else if (body.email || body.firstName || body.lastName) {
      rawLeads = [{ ...body, source: 'manual' }];
    }

    const identifiable = (l) =>
      l &&
      (String(l.email || '').trim() ||
        ((l.firstName || l.lastName) && (l.domain || l.website)));

    rawLeads = rawLeads.filter(identifiable);

    if (rawLeads.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          'No leads found in the request. Send an email address, or a first/last name plus a domain so an email can be discovered.',
      });
    }

    if (rawLeads.length > MAX_BATCH_SIZE) {
      return res.status(413).json({
        success: false,
        message:
          'Batch too large. Send at most ' + MAX_BATCH_SIZE + ' leads per request.',
      });
    }

    const processed = await mapWithConcurrency(rawLeads, DNS_CONCURRENCY, processLead);

    // Upsert so re-running a batch refreshes results instead of failing.
    const saved = [];
    const failed = [];

    for (const lead of processed) {
      if (!lead.email) {
        failed.push({
          email: '',
          message:
            'Could not save ' +
            (lead.company || lead.contactFirstName + ' ' + lead.contactLastName || 'this lead').trim() +
            ': no email was supplied and none could be discovered.',
        });
        continue;
      }

      try {
        const doc = await Lead.findOneAndUpdate(
          { email: lead.email },
          { $set: lead },
          { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
        ).lean();
        saved.push({ ...doc, id: doc._id.toString() });
      } catch (writeError) {
        failed.push({ email: lead.email, message: writeError.message });
      }
    }

    res.status(201).json({
      success: true,
      processed: saved.length,
      skipped: failed.length,
      failures: failed,
      leads: saved,
      message:
        'Processed ' +
        saved.length +
        ' lead' +
        (saved.length === 1 ? '' : 's') +
        (failed.length ? ', ' + failed.length + ' could not be saved.' : '.'),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/leads/find-email
 * Generate and rank likely email addresses for a person at a company.
 * Does not save anything; the frontend lets the person pick a result and
 * carries it into /api/leads/process.
 */
app.post('/api/leads/find-email', async (req, res, next) => {
  try {
    const { company, domain, website, firstName, lastName } = req.body || {};

    if (!String(firstName || '').trim() && !String(lastName || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Enter a first or last name to search for an email.',
      });
    }

    if (!String(domain || '').trim() && !String(website || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Enter a company domain or website to search against.',
      });
    }

    const result = await findEmail({ domain, website, firstName, lastName });
    res.json({ success: true, company: company || '', ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/leads/:id/enrich
 * Fetches the lead's company homepage for a title, description and a
 * guessed industry, updates the stored lead, and rescoring reflects any
 * newly-filled industry field.
 */
app.post('/api/leads/:id/enrich', requireDatabase, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'That lead id is not valid.' });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'No lead exists with that id.' });
    }

    const targetDomain = lead.domain || lead.website || domainFromEmail(lead.email);
    const enrichment = await enrichDomain(targetDomain);

    lead.enrichment = enrichment;
    if (!lead.industry && enrichment.detectedIndustry) {
      lead.industry = enrichment.detectedIndustry;
    }

    // Re-run scoring so a newly-filled industry (or any other change) is
    // reflected immediately, using the lead's already-stored verification
    // results rather than re-checking the mail server.
    const rescored = scoreLead(lead.toObject());
    lead.score = rescored.score;
    lead.quality = rescored.quality;
    lead.scoreBreakdown = rescored.scoreBreakdown;

    await lead.save();

    const doc = lead.toObject();
    res.json({ success: true, lead: { ...doc, id: doc._id.toString() } });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/leads/:id */
app.delete('/api/leads/:id', requireDatabase, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'That lead id is not valid.',
      });
    }

    const deleted = await Lead.findByIdAndDelete(id).lean();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'No lead exists with that id.',
      });
    }

    res.json({
      success: true,
      message: 'Lead removed.',
      id,
    });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Error handling                                                      */
/* ------------------------------------------------------------------ */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Unknown endpoint: ' + req.method + ' ' + req.originalUrl,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error('[api]', error);

  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'The request body is not valid JSON.',
    });
  }

  if (error && error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors)
        .map((e) => e.message)
        .join(' '),
    });
  }

  res.status(500).json({
    success: false,
    message: 'Something went wrong while handling that request.',
  });
});

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

function start() {
  // Listen first so /api/health answers while Atlas is still negotiating,
  // then connect in the background.
  const server = app.listen(PORT, () => {
    console.log('[api] Caprae LeadGen Enhancement Pipeline on http://localhost:' + PORT);
  });

  connectDatabase().then((ok) => {
    if (!ok) {
      console.warn('[api] Running without a database. Lead endpoints will return 503.');
    }
  });

  const shutdown = async (signal) => {
    console.log('\n[api] ' + signal + ' received, shutting down.');
    server.close(async () => {
      await mongoose.connection.close().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  start();
}

module.exports = { app, parseCsvText, csvToLeads, processLead, findEmail, enrichDomain };
