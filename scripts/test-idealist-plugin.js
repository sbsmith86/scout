#!/usr/bin/env node
'use strict';

/**
 * Manual smoke-test for the Idealist.org source plugin.
 *
 * Calls the plugin's fetch() function against a minimal stub profile and
 * prints a summary of what it returns.  No network mocking — this hits the
 * live Idealist.org site so it requires an internet connection.
 *
 * Run from the repo root:
 *
 *   node scripts/test-idealist-plugin.js
 *
 * Options (env vars):
 *   IDEALIST_MAX_TERMS   — override MAX_SEARCH_TERMS (default: 2 for speed)
 *   IDEALIST_MAX_PAGES   — override MAX_PAGES per term  (default: 1 for speed)
 */

const path = require('path');
const idealist = require(path.resolve(__dirname, '../src/sources/idealist'));

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  • ${msg}`); }

// ── Stub profile (minimal, representative) ───────────────────────────────────

const STUB_PROFILE = {
  practice_name: 'HosTechnology',
  focus_areas: [
    'Workflow automation for orgs under 20 staff',
    'Automated reporting pipelines',
  ],
  target_sectors: ['civic tech', 'racial justice'],
  excluded_sectors: ['military and defense'],
  work_types: ['automation', 'workflow implementation'],
  rate_range: { min: 5000, max: 50000 },
  min_project_days: 30,
  geographic_scope: 'remote_only',
  capacity: 'available',
};

// ── Schema validator ─────────────────────────────────────────────────────────

const REQUIRED_STRING_FIELDS = ['id', 'source', 'title', 'org', 'url', 'description'];
const OPTIONAL_NULLABLE_FIELDS = ['deadline', 'budget'];
const REQUIRED_LITERAL_FIELDS = { source: 'idealist', type: 'contract' };

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

  if (!opp.id.startsWith('idealist-')) {
    fail(`[${index}] "id" must start with "idealist-" (got: ${opp.id})`);
    ok = false;
  }

  if (!opp.url.startsWith('http')) {
    fail(`[${index}] "url" must be an absolute URL (got: ${opp.url})`);
    ok = false;
  }

  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n── Scout × Idealist.org plugin smoke-test ──\n');

  // ── 1. Plugin shape ─────────────────────────────────────────────────────────
  console.log('1. Checking plugin export shape…');
  if (idealist.id !== 'idealist') fail(`id should be "idealist" (got ${idealist.id})`);
  else pass(`id: "${idealist.id}"`);

  if (idealist.name !== 'Idealist.org') fail(`name should be "Idealist.org" (got ${idealist.name})`);
  else pass(`name: "${idealist.name}"`);

  if (!['scrape', 'api'].includes(idealist.type)) fail(`type should be "scrape" or "api" (got ${idealist.type})`);
  else pass(`type: "${idealist.type}"`);

  if (typeof idealist.fetch !== 'function') fail('fetch must be a function');
  else pass('fetch is a function');

  if (process.exitCode === 1) {
    console.error('\nPlugin shape invalid — aborting.\n');
    return;
  }

  // ── 2. Empty profile — should return [] without throwing ────────────────────
  console.log('\n2. Calling fetch() with an empty profile (graceful empty)…');
  try {
    const results = await idealist.fetch({});
    if (!Array.isArray(results)) {
      fail(`fetch({}) should return an array (got ${typeof results})`);
    } else {
      pass(`fetch({}) returned an array with ${results.length} item(s)`);
    }
  } catch (err) {
    fail(`fetch({}) threw: ${err.message}`);
  }

  // ── 3. Live fetch with stub profile ─────────────────────────────────────────
  console.log('\n3. Calling fetch() with stub profile against live Idealist.org…');
  console.log('   (This makes real HTTP requests — may take 10–30 seconds)\n');

  let results;
  try {
    results = await idealist.fetch(STUB_PROFILE);
  } catch (err) {
    fail(`fetch(profile) threw unexpectedly: ${err.message}`);
    console.error('\nSomething went wrong with the live fetch — see error above.\n');
    return;
  }

  if (!Array.isArray(results)) {
    fail(`fetch() must return an array (got ${typeof results})`);
    return;
  }

  pass(`fetch() returned ${results.length} opportunity/ies`);

  // ── 4. Schema validation ─────────────────────────────────────────────────────
  if (results.length === 0) {
    info('Zero results returned — schema validation skipped.');
    info('This can mean: Idealist.org returned no consulting listings for the stub search terms,');
    info('the site structure changed, or there is a network issue.');
    info('Run again or broaden the stub profile if you expect results.');
  } else {
    console.log(`\n4. Validating schema for all ${results.length} returned items…`);
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
    console.error('Idealist plugin test FAILED — see ✗ items above.\n');
  } else {
    console.log('Idealist plugin test PASSED.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
