'use strict';

const { notion, OPPORTUNITIES_DB_ID, LEADS_DB_ID, CORRECTIONS_DB_ID } = require('./client');

// ── Property name constants ───────────────────────────────────────────────────
// Keep these in sync with the Notion database schemas.  The property names here
// must match exactly (case-sensitive) what is configured in each database.

const OPPORTUNITIES_HEADERS = [
  'id', 'source', 'title', 'org', 'url', 'deadline', 'budget',
  'score', 'confidence', 'surface_reason', 'description',
  'contact_name', 'contact_title', 'contact_email', 'contact_linkedin',
  'application_type', 'application_notes',
  'status', 'date_surfaced', 'draft_text', 'draft_doc_link',
];

const LEADS_HEADERS = [
  'id', 'org', 'funder', 'funding_amount', 'funding_date', 'mission_summary',
  'score', 'confidence', 'surface_reason',
  'contact_name', 'contact_title', 'contact_email', 'contact_linkedin',
  'status', 'date_surfaced', 'draft_text', 'draft_doc_link',
];

const CORRECTIONS_HEADERS = [
  'id', 'item_id', 'item_type', 'title', 'org', 'source', 'filter_reason', 'feedback', 'date',
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
      property: 'id',
      rich_text: { equals: id },
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
 * No-op for Notion — database schemas are managed in the Notion UI.
 * Provided for interface compatibility with sheets/write.js.
 */
async function initializeAllHeaders() {
  // Notion database schemas are configured in the Notion UI, not in code.
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
  await notion.pages.create({
    parent: { database_id: OPPORTUNITIES_DB_ID },
    properties: {
      title:              titleProp(opportunity.title),
      id:                 text(opportunity.id),
      source:             text(opportunity.source),
      org:                text(opportunity.org),
      url:                url(opportunity.url),
      deadline:           date(opportunity.deadline),
      budget:             text(opportunity.budget),
      score:              number(opportunity.score),
      confidence:         select(opportunity.confidence),
      surface_reason:     text(opportunity.surface_reason),
      description:        text(opportunity.description),
      contact_name:       text(opportunity.contact_name),
      contact_title:      text(opportunity.contact_title),
      contact_email:      text(opportunity.contact_email),
      contact_linkedin:   url(opportunity.contact_linkedin),
      application_type:   text(opportunity.application_type),
      application_notes:  text(opportunity.application_notes),
      status:             select(opportunity.status ?? 'pending'),
      date_surfaced:      text(opportunity.date_surfaced ?? new Date().toISOString()),
      draft_text:         text(opportunity.draft_text),
      draft_doc_link:     url(opportunity.draft_doc_link),
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
  await notion.pages.create({
    parent: { database_id: LEADS_DB_ID },
    properties: {
      title:            titleProp(lead.org),
      id:               text(lead.id),
      org:              text(lead.org),
      funder:           text(lead.funder),
      funding_amount:   text(lead.funding_amount),
      funding_date:     date(lead.funding_date),
      mission_summary:  text(lead.mission_summary),
      score:            number(lead.score),
      confidence:       select(lead.confidence),
      surface_reason:   text(lead.surface_reason),
      contact_name:     text(lead.contact_name),
      contact_title:    text(lead.contact_title),
      contact_email:    text(lead.contact_email),
      contact_linkedin: url(lead.contact_linkedin),
      status:           select(lead.status ?? 'pending'),
      date_surfaced:    text(lead.date_surfaced ?? new Date().toISOString()),
      draft_text:       text(lead.draft_text),
      draft_doc_link:   url(lead.draft_doc_link),
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
      title:         titleProp(correction.title || correction.id),
      id:            text(correction.id),
      item_id:       text(correction.item_id),
      item_type:     select(correction.item_type),
      org:           text(correction.org),
      source:        text(correction.source),
      filter_reason: text(correction.filter_reason),
      feedback:      select(correction.feedback),
      date:          text(correction.date ?? new Date().toISOString()),
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
        { property: 'id', rich_text: { equals: id } },
        { property: 'feedback', select: { is_empty: true } },
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
      filter: { property: 'id', rich_text: { equals: id } },
      sorts,
      page_size: 1,
    });
    page = anyRes.results[0] ?? null;
  }

  if (!page) {
    throw new Error(`Row with id "${id}" not found in Corrections Log`);
  }
  await updatePageSelect(page.id, 'feedback', feedback);
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
  await updatePageSelect(page.id, 'status', status);
}

/**
 * Updates the draft_text of an existing Opportunities or Leads page.
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
  await updatePageProperty(page.id, 'draft_text', draftText);
}

/**
 * Updates the draft_doc_link of an existing Opportunities or Leads page.
 *
 * @param {'Opportunities'|'Leads'} sheetName
 * @param {string} id
 * @param {string} docLink  Notion or Google Docs URL for the exported draft
 */
async function updateDraftDocLink(sheetName, id, docLink) {
  const databaseId = resolveDatabase(sheetName);
  const page = await findPageById(databaseId, id);
  if (!page) {
    throw new Error(`Row with id "${id}" not found in sheet: ${sheetName}`);
  }
  await notion.pages.update({
    page_id: page.id,
    properties: { draft_doc_link: url(docLink) },
  });
}

module.exports = {
  appendOpportunity,
  appendLead,
  appendCorrection,
  updateCorrectionFeedback,
  updateStatus,
  updateDraftText,
  updateDraftDocLink,
  initializeHeaders,
  initializeAllHeaders,
  OPPORTUNITIES_HEADERS,
  LEADS_HEADERS,
  CORRECTIONS_HEADERS,
};
