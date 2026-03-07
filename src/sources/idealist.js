'use strict';

/**
 * Idealist.org source plugin — Contract Finder (Agent 1).
 *
 * Scrapes the Idealist.org consulting-opportunities section, normalises each
 * listing to the standard opportunity schema, and returns the array.
 *
 * Cheerio is used for static HTML parsing.  Idealist renders its search
 * results server-side (the listing markup is present in the initial HTML
 * response), so Playwright is not required.
 *
 * If the page structure changes and scraping breaks, look for the SSR JSON
 * payload embedded in a <script id="__NEXT_DATA__"> tag first — it contains
 * the full listings array and is far more stable than CSS selectors.
 */

const https = require('https');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.idealist.org';
const SEARCH_URL = `${BASE_URL}/en/all`;

/** Maximum pages to scrape per search term (polite ceiling). */
const MAX_PAGES = 5;

/** Maximum distinct search terms derived from the profile. */
const MAX_SEARCH_TERMS = 5;

/** Polite delay between HTTP requests (ms). */
const REQUEST_DELAY_MS = 2000;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a deduplicated list of short search keywords from the profile's
 * work_types, focus_areas, and target_sectors.
 *
 * @param {object} profile
 * @returns {string[]}
 */
function buildSearchTerms(profile) {
  const terms = new Set();

  // work_types are the most targeted signal: "automation", "workflow implementation", …
  if (Array.isArray(profile.work_types)) {
    for (const t of profile.work_types) {
      if (t && typeof t === 'string') terms.add(t.toLowerCase().trim());
    }
  }

  // Pull the first meaningful word-pair from each focus_area description.
  if (Array.isArray(profile.focus_areas)) {
    for (const area of profile.focus_areas) {
      if (!area || typeof area !== 'string') continue;
      // Strip filler words; grab first two content words.
      const words = area
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['for', 'and', 'the', 'with', 'that'].includes(w));
      if (words.length > 0) terms.add(words.slice(0, 2).join(' '));
    }
  }

  // Sector keywords as a final fallback to broaden reach.
  if (Array.isArray(profile.target_sectors)) {
    for (const sector of profile.target_sectors) {
      if (sector && typeof sector === 'string') terms.add(sector.toLowerCase().trim());
    }
  }

  // Always include a broad fallback so we never run with zero terms.
  if (terms.size === 0) {
    terms.add('automation');
    terms.add('nonprofit consulting');
  }

  return [...terms].slice(0, MAX_SEARCH_TERMS);
}

