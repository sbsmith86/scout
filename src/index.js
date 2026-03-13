#!/usr/bin/env node

'use strict';

require('dotenv').config();

const { runPipeline } = require('./pipeline');
const { startDashboard } = require('./dashboard');
const { runHealthChecks, printHealthReport } = require('./health-check');

const [, , command] = process.argv;

async function main() {
  switch (command) {
    case 'run': {
      console.log('[scout] Starting full pipeline run...');
      await runPipeline();
      break;
    }
    case 'fetch': {
      console.log('[scout] Fetch-only run (no scoring, no Sheets write)...');
      await runPipeline({ fetchOnly: true });
      break;
    }
    case 'check': {
      console.log('[scout] Running source health checks...');
      const results = await runHealthChecks();
      printHealthReport(results);
      const anyFailed = results.some((r) => !r.pass);
      if (anyFailed) process.exitCode = 1;
      break;
    }
    case 'dashboard': {
      startDashboard();
      break;
    }
    default:
      console.log('Usage: scout <command>');
      console.log('');
      console.log('Commands:');
      console.log('  run        Run the full pipeline (fetch, score, write to Sheets)');
      console.log('  fetch      Fetch opportunities and leads from all sources (no scoring, no write)');
      console.log('  check      Run health checks on all source plugins');
      console.log('  dashboard  Start the review dashboard (default port 3000)');
      break;
  }
}

main()
  .then(() => {
    // Dashboard intentionally keeps the process alive; all other commands
    // should exit cleanly even if stray handles (HTTP sockets, timers) remain.
    if (command !== 'dashboard') process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
