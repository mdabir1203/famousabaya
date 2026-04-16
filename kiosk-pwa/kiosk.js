'use strict';

// ─── SERVER URL CONFIG (persisted in localStorage) ───────────────────────────
var SERVER_URL = localStorage.getItem('abaya_server_url') || '';

function getServerUrl() { return SERVER_URL.replace(/\/+$/, ''); }

function saveServerUrl(url) {
  SERVER_URL = url.replace(/\/+$/, '');
  localStorage.setItem('abaya_server_url', SERVER_URL);
}

/** Session key for pasted Excel barcode queue (must match clear-all wipe). */
var BC_EXCEL_Q_KEY = 'abaya_kiosk_bc_excel_queue_v1';

/**
 * URL auto-reset (no browser menus):
 *   ?reset=server | ?clear=server | ?reset=1 | ?clear=1  → clear saved factory URL only
 *   ?reset=all    | ?clear=all    | ?wipe=1             → clear URL + Excel queue (sessionStorage)
 */
(function applyUrlResetParams() {
  try {
    var params = new URLSearchParams(window.location.search);
    var reset = (params.get('reset') || '').toLowerCase();
    var clr = (params.get('clear') || '').toLowerCase();
    var wipe = (params.get('wipe') || '').toLowerCase();
    var serverOnly = reset === 'server' || clr === 'server' || reset === '1' || reset === 'true' || clr === '1' || clr === 'true';
    var all = reset === 'all' || clr === 'all' || wipe === '1' || wipe === 'all' || wipe === 'true';
    if (!serverOnly && !all) return;
    localStorage.removeItem('abaya_server_url');
    SERVER_URL = '';
    if (all) {
      try { sessionStorage.removeItem(BC_EXCEL_Q_KEY); } catch (_) {}
    }
    var u = new URL(window.location.href);
    u.searchParams.delete('reset');
    u.searchParams.delete('clear');
    u.searchParams.delete('wipe');
    var qs = u.searchParams.toString();
    history.replaceState({}, '', u.pathname + (qs ? '?' + qs : '') + u.hash);
    setTimeout(function () {
      try {
        showToast(all ? 'Local kiosk data cleared (URL)' : 'Saved factory address cleared (URL)', 'success');
      } catch (_) {}
    }, 150);
  } catch (_) {}
})();

/** Default https:// factory host from index.html meta (tunnel). */
function readDefaultSecureFactoryUrl() {
  try {
    var el = document.querySelector('meta[name="abaya-factory-api-base"]');
    var s = el && el.getAttribute('content') ? String(el.getAttribute('content')).trim() : '';
    return s.replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function mustUseHttpsFactoryOrigin(url) {
  return window.location.protocol === 'https:' && /^http:\/\//i.test(String(url || ''));
}

/** LAN / loopback — cannot be auto-upgraded to https:// from an HTTPS kiosk page (mixed content). */
function isPrivateOrLocalHostname(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('fe80:')) return true;
  if (h === '127.0.0.1') return true;
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  var a = parseInt(m[1], 10), b = parseInt(m[2], 10), c = parseInt(m[3], 10), d = parseInt(m[4], 10);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0 && b === 0 && c === 0 && d === 0) return true;
  return false;
}

/**
 * On HTTPS kiosk pages, Socket.IO must use wss:// (https origin). If the saved URL is
 * http:// for a public hostname (e.g. tunnel hostname), upgrade to https:// automatically.
 * Private IPs stay http — caller must block / show setup (mixed content unavoidable).
 */
function upgradeHttpToHttpsIfNeeded(url) {
  if (!url || window.location.protocol !== 'https:') return url;
  try {
    var p = new URL(url);
    if (p.protocol !== 'http:') return url.replace(/\/+$/, '');
    if (isPrivateOrLocalHostname(p.hostname)) return null;
    p.protocol = 'https:';
    return p.origin.replace(/\/+$/, '');
  } catch (_) {
    return url;
  }
}

/** Persist upgraded URL once so Socket.IO + fetch never see http:// on this origin. */
function applyHttpsUpgradeToStoredServerUrl() {
  if (window.location.protocol !== 'https:') return;
  var u = getServerUrl();
  if (!u) return;
  var up = upgradeHttpToHttpsIfNeeded(u);
  if (up == null) {
    localStorage.removeItem('abaya_server_url');
    SERVER_URL = '';
    try {
      showToast('http:// factory address cannot be used on this HTTPS kiosk page.', 'error');
    } catch (_) {}
    return;
  }
  if (up !== u) {
    saveServerUrl(up);
  }
}

