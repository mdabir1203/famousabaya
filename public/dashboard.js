'use strict';

// Custom-range state for the Executive CEO Reports panel. Set by the
// date pickers in dashboard.html, read by reportPeriodForType('Custom').
let customReportRange = { fromYmd: '', toYmd: '' };

const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  timeout: 20000,
});

let STATE = { active: {}, logs: [], perf: [] };
let fallbackPollTimer = null;
let fallbackConsecutiveErrors = 0;
let fallbackMode = false;

// Employee lookup by id. Report/log rendering did EMPLOYEES.find() per row (O(nÃ—m)
// scans that got slow with a big roster + many rows). This memoizes an idâ†’emp Map
// and rebuilds it only when the EMPLOYEES array reference actually changes.
let _empByIdCache = null;
let _empByIdSrc = null;
function empById(id) {
  var src = typeof EMPLOYEES !== 'undefined' ? EMPLOYEES : [];
  if (_empByIdSrc !== src) {
    _empByIdSrc = src;
    _empByIdCache = new Map((src || []).map(function (e) { return [e.id, e]; }));
  }
  return _empByIdCache.get(id);
}

/**
 * Cached shift-window config (synced from server via /api/client-config).
 * UI elapsed timers, hourly chart, and per-item totals all clamp to these windows so the
 * dashboard never displays time the local server didn't actually count.
 */
const DEFAULT_CLIENT_WORKING_HOURS = {
  profile: 'normal',
  timezone: 'Asia/Dubai',
  days: {
    sat: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
    sun: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
    mon: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
    tue: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
    wed: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
    thu: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
    fri: [['15:00', '20:00'], ['20:40', '23:30']],
  },
};
let CLIENT_WORKING_HOURS = DEFAULT_CLIENT_WORKING_HOURS;
const WH_WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function whTimezone() {
  return (CLIENT_WORKING_HOURS && CLIENT_WORKING_HOURS.timezone) || 'Asia/Dubai';
}

function ymdInTimezone(epochMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const y = (parts.find((p) => p.type === 'year') || {}).value || '0000';
  const m = (parts.find((p) => p.type === 'month') || {}).value || '00';
  const d = (parts.find((p) => p.type === 'day') || {}).value || '00';
  return y + '-' + m + '-' + d;
}

function formatDateTimeTz(epochMs, opts) {
  const o = opts || {};
  return new Date(epochMs).toLocaleString([], {
    timeZone: o.timeZone || whTimezone(),
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    weekday: o.weekday ? 'short' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    second: o.seconds ? '2-digit' : undefined,
    hour12: false,
  });
}

function whParseHHMM(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function whWeekdayKey(epochSec) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: whTimezone(), weekday: 'short' })
    .format(new Date(epochSec * 1000))
    .toLowerCase()
    .slice(0, 3);
  return WH_WEEKDAY_KEYS.includes(wd) ? wd : 'sun';
}

function whMinuteOfDay(epochSec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: whTimezone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSec * 1000));
  const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
  const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
  return hh * 60 + mm;
}

function whWindowsForDay(weekdayKey) {
  const cfg = CLIENT_WORKING_HOURS;
  const arr = cfg && cfg.days && Array.isArray(cfg.days[weekdayKey]) ? cfg.days[weekdayKey] : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const w = arr[i] || [];
    const s = whParseHHMM(w[0]);
    const e = whParseHHMM(w[1]);
    if (s == null || e == null || e <= s) continue;
    out.push([s, e]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

function inWindowClient(epochSec) {
  const k = whWeekdayKey(epochSec);
  const minute = whMinuteOfDay(epochSec);
  const windows = whWindowsForDay(k);
  for (let i = 0; i < windows.length; i++) {
    if (minute >= windows[i][0] && minute < windows[i][1]) return true;
  }
  return false;
}

/** Elapsed seconds since `startMs`, counting only seconds inside configured shift windows. */
function activeSecondsWindowedFromMs(startMs) {
  const st = Math.floor(Number(startMs || 0) / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(st) || now <= st) return 0;
  let sec = 0;
  for (let t = st; t < now; t += 60) {
    const t2 = Math.min(now, t + 60);
    if (inWindowClient(t)) sec += t2 - t;
  }
  return sec;
}

let renderAllRaf = null;
let dashFloorCompletionTab = 'invoice';
try {
  var _sft = sessionStorage.getItem('dash-floor-tab');
  if (_sft === 'checker' || _sft === 'invoice') dashFloorCompletionTab = _sft;
} catch (e) {}
function scheduleRenderAll() {
  if (renderAllRaf != null) return;
  renderAllRaf = requestAnimationFrame(function () {
    renderAllRaf = null;
    renderAll();
  });
}

function setDashboardFloorTab(which) {
  if (which !== 'invoice' && which !== 'checker') return;
  dashFloorCompletionTab = which;
  try {
    sessionStorage.setItem('dash-floor-tab', which);
  } catch (e) {}
  syncDashboardFloorTabUi();
}

function syncDashboardFloorTabUi() {
  const invBtn = document.getElementById('dash-tab-invoice');
  const chkBtn = document.getElementById('dash-tab-checker');
  const invPanel = document.getElementById('floor-tab-invoice');
  const chkPanel = document.getElementById('floor-tab-checker');
  if (!invBtn || !chkBtn || !invPanel || !chkPanel) return;
  const showInv = dashFloorCompletionTab === 'invoice';
  invBtn.classList.toggle('active', showInv);
  chkBtn.classList.toggle('active', !showInv);
  invBtn.setAttribute('aria-selected', showInv ? 'true' : 'false');
  chkBtn.setAttribute('aria-selected', showInv ? 'false' : 'true');
  invPanel.style.display = showInv ? '' : 'none';
  chkPanel.style.display = showInv ? 'none' : '';
  if (showInv) {
    invPanel.removeAttribute('hidden');
    chkPanel.setAttribute('hidden', '');
  } else {
    chkPanel.removeAttribute('hidden');
    invPanel.setAttribute('hidden', '');
  }
}

function checkerBarcodeCellHtml(l) {
  const entered = l.checker_barcode != null && String(l.checker_barcode).trim() !== '';
  const raw = entered ? String(l.checker_barcode).trim().replace(/,/g, ', ') : '';
  const fallbackAb = ABAYAS.find((a) => a.id === l.abaya_id);
  const fb = fallbackAb && fallbackAb.barcode ? String(fallbackAb.barcode) : '';
  const display = entered ? raw : fb;
  if (!display) return '<span style="color:var(--tx3)">\u2014</span>';
  const esc = escapeHtml(display);
  const title = escapeAttr(display.length > 180 ? display.slice(0, 180) + '\u2026' : display);
  return '<span style="font-family:monospace;font-size:10px;line-height:1.35;word-break:break-word;color:var(--tx2)" title="' + title + '">' + esc + '</span>';
}

function updateOfflineRestoreBanner(state, cfg) {
  const el = document.getElementById('offline-restore-banner');
  if (!el) return;
  const fromState = state && state.state_meta && state.state_meta.restored_from_offline_cache;
  const fromCfg = cfg && cfg.offlineReportRestored === true;
  el.style.display = fromState || fromCfg ? 'block' : 'none';
}

function setDbPanelClass(panel, badge, level, label) {
  if (!panel || !badge) return;
  panel.classList.remove('warn', 'bad');
  badge.classList.remove('ok', 'warn', 'bad');
  if (level === 'bad') {
    panel.classList.add('bad');
    badge.classList.add('bad');
  } else if (level === 'warn') {
    panel.classList.add('warn');
    badge.classList.add('warn');
  } else {
    badge.classList.add('ok');
  }
  badge.textContent = label || level || 'ok';
}

function shortAge(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '-';
  const ageMs = Math.max(0, Date.now() - n);
  const sec = Math.floor(ageMs / 1000);
  if (sec < 90) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 90) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 48) return hr + 'h ago';
  return Math.floor(hr / 24) + 'd ago';
}

function updateDatabaseStatusPanel(cfg) {
  const panel = document.getElementById('database-status-panel');
  if (!panel) return;
  const badge = document.getElementById('db-status-badge');
  const sourceEl = document.getElementById('db-ui-source');
  const cloudEl = document.getElementById('db-cloud-sync');
  const reconcileEl = document.getElementById('db-reconcile');
  const snapshotEl = document.getElementById('db-snapshot');
  const db = cfg && cfg.database ? cfg.database : null;
  const stateMeta = STATE && STATE.state_meta ? STATE.state_meta : {};

  if (!db && !stateMeta) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  const syncMode = String((db && db.syncMode) || stateMeta.syncMode || 'unknown');
  const pendingQueue = Number((db && db.pendingQueue) || stateMeta.pendingQueue || 0);
  const reconcile = db && db.reconcile ? db.reconcile : null;
  const reconcileLast = reconcile && reconcile.status ? reconcile.status.lastResult : null;
  const snapshot = db && db.sqliteSnapshot ? db.sqliteSnapshot : null;
  const rejected = db && db.rejectedQueue ? Number(db.rejectedQueue.lines) || 0 : 0;

  const stateSource = String(stateMeta.source || (db && db.source) || 'local-memory');
  const logsText = String((stateMeta.logs_returned != null ? stateMeta.logs_returned : (STATE.logs || []).length)) +
    '/' + String(stateMeta.logs_total_in_memory != null ? stateMeta.logs_total_in_memory : (STATE.logs || []).length);
  if (sourceEl) sourceEl.textContent = stateSource + ' Â· logs ' + logsText;

  if (cloudEl) {
    const cloudTag = db && db.cloudConfigured ? syncMode : 'local only';
    cloudEl.textContent = cloudTag + ' Â· queue ' + pendingQueue + (rejected ? ' Â· rejected ' + rejected : '');
  }

  if (reconcileEl) {
    if (!reconcile || !reconcile.enabled) {
      reconcileEl.textContent = 'disabled';
    } else if (!reconcileLast) {
      reconcileEl.textContent = 'pending first run';
    } else if (!reconcileLast.ok) {
      reconcileEl.textContent = 'error Â· ' + String(reconcileLast.error || 'failed').slice(0, 48);
    } else {
      const replayed = Number(reconcileLast.replayed_finishes || 0) + Number(reconcileLast.replayed_starts || 0);
      reconcileEl.textContent = 'ok Â· push ' + replayed + ' Â· conflicts ' + Number(reconcileLast.conflicts_resolved_local || 0);
    }
  }

  if (snapshotEl) {
    if (!snapshot || !snapshot.enabled) {
      snapshotEl.textContent = 'disabled';
    } else if (snapshot.lastErr) {
      snapshotEl.textContent = 'error Â· ' + String(snapshot.lastErr.message || 'failed').slice(0, 48);
    } else if (snapshot.lastOk && snapshot.lastOk.at) {
      snapshotEl.textContent = 'ok Â· ' + shortAge(snapshot.lastOk.at);
    } else {
      snapshotEl.textContent = 'pending first write';
    }
  }

  let level = 'ok';
  let label = 'database ok';
  if (syncMode === 'local-cache-fallback' || (snapshot && snapshot.lastErr) || (reconcileLast && !reconcileLast.ok)) {
    level = 'bad';
    label = 'needs attention';
  } else if (pendingQueue > 0 || rejected > 0 || (stateMeta.logs_truncated === true) || (reconcileLast && reconcileLast.hard_failures > 0)) {
    level = 'warn';
    label = 'sync pending';
  }
  setDbPanelClass(panel, badge, level, label);
}

function applyFallbackState(state) {
  if (!state || typeof state !== 'object') return;
  if (state.workTypes && Array.isArray(state.workTypes) && state.workTypes.length) {
    WORK_TYPES = state.workTypes.slice();
    if (state.workTypesVersion != null) lastWorkTypesVersionSeen = String(state.workTypesVersion);
  }
  // Invalidate report cache: logs / active sessions / work types may have changed.
  if (typeof reportCacheClear === 'function') reportCacheClear();
  if (typeof dashboardAggregateCacheClear === 'function') dashboardAggregateCacheClear();
  STATE = state;
  updateOfflineRestoreBanner(state, null);
  updateDatabaseStatusPanel(null);
  scheduleRenderAll();
}

function fetchStateFallback() {
  fetchJsonSafe('/api/state', { cache: 'no-store' })
    .then((d) => {
      if (!d || !d.okHttp || !d.j || !d.j.ok || !d.j.state) return;
      fallbackConsecutiveErrors = 0;
      applyFallbackState(d.j.state);
    })
    .catch(() => {
      fallbackConsecutiveErrors += 1;
      if (fallbackConsecutiveErrors % 3 === 0) {
        showToast('Still trying to restore live connection...', 'info');
      }
    });
}

/**
 * One-shot extended-history fetch used on first paint and on every socket
 * (re)connect. The realtime socket bundle (state_update) already carries the
 * configured lookback window (now 400 days by default), but a slow first
 * state_update or a freshly-reconnected socket can leave STATE.logs too
 * short for the report panel. Asking for ?days=400 from the HTTP endpoint
 * guarantees the report panel has the full history it needs from the first
 * render — without bloating the 3-second fallback poll (which still uses
 * fetchStateFallback and the bundled default).
 */
function fetchStateExtendedHistory() {
  // ?days=400 alone isn't enough: the worker's default cap is 100 unless
  // ?days>=7 (which now bumps the cap to 5000) or ?limit= is set explicitly.
  // Pass limit=5000 too so we get the full 400-day bundle in one round trip
  // — the report panel needs every row in STATE.logs to render monthly,
  // weekly, yearly, and custom-range correctly.
  //
  // Response shape: the worker returns a flat object (ok, ts, logs, perf,
  // daily, ...). The local server (used on LAN) wraps the same fields in
  // `.state`. Handle both so the extended history works against either.
  fetchJsonSafe('/api/state?days=400&limit=5000', { cache: 'no-store' })
    .then((d) => {
      if (!d || !d.okHttp || !d.j || !d.j.ok) return;
      const payload = d.j.state || d.j; // worker = flat, server = {state: {...}}
      if (!payload || !payload.logs) return;
      applyFallbackState(payload);
    })
    .catch(() => {
      // Non-fatal: realtime socket is the primary path. The report panel
      // will still work once a state_update arrives with the extended bundle.
    });
}

