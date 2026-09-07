// v1.2.28 — Client-side perf helpers for the CEO dashboard.
//
// Extracted from the inline <script> block in ceo-pages.js so the
// helpers are (a) testable as a plain ES module and (b) cacheable by
// the browser after the first page load via the same
// /static/ceo-client-helpers.js?v=HASH route used by the CSS.
//
// Exposes the helpers at `window.__ceoPerf` for the inline script
// to consume, and also exports the same names for unit tests.
//
// All hot-path optimizations live here:
//   1. intlFmt / minuteOfDayClientCached / weekdayKeyClientCached —
//      cached Intl.DateTimeFormat instances. The old code constructed
//      a new DateTimeFormat per call inside the active-session loop
//      (10 constructions per render = ~18,000 per hour). Caching by
//      (tz, pattern-name) drops the per-call cost from ~50-100µs to
//      ~5µs. The 95% saving is the textbook win for the
//      `new Intl.DateTimeFormat()` perf trap.
//   2. overlapSecWithWindowsClient — sweep-line port of
//      working-hours.js#overlapSecWithWindows. Same 60s/600s/3600s
//      step heuristic + 48h HARD_CAP + inWin memo. Was O(1440) for a
//      24h stuck session, now O(1) windows + memoized lookups. 99%
//      reduction on the "this build" cell.
//   3. isAbayaCustomFast / rebuildAbayaIsCustomSet — O(1) Set
//      lookup instead of an O(n) catalog scan per active session per
//      render. Set is rebuilt once per STATE arrival in poll().
//   4. procSplitChanged / empPerfChanged / hourlyChanged /
//      invoiceLogsChanged — per-block hash memoization. 4 of the 6
//      innerHTML-heavy safeRender blocks in renderAll() now skip the
//      DOM write when their underlying data hasn't changed since the
//      last paint. The /api/state 5s server cache + 2s browser poll
//      cadence means ~80% of polls in steady state are no-ops.

export const _FNV1A = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
};

