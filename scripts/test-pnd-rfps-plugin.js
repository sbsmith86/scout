#!/usr/bin/env node
'use strict';

/**
 * Manual smoke-test for the PND RFPs source plugin.
 *
 * Calls the plugin's fetch() function against a minimal stub profile and
 * prints a summary of what it returns.  No network mocking — this hits the
 * live philanthropynewsdigest.org site so it requires an internet connection.
 *
 * Run from the repo root:
 *
 *   node scripts/test-pnd-rfps-plugin.js
 *
 * Options (env vars):
 *   PND_RFPS_REQUEST_DELAY_MS — override the inter-page delay (default: 2000)
 */

const path = require('path');
const pndRfps = require(path.resolve(__dirname, '../src/sources/pnd-rfps'));

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  • ${msg}`); }

// ── Schema validator ─────────────────────────────────────────────────────────

const REQUIRED_STRING_FIELDS = ['id', 'source', 'title', 'org', 'url', 'description'];
const OPTIONAL_NULLABLE_FIELDS = ['deadline', 'budget'];
const REQUIRED_LITERAL_FIELDS = { source: 'pnd-rfps', type: 'contract' };

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
    // If a deadline is present it should look like an ISO date (YYYY-MM-DD).
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

  if (!opp.id.startsWith('pnd-rfps-')) {
    fail(`[${index}] "id" must start with "pnd-rfps-" (got: ${opp.id})`);
    ok = false;
  }

  if (!opp.url.startsWith('http')) {
    fail(`[${index}] "url" must be an absolute URL (got: ${opp.url})`);
    ok = false;
  }

  try {
    const parsed = new URL(opp.url);
    if (!parsed.pathname.startsWith('/rfps/')) {
      fail(`[${index}] "url" path must start with /rfps/ (got: ${opp.url})`);
      ok = false;
    }
  } catch {
    fail(`[${index}] "url" is not a valid URL (got: ${opp.url})`);
    ok = false;
  }

  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n── Scout × PND RFPs plugin smoke-test ──\n');

  // ── 1. Plugin shape ─────────────────────────────────────────────────────────
  console.log('1. Checking plugin export shape…');
  if (pndRfps.id !== 'pnd-rfps') fail(`id should be "pnd-rfps" (got ${pndRfps.id})`);
  else pass(`id: "${pndRfps.id}"`);

  if (pndRfps.name !== 'PND RFPs (Candid)') fail(`name should be "PND RFPs (Candid)" (got ${pndRfps.name})`);
  else pass(`name: "${pndRfps.name}"`);

  if (pndRfps.type !== 'scrape') fail(`type should be "scrape" (got ${pndRfps.type})`);
  else pass(`type: "${pndRfps.type}"`);

  if (typeof pndRfps.fetch !== 'function') fail('fetch must be a function');
  else pass('fetch is a function');

  if (process.exitCode === 1) {
    console.error('\nPlugin shape invalid — aborting.\n');
    return;
  }

  // ── 2. Live fetch ────────────────────────────────────────────────────────────
  console.log('\n2. Calling fetch() against live philanthropynewsdigest.org…');
  console.log('   (This makes real HTTP requests — may take 10–30 seconds)\n');

  let results;
  try {
    results = await pndRfps.fetch({});
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
    info('or there is a network issue. Verify philanthropynewsdigest.org/rfps is reachable.');
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
    console.error('PND RFPs plugin test FAILED — see ✗ items above.\n');
  } else {
    console.log('PND RFPs plugin test PASSED.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