function startFallbackPolling() {
  if (fallbackPollTimer) return;
  fallbackMode = true;
  fetchStateFallback();
  fallbackPollTimer = setInterval(fetchStateFallback, 3000);
}

function stopFallbackPolling() {
  fallbackMode = false;
  fallbackConsecutiveErrors = 0;
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
}

// â”€â”€â”€ CONNECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
socket.on('connect', () => {
  document.getElementById('conn-dot').classList.add('online');
  document.getElementById('conn-label').textContent = 'Live';
  if (fallbackMode) {
    showToast('Live connection restored', 'success');
  } else {
    showToast('Dashboard connected', 'success');
  }
  stopFallbackPolling();
  // Pull an extended-history bundle on every (re)connect so the report
  // panel has the full lookback the moment the socket is back. Cheap on
  // the server: a single D1 (cloud) or in-memory (LAN) query.
  fetchStateExtendedHistory();
});
socket.on('disconnect', () => {
  document.getElementById('conn-dot').classList.remove('online');
  document.getElementById('conn-label').textContent = 'Fallback';
  showToast('Live socket lost â€” switching to fallback sync...', 'error');
  startFallbackPolling();
});

socket.on('connect_error', () => {
  document.getElementById('conn-dot').classList.remove('online');
  document.getElementById('conn-label').textContent = 'Fallback';
  startFallbackPolling();
});

socket.io.on('reconnect_attempt', () => {
  if (!fallbackPollTimer) startFallbackPolling();
});

AbayaClientCommon.installReconnectNudge(socket);

socket.on('catalog_update', () => {
  refreshDashboardAbayaCatalog();
});

socket.on('employees_update', () => {
  loadEmployeesFromServer();
});

socket.on('work_types_update', (payload) => {
  if (payload && Array.isArray(payload.workTypes) && payload.workTypes.length) {
    WORK_TYPES = payload.workTypes.slice();
    if (payload.version != null) lastWorkTypesVersionSeen = String(payload.version);
    if (typeof renderAll === 'function') renderAll();
  }
});

socket.on('sync_versions', () => {
  pollClientConfig();
});

function loadEmployeesFromServer() {
  AbayaClientCommon.fetchJsonNoStore('/api/employees')
    .then((d) => {
      if (!d.ok || !Array.isArray(d.employees)) return;
      EMPLOYEES = d.employees;
      renderAll();
    })
    .catch(() => {});
}

let lastCatalogVersionSeen = null;
let lastEmployeesVersionSeen = null;
let lastWorkTypesVersionSeen = null;

function fetchJsonSafe(url, options) {
  return fetch(url, options || {}).then((r) =>
    r.json().then(
      (j) => ({ okHttp: r.ok, status: r.status, j: j }),
      () => ({ okHttp: r.ok, status: r.status, j: null })
    )
  );
}

function loadWorkTypesFromServer() {
  AbayaClientCommon.fetchJsonNoStore('/api/work-types')
    .then((d) => {
      if (!d.ok || !Array.isArray(d.workTypes) || !d.workTypes.length) return;
      WORK_TYPES = d.workTypes.slice();
      if (d.version != null) lastWorkTypesVersionSeen = String(d.version);
      if (typeof renderAll === 'function') renderAll();
    })
    .catch(() => {});
}

function openCatalogImportPicker() {
  const el = document.getElementById('catalog-import-input');
  if (!el) return;
  el.value = '';
  el.click();
}

function handleCatalogImportSelected(ev) {
  const input = ev && ev.target ? ev.target : document.getElementById('catalog-import-input');
  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) return;
  const secret = window.prompt('Catalog ingest secret (X-Ingest-Secret):', '');
  if (secret == null || String(secret).trim() === '') {
    showToast('Import cancelled: missing secret', 'error');
    return;
  }
  const fd = new FormData();
  fd.append('file', file, file.name || 'items_export.xlsx');
  fetch('/api/import/catalog-xlsx', {
    method: 'POST',
    headers: { 'X-Ingest-Secret': String(secret).trim() },
    body: fd,
  })
    .then((r) => r.json().then((j) => ({ okHttp: r.ok, status: r.status, j: j })))
    .then((x) => {
      if (!x.okHttp || !x.j || !x.j.ok) {
        const msg = x && x.j && x.j.error ? x.j.error : 'Import failed';
        throw new Error(msg);
      }
      refreshDashboardAbayaCatalog();
      showToast('Import complete: ' + String(x.j.count || 0) + ' catalog row(s)', 'success');
    })
    .catch((e) => {
      showToast('Import failed: ' + String(e && e.message ? e.message : e), 'error');
    });
}

function openFloorSessionsImportPicker() {
  const el = document.getElementById('floor-sessions-import-input');
  if (!el) return;
  el.value = '';
  el.click();
}

function handleFloorSessionsImportSelected(ev) {
  const input = ev && ev.target ? ev.target : document.getElementById('floor-sessions-import-input');
  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) return;
  const secret = window.prompt('Usage import secret (X-Export-Secret):', '');
  if (secret == null || String(secret).trim() === '') {
    showToast('Import cancelled: missing secret', 'error');
    return;
  }
  file.text()
    .then((text) => {
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        throw new Error('Invalid JSON file');
      }
      if (!payload || !Array.isArray(payload.sessions)) {
        throw new Error('Invalid floor export file: missing sessions[]');
      }
      return fetch('/api/import/floor-sessions.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Export-Secret': String(secret).trim(),
        },
        body: JSON.stringify(payload),
      });
    })
    .then((r) => r.json().then((j) => ({ okHttp: r.ok, status: r.status, j: j })))
    .then((x) => {
      if (!x.okHttp || !x.j || !x.j.ok) {
        const msg = x && x.j && x.j.error ? x.j.error : 'Import failed';
        throw new Error(msg);
      }
      renderAll();
      showToast('Import complete: ' + String(x.j.imported || 0) + ' session row(s)', 'success');
    })
    .catch((e) => {
      showToast('Import failed: ' + String(e && e.message ? e.message : e), 'error');
    });
}

function applyClientConfig(cfg) {
  if (!cfg || !cfg.ok) return;
  if (cfg.working_hours && cfg.working_hours.days && typeof cfg.working_hours.days === 'object') {
    CLIENT_WORKING_HOURS = cfg.working_hours;
  }
  const persistBanner = document.getElementById('persistence-health-banner');
  const persistence = cfg.persistence || {};
  if (persistBanner) {
    const bad = persistence.offlineReportDirWritable === false || persistence.ceoQueueDirWritable === false;
    persistBanner.style.display = bad ? 'block' : 'none';
  }
  const banner = document.getElementById('ceo-queue-banner');
  const pendEl = document.getElementById('ceo-queue-pending');
  if (banner && pendEl && cfg.ceoIngestCloud) {
    const p = Number(cfg.ceoIngestPending) || 0;
    if (p > 0) {
      pendEl.textContent = String(p);
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  } else if (banner) {
    banner.style.display = 'none';
  }

  updateOfflineRestoreBanner(STATE, cfg);
  updateDatabaseStatusPanel(cfg);

  const sk = 'abaya_srv_boot';
  const prevBoot = sessionStorage.getItem(sk);
  const boot = String(cfg.serverStartedAt);
  if (prevBoot && prevBoot !== boot) {
    sessionStorage.setItem(sk, boot);
    window.location.reload();
    return;
  }
  sessionStorage.setItem(sk, boot);

  const cv = String(cfg.catalogVersion);
  if (lastCatalogVersionSeen !== null && cv !== lastCatalogVersionSeen) {
    refreshDashboardAbayaCatalog();
  }
  lastCatalogVersionSeen = cv;

  const ev = String(cfg.employeesVersion);
  if (lastEmployeesVersionSeen !== null && ev !== lastEmployeesVersionSeen) {
    loadEmployeesFromServer();
  }
  lastEmployeesVersionSeen = ev;

  const wv = String(cfg.workTypesVersion != null ? cfg.workTypesVersion : '0');
  if (cfg.workTypes && Array.isArray(cfg.workTypes) && cfg.workTypes.length) {
    if (lastWorkTypesVersionSeen === null || wv !== lastWorkTypesVersionSeen) {
      WORK_TYPES = cfg.workTypes.slice();
      if (typeof renderAll === 'function') renderAll();
    }
  }
  lastWorkTypesVersionSeen = wv;
}

function pollClientConfig() {
  AbayaClientCommon.fetchJsonNoStore('/api/client-config')
    .then(applyClientConfig)
    .catch(() => {});
}

function normalizeDashboardAbayaRow(a) {
  return {
    id: String(a.id),
    code: String(a.code),
    barcode: String(a.barcode),
    design: String(a.design != null ? a.design : ''),
    process: String(a.process != null ? a.process : ''),
    tier: a.tier != null ? String(a.tier) : '',
    icon: a.icon != null ? String(a.icon) : '',
    status: a.status || 'waiting',
  };
}

/** Integer seconds from a completed log row (avoids float drift). */
function logDurationSec(l) {
  const n = Number(l && l.duration_sec);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Per abaya_id: sum of completed segment seconds, in-progress seconds on the floor,
 * and total = completed + active.
 */
function aggregateGarmentSeconds(logs, active, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const by = Object.create(null);
  (logs || []).forEach(function (l) {
    if (!l || l.abaya_id == null || l.abaya_id === '') return;
    const k = String(l.abaya_id);
    if (!by[k]) by[k] = { abaya_id: k, completedSec: 0, segments: 0 };
    by[k].completedSec += logDurationSec(l);
    by[k].segments += 1;
  });
  Object.keys(active || {}).forEach(function (empId) {
    const sess = active[empId];
    if (!sess || sess.abaya_id == null || sess.abaya_id === '') return;
    const k = String(sess.abaya_id);
    if (!by[k]) by[k] = { abaya_id: k, completedSec: 0, segments: 0 };
    const started = Number(sess.started_at);
    if (!Number.isFinite(started)) return;
    const el = Math.max(0, activeSecondsWindowedFromMs(started));
    by[k].activeSec = (by[k].activeSec || 0) + el;
  });
  Object.keys(by).forEach(function (k) {
    const o = by[k];
    o.activeSec = o.activeSec || 0;
    o.totalSec = o.completedSec + o.activeSec;
  });
  return by;
}

function totalSecForGarment(aggMap, abaya_id) {
  if (abaya_id == null || abaya_id === '') return 0;
  const o = aggMap[String(abaya_id)];
  return o && o.totalSec != null ? o.totalSec : 0;
}

function abayaCatalogRowForId(abaya_id) {
  if (abaya_id == null || abaya_id === '') return null;
  const id = String(abaya_id);
  return ABAYAS.find(function (a) {
    return a.id === id;
  }) || null;
}

function dashTierBadge(tier) {
  if (!tier) return '';
  var slug = tier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  var colors = {
    'standard':    'background:#1e3a5f;color:#93c5fd',
    'premium':     'background:#3b1f6b;color:#c4b5fd',
    'luxury':      'background:#4a1a00;color:#fcd34d',
    'plain-abaya': 'background:#1f2937;color:#9ca3af',
  };
  var style = colors[slug] || 'background:var(--s2);color:var(--tx2)';
  return '<span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;' + style + '">' + tier + '</span>';
}

function refreshDashboardAbayaCatalog() {
  AbayaClientCommon.fetchJsonNoStore('/api/catalog/abayas')
    .then((d) => {
      if (!d.ok || !Array.isArray(d.abayas)) return;
      ABAYAS = d.abayas.map(normalizeDashboardAbayaRow);
      renderAll();
    })
    .catch(() => {});
}

// â”€â”€â”€ REAL-TIME STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
socket.on('state_update', (data) => {
  applyFallbackState(data);
});

function renderAll() {
  renderKPIs();
  renderLiveSessions();
  renderAbayaItemTotals();
  renderEmployeePerf();
  renderHourlyChart();
  renderPareto();
  renderProcessEff();
  renderRecentInvoiceLogsNode();
  renderRecentCheckerLogsNode();
  syncDashboardFloorTabUi();
  updateClock();
}

// â”€â”€â”€ KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderKPIs() {
  const active = STATE.active || {};
  const actCount = Object.keys(active).length;
  const tz = whTimezone();
  const todayYmd = ymdInTimezone(Date.now(), tz);
  // Single-pass realtime aggregate (cached, fingerprint-busted on state_update).
  const agg = aggregateRealtime(STATE.logs || [], tz, todayYmd);
  const totalUnits = agg.todayCount;

  document.getElementById('kpi-completed').textContent = totalUnits;
  document.getElementById('kpi-active').textContent = actCount;
  document.getElementById('kpi-inprog').textContent = actCount;

  if (totalUnits > 0) {
    document.getElementById('kpi-avg').textContent = fmtHMS(agg.todayAvgSec);
  } else {
    document.getElementById('kpi-avg').textContent = 'â€"';
  }
}

// â”€â”€â”€ TOTAL TIME BY ITEM CODE (DASHBOARD TABLE) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderAbayaItemTotals() {
  const el = document.getElementById('abaya-totals-table');
  if (!el) return;
  const tz = whTimezone();
  const todayYmd = ymdInTimezone(Date.now(), tz);
  // Single-pass realtime aggregate for the items; the result is cached and
  // re-used by renderKPIs / renderEmployeePerf / renderPareto / etc.
  const real = aggregateRealtime(STATE.logs || [], tz, todayYmd);
  // Layer in active-session seconds (one short pass over STATE.active).
  // We do this here, not in the aggregate, because the active snapshot is
  // small and only used by this panel + the modal report's per-item block.
  const active = STATE.active || {};
  const itemAgg = real.itemAgg;
  for (const empId in active) {
    const sess = active[empId];
    if (!sess || sess.abaya_id == null || sess.abaya_id === '') continue;
    const k = String(sess.abaya_id);
    const aRow = itemAgg[k];
    if (!aRow) continue;
    const started = Number(sess.started_at);
    if (!Number.isFinite(started)) continue;
    const el2 = Math.max(0, activeSecondsWindowedFromMs(started));
    aRow.activeSec = (aRow.activeSec || 0) + el2;
    aRow.totalSec = (aRow.completedSec || 0) + (aRow.activeSec || 0);
  }
  const keys = Object.keys(itemAgg);
  if (!keys.length) {
    el.innerHTML =
      '<div style="color:var(--tx3);font-size:13px;padding:16px;text-align:center">No garment sessions yet</div>';
    return;
  }
  const rows = keys
    .map(function (k) {
      const o = agg[k];
      const ab = abayaCatalogRowForId(o.abaya_id);
      const code = ab ? ab.code : o.abaya_id;
      const barcode = ab && ab.barcode ? ab.barcode : '';
      return {
        code: code,
        barcode: barcode,
        segments: o.segments,
        completedSec: o.completedSec,
        activeSec: o.activeSec,
        totalSec: o.totalSec,
        tier: ab && ab.tier ? ab.tier : '',
      };
    })
    .sort(function (a, b) {
      if (b.totalSec !== a.totalSec) return b.totalSec - a.totalSec;
      return String(a.code).localeCompare(String(b.code));
    });
  const head =
    '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.9fr) 52px 72px 72px 80px;gap:8px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--tx3);align-items:center">' +
    '<span>Item code</span><span>Item no.</span><span style="text-align:right">Steps</span>' +
    '<span style="text-align:right">Done</span><span style="text-align:right">Active</span><span style="text-align:right">Total</span></div>';
  const body = rows
    .map(function (r) {
      const tierHtml = r.tier ? ' ' + dashTierBadge(r.tier) : '';
      return (
        '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.9fr) 52px 72px 72px 80px;gap:8px;padding:9px 10px;border-bottom:1px solid rgba(54,45,89,.25);font-size:12px;align-items:center">' +
        '<span style="font-weight:600;color:var(--tx2)">' +
        escapeHtml(String(r.code)) +
        tierHtml +
        '</span>' +
        '<span style="font-family:var(--fn-mono);font-size:11px;color:var(--am)">' +
        (r.barcode ? escapeHtml(r.barcode) : '<span style="color:var(--tx3)">â€”</span>') +
        '</span>' +
        '<span style="text-align:right;color:var(--tx3)">' +
        r.segments +
        '</span>' +
        '<span style="text-align:right;color:var(--tx2)">' +
        fmtHMS(r.completedSec) +
        '</span>' +
        '<span style="text-align:right;color:var(--tx3)">' +
        (r.activeSec > 0 ? fmtHMS(r.activeSec) : 'â€”') +
        '</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">' +
        fmtHMS(r.totalSec) +
        '</span></div>'
      );
    })
    .join('');
  el.innerHTML =
    '<div style="max-height:320px;overflow-y:auto;border:1px solid var(--bd);border-radius:12px;background:var(--s2)">' +
    head +
    body +
    '</div>';
}

