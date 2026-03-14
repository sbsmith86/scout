'use strict';

const { notion, OPPORTUNITIES_DB_ID, LEADS_DB_ID, CORRECTIONS_DB_ID } = require('./client');

// ── Property name constants ───────────────────────────────────────────────────
// Keep these in sync with the Notion database schemas.  The property names here
// must match exactly (case-sensitive) what is configured in each database.

// Property names must match the Notion database schemas exactly (case-sensitive).
// These are the actual Notion property names as configured in the UI.

const OPPORTUNITIES_HEADERS = [
  'Name', 'Source', 'Title', 'Organization', 'URL', 'Deadline', 'Budget',
  'Score', 'Confidence', 'Surface Reason', 'Description',
  'Status', 'Date Surfaced', 'Draft Text',
];

const LEADS_HEADERS = [
  'Name', 'Organization', 'Funder', 'Funding Amount', 'Funding Date',
  'Mission Summary', 'Score', 'Confidence', 'Surface Reason',
  'Status', 'Date Surfaced', 'Draft Text',
];

const CORRECTIONS_HEADERS = [
  'Name', 'Item ID', 'Item Type', 'Title', 'Organization', 'Source',
  'Filter Reason', 'Feedback', 'Date',
];

// ── Property builder helpers ──────────────────────────────────────────────────

// Notion enforces a 2 000-character limit per rich_text content item.
// Values that exceed this (e.g. draft_text, description) are split into
// successive chunks so the API never returns a 400 validation error.
const RICH_TEXT_MAX = 2000;

/** Rich-text property value — splits long strings into 2 000-char chunks */
function text(value) {
  const str = String(value ?? '');
  if (str.length <= RICH_TEXT_MAX) {
    return { rich_text: [{ text: { content: str } }] };
  }
  const chunks = Array.from(
    { length: Math.ceil(str.length / RICH_TEXT_MAX) },
    (_, i) => ({ text: { content: str.slice(i * RICH_TEXT_MAX, (i + 1) * RICH_TEXT_MAX) } })
  );
  return { rich_text: chunks };
}

/** Title property value (Notion requires exactly one title property per page) */
function titleProp(value) {
  return {
    title: [{ text: { content: String(value ?? '') } }],
  };
}

/** Number property value */
function number(value) {
  const n = Number(value);
  return { number: isNaN(n) ? null : n };
}

/** Select property value */
function select(value) {
  if (!value) return { select: null };
  return { select: { name: String(value) } };
}

/** URL property value */
function url(value) {
  if (!value) return { url: null };
  return { url: String(value) };
}

/** Date property value — accepts ISO date strings */
function date(value) {
  if (!value) return { date: null };
  return { date: { start: String(value) } };
}

// ── Sheet-name validation ─────────────────────────────────────────────────────

const VALID_SHEET_NAMES = ['Opportunities', 'Leads'];

/**
 * Maps a validated sheetName string to the correct Notion database ID.
 * Throws immediately for unrecognised values so typos surface early.
 *
 * @param {string} sheetName
 * @returns {string} databaseId
 */
function resolveDatabase(sheetName) {
  if (sheetName === 'Opportunities') return OPPORTUNITIES_DB_ID;
  if (sheetName === 'Leads') return LEADS_DB_ID;
  throw new Error(
    `Unknown sheet name "${sheetName}". Must be one of: ${VALID_SHEET_NAMES.join(', ')}.`
  );
}

// ── Query helper ──────────────────────────────────────────────────────────────

/**
 * Finds the first page in a database where the 'id' property matches the given value.
 * Returns null if not found.
 *
 * @param {string} databaseId
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function findPageById(databaseId, id) {
  const res = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Name',
      title: { equals: id },
    },
    page_size: 1,
  });
  return res.results[0] ?? null;
}

/**
 * Updates a single text property on an existing page.
 *
 * @param {string} pageId
 * @param {string} propertyName
 * @param {string} value
 */
async function updatePageProperty(pageId, propertyName, value) {
  await notion.pages.update({
    page_id: pageId,
    properties: { [propertyName]: text(value) },
  });
}

/**
 * Updates the select (status) property on an existing page.
 *
 * @param {string} pageId
 * @param {string} propertyName
 * @param {string} value
 */
async function updatePageSelect(pageId, propertyName, value) {
  await notion.pages.update({
    page_id: pageId,
    properties: { [propertyName]: select(value) },
  });
}

// ── Header initialisation (no-op for Notion) ──────────────────────────────────
// Notion databases have fixed schemas configured in the UI.  These functions are
// provided so that the notion module has the same interface as sheets/write.js
// and can be used as a drop-in replacement without any call-site changes.

/**
 * No-op for Notion — database schemas are managed in the Notion UI.
 * Provided for interface compatibility with sheets/write.js.
 *
 * @param {'Opportunities'|'Leads'|'Corrections Log'} _sheetName
 */
