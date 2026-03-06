#!/usr/bin/env node

'use strict';

const [, , command] = process.argv;

async function main() {
  switch (command) {
    case 'run':
      console.log('scout run — not yet implemented');
      break;
    case 'fetch':
      console.log('scout fetch — not yet implemented');
      break;
    default:
      console.log('Usage: scout <command>');
      console.log('');
      console.log('Commands:');
      console.log('  run     Run the full pipeline (fetch, score, draft, notify)');
      console.log('  fetch   Fetch opportunities and leads from all sources');
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
