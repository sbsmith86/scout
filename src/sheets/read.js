'use strict';

const { getSheetsClient, getSpreadsheetId } = require('./client');
const { OPPORTUNITIES_HEADERS, LEADS_HEADERS, CORRECTIONS_HEADERS } = require('./write');
const { columnLetter } = require('./utils');

/**
 * Reads all rows from a sheet and returns an array of plain objects keyed by
 * the header row.  The first row is always treated as headers.
 *
 * @param {string} sheetName
 * @param {string[]} headers  Expected column names in order
 * @returns {Promise<object[]>}
 */
async function readSheet(sheetName, headers) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:${columnLetter(headers.length - 1)}`,
  });

  const rows = res.data.values || [];

  // Skip the header row (row index 0)
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? '';
    });
    return obj;
  });
}

/**
 * Returns all opportunities from the Opportunities sheet.
 * Optionally filter by status.
 *
 * @param {string|null} [status=null]  Filter by status, or null for all rows
 * @returns {Promise<object[]>}
 */
async function readOpportunities(status = null) {
  const rows = await readSheet('Opportunities', OPPORTUNITIES_HEADERS);
  if (status) {
    return rows.filter((r) => r.status === status);
  }
  return rows;
}

/**
 * Returns all leads from the Leads sheet.
 * Optionally filter by status.
 *
 * @param {string|null} [status=null]  Filter by status, or null for all rows
 * @returns {Promise<object[]>}
 */
async function readLeads(status = null) {
  const rows = await readSheet('Leads', LEADS_HEADERS);
  if (status) {
    return rows.filter((r) => r.status === status);
  }
  return rows;
}

/**
 * Returns all rows from the Corrections Log sheet.
 * Optionally filter by feedback type.
 *
 * @param {string|null} [feedback=null]  'good_filter' | 'bad_filter' | null for all
 * @returns {Promise<object[]>}
 */
async function readCorrections(feedback = null) {
  const rows = await readSheet('Corrections Log', CORRECTIONS_HEADERS);
  if (feedback) {
    return rows.filter((r) => r.feedback === feedback);
  }
  return rows;
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