/** If this page is HTTPS but saved URL is http:// to a private host, clear and show setup. */
function rejectStoredHttpOnSecurePage() {
  var u = getServerUrl();
  if (!u || !mustUseHttpsFactoryOrigin(u)) return false;
  try {
    var p = new URL(u);
    if (!isPrivateOrLocalHostname(p.hostname)) {
      applyHttpsUpgradeToStoredServerUrl();
      return false;
    }
  } catch (_) {}
  localStorage.removeItem('abaya_server_url');
  SERVER_URL = '';
  var def = readDefaultSecureFactoryUrl();
  var inp = document.getElementById('setup-url');
  if (inp) {
    inp.value = def || '';
  }
  showToast('http:// is blocked on this HTTPS kiosk. Use https:// (tunnel URL).', 'error');
  showSetup();
  return true;
}

// ─── DATA (loaded from server on connect) ────────────────────────────────────
var EMPLOYEES = [];
var ABAYAS = [];
var WORK_TYPES = [
  'Tailor (01)', 'Tailor (02)', 'Hand Work', 'Stone Work', 'Button',
  'Embroidery', 'Ari Work', 'Hand Designing', 'Invoice maker', 'Packaging', 'Checker',
];

// ─── TABLET / FACTORY IDENTITY (URL params ?factory=&tablet=) ────────────────
(function applyTabletIdentity() {
  try {
    var params = new URLSearchParams(window.location.search);
    var factory = params.get('factory') || '';
    var tablet = params.get('tablet') || '';
    if (factory || tablet) {
      var badge = document.getElementById('tb-tablet-badge');
      var sub = document.getElementById('tb-sub-label');
      if (badge) { badge.textContent = [factory, tablet].filter(Boolean).join(' \u2022 '); badge.style.display = 'inline-block'; }
      if (sub && factory) sub.textContent = factory;
    }
    var serverParam = params.get('server');
    if (serverParam) {
      var decoded = decodeURIComponent(String(serverParam).replace(/\+/g, ' ')).trim();
      if (mustUseHttpsFactoryOrigin(decoded)) {
        try {
          var pu = new URL(decoded);
          if (!isPrivateOrLocalHostname(pu.hostname)) {
            pu.protocol = 'https:';
            saveServerUrl(pu.origin.replace(/\/+$/, ''));
          }
        } catch (_) {}
      } else {
        saveServerUrl(decoded);
      }
    }
  } catch (_) {}
})();

/** One-time: fix tablets that still have http:// tunnel URL saved (causes ws:// mixed content). */
(function coerceStoredHttpTunnelUrl() {
  applyHttpsUpgradeToStoredServerUrl();
})();

// ─── SOCKET.IO CONNECTION ────────────────────────────────────────────────────
var socket = null;
var kioskNavStep = 'fp';
var selEmp = null;
var selAbaya = null;
var selRole = null;
var activeSessionProcess = null;
var idleTimer = null;

var bcExcelQueue = [];
var lastDemoActiveEmployeeIds = [];

function connectToServer() {
  applyHttpsUpgradeToStoredServerUrl();
  if (rejectStoredHttpOnSecurePage()) return;
  var url = getServerUrl();
  if (!url) { showSetup(); return; }
  if (window.location.protocol === 'https:') {
    var up = upgradeHttpToHttpsIfNeeded(url);
    if (up == null) {
      localStorage.removeItem('abaya_server_url');
      SERVER_URL = '';
      showToast('http:// LAN URL cannot be used on this HTTPS page. Use tunnel https:// or open kiosk over http://', 'error');
      showSetup();
      return;
    }
    if (up !== url) saveServerUrl(up);
    url = up;
  }

  hideSetup();

  if (socket) { socket.disconnect(); socket = null; }
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    timeout: 20000,
  });

  var dot = document.getElementById('conn-dot');
  var lbl = document.getElementById('conn-label');
  socket.on('connect', function () {
    dot.classList.add('online'); lbl.textContent = 'Live';
    showToast('Connected to factory server', 'success');
    loadEmployeesFromServer();
    refreshKioskAbayaCatalog();
    pollClientConfig();
    if (!window._abayaCfgPoll) {
      window._abayaCfgPoll = setInterval(pollClientConfig, 30000);
    }
  });
  socket.on('disconnect', function () {
    dot.classList.remove('online'); lbl.textContent = 'Offline';
    showToast('Lost server connection — retrying...', 'error');
  });
  socket.on('connect_error', function () {
    dot.classList.remove('online'); lbl.textContent = 'Error';
  });
  socket.on('catalog_update', function () { refreshKioskAbayaCatalog(); });
  socket.on('employees_update', function () { loadEmployeesFromServer(); });
  socket.on('sync_versions', function () { pollClientConfig(); });
  socket.on('state_update', function (data) {
    lastDemoActiveEmployeeIds = Object.keys(data.active || {});
    renderDemoGrid(lastDemoActiveEmployeeIds);
  });
}

