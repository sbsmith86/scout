'use strict';

/**
 * RFPDB.com source plugin — Contract Finder (Agent 1).
 *
 * RFPDB.com is a free RFP database with category and issuer filters.  This
 * plugin targets the intersection of:
 *   • Category: technology
 *   • Issuer:   non_profit
 *
 * Implementation strategy (in order of preference):
 *   1. RSS feed — RFPDB exposes per-category and per-issuer Atom/RSS feeds.
 *      We try to discover usable feed URLs from https://rfpdb.com/view/feeds
 *      and parse them with rss-parser.  If a technology feed is available it
 *      is parsed and items are filtered/labelled for nonprofit issuers.
 *   2. Cheerio scrape — If no usable RSS is found the plugin falls back to
 *      scraping https://rfpdb.com/view/category/name/technology (static HTML)
 *      and cross-referencing with https://rfpdb.com/view/issuer/name/non_profit.
 *
 * All output is normalised to the standard opportunity schema with type: 'contract'.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const cheerio = require('cheerio');
const RSSParser = require('rss-parser');

const BASE_URL = 'https://www.rfpdb.com';

/** Feed discovery page — lists all available RSS/Atom feeds. */
const FEEDS_PAGE_URL = 'https://www.rfpdb.com/view/feeds';

/** Category + issuer pages for Cheerio fallback. */
const TECH_CATEGORY_URL = 'https://www.rfpdb.com/view/category/name/technology';
const NONPROFIT_ISSUER_URL = 'https://www.rfpdb.com/view/issuer/name/non_profit';

/** Candidate RSS feed URLs tried in order before feed-discovery parsing. */
const CANDIDATE_FEED_URLS = [
  // Common Drupal View feed URL patterns
  'https://www.rfpdb.com/view/category/name/technology/feed',
  'https://www.rfpdb.com/view/category/name/technology/feed/rss',
  'https://www.rfpdb.com/view/category/name/technology/rss.xml',
  'https://rfpdb.com/view/category/name/technology/feed',
  'https://rfpdb.com/view/category/name/technology/feed/rss',
];

/** Maximum pages to scrape per run. */
const MAX_PAGES = 5;

/**
 * Regex that matches RFPDB detail page path segments.
 * Handles paths like /rfps/<id>, /rfp/<id>, and /view/rfp/<id>.
 */
const RFP_PATH_RE = /\/(rfps?|view\/rfp)\//i;

/**
 * Regex for extracting issuing organization from free-text descriptions.
 * Matches common label variants followed by a colon/space and captures the value.
 */
const ISSUER_LABEL_RE = /(?:issuer|agency|organization|organisation|issued by)[:\s]+([^\n,<]+)/i;

