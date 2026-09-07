// v1.2.28 — Static asset module for the CEO dashboard.
//
// v1.2.28 lifts the dashboard's 25 KB inline <style> block out of the HTML
// response and serves it from a separate Worker route (/static/ceo.css) with
// an immutable cache header. After the first page load the browser hits
// disk for the CSS and the HTML response shrinks by ~25 KB.
//
// The CSS body is byte-identical to the previous inline block. Any character
// difference would surface as a visual regression, so the value here is the
// exact text that used to sit between <style> and </style> in getCEODashboard
// (ceo-pages.js, lines 145-387). Future CSS edits land here and bump
// DASHBOARD_CSS_VERSION.
//
// DASHBOARD_HTML_VERSION is a human-readable stamp bumped on every Worker
// deploy. The CEO HTML ETag is derived from this + the CSS version + the
// request origin, so the browser's If-None-Match → 304 round-trip
// collapses the 200 KB HTML response to a few-headers response on
// every page refresh.

export const DASHBOARD_HTML_VERSION = '1.2.28';

export const DASHBOARD_CSS_BODY = `:root{--bg:#1f1633;--s1:#150f23;--s2:#241a38;--s3:#362d59;--bd:rgba(54,45,89,.5);--bd2:rgba(106,95,193,.3);--tx:#ffffff;--tx2:#e5e7eb;--tx3:#9c98b0;--gr:#c2ef4e;--grb:rgba(194,239,78,.12);--rd:#ef4444;--rdb:rgba(239,68,68,.12);--bl:#6a5fc1;--blb:rgba(106,95,193,.15);--am:#ffb287;--amb:rgba(255,178,135,.12);--pu:#a78bfa;--fn:'Rubik',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;--fn-display:'Sora','Rubik',sans-serif;--fn-mono:Monaco,Menlo,'Ubuntu Mono',monospace}
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
@media(max-width:600px){.cr-totals{grid-template-columns:repeat(2,1fr)}.cr-row{grid-template-columns:1fr}}`;

function _fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

// Content hash (FNV-1a 32-bit) used as the cache-busting query string on
// the <link> href. With Cache-Control: immutable the browser never
// refetches as long as the URL stays the same — and the URL changes
// whenever the CSS content changes.
export const DASHBOARD_CSS_VERSION = _fnv1a(DASHBOARD_CSS_BODY);

/** URL of the external CSS file, with cache-busting query string. */
export function dashboardCssHref() {
  return '/static/ceo.css?v=' + DASHBOARD_CSS_VERSION;
}

/**
 * Weak ETag for the CEO HTML response, derived from:
 *   - DASHBOARD_HTML_VERSION (bumped on every deploy)
 *   - DASHBOARD_CSS_VERSION (changes when the CSS body changes)
 *   - fnv1a(origin) (changes per request origin)
 *
 * The ETag changes on every deploy (because HTML_VERSION is bumped) and
 * per origin, so the browser's If-None-Match → 304 round-trip collapses
 * the 200 KB HTML response to a few-headers response on every page
 * refresh from the same user / same origin / same deploy.
 */
export function getDashboardHtmlEtag(origin) {
  return 'W/"' + DASHBOARD_HTML_VERSION + '-' + DASHBOARD_CSS_VERSION + '-' + _fnv1a(String(origin || '')) + '"';
}
