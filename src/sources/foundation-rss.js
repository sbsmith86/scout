'use strict';

// Foundation RSS feed source plugin for Agent 2 (Funding Monitor).
//
// Fetches grant announcement RSS/Atom feeds from sector-specific and
// tech-forward funders and normalises each item to the standard lead schema.
// The *recipient* org — the nonprofit that RECEIVED the grant — is extracted
// from the announcement text via a lightweight heuristic pass first; when that
// is inconclusive the Claude API is called to resolve it.
//
// Critical distinction: HosTechnology does NOT apply for grants.  These entries
// are warm outreach leads because a newly-funded org now has capacity dollars to
// spend.

const RSSParser = require('rss-parser');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Feed definitions — add more foundations here (Phase 3) without touching
// anything else in the pipeline.
//
// Source selection rationale:
//   • Borealis Philanthropy funds racial justice orgs (a core HosTech target
//     sector).  Small-to-mid orgs that receive Borealis grants typically lack
//     tech capacity — exactly HosTech's market.
//   • Astraea Foundation is one of the largest LGBTQ+-specific funders.  Grantee
//     orgs are small and grassroots — prime warm-lead territory.
//   • Knight Foundation funds civic/community tech at the local level, surfacing
//     newly-funded orgs that are explicitly building tech capacity.
//   • Mozilla Foundation awards grants for open-web and digital-equity work,
//     frequently to nonprofits and grassroots orgs without in-house tech staff.
//
// Feeds that were removed:
//   • philanthropynewsdigest.org/feeds/grants — 301 redirect to HTML blog page.
//   • macfound.org/feeds/grants/ — redirect chain, grants-specific feed broken.
//   • hewlett.org/grants/feed/ — returns HTML webpage, not RSS/Atom XML.
//
// Investigated but not adopted:
//   • Candid Social Sector News API (developer.candid.org) — investigated as a
//     potential primary Funding Monitor source that could replace broken feeds.
//     Two blockers ruled it out:
//       1. No free tier.  The News API costs $3,300/year (~$275/month), well
//          above the ~$50/month affordability threshold for this project.  The
//          Grants API (which provides structured recipient/funder/amount data)
//          costs $6,000/year (~$500/month).  Only the Demographics and Taxonomy
//          APIs are free, and neither surfaces grant award leads.
//       2. Data is article-level, not structured.  The News API (/news/v1/search)
//          returns article headlines, summaries, and links — the same kind of
//          content already obtained via RSS feeds.  Extracting recipient org,
//          funder, and amount still requires the Claude parsing step.  Structured
//          grant data (recipient, funder, amount) requires the Grants API, which
//          is even more expensive.
//     Decision: closed investigation; continue with free RSS feeds (this plugin)
//     and ProPublica Nonprofit API (see issue #46) as primary Funding Monitor
//     sources.
//
// Validation criteria for any new feed:
//   • HTTP 200 (no redirect chains)
//   • Content-Type: application/rss+xml, application/atom+xml, or text/xml
//   • Response body starts with <?xml, <rss, or <feed  (not <html)
//   • rss-parser returns >0 items
//   • Items are grant award announcements, not general blog posts
// ---------------------------------------------------------------------------
const FEEDS = [
  {
    // Borealis Philanthropy — racial-justice funder; announcements describe
    // individual grants awarded to grassroots orgs.
    id: 'borealis-philanthropy',
    name: 'Borealis Philanthropy',
    url: 'https://borealisphilanthropy.org/feed/',
  },
  {
    // Astraea Foundation for Justice — LGBTQ+-specific global funder.
    // Grantee orgs are small and typically have no dedicated tech staff.
    id: 'astraea-foundation',
    name: 'Astraea Foundation',
    url: 'https://astraeafoundation.org/feed/',
  },
  {
    // Knight Foundation — civic/community-tech funder; grants frequently go to
    // local nonprofits building digital capacity who need outside tech help.
    id: 'knight-foundation',
    name: 'Knight Foundation',
    url: 'https://knightfoundation.org/feed/',
  },
  {
    // Mozilla Foundation — open-web and digital-equity grants; grantees are
    // often small nonprofits or projects without in-house tech teams.
    id: 'mozilla-foundation',
    name: 'Mozilla Foundation',
    url: 'https://foundation.mozilla.org/en/blog/feed/rss/',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Shared sub-pattern fragment for a dollar amount with optional magnitude word
// (e.g. "$2.5 Million", "$500,000", "$750k").  Used in org-extraction regexes
// below so both patterns stay in sync if the format ever needs updating.
// Both lower- and Title-Case magnitude words are listed explicitly to avoid
// using the /i flag, which would cause [A-Z] in capture groups to also match
// lowercase letters (breaking the uppercase-org-name enforcement).
const DOLLAR_AMOUNT_RE = String.raw`\$[\d,.]+(?:\s*(?:[mM]illion|[bB]illion|[tT]housand|[kK]))?`;

/**
 * Deterministic ID derived from the feed source + item URL so that the same
 * announcement is never written to Sheets more than once.
 */
function makeId(feedId, itemUrl, itemTitle) {
  const key = itemUrl || `${feedId}:${itemTitle || ''}`;
  return `${feedId}-${crypto.createHash('md5').update(key).digest('hex').slice(0, 10)}`;
}

/**
 * Try to extract a budget / grant amount from raw text using a simple regex.
 * Returns a human-readable string like "$2,500,000" or null if not found.
 */
function extractBudget(text) {
  if (!text) return null;
  // Match patterns like "$2.5 million", "$500,000", "USD 1,200,000"
  const match = text.match(
    /(?:USD\s*)?\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|thousand))?|\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion)\s*(?:dollars?|USD)?/i
  );
  return match ? match[0].trim() : null;
}

