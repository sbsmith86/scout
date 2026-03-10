'use strict';

// Google Sheets read/write helpers.
// See CLAUDE.md for the three-sheet data schema (Opportunities, Leads, Corrections Log).

const { getSheetsClient, getDocsClient, getDriveClient, getSpreadsheetId } = require('./client');
const { appendOpportunity, appendLead, appendCorrection, updateCorrectionFeedback, updateStatus, updateDraftText, updateDraftDocLink, initializeHeaders, initializeAllHeaders } = require('./write');
const { readOpportunities, readLeads, readCorrections, readPendingForDashboard } = require('./read');

module.exports = {
  // Client
  getSheetsClient,
  getDocsClient,
  getDriveClient,
  getSpreadsheetId,
  // Write
  appendOpportunity,
  appendLead,
  appendCorrection,
  updateCorrectionFeedback,
  updateStatus,
  updateDraftText,
  updateDraftDocLink,
  initializeHeaders,
  initializeAllHeaders,
  // Read
  readOpportunities,
  readLeads,
  readCorrections,
  readPendingForDashboard,
};
