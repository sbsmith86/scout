'use strict';

const { Client } = require('@notionhq/client');

/**
 * Notion client module.
 *
 * Initialises the official Notion SDK from environment variables and exports:
 *  - `notion`               — authenticated Notion Client instance
 *  - `OPPORTUNITIES_DB_ID`  — Notion database ID for the Opportunities database
 *  - `LEADS_DB_ID`          — Notion database ID for the Leads database
 *  - `CORRECTIONS_DB_ID`    — Notion database ID for the Corrections Log database
 *  - `checkConnection()`    — async function that verifies the API key is valid
 *
 * Required environment variables:
 *  - NOTION_API_KEY              — Notion integration token (secret_…)
 *  - NOTION_OPPORTUNITIES_DB_ID  — Notion database ID (hyphenated UUID or 32-hex form)
 *  - NOTION_LEADS_DB_ID          — Notion database ID (hyphenated UUID or 32-hex form)
 *  - NOTION_CORRECTIONS_DB_ID    — Notion database ID (hyphenated UUID or 32-hex form)
 *
 * All env vars are validated eagerly at module load time, so callers get a clear
 * error message immediately on require() rather than an obscure SDK error on
 * the first API call.
 */

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. ` +
      'Add it to .env — see .env.example for setup instructions.'
    );
  }
  return value;
}

// Validate all required env vars on module load so callers get a clear error
// message immediately rather than an obscure SDK error on first API call.
const NOTION_API_KEY = requireEnv('NOTION_API_KEY');
const OPPORTUNITIES_DB_ID = requireEnv('NOTION_OPPORTUNITIES_DB_ID');
const LEADS_DB_ID = requireEnv('NOTION_LEADS_DB_ID');
const CORRECTIONS_DB_ID = requireEnv('NOTION_CORRECTIONS_DB_ID');

/**
 * Authenticated Notion SDK client.
 * Use this instance for all API calls within the notion module.
 */
const notion = new Client({ auth: NOTION_API_KEY });

/**
 * Verifies that the Notion API key is valid by making a lightweight API call
 * (lists users — requires no database permissions).
 *
 * Resolves with `{ ok: true }` on success.
 * Resolves with `{ ok: false, error: string }` on failure (never rejects)
 * so callers can handle connectivity issues gracefully.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function checkConnection() {
  try {
    await notion.users.me({});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  notion,
  OPPORTUNITIES_DB_ID,
  LEADS_DB_ID,
  CORRECTIONS_DB_ID,
  checkConnection,
};
