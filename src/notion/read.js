'use strict';

const { notion, OPPORTUNITIES_DB_ID, LEADS_DB_ID, CORRECTIONS_DB_ID } = require('./client');

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

// ── Notion → pipeline key mapping ────────────────────────────────────────────
// Maps Notion Title Case property names to the snake_case keys that the rest
// of the codebase (pipeline, dashboard, scorer) expects.  This keeps the Notion
// module a drop-in replacement for the sheets module.

const OPPORTUNITIES_MAP = {
  'Name':           'id',
  'Source':         'source',
  'Title':         'title',
  'Organization':  'org',
  'URL':           'url',
  'Deadline':      'deadline',
  'Budget':        'budget',
  'Score':         'score',
  'Confidence':    'confidence',
  'Surface Reason':'surface_reason',
  'Description':   'description',
  'Status':        'status',
  'Date Surfaced': 'date_surfaced',
  'Draft Text':    'draft_text',
};

const LEADS_MAP = {
  'Name':           'id',
  'Organization':   'org',
  'Funder':         'funder',
  'Funding Amount': 'funding_amount',
  'Funding Date':   'funding_date',
  'Mission Summary':'mission_summary',
  'Score':          'score',
  'Confidence':     'confidence',
  'Surface Reason': 'surface_reason',
  'Status':         'status',
  'Date Surfaced':  'date_surfaced',
  'Draft Text':     'draft_text',
};

const CORRECTIONS_MAP = {
  'Name':          'id',
  'Item ID':       'item_id',
  'Item Type':     'item_type',
  'Title':         'title',
  'Organization':  'org',
  'Source':        'source',
  'Filter Reason': 'filter_reason',
  'Feedback':      'feedback',
  'Date':          'date',
};

// ── Read helper ───────────────────────────────────────────────────────────────

/**
 * Reads all pages from a Notion database and returns an array of plain objects
 * with snake_case keys matching the sheets module interface.
 *
 * @param {string}   databaseId
 * @param {object}   propertyMap  Notion property name → pipeline key
 * @param {object}   [filter]     Optional Notion filter object
 * @returns {Promise<object[]>}
 */
async function readDatabase(databaseId, propertyMap, filter) {
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
      for (const [notionName, pipelineKey] of Object.entries(propertyMap)) {
        const prop = page.properties[notionName];
        obj[pipelineKey] = prop ? extractText(prop) : '';
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
  return readDatabase(OPPORTUNITIES_DB_ID, OPPORTUNITIES_MAP, filter);
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
  return readDatabase(LEADS_DB_ID, LEADS_MAP, filter);
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
  return readDatabase(CORRECTIONS_DB_ID, CORRECTIONS_MAP, filter);
}

/**
 * Returns a dashboard-ready summary of pending items — the primary data source
 * for the review dashboard.
 *
 * @returns {Promise<{opportunities: object[], leads: object[]}>}
 */
async function readPendingForDashboard() {
  const [opportunities, leads] = await Promise.all([
    readOpportunities('Pending'),
    readLeads('Pending'),
  ]);
  return { opportunities, leads };
}

module.exports = {
  readOpportunities,
  readLeads,
  readCorrections,
  readPendingForDashboard,
};
