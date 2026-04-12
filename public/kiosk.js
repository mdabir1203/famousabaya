'use strict';

const socket = io();

let selEmp = null;
let selAbaya = null;
let selRole = null;
let activeSessionProcess = null;
let idleTimer = null;

// ─── SOCKET CONNECTION STATUS ─────────────────────────────────────────────────
socket.on('connect', () => showToast('Connected to AbaYa Server', 'success'));
socket.on('disconnect', () => showToast('Lost server connection — retrying...', 'error'));

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
  goTo('ab');
  renderAbayaGrid();
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

// ─── ABAYA SCAN ───────────────────────────────────────────────────────────────
function onBcInput(val) {
  if (val.length >= 7) tryManualBarcode();
  resetIdleTimer();
}

function tryManualBarcode() {
  const val = document.getElementById('bc-input').value.trim().toUpperCase();
  if (!val) return;
  const a = ABAYAS.find(x => x.code === val || x.barcode === val);
  if (a) selectAbaya(a.id);
  else showToast('Abaya "' + val + '" not found', 'error');
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
      '<div class="ab-card-bc">' + a.barcode + '</div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:16px">' + a.icon + '</span>' +
        '<div class="ab-card-code">' + a.code + '</div>' +
      '</div>' +
      '<div class="ab-card-des">' + a.design + '</div>' +
    '</div>'
  ).join('');
}

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
    document.getElementById('rdy-ab-icon').innerHTML = ab.icon;
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
  document.querySelectorAll('.scr').forEach(e => e.classList.remove('on'));
  const target = document.getElementById('scr-' + s);
  if (target) target.classList.add('on');

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
  renderDemoGrid([]);
  goTo('fp');
  resetIdleTimer();
});
