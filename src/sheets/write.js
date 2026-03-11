'use strict';

const { getSheetsClient, getSpreadsheetId } = require('./client');
const { columnLetter } = require('./utils');

// Column headers for each sheet — order must match the append row order below.

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
 * @param {string} [opportunity.draft_text]        Editable draft proposal text
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
    opportunity.draft_text ?? '',
    opportunity.draft_doc_link ?? '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Opportunities!A:U',
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
 * @param {string} [lead.draft_text]                Editable draft outreach text
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
    lead.draft_text ?? '',
    lead.draft_doc_link ?? '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Leads!A:Q',
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
 * Updates the feedback field of an existing Corrections Log row.
 * Finds the most recent row with the given id whose feedback is empty;
 * falls back to the most recent row with that id if all are already reviewed.
 * Throws a descriptive error if no row with the given id exists.
 *
 * @param {string} id       The correction row id (e.g. 'corr-abc12345')
 * @param {string} feedback 'good_filter' | 'bad_filter'
 */
async function updateCorrectionFeedback(id, feedback) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const feedbackCol = CORRECTIONS_HEADERS.indexOf('feedback');
  if (feedbackCol === -1) {
    throw new Error('feedback column not found in CORRECTIONS_HEADERS');
  }

  // Read columns A through feedback to check both id and existing feedback value.
  const feedbackColLetter = columnLetter(feedbackCol);
  const rangeRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Corrections Log!A:${feedbackColLetter}`,
  });
  const rows = rangeRes.data.values || [];

  // Scan from bottom (most recent) to find: first, a row with matching id and
  // empty feedback; fall back to first row with matching id (any feedback).
  let bestEmptyRowIndex = -1;
  let bestAnyRowIndex = -1;

  for (let i = rows.length - 1; i >= 1; i--) { // skip header at index 0
    const rowId = (rows[i] || [])[0];
    if (rowId !== id) continue;

    if (bestAnyRowIndex === -1) bestAnyRowIndex = i;

    const existingFeedback = (rows[i] || [])[feedbackCol];
    if (!existingFeedback && bestEmptyRowIndex === -1) {
      bestEmptyRowIndex = i;
      break; // found the most recent unreviewed match — stop scanning
    }
  }

  const targetRowIndex = bestEmptyRowIndex !== -1 ? bestEmptyRowIndex : bestAnyRowIndex;

  if (targetRowIndex === -1) {
    throw new Error(`Row with id "${id}" not found in Corrections Log`);
  }

  // Sheets rows are 1-indexed; index 0 is the header row
  const rowNumber = targetRowIndex + 1;
  const colLetter = feedbackColLetter;
  const cellRange = `Corrections Log!${colLetter}${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cellRange,
    valueInputOption: 'RAW',
    requestBody: { values: [[feedback]] },
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

/**
 * Updates the draft_text of an existing row by finding the row with the given id.
 * Scans column A for the id, then updates the draft_text column in place.
 *
 * @param {'Opportunities'|'Leads'} sheetName
 * @param {string} id
 * @param {string} draftText  New draft text content
 */
async function updateDraftText(sheetName, id, draftText) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const headers = sheetName === 'Opportunities' ? OPPORTUNITIES_HEADERS : LEADS_HEADERS;
  const draftCol = headers.indexOf('draft_text');
  if (draftCol === -1) {
    throw new Error(`No draft_text column found in sheet: ${sheetName}`);
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
  const colLetter = columnLetter(draftCol);
  const cellRange = `${sheetName}!${colLetter}${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cellRange,
    valueInputOption: 'RAW',
    requestBody: { values: [[draftText]] },
  });
}

/**
 * Updates the draft_doc_link of an existing row by finding the row with the given id.
 * Scans column A for the id, then updates the draft_doc_link column in place.
 *
 * @param {'Opportunities'|'Leads'} sheetName
 * @param {string} id
 * @param {string} docLink  Google Docs URL for the exported draft
 */
async function updateDraftDocLink(sheetName, id, docLink) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const headers = sheetName === 'Opportunities' ? OPPORTUNITIES_HEADERS : LEADS_HEADERS;
  const docLinkCol = headers.indexOf('draft_doc_link');
  if (docLinkCol === -1) {
    throw new Error(`No draft_doc_link column found in sheet: ${sheetName}`);
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
  const colLetter = columnLetter(docLinkCol);
  const cellRange = `${sheetName}!${colLetter}${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cellRange,
    valueInputOption: 'RAW',
    requestBody: { values: [[docLink]] },
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
