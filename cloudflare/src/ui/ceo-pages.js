import { FACTORY_HOURLY_START, FACTORY_HOURLY_END } from '../working-hours.js';

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
export function getLoginPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AbaYa Track — CEO Access</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet"></noscript>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#1f1633;color:#ffffff;font-family:'Rubik',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .box{background:rgba(255,255,255,.08);border:1px solid rgba(54,45,89,.5);border-radius:24px;padding:40px;width:100%;max-width:360px;text-align:center;box-shadow:rgba(22,15,36,.9) 0px 24px 80px;backdrop-filter:blur(18px) saturate(180%)}
  .logo{width:64px;height:64px;background:linear-gradient(135deg,#6a5fc1,#422082);border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 20px}
  h1{font-family:'Sora','Rubik',sans-serif;font-size:22px;font-weight:700;margin-bottom:6px}
  p{color:#9c98b0;font-size:13px;margin-bottom:28px}
  input{width:100%;padding:14px 18px;background:#241a38;border:1px solid rgba(106,95,193,.3);border-radius:12px;color:#ffffff;font-size:16px;text-align:center;letter-spacing:3px;outline:none;transition:border-color .2s;margin-bottom:12px;font-family:'Rubik',sans-serif}
  input:focus{border-color:#6a5fc1}
  button{width:100%;padding:15px;background:#79628c;color:#fff;border:1px solid #584674;border-radius:13px;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;font-family:'Rubik',sans-serif;text-transform:uppercase;letter-spacing:0.2px;box-shadow:rgba(0,0,0,.1) 0px 1px 3px 0px inset}
  button:hover{box-shadow:rgba(0,0,0,.18) 0px .5rem 1.5rem}
  .err{color:#ef4444;font-size:13px;margin-top:10px;min-height:20px}
</style></head><body>
<div class="box">
  <div class="logo">&#129525;</div>
  <h1>CEO Access</h1>
  <p>AbaYa Track &mdash; Executive Dashboard</p>
  <input type="password" id="tok" placeholder="Enter Access Code" maxlength="64" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">&#128274; Access Dashboard</button>
  <div class="err" id="err"></div>
</div>
<script>
async function login() {
  const t = document.getElementById('tok').value.trim();
  const err = document.getElementById('err');
  if (!t) { err.textContent = 'Enter access code'; return; }
  err.textContent = '';
  try {
    var r = await fetch('/api/ceo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: t })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) {
      err.textContent = data && data.error ? String(data.error) : 'Login failed';
      return;
    }
    window.location.replace('/ceo');
  } catch (e) {
    err.textContent = (e && e.message) ? String(e.message).slice(0, 120) : 'Network error';
  }
}
</script></body></html>`;
}

export function getServiceWorkerCleanupScript() {
  return `self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((k) => caches.delete(k)));
    } catch (_) {}

    try {
      await self.registration.unregister();
    } catch (_) {}

    try {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(clientsList.map((client) => client.navigate(client.url)));
    } catch (_) {}
  })());
});