// â”€â”€â”€ LIVE SESSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderLiveSessions() {
  const el = document.getElementById('live-sessions');
  const active = STATE.active || {};
  const ids = Object.keys(active);
  const agg = aggregateGarmentSeconds(STATE.logs || [], active, Date.now());

  if (ids.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:13px">No active sessions right now</div>';
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tz = whTimezone();
  const inShiftNow = inWindowClient(nowSec);

  el.innerHTML = ids.map(id => {
    const sess = active[id];
    const emp = empById(id);
    const ab = ABAYAS.find(a => a.id === sess.abaya_id);
    if (!emp) return '';
    const startedMs = Number(sess.started_at) || Date.now();
    const elapsed = activeSecondsWindowedFromMs(startedMs);
    const totalItem = totalSecForGarment(agg, sess.abaya_id);
    const avHtml = employeeAvatarHtml(emp);
    const sessionProcess = (sess.process || '').trim() || 'â€”';  // use active session role only
    const itemLabel = ab && ab.barcode ? escapeHtml(ab.barcode) : 'â€”';

    const startedAtSec = Math.floor(startedMs / 1000);
    const startedLabel = formatDateTimeTz(startedMs, { timeZone: tz, weekday: true, seconds: true });
    const startedFull = startedLabel;
    const outOfShift = !inShiftNow || !inWindowClient(startedAtSec);
    const outsideBadge = outOfShift
      ? ' <span title="Time outside shift windows is not counted" style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#fcd34d;background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);border-radius:8px;padding:1px 6px">Outside shift</span>'
      : '';
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--bd)">' +
      '<div class="emp-av" style="background:' + (emp.photo ? 'transparent' : emp.color) + '">' + avHtml + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:600">' + emp.name + outsideBadge + '</div>' +
        '<div style="font-size:11px;color:var(--tx3);display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:2px">' +
          'Emp: ' + emp.code + ' &middot; <span style="color:var(--tx2);font-weight:600">' + sessionProcess + '</span>' +
          (ab ? ' &middot; ' + escapeHtml(ab.code) : '') +
          (ab && ab.tier ? ' ' + dashTierBadge(ab.tier) : '') +
        '</div>' +
        '<div style="margin-top:8px">' +
          '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:700">Started</div>' +
          '<div title="' + escapeAttr(startedFull) + '" style="font-size:15px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.25">' +
          escapeHtml(startedLabel) +
          '</div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--tx3);margin-top:6px;line-height:1.45">' +
          'Item No: <span style="color:var(--am);font-family:monospace;font-weight:600">' + itemLabel + '</span>' +
          ' <span style="opacity:.55">&middot;</span> ' +
          'Active in: <span style="color:var(--gr);font-weight:600">' + escapeHtml(sessionProcess) + '</span>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-size:14px;font-weight:700;color:var(--gr)">' + fmtHMS(elapsed) + '</div>' +
        '<div style="font-size:10px;color:var(--tx3)">this step (in shift)</div>' +
        '<div style="font-size:11px;font-weight:700;color:var(--am);margin-top:4px">' + fmtHMS(totalItem) + '</div>' +
        '<div style="font-size:10px;color:var(--tx3)">total on item</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// â”€â”€â”€ EMPLOYEE PERF BARS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderEmployeePerf() {
  const active = STATE.active || {};
  const el = document.getElementById('emp-perf');
  if (!EMPLOYEES.length) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:13px;padding:16px;text-align:center">No employee roster yet</div>';
    return;
  }
  const tz = whTimezone();
  const todayYmd = ymdInTimezone(Date.now(), tz);
  // todayEmp is built in one pass inside the cache; no per-render filter loop.
  const real = aggregateRealtime(STATE.logs || [], tz, todayYmd);
  const todayEmp = real.todayEmp;
  const rows = EMPLOYEES.map((emp) => {
    const row = todayEmp[emp.id];
    const units = row ? row.units : 0;
    const sess = active[emp.id];
    const process = sess && sess.process
      ? String(sess.process)
      : (row && row.lastProcess ? String(row.lastProcess) : 'No activity today');
    return { emp: emp, units: units, process: process };
  }).sort((a, b) => {
    if (b.units !== a.units) return b.units - a.units;
    return String(a.emp.name).localeCompare(String(b.emp.name));
  });
  const nonZeroRows = rows.filter((r) => r.units > 0);
  const topN = nonZeroRows.length ? Math.max(1, Math.ceil(nonZeroRows.length * 0.2)) : 0;
  const topIdSet = new Set(nonZeroRows.slice(0, topN).map((r) => r.emp.id));
  const maxU = Math.max(1, rows.reduce((m, r) => Math.max(m, r.units), 0));
  el.innerHTML = rows.map((r) => {
    const emp = r.emp;
    const w = r.units > 0 ? Math.max(2, Math.round((r.units / maxU) * 100)) : 0;
    const isTop = topIdSet.has(emp.id);
    const avHtml = employeeAvatarHtml(emp);
    return '<div class="emp-row">' +
      '<div class="emp-av" style="background:' + (emp.photo ? 'transparent' : emp.color) + '">' + avHtml + '</div>' +
      '<div style="width:170px"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (isTop ? '&#11088; ' : '') + emp.name + '</div><div style="font-size:10px;color:var(--tx3)">' + escapeHtml(r.process) + '</div></div>' +
      '<div class="bar-wrap"><div class="bar-fill" style="width:' + w + '%;background:linear-gradient(90deg,' + emp.color + ',' + emp.color + '88)"></div></div>' +
      '<div style="width:56px;text-align:right;font-size:14px;font-weight:700">' + r.units + ' u</div>' +
    '</div>';
  }).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** Resolve exactly one catalog item by id/code/barcode; otherwise null item. */
function resolveUniqueCatalogItem(query) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return { item: null, imageUrl: '', hasImage: false };
  const hits = ABAYAS.filter(function (a) {
    return a && (a.id === q || String(a.code) === q || String(a.barcode) === q);
  });
  if (hits.length !== 1) return { item: null, imageUrl: '', hasImage: false };
  const item = hits[0];
  const icon = item && item.icon != null ? String(item.icon).trim() : '';
  const hasImage = /^uploads\//i.test(icon) && /\.(jpe?g|png|gif|webp)$/i.test(icon);
  const safe = hasImage ? icon.replace(/^\/+/, '').replace(/"/g, '') : '';
  return { item: item, imageUrl: safe ? '/' + safe : '', hasImage: hasImage };
}

/** Compact item picture block used in local analytics modals. */
function renderModalItemPictureBlock(resolved, heading) {
  if (!resolved || !resolved.item) return '';
  const a = resolved.item;
  const title = escapeHtml(String(heading || 'Item'));
  const code = escapeHtml(String(a.code || a.id || 'â€”'));
  const barcode = escapeHtml(String(a.barcode || 'â€”'));
  const media = resolved.hasImage
    ? '<img src="' + escapeAttr(resolved.imageUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" class="hover-preview-thumb" data-fullsrc="' + escapeAttr(resolved.imageUrl) + '">'
    : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--tx3);background:var(--s3);text-transform:uppercase;letter-spacing:.06em">No image</div>';
  return (
    '<div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--bd);border-radius:10px;background:var(--s2);margin-bottom:12px">' +
    '<div style="width:64px;height:64px;border-radius:8px;overflow:hidden;background:var(--s3);border:1px solid rgba(54,45,89,.35);flex-shrink:0">' +
    media +
    '</div>' +
    '<div style="min-width:0">' +
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.08em">' +
    title +
    '</div>' +
    '<div style="font-size:13px;font-weight:700;color:var(--tx2);margin-top:2px">' +
    code +
    '</div>' +
    '<div style="font-size:11px;color:var(--am);font-family:monospace;margin-top:2px;word-break:break-word">' +
    barcode +
    '</div>' +
    '</div></div>'
  );
}

/** Employee list avatar: initials or photo with fullscreen hover preview. */
function employeeAvatarHtml(emp) {
  if (!emp || !emp.photo) return emp.initials || '';
  const safe = String(emp.photo).replace(/^\/+/, '').replace(/"/g, '');
  return '<img src="/' + safe + '" data-fullsrc="/' + safe + '" alt="" class="hover-preview-thumb">';
}

function setFullscreenHoverPreview(src) {
  const wrap = document.getElementById('fullscreen-hover-preview');
  const img = document.getElementById('fullscreen-hover-preview-img');
  if (!wrap || !img || !src) return;
  img.src = src;
  wrap.classList.add('show');
}

function hideFullscreenHoverPreview() {
  const wrap = document.getElementById('fullscreen-hover-preview');
  if (!wrap) return;
  wrap.classList.remove('show');
}

function initDashboardHoverImagePreview() {
  if (!document.body || document.body._dashHoverPreviewBound) return;
  document.body._dashHoverPreviewBound = true;
  document.body.addEventListener('mouseover', (ev) => {
    const thumb = ev.target && ev.target.closest ? ev.target.closest('.hover-preview-thumb') : null;
    if (!thumb) return;
    setFullscreenHoverPreview(thumb.getAttribute('data-fullsrc') || thumb.getAttribute('src'));
  });
  document.body.addEventListener('mouseout', (ev) => {
    const thumb = ev.target && ev.target.closest ? ev.target.closest('.hover-preview-thumb') : null;
    if (!thumb) return;
    const next = ev.relatedTarget;
    if (next && thumb.contains && thumb.contains(next)) return;
    hideFullscreenHoverPreview();
  });
}

function logRowProcess(l) {
  const emp = empById(l.emp_id);
  return l.process || (emp ? emp.process : '') || '';
}

function formatProcessExtraCellHtml(l) {
  const proc = logRowProcess(l);
  if (proc === 'Invoice maker') {
    if (l.invoice_count == null && !l.invoice_serial) {
      return '<span style="color:var(--tx3)">\u2014</span>';
    }
    const ser = String(l.invoice_serial || '');
    const fullAttr = escapeAttr(ser);
    const preview = ser.length > 90 ? escapeHtml(ser.slice(0, 90)) + '\u2026' : escapeHtml(ser);
    const n = l.invoice_count != null ? escapeHtml(String(l.invoice_count)) : '';
    return (
      '<div style="font-size:10px;line-height:1.35;color:var(--tx2);max-height:52px;overflow:hidden" title="' +
      fullAttr +
      '">' +
      '<span style="color:#c2ef4e;font-weight:700">' +
      n +
      '</span> <span style="color:var(--tx3)">|</span> ' +
      '<span style="font-family:monospace;word-break:break-word">' +
      preview.replace(/,/g, ', ') +
      '</span></div>'
    );
  }
  if (proc === 'Checker') {
    const qty = l.quantity != null && l.quantity !== '' ? escapeHtml(String(l.quantity)) : '';
    if (!qty) return '<span style="color:var(--tx3)">\u2014</span>';
    const enteredBc = l.checker_barcode != null && String(l.checker_barcode).trim() !== '';
    const barcode = enteredBc
      ? escapeHtml(String(l.checker_barcode).trim().replace(/,/g, ', '))
      : (function () {
          const ab = ABAYAS.find(a => a.id === l.abaya_id);
          return ab && ab.barcode ? escapeHtml(String(ab.barcode)) : '';
        })();
    const barcodeHtml = barcode
      ? '<div style="font-size:10px;color:var(--tx3);font-family:monospace;margin-top:2px">' + barcode + '</div>'
      : '';
    return (
      '<div style="font-size:11px;line-height:1.35;color:var(--tx2)">' +
      '<span style="color:#6a5fc1;font-weight:700">Qty: ' + qty + '</span>' +
      barcodeHtml +
      '</div>'
    );
  }
  return '<span style="color:var(--tx3)">\u2014</span>';
}

function renderRecentInvoiceLogsNode() {
  const el = document.getElementById('recent-invoice-logs');
  if (!el) return;
  const logs = (STATE.logs || []).slice().reverse();
  const rows = logs.filter(function (l) {
    return logRowProcess(l) === 'Invoice maker' && l.invoice_serial;
  }).slice(0, 25);
  if (!rows.length) {
    el.innerHTML =
      '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">No invoice-maker completions in memory yet.</div>';
    return;
  }
  el.innerHTML = rows
    .map(function (l) {
      const t = formatDateTimeTz(l.end, { timeZone: whTimezone() });
      const emp = empById(l.emp_id);
      const name = escapeHtml(emp ? emp.name : l.emp_id || 'â€”');
      const nums = escapeHtml(String(l.invoice_serial || '')).replace(/,/g, ', ');
      const cnt =
        l.invoice_count != null ? '<span style="color:#c2ef4e;font-weight:700">' + escapeHtml(String(l.invoice_count)) + '</span>' : '';
      return (
        '<div style="display:grid;grid-template-columns:48px minmax(0,1fr) 32px;gap:8px;padding:8px 0;border-bottom:1px solid rgba(54,45,89,.3);font-size:11px;align-items:start">' +
        '<span style="color:var(--tx3)">' +
        t +
        '</span>' +
        '<span style="word-break:break-word;font-family:monospace;font-size:10px;line-height:1.35;color:var(--tx2)">' +
        nums +
        '</span>' +
        '<span style="text-align:right">' +
        cnt +
        '</span></div>'
      );
    })
    .join('');
}

function renderRecentCheckerLogsNode() {
  const el = document.getElementById('recent-checker-logs');
  if (!el) return;
  const logs = (STATE.logs || []).slice().reverse();
  const rows = logs.filter(function (l) {
    return logRowProcess(l) === 'Checker';
  }).slice(0, 40);
  if (!rows.length) {
    el.innerHTML =
      '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">No Checker completions in memory yet.</div>';
    return;
  }
  const head =
    '<div style="display:grid;grid-template-columns:52px minmax(0,1fr) 72px 44px minmax(0,1.2fr);gap:8px;padding:8px 8px 10px;border-bottom:1px solid var(--bd);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--tx3);align-items:end">' +
    '<span>Time</span><span>Employee</span><span>Item</span><span style="text-align:right">Qty</span><span>Barcode(s)</span></div>';
  const body = rows
    .map(function (l) {
      const t = formatDateTimeTz(l.end, { timeZone: whTimezone() });
      const emp = empById(l.emp_id);
      const ab = ABAYAS.find(function (a) {
        return a.id === l.abaya_id;
      });
      const name = escapeHtml(emp ? emp.name : l.emp_id || 'â€”');
      const code = ab ? escapeHtml(String(ab.code)) : '\u2014';
      const qty =
        l.quantity != null && l.quantity !== ''
          ? '<span style="color:#6a5fc1;font-weight:800">' + escapeHtml(String(l.quantity)) + '</span>'
          : '\u2014';
      const tier = ab && ab.tier ? ' ' + dashTierBadge(ab.tier) : '';
      return (
        '<div style="display:grid;grid-template-columns:52px minmax(0,1fr) 72px 44px minmax(0,1.2fr);gap:8px;padding:10px 8px;border-bottom:1px solid rgba(54,45,89,.28);font-size:11px;align-items:start">' +
        '<span style="color:var(--tx3)">' +
        escapeHtml(t) +
        '</span>' +
        '<span style="font-weight:600;color:var(--tx2)">' +
        name +
        '</span>' +
        '<span style="font-family:monospace;font-size:10px;color:var(--am)">' +
        code +
        tier +
        '</span>' +
        '<span style="text-align:right">' +
        qty +
        '</span>' +
        '<div>' +
        checkerBarcodeCellHtml(l) +
        '</div></div>'
      );
    })
    .join('');
  el.innerHTML =
    '<div style="border:1px solid var(--bd);border-radius:12px;background:var(--s2);overflow:hidden">' + head + body + '</div>';
}

// â”€â”€â”€ HOURLY CHART â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderHourlyChart() {
  // Only display hour buckets that overlap today's configured shift windows.
  const nowSec = Math.floor(Date.now() / 1000);
  const todayKey = whWeekdayKey(nowSec);
  const windows = whWindowsForDay(todayKey);

  const hours = {};
  if (windows.length > 0) {
    for (let i = 0; i < windows.length; i++) {
      const startH = Math.floor(windows[i][0] / 60);
      const endMin = windows[i][1];
      const endH = endMin % 60 === 0 ? Math.floor(endMin / 60) - 1 : Math.floor(endMin / 60);
      for (let h = startH; h <= endH; h++) {
        if (hours[h] == null) hours[h] = 0;
      }
    }
  } else {
    const h0 = typeof FACTORY_HOURLY_START === 'number' ? FACTORY_HOURLY_START : 9;
    const h1 = typeof FACTORY_HOURLY_END === 'number' ? FACTORY_HOURLY_END : 23;
    for (let h = h0; h <= h1; h++) hours[h] = 0;
  }

  // Read pre-computed hour counts from the cache (single pass, no log walk here).
  const tz = whTimezone();
  const todayYmd = ymdInTimezone(Date.now(), tz);
  const real = aggregateRealtime(STATE.logs || [], tz, todayYmd);
  for (let h in real.hourBuckets) {
    if (hours[h] != null) hours[h] = real.hourBuckets[h];
  }

  const sortedHours = Object.keys(hours).map(Number).sort((a, b) => a - b);
  // Compute max in one pass instead of Math.max.apply (avoids spread overhead).
  let max = 0;
  for (let i = 0; i < sortedHours.length; i++) {
    const v = hours[sortedHours[i]] || 0;
    if (v > max) max = v;
  }
  if (max < 1) max = 1;
  const bar = document.getElementById('hourly');
  const lbl = document.getElementById('hlbl');
  bar.innerHTML = sortedHours
    .map((h) => {
      const v = hours[h] || 0;
      const ht = Math.max(4, Math.round((v / max) * 76));
      return (
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">' +
        '<div style="font-size:10px;color:var(--tx3)">' + (v > 0 ? v : '') + '</div>' +
        '<div style="width:100%;height:' + ht + 'px;background:linear-gradient(180deg,var(--bl),var(--pu));border-radius:3px 3px 0 0;opacity:' + (v > 0 ? 1 : 0.15) + '"></div>' +
        '</div>'
      );
    })
    .join('');
  lbl.innerHTML = sortedHours
    .map((h) => '<div style="flex:1;font-size:9px;color:var(--tx3);text-align:center">' + h + '</div>')
    .join('');

  const sh = document.getElementById('shift-hint');
  if (sh && typeof FACTORY_SHIFT_SCHEDULE_TEXT === 'string') {
    sh.textContent = FACTORY_SHIFT_SCHEDULE_TEXT;
  }
}

// â”€â”€â”€ PARETO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderPareto() {
  const tz = whTimezone();
  const todayYmd = ymdInTimezone(Date.now(), tz);
  const real = aggregateRealtime(STATE.logs || [], tz, todayYmd);
  const todayEmp = real.todayEmp;
  const perf = EMPLOYEES.map((e) => ({ id: e.id, units: (todayEmp[e.id] || {}).units || 0 }))
    .filter((p) => p.units > 0)
    .sort((a, b) => b.units - a.units);
  const topN = perf.length ? (Math.ceil(perf.length * 0.2) || 1) : 0;
  const topUnits = perf.slice(0, topN).reduce((s, p) => s + p.units, 0);
  const totalUnits = perf.reduce((s, p) => s + p.units, 0);
  const pct = totalUnits > 0 ? Math.round((topUnits / totalUnits) * 100) : 0;
  const el = document.getElementById('pareto-chart');
  if (!perf.length) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:13px;text-align:center;padding:20px">No completed units today yet</div>';
    return;
  }
  el.innerHTML = '<div style="text-align:center;margin-bottom:14px">' +
    '<div style="font-size:36px;font-weight:800;color:var(--am)">' + pct + '%</div>' +
    '<div style="font-size:12px;color:var(--tx2)">of output from top ' + topN + ' worker' + (topN > 1 ? 's' : '') + '</div>' +
  '</div>' +
  perf.slice(0, 5).map((p, i) => {
    const emp = empById(p.id);
    if (!emp) return '';
    const pctEmp = totalUnits > 0 ? Math.round((p.units / totalUnits) * 100) : 0;
    const avHtml = employeeAvatarHtml(emp);
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<div class="emp-av" style="background:' + (emp.photo ? 'transparent' : emp.color) + ';width:28px;height:28px;font-size:10px">' + avHtml + '</div>' +
      '<div style="flex:1"><div style="font-size:11px;font-weight:600">' + emp.name + '</div>' +
      '<div style="height:5px;background:var(--s3);border-radius:3px;margin-top:3px"><div style="height:100%;width:' + pctEmp + '%;background:' + emp.color + ';border-radius:3px"></div></div></div>' +
      '<div style="font-size:12px;font-weight:700;color:var(--tx2)">' + p.units + '</div>' +
    '</div>';
  }).join('');
}

