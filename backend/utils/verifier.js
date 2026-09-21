'use strict';

const dns = require('dns/promises');

/**
 * Practical email syntax rule. Deliberately stricter than RFC 5322 so that
 * obvious junk ("a@b", "no-at-sign.com", "double..dot@x.com") is rejected
 * before we spend a DNS round trip on it.
 */
const EMAIL_REGEX =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

const DOMAIN_REGEX =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** Internal blocklist of throwaway inbox providers. */
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'burnermail.io',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemailgenerator.com',
  'getairmail.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'inboxbear.com',
  'jetable.org',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mailsac.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nowmymail.com',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'tempinbox.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempmail.net',
  'tempmailaddress.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trbvm.com',
  'wegwerfmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/** Consumer mailbox providers: valid, but weaker B2B signal. */
const FREE_PROVIDERS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.co.uk',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.co.uk',
  'yahoo.com',
  'yandex.com',
  'zoho.com',
]);

/** Shared inboxes rather than a named decision maker. */
const ROLE_LOCAL_PARTS = new Set([
  'abuse',
  'admin',
  'administrator',
  'billing',
  'contact',
  'enquiries',
  'enquiry',
  'help',
  'hello',
  'hr',
  'info',
  'jobs',
  'mail',
  'marketing',
  'noreply',
  'no-reply',
  'office',
  'postmaster',
  'sales',
  'support',
  'team',
  'webmaster',
]);

/** Strip protocol, credentials, www, path and port from a website or domain. */
function normalizeDomain(value) {
  if (!value || typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  if (!host) return '';

  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split('@').pop();
  host = host.split('/')[0];
  host = host.split('?')[0];
  host = host.split('#')[0];
  host = host.split(':')[0];
  host = host.replace(/^www\./, '');
  host = host.replace(/\.$/, '');

  return host;
}

function isValidSyntax(email) {
  if (!email || typeof email !== 'string') return false;
  const value = email.trim();
  if (value.length > 320) return false;
  if (value.includes('..')) return false;
  return EMAIL_REGEX.test(value);
}

function isValidDomain(domain) {
  const host = normalizeDomain(domain);
  if (!host || host.length > 253) return false;
  return DOMAIN_REGEX.test(host);
}

function domainFromEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '';
  return normalizeDomain(email.split('@').pop());
}

function localPartFromEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '';
  return email.trim().toLowerCase().split('@')[0];
}

function isDisposableDomain(domain) {
  const host = normalizeDomain(domain);
  if (!host) return false;
  if (DISPOSABLE_DOMAINS.has(host)) return true;
  // Catch subdomains of blocked providers, e.g. mail.yopmail.com
  return [...DISPOSABLE_DOMAINS].some((blocked) => host.endsWith('.' + blocked));
}

function isFreeProvider(domain) {
  const host = normalizeDomain(domain);
  return host ? FREE_PROVIDERS.has(host) : false;
}

function isRoleBased(email) {
  const local = localPartFromEmail(email);
  if (!local) return false;
  return ROLE_LOCAL_PARTS.has(local.replace(/[._-]?\d+$/, ''));
}

/**
 * Resolve MX records with a hard timeout so a black-holed nameserver can
 * never stall a batch import.
 */
async function resolveMxRecords(domain, timeoutMs = 5000) {
  const host = normalizeDomain(domain);

  if (!host || !DOMAIN_REGEX.test(host)) {
    return {
      mxVerified: false,
      mxStatus: 'skipped',
      mxRecords: [],
      note: 'No resolvable domain to check for mail servers.',
    };
  }

  let timer = null;
  try {
    const lookup = dns.resolveMx(host);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs);
    });

    const records = await Promise.race([lookup, timeout]);

    if (!Array.isArray(records) || records.length === 0) {
      return {
        mxVerified: false,
        mxStatus: 'unverified',
        mxRecords: [],
        note: host + ' has no mail exchange records.',
      };
    }

    const sorted = [...records].sort(
      (a, b) => (a.priority || 0) - (b.priority || 0)
    );

    return {
      mxVerified: true,
      mxStatus: 'verified',
      mxRecords: sorted.map((r) => r.exchange).filter(Boolean),
      note: 'Found ' + sorted.length + ' mail server(s) for ' + host + '.',
    };
  } catch (error) {
    const code = error && (error.code || error.message);

    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      return {
        mxVerified: false,
        mxStatus: 'unverified',
        mxRecords: [],
        note: host + ' does not resolve to a mail server.',
      };
    }

    return {
      mxVerified: false,
      mxStatus: 'error',
      mxRecords: [],
      note:
        code === 'DNS_TIMEOUT'
          ? 'Lookup for ' + host + ' timed out after ' + timeoutMs + 'ms.'
          : 'Lookup for ' + host + ' failed (' + code + ').',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run every check against a single raw lead and return a normalized,
 * verification-enriched object ready for the scoring engine.
 */
async function verifyLead(rawLead = {}) {
  const email = String(rawLead.email || '').trim().toLowerCase();
  const company = String(rawLead.company || '').trim();
  const industry = String(rawLead.industry || '').trim();
  const website = String(rawLead.website || '').trim();

  const suppliedDomain = normalizeDomain(rawLead.domain || website);
  const emailDomain = domainFromEmail(email);
  const domain = suppliedDomain || emailDomain;

  const notes = [];
  const syntaxValid = isValidSyntax(email);

  if (!email) {
    notes.push('No email address supplied.');
  } else if (!syntaxValid) {
    notes.push('Email address failed the syntax check.');
  }

  if (suppliedDomain && emailDomain && suppliedDomain !== emailDomain) {
    notes.push(
      'Email domain (' +
        emailDomain +
        ') does not match the company domain (' +
        suppliedDomain +
        ').'
    );
  }

  const disposable = isDisposableDomain(emailDomain || domain);
  if (disposable) notes.push('Domain is a known disposable inbox provider.');

  const freeProvider = isFreeProvider(emailDomain || domain);
  if (freeProvider) notes.push('Consumer mailbox rather than a company domain.');

  const roleBased = isRoleBased(email);
  if (roleBased) notes.push('Shared inbox, not an individual contact.');

  let mx = {
    mxVerified: false,
    mxStatus: 'skipped',
    mxRecords: [],
    note: 'Mail server check skipped because the address is not valid.',
  };

  if (syntaxValid && !disposable) {
    mx = await resolveMxRecords(emailDomain || domain);
  } else if (disposable) {
    mx.note = 'Mail server check skipped for a disposable domain.';
  }

  notes.push(mx.note);

  return {
    company,
    domain,
    email,
    industry,
    website,
    syntaxValid,
    mxVerified: mx.mxVerified,
    mxStatus: mx.mxStatus,
    mxRecords: mx.mxRecords,
    disposable,
    freeProvider,
    roleBased,
    domainValid: isValidDomain(domain),
    verificationNotes: notes.filter(Boolean),
  };
}

module.exports = {
  EMAIL_REGEX,
  DOMAIN_REGEX,
  DISPOSABLE_DOMAINS,
  FREE_PROVIDERS,
  ROLE_LOCAL_PARTS,
  normalizeDomain,
  isValidSyntax,
  isValidDomain,
  isDisposableDomain,
  isFreeProvider,
  isRoleBased,
  domainFromEmail,
  localPartFromEmail,
  resolveMxRecords,
  verifyLead,
};