/**
 * Heuristic extraction of the recipient org from announcement text.
 *
 * Foundation announcements often follow patterns like:
 *   "Ford Foundation awards $X to <Org Name>"
 *   "<Org Name> receives a $X grant from the Ford Foundation"
 *   "A grant of $X has been awarded to <Org Name>"
 *
 * Returns the extracted org string, or null when heuristics are not confident.
 */
function heuristicExtractOrg(title, description, foundationName) {
  const text = `${title || ''} ${description || ''}`;

  // Pattern: "Awards/Grants $X to <Org>" — common in PND titles, e.g.
  // "Ford Foundation Awards $2.5 Million to Community Action Network for ..."
  // Also handles "$500k" shorthand and org names that appear at end of title.
  // Magnitude words use explicit case variants ([mM]illion etc.) so [A-Z] in
  // the capture group still enforces an uppercase org-name start character.
  const dollarToMatch = text.match(
    new RegExp(String.raw`${DOLLAR_AMOUNT_RE}\s+to\s+([A-Z][^.,;:()]{3,60}?)(?=\s*(?:,|\.|;|\bfor\b)|$)`)
  );
  if (dollarToMatch) return dollarToMatch[1].trim();

  // Pattern: "to <Org>" / "awarded to <Org>" / "grants $X to <Org>"
  // Handles optional dollar amount (with Title-Case magnitude) between the
  // verb and "to".  Both lower and Title-Case verb forms are listed explicitly
  // so that [A-Z] in the capture group still rejects lowercase-starting words.
  const toMatch = text.match(
    new RegExp(String.raw`(?:award(?:ed|s)?|Award(?:ed|s)?|grant(?:ed|s)?|Grant(?:ed|s)?|support(?:ing)?|fund(?:ing)?)\s+(?:${DOLLAR_AMOUNT_RE}\s+)?(?:to\s+)?([A-Z][^.,;:()]{3,60}?)(?=\s*(?:,|\.|;|\bfor\b|\bto\b)|$)`)
  );
  if (toMatch) return toMatch[1].trim();

  // Pattern: "<Org> receives" / "<Org> awarded" — `i` flag only affects the
  // verb ("Receives" vs "receives") since the org group is anchored at ^ and
  // real org names always start with an uppercase letter.
  const receivesMatch = text.match(
    /^([A-Z][^.,;:()]{3,60}?)\s+(?:receives?|is\s+awarded?|has\s+been\s+awarded?)/i
  );
  if (receivesMatch) return receivesMatch[1].trim();

  // If the title does NOT contain the foundation name at the start, it may be
  // the org name itself (common in MacArthur / Kellogg announcements).
  if (title && !title.toLowerCase().startsWith(foundationName.toLowerCase().split(' ')[0])) {
    // Strip trailing " — grant" / " | grant" noise
    const cleaned = title.replace(/\s*[|—–-]\s*.*/g, '').trim();
    if (cleaned.length > 3 && cleaned.length < 80) return cleaned;
  }

  return null;
}