// â”€â”€â”€ PROCESS EFF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function canonicalLogProcess(l) {
  var lp = l.process || (empById(l.emp_id) || {}).process || '';
  if (lp === 'Cutting') return 'Tailor (01)';
  if (lp === 'Cutting master') return 'Tailor (01)';
  if (lp === 'Stitching') return 'Tailor (02)';
  if (lp === 'Finishing') return 'Hand Work';
  return lp;
}

function logMatchesWorkType(l, workType) {
  return canonicalLogProcess(l) === workType;
}

function renderProcessEff() {
  var procs = typeof WORK_TYPES !== 'undefined' ? WORK_TYPES : [];
  var el = document.getElementById('proc-eff');
  var colors = {
    'Tailor (01)': 'var(--bl)',
    'Cutting master': '#d946ef',
    'Tailor (02)': '#8b5cf6',
    'Hand Work': 'var(--gr)',
    'Stone Work': 'var(--am)',
    'Button': '#fa7faa',
    'Embroidery': 'var(--pu)',
    'Ari Work': '#14b8a6',
    'Hand Designing': '#ffb287',
    'Invoice maker': '#c2ef4e',
    'Packaging': '#79628c',
    'Checker': '#6a5fc1'
  };
  // Build a canonical-process -> aggregated stats map for *today* in one pass.
  // The cache returns the same object every render in steady state, so this
  // map is also O(1) amortized.
  const tz = whTimezone();
  const todayYmd = ymdInTimezone(Date.now(), tz);
  const real = aggregateRealtime(STATE.logs || [], tz, todayYmd);
  // canonicalLogProcess maps 'Cutting' -> 'Tailor (01)' etc. — same map the
  // original used via logMatchesWorkType(). We replicate the aliasing here so
  // the per-worktype counts match what the dashboard showed before.
  const alias = {
    'Cutting': 'Tailor (01)',
    'Cutting master': 'Tailor (01)',
    'Stitching': 'Tailor (02)',
    'Finishing': 'Hand Work',
  };
  // Group today's per-process totals by their canonical name.
  const byCanonical = Object.create(null);
  for (const p in real.todayProc) {
    const canon = alias[p] || p;
    let r = byCanonical[canon];
    if (!r) { r = { units: 0, totalSec: 0 }; byCanonical[canon] = r; }
    r.units += real.todayProc[p].units;
    r.totalSec += real.todayProc[p].totalSec;
  }
  el.innerHTML = procs.map(function (proc) {
    var stats = byCanonical[proc];
    var units = stats ? stats.units : 0;
    var avgSec = units > 0 ? Math.round(stats.totalSec / units) : 0;
    var target = 2700;
    var eff = avgSec > 0 ? Math.min(100, Math.round((target / avgSec) * 100)) : 0;
    var col = colors[proc] || 'var(--tx2)';
    return '<div style="margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">' +
        '<span style="font-weight:600">' + proc + '</span>' +
        '<span style="color:' + col + ';font-weight:700">' + eff + '% &middot; ' + units + ' units</span>' +
      '</div>' +
      '<div style="height:6px;background:var(--s3);border-radius:3px"><div style="height:100%;width:' + eff + '%;background:' + col + ';border-radius:3px;transition:width .5s"></div></div>' +
    '</div>';
  }).join('');
}

// â”€â”€â”€ REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let activeReportType = 'Daily';
let reportEmployeeFilterId = 'all';
let lastReportPeriod = null;

// Cache the report aggregation so re-opening the same modal (no new logs) is
// instant. Cache key = (type, periodHash, employeeFilterId, logsFingerprint).
// We bust the cache whenever a new log arrives.
const REPORT_CACHE_LIMIT = 4; // LRU: keep last 4 distinct (type x filter) results
const reportCache = new Map();
let reportCacheBytes = 0;
const REPORT_CACHE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB ceiling

function reportCacheGet(key) {
  if (!reportCache.has(key)) return null;
  const entry = reportCache.get(key);
  // LRU touch: re-insert so it's most-recent
  reportCache.delete(key);
  reportCache.set(key, entry);
  return entry;
}
function reportCachePut(key, value) {
  if (reportCache.has(key)) {
    reportCacheBytes -= reportCache.get(key).bytes;
    reportCache.delete(key);
  }
  const json = JSON.stringify(value);
  const bytes = json.length * 2; // rough utf-16 size
  if (bytes > REPORT_CACHE_MAX_BYTES) return; // single entry too big, skip
  reportCache.set(key, { value: value, bytes: bytes });
  reportCacheBytes += bytes;
  while (reportCache.size > REPORT_CACHE_LIMIT || reportCacheBytes > REPORT_CACHE_MAX_BYTES) {
    const oldest = reportCache.keys().next().value;
    if (!oldest) break;
    reportCacheBytes -= reportCache.get(oldest).bytes;
    reportCache.delete(oldest);
  }
}
function reportCacheClear() {
  reportCache.clear();
  reportCacheBytes = 0;
}

/**
 * Build a stable fingerprint of the current logs. Includes count and the
 * latest end timestamp, so any new log invalidates the cache.
 */