async function initializeHeaders(_sheetName) {
  // Notion database schemas are configured in the Notion UI, not in code.
}

/**
 * Verifies that all three Notion databases are reachable.
 * Logs a clear error for any database that cannot be retrieved.
 * Provided for interface compatibility with sheets/write.js.
 */
async function initializeAllHeaders() {
  const checks = [
    { label: 'Opportunities',  id: OPPORTUNITIES_DB_ID, envVar: 'NOTION_OPPORTUNITIES_DB_ID' },
    { label: 'Leads',          id: LEADS_DB_ID,          envVar: 'NOTION_LEADS_DB_ID' },
    { label: 'Corrections Log', id: CORRECTIONS_DB_ID,   envVar: 'NOTION_CORRECTIONS_DB_ID' },
  ];

  await Promise.all(checks.map(async ({ label, id, envVar }) => {
    try {
      await notion.databases.retrieve({ database_id: id });
    } catch (err) {
      console.error(
        `[notion] ✗ ${label} database (${id}) is not reachable: ${err.message}. ` +
        `Check ${envVar} in .env and ensure the integration has been shared with the database.`
      );
    }
  }));
}

// ── Write functions ───────────────────────────────────────────────────────────

/**
 * Appends a single opportunity page to the Opportunities database.
 *
 * @param {object} opportunity
 * @param {string} opportunity.id
 * @param {string} opportunity.source
 * @param {string} opportunity.title
 * @param {string} opportunity.org
 * @param {string} opportunity.url
 * @param {string|null} opportunity.deadline        ISO date or null
 * @param {string|null} opportunity.budget          Raw text or null
 * @param {number} opportunity.score                Overall score (1–20)
 * @param {string} opportunity.confidence           'high' | 'medium' | 'low'
 * @param {string} [opportunity.surface_reason]
 * @param {string} [opportunity.description]
 * @param {string} [opportunity.contact_name]
 * @param {string} [opportunity.contact_title]
 * @param {string} [opportunity.contact_email]
 * @param {string} [opportunity.contact_linkedin]
 * @param {string} [opportunity.application_type]
 * @param {string} [opportunity.application_notes]
 * @param {string} [opportunity.status='pending']   'pending' | 'approved' | 'skipped' | 'sent'
 * @param {string} [opportunity.date_surfaced]      ISO timestamp; defaults to now
 * @param {string} [opportunity.draft_text]
 * @param {string} [opportunity.draft_doc_link]
 */
async function appendOpportunity(opportunity) {
  const existing = await findPageById(OPPORTUNITIES_DB_ID, opportunity.id);
  if (existing) {
    console.log(`[notion] Skipping duplicate opportunity: ${opportunity.id}`);
    return;
  }

  await notion.pages.create({
    parent: { database_id: OPPORTUNITIES_DB_ID },
    properties: {
      'Name':             titleProp(opportunity.id),
      'Title':            text(opportunity.title),
      'Source':           select(opportunity.source),
      'Organization':     text(opportunity.org),
      'URL':              url(opportunity.url),
      'Deadline':         date(opportunity.deadline),
      'Budget':           text(opportunity.budget),
      'Score':            number(opportunity.score),
      'Confidence':       select(opportunity.confidence),
      'Surface Reason':   text(opportunity.surface_reason),
      'Description':      text(opportunity.description),
      'Status':           select(opportunity.status ?? 'Pending'),
      'Date Surfaced':    date(opportunity.date_surfaced ?? new Date().toISOString()),
      'Draft Text':       text(opportunity.draft_text),
    },
  });
}

/**
 * Appends a single lead page to the Leads database.
 *
 * @param {object} lead
 * @param {string} lead.id
 * @param {string} lead.org
 * @param {string} lead.funder
 * @param {string} lead.funding_amount
 * @param {string} lead.funding_date                ISO date
 * @param {string} lead.mission_summary
 * @param {number} lead.score                       Overall score (1–20)
 * @param {string} lead.confidence                  'high' | 'medium' | 'low'
 * @param {string} [lead.surface_reason]
 * @param {string} [lead.contact_name]
 * @param {string} [lead.contact_title]
 * @param {string} [lead.contact_email]
 * @param {string} [lead.contact_linkedin]
 * @param {string} [lead.status='pending']          'pending' | 'approved' | 'skipped' | 'sent'
 * @param {string} [lead.date_surfaced]             ISO timestamp; defaults to now
 * @param {string} [lead.draft_text]
 * @param {string} [lead.draft_doc_link]
 */
