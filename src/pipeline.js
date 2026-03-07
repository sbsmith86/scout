'use strict';

/**
 * Scout pipeline — the main orchestrator.
 *
 * Steps:
 *  1. Load profile from config/profile.json
 *  2. Run all source plugins (errors per-source are caught and logged)
 *  3. Deduplicate results (by URL, falling back to org+title)
 *  4. Run disqualifiers on each item
 *  5. Score non-disqualified items via Claude
 *  6. Write passing items to the appropriate Sheets tab (Opportunities or Leads)
 *  7. Write filtered items to the Corrections Log (for the dashboard filtered section)
 *  8. Return a run summary (fetched / filtered / surfaced counts)
 *
 * The pipeline is the single entry point for both manual CLI runs (`scout run`)
 * and the weekly cron job — no interactive prompts, no side effects outside of
 * Google Sheets.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sources = require('./sources');
const { disqualify, score } = require('./scoring');
const {
  initializeAllHeaders,
  appendOpportunity,
  appendLead,
  appendCorrection,
} = require('./sheets');

const PROFILE_PATH = path.join(__dirname, '..', 'config', 'profile.json');

/** Maximum characters used from the title when building a fallback dedupe key. */
const MAX_TITLE_SLUG_LENGTH = 60;

// ── Profile loading ───────────────────────────────────────────────────────────

/**
 * Load the HosTechnology profile JSON from config/profile.json.
 * Throws a descriptive error if the file is missing or unparseable.
 *
 * @returns {object}
 */
