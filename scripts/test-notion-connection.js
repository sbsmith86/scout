#!/usr/bin/env node
'use strict';

/**
 * Connection test for the Notion storage layer.
 *
 * Verifies that all required env vars are set, the Notion API key is valid,
 * and all three databases are reachable and writable.
 *
 * Writes one test page to each database, reads it back, then archives it.
 * Run from the repo root once credentials are configured:
 *
 *   node scripts/test-notion-connection.js
 *
 * Required env vars:
 *   NOTION_API_KEY
 *   NOTION_OPPORTUNITIES_DB_ID
 *   NOTION_LEADS_DB_ID
 *   NOTION_CORRECTIONS_DB_ID
 *
 * Loads .env automatically via dotenv.
 */

require('dotenv').config();

let notionModule;
try {
  notionModule = require('../src/notion/client');
} catch (err) {
  console.error(`\n✗ Failed to load src/notion/client.js: ${err.message}\n`);
  console.error('Make sure all required env vars are set in .env:\n');
  console.error('  NOTION_API_KEY');
  console.error('  NOTION_OPPORTUNITIES_DB_ID');
  console.error('  NOTION_LEADS_DB_ID');
  console.error('  NOTION_CORRECTIONS_DB_ID\n');
  process.exit(1);
}

const { notion, OPPORTUNITIES_DB_ID, LEADS_DB_ID, CORRECTIONS_DB_ID, checkConnection } = notionModule;
const { appendOpportunity, appendLead, appendCorrection } = require('../src/notion/write');
const { readOpportunities, readLeads, readCorrections } = require('../src/notion/read');

const TEST_ID_OPP         = `test-opp-${Date.now()}`;
const TEST_ID_LEAD        = `test-lead-${Date.now()}`;
const TEST_ID_CORRECTION  = `test-correction-${Date.now()}`;

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }

/**
 * Archives (soft-deletes) a Notion page by its page ID.
 */
async function archivePage(pageId) {
  await notion.pages.update({ page_id: pageId, archived: true });
}

/**
 * Finds the first page in a database where the 'Name' title property
 * equals the given value.  Returns null if not found.
 */
async function findPageById(databaseId, id) {
  const res = await notion.databases.query({
    database_id: databaseId,
    filter: { property: 'Name', title: { equals: id } },
    page_size: 1,
  });
  return res.results[0] ?? null;
}

async function run() {
  console.log('\n── Scout × Notion connection test ──\n');

  // ── 1. Connectivity check ───────────────────────────────────────────────────
  console.log('1. Checking API key…');
  const conn = await checkConnection();
  if (conn.ok) {
    pass('checkConnection() → API key is valid');
  } else {
    fail(`checkConnection() failed: ${conn.error}`);
    process.exit(1);
  }

  // ── 2. Verify databases are reachable ───────────────────────────────────────
  console.log('\n2. Verifying database access…');
  for (const [label, dbId] of [
    ['Opportunities', OPPORTUNITIES_DB_ID],
    ['Leads', LEADS_DB_ID],
    ['Corrections Log', CORRECTIONS_DB_ID],
  ]) {
    try {
      const db = await notion.databases.retrieve({ database_id: dbId });
      pass(`${label} database reachable: "${db.title.map((t) => t.plain_text).join('')}"`);
    } catch (err) {
      fail(`${label} database (${dbId}) not reachable: ${err.message}`);
    }
  }

  if (process.exitCode === 1) {
    console.error('\nDatabase check failed — fix the above before continuing.\n');
    process.exit(1);
  }

  // ── 3. Write test pages ─────────────────────────────────────────────────────
  console.log('\n3. Writing test pages…');

  try {
    await appendOpportunity({
      id: TEST_ID_OPP,
      source: 'Idealist',
      title: 'Connection test opportunity',
      org: 'Scout Test Org',
      url: 'https://example.com',
      score: 15,
      confidence: 'High',
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
      confidence: 'High',
    });
    pass(`appendLead() → id: ${TEST_ID_LEAD}`);
  } catch (err) {
    fail(`appendLead() threw: ${err.message}`);
  }

  try {
    await appendCorrection({
      id: TEST_ID_CORRECTION,
      item_id: TEST_ID_OPP,
      item_type: 'Opportunity',
      filter_reason: 'Connection test correction entry',
      feedback: 'Good_filter',
    });
    pass(`appendCorrection() → id: ${TEST_ID_CORRECTION}`);
  } catch (err) {
    fail(`appendCorrection() threw: ${err.message}`);
  }

  // ── 4. Read back and verify ─────────────────────────────────────────────────
  console.log('\n4. Reading back and verifying…');

  try {
    const opps = await readOpportunities();
    const found = opps.find((o) => o['Name'] === TEST_ID_OPP);
    if (found) {
      pass(`readOpportunities() found test page — status: "${found['Status']}"`);
    } else {
      fail('readOpportunities() did not return the test page');
    }
  } catch (err) {
    fail(`readOpportunities() threw: ${err.message}`);
  }

  try {
    const leads = await readLeads();
    const found = leads.find((l) => l['Name'] === TEST_ID_LEAD);
    if (found) {
      pass(`readLeads() found test page — status: "${found['Status']}"`);
    } else {
      fail('readLeads() did not return the test page');
    }
  } catch (err) {
    fail(`readLeads() threw: ${err.message}`);
  }

  try {
    const corrections = await readCorrections();
    const found = corrections.find((c) => c['Name'] === TEST_ID_CORRECTION);
    if (found) {
      pass(`readCorrections() found test page — feedback: "${found['Feedback']}"`);
    } else {
      fail('readCorrections() did not return the test page');
    }
  } catch (err) {
    fail(`readCorrections() threw: ${err.message}`);
  }

  // ── 5. Cleanup ──────────────────────────────────────────────────────────────
  console.log('\n5. Cleaning up test pages (archiving)…');

  for (const [label, dbId, testId] of [
    ['Opportunities', OPPORTUNITIES_DB_ID, TEST_ID_OPP],
    ['Leads', LEADS_DB_ID, TEST_ID_LEAD],
    ['Corrections Log', CORRECTIONS_DB_ID, TEST_ID_CORRECTION],
  ]) {
    try {
      const page = await findPageById(dbId, testId);
      if (page) {
        await archivePage(page.id);
        pass(`Archived test page from ${label}`);
      } else {
        console.log(`  ⚠ Test page not found in ${label} — may not have been created`);
      }
    } catch (err) {
      console.log(`  ⚠ Could not archive test page from ${label}: ${err.message}`);
    }
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  console.log();
  if (process.exitCode === 1) {
    console.error('Connection test FAILED — see ✗ items above.\n');
  } else {
    console.log('Connection test PASSED — all databases readable and writable.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
