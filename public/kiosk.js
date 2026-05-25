'use strict';

// ─── TABLET / FACTORY IDENTITY (URL params ?factory=&tablet=) ────────────────
(function applyTabletIdentity() {
  try {
    const params = new URLSearchParams(window.location.search);
    const factory = params.get('factory') || '';
    const tablet = params.get('tablet') || '';
    if (factory || tablet) {
      const badge = document.getElementById('tb-tablet-badge');
      const sub = document.getElementById('tb-sub-label');
      if (badge) {
        badge.textContent = [factory, tablet].filter(Boolean).join(' \u2022 ');
        badge.style.display = 'inline-block';
      }
      if (sub && factory) {
        sub.textContent = factory;
      }
    }
  } catch (_) {}
})();

const SOCKET_IO_OPTS = {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  timeout: 20000,
};

const socket = io(SOCKET_IO_OPTS);

/** Synced with server /api/work-types and client-config workTypesVersion */
let lastWorkTypesVersionSeen = null;

/** Last active session emp ids from server — keep demo grid in sync when EMPLOYEES reloads. */
let lastActiveEmployeeIds = [];
let activeSessionsByEmployee = {};
let ABAYA_BY_ID = Object.create(null);
let ABAYA_BY_EXACT_BC = Object.create(null);

function syncKioskConnUi(online, label) {
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  if (dot) {
    if (online) dot.classList.add('online');
    else dot.classList.remove('online');
  }
  if (lbl && label != null) lbl.textContent = label;
}

function formatExactStartedAt(epochMs) {
  const ts = Number(epochMs);
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  return new Date(ts).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

let kioskNavStep = 'fp';
let selEmp = null;
let selAbaya = null;
let selRole = null;
let activeSessionProcess = null;
let idleTimer = null;

/** Remaining abaya codes after pasting a column from Excel (FIFO). Survives Start work via sessionStorage. */
let bcExcelQueue = [];
var BC_EXCEL_Q_KEY = 'abaya_kiosk_bc_excel_queue_v1';

function loadBcQueueFromStorage() {
  try {
    var j = sessionStorage.getItem(BC_EXCEL_Q_KEY);
    var parsed = j ? JSON.parse(j) : [];
    bcExcelQueue = Array.isArray(parsed) ? parsed.map(normalizeBcToken).filter(Boolean) : [];
  } catch (e) {
    bcExcelQueue = [];
  }
}

function persistBcQueue() {
  try {
    if (bcExcelQueue.length) sessionStorage.setItem(BC_EXCEL_Q_KEY, JSON.stringify(bcExcelQueue));
    else sessionStorage.removeItem(BC_EXCEL_Q_KEY);
  } catch (e) {}
}

function clearBcExcelQueue(silent) {
  bcExcelQueue = [];
  persistBcQueue();
  updateBcQueueHint();
  if (!silent) showToast('Excel code list cleared', 'info');
}

function refreshKioskSnapshotFromServer() {
  AbayaClientCommon.fetchJsonNoStore('/api/state')
    .then((d) => {
      if (d && d.ok && d.state) applyKioskStatePayload(d.state);
    })
    .catch(() => {});
  AbayaClientCommon.fetchJsonNoStore('/api/work-types')
    .then((d) => {
      if (d && d.ok && Array.isArray(d.workTypes) && d.workTypes.length) {
        applyKioskWorkTypesList(d.workTypes);
        if (d.version != null) lastWorkTypesVersionSeen = String(d.version);
      }
    })
    .catch(() => {});
}

// ─── SOCKET CONNECTION STATUS ─────────────────────────────────────────────────
socket.on('connect', () => {
  syncKioskConnUi(true, 'Live');
  showToast('Connected to AbaYa Server', 'success');
  refreshKioskSnapshotFromServer();
});
socket.on('disconnect', () => {
  syncKioskConnUi(false, 'Offline');
  showToast('Lost server connection — retrying...', 'error');
});
socket.on('connect_error', () => {
  syncKioskConnUi(false, 'Offline');
});

AbayaClientCommon.installReconnectNudge(socket);

socket.on('catalog_update', () => {
  refreshKioskAbayaCatalog();
});

socket.on('employees_update', () => {
  loadEmployeesFromServer();
});

socket.on('sync_versions', () => {
  pollClientConfig();
});

function applyKioskWorkTypesList(types) {
  if (!Array.isArray(types) || types.length === 0) return;
  const next = types
    .map(function (t) {
      return String(t == null ? '' : t).trim();
    })
    .filter(Boolean);
  if (!next.length) return;
  WORK_TYPES = next;
  renderRoleGrid();
  if (selEmp && selRole && WORK_TYPES.indexOf(selRole) < 0) {
    const fallback = WORK_TYPES.indexOf(selEmp.process) >= 0 ? selEmp.process : WORK_TYPES[0];
    setRole(fallback);
    showToast('Work types were updated — confirm the role for this session.', 'info');
  }
}

function renderRoleGrid() {
  const grid = document.getElementById('role-grid');
  if (!grid || !Array.isArray(WORK_TYPES) || WORK_TYPES.length === 0) return;
  grid.textContent = '';
  WORK_TYPES.forEach(function (wt, i) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'role-btn';
    btn.id = 'role-wt-' + i;
    btn.textContent = wt;
    (function (index) {
      btn.addEventListener('click', function () {
        setRoleAt(index);
      });
    })(i);
    grid.appendChild(btn);
  });
}

socket.on('work_types_update', (payload) => {
  if (payload && Array.isArray(payload.workTypes) && payload.workTypes.length) {
    applyKioskWorkTypesList(payload.workTypes);
    if (payload.version != null) lastWorkTypesVersionSeen = String(payload.version);
  }
});

/** Apply server state bundle (same shape as Socket state_update payload or GET /api/state .state). */
function applyKioskStatePayload(state) {
  if (!state || typeof state !== 'object') return;
  if (state.workTypes && Array.isArray(state.workTypes) && state.workTypes.length) {
    applyKioskWorkTypesList(state.workTypes);
  }
  if (state.workTypesVersion != null) {
    lastWorkTypesVersionSeen = String(state.workTypesVersion);
  }
  activeSessionsByEmployee = state.active || {};
  lastActiveEmployeeIds = Object.keys(activeSessionsByEmployee);
  renderDemoGrid(lastActiveEmployeeIds);
  updateFpActiveSessionsBanner();
  if (kioskNavStep === 'ab') renderAbayaGrid();
}

function updateFpActiveSessionsBanner() {
  const el = document.getElementById('fp-active-sessions-banner');
  if (!el) return;
  const n = Array.isArray(lastActiveEmployeeIds) ? lastActiveEmployeeIds.length : 0;
  if (n === 0) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent =
    n === 1
      ? '1 open session on this station — that worker can scan or tap their card to finish.'
      : n + ' open sessions — those workers can scan or tap their cards to finish.';
}