function loadEmployeesFromServer() {
  var url = getServerUrl();
  fetch(url + '/api/employees', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok || !Array.isArray(d.employees)) return;
      EMPLOYEES = d.employees;
      renderDemoGrid(lastDemoActiveEmployeeIds);
    })
    .catch(function () {});
}

var lastCatalogVersionSeen = null;
var lastEmployeesVersionSeen = null;

function applyClientConfig(cfg) {
  if (!cfg || !cfg.ok) return;
  var sk = 'abaya_srv_boot';
  var prevBoot = null;
  try {
    prevBoot = sessionStorage.getItem(sk);
  } catch (_) {}
  var boot = String(cfg.serverStartedAt);
  if (prevBoot && prevBoot !== boot) {
    try {
      sessionStorage.setItem(sk, boot);
    } catch (_) {}
    window.location.reload();
    return;
  }
  try {
    sessionStorage.setItem(sk, boot);
  } catch (_) {}

  var cv = String(cfg.catalogVersion);
  if (lastCatalogVersionSeen !== null && cv !== lastCatalogVersionSeen) {
    refreshKioskAbayaCatalog();
  }
  lastCatalogVersionSeen = cv;

  var ev = String(cfg.employeesVersion);
  if (lastEmployeesVersionSeen !== null && ev !== lastEmployeesVersionSeen) {
    loadEmployeesFromServer();
  }
  lastEmployeesVersionSeen = ev;
}

function pollClientConfig() {
  var base = getServerUrl();
  if (!base) return;
  fetch(base + '/api/client-config', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(applyClientConfig)
    .catch(function () {});
}

// ─── SETUP SCREEN ────────────────────────────────────────────────────────────
function showSetup() {
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('kiosk-app').style.display = 'none';
}
function hideSetup() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('kiosk-app').style.display = 'flex';
}
function submitSetup() {
  var inp = document.getElementById('setup-url');
  var val = (inp.value || '').trim();
  if (!val) { showToast('Enter a server address', 'error'); return; }
  if (!/^https?:\/\//i.test(val)) {
    val = (window.location.protocol === 'https:' ? 'https://' : 'http://') + val;
  }
  if (mustUseHttpsFactoryOrigin(val)) {
    showToast('Use https:// tunnel URL (e.g. from meta abaya-factory-api-base).', 'error');
    return;
  }
  saveServerUrl(val);
  connectToServer();
}
function resetSetup() {
  clearSavedServerAddress(true);
}

/** Clear saved factory URL. Pass silent=true for gear menu (no toast). Prefills default https host from meta on HTTPS. */
function clearSavedServerAddress(silent) {
  localStorage.removeItem('abaya_server_url');
  SERVER_URL = '';
  if (socket) { socket.disconnect(); socket = null; }
  var inp = document.getElementById('setup-url');
  if (inp) inp.value = readDefaultSecureFactoryUrl() || '';
  if (!silent) showToast('Saved factory address cleared', 'success');
  showSetup();
}

/** Clear server URL + Excel barcode queue (session). */
function clearAllKioskData() {
  if (!confirm('Clear saved factory URL and Excel barcode queue on this tablet?')) return;
  localStorage.removeItem('abaya_server_url');
  try { sessionStorage.removeItem(BC_EXCEL_Q_KEY); } catch (_) {}
  SERVER_URL = '';
  bcExcelQueue = [];
  if (socket) { socket.disconnect(); socket = null; }
  var inp = document.getElementById('setup-url');
  if (inp) inp.value = readDefaultSecureFactoryUrl() || '';
  try { updateBcQueueHint(); } catch (_) {}
  showToast('All local kiosk data cleared', 'success');
  showSetup();
}

// ─── ABAYA CATALOG ───────────────────────────────────────────────────────────
function normalizeKioskAbayaRow(a) {
  return {
    id: String(a.id), code: String(a.code), barcode: String(a.barcode),
    design: String(a.design != null ? a.design : ''),
    process: String(a.process != null ? a.process : ''),
    tier: a.tier != null ? String(a.tier) : '',
    icon: a.icon != null && String(a.icon) !== '' ? String(a.icon) : '&#128142;',
    status: a.status || 'waiting',
  };
}

function tierBadgeHtml(tier) {
  if (!tier) return '';
  var slug = tier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return '<span class="ab-tier ab-tier-' + slug + '">' + tier + '</span>';
}

function abayaIconHtml(icon) {
  if (icon == null) return '';
  var s = String(icon).trim();
  if (!s) return '';
  if (/^uploads\//i.test(s) && /\.(jpe?g|png|gif|webp)$/i.test(s)) {
    var safe = s.replace(/^\/+/, '').replace(/"/g, '');
    return '<img src="' + getServerUrl() + '/' + safe + '" alt="" style="width:22px;height:22px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:4px">';
  }
  return '<span style="margin-right:4px">' + s + '</span>';
}

function refreshKioskAbayaCatalog() {
  var url = getServerUrl();
  if (!url) return;
  fetch(url + '/api/catalog/abayas', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok || !Array.isArray(d.abayas)) return;
      ABAYAS = d.abayas.map(normalizeKioskAbayaRow);
      if (kioskNavStep === 'ab') renderAbayaGrid();
    })
    .catch(function () {});
}

