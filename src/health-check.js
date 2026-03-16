'use strict';

/**
 * Scout source health checker.
 *
 * Performs lightweight validation of every registered source plugin without
 * running the full fetch pipeline.  Each source type has its own check:
 *
 *   RSS feeds (foundation-rss feeds, rfpdb RSS probe):
 *     • HTTP GET the feed URL → verify HTTP 200
 *     • Log redirect chain when redirects occur
 *     • Verify Content-Type is XML-like (not HTML)
 *     • Parse with rss-parser and confirm items.length > 0
 *
 *   Scrape / static sources (Idealist, PND RFPs, RFPDB):
 *     • For Idealist: open with Playwright, verify HTTP 200, check for listing
 *       links/elements (Idealist no longer uses Next.js __NEXT_DATA__ SSR embedding)
 *     • For PND RFPs: HTTP GET, verify HTTP 200, check listing element present
 *     • For RFPDB: HTTP GET tech-category page, verify HTTP 200, check listings
 *
 * Usage:
 *   const { runHealthChecks, printHealthReport } = require('./health-check');
 *   const results = await runHealthChecks();
 *   printHealthReport(results);
 */

const https = require('https');
const http = require('http');
const RSSParser = require('rss-parser');
const cheerio = require('cheerio');

// Import constants from source plugins to avoid duplication.
const { FEEDS: FOUNDATION_FEEDS } = require('./sources/foundation-rss');
const {
  CANDIDATE_FEED_URLS: RFPDB_CANDIDATE_FEED_URLS,
  FEEDS_PAGE_URL: RFPDB_FEEDS_PAGE_URL,
  TECH_CATEGORY_URL: RFPDB_TECH_CATEGORY_URL,
} = require('./sources/rfpdb');

