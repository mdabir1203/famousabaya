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

function syncKioskConnUi(online, label) {
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  if (dot) {
    if (online) dot.classList.add('online');
    else dot.classList.remove('online');
  }
  if (lbl && label != null) lbl.textContent = label;
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

// ─── SOCKET CONNECTION STATUS ─────────────────────────────────────────────────
socket.on('connect', () => {
  syncKioskConnUi(true, 'Live');
  showToast('Connected to AbaYa Server', 'success');
});
socket.on('disconnect', () => {
  syncKioskConnUi(false, 'Offline');
  showToast('Lost server connection — retrying...', 'error');
});
socket.on('connect_error', () => {
  syncKioskConnUi(false, 'Offline');
});

function nudgeKioskSocketIfDisconnected() {
  if (!socket.connected) socket.connect();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') nudgeKioskSocketIfDisconnected();
});
window.addEventListener('online', () => {
  nudgeKioskSocketIfDisconnected();
});

socket.on('catalog_update', () => {
  refreshKioskAbayaCatalog();
});

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
    return '<img src="/' + safe + '" alt="" style="width:22px;height:22px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:4px">';
  }
  return '<span style="margin-right:4px">' + s + '</span>';
}

function refreshKioskAbayaCatalog() {
  fetch('/api/catalog/abayas')
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok || !Array.isArray(d.abayas)) return;
      ABAYAS = d.abayas.map(normalizeKioskAbayaRow);
      if (kioskNavStep === 'ab') renderAbayaGrid();
    })
    .catch(() => {});
}

// ─── REAL-TIME GRID UPDATE (when server broadcasts state) ─────────────────────
socket.on('state_update', (data) => {
  renderDemoGrid(Object.keys(data.active));
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
  const emp = EMPLOYEES.find(e => e.id === id);
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
        activeSessionProcess = res.session_process || selEmp.process;
        document.getElementById('wk-proc').textContent = activeSessionProcess;
        document.getElementById('stepbar').style.display = 'none';
        goTo('wk');
        showToast('\uD83D\uDD34 Tap FINISH WORK to complete your session', 'info');
      }, 600);
      return;
    }

    // New session — initialise role to employee's default, then show selector
    selRole = selEmp.process;
    if (selEmp.photo) {
      document.getElementById('id-photo').innerHTML = '<img src="/' + selEmp.photo + '" alt="">';
    } else {
      document.getElementById('id-photo').style.background = selEmp.color;
      document.getElementById('id-photo').innerHTML = '<span id="id-initials">' + selEmp.initials + '</span>';
    }
    document.getElementById('id-photo').innerHTML += '<div class="id-verified">&#10003;</div>';
    
    document.getElementById('id-name').textContent = selEmp.name;
    document.getElementById('id-empno').textContent = selEmp.code;
    document.getElementById('id-ac').textContent = 'AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('bc-num').textContent = selEmp.barcode;
    // Highlight the default role button
    setRole(selRole);
    setTimeout(() => { goTo('id'); resetIdleTimer(); }, 600);
  });
}

