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
  // server (which forwards to the cloud Worker). ──
  async function api(path, opts) {
    const bridge = window.abayaLauncher;
    if (!bridge || typeof bridge.apiFetch !== 'function') {
      return { ok: false, error: 'launcher bridge not available' };
    }
    const o = Object.assign({}, opts || {});
    if (o.body && typeof o.body === 'object') o.body = JSON.stringify(o.body);
    const r = await bridge.apiFetch(path, o);
    if (!r) return { ok: false, error: 'no response' };
    if (r.body) return r.body;
    return r;
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
    detail: null,
    lastDetailSig: null,
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
              <button type="button" class="ghost" id="supportCloseDetail" title="Close (Esc)">×</button>
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

    $('#supportSaveOp').addEventListener('click', saveOperator);
    $('#supportForm').addEventListener('submit', onSubmit);
    $('#supportCloseDetail').addEventListener('click', closeDetail);
    $('#supportResolve').addEventListener('click', onResolve);
    $all('.support-list-filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        $all('.support-list-filters button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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
    if (kind === 'ok') setTimeout(() => {
      if (el.textContent === msg) {
        el.textContent = '';
        el.className = 'support-form-hint';
      }
    }, 4000);
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
      if (r.wa_url) await openExternal(r.wa_url);
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
      if (r && r.ok) {
        state.tickets = r.tickets || [];
        renderTickets();
        if (openId) openDetail(openId);
      } else {
        renderTicketsError(r && r.error ? String(r.error) : 'Unknown error');
      }
    } catch (e) {
      renderTicketsError(e && e.message ? e.message : 'Network error');
    }
  }

  function renderTicketsError(message) {
    const root = $('#supportTickets');
    if (!root) return;
    root.innerHTML = `
      <div class="support-error" role="alert">
        <div>Could not load tickets</div>
        <div class="support-error-detail">${esc(message)}</div>
        <button type="button" class="ghost" id="supportRetryList">Retry</button>
      </div>
    `;
    const retry = $('#supportRetryList');
    if (retry) retry.addEventListener('click', () => refreshList(state.activeId));
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
    // Use a DocumentFragment to batch DOM writes — one reflow per refresh
    // instead of N (one per innerHTML write).
    const frag = document.createDocumentFragment();
    list.forEach(t => {
      const article = document.createElement('article');
      article.className = 'support-ticket' + (t.status === 'resolved' ? ' is-resolved' : '');
      article.dataset.id = t.id;
      const ts = Number(t.last_message_at || t.created_at || 0);
      const prio = String(t.priority || 'normal');
      const status = String(t.status || 'open');
      const statusLabel = STATUS_LABELS[status] || status;
      article.innerHTML = `
        <div class="support-ticket-row1">
          <span class="support-ticket-id">${esc(t.id)}</span>
          <span class="support-ticket-prio support-prio-${esc(prio)}">${esc(prio)}</span>
          <span class="support-ticket-status support-status-${esc(status)}">${esc(statusLabel)}</span>
        </div>
        <div class="support-ticket-subject">${esc(t.subject)}</div>
        <div class="support-ticket-meta">
          <span>${esc(t.category)}</span>
          <span>·</span>
          <span>${esc(t.created_by_name || t.created_by)}</span>
          <span>·</span>
          <span title="${esc(fmtTime(ts))}">${esc(relTime(ts))}</span>
        </div>
      `;
      article.addEventListener('click', () => openDetail(t.id));
      frag.appendChild(article);
    });
    root.innerHTML = '';
    root.appendChild(frag);
  }

  // ── Detail view ──
  async function openDetail(id) {
    state.activeId = id;
    try {
      const r = await api('/api/tickets/' + encodeURIComponent(id), { method: 'GET' });
      if (!r || !r.ok) {
        flashHint('supportFormHint', 'Could not open ticket: ' + (r && r.error ? r.error : 'unknown'), 'err');
        renderDetailError(r && r.error ? String(r.error) : 'Unknown error');
        return;
      }
      state.detail = r;
      state.lastDetailSig = null;       // force one fresh render
      renderDetail();
      if (state.pollTimer) clearInterval(state.pollTimer);
      let failures = 0;
      const pollOnce = async () => {
        if (!state.activeId) return;
        try {
          const r2 = await api('/api/tickets/' + encodeURIComponent(state.activeId), { method: 'GET' });
          if (r2 && r2.ok) {
            failures = 0;
            // Only repaint if the timeline grew. Avoids a full innerHTML
            // rewrite every 5 s when nothing changed.
            const sig = (r2.messages || []).length + '|' +
              (r2.events || []).length + '|' +
              (((r2.messages || []).slice(-1)[0] || {}).sent_at || 0) + '|' +
              (r2.ticket && r2.ticket.resolved_at ? r2.ticket.resolved_at : 0);
            if (sig !== state.lastDetailSig) {
              state.lastDetailSig = sig;
              state.detail = r2;
              renderDetail();
            }
          } else {
            failures += 1;
            if (failures === 3) renderDetailError(r2 && r2.error ? String(r2.error) : 'Lost connection to local server');
          }
        } catch (_) {
          failures += 1;
          if (failures === 3) renderDetailError('Network error');
        }
      };
      state.pollTimer = setInterval(pollOnce, 5000);
    } catch (e) {
      renderDetailError(e && e.message ? e.message : 'Network error');
    }
  }

  function renderDetailError(message) {
    const threadEl = $('#supportThread');
    if (!threadEl) return;
    threadEl.innerHTML = `
      <div class="support-error" role="alert">
        <div>Could not load this ticket</div>
        <div class="support-error-detail">${esc(message)}</div>
        <button type="button" class="ghost" id="supportRetryDetail">Retry</button>
      </div>
    `;
    const retry = $('#supportRetryDetail');
    if (retry && state.activeId) {
      retry.addEventListener('click', () => openDetail(state.activeId));
    }
  }

  function closeDetail() {
    state.activeId = null;
    state.detail = null;
    state.lastDetailSig = null;
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
    const timeline = []
      .concat(events.map(e => ({ kind: 'event', at: e.at, event: e.event, actor: e.actor, note: e.note })))
      .concat(messages.map(m => ({ kind: 'message', at: m.sent_at, direction: m.direction, sender: m.sender, text: m.text, via: m.via })))
      .sort((a, b) => a.at - b.at);
    const threadEl = $('#supportThread');
    if (!threadEl) return;
    const frag = document.createDocumentFragment();
    if (!timeline.length) {
      const empty = document.createElement('div');
      empty.className = 'support-empty';
      empty.textContent = 'No activity yet.';
      frag.appendChild(empty);
    } else {
      timeline.forEach(item => {
        if (item.kind === 'event') {
          const ev = document.createElement('div');
          ev.className = 'support-event';
          ev.innerHTML = `
            <span class="support-event-dot"></span>
            <span class="support-event-time">${esc(fmtTime(item.at))}</span>
            <span class="support-event-label">${esc(item.event)}</span>
            <span class="support-event-actor">${esc(item.actor)}</span>
            ${item.note ? `<span class="support-event-note">— ${esc(item.note)}</span>` : ''}
          `;
          frag.appendChild(ev);
        } else {
          const isOut = item.direction === 'out';
          const msg = document.createElement('div');
          msg.className = 'support-msg ' + (isOut ? 'is-out' : 'is-in');
          msg.innerHTML = `
            <div class="support-msg-bubble">${esc(item.text)}</div>
            <div class="support-msg-meta">
              <span>${esc(item.sender)}</span>
              <span>·</span>
              <span>${esc(item.via)}</span>
              <span>·</span>
              <span>${esc(fmtTime(item.at))}</span>
            </div>
          `;
          frag.appendChild(msg);
        }
      });
    }
    threadEl.innerHTML = '';
    threadEl.appendChild(frag);
    // Only auto-scroll-to-bottom when the user is already near the bottom.
    // If they've scrolled up to read history, don't yank them away.
    const wasAtBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 48;
    if (wasAtBottom) {
      // requestAnimationFrame so the browser commits the innerHTML write
      // before we measure scrollHeight — otherwise the scroll snaps to a
      // stale value and the new messages stay off-screen.
      requestAnimationFrame(() => { threadEl.scrollTop = threadEl.scrollHeight; });
    }
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

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshList(state.activeId);
  });

  // v1.2.42 — when the launcher toggles the Support panel off, stop the
  // detail-poll timer. Without this, polling fires every 5s even when the
  // user can't see the result, wasting IPC + D1 reads. renderer.js toggles
  // the [hidden] attribute on #supportMount; we observe that.
  const supportMount = document.getElementById('supportMount');
  if (supportMount && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => {
      const visible = !supportMount.hasAttribute('hidden');
      if (!visible && state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        state.activeId = null;
        state.detail = null;
      }
    });
    mo.observe(supportMount, { attributes: true, attributeFilter: ['hidden'] });
  }

  // Escape closes the open detail so the operator can dismiss with one
  // keystroke. Doesn't trigger when typing in a form field.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!state.activeId) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    closeDetail();
  });
})();
