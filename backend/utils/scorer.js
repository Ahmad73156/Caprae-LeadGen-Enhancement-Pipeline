'use strict';

/**
 * Heuristic lead scoring engine.
 *
 * The score answers one question: how likely is it that a sales rep who
 * emails this address reaches a real buyer at a real company?
 *
 * Weights are tuned so deliverability (syntax + MX) dominates, firmographic
 * completeness adds lift, and consumer/shared/disposable addresses are
 * penalised rather than silently discarded.
 */

const WEIGHTS = {
  syntaxValid: 26,
  mxVerified: 30,
  domainValid: 12,
  companyPresent: 10,
  corporateDomain: 8,
  industryPresent: 5,
  websitePresent: 4,
  namedContact: 5,
};

const PENALTIES = {
  disposable: -45,
  freeProvider: -14,
  roleBased: -8,
  domainMismatch: -6,
  unconfirmedGuess: -10,
};

const THRESHOLDS = {
  high: 80,
  medium: 50,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hasNamedContact(email) {
  if (!email || !email.includes('@')) return false;
  const local = email.split('@')[0];
  // first.last, first_last, first-last or a word of 3+ letters
  return /[.\-_]/.test(local) || /^[a-z]{3,}$/i.test(local);
}

function qualityFromScore(score) {
  if (score >= THRESHOLDS.high) return 'High Quality';
  if (score >= THRESHOLDS.medium) return 'Medium';
  return 'Low Quality';
}

/**
 * @param {object} lead A verified lead produced by verifier.verifyLead()
 * @returns {{score:number, quality:string, scoreBreakdown:Array<{label:string,points:number}>}}
 */
function scoreLead(lead = {}) {
  const breakdown = [];
  let total = 0;

  const add = (label, points) => {
    if (!points) return;
    total += points;
    breakdown.push({ label, points });
  };

  if (lead.syntaxValid) {
    add('Valid email syntax', WEIGHTS.syntaxValid);
  } else {
    breakdown.push({ label: 'Invalid email syntax', points: 0 });
  }

  if (lead.mxVerified) {
    add('Mail servers confirmed', WEIGHTS.mxVerified);
  } else if (lead.mxStatus === 'error') {
    breakdown.push({ label: 'Mail server check unavailable', points: 0 });
  } else {
    breakdown.push({ label: 'No mail servers found', points: 0 });
  }

  if (lead.domainValid) add('Resolvable company domain', WEIGHTS.domainValid);
  if (lead.company) add('Company name on record', WEIGHTS.companyPresent);
  if (lead.industry) add('Industry captured', WEIGHTS.industryPresent);
  if (lead.website) add('Website captured', WEIGHTS.websitePresent);

  if (lead.domainValid && !lead.freeProvider && !lead.disposable) {
    add('Company-owned mailbox', WEIGHTS.corporateDomain);
  }

  if (!lead.roleBased && hasNamedContact(lead.email)) {
    add('Addressed to a named person', WEIGHTS.namedContact);
  }

  if (lead.disposable) add('Disposable inbox', PENALTIES.disposable);
  if (lead.freeProvider) add('Consumer mailbox', PENALTIES.freeProvider);
  if (lead.roleBased) add('Shared inbox', PENALTIES.roleBased);

  const emailDomain =
    lead.email && lead.email.includes('@')
      ? lead.email.split('@').pop().toLowerCase()
      : '';
  if (lead.domain && emailDomain && lead.domain !== emailDomain) {
    add('Email and company domain differ', PENALTIES.domainMismatch);
  }

  if (lead.emailSource === 'pattern-guess' && lead.emailConfidence !== 'confirmed') {
    add('Guessed email, not confirmed', PENALTIES.unconfirmedGuess);
  }

  // A lead that cannot receive mail can never clear the high-quality bar.
  let score = clamp(Math.round(total), 0, 100);
  if (!lead.syntaxValid || lead.disposable) {
    score = Math.min(score, 24);
  } else if (!lead.mxVerified) {
    score = Math.min(score, 58);
  }

  return {
    score,
    quality: qualityFromScore(score),
    scoreBreakdown: breakdown,
  };
}

module.exports = {
  WEIGHTS,
  PENALTIES,
  THRESHOLDS,
  scoreLead,
  qualityFromScore,
};
