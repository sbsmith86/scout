'use strict';

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

/**
 * Returns an authenticated Google Sheets API client.
 *
 * Authentication is resolved in priority order:
 *
 *  1. Key file (local dev / CI with a downloaded key):
 *     Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH to the path of a service account JSON
 *     key file.  The file must never be committed — it is gitignored.
 *
 *  2. Individual env vars (Codespaces / environments without a key file):
 *     Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.
 *     GOOGLE_PRIVATE_KEY may use literal `\n` sequences; they are normalised
 *     to real newlines automatically.
 *
 * In either case the service account must have been granted Editor access to
 * the target Google Sheet, and GOOGLE_SHEETS_ID must be set in .env.
 *
 * Set up (one-time):
 *  1. Create a Google Cloud project and enable the Sheets API and Docs API.
 *  2. Create a service account and share the target Sheet with it (Editor).
 *  3. Either download the JSON key (local dev) or copy the email + private key
 *     fields into env vars (Codespaces).
 *  4. Set GOOGLE_SHEETS_ID in .env to the spreadsheet ID from the Sheet URL.
 */
async function getSheetsClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  let auth;

  if (keyPath) {
    // ── Option 1: key file ────────────────────────────────────────────────
    const resolvedPath = path.resolve(keyPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Service account key file not found at: ${resolvedPath}. ` +
        'Download the key from Google Cloud Console and update GOOGLE_SERVICE_ACCOUNT_KEY_PATH in .env.'
      );
    }

    auth = new google.auth.GoogleAuth({
      keyFile: resolvedPath,
      scopes: SCOPES,
    });
  } else if (clientEmail && privateKey) {
    // ── Option 2: individual env vars (Codespaces) ────────────────────────
    // Codespace secrets store the private key with literal \n sequences;
    // normalise them to real newlines so the JWT library accepts the key.
    const normalizedKey = privateKey.replace(/\\n/g, '\n');

    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: normalizedKey,
      },
      scopes: SCOPES,
    });
  } else {
    throw new Error(
      'Google Sheets credentials are not configured. Provide one of:\n' +
      '  • GOOGLE_SERVICE_ACCOUNT_KEY_PATH — path to a service account JSON key file (local dev)\n' +
      '  • GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY — individual env vars (Codespaces)'
    );
  }

  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

/**
 * Returns the spreadsheet ID from the GOOGLE_SHEETS_ID environment variable.
 * Throws a descriptive error if it is not set.
 */
function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) {
    throw new Error(
      'GOOGLE_SHEETS_ID is not set. ' +
      'Set it in .env to the spreadsheet ID found in the Google Sheet URL.'
    );
  }
  return id;
}

module.exports = { getSheetsClient, getSpreadsheetId };