/**
 * Call the Anthropic Claude API to extract the recipient org name.
 * Only invoked when the heuristic pass returns null.
 *
 * Uses the raw completions endpoint so we don't need the full Anthropic SDK
 * as a dependency — just the API key from the environment.
 */
async function claudeExtractOrg(title, description) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[foundation-rss] ANTHROPIC_API_KEY not set — skipping Claude org extraction');
    return null;
  }

  const prompt = `You are extracting structured data from a foundation grant announcement.

Announcement title: ${title || '(none)'}

Announcement text:
${(description || '').slice(0, 2000)}

Task: Identify the name of the NONPROFIT ORGANIZATION that RECEIVED this grant (not the foundation awarding it).
Return ONLY the organization name as a plain string, no explanation.
If you cannot determine the recipient with confidence, return exactly: unknown`;

  const body = JSON.stringify({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content && parsed.content[0] && parsed.content[0].text;
            if (text && text.toLowerCase() !== 'unknown') {
              resolve(text.trim());
            } else {
              resolve(null);
            }
          } catch {
            console.error('[foundation-rss] Claude response parse error');
            resolve(null);
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error('[foundation-rss] Claude API request error:', err.message);
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

// Content-type values that indicate genuine RSS/Atom XML.
const XML_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
];

/**
 * Perform a raw HTTP(S) GET and return `{ statusCode, contentType, body }`.
 * Follows up to `redirectsRemaining` redirects (default: 1) so transient CDN
 * hops don't fail the check, but logs a warning so redirect chains are visible.
 * `Location` headers are resolved against the current URL so relative and
 * protocol-relative values are handled correctly.
 *
 * @param {string} url
 * @param {number} [redirectsRemaining=1] - How many redirects may still be followed.
 * @returns {Promise<{statusCode: number, contentType: string, body: string}>}
 */
function fetchRaw(url, redirectsRemaining = 1) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': 'Scout/0.1 (HosTechnology business-dev bot)' }, timeout: 15000 },
      (res) => {
        // Follow redirects up to the configured limit.
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          console.warn(
            `[foundation-rss] WARNING: Feed URL redirected (HTTP ${res.statusCode}) → ${res.headers.location}`
          );
          res.resume(); // drain the socket

          if (redirectsRemaining <= 0) {
            console.warn(
              '[foundation-rss] WARNING: Redirect limit reached; not following further redirects.'
            );
            resolve({
              statusCode: res.statusCode,
              contentType: res.headers['content-type'] || '',
              body: '',
            });
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
          resolve({
            statusCode: res.statusCode,
            contentType: res.headers['content-type'] || '',
            body,
          });
        });
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
 * Fetch a single RSS/Atom feed and return an array of normalised lead objects.
 * Performs health checks on the raw HTTP response before attempting to parse,
 * and logs WARNING-level diagnostics when the response looks unexpected.
 */
async function fetchFeed(feed, parser) {
  // ── 1. Raw fetch with health checks ────────────────────────────────────────
  let rawResponse;
  try {
    rawResponse = await fetchRaw(feed.url);
  } catch (err) {
    console.warn(
      `[foundation-rss] WARNING: Failed to fetch feed "${feed.name}" (${feed.url}): ${err.message}`
    );
    return [];
  }

  const { statusCode, contentType, body } = rawResponse;
  const trimmedBody = body.trimStart();
  const bodySnippet = trimmedBody.slice(0, 120).replace(/\n/g, ' ');
  const looksLikeXml = trimmedBody.startsWith('<?xml') || trimmedBody.startsWith('<rss') || trimmedBody.startsWith('<feed');
  const looksLikeHtml = trimmedBody.toLowerCase().startsWith('<html') || trimmedBody.toLowerCase().startsWith('<!doctype');

  if (statusCode !== 200) {
    console.warn(
      `[foundation-rss] WARNING: Feed "${feed.name}" returned HTTP ${statusCode} ` +
      `(expected 200). Content-Type: "${contentType}". ` +
      `Body starts with: ${looksLikeXml ? '<?xml' : looksLikeHtml ? '<html' : `"${bodySnippet}"`}`
    );
  }

  const hasXmlContentType = XML_CONTENT_TYPES.some((ct) => contentType.toLowerCase().includes(ct));
  if (!hasXmlContentType) {
    console.warn(
      `[foundation-rss] WARNING: Feed "${feed.name}" content-type is ` +
      `"${contentType.split(';')[0].trim()}" (expected an XML type such as application/rss+xml).`
    );
  }

  if (looksLikeHtml) {
    console.warn(
      `[foundation-rss] WARNING: Feed "${feed.name}" body starts with HTML, not XML — ` +
      `skipping parse. HTTP ${statusCode}, content-type: "${contentType}". ` +
      `Body start: ${bodySnippet}`
    );
    return [];
  }

  // ── 2. Parse ────────────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = await parser.parseString(body);
  } catch (err) {
    console.warn(
      `[foundation-rss] WARNING: Failed to parse feed "${feed.name}": ${err.message}. ` +
      `HTTP ${statusCode}, content-type: "${contentType}". ` +
      `Body starts with: ${looksLikeXml ? '<?xml' : looksLikeHtml ? '<html' : `"${bodySnippet}"`}`
    );
    return [];
  }

  const items = parsed.items || [];

  if (items.length === 0) {
    console.warn(
      `[foundation-rss] WARNING: Feed "${feed.name}" returned 0 items after parse. ` +
      `HTTP ${statusCode}, content-type: "${contentType}". ` +
      `Body starts with: ${looksLikeXml ? '<?xml' : looksLikeHtml ? '<html' : `"${bodySnippet}"`}`
    );
  }

  const leads = [];

  for (const item of items) {
    const title = item.title || '';
    const description = item.contentSnippet || item.content || item.summary || '';
    const url = item.link || item.guid || '';

    // Attempt cheap heuristic extraction first; fall back to Claude only when
    // needed to keep latency and API costs low.
    let org = heuristicExtractOrg(title, description, feed.name);
    if (!org) {
      org = await claudeExtractOrg(title, description);
    }

    // If we still cannot identify a recipient, use a generic fallback rather
    // than silently dropping the lead — the human reviewer can correct it on
    // the dashboard.
    if (!org) {
      org = 'Unknown recipient';
    }

    leads.push({
      id: makeId(feed.id, url, title),
      source: feed.id,
      title,
      org,
      url,
      deadline: null,
      budget: extractBudget(`${title} ${description}`),
      description,
      type: 'lead',
    });
  }

  return leads;
}