self.addEventListener('fetch', () => {});`;
}

// ─── CEO DASHBOARD HTML (served by the Worker itself) ─────────────────────────
export function getCEODashboard(origin) {
  const apiBase = origin;
  const baseJs = JSON.stringify(apiBase).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AbaYa Track — CEO Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet"></noscript>
<style>
:root{--bg:#1f1633;--s1:#150f23;--s2:#241a38;--s3:#362d59;--bd:rgba(54,45,89,.5);--bd2:rgba(106,95,193,.3);--tx:#ffffff;--tx2:#e5e7eb;--tx3:#9c98b0;--gr:#c2ef4e;--grb:rgba(194,239,78,.12);--rd:#ef4444;--rdb:rgba(239,68,68,.12);--bl:#6a5fc1;--blb:rgba(106,95,193,.15);--am:#ffb287;--amb:rgba(255,178,135,.12);--pu:#a78bfa;--fn:'Rubik',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;--fn-display:'Sora','Rubik',sans-serif;--fn-mono:Monaco,Menlo,'Ubuntu Mono',monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:var(--fn);min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:11px 18px;background:var(--s1);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:100}
.tb-brand{display:flex;align-items:center;gap:10px}
.tb-logo{width:32px;height:32px;background:linear-gradient(135deg,#6a5fc1,#422082);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px}
.tb-name{font-size:15px;font-weight:600}
.tb-sub{font-size:11px;color:var(--tx3)}
.live-badge{display:flex;align-items:center;gap:5px;background:var(--rdb);color:var(--rd);padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2px}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--rd);animation:blink 1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.dash{padding:16px;max-width:1100px;margin:0 auto}
.dh{font-family:var(--fn-display);font-size:20px;font-weight:700;margin-bottom:2px}
.ds{font-size:12px;color:var(--tx3);margin-bottom:18px}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.stat-card{background:rgba(255,255,255,.08);border:1px solid var(--bd);border-radius:16px;padding:18px;backdrop-filter:blur(18px) saturate(180%);box-shadow:rgba(22,15,36,.4) 0px 2px 8px}
.stat-lbl{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-weight:600}
.stat-val{font-size:28px;font-weight:800;margin:6px 0 2px}
.stat-sub{font-size:11px;color:var(--tx3)}
.dash-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.dash-card{background:rgba(255,255,255,.08);border:1px solid var(--bd);border-radius:16px;padding:18px;backdrop-filter:blur(18px) saturate(180%);box-shadow:rgba(22,15,36,.4) 0px 2px 8px}
.dash-card-title{font-size:11px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.emp-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;transition:background .15s}
.emp-row:hover{background:rgba(106,95,193,.08)}
.emp-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}
.bar-wrap{flex:1;height:5px;background:var(--s3);border-radius:3px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px}
.rep-panel{background:linear-gradient(135deg,rgba(106,95,193,.12),rgba(167,139,250,.08));border:1px solid rgba(106,95,193,.3);border-radius:14px;padding:16px;margin-bottom:16px}
.rep-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.rep-btn{display:flex;align-items:center;gap:6px;padding:9px 16px;border-radius:13px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #584674;background:#79628c;color:#fff;font-family:var(--fn);transition:all .2s;text-transform:uppercase;letter-spacing:0.2px;box-shadow:rgba(0,0,0,.1) 0px 1px 3px 0px inset}
.rep-btn:hover{box-shadow:rgba(0,0,0,.18) 0px .5rem 1.5rem;transform:translateY(-1px)}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(21,15,35,.85);z-index:999;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(8px);overflow-y:auto}
.modal-overlay.open{display:flex}
.modal-box{background:var(--s1);border:1px solid var(--bd2);border-radius:20px;padding:24px;width:100%;max-width:600px;margin:auto;box-shadow:rgba(22,15,36,.9) 0px 24px 80px;animation:pop .25s ease}
@keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.btn-export{flex:1;padding:13px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-weight:700;border:none;border-radius:13px;font-size:14px;cursor:pointer;font-family:var(--fn);transition:all .2s;text-transform:uppercase;letter-spacing:0.2px}
.btn-export:hover{opacity:.9}
.btn-close{padding:13px 22px;background:var(--s2);color:var(--tx2);font-weight:600;border:1px solid var(--bd2);border-radius:13px;font-size:14px;cursor:pointer;font-family:var(--fn);text-transform:uppercase;letter-spacing:0.2px}
.btn-close:hover{background:var(--s3);color:var(--tx)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--s1);border:1px solid var(--bd2);border-radius:12px;padding:11px 18px;font-size:13px;font-weight:500;z-index:9999;transition:transform .35s cubic-bezier(.175,.885,.32,1.275);white-space:nowrap}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast.success{border-color:rgba(194,239,78,.4);background:rgba(194,239,78,.1);color:var(--gr)}
.toast.error{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:var(--rd)}
.release-moment-wrap{max-width:1100px;margin:0 auto;padding:0 16px 10px}
.abaya-release-moment{position:relative;border-radius:18px;border:1px solid rgba(167,139,250,.38);background:linear-gradient(125deg,rgba(106,95,193,.2),rgba(21,15,35,.92));box-shadow:0 18px 50px rgba(4,2,10,.35);overflow:hidden}
.abaya-release-moment__glow{position:absolute;inset:-40%;background:radial-gradient(closest-side,rgba(167,139,250,.22),transparent 70%);opacity:.88;pointer-events:none}
.abaya-release-moment--motion .abaya-release-moment__glow{animation:armGlowCEO 15s ease-in-out infinite alternate}
@keyframes armGlowCEO{from{transform:translate(-3%,-1%) scale(1)}to{transform:translate(4%,2%) scale(1.05)}}
.abaya-release-moment__inner{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px;flex-wrap:wrap}
.abaya-release-moment__eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--pu);margin-bottom:6px}
.abaya-release-moment__hook{font-family:var(--fn-display);font-size:clamp(19px,2.2vw,24px);font-weight:800;letter-spacing:-.03em;line-height:1.15;margin:0 0 6px}
.abaya-release-moment__outcome{font-size:13px;color:var(--tx2);line-height:1.45;max-width:52ch;margin:0}
.abaya-release-moment__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.abaya-release-moment__btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:13px;font-size:12px;font-weight:700;font-family:var(--fn);text-decoration:none;cursor:pointer;transition:transform .16s ease}
.abaya-release-moment__btn--primary{background:linear-gradient(135deg,#8e6cff,#6f58d9);color:#fff;border:1px solid rgba(181,159,255,.55);box-shadow:0 8px 22px rgba(88,64,169,.4)}
.abaya-release-moment__btn--primary:hover{transform:translateY(-1px)}
.abaya-release-moment__btn--ghost{background:rgba(255,255,255,.06);color:var(--tx2);border:1px solid var(--bd2)}
.abaya-release-moment__dismiss{background:transparent;border:none;color:var(--tx3);font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;padding:6px 2px;font-family:var(--fn)}
@media(prefers-reduced-motion:reduce){.abaya-release-moment--motion .abaya-release-moment__glow{animation:none!important}}
#proc-split{max-height:220px;overflow-y:auto;padding-right:4px}
@media(max-width:700px){.stat-row{grid-template-columns:1fr 1fr}.dash-row{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="topbar">
  <div class="tb-brand">
    <div class="tb-logo">&#129525;</div>
    <div><div class="tb-name">AbaYa Track</div><div class="tb-sub">CEO Dashboard &mdash; Global View</div></div>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <div style="font-size:11px;color:var(--tx3)" id="sync-status">Syncing...</div>
    <div class="live-badge"><div class="live-dot"></div>LIVE</div>
  </div>
</div>

<div id="releaseMomentMount" class="release-moment-wrap"></div>

<div class="dash">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:4px">
    <div class="dh">Production Overview</div>
    <div style="font-size:11px;color:var(--tx3)">&#128274; Secure CEO View &mdash; Cloudflare Global Network</div>
  </div>
  <div class="ds" id="dash-date">Loading...</div>
  <div class="ds" id="dubai-now" style="font-size:11px">Dubai time: --</div>
  <div class="ds" id="work-status" style="font-size:11px">Status: --</div>

  <div class="rep-panel" id="exec-reports">
    <div style="font-size:15px;font-weight:700;color:var(--bl);display:flex;align-items:center;gap:8px">&#128274; Executive Reports</div>
    <div style="font-size:11px;color:var(--tx2);margin-top:4px">View report, then export to WhatsApp in one tap</div>
    <div class="rep-btns">
      <button class="rep-btn" onclick="openReport('daily')">&#128467; Daily Report</button>
      <button class="rep-btn" onclick="openReport('weekly')">&#128196; Weekly Report</button>
      <button class="rep-btn" onclick="openReport('monthly')">&#128202; Monthly Report</button>
      <button class="rep-btn" onclick="openReport('yearly')">&#128200; Yearly Report</button>
    </div>
  </div>

  <div class="rep-panel" style="margin-top:12px">
    <div style="font-size:15px;font-weight:700;color:var(--am)">&#128200; Process &amp; garment analytics</div>
    <div style="font-size:11px;color:var(--tx2);margin-top:4px">Station bottlenecks (slowest avg times), fastest workers, trace one barcode through every logged step</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center">
      <label style="font-size:11px;color:var(--tx3)">Period</label>
      <select id="analytics-period" style="padding:8px 10px;border-radius:8px;background:var(--s2);border:1px solid var(--bd);color:var(--tx);font-size:12px">
        <option value="daily">Factory day</option>
        <option value="weekly">This week</option>
        <option value="monthly">This month</option>
        <option value="yearly">This year</option>
      </select>
      <button class="rep-btn" type="button" onclick="openAnalytics()">Open analytics</button>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bd)">
      <div style="font-size:12px;font-weight:600;color:var(--tx2);margin-bottom:4px">Garment trace</div>
      <div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Paste item code or internal abaya id (same as in catalog)</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <input id="trace-q" type="text" placeholder="e.g. AB-0041" style="flex:1;min-width:160px;padding:10px 12px;border-radius:10px;background:var(--s2);border:1px solid var(--bd);color:var(--tx);font-size:13px" onkeydown="if(event.key==='Enter')runGarmentTrace()" />
        <button class="rep-btn" type="button" onclick="runGarmentTrace()">&#128269; Trace garment</button>
      </div>
    </div>
  </div>

  <div class="stat-row">
    <div class="stat-card"><div class="stat-lbl">Completed Today</div><div class="stat-val" id="kpi-completed" style="color:var(--gr)">—</div><div class="stat-sub">units finished</div></div>
    <div class="stat-card"><div class="stat-lbl">Active Workers</div><div class="stat-val" id="kpi-active" style="color:var(--bl)">—</div><div class="stat-sub">on floor now</div></div>
    <div class="stat-card"><div class="stat-lbl">Avg Cycle Time</div><div class="stat-val" id="kpi-avg" style="color:var(--am)">—</div><div class="stat-sub">per unit</div></div>
    <div class="stat-card"><div class="stat-lbl">Efficiency Score</div><div class="stat-val" id="kpi-eff">—</div><div class="stat-sub">vs 45-min target</div></div>
  </div>

  <div class="dash-row">
    <div class="dash-card">
      <div class="dash-card-title">&#9201; Live Active Sessions</div>
      <div id="live-sessions"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No active sessions</div></div>
    </div>
    <div class="dash-card">
      <div class="dash-card-title">Process Split Today</div>
      <div id="proc-split"><div style="color:var(--tx3);font-size:12px;padding:10px">No data</div></div>
    </div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="dash-card-title" style="margin:0">Employee Performance — Today</div>
      <div style="font-size:10px;color:var(--tx3)">&#11088; top 20%</div>
    </div>
    <div id="emp-perf"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No sessions yet today</div></div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div class="dash-card-title">Invoice maker — numbers logged</div>
    <div style="font-size:11px;color:var(--tx2);margin-bottom:10px">From last 100 completed sessions synced to D1</div>
    <div id="recent-invoice-logs"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">Loading...</div></div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div class="dash-card-title">Total time by abaya item code</div>
    <div style="font-size:10px;color:var(--tx2);margin-bottom:8px;line-height:1.35">Factory day: every finished step in D1 for that item, plus live time on the floor (same item).</div>
    <div id="abaya-totals-table"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">Loading\u2026</div></div>
  </div>

  <div class="dash-card">
    <div class="dash-card-title">Hourly output (9–23, factory shift window)</div>
    <div style="font-size:10px;color:var(--tx2);line-height:1.35;margin-bottom:8px">Sat–Thu: 9:00–13:30, 15:00–20:00, 20:40–23:30. Fri: 15:00–20:00, 20:40–23:30.</div>
    <div id="hourly" style="display:flex;align-items:flex-end;gap:2px;height:72px;margin-top:2px"></div>
    <div id="hlbl" style="display:flex;gap:3px;margin-top:4px"></div>
  </div>
</div>

<!-- REPORT MODAL -->
<div class="modal-overlay" id="modal">
  <div class="modal-box">
    <div style="font-size:19px;font-weight:700;margin-bottom:4px" id="modal-title">Report</div>
    <div style="font-size:12px;color:var(--tx2);margin-bottom:16px" id="modal-ts"></div>
    <div id="modal-body"></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn-export" onclick="exportWA()">&#128241; Send via WhatsApp</button>
      <button class="btn-close" onclick="closeModal()">Close</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return;
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (r) {
      r.unregister().catch(function () {});
    });
  }).catch(function () {});
})();
window.addEventListener('error', function (ev) {
  try {
    var syncEl = document.getElementById('sync-status');
    if (!syncEl || ev.message == null) return;
    var fn = ev.filename != null ? String(ev.filename) : '';
    if (
      fn &&
      fn.indexOf(location.origin) !== 0 &&
      fn.indexOf('blob:') !== 0
    )
      return;
    syncEl.textContent = 'Script error: ' + String(ev.message).slice(0, 160);
  } catch (_) {}
});
window.addEventListener('unhandledrejection', function (ev) {
  try {
    var syncEl = document.getElementById('sync-status');
    if (!syncEl) return;
    var r = ev.reason;
    var msg = r && r.message ? String(r.message) : String(r || 'rejected');
    syncEl.textContent = 'Async error: ' + msg.slice(0, 160);
  } catch (_) {}
});
const BASE = ${baseJs};
const WORK_TYPES_ORDER = ['Tailor (01)','Tailor (02)','Hand Work','Stone Work','Button','Embroidery','Ari Work','Hand Designing','Invoice maker','Packaging','Checker'];
(function bootReleaseMomentCEO() {
  var NS = 'abaya_release_dismiss_';
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }
  function motionClass() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return '';
    } catch (_) {}
    return ' abaya-release-moment--motion';
  }
  fetch(BASE + '/api/release-moment', { credentials: 'same-origin' })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (!d || !d.enabled || !d.momentId) return;
      try {
        if (localStorage.getItem(NS + d.momentId)) return;
      } catch (_) {}
      var m = document.getElementById('releaseMomentMount');
      if (!m) return;
      var cta = d.ctaPath || '/ceo';
      var cta2 = d.secondaryCtaPath || '';
      var lab = d.ctaLabel || 'Explore';
      var lab2 = d.secondaryCtaLabel || '';
      var card = document.createElement('div');
      card.className = 'abaya-release-moment';
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', 'Product update');
      card.innerHTML =
        '<div class="abaya-release-moment__glow' +
        motionClass() +
        '"></div><div class="abaya-release-moment__inner"><div class="abaya-release-moment__copy">' +
        '<div class="abaya-release-moment__eyebrow">' +
        esc(d.eyebrow || 'Update') +
        '</div><h2 class="abaya-release-moment__hook">' +
        esc(d.hook || '') +
        '</h2><p class="abaya-release-moment__outcome">' +
        esc(d.outcome || '') +
        '</p></div><div class="abaya-release-moment__actions">' +
        '<a class="abaya-release-moment__btn abaya-release-moment__btn--primary" href="' +
        esc(cta) +
        '">' +
        esc(lab) +
        '</a>' +
        (cta2 && lab2
          ? '<a class="abaya-release-moment__btn abaya-release-moment__btn--ghost" href="' +
            esc(cta2) +
            '">' +
            esc(lab2) +
            '</a>'
          : '') +
        '<button type="button" class="abaya-release-moment__dismiss" aria-label="Dismiss update message">Not now</button></div></div>';
      m.appendChild(card);
      var btn = card.querySelector('.abaya-release-moment__dismiss');
      if (btn) {
        btn.addEventListener('click', function () {
          try {
            localStorage.setItem(NS + d.momentId, '1');
          } catch (_) {}
          card.remove();
        });
      }
    })
    .catch(function () {});
})();
function procColorUI(p) {
  const c = {
    'Tailor (01)':'var(--bl)','Tailor (02)':'#8b5cf6','Hand Work':'var(--gr)','Stone Work':'var(--am)',
    'Button':'#fa7faa','Embroidery':'var(--pu)','Ari Work':'#14b8a6','Hand Designing':'#ffb287',
    'Invoice maker':'#c2ef4e','Packaging':'#79628c','Checker':'#6a5fc1'
  };
  return c[p] || 'var(--tx2)';
}
function byId(primary, fallback) {
  return document.getElementById(primary) || (fallback ? document.getElementById(fallback) : null);
}
let STATE = {
  active:{}, logs:[], perf:[], daily:[],
  factory_today:'', completed_today:0, avg_cycle_sec_today:0, efficiency_today:0,
  process_split_today:{},
  hourly_today:{},
  garment_totals_today:[],
  working_hours:null,
  working_status:''
};
let ABAYAS = [];
let activeReportType = 'daily';
let lastReportData = null;
let lastModalAnalytics = null;
let lastModalTrace = null;
let pollStartedAt = 0;
let pollFinishedAt = 0;
let pollInFlight = false;
let sessionExpired = false;
let lastSessionToastAt = 0;
let activeTimingCache = {
  cacheKey: '',
  byEmpId: {},
  byGarmentId: {},
};

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController === 'undefined') return undefined;
  const ctrl = new AbortController();
  setTimeout(function () {
    try {
      ctrl.abort();
    } catch (_) {}
  }, ms);
  return ctrl.signal;
}

async function fetchWithRetry(url, init, maxRetries) {
  maxRetries = maxRetries == null ? 3 : maxRetries;
  init = init || {};
  var lastErr;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var opts = { credentials: 'same-origin' };
      for (var k in init) {
        if (Object.prototype.hasOwnProperty.call(init, k) && k !== 'signal') opts[k] = init[k];
      }
      opts.signal = timeoutSignal(8000);
      var res = await fetch(url, opts);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxRetries - 1) return res;
        await new Promise(function (r) { setTimeout(r, 1000 * Math.pow(2, attempt)); });
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries - 1) throw err;
      await new Promise(function (r) { setTimeout(r, 1000 * Math.pow(2, attempt)); });
    }
  }
  throw lastErr || new Error('fetchWithRetry failed');
}

// ─── POLLING ──────────────────────────────────────────────────────────────────
async function poll(skipRefreshRetry) {
  if (pollInFlight) return;
  const syncEl = document.getElementById('sync-status');
  pollStartedAt = Date.now();
  pollInFlight = true;
  try {
    const url =
      BASE + '/api/state?ts=' + Date.now() + '&r=' + Math.random().toString(36).slice(2, 10);
    const r = await fetchWithRetry(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (r.status === 200) {
      let d = await r.json();
      if (d && d.ok === true && d.state && typeof d.state === 'object') {
        // Compatibility path with public/dashboard.js envelope.
        d = d.state;
      }
      if (!d || d.ok !== true) {
        if (syncEl) {
          syncEl.textContent = d && d.error ? String(d.error) : 'Bad state payload';
        }
        return;
      }
      sessionExpired = false;
      STATE = d;
      var renderOk = false;
      try {
        renderAll();
        renderOk = true;
      } catch (renderErr) {
        console.error('[ceo-dashboard] renderAll failed:', renderErr);
        if (syncEl) {
          var hint =
            renderErr && renderErr.message ? String(renderErr.message).slice(0, 100) : '';
          syncEl.textContent =
            'API OK — UI error ' +
            new Date().toLocaleTimeString([], { timeZone: uiTz() }) +
            (hint ? ' — ' + hint : '') +
            ' (console)';
        }
      }
      if (syncEl && renderOk) {
        const lagMs = Number(d.ingest_lag_ms || 0);
        const lagText = Number.isFinite(lagMs) ? ' · lag ' + Math.round(lagMs / 1000) + 's' : '';
        syncEl.textContent =
          'Updated ' +
          new Date().toLocaleTimeString([], { timeZone: uiTz() }) +
          (d.ts ? ' \u00b7 seq ' + String(d.ts).slice(-8) : '') +
          lagText;
      }
    } else if (r.status === 429) {
      if (syncEl) syncEl.textContent = 'Rate limited \u2014 wait a moment';
    } else if (r.status === 401) {
      if (!skipRefreshRetry) {
        try {
          const ref = await fetch(BASE + '/api/ceo/session/refresh', {
            method: 'POST',
            credentials: 'same-origin',
          });
          if (ref.ok) {
            sessionExpired = false;
            pollInFlight = false;
            return poll(true);
          }
        } catch (_) {}
      }
      sessionExpired = true;
      let msg = 'Session drift detected. Re-enter CEO access to resume live feed.';
      try {
        const x = await r.json();
        if (x && x.error) msg = String(x.error) + ' Re-enter CEO access to resume live feed.';
      } catch (_) {}
      if (syncEl) syncEl.textContent = msg;
      if (Date.now() - lastSessionToastAt > 15000) {
        showToast('Session expired. Live sync paused until sign-in.', 'error');
        lastSessionToastAt = Date.now();
      }
    } else {
      if (syncEl)
        syncEl.textContent =
          'HTTP ' + r.status + (r.status === 401 ? ' (session/cookie?)' : '');
    }
  } catch (e) {
    if (syncEl) {
      var emsg = e && e.message ? String(e.message).slice(0, 80) : '';
      syncEl.textContent = 'Offline \u2014 retrying...' + (emsg ? ' (' + emsg + ')' : '');
    }
  } finally {
    pollFinishedAt = Date.now();
    pollInFlight = false;
  }
}

function nextPollDelayMs() {
  if (sessionExpired) return 8000;
  const activeCount = Object.keys((STATE && STATE.active) || {}).length;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 7000;
  return activeCount > 0 ? 2000 : 4500;
}

function schedulePollLoop() {
  poll()
    .catch(function () {})
    .finally(function () {
      setTimeout(schedulePollLoop, nextPollDelayMs());
    });
}

function fmtHMS(sec) {
  const n = Math.floor(Number(sec) || 0);
  if (n < 1) return '0s';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function uiTz() {
  const wh = STATE && STATE.working_hours;
  return wh && wh.timezone ? String(wh.timezone) : 'Asia/Dubai';
}

function uiNowString() {
  return new Date().toLocaleString([], {
    timeZone: uiTz(),
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function localYmdNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function windowLabelFromRange(startDate, endDate) {
  if (!startDate && !endDate) return '';
  if (startDate && endDate && startDate === endDate) return String(startDate);
  return String(startDate || '') + ' to ' + String(endDate || '');
}

function parseHHMMClient(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minuteOfDayClient(epochSec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: uiTz(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSec * 1000));
  const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
  const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
  return hh * 60 + mm;
}

function weekdayKeyClient(epochSec) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: uiTz(), weekday: 'short' })
    .format(new Date(epochSec * 1000))
    .toLowerCase()
    .slice(0, 3);
  return wd;
}

function inWindowClient(epochSec) {
  const wh = STATE && STATE.working_hours;
  if (!wh || !wh.days) return true;
  const day = weekdayKeyClient(epochSec);
  const windows = Array.isArray(wh.days[day]) ? wh.days[day] : [];
  const minute = minuteOfDayClient(epochSec);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] || [];
    const s = parseHHMMClient(w[0]);
    const e = parseHHMMClient(w[1]);
    if (s == null || e == null) continue;
    if (minute >= s && minute < e) return true;
  }
  return false;
}

function computeActiveTimingCache() {
  const nowMs = Date.now();
  const active = STATE && STATE.active ? STATE.active : {};
  const activeIds = Object.keys(active).sort();
  const stateTs = Number(STATE && STATE.ts) || 0;
  const elapsedSinceStateSec = stateTs > 0 ? Math.max(0, Math.min(30, Math.floor((nowMs - stateTs) / 1000))) : 0;
  const key = String(activeIds.join('|')) + '::' + String(stateTs) + '::' + String(Math.floor(nowMs / 1000));
  if (activeTimingCache.cacheKey === key) return activeTimingCache;

  const byEmpId = {};
  const byGarmentId = {};
  const inShiftNow = inWindowClient(Math.floor(nowMs / 1000));
  activeIds.forEach(function (id) {
    const s = active[id] || {};
    const base = Math.max(0, Math.floor(Number(s.windowed_elapsed_sec) || 0));
    const live = !s.outside_shift && inShiftNow ? elapsedSinceStateSec : 0;
    const total = base + live;
    byEmpId[id] = total;
    const gid = String(s.abaya_id == null ? '' : s.abaya_id);
    if (gid) byGarmentId[gid] = (byGarmentId[gid] || 0) + total;
  });

  activeTimingCache = { cacheKey: key, byEmpId, byGarmentId };
  return activeTimingCache;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escWA(s) {
  return String(s == null ? '' : s)
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/([*_~\`])/g, '\\\\$1');
}

function logDurationSec(l) {
  const n = Number(l && l.duration_sec);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function garmentCompletedFromState(abayaId) {
  const arr = STATE.garment_totals_today || [];
  const sid = String(abayaId || '');
  for (let i = 0; i < arr.length; i++) {
    if (String(arr[i].abaya_id) === sid) {
      return Math.floor(Number(arr[i].completed_sec) || 0);
    }
  }
  return 0;
}

function activeSecondsOnGarment(abayaId) {
  const sid = String(abayaId || '');
  const cache = computeActiveTimingCache();
  return Math.floor(Number(cache.byGarmentId[sid]) || 0);
}

function garmentTotalLiveForId(abayaId) {
  return garmentCompletedFromState(abayaId) + activeSecondsOnGarment(abayaId);
}

function abayaBarcodeForId(abayaId) {
  const sid = String(abayaId || '');
  for (let i = 0; i < ABAYAS.length; i++) {
    if (ABAYAS[i].id === sid) return ABAYAS[i].barcode || '';
  }
  return '';
}

async function loadAbayaCatalog() {
  try {
    const r = await fetchWithRetry(BASE + '/api/catalog/abayas', { cache: 'no-store' });
    const d = await r.json();
    if (d && d.ok && Array.isArray(d.abayas)) {
      ABAYAS = d.abayas.map(function (a) {
        return {
          id: String(a.id),
          code: String(a.code != null ? a.code : ''),
          barcode: String(a.barcode != null ? a.barcode : ''),
        };
      });
    }
  } catch (e) {}
}

function renderAbayaTotalsTable() {
  const el = document.getElementById('abaya-totals-table');
  if (!el) return;
  const rows = STATE.garment_totals_today || [];
  const timingCache = computeActiveTimingCache();
  if (!rows.length) {
    el.innerHTML =
      '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">No garment timing for factory day yet</div>';
    return;
  }
  const sorted = rows.slice().sort(function (a, b) {
    const ta = garmentTotalLiveForId(a.abaya_id);
    const tb = garmentTotalLiveForId(b.abaya_id);
    if (tb !== ta) return tb - ta;
    return String(a.abaya_code || a.abaya_id).localeCompare(String(b.abaya_code || b.abaya_id));
  });
  const head =
    '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.85fr) 44px 68px 68px 72px;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;text-transform:uppercase;letter-spacing:0.4px;color:var(--tx3);align-items:center">' +
    '<span>Item code</span><span>Item no.</span><span style="text-align:right">Steps</span>' +
    '<span style="text-align:right">Done</span><span style="text-align:right">Active</span><span style="text-align:right">Total</span></div>';
  let body = '';
  sorted.forEach(function (r) {
    const code = r.abaya_code || r.abaya_id || '\u2014';
    const bc = abayaBarcodeForId(r.abaya_id) || '';
    const done = Math.floor(Number(r.completed_sec) || 0);
    const act = Math.floor(Number(timingCache.byGarmentId[String(r.abaya_id || '')]) || 0);
    const tot = garmentTotalLiveForId(r.abaya_id);
    body +=
      '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.85fr) 44px 68px 68px 72px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.25);font-size:11px;align-items:center">' +
      '<span style="font-weight:600;color:var(--tx2)">' +
      esc(String(code)) +
      '</span>' +
      '<span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--am)">' +
      (bc ? esc(bc) : '<span style="color:var(--tx3)">\u2014</span>') +
      '</span>' +
      '<span style="text-align:right;color:var(--tx3)">' +
      esc(String(r.segments != null ? r.segments : 0)) +
      '</span>' +
      '<span style="text-align:right;color:var(--tx2)">' +
      fmtHMS(done) +
      '</span>' +
      '<span style="text-align:right;color:var(--tx3)">' +
      (act > 0 ? fmtHMS(act) : '\u2014') +
      '</span>' +
      '<span style="text-align:right;color:var(--gr);font-weight:700">' +
      fmtHMS(tot) +
      '</span></div>';
  });
  el.innerHTML =
    '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--bd);border-radius:10px;background:var(--s2)">' +
    head +
    body +
    '</div>';
}

function buildLiveSessionsHtml() {
  const active = STATE.active || {};
  const activeIds = Object.keys(active);
  const timingCache = computeActiveTimingCache();
  if (activeIds.length === 0) {
    return '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No active sessions right now</div>';
  }
  const tz = uiTz();
  return activeIds
    .map(function (id) {
      const s = active[id];
      const startedMs = Number(s.started_at) || Date.now();
      const elapsed = Math.floor(Number(timingCache.byEmpId[id]) || 0);
      const totalItem = garmentTotalLiveForId(s.abaya_id);

      const startedLabel = new Date(startedMs).toLocaleString([], {
        timeZone: tz,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const startedFull = new Date(startedMs).toLocaleString([], {
        timeZone: tz,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const nowSecLive = Math.floor(Date.now() / 1000);
      const inShiftNowLive = inWindowClient(nowSecLive);
      const startedAtSec = Math.floor(startedMs / 1000);
      const outOfShift = !inShiftNowLive || !inWindowClient(startedAtSec);
      const outsideBadge = outOfShift
        ? ' <span title="Time outside shift windows is not counted" style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#fcd34d;background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);border-radius:8px;padding:1px 6px">Outside shift</span>'
        : '';

      return (
        '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)">' +
        '<div class="emp-av" style="background:' +
        s.emp_color +
        '">' +
        esc(s.emp_initials) +
        '</div>' +
        '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:600">' +
        esc(s.emp_name) +
        outsideBadge +
        '</div>' +
        '<div style="font-size:11px;color:var(--tx3)">' +
        esc(s.emp_code) +
        ' &middot; ' +
        esc(s.emp_process) +
        ' &middot; ' +
        esc(s.abaya_code || '\u2014') +
        '</div>' +
        '<div style="margin-top:8px">' +
        '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:700">Started</div>' +
        '<div title="' +
        esc(startedFull) +
        '" style="font-size:15px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.25">' +
        esc(startedLabel) +
        '</div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--tx3);margin-top:6px;line-height:1.45">' +
        'Item: <span style="color:var(--am);font-family:monospace;font-weight:600">' +
        esc(s.abaya_code || '\u2014') +
        '</span> <span style="opacity:.55">&middot;</span> Active in: <span style="color:var(--gr);font-weight:600">' +
        esc(s.emp_process || '\u2014') +
        '</span></div>' +
        '</div>' +
        '<div style="text-align:right">' +
        '<div style="font-size:14px;font-weight:700;color:var(--gr)">' +
        fmtHMS(elapsed) +
        '</div>' +
        '<div style="font-size:9px;color:var(--tx3)">this step (in shift)</div>' +
        '<div style="font-size:11px;font-weight:700;color:var(--am);margin-top:3px">' +
        fmtHMS(totalItem) +
        '</div>' +
        '<div style="font-size:9px;color:var(--tx3)">total on item</div>' +
        '</div></div>'
      );
    })
    .join('');
}

function renderLiveSessionsBlock() {
  const el = document.getElementById('live-sessions');
  if (!el) return;
  el.innerHTML = buildLiveSessionsHtml();
}

function renderRecentInvoiceLogs() {
  const el = document.getElementById('recent-invoice-logs');
  if (!el) return;
  const logs = STATE.logs || [];
  const rows = logs.filter(function (l) {
    return (l.emp_process || '') === 'Invoice maker' && l.invoice_serial;
  }).slice(0, 25);
  if (!rows.length) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">No invoice-maker rows in the last 100 ledger entries.</div>';
    return;
  }
  let html = '<div style="max-height:260px;overflow-y:auto">';
  rows.forEach(function (l) {
    const endMs = l.ended_at != null ? Number(l.ended_at) : 0;
    const t = new Date(endMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: uiTz() });
    const nums = esc(String(l.invoice_serial || '')).replace(/,/g, ', ');
    html +=
      '<div style="display:grid;grid-template-columns:48px 1fr 36px;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd);font-size:11px;align-items:start">' +
      '<span style="color:var(--tx3)">' +
      t +
      '</span>' +
      '<span style="word-break:break-word;font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;color:var(--tx2)">' +
      nums +
      '</span>' +
      '<span style="text-align:right;font-weight:700;color:var(--am)">' +
      (l.invoice_count != null ? esc(String(l.invoice_count)) : '') +
      '</span></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function renderAll() {
  const active = STATE.active || {};
  const perf = STATE.perf || [];
  const activeIds = Object.keys(active);

  const completed = Number(STATE.completed_today) || 0;
  const kpiCompleted = byId('kpi-completed', 'kpi-done');
  const kpiActive = byId('kpi-active');
  const kpiAvg = byId('kpi-avg');
  const kpiEff = byId('kpi-eff');
  if (kpiCompleted) kpiCompleted.textContent = completed;
  if (kpiActive) kpiActive.textContent = activeIds.length;
  if (completed > 0) {
    if (kpiAvg) kpiAvg.textContent = fmtHMS(STATE.avg_cycle_sec_today || 0);
    const eff = Number(STATE.efficiency_today) || 0;
    if (kpiEff) {
      kpiEff.textContent = eff + '%';
      kpiEff.style.color = eff >= 80 ? 'var(--gr)' : eff >= 60 ? 'var(--am)' : 'var(--rd)';
    }
  } else {
    if (kpiAvg) kpiAvg.textContent = '\u2014';
    if (kpiEff) {
      kpiEff.textContent = '\u2014';
      kpiEff.style.color = '';
    }
  }

  const ft = STATE.factory_today || '';
  document.getElementById('dash-date').textContent =
    (ft ? 'Factory day ' + ft + ' \u2014 ' : '') + new Date().toLocaleTimeString([], { timeZone: uiTz() });
  const dn = document.getElementById('dubai-now');
  if (dn) dn.textContent = 'Dubai time: ' + uiNowString();
  const ws = document.getElementById('work-status');
  if (ws) ws.textContent = 'Status: ' + String(STATE.working_status || '--');

  renderLiveSessionsBlock();
  renderAbayaTotalsTable();

  // Emp perf bars
  const sorted = perf.slice().sort((a,b)=>b.units-a.units);
  const maxU = sorted.length ? sorted[0].units : 1;
  const topN = Math.max(1, Math.ceil(sorted.length*0.2));
  document.getElementById('emp-perf').innerHTML = sorted.length === 0
    ? '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No sessions yet</div>'
    : sorted.map((p,i)=>{
      const w = Math.max(2,Math.round((p.units/maxU)*100));
      return '<div class="emp-row">' +
        '<div class="emp-av" style="background:'+(p.color||'#666')+'">'+p.initials+'</div>' +
        '<div style="width:120px;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(i<topN?'\u2B50 ':'')+p.name+'<div style="font-size:10px;color:var(--tx3)">'+p.process+'</div></div>' +
        '<div class="bar-wrap"><div class="bar-fill" style="width:'+w+'%;background:'+(p.color||'#3b82f6')+'88"></div></div>' +
        '<div style="width:32px;text-align:right;font-size:13px;font-weight:700">'+p.units+'</div>' +
        '<div style="width:38px;text-align:right;font-size:11px;color:var(--tx2)">'+p.eff+'%</div></div>';
    }).join('');

  const split = STATE.process_split_today || {};
  const total = WORK_TYPES_ORDER.reduce(function(s,t){ return s + (Number(split[t])||0); }, 0) || 1;
  document.getElementById('proc-split').innerHTML = WORK_TYPES_ORDER.map(function(p){
    var v = Number(split[p])||0;
    var pct = Math.round((v/total)*100);
    var col = procColorUI(p);
    return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="font-weight:600">'+p+'</span><span style="color:'+col+';font-weight:700">'+v+' units ('+pct+'%)</span></div>' +
      '<div style="height:5px;background:var(--s3);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:3px;transition:width .5s"></div></div></div>';
  }).join('');

  const hours = {};
  const hourKeys = Object.keys(STATE.hourly_today || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!hourKeys.length) {
    for (let h = ${FACTORY_HOURLY_START}; h <= ${FACTORY_HOURLY_END}; h++) {
      hours[h] = (STATE.hourly_today && STATE.hourly_today[h] != null) ? STATE.hourly_today[h] : 0;
    }
  } else {
    hourKeys.forEach((h) => {
      hours[h] = (STATE.hourly_today && STATE.hourly_today[h] != null) ? STATE.hourly_today[h] : 0;
    });
  }
  const hVals = Object.values(hours);
  const hMax = Math.max(...hVals,1);
  document.getElementById('hourly').innerHTML = Object.entries(hours).map(([h,v])=>{
    const ht = Math.max(4, Math.round((v/hMax)*68));
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">' +
      '<div style="font-size:9px;color:var(--tx3)">'+(v||'')+'</div>' +
      '<div style="width:100%;height:'+ht+'px;background:linear-gradient(180deg,var(--bl),var(--pu));border-radius:3px 3px 0 0;opacity:'+(v?1:0.12)+'"></div></div>';
  }).join('');
  document.getElementById('hlbl').innerHTML = Object.keys(hours).map(h=>'<div style="flex:1;font-size:8px;color:var(--tx3);text-align:center">'+h+'</div>').join('');

  renderRecentInvoiceLogs();
}

async function openAnalytics() {
  lastModalTrace = null;
  lastReportData = null;
  const sel = document.getElementById('analytics-period');
  const period = sel && sel.value ? sel.value : 'daily';
  document.getElementById('modal-title').textContent = 'Process analytics';
  document.getElementById('modal-ts').textContent = 'Loading\u2026';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');
  try {
    const r = await fetchWithRetry(
      BASE + '/api/analytics?period=' + encodeURIComponent(period) + '&local_today=' + encodeURIComponent(localYmdNow()) + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Request failed');
    lastModalAnalytics = d;
    const analyticsWindow = windowLabelFromRange(d.start_date, d.end_date);
    const analyticsFallback = d.fallback_applied ? ' (auto-fallback to previous day)' : '';
    document.getElementById('modal-ts').textContent =
      'Period: ' + period + ' \u2014 Window: ' + analyticsWindow + analyticsFallback + ' \u2014 ' +
      new Date().toLocaleString([], { timeZone: uiTz() }) + ' \u2014 D1';

    let html =
      '<p style="font-size:11px;color:var(--tx3);line-height:1.45;margin-bottom:12px">Higher avg time = slower station (bottleneck). <strong>Fastest in process</strong> needs at least 2 completed sessions in that role.</p>';

    const bp = d.by_process || [];
    html +=
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Avg time by station (slowest first)</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:16px">' +
      '<div style="display:grid;grid-template-columns:1fr 52px 52px 52px;gap:6px;padding:8px 10px;font-size:9px;color:var(--tx3);border-bottom:1px solid var(--bd)">' +
      '<span>Process</span><span style="text-align:right">Avg</span><span style="text-align:right">N</span><span style="text-align:right">Range</span></div>' +
      '<div style="max-height:200px;overflow-y:auto">';
    if (!bp.length) {
      html += '<div style="padding:16px;text-align:center;color:var(--tx3);font-size:12px">No sessions in this period</div>';
    } else {
      bp.forEach(function (row) {
        const col = procColorUI(row.emp_process);
        html +=
          '<div style="display:grid;grid-template-columns:1fr 52px 52px 52px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
          '<span style="font-weight:600;color:' +
          col +
          '">' +
          esc(row.emp_process) +
          '</span>' +
          '<span style="text-align:right;color:var(--am);font-weight:700">' +
          fmtHMS(row.avg_sec) +
          '</span>' +
          '<span style="text-align:right">' +
          esc(String(row.units)) +
          '</span>' +
          '<span style="text-align:right;font-size:10px;color:var(--tx3)">' +
          fmtHMS(row.min_sec) +
          '\u2013' +
          fmtHMS(row.max_sec) +
          '</span></div>';
      });
    }
    html += '</div></div>';

    html +=
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px">Fastest worker in each process (2+ samples)</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:16px;font-size:12px">';
    const fp = d.fastest_per_process || [];
    if (!fp.length) {
      html +=
        '<div style="padding:14px;color:var(--tx3)">Not enough data yet (need 2+ finishes per person per process).</div>';
    } else {
      fp.forEach(function (row) {
        html +=
          '<div style="padding:10px 12px;border-bottom:1px solid rgba(54,45,89,.2)">' +
          '<span style="color:var(--bl);font-weight:700">' +
          esc(row.emp_name) +
          '</span> ' +
          '<span style="color:var(--tx3)">' +
          esc(row.emp_process) +
          '</span> \u2014 avg ' +
          fmtHMS(row.avg_sec) +
          ' (' +
          esc(String(row.units)) +
          ' units)</div>';
      });
    }
    html += '</div>';

    html +=
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px">Speed leaders (overall avg, 2+ units)</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;max-height:180px;overflow-y:auto;font-size:12px">';
    const sl = d.speed_leaders || [];
    if (!sl.length) {
      html += '<div style="padding:14px;color:var(--tx3)">No data</div>';
    } else {
      sl.forEach(function (row, i) {
        html +=
          '<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.15)">' +
          '<span>' +
          (i + 1) +
          '. <strong>' +
          esc(row.emp_name) +
          '</strong> <span style="color:var(--tx3)">' +
          esc(row.emp_process) +
          '</span></span>' +
          '<span style="color:var(--gr);font-weight:700;white-space:nowrap">' +
          fmtHMS(row.avg_sec) +
          '</span></div>';
      });
    }
    html += '</div>';

    document.getElementById('modal-body').innerHTML = html;
  } catch (e) {
    lastModalAnalytics = null;
    document.getElementById('modal-body').innerHTML =
      '<div style="color:var(--rd);text-align:center;padding:20px">Failed: ' + esc(e.message) + '</div>';
  }
}

async function runGarmentTrace() {
  const inp = document.getElementById('trace-q');
  const q = inp && inp.value ? inp.value.trim() : '';
  if (!q) {
    showToast('Enter item code or abaya id', 'error');
    return;
  }
  lastModalAnalytics = null;
  lastReportData = null;
  document.getElementById('modal-title').textContent = 'Garment trace';
  document.getElementById('modal-ts').textContent = 'Loading\u2026';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');
  try {
    const r = await fetchWithRetry(
      BASE + '/api/trace?q=' + encodeURIComponent(q) + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Not found');
    lastModalTrace = d;
    const sumDone = Math.floor(Number(d.sum_duration_sec) || 0);
    const actSec = Math.floor(Number(d.active_seconds) || 0);
    const sumAll = Math.floor(Number(d.sum_with_active_sec) != null ? d.sum_with_active_sec : sumDone + actSec);
    document.getElementById('modal-ts').textContent =
      (d.session_count || 0) +
      ' finished step(s) \u2014 ' +
      fmtHMS(sumDone) +
      ' logged' +
      (actSec > 0 ? ' + ' + fmtHMS(actSec) + ' in progress' : '') +
      ' = ' +
      fmtHMS(sumAll) +
      ' total';

    let html =
      '<p style="font-size:11px;color:var(--tx3);margin-bottom:10px">' + esc(d.note || '') + '</p>';
    const rows = d.rows || [];
    if (!rows.length) {
      html +=
        '<div style="padding:20px;text-align:center;color:var(--tx3)">No sessions in D1 for <strong>' +
        esc(q) +
        '</strong>. Check code or sync from factory.</div>';
    } else {
      html +=
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden">' +
        '<div style="display:grid;grid-template-columns:52px 1fr minmax(100px,1.1fr) 58px;gap:6px;padding:8px 10px;font-size:9px;color:var(--tx3);border-bottom:1px solid var(--bd)">' +
        '<span>End</span><span>Who</span><span>Process</span><span style="text-align:right">Time</span></div>';
      rows.forEach(function (row) {
        const t = new Date((Number(row.ended_at) || 0) * 1000).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: uiTz(),
        });
        html +=
          '<div style="display:grid;grid-template-columns:52px 1fr minmax(100px,1.1fr) 58px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:11px;align-items:start">' +
          '<span style="color:var(--tx3);font-size:10px">' +
          esc(t) +
          '</span>' +
          '<span><strong>' +
          esc(row.emp_name) +
          '</strong></span>' +
          '<span style="color:var(--bl);font-weight:600">' +
          esc(row.emp_process) +
          '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700">' +
          fmtHMS(logDurationSec(row)) +
          '</span></div>';
      });
      html += '</div>';
    }
    document.getElementById('modal-body').innerHTML = html;
  } catch (e) {
    lastModalTrace = null;
    document.getElementById('modal-body').innerHTML =
      '<div style="color:var(--rd);text-align:center;padding:20px">' + esc(e.message) + '</div>';
  }
}

// ─── REPORT MODAL ─────────────────────────────────────────────────────────────
async function openReport(type) {
  activeReportType = type;
  lastModalAnalytics = null;
  lastModalTrace = null;
  document.getElementById('modal-title').textContent = type.charAt(0).toUpperCase()+type.slice(1)+' Report';
  document.getElementById('modal-ts').textContent = 'Fetching data from Cloudflare D1...';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');

  try {
    const r = await fetchWithRetry(
      BASE + '/api/report?type=' + encodeURIComponent(type) + '&local_today=' + encodeURIComponent(localYmdNow()) + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const data = await r.json();
    lastReportData = data;
    const periodWindow = windowLabelFromRange(data.period && data.period.start_date, data.period && data.period.end_date);
    const periodFallback = data.period && data.period.fallback_applied ? ' (auto-fallback to previous day)' : '';
    document.getElementById('modal-title').textContent =
      type.charAt(0).toUpperCase() + type.slice(1) + ' Report — ' + periodWindow;
    document.getElementById('modal-ts').textContent =
      'Generated: ' + new Date().toLocaleString([], { timeZone: uiTz() }) + ' — Window: ' + periodWindow + periodFallback + ' — via Cloudflare D1';

    const s = data.summary || {};
    const period = data.period || {};
    const insights = data.insights || {};
    let html = '<div style="font-size:11px;color:var(--tx3);margin-bottom:10px">Window: <strong>' +
      esc(String(period.start_date || '')) +
      '</strong> \u2192 <strong>' +
      esc(String(period.end_date || '')) +
      '</strong></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
      card('&#129532; Units', s.total_units||0, 'var(--gr)') +
      card('&#9202; Avg Cycle', fmtHMS(s.avg_sec), 'var(--am)') +
      card('&#128101; Workers', s.unique_workers||0, 'var(--bl)') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
      card('Active Time', fmtHMS(s.active_time_sec||0), 'var(--gr)') +
      card('Elapsed Time', fmtHMS(s.elapsed_time_sec||0), 'var(--am)') +
      card('Live In-Progress', fmtHMS(s.live_active_time_sec||0), 'var(--bl)') +
      card('Full Time', fmtHMS(s.full_time_sec||0), 'var(--pu)') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
      card('Tolerance credited', fmtHMS(s.tolerance_sec||0), 'var(--bl)') +
      card('Adjusted Full Time', fmtHMS(s.adjusted_full_time_sec||0), 'var(--gr)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);margin:-6px 0 10px">Adjusted full time applies empathy tolerance (mishaps + short interruptions).</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
      card('Throughput/hr', (s.throughput_units_per_hour||0), 'var(--gr)') +
      card('Utilization', (s.utilization_pct||0) + '%', 'var(--am)') +
      card('Unique items', s.unique_items||0, 'var(--bl)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">By work type</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;font-size:11px">' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">T01: <b>'+(s.tailor_01||0)+'</b> &middot; T02: <b>'+(s.tailor_02||0)+'</b><br>Hand: <b>'+(s.hand_work||0)+'</b> &middot; Stone: <b>'+(s.stone_work||0)+'</b></div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">Btn: <b>'+(s.button||0)+'</b> &middot; Emb: <b>'+(s.embroidery||0)+'</b><br>Ari: <b>'+(s.ari_work||0)+'</b> &middot; H.Des: <b>'+(s.hand_designing||0)+'</b></div>' +
      '<div style="grid-column:1/-1;background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">Inv: <b>'+(s.invoice_maker||0)+'</b> &middot; Pack: <b>'+(s.packaging||0)+'</b> &middot; Chk: <b>'+(s.checker||0)+'</b></div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
      card('Units vs prev', (insights.trend_vs_previous && insights.trend_vs_previous.total_units_delta) || 0, 'var(--gr)') +
      card('Active vs prev', fmtHMS((insights.trend_vs_previous && insights.trend_vs_previous.active_time_sec_delta) || 0), 'var(--am)') +
      card('Avg vs prev', fmtHMS((insights.trend_vs_previous && insights.trend_vs_previous.avg_sec_delta) || 0), 'var(--bl)') +
      '</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden">' +
      '<div style="display:grid;grid-template-columns:1fr 44px 62px 62px 62px 62px 62px 62px;gap:6px;padding:9px 10px;font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--bd)">' +
      '<span>Employee</span><span style="text-align:right">Units</span><span style="text-align:right">Active</span><span style="text-align:right">Elapsed</span><span style="text-align:right">Live</span><span style="text-align:right">Full</span><span style="text-align:right">Tol</span><span style="text-align:right">Adj</span></div>' +
      '<div style="max-height:220px;overflow-y:auto">';

    (data.by_employee||[]).forEach(e => {
      html += '<div style="display:grid;grid-template-columns:1fr 44px 62px 62px 62px 62px 62px 62px;gap:6px;padding:9px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px">' +
        '<span style="font-weight:600">'+e.emp_name+'<span style="color:var(--tx3);font-weight:400"> &middot; '+e.emp_process+'</span></span>' +
        '<span style="text-align:right;font-weight:700">'+e.units+'</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">'+fmtHMS(e.active_time_sec)+'</span>' +
        '<span style="text-align:right;color:var(--tx2)">'+fmtHMS(e.elapsed_time_sec)+'</span>' +
        '<span style="text-align:right;color:var(--bl)">'+fmtHMS(e.live_active_time_sec)+'</span>' +
        '<span style="text-align:right;color:var(--pu);font-weight:700">'+fmtHMS(e.full_time_sec)+'</span>' +
        '<span style="text-align:right;color:var(--am)">'+fmtHMS(e.tolerance_sec)+'</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">'+fmtHMS(e.adjusted_full_time_sec)+'</span></div>';
    });
    if (!data.by_employee||!data.by_employee.length) {
      html += '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:12px">No data for this period</div>';
    }
    html += '</div></div>';

    const byProcess = data.by_process || [];
    if (byProcess.length) {
      html +=
        '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">By process (decision bottlenecks)</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px;max-height:220px;overflow-y:auto">' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;color:var(--tx3)">' +
        '<span>Process</span><span style="text-align:right">Units</span><span style="text-align:right">Active</span><span style="text-align:right">Elapsed</span><span style="text-align:right">Live</span><span style="text-align:right">Full</span><span style="text-align:right">Tol</span><span style="text-align:right">Adj</span></div>';
      byProcess.forEach(function (p) {
        html +=
          '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
          '<span style="font-weight:600;color:'+procColorUI(p.emp_process)+'">' + esc(String(p.emp_process || '—')) + '</span>' +
          '<span style="text-align:right">' + esc(String(p.units || 0)) + '</span>' +
          '<span style="text-align:right;color:var(--gr)">' + fmtHMS(p.active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--tx2)">' + fmtHMS(p.elapsed_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--bl)">' + fmtHMS(p.live_active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--pu);font-weight:700">' + fmtHMS(p.full_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--am)">' + fmtHMS(p.tolerance_sec) + '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(p.adjusted_full_time_sec) + '</span></div>';
      });
      html += '</div>';
    }

    const itemTotals = data.item_totals || [];
    if (itemTotals.length) {
      html +=
        '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">Total time by item code (report period)</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px;max-height:200px;overflow-y:auto">' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;color:var(--tx3)">' +
        '<span>Item</span><span style="text-align:right">Steps</span><span style="text-align:right">Active</span><span style="text-align:right">Elapsed</span><span style="text-align:right">Live</span><span style="text-align:right">Full</span><span style="text-align:right">Tol</span><span style="text-align:right">Adj</span></div>';
      itemTotals.forEach(function (it) {
        const lab = it.abaya_code || it.abaya_id || '\u2014';
        const segs = it.segments != null ? it.segments : 0;
        html +=
          '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
          '<span style="font-weight:600">' +
          esc(String(lab)) +
          '</span>' +
          '<span style="text-align:right;color:var(--tx3)">' +
          esc(String(segs)) +
          '</span>' +
          '<span style="text-align:right;color:var(--gr)">' + fmtHMS(it.active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--tx2)">' + fmtHMS(it.elapsed_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--bl)">' + fmtHMS(it.live_active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--pu);font-weight:700">' + fmtHMS(it.full_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--am)">' + fmtHMS(it.tolerance_sec) + '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(it.adjusted_full_time_sec) + '</span></div>';
      });
      html += '</div>';
    }

    const invRows = data.invoice_maker_sessions || [];
    html += '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:18px 0 8px">Invoice maker \u2014 numbers logged</div>';
    if (!invRows.length) {
      html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;padding:14px;font-size:12px;color:var(--tx3)">No invoice-maker sessions with saved invoice numbers in this period.</div>';
    } else {
      html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;max-height:320px;overflow-y:auto">' +
        '<div style="display:grid;grid-template-columns:48px minmax(0,1fr) 36px minmax(0,1.2fr);gap:6px;padding:8px 10px;font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--bd);align-items:center">' +
        '<span>Time</span><span>Employee</span><span style="text-align:right">#</span><span>Invoice numbers</span></div>';
      invRows.forEach(function (row) {
        const t = new Date((Number(row.ended_at) || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: uiTz() });
        const nums = esc(String(row.invoice_serial || '')).replace(/,/g, ', ');
        html += '<div style="display:grid;grid-template-columns:48px minmax(0,1fr) 36px minmax(0,1.2fr);gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:11px;align-items:start">' +
          '<span style="color:var(--tx3);white-space:nowrap">' + t + '</span>' +
          '<span style="font-weight:600;min-width:0">' + esc(row.emp_name || '') + '<span style="color:var(--tx3);font-weight:400"> \u00b7 ' + esc(row.abaya_code || '\u2014') + '</span></span>' +
          '<span style="text-align:right;font-weight:700;color:var(--am)">' + (row.invoice_count != null ? esc(String(row.invoice_count)) : '\u2014') + '</span>' +
          '<span style="word-break:break-word;font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;color:var(--tx2);min-width:0">' + nums + '</span></div>';
      });
      html += '</div>';
    }

    document.getElementById('modal-body').innerHTML = html;
  } catch(e) {
    document.getElementById('modal-body').innerHTML = '<div style="color:var(--rd);text-align:center;padding:20px">Failed to load report: '+e.message+'</div>';
  }
}

function card(label, val, color) {
  return '<div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center;border:1px solid var(--bd)">' +
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;margin-bottom:4px">'+label+'</div>' +
    '<div style="font-size:20px;font-weight:800;color:'+color+'">'+val+'</div></div>';
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  lastModalAnalytics = null;
  lastModalTrace = null;
}

function exportWA() {
  if (lastModalAnalytics) {
    const d = lastModalAnalytics;
    const lines = [
      '[Analytics] *AbaYa Track - Process analytics*',
      'Period: *' + escWA(d.period || '') + '*',
      'Window: *' + escWA(windowLabelFromRange(d.start_date, d.end_date)) + '*' + (d.fallback_applied ? ' (previous-day fallback)' : ''),
      '_' + new Date().toLocaleString([], { timeZone: uiTz() }) + '_',
      '',
      '[Bottlenecks] *slowest avg first*',
    ];
    (d.by_process || []).forEach(function (r) {
      lines.push('- ' + escWA(r.emp_process) + ': avg *' + fmtHMS(r.avg_sec) + '* (' + r.units + ' units)');
    });
    lines.push('');
    lines.push('[Fastest] *per process (2+ samples)*');
    (d.fastest_per_process || []).forEach(function (r) {
      lines.push(
        '- ' +
          escWA(r.emp_process) +
          ': *' +
          escWA(r.emp_name) +
          '* avg ' +
          fmtHMS(r.avg_sec) +
          ' (' +
          r.units +
          ' u)'
      );
    });
    lines.push('');
    lines.push('[Leaders] *Speed leaders (overall)*');
    (d.speed_leaders || []).slice(0, 15).forEach(function (r, i) {
      lines.push(
        i +
          1 +
          '. ' +
          escWA(r.emp_name) +
          ' \u2014 ' +
          fmtHMS(r.avg_sec) +
          ' (' +
          r.units +
          ' units, ' +
          escWA(r.emp_process) +
          ')'
      );
    });
    lines.push('');
    lines.push('_AbaYa Track - Cloudflare D1_');
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\\n')), '_blank');
    closeModal();
    return;
  }
  if (lastModalTrace) {
    const d = lastModalTrace;
    const sumDone = Math.floor(Number(d.sum_duration_sec) || 0);
    const actSec = Math.floor(Number(d.active_seconds) || 0);
    const sumAll = Math.floor(Number(d.sum_with_active_sec) != null ? d.sum_with_active_sec : sumDone + actSec);
    const lines = [
      '[Trace] *Garment trace: ' + escWA(d.q || '') + '*',
      '_Finished: ' +
        fmtHMS(sumDone) +
        (actSec ? ' + in progress ' + fmtHMS(actSec) : '') +
        ' = ' +
        fmtHMS(sumAll) +
        ' (' +
        (d.session_count || 0) +
        ' steps)_',
      '',
    ];
    (d.rows || []).forEach(function (r) {
      lines.push('- ' + escWA(r.emp_name) + ' | ' + escWA(r.emp_process) + ' | ' + fmtHMS(logDurationSec(r)));
    });
    lines.push('');
    lines.push('_AbaYa Track_');
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\\n')), '_blank');
    closeModal();
    return;
  }
  if (!lastReportData) return;
  const s = lastReportData.summary || {};
  const insights = lastReportData.insights || {};
  const trend = insights.trend_vs_previous || {};
  const period = lastReportData.period || {};
  const lines = [
    '[Report] *AbaYa Track - ' +
      activeReportType.charAt(0).toUpperCase() +
      activeReportType.slice(1) +
      ' Report*',
    '_' + new Date().toLocaleString([], { timeZone: uiTz() }) + '_',
    '',
    'Window: *' + escWA(windowLabelFromRange(period.start_date, period.end_date)) + '*' + (period.fallback_applied ? ' (previous-day fallback)' : ''),
    '',
    '*Summary*',
    '- Total Output: *' + (s.total_units || 0) + ' units*',
    '- Avg Cycle: *' + fmtHMS(s.avg_sec) + '*',
    '- Active: *' + fmtHMS(s.active_time_sec || 0) + '* | Elapsed: *' + fmtHMS(s.elapsed_time_sec || 0) + '*',
    '- Live: *' + fmtHMS(s.live_active_time_sec || 0) + '* | Full: *' + fmtHMS(s.full_time_sec || 0) + '*',
    '- Tolerance: *' + fmtHMS(s.tolerance_sec || 0) + '* | Adjusted Full: *' + fmtHMS(s.adjusted_full_time_sec || 0) + '*',
    '- Throughput: *' + (s.throughput_units_per_hour || 0) + ' units/hr* | Utilization: *' + (s.utilization_pct || 0) + '%*',
    '- T01: ' +
      (s.tailor_01 || 0) +
      ' | T02: ' +
      (s.tailor_02 || 0) +
      ' | Hand: ' +
      (s.hand_work || 0) +
      ' | Stone: ' +
      (s.stone_work || 0),
    '- Btn: ' +
      (s.button || 0) +
      ' | Emb: ' +
      (s.embroidery || 0) +
      ' | Ari: ' +
      (s.ari_work || 0) +
      ' | H.Des: ' +
      (s.hand_designing || 0),
    '- Inv: ' +
      (s.invoice_maker || 0) +
      ' | Pack: ' +
      (s.packaging || 0) +
      ' | Chk: ' +
      (s.checker || 0),
    '- Vs previous: Units ' + (trend.total_units_delta || 0) + ', Active ' + fmtHMS(trend.active_time_sec_delta || 0) + ', Avg ' + fmtHMS(trend.avg_sec_delta || 0),
    '',
    '*Top Performers*',
  ];
  (lastReportData.by_employee || []).slice(0, 5).forEach(function (e, i) {
    lines.push(
      i +
        1 +
        '. ' +
        escWA(e.emp_name) +
        ' — ' +
        e.units +
        ' units (' +
        escWA(e.emp_process) +
        '), full ' +
        fmtHMS(e.full_time_sec) +
        ', tol ' +
        fmtHMS(e.tolerance_sec) +
        ', adj ' +
        fmtHMS(e.adjusted_full_time_sec)
    );
  });
  lines.push('');
  lines.push('*Top Bottleneck Processes (by full time)*');
  (lastReportData.by_process || []).slice(0, 5).forEach(function (p) {
    lines.push(
      '• ' +
        escWA(p.emp_process) +
        ': full ' +
        fmtHMS(p.full_time_sec) +
        ' (active ' +
        fmtHMS(p.active_time_sec) +
        ', elapsed ' +
        fmtHMS(p.elapsed_time_sec) +
        ')'
    );
  });
  const invs = lastReportData.invoice_maker_sessions || [];
  lines.push('');
  lines.push('*Invoice maker - numbers*');
  if (!invs.length) {
    lines.push('_No rows with saved lists in this period._');
  } else {
    invs.slice(0, 12).forEach(function (row, i) {
      const line = String(row.invoice_serial || '').replace(/,/g, ', ');
      const short = line.length > 100 ? line.slice(0, 100) + '\u2026' : line;
      lines.push(
        i + 1 +
          '. ' +
          escWA(row.emp_name) +
          ' \u2014 count ' +
          escWA(row.invoice_count != null ? row.invoice_count : '?') +
          ': ' +
          escWA(short)
      );
    });
    if (invs.length > 12) {
      lines.push('_+' + (invs.length - 12) + ' more in dashboard report._');
    }
  }
  lines.push('');
  lines.push('_AbaYa Track - Powered by Cloudflare_');
  window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\\n')), '_blank');
  closeModal();
}

function showToast(msg,type) {
  const t=document.getElementById('toast');
  t.className='toast '+(type||'info')+' show';
  t.textContent=msg;
  clearTimeout(t._t);
  t._t=setTimeout(()=>t.classList.remove('show'),3500);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
loadAbayaCatalog().then(function () {
  renderAbayaTotalsTable();
});
schedulePollLoop();
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') poll();
});
setInterval(function () {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible' || sessionExpired) return;
  fetch(BASE + '/api/ceo/session/refresh', { method: 'POST', credentials: 'same-origin' }).catch(
    function () {}
  );
}, 25 * 60 * 1000);
setInterval(function () {
  var syncEl = document.getElementById('sync-status');
  if (syncEl && pollInFlight && Date.now() - pollStartedAt > 12000) {
    syncEl.textContent = 'Polling timeout \u2014 check network / session / service worker';
  }
  const d = document.getElementById('dash-date');
  const ft = STATE.factory_today || '';
  if (d) d.textContent = (ft ? 'Factory day ' + ft + ' \u2014 ' : '') + new Date().toLocaleTimeString([], { timeZone: uiTz() });
  const dn = document.getElementById('dubai-now');
  if (dn) dn.textContent = 'Dubai time: ' + uiNowString();
  const ws = document.getElementById('work-status');
  if (ws) ws.textContent = 'Status: ' + String(STATE.working_status || '--');
}, 2000);
</script>
</body>
</html>`;
}
