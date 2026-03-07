'use strict';

const { getSheetsClient, getSpreadsheetId } = require('./client');
const { columnLetter } = require('./utils');

// Column headers for each sheet — order must match the append row order below.

const OPPORTUNITIES_HEADERS = [
  'id', 'source', 'title', 'org', 'url', 'deadline', 'budget',
  'score', 'confidence', 'surface_reason', 'description',
  'contact_name', 'contact_title', 'contact_email', 'contact_linkedin',
  'application_type', 'application_notes',
  'status', 'date_surfaced', 'draft_doc_link',
];

const LEADS_HEADERS = [
  'id', 'org', 'funder', 'funding_amount', 'funding_date', 'mission_summary',
  'score', 'confidence', 'surface_reason',
  'contact_name', 'contact_title', 'contact_email', 'contact_linkedin',
  'status', 'date_surfaced', 'draft_doc_link',
];

const CORRECTIONS_HEADERS = [
  'id', 'item_id', 'item_type', 'title', 'org', 'source', 'filter_reason', 'feedback', 'date',
];

const SHEET_HEADERS = {
  'Opportunities': OPPORTUNITIES_HEADERS,
  'Leads': LEADS_HEADERS,
  'Corrections Log': CORRECTIONS_HEADERS,
};

/**
 * Ensures row 1 of the given sheet contains the expected header row.
 * Writes headers if row 1 is empty or does not start with the correct first header.
 * Safe to call repeatedly — it is a no-op when headers are already present.
 *
 * @param {'Opportunities'|'Leads'|'Corrections Log'} sheetName
 */
async function initializeHeaders(sheetName) {
  const headers = SHEET_HEADERS[sheetName];
  if (!headers) {
    throw new Error(`Unknown sheet name: ${sheetName}`);
  }

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:${columnLetter(headers.length - 1)}1`,
  });

  const existingRow = (res.data.values || [])[0] || [];

  // Headers are present when the first cell matches the expected first header
  if (existingRow[0] === headers[0]) {
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
}

/**
 * Ensures all three sheets (Opportunities, Leads, Corrections Log) have their
 * header rows written.  Call once before any append or read operations on a
 * freshly-created spreadsheet.
 */
async function initializeAllHeaders() {
  await Promise.all(Object.keys(SHEET_HEADERS).map((name) => initializeHeaders(name)));
}

/**
 * Appends a single opportunity row to the Opportunities sheet.
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
 * @param {string} [opportunity.surface_reason]     One-line reason surfaced by scorer
 * @param {string} [opportunity.description]        Truncated opportunity description
 * @param {string} opportunity.contact_name
 * @param {string} opportunity.contact_title
 * @param {string} opportunity.contact_email
 * @param {string} opportunity.contact_linkedin
 * @param {string} opportunity.application_type
 * @param {string} opportunity.application_notes
 * @param {string} [opportunity.status='pending']   'pending' | 'approved' | 'skipped' | 'sent'
 * @param {string} [opportunity.date_surfaced]      ISO timestamp; defaults to now
 * @param {string} [opportunity.draft_doc_link]
 */
async function appendOpportunity(opportunity) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const row = [
    opportunity.id ?? '',
    opportunity.source ?? '',
    opportunity.title ?? '',
    opportunity.org ?? '',
    opportunity.url ?? '',
    opportunity.deadline ?? '',
    opportunity.budget ?? '',
    opportunity.score ?? '',
    opportunity.confidence ?? '',
    opportunity.surface_reason ?? '',
    opportunity.description ?? '',
    opportunity.contact_name ?? '',
    opportunity.contact_title ?? '',
    opportunity.contact_email ?? '',
    opportunity.contact_linkedin ?? '',
    opportunity.application_type ?? '',
    opportunity.application_notes ?? '',
    opportunity.status ?? 'pending',
    opportunity.date_surfaced ?? new Date().toISOString(),
    opportunity.draft_doc_link ?? '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Opportunities!A:T',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/**
 * Appends a single lead row to the Leads sheet.
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
 * @param {string} [lead.surface_reason]            One-line reason surfaced by scorer
 * @param {string} lead.contact_name
 * @param {string} lead.contact_title
 * @param {string} lead.contact_email
 * @param {string} lead.contact_linkedin
 * @param {string} [lead.status='pending']          'pending' | 'approved' | 'skipped' | 'sent'
 * @param {string} [lead.date_surfaced]             ISO timestamp; defaults to now
 * @param {string} [lead.draft_doc_link]
 */
async function appendLead(lead) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const row = [
    lead.id ?? '',
    lead.org ?? '',
    lead.funder ?? '',
    lead.funding_amount ?? '',
    lead.funding_date ?? '',
    lead.mission_summary ?? '',
    lead.score ?? '',
    lead.confidence ?? '',
    lead.surface_reason ?? '',
    lead.contact_name ?? '',
    lead.contact_title ?? '',
    lead.contact_email ?? '',
    lead.contact_linkedin ?? '',
    lead.status ?? 'pending',
    lead.date_surfaced ?? new Date().toISOString(),
    lead.draft_doc_link ?? '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Leads!A:P',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/**
 * Appends a single row to the Corrections Log sheet.
 *
 * @param {object} correction
 * @param {string} correction.id
 * @param {string} correction.item_id
 * @param {string} correction.item_type             'opportunity' | 'lead'
 * @param {string} [correction.title]               Title of the filtered item
 * @param {string} [correction.org]                 Org name of the filtered item
 * @param {string} [correction.source]              Source of the filtered item
 * @param {string} correction.filter_reason         Plain-English reason the item was filtered
 * @param {string} correction.feedback              'good_filter' | 'bad_filter'
 * @param {string} [correction.date]                ISO timestamp; defaults to now
 */
async function appendCorrection(correction) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const row = [
    correction.id ?? '',
    correction.item_id ?? '',
    correction.item_type ?? '',
    correction.title ?? '',
    correction.org ?? '',
    correction.source ?? '',
    correction.filter_reason ?? '',
    correction.feedback ?? '',
    correction.date ?? new Date().toISOString(),
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Corrections Log!A:I',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/**
 * Updates the status of an existing row by finding the row with the given id.
 * Scans column A for the id, then updates the status column in place.
 *
 * @param {'Opportunities'|'Leads'} sheetName
 * @param {string} id
 * @param {string} status  'pending' | 'approved' | 'skipped' | 'sent'
 */
async function updateStatus(sheetName, id, status) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const headers = sheetName === 'Opportunities' ? OPPORTUNITIES_HEADERS : LEADS_HEADERS;
  const statusCol = headers.indexOf('status');
  if (statusCol === -1) {
    throw new Error(`No status column found in sheet: ${sheetName}`);
  }

  // Read column A (ids) to find the row number
  const idRange = `${sheetName}!A:A`;
  const idRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: idRange });
  const ids = (idRes.data.values || []).flat();
  const rowIndex = ids.indexOf(id);

  if (rowIndex === -1) {
    throw new Error(`Row with id "${id}" not found in sheet: ${sheetName}`);
  }

  // Sheets rows are 1-indexed; rowIndex 0 is the header row
  const rowNumber = rowIndex + 1;
  const colLetter = columnLetter(statusCol);
  const cellRange = `${sheetName}!${colLetter}${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cellRange,
    valueInputOption: 'RAW',
    requestBody: { values: [[status]] },
  });
}

module.exports = {
  appendOpportunity,
  appendLead,
  appendCorrection,
  updateStatus,
  initializeHeaders,
  initializeAllHeaders,
  OPPORTUNITIES_HEADERS,
  LEADS_HEADERS,
  CORRECTIONS_HEADERS,
};
