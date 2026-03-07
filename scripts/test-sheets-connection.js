#!/usr/bin/env node
'use strict';

/**
 * Connection test for the Google Sheets storage layer.
 *
 * Writes one test row to each sheet, reads it back, then removes it.
 * Run from the repo root once credentials are configured:
 *
 *   node scripts/test-sheets-connection.js
 *
 * Required env vars (at least one auth option must be set):
 *   GOOGLE_SHEETS_ID
 *
 *   Option 1 — key file (local dev):
 *     GOOGLE_SERVICE_ACCOUNT_KEY_PATH
 *
 *   Option 2 — individual env vars (Codespaces):
 *     GOOGLE_SERVICE_ACCOUNT_EMAIL
 *     GOOGLE_PRIVATE_KEY
 *
 * Loads .env automatically via a lightweight inline parser (no dotenv dependency).
 */

const fs = require('fs');
const path = require('path');

// ── Inline .env loader ────────────────────────────────────────────────────────
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

const { getSheetsClient, getSpreadsheetId } = require('../src/sheets/client');
const { appendOpportunity, appendLead, appendCorrection, initializeAllHeaders } = require('../src/sheets/write');
const { readOpportunities, readLeads, readCorrections } = require('../src/sheets/read');

const TEST_ID_OPP = `test-opp-${Date.now()}`;
const TEST_ID_LEAD = `test-lead-${Date.now()}`;
const TEST_ID_CORRECTION = `test-correction-${Date.now()}`;

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }

async function deleteTestRow(sheets, spreadsheetId, sheetName, testId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:A`,
  });
  const ids = (res.data.values || []).flat();
  const rowIndex = ids.indexOf(testId);
  if (rowIndex === -1) return;

  // Get sheet id for batchUpdate
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );
  if (!sheet) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    },
  });
}

async function run() {
  console.log('\n── Scout × Google Sheets connection test ──\n');

  // ── 1. Auth check ───────────────────────────────────────────────────────────
  console.log('1. Checking credentials…');
  let sheets;
  try {
    sheets = await getSheetsClient();
    pass('getSheetsClient() returned a client');
  } catch (err) {
    fail(`getSheetsClient() threw: ${err.message}`);
    process.exit(1);
  }

  let spreadsheetId;
  try {
    spreadsheetId = getSpreadsheetId();
    pass(`getSpreadsheetId() → ${spreadsheetId}`);
  } catch (err) {
    fail(`getSpreadsheetId() threw: ${err.message}`);
    process.exit(1);
  }

  // ── 2. Verify spreadsheet is reachable ──────────────────────────────────────
  console.log('\n2. Verifying spreadsheet access…');
  let sheetMeta;
  try {
    sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = sheetMeta.data.sheets.map((s) => s.properties.title);
    pass(`Spreadsheet reachable: "${sheetMeta.data.properties.title}"`);
    pass(`Tabs found: ${sheetNames.join(', ')}`);

    const required = ['Opportunities', 'Leads', 'Corrections Log'];
    for (const name of required) {
      if (sheetNames.includes(name)) {
        pass(`  Tab exists: ${name}`);
      } else {
        fail(`  Tab missing: ${name} — create it in the Google Sheet`);
      }
    }
  } catch (err) {
    fail(`Could not read spreadsheet metadata: ${err.message}`);
    process.exit(1);
  }

  // ── 3. Initialize header rows ───────────────────────────────────────────────
  console.log('\n3. Initializing header rows…');
  try {
    await initializeAllHeaders();
    pass('initializeAllHeaders() completed — all three sheets have headers');
  } catch (err) {
    fail(`initializeAllHeaders() threw: ${err.message}`);
    process.exit(1);
  }

  // ── 4. Write test rows ──────────────────────────────────────────────────────
  console.log('\n4. Writing test rows…');
  try {
    await appendOpportunity({
      id: TEST_ID_OPP,
      source: 'test',
      title: 'Connection test opportunity',
      org: 'Scout Test Org',
      url: 'https://example.com',
      score: 15,
      confidence: 'high',
    });
    pass(`appendOpportunity() → id: ${TEST_ID_OPP}`);
  } catch (err) {
    fail(`appendOpportunity() threw: ${err.message}`);
  }

  try {
    await appendLead({
      id: TEST_ID_LEAD,
      org: 'Scout Test Org',
      funder: 'Test Foundation',
      funding_amount: '$500k',
      funding_date: new Date().toISOString().slice(0, 10),
      mission_summary: 'Connection test lead',
      score: 14,
      confidence: 'medium',
    });
    pass(`appendLead() → id: ${TEST_ID_LEAD}`);
  } catch (err) {
    fail(`appendLead() threw: ${err.message}`);
  }

  try {
    await appendCorrection({
      id: TEST_ID_CORRECTION,
      item_id: TEST_ID_OPP,
      item_type: 'opportunity',
      filter_reason: 'Connection test correction entry',
      feedback: 'good_filter',
    });
    pass(`appendCorrection() → id: ${TEST_ID_CORRECTION}`);
  } catch (err) {
    fail(`appendCorrection() threw: ${err.message}`);
  }

  // ── 5. Read back and verify ─────────────────────────────────────────────────
  console.log('\n5. Reading back and verifying…');
  try {
    const opps = await readOpportunities();
    const found = opps.find((o) => o.id === TEST_ID_OPP);
    if (found) {
      pass(`readOpportunities() found test row — status: "${found.status}"`);
    } else {
      fail(`readOpportunities() did not return the test row`);
    }
  } catch (err) {
    fail(`readOpportunities() threw: ${err.message}`);
  }

  try {
    const leads = await readLeads();
    const found = leads.find((l) => l.id === TEST_ID_LEAD);
    if (found) {
      pass(`readLeads() found test row — status: "${found.status}"`);
    } else {
      fail(`readLeads() did not return the test row`);
    }
  } catch (err) {
    fail(`readLeads() threw: ${err.message}`);
  }

  try {
    const corrections = await readCorrections();
    const found = corrections.find((c) => c.id === TEST_ID_CORRECTION);
    if (found) {
      pass(`readCorrections() found test row — feedback: "${found.feedback}"`);
    } else {
      fail(`readCorrections() did not return the test row`);
    }
  } catch (err) {
    fail(`readCorrections() threw: ${err.message}`);
  }

  // ── 6. Cleanup ──────────────────────────────────────────────────────────────
  console.log('\n6. Cleaning up test rows…');
  for (const [sheetName, testId] of [
    ['Opportunities', TEST_ID_OPP],
    ['Leads', TEST_ID_LEAD],
    ['Corrections Log', TEST_ID_CORRECTION],
  ]) {
    try {
      await deleteTestRow(sheets, spreadsheetId, sheetName, testId);
      pass(`Deleted test row from ${sheetName}`);
    } catch (err) {
      // Non-fatal — rows can be deleted manually if needed
      console.log(`  ⚠ Could not auto-delete test row from ${sheetName}: ${err.message}`);
    }
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  console.log();
  if (process.exitCode === 1) {
    console.error('Connection test FAILED — see ✗ items above.\n');
  } else {
    console.log('Connection test PASSED — all sheets readable and writable.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