async function appendLead(lead) {
  const existing = await findPageById(LEADS_DB_ID, lead.id);
  if (existing) {
    console.log(`[notion] Skipping duplicate lead: ${lead.id}`);
    return;
  }

  await notion.pages.create({
    parent: { database_id: LEADS_DB_ID },
    properties: {
      'Name':             titleProp(lead.id),
      'Organization':     text(lead.org),
      'Funder':           text(lead.funder),
      'Funding Amount':   text(lead.funding_amount),
      'Funding Date':     date(lead.funding_date),
      'Mission Summary':  text(lead.mission_summary),
      'Score':            number(lead.score),
      'Confidence':       select(lead.confidence),
      'Surface Reason':   text(lead.surface_reason),
      'Status':           select(lead.status ?? 'Pending'),
      'Date Surfaced':    date(lead.date_surfaced ?? new Date().toISOString()),
      'Draft Text':       text(lead.draft_text),
    },
  });
}

/**
 * Appends a single row to the Corrections Log database.
 *
 * @param {object} correction
 * @param {string} correction.id
 * @param {string} correction.item_id
 * @param {string} correction.item_type             'opportunity' | 'lead'
 * @param {string} [correction.title]
 * @param {string} [correction.org]
 * @param {string} [correction.source]
 * @param {string} correction.filter_reason         Plain-English reason the item was filtered
 * @param {string} correction.feedback              'good_filter' | 'bad_filter'
 * @param {string} [correction.date]                ISO timestamp; defaults to now
 */
async function appendCorrection(correction) {
  await notion.pages.create({
    parent: { database_id: CORRECTIONS_DB_ID },
    properties: {
      'Name':           titleProp(correction.id),
      'Item ID':        text(correction.item_id),
      'Item Type':      select(correction.item_type),
      'Title':          text(correction.title),
      'Organization':   text(correction.org),
      'Source':         select(correction.source),
      'Filter Reason':  text(correction.filter_reason),
      'Feedback':       select(correction.feedback),
      'Date':           date(correction.date ?? new Date().toISOString()),
    },
  });
}

/**
 * Updates the feedback field of an existing Corrections Log page.
 *
 * Prefers the most recent page whose feedback field is empty (matching the
 * Sheets behaviour of writing to the first unfeedback-ed row with the given id).
 * Falls back to the most recent page with any value if no empty-feedback page
 * is found.  Throws a descriptive error if no page exists with the given id.
 *
 * @param {string} id       The correction row id (e.g. 'corr-abc12345')
 * @param {string} feedback 'good_filter' | 'bad_filter'
 */
async function updateCorrectionFeedback(id, feedback) {
  const sorts = [{ timestamp: 'created_time', direction: 'descending' }];

  // First try: most recent page with matching id AND empty feedback
  const emptyFeedbackRes = await notion.databases.query({
    database_id: CORRECTIONS_DB_ID,
    filter: {
      and: [
        { property: 'Name', title: { equals: id } },
        { property: 'Feedback', select: { is_empty: true } },
      ],
    },
    sorts,
    page_size: 1,
  });

  let page = emptyFeedbackRes.results[0] ?? null;

  if (!page) {
    // Fallback: most recent page with matching id regardless of feedback value
    const anyRes = await notion.databases.query({
      database_id: CORRECTIONS_DB_ID,
      filter: { property: 'Name', title: { equals: id } },
      sorts,
      page_size: 1,
    });
    page = anyRes.results[0] ?? null;
  }

  if (!page) {
    throw new Error(`Row with id "${id}" not found in Corrections Log`);
  }
  await updatePageSelect(page.id, 'Feedback', feedback);
}

/**
 * Updates the status of an existing Opportunities or Leads page.
 *
 * @param {'Opportunities'|'Leads'} sheetName  Used for error messages; actual DB is resolved from id
 * @param {string} id
 * @param {string} status  'pending' | 'approved' | 'skipped' | 'sent'
 */
async function updateStatus(sheetName, id, status) {
  const databaseId = resolveDatabase(sheetName);
  const page = await findPageById(databaseId, id);
  if (!page) {
    throw new Error(`Row with id "${id}" not found in sheet: ${sheetName}`);
  }
  await updatePageSelect(page.id, 'Status', status);
}

/**
 * Updates the Draft Text of an existing Opportunities or Leads page.
 *
 * @param {'Opportunities'|'Leads'} sheetName
 * @param {string} id
 * @param {string} draftText  New draft text content
 */
async function updateDraftText(sheetName, id, draftText) {
  const databaseId = resolveDatabase(sheetName);
  const page = await findPageById(databaseId, id);
  if (!page) {
    throw new Error(`Row with id "${id}" not found in sheet: ${sheetName}`);
  }
  await updatePageProperty(page.id, 'Draft Text', draftText);
}

module.exports = {
  appendOpportunity,
  appendLead,
  appendCorrection,
  updateCorrectionFeedback,
  updateStatus,
  updateDraftText,
  initializeHeaders,
  initializeAllHeaders,
  OPPORTUNITIES_HEADERS,
  LEADS_HEADERS,
  CORRECTIONS_HEADERS,
};
