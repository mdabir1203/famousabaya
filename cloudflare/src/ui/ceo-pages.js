import { FACTORY_HOURLY_START, FACTORY_HOURLY_END } from '../working-hours.js';

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
export function getLoginPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>FarewellAbaya — Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet"></noscript>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#160f24;color:#fff;font-family:'Rubik',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;overflow:hidden;position:relative}
  /* soft drifting aurora behind the card */
  body::before,body::after{content:'';position:fixed;width:60vmax;height:60vmax;border-radius:50%;filter:blur(80px);opacity:.5;z-index:0;animation:drift 18s ease-in-out infinite alternate}
  body::before{background:radial-gradient(circle,#6a5fc1,transparent 60%);top:-15vmax;left:-10vmax}
  body::after{background:radial-gradient(circle,#a86fd6,transparent 60%);bottom:-18vmax;right:-12vmax;animation-delay:-9s}
  @keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(4vmax,3vmax) scale(1.15)}}
  @media (prefers-reduced-motion:reduce){body::before,body::after,.logo{animation:none}}
  .box{position:relative;z-index:1;background:rgba(255,255,255,.07);border:1px solid rgba(150,130,220,.28);border-radius:26px;padding:42px 38px;width:100%;max-width:372px;text-align:center;box-shadow:rgba(15,9,28,.85) 0 30px 90px;backdrop-filter:blur(22px) saturate(180%)}
  .logo{width:66px;height:66px;background:linear-gradient(135deg,#7c6fe0,#422082);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:33px;margin:0 auto 18px;box-shadow:0 10px 30px rgba(106,95,193,.45);animation:float 4.5s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
  .hi{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#a89fd0;margin-bottom:6px}
  h1{font-family:'Sora','Rubik',sans-serif;font-size:24px;font-weight:800;margin-bottom:8px;background:linear-gradient(90deg,#fff,#c9b8ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .sub{color:#9c98b0;font-size:13.5px;margin-bottom:26px;line-height:1.5}
  input{width:100%;padding:15px 18px;background:#221735;border:1px solid rgba(124,111,224,.3);border-radius:13px;color:#fff;font-size:16px;text-align:center;letter-spacing:3px;outline:none;transition:border-color .2s,box-shadow .2s;margin-bottom:12px;font-family:'Rubik',sans-serif}
  input::placeholder{letter-spacing:.5px;color:#6f688a}
  input:focus{border-color:#9d8bff;box-shadow:0 0 0 4px rgba(124,111,224,.18)}
  button{width:100%;padding:15px;background:linear-gradient(135deg,#7c6fe0,#5a3fb0);color:#fff;border:0;border-radius:13px;font-size:14px;font-weight:700;cursor:pointer;transition:transform .12s,box-shadow .2s,filter .2s;font-family:'Rubik',sans-serif;text-transform:uppercase;letter-spacing:.4px}
  button:hover{filter:brightness(1.08);box-shadow:0 .6rem 1.6rem rgba(106,95,193,.5)}
  button:active{transform:translateY(1px) scale(.99)}
  .err{color:#ff8a8a;font-size:13px;margin-top:10px;min-height:20px}
  .legal{margin-top:22px;font-size:11.5px;color:#6f688a;line-height:1.6}
  .legal a{color:#a89fd0;text-decoration:none}
  .legal a:hover{text-decoration:underline}
</style></head><body>
<div class="box">
  <div class="logo">&#129525;</div>
  <div class="hi">FarewellAbaya</div>
  <h1>Welcome back</h1>
  <p class="sub">Your atelier, at a glance.<br>Pop in your access code and let's go.</p>
  <input type="password" id="tok" placeholder="Access code" maxlength="64" autofocus onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Open my dashboard &#10142;</button>
  <div class="err" id="err"></div>
  <div class="legal">By continuing you agree to our<br>
    <a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy Policy</a></div>
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
<script>
// Visible error banner — if ANY script on the page throws, show it
// inside the dashboard so the user doesn't have to open devtools.
(function () {
  function show(msg) {
    try {
      var b = document.getElementById('__js_err_banner');
      if (!b) {
        b = document.createElement('div');
        b.id = '__js_err_banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#ef4444;color:#fff;font:12px/1.4 monospace;padding:8px 12px;white-space:pre-wrap;max-height:40vh;overflow:auto;box-shadow:0 4px 12px rgba(0,0,0,.4)';
        if (document.body) document.body.appendChild(b); else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(b); });
      }
      var line = document.createElement('div');
      line.textContent = '[JS] ' + msg;
      b.appendChild(line);
    } catch (_) {}
  }
  window.addEventListener('error', function (ev) {
    show((ev.filename || 'inline') + ':' + (ev.lineno || '?') + ':' + (ev.colno || '?') + ' — ' + (ev.message || 'unknown'));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    show('unhandledrejection: ' + (r && r.message ? r.message : String(r)));
  });
})();
</script>
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
.stat-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
@media(max-width:1180px){.stat-row{grid-template-columns:repeat(3,1fr)}}
.stat-row-2{grid-template-columns:1fr 1fr}
.stat-row-3{grid-template-columns:1fr 1fr 1fr}
.stat-card{background:rgba(255,255,255,.08);border:1px solid var(--bd);border-radius:16px;padding:18px;backdrop-filter:blur(18px) saturate(180%);box-shadow:rgba(22,15,36,.4) 0px 2px 8px;position:relative;overflow:hidden;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background .18s ease;will-change:transform}
.stat-card:hover{transform:translateY(-2px);box-shadow:rgba(22,15,36,.55) 0px 14px 30px,inset 0 0 0 1px rgba(124,111,224,.32);border-color:rgba(124,111,224,.45);background:rgba(255,255,255,.11)}
.stat-card::before{content:'';position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--bl),var(--pu),var(--gr));opacity:0;transform:scaleX(.6);transform-origin:left center;transition:opacity .25s ease,transform .35s ease;pointer-events:none}
.stat-card:hover::before{opacity:1;transform:scaleX(1)}
/* Staggered entry: cards fade in + lift 8px, with a 50ms per-card delay */
@keyframes statCardEnter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.stat-card.stat-card-enter{animation:statCardEnter .45s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--stagger-i,0) * 50ms)}
@media(prefers-reduced-motion:reduce){.stat-card.stat-card-enter{animation:none}}
/* Click ripple: pure CSS using transform scale on a positioned span */
.stat-card-ink{position:absolute;border-radius:50%;background:rgba(255,255,255,.18);transform:scale(0);opacity:1;pointer-events:none;animation:statCardInk .55s ease-out forwards}
@keyframes statCardInk{to{transform:scale(2.2);opacity:0}}
@media(prefers-reduced-motion:reduce){.stat-card-ink{display:none}}
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
.rep-panel{background:linear-gradient(135deg,rgba(106,95,193,.12),rgba(167,139,250,.08));border:1px solid rgba(106,95,193,.3);border-radius:14px;padding:16px 16px 14px;margin-bottom:16px}
.rep-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.rep-btn{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:88px;padding:12px 14px;border-radius:13px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #584674;background:#79628c;color:#fff;font-family:var(--fn);transition:all .2s;text-transform:uppercase;letter-spacing:0.3px;box-shadow:rgba(0,0,0,.1) 0px 1px 3px 0px inset}
.rep-btn:hover{box-shadow:rgba(0,0,0,.22) 0px .5rem 1.5rem;transform:translateY(-1px);filter:brightness(1.06)}
/* Trace combobox dropdown */
.trace-dd-h{font-size:9px;text-transform:uppercase;letter-spacing:1.1px;color:var(--tx3);padding:10px 12px 6px}
.trace-dd-row{display:flex;align-items:center;gap:0;padding:9px 12px;cursor:pointer;border-top:1px solid rgba(124,111,224,.10);transition:background .14s ease,transform .14s ease;color:var(--tx);font-size:13px;line-height:1.3}
.trace-dd-row:hover,.trace-dd-row.trace-dd-active{background:rgba(106,95,193,.16);transform:translateX(2px)}
.trace-dd-code{font-weight:700;font-family:var(--fn-mono);letter-spacing:.2px}
.trace-dd-sub{font-size:11px;color:var(--tx3);margin-left:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.exec-filters{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
@media(max-width:980px){.exec-filters{grid-template-columns:1fr 1fr}}
@media(max-width:680px){.exec-filters{grid-template-columns:1fr}}
.exec-filter{background:rgba(0,0,0,.18);border:1px solid rgba(106,95,193,.22);border-radius:11px;padding:10px 12px}
.exec-filter-lbl{font-size:10.5px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px;font-weight:600;margin-bottom:6px}
.exec-filter-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.exec-filter-hint{font-size:10.5px;color:var(--tx3);margin-top:6px;line-height:1.4}
.exec-input{padding:8px 10px;border-radius:9px;background:var(--s1);border:1px solid var(--bd2);color:var(--tx);font-family:var(--fn);font-size:13px;min-width:0;flex:1}
.exec-input:focus{outline:none;border-color:var(--bl);box-shadow:0 0 0 3px rgba(106,95,193,.18)}
.exec-chip{padding:8px 12px;border-radius:9px;background:var(--s3);color:var(--tx2);border:1px solid var(--bd2);font-family:var(--fn);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap}
.exec-chip:hover{background:var(--bl);color:#fff;border-color:rgba(167,139,250,.5)}
.exec-chip-primary{background:linear-gradient(135deg,#6a5fc1,#422082);color:#fff;border-color:rgba(167,139,250,.55);box-shadow:0 0 0 1px rgba(167,139,250,.18) inset}
.exec-chip-primary:hover{filter:brightness(1.08);border-color:rgba(167,139,250,.75)}
.exec-reports{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}
@media(max-width:680px){.exec-reports{grid-template-columns:repeat(2,1fr)}}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(21,15,35,.85);z-index:999;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(8px);overflow-y:auto}
.modal-overlay.open{display:flex}
.modal-box{background:var(--s1);border:1px solid var(--bd2);border-radius:20px;padding:24px;width:100%;max-width:600px;margin:auto;box-shadow:rgba(22,15,36,.9) 0px 24px 80px;animation:pop .25s ease}
.modal-title{font-family:var(--fn-display);font-size:20px;font-weight:700;color:var(--tx);margin-bottom:4px;line-height:1.2;letter-spacing:-.3px}
.modal-sub{font-size:12.5px;color:var(--tx3);margin-bottom:16px;line-height:1.45}
.modal-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;align-items:center}
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

/* ─── Check Delivery Report (calendar + per-factory delivery summary) ─────────
 * Reuses the existing dark-purple palette and rep-panel / modal-overlay
 * patterns so the new button looks like it has always belonged to the
 * Executive Reports panel. No new visual language.
 */
.cr-wrap{display:flex;flex-direction:column;gap:14px}
.cr-cal{background:var(--s2);border:1px solid var(--bd);border-radius:14px;padding:14px}
.cr-cal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.cr-cal-title{font-family:var(--fn-display);font-size:15px;font-weight:700;color:var(--tx)}
.cr-nav{display:flex;gap:6px}
.cr-nav-btn{background:var(--s3);color:var(--tx2);border:1px solid var(--bd2);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--fn)}
.cr-nav-btn:hover{background:var(--bl);color:#fff;border-color:rgba(167,139,250,.5)}
.cr-nav-btn:disabled{opacity:.4;cursor:not-allowed}
.cr-weekdays,.cr-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cr-weekdays{margin-bottom:6px}
.cr-wd{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px;text-align:center;padding:4px 0;font-weight:600}
.cr-cell{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;border-radius:10px;font-size:13px;font-weight:600;color:var(--tx2);background:var(--s1);border:1px solid var(--bd);cursor:pointer;transition:all .15s;position:relative;font-family:var(--fn)}
.cr-cell:hover{border-color:var(--bl);color:var(--tx)}
.cr-cell.muted{opacity:.3;cursor:default}
.cr-cell.today{outline:1px solid var(--am);outline-offset:-2px}
.cr-cell.selected{background:var(--bl);color:#fff;border-color:rgba(167,139,250,.7)}
.cr-cell.in-range{background:rgba(106,95,193,.25);color:var(--tx);border-color:var(--bd2)}
.cr-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--tx2);padding:8px 4px;border-top:1px solid var(--bd)}
.cr-summary b{color:var(--tx)}
.cr-factory-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cr-factory-pick select{padding:6px 10px;border-radius:8px;border:1px solid var(--bd);background:var(--s2);color:var(--tx2);font-family:var(--fn);font-size:12px}
.cr-totals{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.cr-tot{background:var(--s2);border:1px solid var(--bd);border-radius:10px;padding:10px;text-align:center}
.cr-tot-lbl{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-weight:600}
.cr-tot-val{font-size:20px;font-weight:800;color:var(--gr);font-family:var(--fn-display);letter-spacing:-.5px}
.cr-tot-val.delivered{color:var(--gr)}
.cr-tot-val.pending{color:var(--am)}
.cr-tot-val.cancelled{color:var(--rd)}
.cr-tot-val.abayas{color:var(--bl)}
.cr-tot-val.invoices{color:var(--pu)}
.cr-section{background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
.cr-section-h{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--bd);font-size:12px;color:var(--tx2);font-weight:700;text-transform:uppercase;letter-spacing:.6px}
.cr-section-h .cr-mini{font-size:10px;color:var(--tx3);font-weight:600;text-transform:none;letter-spacing:0}
.cr-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px}
.cr-row:last-child{border-bottom:0}
.cr-factory-name{font-weight:700;color:var(--tx);font-size:13px}
.cr-inv-name{font-weight:600;color:var(--tx2);font-family:var(--fn-mono);font-size:11px}
.cr-abaya{font-family:var(--fn-mono);font-size:11px;color:var(--tx2);display:flex;justify-content:space-between;gap:8px;align-items:center}
.cr-status{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
.cr-status.delivered{color:var(--gr);background:rgba(194,239,78,.12);border:1px solid rgba(194,239,78,.3)}
.cr-status.pending{color:var(--am);background:rgba(255,178,135,.12);border:1px solid rgba(255,178,135,.3)}
.cr-status.cancelled{color:var(--rd);background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3)}
.cr-empty{padding:24px;text-align:center;color:var(--tx3);font-size:13px}
/* Smooth the data-swap on every poll. Without this, the innerHTML
   replacements in renderAll() visibly snap, making the live row +
   per-employee + abaya totals look like the previous data is going
   away and being replaced. The .is-syncing class is applied to .dash
   around the STATE = d; renderAll() pair so the user sees a brief
   pulse instead of a hard swap. */
.dash{transition:opacity .18s ease}
.dash.is-syncing{opacity:.55}
/* 30-day history strip in the per-employee day report. */
.ed-day-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;padding:10px 12px}
.ed-day-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:6px 4px;border-radius:8px;border:1px solid rgba(54,45,89,.35);font-family:var(--fn);color:var(--tx);cursor:pointer;transition:transform .12s ease,border-color .12s ease;min-height:54px}
.ed-day-cell:hover{transform:translateY(-1px);border-color:var(--am)}
.ed-day-cell.is-current{border-color:var(--am);box-shadow:0 0 0 1px rgba(245,158,11,.4)}
.ed-day-date{font-size:10px;color:var(--tx3);font-weight:600;letter-spacing:.4px}
.ed-day-units{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.ed-day-time{font-size:10px;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.1;margin-top:1px}
/* By-employee table in the Process & garment analytics modal.
   Responsive grid: 8-col wide → 4-col medium → 2-row card on mobile. */
.by-emp-table{background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:visible}
.by-emp-head,.by-emp-row{display:grid;grid-template-columns:minmax(0,1fr) 50px repeat(6,minmax(60px,1fr));gap:8px;padding:10px 12px;align-items:center;position:relative}
.by-emp-head{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--bd);border-radius:10px 10px 0 0;background:var(--s1)}
.by-emp-head>span,.by-emp-row>span[data-col]{text-align:right;font-variant-numeric:tabular-nums}
.by-emp-row{cursor:pointer;border-bottom:1px solid rgba(54,45,89,.2);font-size:13px;transition:background-color .14s ease,transform .14s ease}
.by-emp-body>*:last-child.by-emp-row{border-bottom:0}
.by-emp-row:hover{background:rgba(106,95,193,.10);transform:translateX(1px)}
.by-emp-row:hover .by-emp-name{color:var(--am)}
.by-emp-name{display:inline-block;text-decoration:none;background-image:linear-gradient(currentColor,currentColor);background-size:0 1px;background-repeat:no-repeat;background-position:0 100%;transition:background-size .25s ease,color .14s ease;min-width:0}
.by-emp-row:hover .by-emp-name{background-size:100% 1px}
.by-emp-units-pill{display:inline-block;min-width:34px;padding:2px 8px;border-radius:999px;background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.32);color:var(--gr);font-weight:700;font-variant-numeric:tabular-nums;font-size:12px;text-align:center}
.by-emp-col-hide-mid,.by-emp-col-hide-sm{display:none}
/* Mobile-only horizontal stat strip: hidden on desktop, shown via media query */
.by-emp-row-stats{display:none}

/* Medium: <=720px — drop tolerance + live, keep units + 4 time stats */
@media(max-width:720px){
  .by-emp-head,.by-emp-row{grid-template-columns:minmax(0,1fr) 56px repeat(4,minmax(54px,1fr));gap:6px;padding:10px;font-size:12px}
  .by-emp-col-hide-mid{display:none}
}

/* Small: <=520px — card layout: name+units on top row, time stats
   below in a horizontal flex strip. No grid. No overlap. */
@media(max-width:520px){
  /* Give the modal a little more room on phones */
  .modal-overlay{padding:8px}
  .modal-box{padding:16px;border-radius:14px}
  .by-emp-head{display:none}
  .by-emp-row{display:block;padding:10px 12px}
  .by-emp-row-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .by-emp-name{flex:1;min-width:0}
  .by-emp-units-pill{flex:0 0 auto}
  .by-emp-row-stats{display:flex;gap:6px;margin-top:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;scrollbar-width:thin}
  .by-emp-stat{flex:0 0 auto;background:var(--s1);border:1px solid var(--bd);border-radius:6px;padding:3px 7px;font-size:10.5px;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.3;white-space:nowrap}
  .by-emp-stat b{display:block;color:var(--tx);font-size:11.5px;font-weight:700;margin-top:1px}
  .by-emp-col-hide-sm{display:none}
  /* Popup drops below the row instead of off to the right */
  .by-emp-popup{position:static;width:auto;max-width:none;transform:none!important;margin-top:8px;right:auto;top:auto}
  .by-emp-row:hover .by-emp-popup,.by-emp-row:focus-within .by-emp-popup{transform:none!important}
}

/* Hover popup: focused on context the row can't show, NOT a duplicate
   of the row's time stats. Shows: avatar, name, all processes this
   person wore in the window, last finished abaya, avg per unit, and
   the one-tap action. */
.by-emp-popup{position:absolute;right:14px;top:50%;transform:translateY(-50%) translateX(6px);width:260px;max-width:calc(100% - 28px);background:linear-gradient(180deg,rgba(34,24,58,.97),rgba(22,15,36,.97));border:1px solid rgba(124,111,224,.45);border-radius:12px;padding:14px;font-size:12px;color:var(--tx);box-shadow:0 14px 40px rgba(0,0,0,.45),0 0 0 1px rgba(124,111,224,.18);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;z-index:5;backdrop-filter:blur(14px) saturate(180%)}
.by-emp-row:hover .by-emp-popup,.by-emp-row:focus-within .by-emp-popup{opacity:1;transform:translateY(-50%) translateX(0);pointer-events:auto}
.by-emp-popup-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.by-emp-popup-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#0f0a1f;flex-shrink:0}
.by-emp-popup-name{font-size:15px;font-weight:700;color:#fff;line-height:1.15}
.by-emp-popup-empcode{font-size:10px;color:var(--tx3);letter-spacing:.5px;margin-top:1px}
.by-emp-popup-processes{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.by-emp-popup-process{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:.2px}
.by-emp-popup-units-row{display:flex;align-items:baseline;justify-content:space-between;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.28);border-radius:8px;padding:8px 12px;margin-bottom:12px}
.by-emp-popup-units-lbl{font-size:10px;color:var(--gr);text-transform:uppercase;letter-spacing:.6px;font-weight:700}
.by-emp-popup-units-val{font-size:24px;font-weight:800;color:var(--gr);font-variant-numeric:tabular-nums;line-height:1}
.by-emp-popup-cta{display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;background:linear-gradient(135deg,#7c6fe0,#422082);color:#fff;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;letter-spacing:.3px;transition:filter .14s ease,transform .14s ease}
.by-emp-popup-cta:hover{filter:brightness(1.1);transform:translateY(-1px)}
.cr-cancel-list{display:flex;flex-direction:column;gap:6px;padding:10px 12px}
.cr-cancel-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--s1);border:1px solid var(--bd);border-radius:8px;font-size:12px;flex-wrap:wrap}
.cr-cancel-row b{font-family:var(--fn-mono);color:var(--rd);font-size:11px}
.cr-cancel-row .cr-when{color:var(--tx3);font-size:11px}
.cr-form{display:flex;flex-direction:column;gap:10px}
.cr-form label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--tx3);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.cr-form input,.cr-form select{padding:9px 11px;border-radius:9px;border:1px solid var(--bd2);background:var(--s1);color:var(--tx);font-family:var(--fn);font-size:13px}
.cr-form input:focus,.cr-form select:focus{outline:none;border-color:var(--bl)}
.cr-form-hint{font-size:11px;color:var(--tx3);line-height:1.5}
.cr-msg{padding:8px 12px;border-radius:9px;font-size:12px;line-height:1.45;background:var(--s1);border:1px solid var(--bd);color:var(--tx2)}
.cr-msg.warn{border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.08);color:#fde68a}
.cr-msg.error{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#fca5a5}
.cr-msg.ok{border-color:rgba(194,239,78,.35);background:rgba(194,239,78,.08);color:#d9f99d}
.cr-divider{height:1px;background:var(--bd);margin:8px 0}
.cr-tag{display:inline-block;padding:2px 8px;border-radius:6px;background:rgba(106,95,193,.15);color:var(--bl);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-left:6px}
.cr-scroll{max-height:300px;overflow-y:auto}
@media(max-width:600px){.cr-totals{grid-template-columns:repeat(2,1fr)}.cr-row{grid-template-columns:1fr}}
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6a5fc1,#422082);display:flex;align-items:center;justify-content:center;font-size:15px">&#128274;</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--tx);font-family:var(--fn-display);letter-spacing:-.2px">Executive Reports</div>
        <div style="font-size:11.5px;color:var(--tx3);margin-top:2px">Pick a date and (optionally) a person, then tap a report below. All reports export to WhatsApp in one tap.</div>
      </div>
    </div>
    <div class="exec-filters">
      <div class="exec-filter">
        <div class="exec-filter-lbl">&#128197; Pick a date</div>
        <div class="exec-filter-row">
          <input type="date" id="report-date" class="exec-input" aria-label="Report date" onchange="onReportDateChange()" oninput="onReportDateChange()">
          <button type="button" class="exec-chip" onclick="resetReportDate()">Today</button>
        </div>
        <div class="exec-filter-hint">Reports open for this date. Leave empty for today.</div>
      </div>
      <div class="exec-filter">
        <div class="exec-filter-lbl">&#128197; Pick a month</div>
        <div class="exec-filter-row">
          <input type="month" id="report-month" class="exec-input" aria-label="Report month" onchange="onReportMonthChange()" oninput="onReportMonthChange()">
          <button type="button" class="exec-chip" onclick="resetReportMonth()">This month</button>
        </div>
        <div class="exec-filter-hint">Scope every report (and the dashboard) to that month. Leave empty for today.</div>
      </div>
      <div class="exec-filter">
        <div class="exec-filter-lbl">&#128100; Pick a person</div>
        <div class="exec-filter-row">
          <select id="employee-day-select" class="exec-input" style="max-width:240px" aria-label="Employee">
            <option value="">Loading names\u2026</option>
          </select>
          <button type="button" class="exec-chip exec-chip-primary" onclick="openSelectedEmployeeDay()">&#128269; Show their day</button>
        </div>
        <div class="exec-filter-hint">See what that person did on the picked date (or today).</div>
      </div>
    </div>
    <div class="exec-reports">
      <button class="rep-btn" onclick="openReport('daily')"><span style="font-size:14px">&#128467;</span><span>Daily</span></button>
      <button class="rep-btn" onclick="openReport('weekly')"><span style="font-size:14px">&#128196;</span><span>Weekly</span></button>
      <button class="rep-btn" onclick="openReport('monthly')"><span style="font-size:14px">&#128202;</span><span>Monthly</span></button>
      <button class="rep-btn" onclick="openReport('yearly')"><span style="font-size:14px">&#128200;</span><span>Yearly</span></button>
      <button class="rep-btn" id="cr-open" onclick="openCheckReport()" style="background:linear-gradient(135deg,#6a5fc1,#422082);border-color:rgba(167,139,250,.55)" title="Check Delivery Report — overall delivery summary by factory"><span style="font-size:14px">&#128230;</span><span>Check Delivery</span></button>
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
      <div style="display:flex;flex-wrap:wrap;gap:8px;position:relative">
        <div style="flex:1;min-width:160px;position:relative">
          <input id="trace-q" type="text" placeholder="e.g. AB-0041 or paste an abaya id" autocomplete="off" spellcheck="false" style="width:100%;padding:10px 12px;border-radius:10px;background:var(--s2);border:1px solid var(--bd);color:var(--tx);font-size:13px" />
          <div id="trace-dd" role="listbox" aria-label="Garment trace suggestions" style="position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;background:var(--s1);border:1px solid var(--bd2);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);max-height:340px;overflow-y:auto;display:none"></div>
        </div>
        <button class="rep-btn" type="button" onclick="runGarmentTrace()">&#128269; Trace garment</button>
      </div>
    </div>
  </div>

  <div class="stat-row">
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="completed">Completed Today</div><div class="stat-val" id="kpi-completed" style="color:var(--gr)">—</div><div class="stat-sub">steps completed</div></div>
    <div class="stat-card" title="Distinct abayas that touched the line in this window. Different from 'Completed Today' which counts every finished session: one abaya that went through Tailor (01) + Button + Hand Work + Tailor (02) = 1 abaya here, 4 in Completed Today."><div class="stat-lbl" data-kpi-label="abayas-delivered">Abayas Delivered</div><div class="stat-val" id="kpi-abayas-delivered" style="color:var(--pu)">—</div><div class="stat-sub">distinct garments</div></div>
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="active">Active Workers</div><div class="stat-val" id="kpi-active" style="color:var(--bl)">—</div><div class="stat-sub">on floor now</div></div>
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="avg" title="Median of all finished sessions today. Closer to a real per-step cycle time than the mean, which is inflated by forgotten-Finish sessions (workers who tap Start and walk away).">Avg Session Time</div><div class="stat-val" id="kpi-avg" style="color:var(--am)">—</div><div class="stat-sub">median per finished step today</div></div>
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="eff">Efficiency Score</div><div class="stat-val" id="kpi-eff">—</div><div class="stat-sub">vs 45-min target</div></div>
  </div>

  <div class="dash-row">
    <div class="dash-card">
      <div class="dash-card-title">&#9201; Live Active Sessions</div>
      <div id="live-sessions"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No active sessions</div></div>
    </div>
    <div class="dash-card">
      <div class="dash-card-title" data-kpi-label="procsplit">Process Split Today</div>
      <div id="proc-split"><div style="color:var(--tx3);font-size:12px;padding:10px">No data</div></div>
    </div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="dash-card-title" style="margin:0" data-kpi-label="empperf">Employee Performance — Today</div>
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
    <div id="month-nav-host" style="display:none"></div>
    <div style="font-size:19px;font-weight:700;margin-bottom:4px" id="modal-title">Report</div>
    <div style="font-size:12px;color:var(--tx2);margin-bottom:16px" id="modal-ts"></div>
    <div id="modal-body"></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn-export" onclick="exportWA()">&#128241; Send via WhatsApp</button>
      <button class="btn-close" onclick="closeModal()">Close</button>
    </div>
  </div>
</div>

<!-- SINGULAR EMPLOYEE DAY MODAL (coherent with Check Delivery Report design system) -->
<div class="modal-overlay" id="modal-ed" role="dialog" aria-modal="true" aria-labelledby="ed-title">
  <div class="modal-box" style="max-width:780px">
    <div class="modal-title" id="ed-title">Employee day</div>
    <div class="modal-sub" id="ed-sub">What this person did on the picked date, in order.</div>
    <div id="ed-body" class="cr-wrap"></div>
    <div class="modal-actions" id="ed-actions">
      <button class="btn-close" onclick="closeEmployeeDay()">Close</button>
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
  factory_today:'', completed_today:0, avg_cycle_sec_today:0, median_session_sec_today:0, efficiency_today:0,
  process_split_today:{},
  hourly_today:{},
  garment_totals_today:[],
  abaya_lifetime:{},
  abaya_builds:{},
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
  // Cloudflare's Git integration briefly returns 503 to in-flight requests
  // during a Worker version swap (typical 5-10s, occasionally up to ~30s).
  // The previous default of 3 retries with 1+2s backoff only covered ~3s
  // of that window -- any deploy longer than that surfaced 503s in the
  // dashboard's network panel. Bump to 5 retries with 1+2+4+8s backoff
  // (15s total retry budget) so a typical Cloudflare deploy is invisible
  // to the polling client.
  maxRetries = maxRetries == null ? 5 : maxRetries;
  init = init || {};
  var lastErr;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var opts = { credentials: 'same-origin' };
      for (var k in init) {
        if (Object.prototype.hasOwnProperty.call(init, k) && k !== 'signal') opts[k] = init[k];
      }
      opts.signal = timeoutSignal(15000);
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
    // When the CEO picks a date or a month in the Executive Reports
    // filters, the entire dashboard flips to that range — Completed,
    // Active Workers, Process Split, Employee Performance, Garment
    // Totals, Recent Invoice Logs. Without this, those cards kept
    // showing today even when the user had clearly asked for a past
    // period. Day picker wins over month picker (more specific).
    const rangeQs = getPickedRangeQs();
    const url =
      BASE + '/api/state?ts=' + Date.now() + '&r=' + Math.random().toString(36).slice(2, 10) + rangeQs;
    const r = await fetchWithRetry(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    try { console.log('[ceo-poll] status=' + r.status + ' url=' + url); } catch (_) {}
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
      // Pulse the .dash opacity so the innerHTML swap in renderAll()
      // doesn't look like the previous data vanished. See the .is-syncing
      // CSS rule for the transition. Two rAFs: the first lets the browser
      // paint the dimmed state, the second lets it paint the new content
      // before restoring opacity.
      var dashEl = document.querySelector('.dash');
      if (dashEl) dashEl.classList.add('is-syncing');
      await new Promise(function (r) { requestAnimationFrame(r); });
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
      if (dashEl) {
        await new Promise(function (r) { requestAnimationFrame(r); });
        dashEl.classList.remove('is-syncing');
      }
      if (syncEl && renderOk) {
        const lagMs = Number(d.ingest_lag_ms || 0);
        // Format lag as a human phrase so "4h of no events" doesn't look like
        // a system failure — it usually means the factory is between shifts.
        const lagMode = (d.state_meta && d.state_meta.lag_mode) || 'unknown';
        const lagLabel = {
          hot: 'live',
          warm: 'paused',
          idle: 'idle',
          stale: 'stale',
          'no-data': 'no data',
        }[lagMode] || 'live';
        let lagText = ' · ' + lagLabel;
        if (lagMode === 'hot' && Number.isFinite(lagMs)) {
          lagText = ' · ' + Math.round(lagMs / 1000) + 's';
        } else if (Number.isFinite(lagMs)) {
          // Idle/stale: show only the friendly word, not a giant seconds number.
          lagText = ' · ' + lagLabel;
        }
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
    try { console.error('[ceo-poll] threw:', e); } catch (_) {}
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

// Compact "12h 4m" / "1h 22m" / "45m" / "12s" for tight cells. Drops
// the seconds component when the hours or minutes are already shown.
function fmtShortHMS(sec) {
  const n = Math.floor(Number(sec) || 0);
  if (n < 1) return '0m';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h > 0 && m > 0) return h + 'h ' + m + 'm';
  if (h > 0) return h + 'h';
  if (m > 0) return m + 'm';
  return n + 's';
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
  // No regex literal — wrangler's minifier strips backslashes from
  // /\d/ → /d/ which throws SyntaxError on every page load. Do the
  // HH:MM check with raw string ops instead.
  const t = String(s == null ? '' : s).trim();
  if (t.length !== 5 || t.charAt(2) !== ':') return null;
  const h0 = t.charAt(0);
  const h1 = t.charAt(1);
  const m0 = t.charAt(3);
  const m1 = t.charAt(4);
  if (h0 < '0' || h0 > '9' || h1 < '0' || h1 > '9') return null;
  if (m0 < '0' || m0 > '5' || m1 < '0' || m1 > '9') return null;
  let h = (h0.charCodeAt(0) - 48) * 10 + (h1.charCodeAt(0) - 48);
  let mm = (m0.charCodeAt(0) - 48) * 10 + (m1.charCodeAt(0) - 48);
  // Hour must be 0–23. 0[0-9], 1[0-9], 2[0-3] are valid; 2[4-9] is not.
  if (h0 === '2' && h1 > '3') return null;
  if (h > 23) return null;
  if (mm > 59) return null;
  return h * 60 + mm;
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

// Inline-JS literal escaper for HTML attributes like
//   onclick="openEmployeeDayForDate('e16', '2026-07-18')"
// Wraps the value in single quotes and escapes the single quote.
// The values we pass (emp_id, day_date) never contain backslashes
// in practice, so we don't need to escape that one — which avoids
// the regex-literal-vs-template-literal escape fight (this is the
// same gotcha that bit the WhatsApp newline fix in v1.2.8).
function escJs(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "\\'") + "'";
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

// Per-build (current contiguous run) total for an abaya, from
// STATE.abaya_builds. The build is the most recent run of sessions on
// the same abaya_id where a 24h+ gap between consecutive sessions
// defines a build boundary. This is what the operator means by "this
// build" -- e.g. CF111 STD-O build #2 -- and is computed server-side
// from the sessions table (source of truth, no double-count bug).
// Falls back to 0 if the build map has no row for this abaya_id.
function abayaBuildSec(abayaId) {
  const sid = String(abayaId || '');
  const map = (STATE && STATE.abaya_builds) || {};
  const row = map[sid];
  if (!row) return 0;
  return Math.floor(Number(row.total_in_window_sec) || 0);
}

// Build start for an abaya, as a Unix seconds timestamp, or 0 if the
// build map has no row. Used for the "build started YYYY-MM-DD" caption
// on the Live row.
function abayaBuildStartUnix(abayaId) {
  const sid = String(abayaId || '');
  const map = (STATE && STATE.abaya_builds) || {};
  const row = map[sid];
  if (!row) return 0;
  return Math.floor(Number(row.build_start_unix) || 0);
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
    // The catalog is ~558 KB and changes rarely. The Worker already sends
    // Cache-Control public, max-age=10, stale-while-revalidate=120, so let the
    // browser honour it -- no-store was forcing a full re-download on every load
    // (measured 2.5-4.0s). Freshness is unchanged: edits still appear within ~10s.
    const r = await fetchWithRetry(BASE + '/api/catalog/abayas');
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
      // "This build" = total in-window shift seconds on this abaya within
      // the current contiguous build window (24h-gap rule), plus the in-
      // shift seconds we've added this snapshot that aren't yet flushed to
      // D1. Computed server-side from the sessions table -- same source
      // the daily/weekly/monthly/yearly reports use for their per-day
      // totals, just windowed by contiguity instead of by calendar day.
      // Multi-day abaya builds are valid -- never auto-close a session
      // that started days ago.
      const buildSec = abayaBuildSec(s.abaya_id);
      const liveAddedThisSnapshot = activeSecondsOnGarment(s.abaya_id);
      const buildStartUnix = abayaBuildStartUnix(s.abaya_id);
      const totalItem = buildSec + liveAddedThisSnapshot;
      // All time numbers on the Live row are in-window only. Outside-shift
      // time (nights, weekends, lunch breaks) is not labor cost and must
      // not be added to the per-shift or per-build totals. The 'wall'
      // line that previously sat here was deleted because it counted
      // outside-shift time by definition -- e.g. a worker who tapped
      // Start on Aug 20 and is still on it would show 'wall 73h' even
      // though only 26h of that was actual factory time. The forgotten-
      // Finish signal now lives in the Stuck badge below: fires when
      // the session has been open >2h AND we are currently outside
      // the working window (i.e. the shift ended and nobody hit Finish).

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
      const ageSec = Math.max(0, nowSecLive - startedAtSec);
      // is_stale requires the row to be cross-day, >2h wall-clock, AND
      // currently outside a shift window. Same-day sessions in a short
      // break (lunch, evening gap) are NOT stuck — the worker is just on
      // a break. Only forgotten-Finish rows that crossed midnight get the
      // badge. Mirrors the local rule in shared/live-row-state.cjs.
      // Prefer the s.is_stale field the cloud re-walked, fall back to
      // recompute for legacy rows.
      const isCrossDay = s.is_cross_day === true || s.is_cross_day === 1;
      const stale = (s.is_stale === true || s.is_stale === 1)
        ? true
        : (isCrossDay && ageSec > 2 * 3600 && !inShiftNowLive);
      // Only show "Outside shift" when the session is not also stuck.
      // Stuck already tells the operator the worker is outside shift AND
      // has been for >2h, so adding "Outside shift" on top is just
      // visual noise (the row used to read "Outside shift | Stuck" on
      // every forgotten-Finish session). For a fresh session that
      // happens to straddle the shift boundary, "Outside shift" alone
      // still makes sense and is shown.
      const outOfShift = !inShiftNowLive || !inWindowClient(startedAtSec);
      const outsideBadge = (outOfShift && !stale)
        ? ' <span title="Time outside shift windows is not counted in the per-shift or per-build totals." style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#fcd34d;background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);border-radius:8px;padding:1px 6px">Outside shift</span>'
        : '';
      // Stuck = session has been open >2h AND we are currently outside
      // the working window. A worker who finished their shift and
      // walked away without tapping Finish leaves the session open
      // through the entire factory-closed period. The badge is the
      // operator's cue to ping the worker (or close the session from
      // the manager UI). Kept as a label, not a number, because the
      // operator doesn't need to see the raw '47h since Start' -- they
      // just need to know it was forgotten. (ageSec and stale computed
      // above so we can suppress the redundant "Outside shift" badge.)
      const staleBadge = stale
        ? ' <span title="Session has been open more than 2 hours and the factory is currently outside the working window. Likely a forgotten-Finish -- check the station and either Finish the session or have the worker re-tap Start." style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#fca5a5;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);border-radius:8px;padding:1px 6px">Stuck</span>'
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
        staleBadge +
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
        // Exact last-finish time for this worker (the most recent COMPLETED
        // session for this emp_id from D1). Rendered in the factory's working-
        // hours timezone so the operator sees a wall-clock they recognise.
        // Replaces the previous "this step (in shift)" live counter, which
        // didn't add useful signal: the live row already has Started + this
        // build, and operators said the live ticking was distracting.
        (function () {
          const lf = Number(s.last_finish_at_ms) || 0;
          if (!lf) {
            return '<div style="font-size:14px;font-weight:700;color:var(--tx3);font-variant-numeric:tabular-nums;line-height:1.25">—</div>' +
              '<div style="font-size:9px;color:var(--tx3)">last finished</div>';
          }
          const t = new Date(lf).toLocaleTimeString([], {
            timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
          });
          const d = new Date(lf).toLocaleDateString([], {
            timeZone: tz, day: '2-digit', month: 'short',
          });
          return '<div title="Exact moment the worker last tapped Finish on this abaya (most recent ended_at for this emp_id in the D1 sessions table). Shown instead of a live counter so the operator can see at a glance when the previous session closed." style="font-size:14px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.25">' + esc(t) + '</div>' +
            '<div style="font-size:9px;color:var(--tx3)">last finished &middot; ' + esc(d) + '</div>';
        })() +
        // Wall-clock AGE of the current build (24h-gap rule). Replaces the
        // previous "in-window shift seconds" cell — operators want the
        // calendar answer for "how old is this build" (e.g. "40h 30m 24s
        // for the abaya that's been on the floor since Aug 26"). The
        // server sends buildStartUnix (seconds) per active row, so this
        // is wall-clock NOW - buildStartUnix, no shift-window walk. Ticks
        // live on every poll. The in-shift number still lives on the
        // Daily/Weekly/Monthly/Yearly reports and the per-abaya totals
        // panel for productivity calculations.
        (function () {
          const buildTitle = 'Wall-clock age of the current build, counted from its first session (24h-gap rule). Not capped to shift windows and not the per-session timer. The in-shift working time is on the Daily / Weekly / Monthly / Yearly reports.';
          if (!buildStartUnix || buildStartUnix <= 0) {
            return '<div title="' + buildTitle + '" style="font-size:14px;font-weight:700;color:var(--am);margin-top:6px;font-variant-numeric:tabular-nums;line-height:1.25">—</div>' +
              '<div style="font-size:9px;color:var(--tx3)">this build</div>';
          }
          const ageSec = Math.max(0, Math.floor((Date.now() / 1000) - buildStartUnix));
          return '<div title="' + buildTitle + '" style="font-size:14px;font-weight:700;color:var(--am);margin-top:6px;cursor:help;font-variant-numeric:tabular-nums;line-height:1.25">' + esc(fmtHMS(ageSec)) + '</div>' +
            '<div style="font-size:9px;color:var(--tx3)">this build &middot; started ' + esc(new Date(buildStartUnix * 1000).toLocaleDateString([], { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit' })) + '</div>';
        })() +
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

/** Show a non-blocking error banner at the top of the body so render failures
 *  are visible without forcing the user to open devtools. Keeps the rest of
 *  the page renderable. */
function showRenderError(stage, err) {
  try {
    var msg = (err && (err.message || err.stack)) ? String(err.message || err.stack) : String(err || 'unknown');
    if (msg.length > 240) msg = msg.slice(0, 240) + '\u2026';
    var existing = document.getElementById('render-error-banner');
    var body = '<div style="font-family:var(--fn-mono);font-size:11.5px;line-height:1.5;white-space:pre-wrap;margin-top:6px">' +
      'Stage: ' + String(stage || '?') + '<br>' +
      msg + '</div>' +
      '<div style="margin-top:8px;font-size:10.5px;opacity:.7">Hard-refresh (Ctrl+Shift+R) if this keeps appearing. The dashboard above is still live; only this section failed to render.</div>';
    if (existing) {
      existing.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
        '<div style="flex:1"><b>\u26A0 Render hiccup</b>' + body + '</div>' +
        '<button type="button" onclick="this.parentNode.parentNode.remove()" style="background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;line-height:1;padding:0 4px">\u00d7</button></div>';
      return;
    }
    var banner = document.createElement('div');
    banner.id = 'render-error-banner';
    banner.style.cssText = 'position:relative;margin:0 16px 14px;padding:14px 16px;border-radius:14px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.45);color:#ffd6d6;font-size:12.5px';
    banner.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
      '<div style="flex:1"><b>\u26A0 Render hiccup</b>' + body + '</div>' +
      '<button type="button" onclick="this.parentNode.parentNode.remove()" style="background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;line-height:1;padding:0 4px">\u00d7</button></div>';
    var dash = document.querySelector('.dash');
    if (dash && dash.parentNode) dash.parentNode.insertBefore(banner, dash.nextSibling);
    else document.body.appendChild(banner);
  } catch (_) { /* never let the banner itself break the page */ }
}

/** Run a render step; if it throws, surface the error and keep going so
 *  the rest of the page still updates. */
function safeRender(stage, fn) {
  try { fn(); }
  catch (e) {
    console.error('[ceo-dashboard] renderAll step failed:', stage, e);
    showRenderError(stage, e);
  }
}

function renderAll() {
  const active = STATE.active || {};
  const perf = STATE.perf || [];
  const activeIds = Object.keys(active);

  safeRender('kpi', function () {
    const completed = Number(STATE.completed_today) || 0;
    const kpiCompleted = byId('kpi-completed', 'kpi-done');
    const kpiAbayasDelivered = byId('kpi-abayas-delivered');
    const kpiActive = byId('kpi-active');
    const kpiAvg = byId('kpi-avg');
    const kpiEff = byId('kpi-eff');
    if (kpiCompleted) kpiCompleted.textContent = completed;
    // Distinct abayas delivered in this window. Same anchor as Completed
    // Today (kpi_anchor_ymd -> kpi_to_ymd) so the two KPIs are
    // always comparable. Hides on a picked day/month where STATE has
    // not yet been re-polled (worker-stale 0 fallback would confuse
    // the operator -- "why 0?"). Once STATE arrives, render normally.
    const abayasDelivered = Number(STATE.abayas_delivered_today) || 0;
    if (kpiAbayasDelivered) kpiAbayasDelivered.textContent = abayasDelivered;
    // Active Workers stays the live count regardless of picked date or
    // month — a past period has nobody currently on the floor. Hide it
    // when the user is looking at a historical period so the dashboard
    // doesn't show 0 and confuse the operator.
    const picked = getPickedReportDate() || getPickedReportMonth();
    const isLive = !picked;
    if (kpiActive) {
      kpiActive.textContent = isLive ? activeIds.length : '\u2014';
      kpiActive.parentNode.style.opacity = isLive ? '1' : '0.45';
    }
    if (completed > 0) {
      // Prefer the median session time when available — it is not skewed
      // by forgotten-Finish sessions. Fall back to the mean for the first
      // paint before the worker pushes any sessions.
      const median = Number(STATE.median_session_sec_today) || 0;
      const mean = Number(STATE.avg_cycle_sec_today) || 0;
      const display = median > 0 ? median : mean;
      if (kpiAvg) kpiAvg.textContent = fmtHMS(display);
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
  });

  safeRender('header', function () {
    const ft = STATE.factory_today || '';
    const picked = getPickedReportDate();
    const pickedMo = getPickedReportMonth();
    const anchor = (STATE.kpi_anchor_ymd) || ft;
    const dd = document.getElementById('dash-date');
    if (dd) {
      let head = '';
      if (picked) {
        head = 'Showing picked date ' + picked + ' (factory today is ' + ft + ') \u2014 ';
      } else if (pickedMo) {
        head = 'Showing month ' + pickedMo + ' (factory today is ' + ft + ') \u2014 ';
      } else if (ft) {
        head = 'Factory day ' + ft + ' \u2014 ';
      }
      dd.textContent = head + new Date().toLocaleTimeString([], { timeZone: uiTz() });
    }
    // When a date is picked, the "Today" KPIs are no longer "Today" —
    // re-label them so the operator doesn't think they're still looking
    // at live data.
    const cardLabels = document.querySelectorAll('[data-kpi-label]');
    cardLabels.forEach(function (el) {
      const key = el.getAttribute('data-kpi-label');
      const baseText = el.getAttribute('data-kpi-base') || el.textContent;
      if (!el.getAttribute('data-kpi-base')) el.setAttribute('data-kpi-base', baseText);
      el.textContent = picked ? baseText.replace(/today/i, 'on ' + picked) : baseText;
    });
    const dn = document.getElementById('dubai-now');
    if (dn) dn.textContent = 'Dubai time: ' + uiNowString();
    const ws = document.getElementById('work-status');
    if (ws) ws.textContent = 'Status: ' + String(STATE.working_status || '--');
  });

  safeRender('live', renderLiveSessionsBlock);
  safeRender('abaya-totals', renderAbayaTotalsTable);

  safeRender('emp-perf', function () {
    const sorted = perf.slice().sort((a,b)=>b.units-a.units);
    const maxU = sorted.length ? sorted[0].units : 1;
    const topN = Math.max(1, Math.ceil(sorted.length*0.2));
    const ep = document.getElementById('emp-perf');
    if (!ep) return;
    ep.innerHTML = sorted.length === 0
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
  });

  safeRender('proc-split', function () {
    const split = STATE.process_split_today || {};
    const total = WORK_TYPES_ORDER.reduce(function(s,t){ return s + (Number(split[t])||0); }, 0) || 1;
    const ps = document.getElementById('proc-split');
    if (!ps) return;
    ps.innerHTML = WORK_TYPES_ORDER.map(function(p){
      var v = Number(split[p])||0;
      var pct = Math.round((v/total)*100);
      var col = procColorUI(p);
      return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="font-weight:600">'+p+'</span><span style="color:'+col+';font-weight:700">'+v+' units ('+pct+'%)</span></div>' +
        '<div style="height:5px;background:var(--s3);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:3px;transition:width .5s"></div></div></div>';
    }).join('');
  });

  safeRender('hourly', function () {
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
    const hMax = Math.max.apply(null, hVals.concat([1]));
    const ho = document.getElementById('hourly');
    if (ho) ho.innerHTML = Object.entries(hours).map(function (kv) {
      var h = kv[0], v = kv[1];
      const ht = Math.max(4, Math.round((v/hMax)*68));
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">' +
        '<div style="font-size:9px;color:var(--tx3)">'+(v||'')+'</div>' +
        '<div style="width:100%;height:'+ht+'px;background:linear-gradient(180deg,var(--bl),var(--pu));border-radius:3px 3px 0 0;opacity:'+(v?1:0.12)+'"></div></div>';
    }).join('');
    const hl = document.getElementById('hlbl');
    if (hl) hl.innerHTML = Object.keys(hours).map(h=>'<div style="flex:1;font-size:8px;color:var(--tx3);text-align:center">'+h+'</div>').join('');
  });

  safeRender('recent-invoice-logs', renderRecentInvoiceLogs);
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
    // When the CEO picked a date or a month, the analytics modal scopes
    // to that range instead of the period-anchored-at-today default.
    // This way picking Aug 17 from the date picker shows the Aug 17
    // process breakdown, and picking "2026-08" from the month picker
    // shows the whole month's process breakdown.
    const rangeQs = getPickedRangeQs();
    const r = await fetchWithRetry(
      BASE + '/api/analytics?period=' + encodeURIComponent(period) + '&local_today=' + encodeURIComponent(localYmdNow()) + rangeQs + '&ts=' + Date.now(),
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
    if (inp) inp.focus();
    return;
  }
  lastModalAnalytics = null;
  lastReportData = null;
  document.getElementById('modal-title').textContent = 'Garment trace';
  document.getElementById('modal-ts').textContent = 'Loading\u2026';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');
  hideTraceDropdown();
  try {
    const r = await fetchWithRetry(
      BASE + '/api/trace?q=' + encodeURIComponent(q) + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Not found');
    lastModalTrace = d;
    // Remember the pick for the next time the dropdown opens.
    recordRecentTrace(String(d.abaya_code || d.abaya_id || q), d);
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

// ─── TRACE COMBOBOX (autocomplete + bloom + recents) ────────────────────────────
// Catalog is loaded once, kept warm in memory, and indexed with a tiny
// bloom filter so even a 5k-item catalog filters in O(n) with no false
// negatives and a low false-positive rate.
let traceCatalog = [];           // [{code, barcode, design, process, icon, id}]
let traceCatalogLoadedAt = 0;
let traceBloom = null;            // {bits: Uint8Array, k: number, m: number}
const TRACE_BLOOM_M = 8192;      // 8 KB, plenty for 5k items
const TRACE_BLOOM_K = 3;
const TRACE_RECENTS_KEY = 'abaya.trace.recents.v1';
const TRACE_RECENTS_MAX = 5;

function traceBloomHas(token) {
  if (!traceBloom) return true; // pre-load fallback: assume yes
  const { bits, m, k } = traceBloom;
  const h = traceHash32(token);
  for (let i = 0; i < k; i++) {
    const bit = ((h >>> i) ^ (h * (i + 1))) & (m - 1);
    if (!bits[bit >>> 3] || !((bits[bit >>> 3] >> (bit & 7)) & 1)) return false;
  }
  return true;
}
function traceBloomAdd(token) {
  if (!token) return;
  if (!traceBloom) {
    traceBloom = { bits: new Uint8Array(TRACE_BLOOM_M >>> 3), m: TRACE_BLOOM_M, k: TRACE_BLOOM_K };
  }
  const { bits, m, k } = traceBloom;
  const h = traceHash32(token);
  for (let i = 0; i < k; i++) {
    const bit = ((h >>> i) ^ (h * (i + 1))) & (m - 1);
    bits[bit >>> 3] |= 1 << (bit & 7);
  }
}
// Tiny FNV-1a-style 32-bit hash — fast and good enough for bloom.
function traceHash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

async function loadTraceCatalog(force) {
  const now = Date.now();
  if (!force && traceCatalog.length && now - traceCatalogLoadedAt < 60_000) {
    return traceCatalog;
  }
  try {
    const r = await fetchWithRetry(BASE + '/api/catalog/abayas?ts=' + Date.now(), { cache: 'no-store' });
    const d = await r.json();
    const list = (d && d.abayas) || [];
    traceCatalog = list.map(function (a) {
      return {
        code: String(a.code || ''),
        barcode: String(a.barcode || ''),
        design: String(a.design || ''),
        process: String(a.process || ''),
        icon: String(a.icon || ''),
        id: a.id != null ? String(a.id) : '',
      };
    });
    traceCatalogLoadedAt = now;
    traceBloom = null;
    for (let i = 0; i < traceCatalog.length; i++) {
      const a = traceCatalog[i];
      traceBloomAdd(a.code);
      traceBloomAdd(a.barcode);
      traceBloomAdd(a.id);
    }
  } catch (_) {
    // keep what we had
  }
  return traceCatalog;
}

function getTraceRecents() {
  try {
    const raw = localStorage.getItem(TRACE_RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, TRACE_RECENTS_MAX) : [];
  } catch (_) {
    return [];
  }
}
function saveTraceRecents(list) {
  try {
    localStorage.setItem(TRACE_RECENTS_KEY, JSON.stringify(list.slice(0, TRACE_RECENTS_MAX)));
  } catch (_) {}
}
function recordRecentTrace(label, data) {
  if (!label) return;
  const entry = {
    label: String(label),
    abaya_id: data && data.abaya_id != null ? String(data.abaya_id) : '',
    at: Date.now(),
  };
  const cur = getTraceRecents().filter(function (r) { return r.label !== entry.label; });
  cur.unshift(entry);
  saveTraceRecents(cur);
}

// Score a catalog row against the query. Lower = better. -1 = no match.
function traceScore(item, q) {
  if (!q) return 999; // empty query: only recents
  const code = item.code.toLowerCase();
  const barcode = item.barcode.toLowerCase();
  const design = item.design.toLowerCase();
  const id = item.id.toLowerCase();
  if (code === q) return 0;
  if (barcode === q) return 1;
  if (id === q) return 2;
  if (code.startsWith(q)) return 10;
  if (barcode.startsWith(q)) return 11;
  if (id.startsWith(q)) return 12;
  if (code.indexOf(q) >= 0) return 30;
  if (barcode.indexOf(q) >= 0) return 31;
  if (design.indexOf(q) >= 0) return 50;
  return -1;
}

function traceMatchCatalog(q) {
  if (!q) return [];
  const ql = q.toLowerCase();
  // Bloom fast-path: only walk the catalog if the bloom says "maybe".
  if (traceBloom && !traceBloomHas(ql) && !traceBloomHas(q)) {
    return [];
  }
  const hits = [];
  for (let i = 0; i < traceCatalog.length; i++) {
    const s = traceScore(traceCatalog[i], ql);
    if (s >= 0) hits.push({ item: traceCatalog[i], score: s });
  }
  hits.sort(function (a, b) {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.code.localeCompare(b.item.code);
  });
  return hits.slice(0, 8).map(function (h) { return h.item; });
}

let traceActiveIndex = -1; // currently highlighted option in dropdown
let traceOptions = [];     // current items shown (mix of recents + catalog hits)

function hideTraceDropdown() {
  const dd = document.getElementById('trace-dd');
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
  traceActiveIndex = -1;
  traceOptions = [];
}

function renderTraceDropdown() {
  const dd = document.getElementById('trace-dd');
  if (!dd) return;
  if (!traceOptions.length) { hideTraceDropdown(); return; }
  const ql = String(document.getElementById('trace-q').value || '').trim().toLowerCase();
  const headerHtml = (ql ? '<div class="trace-dd-h">Catalog matches</div>' : '<div class="trace-dd-h">Recent traces</div>');
  const rows = traceOptions.map(function (it, i) {
    const isActive = i === traceActiveIndex;
    const swatch = it.icon
      ? '<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:' + esc(it.icon) + ';margin-right:8px;vertical-align:middle;border:1px solid rgba(255,255,255,.12)"></span>'
      : '<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:rgba(124,111,224,.18);margin-right:8px;vertical-align:middle"></span>';
    return '<div class="trace-dd-row' + (isActive ? ' trace-dd-active' : '') + '" role="option" data-i="' + i + '" data-label="' + esc(it.label) + '">' +
      swatch +
      '<span class="trace-dd-code">' + esc(it.label) + '</span>' +
      (it.sub ? '<span class="trace-dd-sub">' + esc(it.sub) + '</span>' : '') +
      '</div>';
  }).join('');
  dd.innerHTML = headerHtml + rows;
  dd.style.display = 'block';
  // Delegated click
  dd.onclick = function (ev) {
    const row = ev.target.closest && ev.target.closest('.trace-dd-row');
    if (!row) return;
    const idx = Number(row.getAttribute('data-i'));
    if (traceOptions[idx]) pickTraceOption(traceOptions[idx]);
  };
}

function pickTraceOption(opt) {
  const inp = document.getElementById('trace-q');
  if (inp) {
    inp.value = opt.label;
    inp.focus();
  }
  hideTraceDropdown();
  runGarmentTrace();
}

function openTraceDropdown() {
  const inp = document.getElementById('trace-q');
  if (!inp) return;
  const q = inp.value.trim();
  if (!q) {
    // Empty: show recents
    const recents = getTraceRecents();
    traceOptions = recents.map(function (r) {
      return { label: r.label, sub: r.abaya_id && r.abaya_id !== r.label ? ('id ' + r.abaya_id) : '' };
    });
  } else {
    const hits = traceMatchCatalog(q);
    traceOptions = hits.map(function (a) {
      return {
        label: a.code || a.barcode || a.id,
        sub: (a.design ? a.design + ' \u00b7 ' : '') + (a.process || ''),
      };
    });
  }
  traceActiveIndex = traceOptions.length ? 0 : -1;
  renderTraceDropdown();
}

function moveTraceActive(delta) {
  if (!traceOptions.length) return;
  traceActiveIndex = (traceActiveIndex + delta + traceOptions.length) % traceOptions.length;
  renderTraceDropdown();
}

function wireTraceCombobox() {
  const inp = document.getElementById('trace-q');
  if (!inp || inp.__traceWired) return;
  inp.__traceWired = true;
  // Plain paste of digits = abaya_id; auto-trigger after a short debounce.
  let pasteTimer = null;
  inp.addEventListener('input', function () {
    if (pasteTimer) clearTimeout(pasteTimer);
    const v = inp.value.trim();
    // Open dropdown on any input (recents if empty, matches if not).
    openTraceDropdown();
    // Pure digits (3+ chars) on a fresh field = abaya_id, auto-search.
    // No /\d{3,}/ regex literal: wrangler's minifier strips the backslash
    // and ships /d{3,}/ which throws on every page load. Use a char loop.
    let _isPureDigits = v.length >= 3;
    if (_isPureDigits) {
      for (let _i = 0; _i < v.length; _i++) {
        const _c = v.charCodeAt(_i);
        if (_c < 48 || _c > 57) { _isPureDigits = false; break; }
      }
    }
    if (_isPureDigits) {
      pasteTimer = setTimeout(function () {
        if (inp.value.trim() === v) runGarmentTrace();
      }, 250);
    }
  });
  inp.addEventListener('focus', function () {
    loadTraceCatalog(false).then(openTraceDropdown);
  });
  inp.addEventListener('blur', function () {
    // Delay so a click on a dropdown row still fires.
    setTimeout(function () {
      if (!document.activeElement || !(document.activeElement.closest && document.activeElement.closest('#trace-dd'))) {
        hideTraceDropdown();
      }
    }, 120);
  });
  inp.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      if (traceOptions.length && traceActiveIndex >= 0) {
        ev.preventDefault();
        pickTraceOption(traceOptions[traceActiveIndex]);
        return;
      }
      ev.preventDefault();
      runGarmentTrace();
      return;
    }
    if (ev.key === 'Escape') { hideTraceDropdown(); inp.blur(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (!traceOptions.length) openTraceDropdown(); else moveTraceActive(1); return; }
    if (ev.key === 'ArrowUp')   { ev.preventDefault(); if (!traceOptions.length) openTraceDropdown(); else moveTraceActive(-1); return; }
  });
  // Eager load so the catalog is warm by the time the user clicks the field.
  loadTraceCatalog(false);
}
// Wire once on first module init (called from poll setup below).

// ─── REPORT MODAL ─────────────────────────────────────────────────────────────
function getPickedReportDate() {
  const el = document.getElementById('report-date');
  const v = el ? String(el.value || '').trim() : '';
  // No regex literal — wrangler's minifier strips backslashes from
  // /\d/ → /d/ which throws SyntaxError on every page load. <input
  // type="date">.value is always "YYYY-MM-DD" or "" so a 10-char
  // length + dash positions are sufficient.
  if (v.length !== 10) return '';
  if (v.charAt(4) !== '-' || v.charAt(7) !== '-') return '';
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = v.charAt(i);
    if (c < '0' || c > '9') return '';
  }
  return v;
}

function resetReportDate() {
  const el = document.getElementById('report-date');
  if (el) el.value = '';
  onReportDateChange();
}

/** YYYY-MM string the CEO picked in the "Pick a month" filter, or ''.
 *  Same "no regex literal" caveat as getPickedReportDate — wrangler's
 *  minifier strips backslashes from /\d/ -> /d/ and breaks every page load.
 *  Instead, hand-check the four-digit / two-digit shape with charCodeAt. */
function getPickedReportMonth() {
  const el = document.getElementById('report-month');
  const v = el ? String(el.value || '').trim() : '';
  if (v.length !== 7 || v.charCodeAt(4) !== 45) return '';
  // YYYY-MM with the dash at index 4 and 6 numeric digits elsewhere.
  for (let i = 0; i < 7; i++) {
    if (i === 4) continue;
    const c = v.charCodeAt(i);
    if (c < 48 || c > 57) return '';
  }
  const yy = Number(v.slice(0, 4));
  const mm = Number(v.slice(5, 7));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return '';
  return v;
}

/** Last day (YYYY-MM-DD) of the picked month, in UTC. The sessions table
 *  stores day_date as a UTC YYYY-MM-DD so month boundaries are stable. */
function pickedMonthEndYmd(monthYmd) {
  const y = Number(monthYmd.slice(0, 4));
  const m = Number(monthYmd.slice(5, 7));
  // day 0 of month (m+1) = last day of month m. JS month is 0-indexed.
  const last = new Date(Date.UTC(y, m, 0));
  const ly = last.getUTCFullYear();
  const lm = String(last.getUTCMonth() + 1).padStart(2, '0');
  const ld = String(last.getUTCDate()).padStart(2, '0');
  return ly + '-' + lm + '-' + ld;
}

/** First day (YYYY-MM-DD) of the picked month, UTC. */
function pickedMonthStartYmd(monthYmd) {
  return monthYmd.slice(0, 4) + '-' + monthYmd.slice(5, 7) + '-01';
}

// ─── MONTH NAVIGATOR (monthly report) ──────────────────────────────────────────
// Lets the CEO step through the last 12 months from inside the monthly
// report modal. The current dashboard "Pick a month" filter is the source
// of truth: the navigator just rewrites that input and re-runs the same
// report. The 12-month floor is a soft cap (user can still type a
// different month into the picker; arrows are only a quick nav).

/** YYYY-MM string of today, in local factory time. */
function currentMonthYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** YYYY-MM for delta months away from monthYmd (negative = back).
 *  Handles year wrap. No regex, no Date parsing — just integer math. */
function shiftMonthYmd(monthYmd, delta) {
  const y = Number(monthYmd.slice(0, 4));
  const m = Number(monthYmd.slice(5, 7));
  // JS Date trick: day-of-month-1 of (m-1 + delta) in year y, then read back.
  // Day-of-month-0 of next month is the last of the previous month, so day 0
  // of month 0 of next year is the last of December. We want the YYYY-MM
  // label, so just normalize (m-1)+delta then split back.
  const total = (y * 12) + (m - 1) + (Number(delta) || 0);
  const ny = Math.floor(total / 12);
  const nm = (total - (ny * 12)) + 1;
  return ny + '-' + String(nm).padStart(2, '0');
}

/** 12 months back from today, as YYYY-MM. Lower bound for the prev arrow. */
function monthNavFloor() {
  return shiftMonthYmd(currentMonthYmd(), -12);
}

function isAtFloor(monthYmd) {
  return monthYmd <= monthNavFloor();
}

function isAtCurrentMonth(monthYmd) {
  return monthYmd >= currentMonthYmd();
}

/** Human label for a YYYY-MM month, e.g. "Aug 2026". Uses the dashboard's
 *  UI timezone so the CEO sees the month as their factory sees it. */
function monthLabel(monthYmd) {
  const y = Number(monthYmd.slice(0, 4));
  const m = Number(monthYmd.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthYmd;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', year: 'numeric',
  });
}

/** Build the from/to range the dashboard / reports should be scoped to.
 *  Day picker wins when set (more specific). Otherwise month picker.
 *  Empty strings when neither is set (server uses today as anchor). */
function getPickedRangeQs() {
  const day = getPickedReportDate();
  if (day) return '&from=' + encodeURIComponent(day) + '&to=' + encodeURIComponent(day);
  const mo = getPickedReportMonth();
  if (mo) {
    return '&from=' + encodeURIComponent(pickedMonthStartYmd(mo)) +
      '&to=' + encodeURIComponent(pickedMonthEndYmd(mo));
  }
  return '';
}

function resetReportMonth() {
  const el = document.getElementById('report-month');
  if (el) el.value = '';
  onReportMonthChange();
}

/** The CEO picked (or cleared) a month in the Executive Reports month picker.
 *  Re-poll /api/state right away so the dashboard flips to that month. */
function onReportMonthChange() {
  try {
    if (typeof poll === 'function') {
      void poll(true);
    }
  } catch (_) {}
}

/** Step the dashboard month picker by delta months and reopen the
 *  currently-active monthly report. Clamped to [floor, current]. */
function stepMonth(delta) {
  // No day picker allowed — the navigator is only meaningful for the
  // month-scoped monthly report. If a day is set, jump to this month
  // (i.e. delta=0) and clear the day so the user actually gets a month
  // view of the report.
  if (getPickedReportDate()) {
    const dayEl = document.getElementById('report-date');
    if (dayEl) dayEl.value = '';
  }
  // Resolve the current target month: the picker value, or "this month".
  const cur = getPickedReportMonth() || currentMonthYmd();
  let next = shiftMonthYmd(cur, delta);
  if (next < monthNavFloor()) next = monthNavFloor();
  if (next > currentMonthYmd()) next = currentMonthYmd();
  const moEl = document.getElementById('report-month');
  if (moEl) moEl.value = next;
  onReportMonthChange();
  if (activeReportType === 'monthly') openReport('monthly');
}

window.stepMonth = stepMonth;

/** Render the month navigator into #month-nav-host.
 *  Cleared when the active report is not monthly, or when a day is picked. */
function renderMonthNav() {
  const host = document.getElementById('month-nav-host');
  if (!host) return;
  if (activeReportType !== 'monthly' || getPickedReportDate()) {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }
  const cur = getPickedReportMonth() || currentMonthYmd();
  const atFloor = isAtFloor(cur);
  const atTop = isAtCurrentMonth(cur);
  const lbl = monthLabel(cur);
  // Reuses the existing .cr-nav-btn style from the Check Delivery report —
  // same dark-purple palette so the new chrome looks native to the modal.
  // Disabled buttons get the existing :disabled { opacity: .4 } treatment.
  host.style.display = 'block';
  host.style.marginBottom = '8px';
  host.innerHTML =
    '<div class="cr-nav" style="flex-wrap:wrap">' +
      '<button type="button" class="cr-nav-btn"' + (atFloor ? ' disabled' : '') +
        ' onclick="stepMonth(-1)" title="Previous month" aria-label="Previous month">&larr; Prev</button>' +
      '<span class="cr-nav-btn" style="background:transparent;border-color:transparent;color:var(--tx);font-weight:700;cursor:default;min-width:120px;text-align:center">' +
        esc(lbl) +
      '</span>' +
      '<button type="button" class="cr-nav-btn"' + (atTop ? ' disabled' : '') +
        ' onclick="stepMonth(1)" title="Next month" aria-label="Next month">Next &rarr;</button>' +
      '<button type="button" class="cr-nav-btn" onclick="jumpToCurrentMonth()" title="Jump to current month">This month</button>' +
    '</div>';
}

/** One-tap reset to the current month. Same effect as clearing the picker
 *  + reopening, but the button is a discoverable shortcut inside the modal. */
function jumpToCurrentMonth() {
  const el = document.getElementById('report-month');
  if (el) el.value = currentMonthYmd();
  onReportMonthChange();
  if (activeReportType === 'monthly') openReport('monthly');
}
window.jumpToCurrentMonth = jumpToCurrentMonth;

/** The CEO picked (or cleared) a date in the Executive Reports date picker.
 *  Re-poll /api/state right away so the dashboard flips to that day. */
function onReportDateChange() {
  try {
    if (typeof poll === 'function') {
      void poll(true);
    }
  } catch (_) {}
}
window.onReportDateChange = onReportDateChange;
window.resetReportDate = resetReportDate;
window.onReportMonthChange = onReportMonthChange;
window.resetReportMonth = resetReportMonth;

/** Roster for the "Pick a person" dropdown — fetched once per page load. */
async function loadEmployeeDayOptions() {
  const sel = document.getElementById('employee-day-select');
  try {
    const r = await fetchWithRetry(BASE + '/api/employees?ts=' + Date.now(), { cache: 'no-store' });
    const data = await r.json();
    const list = (data && data.employees) || [];
    if (!sel) return;
    if (!list.length) {
      sel.innerHTML = '<option value="">No people found</option>';
      return;
    }
    sel.innerHTML =
      '<option value="">Choose a person...</option>' +
      list
        .map(function (e) {
          const label = String(e.name || e.id || '') + (e.process ? ' — ' + String(e.process) : '');
          return '<option value="' + encodeURIComponent(String(e.id || '')) + '">' + esc(label) + '</option>';
        })
        .join('');
  } catch (_) {
    if (sel) sel.innerHTML = '<option value="">Could not load names</option>';
  }
}

function openSelectedEmployeeDay() {
  const sel = document.getElementById('employee-day-select');
  const raw = sel ? String(sel.value || '') : '';
  if (!raw) {
    document.getElementById('ed-title').textContent = 'Pick a person first';
    document.getElementById('ed-sub').textContent = '';
    document.getElementById('ed-body').innerHTML =
      '<div class="cr-empty">Choose a name from "Pick a person", then tap Show their day.</div>';
    document.getElementById('ed-actions').innerHTML =
      '<button class="btn-close" onclick="closeEmployeeDay()">Close</button>';
    document.getElementById('modal-ed').classList.add('open');
    return;
  }
  openEmployeeDay(decodeURIComponent(raw));
}

/** Date the per-employee day view applies to: picked date, else the report's end date. */
function employeeDayAnchorYmd() {
  const picked = getPickedReportDate();
  if (picked) return picked;
  const p = lastReportData && lastReportData.period;
  return (p && p.end_date) || localYmdNow();
}

function closeEmployeeDay() {
  const m = document.getElementById('modal-ed');
  if (m) m.classList.remove('open');
}
window.closeEmployeeDay = closeEmployeeDay;

async function openEmployeeDay(empId, explicitDate) {
  const anchor = explicitDate || employeeDayAnchorYmd();
  const m = document.getElementById('modal-ed');
  if (m) m.classList.add('open');
  document.getElementById('ed-title').textContent = 'Employee day';
  document.getElementById('ed-sub').textContent = 'Loading ' + anchor + '...';
  document.getElementById('ed-body').innerHTML =
    '<div class="cr-empty">\u23F3 Loading\u2026</div>';
  document.getElementById('ed-actions').innerHTML =
    '<button class="btn-close" onclick="closeEmployeeDay()">Close</button>';
  try {
    const r = await fetchWithRetry(
      BASE + '/api/report/employee-day?emp_id=' + encodeURIComponent(empId) +
        '&date=' + encodeURIComponent(anchor) + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const data = await r.json();
    if (!data || data.ok === false) throw new Error((data && data.error) || 'load failed');
    renderEmployeeDay(data);
  } catch (e) {
    document.getElementById('ed-body').innerHTML =
      '<div class="cr-empty" style="color:var(--rd)">Could not load employee day: ' +
      esc(String((e && e.message) || e)) + '</div>';
  }
}

// Convenience: re-open the modal for a specific date. Wired into the
// "nearby dates" chips that appear when the picked date is empty so the
// CEO can jump straight to a real workday with one click.
function openEmployeeDayForDate(empId, dateYmd) {
  if (!empId || !dateYmd) return;
  return openEmployeeDay(String(empId), String(dateYmd));
}
window.openEmployeeDayForDate = openEmployeeDayForDate;

function edFmtRange(s) {
  // Always 12-hour with explicit AM/PM regardless of the browser's
  // locale. The previous { hour: '2-digit', minute: '2-digit' } call
  // inherited the locale's default and rendered as '19:34' on
  // en-GB and as '07:34 PM' on en-US, so the CEO saw mixed formats
  // depending on their OS. Pin it.
  const start = s.started_at
    ? new Date(Number(s.started_at) * 1000).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: uiTz(),
      })
    : '\u2014';
  const end = s.live
    ? 'now'
    : s.ended_at
      ? new Date(Number(s.ended_at) * 1000).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: uiTz(),
        })
      : '\u2014';
  return start + ' \u2013 ' + end;
}

function renderEmployeeDay(data) {
  const emp = data.emp || {};
  const t = data.totals || {};
  const name = emp.name || emp.id || 'Employee';
  const date = String(data.date || '');
  document.getElementById('ed-title').textContent = name + (date ? ' \u2014 ' + date : '');
  document.getElementById('ed-sub').textContent =
    (emp.process ? emp.process + ' \u00b7 ' : '') +
    'What ' + name + ' did on this date, in order. Generated: ' +
    new Date().toLocaleString([], { timeZone: uiTz() });

  // Stat cards (same cr-totals / cr-tot pattern as Check Delivery Report)
  // Work time = completed-only by default; if the live session has accrued
  // time and there are 0 completed units today, the live overlap is rolled
  // in so the card doesn't read 0s when the employee is clearly working.
  const workTimeSec = (t.units || 0) > 0
    ? Number(t.active_time_sec || 0)
    : Number(t.full_time_sec || t.active_time_sec || 0);
  const totalsHtml =
    '<div class="cr-totals" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="cr-tot"><div class="cr-tot-lbl" title="Finished process steps (Tailor, Hand Work, Button, etc.) — replaces the old &quot;Units&quot; label which was misleading in a garment factory">Process completed</div>' +
        '<div class="cr-tot-val" style="color:var(--gr)">' + (t.units || 0) + '</div></div>' +
      '<div class="cr-tot"><div class="cr-tot-lbl">Work time</div>' +
        '<div class="cr-tot-val" style="color:var(--am)">' + esc(fmtHMS(workTimeSec)) + '</div></div>' +
      '<div class="cr-tot"><div class="cr-tot-lbl">Live now</div>' +
        '<div class="cr-tot-val" style="color:var(--bl)">' + esc(fmtHMS(t.live_active_time_sec || 0)) + '</div></div>' +
    '</div>';

  // 30-day history strip (always rendered when the backend returns data).
  // Click any cell to jump to that date. Lets the CEO spot the real
  // workdays at a glance instead of guessing from the picker.
  let historyHtml = '';
  if (Array.isArray(data.recent_days) && data.recent_days.length) {
    const cells = data.recent_days.map(function (n) {
      const isCurrent = n.day_date === data.date;
      const intensity = n.units >= 8 ? '1' : n.units >= 4 ? '0.7' : n.units >= 1 ? '0.45' : '0.15';
      // Time rendered compact: "12h 4m" / "1h 22m" / "<1m" / "" when zero
      // (today's live session is not in the sessions table, so today often
      // shows 0m — that's correct, the live time is on the stat card above).
      const ts = Number(n.time_sec) || 0;
      const timeLabel = ts > 0 ? fmtShortHMS(ts) : '';
      return '<button type="button" class="ed-day-cell' + (isCurrent ? ' is-current' : '') +
        '" style="background:rgba(34,197,94,' + intensity + ');' +
        (isCurrent ? 'outline:2px solid var(--am);' : '') +
        '" title="' + esc(n.day_date) + ' · ' + n.units + ' unit' + (n.units === 1 ? '' : 's') +
        (ts > 0 ? ' · ' + esc(fmtHMS(ts)) : '') + '"' +
        ' onclick="openEmployeeDayForDate(' + escJs(emp.id) + ', ' + escJs(n.day_date) + ')">' +
        '<span class="ed-day-date">' + esc(String(n.day_date).slice(5)) + '</span>' +
        '<span class="ed-day-units">' + n.units + 'u</span>' +
        '<span class="ed-day-time">' + esc(timeLabel) + '</span>' +
        '</button>';
    }).join('');
    historyHtml =
      '<div class="cr-section" style="margin-top:8px">' +
        '<div class="cr-section-h">Last 30 days <span class="cr-mini">units + time, click a day to jump</span></div>' +
        '<div class="ed-day-strip">' + cells + '</div>' +
      '</div>';
  }

  // Sessions section
  const rows = data.sessions || [];
  let sessionsHtml;
  if (!rows.length) {
    // Empty date — show the 3 nearest dates the employee DID work, so the
    // CEO can see whether the picker is wrong or the employee just didn't
    // log anything on the picked day. Clickable: re-opens the modal for
    // that date. (Backend populates data.nearby_dates when rows=0.)
    let nearbyHint = '';
    if (data.nearby_dates && data.nearby_dates.length) {
      const chips = data.nearby_dates.map(function (n) {
        return '<button class="exec-chip" style="margin:0 4px 4px 0" onclick="openEmployeeDayForDate(' + escJs(emp.id) + ', ' + escJs(n.day_date) + ')">' +
          esc(n.day_date) + ' &middot; ' + n.units + ' unit' + (n.units === 1 ? '' : 's') + '</button>';
      }).join('');
      nearbyHint = '<div style="margin-top:10px;font-size:11px;color:var(--tx3)">No sessions for <b>' + esc(data.date) + '</b>, but this employee has logged time on:</div>' +
        '<div style="margin-top:6px;display:flex;flex-wrap:wrap">' + chips + '</div>';
    }
    sessionsHtml =
      '<div class="cr-section"><div class="cr-section-h">Sessions <span class="cr-mini">chronological, with abaya + duration</span></div>' +
      '<div class="cr-empty">No sessions on this date.</div>' + nearbyHint + '</div>';
  } else {
    sessionsHtml =
      '<div class="cr-section">' +
        '<div class="cr-section-h">Sessions <span class="cr-mini">' + rows.length + ' step' + (rows.length === 1 ? '' : 's') + ' \u00b7 chronological</span></div>' +
        '<div class="cr-scroll">' +
          '<div style="display:grid;grid-template-columns:120px minmax(0,1fr) minmax(0,1.1fr) 76px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-weight:600">' +
            '<span>Time</span><span>Process</span><span>Item</span><span style="text-align:right">Duration</span></div>';
    rows.forEach(function (s) {
      const procColor = procColorUI(s.emp_process);
      const liveBadge = s.live
        ? ' <span class="cr-status" style="color:var(--bl);background:var(--blb);border-color:rgba(106,95,193,.3)">live</span>'
        : '';
      sessionsHtml +=
        '<div style="display:grid;grid-template-columns:120px minmax(0,1fr) minmax(0,1.1fr) 76px;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center;' +
        (s.live ? 'background:rgba(106,95,193,.10);' : '') +
        '">' +
          '<span style="color:var(--tx3);font-variant-numeric:tabular-nums">' + esc(edFmtRange(s)) + '</span>' +
          '<span style="font-weight:600;color:' + procColor + '">' + esc(String(s.emp_process || '\u2014')) + liveBadge + '</span>' +
          '<span style="color:var(--tx2);font-family:var(--fn-mono);font-size:11px">' + esc(String(s.abaya_code || s.abaya_id || '\u2014')) + '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700;font-variant-numeric:tabular-nums">' + esc(fmtHMS(s.duration_sec)) + '</span>' +
        '</div>';
    });
    sessionsHtml += '</div></div>';
  }

  document.getElementById('ed-body').innerHTML = totalsHtml + historyHtml + sessionsHtml;
  // Action bar: WhatsApp export, Change Date, Close
  document.getElementById('ed-actions').innerHTML =
    '<button class="btn-export" style="background:linear-gradient(135deg,#6a5fc1,#422082)" onclick="edWhatsApp()">&#128241; Send via WhatsApp</button>' +
    '<button class="btn-close" onclick="edChangeDate()">&#9664; Change Date</button>' +
    '<button class="btn-close" onclick="closeEmployeeDay()">Close</button>';
}

/** Step back to the Executive Reports panel so the user can pick a new date / person. */
function edChangeDate() {
  closeEmployeeDay();
  // The Executive Reports panel is at the top of the dashboard; scroll to it.
  try {
    const panel = document.getElementById('exec-reports');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {}
}
window.edChangeDate = edChangeDate;

/** Build a WhatsApp-shareable summary of the employee day. */
window.edWhatsApp = function () {
  // Re-render the most recent /api/report/employee-day call's data. The handler
  // stored it on the closure, but we don't keep that across invocations — so
  // we re-fetch.
  const sel = document.getElementById('employee-day-select');
  const empId = sel ? String(sel.value || '') : '';
  if (!empId) { showToast('Pick a person first', 'error'); return; }
  const date = employeeDayAnchorYmd();
  showToast('Building WhatsApp text\u2026');
  fetchWithRetry(
    BASE + '/api/report/employee-day?emp_id=' + encodeURIComponent(decodeURIComponent(empId)) +
      '&date=' + encodeURIComponent(date) + '&ts=' + Date.now(),
    { cache: 'no-store' }
  ).then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'load failed');
      const emp = data.emp || {};
      const t = data.totals || {};
      const name = emp.name || emp.id || 'Employee';
      const lines = [];
      lines.push('*AbaYa Track \u2014 ' + name + '*');
      lines.push('_' + String(data.date || '') + '_');
      lines.push('_' + (emp.process || '') + '_');
      lines.push('_Generated in ' + uiTz() + '_');
      lines.push('');
      lines.push('*Totals*');
      lines.push('\u2022 Process completed: *' + (t.units || 0) + '*');
      lines.push('\u2022 Work time: *' + fmtHMS(t.active_time_sec || 0) + '*');
      lines.push('\u2022 Live now: *' + fmtHMS(t.live_active_time_sec || 0) + '*');
      lines.push('');
      if ((data.sessions || []).length) {
        lines.push('*Sessions*');
        data.sessions.forEach(function (s) {
          lines.push('\u2022 ' + edFmtRange(s) + ' \u00b7 ' + (s.emp_process || '\u2014') +
            ' \u00b7 ' + (s.abaya_code || s.abaya_id || '\u2014') +
            ' \u00b7 ' + fmtHMS(s.duration_sec) + (s.live ? ' (active)' : ''));
        });
        lines.push('');
      }
      lines.push('_Sent from AbaYa Track CEO Dashboard_');
      const text = lines.join('\\n');
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      showToast('WhatsApp opened');
    })
    .catch(function (e) { showToast('Could not build text: ' + (e.message || e), 'error'); });
};

function backToReportBtnHtml() {
  return '<div style="margin-bottom:10px"><button type="button" class="rep-btn" style="padding:8px 12px;text-transform:none" onclick="backToReport()">&larr; Back to report</button></div>';
}

function backToReport() {
  if (activeReportType) openReport(activeReportType);
}

async function openReport(type) {
  activeReportType = type;
  lastModalAnalytics = null;
  lastModalTrace = null;
  document.getElementById('modal-title').textContent = type.charAt(0).toUpperCase()+type.slice(1)+' Report';
  document.getElementById('modal-ts').textContent = 'Fetching data from Cloudflare D1...';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');
  // Month navigator lives only in the monthly report, and only when no
  // day is picked. renderMonthNav() handles both decisions internally so
  // we just call it unconditionally on every report open.
  try { renderMonthNav(); } catch (_) {}

  try {
    // Day picker still anchors the report at a single date (back-compat
    // with the existing &date= behaviour). When a month is picked, the
    // report becomes a custom range covering that month, so e.g. tapping
    // "Weekly" while month=2026-08 returns the last full week of August,
    // not the current real-world week.
    const pickedDate = getPickedReportDate();
    const pickedMonth = getPickedReportMonth();
    let rangeQs = '';
    if (pickedDate) {
      rangeQs = '&date=' + encodeURIComponent(pickedDate);
    } else if (pickedMonth) {
      rangeQs =
        '&from=' + encodeURIComponent(pickedMonthStartYmd(pickedMonth)) +
        '&to=' + encodeURIComponent(pickedMonthEndYmd(pickedMonth));
    }
    const r = await fetchWithRetry(
      BASE + '/api/report?type=' + encodeURIComponent(type) +
        '&local_today=' + encodeURIComponent(localYmdNow()) +
        rangeQs +
        '&ts=' + Date.now(),
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
      '<div class="stat-row stat-row-3" style="margin-bottom:14px">' +
      card('&#129532; Process completed', s.total_units||0, 'var(--gr)') +
      card('&#9202; Avg Cycle', fmtHMS(s.avg_sec), 'var(--am)') +
      card('&#128101; Workers', s.unique_workers||0, 'var(--bl)') +
      '</div>' +
      '<div class="stat-row stat-row-2" style="margin-bottom:14px">' +
      card('Active Time', fmtHMS(s.active_time_sec||0), 'var(--gr)') +
      card('Elapsed Time', fmtHMS(s.elapsed_time_sec||0), 'var(--am)') +
      card('Live In-Progress', fmtHMS(s.live_active_time_sec||0), 'var(--bl)') +
      card('Full Time', fmtHMS(s.full_time_sec||0), 'var(--pu)') +
      '</div>' +
      '<div class="stat-row stat-row-2" style="margin-bottom:14px">' +
      card('Tolerance credited', fmtHMS(s.tolerance_sec||0), 'var(--bl)') +
      card('Adjusted Full Time', fmtHMS(s.adjusted_full_time_sec||0), 'var(--gr)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);margin:-6px 0 10px">Adjusted full time applies empathy tolerance (mishaps + short interruptions).</div>' +
      '<div class="stat-row stat-row-3" style="margin-bottom:14px">' +
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
      card('Process vs prev', (insights.trend_vs_previous && insights.trend_vs_previous.total_units_delta) || 0, 'var(--gr)') +
      card('Active vs prev', fmtHMS((insights.trend_vs_previous && insights.trend_vs_previous.active_time_sec_delta) || 0), 'var(--am)') +
      card('Avg vs prev', fmtHMS((insights.trend_vs_previous && insights.trend_vs_previous.avg_sec_delta) || 0), 'var(--bl)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">By employee — tap a name to see their day</div>' +
      '<div class="by-emp-table">' +
      '<div class="by-emp-head">' +
        '<span>Employee</span>' +
        '<span title="Finished process steps">Process</span>' +
        '<span>Active</span>' +
        '<span class="by-emp-col-hide-mid">Elapsed</span>' +
        '<span class="by-emp-col-hide-sm">Live</span>' +
        '<span>Full</span>' +
        '<span class="by-emp-col-hide-sm">Tol</span>' +
        '<span>Adj</span>' +
      '</div>' +
      '<div class="by-emp-body" style="max-height:340px;overflow-y:auto;border-radius:0 0 10px 10px">';

    (data.by_employee||[]).forEach(e => {
      const empId = String(e.emp_id || '');
      const empNameRaw = String(e.emp_name || e.emp_id || '');
      const empName = esc(empNameRaw);
      const empCode = esc(String(e.emp_code || ''));
      const empProcess = esc(String(e.emp_process || ''));
      // The popup deliberately does NOT repeat the time stats the row
      // already shows. It surfaces what the row can't fit compactly:
      // the employee's identity (avatar + name + processes), the
      // headline number (units, big), and the one-tap action.
      // Split name into whitespace-separated tokens without /\s+/ — the
      // wrangler minifier strips backslashes from regex literals and would
      // ship /s+/ which throws on every page load. Take the first 2
      // non-empty tokens after collapsing runs of whitespace.
      const _nameParts = [];
      {
        const _raw = String(empNameRaw || '');
        let _cur = '';
        for (let _i = 0; _i < _raw.length; _i++) {
          const _cc = _raw.charCodeAt(_i);
          const _isSpace = _cc === 32 || _cc === 9 || _cc === 10 || _cc === 13;
          if (_isSpace) {
            if (_cur) { _nameParts.push(_cur); _cur = ''; if (_nameParts.length >= 2) break; }
          } else {
            _cur += _raw.charAt(_i);
          }
        }
        if (_cur && _nameParts.length < 2) _nameParts.push(_cur);
      }
      const initials = _nameParts
        .map(function (s) { return s.charAt(0).toUpperCase(); })
        .join('') || (empId ? empId.slice(-2).toUpperCase() : '?');
      const avatarColor = procColorUI(String(e.emp_process || ''));
      const processesAll = Array.isArray(e.emp_processes) && e.emp_processes.length
        ? e.emp_processes : (e.emp_process ? [e.emp_process] : []);
      const processesHtml = processesAll.map(function (p) {
        const c = procColorUI(p);
        return '<span class="by-emp-popup-process" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55">' +
          esc(String(p)) + '</span>';
      }).join('');
      // Desktop/tablet cells (7). Each gets a class for hide rules.
      // 'by-emp-col-hide-mid' hides at <=720px (tolerance + live)
      // 'by-emp-col-hide-sm'  hides at <=520px (elapsed + live + tolerance)
      html += '<div class="by-emp-row" tabindex="0" data-emp-id="' + esc(empId) + '"' +
        ' data-emp-name="' + empName + '" data-emp-process="' + empProcess + '"' +
        ' data-emp-code="' + empCode + '">' +
        '<span class="by-emp-name">' +
          '<span style="color:var(--tx);display:block;font-weight:600;line-height:1.25">' + empName + '</span>' +
          '<span style="color:var(--tx3);font-weight:400;font-size:11px;display:block;margin-top:2px">' + (empProcess||'') + (empCode?' &middot; '+empCode:'') + '</span>' +
        '</span>' +
        // Top row: name + units pill (mobile uses this)
        // Wide layout: each cell is its own grid cell
        '<span data-col="units"><span class="by-emp-units-pill">' + (e.units || 0) + '</span></span>' +
        '<span data-col="active" style="color:var(--gr);font-weight:700">' + fmtHMS(e.active_time_sec) + '</span>' +
        '<span data-col="elapsed" class="by-emp-col-hide-mid" style="color:var(--tx2)">' + fmtHMS(e.elapsed_time_sec) + '</span>' +
        '<span data-col="live" class="by-emp-col-hide-sm" style="color:var(--bl)">' + fmtHMS(e.live_active_time_sec) + '</span>' +
        '<span data-col="full" style="color:var(--pu);font-weight:700">' + fmtHMS(e.full_time_sec) + '</span>' +
        '<span data-col="tol" class="by-emp-col-hide-sm" style="color:var(--am)">' + fmtHMS(e.tolerance_sec) + '</span>' +
        '<span data-col="adj" style="color:var(--gr);font-weight:700">' + fmtHMS(e.adjusted_full_time_sec) + '</span>' +
        // Mobile-only horizontal stat strip (CSS turns off on wide)
        '<div class="by-emp-row-stats">' +
          '<div class="by-emp-stat">Active<b>' + fmtHMS(e.active_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Full<b>' + fmtHMS(e.full_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Adj<b>' + fmtHMS(e.adjusted_full_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Live<b>' + fmtHMS(e.live_active_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Elpsd<b>' + fmtHMS(e.elapsed_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Tol<b>' + fmtHMS(e.tolerance_sec) + '</b></div>' +
        '</div>' +
        '<div class="by-emp-popup" role="tooltip">' +
          '<div class="by-emp-popup-head">' +
            '<div class="by-emp-popup-avatar" style="background:' + avatarColor + '">' + esc(initials) + '</div>' +
            '<div style="min-width:0">' +
              '<div class="by-emp-popup-name">' + empName + '</div>' +
              (empCode ? '<div class="by-emp-popup-empcode">' + empCode + '</div>' : '') +
            '</div>' +
          '</div>' +
          (processesHtml ? '<div class="by-emp-popup-processes">' + processesHtml + '</div>' : '') +
          '<div class="by-emp-popup-units-row">' +
            '<div class="by-emp-popup-units-lbl" title="Finished process steps the employee completed this period">Process completed</div>' +
            '<div class="by-emp-popup-units-val">' + (e.units || 0) + '</div>' +
          '</div>' +
          '<a class="by-emp-popup-cta" href="javascript:void(0)" data-emp-id="' + esc(empId) + '">View their day &rarr;</a>' +
        '</div>' +
      '</div>';
    });
    if (!data.by_employee||!data.by_employee.length) {
      html += '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:12px">No data for this period</div>';
    }
    html += '</div></div>';

    const byProcess = data.by_process || [];
    if (byProcess.length) {
      html +=
        '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">By process (decision bottlenecks)</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;margin-bottom:14px;max-height:220px;overflow:auto">' +
        '<div style="min-width:560px">' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;color:var(--tx3)">' +
        '<span>Process</span><span style="text-align:right" title="Finished process steps at this station">Process completed</span><span style="text-align:right">Active</span><span style="text-align:right">Elapsed</span><span style="text-align:right">Live</span><span style="text-align:right">Full</span><span style="text-align:right">Tol</span><span style="text-align:right">Adj</span></div>';
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
      html += '</div></div>';
    }

    // Month-by-month breakdown (yearly report only — server sends by_month for type=yearly).
    // Six columns aligned to the real meaning of the data:
    //   Month | Trend(Abayas) | Abayas | Process completed | Active time | Avg/abaya
    // The trend bar visualises ABYAS (the factory's real output), not raw
    // process steps. "Process completed" replaces the old "Units" label
    // because COUNT(*) is the number of finished process steps, not
    // finished garments — labelling it "Units" was misleading for a
    // garment factory.
    const byMonth = data.by_month || [];
    if (byMonth.length) {
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const maxAby = byMonth.reduce(function (m, r) { return Math.max(m, Number(r.abayas) || 0); }, 0) || 1;
      html +=
        '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">Month by month</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px">' +
        '<div style="display:grid;grid-template-columns:42px 1fr 60px 64px 80px 64px;gap:8px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px">' +
          '<span>Month</span><span>Trend (abayas)</span><span style="text-align:right" title="Distinct abaya ids with a finished session in this month">Abayas</span>' +
          '<span style="text-align:right" title="Total finished process steps the floor completed (Tailor, Hand Work, Button, etc.)">Process</span>' +
          '<span style="text-align:right" title="In-shift working minutes summed across every session that month">Active time</span>' +
          '<span style="text-align:right" title="Active time ÷ distinct abayas = average minutes invested per garment that month">Avg / abaya</span>' +
        '</div>';
      byMonth.forEach(function (m) {
        const mi = parseInt(String(m.ym).slice(5, 7), 10) - 1;
        const aby = Number(m.abayas) || 0;
        const pct = Math.round((aby / maxAby) * 100);
        html +=
          '<div style="display:grid;grid-template-columns:42px 1fr 60px 64px 80px 64px;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
            '<span style="font-weight:600">' + esc(MONTHS[mi] || String(m.ym)) + '</span>' +
            '<span title="' + aby + ' abayas in ' + esc(MONTHS[mi] || String(m.ym)) + '" style="background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden"><span style="display:block;height:8px;width:' + pct + '%;background:var(--gr)"></span></span>' +
            '<span style="text-align:right;font-weight:700;color:var(--bl)" title="distinct abaya ids">' + aby + '</span>' +
            '<span style="text-align:right;font-weight:700" title="finished process steps">' + esc(String(m.units || 0)) + '</span>' +
            '<span style="text-align:right;color:var(--am)">' + fmtHMS(m.active_time_sec) + '</span>' +
            '<span style="text-align:right;color:var(--pu);font-weight:600" title="active_time ÷ abayas">' + fmtHMS(m.avg_per_abaya_sec) + '</span>' +
          '</div>';
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
  // Use the same .stat-card class as the dashboard KPI bar so the
  // tick-up + lift + click-ripple animations apply uniformly.
  const safeVal = (val == null) ? '\u2014' : String(val);
  return '<div class="stat-card" style="text-align:center">' +
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">'+label+'</div>' +
    '<div class="stat-val" data-stat-tick="' + esc(safeVal) + '" style="font-size:20px;font-weight:800;color:'+color+'">'+safeVal+'</div></div>';
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
    '- Vs previous: Process completed ' + (trend.total_units_delta || 0) + ', Active ' + fmtHMS(trend.active_time_sec_delta || 0) + ', Avg ' + fmtHMS(trend.avg_sec_delta || 0),
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
        ' process completed (' +
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

// ─── MICRO-INTERACTIONS ON STAT CARDS ──────────────────────────────────────────
// Three layers: (1) tick-up from 0 on first render, (2) stagger reveal,
// (3) hover lift + click ripple. Re-runs are safe; values that don't
// change won't re-tick, and DOM elements are tagged with a data-attr
// so we don't re-attach listeners twice.

function parseStatNumber(s) {
  // Accept "1,039", "2h 12m 38s", "55.9%", "—", etc.
  // No regex literals here: wrangler's minifier strips backslashes from
  // /\d/ /\s/ patterns and ships /d/ /s/ which throw on every page load.
  // All parsing is done with explicit char-by-char checks instead.
  if (s == null) return null;
  const str = String(s).trim();
  if (!str || str === '\u2014' || str === '-') return null;

  function _isDigit(c) {
    const cc = c.charCodeAt(0);
    return cc >= 48 && cc <= 57;
  }
  function _allDigits(s2) {
    if (!s2.length) return false;
    for (let i = 0; i < s2.length; i++) if (!_isDigit(s2.charAt(i))) return false;
    return true;
  }

  // Plain integer or decimal with thousands separators: "-1,039", "12.5".
  if (str.charAt(0) === '-' || _isDigit(str.charAt(0))) {
    let _ok = true;
    let _sawDigit = false;
    let _sawDot = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      if (_isDigit(ch)) { _sawDigit = true; continue; }
      if (ch === ',') continue;
      if (ch === '.' && !_sawDot) { _sawDot = true; continue; }
      _ok = false; break;
    }
    if (_ok && _sawDigit) {
      return { value: Number(str.replace(/,/g, '')), kind: 'num', suffix: '' };
    }
  }

  // Percentage: "-12.5%" or "55.9%".
  if (str.charAt(str.length - 1) === '%') {
    const _body = str.slice(0, -1).trim();
    if (_body.length && (_body.charAt(0) === '-' || _isDigit(_body.charAt(0)))) {
      let _ok2 = true; let _sawDigit2 = false; let _sawDot2 = false;
      for (let i = 0; i < _body.length; i++) {
        const ch = _body.charAt(i);
        if (_isDigit(ch)) { _sawDigit2 = true; continue; }
        if (ch === '.' && !_sawDot2) { _sawDot2 = true; continue; }
        _ok2 = false; break;
      }
      if (_ok2 && _sawDigit2) return { value: Number(_body), kind: 'num', suffix: '%' };
    }
  }

  // HMS: "2h 12m 38s", "12m 5s", "45s", "3h". Tokens are split on
  // whitespace, each unit is "<digits><h|m|s>".
  {
    const _toks = str.split(' ');
    let _h = 0, _mi = 0, _se = 0;
    let _matched = false;
    for (let i = 0; i < _toks.length; i++) {
      const t = _toks[i];
      if (!t) continue;
      const last = t.charAt(t.length - 1);
      const num = t.slice(0, -1);
      if (last === 'h' && num.length && _allDigits(num)) { _h = Number(num); _matched = true; continue; }
      if (last === 'm' && num.length && _allDigits(num)) { _mi = Number(num); _matched = true; continue; }
      if (last === 's' && num.length && _allDigits(num)) { _se = Number(num); _matched = true; continue; }
      _matched = false; break;
    }
    if (_matched) {
      return { value: _h * 3600 + _mi * 60 + _se, kind: 'hms', suffix: '' };
    }
  }

  return null;
}

function fmtTickValue(target, kind, suffix) {
  if (kind === 'hms') {
    return fmtHMS(Math.round(target));
  }
  // Numbers: thousands separator if large, decimals only if present.
  const n = Math.round(target);
  return (n === 0 ? '0' : n.toLocaleString('en-US')) + suffix;
}

function tickStatValue(el, targetStr, opts) {
  if (!el) return;
  opts = opts || {};
  const dur = opts.duration || 700;
  if (el.__statWired) {
    // Already animated once; just update the text without re-ticking.
    const parsed = parseStatNumber(targetStr);
    if (parsed) el.textContent = fmtTickValue(parsed.value, parsed.kind, parsed.suffix);
    else el.textContent = String(targetStr);
    return;
  }
  el.__statWired = true;
  const parsed = parseStatNumber(targetStr);
  if (!parsed) { el.textContent = String(targetStr); return; }
  // Respect reduced motion: skip the tick, just set the value.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmtTickValue(parsed.value, parsed.kind, parsed.suffix);
    return;
  }
  const from = 0;
  const to = parsed.value;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    // ease-out cubic
    const e = 1 - Math.pow(1 - t, 3);
    const v = from + (to - from) * e;
    el.textContent = fmtTickValue(v, parsed.kind, parsed.suffix);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmtTickValue(to, parsed.kind, parsed.suffix);
  }
  el.textContent = fmtTickValue(0, parsed.kind, parsed.suffix);
  requestAnimationFrame(step);
}

// Walk a stat-card grid and animate every numeric value inside.
function animateStatGrid(root, opts) {
  if (!root) return;
  const cards = root.querySelectorAll('.stat-card');
  cards.forEach(function (card, i) {
    // Stagger reveal
    card.style.setProperty('--stagger-i', i);
    card.classList.add('stat-card-enter');
    // Tick any value or sub that's a parseable number
    card.querySelectorAll('[data-stat-tick]').forEach(function (el) {
      tickStatValue(el, el.getAttribute('data-stat-tick'), opts);
    });
  });
  // Hover lift + click ripple (delegated on the grid, attached once)
  if (!root.__statWired) {
    root.__statWired = true;
    root.addEventListener('click', function (ev) {
      const card = ev.target.closest && ev.target.closest('.stat-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const span = Math.max(r.width, r.height);
      const ink = document.createElement('span');
      ink.className = 'stat-card-ink';
      ink.style.width = ink.style.height = span + 'px';
      ink.style.left = (x - span / 2) + 'px';
      ink.style.top = (y - span / 2) + 'px';
      card.appendChild(ink);
      setTimeout(function () { ink.remove(); }, 600);
    });
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
// Delegated click handler for the by-employee rows in the analytics modal.
// The row carries data-emp-id (no inline onclick = no escape-trap syntax
// errors). Clicks on the row OR on the popup's "View their day" CTA both
// open the singular day report. Keyboard Enter / Space on a focused row
// also works because the row is tabindex=0.
function wireByEmpRowDelegation() {
  const body = document.getElementById('modal-body');
  if (!body || body.__byEmpWired) return;
  body.__byEmpWired = true;
  body.addEventListener('click', function (ev) {
    const cta = ev.target.closest && ev.target.closest('.by-emp-popup-cta');
    if (cta) {
      ev.preventDefault();
      const id = String(cta.getAttribute('data-emp-id') || '');
      if (id) openEmployeeDay(id);
      return;
    }
    const row = ev.target.closest && ev.target.closest('.by-emp-row');
    if (row) {
      const id = String(row.getAttribute('data-emp-id') || '');
      if (id) openEmployeeDay(id);
    }
  });
  body.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest && ev.target.closest('.by-emp-row');
    if (!row) return;
    ev.preventDefault();
    const id = String(row.getAttribute('data-emp-id') || '');
    if (id) openEmployeeDay(id);
  });
}

loadAbayaCatalog().then(function () {
  renderAbayaTotalsTable();
});
loadEmployeeDayOptions();
wireTraceCombobox();
schedulePollLoop();
wireByEmpRowDelegation();
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
  const pickedD = getPickedReportDate();
  const pickedM = getPickedReportMonth();
  if (d) {
    let head = '';
    if (pickedD) head = 'Showing picked date ' + pickedD + ' (factory today is ' + ft + ') \u2014 ';
    else if (pickedM) head = 'Showing month ' + pickedM + ' (factory today is ' + ft + ') \u2014 ';
    else if (ft) head = 'Factory day ' + ft + ' \u2014 ';
    d.textContent = head + new Date().toLocaleTimeString([], { timeZone: uiTz() });
  }
  const dn = document.getElementById('dubai-now');
  if (dn) dn.textContent = 'Dubai time: ' + uiNowString();
  const ws = document.getElementById('work-status');
  if (ws) ws.textContent = 'Status: ' + String(STATE.working_status || '--');
}, 2000);

// ── Customer notifications add-on (CEO toggle + usage meter) ───────────────────
(function () {
  var card = document.createElement('div');
  card.id = 'msg-addon';
  card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:14px 16px;font-family:system-ui,sans-serif;max-width:300px';
  card.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">' +
      '<div><div style="font-weight:700;font-size:13px;color:#0f172a">Customer notifications</div>' +
      '<div id="msg-sub" style="font-size:11px;color:#64748b;margin-top:2px">Loading…</div></div>' +
      '<button id="msg-toggle" role="switch" aria-checked="false" aria-label="Toggle customer notifications" ' +
        'style="position:relative;width:46px;height:26px;border-radius:999px;border:none;background:#cbd5e1;cursor:pointer;flex-shrink:0;transition:background .2s">' +
        '<span id="msg-knob" style="position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.25)"></span>' +
      '</button>' +
    '</div>';
  document.body.appendChild(card);
  var sub = card.querySelector('#msg-sub');
  var btn = card.querySelector('#msg-toggle');
  var knob = card.querySelector('#msg-knob');
  var enabled = false, busy = false;

  function paint() {
    btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
    btn.style.background = enabled ? '#14b8a6' : '#cbd5e1';
    knob.style.left = enabled ? '23px' : '3px';
  }
  function load() {
    fetch(BASE + '/api/messaging/status', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { sub.textContent = 'Sign in to manage'; return; }
        enabled = !!d.enabled;
        sub.textContent = (enabled ? 'On' : 'Off') + ' · ' + (d.periodCount || 0) + ' sent this month (' + (d.sentCount || 0) + ' total)';
        paint();
      })
      .catch(function () { sub.textContent = 'Unavailable'; });
  }
  btn.addEventListener('click', function () {
    if (busy) return; busy = true;
    var next = !enabled;
    fetch(BASE + '/api/messaging/toggle', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) { enabled = !!d.enabled; paint(); } busy = false; load(); })
      .catch(function () { busy = false; });
  });
  load();
  setInterval(load, 60000);
})();

/* ─── Check Delivery Report (calendar + per-factory delivery summary) ─────────
 * Reuses the same dark-purple palette. Server is on the same origin so the
 * BASE constant from the surrounding dashboard script is reused directly.
 * The user picks a date or range + a factory (or "All factories" for the
 * overall headline), and the report shows:
 *   1. Overall delivery summary (Invoices / Abayas / Delivered / Pending /
 *      Cancelled) as five big stat cards under a "Delivery summary" header.
 *   2. Per-factory drill-down — each factory as its own card with a sub-grid
 *      of invoices and abayas, plus mini status pills.
 *   3. Cancellations section (cloud-side) appended at the bottom. */
(function initCheckReport() {
  // fetchJsonSafe is not inlined in the dashboard helper bundle. Define a
  // tiny local equivalent so the IIFE stays self-contained.
  //
  // The old version (r => r.json()) blindly parsed the body as JSON and
  // caught errors as null. That swallowed the server's actual error message
  // on a 4xx/5xx (e.g. "Session expired. Please sign in again.") and
  // turned every failure into a generic "Network error" toast, which
  // makes the operator's "Check Delivery" modal look broken when in fact
  // it's a stale CEO session. This version:
  //   - reads the body as text first
  //   - tries to parse as JSON and surface server's error field on non-2xx
  //   - falls back to "HTTP <status> <first 200 bytes>" for HTML / empty
  //     bodies, and logs the full URL+status+body to console for diagnosis
  //   - throws a real Error on non-2xx so the caller can branch (e.g. 401
  //     -> refresh session and retry)
  function crFetchJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      var looksJson = ct.indexOf('application/json') !== -1;
      // Read the body as text first so we can both parse it and surface
      // a useful slice of non-JSON bodies in the toast / console.
      return r.text().then(function (txt) {
        var parsed = null;
        if (txt && (looksJson || txt.charCodeAt(0) === 123 || txt.charCodeAt(0) === 91)) {
          try { parsed = JSON.parse(txt); } catch (_) { parsed = null; }
        }
        if (r.ok) {
          // If the body is non-empty but unparseable, the server is
          // misbehaving. Throw so the caller shows a real error rather
          // than silently treating the malformed body as a report.
          if (parsed == null && txt) {
            console.error('[check-delivery] 2xx but unparseable body', { url: url, status: r.status, body: txt.slice(0, 200) });
            throw new Error('Bad response (HTTP ' + r.status + ', non-JSON body)');
          }
          return parsed;
        }
        // Non-2xx: surface the server's error message when we can.
        var msg = (parsed && (parsed.error || parsed.message)) || ('HTTP ' + r.status);
        if (!parsed && txt) msg = msg + ' — ' + txt.slice(0, 200);
        console.error('[check-delivery] non-2xx', { url: url, status: r.status, body: txt.slice(0, 200) });
        var err = new Error(msg);
        err.status = r.status;
        err.url = url;
        throw err;
      });
    });
  }
  const tz = 'Asia/Dubai';
  const state = {
    step: 'calendar',
    config: null,
    factory: '',
    viewYear: 0,
    viewMonth: 0,
    todayYmd: '',
    fromYmd: '',
    toYmd: '',
    report: null,
  };

  function ymdInTz(epochSec) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epochSec * 1000));
    } catch (_) { return ''; }
  }
  function ymdInTzMs(epochMs) { return ymdInTz(Math.floor(epochMs / 1000)); }
  function longInTz(ymd) {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
    const noon = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(noon));
  }
  function rangeLabel() {
    if (!state.fromYmd) return 'No date selected';
    if (state.fromYmd === state.toYmd) return longInTz(state.fromYmd);
    return longInTz(state.fromYmd) + ' \u2192 ' + longInTz(state.toYmd);
  }

  function openCheckReport() {
    const m = document.getElementById('modal-check');
    if (!m) return;
    m.classList.add('open');
    state.step = 'calendar';
    crFetchJson(BASE + '/api/check-delivery-report/config').then(function (j) {
      if (j && j.ok) {
        state.config = j;
        // Default to "All factories" so the user lands on the overall
        // summary first; can pick a specific factory from the dropdown.
        state.factory = '';
        state.todayYmd = j.todayYmd || ymdInTzMs(Date.now());
      } else {
        state.todayYmd = ymdInTzMs(Date.now());
      }
      const p = state.todayYmd.split('-');
      state.viewYear = parseInt(p[0], 10);
      state.viewMonth = parseInt(p[1], 10) - 1;
      state.fromYmd = state.todayYmd;
      state.toYmd = state.todayYmd;
      renderCalendar();
    }).catch(function () {
      state.todayYmd = ymdInTzMs(Date.now());
      const p = state.todayYmd.split('-');
      state.viewYear = parseInt(p[0], 10);
      state.viewMonth = parseInt(p[1], 10) - 1;
      state.fromYmd = state.todayYmd;
      state.toYmd = state.todayYmd;
      renderCalendar();
    });
  }
  function closeCheckReport() {
    const m = document.getElementById('modal-check');
    if (m) m.classList.remove('open');
  }
  window.closeCheckReport = closeCheckReport;
  window.openCheckReport = openCheckReport;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function renderCalendar() {
    const body = document.getElementById('cr-body');
    const sub  = document.getElementById('cr-sub');
    const acts = document.getElementById('cr-actions');
    if (!body) return;
    if (sub) sub.textContent = 'Pick a single date or a range. Production timezone: ' + tz + '.';
    const year = state.viewYear;
    const month = state.viewMonth;
    const firstWd = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let cells = '';
    for (let i = firstWd - 1; i >= 0; i--) {
      cells += '<div class="cr-cell muted">' + (prevMonthDays - i) + '</div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = year + '-' + pad2(month + 1) + '-' + pad2(d);
      const cls = ['cr-cell'];
      if (ymd === state.todayYmd) cls.push('today');
      if (ymd === state.fromYmd || ymd === state.toYmd) cls.push('selected');
      else if (state.fromYmd && state.toYmd && ymd >= state.fromYmd && ymd <= state.toYmd) cls.push('in-range');
      cells += '<div class="' + cls.join(' ') + '" data-ymd="' + ymd + '" onclick="crSel(this.dataset.ymd)">' + d + '</div>';
    }
    const totalCells = firstWd + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) cells += '<div class="cr-cell muted">' + i + '</div>';

    const monthName = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(year, month, 15)));
    const factories = (state.config && state.config.factories) || ['Main Factory'];
    // "All factories" sentinel = empty string. The dashboard defaults to this
    // so the headline numbers are the first thing the user sees.
    const factoryOpts = '<option value=""' + (state.factory === '' ? ' selected' : '') + '>All factories</option>' +
      factories.map(function (f) {
        return '<option value="' + escapeAttr(f) + '"' + (f === state.factory ? ' selected' : '') + '>' + escapeHtml(f) + '</option>';
      }).join('');

    body.innerHTML =
      '<div class="cr-cal">' +
        '<div class="cr-cal-head">' +
          '<div class="cr-nav"><button class="cr-nav-btn" onclick="crNav(-1)">&#9664; Prev</button></div>' +
          '<div class="cr-cal-title">' + escapeHtml(monthName) + '</div>' +
          '<div class="cr-nav">' +
            '<button class="cr-nav-btn" onclick="crToday()">Today</button>' +
            '<button class="cr-nav-btn" onclick="crNav(1)">Next &#9654;</button>' +
          '</div>' +
        '</div>' +
        '<div class="cr-weekdays">' +
          ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function (w) { return '<div class="cr-wd">' + w + '</div>'; }).join('') +
        '</div>' +
        '<div class="cr-grid">' + cells + '</div>' +
      '</div>' +
      '<div class="cr-summary">' +
        '<div class="cr-factory-pick">' +
          '<span>Factory</span>' +
          '<select id="cr-factory" onchange="CR_STATE_FACTORY=this.value">' + factoryOpts + '</select>' +
        '</div>' +
        '<div><b id="cr-range-label">' + escapeHtml(rangeLabel()) + '</b>' +
          ' &middot; <span style="color:var(--tx3)">pick a date or range, then Check Delivery Report</span></div>' +
      '</div>';
    if (acts) {
      acts.innerHTML =
        '<button class="btn-close" onclick="closeCheckReport()">Close</button>' +
        '<button class="btn-export" style="background:linear-gradient(135deg,#6a5fc1,#422082)" onclick="crSubmit()">&#128230; Check Delivery Report</button>';
    }
  }
  // Expose a small bridge for the inline onchange so the factory select can
  // update the state without a closure-routed setter.
  window.CR_STATE_FACTORY = '';
  Object.defineProperty(window, 'CR_STATE_FACTORY', {
    get: function () { return state.factory; },
    set: function (v) { state.factory = v; },
  });

  window.crNav = function (delta) {
    let m = state.viewMonth + delta;
    let y = state.viewYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    state.viewYear = y; state.viewMonth = m;
    renderCalendar();
  };
  window.crToday = function () {
    const p = state.todayYmd.split('-');
    state.viewYear = parseInt(p[0], 10);
    state.viewMonth = parseInt(p[1], 10) - 1;
    state.fromYmd = state.todayYmd;
    state.toYmd = state.todayYmd;
    renderCalendar();
  };
  window.crSel = function (ymd) {
    if (!ymd) return;
    if (!state.fromYmd) { state.fromYmd = ymd; state.toYmd = ymd; }
    else if (state.fromYmd === state.toYmd) {
      if (ymd !== state.fromYmd) {
        if (ymd > state.fromYmd) state.toYmd = ymd;
        else { state.toYmd = state.fromYmd; state.fromYmd = ymd; }
      }
    } else { state.fromYmd = ymd; state.toYmd = ymd; }
    renderCalendar();
  };
  window.crSubmit = function () {
    if (!state.fromYmd) { showToast('Pick a date first'); return; }
    // Reshape the server's compact aggregation into the nested
    // factories[].invoices[] shape the renderers and crWhatsApp expect.
    // Inputs:  j.byLocation[] (per-showroom totals), j.groups[]
    //          (per-(location, invoice) detail with rows[]), j.cancellations[]
    // Outputs: j.factories[] with name, totals, invoices[] (each with
    //          no, abayas[{code, timestamp, status}], totals), and
    //          j.cancellations[] with reason (renamed from
    //          cancellationReason) for the cancel row renderer.
    function transformReport(j) {
      if (!j) return j;
      // Group per-location invoices from the server's flat groups[].
      const invoiceByLoc = new Map();
      const groups = Array.isArray(j.groups) ? j.groups : [];
      for (const g of groups) {
        const loc = String(g.location || 'Unspecified');
        let bucket = invoiceByLoc.get(loc);
        if (!bucket) { bucket = []; invoiceByLoc.set(loc, bucket); }
        const rows = Array.isArray(g.rows) ? g.rows : [];
        const totals = { abayas: rows.length, delivered: 0, pending: 0, cancelled: 0 };
        for (const r of rows) {
          if (r.status === 'completed') totals.delivered += 1;
          else if (r.status === 'cancelled') totals.cancelled += 1;
          else totals.pending += 1;
        }
        bucket.push({
          no: g.invoiceNo,
          // Mark a synthetic "(no invoice)" entry when the group has no
          // invoiceNo -- matches what the old server path used to emit
          // so the renderers' inv.synthetic ? '(no invoice)' : inv.no
          // ternary keeps working.
          synthetic: !g.invoiceNo,
          totals,
          abayas: rows.map(function (r) {
            return {
              code: r.abayaCode || '',
              status: r.status || 'pending',
              // Renderers expect a millisecond timestamp.
              timestamp: r.eventAt ? Date.parse(r.eventAt) : null,
            };
          }),
        });
      }
      // Build the factories[] array. Use the server's factories[] as the
      // source of truth for name + totals (it already has the
      // per-showroom rollups) and stitch in the per-invoice drill-down
      // we just computed.
      const serverFactories = Array.isArray(j.factories) ? j.factories : [];
      const byLocName = new Map((Array.isArray(j.byLocation) ? j.byLocation : []).map(function (lt) {
        return [String(lt.location || ''), lt];
      }));
      const factories = (serverFactories.length ? serverFactories : Array.from(byLocName.values()).map(function (lt) {
        return { name: lt.location, totals: {
          invoices: lt.invoices, abayas: lt.abayas, delivered: lt.delivered,
          pending: lt.pending, cancelled: lt.cancelled,
        } };
      })).map(function (f) {
        const loc = String(f.name || '');
        return Object.assign({}, f, { invoices: invoiceByLoc.get(loc) || [] });
      });
      // Cancellations: rename cancellationReason -> reason so the
      // cancel-row renderer (which reads c.reason) doesn't render
      // "undefined" inline.
      const cancellations = (Array.isArray(j.cancellations) ? j.cancellations : []).map(function (c) {
        const out = Object.assign({}, c);
        if (typeof out.reason === 'undefined' && typeof out.cancellationReason !== 'undefined') {
          out.reason = out.cancellationReason;
        }
        return out;
      });
      // Return a shallow-copied object so we never mutate the response
      // and risk a future caller seeing the wrong shape.
      return Object.assign({}, j, { factories: factories, cancellations: cancellations });
    }
    function buildUrl() {
      const params = new URLSearchParams();
      params.set('from', state.fromYmd);
      params.set('to', state.toYmd);
      if (state.factory) params.set('factory', state.factory);
      params.set('ts', String(Date.now()));
      return BASE + '/api/check-delivery-report?' + params.toString();
    }
    // One auto-retry on a 401 'Session expired' response: reissue the
    // session via the existing /api/ceo/session/refresh endpoint, then
    // retry the report fetch. Mirrors the pattern in the main poll()
    // loop. Transparent to the operator -- if the refresh also fails
    // (e.g. the refresh JWT itself expired) we fall through to the
    // generic toast.
    function fetchReport(attemptedRefresh) {
      crFetchJson(buildUrl()).then(function (j) {
        if (!j || !j.ok) { showToast((j && j.error) || 'Could not load report'); return; }
        // The server returns a compact aggregation (byLocation + groups).
        // The renderers + crWhatsApp expect a nested shape (factories with
        // invoices[] inside). The server's factories field only carries
        // name + totals -- no per-invoice drill-down -- which made
        // factorySection blow up on f.invoices.map(...) with
        // "Cannot read properties of undefined (reading 'map')". Map
        // groups[] into the nested shape here, on the client, so we
        // don't have to change the worker or the leaderboard proxy.
        try { j = transformReport(j); } catch (e) {
          console.error('[check-delivery] transform failed', e);
          showToast('Could not load report: ' + ((e && e.message) || 'bad shape'));
          return;
        }
        state.report = j;
        state.step = 'report';
        renderReport();
      }).catch(function (e) {
        var status = e && e.status;
        if (status === 401 && !attemptedRefresh) {
          fetch(BASE + '/api/ceo/session/refresh', {
            method: 'POST',
            credentials: 'same-origin',
          }).then(function (ref) {
            if (ref && ref.ok) return fetchReport(true);
            // Refresh failed -- surface the original 401 message verbatim.
            showToast('Session expired. Please sign in again.');
          }).catch(function () {
            showToast('Session expired. Please sign in again.');
          });
          return;
        }
        // Non-401 errors: surface the real message from the server (or
        // the network / parse error). e.message is the human-readable
        // text the new crFetchJson builds.
        showToast('Could not load report: ' + ((e && e.message) || 'Network error'));
      });
    }
    fetchReport(false);
  };

  function statCard(label, val, kind) {
    return '<div class="cr-tot"><div class="cr-tot-lbl">' + escapeHtml(label) +
      '</div><div class="cr-tot-val ' + kind + '">' + Number(val || 0) + '</div></div>';
  }
  function miniStat(label, val, kind) {
    return ' <span class="cr-status ' + kind + '">' + Number(val || 0) + ' ' + escapeHtml(label) + '</span>';
  }
  function abayaRowHtml(a) {
    const when = a.timestamp ? new Date(a.timestamp).toLocaleString([], {
      timeZone: tz, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '';
    return '<div class="cr-abaya"><span>' + escapeHtml(a.code) +
      (when ? ' <span style="color:var(--tx3);font-size:10px">&middot; ' + escapeHtml(when) + '</span>' : '') +
      '</span><span class="cr-status ' + (a.status || '').toLowerCase() + '">' + escapeHtml(a.status || '\u2014') + '</span></div>';
  }
  function invoiceSection(inv) {
    if (inv.synthetic) {
      const rows = inv.abayas.map(abayaRowHtml).join('');
      return '<div class="cr-row"><div><span class="cr-inv-name">(no invoice)</span>' +
        '<span class="cr-tag">unassigned</span></div><div class="cr-mini">' +
        miniStat('Abayas', inv.totals.abayas, 'abayas') +
        miniStat('Delivered', inv.totals.delivered, 'delivered') +
        miniStat('Pending', inv.totals.pending, 'pending') +
        miniStat('Cancelled', inv.totals.cancelled, 'cancelled') +
        '</div></div><div style="background:var(--s1);border-top:1px solid var(--bd);padding:6px 12px">' + rows + '</div>';
    }
    const rows = inv.abayas.map(abayaRowHtml).join('');
    return '<div class="cr-row"><div><span class="cr-inv-name">' + escapeHtml(inv.no || '(no invoice)') + '</span>' +
      '<span class="cr-mini"> &middot; ' + inv.totals.abayas + ' abaya(s)</span></div><div class="cr-mini">' +
      miniStat('Delivered', inv.totals.delivered, 'delivered') +
      miniStat('Pending', inv.totals.pending, 'pending') +
      miniStat('Cancelled', inv.totals.cancelled, 'cancelled') +
      '</div></div><div style="background:var(--s1);border-top:1px solid var(--bd);padding:6px 12px">' + rows + '</div>';
  }
  function factorySection(f) {
    const head = '<div class="cr-section-h"><span>' + escapeHtml(f.name) +
      '<span class="cr-mini"> &middot; ' + f.totals.invoices + ' invoice(s) &middot; ' + f.totals.abayas + ' abaya(s)</span></span>' +
      '<span class="cr-mini">' +
      miniStat('Delivered', f.totals.delivered, 'delivered') +
      miniStat('Pending', f.totals.pending, 'pending') +
      miniStat('Cancelled', f.totals.cancelled, 'cancelled') +
      '</span></div>';
    const rows = f.invoices.map(invoiceSection).join('');
    return '<div class="cr-section">' + head + '<div class="cr-scroll">' + (rows || '<div class="cr-empty">No invoices</div>') + '</div></div>';
  }
  function cancelRowHtml(c) {
    const when = c.cancelledAt ? new Date(c.cancelledAt).toLocaleString([], {
      timeZone: tz, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '';
    const pieces = [];
    if (c.invoiceNo) pieces.push('Invoice <b>' + escapeHtml(c.invoiceNo) + '</b>');
    if (c.abayaCode) pieces.push('Abaya <b>' + escapeHtml(c.abayaCode) + '</b>');
    if (c.factory)   pieces.push('Factory <b>' + escapeHtml(c.factory) + '</b>');
    if (c.cancelledBy) pieces.push('By <b>' + escapeHtml(c.cancelledBy) + '</b>');
    if (c.reason)    pieces.push('<span style="color:var(--tx3)">' + escapeHtml(c.reason) + '</span>');
    return '<div class="cr-cancel-row"><div style="display:flex;flex-wrap:wrap;gap:8px">' +
      pieces.join(' &middot; ') + '</div><span class="cr-when">' + escapeHtml(when) + '</span></div>';
  }
  function renderReport() {
    const r = state.report; if (!r) return;
    const body = document.getElementById('cr-body');
    const sub  = document.getElementById('cr-sub');
    const acts = document.getElementById('cr-actions');
    const title = document.getElementById('cr-title');
    title.textContent = r.dateRange.sameDay ? 'Check Delivery Report' : 'Check Delivery Report (range)';
    sub.innerHTML = '<b>' + escapeHtml(r.dateRange.label) + '</b>' +
      ' &middot; <span style="color:var(--tx3)">Generated in ' + escapeHtml(r.timezone) + '</span>';

    // ---- Overall delivery summary (first thing the eye lands on) -----------
    // Five big cards: Invoices / Abayas / Delivered / Pending / Cancelled.
    // When a specific factory is picked, the headline is that factory's
    // slice; the per-factory cards below stay as a comparison.
    const t = r.totals;
    const isAll = !r.factory || r.factory === 'All' || r.factory === '' ||
      (r.factories && r.factories.length > 1);
    const summaryHeading = isAll
      ? 'Delivery summary &mdash; overall (all factories)'
      : 'Delivery summary &mdash; ' + escapeHtml(r.factory);
    const totalFactories = (r.factories || []).length;
    const overallHtml =
      '<div class="cr-section">' +
        '<div class="cr-section-h">' +
          '<span>' + summaryHeading +
            '<span class="cr-mini"> &middot; ' + totalFactories +
            (totalFactories === 1 ? ' factory' : ' factories') + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="cr-totals">' +
          statCard('Invoices', t.invoices, 'invoices') +
          statCard('Abayas', t.abayas, 'abayas') +
          statCard('Delivered', t.delivered, 'delivered') +
          statCard('Pending', t.pending, 'pending') +
          statCard('Cancelled', t.cancelled, 'cancelled') +
        '</div>' +
      '</div>';

    // ---- Per-factory drill-down (only when viewing "All") -------------------
    // When a single factory is picked, the headline IS that factory — no
    // need to repeat the per-factory card. When viewing All, the per-factory
    // cards give the CEO a one-line comparison.
    const factoriesHtml = (isAll && r.factories && r.factories.length)
      ? '<div class="cr-section">' +
          '<div class="cr-section-h"><span>By factory<span class="cr-mini"> &middot; pick one above to drill in</span></span></div>' +
          r.factories.map(factorySection).join('') +
        '</div>'
      : (r.factories && r.factories.length
          ? r.factories.map(factorySection).join('')
          : '<div class="cr-empty">No factory activity in this range.</div>');

    const cancelHtml = r.cancellations.length
      ? '<div class="cr-section"><div class="cr-section-h">Cancellations <span class="cr-mini">traceable to invoice / abaya code</span></div>' +
        '<div class="cr-cancel-list">' + r.cancellations.map(cancelRowHtml).join('') + '</div></div>'
      : '';
    body.innerHTML = overallHtml + factoriesHtml + cancelHtml;
    acts.innerHTML =
      '<button class="btn-close" onclick="crBack()">&#9664; Change Date</button>' +
      '<button class="btn-close" onclick="openCancelModal()">+ Record Cancellation</button>' +
      '<button class="btn-export" onclick="crWhatsApp()">&#128241; Send via WhatsApp</button>';
  }
  window.crBack = function () { state.step = 'calendar'; renderCalendar(); };

  window.crWhatsApp = function () {
    const r = state.report; if (!r) return;
    const t = r.totals;
    const lines = [];
    lines.push('*AbaYa Track \u2014 Check Delivery Report*');
    lines.push('_' + r.dateRange.label + '_');
    lines.push('_Generated in ' + r.timezone + '_');
    lines.push('');
    lines.push('*Totals*');
    lines.push('\u2022 Invoices: *' + t.invoices + '*');
    lines.push('\u2022 Abayas: *' + t.abayas + '*');
    lines.push('\u2022 Delivered: *' + t.delivered + '*');
    lines.push('\u2022 Pending: *' + t.pending + '*');
    lines.push('\u2022 Cancelled: *' + t.cancelled + '*');
    lines.push('');
    for (const f of r.factories) {
      lines.push('*' + f.name + '*');
      lines.push('  Invoices: ' + f.totals.invoices + ' \u2022 Abayas: ' + f.totals.abayas);
      lines.push('  Delivered: ' + f.totals.delivered + ' \u2022 Pending: ' + f.totals.pending + ' \u2022 Cancelled: ' + f.totals.cancelled);
      for (const inv of f.invoices) {
        const label = inv.synthetic ? '(no invoice)' : (inv.no || '(no invoice)');
        lines.push('   \u2022 ' + label + ' \u2014 ' + inv.totals.abayas + ' abaya(s)');
        for (const a of inv.abayas) {
          const when = a.timestamp ? new Date(a.timestamp).toLocaleString([], {
            timeZone: r.timezone, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
          }) : '';
          lines.push('       - ' + a.code + ' \u2014 ' + a.status + (when ? ' (' + when + ')' : ''));
        }
      }
      lines.push('');
    }
    if (r.cancellations.length) {
      lines.push('*Cancellations*');
      for (const c of r.cancellations) {
        const when = c.cancelledAt ? new Date(c.cancelledAt).toLocaleString([], {
          timeZone: r.timezone, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        }) : '';
        const parts = [];
        if (c.invoiceNo) parts.push('Invoice ' + c.invoiceNo);
        if (c.abayaCode) parts.push('Abaya ' + c.abayaCode);
        if (c.factory)   parts.push('Factory ' + c.factory);
        if (c.cancelledBy) parts.push('by ' + c.cancelledBy);
        if (c.reason)    parts.push('\u2014 ' + c.reason);
        lines.push('\u2022 ' + parts.join(' \u2022 ') + (when ? ' [' + when + ']' : ''));
      }
      lines.push('');
    }
    lines.push('_Sent from AbaYa Track CEO Dashboard_');
    const text = lines.join('\\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    showToast('WhatsApp opened with the report');
  };

  function openCancelModal() {
    const m = document.getElementById('modal-cancel');
    if (!m) return;
    const fac = document.getElementById('cn-factory');
    if (fac) fac.value = state.factory || (state.config && state.config.defaultFactory) || '';
    const msg = document.getElementById('cn-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    m.classList.add('open');
    setTimeout(function () {
      const inv = document.getElementById('cn-invoice');
      if (inv) inv.focus();
    }, 50);
  }
  window.openCancelModal = openCancelModal;
  function closeCancelModal() {
    const m = document.getElementById('modal-cancel');
    if (m) m.classList.remove('open');
  }
  window.closeCancelModal = closeCancelModal;
  window.submitCancellation = function () {
    const factory = String(document.getElementById('cn-factory').value || '').trim();
    const invoiceNo = String(document.getElementById('cn-invoice').value || '').trim();
    const abayaCode = String(document.getElementById('cn-abaya').value || '').trim();
    const reason = String(document.getElementById('cn-reason').value || '').trim();
    const cancelledBy = String(document.getElementById('cn-by').value || '').trim();
    const msg = document.getElementById('cn-msg');
    function showMsg(kind, text) {
      if (!msg) return;
      msg.className = 'cr-msg ' + kind;
      msg.textContent = text;
      msg.style.display = 'block';
    }
    if (!invoiceNo && !abayaCode) {
      showMsg('warn', 'Provide at least one of Invoice No or Abaya Code so the cancellation is traceable.');
      return;
    }
    fetch(BASE + '/api/cancellations', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        factory: factory || undefined,
        invoiceNo: invoiceNo || undefined,
        abayaCode: abayaCode || undefined,
        reason: reason || undefined,
        cancelledBy: cancelledBy || undefined,
      }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || !x.j || !x.j.ok) {
          showMsg('error', (x.j && x.j.error) || 'Could not save the cancellation');
          return;
        }
        showMsg('ok', 'Saved. Reloading the report\u2026');
        window.crSubmit();
        setTimeout(closeCancelModal, 800);
      }).catch(function () { showMsg('error', 'Network error while saving'); });
  };
})();
</script>

<!-- Check Delivery Report modal: calendar + per-factory delivery summary + record cancellation -->
<div class="modal-overlay" id="modal-check" role="dialog" aria-modal="true" aria-labelledby="cr-title">
  <div class="modal-box" style="max-width:780px">
    <div class="modal-title" id="cr-title">Check Delivery Report</div>
    <div class="modal-sub" id="cr-sub">Pick a single date or a range in the production timezone. Pick a factory to drill in, or leave on "All factories" for the overall summary.</div>
    <div id="cr-body" class="cr-wrap"></div>
    <div class="modal-actions" id="cr-actions">
      <button class="btn-close" onclick="closeCheckReport()">Close</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="modal-cancel" role="dialog" aria-modal="true" aria-labelledby="cn-title">
  <div class="modal-box" style="max-width:520px">
    <div class="modal-title" id="cn-title">Record Cancellation</div>
    <div class="modal-sub">Cancellation is a first-class operational state \u2014 a real record is required.</div>
    <form class="cr-form" onsubmit="event.preventDefault(); submitCancellation();">
      <label>Factory
        <input id="cn-factory" placeholder="Main Factory" autocomplete="off">
      </label>
      <div class="cr-form-hint">At least one of <b>Invoice</b> or <b>Abaya Code</b> is required so the cancellation stays traceable.</div>
      <label>Invoice No
        <input id="cn-invoice" placeholder="e.g. INV-2026-00128" autocomplete="off">
      </label>
      <label>Abaya Code
        <input id="cn-abaya" placeholder="e.g. ABY-00483" autocomplete="off">
      </label>
      <label>Reason
        <input id="cn-reason" placeholder="material defect, customer change, ..." autocomplete="off">
      </label>
      <label>Cancelled by
        <input id="cn-by" placeholder="e.g. Misbah" autocomplete="off">
      </label>
      <div id="cn-msg" class="cr-msg" style="display:none"></div>
      <div class="modal-actions" style="margin-top:4px">
        <button type="button" class="btn-close" onclick="closeCancelModal()">Cancel</button>
        <button type="submit" class="btn-export" style="background:linear-gradient(135deg,#6a5fc1,#422082)">Save Cancellation</button>
      </div>
    </form>
  </div>
</div>
</body>
</html>`;
}

// ─── LEGAL PAGES (public — no auth) ───────────────────────────────────────────
// Served for OAuth/Login dialog review (e.g. Meta App Review) and end users.
// Privacy policy: /privacy   Terms of Service: /terms
const LEGAL_BUSINESS = 'FarewellAbaya';
const LEGAL_EMAIL = 'info@farewellabaya.com';
const LEGAL_UPDATED = 'June 3, 2026';

function legalShell(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} &mdash; ${LEGAL_BUSINESS}</title>
<meta name="robots" content="index,follow">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#1f1633;color:#ece9f5;font-family:-apple-system,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.65;padding:0}
  .wrap{max-width:780px;margin:0 auto;padding:48px 22px 96px}
  header{border-bottom:1px solid rgba(106,95,193,.3);padding-bottom:22px;margin-bottom:30px}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}
  .logo{width:42px;height:42px;background:linear-gradient(135deg,#6a5fc1,#422082);border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:22px}
  .brand b{font-size:17px;font-weight:700}
  h1{font-size:27px;font-weight:800;letter-spacing:-.01em}
  .updated{color:#9c98b0;font-size:13px;margin-top:8px}
  h2{font-size:18px;font-weight:700;margin:30px 0 10px;color:#fff}
  p,li{color:#c9c4dc;font-size:15px;margin:10px 0}
  ul{padding-left:22px}
  a{color:#9d8bff;text-decoration:none}
  a:hover{text-decoration:underline}
  .box{background:rgba(255,255,255,.05);border:1px solid rgba(106,95,193,.25);border-radius:14px;padding:16px 18px;margin:18px 0}
  footer{margin-top:40px;border-top:1px solid rgba(106,95,193,.3);padding-top:18px;color:#807c95;font-size:13px}
  footer a{color:#9c98b0}
</style></head><body>
<div class="wrap">
  <header>
    <div class="brand"><div class="logo">&#129525;</div><b>${LEGAL_BUSINESS}</b></div>
    <h1>${title}</h1>
    <div class="updated">Last updated: ${LEGAL_UPDATED}</div>
  </header>
  ${bodyHtml}
  <footer>
    &copy; ${LEGAL_BUSINESS}. Contact: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>
    &middot; <a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms of Service</a>
  </footer>
</div>
</body></html>`;
}

export function getPrivacyPolicyPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Privacy, in plain words &mdash; ${LEGAL_BUSINESS}</title>
<meta name="robots" content="index,follow">
<meta name="description" content="The honest, no-jargon version of how FarewellAbaya handles your data.">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#160f24;color:#ece9f5;font-family:-apple-system,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}
  .wrap{max-width:680px;margin:0 auto;padding:54px 22px 90px}
  .brand{display:flex;align-items:center;gap:11px;margin-bottom:34px}
  .brand .logo{width:40px;height:40px;background:linear-gradient(135deg,#7c6fe0,#422082);border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:21px}
  .brand b{font-size:16px;font-weight:700}
  .eyebrow{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:#a89fd0;margin-bottom:10px}
  h1{font-size:34px;line-height:1.15;font-weight:800;letter-spacing:-.02em;margin-bottom:12px;background:linear-gradient(95deg,#fff,#c9b8ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .lede{color:#b9b3d2;font-size:16.5px;margin-bottom:6px}
  .updated{color:#7d779a;font-size:13px;margin-bottom:30px}
  /* TL;DR */
  .tldr{background:linear-gradient(160deg,rgba(124,111,224,.16),rgba(124,111,224,.04));border:1px solid rgba(150,130,220,.3);border-radius:18px;padding:24px 24px 8px;margin:8px 0 40px}
  .tldr h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#c9b8ff;margin-bottom:14px}
  .tldr .row{display:flex;gap:13px;align-items:flex-start;margin-bottom:16px}
  .tldr .ico{font-size:21px;line-height:1.3;flex:0 0 auto}
  .tldr .row p{margin:0;font-size:15.5px;color:#e7e3f5}
  .tldr .row b{color:#fff}
  section{margin:0 0 30px}
  h3{font-size:20px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;align-items:center;gap:9px}
  h3 .e{font-size:20px}
  p,li{color:#c5c0db;font-size:15.5px;margin:9px 0}
  ul{padding-left:6px;list-style:none}
  ul li{position:relative;padding-left:22px}
  ul li::before{content:'\\2014';position:absolute;left:0;color:#8a7fd0}
  b{color:#efecfb}
  a{color:#a89fd0;text-decoration:none;border-bottom:1px solid rgba(168,159,208,.4)}
  a:hover{color:#fff}
  .delete{background:rgba(124,111,224,.1);border:1px dashed rgba(150,130,220,.45);border-radius:16px;padding:20px 22px;margin:6px 0}
  .delete p{margin-top:0}
  .big-btn{display:inline-block;margin-top:6px;background:linear-gradient(135deg,#7c6fe0,#5a3fb0);color:#fff;border-bottom:0;padding:11px 18px;border-radius:11px;font-weight:700;font-size:14.5px}
  .big-btn:hover{filter:brightness(1.08);color:#fff}
  footer{margin-top:44px;border-top:1px solid rgba(106,95,193,.25);padding-top:20px;color:#7d779a;font-size:13px}
  footer a{color:#a89fd0;border-bottom:0}
  hr{border:0;border-top:1px solid rgba(106,95,193,.18);margin:34px 0}
</style></head><body>
<div class="wrap">
  <div class="brand"><div class="logo">&#129525;</div><b>${LEGAL_BUSINESS}</b></div>

  <div class="eyebrow">Privacy Policy</div>
  <h1>Your data, in plain words.</h1>
  <p class="lede">No 40-page maze, no hidden clauses. Here's exactly what we see, what we do with it, and how to make it disappear &mdash; in about 60 seconds.</p>
  <div class="updated">Last updated: ${LEGAL_UPDATED}</div>

  <div class="tldr">
    <h2>The 10-second version</h2>
    <div class="row"><div class="ico">&#128075;</div><p><b>We see your name and email</b> &mdash; just enough to know it's you when you log in.</p></div>
    <div class="row"><div class="ico">&#128683;</div><p><b>We never sell it.</b> No ads, no data brokers, no funny business.</p></div>
    <div class="row"><div class="ico">&#128274;</div><p><b>It's encrypted</b> on the way to us and locked behind your access code.</p></div>
    <div class="row"><div class="ico">&#128465;&#65039;</div><p><b>Want out?</b> One email and everything about you is gone within 30 days.</p></div>
  </div>

  <section>
    <h3><span class="e">&#128064;</span> What we actually collect</h3>
    <ul>
      <li><b>Who you are:</b> when you sign in &mdash; including with <b>Facebook Login (Meta)</b> &mdash; we get the basics you approve: your name, email, and an ID that lets us recognize you next time.</li>
      <li><b>What you do in the app:</b> the orders, garments, and production updates you or your team enter. That's the whole point of the dashboard.</li>
      <li><b>The technical stuff:</b> things like your IP address and timestamps, kept briefly to keep the app secure and running.</li>
    </ul>
  </section>

  <section>
    <h3><span class="e">&#9881;&#65039;</span> What we do with it</h3>
    <p>Honestly, not much beyond running the app: we use it to <b>log you in</b>, <b>show you your dashboard</b>, and <b>keep things secure</b>. That's it.</p>
    <p>What we'll <b>never</b> do: sell it, rent it, or use it to follow you around the internet with ads.</p>
  </section>

  <section>
    <h3><span class="e">&#128241;</span> About signing in with Facebook</h3>
    <p>If you use Facebook to log in, we ask for the bare minimum &mdash; usually your <b>public profile and email</b> &mdash; and we use it only to confirm it's really you. We don't post anything, and we can't see anything you didn't tick "yes" to in the Facebook dialog. (Meta's own rules apply there too.)</p>
  </section>

  <section>
    <h3><span class="e">&#129309;</span> Who else sees it</h3>
    <p>Only the trusted services that help us run the app (like our host, <b>Cloudflare</b>) &mdash; and only as much as they need. The one exception: if the law genuinely requires it. No marketing partners, ever.</p>
  </section>

  <section>
    <h3><span class="e">&#9203;</span> How long we keep it</h3>
    <p>Only as long as you're using the Service (plus a little extra if the law says so). After that, it's deleted or anonymized.</p>
  </section>

  <section>
    <h3><span class="e">&#128465;&#65039;</span> Delete everything &mdash; anytime</h3>
    <div class="delete">
      <p><b>It's your data. Here's the off switch:</b> email us from the address on your account (or tell us the name you used with Facebook Login) with the subject <b>"Delete my data"</b>. We'll wipe your personal data within <b>30 days</b> and email you to confirm.</p>
      <a class="big-btn" href="mailto:${LEGAL_EMAIL}?subject=Delete%20my%20data">&#9993;&#65039; Request deletion</a>
    </div>
    <p>You can also just ask to <b>see</b> or <b>fix</b> what we hold &mdash; same address, we're happy to help.</p>
  </section>

  <hr>

  <section>
    <h3><span class="e">&#128272;</span> Keeping it safe</h3>
    <p>We use solid, industry-standard protection: encrypted connections (HTTPS) and access controls. No system on earth is 100% bulletproof, but we treat your data like it's our own.</p>
  </section>

  <section>
    <h3><span class="e">&#129516;</span> A few honest footnotes</h3>
    <ul>
      <li><b>Not for kids:</b> this is a business tool, not meant for anyone under 13, and we don't knowingly collect their info.</li>
      <li><b>If this changes:</b> we'll update the date at the top. Big changes, we'll make obvious.</li>
      <li><b>Got a question?</b> A real person reads <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</li>
    </ul>
  </section>

  <footer>
    &copy; ${LEGAL_BUSINESS} &middot; <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>
    &middot; <a href="/terms">Terms of Service</a> &middot; <a href="/">Home</a>
  </footer>
</div>
</body></html>`;
}

export function getTermsOfServicePage() {
  return legalShell('Terms of Service', `
  <p>These Terms of Service ("Terms") govern your access to and use of the ${LEGAL_BUSINESS}
  production tracking and dashboard service (the "Service"). By accessing or using the Service,
  including by signing in, you agree to these Terms.</p>

  <h2>1. Use of the Service</h2>
  <p>The Service is provided for authorized business users to track and manage abaya production,
  orders, and dispatch. You agree to use it only for lawful purposes and in accordance with these
  Terms.</p>

  <h2>2. Accounts &amp; login</h2>
  <p>You may sign in using credentials we issue or via a third-party provider such as Facebook
  Login. You are responsible for activity under your account and for keeping your access
  credentials confidential. Notify us promptly of any unauthorized use.</p>

  <h2>3. Acceptable use</h2>
  <ul>
    <li>Do not attempt to gain unauthorized access to the Service or its data.</li>
    <li>Do not interfere with, disrupt, or overload the Service.</li>
    <li>Do not use the Service to store or transmit unlawful or infringing content.</li>
  </ul>

  <h2>4. Intellectual property</h2>
  <p>The Service, including its software, design, and content, is owned by ${LEGAL_BUSINESS} and
  its licensors and is protected by applicable laws. These Terms do not grant you any rights to
  our trademarks or branding.</p>

  <h2>5. Data</h2>
  <p>Our handling of personal data is described in our
  <a href="/privacy">Privacy Policy</a>, which forms part of these Terms.</p>

  <h2>6. Disclaimers</h2>
  <p>The Service is provided "as is" and "as available" without warranties of any kind, whether
  express or implied, including merchantability, fitness for a particular purpose, and
  non-infringement, to the maximum extent permitted by law.</p>

  <h2>7. Limitation of liability</h2>
  <p>To the maximum extent permitted by law, ${LEGAL_BUSINESS} will not be liable for any
  indirect, incidental, special, consequential, or punitive damages, or any loss of data,
  revenue, or profits arising from your use of the Service.</p>

  <h2>8. Termination</h2>
  <p>We may suspend or terminate access to the Service at any time if you violate these Terms or
  to protect the Service. You may stop using the Service at any time.</p>

  <h2>9. Changes to these Terms</h2>
  <p>We may update these Terms from time to time. Continued use of the Service after changes take
  effect constitutes acceptance of the updated Terms.</p>

  <h2>10. Contact us</h2>
  <p>Questions about these Terms: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>
  `);
}
