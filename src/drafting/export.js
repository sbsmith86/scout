'use strict';

/**
 * Google Docs export for approved Scout items.
 *
 * When an opportunity or lead is approved from the dashboard, this module
 * creates a Google Doc containing all relevant metadata, contact info, and
 * the draft text.  The doc URL is returned so it can be written back to the
 * corresponding Sheets row (draft_doc_link column).
 *
 * The service account used here is the same one that accesses Sheets.  It
 * must have the Docs API enabled on the associated Google Cloud project.
 * The resulting document is shared as an editor with the NOTIFICATION_EMAIL
 * address (if set) so the user can open and edit it.
 */

const { getDocsClient, getDriveClient } = require('../sheets/client');

// ── Text builders ──────────────────────────────────────────────────────────

/**
 * Formats a labelled field line.  Omits the line entirely when the value is
 * empty or undefined so the doc stays clean.
 *
 * @param {string} label
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
function field(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `${label}: ${value}\n`;
}

/**
 * Builds the plain-text body of the Google Doc for an opportunity (Contract
 * Finder item).
 *
 * @param {object} item  Row object from Opportunities sheet
 * @returns {string}
 */
function buildOpportunityContent(item) {
  const lines = [];

  // ── Metadata ──
  lines.push('OPPORTUNITY DETAILS\n');
  lines.push(field('Org', item.org));
  lines.push(field('Source', item.source));
  lines.push(field('Deadline', item.deadline));
  lines.push(field('Budget', item.budget));
  lines.push(field('Score', item.score ? `${item.score}/20` : ''));
  lines.push(field('Confidence', item.confidence));
  lines.push(field('Surface Reason', item.surface_reason));
  lines.push(field('Date Surfaced', item.date_surfaced));
  lines.push(field('URL', item.url));

  // ── Contact ──
  const hasContact = item.contact_name || item.contact_email || item.contact_linkedin;
  if (hasContact) {
    lines.push('\nCONTACT INFORMATION\n');
    lines.push(field('Name', item.contact_name));
    lines.push(field('Title', item.contact_title));
    lines.push(field('Email', item.contact_email));
    lines.push(field('LinkedIn', item.contact_linkedin));
  }

  // ── Application process ──
  const hasApplication = item.application_type || item.application_notes;
  if (hasApplication) {
    lines.push('\nAPPLICATION PROCESS\n');
    lines.push(field('Type', item.application_type));
    lines.push(field('Notes', item.application_notes));
  }

  // ── Draft ──
  lines.push('\nDRAFT\n');
  lines.push(item.draft_text || '(no draft text)');
  lines.push('\n');

  return lines.filter(Boolean).join('');
}

/**
 * Builds the plain-text body of the Google Doc for a lead (Funding Monitor
 * item).
 *
 * @param {object} item  Row object from Leads sheet
 * @returns {string}
 */
function buildLeadContent(item) {
  const lines = [];

  // ── Metadata ──
  lines.push('LEAD DETAILS\n');
  lines.push(field('Org', item.org));
  lines.push(field('Funder', item.funder));
  lines.push(field('Funding Amount', item.funding_amount));
  lines.push(field('Funding Date', item.funding_date));
  lines.push(field('Mission Summary', item.mission_summary));
  lines.push(field('Score', item.score ? `${item.score}/20` : ''));
  lines.push(field('Confidence', item.confidence));
  lines.push(field('Surface Reason', item.surface_reason));
  lines.push(field('Date Surfaced', item.date_surfaced));

  // ── Contact ──
  const hasContact = item.contact_name || item.contact_email || item.contact_linkedin;
  if (hasContact) {
    lines.push('\nCONTACT INFORMATION\n');
    lines.push(field('Name', item.contact_name));
    lines.push(field('Title', item.contact_title));
    lines.push(field('Email', item.contact_email));
    lines.push(field('LinkedIn', item.contact_linkedin));
  }

  // ── Draft ──
  lines.push('\nDRAFT\n');
  lines.push(item.draft_text || '(no draft text)');
  lines.push('\n');

  return lines.filter(Boolean).join('');
}

// ── Main export function ───────────────────────────────────────────────────

/**
 * Creates a Google Doc for an approved item (opportunity or lead), writes the
 * draft content to it, shares it with the notification user, and returns the
 * doc URL.
 *
 * @param {object} item        Full row object from Opportunities or Leads sheet
 * @param {'opportunity'|'lead'} type
 * @returns {Promise<string>}  Google Docs editing URL
 */
async function exportDraft(item, type) {
  const docs = await getDocsClient();
  const drive = await getDriveClient();

  // ── Build document title ────────────────────────────────────────────────
  const org = item.org || 'Unknown Org';
  const docTitle = type === 'lead'
    ? `Scout — ${org} Outreach Draft`
    : `Scout — ${org} Proposal Draft`;

  // ── Build document body text ────────────────────────────────────────────
  const bodyText = type === 'lead'
    ? buildLeadContent(item)
    : buildOpportunityContent(item);

  // ── Create the Google Doc ───────────────────────────────────────────────
  const createRes = await docs.documents.create({
    requestBody: { title: docTitle },
  });
  const documentId = createRes.data.documentId;

  // ── Insert content via batchUpdate ─────────────────────────────────────
  // The new document body has a single empty paragraph; index 1 is the
  // insertion point at the start of the body content.
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: bodyText,
          },
        },
      ],
    },
  });

  // ── Share with the user ─────────────────────────────────────────────────
  const userEmail = process.env.NOTIFICATION_EMAIL;
  if (userEmail) {
    try {
      await drive.permissions.create({
        fileId: documentId,
        sendNotificationEmail: false,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: userEmail,
        },
      });
    } catch (shareErr) {
      // Sharing failure is non-fatal — the doc was still created.
      console.warn(`[export] Could not share doc with ${userEmail}: ${shareErr.message}`);
    }
  } else {
    console.warn(
      '[export] NOTIFICATION_EMAIL is not set — the doc was created but not shared with any user. ' +
      'Set NOTIFICATION_EMAIL in your .env file to automatically share exported docs with your account.'
    );
  }

  const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
  return docUrl;
}

module.exports = { exportDraft };