// ─── FINGERPRINT SIMULATION ───────────────────────────────────────────────────
function simulateScan() {
  var sc = document.getElementById('fp-scanner');
  if (sc.classList.contains('scanning')) return;
  sc.classList.add('scanning');
  document.getElementById('fp-status').textContent = 'Scanning fingerprint...';
  if (EMPLOYEES.length) setTimeout(function () { simulateScanFor(EMPLOYEES[0].id); }, 1000);
  else { sc.classList.remove('scanning'); showToast('No employees loaded — check server connection', 'error'); }
}

function simulateScanFor(id) {
  var emp = EMPLOYEES.find(function (e) { return e.id === id; });
  if (!emp || !socket) return;

  var sc = document.getElementById('fp-scanner');
  sc.classList.remove('success', 'error');
  sc.classList.add('scanning');
  document.getElementById('fp-status').textContent = 'Scanning...';

  socket.emit('req_lookup', emp.ac_no, function (res) {
    if (!res.ok) {
      sc.classList.remove('scanning'); sc.classList.add('error');
      document.getElementById('fp-icon').innerHTML = '&#10060;';
      document.getElementById('fp-status').textContent = 'Employee not found';
      setTimeout(resetFP, 2000);
      return;
    }
    selEmp = res.employee;
    sc.classList.remove('scanning'); sc.classList.add('success');
    document.getElementById('fp-icon').innerHTML = '&#10004;&#65039;';
    document.getElementById('fp-status').textContent = 'Match: ' + selEmp.name;
    resetIdleTimer();

    if (res.is_active) {
      setTimeout(function () {
        document.getElementById('wk-emp').textContent = selEmp.name;
        document.getElementById('wk-empno').textContent = selEmp.code;
        document.getElementById('wk-ab').textContent = res.abaya_code || '\u2014';
        activeSessionProcess = res.session_process || selEmp.process;
        document.getElementById('wk-proc').textContent = activeSessionProcess;
        document.getElementById('stepbar').style.display = 'none';
        goTo('wk');
        showToast('\uD83D\uDD34 Tap FINISH WORK to complete your session', 'info');
      }, 600);
      return;
    }

    selRole = selEmp.process;
    if (selEmp.photo) {
      document.getElementById('id-photo').innerHTML = '<img src="' + getServerUrl() + '/' + selEmp.photo + '" alt="">';
    } else {
      document.getElementById('id-photo').style.background = selEmp.color;
      document.getElementById('id-photo').innerHTML = '<span id="id-initials">' + selEmp.initials + '</span>';
    }
    document.getElementById('id-photo').innerHTML += '<div class="id-verified">&#10003;</div>';
    document.getElementById('id-name').textContent = selEmp.name;
    document.getElementById('id-empno').textContent = selEmp.code;
    document.getElementById('id-ac').textContent = 'AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('bc-num').textContent = selEmp.barcode;
    setRole(selRole);
    setTimeout(function () { goTo('id'); resetIdleTimer(); }, 600);
  });
}

// ─── IDENTITY ─────────────────────────────────────────────────────────────────
function setRoleAt(index) { if (WORK_TYPES[index]) setRole(WORK_TYPES[index]); }
function setRole(role) {
  selRole = role;
  WORK_TYPES.forEach(function (wt, i) {
    var btn = document.getElementById('role-wt-' + i);
    if (btn) btn.className = 'role-btn' + (role === wt ? ' active' : '');
  });
}
function confirmIdentity() {
  var bin = document.getElementById('bc-input');
  if (bin) bin.value = '';
  goTo('ab'); renderAbayaGrid(); updateBcQueueHint(); resetIdleTimer();
}
function resetFP() {
  selEmp = null; selAbaya = null; selRole = null; activeSessionProcess = null;
  WORK_TYPES.forEach(function (_, i) { var btn = document.getElementById('role-wt-' + i); if (btn) btn.className = 'role-btn'; });
  var sc = document.getElementById('fp-scanner');
  sc.classList.remove('scanning', 'success', 'error');
  document.getElementById('fp-status').textContent = 'Waiting for fingerprint...';
  document.getElementById('fp-icon').innerHTML = '&#9757;&#65039;';
}