// ---------------------------------------------------------------------------
// Source plugin — standard interface expected by the Scout pipeline
// ---------------------------------------------------------------------------

/** @type {import('./index').SourcePlugin} */
const foundationRssPlugin = {
  id: 'foundation-rss',
  name: 'Foundation RSS Feeds',
  type: 'api',

  /**
   * Fetch grant announcements from all configured foundation RSS feeds.
   *
   * @param {object} _profile  The HosTechnology profile (unused for fetching;
   *                           passed along for interface consistency).
   * @returns {Promise<Array>} Normalised lead objects ready for the scorer.
   */
  fetch: async (_profile) => {
    const parser = new RSSParser({
      timeout: 10000,
      headers: { 'User-Agent': 'Scout/0.1 (HosTechnology business-dev bot)' },
      // Accept both RSS and Atom content fields
      customFields: {
        item: [
          ['content:encoded', 'content'],
          ['summary', 'summary'],
        ],
      },
    });

    const allLeads = [];

    for (const feed of FEEDS) {
      const leads = await fetchFeed(feed, parser);
      console.log(`[foundation-rss] ${feed.name}: ${leads.length} item(s) fetched`);
      allLeads.push(...leads);
    }

    return allLeads;
  },
};

module.exports = foundationRssPlugin;

/** @type {Array<{id: string, name: string, url: string}>} */
module.exports.FEEDS = FEEDS;
