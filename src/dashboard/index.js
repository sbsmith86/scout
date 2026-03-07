'use strict';

/**
 * Scout dashboard — lightweight Express server.
 *
 * Routes:
 *   GET /                    Serves the single-page dashboard HTML
 *   GET /api/opportunities   Pending opportunities from Google Sheets
 *   GET /api/leads           Pending leads from Google Sheets
 *   GET /api/filtered        Filtered items from the Corrections Log
 *
 * Phase 1: read-only display.  Approve/Skip/Edit actions come in Phase 2.
 */

const express = require('express');
const { readOpportunities, readLeads, readCorrections } = require('../sheets');
const { renderPage } = require('./template');

const DEFAULT_PORT = process.env.PORT || 3000;

/**
 * Create and return the Express application without starting it.
 * Exported so tests can import the app without binding a port.
 *
 * @returns {import('express').Application}
 */
function createApp() {
  const app = express();

  // ── JSON API routes ────────────────────────────────────────────────────────

  app.get('/api/opportunities', async (_req, res) => {
    try {
      const rows = await readOpportunities('pending');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/leads', async (_req, res) => {
    try {
      const rows = await readLeads('pending');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/filtered', async (_req, res) => {
    try {
      const rows = await readCorrections();
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Dashboard HTML ─────────────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPage());
  });

  return app;
}

/**
 * Start the dashboard HTTP server.
 *
 * @param {number} [port]  Port to listen on (defaults to PORT env var or 3000).
 * @returns {import('http').Server}
 */
function startDashboard(port = DEFAULT_PORT) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`[dashboard] Scout dashboard running at http://localhost:${port}`);
  });
  return server;
}

module.exports = { createApp, startDashboard };

