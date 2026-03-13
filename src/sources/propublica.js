'use strict';

/**
 * ProPublica Nonprofit Explorer source plugin — Funding Monitor (Agent 2).
 *
 * Queries the ProPublica Nonprofit Explorer API v2 (free, no auth required) to
 * surface growing nonprofit organizations as warm outreach leads.  990 filings
 * include grants received, total revenue, and organizational details, making
 * this a strong signal that an org has capacity dollars to spend.
 *
 * Data lag note: 990 filings are typically submitted 6-12 months after the
 * fiscal year ends, so ProPublica data is not real-time.  This plugin therefore
 * uses `interval: 'monthly'` rather than the default weekly cadence — there is
 * no value in running it every week when the underlying data updates in batches.
 *
 * Critical distinction: HosTechnology does NOT apply for grants.  These entries
 * are warm outreach leads because an org with growing revenue / grants received
 * now has capacity dollars to spend on automation and tech consulting.
 */

const https = require('https');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROPUBLICA_API_BASE = 'https://projects.propublica.org/nonprofits/api/v2';

/**
 * Maximum number of organizations to fetch per NTEE category per run.
 * Keeps the run time and downstream scoring costs predictable.
 */
const MAX_ORGS_PER_NTEE = 25;

/**
 * Only include organizations whose most recent 990 was filed within this many
 * days.  990s older than this threshold are stale for outreach purposes.
 */
const MAX_FILING_AGE_DAYS = 730; // ~2 years

// ---------------------------------------------------------------------------
// NTEE code mapping
// ---------------------------------------------------------------------------

/**
 * Maps lower-cased target_sector keywords (from profile.json) to one or more
 * NTEE major group letters.  The ProPublica search API accepts `ntee[]=<letter>`
 * to filter by major group.
 *
 * NTEE major groups used here:
 *   B — Education
 *   E — Health — General and Rehabilitative
 *   L — Housing, Shelter
 *   O — Youth Development
 *   P — Human Services
 *   R — Civil Rights, Social Action, Advocacy
 *   S — Community Improvement, Capacity Building
 *   W — Public, Societal Benefit
 *
 * Reference: https://nccs.urban.org/publication/irs-activity-codes
 */
const SECTOR_TO_NTEE = {
  'civic tech':             ['W', 'S'],
  'racial justice':         ['R'],
  'lgbtq+':                 ['R', 'P'],
  'education':              ['B'],
  'housing justice':        ['L'],
  'community organizing':   ['S', 'O'],
  'grassroots advocacy':    ['R', 'S'],
  'immigrant rights':       ['R', 'P'],
  'public health':          ['E'],
};

/**
 * Derive the set of NTEE major-group letters to query based on
 * `profile.target_sectors`.  Falls back to a broad default set when the
 * profile has no recognisable sectors so the plugin never returns zero results
 * solely due to an empty or unrecognised profile.
 *
 * @param {string[]} sectors  Array of sector strings from the profile.
 * @returns {string[]}  Deduplicated NTEE letter codes to query.
 */
function resolveNteeCodes(sectors) {
  if (!Array.isArray(sectors) || sectors.length === 0) {
    // Broad default covering HosTechnology's likely market
    return ['R', 'S', 'P', 'B', 'L', 'E'];
  }

  const codes = new Set();
  for (const sector of sectors) {
    const key = sector.toLowerCase().trim();
    const mapped = SECTOR_TO_NTEE[key];
    if (mapped) {
      for (const code of mapped) codes.add(code);
    }
  }

  // If none of the profile sectors matched our map, fall back to the default.
  return codes.size > 0 ? Array.from(codes) : ['R', 'S', 'P', 'B', 'L', 'E'];
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Perform a GET request to a ProPublica API endpoint and return the parsed
 * JSON body.  Rejects on non-200 status or JSON parse failure.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Scout/0.1 (HosTechnology business-dev bot)',
          'Accept': 'application/json',
        },
        timeout: 20000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`JSON parse error for ${url}: ${err.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after 20 s (${url})`));
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic lead ID derived from the EIN so the same organization is never
 * written to Sheets more than once across monthly runs.
 *
 * @param {string|number} ein
 * @returns {string}
 */
