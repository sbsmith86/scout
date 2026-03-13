'use strict';

/**
 * Idealist.org source plugin — Contract Finder (Agent 1).
 *
 * Scrapes https://www.idealist.org/en/consulting (consulting opportunities
 * posted by nonprofits/orgs), normalises each listing to the standard
 * opportunity schema, and returns the array.
 *
 * Idealist renders search results via client-side JavaScript (React), so
 * Playwright is used to fully render the page before extracting listings.
 * Cheerio is used for HTML parsing after the page has been rendered.
 *
 * Three extraction strategies are attempted in order:
 *
 *   1. __NEXT_DATA__ JSON payload (fast-path; only present if Idealist is
 *      running Next.js SSR — not currently the case as of 2024, but kept
 *      for forward-compatibility in case they reintroduce it).
 *
 *   2. CSS selector scraping — tries a battery of known card-element
 *      selectors that cover various Idealist layout generations.
 *
 *   3. Link-scan fallback — scans the page for any <a href> pointing to
 *      an individual consultant-org-job detail page
 *      (/en/consultant-org-job/…).  This is framework-agnostic and
 *      resilient to CSS-class refactors; it always extracts at least a
 *      title and URL even when the card markup changes.
 */

const { chromium } = require('playwright');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.idealist.org';
// Idealist moved away from /en/consultant-org-jobs; /en/consulting is the
// current path for consulting opportunities posted by nonprofits/orgs.
// The old path may redirect, but using the current one avoids a round-trip.
const SEARCH_URL = `${BASE_URL}/en/consulting`;

/** Maximum pages to scrape per search term (polite ceiling). */
const MAX_PAGES = 5;

/** Maximum distinct search terms derived from the profile. */
const MAX_SEARCH_TERMS = 5;

/** Polite delay between HTTP requests (ms). */
const REQUEST_DELAY_MS = 2000;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a deduplicated list of short search keywords from the profile.
 *
 * Prefers `profile.search_keywords` when present — these are curated
 * nonprofit-facing terms (e.g. "Salesforce consultant", "CRM implementation")
 * that match how organizations post opportunities on external sites.
 *
 * Falls back to deriving terms from work_types, focus_areas, and
 * target_sectors when search_keywords is absent or empty.
 *
 * @param {object} profile
 * @returns {string[]}
 */
