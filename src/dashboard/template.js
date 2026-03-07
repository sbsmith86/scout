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

<script>
  // ── Tab switching ─────────────────────────────────────────────────────────
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
<div class="card\${isLow ? ' low-confidence' : ''}" data-id="\${esc(item.id)}">
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
</div>\`;
  }

  // ── Lead card ─────────────────────────────────────────────────────────────
  function leadCard(item, idx) {
    const isLow = item.confidence === 'low';
    const hasDesc = Boolean(item.mission_summary);
    const hasSurface = Boolean(item.surface_reason);
    return \`
<div class="card\${isLow ? ' low-confidence' : ''}" data-id="\${esc(item.id)}">
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

  function showError(containerId, msg) {
    document.getElementById(containerId).innerHTML =
      \`<div class="error-msg">Failed to load data: \${esc(msg)}</div>\`;
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

  loadAll();
</script>
</body>
</html>`;
}

module.exports = { renderPage };
