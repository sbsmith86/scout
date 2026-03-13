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
const { sendRunSummaryEmail } = require('./notifications');
const { runHealthChecks } = require('./health-check');

const PROFILE_PATH = path.join(__dirname, '..', 'config', 'profile.json');

/** Persists the last-successful-fetch timestamp per source plugin. */
const SOURCE_RUNS_PATH = path.join(__dirname, '..', 'config', 'source-runs.json');

/** Maximum characters used from the title when building a fallback dedupe key. */
const MAX_TITLE_SLUG_LENGTH = 60;

// ── Per-source interval tracking ─────────────────────────────────────────────

/** Milliseconds per named interval. */
const INTERVAL_MS = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Load the source-runs state file, returning an empty object when it does not
 * yet exist or cannot be parsed.
 *
 * @returns {object}  Map of source id → ISO timestamp of last successful run.
 */
function loadSourceRuns() {
  try {
    if (fs.existsSync(SOURCE_RUNS_PATH)) {
      return JSON.parse(fs.readFileSync(SOURCE_RUNS_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn(`[pipeline] Could not read source-runs file: ${err.message}`);
  }
  return {};
}

/**
 * Persist an updated source-runs map to disk.  Errors are non-fatal — a
 * missing state file just means the source will run again next time.
 *
 * @param {object} runs
 */
function saveSourceRuns(runs) {
  try {
    fs.writeFileSync(SOURCE_RUNS_PATH, JSON.stringify(runs, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[pipeline] Could not save source-runs file: ${err.message}`);
  }
}

/**
 * Return true if the plugin's fetch interval has elapsed since its last run
 * (or if no last-run record exists).  Plugins without an `interval` field are
 * treated as 'weekly'.
 *
 * @param {object} plugin   Source plugin object.
 * @param {object} runs     Current source-runs state map.
 * @returns {boolean}
 */
function intervalElapsed(plugin, runs) {
  const interval = plugin.interval || 'weekly';
  let intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) {
    console.warn(`[pipeline] Unknown interval "${interval}" for "${plugin.id}" — using weekly`);
    intervalMs = INTERVAL_MS.weekly;
  }
  const lastRun = runs[plugin.id];
  if (!lastRun) return true; // never run before
  const ts = new Date(lastRun).getTime();
  if (Number.isNaN(ts)) {
    console.warn(
      `[pipeline] Invalid lastRun timestamp for "${plugin.id}" ("${lastRun}") — treating as never run`
    );
    return true; // corrupt entry → force a fresh fetch
  }
  const elapsed = Date.now() - ts;
  return elapsed >= intervalMs;
}

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
    surface_reason: scoreResult.surface_reason ?? '',
    description: item.description ? item.description.slice(0, 500) : '',
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
    surface_reason: scoreResult.surface_reason ?? '',
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
  const { fetchOnly = false, healthCheck = false } = options;

  // ── 1. Load profile ────────────────────────────────────────────────────────
  console.log('[pipeline] Loading profile...');
  const profile = loadProfile();
  console.log(`[pipeline] Profile loaded: ${profile.practice_name || 'HosTechnology'}`);

  // ── 1a. Optional lightweight source health checks (non-blocking) ─────────
  // Warn about degraded sources before fetching so failures are immediately
  // visible.  A failing health check does NOT stop the run — the full fetch
  // will still attempt all sources.
  if (healthCheck) {
    console.log('[pipeline] Running source health checks...');
    try {
      const healthResults = await runHealthChecks();
      const failed = healthResults.filter((r) => !r.pass);
      if (failed.length > 0) {
        for (const r of failed) {
          console.warn(
            `[pipeline] ⚠ Source health warning — ${r.name}: ${r.reason}`
          );
        }
        console.warn(
          `[pipeline] ${failed.length}/${healthResults.length} source(s) may be degraded. ` +
          'Run `scout check` for a full health report.'
        );
      } else {
        console.log(`[pipeline] All ${healthResults.length} source(s) healthy.`);
      }
    } catch (err) {
      // Health checks are best-effort; never abort the pipeline over them.
      console.warn(
        `[pipeline] Health check error (non-fatal): ${err.message}`
      );
    }
  }

  // ── 2. Fetch from all source plugins ──────────────────────────────────────
  const allPlugins = Object.values(sources);
  console.log(`[pipeline] Running ${allPlugins.length} source plugin(s)...`);

  const sourceRuns = loadSourceRuns();
  const allItems = [];
  const sourceErrors = [];

  for (const plugin of allPlugins) {
    // Respect per-source fetch intervals — skip plugins whose interval has
    // not yet elapsed since their last successful run.
    if (!intervalElapsed(plugin, sourceRuns)) {
      const interval = plugin.interval || 'weekly';
      const lastRun = sourceRuns[plugin.id];
      console.log(
        `[pipeline] → ${plugin.name} (${plugin.id}) — skipped ` +
        `(interval: ${interval}, last run: ${lastRun})`
      );
      continue;
    }

    console.log(`[pipeline] → ${plugin.name} (${plugin.id})`);
    try {
      const items = await plugin.fetch(profile);
      console.log(`[pipeline]   ${plugin.name}: ${items.length} item(s) fetched`);
      allItems.push(...items);
      // Record successful run immediately after fetch completes.  Recording
      // here (rather than at end of pipeline) means the interval resets even
      // if downstream scoring or Sheets writes fail — the raw data was
      // successfully fetched and the same results would be returned again next
      // time, so re-fetching before the interval elapses adds no value.
      sourceRuns[plugin.id] = new Date().toISOString();
    } catch (err) {
      // One source failing must not stop the run.
      console.error(`[pipeline]   ✗ "${plugin.name}" failed: ${err.message}`);
      sourceErrors.push({ source: plugin.id, error: err.message });
    }
  }

  // Persist updated run timestamps only for a real run — skip when fetchOnly
  // so that preview/dry-run invocations don't advance the scheduler and cause
  // subsequent real runs to skip sources whose interval appears elapsed.
  if (!fetchOnly) {
    saveSourceRuns(sourceRuns);
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
        title: item.title || '',
        org: item.org || '',
        source: item.source || '',
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

  // ── 9. Send notification email ─────────────────────────────────────────────
  await sendRunSummaryEmail(summary, surfacedItems);

  return summary;
}

module.exports = { runPipeline, loadProfile, intervalElapsed, loadSourceRuns, saveSourceRuns };