function loadEmployeesFromServer() {
  AbayaClientCommon.fetchJsonNoStore('/api/employees')
    .then((d) => {
      if (!d.ok || !Array.isArray(d.employees)) return;
      EMPLOYEES = d.employees;
      renderDemoGrid(lastActiveEmployeeIds);
      updateFpActiveSessionsBanner();
    })
    .catch(() => {});
}

let lastCatalogVersionSeen = null;
let lastEmployeesVersionSeen = null;

function applyClientConfig(cfg) {
  if (!cfg || !cfg.ok) return;
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
    refreshKioskAbayaCatalog();
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
      applyKioskWorkTypesList(cfg.workTypes);
    }
  }
  lastWorkTypesVersionSeen = wv;
}

function pollClientConfig() {
  AbayaClientCommon.fetchJsonNoStore('/api/client-config')
    .then(applyClientConfig)
    .catch(() => {});
}

function normalizeKioskAbayaRow(a) {
  return {
    id: String(a.id),
    code: String(a.code),
    barcode: String(a.barcode),
    design: String(a.design != null ? a.design : ''),
    process: String(a.process != null ? a.process : ''),
    tier: a.tier != null ? String(a.tier) : '',
    icon: a.icon != null && String(a.icon) !== '' ? String(a.icon) : '&#128142;',
    status: a.status || 'waiting',
  };
}

function rebuildAbayaIndexes() {
  ABAYA_BY_ID = Object.create(null);
  ABAYA_BY_EXACT_BC = Object.create(null);
  const list = Array.isArray(ABAYAS) ? ABAYAS : [];
  list.forEach(function (a) {
    if (!a || !a.id) return;
    ABAYA_BY_ID[a.id] = a;
    const n = normalizeSearchKey(a.barcode);
    const c = compactSearchKey(a.barcode);
    if (n) {
      if (!ABAYA_BY_EXACT_BC[n]) ABAYA_BY_EXACT_BC[n] = [];
      ABAYA_BY_EXACT_BC[n].push(a);
    }
    if (c && c !== n) {
      if (!ABAYA_BY_EXACT_BC[c]) ABAYA_BY_EXACT_BC[c] = [];
      ABAYA_BY_EXACT_BC[c].push(a);
    }
  });
}

function tierBadgeHtml(tier) {
  if (!tier) return '';
  var slug = tier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return '<span class="ab-tier ab-tier-' + slug + '">' + tier + '</span>';
}