function buildSearchTerms(profile) {
  // Prefer the explicit search_keywords list when populated.
  if (Array.isArray(profile.search_keywords) && profile.search_keywords.length > 0) {
    const terms = profile.search_keywords
      .filter((k) => k && typeof k === 'string')
      .map((k) => k.trim())
      .filter(Boolean);
    if (terms.length > 0) return [...new Set(terms)].slice(0, MAX_SEARCH_TERMS);
  }

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

/**
 * Fetch a fully JS-rendered page using Playwright (headless Chromium).
 * Waits for the network to go idle so React/Next.js hydration completes
 * before the HTML is captured.
 *
 * @param {import('playwright').Page} page  An open Playwright Page instance.
 * @param {string} url                      The URL to navigate to.
 * @returns {Promise<{html: string, statusCode: number, contentType: string}>}
 */
async function fetchPage(page, url) {
  let statusCode = 200;
  let contentType = '';

  const response = await page.goto(url, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  if (response) {
    statusCode = response.status();
    contentType = response.headers()['content-type'] || '';
  }

  const html = await page.content();
  return { html, statusCode, contentType };
}

/** Returns a promise that resolves after `ms` milliseconds. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the Next.js server-side data payload embedded as JSON in
 * `<script id="__NEXT_DATA__">`.  Returns null if absent or unparseable.
 *
 * NOTE: Idealist.org no longer uses Next.js SSR (as of 2024).  This
 * function is kept as a forward-compat fast-path in case they reintroduce
 * SSR — it will simply return null on the current site, which is harmless.
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
 * NOTE: Only useful when Idealist is running Next.js SSR.  Returns [] on
 * the current client-rendered site, falling through to the other strategies.
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
 * Last-resort link-scan extraction.
 *
 * Scans every anchor tag on the page for hrefs that match the Idealist
 * consultant-org-job detail page pattern (`/en/consultant-org-job/…`).
 * This approach is framework-agnostic: it does not rely on specific CSS
 * class names or data attributes, so it survives most frontend refactors.
 *
 * Information extracted is minimal (title from anchor text, URL from href)
 * but sufficient to queue the opportunity for scoring and detail-page fetch.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {object[]}
 */
function listingsFromLinkScan($) {
  const listings = [];
  const seen = new Set();

  // Regex that matches paths to individual consultant-org-job detail pages.
  // Example: /en/consultant-org-job/abc123/some-title-slug
  const LISTING_PATH_RE = /\/en\/consultant-org-job\/([^/?#\s]+)/;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(LISTING_PATH_RE);
    if (!m) return;

    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    if (seen.has(url)) return;
    seen.add(url);

    // Extract the listing slug from the URL for a stable ID.
    const slug = m[1];
    const id = `idealist-${slug}`;

    // Title: prefer text inside a heading child, else use the anchor's own text.
    const $a = $(el);
    const title =
      $a.find('h2, h3, h4, h5').first().text().trim() ||
      $a.text().trim();
    if (!title) return; // skip anonymous links

    // Walk up the DOM to find the closest card-like container, then look for
    // an org name element within it.
    const card = $a.closest('article, section, li, [class*="card"], [class*="listing"]');
    let org = '';
    if (card.length > 0) {
      const orgEl = card
        .find('[class*="org"], [class*="Org"], [class*="organization"], [class*="company"]')
        .first();
      if (orgEl.length > 0) org = orgEl.text().trim();
    }

    listings.push({
      id,
      source: 'idealist',
      title,
      org: org || 'Unknown Organization',
      url,
      deadline: null,
      budget: null,
      description: '',
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

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (compatible; Scout/1.0; +https://hostechnology.io)',
        locale: 'en-US',
      });
      const page = await context.newPage();

      for (let termIdx = 0; termIdx < searchTerms.length; termIdx++) {
        const term = searchTerms[termIdx];
        let pageNum = 1;
        let morePages = true;

        while (morePages && pageNum <= MAX_PAGES) {
          const params = new URLSearchParams({ q: term });
          if (pageNum > 1) params.set('page', String(pageNum));

          const pageUrl = `${SEARCH_URL}?${params.toString()}`;
          console.log(`[idealist] Fetching page ${pageNum} for "${term}": ${pageUrl}`);

          let html, statusCode, contentType;
          try {
            ({ html, statusCode, contentType } = await fetchPage(page, pageUrl));
          } catch (err) {
            console.warn(`[idealist] Request failed (${pageUrl}): ${err.name}: ${err.message}`);
            break;
          }

          if (statusCode !== 200) {
            console.warn(`[idealist] HTTP ${statusCode} for ${pageUrl} — stopping this term`);
            break;
          }

          const $ = cheerio.load(html);

          // ── Extraction strategy 1: __NEXT_DATA__ JSON (fast-path) ──────────
          // Only present when Idealist is using Next.js SSR.  Not currently the
          // case (2024+), but kept for forward-compatibility.
          const nextData = extractNextData($);
          let listings = nextData ? listingsFromNextData(nextData) : [];

          // ── Extraction strategy 2: CSS selector scraping ───────────────────
          if (listings.length === 0) {
            listings = listingsFromHTML($);
          }

          // ── Extraction strategy 3: Link-scan fallback ──────────────────────
          // Framework-agnostic: find any <a href="/en/consultant-org-job/…">
          // links.  Resilient to CSS-class refactors.
          if (listings.length === 0) {
            listings = listingsFromLinkScan($);
          }

          if (listings.length === 0) {
            console.warn(
              `[idealist] WARN: 0 listings on page ${pageNum} for "${term}" — ` +
              `url: ${pageUrl} | content-type: ${contentType || 'unknown'} | ` +
              `__NEXT_DATA__ present: ${html.includes('__NEXT_DATA__') ? 'yes' : 'no'} ` +
              '— stopping pagination for this term'
            );
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
            console.log(`[idealist] Page ${pageNum}: ${listings.length} listings, ${added} new`);

            morePages = hasNextPage($);
            pageNum++;

            if (morePages) await delay(REQUEST_DELAY_MS);
          }
        }

        // Polite delay between different search terms.
        if (termIdx < searchTerms.length - 1) {
          await delay(REQUEST_DELAY_MS);
        }
      }
    } finally {
      await browser.close();
    }

    if (opportunities.length === 0) {
      console.warn(
        `[idealist] WARN: All ${searchTerms.length} search term(s) returned 0 results. ` +
        `Check that ${SEARCH_URL} is the correct search endpoint and that ` +
        'Idealist.org is returning scrapable listings. If the page loads but no ' +
        'listings are found, run `node scripts/test-idealist-plugin.js` for details ' +
        'and inspect the rendered HTML to update selectors or the URL.'
      );
    }

    console.log(`[idealist] Done — ${opportunities.length} total opportunities`);
    return opportunities;
  },
};
