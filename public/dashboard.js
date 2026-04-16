'use strict';

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
let dashInterval = null;
let fallbackPollTimer = null;
let fallbackConsecutiveErrors = 0;
let fallbackMode = false;

function applyFallbackState(state) {
  if (!state || typeof state !== 'object') return;
  STATE = state;
  renderAll();
}

function fetchStateFallback() {
  fetch('/api/state', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.ok || !d.state) return;
      fallbackConsecutiveErrors = 0;
      applyFallbackState(d.state);
    })
    .catch(() => {
      fallbackConsecutiveErrors += 1;
      if (fallbackConsecutiveErrors % 3 === 0) {
        showToast('Still trying to restore live connection...', 'info');
      }
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

// ─── CONNECTION ───────────────────────────────────────────────────────────────
socket.on('connect', () => {
  document.getElementById('conn-dot').classList.add('online');
  document.getElementById('conn-label').textContent = 'Live';
  if (fallbackMode) {
    showToast('Live connection restored', 'success');
  } else {
    showToast('Dashboard connected', 'success');
  }
  stopFallbackPolling();
});
socket.on('disconnect', () => {
  document.getElementById('conn-dot').classList.remove('online');
  document.getElementById('conn-label').textContent = 'Fallback';
  showToast('Live socket lost — switching to fallback sync...', 'error');
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

function nudgeSocketIfDisconnected() {
  if (!socket.connected) socket.connect();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') nudgeSocketIfDisconnected();
});
window.addEventListener('online', () => {
  nudgeSocketIfDisconnected();
});

socket.on('catalog_update', () => {
  refreshDashboardAbayaCatalog();
});

socket.on('employees_update', () => {
  loadEmployeesFromServer();
});

socket.on('sync_versions', () => {
  pollClientConfig();
});

function loadEmployeesFromServer() {
  fetch('/api/employees', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok || !Array.isArray(d.employees)) return;
      EMPLOYEES = d.employees;
      renderAll();
    })
    .catch(() => {});
}

let lastCatalogVersionSeen = null;
let lastEmployeesVersionSeen = null;

function applyClientConfig(cfg) {
  if (!cfg || !cfg.ok) return;
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
}

function pollClientConfig() {
  fetch('/api/client-config', { cache: 'no-store' })
    .then((r) => r.json())
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
  fetch('/api/catalog/abayas', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok || !Array.isArray(d.abayas)) return;
      ABAYAS = d.abayas.map(normalizeDashboardAbayaRow);
      renderAll();
    })
    .catch(() => {});
}

// ─── REAL-TIME STATE ──────────────────────────────────────────────────────────
socket.on('state_update', (data) => {
  applyFallbackState(data);
});