function logsFingerprint(logs) {
  if (!logs || !logs.length) return '0';
  const last = logs[logs.length - 1];
  const lastEnd = last && last.end != null ? String(last.end) : '0';
  return logs.length + ':' + lastEnd;
}

/**
 * Single-pass report aggregation. Computes everything the report needs
 * (day buckets, process totals, employee summary, item-code totals) in one
 * walk over allLogs. Replaces 4 separate forEach passes.
 */
function aggregateReport(logs) {
  const n = logs ? logs.length : 0;
  const dayBuckets = Object.create(null);
  const processAgg = Object.create(null);
  const employeeAgg = Object.create(null);
  const itemAgg = Object.create(null);
  let totalSec = 0;

  for (let i = 0; i < n; i++) {
    const l = logs[i];
    if (!l) continue;
    const sec = logDurationSec(l);
    totalSec += sec;

    // Day bucket
    const end = l.end;
    if (Number.isFinite(end)) {
      const d = new Date(end);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const dd = d.getDate();
      const ymd = y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
      let bucket = dayBuckets[ymd];
      if (!bucket) {
        bucket = { ymd: ymd, units: 0, totalSec: 0, processes: Object.create(null), weekday: d.getDay() };
        dayBuckets[ymd] = bucket;
      }
      bucket.units++;
      bucket.totalSec += sec;
      const p = l.process || '—';
      bucket.processes[p] = (bucket.processes[p] || 0) + 1;
    }

    // Process aggregation
    const procName = l.process || '—';
    let pRow = processAgg[procName];
    if (!pRow) { pRow = { units: 0, totalSec: 0 }; processAgg[procName] = pRow; }
    pRow.units++;
    pRow.totalSec += sec;

    // Employee aggregation
    const empId = l.emp_id;
    if (empId != null && empId !== '') {
      const ek = String(empId);
      let eRow = employeeAgg[ek];
      if (!eRow) { eRow = { empId: ek, units: 0, totalSec: 0 }; employeeAgg[ek] = eRow; }
      eRow.units++;
      eRow.totalSec += sec;
    }

    // Item-code aggregation
    const abayaId = l.abaya_id;
    if (abayaId != null && abayaId !== '') {
      const ak = String(abayaId);
      let aRow = itemAgg[ak];
      if (!aRow) { aRow = { abaya_id: ak, units: 0, totalSec: 0, segments: 0 }; itemAgg[ak] = aRow; }
      aRow.units++;
      aRow.totalSec += sec;
      aRow.segments++;
    }
  }

  return {
    totalUnits: n,
    totalSec: totalSec,
    avgSec: n > 0 ? Math.round(totalSec / n) : 0,
    dayBuckets: dayBuckets,
    processAgg: processAgg,
    employeeAgg: employeeAgg,
    itemAgg: itemAgg,
  };
}

/**
 * Single-pass aggregator for the realtime dashboard panels (KPIs, Employee
 * perf, Pareto, Process efficiency, Hourly chart, Abaya totals). Builds
 * everything the live renderers need in ONE walk over logs.
 *
 * Caches via dashboardAggregateCache (keyed on logsFingerprint + tz + today).
 * Busted on every state_update by applyFallbackState.
 */
const dashboardAggregateCache = { value: null, fingerprint: '' };

function aggregateRealtime(logs, tz, todayYmd) {
  const fingerprint = (tz || '') + '|' + (todayYmd || '') + '|' + logsFingerprint(logs);
  if (dashboardAggregateCache.value && dashboardAggregateCache.fingerprint === fingerprint) {
    return dashboardAggregateCache.value;
  }

  const n = logs ? logs.length : 0;
  // Today's buckets
  const todayUnits = 0;
  let todayCount = 0;
  let todaySec = 0;
  const todayEmp = Object.create(null);     // empId -> { units, lastEnd, lastProcess }
  const todayProc = Object.create(null);    // procName -> { units, totalSec }
  // All-time buckets
  const itemAgg = Object.create(null);      // abayaId -> { units, totalSec, segments, activeSec }
  const hourBuckets = Object.create(null);  // hour (0-23) -> count

  for (let i = 0; i < n; i++) {
    const l = logs[i];
    if (!l) continue;
    const end = l.end;
    const endNum = Number(end);
    if (!Number.isFinite(endNum)) continue;
    const sec = logDurationSec(l);
    const d = new Date(endNum);
    const ymd = ymdInTimezone(endNum, tz);
    const hour = d.getHours();

    // Hour bucket (cheap, no allocation)
    hourBuckets[hour] = (hourBuckets[hour] || 0) + 1;

    if (ymd === todayYmd) {
      todayCount++;
      todaySec += sec;
      const empId = l.emp_id != null && l.emp_id !== '' ? String(l.emp_id) : '';
      if (empId) {
        let row = todayEmp[empId];
        if (!row) { row = { units: 0, lastEnd: 0, lastProcess: '' }; todayEmp[empId] = row; }
        row.units++;
        if (endNum > row.lastEnd) {
          row.lastEnd = endNum;
          row.lastProcess = l.process || row.lastProcess || '';
        }
      }
      const proc = l.process || '—';
      let pRow = todayProc[proc];
      if (!pRow) { pRow = { units: 0, totalSec: 0 }; todayProc[proc] = pRow; }
      pRow.units++;
      pRow.totalSec += sec;
    }

    // Item-code aggregation (all-time, used by renderAbayaItemTotals)
    const abayaId = l.abaya_id;
    if (abayaId != null && abayaId !== '') {
      const ak = String(abayaId);
      let aRow = itemAgg[ak];
      if (!aRow) { aRow = { abaya_id: ak, units: 0, totalSec: 0, segments: 0, activeSec: 0 }; itemAgg[ak] = aRow; }
      aRow.units++;
      aRow.totalSec += sec;
      aRow.segments++;
    }
  }

  const out = {
    todayCount: todayCount,
    todaySec: todaySec,
    todayAvgSec: todayCount > 0 ? Math.round(todaySec / todayCount) : 0,
    todayEmp: todayEmp,
    todayProc: todayProc,
    itemAgg: itemAgg,
    hourBuckets: hourBuckets,
  };
  dashboardAggregateCache.value = out;
  dashboardAggregateCache.fingerprint = fingerprint;
  return out;
}

function dashboardAggregateCacheClear() {
  dashboardAggregateCache.value = null;
  dashboardAggregateCache.fingerprint = '';
}


function employeeIndexMap() {
  const out = Object.create(null);
  (EMPLOYEES || []).forEach(function (e) {
    if (!e || !e.id) return;
    out[String(e.id)] = e;
  });
  return out;
}

function normalizeLookupId(id) {
  return String(id == null ? '' : id).trim();
}

function resolveEmployeeDisplay(empId, empById) {
  const key = normalizeLookupId(empId);
  const byId = empById || employeeIndexMap();
  const emp = key ? byId[key] : null;
  const name = emp && emp.name ? String(emp.name) : 'Unknown employee';
  return { name: name, found: !!(emp && emp.name) };
}

function abayaIndexMap() {
  const out = Object.create(null);
  (ABAYAS || []).forEach(function (a) {
    if (!a || !a.id) return;
    out[String(a.id)] = a;
  });
  return out;
}

function summarizeLogsByEmployee(logs, empById) {
  const by = Object.create(null);
  (logs || []).forEach(function (l) {
    if (!l || !l.emp_id) return;
    const id = String(l.emp_id);
    if (!by[id]) by[id] = { empId: id, empName: id, units: 0, totalSec: 0, avgSec: 0 };
    const row = by[id];
    const emp = empById[id];
    row.empName = emp && emp.name ? String(emp.name) : id;
    row.units += 1;
    row.totalSec += logDurationSec(l);
  });
  const total = (logs || []).length;
  const rows = Object.keys(by).map(function (id) {
    const r = by[id];
    r.avgSec = r.units > 0 ? Math.round(r.totalSec / r.units) : 0;
    r.sharePct = total > 0 ? Math.round((r.units / total) * 100) : 0;
    return r;
  });
  rows.sort(function (a, b) {
    if (b.units !== a.units) return b.units - a.units;
    if (a.avgSec !== b.avgSec) return a.avgSec - b.avgSec;
    return String(a.empName).localeCompare(String(b.empName));
  });
  return rows;
}

function employeeFilterOptions(logs, empById) {
  const seen = Object.create(null);
  (logs || []).forEach(function (l) {
    if (!l || !l.emp_id) return;
    seen[String(l.emp_id)] = true;
  });
  return Object.keys(seen)
    .map(function (id) {
      const emp = empById[id];
      return { id: id, name: emp && emp.name ? String(emp.name) : id };
    })
    .sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
}

function renderEmployeeSummaryCards(rows) {
  if (!rows.length) {
    return '<div style="padding:12px;color:var(--tx3);text-align:center">No employee summary for this period.</div>';
  }
  return rows
    .map(function (r) {
      return (
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 56px 88px 84px 56px;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
        '<span style="font-weight:600;color:var(--tx2)">' +
        escapeHtml(r.empName) +
        '</span>' +
        '<span style="text-align:right;color:var(--tx3)">' +
        r.units +
        '</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">' +
        fmtHMS(r.totalSec) +
        '</span>' +
        '<span style="text-align:right;color:var(--am);font-weight:700">' +
        fmtHMS(r.avgSec) +
        '</span>' +
        '<span style="text-align:right;color:var(--pu);font-weight:700">' +
        (r.sharePct != null ? r.sharePct : 0) + '%' +
        '</span></div>'
      );
    })
    .join('');
}

function setReportEmployeeFilter(empId) {
  reportEmployeeFilterId = empId && String(empId).trim() ? String(empId).trim() : 'all';
  openReport(activeReportType);
}

function pad2(n) {
  return String(Number(n) || 0).padStart(2, '0');
}

