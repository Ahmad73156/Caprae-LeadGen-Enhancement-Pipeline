'use strict';

const { normalizeDomain, isValidDomain } = require('./verifier');

/** Small keyword taxonomy used to guess an industry from homepage text. */
const INDUSTRY_KEYWORDS = [
  { label: 'Technology / Software', keywords: ['software', 'saas', 'platform', 'api', 'cloud', 'app', 'developer', 'engineering', 'ai', 'artificial intelligence', 'machine learning', 'data platform'] },
  { label: 'E-commerce / Retail', keywords: ['shop', 'store', 'cart', 'checkout', 'retail', 'ecommerce', 'e-commerce', 'products', 'shipping', 'catalog'] },
  { label: 'Healthcare', keywords: ['health', 'medical', 'clinic', 'patient', 'hospital', 'pharma', 'therapy', 'wellness', 'physician'] },
  { label: 'Finance / Fintech', keywords: ['finance', 'financial', 'banking', 'invest', 'insurance', 'payments', 'lending', 'fintech', 'wealth', 'accounting'] },
  { label: 'Logistics / Transportation', keywords: ['logistics', 'freight', 'shipping', 'fleet', 'supply chain', 'warehouse', 'delivery', 'trucking', 'transport'] },
  { label: 'Manufacturing', keywords: ['manufacturing', 'factory', 'production', 'industrial', 'machinery', 'fabrication', 'assembly'] },
  { label: 'Real Estate', keywords: ['real estate', 'property', 'realtor', 'leasing', 'mortgage', 'housing', 'tenant'] },
  { label: 'Education', keywords: ['education', 'school', 'university', 'course', 'learning', 'student', 'curriculum', 'training'] },
  { label: 'Food & Beverage', keywords: ['restaurant', 'food', 'beverage', 'menu', 'cafe', 'catering', 'kitchen', 'recipe'] },
  { label: 'Marketing / Advertising', keywords: ['marketing', 'advertising', 'agency', 'campaign', 'brand', 'seo', 'social media'] },
  { label: 'Legal', keywords: ['law firm', 'attorney', 'legal', 'lawyer', 'litigation', 'counsel'] },
  { label: 'Construction', keywords: ['construction', 'contractor', 'builder', 'renovation', 'architecture', 'building'] },
  { label: 'Hospitality / Travel', keywords: ['hotel', 'travel', 'booking', 'vacation', 'tourism', 'resort', 'flight'] },
  { label: 'Energy', keywords: ['energy', 'solar', 'renewable', 'utility', 'power plant', 'oil and gas'] },
  { label: 'Non-profit', keywords: ['nonprofit', 'non-profit', 'charity', 'donate', 'foundation', 'volunteer'] },
];

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Parse a tag's attributes into a { name: value } map, order independent. */
function parseAttributes(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*"([^"]*)"|([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*'([^']*)'/g;
  let match;
  while ((match = attrRegex.exec(tag)) !== null) {
    const name = (match[1] || match[3] || '').toLowerCase();
    const value = match[2] !== undefined ? match[2] : match[4];
    attrs[name] = value;
  }
  return attrs;
}

function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).slice(0, 300) : '';
}

function extractMetaDescription(html) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attrs = parseAttributes(tag);
    const key = (attrs.name || attrs.property || '').toLowerCase();
    if ((key === 'description' || key === 'og:description') && attrs.content) {
      return decodeEntities(attrs.content).slice(0, 400);
    }
  }
  return '';
}

function guessIndustry(text) {
  const haystack = text.toLowerCase();
  let best = { label: '', score: 0 };

  for (const entry of INDUSTRY_KEYWORDS) {
    const score = entry.keywords.reduce(
      (count, keyword) => count + (haystack.includes(keyword) ? 1 : 0),
      0
    );
    if (score > best.score) best = { label: entry.label, score };
  }

  return best.score > 0 ? best.label : '';
}

/** Strip tags/scripts/styles down to plain text, capped for the industry scan. */
function stripToText(html, maxChars = 4000) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Fetch a domain's public homepage and pull out light signals: title,
 * meta description, and a best-guess industry category. Best effort only;
 * a fetch failure returns a note rather than throwing, since a dead or
 * unreachable site is common and shouldn't break the caller.
 */
async function enrichDomain(domainOrWebsite, timeoutMs = 6000) {
  const host = normalizeDomain(domainOrWebsite);

  if (!host || !isValidDomain(host)) {
    return {
      siteTitle: '',
      siteDescription: '',
      detectedIndustry: '',
      note: 'No valid domain to enrich.',
      fetchedAt: new Date(),
    };
  }

  const attempts = ['https://' + host, 'http://' + host];

  for (const url of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; CapraeLeadGenBot/1.0; +https://example.com/bot)',
          Accept: 'text/html',
        },
      });

      clearTimeout(timer);

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('text/html')) {
        continue; // try the next scheme, or fall through to the final note
      }

      const rawHtml = await response.text();
      const html = rawHtml.slice(0, 250000); // cap parsing work on huge pages

      const siteTitle = extractTitle(html);
      const siteDescription = extractMetaDescription(html);
      const bodyText = stripToText(html);
      const detectedIndustry = guessIndustry(
        [siteTitle, siteDescription, bodyText].join(' ')
      );

      return {
        siteTitle,
        siteDescription,
        detectedIndustry,
        note: detectedIndustry
          ? 'Enriched from the homepage at ' + url + '.'
          : 'Fetched the homepage, but no industry keywords matched.',
        fetchedAt: new Date(),
      };
    } catch (error) {
      clearTimeout(timer);
      // Try the next URL scheme before giving up entirely.
    }
  }

  return {
    siteTitle: '',
    siteDescription: '',
    detectedIndustry: '',
    note: 'Could not reach ' + host + ' to enrich this lead.',
    fetchedAt: new Date(),
  };
}

module.exports = { enrichDomain, guessIndustry, extractTitle, extractMetaDescription };
