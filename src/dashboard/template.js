'use strict';

/**
 * Returns the full HTML string for the Scout dashboard single-page app.
 *
 * The page fetches data from the /api/* routes at runtime (client-side fetch)
 * so the server only needs to serve this static shell once.
 */
function renderPage() {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Scout — HosTechnology Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f7f8fa;
      --surface: #ffffff;
      --border: #e2e5ea;
      --text: #1a1d23;
      --text-muted: #6b7280;
      --accent: #2563eb;
      --accent-light: #eff4ff;
      --low-bg: #fff7ed;
      --low-border: #fb923c;
      --low-text: #9a3412;
      --badge-high: #16a34a;
      --badge-high-bg: #dcfce7;
      --badge-low: #dc2626;
      --badge-low-bg: #fee2e2;
      --score-bar: #2563eb;
      --filtered-bg: #f9fafb;
      --radius: 8px;
      --shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.05);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 15px;
      line-height: 1.5;
    }

    /* ── Header ─────────────────────────────────────────────── */
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    header h1 {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }
    header .subtitle {
      font-size: 13px;
      color: var(--text-muted);
    }
    #last-updated {
      margin-left: auto;
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ── Tabs ───────────────────────────────────────────────── */
    .tab-bar {
      display: flex;
      gap: 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 3px solid transparent;
      padding: 14px 20px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      transition: color .15s, border-color .15s;
    }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .tab-btn .badge {
      display: inline-block;
      background: var(--accent-light);
      color: var(--accent);
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 7px;
      margin-left: 6px;
    }

    /* ── Content area ───────────────────────────────────────── */
    .tab-panel { display: none; padding: 24px; max-width: 960px; margin: 0 auto; }
    .tab-panel.active { display: block; }

    /* ── Cards ──────────────────────────────────────────────── */
    .cards { display: flex; flex-direction: column; gap: 16px; }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: var(--shadow);
    }
    .card.low-confidence {
      background: var(--low-bg);
      border-color: var(--low-border);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
    }
    .card-title-block { flex: 1; min-width: 0; }
    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
      text-decoration: none;
    }
    .card-title:hover { text-decoration: underline; color: var(--accent); }
    .card-org { font-size: 13px; color: var(--text-muted); margin-top: 2px; }

    .card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      align-items: center;
    }
    .meta-item {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 8px;
    }
    .meta-item strong { color: var(--text); }

    /* score pill */
    .score-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 4px;
      padding: 2px 8px;
      border: 1px solid var(--border);
      background: var(--bg);
    }
    .score-bar {
      width: 60px;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      overflow: hidden;
    }
    .score-fill { height: 100%; background: var(--score-bar); border-radius: 3px; }

    /* confidence badge */
    .conf-badge {
      font-size: 11px;
      font-weight: 700;
      border-radius: 10px;
      padding: 2px 8px;
    }
    .conf-high { background: var(--badge-high-bg); color: var(--badge-high); }
    .conf-low  { background: var(--badge-low-bg);  color: var(--badge-low);  }

    /* low-confidence callout */
    .low-conf-notice {
      font-size: 12px;
      color: var(--low-text);
      font-weight: 600;
      margin-bottom: 8px;
    }

    .surface-reason {
      font-size: 13px;
      color: var(--text);
      margin-top: 10px;
      font-style: italic;
    }

    /* expandable description */
    .expand-btn {
      background: none;
      border: none;
      color: var(--accent);
      font-size: 12px;
      cursor: pointer;
      padding: 6px 0 0;
      font-weight: 600;
    }
    .expand-btn:hover { text-decoration: underline; }
    .description-preview {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 6px;
      display: none;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .description-preview.open { display: block; }

    /* ── Empty state ─────────────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
      font-size: 14px;
    }

    /* ── Filtered section ────────────────────────────────────── */
    .filtered-section { margin-top: 32px; }
    .filtered-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      background: none;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      width: 100%;
      text-align: left;
    }
    .filtered-toggle:hover { background: var(--bg); }
    .filtered-toggle .arrow { transition: transform .2s; }
    .filtered-toggle.open .arrow { transform: rotate(180deg); }

    .filtered-list {
      display: none;
      margin-top: 8px;
      background: var(--filtered-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .filtered-list.open { display: block; }

    .filtered-item {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: 12px;
      transition: opacity 0.4s;
    }
    .filtered-item:last-child { border-bottom: none; }
    .filtered-item-info { flex: 1; min-width: 0; }
    .filtered-item-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .filtered-item-org {
      font-size: 12px;
      color: var(--text-muted);
    }
    .filtered-item-reason {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .filtered-type-badge {
      font-size: 11px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 6px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Loading / Error ─────────────────────────────────────── */
    .loading { text-align: center; padding: 32px; color: var(--text-muted); }
    .error-msg {
      background: #fee2e2;
      border: 1px solid #fca5a5;
      border-radius: var(--radius);
      padding: 12px 16px;
      font-size: 13px;
      color: #991b1b;
    }

    /* ── Responsive ──────────────────────────────────────────── */
    @media (max-width: 600px) {
      header { padding: 12px 16px; }
      .tab-bar { padding: 0 16px; }
      .tab-panel { padding: 16px; }
      .tab-btn { padding: 12px 12px; font-size: 13px; }
    }

    /* ── Action buttons ──────────────────────────────────────── */
    .card-actions {
      display: flex;
      gap: 8px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: none;
      border-radius: 6px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s, background .15s;
    }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .btn-approve { background: #16a34a; color: #fff; }
    .btn-approve:hover:not(:disabled) { background: #15803d; }
    .btn-skip    { background: var(--bg); color: var(--text-muted); border: 1px solid var(--border); }
    .btn-skip:hover:not(:disabled)    { background: #f1f3f5; }
    .btn-edit    { background: var(--accent-light); color: var(--accent); border: 1px solid #bcd0fb; }
    .btn-edit:hover:not(:disabled)    { background: #dde9ff; }
    .btn-sent    { background: #6b7280; color: #fff; font-size: 12px; padding: 5px 10px; }
    .btn-sent:hover:not(:disabled)    { background: #4b5563; }

    /* ── Approved queue ──────────────────────────────────────── */
    .approved-queue {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: var(--radius);
      padding: 16px 20px;
      margin-bottom: 24px;
    }
    .approved-queue h2 {
      font-size: 14px;
      font-weight: 700;
      color: #15803d;
      margin-bottom: 10px;
    }
    .approved-list { display: flex; flex-direction: column; gap: 8px; }
    .approved-item {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 10px 14px;
      flex-wrap: wrap;
    }
    .approved-item-info { flex: 1; min-width: 0; }
    .approved-item-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .approved-item-org { font-size: 12px; color: var(--text-muted); }
    .approved-item-doc {
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
      white-space: nowrap;
    }
    .approved-item-doc:hover { text-decoration: underline; }
    .approved-sent-badge {
      font-size: 11px;
      background: #e5e7eb;
      color: #374151;
      border-radius: 10px;
      padding: 2px 8px;
      font-weight: 700;
      white-space: nowrap;
    }

    /* ── Edit modal ──────────────────────────────────────────── */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.45);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: var(--surface);
      border-radius: var(--radius);
      box-shadow: 0 8px 32px rgba(0,0,0,.18);
      width: 100%;
      max-width: 680px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    .modal-header h3 { font-size: 16px; font-weight: 700; }
    .modal-close {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: var(--text-muted);
      line-height: 1;
      padding: 2px 6px;
    }
    .modal-close:hover { color: var(--text); }
    .modal-body { padding: 16px 20px; flex: 1; overflow-y: auto; }
    .modal-body label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .modal-body textarea {
      width: 100%;
      min-height: 240px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 13px;
      font-family: inherit;
      line-height: 1.6;
      resize: vertical;
      color: var(--text);
    }
    .modal-body textarea:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 20px;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>

<header>
  <div>
    <h1>Scout</h1>
    <div class="subtitle">HosTechnology · Business Development Dashboard</div>
  </div>
  <span id="last-updated"></span>
</header>

<nav class="tab-bar" role="tablist">
  <button class="tab-btn active" role="tab" aria-selected="true" data-tab="opportunities">
    Opportunities <span class="badge" id="opp-count">…</span>
  </button>
  <button class="tab-btn" role="tab" aria-selected="false" data-tab="leads">
    Leads <span class="badge" id="leads-count">…</span>
  </button>
</nav>

<main>
  <section id="tab-opportunities" class="tab-panel active" role="tabpanel">
    <div class="approved-queue" id="opp-approved-queue" style="display:none">
      <h2>✓ Approved</h2>
      <div class="approved-list" id="opp-approved-list"></div>
    </div>
    <div id="opp-cards" class="cards"><div class="loading">Loading…</div></div>
    <div class="filtered-section" id="opp-filtered-section" style="display:none">
      <button class="filtered-toggle" id="opp-filtered-toggle">
        <span class="arrow">▼</span>
        <span id="opp-filtered-label">Filtered items</span>
      </button>
      <div class="filtered-list" id="opp-filtered-list"></div>
    </div>
  </section>

  <section id="tab-leads" class="tab-panel" role="tabpanel">
    <div class="approved-queue" id="leads-approved-queue" style="display:none">
      <h2>✓ Approved</h2>
      <div class="approved-list" id="leads-approved-list"></div>
    </div>
    <div id="leads-cards" class="cards"><div class="loading">Loading…</div></div>
    <div class="filtered-section" id="leads-filtered-section" style="display:none">
      <button class="filtered-toggle" id="leads-filtered-toggle">
        <span class="arrow">▼</span>
        <span id="leads-filtered-label">Filtered items</span>
      </button>
      <div class="filtered-list" id="leads-filtered-list"></div>
    </div>
  </section>
</main>

<!-- Edit modal -->
<div class="modal-overlay" id="edit-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <div class="modal">
    <div class="modal-header">
      <h3 id="modal-title">Edit Draft</h3>
      <button class="modal-close" onclick="closeEditModal()" aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      <label for="modal-draft-text">Draft text</label>
      <textarea id="modal-draft-text" placeholder="Draft proposal or outreach message…"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-skip" onclick="closeEditModal()">Cancel</button>
      <button class="btn btn-edit" onclick="saveDraftOnly()" id="modal-save-btn">Save draft</button>
      <button class="btn btn-approve" onclick="saveAndApprove()" id="modal-approve-btn">Save &amp; Approve</button>
    </div>
  </div>
</div>

<script>
  // ── Constants ─────────────────────────────────────────────────────────────
  // FADE_OUT_MS must match the CSS opacity transition duration on .filtered-item.
  const FADE_OUT_MS = 400;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ── Filtered section toggle ───────────────────────────────────────────────
  function wireFilterToggle(toggleId, listId) {
    const btn = document.getElementById(toggleId);
    const list = document.getElementById(listId);
    btn.addEventListener('click', () => {
      const open = list.classList.toggle('open');
      btn.classList.toggle('open', open);
    });
  }
  wireFilterToggle('opp-filtered-toggle', 'opp-filtered-list');
  wireFilterToggle('leads-filtered-toggle', 'leads-filtered-list');

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return iso; }
  }

  function scoreBar(score) {
    const pct = Math.round((Number(score) / 20) * 100);
    return \`<div class="score-bar"><div class="score-fill" style="width:\${pct}%"></div></div>\`;
  }

  // ── Opportunity card ──────────────────────────────────────────────────────
  function oppCard(item, idx) {
    const isLow = item.confidence === 'low';
    const hasDesc = Boolean(item.description);
    const hasSurface = Boolean(item.surface_reason);
    return \`
<div class="card\${isLow ? ' low-confidence' : ''}" data-id="\${esc(item.id)}" id="card-opp-\${esc(item.id)}">
  \${isLow ? '<div class="low-conf-notice">⚠ Low confidence — key details may be missing</div>' : ''}
  <div class="card-header">
    <div class="card-title-block">
      \${item.url
        ? \`<a class="card-title" href="\${esc(item.url)}" target="_blank" rel="noopener">\${esc(item.title)}</a>\`
        : \`<span class="card-title">\${esc(item.title)}</span>\`}
      <div class="card-org">\${esc(item.org)}</div>
    </div>
    <span class="conf-badge conf-\${esc(item.confidence)}">\${esc(item.confidence)} confidence</span>
  </div>
  <div class="card-meta">
    \${item.source ? \`<span class="meta-item"><strong>Source:</strong> \${esc(item.source)}</span>\` : ''}
    \${item.deadline ? \`<span class="meta-item"><strong>Deadline:</strong> \${esc(formatDate(item.deadline))}</span>\` : ''}
    \${item.budget ? \`<span class="meta-item"><strong>Budget:</strong> \${esc(item.budget)}</span>\` : ''}
    <span class="score-pill">\${scoreBar(item.score)} <strong>\${esc(item.score)}/20</strong></span>
  </div>
  \${hasSurface ? \`<div class="surface-reason">"\${esc(item.surface_reason)}"</div>\` : ''}
  \${hasDesc ? \`
  <button class="expand-btn" onclick="toggleDesc(this)" data-idx="\${idx}">▸ Show description</button>
  <div class="description-preview" id="desc-opp-\${idx}">\${esc(item.description)}</div>
  \` : ''}
  <div class="card-actions">
    <button class="btn btn-approve" onclick="approveItem('opportunity', '\${esc(item.id)}', this)">✓ Approve</button>
    <button class="btn btn-edit" data-type="opportunity" data-id="\${esc(item.id)}" data-title="\${esc(item.title || item.org || '')}" data-draft="\${esc(item.draft_text || item.description || '')}" onclick="openEditModal(this)">✎ Edit draft</button>
    <button class="btn btn-skip" onclick="skipItem('opportunity', '\${esc(item.id)}', this)">✕ Skip</button>
  </div>
</div>\`;
  }

  // ── Lead card ─────────────────────────────────────────────────────────────
  function leadCard(item, idx) {
    const isLow = item.confidence === 'low';
    const hasDesc = Boolean(item.mission_summary);
    const hasSurface = Boolean(item.surface_reason);
    return \`
<div class="card\${isLow ? ' low-confidence' : ''}" data-id="\${esc(item.id)}" id="card-lead-\${esc(item.id)}">
  \${isLow ? '<div class="low-conf-notice">⚠ Low confidence — key details may be missing</div>' : ''}
  <div class="card-header">
    <div class="card-title-block">
      <span class="card-title">\${esc(item.org)}</span>
      <div class="card-org">Funded by \${esc(item.funder)}</div>
    </div>
    <span class="conf-badge conf-\${esc(item.confidence)}">\${esc(item.confidence)} confidence</span>
  </div>
  <div class="card-meta">
    \${item.funder ? \`<span class="meta-item"><strong>Funder:</strong> \${esc(item.funder)}</span>\` : ''}
    \${item.funding_date ? \`<span class="meta-item"><strong>Announced:</strong> \${esc(formatDate(item.funding_date))}</span>\` : ''}
    \${item.funding_amount ? \`<span class="meta-item"><strong>Amount:</strong> \${esc(item.funding_amount)}</span>\` : ''}
    <span class="score-pill">\${scoreBar(item.score)} <strong>\${esc(item.score)}/20</strong></span>
  </div>
  \${hasSurface ? \`<div class="surface-reason">"\${esc(item.surface_reason)}"</div>\` : ''}
  \${hasDesc ? \`
  <button class="expand-btn" onclick="toggleDesc(this)" data-idx="\${idx}">▸ Show summary</button>
  <div class="description-preview" id="desc-lead-\${idx}">\${esc(item.mission_summary)}</div>
  \` : ''}
  <div class="card-actions">
    <button class="btn btn-approve" onclick="approveItem('lead', '\${esc(item.id)}', this)">✓ Approve</button>
    <button class="btn btn-edit" data-type="lead" data-id="\${esc(item.id)}" data-title="\${esc(item.org || '')}" data-draft="\${esc(item.draft_text || item.mission_summary || '')}" onclick="openEditModal(this)">✎ Edit draft</button>
    <button class="btn btn-skip" onclick="skipItem('lead', '\${esc(item.id)}', this)">✕ Skip</button>
  </div>
</div>\`;
  }

  // ── Filtered item row ─────────────────────────────────────────────────────
  function filteredRow(item) {
    const displayTitle = item.title || item.org || item.item_id || '(untitled)';
    return \`
<div class="filtered-item">
  <div class="filtered-item-info">
    <div class="filtered-item-title">\${esc(displayTitle)}</div>
    \${item.org && item.title ? \`<div class="filtered-item-org">\${esc(item.org)}</div>\` : ''}
    <div class="filtered-item-reason">\${esc(item.filter_reason || 'No reason recorded.')}</div>
  </div>
  <span class="filtered-type-badge">\${esc(item.item_type || 'item')}</span>
  <button class="btn btn-skip" style="font-size:12px;padding:4px 10px" title="Good filter — correctly filtered"
    aria-label="Mark as good filter"
    data-corr-id="\${esc(item.id)}" data-feedback="good_filter"
    onclick="thumbFeedback(this)">👍</button>
  <button class="btn btn-edit" style="font-size:12px;padding:4px 10px" title="Bad filter — should have surfaced"
    aria-label="Mark as bad filter — should have surfaced"
    data-corr-id="\${esc(item.id)}" data-feedback="bad_filter"
    onclick="thumbFeedback(this)">👎</button>
</div>\`;
  }

  // ── Toggle description expand ─────────────────────────────────────────────
  function toggleDesc(btn) {
    const descEl = btn.nextElementSibling;
    const open = descEl.classList.toggle('open');
    if (!open) {
      btn.textContent = btn.dataset.showLabel || '▸ Show description';
    } else {
      if (!btn.dataset.showLabel) btn.dataset.showLabel = btn.textContent;
      btn.textContent = '▾ Hide';
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderCards(containerId, items, cardFn, badgeId) {
    const el = document.getElementById(containerId);
    document.getElementById(badgeId).textContent = items.length;
    if (!items.length) {
      el.innerHTML = '<div class="empty-state">No pending items. Run the pipeline to fetch new opportunities.</div>';
      return;
    }
    el.innerHTML = items.map((item, i) => cardFn(item, i)).join('');
  }

  function renderFiltered(listId, sectionId, labelId, items, type) {
    const section = document.getElementById(sectionId);
    const list = document.getElementById(listId);
    const label = document.getElementById(labelId);
    if (!items.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    label.textContent = items.length + ' filtered item' + (items.length === 1 ? '' : 's') + ' from latest run';
    list.innerHTML = items.map(filteredRow).join('');
  }

  function renderApprovedQueue(listId, queueId, items, type) {
    const queue = document.getElementById(queueId);
    const list = document.getElementById(listId);
    if (!items.length) { queue.style.display = 'none'; return; }
    queue.style.display = '';
    list.innerHTML = items.map(item => approvedQueueItem(item, type)).join('');
  }

  function approvedQueueItem(item, type) {
    const title = type === 'opportunity' ? esc(item.title || item.org) : esc(item.org);
    const sub = type === 'opportunity' ? esc(item.org) : \`Funded by \${esc(item.funder)}\`;
    const isSent = item.status === 'sent';
    const docLink = item.draft_doc_link
      ? \`<a class="approved-item-doc" href="\${esc(item.draft_doc_link)}" target="_blank" rel="noopener">📄 View Doc</a>\`
      : '<span style="font-size:12px;color:var(--text-muted)">No doc yet</span>';
    return \`
<div class="approved-item" id="approved-\${esc(item.id)}">
  <div class="approved-item-info">
    <div class="approved-item-title">\${title}</div>
    <div class="approved-item-org">\${sub}</div>
  </div>
  \${docLink}
  \${isSent
    ? '<span class="approved-sent-badge">✓ Sent</span>'
    : \`<button class="btn btn-sent" onclick="markSent('\${type}', '\${esc(item.id)}', this)">Mark as sent</button>\`
  }
</div>\`;
  }

  function showError(containerId, msg) {
    document.getElementById(containerId).innerHTML =
      \`<div class="error-msg">Failed to load data: \${esc(msg)}</div>\`;
  }

  // ── Action: Approve ───────────────────────────────────────────────────────
  async function approveItem(type, id, btn) {
    const btns = btn.closest('.card-actions').querySelectorAll('button');
    btns.forEach(b => b.disabled = true);
    const endpoint = type === 'opportunity' ? \`/api/opportunities/\${encodeURIComponent(id)}/status\` : \`/api/leads/\${encodeURIComponent(id)}/status\`;
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      // Remove card from pending list
      const card = document.getElementById(\`card-\${type === 'opportunity' ? 'opp' : 'lead'}-\${id}\`);
      if (card) card.remove();
      // Re-render approved queue
      await reloadApproved();
      // Update pending badge counts
      updatePendingBadge(type);
    } catch (e) {
      btns.forEach(b => b.disabled = false);
      alert('Error approving: ' + e.message);
    }
  }

  // ── Action: Skip ──────────────────────────────────────────────────────────
  async function skipItem(type, id, btn) {
    const btns = btn.closest('.card-actions').querySelectorAll('button');
    btns.forEach(b => b.disabled = true);
    const endpoint = type === 'opportunity' ? \`/api/opportunities/\${encodeURIComponent(id)}/status\` : \`/api/leads/\${encodeURIComponent(id)}/status\`;
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'skipped' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      const card = document.getElementById(\`card-\${type === 'opportunity' ? 'opp' : 'lead'}-\${id}\`);
      if (card) card.remove();
      updatePendingBadge(type);
    } catch (e) {
      btns.forEach(b => b.disabled = false);
      alert('Error skipping: ' + e.message);
    }
  }

  // ── Action: Mark as sent ──────────────────────────────────────────────────
  async function markSent(type, id, btn) {
    btn.disabled = true;
    const endpoint = type === 'opportunity' ? \`/api/opportunities/\${encodeURIComponent(id)}/status\` : \`/api/leads/\${encodeURIComponent(id)}/status\`;
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      // Replace button with badge
      btn.outerHTML = '<span class="approved-sent-badge">✓ Sent</span>';
    } catch (e) {
      btn.disabled = false;
      alert('Error updating status: ' + e.message);
    }
  }

  // ── Action: Thumb feedback on filtered items ──────────────────────────────
  async function thumbFeedback(btn) {
    // Disable both thumb buttons on this row to prevent conflicting double-submits
    const row = btn.closest('.filtered-item');
    const rowBtns = row ? Array.from(row.querySelectorAll('button[data-feedback]')) : [btn];
    rowBtns.forEach(b => { b.disabled = true; });
    const { corrId, feedback } = btn.dataset;
    try {
      const res = await fetch('/api/corrections/' + encodeURIComponent(corrId) + '/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      // Visual confirmation: fade the row out, remove it, and update the section label count
      if (row) {
        row.style.opacity = '0';
        setTimeout(() => {
          const list = row.closest('.filtered-list');
          const section = list ? list.closest('.filtered-section') : null;
          const labelEl = section ? section.querySelector('.filtered-toggle span:last-child') : null;
          row.remove();
          if (section && list && labelEl) {
            const remaining = list.querySelectorAll('.filtered-item').length;
            if (remaining === 0) {
              section.style.display = 'none';
            } else {
              labelEl.textContent = remaining + ' filtered item' + (remaining === 1 ? '' : 's') + ' from latest run';
            }
          }
        }, FADE_OUT_MS + 20);
      }
    } catch (e) {
      rowBtns.forEach(b => { b.disabled = false; });
      alert('Error saving feedback: ' + e.message);
    }
  }

  // ── Edit modal state ──────────────────────────────────────────────────────
  let _modalType = null;
  let _modalId = null;

  function openEditModal(btn) {
    _modalType = btn.dataset.type;
    _modalId = btn.dataset.id;
    const title = btn.dataset.title || _modalId;
    document.getElementById('modal-title').textContent = 'Edit Draft — ' + title;
    // dataset values are HTML-decoded automatically by the browser
    document.getElementById('modal-draft-text').value = btn.dataset.draft || '';
    document.getElementById('edit-modal').classList.add('open');
    document.getElementById('modal-draft-text').focus();
  }

  function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('open');
    _modalType = null;
    _modalId = null;
  }

  async function saveDraftOnly() {
    if (!_modalType || !_modalId) return;
    const saveBtn = document.getElementById('modal-save-btn');
    const approveBtn = document.getElementById('modal-approve-btn');
    saveBtn.disabled = true;
    approveBtn.disabled = true;
    const text = document.getElementById('modal-draft-text').value;
    const endpoint = _modalType === 'opportunity'
      ? \`/api/opportunities/\${encodeURIComponent(_modalId)}/draft\`
      : \`/api/leads/\${encodeURIComponent(_modalId)}/draft\`;
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_text: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      closeEditModal();
    } catch (e) {
      saveBtn.disabled = false;
      approveBtn.disabled = false;
      alert('Error saving draft: ' + e.message);
    }
  }

  async function saveAndApprove() {
    if (!_modalType || !_modalId) return;
    const saveBtn = document.getElementById('modal-save-btn');
    const approveBtn = document.getElementById('modal-approve-btn');
    saveBtn.disabled = true;
    approveBtn.disabled = true;
    const text = document.getElementById('modal-draft-text').value;
    const type = _modalType;
    const id = _modalId;
    const draftEndpoint = type === 'opportunity'
      ? \`/api/opportunities/\${encodeURIComponent(id)}/draft\`
      : \`/api/leads/\${encodeURIComponent(id)}/draft\`;
    const statusEndpoint = type === 'opportunity'
      ? \`/api/opportunities/\${encodeURIComponent(id)}/status\`
      : \`/api/leads/\${encodeURIComponent(id)}/status\`;
    let draftSaved = false;
    try {
      const draftRes = await fetch(draftEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_text: text }),
      });
      if (!draftRes.ok) {
        const err = await draftRes.json().catch(() => ({ error: draftRes.statusText }));
        throw new Error(err.error || draftRes.statusText);
      }
      draftSaved = true;
      const statusRes = await fetch(statusEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!statusRes.ok) {
        const err = await statusRes.json().catch(() => ({ error: statusRes.statusText }));
        throw new Error(err.error || statusRes.statusText);
      }
      closeEditModal();
      // Remove card from pending list
      const card = document.getElementById(\`card-\${type === 'opportunity' ? 'opp' : 'lead'}-\${id}\`);
      if (card) card.remove();
      updatePendingBadge(type);
      await reloadApproved();
    } catch (e) {
      saveBtn.disabled = false;
      approveBtn.disabled = false;
      const msg = draftSaved
        ? \`Draft saved, but approval failed: \${e.message}. You can close this dialog and try approving again.\`
        : \`Error saving draft: \${e.message}\`;
      alert(msg);
    }
  }

  // Close modal when clicking outside
  document.getElementById('edit-modal').addEventListener('click', function(e) {
    if (e.target === this) closeEditModal();
  });
  // Close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeEditModal();
  });

  // ── Reload approved queues ────────────────────────────────────────────────
  async function reloadApproved() {
    const [approvedOpps, approvedLeads] = await Promise.all([
      fetch('/api/opportunities/approved').then(r => r.json()).catch(() => []),
      fetch('/api/leads/approved').then(r => r.json()).catch(() => []),
    ]);
    renderApprovedQueue('opp-approved-list', 'opp-approved-queue', Array.isArray(approvedOpps) ? approvedOpps : [], 'opportunity');
    renderApprovedQueue('leads-approved-list', 'leads-approved-queue', Array.isArray(approvedLeads) ? approvedLeads : [], 'lead');
  }

  // ── Update pending badge count ────────────────────────────────────────────
  function updatePendingBadge(type) {
    const containerId = type === 'opportunity' ? 'opp-cards' : 'leads-cards';
    const badgeId = type === 'opportunity' ? 'opp-count' : 'leads-count';
    const count = document.getElementById(containerId).querySelectorAll('.card').length;
    document.getElementById(badgeId).textContent = count;
  }

  // ── Fetch & render ────────────────────────────────────────────────────────
  async function loadAll() {
    const [opps, leads, filtered] = await Promise.all([
      fetch('/api/opportunities').then(r => r.json()).catch(e => ({ error: e.message })),
      fetch('/api/leads').then(r => r.json()).catch(e => ({ error: e.message })),
      fetch('/api/filtered').then(r => r.json()).catch(e => []),
    ]);

    // Opportunities
    if (opps.error) {
      showError('opp-cards', opps.error);
      document.getElementById('opp-count').textContent = '!';
    } else {
      renderCards('opp-cards', opps, oppCard, 'opp-count');
    }

    // Leads
    if (leads.error) {
      showError('leads-cards', leads.error);
      document.getElementById('leads-count').textContent = '!';
    } else {
      renderCards('leads-cards', leads, leadCard, 'leads-count');
    }

    // Filtered — split by type for each tab
    const filteredArr = Array.isArray(filtered) ? filtered : [];
    const oppFiltered = filteredArr.filter(f => f.item_type !== 'lead');
    const leadFiltered = filteredArr.filter(f => f.item_type === 'lead');
    renderFiltered('opp-filtered-list', 'opp-filtered-section', 'opp-filtered-label', oppFiltered, 'opportunity');
    renderFiltered('leads-filtered-list', 'leads-filtered-section', 'leads-filtered-label', leadFiltered, 'lead');

    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString();
  }

  Promise.all([loadAll(), reloadApproved()]);
</script>
</body>
</html>`;
}

module.exports = { renderPage };