function localYmd(tsMs) {
  const d = new Date(Number(tsMs) || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function dateAtLocalMidnight(tsMs) {
  const d = new Date(Number(tsMs) || Date.now());
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function reportPeriodForType(type, logs) {
  const now = Date.now();
  const todayStart = dateAtLocalMidnight(now).getTime();
  const tomorrowStart = todayStart + 86400000;
  const yesterdayStart = todayStart - 86400000;
  const logsArr = Array.isArray(logs) ? logs : [];
  const hasToday = logsArr.some(function (l) {
    const end = Number(l && l.end);
    return Number.isFinite(end) && end >= todayStart && end < tomorrowStart;
  });
  if (type === 'Daily') {
    const useStart = hasToday ? todayStart : yesterdayStart;
    const useEnd = useStart + 86400000;
    return {
      startMs: useStart,
      endMs: useEnd,
      startYmd: localYmd(useStart),
      endYmd: localYmd(useStart),
      effectiveDailyYmd: localYmd(useStart),
      fallbackApplied: !hasToday,
    };
  }
  if (type === 'Weekly') {
    const end = dateAtLocalMidnight(now);
    const wd = end.getDay();
    const delta = wd === 0 ? 6 : wd - 1;
    const start = new Date(end);
    start.setDate(end.getDate() - delta);
    return {
      startMs: start.getTime(),
      endMs: tomorrowStart,
      startYmd: localYmd(start.getTime()),
      endYmd: localYmd(now),
      effectiveDailyYmd: '',
      fallbackApplied: false,
    };
  }
  if (type === 'Yearly') {
    const yearStart = new Date(new Date(now).getFullYear(), 0, 1, 0, 0, 0, 0);
    return {
      startMs: yearStart.getTime(),
      endMs: tomorrowStart,
      startYmd: localYmd(yearStart.getTime()),
      endYmd: localYmd(now),
      effectiveDailyYmd: '',
      fallbackApplied: false,
    };
  }
  if (type === 'Custom') {
    // Custom-range is driven by the date pickers. Fall back to "this
    // month" if the pickers are empty so the user gets a report
    // rather than an error.
    const r = customReportRange || {};
    if (r.fromYmd && r.toYmd) {
      const a = parseYmdLocal(r.fromYmd);
      const b = parseYmdLocal(r.toYmd);
      if (a && b && a.getTime() <= b.getTime() + 86400000) {
        return {
          startMs: a.getTime(),
          endMs: b.getTime() + 86400000,
          startYmd: r.fromYmd,
          endYmd: r.toYmd,
          effectiveDailyYmd: '',
          fallbackApplied: false,
        };
      }
    }
    const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1, 0, 0, 0, 0);
    return {
      startMs: monthStart.getTime(),
      endMs: tomorrowStart,
      startYmd: localYmd(monthStart.getTime()),
      endYmd: localYmd(now),
      effectiveDailyYmd: '',
      fallbackApplied: true,
    };
  }
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1, 0, 0, 0, 0);
  return {
    startMs: monthStart.getTime(),
    endMs: tomorrowStart,
    startYmd: localYmd(monthStart.getTime()),
    endYmd: localYmd(now),
    effectiveDailyYmd: '',
    fallbackApplied: false,
  };
}

/** Parse a YYYY-MM-DD string to a local-midnight Date. */
function parseYmdLocal(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function reportWindowLabel(type, period) {
  if (!period) return '';
  if (type === 'Daily') return period.startYmd;
  if (type === 'Yearly') return 'Year ' + (period.startYmd || '').slice(0, 4);
  return period.startYmd + ' to ' + period.endYmd;
}

function openReport(type) {
  activeReportType = type;
  const period = reportPeriodForType(type, STATE.logs || []);
  lastReportPeriod = period;
  const allLogs = getLogsForType(type, period);
  const empById = employeeIndexMap();
  const abById = abayaIndexMap();

  // ── Cache lookup: avoid re-aggregating the same period+filter twice ──────
  // Cache key encodes type, period bounds, employee filter, and a fingerprint
  // of the current logs. Any new log invalidates via applyFallbackState.
  const cacheKey = type + '|' + period.startMs + '-' + period.endMs + '|' + reportEmployeeFilterId + '|' + logsFingerprint(STATE.logs);
  let agg = reportCacheGet(cacheKey);
  let summaryRows;
  let options;
  if (agg) {
    summaryRows = agg.summaryRows;
    options = agg.options;
  } else {
    // Cold path: build everything in one pass.
    const single = aggregateReport(allLogs);
    // Decorate with names for the per-employee and per-item tables.
    const empRows = Object.keys(single.employeeAgg).map(function (id) {
      const r = single.employeeAgg[id];
      const emp = empById[id];
      return {
        empId: id,
        empName: emp && emp.name ? String(emp.name) : id,
        units: r.units,
        totalSec: r.totalSec,
        avgSec: r.units > 0 ? Math.round(r.totalSec / r.units) : 0,
        sharePct: single.totalUnits > 0 ? Math.round((r.units / single.totalUnits) * 100) : 0,
      };
    });
    empRows.sort(function (a, b) {
      if (b.units !== a.units) return b.units - a.units;
      if (a.avgSec !== b.avgSec) return a.avgSec - b.avgSec;
      return String(a.empName).localeCompare(String(b.empName));
    });
    summaryRows = empRows;
    options = employeeFilterOptions(allLogs, empById);
    agg = { summaryRows: summaryRows, options: options, single: single };
    reportCachePut(cacheKey, agg);
  }
  const single = agg.single;
  const allowedFilter = reportEmployeeFilterId === 'all' || options.some(function (o) {
    return o.id === reportEmployeeFilterId;
  });
  if (!allowedFilter) reportEmployeeFilterId = 'all';
  const logs = reportEmployeeFilterId === 'all'
    ? allLogs
    : allLogs.filter(function (l) {
        return String(l.emp_id) === reportEmployeeFilterId;
      });
  const modal = document.getElementById('modal-report');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');

  title.textContent = type + ' Production Report â€” ' + reportWindowLabel(type, period);
  const tsMeta = document.getElementById('modal-ts');
  if (tsMeta) {
    const extra = period && period.fallbackApplied ? ' (auto-fallback: no logs today, showing yesterday)' : '';
    tsMeta.textContent = 'Generated on ' + new Date().toLocaleString() + ' â€” Window: ' + reportWindowLabel(type, period) + extra;
  }

  const totalUnits = single.totalUnits;
  const totalSec = single.totalSec;
  const avgCycle = totalUnits > 0 ? fmtHMS(single.avgSec) : 'â€"';
  const actCount = Object.keys(STATE.active || {}).length;

  // Summary cards
  let html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px">' +
    statCard('Total Output', totalUnits + ' units', 'var(--gr)') +
    statCard('Avg Cycle', avgCycle, 'var(--am)') +
    statCard('Active Now', actCount, 'var(--bl)') +
  '</div>';

  // ─── Day-by-day breakdown (the "absolute clarity" panel) ──────────────────
  // For weekly / monthly / yearly / custom-range: shows one row per day with
  // weekday label, full date, units, total time, and % share of the period.
  // For daily: shows a single one-line summary instead of an empty table.
  if (type !== 'Daily' && period.startMs && period.endMs) {
    const dayBuckets = single.dayBuckets;
    const dayKeys = Object.keys(dayBuckets).sort();
    if (dayKeys.length) {
      const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      // Compute peak in one pass instead of Math.max.apply() over an array
      // (avoids spread overhead and is faster on large day sets).
      let peakUnits = 0;
      for (let i = 0; i < dayKeys.length; i++) {
        const u = dayBuckets[dayKeys[i]].units;
        if (u > peakUnits) peakUnits = u;
      }
      html +=
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--tx3);margin-bottom:8px">Day-by-day — ' +
        dayKeys.length + ' day' + (dayKeys.length === 1 ? '' : 's') + ' with activity' +
        '</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:16px;max-height:300px;overflow-y:auto">' +
        '<div style="display:grid;grid-template-columns:54px 92px minmax(0,1fr) 60px 76px 56px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px">' +
          '<span>Day</span><span>Date</span><span>Activity</span><span style="text-align:right">Units</span><span style="text-align:right">Total time</span><span style="text-align:right">Share</span>' +
        '</div>';
      for (let i = 0; i < dayKeys.length; i++) {
        const k = dayKeys[i];
        const b = dayBuckets[k];
        // Weekday was computed during aggregation, no need to re-parse the date.
        const wd = WD[b.weekday != null ? b.weekday : 0];
        const share = totalUnits > 0 ? Math.round((b.units / totalUnits) * 100) : 0;
        const barWidth = peakUnits > 0 ? Math.max(4, Math.round((b.units / peakUnits) * 100)) : 0;
        // Top process for the day — single-pass scan instead of sort.
        let topProc = '—';
        let topProcCount = 0;
        const procs = b.processes;
        for (const pk in procs) {
          if (procs[pk] > topProcCount) { topProcCount = procs[pk]; topProc = pk; }
        }
        const topProcPct = b.units > 0 ? Math.round((topProcCount / b.units) * 100) : 0;
        html +=
          '<div style="display:grid;grid-template-columns:54px 92px minmax(0,1fr) 60px 76px 56px;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
            '<span style="font-weight:700;color:var(--bl)">' + wd + '</span>' +
            '<span style="color:var(--tx3);font-family:var(--fn-mono);font-size:11px">' + k + '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;min-width:0">' +
              '<span style="display:inline-block;height:6px;background:linear-gradient(90deg,var(--gr),var(--bl));border-radius:3px;flex:0 0 ' + barWidth + '%;max-width:100%"></span>' +
              '<span style="font-size:10px;color:var(--tx3);white-space:nowrap">' + escapeHtml(topProc) + ' ' + topProcPct + '%</span>' +
            '</span>' +
            '<span style="text-align:right;font-weight:700">' + b.units + '</span>' +
            '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(b.totalSec) + '</span>' +
            '<span style="text-align:right;color:var(--am);font-weight:600">' + share + '%</span>' +
          '</div>';
      }
      html += '</div>';
    }
  }

  // ─── Process totals — what kind of work and how much ──────────────────────
  // Always shown (even for Daily). One row per distinct process with units,
  // total time, and % share of the period.
  if (allLogs.length) {
    // Build the sorted list of process rows from the single-pass aggregate.
    // Sort the keys by units desc — Object.keys on plain objects preserves
    // insertion order in V8, so this is just O(d log d) where d = process count
    // (typically < 20, effectively free).
    const procKeys = Object.keys(single.processAgg);
    if (procKeys.length) {
      procKeys.sort(function (a, b) { return single.processAgg[b].units - single.processAgg[a].units; });
      html +=
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--tx3);margin-bottom:8px">What work was done — by process</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:16px">' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 60px 88px 56px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px">' +
          '<span>Process</span><span style="text-align:right">Units</span><span style="text-align:right">Total time</span><span style="text-align:right">Share</span>' +
        '</div>';
      for (let i = 0; i < procKeys.length; i++) {
        const k = procKeys[i];
        const r = single.processAgg[k];
        const share = totalUnits > 0 ? Math.round((r.units / totalUnits) * 100) : 0;
        html +=
          '<div style="display:grid;grid-template-columns:minmax(0,1fr) 60px 88px 56px;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
            '<span style="font-weight:600;color:var(--bl)">' + escapeHtml(k) + '</span>' +
            '<span style="text-align:right;font-weight:700">' + r.units + '</span>' +
            '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(r.totalSec) + '</span>' +
            '<span style="text-align:right;color:var(--am);font-weight:600">' + share + '%</span>' +
          '</div>';
      }
      html += '</div>';
    }
  }

  // Per-item code block — use the cached single.itemAgg instead of the
  // separate aggregateGarmentSeconds() pass.
  const garmentAgg = single.itemAgg;
  const garmentKeys = Object.keys(garmentAgg).filter(function (k) {
    return garmentAgg[k].totalSec > 0 || garmentAgg[k].segments > 0;
  });
  if (garmentKeys.length) {
    // Decorate with code + tier in one pass; sort by total time desc.
    const gRows = garmentKeys.map(function (k) {
      const o = garmentAgg[k];
      const ab = abById[String(o.abaya_id)] || null;
      return { label: ab ? ab.code : o.abaya_id, totalSec: o.totalSec, segments: o.segments, tier: ab && ab.tier ? ab.tier : '' };
    });
    gRows.sort(function (a, b) {
      if (b.totalSec !== a.totalSec) return b.totalSec - a.totalSec;
      return String(a.label).localeCompare(String(b.label));
    });
    html +=
      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--tx3);margin-bottom:8px">Total time by item code (this report window)</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:16px;max-height:200px;overflow-y:auto">' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) 52px 88px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);font-size:10px;color:var(--tx3)">' +
      '<span>Item</span><span style="text-align:right">Steps</span><span style="text-align:right">Total time</span></div>';
    for (let i = 0; i < gRows.length; i++) {
      const r = gRows[i];
      const tierHtml = r.tier ? ' ' + dashTierBadge(r.tier) : '';
      html +=
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 52px 88px;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
        '<span style="font-weight:600">' +
        escapeHtml(String(r.label)) +
        tierHtml +
        '</span>' +
        '<span style="text-align:right;color:var(--tx3)">' +
        r.segments +
        '</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">' +
        fmtHMS(r.totalSec) +
        '</span></div>';
    }
    html += '</div>';
  }

  const filterSelect =
    '<label style="font-size:11px;color:var(--tx3);display:flex;align-items:center;gap:8px;justify-content:flex-end">' +
    '<span>Employee</span>' +
    '<select onchange="setReportEmployeeFilter(this.value)" style="padding:6px 8px;border-radius:8px;border:1px solid var(--bd);background:var(--s2);color:var(--tx2);font-family:var(--fn);font-size:11px;max-width:220px">' +
    '<option value="all"' +
    (reportEmployeeFilterId === 'all' ? ' selected' : '') +
    '>All employees</option>' +
    options
      .map(function (o) {
        return '<option value="' + escapeAttr(o.id) + '"' + (reportEmployeeFilterId === o.id ? ' selected' : '') + '>' + escapeHtml(o.name) + '</option>';
      })
      .join('') +
    '</select></label>';

  html +=
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--tx3)">Per-employee summary (this report window)</div>' +
    filterSelect +
    '</div>' +
    '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:16px">' +
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) 56px 88px 84px 56px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);font-size:10px;color:var(--tx3)">' +
    '<span>Employee</span><span style="text-align:right">Units</span><span style="text-align:right">Total time</span><span style="text-align:right">Avg</span><span style="text-align:right">Share</span></div>' +
    renderEmployeeSummaryCards(summaryRows) +
    '</div>';

  // Log table
  html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:16px">' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--tx3);padding:10px 12px;border-bottom:1px solid var(--bd);display:grid;grid-template-columns:50px minmax(0,1fr) 72px minmax(72px,0.9fr) 58px minmax(100px,1.1fr);gap:8px;align-items:center">' +
      '<span>Time</span><span>Employee</span><span>Abaya</span><span>Process</span><span style="text-align:right">Duration</span><span>Invoices</span>' +
    '</div>' +
    '<div style="max-height:240px;overflow-y:auto">';

  if (logs.length === 0) {
    html += '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:13px">No logs for this period</div>';
  } else {
    // Render newest first. Cap at 200 rows so the per-log table doesn't
    // cost O(n) HTML for 50k+ logs — the user only sees ~30 visible rows
    // in the 240px-tall scroll pane anyway, so this is invisible UX-wise.
    const PER_LOG_CAP = 200;
    const showCount = Math.min(logs.length, PER_LOG_CAP);
    const truncated = logs.length > PER_LOG_CAP;
    // Walk the array in reverse (no slice() — saves one O(n) copy on huge logs).
    const parts = new Array(showCount);
    for (let i = 0; i < showCount; i++) {
      const l = logs[logs.length - 1 - i];
      const emp = empById[String(l.emp_id)] || null;
      const ab = abById[String(l.abaya_id)] || null;
      const t = new Date(l.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Use the process stored in the log (employee may have selected a different role)
      const logProcess = l.process || (emp ? emp.process : 'â€"');
      parts[i] =
        '<div style="display:grid;grid-template-columns:50px minmax(0,1fr) 72px minmax(72px,0.9fr) 58px minmax(100px,1.1fr);gap:8px;padding:9px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:start">' +
        '<span style="color:var(--tx3)">' + t + '</span>' +
        '<span style="font-weight:600">' + (emp ? escapeHtml(emp.name) : 'â€"') + '</span>' +
        '<span style="color:var(--tx2)">' + (ab ? escapeHtml(ab.code) : 'â€"') + (ab && ab.tier ? ' ' + dashTierBadge(ab.tier) : '') + '</span>' +
        '<span style="color:var(--bl);font-weight:600">' + escapeHtml(String(logProcess)) + '</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(logDurationSec(l)) + '</span>' +
        formatProcessExtraCellHtml(l) +
      '</div>';
    }
    html += parts.join('');
    if (truncated) {
      html += '<div style="padding:10px 12px;font-size:11px;color:var(--tx3);text-align:center;background:var(--s1)">Showing newest ' + showCount + ' of ' + logs.length + ' log rows. Scroll inside the report for the day/process/employee summaries above.</div>';
    }
  }
  html += '</div></div>';

  body.innerHTML = html;
  modal.classList.add('open');
}

function statCard(label, val, color) {
  return '<div style="background:var(--s2);border-radius:10px;padding:14px;text-align:center;border:1px solid var(--bd)">' +
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">' + label + '</div>' +
    '<div style="font-size:22px;font-weight:800;color:' + color + '">' + val + '</div>' +
  '</div>';
}

function getLogsForType(type, period) {
  const logs = STATE.logs || [];
  const p = period || reportPeriodForType(type, logs);
  return logs.filter(function (l) {
    const end = Number(l && l.end);
    return Number.isFinite(end) && end >= p.startMs && end < p.endMs;
  });
}

function closeReport() {
  const modal = document.getElementById('modal-report');
  modal.classList.remove('open');
  // Reset overflow: openEveryEmployeeEveryTask sets maxHeight/overflowY
  // so long lists stay scrollable; the next normal report should fill
  // the modal instead.
  const body = document.getElementById('modal-body');
  if (body) { body.style.maxHeight = ''; body.style.overflowY = ''; }
}