/** Promisified HTTPS GET with redirect following and a 15-second timeout. */
function fetchPage(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error(`Too many redirects for ${url}`));
    }

    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; Scout/1.0; +https://hostechnology.io)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      (res) => {
        // Follow HTTP 3xx redirects.
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : `${BASE_URL}${res.headers.location}`;
          res.resume(); // drain and discard
          return fetchPage(next, redirectCount + 1).then(resolve).catch(reject);
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ html: body, statusCode: res.statusCode }));
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Request timed out: ${url}`));
    });
  });
}

/** Returns a promise that resolves after `ms` milliseconds. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the Next.js server-side data payload embedded as JSON in
 * `<script id="__NEXT_DATA__">`.  Returns null if absent or unparseable.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {object|null}
 */
function extractNextData($) {
  try {
    const raw = $('#__NEXT_DATA__').html();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Attempt to parse opportunity listings from the embedded Next.js JSON
 * payload.  Returns an empty array if the expected data path is not found.
 *
 * @param {object} nextData  Parsed __NEXT_DATA__ object
 * @returns {object[]}       Normalised opportunity objects
 */
function listingsFromNextData(nextData) {
  const listings = [];

  // Navigate the typical Next.js pageProps structure.
  // Idealist stores results under pageProps.initialData.hits or similar.
  const candidates = [
    nextData?.props?.pageProps?.initialData?.hits,
    nextData?.props?.pageProps?.searchResults?.hits,
    nextData?.props?.pageProps?.results,
    nextData?.props?.pageProps?.listings,
  ];

  const hits = candidates.find((c) => Array.isArray(c) && c.length > 0);
  if (!hits) return listings;

  for (const hit of hits) {
    const title = (hit.title || hit.name || '').trim();
    if (!title) continue;

    const slug = hit.slug || hit.id || hit._id || '';
    const rawUrl = hit.url || hit.canonicalUrl || '';
    const url = rawUrl
      ? rawUrl.startsWith('http')
        ? rawUrl
        : `${BASE_URL}${rawUrl}`
      : slug
        ? `${BASE_URL}/en/consulting-opportunity/${slug}`
        : '';

    if (!url) continue;

    const org = (hit.organizationName || hit.org || hit.organization || '').trim();

    // Deadline — may be an ISO string, epoch ms, or a formatted date string.
    let deadline = null;
    const rawDeadline = hit.applicationDeadline || hit.deadline || hit.endDate || '';
    if (rawDeadline) {
      const d = new Date(rawDeadline);
      if (!isNaN(d.getTime())) deadline = d.toISOString().slice(0, 10);
    }

    const budget =
      hit.compensationRange ||
      hit.compensation ||
      hit.budget ||
      hit.salary ||
      null;

    const description = (
      hit.body ||
      hit.description ||
      hit.summary ||
      hit.excerpt ||
      ''
    ).trim();

    const id = `idealist-${slug || encodeURIComponent(title).slice(0, 40)}`;

    listings.push({
      id,
      source: 'idealist',
      title,
      org: org || 'Unknown Organization',
      url,
      deadline,
      budget: budget ? String(budget).trim() : null,
      description,
      type: 'contract',
    });
  }

  return listings;
}

/**
 * Parse opportunity listings from HTML via Cheerio CSS selectors.
 * Multiple selector variants are tried in order to handle layout changes.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {object[]}
 */
function listingsFromHTML($) {
  const listings = [];

  // Try selector families most → least specific.
  const cardSelectors = [
    '[data-test="listing-card"]',
    '[data-qa-id="listing-card"]',
    '[data-automation="listing-card"]',
    '.ListingCard',
    '.listing-card',
    'article[class*="ListingCard"]',
    'article[class*="listing"]',
    'li[class*="SearchResult"]',
    'li[class*="listing"]',
  ];

  let cards = $();
  for (const sel of cardSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      cards = found;
      break;
    }
  }

  if (cards.length === 0) return listings;

  cards.each((_, el) => {
    const card = $(el);

    // ── Title & URL ───────────────────────────────────────────────────────
    const titleSelectors = [
      '[data-test="listing-card-title"] a',
      '[data-qa-id="listing-card-title"] a',
      '.ListingCard-title a',
      '.listing-card__title a',
      'h2 a',
      'h3 a',
      'h4 a',
    ];

    let titleEl = null;
    for (const sel of titleSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { titleEl = found.first(); break; }
    }

    const title = titleEl ? titleEl.text().trim() : '';
    if (!title) return; // skip malformed cards

    const href = titleEl ? titleEl.attr('href') : '';
    if (!href) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;

    // ── Organisation ──────────────────────────────────────────────────────
    const orgSelectors = [
      '[data-test="listing-card-org-name"]',
      '[data-qa-id="listing-card-org-name"]',
      '[data-automation="org-name"]',
      '.ListingCard-org',
      '.listing-card__org',
      '[class*="orgName"]',
      '[class*="org-name"]',
    ];

    let org = '';
    for (const sel of orgSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { org = found.first().text().trim(); break; }
    }

    // ── Description ───────────────────────────────────────────────────────
    const descSelectors = [
      '[data-test="listing-card-description"]',
      '[data-qa-id="listing-card-description"]',
      '.ListingCard-description',
      '.listing-card__description',
      '[class*="description"]',
      'p',
    ];

    let description = '';
    for (const sel of descSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { description = found.first().text().trim(); break; }
    }

    // ── Deadline ──────────────────────────────────────────────────────────
    let deadline = null;
    const deadlineSelectors = [
      '[data-test="listing-card-deadline"]',
      '[data-qa-id="listing-card-deadline"]',
      '[class*="deadline"]',
      '[class*="Deadline"]',
    ];

    let deadlineText = '';
    for (const sel of deadlineSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { deadlineText = found.first().text().trim(); break; }
    }

    if (deadlineText) {
      const datePattern =
        /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},?\s*\d{4})/i;
      const m = deadlineText.match(datePattern);
      if (m) {
        const parsed = new Date(m[1]);
        if (!isNaN(parsed.getTime())) deadline = parsed.toISOString().slice(0, 10);
      }
    }

    // ── Budget / Compensation ─────────────────────────────────────────────
    let budget = null;
    const budgetSelectors = [
      '[data-test="listing-card-compensation"]',
      '[data-qa-id="listing-card-compensation"]',
      '[class*="compensation"]',
      '[class*="Compensation"]',
      '[class*="budget"]',
      '[class*="Budget"]',
      '[class*="salary"]',
    ];

    for (const sel of budgetSelectors) {
      const found = card.find(sel);
      if (found.length > 0) {
        const text = found.first().text().trim();
        if (text) { budget = text; break; }
      }
    }

    // ── ID ────────────────────────────────────────────────────────────────
    // Prefer the path segment from the URL which is typically the listing slug.
    const pathMatch = url.match(/\/([^/?#]+)(?:[?#]|$)/);
    const id = `idealist-${pathMatch ? pathMatch[1] : encodeURIComponent(title).slice(0, 40)}`;

    listings.push({
      id,
      source: 'idealist',
      title,
      org: org || 'Unknown Organization',
      url,
      deadline,
      budget,
      description,
      type: 'contract',
    });
  });

  return listings;
}

/**
 * Return true if the page contains a "next page" control.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {boolean}
 */
function hasNextPage($) {
  const nextSelectors = [
    '[data-test="pagination-next"]:not([disabled])',
    '[data-qa-id="pagination-next"]:not([disabled])',
    'a[aria-label="Next page"]',
    'a[rel="next"]',
    '.pagination__next:not(.disabled)',
    '[class*="pagination"][class*="next"]:not([disabled]):not(.disabled)',
  ];

  for (const sel of nextSelectors) {
    if ($(sel).length > 0) return true;
  }

  return false;
}

// ── Plugin export ─────────────────────────────────────────────────────────────

module.exports = {
  id: 'idealist',
  name: 'Idealist.org',
  type: 'scrape',

  /**
   * Fetch consulting opportunities from Idealist.org.
   *
   * @param {object} profile  The HosTechnology profile JSON.
   * @returns {Promise<object[]>}  Normalised opportunity objects.
   */
  fetch: async (profile) => {
    const opportunities = [];
    const seen = new Set();
    const searchTerms = buildSearchTerms(profile);

    // Truncate each term in the log to avoid leaking unexpectedly long profile text.
    const logTerms = searchTerms.map((t) => t.slice(0, 40));
    console.log(`[idealist] Search terms (${searchTerms.length}): ${logTerms.join(' | ')}`);

    for (let termIdx = 0; termIdx < searchTerms.length; termIdx++) {
      const term = searchTerms[termIdx];
      let page = 1;
      let morePages = true;

      while (morePages && page <= MAX_PAGES) {
        const params = new URLSearchParams({ type: 'CONSULTING', q: term });
        if (page > 1) params.set('page', String(page));

        const pageUrl = `${SEARCH_URL}?${params.toString()}`;
        console.log(`[idealist] Fetching page ${page} for "${term}": ${pageUrl}`);

        let html, statusCode;
        try {
          ({ html, statusCode } = await fetchPage(pageUrl));
        } catch (err) {
          console.warn(`[idealist] Request failed (${pageUrl}): ${err.message}`);
          break;
        }

        if (statusCode !== 200) {
          console.warn(`[idealist] HTTP ${statusCode} for ${pageUrl} — stopping this term`);
          break;
        }

        const $ = cheerio.load(html);

        // Prefer the structured JSON payload embedded by Next.js — it is more
        // reliable than CSS selectors and less likely to break on layout changes.
        const nextData = extractNextData($);
        let listings = nextData ? listingsFromNextData(nextData) : [];

        // Fall back to HTML selector scraping if the JSON path yields nothing.
        if (listings.length === 0) {
          listings = listingsFromHTML($);
        }

        if (listings.length === 0) {
          console.log(`[idealist] No listings on page ${page} for "${term}" — stopping pagination`);
          morePages = false;
        } else {
          let added = 0;
          for (const listing of listings) {
            if (!seen.has(listing.id)) {
              seen.add(listing.id);
              opportunities.push(listing);
              added++;
            }
          }
          console.log(`[idealist] Page ${page}: ${listings.length} listings, ${added} new`);

          morePages = hasNextPage($);
          page++;

          if (morePages) await delay(REQUEST_DELAY_MS);
        }
      }

      // Polite delay between different search terms.
      if (termIdx < searchTerms.length - 1) {
        await delay(REQUEST_DELAY_MS);
      }
    }

    console.log(`[idealist] Done — ${opportunities.length} total opportunities`);
    return opportunities;
  },
};