/** Polite delay between page requests (ms). */
const REQUEST_DELAY_MS = (() => {
  const fromEnv = Number(process.env.RFPDB_REQUEST_DELAY_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 2000;
})();

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(num) {
  return num.toString().padStart(2, '0');
}

const MONTH_NAMES = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/**
 * Deterministic ID derived from the listing URL.
 *
 * @param {string} url
 * @returns {string}
 */
function makeId(url) {
  const key = url && url.length > 0 ? url : `${TECH_CATEGORY_URL}#missing-url`;
  return `rfpdb-${crypto.createHash('md5').update(key).digest('hex').slice(0, 10)}`;
}

/**
 * Parse a date string to ISO `YYYY-MM-DD`.  Returns null on failure.
 *
 * Handles:
 *   - Named-month formats: "March 31, 2025" / "Mar 31 2025"
 *   - Numeric formats:     "03/31/2025" / "3-31-2025"
 *   - ISO format:          "2025-03-31"
 *   - ISO datetime:        "2025-03-31T…"
 *
 * @param {string|Date} raw
 * @returns {string|null}
 */
function parseDeadline(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())}`;
  }

  const cleaned = String(raw).replace(/deadline:?\s*/i, '').trim();
  if (!cleaned) return null;

  const value = cleaned.replace(/\s+/g, ' ').trim();

  // ISO datetime: "2025-03-31T00:00:00Z" or "2025-03-31 12:00:00"
  const isoDatetimeMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s)/);
  if (isoDatetimeMatch) return `${isoDatetimeMatch[1]}-${isoDatetimeMatch[2]}-${isoDatetimeMatch[3]}`;

  // ISO date: "2025-03-31"
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // Named-month: "March 31, 2025" or "Mar 31 2025"
  const monthNameMatch = value.match(/^([A-Za-z.]+)\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (monthNameMatch) {
    const monthKey = monthNameMatch[1].replace(/\./g, '').toLowerCase();
    const month = MONTH_NAMES[monthKey];
    const day = parseInt(monthNameMatch[2], 10);
    let year = parseInt(monthNameMatch[3], 10);
    if (!month || day < 1 || day > 31) return null;
    if (year < 100) year += 2000;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  // Numeric: "03/31/2025" or "3-31-2025"
  const numericMatch = value.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (numericMatch) {
    const month = parseInt(numericMatch[1], 10);
    const day = parseInt(numericMatch[2], 10);
    let year = parseInt(numericMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (year < 100) year += 2000;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  // Try native Date parse as last resort (handles RFC 2822 from RSS pubDate)
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
  }

  return null;
}

/**
 * Raw HTTP/HTTPS GET — returns `{ statusCode, contentType, body }`.
 * Follows up to `redirectsRemaining` redirects (HTTPS only after first hop).
 *
 * @param {string} url
 * @param {number} [redirectsRemaining=3]
 * @returns {Promise<{statusCode: number, contentType: string, body: string}>}
 */
function fetchRaw(url, redirectsRemaining = 3) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const req = transport.get(
      url,
      {
        headers: {
          'User-Agent': 'Scout/0.1 (HosTechnology business-dev bot)',
          'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml',
        },
        timeout: 20000,
      },
      (res) => {
        if (
          (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
          res.headers.location
        ) {
          console.warn(`[rfpdb] Redirect (HTTP ${res.statusCode}) → ${res.headers.location}`);
          res.resume();

          if (redirectsRemaining <= 0) {
            resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'] || '', body: '' });
            return;
          }

          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, url).toString();
          } catch (e) {
            reject(e);
            return;
          }

          fetchRaw(redirectUrl, redirectsRemaining - 1).then(resolve).catch(reject);
          return;
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'] || '', body });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 20 s'));
    });
  });
}

/**
 * Returns true if the response body looks like XML (RSS or Atom).
 *
 * @param {string} body
 * @param {string} contentType
 * @returns {boolean}
 */
function looksLikeXml(body, contentType) {
  const ct = contentType.toLowerCase();
  if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom')) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') || trimmed.startsWith('<feed');
}

/**
 * Returns true if the response body looks like HTML.
 *
 * @param {string} body
 * @returns {boolean}
 */
function looksLikeHtml(body) {
  const t = body.trimStart().toLowerCase();
  return t.startsWith('<html') || t.startsWith('<!doctype');
}

// ── RSS strategy ─────────────────────────────────────────────────────────────

/**
 * Attempt to discover the technology-category RSS feed URL from the feeds
 * discovery page, falling back to the candidate URL list.
 *
 * @returns {Promise<string|null>}  Feed URL, or null if not found.
 */
async function discoverFeedUrl() {
  // 1. Try candidate URLs first (avoids an extra round-trip in the common case).
  for (const candidate of CANDIDATE_FEED_URLS) {
    try {
      const { statusCode, contentType, body } = await fetchRaw(candidate);
      if (statusCode === 200 && looksLikeXml(body, contentType)) {
        console.log(`[rfpdb] Discovered RSS feed at candidate URL: ${candidate}`);
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  // 2. Parse the feeds discovery page for a link to a technology feed.
  try {
    const { statusCode, body } = await fetchRaw(FEEDS_PAGE_URL);
    if (statusCode !== 200 || !body) return null;

    const $ = cheerio.load(body);
    let techFeedUrl = null;

    // Look for anchor tags whose href contains a technology/tech feed path and
    // whose text or surrounding context mentions "technology".
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().toLowerCase();
      if (
        (href.toLowerCase().includes('technology') || text.includes('technology')) &&
        (href.toLowerCase().includes('feed') || href.toLowerCase().includes('rss') || href.toLowerCase().includes('atom'))
      ) {
        try {
          techFeedUrl = new URL(href, FEEDS_PAGE_URL).toString();
        } catch {
          // skip
        }
        return false; // break .each()
      }
    });

    if (techFeedUrl) {
      console.log(`[rfpdb] Discovered RSS feed from feeds page: ${techFeedUrl}`);
    }
    return techFeedUrl;
  } catch (err) {
    console.warn(`[rfpdb] Feed discovery page unreachable: ${err.message}`);
    return null;
  }
}

/**
 * Fetch and parse the RSS/Atom feed at `feedUrl`.  Returns an array of
 * normalised opportunity objects.
 *
 * @param {string} feedUrl
 * @returns {Promise<object[]>}
 */
async function fetchViaRss(feedUrl) {
  const parser = new RSSParser({
    timeout: 20000,
    headers: {
      'User-Agent': 'Scout/0.1 (HosTechnology business-dev bot)',
      'Accept': 'application/rss+xml, application/atom+xml, text/xml, */*',
    },
    customFields: {
      item: [
        ['rfpdb:deadline', 'rfpdbDeadline'],
        ['rfpdb:issuer', 'rfpdbIssuer'],
        ['rfpdb:budget', 'rfpdbBudget'],
        ['category', 'categories', { keepArray: true }],
      ],
    },
  });

  let feed;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (err) {
    console.warn(`[rfpdb] RSS parse failed (${feedUrl}): ${err.message}`);
    return [];
  }

  if (!feed.items || feed.items.length === 0) {
    console.warn(`[rfpdb] RSS feed returned 0 items (${feedUrl})`);
    return [];
  }

  console.log(`[rfpdb] RSS feed returned ${feed.items.length} item(s)`);

  const opportunities = [];
  for (const item of feed.items) {
    const title = (item.title || '').trim();
    const url = (item.link || item.guid || '').trim();

    if (!title || !url) continue;

    // Org: try custom field, then extract from content/description
    const org = extractOrgFromItem(item);

    // Deadline: custom field → pubDate fallback
    let deadline = null;
    if (item.rfpdbDeadline) {
      deadline = parseDeadline(item.rfpdbDeadline);
    }
    if (!deadline && item.pubDate) {
      deadline = parseDeadline(new Date(item.pubDate));
    }

    // Budget: custom field
    const budget = item.rfpdbBudget ? String(item.rfpdbBudget).trim() || null : null;

    // Description: content:encoded → contentSnippet → summary
    const description = (
      item['content:encoded'] ||
      item.contentSnippet ||
      item.content ||
      item.summary ||
      ''
    ).trim();

    opportunities.push({
      id: makeId(url),
      source: 'rfpdb',
      title,
      org: org || 'Unknown Organization',
      url,
      deadline,
      budget,
      description: description || title,
      type: 'contract',
    });
  }

  return opportunities;
}

/**
 * Try to extract the issuing organization name from an RSS item.
 *
 * RFPDB often embeds the org name in the item description, custom elements, or
 * the "author" field.  We try several approaches in order.
 *
 * @param {object} item  rss-parser item
 * @returns {string}
 */
function extractOrgFromItem(item) {
  // 1. Custom RFPDB field
  if (item.rfpdbIssuer && typeof item.rfpdbIssuer === 'string') {
    return item.rfpdbIssuer.trim();
  }

  // 2. <author> or <dc:creator>
  const author = item.author || item.creator || item['dc:creator'] || '';
  if (author && author.trim()) return author.trim();

  // 3. Heuristic scan of the description/content for "Issuer: …" or "Agency: …"
  const text = (
    item['content:encoded'] ||
    item.contentSnippet ||
    item.content ||
    item.summary ||
    ''
  );

  const issuerMatch = text.match(ISSUER_LABEL_RE);
  if (issuerMatch) return issuerMatch[1].trim();

  return '';
}

// ── Cheerio scrape strategy ───────────────────────────────────────────────────

/**
 * Scrape the RFPDB technology category page and return normalised opportunity
 * objects.  Paginates up to MAX_PAGES.
 *
 * @returns {Promise<object[]>}
 */
async function fetchViaScrape() {
  // Build the set of URLs seen on the nonprofit issuer page so we can
  // intersect (filter) the technology results to nonprofit-only.
  const nonprofitUrls = await fetchNonprofitUrls();
  console.log(`[rfpdb] Scraped ${nonprofitUrls.size} nonprofit RFP URL(s) for intersection filter`);

  const opportunities = [];
  const seen = new Set();
  let pageNum = 1;
  let morePages = true;

  while (morePages && pageNum <= MAX_PAGES) {
    const pageUrl =
      pageNum === 1
        ? TECH_CATEGORY_URL
        : `${TECH_CATEGORY_URL}/page/${pageNum}`;

    console.log(`[rfpdb] Scraping technology page ${pageNum}: ${pageUrl}`);

    let rawResponse;
    try {
      rawResponse = await fetchRaw(pageUrl);
    } catch (err) {
      console.warn(`[rfpdb] Request failed (${pageUrl}): ${err.message}`);
      break;
    }

    const { statusCode, contentType, body } = rawResponse;

    if (statusCode !== 200) {
      console.warn(`[rfpdb] HTTP ${statusCode} for ${pageUrl} — stopping`);
      break;
    }

    if (!looksLikeHtml(body)) {
      console.warn(`[rfpdb] Non-HTML response (${contentType}) on page ${pageNum} — stopping`);
      break;
    }

    const $ = cheerio.load(body);
    const listings = parseScrapedListings($, nonprofitUrls);

    if (listings.length === 0) {
      console.warn(`[rfpdb] 0 listings on page ${pageNum} — stopping pagination`);
      morePages = false;
    } else {
      let added = 0;
      for (const listing of listings) {
        const id = makeId(listing.url);
        if (!seen.has(id)) {
          seen.add(id);
          opportunities.push({
            id,
            source: 'rfpdb',
            title: listing.title,
            org: listing.org || 'Unknown Organization',
            url: listing.url,
            deadline: listing.deadline,
            budget: listing.budget,
            description: listing.description,
            type: 'contract',
          });
          added++;
        }
      }
      console.log(`[rfpdb] Page ${pageNum}: ${listings.length} listings, ${added} new`);
      morePages = hasNextPage($);
      pageNum++;
      if (morePages) await delay(REQUEST_DELAY_MS);
    }
  }

  return opportunities;
}

/**
 * Fetch the nonprofit issuer page and return a Set of absolute RFP URLs.
 * Used for intersection filtering when scraping the technology category.
 *
 * @returns {Promise<Set<string>>}
 */
async function fetchNonprofitUrls() {
  const urls = new Set();
  let pageNum = 1;
  let morePages = true;

  while (morePages && pageNum <= MAX_PAGES) {
    const pageUrl =
      pageNum === 1
        ? NONPROFIT_ISSUER_URL
        : `${NONPROFIT_ISSUER_URL}/page/${pageNum}`;

    let rawResponse;
    try {
      rawResponse = await fetchRaw(pageUrl);
    } catch (err) {
      console.warn(`[rfpdb] Nonprofit page request failed (${pageUrl}): ${err.message}`);
      break;
    }

    const { statusCode, body } = rawResponse;
    if (statusCode !== 200 || !looksLikeHtml(body)) break;

    const $ = cheerio.load(body);
    extractListingUrls($).forEach((u) => urls.add(u));

    morePages = hasNextPage($);
    pageNum++;
    if (morePages) await delay(REQUEST_DELAY_MS);
  }

  return urls;
}

/**
 * Extract all RFP listing URLs from a Cheerio-parsed page.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string[]}
 */
function extractListingUrls($) {
  const urls = [];
  // Primary: listing rows/cards that link to an RFP detail page
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href) return;
    try {
      const abs = new URL(href, BASE_URL).toString();
      // RFPDB detail pages have paths like /rfps/<id> or /view/rfp/<id>
      if (isRfpDetailPath(new URL(abs).pathname)) {
        urls.push(abs);
      }
    } catch {
      // skip
    }
  });
  return urls;
}

/**
 * Parse RFP listings from a Cheerio-loaded technology category page.
 * When `nonprofitUrls` is non-empty, only listings whose detail URL appears
 * in that set are included (intersection with nonprofit issuer).
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {Set<string>} [nonprofitUrls]
 * @returns {object[]}
 */
function parseScrapedListings($, nonprofitUrls) {
  const listings = [];

  // RFPDB uses a table or list layout.  Try several card container selectors.
  const cardSelectors = [
    'table.rfp-list tbody tr',
    'table tbody tr',
    '.rfp-listing',
    '.rfp-item',
    '.listing-row',
    'ul.rfps li',
    '.views-row',         // Drupal Views row class
    '.view-content .views-row',
    '.view-content > div',
    'tr.views-row',
  ];

  let cards = $();
  for (const sel of cardSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      cards = found;
      break;
    }
  }

  if (cards.length === 0) {
    // Last-resort: scan all links pointing to RFP detail pages
    $('a[href]').each((_, el) => {
      const a = $(el);
      const href = a.attr('href') || '';
      const title = a.text().trim();
      if (!title || !href) return;

      let abs;
      try {
        abs = new URL(href, BASE_URL).toString();
        if (!isRfpDetailPath(new URL(abs).pathname)) return;
      } catch {
        return;
      }

      if (nonprofitUrls && nonprofitUrls.size > 0 && !nonprofitUrls.has(abs)) return;

      listings.push({
        title,
        org: '',
        url: abs,
        deadline: null,
        budget: null,
        description: title,
      });
    });
    return listings;
  }

  cards.each((_, el) => {
    const card = $(el);

    // ── Title & URL ─────────────────────────────────────────────────────────
    const titleSelectors = [
      '.views-field-title a',
      '.rfp-title a',
      '.title a',
      'td.title a',
      'h2 a', 'h3 a', 'h4 a',
      'a[href*="/rfp"]',
    ];

    let titleEl = null;
    for (const sel of titleSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { titleEl = found.first(); break; }
    }

    // Some rows expose an inline link without a specific title class
    if (!titleEl) {
      const links = card.find('a[href]');
      links.each((__, a) => {
        const href = $(a).attr('href') || '';
        try {
          if (isRfpDetailPath(new URL(href, BASE_URL).pathname)) {
            titleEl = $(a);
            return false;
          }
        } catch {
          // skip unparsable hrefs
        }
      });
    }

    if (!titleEl) return; // skip rows without a recognisable RFP link

    const title = titleEl.text().trim();
    const href = titleEl.attr('href') || '';
    if (!title || !href) return;

    let url;
    try {
      url = new URL(href, BASE_URL).toString();
    } catch {
      return;
    }

    // Intersection filter: skip if not in the nonprofit set (when set is non-empty)
    if (nonprofitUrls && nonprofitUrls.size > 0 && !nonprofitUrls.has(url)) return;

    // ── Organisation ────────────────────────────────────────────────────────
    const orgSelectors = [
      '.views-field-field-issuer',
      '.views-field-field-organization',
      '.views-field-field-agency',
      '.rfp-org', '.org-name', '.issuer',
      'td.issuer', 'td.organization', 'td.org',
    ];

    let org = '';
    for (const sel of orgSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { org = found.first().text().trim(); break; }
    }

    // ── Deadline ────────────────────────────────────────────────────────────
    const deadlineSelectors = [
      '.views-field-field-deadline',
      '.views-field-field-closing-date',
      '.deadline', '[class*="deadline"]',
      'td.deadline', 'td.due-date',
      'time[datetime]',
    ];

    let deadlineRaw = '';
    for (const sel of deadlineSelectors) {
      const found = card.find(sel);
      if (found.length > 0) {
        const dt = found.first().attr('datetime');
        deadlineRaw = dt || found.first().text().trim();
        break;
      }
    }

    if (!deadlineRaw) {
      card.find('*').each((__, node) => {
        const text = $(node).text();
        if (/deadline|due date|closing date/i.test(text)) {
          deadlineRaw = text;
          return false;
        }
      });
    }

    const deadline = parseDeadline(deadlineRaw);

    // ── Budget ──────────────────────────────────────────────────────────────
    const budgetSelectors = [
      '.views-field-field-budget',
      '.views-field-field-value',
      '.budget', '[class*="budget"]',
      'td.budget', 'td.value',
    ];

    let budget = null;
    for (const sel of budgetSelectors) {
      const found = card.find(sel);
      if (found.length > 0) {
        const t = found.first().text().trim();
        if (t) { budget = t; break; }
      }
    }

    // ── Description / Summary ───────────────────────────────────────────────
    const descSelectors = [
      '.views-field-body',
      '.views-field-field-description',
      '.description', '.summary', '[class*="description"]',
    ];

    let description = '';
    for (const sel of descSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { description = found.first().text().trim(); break; }
    }

    if (!description) {
      description = card.find('p').map((__, p) => $(p).text().trim()).get().join(' ').trim();
    }

    listings.push({ title, org, url, deadline, budget, description: description || title });
  });

  return listings;
}

/**
 * Returns true if the page has a next-page link.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {boolean}
 */
function hasNextPage($) {
  const nextSelectors = [
    'a[rel="next"]',
    'a[aria-label="Next page"]',
    '.pager-next a',
    '.pagination .next:not(.disabled)',
    '.pagination a.next',
    '[class*="pagination"] a[class*="next"]',
    'li.next a',
  ];
  for (const sel of nextSelectors) {
    try {
      if ($(sel).length > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Returns true if `urlPathname` looks like an RFPDB RFP detail page.
 *
 * @param {string} urlPathname
 * @returns {boolean}
 */
function isRfpDetailPath(urlPathname) {
  return RFP_PATH_RE.test(urlPathname);
}

// ── Plugin export ─────────────────────────────────────────────────────────────

module.exports = {
  id: 'rfpdb',
  name: 'RFPDB.com',
  type: 'scrape',

  /**
   * Fetch active technology RFPs from nonprofit issuers on RFPDB.com.
   *
   * Tries RSS first; falls back to Cheerio scraping.
   *
   * @param {object} _profile  The HosTechnology profile (unused for fetching).
   * @returns {Promise<object[]>}  Normalised opportunity objects.
   */
  fetch: async (_profile) => {
    // ── 1. Validate accessibility ─────────────────────────────────────────
    let accessible = false;
    try {
      const { statusCode } = await fetchRaw(TECH_CATEGORY_URL);
      accessible = statusCode === 200;
    } catch (err) {
      console.warn(`[rfpdb] Accessibility check failed: ${err.message}`);
    }

    if (!accessible) {
      console.warn(
        '[rfpdb] WARN: RFPDB.com technology category page is not accessible. ' +
        'Verify https://www.rfpdb.com/view/category/name/technology is reachable.'
      );
      return [];
    }

    console.log('[rfpdb] Accessibility check passed — proceeding with fetch');

    // ── 2. Try RSS ────────────────────────────────────────────────────────
    const feedUrl = await discoverFeedUrl();
    if (feedUrl) {
      const rssResults = await fetchViaRss(feedUrl);
      if (rssResults.length > 0) {
        console.log(`[rfpdb] Done (RSS) — ${rssResults.length} total opportunities`);
        return rssResults;
      }
      console.log('[rfpdb] RSS returned 0 results — falling back to scrape');
    } else {
      console.log('[rfpdb] No RSS feed found — using Cheerio scrape');
    }

    // ── 3. Cheerio scrape fallback ────────────────────────────────────────
    const scrapeResults = await fetchViaScrape();

    if (scrapeResults.length === 0) {
      console.warn(
        '[rfpdb] WARN: 0 opportunities returned from scrape. ' +
        'Verify that https://www.rfpdb.com/view/category/name/technology is accessible ' +
        'and that the page HTML structure matches the expected selectors.'
      );
    }

    console.log(`[rfpdb] Done (scrape) — ${scrapeResults.length} total opportunities`);
    return scrapeResults;
  },
};