const PND_RFPS_URL        = 'https://philanthropynewsdigest.org/rfps';
// Algolia credentials for Idealist health check (public, embedded in their frontend).
const ALGOLIA_APP_ID    = 'NSV3AUESS7';
const ALGOLIA_SEARCH_KEY = 'c2730ea10ab82787f2f3cc961e8c1e06';
const ALGOLIA_INDEX     = 'idealist7-production';
const ALGOLIA_HOST      = `${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;

/** Content-type substrings that indicate genuine RSS/Atom XML. */
const XML_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
];

/** Shared User-Agent string for all health-check HTTP requests. */
const UA = 'Scout/0.1 (HosTechnology health-check)';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * Perform a raw HTTP(S) GET and return `{ statusCode, contentType, body, redirectChain }`.
 * Follows up to `maxRedirects` hops and records the full chain.
 *
 * @param {string}   url
 * @param {number}   [maxRedirects=3]
 * @param {string[]} [chain=[]]          Redirect chain accumulated so far.
 * @returns {Promise<{statusCode:number, contentType:string, body:string, redirectChain:string[]}>}
 */
function fetchRaw(url, maxRedirects = 3, chain = []) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': UA, 'Accept': '*/*' }, timeout: 15000 },
      (res) => {
        const isRedirect = res.statusCode >= 300 && res.statusCode < 400;
        if (isRedirect && res.headers.location) {
          res.resume(); // drain socket
          chain.push(`HTTP ${res.statusCode} → ${res.headers.location}`);

          if (maxRedirects <= 0) {
            resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'] || '', body: '', redirectChain: chain });
            return;
          }

          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, url).toString();
          } catch (e) {
            reject(e);
            return;
          }

          fetchRaw(redirectUrl, maxRedirects - 1, chain).then(resolve).catch(reject);
          return;
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'] || '',
          body,
          redirectChain: chain,
        }));
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 15 s'));
    });
  });
}

/**
 * Return true when the body content appears to be XML (RSS/Atom).
 * @param {string} body
 * @returns {boolean}
 */
function looksLikeXml(body) {
  const s = body.trimStart();
  return s.startsWith('<?xml') || s.startsWith('<rss') || s.startsWith('<feed');
}

/**
 * Return true when the content-type indicates XML/RSS/Atom.
 * @param {string} ct  Content-Type header value.
 * @returns {boolean}
 */
function hasXmlContentType(ct) {
  const lower = ct.toLowerCase();
  return XML_CONTENT_TYPES.some((x) => lower.includes(x));
}

// ── Individual check functions ────────────────────────────────────────────────

/**
 * Check a single RSS/Atom feed URL.
 *
 * @param {string} name   Human-readable label used in the report.
 * @param {string} url    Feed URL to probe.
 * @returns {Promise<{id:string, name:string, pass:boolean, reason:string}>}
 */
async function checkRssFeed(name, url) {
  let raw;
  try {
    raw = await fetchRaw(url);
  } catch (err) {
    return { id: name, name, pass: false, reason: `Network error: ${err.message}` };
  }

  const { statusCode, contentType, body, redirectChain } = raw;

  const redirectNote = redirectChain.length > 0
    ? ` (redirected: ${redirectChain.join(' → ')})`
    : '';

  if (statusCode !== 200) {
    return { id: name, name, pass: false, reason: `HTTP ${statusCode}${redirectNote}` };
  }

  if (!hasXmlContentType(contentType) && !looksLikeXml(body)) {
    const ctShort = (contentType.split(';')[0] || 'unknown').trim();
    return {
      id: name,
      name,
      pass: false,
      reason: `returns ${ctShort}, not RSS${redirectNote}`,
    };
  }

  const parser = new RSSParser({
    timeout: 10000,
    headers: { 'User-Agent': UA },
  });

  let parsed;
  try {
    parsed = await parser.parseString(body);
  } catch (err) {
    return { id: name, name, pass: false, reason: `RSS parse error: ${err.message}${redirectNote}` };
  }

  const count = (parsed.items || []).length;
  if (count === 0) {
    return { id: name, name, pass: false, reason: `0 items returned${redirectNote}` };
  }

  const redirectSuffix = redirectChain.length > 0 ? ` (${redirectChain.length} redirect(s))` : '';
  return { id: name, name, pass: true, reason: `${count} item${count === 1 ? '' : 's'}${redirectSuffix}` };
}

/**
 * Health check for the Foundation RSS source.
 * Reports one result per individual feed (not one aggregated result).
 *
 * @returns {Promise<Array<{id:string, name:string, pass:boolean, reason:string}>>}
 */
async function checkFoundationRss() {
  const results = [];
  for (const feed of FOUNDATION_FEEDS) {
    const label = `Foundation RSS: ${feed.name}`;
    const result = await checkRssFeed(label, feed.url);
    result.id = feed.id;
    results.push(result);
  }
  return results;
}

/**
 * Health check for RFPDB.com.
 * Probes the candidate RSS feed URLs first; if none return valid XML falls
 * back to verifying the technology category page is accessible and contains
 * listing elements.
 *
 * @returns {Promise<{id:string, name:string, pass:boolean, reason:string}>}
 */
async function checkRfpdb() {
  const id   = 'rfpdb';
  const name = 'RFPDB.com';

  // ── 1. Probe candidate RSS feed URLs ──────────────────────────────────────
  // Try the feed discovery page for a tech feed link first.
  let feedUrl = null;
  try {
    const { statusCode, body } = await fetchRaw(RFPDB_FEEDS_PAGE_URL);
    if (statusCode === 200 && body) {
      const $ = cheerio.load(body);
      $('a[href]').each((_, el) => {
        if (feedUrl) return;
        const href = $(el).attr('href') || '';
        const abs  = href.startsWith('http') ? href : new URL(href, 'https://www.rfpdb.com').toString();
        if (/technology/i.test(abs) && /feed|rss|atom/i.test(abs)) {
          feedUrl = abs;
        }
      });
    }
  } catch {
    // ignore — fall through to candidate probes
  }

  // Probe candidate URLs if discovery page didn't help.
  if (!feedUrl) {
    for (const candidate of RFPDB_CANDIDATE_FEED_URLS) {
      try {
        const { statusCode, contentType, body } = await fetchRaw(candidate);
        if (statusCode === 200 && (hasXmlContentType(contentType) || looksLikeXml(body))) {
          feedUrl = candidate;
          break;
        }
      } catch {
        // try next candidate
      }
    }
  }

  if (feedUrl) {
    // We found a working RSS URL — report how many items it has.
    const rssResult = await checkRssFeed(name, feedUrl);
    rssResult.id = id;
    if (rssResult.pass) {
      rssResult.reason = `RSS feed OK, ${rssResult.reason}`;
    }
    return rssResult;
  }

  // ── 2. Fallback: verify the tech-category scrape page ────────────────────
  let raw;
  try {
    raw = await fetchRaw(RFPDB_TECH_CATEGORY_URL);
  } catch (err) {
    return { id, name, pass: false, reason: `Network error: ${err.message}` };
  }

  const { statusCode, body, redirectChain } = raw;
  const redirectNote = redirectChain.length > 0 ? ` (redirected)` : '';

  if (statusCode !== 200) {
    return { id, name, pass: false, reason: `HTTP ${statusCode}${redirectNote}` };
  }

  const $ = cheerio.load(body);
  // RFPDB technology category page should have at least one RFP-detail link.
  const rfpLinks = $('a[href*="/rfps/"], a[href*="/rfp/"], a[href*="/view/rfp/"]').length;
  if (rfpLinks === 0) {
    return { id, name, pass: false, reason: `no RSS feed found, page loaded but no listing links detected${redirectNote}` };
  }

  return { id, name, pass: true, reason: `no RSS feed found, page loads, ${rfpLinks} listing link(s) detected${redirectNote}` };
}

/**
 * Health check for PND RFPs (philanthropynewsdigest.org/rfps).
 * HTTP GET the page, verify 200, look for listing elements.
 *
 * @returns {Promise<{id:string, name:string, pass:boolean, reason:string}>}
 */
async function checkPndRfps() {
  const id   = 'pnd-rfps';
  const name = 'PND RFPs (Candid)';

  let raw;
  try {
    raw = await fetchRaw(PND_RFPS_URL);
  } catch (err) {
    return { id, name, pass: false, reason: `Network error: ${err.message}` };
  }

  const { statusCode, body, redirectChain } = raw;
  const redirectNote = redirectChain.length > 0 ? ` (redirected)` : '';

  if (statusCode !== 200) {
    return { id, name, pass: false, reason: `HTTP ${statusCode}${redirectNote}` };
  }

  const $ = cheerio.load(body);

  // A stable indicator that RFP listings are present: any link that points to
  // an /rfps/ detail page.  This is simpler than the full multi-selector
  // chain used by the source plugin and is less likely to break if minor
  // CSS class changes occur.
  const rfpLinks = $('a[href*="/rfps/"]').length;

  if (rfpLinks === 0) {
    return { id, name, pass: false, reason: `page loaded (HTTP 200) but no RFP listing links found${redirectNote}` };
  }

  const redirectSuffix = redirectChain.length > 0 ? ` (${redirectChain.length} redirect(s))` : '';
  return { id, name, pass: true, reason: `page loads, ${rfpLinks} RFP listing link(s) found${redirectSuffix}` };
}

/**
 * Health check for Idealist.org.
 *
 * Queries the Algolia search API directly for CONTRACT job listings.
 * Much faster and more reliable than loading the JS-rendered page.
 *
 * @returns {Promise<{id:string, name:string, pass:boolean, reason:string}>}
 */
async function checkIdealist() {
  const id   = 'idealist';
  const name = 'Idealist.org';

  try {
    const result = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        query: '',
        hitsPerPage: 1,
        facetFilters: [['type:JOB'], ['jobType:CONTRACT']],
        attributesToRetrieve: ['name'],
      });

      const options = {
        hostname: ALGOLIA_HOST,
        path: `/1/indexes/${ALGOLIA_INDEX}/query`,
        method: 'POST',
        headers: {
          'X-Algolia-Application-Id': ALGOLIA_APP_ID,
          'X-Algolia-API-Key': ALGOLIA_SEARCH_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (err) { reject(new Error(`JSON parse error: ${err.message}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(body);
      req.end();
    });

    if (result.nbHits > 0) {
      return { id, name, pass: true, reason: `Algolia API reachable, ${result.nbHits} contract listing(s) in index` };
    }

    return { id, name, pass: false, reason: 'Algolia API reachable but 0 contract listings found' };
  } catch (err) {
    return { id, name, pass: false, reason: `Algolia API error: ${err.message}` };
  }
}

