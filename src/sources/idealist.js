'use strict';

/**
 * Idealist.org source plugin — Contract Finder (Agent 1).
 *
 * Queries the Idealist Algolia search index directly for CONTRACT job
 * listings posted by nonprofits/orgs.  This is far more reliable than
 * scraping — the Algolia API returns structured JSON and is immune to
 * frontend redesigns.
 *
 * The Algolia app ID and search API key are public (embedded in the
 * Idealist client-side bundle for browser search).
 */

const https = require('https');

const BASE_URL = 'https://www.idealist.org';

// Algolia credentials — public, embedded in the Idealist frontend.
const ALGOLIA_APP_ID = 'NSV3AUESS7';
const ALGOLIA_SEARCH_KEY = 'c2730ea10ab82787f2f3cc961e8c1e06';
const ALGOLIA_INDEX = 'idealist7-production';
const ALGOLIA_HOST = `${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;

/** Maximum results per search query (Algolia max is 1000). */
const HITS_PER_PAGE = 50;

/** Maximum pages to paginate through per search term. */
const MAX_PAGES = 3;

/** Maximum distinct search terms derived from the profile. */
const MAX_SEARCH_TERMS = 5;

/** Polite delay between API requests (ms). */
const REQUEST_DELAY_MS = 500;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a deduplicated list of short search keywords from the profile.
 *
 * Prefers `profile.search_keywords` when present — these are curated
 * nonprofit-facing terms that match how organizations post opportunities.
 *
 * Falls back to deriving terms from work_types, focus_areas, and
 * target_sectors when search_keywords is absent or empty.
 *
 * @param {object} profile
 * @returns {string[]}
 */
function buildSearchTerms(profile) {
  if (Array.isArray(profile.search_keywords) && profile.search_keywords.length > 0) {
    const terms = profile.search_keywords
      .filter((k) => k && typeof k === 'string')
      .map((k) => k.trim())
      .filter(Boolean);
    if (terms.length > 0) return [...new Set(terms)].slice(0, MAX_SEARCH_TERMS);
  }

  const terms = new Set();

  if (Array.isArray(profile.work_types)) {
    for (const t of profile.work_types) {
      if (t && typeof t === 'string') terms.add(t.toLowerCase().trim());
    }
  }

  if (Array.isArray(profile.focus_areas)) {
    for (const area of profile.focus_areas) {
      if (!area || typeof area !== 'string') continue;
      const words = area
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['for', 'and', 'the', 'with', 'that'].includes(w));
      if (words.length > 0) terms.add(words.slice(0, 2).join(' '));
    }
  }

  if (Array.isArray(profile.target_sectors)) {
    for (const sector of profile.target_sectors) {
      if (sector && typeof sector === 'string') terms.add(sector.toLowerCase().trim());
    }
  }

  if (terms.size === 0) {
    terms.add('automation');
    terms.add('nonprofit consulting');
  }

  return [...terms].slice(0, MAX_SEARCH_TERMS);
}

/**
 * Query the Algolia search API.
 *
 * @param {string} query  Search text.
 * @param {number} page   Zero-indexed page number.
 * @returns {Promise<object>}  Algolia response with hits, nbHits, nbPages.
 */
function algoliaSearch(query, page = 0) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      query,
      page,
      hitsPerPage: HITS_PER_PAGE,
      facetFilters: [['type:JOB'], ['jobType:CONTRACT']],
      attributesToRetrieve: [
        'name', 'orgName', 'orgType', 'url', 'description',
        'salaryMinimum', 'salaryMaximum', 'salaryCurrency', 'salaryPeriod',
        'published', 'locationType', 'remoteOk', 'areasOfFocus',
        'keywords', 'functions', 'objectID',
      ],
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
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Algolia JSON parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Returns a promise that resolves after `ms` milliseconds. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a salary range into a human-readable budget string.
 *
 * @param {object} hit  Algolia hit object.
 * @returns {string|null}
 */
function formatBudget(hit) {
  const min = hit.salaryMinimum;
  const max = hit.salaryMaximum;
  if (!min && !max) return null;

  const currency = hit.salaryCurrency || 'USD';
  const period = hit.salaryPeriod ? hit.salaryPeriod.toLowerCase() : '';

  const parts = [];
  if (min && max) {
    parts.push(`${currency} ${min.toLocaleString()}–${max.toLocaleString()}`);
  } else if (min) {
    parts.push(`${currency} ${min.toLocaleString()}+`);
  } else {
    parts.push(`up to ${currency} ${max.toLocaleString()}`);
  }
  if (period && period !== 'none') parts.push(`/${period}`);

  return parts.join(' ');
}

/**
 * Normalize an Algolia hit into the standard opportunity schema.
 *
 * @param {object} hit  Algolia hit object.
 * @returns {object|null}  Normalized opportunity, or null if unusable.
 */
function normalizeHit(hit) {
  const name = (hit.name || '').trim();
  if (!name) return null;

  const urlPath = hit.url && hit.url.en ? hit.url.en : '';
  if (!urlPath) return null;

  const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
  const id = `idealist-${hit.objectID || encodeURIComponent(name).slice(0, 40)}`;

  return {
    id,
    source: 'idealist',
    title: name,
    org: (hit.orgName || 'Unknown Organization').trim(),
    url: fullUrl,
    deadline: null, // Idealist doesn't expose application deadlines in search results
    budget: formatBudget(hit),
    description: (hit.description || '').trim(),
    type: 'contract',
  };
}

// ── Plugin export ─────────────────────────────────────────────────────────────

module.exports = {
  id: 'idealist',
  name: 'Idealist.org',
  type: 'api',

  /**
   * Fetch contract opportunities from Idealist.org via Algolia.
   *
   * @param {object} profile  The HosTechnology profile JSON.
   * @returns {Promise<object[]>}  Normalised opportunity objects.
   */
  fetch: async (profile) => {
    const opportunities = [];
    const seen = new Set();
    const searchTerms = buildSearchTerms(profile);

    const logTerms = searchTerms.map((t) => t.slice(0, 40));
    console.log(`[idealist] Search terms (${searchTerms.length}): ${logTerms.join(' | ')}`);

    // Also run a blank query to get all CONTRACT listings (there are usually < 200).
    const allTerms = ['', ...searchTerms];

    for (let termIdx = 0; termIdx < allTerms.length; termIdx++) {
      const term = allTerms[termIdx];
      const termLabel = term || '(all contracts)';

      for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
        console.log(`[idealist] Querying "${termLabel}" page ${pageNum + 1}…`);

        let result;
        try {
          result = await algoliaSearch(term, pageNum);
        } catch (err) {
          console.warn(`[idealist] Algolia request failed for "${termLabel}": ${err.message}`);
          break;
        }

        if (!result.hits || result.hits.length === 0) {
          break;
        }

        let added = 0;
        for (const hit of result.hits) {
          const opp = normalizeHit(hit);
          if (!opp) continue;
          if (seen.has(opp.id)) continue;
          seen.add(opp.id);
          opportunities.push(opp);
          added++;
        }

        console.log(`[idealist] Page ${pageNum + 1}: ${result.hits.length} hits, ${added} new`);

        // Stop if we've reached the last page of results.
        if (pageNum + 1 >= (result.nbPages || 1)) break;

        if (pageNum < MAX_PAGES - 1) await delay(REQUEST_DELAY_MS);
      }

      if (termIdx < allTerms.length - 1) await delay(REQUEST_DELAY_MS);
    }

    if (opportunities.length === 0) {
      console.warn(
        `[idealist] WARN: All queries returned 0 results. ` +
        'This may indicate the Algolia API key has been rotated or the index renamed.',
      );
    }

    console.log(`[idealist] Done — ${opportunities.length} total opportunities`);
    return opportunities;
  },
};
