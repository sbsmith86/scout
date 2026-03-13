#!/usr/bin/env node
'use strict';

/**
 * Manual smoke-test for the RFPDB.com source plugin.
 *
 * Calls the plugin's fetch() function against a minimal stub profile and
 * prints a summary of what it returns.  No network mocking — this hits the
 * live rfpdb.com site so it requires an internet connection.
 *
 * Run from the repo root:
 *
 *   node scripts/test-rfpdb-plugin.js
 *
 * Options (env vars):
 *   RFPDB_REQUEST_DELAY_MS — override the inter-page delay (default: 2000)
 */

const path = require('path');
const rfpdb = require(path.resolve(__dirname, '../src/sources/rfpdb'));

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  • ${msg}`); }

// ── Schema validator ─────────────────────────────────────────────────────────

const REQUIRED_STRING_FIELDS = ['id', 'source', 'title', 'org', 'url', 'description'];
const OPTIONAL_NULLABLE_FIELDS = ['deadline', 'budget'];
const REQUIRED_LITERAL_FIELDS = { source: 'rfpdb', type: 'contract' };

function validateOpportunity(opp, index) {
  let ok = true;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof opp[field] !== 'string' || opp[field].length === 0) {
      fail(`[${index}] "${field}" must be a non-empty string (got: ${JSON.stringify(opp[field])})`);
      ok = false;
    }
  }

  for (const field of OPTIONAL_NULLABLE_FIELDS) {
    if (opp[field] !== null && typeof opp[field] !== 'string') {
      fail(`[${index}] "${field}" must be a string or null (got: ${JSON.stringify(opp[field])})`);
      ok = false;
    }
    if (field === 'deadline' && opp[field] !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(opp[field])) {
        fail(`[${index}] "deadline" is not ISO date format: ${opp[field]}`);
        ok = false;
      }
    }
  }

  for (const [field, expected] of Object.entries(REQUIRED_LITERAL_FIELDS)) {
    if (opp[field] !== expected) {
      fail(`[${index}] "${field}" must be "${expected}" (got: ${JSON.stringify(opp[field])})`);
      ok = false;
    }
  }

  if (!opp.id.startsWith('rfpdb-')) {
    fail(`[${index}] "id" must start with "rfpdb-" (got: ${opp.id})`);
    ok = false;
  }

  if (!opp.url.startsWith('http')) {
    fail(`[${index}] "url" must be an absolute URL (got: ${opp.url})`);
    ok = false;
  }

  try {
    new URL(opp.url); // eslint-disable-line no-new
  } catch {
    fail(`[${index}] "url" is not a valid URL (got: ${opp.url})`);
    ok = false;
  }

  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n── Scout × RFPDB.com plugin smoke-test ──\n');

  // ── 1. Plugin shape ─────────────────────────────────────────────────────────
  console.log('1. Checking plugin export shape…');
  if (rfpdb.id !== 'rfpdb') fail(`id should be "rfpdb" (got ${rfpdb.id})`);
  else pass(`id: "${rfpdb.id}"`);

  if (typeof rfpdb.name !== 'string' || rfpdb.name.length === 0) fail('name must be a non-empty string');
  else pass(`name: "${rfpdb.name}"`);

  if (rfpdb.type !== 'scrape') fail(`type should be "scrape" (got ${rfpdb.type})`);
  else pass(`type: "${rfpdb.type}"`);

  if (typeof rfpdb.fetch !== 'function') fail('fetch must be a function');
  else pass('fetch is a function');

  if (process.exitCode === 1) {
    console.error('\nPlugin shape invalid — aborting.\n');
    return;
  }

  // ── 2. Live fetch ────────────────────────────────────────────────────────────
  console.log('\n2. Calling fetch() against live rfpdb.com…');
  console.log('   (This makes real HTTP requests — may take 30–60 seconds)\n');

  let results;
  try {
    results = await rfpdb.fetch({});
  } catch (err) {
    fail(`fetch() threw unexpectedly: ${err.message}`);
    console.error('\nSomething went wrong with the live fetch — see error above.\n');
    return;
  }

  if (!Array.isArray(results)) {
    fail(`fetch() must return an array (got ${typeof results})`);
    return;
  }

  pass(`fetch() returned ${results.length} opportunity/ies`);

  // ── 3. Schema validation ─────────────────────────────────────────────────────
  if (results.length === 0) {
    info('Zero results returned — schema validation skipped.');
    info('Possible causes: site structure changed, selectors need updating,');
    info('or there is a network issue. Verify https://www.rfpdb.com/view/category/name/technology is reachable.');
  } else {
    console.log(`\n3. Validating schema for all ${results.length} returned items…`);
    let validCount = 0;
    for (let i = 0; i < results.length; i++) {
      if (validateOpportunity(results[i], i)) validCount++;
    }
    pass(`${validCount}/${results.length} items pass schema validation`);

    // Print a sample card.
    console.log('\n── Sample opportunity (first result) ──');
    const s = results[0];
    console.log(`  id:          ${s.id}`);
    console.log(`  title:       ${s.title}`);
    console.log(`  org:         ${s.org}`);
    console.log(`  url:         ${s.url}`);
    console.log(`  deadline:    ${s.deadline}`);
    console.log(`  budget:      ${s.budget}`);
    console.log(`  description: ${(s.description || '').slice(0, 120)}…`);
  }

  // ── Result ───────────────────────────────────────────────────────────────────
  console.log();
  if (process.exitCode === 1) {
    console.error('RFPDB plugin test FAILED — see ✗ items above.\n');
  } else {
    console.log('RFPDB plugin test PASSED.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
