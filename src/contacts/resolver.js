'use strict';

/**
 * Contact resolution — looks up a decision-maker name, title, email, and LinkedIn
 * for every opportunity or lead that passes scoring.
 *
 * Resolution priority:
 *  1. Extract named contact or submission email directly from the opportunity posting.
 *  2. Search the org website (About, Team, Staff, Leadership pages) via HTTP + Cheerio.
 *  3. Target by role: small org (<20 staff) → ED/COO; mid org → Director of Tech/Ops;
 *     contract posting → named hiring manager (falls back to ED).
 *  4. Run name + domain through Hunter.io API for email verification / email finder.
 *  5. Return LinkedIn URL as fallback when email is not found.
 *
 * Never hallucinates — every field that cannot be found is returned as "unknown" or "".
 *
 * Output schema:
 * {
 *   name:         string,   // "Jane Smith" or "unknown"
 *   title:        string,   // "Executive Director" or "unknown"
 *   email:        string,   // "jane@org.org" or "unknown"
 *   linkedin_url: string,   // "https://linkedin.com/in/..." or ""
 *   confidence:   string,   // "high" | "medium" | "low"
 * }
 */

const https = require('https');
const http = require('http');

let cheerio;
try {
  cheerio = require('cheerio');
} catch {
  // Cheerio is a listed dependency; this catch is a safety net only.
  cheerio = null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 8000;
const USER_AGENT = 'Scout/0.1 (HosTechnology business-dev bot)';

const HUNTER_API_BASE = 'https://api.hunter.io/v2';

/**
 * Domains that host opportunity listings — URLs from these domains found in
 * the item description are NOT the org's own website.
 */
const OPPORTUNITY_PLATFORM_DOMAINS = new Set([
  'idealist.org',
  'propublica.org',
  'grants.gov',
  'sam.gov',
  'catchafire.org',
  'rfpdb.com',
  'philanthropynewsdigest.org',
  'linkedin.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'submittable.com',
  'zoomgrants.com',
  'jotform.com',
  'typeform.com',
  'guidestar.org',
  'candid.org',
]);

/**
 * Paths to attempt when searching an org website for staff/leadership contacts.
 * Tried in order; scraping stops at the first page that yields usable results.
 */
const STAFF_PAGE_PATHS = [
  '/about',
  '/team',
  '/our-team',
  '/staff',
  '/leadership',
  '/about-us',
  '/about/team',
  '/about/staff',
  '/about/leadership',
  '/who-we-are',
  '/people',
  '/board',
];

/** Title keywords used to identify Executive Directors / COOs (small org targets). */
const ED_TITLE_KEYWORDS = [
  'executive director',
  'president',
  'ceo',
  'chief executive',
];

/** Title keywords used to identify COOs. */
const COO_TITLE_KEYWORDS = [
  'chief operating',
  'coo',
];

/** Title keywords used to identify technology / operations directors (mid org targets). */
const TECH_OPS_TITLE_KEYWORDS = [
  'director of technology',
  'director of it',
  'chief technology',
  'cto',
  'technology director',
  'it director',
  'director of operations',
  'operations director',
  'director of digital',
  'digital director',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Empty / unknown contact object — returned whenever no contact can be found.
 *
 * @returns {object}
 */
function unknownContact() {
  return {
    name: 'unknown',
    title: 'unknown',
    email: 'unknown',
    linkedin_url: '',
    confidence: 'low',
  };
}

/**
 * Merge fields from `source` into `target`, skipping any field that is already
 * populated (non-empty and not "unknown").  Mutates `target`.
 *
 * @param {object} target
 * @param {object} source
 */
function mergeContact(target, source) {
  if (!source) return;
  for (const key of ['name', 'title', 'email', 'linkedin_url']) {
    const val = source[key];
    if (!val || val === 'unknown') continue;
    const existing = target[key];
    if (!existing || existing === 'unknown') {
      target[key] = val;
    }
  }
}

/**
 * Perform an HTTP/HTTPS GET request and resolve with the full response body.
 * Follows redirects up to MAX_REDIRECTS times.
 * Errors are NOT thrown — instead the promise resolves with null on failure.
 *
 * @param {string} rawUrl        URL to fetch.
 * @param {number} [redirects]   Remaining redirect budget (internal use).
 * @returns {Promise<string|null>}
 */
async function fetchHtml(rawUrl, redirects = MAX_REDIRECTS) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(rawUrl); } catch { return resolve(null); }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      rawUrl,
      {
        headers: { 'User-Agent': USER_AGENT },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        // Handle redirects.
        if (
          redirects > 0 &&
          (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
          res.headers.location
        ) {
          res.resume(); // drain socket
          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, rawUrl).toString();
          } catch {
            return resolve(null);
          }
          fetchHtml(redirectUrl, redirects - 1).then(resolve);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return resolve(null);
        }

        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', () => resolve(null));
      }
    );

    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/**
 * Perform a JSON API GET request against the Hunter.io API.
 * Returns null on any error (network failure, non-200 status, parse error).
 *
 * @param {string} endpoint  Full URL including query string.
 * @returns {Promise<object|null>}
 */
