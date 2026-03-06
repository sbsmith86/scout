'use strict';

// Google Sheets read/write helpers.
// See CLAUDE.md for the three-sheet data schema (Opportunities, Leads, Corrections Log).

const { getSheetsClient, getSpreadsheetId } = require('./client');
const { appendOpportunity, appendLead, appendCorrection, updateStatus } = require('./write');
const { readOpportunities, readLeads, readCorrections, readPendingForDashboard } = require('./read');

module.exports = {
  // Client
  getSheetsClient,
  getSpreadsheetId,
  // Write
  appendOpportunity,
  appendLead,
  appendCorrection,
  updateStatus,
  // Read
  readOpportunities,
  readLeads,
  readCorrections,
  readPendingForDashboard,
};
