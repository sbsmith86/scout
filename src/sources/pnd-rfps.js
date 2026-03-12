'use strict';

/**
 * PND RFPs source plugin — Contract Finder (Agent 1).
 *
 * Scrapes https://philanthropynewsdigest.org/rfps (Philanthropy News Digest,
 * run by Candid) and normalises each RFP listing to the standard opportunity
 * schema.  PND publishes daily "Request for Proposals" from nonprofits and
 * grantmaking organisations that are explicitly hiring consultants, vendors,
 * or service providers — a high-signal source for Contract Finder.
 *
 * The PND RFPs page is server-rendered static HTML, so Cheerio + the Node
 * built-in https module are sufficient (no Playwright needed).
 *
 * Pagination: PND uses ?page=N query params.  We fetch until no new listings
 * appear or MAX_PAGES is reached.
 */

const https = require('https');
const cheerio = require('cheerio');
const crypto = require('crypto');

const BASE_URL = 'https://philanthropynewsdigest.org';
const RFPS_URL = `${BASE_URL}/rfps`;

/** Maximum pages to scrape per run (polite ceiling). */
const MAX_PAGES = 5;

/** Polite delay between page requests (ms). */
const REQUEST_DELAY_MS = 1500;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` milliseconds. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic ID derived from the listing URL so that re-runs never create
 * duplicate rows in Google Sheets.
 *
 * @param {string} url
 * @returns {string}
 */
function makeId(url) {
  const key = url && url.length > 0 ? url : crypto.randomBytes(8).toString('hex');
  return `pnd-rfps-${crypto.createHash('md5').update(key).digest('hex').slice(0, 10)}`;
}

/**
 * Perform a raw HTTPS GET and return `{ statusCode, contentType, body }`.
 * Follows up to `redirectsRemaining` redirects (default 2) to handle
 * transient CDN hops.  Targets HTTPS only — PND has no HTTP fallback.
 *
 * @param {string} url
 * @param {number} [redirectsRemaining=2]
 * @returns {Promise<{statusCode: number, contentType: string, body: string}>}
 */
function fetchRaw(url, redirectsRemaining = 2) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Scout/0.1 (HosTechnology business-dev bot)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 20000,
      },
      (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          console.warn(`[pnd-rfps] Redirect (HTTP ${res.statusCode}) → ${res.headers.location}`);
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
 * Parse a date string from PND and normalise it to an ISO `YYYY-MM-DD` string.
 * PND typically uses formats like "March 31, 2025" or "03/31/2025".
 * Returns null if parsing fails.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function parseDeadline(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/deadline:?\s*/i, '').trim();
  if (!cleaned) return null;
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Parse RFP listings from a rendered Cheerio document.
 *
 * PND RFP listings follow a consistent structure:
 *
 *   <article class="rfp-listing"> (or similar)
 *     <h2><a href="/rfps/slug">Title</a></h2>
 *     <p class="organization">Org Name</p>
 *     <p class="deadline">Deadline: Month DD, YYYY</p>
 *     <div class="description">Short summary text…</div>
 *   </article>
 *
 * Multiple selector families are tried (most-specific first) to handle minor
 * layout changes without requiring a full plugin rewrite.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {object[]}  Normalised opportunity objects (without `id` yet).
 */
function parseListings($) {
  const listings = [];

  // ── Card container selectors ─────────────────────────────────────────────
  const cardSelectors = [
    'article.rfp-listing',
    'article.rfp',
    '.rfp-listing',
    '.rfp-item',
    'li.rfp',
    // Generic fallbacks — PND often wraps items in <ul>/<li> or <div> lists
    'ul.rfps li',
    '.content-list li',
    '.listing-list li',
    'article',
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
    // Last-resort: any <h2> or <h3> inside the main content area that has an
    // <a> child pointing to /rfps/... — reconstruct a virtual listing from
    // the surrounding context.
    $('h2 a[href*="/rfps/"], h3 a[href*="/rfps/"]').each((_, el) => {
      const a = $(el);
      const href = a.attr('href') || '';
      const title = a.text().trim();
      if (!title || !href) return;

      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      const parent = a.closest('div, li, article, section');

      // Org: look for a nearby element with org-like class or the first <p>
      let org = '';
      const orgEl = parent.find('[class*="org"], [class*="organization"], [class*="sponsor"]').first();
      if (orgEl.length) {
        org = orgEl.text().trim();
      } else {
        const firstP = parent.find('p').first();
        if (firstP.length) org = firstP.text().trim();
      }

      // Deadline: look for text matching "Deadline" pattern
      let deadline = null;
      parent.find('*').each((__, node) => {
        const text = $(node).text();
        if (/deadline/i.test(text)) {
          deadline = parseDeadline(text);
          if (deadline) return false; // break
        }
      });

      // Description: remaining <p> text
      const description = parent.find('p').map((__, p) => $(p).text().trim()).get().join(' ').trim();

      listings.push({ title, org, url, deadline, description });
    });

    return listings;
  }

  // ── Parse each card ──────────────────────────────────────────────────────
  cards.each((_, el) => {
    const card = $(el);

    // ── Title & URL ───────────────────────────────────────────────────────
    let titleEl = null;
    const titleSelectors = [
      'h2 a', 'h3 a', 'h4 a',
      '.rfp-title a', '.title a', '[class*="title"] a',
      'a[href*="/rfps/"]',
    ];
    for (const sel of titleSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { titleEl = found.first(); break; }
    }

    // Some cards use <h2>/<h3> without a nested <a> — fall back to a bare
    // heading + the card's own link.
    let title = titleEl ? titleEl.text().trim() : '';
    let href = titleEl ? titleEl.attr('href') : '';

    if (!title) {
      const headingEl = card.find('h2, h3, h4').first();
      title = headingEl.length ? headingEl.text().trim() : '';
    }
    if (!href) {
      const linkEl = card.find('a').first();
      href = linkEl.length ? linkEl.attr('href') : '';
    }

    if (!title || !href) return; // skip malformed cards

    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;

    // ── Organisation ─────────────────────────────────────────────────────
    const orgSelectors = [
      '.organization', '.org-name', '[class*="organization"]', '[class*="org-name"]',
      '.sponsor', '[class*="sponsor"]', '[class*="issuing"]',
      // PND sometimes uses a <span> or <p> with "by <OrgName>"
      '.rfp-org', '.byline',
    ];

    let org = '';
    for (const sel of orgSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { org = found.first().text().trim(); break; }
    }

    // Fallback: look for "by …" or "from …" text patterns in any <p>/<span>
    if (!org) {
      card.find('p, span').each((_, node) => {
        const text = $(node).text().trim();
        const m = text.match(/^(?:by|from|posted by|submitted by)\s+(.+)$/i);
        if (m) { org = m[1].trim(); return false; }
      });
    }

    // ── Deadline ─────────────────────────────────────────────────────────
    const deadlineSelectors = [
      '.deadline', '[class*="deadline"]', '[class*="due-date"]', '[class*="duedate"]',
      'time[datetime]', '.date',
    ];

    let deadlineRaw = '';
    for (const sel of deadlineSelectors) {
      const found = card.find(sel);
      if (found.length > 0) {
        // Prefer datetime attribute on <time> elements
        const dt = found.first().attr('datetime');
        deadlineRaw = dt || found.first().text().trim();
        break;
      }
    }

    // Scan all text nodes for "Deadline:" pattern when specific selectors miss
    if (!deadlineRaw) {
      card.find('*').each((_, node) => {
        const text = $(node).text();
        if (/deadline/i.test(text)) {
          deadlineRaw = text;
          return false; // break
        }
      });
    }

    const deadline = parseDeadline(deadlineRaw);

    // ── Description / Summary ────────────────────────────────────────────
    const descSelectors = [
      '.description', '.summary', '[class*="description"]', '[class*="summary"]',
      '.rfp-body', '.body', '.excerpt', '[class*="excerpt"]',
    ];

    let description = '';
    for (const sel of descSelectors) {
      const found = card.find(sel);
      if (found.length > 0) { description = found.first().text().trim(); break; }
    }

    // Fallback: concatenate all <p> text in the card
    if (!description) {
      description = card.find('p').map((_, p) => $(p).text().trim()).get().join(' ').trim();
    }

    listings.push({ title, org, url, deadline, description });
  });

  return listings;
}

/**
 * Returns true if the page contains a link or button to the next page.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {boolean}
 */
function hasNextPage($) {
  const nextSelectors = [
    'a[rel="next"]',
    'a[aria-label="Next page"]',
    '.pagination .next:not(.disabled)',
    '.pagination a.next',
    '[class*="pagination"] a[class*="next"]',
    'a:contains("Next")',
    'a:contains("›")',
    'a:contains("»")',
  ];
  for (const sel of nextSelectors) {
    try {
      if ($(sel).length > 0) return true;
    } catch {
      // Ignore invalid selectors (e.g. :contains with special chars)
    }
  }
  return false;
}

// ── Plugin export ─────────────────────────────────────────────────────────────

module.exports = {
  id: 'pnd-rfps',
  name: 'PND RFPs (Candid)',
  type: 'scrape',

  /**
   * Fetch active RFP listings from Philanthropy News Digest.
   *
   * @param {object} _profile  The HosTechnology profile (unused for fetching;
   *                           passed along for interface consistency).
   * @returns {Promise<object[]>}  Normalised opportunity objects.
   */
  fetch: async (_profile) => {
    const opportunities = [];
    const seen = new Set();
    let pageNum = 1;
    let morePages = true;

    while (morePages && pageNum <= MAX_PAGES) {
      const pageUrl = pageNum === 1 ? RFPS_URL : `${RFPS_URL}?page=${pageNum}`;
      console.log(`[pnd-rfps] Fetching page ${pageNum}: ${pageUrl}`);

      let rawResponse;
      try {
        rawResponse = await fetchRaw(pageUrl);
      } catch (err) {
        console.warn(`[pnd-rfps] Request failed (${pageUrl}): ${err.message}`);
        break;
      }

      const { statusCode, contentType, body } = rawResponse;

      if (statusCode !== 200) {
        console.warn(`[pnd-rfps] HTTP ${statusCode} for ${pageUrl} — stopping`);
        break;
      }

      const looksLikeHtml =
        body.trimStart().toLowerCase().startsWith('<html') ||
        body.trimStart().toLowerCase().startsWith('<!doctype');

      if (!looksLikeHtml && body.trimStart().length > 0) {
        console.warn(
          `[pnd-rfps] Unexpected content-type "${contentType}" or non-HTML body on page ${pageNum} — stopping`
        );
        break;
      }

      const $ = cheerio.load(body);
      const listings = parseListings($);

      if (listings.length === 0) {
        console.warn(
          `[pnd-rfps] WARN: 0 listings on page ${pageNum} (${pageUrl}) — stopping pagination. ` +
          `Content-Type: "${contentType}"`
        );
        morePages = false;
      } else {
        let added = 0;
        for (const listing of listings) {
          const id = makeId(listing.url);
          if (!seen.has(id)) {
            seen.add(id);
            opportunities.push({
              id,
              source: 'pnd-rfps',
              title: listing.title,
              org: listing.org || 'Unknown Organization',
              url: listing.url,
              deadline: listing.deadline,
              budget: null, // PND RFPs rarely include budget; scorer can infer
              description: listing.description,
              type: 'contract',
            });
            added++;
          }
        }
        console.log(`[pnd-rfps] Page ${pageNum}: ${listings.length} listings, ${added} new`);

        morePages = hasNextPage($);
        pageNum++;

        if (morePages) await delay(REQUEST_DELAY_MS);
      }
    }

    if (opportunities.length === 0) {
      console.warn(
        '[pnd-rfps] WARN: 0 opportunities returned across all pages. ' +
        'Verify that https://philanthropynewsdigest.org/rfps is accessible ' +
        'and that the page HTML structure matches the expected selectors.'
      );
    }

    console.log(`[pnd-rfps] Done — ${opportunities.length} total opportunities`);
    return opportunities;
  },
};
