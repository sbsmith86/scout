'use strict';

const { notion, OPPORTUNITIES_DB_ID, LEADS_DB_ID, CORRECTIONS_DB_ID } = require('./client');
const { OPPORTUNITIES_HEADERS, LEADS_HEADERS, CORRECTIONS_HEADERS } = require('./write');

// ── Property extraction helpers ───────────────────────────────────────────────

/**
 * Extracts a plain string from a Notion property value regardless of type.
 * Returns '' for null / unsupported types.
 *
 * @param {object} prop  Raw property value from the Notion API
 * @returns {string}
 */
function extractText(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return (prop.title || []).map((t) => t.plain_text).join('');
    case 'rich_text':
      return (prop.rich_text || []).map((t) => t.plain_text).join('');
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'number':
      return prop.number != null ? String(prop.number) : '';
    case 'url':
      return prop.url ?? '';
    case 'date':
      return prop.date ? prop.date.start : '';
    default:
      return '';
  }
}

// ── Read helper ───────────────────────────────────────────────────────────────

/**
 * Reads all pages from a Notion database and returns an array of plain objects
 * keyed by the provided header list.  Handles pagination automatically.
 *
 * @param {string}   databaseId
 * @param {string[]} headers  Column names that map to Notion property names
 * @param {object}   [filter]  Optional Notion filter object
 * @returns {Promise<object[]>}
 */
async function readDatabase(databaseId, headers, filter) {
  const results = [];
  let cursor;

  do {
    const params = {
      database_id: databaseId,
      page_size: 100,
    };
    if (filter) params.filter = filter;
    if (cursor) params.start_cursor = cursor;

    const res = await notion.databases.query(params);

    for (const page of res.results) {
      const obj = {};
      for (const header of headers) {
        const prop = page.properties[header];
        obj[header] = prop ? extractText(prop) : '';
      }
      results.push(obj);
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return results;
}

// ── Public read functions ─────────────────────────────────────────────────────

/**
 * Returns all opportunities from the Opportunities database.
 * Optionally filter by status.
 *
 * @param {string|null} [status=null]  Filter by status, or null for all rows
 * @returns {Promise<object[]>}
 */
async function readOpportunities(status = null) {
  const filter = status
    ? { property: 'Status', select: { equals: status } }
    : undefined;
  return readDatabase(OPPORTUNITIES_DB_ID, OPPORTUNITIES_HEADERS, filter);
}

/**
 * Returns all leads from the Leads database.
 * Optionally filter by status.
 *
 * @param {string|null} [status=null]  Filter by status, or null for all rows
 * @returns {Promise<object[]>}
 */
async function readLeads(status = null) {
  const filter = status
    ? { property: 'Status', select: { equals: status } }
    : undefined;
  return readDatabase(LEADS_DB_ID, LEADS_HEADERS, filter);
}

/**
 * Returns all rows from the Corrections Log database.
 * Optionally filter by feedback type.
 *
 * @param {string|null} [feedback=null]  'good_filter' | 'bad_filter' | null for all
 * @returns {Promise<object[]>}
 */
async function readCorrections(feedback = null) {
  const filter = feedback
    ? { property: 'Feedback', select: { equals: feedback } }
    : undefined;
  return readDatabase(CORRECTIONS_DB_ID, CORRECTIONS_HEADERS, filter);
}

/**
 * Returns a dashboard-ready summary of pending items — the primary data source
 * for the review dashboard.
 *
 * @returns {Promise<{opportunities: object[], leads: object[]}>}
 */
async function readPendingForDashboard() {
  const [opportunities, leads] = await Promise.all([
    readOpportunities('pending'),
    readLeads('pending'),
  ]);
  return { opportunities, leads };
}

module.exports = {
  readOpportunities,
  readLeads,
  readCorrections,
  readPendingForDashboard,
};