// ─── BARCODE HELPERS ─────────────────────────────────────────────────────────
function loadBcQueueFromStorage() {
  try { var j = sessionStorage.getItem(BC_EXCEL_Q_KEY); var p = j ? JSON.parse(j) : []; bcExcelQueue = Array.isArray(p) ? p.map(normalizeBcToken).filter(Boolean) : []; } catch (e) { bcExcelQueue = []; }
}
function persistBcQueue() {
  try { if (bcExcelQueue.length) sessionStorage.setItem(BC_EXCEL_Q_KEY, JSON.stringify(bcExcelQueue)); else sessionStorage.removeItem(BC_EXCEL_Q_KEY); } catch (e) {}
}
function clearBcExcelQueue(silent) { bcExcelQueue = []; persistBcQueue(); updateBcQueueHint(); if (!silent) showToast('Excel code list cleared', 'info'); }
function splitBcTokens(raw) { return String(raw || '').replace(/\uFEFF/g, '').split(/[\r\n\u2028\u2029\t,;]+/).map(function (s) { return s.trim(); }).filter(Boolean); }
function normalizeBcToken(s) { return String(s || '').trim().replace(/^\uFEFF/, '').toUpperCase(); }
function normalizeSearchKey(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function compactSearchKey(s) { return normalizeSearchKey(s).replace(/[^A-Z0-9]/g, ''); }

function updateBcQueueHint() {
  var wrap = document.getElementById('bc-queue-wrap'); if (!wrap) return;
  var n = bcExcelQueue.length; persistBcQueue();
  if (n === 0) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = 'block';
  wrap.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px"><span style="color:var(--tx2);font-size:12px;line-height:1.4">' + n + ' code' + (n === 1 ? '' : 's') + ' from Excel in queue.</span><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><button type="button" class="bbk" style="min-height:44px" onclick="applyNextFromBcQueue()">Use next code</button><button type="button" class="bbk" style="min-height:44px;opacity:.85" onclick="clearBcExcelQueue()">Clear list</button></div></div>';
}
function applyNextFromBcQueue() { if (!bcExcelQueue.length) return; var el = document.getElementById('bc-input'); el.value = bcExcelQueue.shift(); updateBcQueueHint(); tryManualBarcode(); }

// ─── ABAYA SCAN ───────────────────────────────────────────────────────────────
function onBcInput(val) {
  var el = document.getElementById('bc-input');
  var tokens = splitBcTokens(val);
  if (tokens.length > 1) { el.value = normalizeBcToken(tokens[0]); bcExcelQueue = tokens.slice(1).map(normalizeBcToken); updateBcQueueHint(); showToast(tokens.length - 1 + ' more code(s) queued from list', 'info'); val = el.value; }
  filterAbayaGrid(normalizeBcToken(val)); resetIdleTimer();
}
function onBcPaste() {
  setTimeout(function () { var el = document.getElementById('bc-input'); var tokens = splitBcTokens(el.value); if (tokens.length > 1) { el.value = normalizeBcToken(tokens[0]); bcExcelQueue = tokens.slice(1).map(normalizeBcToken); updateBcQueueHint(); showToast('Pasted ' + tokens.length + ' codes — using first', 'info'); } filterAbayaGrid(normalizeBcToken(el.value)); }, 0);
}
function tryManualBarcode() {
  var el = document.getElementById('bc-input');
  var raw = el.value.trim();
  if (!raw && bcExcelQueue.length) { raw = bcExcelQueue.shift(); el.value = raw; updateBcQueueHint(); }
  if (!raw) return;
  var parts = splitBcTokens(raw);
  var first = normalizeBcToken(parts[0] || raw);
  if (parts.length > 1) { bcExcelQueue = parts.slice(1).map(normalizeBcToken); el.value = first; updateBcQueueHint(); }
  var val = first; if (!val) return;
  var qNorm = normalizeSearchKey(val); var qCompact = compactSearchKey(val);
  var roleFilter = selRole || (selEmp ? selEmp.process : '');
  var exactBarcode = ABAYAS.find(function (x) { if (x.process !== roleFilter) return false; var bc = String(x.barcode || ''); return normalizeSearchKey(bc) === qNorm || compactSearchKey(bc) === qCompact; });
  if (exactBarcode) { selectAbaya(exactBarcode.id); return; }
  var exactCodeMatches = ABAYAS.filter(function (x) { if (x.process !== roleFilter) return false; var code = String(x.code || ''); return normalizeSearchKey(code) === qNorm || compactSearchKey(code) === qCompact; });
  if (exactCodeMatches.length === 1) { selectAbaya(exactCodeMatches[0].id); return; }
  filterAbayaGrid(val);
  var partial = ABAYAS.filter(function (x) { var code = normalizeSearchKey(x.code); var bc = normalizeSearchKey(x.barcode); var des = normalizeSearchKey(x.design); return x.process === roleFilter && (code.includes(qNorm) || bc.includes(qNorm) || des.includes(qNorm) || compactSearchKey(x.code).includes(qCompact) || compactSearchKey(x.barcode).includes(qCompact) || compactSearchKey(x.design).includes(qCompact)); });
  if (partial.length > 1) showToast(partial.length + ' items match "' + val + '" — tap the one you need', 'info');
  else if (partial.length === 0) showToast('Item "' + val + '" not found', 'error');
}

function renderAbayaGrid() {
  if (!selEmp) return;
  var grid = document.getElementById('ab-grid');
  var roleFilter = selRole || selEmp.process;
  var procAbayas = ABAYAS.filter(function (a) { return a.process === roleFilter; });
  if (procAbayas.length === 0) { grid.style.display = 'none'; document.getElementById('ab-empty').style.display = 'block'; return; }
  grid.style.display = 'grid'; document.getElementById('ab-empty').style.display = 'none';
  grid.innerHTML = procAbayas.map(function (a) {
    return '<div class="ab-card" onclick="selectAbaya(\'' + a.id + '\')">' +
      '<div class="ab-card-bc-lbl">Item No.</div><div class="ab-card-bc">' + a.barcode + '</div>' +
      '<div class="ab-card-des">' + abayaIconHtml(a.icon) + a.design + '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px"><div class="ab-card-code">' + a.code + '</div>' + tierBadgeHtml(a.tier) + '</div></div>';
  }).join('');
}

function filterAbayaGrid(query) {
  if (!selEmp) return;
  var q = normalizeSearchKey(query || ''); var qCompact = compactSearchKey(query || '');
  if (!q) { renderAbayaGrid(); return; }
  var roleFilter = selRole || selEmp.process;
  var pool = ABAYAS.filter(function (a) { return a.process === roleFilter; });
  var matches = pool.filter(function (a) {
    var bc = normalizeSearchKey(a.barcode); var cod = normalizeSearchKey(a.code); var des = normalizeSearchKey(a.design);
    var bcC = compactSearchKey(a.barcode); var codC = compactSearchKey(a.code); var desC = compactSearchKey(a.design);
    return bc === q || cod === q || bcC === qCompact || codC === qCompact || cod.includes(q) || bc.includes(q) || des.includes(q) || codC.includes(qCompact) || bcC.includes(qCompact) || desC.includes(qCompact);
  });
  var grid = document.getElementById('ab-grid'); var emptyEl = document.getElementById('ab-empty');
  if (matches.length === 0) { grid.style.display = 'none'; grid.innerHTML = ''; if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.innerHTML = '&#128269; No items match <strong>' + q + '</strong>'; } return; }
  var exactBarcode = matches.find(function (a) { return normalizeSearchKey(a.barcode) === q || compactSearchKey(a.barcode) === qCompact; });
  if (exactBarcode) { selectAbaya(exactBarcode.id); return; }
  var exactCodeMatches = matches.filter(function (a) { return normalizeSearchKey(a.code) === q || compactSearchKey(a.code) === qCompact; });
  if (exactCodeMatches.length === 1) { selectAbaya(exactCodeMatches[0].id); return; }
  grid.style.display = 'grid'; if (emptyEl) emptyEl.style.display = 'none';
  grid.innerHTML = matches.map(function (a) {
    return '<div class="ab-card" onclick="selectAbaya(\'' + a.id + '\')">' +
      '<div class="ab-card-bc-lbl">Item No.</div><div class="ab-card-bc">' + a.barcode + '</div>' +
      '<div class="ab-card-des">' + abayaIconHtml(a.icon) + a.design + '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px"><div class="ab-card-code">' + a.code + '</div>' + tierBadgeHtml(a.tier) + '</div></div>';
  }).join('');
}

