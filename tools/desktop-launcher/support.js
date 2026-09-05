'use strict';

// ─── Support tab (v1.2.24+) ─────────────────────────────────────────────────────
// Lets the launcher operator create WhatsApp-bound support tickets that the
// office sees on their phone. Tickets go to D1 via the local server (which
// proxies to the cloud Worker), and the office replies either on their
// personal WhatsApp (Phase 1) or via the office-side whatsapp-web.js bot
// (Phase 2, ships later).
//
// Renders into the #supportMount container that index.html provides. No
// state lives outside the DOM except the cached ticket list (refreshed on
// each show). All API calls go through window.api.fetch (the launcher's
// IPC bridge to the local server) so the same code works in dev and in
// the packaged .exe.

(function () {
  const CATEGORIES = [
    { v: 'login',     label: 'Login / account',     desc: 'Can\'t log in, locked out, wrong barcode' },
    { v: 'app',       label: 'App crash / bug',     desc: 'App froze, wrong number, error message' },
    { v: 'network',   label: 'Network / LAN / Wi-Fi', desc: 'Tablets offline, Wi-Fi down, port unreachable' },
    { v: 'hardware',  label: 'Hardware',            desc: 'Scanner, tablet, PC beeping, screen flicker' },
    { v: 'catalog',   label: 'Catalog / Roster',    desc: 'Wrong abaya style, missing employee, photo won\'t sync' },
    { v: 'other',     label: 'Other',               desc: 'Anything else — describe below' },
  ];

  const STATUS_LABELS = {
    open: 'Open',
    pending: 'Pending office reply',
    resolved: 'Resolved',
    closed: 'Closed',
  };

  // ── Persistence helpers (localStorage; lives per-launcher-install) ──
  const LS_OP = 'support.operator_emp_id';
  const LS_OP_NAME = 'support.operator_name';
  const LS_LAST_TICKET = 'support.last_ticket_id';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmtTime(sec) {
    if (!sec) return '-';
    const d = new Date(sec * 1000);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function relTime(sec) {
    if (!sec) return '-';
    const diff = Date.now() / 1000 - sec;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // ── IPC bridge — talks to the main process which proxies to the local
  // server (which forwards to the cloud Worker). The launcher can also
  // call the cloud Worker directly via shell.openExternal, but we keep
  // all ticket CRUD here so the local server can log + audit it.
  async function api(path, opts) {
    const bridge = window.abayaLauncher;
    if (!bridge || typeof bridge.apiFetch !== 'function') {
      return { ok: false, error: 'launcher bridge not available' };
    }
    // Normalize: stringify body if it's an object, pass through if string.
    const o = Object.assign({}, opts || {});
    if (o.body && typeof o.body === 'object') o.body = JSON.stringify(o.body);
    const r = await bridge.apiFetch(path, o);
    if (!r) return { ok: false, error: 'no response' };
    if (r.body) return r.body;          // new IPC format: {status, body}
    return r;                             // legacy: direct return
  }

  async function openExternal(url) {
    const bridge = window.abayaLauncher;
    if (bridge && typeof bridge.openExternal === 'function') return bridge.openExternal(url);
    if (bridge && typeof bridge.openUrl === 'function') return bridge.openUrl(url);
    window.open(url, '_blank');
    return null;
  }

  // ── State ──
  const state = {
    operatorEmpId: localStorage.getItem(LS_OP) || '',
    operatorName: localStorage.getItem(LS_OP_NAME) || '',
    tickets: [],
    activeId: null,
    detail: null,           // { ticket, events, messages }
    pollTimer: null,
    config: { primary: '', fallback: [] },
    submitting: false,
  };

  // ── Mount the Support tab into the host container ──
  function render() {
    const mount = document.getElementById('supportMount');
    if (!mount) return;
    mount.innerHTML = `
      <div class="support-shell">
        <header class="support-head">
          <div class="support-head__title">
            <span class="support-head__eyebrow">Support</span>
            <h2>Get help from the office</h2>
            <p>Create a ticket — opens WhatsApp on the office's number with the details pre-filled.</p>
          </div>
          <div class="support-head__who">
            <label>Operator (you)</label>
            <div class="support-who">
              <input type="text" id="supportOpId" placeholder="e_bc_00000129" value="${esc(state.operatorEmpId)}" />
              <input type="text" id="supportOpName" placeholder="Name (optional)" value="${esc(state.operatorName)}" />
              <button type="button" id="supportSaveOp" class="ghost">Save</button>
            </div>
            <div class="support-config" id="supportConfig"></div>
          </div>
        </header>

        <div class="support-grid">
          <section class="support-card support-create">
            <h3>New ticket</h3>
            <form id="supportForm">
              <label>Category
                <select id="supportCategory" required>
                  <option value="">Choose one…</option>
                  ${CATEGORIES.map(c => `<option value="${esc(c.v)}">${esc(c.label)}</option>`).join('')}
                </select>
              </label>
              <label>Priority
                <select id="supportPriority">
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent — production stopped</option>
                </select>
              </label>
              <label>Subject
                <input type="text" id="supportSubject" maxlength="120" required placeholder="One-line summary" />
              </label>
              <label>Description
                <textarea id="supportDescription" rows="5" maxlength="4000" required placeholder="What happened, what you tried, what you expected…"></textarea>
              </label>
              <div class="support-form-foot">
                <span class="support-form-hint" id="supportFormHint"></span>
                <button type="submit" class="primary" id="supportSubmit">Create &amp; send via WhatsApp</button>
              </div>
            </form>
          </section>

          <section class="support-card support-list">
            <header class="support-list-head">
              <h3>Tickets</h3>
              <div class="support-list-filters">
                <button type="button" data-filter="open" class="ghost active">Open</button>
                <button type="button" data-filter="pending" class="ghost">Pending</button>
                <button type="button" data-filter="resolved" class="ghost">Resolved</button>
                <button type="button" data-filter="all" class="ghost">All</button>
              </div>
            </header>
            <div id="supportTickets" class="support-tickets"></div>
          </section>

          <section class="support-card support-detail" id="supportDetail" hidden>
            <header class="support-detail-head">
              <div>
                <span class="support-detail-id" id="supportDetailId"></span>
                <h3 id="supportDetailSubject"></h3>
                <div class="support-detail-meta" id="supportDetailMeta"></div>
              </div>
              <button type="button" class="ghost" id="supportCloseDetail" title="Close">×</button>
            </header>
            <div class="support-thread" id="supportThread"></div>
            <div class="support-detail-foot">
              <button type="button" class="primary" id="supportResolve">Mark resolved</button>
              <span class="support-detail-hint">Or wait — office replies appear here in real time.</span>
            </div>
          </section>
        </div>
      </div>
    `;

    // Wire up the freshly-rendered DOM
    $('#supportSaveOp').addEventListener('click', saveOperator);
    $('#supportForm').addEventListener('submit', onSubmit);
    $('#supportCloseDetail').addEventListener('click', closeDetail);
    $('#supportResolve').addEventListener('click', onResolve);
    $all('.support-list-filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        $all('.support-list-filters button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Re-fetch on every filter click so the preview mock (and any
        // future server-side filter) can change what shows. Cheap call.
        refreshList();
      });
    });
    refreshConfig();
    refreshList();
  }

  function saveOperator() {
    state.operatorEmpId = ($('#supportOpId').value || '').trim();
    state.operatorName = ($('#supportOpName').value || '').trim();
    localStorage.setItem(LS_OP, state.operatorEmpId);
    localStorage.setItem(LS_OP_NAME, state.operatorName);
    flashHint('supportFormHint', 'Saved. You can now create tickets as this operator.', 'ok');
  }

  async function refreshConfig() {
    try {
      const r = await api('/api/worker-settings/support', { method: 'GET' });
      if (r && r.ok) {
        state.config = { primary: r.primary || '', fallback: r.fallback || [] };
        renderConfig();
      }
    } catch (e) { /* non-fatal */ }
  }

  function renderConfig() {
    const el = $('#supportConfig');
    if (!el) return;
    const fallback = state.config.fallback && state.config.fallback.length
      ? ` · fallback: ${state.config.fallback.map(esc).join(', ')}`
      : ' · no fallback configured';
    el.innerHTML = `
      <div class="support-config-row">
        <span>Office primary:</span>
        <code>${esc(state.config.primary || 'NOT SET')}</code>
        ${state.config.fallback && state.config.fallback.length ? `<span>${esc(fallback)}</span>` : `<span class="muted">${esc(fallback)}</span>`}
      </div>
      <details>
        <summary>Change office number</summary>
        <div class="support-config-edit">
          <input type="text" id="supportOfficeInput" placeholder="+971...,+971..." value="${esc([state.config.primary].concat(state.config.fallback).filter(Boolean).join(','))}" />
          <button type="button" id="supportOfficeSave" class="ghost">Save</button>
          <p class="muted">E.164 format. First number is the primary; rest are fallbacks (in order). Changes apply on the next ticket.</p>
        </div>
      </details>
    `;
    const saveBtn = $('#supportOfficeSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const csv = ($('#supportOfficeInput').value || '').trim();
        const r = await api('/api/worker-settings/support', { method: 'PUT', body: JSON.stringify({ office_numbers: csv }) });
        if (r && r.ok) {
          state.config = { primary: r.primary || '', fallback: r.fallback || [] };
          renderConfig();
          flashHint('supportFormHint', 'Office numbers updated.', 'ok');
        } else {
          flashHint('supportFormHint', 'Failed: ' + (r && r.error ? r.error : 'unknown'), 'err');
        }
      });
    }
  }

  function flashHint(id, msg, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'support-form-hint' + (kind ? ' ' + kind : '');
    if (kind === 'ok') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.className = 'support-form-hint'; } }, 4000);
  }

  // ── Create ticket ──
  async function onSubmit(e) {
    e.preventDefault();
    if (state.submitting) return;
    const empId = state.operatorEmpId || ($('#supportOpId').value || '').trim();
    const name = state.operatorName || ($('#supportOpName').value || '').trim();
    if (!empId || !/^e_bc_\d+$/.test(empId)) {
      flashHint('supportFormHint', 'Set your operator ID (e_bc_<digits>) at the top right first.', 'err');
      return;
    }
    const category = $('#supportCategory').value;
    const priority = $('#supportPriority').value;
    const subject = $('#supportSubject').value.trim();
    const description = $('#supportDescription').value.trim();
    if (!category || !subject || !description) {
      flashHint('supportFormHint', 'Fill category, subject, and description.', 'err');
      return;
    }
    state.submitting = true;
    $('#supportSubmit').disabled = true;
    try {
      const r = await api('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({
          created_by: empId, created_by_name: name || null,
          category, priority, subject, description,
        }),
      });
      if (!r || !r.ok) {
        flashHint('supportFormHint', 'Failed: ' + (r && r.error ? r.error : 'unknown'), 'err');
        return;
      }
      // Open the wa.me link in the user's default browser via Electron.
      if (r.wa_url) {
        await openExternal(r.wa_url);
      }
      localStorage.setItem(LS_LAST_TICKET, r.ticket.id);
      $('#supportSubject').value = '';
      $('#supportDescription').value = '';
      flashHint('supportFormHint', 'Ticket ' + r.ticket.id + ' created. WhatsApp opened — tap send on your phone.', 'ok');
      refreshList(r.ticket.id);
    } catch (err) {
      flashHint('supportFormHint', 'Network error: ' + err.message, 'err');
    } finally {
      state.submitting = false;
      $('#supportSubmit').disabled = false;
    }
  }

  // ── List + filter ──
  let currentFilter = 'open';
  async function refreshList(openId) {
    try {
      const r = await api('/api/tickets?limit=100', { method: 'GET' });
      if (r && r.ok) state.tickets = r.tickets || [];
    } catch (e) { state.tickets = []; }
    renderTickets();
    if (openId) openDetail(openId);
  }

  function renderTickets() {
    const root = $('#supportTickets');
    if (!root) return;
    const filterBtn = document.querySelector('.support-list-filters button.active');
    currentFilter = filterBtn ? filterBtn.dataset.filter : 'open';
    let list = state.tickets;
    if (currentFilter !== 'all') list = list.filter(t => t.status === currentFilter);
    if (!list.length) {
      root.innerHTML = `<div class="support-empty">No ${currentFilter === 'all' ? '' : currentFilter} tickets yet.</div>`;
      return;
    }
    root.innerHTML = list.map(t => `
      <article class="support-ticket ${t.status === 'resolved' ? 'is-resolved' : ''}" data-id="${esc(t.id)}">
        <div class="support-ticket-row1">
          <span class="support-ticket-id">${esc(t.id)}</span>
          <span class="support-ticket-prio support-prio-${esc(t.priority)}">${esc(t.priority)}</span>
          <span class="support-ticket-status support-status-${esc(t.status)}">${esc(STATUS_LABELS[t.status] || t.status)}</span>
        </div>
        <div class="support-ticket-subject">${esc(t.subject)}</div>
        <div class="support-ticket-meta">
          <span>${esc(t.category)}</span>
          <span>·</span>
          <span>${esc(t.created_by_name || t.created_by)}</span>
          <span>·</span>
          <span title="${esc(fmtTime(t.last_message_at || t.created_at))}">${esc(relTime(t.last_message_at || t.created_at))}</span>
        </div>
      </article>
    `).join('');
    $all('.support-ticket', root).forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
  }

  // ── Detail view ──
  async function openDetail(id) {
    state.activeId = id;
    const r = await api('/api/tickets/' + encodeURIComponent(id), { method: 'GET' });
    if (!r || !r.ok) {
      flashHint('supportFormHint', 'Could not open ticket: ' + (r && r.error ? r.error : 'unknown'), 'err');
      return;
    }
    state.detail = r;
    renderDetail();
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (!state.activeId) return;
      const r2 = await api('/api/tickets/' + encodeURIComponent(state.activeId), { method: 'GET' });
      if (r2 && r2.ok) { state.detail = r2; renderDetail(); }
    }, 5000);
  }

  function closeDetail() {
    state.activeId = null;
    state.detail = null;
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    $('#supportDetail').hidden = true;
  }

  function renderDetail() {
    const d = state.detail;
    if (!d) return;
    $('#supportDetail').hidden = false;
    $('#supportDetailId').textContent = d.ticket.id;
    $('#supportDetailSubject').textContent = d.ticket.subject;
    const t = d.ticket;
    $('#supportDetailMeta').innerHTML = `
      <span class="support-prio-${esc(t.priority)}">${esc(t.priority)}</span>
      <span>${esc(t.category)}</span>
      <span>${esc(STATUS_LABELS[t.status] || t.status)}</span>
      <span>opened ${esc(relTime(t.created_at))}</span>
      ${t.resolved_at ? `<span>resolved ${esc(relTime(t.resolved_at))}</span>` : ''}
    `;
    const messages = d.messages || [];
    const events = d.events || [];
    // Merge events + messages into a single chronological timeline.
    const timeline = []
      .concat(events.map(e => ({ kind: 'event', at: e.at, event: e.event, actor: e.actor, note: e.note })))
      .concat(messages.map(m => ({ kind: 'message', at: m.sent_at, direction: m.direction, sender: m.sender, text: m.text, via: m.via })))
      .sort((a, b) => a.at - b.at);
    const html = timeline.map(item => {
      if (item.kind === 'event') {
        return `<div class="support-event">
          <span class="support-event-dot"></span>
          <span class="support-event-time">${esc(fmtTime(item.at))}</span>
          <span class="support-event-label">${esc(item.event)}</span>
          <span class="support-event-actor">${esc(item.actor)}</span>
          ${item.note ? `<span class="support-event-note">— ${esc(item.note)}</span>` : ''}
        </div>`;
      }
      const isOut = item.direction === 'out';
      return `<div class="support-msg ${isOut ? 'is-out' : 'is-in'}">
        <div class="support-msg-bubble">${esc(item.text)}</div>
        <div class="support-msg-meta">
          <span>${esc(item.sender)}</span>
          <span>·</span>
          <span>${esc(item.via)}</span>
          <span>·</span>
          <span>${esc(fmtTime(item.at))}</span>
        </div>
      </div>`;
    }).join('');
    $('#supportThread').innerHTML = html || '<div class="support-empty">No activity yet.</div>';
    // Scroll to bottom
    const threadEl = $('#supportThread');
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
    // Disable resolve if already resolved
    const btn = $('#supportResolve');
    if (btn) {
      btn.disabled = (t.status === 'resolved' || t.status === 'closed');
      btn.textContent = btn.disabled ? 'Already resolved' : 'Mark resolved';
    }
  }

  async function onResolve() {
    if (!state.activeId) return;
    const empId = state.operatorEmpId || '';
    const r = await api('/api/tickets/' + encodeURIComponent(state.activeId) + '/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolved_by: empId || 'office' }),
    });
    if (r && r.ok) {
      state.detail = { ticket: r.ticket, events: state.detail.events, messages: state.detail.messages };
      // Append a synthetic resolved event for the timeline
      state.detail.events = (state.detail.events || []).concat([{ at: Math.floor(Date.now()/1000), event: 'resolved', actor: empId || 'office' }]);
      renderDetail();
      refreshList();
    } else {
      flashHint('supportFormHint', 'Resolve failed: ' + (r && r.error ? r.error : 'unknown'), 'err');
    }
  }

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // Refresh list when the tab becomes visible (in case the operator navigates away).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshList(state.activeId); });
})();
