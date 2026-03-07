'use strict';

// Foundation RSS feed source plugin for Agent 2 (Funding Monitor).
//
// Fetches grant announcement RSS/Atom feeds from major foundations and normalises
// each item to the standard lead schema.  The *recipient* org — the nonprofit that
// RECEIVED the grant — is extracted from the announcement text via a lightweight
// heuristic pass first; when that is inconclusive the Claude API is called to
// resolve it.
//
// Critical distinction: HosTechnology does NOT apply for grants.  These entries
// are warm outreach leads because a newly-funded org now has capacity dollars to
// spend.

const RSSParser = require('rss-parser');
const https = require('https');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Feed definitions — add more foundations here (Phase 3) without touching
// anything else in the pipeline.
// ---------------------------------------------------------------------------
const FEEDS = [
  {
    id: 'ford-foundation',
    name: 'Ford Foundation',
    url: 'https://www.fordfoundation.org/news-and-stories/feed/',
  },
  {
    id: 'hewlett-foundation',
    name: 'Hewlett Foundation',
    url: 'https://hewlett.org/feed/',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  // Pattern: "to <Org>" / "awarded to <Org>" / "grant to <Org>"
  const toMatch = text.match(
    /(?:awarded?|grant(?:ed)?|support(?:ing)?|fund(?:ing)?)\s+(?:to\s+)?([A-Z][^.,;:()]{3,60}?)(?:\s*(?:,|\.|;|\bfor\b|\bto\b))/
  );
  if (toMatch) return toMatch[1].trim();

  // Pattern: "<Org> receives" / "<Org> awarded"
  const receivesMatch = text.match(
    /^([A-Z][^.,;:()]{3,60}?)\s+(?:receives?|is\s+awarded?|has\s+been\s+awarded?)/
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

/**
 * Fetch a single RSS/Atom feed and return an array of normalised lead objects.
 */
async function fetchFeed(feed, parser) {
  let parsed;
  try {
    parsed = await parser.parseURL(feed.url);
  } catch (err) {
    console.error(`[foundation-rss] Failed to fetch feed "${feed.name}" (${feed.url}): ${err.message}`);
    return [];
  }

  const items = parsed.items || [];
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
