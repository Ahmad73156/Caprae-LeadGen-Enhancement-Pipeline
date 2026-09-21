'use strict';

const net = require('net');
const { resolveMxRecords, normalizeDomain, isValidDomain } = require('./verifier');

/**
 * Common professional email patterns, ordered by real-world frequency
 * (first.last is by far the most common corporate convention, followed by
 * initial-based shortenings). The "weight" is the base confidence score
 * used when a live mailbox probe isn't possible.
 */
function buildPatterns(first, last) {
  const f = first.toLowerCase().replace(/[^a-z]/g, '');
  const l = last.toLowerCase().replace(/[^a-z]/g, '');
  if (!f && !l) return [];

  const fi = f[0] || '';
  const li = l[0] || '';

  const patterns = [];
  const add = (local, weight) => {
    if (local && !patterns.some((p) => p.local === local)) {
      patterns.push({ local, weight });
    }
  };

  if (f && l) {
    add(f + '.' + l, 38);
    add(fi + l, 22);
    add(f, 12);
    add(f + l, 10);
    add(f + '_' + l, 6);
    add(l + '.' + f, 4);
    add(f[0] + '.' + l, 3);
    add(f + '-' + l, 2);
    add(l, 2);
    add(fi + '.' + li, 1);
  } else if (f) {
    add(f, 20);
  } else if (l) {
    add(l, 20);
  }

  return patterns.sort((a, b) => b.weight - a.weight);
}

/** Read one full SMTP response (handles multi-line "250-" continuations). */
function readSmtpResponse(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP_READ_TIMEOUT'));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      // A final response line has a space after the 3-digit code; a
      // continuation line uses a hyphen ("250-").
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function statusCode(response) {
  const match = /^(\d{3})/.exec(response || '');
  return match ? Number(match[1]) : 0;
}

/**
 * Best-effort SMTP verification for a batch of candidate addresses against
 * one MX host. Opens a single connection, issues one RCPT TO per candidate
 * (resetting the transaction between attempts), and reports each result.
 *
 * This requires outbound port 25, which most home networks, corporate
 * networks and cloud platforms block. Any failure here is expected and
 * handled by the caller as "could not confirm" rather than an error.
 */
async function probeCandidates(mxHost, candidates, timeoutMs = 6000) {
  const results = new Map();
  let socket;

  try {
    socket = net.createConnection({ host: mxHost, port: 25, timeout: timeoutMs });

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      const onTimeout = () => reject(new Error('SMTP_CONNECT_TIMEOUT'));
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        socket.removeListener('timeout', onTimeout);
        resolve();
      });
    });

    await readSmtpResponse(socket, timeoutMs); // greeting (220)

    socket.write('EHLO caprae-leadgen.local\r\n');
    await readSmtpResponse(socket, timeoutMs);

    socket.write('MAIL FROM:<verify@caprae-leadgen.local>\r\n');
    const mailResponse = await readSmtpResponse(socket, timeoutMs);
    if (statusCode(mailResponse) >= 400) {
      throw new Error('SMTP_MAIL_FROM_REJECTED');
    }

    // Catch-all detection: a domain that accepts obviously fake addresses
    // will "confirm" every candidate, which makes individual results
    // meaningless.
    const probeAddress =
      'no-such-mailbox-' + Date.now().toString(36) + '@' + mxHost.split('.').slice(-2).join('.');
    socket.write('RCPT TO:<' + probeAddress + '>\r\n');
    const catchAllResponse = await readSmtpResponse(socket, timeoutMs);
    const isCatchAll = statusCode(catchAllResponse) < 400;
    if (isCatchAll) {
      socket.write('RSET\r\n');
      await readSmtpResponse(socket, timeoutMs);
    }

    for (const candidate of candidates) {
      if (isCatchAll) {
        results.set(candidate, 'catch-all');
        continue;
      }

      socket.write('RCPT TO:<' + candidate + '>\r\n');
      try {
        const response = await readSmtpResponse(socket, timeoutMs);
        const code = statusCode(response);
        results.set(candidate, code < 400 ? 'confirmed' : 'invalid');
      } catch {
        results.set(candidate, 'unconfirmed');
      }
      socket.write('RSET\r\n');
      try {
        await readSmtpResponse(socket, timeoutMs);
      } catch {
        // If RSET doesn't come back cleanly the connection is likely dead;
        // remaining candidates will fall through to "unconfirmed" below.
      }
    }

    socket.write('QUIT\r\n');
    socket.end();
  } catch {
    // Port 25 blocked, connection refused, timeout, or the server dropped
    // mid-transaction. Every candidate not already resolved falls back to
    // "unconfirmed" so the caller can still rank by pattern popularity.
    if (socket && !socket.destroyed) socket.destroy();
  }

  return results;
}