/** Aggregate logs (same shape as socket logs) for bottleneck / leader UI */
function computeLocalAnalytics(logs) {
  const byProc = {};
  const empProc = {};
  const byEmp = {};
  const procItems = {};
  const empItems = {};
  logs.forEach(function (l) {
    const proc = l.process || 'â€”';
    const du = Number(l.duration_sec) || 0;
    if (!byProc[proc]) byProc[proc] = { units: 0, totalSec: 0 };
    byProc[proc].units += 1;
    byProc[proc].totalSec += du;
    const key = l.emp_id + '|' + proc;
    if (!empProc[key]) empProc[key] = { emp_id: l.emp_id, process: proc, units: 0, totalSec: 0 };
    empProc[key].units += 1;
    empProc[key].totalSec += du;
    if (!byEmp[l.emp_id]) byEmp[l.emp_id] = { units: 0, totalSec: 0 };
    byEmp[l.emp_id].units += 1;
    byEmp[l.emp_id].totalSec += du;
    const abId = l.abaya_id != null && l.abaya_id !== '' ? String(l.abaya_id) : '';
    if (abId) {
      if (!procItems[proc]) procItems[proc] = {};
      procItems[proc][abId] = (procItems[proc][abId] || 0) + 1;
      if (!empItems[l.emp_id]) empItems[l.emp_id] = {};
      empItems[l.emp_id][abId] = (empItems[l.emp_id][abId] || 0) + 1;
    }
  });
  const by_process = Object.keys(byProc)
    .map(function (p) {
      const o = byProc[p];
      const avg = o.units > 0 ? Math.round(o.totalSec / o.units) : 0;
      return {
        emp_process: p,
        units: o.units,
        avg_sec: avg,
        min_sec: avg,
        max_sec: avg,
      };
    })
    .sort(function (a, b) {
      return b.avg_sec - a.avg_sec;
    });
  const fastestMap = {};
  Object.keys(empProc).forEach(function (k) {
    const o = empProc[k];
    if (o.units < 2) return;
    const avg = Math.round(o.totalSec / o.units);
    const p = o.process;
    if (!fastestMap[p] || avg < fastestMap[p].avg_sec) {
      const emp = empById(o.emp_id);
      fastestMap[p] = {
        emp_name: emp ? emp.name : o.emp_id,
        emp_process: p,
        units: o.units,
        avg_sec: avg,
      };
    }
  });
  Object.keys(fastestMap).forEach(function (p) {
    const ids = Object.keys(procItems[p] || {});
    if (ids.length !== 1) return;
    fastestMap[p].lead_abaya_id = ids[0];
  });
  const fastest_per_process = Object.values(fastestMap).sort(function (a, b) {
    return String(a.emp_process).localeCompare(String(b.emp_process));
  });
  const speed_leaders = Object.keys(byEmp)
    .map(function (id) {
      const o = byEmp[id];
      if (o.units < 2) return null;
      const emp = empById(id);
      return {
        emp_id: id,
        emp_name: emp ? emp.name : id,
        emp_process: emp ? emp.process : 'â€”',
        units: o.units,
        avg_sec: Math.round(o.totalSec / o.units),
        lead_abaya_id: Object.keys(empItems[id] || {}).length === 1 ? Object.keys(empItems[id] || {})[0] : '',
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.avg_sec - b.avg_sec;
    })
    .slice(0, 40);
  return {
    by_process: by_process,
    fastest_per_process: fastest_per_process,
    speed_leaders: speed_leaders,
    log_count: logs.length,
  };
}

function openLocalProcessAnalytics() {
  const logs = STATE.logs || [];
  const period = 'This server (session)';
  const d = computeLocalAnalytics(logs);
  activeReportType = 'LocalAnalytics';
  document.getElementById('modal-title').textContent = 'Process analytics (local)';
  document.getElementById('modal-ts').textContent = new Date().toLocaleString() + ' \u2014 ' + d.log_count + ' sessions';

  let html =
    '<p style="font-size:12px;color:var(--tx3);line-height:1.45;margin-bottom:12px">Bottleneck = highest average time per station. Leaders need 2+ sessions in the window.</p>';

  html +=
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;margin-bottom:6px">Avg time by station</div><div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px;font-size:13px">';
  if (!d.by_process.length) {
    html += '<div style="padding:16px;text-align:center;color:var(--tx3)">No sessions yet</div>';
  } else {
    d.by_process.forEach(function (row) {
      html +=
        '<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.2)">' +
        '<span style="font-weight:600">' +
        escapeHtml(row.emp_process) +
        '</span><span style="color:var(--gr);font-weight:700">' +
        fmtHMS(row.avg_sec) +
        '</span> <span style="color:var(--tx3)">(' +
        row.units +
        ')</span></div>';
    });
  }
  html += '</div>';

  html +=
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;margin-bottom:6px">Fastest per process (2+ samples)</div><div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;margin-bottom:14px;font-size:13px">';
  if (!d.fastest_per_process.length) {
    html += '<div style="padding:12px;color:var(--tx3)">Not enough split data</div>';
  } else {
    d.fastest_per_process.forEach(function (r) {
      const leadItem = r.lead_abaya_id ? resolveUniqueCatalogItem(r.lead_abaya_id) : null;
      const leadItemHtml = leadItem && leadItem.item ? renderModalItemPictureBlock(leadItem, 'Lead item') : '';
      html +=
        '<div style="padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.15)"><strong>' +
        escapeHtml(r.emp_name) +
        '</strong> \u2014 ' +
        escapeHtml(r.emp_process) +
        ' \u2014 ' +
        fmtHMS(r.avg_sec) +
        '</div>' +
        leadItemHtml;
    });
  }
  html += '</div>';

  html +=
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;margin-bottom:6px">Speed leaders (2+ units)</div><div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;max-height:200px;overflow-y:auto;font-size:13px">';
  if (!d.speed_leaders.length) {
    html += '<div style="padding:12px;color:var(--tx3)">Not enough data</div>';
  } else {
    d.speed_leaders.forEach(function (r, i) {
      const leadItem = r.lead_abaya_id ? resolveUniqueCatalogItem(r.lead_abaya_id) : null;
      const leadItemHtml = leadItem && leadItem.item ? renderModalItemPictureBlock(leadItem, 'Lead item') : '';
      html +=
        '<div style="padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.15)">' +
        (i + 1) +
        '. <strong>' +
        escapeHtml(r.emp_name) +
        '</strong> \u2014 ' +
        fmtHMS(r.avg_sec) +
        ' (' +
        r.units +
        ' u)</div>' +
        leadItemHtml;
    });
  }
  html += '</div>';

  document.getElementById('modal-body').innerHTML = html;
  window._localAnalyticsExport = { period: period, data: d };
  document.getElementById('modal-report').classList.add('open');
}

function openLocalTracePrompt() {
  const q = window.prompt('Item code or abaya id (as in catalog):', '');
  if (!q || !String(q).trim()) return;
  openLocalGarmentTrace(String(q).trim());
}

function openLocalGarmentTrace(q) {
  // #region agent log
  fetch('http://127.0.0.1:7334/ingest/ec0dc368-e56e-4507-89de-39c8d0c8ba23',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d88364'},body:JSON.stringify({sessionId:'d88364',runId:'pre-fix',hypothesisId:'H1',location:'public/dashboard.js:openLocalGarmentTrace.entry',message:'local trace entry state',data:{q:String(q||''),employeesCount:Array.isArray(EMPLOYEES)?EMPLOYEES.length:-1,logsCount:Array.isArray(STATE&&STATE.logs)?STATE.logs.length:-1},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const resolvedDirect = resolveUniqueCatalogItem(q);
  const logs = (STATE.logs || []).slice();
  const matches = logs.filter(function (l) {
    const ab = ABAYAS.find(function (a) {
      return a.id === l.abaya_id;
    });
    if (!ab) return false;
    return ab.id === q || String(ab.code) === q || String(ab.barcode) === q;
  });
  matches.sort(function (a, b) {
    return (Number(a.end) || 0) - (Number(b.end) || 0);
  });
  const sumCompleted = matches.reduce(function (s, l) {
    return s + logDurationSec(l);
  }, 0);
  // #region agent log
  fetch('http://127.0.0.1:7334/ingest/ec0dc368-e56e-4507-89de-39c8d0c8ba23',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d88364'},body:JSON.stringify({sessionId:'d88364',runId:'pre-fix',hypothesisId:'H3',location:'public/dashboard.js:openLocalGarmentTrace.matches',message:'local trace matches computed',data:{q:String(q||''),matchesCount:matches.length,sampleEmpIds:matches.slice(0,5).map(function(m){return m&&m.emp_id;})},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  let resolvedId = null;
  if (matches.length) {
    resolvedId = matches[0].abaya_id;
  } else {
    const abHit = resolvedDirect.item;
    if (abHit) resolvedId = abHit.id;
  }
  let activeExtra = 0;
  const active = STATE.active || {};
  if (resolvedId != null) {
    Object.keys(active).forEach(function (empId) {
      const sess = active[empId];
      if (!sess || String(sess.abaya_id) !== String(resolvedId)) return;
      const started = Number(sess.started_at);
      if (!Number.isFinite(started)) return;
      activeExtra += Math.max(0, Math.floor((Date.now() - started) / 1000));
    });
  }
  const sumTotal = sumCompleted + activeExtra;

  activeReportType = 'LocalTrace';
  document.getElementById('modal-title').textContent = 'Garment trace (local)';
  document.getElementById('modal-ts').textContent =
    matches.length +
    ' finished step(s) \u2014 ' +
    fmtHMS(sumCompleted) +
    ' logged' +
    (activeExtra > 0 ? ' + ' + fmtHMS(activeExtra) + ' in progress' : '') +
    ' = ' +
    fmtHMS(sumTotal) +
    ' total on item';

  let html =
    '<p style="font-size:12px;color:var(--tx3)">Order is by completion time on this server.</p>';
  if (resolvedId != null) {
    const resolvedById = resolveUniqueCatalogItem(String(resolvedId));
    if (resolvedById && resolvedById.item) {
      html += renderModalItemPictureBlock(resolvedById, 'Resolved item');
    }
  }
  if (!matches.length) {
    html +=
      '<div style="padding:20px;text-align:center;color:var(--tx3)">No sessions for <strong>' +
      escapeHtml(q) +
      '</strong></div>';
  } else {
    html +=
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;font-size:13px">';
    const empById = employeeIndexMap();
    const traceDiag = { unresolvedCount: 0, totalRows: matches.length };
    matches.forEach(function (l) {
      const resolvedEmp = resolveEmployeeDisplay(l.emp_id, empById);
      if (!resolvedEmp.found) {
        traceDiag.unresolvedCount += 1;
        // #region agent log
        fetch('http://127.0.0.1:7334/ingest/ec0dc368-e56e-4507-89de-39c8d0c8ba23',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d88364'},body:JSON.stringify({sessionId:'d88364',runId:'pre-fix',hypothesisId:'H2',location:'public/dashboard.js:openLocalGarmentTrace.empFallback',message:'employee fallback to emp_id',data:{logEmpId:l&&l.emp_id,logEmpIdType:typeof (l&&l.emp_id),employeeIdsSample:Array.isArray(EMPLOYEES)?EMPLOYEES.slice(0,5).map(function(e){return e&&e.id;}):[],employeeIdsTypeSample:Array.isArray(EMPLOYEES)?EMPLOYEES.slice(0,5).map(function(e){return typeof (e&&e.id);}):[]},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      const ab = ABAYAS.find(function (a) {
        return a.id === l.abaya_id;
      });
      const t = new Date(l.end).toLocaleString();
      html +=
        '<div style="padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.15)">' +
        '<div style="font-size:11px;color:var(--tx3)">' +
        escapeHtml(t) +
        '</div><strong>' +
        escapeHtml(resolvedEmp.name) +
        '</strong> \u2014 ' +
        escapeHtml(l.process || '') +
        ' \u2014 ' +
        fmtHMS(logDurationSec(l)) +
        (ab ? ' \u2014 ' + escapeHtml(ab.code) : '') +
        '</div>';
    });
    window._localTraceLookupDiag = traceDiag;
    html += '</div>';
  }
  document.getElementById('modal-body').innerHTML = html;
  window._localTraceExport = { q: q, matches: matches, sum: sumTotal, sumCompleted: sumCompleted, activeExtra: activeExtra };
  document.getElementById('modal-report').classList.add('open');
}

function exportReport() {
  if (activeReportType === 'LocalAnalytics' && window._localAnalyticsExport) {
    const d = window._localAnalyticsExport.data;
    let text = '*AbaYa Track â€” Floor analytics (this PC)*\n';
    text += '_Sessions in memory: ' + d.log_count + '_\n\n';
    text += '*Bottlenecks (slowest avg first)*\n';
    d.by_process.forEach(function (r) {
      text += '\u2022 ' + r.emp_process + ': ' + fmtHMS(r.avg_sec) + ' (' + r.units + ' u)\n';
    });
    text += '\n*Speed leaders*\n';
    d.speed_leaders.slice(0, 20).forEach(function (r, i) {
      text += (i + 1) + '. ' + r.emp_name + ' â€” ' + fmtHMS(r.avg_sec) + '\n';
    });
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    closeReport();
    return;
  }
  if (activeReportType === 'LocalTrace' && window._localTraceExport) {
    const x = window._localTraceExport;
    const empById = employeeIndexMap();
    let text = '*Garment trace: ' + x.q + '*\n';
    text +=
      '_Finished steps: ' +
      x.matches.length +
      ' â€” logged ' +
      fmtHMS(x.sumCompleted != null ? x.sumCompleted : x.sum) +
      (x.activeExtra ? ' + in progress ' + fmtHMS(x.activeExtra) : '') +
      ' = total ' +
      fmtHMS(x.sum) +
      '_\n\n';
    x.matches.forEach(function (l) {
      const resolvedEmp = resolveEmployeeDisplay(l.emp_id, empById);
      text +=
        '\u2022 ' +
        resolvedEmp.name +
        ' | ' +
        (l.process || '') +
        ' | ' +
        fmtHMS(logDurationSec(l)) +
        '\n';
    });
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    closeReport();
    return;
  }
  const period = lastReportPeriod || reportPeriodForType(activeReportType, STATE.logs || []);
  const logs = getLogsForType(activeReportType, period);
  const totalUnits = logs.length;
  const totalSec = logs.reduce(function (s, l) {
    return s + logDurationSec(l);
  }, 0);
  const avg = totalUnits > 0 ? fmtHMS(Math.round(totalSec / totalUnits)) : '0s';

  let text = '\uD83D\uDCCA *AbaYa Track \u2014 ' + activeReportType + ' Report*\n';
  text += '_Window: ' + reportWindowLabel(activeReportType, period) + (period.fallbackApplied ? ' (yesterday fallback)' : '') + '_\n';
  text += '_Generated: ' + new Date().toLocaleString() + '_\n\n';
  text += '\uD83D\uDC54 *Summary*\n';
  text += '\u2022 Total Completed: *' + totalUnits + ' units*\n';
  text += '\u2022 Avg Cycle Time: *' + avg + '*\n';
  text += '\u2022 Active Workers: *' + Object.keys(STATE.active || {}).length + '*\n\n';
  text += '\uD83D\uDCCB *Recent Sessions*\n';

  logs.slice(-10).reverse().forEach(l => {
    const emp = empById(l.emp_id);
    const ab = ABAYAS.find(a => a.id === l.abaya_id);
    const t = new Date(l.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const logProcess = l.process || (emp ? emp.process : '?');
    text += '\u25FD ' + t + ' | ' + (emp ? emp.name : '?') + ' | ' + (ab ? ab.code : '?') + ' | ' + logProcess + ' (' + fmtHMS(logDurationSec(l)) + ')';
    if (logProcess === 'Invoice maker' && l.invoice_serial) {
      const ser = String(l.invoice_serial).replace(/,/g, ', ');
      const short = ser.length > 80 ? ser.slice(0, 80) + '\u2026' : ser;
      text += '\n   Invoices (' + (l.invoice_count != null ? l.invoice_count : '?') + '): ' + short;
    } else if (logProcess === 'Checker' && l.quantity != null) {
      text += '\n   Quantity: ' + l.quantity;
      if (l.checker_barcode != null && String(l.checker_barcode).trim() !== '') {
        text += '\n   Barcode: ' + String(l.checker_barcode).trim().replace(/,/g, ', ');
      }
    }
    text += '\n';
  });

  text += '\n\u2705 _Sent from AbaYa Track CEO Dashboard_';

  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  closeReport();
}

// â”€â”€â”€ CLOCK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateClock() {
  const el = document.getElementById('dash-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) +
    ' \u2014 ' + new Date().toLocaleTimeString();
}

// â”€â”€â”€ UTILS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmtHMS(sec) {
  if (window.AbayaUiCommon && typeof window.AbayaUiCommon.fmtHMS === 'function') {
    return window.AbayaUiCommon.fmtHMS(sec);
  }
  return '0s';
}

function showToast(msg, type) {
  if (window.AbayaUiCommon && typeof window.AbayaUiCommon.showToast === 'function') {
    window.AbayaUiCommon.showToast(msg, type);
  }
}

function toggleDashboardGuide(forceOpen) {
  const panel = document.getElementById('dash-guide-panel');
  const btn = document.getElementById('guide-toggle');
  if (!panel || !btn) return;
  const next = forceOpen == null ? !panel.classList.contains('open') : !!forceOpen;
  panel.classList.toggle('open', next);
  panel.setAttribute('aria-hidden', next ? 'false' : 'true');
  btn.setAttribute('aria-expanded', next ? 'true' : 'false');
  btn.textContent = next ? 'Hide simple guide' : 'Show simple guide';
  try {
    localStorage.setItem('dash-guide-open', next ? '1' : '0');
  } catch (e) {}
}

function initDashboardGuideToggle() {
  let open = false;
  try {
    open = localStorage.getItem('dash-guide-open') === '1';
  } catch (e) {}
  toggleDashboardGuide(open);
}

// â”€â”€â”€ FLOOR DATA EXPORT (CSV / JSON) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function applyFloorExportPreset() {
  const sel = document.getElementById('floor-export-preset');
  const fromEl = document.getElementById('floor-export-from');
  const toEl = document.getElementById('floor-export-to');
  if (!sel || !fromEl || !toEl) return;
  const custom = sel.value === 'custom';
  fromEl.disabled = !custom;
  toEl.disabled = !custom;
  if (!custom) {
    fromEl.value = '';
    toEl.value = '';
  }
}

function floorExportQueryParams(includeSummary) {
  const presetEl = document.getElementById('floor-export-preset');
  const preset = presetEl ? presetEl.value : 'all';
  const p = new URLSearchParams();
  const now = new Date();
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    p.set('from', String(start.getTime()));
    p.set('to', String(end.getTime()));
  } else if (preset === 'year') {
    const y = now.getFullYear();
    const start = new Date(y, 0, 1, 0, 0, 0, 0);
    const end = new Date(y, 11, 31, 23, 59, 59, 999);
    p.set('from', String(start.getTime()));
    p.set('to', String(end.getTime()));
  } else if (preset === 'custom') {
    const f = document.getElementById('floor-export-from');
    const t = document.getElementById('floor-export-to');
    const fv = f && f.value ? f.value : '';
    const tv = t && t.value ? t.value : '';
    if (fv) p.set('from', String(new Date(fv + 'T00:00:00').getTime()));
    if (tv) p.set('to', String(new Date(tv + 'T23:59:59.999').getTime()));
  }
  const sumEl = document.getElementById('floor-export-summary');
  if (includeSummary && sumEl && sumEl.checked) {
    p.set('summary', '1');
  }
  return p;
}

function downloadFloorExport(fmt) {
  const includeSummary = fmt === 'json';
  const secret = window.prompt(
    'X-Export-Secret (from .env: FLOOR_EXPORT_SECRET or CATALOG_INGEST_SECRET):'
  );
  if (secret == null || String(secret).trim() === '') {
    showToast('Export cancelled', 'info');
    return;
  }
  const params = floorExportQueryParams(includeSummary);
  const url = '/api/export/floor-sessions.' + fmt + (params.toString() ? '?' + params.toString() : '');
  fetch(url, { headers: { 'X-Export-Secret': String(secret).trim() }, cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error(t ? t.slice(0, 200) : 'HTTP ' + r.status);
        });
      }
      return r.blob();
    })
    .then(function (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fmt === 'csv' ? 'floor-sessions.csv' : 'floor-sessions.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      showToast('Download started', 'success');
    })
    .catch(function (e) {
      showToast('Export failed: ' + (e.message || e), 'error');
    });
}