function selectAbaya(id) {
  var ab = ABAYAS.find(function (a) { return a.id === id; });
  if (!ab || !selEmp) return;
  selAbaya = ab;
  var sc = document.getElementById('bc-scanner');
  sc.classList.add('success');
  document.getElementById('bc-status').textContent = ab.code + ' — Scanned \u2713';
  setTimeout(function () {
    var bin = document.getElementById('bc-input'); if (bin) bin.value = '';
    var base = getServerUrl();
    if (selEmp.photo) document.getElementById('rdy-av').innerHTML = '<img src="' + base + '/' + selEmp.photo + '" alt="">';
    else { document.getElementById('rdy-av').textContent = selEmp.initials; document.getElementById('rdy-av').style.background = selEmp.color; }
    document.getElementById('rdy-name').textContent = selEmp.name;
    document.getElementById('rdy-meta').textContent = selEmp.code + ' \u00b7 AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('rdy-proc').textContent = selRole || selEmp.process;
    document.getElementById('rdy-ac').textContent = String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('rdy-ab-icon').innerHTML = abayaIconHtml(ab.icon);
    document.getElementById('rdy-ab-code').textContent = ab.code;
    document.getElementById('rdy-ab-des').textContent = ab.design;
    document.getElementById('rdy-bc').textContent = ab.barcode;
    goTo('rdy'); resetIdleTimer();
  }, 500);
}