/**
 * Find the most likely work email for a person at a company.
 *
 * @param {{domain?:string, website?:string, firstName?:string, lastName?:string}} input
 * @returns {Promise<{domain:string, mxVerified:boolean, catchAll:boolean, candidates:Array, bestGuess:object|null, note:string}>}
 */
async function findEmail({ domain, website, firstName = '', lastName = '' }) {
  const host = normalizeDomain(domain || website);

  if (!host || !isValidDomain(host)) {
    return {
      domain: host,
      mxVerified: false,
      catchAll: false,
      candidates: [],
      bestGuess: null,
      note: 'No valid domain supplied, so no email could be guessed.',
    };
  }

  const patterns = buildPatterns(String(firstName || ''), String(lastName || ''));
  if (patterns.length === 0) {
    return {
      domain: host,
      mxVerified: false,
      catchAll: false,
      candidates: [],
      bestGuess: null,
      note: 'A first or last name is required to generate email candidates.',
    };
  }

  const mx = await resolveMxRecords(host);
  if (!mx.mxVerified || mx.mxRecords.length === 0) {
    return {
      domain: host,
      mxVerified: false,
      catchAll: false,
      candidates: patterns.map((p) => ({
        email: p.local + '@' + host,
        pattern: p.local,
        status: 'unconfirmed',
        confidence: 'unconfirmed',
      })),
      bestGuess: {
        email: patterns[0].local + '@' + host,
        status: 'unconfirmed',
        confidence: 'unconfirmed',
      },
      note: host + ' has no mail servers, so candidates are pattern guesses only.',
    };
  }

  const candidateAddresses = patterns.map((p) => p.local + '@' + host);
  // Cap probing at 6 candidates so a single request can't hang for minutes
  // on a slow or unresponsive mail server.
  const probeSet = candidateAddresses.slice(0, 6);
  const probeResults = await probeCandidates(mx.mxRecords[0], probeSet);

  let catchAll = false;
  const candidates = patterns.map((p) => {
    const email = p.local + '@' + host;
    const status = probeResults.get(email) || 'unconfirmed';
    if (status === 'catch-all') catchAll = true;
    return { email, pattern: p.local, status, confidence: status, weight: p.weight };
  });

  const viable = candidates.filter((c) => c.status !== 'invalid');
  const rank = { confirmed: 0, 'catch-all': 1, unconfirmed: 2, invalid: 3 };
  viable.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.weight - a.weight));

  const bestGuess = viable[0]
    ? {
        email: viable[0].email,
        status: viable[0].status,
        confidence: viable[0].status,
      }
    : null;

  let note;
  if (candidates.every((c) => c.status === 'unconfirmed')) {
    note =
      'Mail server probing was not possible on this network (port 25 is commonly blocked), so results are ranked by pattern likelihood only.';
  } else if (catchAll) {
    note = host + ' accepts mail for any address at this domain, so no single candidate could be confirmed.';
  } else if (bestGuess && bestGuess.status === 'confirmed') {
    note = 'Confirmed a working mailbox for this address.';
  } else {
    note = 'No candidate could be confirmed as deliverable.';
  }

  return {
    domain: host,
    mxVerified: true,
    catchAll,
    candidates: candidates.map(({ weight, ...rest }) => rest),
    bestGuess,
    note,
  };
}

module.exports = { buildPatterns, probeCandidates, findEmail };