// ─── IDENTITY ─────────────────────────────────────────────────────────────────
function setRoleAt(index) {
  if (!WORK_TYPES || !WORK_TYPES[index]) return;
  setRole(WORK_TYPES[index]);
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

function normalizeSearchKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchKey(s) {
  return normalizeSearchKey(s).replace(/[^A-Z0-9]/g, '');
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
function onBcInput(val) {
  const el = document.getElementById('bc-input');
  const tokens = splitBcTokens(val);
  if (tokens.length > 1) {
    el.value = normalizeBcToken(tokens[0]);
    bcExcelQueue = tokens.slice(1).map(normalizeBcToken);
    updateBcQueueHint();
    showToast(tokens.length - 1 + ' more code(s) queued from list', 'info');
    val = el.value;
  }
  // Live-filter the grid as the employee types (item name OR barcode)
  filterAbayaGrid(normalizeBcToken(val));
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
    filterAbayaGrid(normalizeBcToken(el.value));
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

  const val = first;
  if (!val) return;
  const qNorm = normalizeSearchKey(val);
  const qCompact = compactSearchKey(val);

  // Exact barcode match auto-selects; exact code only auto-selects when unique in selected role.
  const roleFilter = selRole || (selEmp ? selEmp.process : '');
  const exactBarcode = ABAYAS.find(function (x) {
    if (x.process !== roleFilter) return false;
    var bc = String(x.barcode || '');
    return normalizeSearchKey(bc) === qNorm || compactSearchKey(bc) === qCompact;
  });
  if (exactBarcode) { selectAbaya(exactBarcode.id); return; }
  const exactCodeMatches = ABAYAS.filter(function (x) {
    if (x.process !== roleFilter) return false;
    var code = String(x.code || '');
    return normalizeSearchKey(code) === qNorm || compactSearchKey(code) === qCompact;
  });
  if (exactCodeMatches.length === 1) { selectAbaya(exactCodeMatches[0].id); return; }

  // Partial match — filter grid and tell employee to tap the right variant
  const partial = ABAYAS.filter(function (x) {
    var code = String(x.code || '');
    var bc = String(x.barcode || '');
    var des = String(x.design || '');
    var codeNorm = normalizeSearchKey(code);
    var bcNorm = normalizeSearchKey(bc);
    var desNorm = normalizeSearchKey(des);
    var codeCompact = compactSearchKey(code);
    var bcCompact = compactSearchKey(bc);
    var desCompact = compactSearchKey(des);
    return x.process === roleFilter && (
      codeNorm.includes(qNorm) ||
      bcNorm.includes(qNorm) ||
      desNorm.includes(qNorm) ||
      codeCompact.includes(qCompact) ||
      bcCompact.includes(qCompact) ||
      desCompact.includes(qCompact)
    );
  });
  filterAbayaGrid(val);
  if (partial.length > 1) {
    showToast(partial.length + ' items match "' + val + '" — tap the one you need', 'info');
  } else if (partial.length === 0) {
    const crossProcess = ABAYAS.filter(function (x) {
      var code = String(x.code || '');
      var bc = String(x.barcode || '');
      var des = String(x.design || '');
      return (
        normalizeSearchKey(code).includes(qNorm) ||
        normalizeSearchKey(bc).includes(qNorm) ||
        normalizeSearchKey(des).includes(qNorm) ||
        compactSearchKey(code).includes(qCompact) ||
        compactSearchKey(bc).includes(qCompact) ||
        compactSearchKey(des).includes(qCompact)
      );
    });
    if (crossProcess.length) {
      var processHints = [...new Set(crossProcess.map(function (r) { return r.process; }))].slice(0, 3).join(', ');
      showToast('Item found in different process: ' + processHints, 'info');
    } else {
      showToast('Item "' + val + '" not found', 'error');
    }
  }
}

function renderAbayaGrid() {
  if (!selEmp) return;
  const grid = document.getElementById('ab-grid');
  // Filter by selRole (the dynamically chosen role), not the employee's profile process
  const roleFilter = selRole || selEmp.process;
  const procAbayas = ABAYAS.filter(a => a.process === roleFilter);
  if (procAbayas.length === 0) {
    grid.style.display = 'none';
    document.getElementById('ab-empty').style.display = 'block';
    return;
  }
  grid.style.display = 'grid';
  document.getElementById('ab-empty').style.display = 'none';
  grid.innerHTML = procAbayas.map(a =>
    '<div class="ab-card" onclick="selectAbaya(\'' + a.id + '\')">' +
      '<div class="ab-card-bc-lbl">Item No.</div>' +
      '<div class="ab-card-bc">' + a.barcode + '</div>' +
      '<div class="ab-card-des">' +
        abayaIconHtml(a.icon) +
        a.design +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
        '<div class="ab-card-code">' + a.code + '</div>' +
        tierBadgeHtml(a.tier) +
      '</div>' +
    '</div>'
  ).join('');
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

  const roleFilter = selRole || selEmp.process;
  const pool = ABAYAS.filter(a => a.process === roleFilter);

  const matches = pool.filter(function (a) {
    const bc = normalizeSearchKey(a.barcode);
    const cod = normalizeSearchKey(a.code);
    const des = normalizeSearchKey(a.design);
    const bcCompact = compactSearchKey(a.barcode);
    const codCompact = compactSearchKey(a.code);
    const desCompact = compactSearchKey(a.design);
    return (
      bc === q || cod === q || bcCompact === qCompact || codCompact === qCompact ||
      cod.startsWith(q) || cod.includes(q) ||
      bc.startsWith(q) || bc.includes(q) ||
      des.includes(q) ||
      codCompact.startsWith(qCompact) || codCompact.includes(qCompact) ||
      bcCompact.startsWith(qCompact) || bcCompact.includes(qCompact) ||
      desCompact.includes(qCompact)
    );
  });

  const grid    = document.getElementById('ab-grid');
  const emptyEl = document.getElementById('ab-empty');

  if (matches.length === 0) {
    grid.style.display = 'none';
    grid.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.innerHTML = '&#128269; No items match <strong>' + q + '</strong> — try the full barcode or a different item name.';
    }
    return;
  }

  // Exact barcode match auto-selects; exact code only if unique among matches.
  const exactBarcode = matches.find(function (a) {
    const bc = normalizeSearchKey(a.barcode);
    const bcCompact = compactSearchKey(a.barcode);
    return bc === q || bcCompact === qCompact;
  });
  if (exactBarcode) { selectAbaya(exactBarcode.id); return; }
  const exactCodeMatches = matches.filter(function (a) {
    const cod = normalizeSearchKey(a.code);
    const codCompact = compactSearchKey(a.code);
    return cod === q || codCompact === qCompact;
  });
  if (exactCodeMatches.length === 1) { selectAbaya(exactCodeMatches[0].id); return; }

  // Multiple partial matches → show filtered cards so employee taps the right variant
  grid.style.display = 'grid';
  if (emptyEl) emptyEl.style.display = 'none';
  grid.innerHTML = matches.map(function (a) {
    return '<div class="ab-card" onclick="selectAbaya(\'' + a.id + '\')">' +
      '<div class="ab-card-bc-lbl">Item No.</div>' +
      '<div class="ab-card-bc">' + a.barcode + '</div>' +
      '<div class="ab-card-des">' +
        abayaIconHtml(a.icon) +
        a.design +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
        '<div class="ab-card-code">' + a.code + '</div>' +
        tierBadgeHtml(a.tier) +
      '</div>' +
    '</div>';
  }).join('');
}
// ─────────────────────────────────────────────────────────────────────────────

function selectAbaya(id) {
  const ab = ABAYAS.find(a => a.id === id);
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
      document.getElementById('rdy-av').innerHTML = '<img src="/' + selEmp.photo + '" alt="">';
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
  const btn = document.getElementById('btn-start-work');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  socket.emit('req_startWork', { emp_id: selEmp.id, abaya_id: selAbaya.id, process: selRole }, (res) => {
    btn.disabled = false;
    btn.textContent = '\uD83D\uDFE2 START WORK';
    if (!res.ok) { showToast(res.error, 'error'); return; }

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

function finishWork() {
  if (!selEmp) { showToast('No active employee', 'error'); return; }
  const proc = getActiveWorkProcess();
  if (proc === 'Invoice maker') {
    const ta = document.getElementById('inv-serial');
    if (ta) ta.value = '';
    const ph = document.getElementById('inv-parse-hint');
    if (ph) ph.textContent = '';
    announceInv('');
    goTo('inv');
    resetIdleTimer();
    // Focus in the same turn as the tap on "Finish work" so Android/iOS still treat it as a user
    // gesture and open the soft keyboard (delayed focus often suppresses the IME).
    if (ta) ta.focus();
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

function emitFinishWork(extra) {
  const btn = document.getElementById('btn-finish-work');
  const btnInv = document.getElementById('btn-inv-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Finishing...';
  }
  if (btnInv) btnInv.disabled = true;

  const payload = Object.assign({ emp_id: selEmp.id }, extra || {});
  socket.emit('req_finishWork', payload, (res) => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '\uD83D\uDD34 FINISH WORK';
    }
    if (btnInv) btnInv.disabled = false;
    if (!res.ok) {
      const invScr = document.getElementById('scr-inv');
      if (invScr && invScr.classList.contains('on')) {
        announceInv((res.error && String(res.error)) || 'Could not finish session. Check the form and try again.');
      }
      showToast(res.error, 'error');
      return;
    }

    document.getElementById('cf-emp').textContent = selEmp.name;
    document.getElementById('cf-ac').textContent = 'AC-' + String(selEmp.ac_no).padStart(2, '0');
    document.getElementById('cf-ab').textContent = res.abaya_code || '—';
    document.getElementById('cf-proc').textContent = res.session_process || selEmp.process;
    document.getElementById('cf-dur').textContent = fmtHMS(res.duration_seconds);
    const invWrap = document.getElementById('cf-inv-wrap');
    if (res.invoice_count != null && res.invoice_count !== undefined) {
      invWrap.style.display = 'block';
      document.getElementById('cf-inv-n').textContent = String(res.invoice_count);
      document.getElementById('cf-inv-ser').textContent = res.invoice_serial || '—';
    } else {
      invWrap.style.display = 'none';
    }

    document.getElementById('stepbar').style.display = 'none';
    goTo('conf');
    showToast('Work logged! Duration: ' + fmtHMS(res.duration_seconds), 'success');

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

// ─── NAV ──────────────────────────────────────────────────────────────────────
function goTo(s) {
  kioskNavStep = s;
  document.querySelectorAll('.scr').forEach(e => e.classList.remove('on'));
  const target = document.getElementById('scr-' + s);
  if (target) target.classList.add('on');
  if (s === 'ab') updateBcQueueHint();

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
  const html = EMPLOYEES.map(e => {
    const busy = activeIds.includes(e.id);
    const avHtml = e.photo 
      ? '<img src="/' + e.photo + '" alt="">' 
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
  if (!sec || sec < 1) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function showToast(msg, type) {
  type = type || 'info';
  const t = document.getElementById('toast');
  t.className = 'toast ' + type + ' show';
  t.textContent = msg;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  loadBcQueueFromStorage();
  updateBcQueueHint();
  renderDemoGrid([]);
  goTo('fp');
  resetIdleTimer();
  refreshKioskAbayaCatalog();
});