/** Catalog icon: image path under uploads/ → img; else emoji / HTML fragment. */
function abayaIconHtml(icon) {
  if (icon == null) return '';
  const s = String(icon).trim();
  if (!s) return '';
  if (/^uploads\//i.test(s) && /\.(jpe?g|png|gif|webp)$/i.test(s)) {
    const safe = s.replace(/^\/+/, '').replace(/"/g, '');
    return '<img src="/' + safe + '" data-fullsrc="/' + safe + '" alt="" class="ab-card-thumb hover-preview-thumb">';
  }
  return '<span style="margin-right:4px">' + s + '</span>';
}

function setAbayaHoverPreviewImage(src) {
  const wrap = document.getElementById('abaya-hover-preview');
  const img = document.getElementById('abaya-hover-preview-img');
  if (!wrap || !img || !src) return;
  img.src = src;
  wrap.classList.add('show');
}

function hideAbayaHoverPreviewImage() {
  const wrap = document.getElementById('abaya-hover-preview');
  if (!wrap) return;
  wrap.classList.remove('show');
}

function initAbayaHoverPreview() {
  if (document.body && document.body._abayaHoverBound) return;
  if (!document.body) return;
  document.body._abayaHoverBound = true;
  document.body.addEventListener('mouseover', (ev) => {
    const thumb = ev.target && ev.target.closest ? ev.target.closest('.hover-preview-thumb') : null;
    if (!thumb) return;
    setAbayaHoverPreviewImage(thumb.getAttribute('data-fullsrc') || thumb.getAttribute('src'));
  });
  document.body.addEventListener('mouseout', (ev) => {
    const thumb = ev.target && ev.target.closest ? ev.target.closest('.hover-preview-thumb') : null;
    if (!thumb) return;
    const next = ev.relatedTarget;
    if (next && thumb.contains && thumb.contains(next)) return;
    hideAbayaHoverPreviewImage();
  });
}

function refreshKioskAbayaCatalog() {
  AbayaClientCommon.fetchJsonNoStore('/api/catalog/abayas')
    .then((d) => {
      if (!d.ok || !Array.isArray(d.abayas)) return;
      ABAYAS = d.abayas.map(normalizeKioskAbayaRow);
      rebuildAbayaIndexes();
      rebuildBcPrefixSelect();
      if (kioskNavStep === 'ab') renderAbayaGrid();
    })
    .catch(() => {});
}

// ─── REAL-TIME GRID UPDATE (when server broadcasts state) ─────────────────────
socket.on('state_update', (data) => {
  applyKioskStatePayload(data);
});

// ─── FINGERPRINT SIMULATION ───────────────────────────────────────────────────
function simulateScan() {
  const sc = document.getElementById('fp-scanner');
  if (sc.classList.contains('scanning')) return;
  sc.classList.add('scanning');
  document.getElementById('fp-status').textContent = 'Scanning fingerprint...';
  setTimeout(() => simulateScanFor(EMPLOYEES[0].id), 1000);
}

function simulateScanFor(id) {
  const emp = EMPLOYEES.find((e) => String(e.id) === String(id));
  if (!emp) return;

  const sc = document.getElementById('fp-scanner');
  sc.classList.remove('success', 'error');
  sc.classList.add('scanning');
  document.getElementById('fp-status').textContent = 'Scanning...';

  socket.emit('req_lookup', emp.ac_no, (res) => {
    if (!res.ok) {
      sc.classList.remove('scanning');
      sc.classList.add('error');
      document.getElementById('fp-icon').innerHTML = '&#10060;';
      document.getElementById('fp-status').textContent = 'Employee not found';
      setTimeout(resetFP, 2000);
      return;
    }

    selEmp = res.employee;
    sc.classList.remove('scanning');
    sc.classList.add('success');
    document.getElementById('fp-icon').innerHTML = '&#10004;&#65039;';
    document.getElementById('fp-status').textContent = 'Match: ' + selEmp.name;
    resetIdleTimer();

    if (res.is_active) {
      // Employee already working — send them directly to finish screen
      setTimeout(() => {
        document.getElementById('wk-emp').textContent = selEmp.name;
        document.getElementById('wk-empno').textContent = selEmp.code;
        document.getElementById('wk-ab').textContent = res.abaya_code || '\u2014';
        // Show the role they chose when they started, if the server returned it
        activeSessionProcess = String(res.session_process || '').trim();
        document.getElementById('wk-proc').textContent = activeSessionProcess || '—';
        document.getElementById('wk-started').textContent = formatExactStartedAt(res.session_started_at);
        document.getElementById('stepbar').style.display = 'none';
        goTo('wk');
        showToast('\uD83D\uDD34 Tap FINISH WORK to complete your session', 'info');
      }, 600);
      return;
    }

    // New session — initialise role to employee's default, then show selector
    selRole = selEmp.process;
    if (selEmp.photo) {
      document.getElementById('id-photo').innerHTML = '<img src="/' + selEmp.photo + '" data-fullsrc="/' + selEmp.photo + '" alt="" class="hover-preview-thumb">';
    } else {
      document.getElementById('id-photo').style.background = selEmp.color;
      document.getElementById('id-photo').innerHTML = '<span id="id-initials">' + selEmp.initials + '</span>';
    }
    document.getElementById('id-photo').innerHTML += '<div class="id-verified">&#10003;</div>';
    
    document.getElementById('id-name').textContent = selEmp.name;
    document.getElementById('id-empno').textContent = selEmp.code;
    document.getElementById('id-ac').textContent = 'AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('bc-num').textContent = formatEmployeeBadgeDisplay(selEmp.barcode);
    // Highlight the default role button
    setRole(selRole);
    setTimeout(() => { goTo('id'); resetIdleTimer(); }, 600);
  });
}

// ─── IDENTITY ─────────────────────────────────────────────────────────────────
function setRoleAt(index) {
  const btn = document.getElementById('role-wt-' + index);
  const roleFromButton = btn && btn.textContent ? String(btn.textContent).trim() : '';
  const role = roleFromButton || (WORK_TYPES && WORK_TYPES[index] ? WORK_TYPES[index] : '');
  if (!role) return;
  setRole(role);
}

function setRole(role) {
  selRole = role;
  WORK_TYPES.forEach((wt, i) => {
    const btn = document.getElementById('role-wt-' + i);
    if (!btn) return;
    btn.className = 'role-btn' + (role === wt ? ' active' : '');
  });
}

function confirmIdentity() {
  const bin = document.getElementById('bc-input');
  if (bin) bin.value = '';
  goTo('ab');
  renderAbayaGrid();
  updateBcQueueHint();
  resetIdleTimer();
}

function resetFP() {
  selEmp = null;
  selAbaya = null;
  selRole = null;
  activeSessionProcess = null;
  WORK_TYPES.forEach((_, i) => {
    const btn = document.getElementById('role-wt-' + i);
    if (btn) btn.className = 'role-btn';
  });
  const sc = document.getElementById('fp-scanner');
  sc.classList.remove('scanning', 'success', 'error');
  document.getElementById('fp-status').textContent = 'Waiting for fingerprint...';
  document.getElementById('fp-icon').innerHTML = '&#9757;&#65039;';
  const startedEl = document.getElementById('wk-started');
  if (startedEl) startedEl.textContent = '—';
}

function splitBcTokens(raw) {
  return String(raw || '')
    .replace(/\uFEFF/g, '')
    .split(/[\r\n\u2028\u2029\t,;]+/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function normalizeBcToken(s) {
  return String(s || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .toUpperCase();
}

/** Badge line on ID screen: always show FWAS + numeric part (data may be digits-only or already prefixed). */
function formatEmployeeBadgeDisplay(barcode) {
  const s = String(barcode != null ? barcode : '').trim();
  if (!s) return '\u2014';
  const u = s.toUpperCase().replace(/\s+/g, '');
  if (u.indexOf('FWAS') === 0) {
    const rest = u.slice(4).replace(/\D/g, '');
    return rest ? 'FWAS ' + rest : 'FWAS';
  }
  const digits = s.replace(/\D/g, '');
  return digits ? 'FWAS ' + digits : s;
}

/** Persisted prefix for digits-only manual entry (dropdown). */
const BC_PREFIX_STORAGE_KEY = 'abaya_kiosk_bc_prefix_v1';
const DEFAULT_BC_PREFIX_CHOICES = ['FWAS', 'FWAP', 'AB'];

function orderBcPrefixList(set) {
  const PRI = ['FWAS', 'FWAP', 'AB'];
  const arr = Array.from(set);
  const first = PRI.filter((p) => arr.includes(p));
  const rest = arr.filter((p) => !PRI.includes(p)).sort((a, b) => a.localeCompare(b));
  return first.concat(rest);
}

function collectPrefixesFromAbayas(abayas) {
  const found = new Set();
  DEFAULT_BC_PREFIX_CHOICES.forEach((p) => found.add(p));
  function consider(str) {
    const t = String(str || '').trim();
    if (!t) return;
    let m = t.match(/^([A-Za-z]{2,14})(?=\s)/);
    if (m) {
      found.add(m[1].toUpperCase());
      return;
    }
    m = t.match(/^([A-Za-z]{2,14})(?=\d)/);
    if (m) found.add(m[1].toUpperCase());
  }
  if (abayas && abayas.length) {
    abayas.forEach((a) => {
      consider(a.barcode);
      consider(a.design);
      consider(a.code);
    });
  }
  return orderBcPrefixList(found);
}

function rebuildBcPrefixSelect() {
  const sel = document.getElementById('bc-prefix-select');
  if (!sel) return;
  const prefixes = collectPrefixesFromAbayas(ABAYAS);
  let prev = '';
  try {
    prev = localStorage.getItem(BC_PREFIX_STORAGE_KEY) || '';
  } catch (_) {}
  sel.innerHTML = prefixes.map((p) => '<option value="' + p + '">' + p + '</option>').join('');
  const pick = prev && prefixes.includes(prev) ? prev : prefixes[0];
  if (pick) sel.value = pick;
}

function onBcPrefixChange() {
  try {
    const s = document.getElementById('bc-prefix-select');
    if (s && s.value) localStorage.setItem(BC_PREFIX_STORAGE_KEY, s.value);
  } catch (_) {}
  const el = document.getElementById('bc-input');
  if (el && el.value) filterAbayaGrid(buildBcSearchQuery(el.value));
}

/** Manual entry optimized for quick item-no search. */
function buildBcSearchQuery(token) {
  const s = String(token || '').trim();
  if (!s) return '';
  if (/^[0-9\s]+$/.test(s)) {
    const d = s.replace(/\D/g, '');
    return d;
  }
  return normalizeBcToken(s);
}

function normalizeSearchKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchKey(s) {
  return normalizeSearchKey(s).replace(/[^A-Z0-9]/g, '');
}

/** Barcode appears on more than one process (same garment, different station). */
function computeMultiBarcodeKeys(abayas) {
  const byKey = {};
  (abayas || []).forEach(function (a) {
    const k = compactSearchKey(a.barcode);
    if (!k) return;
    if (!byKey[k]) byKey[k] = new Set();
    byKey[k].add(String(a.process || ''));
  });
  const out = new Set();
  Object.keys(byKey).forEach(function (k) {
    if (byKey[k].size > 1) out.add(k);
  });
  return out;
}

function getExactBarcodeCandidates(qNorm, qCompact) {
  const merged = []
    .concat((ABAYA_BY_EXACT_BC[qNorm] || []))
    .concat((ABAYA_BY_EXACT_BC[qCompact] || []));
  const seen = new Set();
  return merged.filter(function (a) {
    if (!a || seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

function abayaMatchesSearchInRole(a, q, qCompact) {
  const bc = normalizeSearchKey(a.barcode);
  const cod = normalizeSearchKey(a.code);
  const des = normalizeSearchKey(a.design);
  const bcC = compactSearchKey(a.barcode);
  const codC = compactSearchKey(a.code);
  const desC = compactSearchKey(a.design);
  return (
    bc === q || cod === q || bcC === qCompact || codC === qCompact ||
    cod.startsWith(q) || cod.includes(q) ||
    bc.startsWith(q) || bc.includes(q) ||
    des.includes(q) ||
    codC.startsWith(qCompact) || codC.includes(qCompact) ||
    bcC.startsWith(qCompact) || bcC.includes(qCompact) ||
    desC.includes(qCompact)
  );
}

function scoreAbayaSearchMatch(a, q, qCompact) {
  const bc = normalizeSearchKey(a.barcode);
  const cod = normalizeSearchKey(a.code);
  const des = normalizeSearchKey(a.design);
  const bcC = compactSearchKey(a.barcode);
  const codC = compactSearchKey(a.code);
  const desC = compactSearchKey(a.design);
  if (bc === q || bcC === qCompact) return 1000;
  if (cod === q || codC === qCompact) return 900;
  if (bc.startsWith(q) || bcC.startsWith(qCompact)) return 800;
  if (cod.startsWith(q) || codC.startsWith(qCompact)) return 700;
  if (bc.includes(q) || bcC.includes(qCompact)) return 600;
  if (cod.includes(q) || codC.includes(qCompact)) return 500;
  if (des.includes(q) || desC.includes(qCompact)) return 300;
  return 0;
}

function getRankedAbayaMatches(list, q, qCompact) {
  return list
    .map(function (a) {
      return { a: a, score: scoreAbayaSearchMatch(a, q, qCompact) };
    })
    .sort(function (x, y) {
      if (y.score !== x.score) return y.score - x.score;
      return String(x.a.barcode || '').localeCompare(String(y.a.barcode || ''));
    })
    .map(function (x) { return x.a; });
}

function updateBcQueueHint() {
  const wrap = document.getElementById('bc-queue-wrap');
  if (!wrap) return;
  const n = bcExcelQueue.length;
  persistBcQueue();
  if (n === 0) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }
  wrap.style.display = 'block';
  wrap.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    '<span style="color:var(--tx2);font-size:12px;line-height:1.4">' +
    n +
    ' code' +
    (n === 1 ? '' : 's') +
    ' from Excel in queue (kept after each Start work).</span>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
    '<button type="button" class="bbk" style="min-height:44px" onclick="applyNextFromBcQueue()">Use next code</button>' +
    '<button type="button" class="bbk" style="min-height:44px;opacity:.85" onclick="clearBcExcelQueue()">Clear list</button>' +
    '</div></div>';
}

function applyNextFromBcQueue() {
  if (!bcExcelQueue.length) return;
  const el = document.getElementById('bc-input');
  el.value = bcExcelQueue.shift();
  updateBcQueueHint();
  tryManualBarcode();
}

// ─── ABAYA SCAN ───────────────────────────────────────────────────────────────
function onBcInput() {
  const el = document.getElementById('bc-input');
  const tokens = splitBcTokens(el.value);
  if (tokens.length > 1) {
    el.value = normalizeBcToken(tokens[0]);
    bcExcelQueue = tokens.slice(1).map(normalizeBcToken);
    updateBcQueueHint();
    showToast(tokens.length - 1 + ' more code(s) queued from list', 'info');
  }
  filterAbayaGrid(buildBcSearchQuery(el.value));
  resetIdleTimer();
}

function onBcPaste() {
  setTimeout(function () {
    const el = document.getElementById('bc-input');
    const tokens = splitBcTokens(el.value);
    if (tokens.length > 1) {
      el.value = normalizeBcToken(tokens[0]);
      bcExcelQueue = tokens.slice(1).map(normalizeBcToken);
      updateBcQueueHint();
      showToast('Pasted ' + tokens.length + ' codes — using first', 'info');
    }
    filterAbayaGrid(buildBcSearchQuery(el.value));
  }, 0);
}

function tryManualBarcode() {
  const el = document.getElementById('bc-input');
  let raw = el.value.trim();
  if (!raw && bcExcelQueue.length) {
    raw = bcExcelQueue.shift();
    el.value = raw;
    updateBcQueueHint();
  }
  if (!raw) return;

  const parts = splitBcTokens(raw);
  let first = normalizeBcToken(parts[0] || raw);
  if (parts.length > 1) {
    bcExcelQueue = parts.slice(1).map(normalizeBcToken);
    el.value = first;
    updateBcQueueHint();
  }

  const val = buildBcSearchQuery(first);
  if (!val) return;
  const qNorm = normalizeSearchKey(val);
  const qCompact = compactSearchKey(val);

  // Exact barcode match auto-selects; exact code only auto-selects when unique in selected role.
  const roleFilter = selRole || (selEmp ? selEmp.process : '');
  const exactBarcode = getExactBarcodeCandidates(qNorm, qCompact).find(function (x) {
    return x.process === roleFilter;
  });
  if (exactBarcode) { selectAbaya(exactBarcode.id); return; }
  if (trySelectExactBarcodeAcrossProcesses(qNorm, qCompact, val)) return;
  const exactCodeMatches = ABAYAS.filter(function (x) {
    if (x.process !== roleFilter) return false;
    var code = String(x.code || '');
    return normalizeSearchKey(code) === qNorm || compactSearchKey(code) === qCompact;
  });
  if (exactCodeMatches.length === 1) { selectAbaya(exactCodeMatches[0].id); return; }

  // Partial match — full grid + highlights; tell employee to tap the right variant when several match
  const partial = ABAYAS.filter(function (x) {
    return abayaMatchesSearchInRole(x, qNorm, qCompact);
  });
  filterAbayaGrid(val);
  if (partial.length > 1) {
    showToast(partial.length + ' items match "' + val + '" — tap the one you need', 'info');
  } else if (partial.length === 0) {
    showToast('Item "' + val + '" not found', 'error');
  }
}

function renderAbayaGrid(highlightQuery, sourceList) {
  if (!selEmp) return;
  const grid = document.getElementById('ab-grid');
  const emptyEl = document.getElementById('ab-empty');
  const allAbayas = Array.isArray(sourceList) ? sourceList.slice() : ABAYAS.slice();
  if (allAbayas.length === 0) {
    grid.style.display = 'none';
    if (emptyEl) {
      emptyEl.textContent = highlightQuery ? 'No items match this search.' : 'No abaya items available. Check catalog source.';
      emptyEl.style.display = 'block';
    }
    return;
  }
  const hq = highlightQuery != null ? String(highlightQuery).trim() : '';
  const q = normalizeSearchKey(hq);
  const qCompact = compactSearchKey(hq);
  const wantHit = !!q;
  const multiKeys = computeMultiBarcodeKeys(ABAYAS);
  const activeHintByBc = buildActiveProcessHintMap();
  grid.style.display = 'grid';
  if (emptyEl) emptyEl.style.display = 'none';
  grid.innerHTML = allAbayas.map(function (a) {
    const bcK = compactSearchKey(a.barcode);
    const classes = ['ab-card'];
    const activeHint = activeHintByBc[compactSearchKey(a.barcode)] || '';
    if (multiKeys.has(bcK)) classes.push('ab-card-multi');
    if (wantHit && abayaMatchesSearchInRole(a, q, qCompact)) classes.push('ab-card-hit');
    return (
      '<div class="' + classes.join(' ') + '" onclick="selectAbaya(\'' + a.id + '\')">' +
      '<div class="ab-card-bc-lbl">Item No.</div>' +
      '<div class="ab-card-bc">' + a.barcode + '</div>' +
      (activeHint ? '<div class="ab-card-active">' + activeHint + '</div>' : '') +
      '<div class="ab-card-des">' +
        abayaIconHtml(a.icon) +
        a.design +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
        '<div class="ab-card-code">' + a.code + '</div>' +
        '<div class="ab-card-proc">' + (a.process || '—') + '</div>' +
        tierBadgeHtml(a.tier) +
      '</div>' +
    '</div>'
    );
  }).join('');
}

function buildActiveProcessHintMap() {
  const byBc = Object.create(null);
  Object.keys(activeSessionsByEmployee || {}).forEach(function (empId) {
    const sess = activeSessionsByEmployee[empId];
    if (!sess) return;
    const ab = ABAYA_BY_ID[String(sess.abaya_id)];
    if (!ab) return;
    const bcKey = compactSearchKey(ab.barcode);
    if (!bcKey) return;
    const proc = String(sess.process || ab.process || '').trim();
    if (!proc) return;
    if (!byBc[bcKey]) byBc[bcKey] = [];
    byBc[bcKey].push(proc);
  });
  const out = Object.create(null);
  Object.keys(byBc).forEach(function (k) {
    out[k] = 'Active in: ' + [...new Set(byBc[k])].join(', ');
  });
  return out;
}

function trySelectExactBarcodeAcrossProcesses(qNorm, qCompact, rawQuery) {
  if (!qNorm && !qCompact) return false;
  const roleFilter = selRole || (selEmp ? selEmp.process : '');
  const candidates = getExactBarcodeCandidates(qNorm, qCompact);
  if (!candidates.length) return false;
  const inRole = candidates.find(function (x) { return x.process === roleFilter; });
  if (inRole) {
    selectAbaya(inRole.id);
    return true;
  }
  if (candidates.length > 1) {
    renderAbayaGrid(rawQuery || qNorm, candidates);
    showToast(candidates.length + ' process variants found for this barcode — tap your item', 'info');
    return true;
  }
  const target = candidates[0];
  if (!target) return false;
  selectAbaya(target.id);
  return true;
}

// ─── LIVE ITEM SEARCH ────────────────────────────────────────────────────────
// Called on every keystroke in bc-input. Filters the ab-grid by:
//  1. Exact barcode / code match          → auto-selects immediately
//  2. Barcode starts-with / contains      → shows matched cards
//  3. Item Name (design) contains query   → shows matched cards
//  Empty query restores the full role grid.
function filterAbayaGrid(query) {
  if (!selEmp) return;
  const q = normalizeSearchKey(query || '');
  const qCompact = compactSearchKey(query || '');
  if (!q) { renderAbayaGrid(); return; }

  const pool = ABAYAS.slice();

  const matches = pool.filter(function (a) {
    return abayaMatchesSearchInRole(a, q, qCompact);
  });

  // Exact barcode match auto-selects; exact code only if unique among matches.
  const exactBarcode = getExactBarcodeCandidates(q, qCompact).find(function (a) {
    return matches.some(function (m) { return m.id === a.id; });
  });
  if (exactBarcode) { selectAbaya(exactBarcode.id); return; }
  if (trySelectExactBarcodeAcrossProcesses(q, qCompact, query)) return;
  const exactCodeMatches = matches.filter(function (a) {
    const cod = normalizeSearchKey(a.code);
    const codCompact = compactSearchKey(a.code);
    return cod === q || codCompact === qCompact;
  });
  if (exactCodeMatches.length === 1) { selectAbaya(exactCodeMatches[0].id); return; }

  const ranked = getRankedAbayaMatches(matches, q, qCompact);
  renderAbayaGrid(query, ranked);
}
// ─────────────────────────────────────────────────────────────────────────────

function selectAbaya(id) {
  const ab = ABAYA_BY_ID[id] || ABAYAS.find(a => a.id === id);
  if (!ab || !selEmp) return;
  selAbaya = ab;

  // Visual feedback on scanner
  const sc = document.getElementById('bc-scanner');
  sc.classList.add('success');
  document.getElementById('bc-status').textContent = ab.code + ' — Scanned ✓';

  // Highlight selected card
  document.querySelectorAll('.ab-card').forEach(c => c.classList.remove('sel'));
  const cards = document.querySelectorAll('.ab-card');
  cards.forEach(c => { if (c.onclick.toString().includes(id)) c.classList.add('sel'); });

  setTimeout(() => {
    const bin = document.getElementById('bc-input');
    if (bin) bin.value = '';
    // Populate ready screen
    if (selEmp.photo) {
      document.getElementById('rdy-av').innerHTML = '<img src="/' + selEmp.photo + '" data-fullsrc="/' + selEmp.photo + '" alt="" class="hover-preview-thumb">';
    } else {
      document.getElementById('rdy-av').textContent = selEmp.initials;
      document.getElementById('rdy-av').style.background = selEmp.color;
    }
    document.getElementById('rdy-name').textContent = selEmp.name;
    document.getElementById('rdy-meta').textContent = selEmp.code + ' \u00b7 AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('rdy-proc').textContent = selRole || selEmp.process;
    document.getElementById('rdy-ac').textContent = String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('rdy-ab-icon').innerHTML = abayaIconHtml(ab.icon);
    document.getElementById('rdy-ab-code').textContent = ab.code;
    document.getElementById('rdy-ab-des').textContent = ab.design;
    document.getElementById('rdy-bc').textContent = ab.barcode;
    goTo('rdy');
    resetIdleTimer();
  }, 500);
}

// ─── WORK FLOW ────────────────────────────────────────────────────────────────
function startWork() {
  if (!selEmp || !selAbaya) { showToast('Missing employee or abaya data', 'error'); return; }
  const selectedProcess = String(selRole || (selEmp ? selEmp.process : '') || '').trim();
  const itemProcess = String(selAbaya.process || '').trim();
  if (
    selectedProcess &&
    itemProcess &&
    selectedProcess !== itemProcess &&
    selectedProcess !== 'Checker'
  ) {
    const ok = window.confirm(
      'You selected "' +
      selectedProcess +
      '" but this item is tagged "' +
      itemProcess +
      '".\n\nCross-process work is allowed. Start anyway?'
    );
    if (!ok) {
      showToast('Start cancelled. Choose another item or change process.', 'info');
      return;
    }
  }
  const btn = document.getElementById('btn-start-work');
  setStartButtonBusy(true);

  socket.emit('req_startWork', { emp_id: selEmp.id, abaya_id: selAbaya.id, process: selRole }, (res) => {
    setStartButtonBusy(false);
    if (!res.ok) {
      if (res.error_code === 'ABAYA_ALREADY_ACTIVE') {
        const owner = res.active_emp_name || res.active_emp_code || 'another employee';
        const proc = res.active_process ? ' (' + res.active_process + ')' : '';
        showToast('This item is already in progress by ' + owner + proc, 'error');
      } else {
        showToast(res.error, 'error');
      }
      return;
    }

    showToast('Session started for ' + selEmp.name, 'success');

    // Immediately reset kiosk for next worker
    selEmp = null;
    selAbaya = null;
    document.getElementById('bc-input').value = '';
    document.getElementById('bc-status').textContent = 'Ready to scan...';
    document.getElementById('bc-scanner').classList.remove('success');
    resetFP();
    document.getElementById('stepbar').style.display = 'flex';
    goTo('fp');
    resetIdleTimer();
  });
}

function getActiveWorkProcess() {
  const el = document.getElementById('wk-proc');
  const fromDom = el && el.textContent && el.textContent !== '\u2014' ? el.textContent.trim() : '';
  return fromDom || activeSessionProcess || '';
}

function announceInv(msg) {
  const el = document.getElementById('inv-announce');
  if (!el) return;
  el.textContent = '';
  if (!msg) return;
  requestAnimationFrame(() => { el.textContent = msg; });
}

function announceChecker(msg) {
  const el = document.getElementById('chk-announce');
  if (!el) return;
  el.textContent = '';
  if (!msg) return;
  requestAnimationFrame(() => { el.textContent = msg; });
}

var MAX_INVOICE_NUMBERS = 500;
var MAX_INVOICE_DIGITS_PER = 20;
var MAX_INVOICE_RAW_CHARS = 12000;
var TOKEN_RE = /^\d{1,20}$/;

function parseInvoiceNumberList(raw) {
  const str = String(raw ?? '');
  if (str.length > MAX_INVOICE_RAW_CHARS) {
    return { ok: false, error: 'List is too long. Use at most ' + MAX_INVOICE_RAW_CHARS + ' characters or split across sessions.', nums: null };
  }
  const parts = str
    .trim()
    .split(/[\r\n,;\s\u00a0]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nums = [];
  const seen = new Set();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!TOKEN_RE.test(p)) {
      const show = p.length > 24 ? p.slice(0, 24) + '\u2026' : p;
      return {
        ok: false,
        error:
          'Invalid value "' +
          show +
          '": each invoice number must be digits only, 1\u2013' +
          MAX_INVOICE_DIGITS_PER +
          ' digits (no letters, dots, or scientific notation).',
        nums: null,
      };
    }
    if (seen.has(p)) {
      return { ok: false, error: 'Duplicate invoice number: ' + p + '. Remove the duplicate.', nums: null };
    }
    seen.add(p);
    nums.push(p);
  }
  if (nums.length < 1) {
    return { ok: false, error: 'Enter at least one invoice number.', nums: null };
  }
  if (nums.length > MAX_INVOICE_NUMBERS) {
    return { ok: false, error: 'Too many invoice numbers (max ' + MAX_INVOICE_NUMBERS + ' per session).', nums: null };
  }
  return { ok: true, error: '', nums };
}

var invInputTimer = null;
var chkInputTimer = null;
var chkBcInputTimer = null;

function onCheckerBarcodeTabToQty(ev) {
  if (!ev || ev.key !== 'Tab' || ev.shiftKey) return;
  ev.preventDefault();
  const q = document.getElementById('chk-qty');
  if (q) q.focus();
}

function onCheckerQtyShiftTabToBc(ev) {
  if (!ev || ev.key !== 'Tab' || !ev.shiftKey) return;
  ev.preventDefault();
  const bc = document.getElementById('chk-bc');
  if (bc) bc.focus();
}

function onCheckerBarcodeInput(el) {
  const hint = document.getElementById('chk-bc-hint');
  if (!hint) return;
  clearTimeout(chkBcInputTimer);
  chkBcInputTimer = setTimeout(function () {
    if (!el.value.trim()) {
      hint.textContent = '';
      return;
    }
    const parsed = parseCheckerBarcodeList(el.value);
    if (!parsed.ok) {
      hint.textContent = parsed.error;
      return;
    }
    const n = parsed.barcode.split(',').length;
    hint.textContent =
      'Ready: ' + n + ' barcode' + (n === 1 ? '' : 's') + ' \u2014 Tab moves to Quantity.';
  }, 200);
}

function onInvoiceSerialInput(el) {
  el.value = el.value.replace(/[^\d\s,;\n\r\u00a0]/g, '');
  const hint = document.getElementById('inv-parse-hint');
  if (!hint) return;
  clearTimeout(invInputTimer);
  invInputTimer = setTimeout(function () {
    if (!el.value.trim()) {
      hint.textContent = '';
      return;
    }
    const parsed = parseInvoiceNumberList(el.value);
    if (!parsed.ok) {
      hint.textContent = parsed.error;
    } else {
      const n = parsed.nums.length;
      hint.textContent =
        'Ready: ' + n + ' invoice number' + (n === 1 ? '' : 's') + ' \u2014 count will be ' + n + ' (matches list).';
    }
  }, 200);
}

var MAX_CHECKER_BC_RAW_CHARS = 500000;
var MAX_CHECKER_BC_TOKENS = 100000;
var MAX_CHECKER_BC_TOKEN_CHARS = 500;

function parseCheckerBarcodeList(raw) {
  const str = String(raw != null ? raw : '');
  if (str.length > MAX_CHECKER_BC_RAW_CHARS) {
    return {
      ok: false,
      error:
        'List is too long. Use at most ' +
        MAX_CHECKER_BC_RAW_CHARS +
        ' characters or split across sessions.',
      barcode: null,
    };
  }
  const lines = str.replace(/\uFEFF/g, '').split(/\r?\n/);
  const parts = [];
  for (let li = 0; li < lines.length; li++) {
    const segs = lines[li].split(',');
    for (let si = 0; si < segs.length; si++) {
      const t = segs[si].trim();
      if (t) parts.push(t);
    }
  }
  if (parts.length < 1) {
    return { ok: false, error: 'Enter at least one barcode (separate with commas).', barcode: null };
  }
  if (parts.length > MAX_CHECKER_BC_TOKENS) {
    return {
      ok: false,
      error: 'Too many barcodes (max ' + MAX_CHECKER_BC_TOKENS + ' per session).',
      barcode: null,
    };
  }
  for (let ti = 0; ti < parts.length; ti++) {
    if (parts[ti].length > MAX_CHECKER_BC_TOKEN_CHARS) {
      const show = parts[ti].length > 40 ? parts[ti].slice(0, 40) + '\u2026' : parts[ti];
      return {
        ok: false,
        error:
          'Barcode too long: "' +
          show +
          '" (max ' +
          MAX_CHECKER_BC_TOKEN_CHARS +
          ' characters per value).',
        barcode: null,
      };
    }
  }
  return { ok: true, error: '', barcode: parts.join(',') };
}

function parseCheckerQuantity(raw) {
  const str = String(raw != null ? raw : '').trim();
  if (!str) return { ok: false, error: 'Enter quantity.', quantity: null };
  if (!/^\d+$/.test(str)) return { ok: false, error: 'Quantity must be digits only.', quantity: null };
  const qty = parseInt(str, 10);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'Quantity must be at least 1.', quantity: null };
  return { ok: true, error: '', quantity: qty };
}

function onCheckerQuantityInput(el) {
  el.value = el.value.replace(/[^\d]/g, '');
  const hint = document.getElementById('chk-hint');
  if (!hint) return;
  clearTimeout(chkInputTimer);
  chkInputTimer = setTimeout(function () {
    if (!el.value.trim()) {
      hint.textContent = '';
      return;
    }
    const parsed = parseCheckerQuantity(el.value);
    hint.textContent = parsed.ok ? 'Ready: quantity ' + parsed.quantity : parsed.error;
  }, 150);
}

function finishWork() {
  if (!selEmp) {
    showToast('No active employee', 'error');
    return;
  }
  openFinishConfirmModal();
}

function openFinishConfirmModal() {
  const overlay = document.getElementById('finish-confirm-overlay');
  const nameEl = document.getElementById('finish-confirm-name');
  if (!overlay || !selEmp) return;
  if (nameEl) nameEl.textContent = selEmp.name;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  function onEsc(ev) {
    if (ev.key === 'Escape') onFinishConfirmCancel();
  }
  overlay._finishEsc = onEsc;
  document.addEventListener('keydown', onEsc);
  setTimeout(function () {
    const ok = document.getElementById('finish-confirm-ok');
    if (ok) ok.focus();
  }, 0);
}

function closeFinishConfirmModal() {
  const overlay = document.getElementById('finish-confirm-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  if (overlay._finishEsc) {
    document.removeEventListener('keydown', overlay._finishEsc);
    overlay._finishEsc = null;
  }
}

function onFinishConfirmOk() {
  closeFinishConfirmModal();
  proceedFinishWorkAfterConfirm();
}

function onFinishConfirmCancel() {
  closeFinishConfirmModal();
  showToast('Finish cancelled. Returning to active session.', 'info');
  goTo('wk');
  resetIdleTimer();
}

function proceedFinishWorkAfterConfirm() {
  const proc = getActiveWorkProcess();
  if (proc === 'Invoice maker') {
    const ta = document.getElementById('inv-serial');
    if (ta) ta.value = '';
    const ph = document.getElementById('inv-parse-hint');
    if (ph) ph.textContent = '';
    announceInv('');
    goTo('inv');
    resetIdleTimer();
    if (ta) ta.focus();
    return;
  }
  if (proc === 'Checker') {
    const bc = document.getElementById('chk-bc');
    const q = document.getElementById('chk-qty');
    const h = document.getElementById('chk-hint');
    if (bc) bc.value = '';
    if (q) q.value = '';
    if (h) h.textContent = '';
    const bh = document.getElementById('chk-bc-hint');
    if (bh) bh.textContent = '';
    announceChecker('');
    goTo('chk');
    resetIdleTimer();
    if (bc) bc.focus();
    return;
  }
  emitFinishWork({});
}

function submitInvoiceFinish(ev) {
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  if (!selEmp) {
    announceInv('No active employee. Use Back or wait for the kiosk to reset.');
    showToast('No active employee', 'error');
    return false;
  }
  const raw = document.getElementById('inv-serial').value;
  announceInv('');
  const parsed = parseInvoiceNumberList(raw);
  if (!parsed.ok) {
    announceInv(parsed.error);
    showToast(parsed.error, 'error');
    document.getElementById('inv-serial').focus();
    return false;
  }
  const normalized = parsed.nums.join(',');
  emitFinishWork({ invoice_count: parsed.nums.length, invoice_serial: normalized });
  return false;
}

function submitCheckerFinish(ev) {
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  if (!selEmp) {
    announceChecker('No active employee. Use Back or wait for the kiosk to reset.');
    showToast('No active employee', 'error');
    return false;
  }
  const rawBc = document.getElementById('chk-bc') ? document.getElementById('chk-bc').value : '';
  const raw = document.getElementById('chk-qty').value;
  announceChecker('');
  const parsedBc = parseCheckerBarcodeList(rawBc);
  if (!parsedBc.ok) {
    announceChecker(parsedBc.error);
    showToast(parsedBc.error, 'error');
    const bcEl = document.getElementById('chk-bc');
    if (bcEl) bcEl.focus();
    return false;
  }
  const parsed = parseCheckerQuantity(raw);
  if (!parsed.ok) {
    announceChecker(parsed.error);
    showToast(parsed.error, 'error');
    document.getElementById('chk-qty').focus();
    return false;
  }
  emitFinishWork({ quantity: parsed.quantity, checker_barcode: parsedBc.barcode });
  return false;
}

function emitFinishWork(extra) {
  setFinishButtonsBusy(true);

  const payload = Object.assign({ emp_id: selEmp.id }, extra || {});
  socket.emit('req_finishWork', payload, (res) => {
    setFinishButtonsBusy(false);
    if (!res.ok) {
      const invScr = document.getElementById('scr-inv');
      const chkScr = document.getElementById('scr-chk');
      if (invScr && invScr.classList.contains('on')) {
        announceInv((res.error && String(res.error)) || 'Could not finish session. Check the form and try again.');
      }
      if (chkScr && chkScr.classList.contains('on')) {
        announceChecker((res.error && String(res.error)) || 'Could not finish session. Check the form and try again.');
      }
      showToast(res.error, 'error');
      return;
    }

    const finishProcess = String(res.session_process || (selEmp ? selEmp.process : '') || '').trim();
    document.getElementById('cf-emp').textContent = selEmp.name;
    document.getElementById('cf-ac').textContent = 'AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('cf-ab').textContent = res.abaya_code || '—';
    document.getElementById('cf-proc').textContent = finishProcess || '—';
    document.getElementById('cf-dur').textContent = fmtHMS(res.duration_seconds);
    renderFinishConfirmationExtras(finishProcess, res);

    document.getElementById('stepbar').style.display = 'none';
    goTo('conf');
    showToast(buildFinishSuccessMessage(finishProcess, res), 'success');

    setTimeout(() => {
      selEmp = null;
      selAbaya = null;
      document.getElementById('bc-input').value = '';
      document.getElementById('bc-status').textContent = 'Ready to scan...';
      document.getElementById('bc-scanner').classList.remove('success');
      resetFP();
      document.getElementById('stepbar').style.display = 'flex';
      goTo('fp');
      resetIdleTimer();
    }, 3000);
  });
}

function renderFinishConfirmationExtras(processName, res) {
  const durRow = document.getElementById('cf-dur-row');
  const invWrap = document.getElementById('cf-inv-wrap');
  const chkWrap = document.getElementById('cf-chk-wrap');
  const isInvoice = processName === 'Invoice maker';
  const isChecker = processName === 'Checker';

  if (invWrap) {
    if (isInvoice) {
      invWrap.style.display = 'block';
      document.getElementById('cf-inv-n').textContent =
        res.invoice_count != null ? String(res.invoice_count) : '—';
      document.getElementById('cf-inv-ser').textContent = res.invoice_serial || '—';
    } else {
      invWrap.style.display = 'none';
    }
  }

  if (chkWrap) {
    if (isChecker) {
      chkWrap.style.display = 'block';
      document.getElementById('cf-chk-qty').textContent =
        res.quantity != null ? String(res.quantity) : '—';
      document.getElementById('cf-chk-bc').textContent = formatCheckerBarcodeForDisplay(
        res.checker_barcode || res.abaya_barcode || ''
      );
    } else {
      chkWrap.style.display = 'none';
    }
  }

  if (durRow) {
    durRow.style.display = isChecker ? 'none' : 'flex';
  }
}

function formatCheckerBarcodeForDisplay(s) {
  const t = String(s != null ? s : '').trim();
  if (!t) return '\u2014';
  return t.replace(/,/g, ', ');
}

function buildFinishSuccessMessage(processName, res) {
  if (processName === 'Checker') {
    const rawBc = res.checker_barcode || res.abaya_barcode || '';
    const bc = rawBc ? formatCheckerBarcodeForDisplay(rawBc) : '\u2014';
    const bcToast = bc.length > 100 ? bc.slice(0, 100) + '\u2026' : bc;
    return (
      'Work logged! Barcode: ' +
      bcToast +
      ' · Quantity: ' +
      (res.quantity != null ? res.quantity : '\u2014')
    );
  }
  return 'Work logged! Duration: ' + fmtHMS(res.duration_seconds);
}

function setStartButtonBusy(busy) {
  const btn = document.getElementById('btn-start-work');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? 'Starting...' : '\uD83D\uDFE2 START WORK';
}

function setFinishButtonsBusy(busy) {
  const btn = document.getElementById('btn-finish-work');
  const btnInv = document.getElementById('btn-inv-submit');
  const btnChk = document.getElementById('btn-chk-submit');
  if (btn) {
    btn.disabled = !!busy;
    btn.textContent = busy ? 'Finishing...' : '\uD83D\uDD34 FINISH WORK';
  }
  if (btnInv) btnInv.disabled = !!busy;
  if (btnChk) btnChk.disabled = !!busy;
}

// ─── NAV ──────────────────────────────────────────────────────────────────────
function goTo(s) {
  kioskNavStep = s;
  document.querySelectorAll('.scr').forEach(e => e.classList.remove('on'));
  const target = document.getElementById('scr-' + s);
  if (target) target.classList.add('on');
  if (s === 'ab') {
    updateBcQueueHint();
    setTimeout(function () {
      const bin = document.getElementById('bc-input');
      if (bin) bin.focus();
    }, 0);
  }

  const steps = ['fp', 'id', 'ab', 'rdy', 'wk'];
  const idx = steps.indexOf(s);
  document.querySelectorAll('.stp').forEach((el, i) => {
    el.style.background = 'transparent';
    el.style.color = 'var(--tx3)';
    el.style.fontWeight = '400';
    if (i < idx) { el.style.background = 'var(--grb)'; el.style.color = 'var(--gr)'; el.style.fontWeight = '600'; }
    if (i === idx) { el.style.background = 'var(--blb)'; el.style.color = 'var(--bl)'; el.style.fontWeight = '700'; }
  });
}

// ─── IDLE TIMER ───────────────────────────────────────────────────────────────
function resetIdleTimer() {
  clearTimeout(idleTimer);
  document.getElementById('idle-warn').style.display = 'none';
  idleTimer = setTimeout(() => {
    if (document.getElementById('scr-fp').classList.contains('on')) return;
    document.getElementById('idle-warn').style.display = 'block';
    resetFP();
    clearBcExcelQueue(true);
    goTo('fp');
    document.getElementById('stepbar').style.display = 'flex';
    showToast('Session timed out — please re-scan', 'error');
  }, 90000);
}

// ─── DEMO GRID ────────────────────────────────────────────────────────────────
function renderDemoGrid(activeIds) {
  activeIds = activeIds || [];
  const busySet = new Set(activeIds.map((x) => String(x)));
  const html = EMPLOYEES.map(e => {
    const busy = busySet.has(String(e.id));
    const avHtml = e.photo 
      ? '<img src="/' + e.photo + '" data-fullsrc="/' + e.photo + '" alt="" class="hover-preview-thumb">' 
      : e.initials;
    const statusLine = busy
      ? '<div class="demo-ac" style="color:var(--gr);font-weight:700">\u25CF Working</div>' +
        '<div style="font-size:8px;color:var(--gr);margin-top:1px;opacity:.85">Tap to Finish</div>'
      : '<div class="demo-ac">AC-' + e.ac_no + '</div>';
    return '<div class="demo-emp' + (busy ? ' busy' : '') + '" onclick="simulateScanFor(\'' + e.id + '\')" title="' + (busy ? 'Tap to finish session' : 'Tap to scan') + '">' +
      '<div class="demo-av" style="background:' + (e.photo ? 'transparent' : e.color) + '">' + avHtml + '</div>' +
      '<div class="demo-nm">' + e.name + '</div>' +
      statusLine +
    '</div>';
  }).join('');
  document.getElementById('demo-grid').innerHTML = html;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
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

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!socket || !socket.connected) return;
  refreshKioskSnapshotFromServer();
});

window.addEventListener('load', () => {
  loadBcQueueFromStorage();
  updateBcQueueHint();
  loadEmployeesFromServer();
  renderDemoGrid([]);
  updateFpActiveSessionsBanner();
  rebuildBcPrefixSelect();
  renderRoleGrid();
  goTo('fp');
  resetIdleTimer();
  refreshKioskAbayaCatalog();
  initAbayaHoverPreview();
  pollClientConfig();
  setInterval(pollClientConfig, 30000);
});
