'use strict';

/**
 * Scout dashboard — lightweight Express server.
 *
 * Routes:
 *   GET  /                           Serves the single-page dashboard HTML
 *   GET  /api/opportunities          Pending opportunities from Google Sheets
 *   GET  /api/opportunities/approved Approved opportunities from Google Sheets
 *   GET  /api/leads                  Pending leads from Google Sheets
 *   GET  /api/leads/approved         Approved leads from Google Sheets
 *   GET  /api/filtered               Unreviewed filtered items (empty feedback) from Corrections Log
 *   PATCH /api/opportunities/:id/status  Update opportunity status in Sheets
 *   PATCH /api/leads/:id/status          Update lead status in Sheets
 *   PATCH /api/opportunities/:id/draft   Update opportunity draft text in Sheets
 *   PATCH /api/leads/:id/draft           Update lead draft text in Sheets
 *   POST  /api/corrections               Append a new correction/feedback entry to Sheets
 *   PATCH /api/corrections/:id/feedback  Update feedback on an existing correction row
 */

const express = require('express');
const { randomUUID } = require('crypto');
const { readOpportunities, readLeads, readCorrections, updateStatus, updateDraftText, updateDraftDocLink, appendCorrection, updateCorrectionFeedback } = require('../sheets');
const { exportDraft } = require('../drafting');
const { renderPage } = require('./template');

const DEFAULT_PORT = process.env.PORT || 3000;

const VALID_STATUSES = new Set(['pending', 'approved', 'skipped', 'sent']);
const VALID_FEEDBACK = new Set(['good_filter', 'bad_filter']);

/**
 * Create and return the Express application without starting it.
 * Exported so tests can import the app without binding a port.
 *
 * @returns {import('express').Application}
 */
function createApp() {
  const app = express();

  app.use(express.json());

  // ── JSON API routes ────────────────────────────────────────────────────────

  app.get('/api/opportunities', async (_req, res) => {
    try {
      const rows = await readOpportunities('pending');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/opportunities/approved', async (_req, res) => {
    try {
      const rows = await readOpportunities('approved');
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

  app.get('/api/leads/approved', async (_req, res) => {
    try {
      const rows = await readLeads('approved');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/filtered', async (_req, res) => {
    try {
      const rows = await readCorrections();
      // Only return unreviewed items (empty feedback) so items that already have
      // feedback don't reappear after a page reload.
      res.json(rows.filter((r) => !r.feedback));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Status update endpoints ────────────────────────────────────────────────

  app.patch('/api/opportunities/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }
    try {
      await updateStatus('Opportunities', id, status);

      // On approval, create a Google Doc with the draft and write the link back.
      let draft_doc_link;
      if (status === 'approved') {
        const rows = await readOpportunities('approved');
        const item = rows.find((r) => r.id === id);
        if (item) {
          let docLink;
          try {
            docLink = await exportDraft(item, 'opportunity');
          } catch (exportErr) {
            console.error(`[dashboard] Google Docs export failed for opportunity ${id}: ${exportErr.message}`);
          }
          if (docLink) {
            try {
              await updateDraftDocLink('Opportunities', id, docLink);
              draft_doc_link = docLink;
            } catch (sheetsErr) {
              console.error(`[dashboard] Updating draft_doc_link in Sheets failed for opportunity ${id}: ${sheetsErr.message}`);
            }
          }
        }
      }

      res.json({ ok: true, id, status, ...(draft_doc_link ? { draft_doc_link } : {}) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/leads/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }
    try {
      await updateStatus('Leads', id, status);

      // On approval, create a Google Doc with the draft and write the link back.
      let draft_doc_link;
      if (status === 'approved') {
        const rows = await readLeads('approved');
        const item = rows.find((r) => r.id === id);
        if (item) {
          let docLink;
          try {
            docLink = await exportDraft(item, 'lead');
          } catch (exportErr) {
            console.error(`[dashboard] Google Docs export failed for lead ${id}: ${exportErr.message}`);
          }
          if (docLink) {
            try {
              await updateDraftDocLink('Leads', id, docLink);
              draft_doc_link = docLink;
            } catch (sheetsErr) {
              console.error(`[dashboard] Updating draft_doc_link in Sheets failed for lead ${id}: ${sheetsErr.message}`);
            }
          }
        }
      }

      res.json({ ok: true, id, status, ...(draft_doc_link ? { draft_doc_link } : {}) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Draft text update endpoints ────────────────────────────────────────────

  app.patch('/api/opportunities/:id/draft', async (req, res) => {
    const { id } = req.params;
    const { draft_text } = req.body || {};
    if (typeof draft_text !== 'string') {
      return res.status(400).json({ error: 'draft_text must be a string' });
    }
    try {
      await updateDraftText('Opportunities', id, draft_text);
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/leads/:id/draft', async (req, res) => {
    const { id } = req.params;
    const { draft_text } = req.body || {};
    if (typeof draft_text !== 'string') {
      return res.status(400).json({ error: 'draft_text must be a string' });
    }
    try {
      await updateDraftText('Leads', id, draft_text);
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Corrections (thumb feedback) endpoint ─────────────────────────────────

  app.post('/api/corrections', async (req, res) => {
    const { item_id, item_type, filter_reason, title, org, source, feedback } = req.body || {};
    if (!item_id || !feedback || !VALID_FEEDBACK.has(feedback)) {
      return res.status(400).json({ error: 'item_id and valid feedback (good_filter|bad_filter) are required' });
    }
    try {
      const id = `corr-${randomUUID()}`;
      await appendCorrection({ id, item_id, item_type: item_type || 'unknown', title, org, source, filter_reason, feedback });
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update feedback on an existing correction ──────────────────────────────

  app.patch('/api/corrections/:id/feedback', async (req, res) => {
    const { id } = req.params;
    const { feedback } = req.body || {};
    if (!feedback || !VALID_FEEDBACK.has(feedback)) {
      return res.status(400).json({ error: `Invalid feedback. Must be one of: ${[...VALID_FEEDBACK].join(', ')}` });
    }
    try {
      await updateCorrectionFeedback(id, feedback);
      res.json({ ok: true, id, feedback });
    } catch (err) {
      // A missing row is a client error; only use 500 for actual backend failures.
      if (err.message && err.message.toLowerCase().includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
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