// â”€â”€â”€ BOOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.addEventListener('load', () => {
  updateClock();
  initDashboardGuideToggle();
  initDashboardHoverImagePreview();
  applyFloorExportPreset();
  loadEmployeesFromServer();
  loadWorkTypesFromServer();
  refreshDashboardAbayaCatalog();
  pollClientConfig();
  setInterval(pollClientConfig, 30000);
  // First-paint extended history so the report panel has year-long
  // context before the first state_update lands (or right away if the
  // socket never connects).
  fetchStateExtendedHistory();
  /** Clock ticks every second; heavy live DOM refreshes throttle to reduce INP / main-thread work */
  setInterval(updateClock, 1000);
  setInterval(renderLiveSessions, 2500);

  // â”€â”€ Custom-range + Every-Employee-Every-Task wiring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const repCustomApply = document.getElementById('rep-custom-apply');
  const repCustomFrom = document.getElementById('rep-custom-from');
  const repCustomTo = document.getElementById('rep-custom-to');
  const repEveryone = document.getElementById('rep-everyone');
  if (repCustomFrom && repCustomTo) {
    // Default the pickers to the current month so a user clicking the
    // button without picking gets a sensible range.
    const todayYmd = (function () {
      const d = new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    })();
    const monthStartYmd = (function () {
      const d = new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01';
    })();
    if (!repCustomFrom.value) repCustomFrom.value = monthStartYmd;
    if (!repCustomTo.value) repCustomTo.value = todayYmd;
  }
  if (repCustomApply) {
    repCustomApply.onclick = function () {
      customReportRange = {
        fromYmd: repCustomFrom ? repCustomFrom.value : '',
        toYmd: repCustomTo ? repCustomTo.value : '',
      };
      openReport('Custom');
    };
  }
  if (repEveryone) {
    repEveryone.onclick = function () {
      openEveryEmployeeEveryTask();
    };
  }
});

/**
 * Every-Employee-Every-Task view: opens a modal with the full log list
 * for the picked range, grouped by employee. Each row shows start time,
 * abaya code, process, duration, and any task-specific fields
 * (invoice serial, quantity, checker barcode).
 *
 * Driven by the same date pickers as Custom Range. Defaults to the
 * current month.
 */
function openEveryEmployeeEveryTask() {
  const repCustomFrom = document.getElementById('rep-custom-from');
  const repCustomTo = document.getElementById('rep-custom-to');
  const fromYmd = (repCustomFrom && repCustomFrom.value) || (function () {
    const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01';
  })();
  const toYmd = (repCustomTo && repCustomTo.value) || (function () {
    const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  })();
  customReportRange = { fromYmd: fromYmd, toYmd: toYmd };
  const period = reportPeriodForType('Custom', STATE.logs || []);
  const logs = (STATE.logs || []).filter(function (l) {
    const end = Number(l && l.end);
    return Number.isFinite(end) && end >= period.startMs && end < period.endMs;
  });
  const empById = employeeIndexMap();
  const abById = abayaIndexMap();
  // Group by employee, then by ymd.
  const byEmp = new Map();
  for (const l of logs) {
    const empId = String(l.emp_id || '?');
    if (!byEmp.has(empId)) byEmp.set(empId, []);
    byEmp.get(empId).push(l);
  }
  // Sort each employee's logs newest first, and sort employees by total
  // units desc (most active first).
  const empRows = Array.from(byEmp.entries()).map(function (entry) {
    const id = entry[0];
    const items = entry[1].slice().sort(function (a, b) { return Number(b.end) - Number(a.end); });
    const totalSec = items.reduce(function (s, l) { return s + (Number(l.duration_sec) || 0); }, 0);
    return { id: id, items: items, totalSec: totalSec };
  }).sort(function (a, b) { return b.items.length - a.items.length; });

  const modal = document.getElementById('modal-report');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const tsMeta = document.getElementById('modal-ts');
  if (!modal || !title || !body) return;

  title.textContent = 'Every Employee Every Task â€” ' + period.startYmd + ' to ' + period.endYmd;
  if (tsMeta) tsMeta.textContent = 'Range picked: ' + fromYmd + ' \u2192 ' + toYmd + ' \u2022 ' + empRows.length + ' employee(s) \u2022 ' + logs.length + ' task(s)';

  // Build a single scrollable container; one section per employee.
  const sections = [];
  if (!empRows.length) {
    sections.push('<div style="padding:20px;color:var(--tx3);text-align:center">No tasks in this range. Pick a wider range or check that the factory has been logging.</div>');
  }
  for (const row of empRows) {
    const emp = empById[row.id] || { name: '(unknown)', code: row.id, initials: '?' };
    const rows = row.items.map(function (l) {
      const ab = abById[l.abaya_id] || {};
      const abayaLabel = ab.code || l.abaya_id || 'â€”';
      const start = l.start ? new Date(l.start) : null;
      const end = l.end ? new Date(l.end) : null;
      const timeLabel = start ? pad2(start.getHours()) + ':' + pad2(start.getMinutes()) + 'â€“' + (end ? pad2(end.getHours()) + ':' + pad2(end.getMinutes()) : '?') : '?';
      const ymd = start ? start.getFullYear() + '-' + pad2(start.getMonth() + 1) + '-' + pad2(start.getDate()) : '';
      const mins = Math.max(1, Math.round((Number(l.duration_sec) || 0) / 60));
      let extra = '';
      if (l.invoice_count) extra += ' &middot; <span style="color:var(--am)">' + escape(String(l.invoice_count)) + ' invoices</span>';
      if (l.invoice_serial) extra += ' <span style="color:var(--tx3);font-family:monospace;font-size:10px">' + escape(String(l.invoice_serial)) + '</span>';
      if (l.quantity) extra += ' &middot; <span style="color:var(--am)">qty ' + escape(String(l.quantity)) + '</span>';
      if (l.checker_barcode) extra += ' <span style="color:var(--tx3);font-family:monospace;font-size:10px">' + escape(String(l.checker_barcode)) + '</span>';
      return '<tr>' +
        '<td style="padding:6px 8px;color:var(--tx3);font-family:monospace;font-size:11px;white-space:nowrap">' + escape(ymd) + '</td>' +
        '<td style="padding:6px 8px;color:var(--tx3);font-family:monospace;font-size:11px;white-space:nowrap">' + escape(timeLabel) + '</td>' +
        '<td style="padding:6px 8px;color:var(--label);font-family:monospace">' + escape(abayaLabel) + '</td>' +
        '<td style="padding:6px 8px">' + escape(l.process || 'â€”') + extra + '</td>' +
        '<td style="padding:6px 8px;text-align:right;color:var(--gr);font-family:monospace">' + mins + 'm</td>' +
        '</tr>';
    }).join('');
    sections.push(
      '<div style="margin-bottom:18px;border:1px solid var(--bd);border-radius:12px;overflow:hidden">' +
        '<div style="padding:8px 12px;background:var(--s2);display:flex;align-items:center;gap:10px">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:var(--s3);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">' + escape(emp.initials || (emp.name || '?').slice(0, 2).toUpperCase()) + '</div>' +
          '<div style="flex:1"><div style="font-weight:700">' + escape(emp.name || '(unknown)') + '</div>' +
            '<div style="font-size:11px;color:var(--tx3)">' + escape(emp.code || row.id) + ' \u2022 ' + row.items.length + ' task(s) \u2022 ' + Math.round(row.totalSec / 60) + ' min</div>' +
          '</div>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr style="background:var(--s1);color:var(--label);font-size:10px;text-transform:uppercase;letter-spacing:.06em">' +
            '<th style="padding:6px 8px;text-align:left">Date</th><th style="padding:6px 8px;text-align:left">Time</th>' +
            '<th style="padding:6px 8px;text-align:left">Abaya</th><th style="padding:6px 8px;text-align:left">Process</th>' +
            '<th style="padding:6px 8px;text-align:right">Min</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>'
    );
  }
  body.innerHTML = sections.join('');
  // Cap the body height so long lists don't push the close button off-screen.
  body.style.maxHeight = '60vh';
  body.style.overflowY = 'auto';
  modal.classList.add('open');
}