function loadProfile() {
  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error(
      `Profile not found at ${PROFILE_PATH}.\n` +
      'Copy config/profile.example.json → config/profile.json and fill it in before running the pipeline.'
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(PROFILE_PATH, 'utf8');
  } catch (err) {
    throw new Error(`Could not read profile at ${PROFILE_PATH}: ${err.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse profile at ${PROFILE_PATH}: ${err.message}`);
  }
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Derive a stable deduplication key for an opportunity or lead.
 *
 * Priority:
 *  1. Canonical URL (most stable across sources)
 *  2. org slug + title slug (fallback when URL is absent)
 *
 * @param {object} item
 * @returns {string}
 */
function dedupeKey(item) {
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (url) return url.toLowerCase();

  const orgSlug = (item.org || '').toLowerCase().replace(/\s+/g, '-');
  const titleSlug = (item.title || '').toLowerCase().replace(/\s+/g, '-').slice(0, MAX_TITLE_SLUG_LENGTH);
  return `${orgSlug}:${titleSlug}`;
}

// ── Sheets record builders ────────────────────────────────────────────────────

/**
 * Build a flat record ready to be written to the Opportunities sheet.
 *
 * @param {object} item
 * @param {object} scoreResult
 * @returns {object}
 */
function buildOpportunityRecord(item, scoreResult) {
  return {
    id: item.id ?? '',
    source: item.source ?? '',
    title: item.title ?? '',
    org: item.org ?? '',
    url: item.url ?? '',
    deadline: item.deadline ?? '',
    budget: item.budget ?? '',
    score: scoreResult.overall,
    confidence: scoreResult.confidence,
    // Contact fields — populated by Phase 2 contact resolution.
    contact_name: '',
    contact_title: '',
    contact_email: '',
    contact_linkedin: '',
    // Application process fields — populated by Phase 2 discovery.
    application_type: '',
    application_notes: '',
    status: 'pending',
    date_surfaced: new Date().toISOString(),
    draft_doc_link: '',
  };
}

/**
 * Build a flat record ready to be written to the Leads sheet.
 *
 * @param {object} item
 * @param {object} scoreResult
 * @returns {object}
 */
function buildLeadRecord(item, scoreResult) {
  return {
    id: item.id ?? '',
    org: item.org ?? '',
    funder: item.funder ?? item.source ?? '',
    funding_amount: item.funding_amount ?? item.budget ?? '',
    funding_date: item.funding_date ?? item.deadline ?? '',
    mission_summary: item.mission_summary ?? item.description ?? '',
    score: scoreResult.overall,
    confidence: scoreResult.confidence,
    // Contact fields — populated by Phase 2 contact resolution.
    contact_name: '',
    contact_title: '',
    contact_email: '',
    contact_linkedin: '',
    status: 'pending',
    date_surfaced: new Date().toISOString(),
    draft_doc_link: '',
  };
}

// ── Console output ────────────────────────────────────────────────────────────

/**
 * Print a human-readable run summary to the console.
 *
 * @param {object} summary
 */
function printSummary(summary) {
  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  Scout Run Summary');
  console.log('══════════════════════════════════════════');
  console.log(`  Fetched           : ${summary.fetched}`);
  console.log(`  After dedupe      : ${summary.deduplicated}`);
  if (summary.duplicatesRemoved > 0) {
    console.log(`  Duplicates removed: ${summary.duplicatesRemoved}`);
  }
  if (summary.filtered !== undefined) {
    console.log(`  Filtered out      : ${summary.filtered}`);
  }
  if (summary.surfaced !== undefined) {
    console.log(`  Surfaced          : ${summary.surfaced}`);
  }
  if (summary.sheetsWritten !== undefined) {
    console.log(`  Written to Sheets : ${summary.sheetsWritten}`);
  }
  if (summary.sourceErrors && summary.sourceErrors.length > 0) {
    console.log(`  Source errors     : ${summary.sourceErrors.length}`);
    for (const e of summary.sourceErrors) {
      console.log(`    ✗ ${e.source}: ${e.error}`);
    }
  }
  console.log('══════════════════════════════════════════');
  console.log('');
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the full Scout pipeline.
 *
 * @param {object}  [options]
 * @param {boolean} [options.fetchOnly=false]
 *   When true, skip disqualification, scoring, and Sheets writes.
 *   Used by `scout fetch` to preview raw source output.
 *
 * @returns {Promise<object>} Run summary with counts and any source errors.
 */
async function runPipeline(options = {}) {
  const { fetchOnly = false } = options;

  // ── 1. Load profile ────────────────────────────────────────────────────────
  console.log('[pipeline] Loading profile...');
  const profile = loadProfile();
  console.log(`[pipeline] Profile loaded: ${profile.practice_name || 'HosTechnology'}`);

  // ── 2. Fetch from all source plugins ──────────────────────────────────────
  const allPlugins = Object.values(sources);
  console.log(`[pipeline] Running ${allPlugins.length} source plugin(s)...`);

  const allItems = [];
  const sourceErrors = [];

  for (const plugin of allPlugins) {
    console.log(`[pipeline] → ${plugin.name} (${plugin.id})`);
    try {
      const items = await plugin.fetch(profile);
      console.log(`[pipeline]   ${plugin.name}: ${items.length} item(s) fetched`);
      allItems.push(...items);
    } catch (err) {
      // One source failing must not stop the run.
      console.error(`[pipeline]   ✗ "${plugin.name}" failed: ${err.message}`);
      sourceErrors.push({ source: plugin.id, error: err.message });
    }
  }

  console.log(`[pipeline] Total fetched (pre-dedupe): ${allItems.length}`);

  // ── 3. Deduplicate ─────────────────────────────────────────────────────────
  const seen = new Set();
  const dedupedItems = [];
  for (const item of allItems) {
    const key = dedupeKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      dedupedItems.push(item);
    }
  }
  const duplicatesRemoved = allItems.length - dedupedItems.length;
  console.log(
    `[pipeline] After deduplication: ${dedupedItems.length} item(s)` +
    (duplicatesRemoved > 0 ? ` (${duplicatesRemoved} duplicate(s) removed)` : '')
  );

  // fetch-only mode — return early without scoring or writing.
  if (fetchOnly) {
    const summary = {
      fetched: allItems.length,
      deduplicated: dedupedItems.length,
      duplicatesRemoved,
      sourceErrors,
      items: dedupedItems,
    };
    printSummary(summary);
    return summary;
  }

  // ── 4. Disqualify ──────────────────────────────────────────────────────────
  const passingItems = [];
  const filteredItems = []; // { item, filter_reason }

  for (const item of dedupedItems) {
    const result = disqualify(item, profile);
    if (result.pass) {
      passingItems.push(item);
    } else {
      filteredItems.push({ item, filter_reason: result.filter_reason });
    }
  }

  console.log(
    `[pipeline] Disqualifier: ${passingItems.length} passing, ${filteredItems.length} filtered`
  );

  // ── 5. Score passing items via Claude ──────────────────────────────────────
  console.log(`[pipeline] Scoring ${passingItems.length} item(s)...`);

  const surfacedItems = []; // { item, scoreResult }

  for (const item of passingItems) {
    let scoreResult;
    try {
      scoreResult = await score(item, profile);
    } catch (err) {
      console.error(
        `[pipeline] Scoring failed for "${item.title}" (${item.id}): ${err.message}`
      );
      // Treat as filtered so it still appears in the dashboard filtered section.
      filteredItems.push({ item, filter_reason: `Scoring error: ${err.message}` });
      continue;
    }

    if (scoreResult.pass) {
      surfacedItems.push({ item, scoreResult });
      console.log(
        `[pipeline] ✓ Surfaced: "${item.title}" — ${scoreResult.overall}/20 (${scoreResult.confidence})`
      );
    } else {
      filteredItems.push({ item, filter_reason: scoreResult.filter_reason });
      console.log(
        `[pipeline] ✗ Scored out: "${item.title}" — ${scoreResult.overall}/20`
      );
    }
  }

  console.log(
    `[pipeline] Surfaced: ${surfacedItems.length}, ` +
    `Total filtered: ${filteredItems.length}`
  );

  // ── 6. Initialize Sheets headers and write surfaced items ─────────────────
  console.log('[pipeline] Initializing Google Sheets headers...');
  await initializeAllHeaders();

  let sheetsWritten = 0;

  for (const { item, scoreResult } of surfacedItems) {
    try {
      if (item.type === 'lead') {
        await appendLead(buildLeadRecord(item, scoreResult));
      } else {
        await appendOpportunity(buildOpportunityRecord(item, scoreResult));
      }
      sheetsWritten++;
      console.log(
        `[pipeline] Written: "${item.title}" → ${item.type === 'lead' ? 'Leads' : 'Opportunities'}`
      );
    } catch (err) {
      console.error(`[pipeline] Failed to write "${item.title}" to Sheets: ${err.message}`);
    }
  }

  // ── 7. Write filtered items to Corrections Log ────────────────────────────
  let filteredWritten = 0;

  for (const { item, filter_reason } of filteredItems) {
    const rawKey = item.id || dedupeKey(item);
    const corrId = `corr-${crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 8)}`;

    try {
      await appendCorrection({
        id: corrId,
        item_id: item.id || '',
        item_type: item.type === 'lead' ? 'lead' : 'opportunity',
        filter_reason,
        feedback: '',
        date: new Date().toISOString(),
      });
      filteredWritten++;
    } catch (err) {
      console.error(
        `[pipeline] Failed to log filtered item "${item.title}" to Corrections Log: ${err.message}`
      );
    }
  }

  // ── 8. Run summary ─────────────────────────────────────────────────────────
  const summary = {
    fetched: allItems.length,
    deduplicated: dedupedItems.length,
    duplicatesRemoved,
    filtered: filteredItems.length,
    surfaced: surfacedItems.length,
    sheetsWritten,
    filteredWritten,
    sourceErrors,
  };

  printSummary(summary);
  return summary;
}

module.exports = { runPipeline, loadProfile };