function renderAll() {
  renderKPIs();
  renderLiveSessions();
  renderEmployeePerf();
  renderHourlyChart();
  renderPareto();
  renderProcessEff();
  renderRecentInvoiceLogsNode();
  updateClock();
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderKPIs() {
  const logs = STATE.logs || [];
  const active = STATE.active || {};
  const actCount = Object.keys(active).length;
  const totalUnits = logs.length;

  document.getElementById('kpi-completed').textContent = totalUnits;
  document.getElementById('kpi-active').textContent = actCount;
  document.getElementById('kpi-inprog').textContent = actCount;

  if (totalUnits > 0) {
    const totalSec = logs.reduce((s, l) => s + l.duration_sec, 0);
    const avg = Math.round(totalSec / totalUnits);
    document.getElementById('kpi-avg').textContent = fmtHMS(avg);
  } else {
    document.getElementById('kpi-avg').textContent = '—';
  }
}

// ─── LIVE SESSIONS ────────────────────────────────────────────────────────────
function renderLiveSessions() {
  const el = document.getElementById('live-sessions');
  const active = STATE.active || {};
  const ids = Object.keys(active);

  if (ids.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:13px">No active sessions right now</div>';
    return;
  }

  el.innerHTML = ids.map(id => {
    const sess = active[id];
    const emp = EMPLOYEES.find(e => e.id === id);
    const ab = ABAYAS.find(a => a.id === sess.abaya_id);
    if (!emp) return '';
    const elapsed = Math.floor((Date.now() - sess.started_at) / 1000);
    const avHtml = emp.photo ? '<img src="/' + emp.photo + '" alt="">' : emp.initials;
    const sessionProcess = sess.process || emp.process;  // use chosen role
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--bd)">' +
      '<div class="emp-av" style="background:' + (emp.photo ? 'transparent' : emp.color) + '">' + avHtml + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:600">' + emp.name + '</div>' +
        '<div style="font-size:11px;color:var(--tx3);display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:2px">' +
          emp.code + ' &middot; <span style="color:var(--tx2);font-weight:600">' + sessionProcess + '</span>' +
          (ab ? ' &middot; ' + escapeHtml(ab.code) : '') +
          (ab && ab.tier ? ' ' + dashTierBadge(ab.tier) : '') +
        '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-size:14px;font-weight:700;color:var(--gr)">' + fmtHMS(elapsed) + '</div>' +
        '<div style="font-size:10px;color:var(--tx3)">elapsed</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ─── EMPLOYEE PERF BARS ───────────────────────────────────────────────────────
function renderEmployeePerf() {
  const perf = STATE.perf || [];
  const el = document.getElementById('emp-perf');
  if (!perf.length) { el.innerHTML = '<div style="color:var(--tx3);font-size:13px;padding:16px;text-align:center">No data yet</div>'; return; }

  const sorted = perf.slice().sort((a, b) => b.units - a.units);
  const maxU = sorted[0].units || 1;
  const topN = Math.max(1, Math.ceil(sorted.length * 0.2));

  el.innerHTML = sorted.map((p, i) => {
    const emp = EMPLOYEES.find(e => e.id === p.id);
    if (!emp) return '';
    const w = Math.max(2, Math.round((p.units / maxU) * 100));
    const isTop = i < topN;
    const avHtml = emp.photo ? '<img src="/' + emp.photo + '" alt="">' : emp.initials;
    return '<div class="emp-row">' +
      '<div class="emp-av" style="background:' + (emp.photo ? 'transparent' : emp.color) + '">' + avHtml + '</div>' +
      '<div style="width:120px"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (isTop ? '&#11088; ' : '') + emp.name + '</div><div style="font-size:10px;color:var(--tx3)">' + emp.process + '</div></div>' +
      '<div class="bar-wrap"><div class="bar-fill" style="width:' + w + '%;background:linear-gradient(90deg,' + emp.color + ',' + emp.color + '88)"></div></div>' +
      '<div style="width:36px;text-align:right;font-size:14px;font-weight:700">' + p.units + '</div>' +
      '<div style="width:44px;text-align:right;font-size:11px;color:var(--tx2)">' + p.eff + '%</div>' +
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

function logRowProcess(l) {
  const emp = EMPLOYEES.find(e => e.id === l.emp_id);
  return l.process || (emp ? emp.process : '') || '';
}

function formatInvoiceCellHtml(l) {
  const proc = logRowProcess(l);
  if (proc !== 'Invoice maker' || (l.invoice_count == null && !l.invoice_serial)) {
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
      const t = new Date(l.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const emp = EMPLOYEES.find(e => e.id === l.emp_id);
      const name = escapeHtml(emp ? emp.name : l.emp_id || '—');
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

// ─── HOURLY CHART ─────────────────────────────────────────────────────────────
function renderHourlyChart() {
  const h0 = typeof FACTORY_HOURLY_START === 'number' ? FACTORY_HOURLY_START : 9;
  const h1 = typeof FACTORY_HOURLY_END === 'number' ? FACTORY_HOURLY_END : 23;
  const logs = STATE.logs || [];
  const hours = {};
  for (let h = h0; h <= h1; h++) hours[h] = 0;
  logs.forEach(l => {
    const h = new Date(l.end).getHours();
    if (h >= h0 && h <= h1) hours[h]++;
  });
  const vals = Object.values(hours);
  const max = Math.max(...vals, 1);
  const bar = document.getElementById('hourly');
  const lbl = document.getElementById('hlbl');
  bar.innerHTML = Object.entries(hours).map(([h, v]) => {
    const ht = Math.max(4, Math.round((v / max) * 76));
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">' +
      '<div style="font-size:10px;color:var(--tx3)">' + (v > 0 ? v : '') + '</div>' +
      '<div style="width:100%;height:' + ht + 'px;background:linear-gradient(180deg,var(--bl),var(--pu));border-radius:3px 3px 0 0;opacity:' + (v > 0 ? 1 : 0.15) + '"></div>' +
    '</div>';
  }).join('');
  lbl.innerHTML = Object.keys(hours).map(h => '<div style="flex:1;font-size:9px;color:var(--tx3);text-align:center">' + h + '</div>').join('');

  const sh = document.getElementById('shift-hint');
  if (sh && typeof FACTORY_SHIFT_SCHEDULE_TEXT === 'string') {
    sh.textContent = FACTORY_SHIFT_SCHEDULE_TEXT;
  }
}

// ─── PARETO ───────────────────────────────────────────────────────────────────
function renderPareto() {
  const perf = (STATE.perf || []).slice().sort((a, b) => b.units - a.units);
  const topN = Math.ceil(perf.length * 0.2) || 1;
  const topUnits = perf.slice(0, topN).reduce((s, p) => s + p.units, 0);
  const totalUnits = perf.reduce((s, p) => s + p.units, 0);
  const pct = totalUnits > 0 ? Math.round((topUnits / totalUnits) * 100) : 0;
  const el = document.getElementById('pareto-chart');
  el.innerHTML = '<div style="text-align:center;margin-bottom:14px">' +
    '<div style="font-size:36px;font-weight:800;color:var(--am)">' + pct + '%</div>' +
    '<div style="font-size:12px;color:var(--tx2)">of output from top ' + topN + ' worker' + (topN > 1 ? 's' : '') + '</div>' +
  '</div>' +
  perf.slice(0, 5).map((p, i) => {
    const emp = EMPLOYEES.find(e => e.id === p.id);
    if (!emp) return '';
    const pctEmp = totalUnits > 0 ? Math.round((p.units / totalUnits) * 100) : 0;
    const avHtml = emp.photo ? '<img src="/' + emp.photo + '" alt="">' : emp.initials;
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<div class="emp-av" style="background:' + (emp.photo ? 'transparent' : emp.color) + ';width:28px;height:28px;font-size:10px">' + avHtml + '</div>' +
      '<div style="flex:1"><div style="font-size:11px;font-weight:600">' + emp.name + '</div>' +
      '<div style="height:5px;background:var(--s3);border-radius:3px;margin-top:3px"><div style="height:100%;width:' + pctEmp + '%;background:' + emp.color + ';border-radius:3px"></div></div></div>' +
      '<div style="font-size:12px;font-weight:700;color:var(--tx2)">' + p.units + '</div>' +
    '</div>';
  }).join('');
}

// ─── PROCESS EFF ─────────────────────────────────────────────────────────────
function canonicalLogProcess(l) {
  var lp = l.process || (EMPLOYEES.find(function (e) { return e.id === l.emp_id; }) || {}).process || '';
  if (lp === 'Cutting') return 'Tailor (01)';
  if (lp === 'Stitching') return 'Tailor (02)';
  if (lp === 'Finishing') return 'Hand Work';
  return lp;
}

function logMatchesWorkType(l, workType) {
  return canonicalLogProcess(l) === workType;
}

function renderProcessEff() {
  var procs = typeof WORK_TYPES !== 'undefined' ? WORK_TYPES : [];
  var logs = STATE.logs || [];
  var el = document.getElementById('proc-eff');
  var colors = {
    'Tailor (01)': 'var(--bl)',
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
  el.innerHTML = procs.map(function (proc) {
    var procLogs = logs.filter(function (l) { return logMatchesWorkType(l, proc); });
    var units = procLogs.length;
    var avgSec = units > 0 ? Math.round(procLogs.reduce(function (s, l) { return s + l.duration_sec; }, 0) / units) : 0;
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

// ─── REPORTS ─────────────────────────────────────────────────────────────────
let activeReportType = 'Daily';

function openReport(type) {
  activeReportType = type;
  const logs = getLogsForType(type);
  const modal = document.getElementById('modal-report');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');

  title.textContent = type + ' Production Report';

  const totalUnits = logs.length;
  const totalSec = logs.reduce((s, l) => s + l.duration_sec, 0);
  const avgCycle = totalUnits > 0 ? fmtHMS(Math.round(totalSec / totalUnits)) : '—';
  const actCount = Object.keys(STATE.active || {}).length;

  // Summary cards
  let html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px">' +
    statCard('Total Output', totalUnits + ' units', 'var(--gr)') +
    statCard('Avg Cycle', avgCycle, 'var(--am)') +
    statCard('Active Now', actCount, 'var(--bl)') +
  '</div>';

  // Per-employee breakdown
  const empMap = {};
  logs.forEach(l => {
    if (!empMap[l.emp_id]) empMap[l.emp_id] = { units: 0, totalSec: 0 };
    empMap[l.emp_id].units++;
    empMap[l.emp_id].totalSec += l.duration_sec;
  });
  const empRows = Object.entries(empMap).sort((a, b) => b[1].units - a[1].units);

  // Log table
  html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:16px">' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--tx3);padding:10px 12px;border-bottom:1px solid var(--bd);display:grid;grid-template-columns:50px minmax(0,1fr) 72px minmax(72px,0.9fr) 58px minmax(100px,1.1fr);gap:8px;align-items:center">' +
      '<span>Time</span><span>Employee</span><span>Abaya</span><span>Process</span><span style="text-align:right">Duration</span><span>Invoices</span>' +
    '</div>' +
    '<div style="max-height:240px;overflow-y:auto">';

  if (logs.length === 0) {
    html += '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:13px">No logs for this period</div>';
  } else {
    html += logs.slice().reverse().map(l => {
      const emp = EMPLOYEES.find(e => e.id === l.emp_id);
      const ab = ABAYAS.find(a => a.id === l.abaya_id);
      const t = new Date(l.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Use the process stored in the log (employee may have selected a different role)
      const logProcess = l.process || (emp ? emp.process : '—');
      return '<div style="display:grid;grid-template-columns:50px minmax(0,1fr) 72px minmax(72px,0.9fr) 58px minmax(100px,1.1fr);gap:8px;padding:9px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:start">' +
        '<span style="color:var(--tx3)">' + t + '</span>' +
        '<span style="font-weight:600">' + (emp ? escapeHtml(emp.name) : '—') + '</span>' +
        '<span style="color:var(--tx2)">' + (ab ? escapeHtml(ab.code) : '—') + (ab && ab.tier ? ' ' + dashTierBadge(ab.tier) : '') + '</span>' +
        '<span style="color:var(--bl);font-weight:600">' + escapeHtml(String(logProcess)) + '</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(l.duration_sec) + '</span>' +
        formatInvoiceCellHtml(l) +
      '</div>';
    }).join('');
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

function getLogsForType(type) {
  const logs = STATE.logs || [];
  const now = Date.now();
  if (type === 'Daily') return logs.filter(l => l.end > now - 86400000);
  if (type === 'Weekly') return logs.filter(l => l.end > now - 7 * 86400000);
  return logs; // Monthly = all
}

function closeReport() {
  document.getElementById('modal-report').classList.remove('open');
}

function exportReport() {
  const logs = getLogsForType(activeReportType);
  const totalUnits = logs.length;
  const totalSec = logs.reduce((s, l) => s + l.duration_sec, 0);
  const avg = totalUnits > 0 ? fmtHMS(Math.round(totalSec / totalUnits)) : '0s';

  let text = '\uD83D\uDCCA *AbaYa Track \u2014 ' + activeReportType + ' Report*\n';
  text += '_Generated: ' + new Date().toLocaleString() + '_\n\n';
  text += '\uD83D\uDC54 *Summary*\n';
  text += '\u2022 Total Completed: *' + totalUnits + ' units*\n';
  text += '\u2022 Avg Cycle Time: *' + avg + '*\n';
  text += '\u2022 Active Workers: *' + Object.keys(STATE.active || {}).length + '*\n\n';
  text += '\uD83D\uDCCB *Recent Sessions*\n';

  logs.slice(-10).reverse().forEach(l => {
    const emp = EMPLOYEES.find(e => e.id === l.emp_id);
    const ab = ABAYAS.find(a => a.id === l.abaya_id);
    const t = new Date(l.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const logProcess = l.process || (emp ? emp.process : '?');
    text += '\u25FD ' + t + ' | ' + (emp ? emp.name : '?') + ' | ' + (ab ? ab.code : '?') + ' | ' + logProcess + ' (' + fmtHMS(l.duration_sec) + ')';
    if (logProcess === 'Invoice maker' && l.invoice_serial) {
      const ser = String(l.invoice_serial).replace(/,/g, ', ');
      const short = ser.length > 80 ? ser.slice(0, 80) + '\u2026' : ser;
      text += '\n   Invoices (' + (l.invoice_count != null ? l.invoice_count : '?') + '): ' + short;
    }
    text += '\n';
  });

  text += '\n\u2705 _Sent from AbaYa Track CEO Dashboard_';

  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  closeReport();
}

// ─── CLOCK ────────────────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('dash-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) +
    ' \u2014 ' + new Date().toLocaleTimeString();
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
  updateClock();
  loadEmployeesFromServer();
  refreshDashboardAbayaCatalog();
  pollClientConfig();
  setInterval(pollClientConfig, 30000);
  // Refresh live timers every second
  setInterval(() => {
    renderLiveSessions();
    updateClock();
  }, 1000);
});