function makeId(ein) {
  const key = String(ein).replace(/\D/g, '');
  return `propublica-${crypto.createHash('md5').update(key).digest('hex').slice(0, 10)}`;
}

/**
 * Format a revenue number as a human-readable budget string.
 *
 * @param {number|null} amount
 * @returns {string|null}
 */
function formatRevenue(amount) {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return `$${amount}`;
}

/**
 * Check whether the given filing date string is within MAX_FILING_AGE_DAYS.
 *
 * @param {string|null} filingDate  ISO date string (YYYY-MM-DD) or null.
 * @returns {boolean}
 */
function isRecentFiling(filingDate) {
  if (!filingDate) return false;
  const filed = new Date(filingDate);
  if (isNaN(filed.getTime())) return false;
  const ageMs = Date.now() - filed.getTime();
  return ageMs <= MAX_FILING_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Normalize an EIN to the "XXXXXXXXX" (9-digit, no hyphen) format used in
 * ProPublica organization URLs.
 *
 * @param {string|number} ein
 * @returns {string}
 */
function normalizeEin(ein) {
  return String(ein).replace(/\D/g, '');
}

/**
 * Build the ProPublica organization profile URL for a given EIN.
 *
 * @param {string|number} ein
 * @returns {string}
 */
function orgUrl(ein) {
  return `https://projects.propublica.org/nonprofits/organizations/${normalizeEin(ein)}`;
}

/**
 * Build a human-readable description of an organization from its 990 data.
 *
 * @param {object} org  Organization object from ProPublica search results.
 * @param {object|null} detail  Optional detail object from the org endpoint.
 * @returns {string}
 */
function buildDescription(org, detail) {
  const parts = [];

  const location = [org.city, org.state].filter(Boolean).join(', ');
  if (location) parts.push(`Location: ${location}.`);

  if (org.ntee_code) parts.push(`NTEE: ${org.ntee_code}.`);

  const revenue = formatRevenue(org.revenue_amount);
  if (revenue) parts.push(`Total revenue: ${revenue}.`);

  const assets = formatRevenue(org.asset_amount);
  if (assets) parts.push(`Total assets: ${assets}.`);

  if (org.filing_date) parts.push(`Most recent 990 filed: ${org.filing_date}.`);

  // Include grant/contribution data from detail filing if available
  if (detail && detail.filings_with_data && detail.filings_with_data.length > 0) {
    const latest = detail.filings_with_data[0];
    if (latest.totgrnts) {
      const grants = formatRevenue(latest.totgrnts);
      if (grants) parts.push(`Grants paid (latest filing): ${grants}.`);
    }
    if (latest.totrevenue) {
      const rev = formatRevenue(latest.totrevenue);
      if (rev) parts.push(`Total revenue (latest filing): ${rev}.`);
    }
  }

  parts.push('Recent 990 filing detected — potential capacity-building lead.');

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Search ProPublica for organizations in a given NTEE major group that have
 * recently filed 990s.
 *
 * @param {string} nteeCode  Single NTEE major-group letter (e.g. 'R').
 * @returns {Promise<object[]>}  Array of org objects from the API response.
 */
async function searchByNtee(nteeCode) {
  // The search endpoint supports ntee[] filter and returns basic org data.
  // c_code[id]=3 restricts to 501(c)(3) public charities.
  const url =
    `${PROPUBLICA_API_BASE}/search.json` +
    `?ntee[id]=${encodeURIComponent(nteeCode)}&c_code[id]=3`;

  let data;
  try {
    data = await fetchJson(url);
  } catch (err) {
    console.warn(`[propublica] WARNING: Search failed for NTEE "${nteeCode}": ${err.message}`);
    return [];
  }

  const orgs = data.organizations || [];
  console.log(`[propublica] NTEE "${nteeCode}": ${orgs.length} org(s) returned`);
  return orgs.slice(0, MAX_ORGS_PER_NTEE);
}

/**
 * Fetch the detail record for a single organization by EIN.
 * Returns null on error so callers can skip rather than fail.
 *
 * @param {string|number} ein
 * @returns {Promise<object|null>}
 */
async function fetchOrgDetail(ein) {
  const url = `${PROPUBLICA_API_BASE}/organizations/${normalizeEin(ein)}.json`;
  try {
    const data = await fetchJson(url);
    return data.organization || null;
  } catch (err) {
    console.warn(`[propublica] WARNING: Could not fetch detail for EIN ${ein}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source plugin — standard interface expected by the Scout pipeline
// ---------------------------------------------------------------------------

/** @type {import('./index').SourcePlugin} */
const propublicaPlugin = {
  id: 'propublica',
  name: 'ProPublica Nonprofit Explorer',
  type: 'api',

  /**
   * Run this source monthly, not weekly.
   *
   * ProPublica 990 data is updated in batches, not continuously — the
   * underlying IRS filings have a 6-12 month natural lag.  Running weekly
   * would return the same orgs every run.  The pipeline respects this field
   * via the per-source interval check in pipeline.js.
   */
  interval: 'monthly',

  /**
   * Fetch organizations from ProPublica Nonprofit Explorer whose recent 990
   * filings indicate active and growing funding.
   *
   * @param {object} profile  The HosTechnology profile.
   * @returns {Promise<Array>} Normalised lead objects ready for the scorer.
   */
  fetch: async (profile) => {
    const nteeCodes = resolveNteeCodes(profile.target_sectors);
    console.log(`[propublica] Querying NTEE codes: ${nteeCodes.join(', ')}`);

    // Collect unique orgs across all NTEE codes (dedupe by EIN).
    const seenEins = new Set();
    const candidates = [];

    for (const code of nteeCodes) {
      const orgs = await searchByNtee(code);
      for (const org of orgs) {
        const ein = normalizeEin(org.ein || org.strein || '');
        if (!ein || seenEins.has(ein)) continue;

        // Only include orgs with a recent filing.
        if (!isRecentFiling(org.filing_date)) {
          continue;
        }

        seenEins.add(ein);
        candidates.push(org);
      }
    }

    console.log(`[propublica] ${candidates.length} candidate org(s) with recent filings`);

    /**
     * Fetch org details concurrently with a small pool to avoid hammering the
     * API sequentially.  With MAX_ORGS_PER_NTEE=25 and up to 6 NTEE codes
     * there can be ~150 candidates; sequential fetching would be very slow and
     * risks rate-limiting.  A concurrency of 4 keeps throughput high while
     * remaining polite to the upstream API.
     */
    const DETAIL_CONCURRENCY = 4;

    async function pooledDetailFetch(orgs) {
      const results = new Array(orgs.length);
      let next = 0;

      async function worker() {
        while (next < orgs.length) {
          const idx = next++;
          const org = orgs[idx];
          const rawEin = org.ein || org.strein || '';
          results[idx] = rawEin ? await fetchOrgDetail(rawEin) : null;
        }
      }

      const workers = Array.from({ length: DETAIL_CONCURRENCY }, () => worker());
      await Promise.all(workers);
      return results;
    }

    const details = await pooledDetailFetch(candidates);

    const leads = [];

    for (let i = 0; i < candidates.length; i++) {
      const org = candidates[i];
      const detail = details[i];
      const ein = normalizeEin(org.ein || org.strein || '');
      const orgName = (org.name || '').trim();

      if (!orgName || !ein) continue;

      const budget = formatRevenue(org.revenue_amount);

      leads.push({
        id: makeId(ein),
        source: 'propublica',
        title: `${orgName} — Recent 990 filing detected`,
        org: orgName,
        url: orgUrl(ein),
        deadline: null,
        budget,
        description: buildDescription(org, detail),
        type: 'lead',
      });
    }

    console.log(`[propublica] Done — ${leads.length} lead(s) returned`);
    return leads;
  },
};

module.exports = propublicaPlugin;

/** Exported for testing */
module.exports.resolveNteeCodes = resolveNteeCodes;
module.exports.SECTOR_TO_NTEE = SECTOR_TO_NTEE;
module.exports.isRecentFiling = isRecentFiling;
module.exports.formatRevenue = formatRevenue;
module.exports.makeId = makeId;