async function hunterGet(endpoint) {
  return new Promise((resolve) => {
    const req = https.get(
      endpoint,
      { headers: { 'User-Agent': USER_AGENT }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const chunks = [];
        res.on('data', (c) => { chunks.push(c); });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
        });
        res.on('error', () => resolve(null));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// ── Strategy 1: Extract from posting ─────────────────────────────────────────

/** Regex: bare email address. */
const EMAIL_RE = /\b([\w.+%-]+@[\w-]+\.[\w.]{2,})\b/gi;

/**
 * Regex to extract a person's name directly following a contact-signal keyword.
 *
 * Matches patterns like:
 *   "Contact Jane Smith at …"
 *   "Questions to John Doe <email>"
 *   "Submit to: Maria Lopez"
 *
 * The name must appear immediately after the keyword (optional colon/comma/space
 * separators only), and must NOT be followed by an @ sign (to avoid matching
 * email local-parts).
 *
 * @type {RegExp}  (global + case-insensitive; reset lastIndex before each use)
 */
const CONTACT_NAME_RE = new RegExp(
  '(?:' +
  'contact|questions\\s+to|inquiries\\s+to|reach\\s+out\\s+to|' +
  'apply\\s+to|send\\s+to|submit\\s+to|directed\\s+to|' +
  'addressed\\s+to|attention\\s+to|attn' +
  ')[:\\s,]+' +
  '([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,2})' +
  '(?!\\s*@)',
  'gi'
);

/** Regex: LinkedIn profile URL. */
const LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/([\w-]+)\/?/gi;

/**
 * Regex matching bare domain names (no protocol) in text, e.g. "example.org".
 * Handles common TLDs used by nonprofits.
 */
const BARE_DOMAIN_RE = /\b((?:[\w-]+\.)+(?:org|com|net|edu|gov|io|us|co))(?:\/[^\s"'<>)]*)?/gi;

/**
 * Look for contact information embedded directly in the opportunity posting.
 * Extracts the first email address, first LinkedIn URL, and attempts to find a
 * name immediately following a contact-signal keyword.
 *
 * @param {object} item  Opportunity or lead item.
 * @returns {object}     Partial contact object (fields may be empty strings).
 */
function extractFromPosting(item) {
  const result = { name: '', title: '', email: '', linkedin_url: '' };

  const text = [item.description, item.title, item.org].filter(Boolean).join(' ');

  // Email
  const emailMatch = EMAIL_RE.exec(text);
  EMAIL_RE.lastIndex = 0;
  if (emailMatch) {
    result.email = emailMatch[1].toLowerCase();
  }

  // LinkedIn
  const linkedinMatch = LINKEDIN_RE.exec(text);
  LINKEDIN_RE.lastIndex = 0;
  if (linkedinMatch) {
    result.linkedin_url = linkedinMatch[0];
  }

  // Name immediately following a contact-signal keyword.
  // Use the dedicated regex that requires the name to appear directly after the
  // keyword (with only optional colon/comma/space separators), preventing false
  // positives from names that appear much later in the same sentence.
  CONTACT_NAME_RE.lastIndex = 0;
  const nameMatch = CONTACT_NAME_RE.exec(text);
  CONTACT_NAME_RE.lastIndex = 0;
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  return result;
}

// ── Strategy 2: Org website scraping ─────────────────────────────────────────

/**
 * Derive the org's own domain from the item's description or org name.
 * Filters out known opportunity-platform domains.
 *
 * Returns null when no suitable domain can be found.
 *
 * @param {object} item
 * @returns {string|null}  e.g. "aclu.org" (no protocol, no trailing slash)
 */
function findOrgDomain(item) {
  const text = item.description || '';

  // 1. Full URLs (https://domain or http://domain)
  const urlRe = /https?:\/\/([\w.-]+(?:\.[\w]{2,})(?:\/[^\s"'<>]*)?)/gi;
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    const rawDomain = match[1].split('/')[0].toLowerCase().replace(/^www\./, '');
    if (!OPPORTUNITY_PLATFORM_DOMAINS.has(rawDomain)) {
      return rawDomain;
    }
  }

  // 2. Bare domain names (e.g. "democracyforward.org" in parentheses or prose)
  BARE_DOMAIN_RE.lastIndex = 0;
  let bareDomainMatch;
  while ((bareDomainMatch = BARE_DOMAIN_RE.exec(text)) !== null) {
    const rawDomain = bareDomainMatch[1].toLowerCase().replace(/^www\./, '');
    if (!OPPORTUNITY_PLATFORM_DOMAINS.has(rawDomain)) {
      return rawDomain;
    }
  }

  // 3. Fall back to the item's own URL hostname if it's not a platform domain.
  if (item.url) {
    try {
      const u = new URL(item.url);
      const rawDomain = u.hostname.replace(/^www\./, '');
      if (!OPPORTUNITY_PLATFORM_DOMAINS.has(rawDomain)) {
        return rawDomain;
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Determine the preferred target role for contact lookup based on the item type
 * and a rough org-size heuristic derived from the description text.
 *
 * @param {object} item  Opportunity or lead.
 * @returns {'ed'|'coo'|'tech'|'hiring_manager'}
 */
function targetRole(item) {
  // Contracts often name a hiring manager.
  if (item.type === 'contract') return 'hiring_manager';

  // Try to infer org size from description text.
  const desc = (item.description || '').toLowerCase();
  const staffMatch = desc.match(/(?:team|staff|employees?)\s+of\s+(\d+)/);
  const staffCount = staffMatch ? parseInt(staffMatch[1], 10) : null;

  if (staffCount !== null && staffCount >= 20) return 'tech';
  return 'ed'; // default — small org, go for ED/COO
}

/**
 * Extract a staff contact from a parsed Cheerio HTML document.
 * Looks for common name+title patterns on nonprofit "About/Team/Staff" pages.
 *
 * Respects the `role` hint to prefer candidates matching the target title.
 *
 * @param {CheerioStatic} $     Loaded Cheerio instance.
 * @param {'ed'|'coo'|'tech'|'hiring_manager'} role
 * @returns {object}  Partial contact (fields may be empty strings).
 */
function extractContactFromDom($, role) {
  if (!$) return { name: '', title: '', email: '', linkedin_url: '' };

  /**
   * Score a title string against the priority lists for the current role.
   * Higher is better.  Returns 0 if no match.
   */
  function titleScore(titleStr) {
    const lower = titleStr.toLowerCase();
    if (role === 'tech') {
      for (const kw of TECH_OPS_TITLE_KEYWORDS) {
        if (lower.includes(kw)) return 3;
      }
    }
    for (const kw of ED_TITLE_KEYWORDS) {
      if (lower.includes(kw)) return 2;
    }
    for (const kw of COO_TITLE_KEYWORDS) {
      if (lower.includes(kw)) return 1;
    }
    return 0;
  }

  // Collect candidate {name, title, email, linkedin_url} entries from the DOM.
  const candidates = [];

  // Pattern A — elements with common staff-name class names.
  const nameSelectors = [
    '.staff-name', '.team-member-name', '.member-name', '.person-name',
    '.name', '[class*="staff"] h3', '[class*="team"] h3', '[class*="people"] h3',
    '[class*="leadership"] h3', '[class*="staff"] h4', '[class*="team"] h4',
    '.card-title', '.bio-name', 'h3.name', 'h4.name',
  ];

  for (const sel of nameSelectors) {
    $(sel).each((_, el) => {
      const nameText = $(el).text().trim();
      if (!nameText || nameText.length > 60) return;

      // Look for a title in a sibling or child element.
      let titleText = '';
      const sibling = $(el).next('[class*="title"],[class*="role"],[class*="position"],[class*="job"]');
      if (sibling.length) {
        titleText = sibling.first().text().trim();
      }
      if (!titleText) {
        titleText = $(el).siblings('[class*="title"],[class*="role"]').first().text().trim();
      }
      if (!titleText) {
        titleText = $(el).parent().find('[class*="title"],[class*="role"]').first().text().trim();
      }

      // LinkedIn link near this element.
      let linkedin = '';
      const nearbyLinks = $(el).closest('[class*="card"],[class*="member"],[class*="staff"],[class*="person"]').find('a[href*="linkedin.com"]');
      if (nearbyLinks.length) {
        linkedin = nearbyLinks.attr('href') || '';
      }

      candidates.push({ name: nameText, title: titleText, email: '', linkedin_url: linkedin });
    });
  }

  // Pattern B — definition-list / label + value pairs (e.g. "Executive Director: Jane Smith").
  const bodyText = $('body').text();
  const labelRe = /(executive director|president|ceo|chief operating officer|coo|director of technology|cto|director of operations)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/gi;
  let labelMatch;
  while ((labelMatch = labelRe.exec(bodyText)) !== null) {
    candidates.push({
      name: labelMatch[2].trim(),
      title: labelMatch[1].trim(),
      email: '',
      linkedin_url: '',
    });
  }

  // Pattern C — email addresses anywhere in the page.
  let pageEmail = '';
  EMAIL_RE.lastIndex = 0;
  const pageEmailMatch = EMAIL_RE.exec(bodyText);
  EMAIL_RE.lastIndex = 0;
  if (pageEmailMatch) pageEmail = pageEmailMatch[1].toLowerCase();

  // Pattern D — LinkedIn profile URLs.
  let pageLinkedin = '';
  LINKEDIN_RE.lastIndex = 0;
  const pageLinkedinMatch = LINKEDIN_RE.exec($('body').html() || '');
  LINKEDIN_RE.lastIndex = 0;
  if (pageLinkedinMatch) pageLinkedin = pageLinkedinMatch[0];

  // Pick the best candidate based on title score.
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const s = titleScore(c.title);
    if (s > bestScore) { best = c; bestScore = s; }
  }

  if (!best && candidates.length > 0) best = candidates[0];

  return {
    name: best?.name || '',
    title: best?.title || '',
    email: best?.email || pageEmail,
    linkedin_url: best?.linkedin_url || pageLinkedin,
  };
}

/**
 * Scrape an org's website to find a decision-maker contact.
 * Tries multiple pages (about, team, staff, leadership …) and returns the
 * first set of useful results, or an empty contact on failure.
 *
 * @param {string} domain   The org's domain (no protocol, no trailing slash).
 * @param {object} item     Opportunity / lead item (used for role targeting).
 * @returns {Promise<object>}
 */
async function scrapeOrgWebsite(domain, item) {
  if (!cheerio) return { name: '', title: '', email: '', linkedin_url: '' };

  const role = targetRole(item);

  for (const pagePath of STAFF_PAGE_PATHS) {
    const url = `https://${domain}${pagePath}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch {
      continue;
    }
    if (!html) continue;

    let $;
    try {
      $ = cheerio.load(html);
    } catch {
      continue;
    }

    const contact = extractContactFromDom($, role);

    // Only return if we found at least a name.
    if (contact.name) {
      console.log(`[contacts] Found contact on ${url}: ${contact.name} (${contact.title || 'no title'})`);
      return contact;
    }
  }

  return { name: '', title: '', email: '', linkedin_url: '' };
}

// ── Strategy 4: Hunter.io ─────────────────────────────────────────────────────

/**
 * Attempt email lookup via Hunter.io.
 *
 * - If a name is known: uses the Email Finder endpoint (more targeted, one lookup).
 * - Otherwise: uses the Domain Search endpoint (returns top staff emails).
 *
 * Returns an empty contact object when HUNTER_API_KEY is not set, when the
 * API returns an error, or when nothing useful is found.
 *
 * @param {string} domain   Org's domain (no protocol).
 * @param {string} name     Known contact name ("" if unknown).
 * @param {string} apiKey   Hunter.io API key.
 * @returns {Promise<object>}
 */
async function lookupWithHunter(domain, name, apiKey) {
  const result = { name: '', title: '', email: '', linkedin_url: '' };

  if (name && name !== 'unknown') {
    // Email Finder: supply first + last name.
    const parts = name.trim().split(/\s+/);
    const firstName = encodeURIComponent(parts[0] || '');
    const lastName = encodeURIComponent(parts.slice(1).join(' ') || '');
    if (!firstName || !lastName) {
      // Can't run email-finder with only one name part; fall through to domain search.
    } else {
      const url = `${HUNTER_API_BASE}/email-finder?domain=${encodeURIComponent(domain)}&first_name=${firstName}&last_name=${lastName}&api_key=${apiKey}`;
      const data = await hunterGet(url);
      const email = data?.data?.email;
      const confidence = data?.data?.score;
      if (email) {
        result.email = email;
        // Hunter also returns first_name, last_name in some responses.
        if (data.data.first_name && data.data.last_name) {
          result.name = `${data.data.first_name} ${data.data.last_name}`;
        }
        if (data.data.position) result.title = data.data.position;
        if (data.data.linkedin) result.linkedin_url = data.data.linkedin;
        console.log(`[contacts] Hunter email-finder: ${email} (score: ${confidence})`);
        return result;
      }
    }
  }

  // Domain Search: find top executive emails for the domain.
  const url = `${HUNTER_API_BASE}/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`;
  const data = await hunterGet(url);
  const emails = data?.data?.emails;
  if (!Array.isArray(emails) || emails.length === 0) return result;

  // Prefer executives/directors; fall back to first available.
  const preferred = emails.find((e) => {
    const pos = (e.position || '').toLowerCase();
    const dept = (e.department || '').toLowerCase();
    return (
      pos.includes('executive') || pos.includes('director') ||
      pos.includes('president') || pos.includes('ceo') ||
      dept === 'executive' || dept === 'management'
    );
  }) || emails[0];

  if (preferred.value) result.email = preferred.value;
  if (preferred.first_name && preferred.last_name) {
    result.name = `${preferred.first_name} ${preferred.last_name}`;
  }
  if (preferred.position) result.title = preferred.position;
  if (preferred.linkedin) result.linkedin_url = preferred.linkedin;

  if (result.email) {
    console.log(`[contacts] Hunter domain-search: ${result.email} (${result.name || 'no name'})`);
  }
  return result;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a contact for an opportunity or lead item.
 *
 * Tries all strategies in priority order and returns the best result found.
 * Never hallucinates — every field that cannot be found is "unknown" or "".
 *
 * @param {object} item  Opportunity or lead object from a source plugin.
 * @returns {Promise<object>}  Contact object matching the output schema.
 */
async function resolveContact(item) {
  const contact = unknownContact();

  // ── Strategy 1: Extract from posting ──────────────────────────────────────
  try {
    const fromPosting = extractFromPosting(item);
    mergeContact(contact, fromPosting);
  } catch (err) {
    console.warn(`[contacts] Strategy 1 (posting extract) error: ${err.message}`);
  }

  // Short-circuit: if we already have email + name from the posting, confidence
  // is high and there is nothing more to do.
  if (contact.email !== 'unknown' && contact.name !== 'unknown') {
    contact.confidence = 'high';
    return contact;
  }

  // ── Strategy 2: Scrape org website ────────────────────────────────────────
  let orgDomain = null;
  try {
    orgDomain = findOrgDomain(item);
  } catch (err) {
    console.warn(`[contacts] Could not determine org domain: ${err.message}`);
  }

  if (orgDomain) {
    try {
      const fromWebsite = await scrapeOrgWebsite(orgDomain, item);
      mergeContact(contact, fromWebsite);
    } catch (err) {
      console.warn(`[contacts] Strategy 2 (website scrape) error for ${orgDomain}: ${err.message}`);
    }
  }

  // ── Strategy 4: Hunter.io ─────────────────────────────────────────────────
  const hunterKey = process.env.HUNTER_API_KEY;
  if (hunterKey && orgDomain) {
    try {
      const fromHunter = await lookupWithHunter(
        orgDomain,
        contact.name !== 'unknown' ? contact.name : '',
        hunterKey
      );
      mergeContact(contact, fromHunter);
    } catch (err) {
      console.warn(`[contacts] Strategy 4 (Hunter.io) error: ${err.message}`);
    }
  }

  // ── Assign confidence ──────────────────────────────────────────────────────
  const hasEmail = contact.email && contact.email !== 'unknown';
  const hasName = contact.name && contact.name !== 'unknown';

  if (hasEmail && hasName) {
    contact.confidence = 'high';
  } else if (hasEmail || hasName || contact.linkedin_url) {
    contact.confidence = 'medium';
  } else {
    contact.confidence = 'low';
  }

  return contact;
}

module.exports = { resolveContact, extractFromPosting, findOrgDomain, lookupWithHunter };