// ─── WORK FLOW ────────────────────────────────────────────────────────────────
function startWork() {
  if (!selEmp || !selAbaya || !socket) { showToast('Missing data or no connection', 'error'); return; }
  var btn = document.getElementById('btn-start-work'); btn.disabled = true; btn.textContent = 'Starting...';
  socket.emit('req_startWork', { emp_id: selEmp.id, abaya_id: selAbaya.id, process: selRole }, function (res) {
    btn.disabled = false; btn.textContent = '\uD83D\uDFE2 START WORK';
    if (!res.ok) { showToast(res.error, 'error'); return; }
    showToast('Session started for ' + selEmp.name, 'success');
    selEmp = null; selAbaya = null;
    document.getElementById('bc-input').value = ''; document.getElementById('bc-status').textContent = 'Ready to scan...'; document.getElementById('bc-scanner').classList.remove('success');
    resetFP(); document.getElementById('stepbar').style.display = 'flex'; goTo('fp'); resetIdleTimer();
  });
}

function getActiveWorkProcess() {
  var el = document.getElementById('wk-proc');
  var fromDom = el && el.textContent && el.textContent !== '\u2014' ? el.textContent.trim() : '';
  return fromDom || activeSessionProcess || '';
}

function announceInv(msg) { var el = document.getElementById('inv-announce'); if (!el) return; el.textContent = ''; if (msg) requestAnimationFrame(function () { el.textContent = msg; }); }

var MAX_INVOICE_NUMBERS = 500;
var TOKEN_RE = /^\d{1,20}$/;