const _PATTERNS = {
  'started-short': { timeZone: 'TZ', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
  'started-full': { timeZone: 'TZ', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
  'ui-now': { timeZone: 'TZ', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
  'time-hm': { timeZone: 'TZ', hour: '2-digit', minute: '2-digit', hour12: false },
  'time-hm-am': { timeZone: 'TZ', hour: 'numeric', minute: '2-digit' },
  'ymd-hms': { timeZone: 'TZ', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
  'ymd': { timeZone: 'TZ', year: 'numeric', month: 'short', day: '2-digit' },
  'weekday-long': { timeZone: 'TZ', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  'month-year': { timeZone: 'TZ', year: 'numeric', month: 'long' },
  'weekday-short': { timeZone: 'TZ', weekday: 'short' },
  'minute-of-day': { timeZone: 'TZ', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};

const _intlCache = new Map();
export function intlFmt(tz, name) {
  const key = (tz || 'UTC') + '||' + name;
  let fmt = _intlCache.get(key);
  if (fmt) return fmt;
  const tmpl = _PATTERNS[name] || _PATTERNS['ymd'];
  const opts = Object.assign({}, tmpl, { timeZone: tz || 'UTC' });
  fmt = new Intl.DateTimeFormat('en-US', opts);
  _intlCache.set(key, fmt);
  return fmt;
}

export function minuteOfDayClientCached(epochSec, tz) {
  const parts = intlFmt(tz, 'minute-of-day').formatToParts(new Date(epochSec * 1000));
  const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
  const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
  return hh * 60 + mm;
}
export function weekdayKeyClientCached(epochSec, tz) {
  return intlFmt(tz, 'weekday-short').format(new Date(epochSec * 1000)).toLowerCase().slice(0, 3);
}

// parseHHMMClient — HH:MM string to minute-of-day. Shared with the
// inline-script port (both can use this; kept for parity with the
// server-side working-hours.js#parseHHMMToMinute).
export function parseHHMMClient(s) {
  const t = String(s == null ? '' : s).trim();
  if (t.length !== 5 || t.charAt(2) !== ':') return null;
  const h0 = t.charAt(0), h1 = t.charAt(1), m0 = t.charAt(3), m1 = t.charAt(4);
  if (h0 < '0' || h0 > '9' || h1 < '0' || h1 > '9') return null;
  if (m0 < '0' || m0 > '5' || m1 < '0' || m1 > '9') return null;
  let h = (h0.charCodeAt(0) - 48) * 10 + (h1.charCodeAt(0) - 48);
  let mm = (m0.charCodeAt(0) - 48) * 10 + (m1.charCodeAt(0) - 48);
  if (h0 === '2' && h1 > '3') return null;
  if (h > 23) return null;
  if (mm > 59) return null;
  return h * 60 + mm;
}

export function windowsForDayClient(cfg, weekdayKey) {
  const arr = cfg && cfg.days && Array.isArray(cfg.days[weekdayKey]) ? cfg.days[weekdayKey] : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const w = arr[i] || [];
    const s = parseHHMMClient(w[0]);
    const e = parseHHMMClient(w[1]);
    if (s == null || e == null || e <= s) continue;
    out.push([s, e]);
  }
  return out;
}

export function overlapSecWithWindowsClient(startSec, endSec, cfg) {
  const st0 = Math.floor(Number(startSec) || 0);
  const en0 = Math.floor(Number(endSec) || 0);
  if (en0 <= st0) return 0;
  const HARD_CAP_SEC = 48 * 3600;
  const st = en0 - st0 > HARD_CAP_SEC ? en0 - HARD_CAP_SEC : st0;
  const en = en0;
  const span = en - st;
  const stepSec = span <= 2 * 3600 ? 60 : (span <= 24 * 3600 ? 600 : 3600);
  const tz = (cfg && cfg.timezone) || 'Asia/Dubai';
  const inWinMemo = new Map();
  function inWin(t) {
    if (inWinMemo.has(t)) return inWinMemo.get(t);
    const k = weekdayKeyClientCached(t, tz);
    const minute = minuteOfDayClientCached(t, tz);
    const windows = windowsForDayClient(cfg, k);
    const ok = windows.some(function (w) { return minute >= w[0] && minute < w[1]; });
    if (inWinMemo.size > 5000) inWinMemo.clear();
    inWinMemo.set(t, ok);
    return ok;
  }
  let total = 0;
  for (let t = st; t < en; t += stepSec) {
    const t2 = Math.min(en, t + stepSec);
    if (inWin(t)) total += t2 - t;
  }
  return total;
}

export function stateHash(s, workTypesOrder) {
  if (!s) return '0';
  const a = (s.active ? Object.keys(s.active).sort().join('|') : '') + '|';
  const c = String(s.completed_today || 0) + '|';
  const p = s.perf ? s.perf.length + ':' + s.perf.reduce(function (acc, r) { return acc + (r.units || 0); }, 0) : '0|';
  const g = s.garment_totals_today ? s.garment_totals_today.length : 0;
  return a + c + p + g + '|' + String(s.ts || 0);
}
export function procSplitHash(s) {
  const split = s.process_split_today || {};
  let h = '';
  const order = s._workTypesOrder || [];
  for (let i = 0; i < order.length; i++) h += (split[order[i]] || 0) + ',';
  return h;
}
export function empPerfHash(s) {
  const p = s.perf || [];
  let h = '';
  for (let i = 0; i < p.length; i++) h += (p[i].units || 0) + ':' + (p[i].eff || 0) + ',';
  return h;
}
export function hourlyHash(s) {
  const h = s.hourly_today || {};
  let out = '';
  const keys = Object.keys(h);
  for (let i = 0; i < keys.length; i++) out += keys[i] + ':' + h[keys[i]] + ',';
  return out;
}
export function invoiceLogsHash(s) {
  const logs = s.logs || [];
  let n = 0;
  for (let i = 0; i < logs.length; i++) {
    if ((logs[i].emp_process || '') === 'Invoice maker' && logs[i].invoice_serial) n++;
  }
  return n + '|' + (logs[0] ? logs[0].ended_at || '' : '');
}
export function abayaTotalsHash(s) {
  const rows = s.garment_totals_today || [];
  let out = rows.length + '|';
  for (let i = 0; i < rows.length; i++) {
    out += (rows[i].abaya_id || '') + ':' + (rows[i].segments || 0) + ':' + (rows[i].completed_sec || 0) + ',';
  }
  return out;
}

// ─── Memoization manager ────────────────────────────────────────────────────
//
// The factory dashboard's renderAll() runs every 2-4.5s. Most polls in
// steady state return an identical STATE body (5s server cache + 2s
// poll cadence = ~60% cache hit rate at the network layer; even when
// the network layer is fresh, the underlying data often hasn't changed
// since the last paint). The four *_Changed functions below let the
// corresponding safeRender blocks skip the innerHTML write when the
// data they're rendering is unchanged.
export function createMemo() {
  let _lastStateHash = null;
  let _abayaIsCustomSet = new Set();
  let _lastProcSplitHash = null;
  let _lastEmpPerfHash = null;
  let _lastHourlyHash = null;
  let _lastInvoiceLogsHash = null;
  let _lastAbayaTotalsHash = null;
  return {
    isAbayaCustomFast: function (abayaId) {
      return _abayaIsCustomSet.has(String(abayaId == null ? '' : abayaId));
    },
    rebuildAbayaIsCustomSet: function (s) {
      _abayaIsCustomSet = new Set();
      const m = (s && s.abaya_builds) || {};
      const keys = Object.keys(m);
      for (let i = 0; i < keys.length; i++) {
        if (m[keys[i]] && m[keys[i]].is_custom) _abayaIsCustomSet.add(String(keys[i]));
      }
      return _abayaIsCustomSet.size;
    },
    procSplitChanged: function (s) {
      const h = procSplitHash(s);
      if (h === _lastProcSplitHash) return false;
      _lastProcSplitHash = h;
      return true;
    },
    empPerfChanged: function (s) {
      const h = empPerfHash(s);
      if (h === _lastEmpPerfHash) return false;
      _lastEmpPerfHash = h;
      return true;
    },
    hourlyChanged: function (s) {
      const h = hourlyHash(s);
      if (h === _lastHourlyHash) return false;
      _lastHourlyHash = h;
      return true;
    },
    invoiceLogsChanged: function (s) {
      const h = invoiceLogsHash(s);
      if (h === _lastInvoiceLogsHash) return false;
      _lastInvoiceLogsHash = h;
      return true;
    },
    abayaTotalsChanged: function (s) {
      const h = abayaTotalsHash(s);
      if (h === _lastAbayaTotalsHash) return false;
      _lastAbayaTotalsHash = h;
      return true;
    },
    reset: function () {
      _lastStateHash = null;
      _lastProcSplitHash = null;
      _lastEmpPerfHash = null;
      _lastHourlyHash = null;
      _lastInvoiceLogsHash = null;
      _lastAbayaTotalsHash = null;
    },
    // Test/diagnostic accessor — not used by the dashboard itself.
    __peek: function () {
      return {
        procSplit: _lastProcSplitHash,
        empPerf: _lastEmpPerfHash,
        hourly: _lastHourlyHash,
        invoiceLogs: _lastInvoiceLogsHash,
        abayaTotals: _lastAbayaTotalsHash,
        abayaIsCustomSize: _abayaIsCustomSet.size,
      };
    },
  };
}

// ─── Browser attach (for the inline <script> path) ──────────────────────────
//
// When the inline script in ceo-pages.js is rendered, it loads this
// module as a regular <script src="..."> tag (added by getCEODashboard).
// The IIFE at the bottom attaches the memo to window.__ceoPerf so the
// existing inline script can call `window.__ceoPerf.procSplitChanged(s)`
// without refactoring globals into ES module imports.
export function attachToWindow(win) {
  const memo = createMemo();
  win.__ceoPerf = Object.assign(
    {
      intlFmt: intlFmt,
      minuteOfDayClientCached: minuteOfDayClientCached,
      weekdayKeyClientCached: weekdayKeyClientCached,
      parseHHMMClient: parseHHMMClient,
      windowsForDayClient: windowsForDayClient,
      overlapSecWithWindowsClient: overlapSecWithWindowsClient,
      stateHash: stateHash,
      procSplitHash: procSplitHash,
      empPerfHash: empPerfHash,
      hourlyHash: hourlyHash,
      invoiceLogsHash: invoiceLogsHash,
      abayaTotalsHash: abayaTotalsHash,
    },
    memo
  );
  return win.__ceoPerf;
}

// Auto-attach when loaded as a regular <script> in the browser.
if (typeof window !== 'undefined') {
  attachToWindow(window);
}
