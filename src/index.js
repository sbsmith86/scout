#!/usr/bin/env node

'use strict';

require('dotenv').config();

const { runPipeline } = require('./pipeline');
const { startDashboard } = require('./dashboard');

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
      console.log('  dashboard  Start the review dashboard (default port 3000)');
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
