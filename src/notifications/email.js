'use strict';

/**
 * Resend notification email — run summary.
 *
 * Sends a plain notification email after each Scout pipeline run.
 * Email is notification-only; the dashboard is the primary review interface.
 *
 * Required env vars:
 *   RESEND_API_KEY       — Resend API key
 *   NOTIFICATION_EMAIL   — recipient address
 *
 * Optional env vars:
 *   DASHBOARD_URL        — base URL of the review dashboard (defaults to http://localhost:3000)
 */

const { Resend } = require('resend');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

/**
 * The "from" address used when sending emails via Resend.
 * The domain portion MUST be verified in your Resend account before emails
 * will be delivered. Set RESEND_FROM_EMAIL in .env to override.
 * Default: scout@hostechnology.com
 */
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Scout <scout@hostechnology.com>';

// ── HTML template ─────────────────────────────────────────────────────────────

/**
 * Render one surfaced-item row for the email body.
 *
 * @param {{ item: object, scoreResult: object }} entry
 * @returns {string}
 */
function renderSurfacedRow(entry) {
  const { item, scoreResult } = entry;
  const org = item.org || '(unknown org)';
  const title = item.title || '(no title)';
  const reason = scoreResult.surface_reason || '';

  return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;">
            ${escapeHtml(org)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">
            ${escapeHtml(title)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">
            ${escapeHtml(reason)}
          </td>
        </tr>`;
}

/**
 * Build the full HTML email body.
 *
 * @param {object} summary         Run summary from the pipeline.
 * @param {Array}  surfacedItems   Items that passed scoring (with scoreResult).
 * @param {Date}   runDate         When the run happened.
 * @returns {string}
 */
function buildHtml(summary, surfacedItems, runDate) {
  const dateStr = runDate.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const surfacedCount = summary.surfaced ?? 0;
  const filteredCount = summary.filtered ?? 0;
  const fetchedCount = summary.fetched ?? 0;

  const itemRows = surfacedItems.length > 0
    ? surfacedItems.map(renderSurfacedRow).join('')
    : `
        <tr>
          <td colspan="3" style="padding:16px 12px;color:#9ca3af;font-style:italic;">
            No items surfaced this run.
          </td>
        </tr>`;

  const sourceErrorHtml = (summary.sourceErrors && summary.sourceErrors.length > 0)
    ? `
      <div style="margin:24px 0;padding:12px 16px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;">
        <p style="margin:0 0 8px;font-weight:600;color:#b91c1c;">Source errors (${summary.sourceErrors.length})</p>
        <ul style="margin:0;padding-left:20px;color:#7f1d1d;">
          ${summary.sourceErrors.map(e => `<li>${escapeHtml(e.source)}: ${escapeHtml(e.error)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Scout Run Complete</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#111827;padding:24px 32px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
                Scout <span style="color:#6b7280;font-weight:400;">by HosTechnology</span>
              </p>
            </td>
          </tr>

          <!-- Title row -->
          <tr>
            <td style="padding:28px 32px 0;">
              <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;">
                Run Complete — ${surfacedCount} ${surfacedCount === 1 ? 'item' : 'items'} surfaced
              </h1>
              <p style="margin:0;font-size:14px;color:#6b7280;">${escapeHtml(dateStr)}</p>
            </td>
          </tr>

          <!-- Stats -->
          <tr>
            <td style="padding:24px 32px;">
              <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:14px 20px;border-right:1px solid #e5e7eb;text-align:center;">
                    <p style="margin:0;font-size:28px;font-weight:700;color:#111827;">${fetchedCount}</p>
                    <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Fetched</p>
                  </td>
                  <td style="padding:14px 20px;border-right:1px solid #e5e7eb;text-align:center;">
                    <p style="margin:0;font-size:28px;font-weight:700;color:#111827;">${filteredCount}</p>
                    <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Filtered out</p>
                  </td>
                  <td style="padding:14px 20px;text-align:center;">
                    <p style="margin:0;font-size:28px;font-weight:700;color:#059669;">${surfacedCount}</p>
                    <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Surfaced</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Surfaced items table -->
          <tr>
            <td style="padding:0 32px 24px;">
              <h2 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#374151;">Surfaced this run</h2>
              <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;border-collapse:collapse;">
                <thead>
                  <tr style="background:#f3f4f6;">
                    <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Org</th>
                    <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Title</th>
                    <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Why surfaced</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>
            </td>
          </tr>

          ${sourceErrorHtml}

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px;">
              <a href="${safeDashboardUrl(DASHBOARD_URL)}"
                 style="display:inline-block;padding:12px 24px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
                Review in Dashboard →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                Scout · HosTechnology · This is a notification-only email. Review and approve items in the dashboard.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── URL validation ────────────────────────────────────────────────────────────

/**
 * Return a safe, HTML-escaped dashboard URL for use in an href attribute.
 * Validates that the URL uses http or https — falls back to '#' if not.
 *
 * @param {string} url
 * @returns {string}
 */
function safeDashboardUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '#';
    }
  } catch (_) {
    return '#';
  }
  return escapeHtml(url);
}

// ── HTML escape ───────────────────────────────────────────────────────────────

/**
 * Escape special HTML characters to prevent injection in the email template.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a run-summary notification email via Resend.
 *
 * Errors are caught and logged — a failing email must never crash the pipeline.
 *
 * @param {object} summary       The run summary returned by the pipeline.
 * @param {Array}  [surfacedItems=[]]  Items that passed scoring (with .item and .scoreResult).
 * @returns {Promise<void>}
 */
async function sendRunSummaryEmail(summary, surfacedItems = []) {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.NOTIFICATION_EMAIL;

  if (!apiKey) {
    console.log('[email] RESEND_API_KEY not set — skipping notification email.');
    return;
  }

  if (!recipient) {
    console.log('[email] NOTIFICATION_EMAIL not set — skipping notification email.');
    return;
  }

  const surfacedCount = summary.surfaced ?? 0;
  const subject = `Scout Run Complete — ${surfacedCount} opportunities surfaced`;
  const runDate = new Date();
  const html = buildHtml(summary, surfacedItems, runDate);

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: [recipient],
      subject,
      html,
    });

    if (error) {
      console.error('[email] Resend API error:', error.message || JSON.stringify(error));
    } else {
      console.log(`[email] Notification sent (id: ${data.id}) → ${recipient}`);
    }
  } catch (err) {
    console.error(`[email] Failed to send notification email: ${err.message}`);
  }
}

module.exports = { sendRunSummaryEmail, buildHtml, escapeHtml, safeDashboardUrl };