function parseInvoiceNumberList(raw) {
  var str = String(raw != null ? raw : '');
  if (str.length > 12000) return { ok: false, error: 'List too long.', nums: null };
  var parts = str.trim().split(/[\r\n,;\s\u00a0]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  var nums = [], seen = {};
  for (var i = 0; i < parts.length; i++) {
    if (!TOKEN_RE.test(parts[i])) return { ok: false, error: 'Invalid: "' + parts[i].slice(0, 24) + '" — digits only.', nums: null };
    if (seen[parts[i]]) return { ok: false, error: 'Duplicate: ' + parts[i], nums: null };
    seen[parts[i]] = true; nums.push(parts[i]);
  }
  if (nums.length < 1) return { ok: false, error: 'Enter at least one invoice number.', nums: null };
  if (nums.length > MAX_INVOICE_NUMBERS) return { ok: false, error: 'Max ' + MAX_INVOICE_NUMBERS + ' per session.', nums: null };
  return { ok: true, error: '', nums: nums };
}

var invInputTimer = null;
function onInvoiceSerialInput(el) {
  el.value = el.value.replace(/[^\d\s,;\n\r\u00a0]/g, '');
  var hint = document.getElementById('inv-parse-hint'); if (!hint) return;
  clearTimeout(invInputTimer);
  invInputTimer = setTimeout(function () {
    if (!el.value.trim()) { hint.textContent = ''; return; }
    var p = parseInvoiceNumberList(el.value);
    hint.textContent = p.ok ? 'Ready: ' + p.nums.length + ' invoice number' + (p.nums.length === 1 ? '' : 's') : p.error;
  }, 200);
}

function finishWork() {
  if (!selEmp) { showToast('No active employee', 'error'); return; }
  if (getActiveWorkProcess() === 'Invoice maker') {
    var ta = document.getElementById('inv-serial'); if (ta) ta.value = '';
    var ph = document.getElementById('inv-parse-hint'); if (ph) ph.textContent = '';
    announceInv(''); goTo('inv'); resetIdleTimer(); if (ta) ta.focus(); return;
  }
  emitFinishWork({});
}

function submitInvoiceFinish(ev) {
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  if (!selEmp) { showToast('No active employee', 'error'); return false; }
  var raw = document.getElementById('inv-serial').value;
  var p = parseInvoiceNumberList(raw);
  if (!p.ok) { announceInv(p.error); showToast(p.error, 'error'); document.getElementById('inv-serial').focus(); return false; }
  emitFinishWork({ invoice_count: p.nums.length, invoice_serial: p.nums.join(',') });
  return false;
}

function emitFinishWork(extra) {
  if (!socket) return;
  var btn = document.getElementById('btn-finish-work');
  var btnInv = document.getElementById('btn-inv-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Finishing...'; }
  if (btnInv) btnInv.disabled = true;
  var payload = Object.assign({ emp_id: selEmp.id }, extra || {});
  socket.emit('req_finishWork', payload, function (res) {
    if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDD34 FINISH WORK'; }
    if (btnInv) btnInv.disabled = false;
    if (!res.ok) { showToast(res.error, 'error'); return; }
    document.getElementById('cf-emp').textContent = selEmp.name;
    document.getElementById('cf-ac').textContent = 'AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('cf-ab').textContent = res.abaya_code || '\u2014';
    document.getElementById('cf-proc').textContent = res.session_process || selEmp.process;
    document.getElementById('cf-dur').textContent = fmtHMS(res.duration_seconds);
    var invWrap = document.getElementById('cf-inv-wrap');
    if (res.invoice_count != null) { invWrap.style.display = 'block'; document.getElementById('cf-inv-n').textContent = String(res.invoice_count); document.getElementById('cf-inv-ser').textContent = res.invoice_serial || '\u2014'; }
    else invWrap.style.display = 'none';
    document.getElementById('stepbar').style.display = 'none'; goTo('conf');
    showToast('Work logged! Duration: ' + fmtHMS(res.duration_seconds), 'success');
    setTimeout(function () {
      selEmp = null; selAbaya = null;
      document.getElementById('bc-input').value = ''; document.getElementById('bc-status').textContent = 'Ready to scan...'; document.getElementById('bc-scanner').classList.remove('success');
      resetFP(); document.getElementById('stepbar').style.display = 'flex'; goTo('fp'); resetIdleTimer();
    }, 3000);
  });
}

// ─── NAV ──────────────────────────────────────────────────────────────────────
function goTo(s) {
  kioskNavStep = s;
  document.querySelectorAll('.scr').forEach(function (e) { e.classList.remove('on'); });
  var target = document.getElementById('scr-' + s); if (target) target.classList.add('on');
  if (s === 'ab') updateBcQueueHint();
  var steps = ['fp', 'id', 'ab', 'rdy', 'wk'];
  var idx = steps.indexOf(s);
  document.querySelectorAll('.stp').forEach(function (el, i) {
    el.style.background = 'transparent'; el.style.color = 'var(--tx3)'; el.style.fontWeight = '400';
    if (i < idx) { el.style.background = 'var(--grb)'; el.style.color = 'var(--gr)'; el.style.fontWeight = '600'; }
    if (i === idx) { el.style.background = 'var(--blb)'; el.style.color = 'var(--bl)'; el.style.fontWeight = '700'; }
  });
}

// ─── IDLE TIMER ───────────────────────────────────────────────────────────────
function resetIdleTimer() {
  clearTimeout(idleTimer); document.getElementById('idle-warn').style.display = 'none';
  idleTimer = setTimeout(function () {
    if (document.getElementById('scr-fp').classList.contains('on')) return;
    document.getElementById('idle-warn').style.display = 'block';
    resetFP(); clearBcExcelQueue(true); goTo('fp'); document.getElementById('stepbar').style.display = 'flex';
    showToast('Session timed out — please re-scan', 'error');
  }, 90000);
}

// ─── DEMO GRID ────────────────────────────────────────────────────────────────
function renderDemoGrid(activeIds) {
  activeIds = activeIds || [];
  var base = getServerUrl();
  var html = EMPLOYEES.map(function (e) {
    var busy = activeIds.includes(e.id);
    var avHtml = e.photo ? '<img src="' + base + '/' + e.photo + '" alt="">' : (e.initials || '?');
    var statusLine = busy
      ? '<div class="demo-ac" style="color:var(--gr);font-weight:700">\u25CF Working</div><div style="font-size:8px;color:var(--gr);margin-top:1px;opacity:.85">Tap to Finish</div>'
      : '<div class="demo-ac">AC-' + e.ac_no + '</div>';
    return '<div class="demo-emp' + (busy ? ' busy' : '') + '" onclick="simulateScanFor(\'' + e.id + '\')">' +
      '<div class="demo-av" style="background:' + (e.photo ? 'transparent' : (e.color || '#6a5fc1')) + '">' + avHtml + '</div>' +
      '<div class="demo-nm">' + (e.name || '?') + '</div>' + statusLine + '</div>';
  }).join('');
  document.getElementById('demo-grid').innerHTML = html;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function fmtHMS(sec) {
  if (!sec || sec < 1) return '0s';
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function showToast(msg, type) {
  type = type || 'info';
  var t = document.getElementById('toast');
  t.className = 'toast ' + type + ' show'; t.textContent = msg;
  clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove('show'); }, 3500);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', function () {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  loadBcQueueFromStorage(); updateBcQueueHint(); goTo('fp'); resetIdleTimer();
  connectToServer();
});

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return;
  if (socket && !socket.connected) socket.connect();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg) reg.update();
    });
  }
  pollClientConfig();
});
window.addEventListener('online', function () {
  if (socket && !socket.connected) socket.connect();
});
