#!/usr/bin/env node
'use strict';

/**
 * Manual smoke-test for the ProPublica Nonprofit Explorer source plugin.
 *
 * Calls the plugin's fetch() function and validates the shape of returned
 * leads.  No network mocking — this hits the live ProPublica API so it
 * requires an internet connection.  No API key is needed (the API is public).
 *
 * Run from the repo root:
 *
 *   node scripts/test-propublica-plugin.js
 *
 * The script exits with code 1 if any schema assertion fails, 0 on success.
 */

const path = require('path');
const propublica = require(path.resolve(__dirname, '../src/sources/propublica'));
const { intervalElapsed } = require(path.resolve(__dirname, '../src/pipeline'));

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  • ${msg}`); }

// ── Schema validator ─────────────────────────────────────────────────────────

const REQUIRED_STRING_FIELDS = ['id', 'source', 'title', 'org', 'url', 'description'];
const OPTIONAL_NULLABLE_FIELDS = ['deadline', 'budget'];
const REQUIRED_LITERAL_FIELDS = { source: 'propublica', type: 'lead' };

function validateLead(lead, index) {
  let ok = true;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof lead[field] !== 'string' || lead[field].length === 0) {
      fail(`[${index}] "${field}" must be a non-empty string (got: ${JSON.stringify(lead[field])})`);
      ok = false;
    }
  }

  for (const field of OPTIONAL_NULLABLE_FIELDS) {
    if (lead[field] !== null && typeof lead[field] !== 'string') {
      fail(`[${index}] "${field}" must be a string or null (got: ${JSON.stringify(lead[field])})`);
      ok = false;
    }
  }

  for (const [field, expected] of Object.entries(REQUIRED_LITERAL_FIELDS)) {
    if (lead[field] !== expected) {
      fail(`[${index}] "${field}" must be "${expected}" (got: ${JSON.stringify(lead[field])})`);
      ok = false;
    }
  }

  if (!lead.id.startsWith('propublica-')) {
    fail(`[${index}] "id" must start with "propublica-" (got: ${lead.id})`);
    ok = false;
  }

  if (!lead.url.startsWith('https://projects.propublica.org/nonprofits/organizations/')) {
    fail(`[${index}] "url" must be a ProPublica org URL (got: ${lead.url})`);
    ok = false;
  }

  try {
    new URL(lead.url); // eslint-disable-line no-new
  } catch {
    fail(`[${index}] "url" is not a valid URL (got: ${lead.url})`);
    ok = false;
  }

  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n── Scout × ProPublica Nonprofit Explorer plugin smoke-test ──\n');

  // ── 1. Plugin shape ─────────────────────────────────────────────────────────
  console.log('1. Checking plugin export shape…');
  if (propublica.id !== 'propublica') fail(`id should be "propublica" (got ${propublica.id})`);
  else pass(`id: "${propublica.id}"`);

  if (typeof propublica.name !== 'string' || propublica.name.length === 0) fail('name must be a non-empty string');
  else pass(`name: "${propublica.name}"`);

  if (propublica.type !== 'api') fail(`type should be "api" (got ${propublica.type})`);
  else pass(`type: "${propublica.type}"`);

  if (propublica.interval !== 'monthly') fail(`interval should be "monthly" (got ${propublica.interval})`);
  else pass(`interval: "${propublica.interval}"`);

  if (typeof propublica.fetch !== 'function') fail('fetch must be a function');
  else pass('fetch is a function');

  if (process.exitCode === 1) {
    console.error('\nPlugin shape invalid — aborting.\n');
    return;
  }

  // ── 2. NTEE code resolution ─────────────────────────────────────────────────
  console.log('\n2. Checking NTEE code resolution…');

  const { resolveNteeCodes, SECTOR_TO_NTEE } = propublica;

  // Empty/missing profile → falls back to default set
  const defaultCodes = resolveNteeCodes([]);
  if (defaultCodes.length > 0) pass(`Default NTEE codes (empty profile): [${defaultCodes.join(', ')}]`);
  else fail('Expected default NTEE codes for empty profile');

  // Known sectors
  const racialJusticeCodes = resolveNteeCodes(['racial justice']);
  if (racialJusticeCodes.includes('R')) pass('"racial justice" resolves to include NTEE "R"');
  else fail('"racial justice" should resolve to NTEE "R"');

  const lgbtCodes = resolveNteeCodes(['LGBTQ+']);
  if (lgbtCodes.includes('R') || lgbtCodes.includes('P')) pass('"LGBTQ+" resolves to expected NTEE codes');
  else fail('"LGBTQ+" should resolve to NTEE "R" or "P"');

  // Deduplication across multiple sectors
  const multiCodes = resolveNteeCodes(['racial justice', 'immigrant rights']);
  if (new Set(multiCodes).size === multiCodes.length) pass('Deduplication works for overlapping sectors');
  else fail('Duplicate NTEE codes returned for overlapping sectors');

  info(`SECTOR_TO_NTEE keys: ${Object.keys(SECTOR_TO_NTEE).join(', ')}`);

  // ── 3. Interval field check ─────────────────────────────────────────────────
  console.log('\n3. Checking interval field and intervalElapsed helper…');

  // Never run before → should run
  if (intervalElapsed(propublica, {})) pass('intervalElapsed returns true when never run before');
  else fail('intervalElapsed should return true when no last-run record exists');

  // Just ran → should not run again
  const justRan = { propublica: new Date().toISOString() };
  if (!intervalElapsed(propublica, justRan)) pass('intervalElapsed returns false immediately after a run');
  else fail('intervalElapsed should return false immediately after a run');

  // Ran 31 days ago → should run
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const ranMonthAgo = { propublica: thirtyOneDaysAgo };
  if (intervalElapsed(propublica, ranMonthAgo)) pass('intervalElapsed returns true after 31 days (monthly interval)');
  else fail('intervalElapsed should return true after 31 days for a monthly plugin');

  // ── 4. Live fetch ────────────────────────────────────────────────────────────
  console.log('\n4. Calling fetch() against live ProPublica API…');
  console.log('   (This makes real HTTP requests — may take 30–60 seconds)\n');

  // Use a minimal profile with a couple of known sectors so NTEE mapping works.
  const testProfile = {
    target_sectors: ['racial justice', 'LGBTQ+', 'community organizing'],
  };

  let results;
  try {
    results = await propublica.fetch(testProfile);
  } catch (err) {
    fail(`fetch() threw unexpectedly: ${err.message}`);
    console.error('\nSomething went wrong with the live fetch — see error above.\n');
    return;
  }

  if (!Array.isArray(results)) {
    fail(`fetch() must return an array (got ${typeof results})`);
    return;
  }

  pass(`fetch() returned ${results.length} lead(s)`);

  // ── 5. Schema validation ─────────────────────────────────────────────────────
  if (results.length === 0) {
    info('Zero results returned — schema validation skipped.');
    info('Possible causes: no recent 990 filings found for the queried NTEE codes,');
    info('or there is a network issue. Verify the ProPublica API is reachable.');
  } else {
    console.log(`\n5. Validating schema for all ${results.length} returned items…`);
    let validCount = 0;
    for (let i = 0; i < results.length; i++) {
      if (validateLead(results[i], i)) validCount++;
    }
    pass(`${validCount}/${results.length} items pass schema validation`);

    // Print a sample card.
    console.log('\n── Sample lead (first result) ──');
    const s = results[0];
    console.log(`  id:          ${s.id}`);
    console.log(`  source:      ${s.source}`);
    console.log(`  title:       ${s.title}`);
    console.log(`  org:         ${s.org}`);
    console.log(`  url:         ${s.url}`);
    console.log(`  budget:      ${s.budget}`);
    console.log(`  description: ${(s.description || '').slice(0, 160)}…`);
  }

  // ── Result ───────────────────────────────────────────────────────────────────
  console.log();
  if (process.exitCode === 1) {
    console.error('ProPublica plugin test FAILED — see ✗ items above.\n');
  } else {
    console.log('ProPublica plugin test PASSED.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
