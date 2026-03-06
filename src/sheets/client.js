'use strict';

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/**
 * Returns an authenticated Google Sheets API client.
 *
 * Credentials are loaded from the path set in GOOGLE_SERVICE_ACCOUNT_KEY_PATH.
 * The file must be a Google Cloud service account JSON key with Sheets API access.
 *
 * Set up:
 *  1. Create a Google Cloud project and enable the Sheets API and Docs API.
 *  2. Create a service account, download the JSON key, and store it at the path
 *     specified in GOOGLE_SERVICE_ACCOUNT_KEY_PATH (never commit this file).
 *  3. Share the target Google Sheet with the service account email (editor access).
 *  4. Set GOOGLE_SHEETS_ID in .env to the spreadsheet ID from the sheet URL.
 */
async function getSheetsClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  if (!keyPath) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set. ' +
      'Set it in .env to the path of your Google service account JSON key file.'
    );
  }

  const resolvedPath = path.resolve(keyPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Service account key file not found at: ${resolvedPath}. ` +
      'Download the key from Google Cloud Console and update GOOGLE_SERVICE_ACCOUNT_KEY_PATH in .env.'
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });

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