// ── Aggregate runner ──────────────────────────────────────────────────────────

/**
 * Run health checks on all registered sources.
 *
 * Returns an array of result objects:
 *   { id: string, name: string, pass: boolean, reason: string }
 *
 * Checks run sequentially so the console output stays readable.
 *
 * @returns {Promise<Array<{id:string, name:string, pass:boolean, reason:string}>>}
 */
async function runHealthChecks() {
  const results = [];

  // Idealist (Playwright scrape)
  results.push(await checkIdealist());

  // PND RFPs (https scrape)
  results.push(await checkPndRfps());

  // RFPDB (RSS-first, scrape fallback)
  results.push(await checkRfpdb());

  // Foundation RSS feeds (one result per feed)
  const rssResults = await checkFoundationRss();
  results.push(...rssResults);

  return results;
}

// ── Console report ────────────────────────────────────────────────────────────

/**
 * Print the formatted health report to stdout.
 *
 * Format:
 *   ══════════════════════════════════════════
 *     Scout Source Health Check
 *   ══════════════════════════════════════════
 *     ✓ Idealist.org          — page loads, data markers found
 *     ✗ RFPDB.com             — HTTP 403 (blocked)
 *   ══════════════════════════════════════════
 *     4/6 sources healthy
 *   ══════════════════════════════════════════
 *
 * @param {Array<{id:string, name:string, pass:boolean, reason:string}>} results
 */
function printHealthReport(results) {
  const border = '══════════════════════════════════════════';
  console.log('');
  console.log(border);
  console.log('  Scout Source Health Check');
  console.log(border);

  // Compute column width from the longest source name (min 20, max 40).
  const maxLen = results.reduce((m, r) => Math.max(m, r.name.length), 0);
  const colWidth = Math.min(Math.max(maxLen + 2, 20), 40);

  for (const r of results) {
    const icon  = r.pass ? '✓' : '✗';
    const label = r.name.padEnd(colWidth);
    console.log(`  ${icon} ${label}— ${r.reason}`);
  }

  const healthy = results.filter((r) => r.pass).length;
  const total   = results.length;

  console.log(border);
  console.log(`  ${healthy}/${total} source${total === 1 ? '' : 's'} healthy`);
  console.log(border);
  console.log('');
}

module.exports = { runHealthChecks, printHealthReport, checkIdealist, checkPndRfps, checkRfpdb, checkFoundationRss };
