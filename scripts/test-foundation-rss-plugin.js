#!/usr/bin/env node
'use strict';

/**
 * Manual smoke-test for the foundation-rss source plugin.
 *
 * Calls the plugin's fetch() function and validates the shape of returned
 * leads.  No network mocking — this hits the live RSS feeds so it requires
 * an internet connection and optionally an ANTHROPIC_API_KEY for the Claude
 * org-extraction fallback.
 *
 * Run from the repo root:
 *
 *   node scripts/test-foundation-rss-plugin.js
 *
 * The script exits with code 1 if any schema assertion fails, 0 on success.
 */

const path = require('path');
const foundationRss = require(path.resolve(__dirname, '../src/sources/foundation-rss'));

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  • ${msg}`); }

// ── Schema validator ─────────────────────────────────────────────────────────

const REQUIRED_STRING_FIELDS = ['id', 'source', 'title', 'org', 'url', 'description'];
const OPTIONAL_NULLABLE_FIELDS = ['deadline', 'budget'];
const REQUIRED_LITERAL_FIELDS = { type: 'lead' };

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

  if (!lead.url.startsWith('http')) {
    fail(`[${index}] "url" must be an absolute URL (got: ${lead.url})`);
    ok = false;
  }

  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n── Scout × Foundation RSS plugin smoke-test ──\n');

  // ── 1. Plugin shape ─────────────────────────────────────────────────────────
  console.log('1. Checking plugin export shape…');
  if (foundationRss.id !== 'foundation-rss') fail(`id should be "foundation-rss" (got ${foundationRss.id})`);
  else pass(`id: "${foundationRss.id}"`);

  if (typeof foundationRss.name !== 'string' || foundationRss.name.length === 0) fail('name must be a non-empty string');
  else pass(`name: "${foundationRss.name}"`);

  if (foundationRss.type !== 'api') fail(`type should be "api" (got ${foundationRss.type})`);
  else pass(`type: "${foundationRss.type}"`);

  if (typeof foundationRss.fetch !== 'function') fail('fetch must be a function');
  else pass('fetch is a function');

  if (process.exitCode === 1) {
    console.error('\nPlugin shape invalid — aborting.\n');
    return;
  }

  // ── 2. Live fetch ────────────────────────────────────────────────────────────
  console.log('\n2. Calling fetch() against live RSS feeds…');
  console.log('   (This makes real HTTP requests — may take 10–30 seconds)\n');

  let results;
  try {
    results = await foundationRss.fetch({});
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

  // ── 3. Schema validation ─────────────────────────────────────────────────────
  if (results.length === 0) {
    info('Zero results returned — schema validation skipped.');
    info('Possible causes: feeds are empty, all items are non-grant blog posts,');
    info('or there is a network issue. Verify the feed URLs are reachable.');
  } else {
    console.log(`\n3. Validating schema for all ${results.length} returned items…`);
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
    console.log(`  description: ${(s.description || '').slice(0, 120)}…`);
  }

  // ── Result ───────────────────────────────────────────────────────────────────
  console.log();
  if (process.exitCode === 1) {
    console.error('Foundation RSS plugin test FAILED — see ✗ items above.\n');
  } else {
    console.log('Foundation RSS plugin test PASSED.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
