'use strict';

// Notion storage layer — drop-in replacement for src/sheets/index.js for all
// read/write functions used by pipeline.js and the dashboard.  Client-level
// exports intentionally differ (notion/DB ID constants vs. getSheetsClient etc.)
// since the two backends have different connection models.

const { notion, OPPORTUNITIES_DB_ID, LEADS_DB_ID, CORRECTIONS_DB_ID, checkConnection } = require('./client');
const {
  appendOpportunity,
  appendLead,
  appendCorrection,
  updateCorrectionFeedback,
  updateStatus,
  updateDraftText,
  updateDraftDocLink,
  initializeHeaders,
  initializeAllHeaders,
} = require('./write');
const { readOpportunities, readLeads, readCorrections, readPendingForDashboard } = require('./read');

module.exports = {
  // Client
  notion,
  OPPORTUNITIES_DB_ID,
  LEADS_DB_ID,
  CORRECTIONS_DB_ID,
  checkConnection,
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
