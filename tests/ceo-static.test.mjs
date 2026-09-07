// v1.2.28 — tests for the dashboard static-asset module
// (cloudflare/src/ui/ceo-static.js) and the client-perf helpers
// (cloudflare/src/ui/ceo-client-helpers.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DASHBOARD_CSS_BODY,
  DASHBOARD_CSS_VERSION,
  DASHBOARD_HTML_VERSION,
  dashboardCssHref,
  getDashboardHtmlEtag,
} from '../cloudflare/src/ui/ceo-static.js';
import {
  intlFmt,
  minuteOfDayClientCached,
  weekdayKeyClientCached,
  parseHHMMClient,
  windowsForDayClient,
  overlapSecWithWindowsClient,
  stateHash,
  procSplitHash,
  empPerfHash,
  hourlyHash,
  invoiceLogsHash,
  abayaTotalsHash,
  createMemo,
  attachToWindow,
} from '../cloudflare/src/ui/ceo-client-helpers.js';

const REPO = path.join(import.meta.dirname, '..');
const SRC = path.join(REPO, 'cloudflare', 'src', 'ui', 'ceo-pages.js');
const HELPERS_SRC = path.join(REPO, 'cloudflare', 'src', 'ui', 'ceo-client-helpers.js');

test('DASHBOARD_HTML_VERSION is set to 1.2.28', () => {
  assert.equal(DASHBOARD_HTML_VERSION, '1.2.28');
});

test('DASHBOARD_CSS_BODY is non-empty CSS', () => {
  assert.ok(DASHBOARD_CSS_BODY.length > 1000, 'CSS body is suspiciously small');
  assert.ok(DASHBOARD_CSS_BODY.includes('--bg:'));
  assert.ok(DASHBOARD_CSS_BODY.includes('.stat-card'));
  assert.ok(DASHBOARD_CSS_BODY.includes('@media'));
});

test('DASHBOARD_CSS_VERSION is 8 hex chars', () => {
  assert.match(DASHBOARD_CSS_VERSION, /^[0-9a-f]{8}$/);
});

test('dashboardCssHref returns a versioned URL', () => {
  const href = dashboardCssHref();
  assert.match(href, /^\/static\/ceo\.css\?v=[0-9a-f]{8}$/);
  assert.ok(href.endsWith('=' + DASHBOARD_CSS_VERSION));
});

test('getDashboardHtmlEtag is deterministic and per-origin', () => {
  const a1 = getDashboardHtmlEtag('https://dashboard.farewellabaya.com');
  const a2 = getDashboardHtmlEtag('https://dashboard.farewellabaya.com');
  const b = getDashboardHtmlEtag('https://example.com');
  assert.equal(a1, a2, 'same origin → same ETag');
  assert.notEqual(a1, b, 'different origin → different ETag');
  assert.match(a1, /^W\/"1\.2\.28-[0-9a-f]{8}-[0-9a-f]{8}"$/);
});

test('getDashboardHtmlEtag includes both versions', () => {
  const etag = getDashboardHtmlEtag('https://x');
  assert.ok(etag.includes(DASHBOARD_HTML_VERSION));
  assert.ok(etag.includes(DASHBOARD_CSS_VERSION));
});

test('intlFmt caches per (tz, name) — second call returns the same instance', () => {
  const a = intlFmt('Asia/Dubai', 'started-short');
  const b = intlFmt('Asia/Dubai', 'started-short');
  assert.equal(a, b, 'same key → same formatter');
  const c = intlFmt('Asia/Dubai', 'started-full');
  assert.notEqual(a, c, 'different name → different formatter');
  const d = intlFmt('UTC', 'started-short');
  assert.notEqual(a, d, 'different tz → different formatter');
});

test('intlFmt format output matches toLocaleString for the same options', () => {
  const fmt = intlFmt('Asia/Dubai', 'started-short');
  const d = new Date(1735689600000);
  const expected = d.toLocaleString('en-US', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  assert.equal(fmt.format(d), expected);
});

test('minuteOfDayClientCached returns 0..1439 for tz-local time', () => {
  // 2026-01-01 00:00:00 UTC = 04:00:00 Asia/Dubai
  const epoch = Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000);
  assert.equal(minuteOfDayClientCached(epoch, 'Asia/Dubai'), 4 * 60);
  // 2026-01-01 12:00:00 UTC = 16:00:00 Asia/Dubai
  const epoch2 = Math.floor(Date.UTC(2026, 0, 1, 12, 0, 0) / 1000);
  assert.equal(minuteOfDayClientCached(epoch2, 'Asia/Dubai'), 16 * 60);
});

test('weekdayKeyClientCached returns 3-letter lowercase', () => {
  const sunday = Math.floor(Date.UTC(2026, 0, 4, 12, 0, 0) / 1000);
  assert.equal(weekdayKeyClientCached(sunday, 'UTC'), 'sun');
  const saturday = Math.floor(Date.UTC(2026, 0, 3, 12, 0, 0) / 1000);
  assert.equal(weekdayKeyClientCached(saturday, 'UTC'), 'sat');
});

// ─────────────────────────────────────────────────────────────────────────
// Sweep-line overlapSecWithWindowsClient — must match the minute-walk for
// the same range so v1.2.28 is a behavior-preserving optimization.
// ─────────────────────────────────────────────────────────────────────────

const DAILY_9_TO_5 = {
  timezone: 'Asia/Dubai',
  days: {
    sun: [['09:00', '17:00']],
    mon: [['09:00', '17:00']],
    tue: [['09:00', '17:00']],
    wed: [['09:00', '17:00']],
    thu: [['09:00', '17:00']],
    fri: [],
    sat: [['09:00', '17:00']],
  },
};
const DAILY_FRI_3_TO_11 = {
  timezone: 'Asia/Dubai',
  days: {
    sun: [], mon: [], tue: [], wed: [], thu: [],
    fri: [['15:00', '23:00']],
    sat: [],
  },
};

// Reference: the OLD minute-walk the dashboard used to run, without
// any HARD_CAP clamp. Verifies the sweep-line matches for short
// ranges AND demonstrates that the clamp is the new behavior for
// very long ranges.
function oldMinuteWalk(startSec, endSec, cfg) {
  if (endSec <= startSec) return 0;
  const tz = (cfg && cfg.timezone) || 'Asia/Dubai';
  let total = 0;
  for (let t = startSec; t < endSec; t += 60) {
    const t2 = Math.min(endSec, t + 60);
    const d = new Date(t * 1000);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d).toLowerCase().slice(0, 3);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
    const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
    const minute = hh * 60 + mm;
    const arr = cfg.days[wd] || [];
    for (const w of arr) {
      const s = parseHHMMClient(w[0]);
      const e = parseHHMMClient(w[1]);
      if (s != null && e != null && minute >= s && minute < e) {
        total += t2 - t;
        break;
      }
    }
  }
  return total;
}

test('overlapSecWithWindowsClient matches old minute-walk for a 1h weekday range', () => {
  // 2026-01-05 (Mon) 10:00–11:00 Asia/Dubai = 06:00–07:00 UTC
  const start = Math.floor(Date.UTC(2026, 0, 5, 6, 0, 0) / 1000);
  const end = Math.floor(Date.UTC(2026, 0, 5, 7, 0, 0) / 1000);
  const fast = overlapSecWithWindowsClient(start, end, DAILY_9_TO_5);
  const slow = oldMinuteWalk(start, end, DAILY_9_TO_5);
  assert.equal(fast, slow, 'sweep-line and minute-walk should match');
  assert.equal(fast, 3600, 'full hour inside 9-17 window');
});

test('overlapSecWithWindowsClient returns 0 for an empty range', () => {
  const t = Math.floor(Date.UTC(2026, 0, 5, 12, 0, 0) / 1000);
  assert.equal(overlapSecWithWindowsClient(t, t, DAILY_9_TO_5), 0);
  assert.equal(overlapSecWithWindowsClient(t + 1, t, DAILY_9_TO_5), 0);
});

test('overlapSecWithWindowsClient handles a multi-day range', () => {
  // 2026-01-04 (Sun) 22:00 → 2026-01-05 (Mon) 12:00 Asia/Dubai
  // = 18:00 Jan 4 → 08:00 Jan 5 UTC.
  // Sun 9-17 window: 22:00 Dubai is OUTSIDE (window ends 17:00).
  // Mon 9-17 window: 09:00-12:00 Dubai = 3h IN.
  const start = Math.floor(Date.UTC(2026, 0, 4, 18, 0, 0) / 1000);
  const end = Math.floor(Date.UTC(2026, 0, 5, 8, 0, 0) / 1000);
  const fast = overlapSecWithWindowsClient(start, end, DAILY_9_TO_5);
  const slow = oldMinuteWalk(start, end, DAILY_9_TO_5);
  assert.equal(fast, slow, 'multi-day range must match the old walk');
  assert.equal(fast, 3 * 3600, '3h of in-shift seconds expected (only Mon morning)');
});

test('overlapSecWithWindowsClient handles the Friday 3pm-11pm profile', () => {
  // 2026-01-09 is a Friday. 14:00 → 22:30 Asia/Dubai
  // = 10:00 → 18:30 UTC. Window: 15:00-23:00 Dubai.
  // In-window: 15:00-22:30 Dubai = 7h30m = 27000s.
  const start = Math.floor(Date.UTC(2026, 0, 9, 10, 0, 0) / 1000);
  const end = Math.floor(Date.UTC(2026, 0, 9, 18, 30, 0) / 1000);
  const fast = overlapSecWithWindowsClient(start, end, DAILY_FRI_3_TO_11);
  const slow = oldMinuteWalk(start, end, DAILY_FRI_3_TO_11);
  assert.equal(fast, slow, 'Friday profile must match the old walk');
  assert.equal(fast, 7.5 * 3600, '7.5h of in-shift seconds expected');
});

test('overlapSecWithWindowsClient clamps to 48h HARD_CAP', () => {
  // 72h range — should be clamped to last 48h. From Thu 10:00 UTC
  // to Sun 10:00 UTC. Clamped 48h starts at Fri 10:00 UTC.
  // In clamped range: Sat 9-17 Dubai (8h) + Sun 9-14 Dubai (5h,
  // because Sun 14:00 Dubai = Sun 10:00 UTC = the END of the
  // clamped range, exclusive) = 13h.
  const start = Math.floor(Date.UTC(2026, 0, 8, 10, 0, 0) / 1000); // Thu
  const end = Math.floor(Date.UTC(2026, 0, 11, 10, 0, 0) / 1000);   // Sun
  const fast = overlapSecWithWindowsClient(start, end, DAILY_9_TO_5);
  const slow = oldMinuteWalk(start, end, DAILY_9_TO_5);
  assert.equal(fast, 13 * 3600, 'clamped to 13h of in-shift seconds (8h Sat + 5h Sun)');
  assert.notEqual(fast, slow, 'clamp should make fast < slow');
});

// ─────────────────────────────────────────────────────────────────────────
// stateHash + the four innerHTML-memoization hashes
// ─────────────────────────────────────────────────────────────────────────

test('stateHash changes when STATE changes', () => {
  const a = { active: { e1: {}, e2: {} }, completed_today: 5, perf: [{units: 3}, {units: 1}], garment_totals_today: [{}], ts: 100 };
  const b = { active: { e1: {}, e2: {} }, completed_today: 6, perf: [{units: 3}, {units: 1}], garment_totals_today: [{}], ts: 100 };
  assert.notEqual(stateHash(a), stateHash(b), 'completed_today change should change the hash');
  const c = { active: { e2: {}, e1: {} }, completed_today: 5, perf: [{units: 3}, {units: 1}], garment_totals_today: [{}], ts: 100 };
  assert.equal(stateHash(a), stateHash(c), 'active key order should not change the hash');
});

test('procSplitHash changes when split changes', () => {
  const order = ['Tailor (01)'];
  const a = { process_split_today: { 'Tailor (01)': 5 }, _workTypesOrder: order };
  const b = { process_split_today: { 'Tailor (01)': 6 }, _workTypesOrder: order };
  assert.notEqual(procSplitHash(a), procSplitHash(b), 'split change should change the hash');
});

test('empPerfHash changes when perf changes', () => {
  const a = { perf: [{units: 3, eff: 80}] };
  const b = { perf: [{units: 4, eff: 80}] };
  assert.notEqual(empPerfHash(a), empPerfHash(b), 'units change should change the hash');
  const c = { perf: [{units: 3, eff: 81}] };
  assert.notEqual(empPerfHash(a), empPerfHash(c), 'eff change should change the hash');
});

test('procSplitHash and empPerfHash are independent', () => {
  const order = ['Tailor (01)'];
  const a = { process_split_today: { 'Tailor (01)': 5 }, perf: [{units: 3, eff: 80}], _workTypesOrder: order };
  const b = { process_split_today: { 'Tailor (01)': 6 }, perf: [{units: 3, eff: 80}], _workTypesOrder: order };
  assert.notEqual(procSplitHash(a), procSplitHash(b), 'split change affects procSplitHash');
  assert.equal(empPerfHash(a), empPerfHash(b), 'split change does NOT affect empPerfHash');
});

test('hourlyHash is stable for the same buckets', () => {
  const a = { hourly_today: { 9: 1, 10: 2, 11: 0 } };
  const b = { hourly_today: { 11: 0, 9: 1, 10: 2 } };
  assert.equal(hourlyHash(a), hourlyHash(b), 'order should not change the hash');
  const c = { hourly_today: { 9: 1, 10: 3, 11: 0 } };
  assert.notEqual(hourlyHash(a), hourlyHash(c), 'value change should change the hash');
});

test('invoiceLogsHash counts Invoice-maker rows', () => {
  const a = { logs: [{ emp_process: 'Invoice maker', invoice_serial: 'X1' }, { emp_process: 'Tailor (01)' }] };
  const b = { logs: [{ emp_process: 'Invoice maker', invoice_serial: 'X1' }, { emp_process: 'Invoice maker', invoice_serial: 'X2' }] };
  assert.notEqual(invoiceLogsHash(a), invoiceLogsHash(b), 'row count change should change the hash');
});

test('abayaTotalsHash is stable for the same rows', () => {
  const a = { garment_totals_today: [{ abaya_id: 'A1', segments: 3, completed_sec: 1000 }] };
  const b = { garment_totals_today: [{ abaya_id: 'A1', segments: 3, completed_sec: 1000 }] };
  assert.equal(abayaTotalsHash(a), abayaTotalsHash(b));
  const c = { garment_totals_today: [{ abaya_id: 'A1', segments: 3, completed_sec: 1001 }] };
  assert.notEqual(abayaTotalsHash(a), abayaTotalsHash(c), 'completed_sec change should change the hash');
});

// ─────────────────────────────────────────────────────────────────────────
// createMemo + abayaIsCustomSet
// ─────────────────────────────────────────────────────────────────────────

test('createMemo: rebuildAbayaIsCustomSet picks up only the flagged rows', () => {
  const m = createMemo();
  assert.equal(m.rebuildAbayaIsCustomSet({
    abaya_builds: {
      'a1': { is_custom: 1 },
      'a2': { is_custom: 0 },
      'a3': { is_custom: 1 },
    },
  }), 2);
  assert.equal(m.isAbayaCustomFast('a1'), true);
  assert.equal(m.isAbayaCustomFast('a2'), false);
  assert.equal(m.isAbayaCustomFast('a3'), true);
  assert.equal(m.isAbayaCustomFast('aX'), false);
});

test('createMemo: per-block hash gates the innerHTML writes', () => {
  const m = createMemo();
  const order = ['Tailor (01)'];
  const s1 = {
    process_split_today: { 'Tailor (01)': 5 },
    perf: [{ units: 3, eff: 80 }],
    hourly_today: { 9: 1 },
    logs: [{ emp_process: 'Invoice maker', invoice_serial: 'X1' }],
    garment_totals_today: [{ abaya_id: 'A1', segments: 3, completed_sec: 1000 }],
    _workTypesOrder: order,
  };
  // First call returns "changed" for every block.
  assert.equal(m.procSplitChanged(s1), true);
  assert.equal(m.empPerfChanged(s1), true);
  assert.equal(m.hourlyChanged(s1), true);
  assert.equal(m.invoiceLogsChanged(s1), true);
  assert.equal(m.abayaTotalsChanged(s1), true);
  // Second call with the same data returns "not changed" — the
  // innerHTML write is skipped.
  assert.equal(m.procSplitChanged(s1), false);
  assert.equal(m.empPerfChanged(s1), false);
  assert.equal(m.hourlyChanged(s1), false);
  assert.equal(m.invoiceLogsChanged(s1), false);
  assert.equal(m.abayaTotalsChanged(s1), false);
  // Change one field; only that block reports a change.
  const s2 = { ...s1, process_split_today: { 'Tailor (01)': 6 } };
  assert.equal(m.procSplitChanged(s2), true, 'procSplit must detect the change');
  assert.equal(m.empPerfChanged(s2), false, 'empPerf must NOT be invalidated by procSplit change');
  assert.equal(m.hourlyChanged(s2), false);
  assert.equal(m.invoiceLogsChanged(s2), false);
  assert.equal(m.abayaTotalsChanged(s2), false);
});

test('createMemo.reset() clears the memo slots', () => {
  const m = createMemo();
  const s = { process_split_today: {}, perf: [], hourly_today: {}, logs: [], garment_totals_today: [] };
  m.procSplitChanged(s);
  assert.equal(m.procSplitChanged(s), false, 'memoized');
  m.reset();
  assert.equal(m.procSplitChanged(s), true, 'reset clears the memo');
});

test('attachToWindow attaches window.__ceoPerf', () => {
  const fakeWin = {};
  const api = attachToWindow(fakeWin);
  assert.ok(fakeWin.__ceoPerf, 'window.__ceoPerf is set');
  assert.equal(typeof api.intlFmt, 'function');
  assert.equal(typeof api.overlapSecWithWindowsClient, 'function');
  assert.equal(typeof api.rebuildAbayaIsCustomSet, 'function');
  assert.equal(typeof api.procSplitChanged, 'function');
});

// ─────────────────────────────────────────────────────────────────────────
// Source-sync check: the inline IIFE in ceo-pages.js must reference the
// same algorithm names. If a future refactor renames any of them, this
// test fires and the maintainer updates both files in lock-step.
// ─────────────────────────────────────────────────────────────────────────

test('inline IIFE in ceo-pages.js still references __ceoPerf', () => {
  const inline = fs.readFileSync(SRC, 'utf-8');
  assert.ok(inline.includes('window.__ceoPerf'), 'inline IIFE must attach to window.__ceoPerf');
  assert.ok(inline.includes('__ceoPerf.intlFmt'), 'inline script must use the cached intlFmt');
  assert.ok(inline.includes('__ceoPerf.overlapSecWithWindowsClient'), 'inline script must use the sweep-line');
  assert.ok(inline.includes('__ceoPerf.isAbayaCustomFast'), 'inline script must use the Set lookup');
  assert.ok(inline.includes('__ceoPerf.procSplitChanged'), 'inline script must use the proc-split memo');
  assert.ok(inline.includes('__ceoPerf.empPerfChanged'), 'inline script must use the emp-perf memo');
  assert.ok(inline.includes('__ceoPerf.hourlyChanged'), 'inline script must use the hourly memo');
  assert.ok(inline.includes('__ceoPerf.invoiceLogsChanged'), 'inline script must use the invoice-logs memo');
  assert.ok(inline.includes('__ceoPerf.rebuildAbayaIsCustomSet'), 'inline script must rebuild the Set on STATE arrival');
});

test('getCEODashboard references the external CSS via dashboardCssHref()', () => {
  const inline = fs.readFileSync(SRC, 'utf-8');
  // The inline template literal should reference dashboardCssHref() in
  // the <link> tag, not inline CSS body.
  assert.ok(inline.includes('${dashboardCssHref()}'), 'template literal uses dashboardCssHref()');
  // The inline <style> block that used to live between <style> and
  // </style> at the top of getCEODashboard should be GONE — the CSS
  // is now served via /static/ceo.css. We look for the unique
  // --bg:#1f1633 root var to confirm the inline body is gone.
  const inlineCssStillThere = /:root\{--bg:#1f1633/.test(inline);
  assert.equal(inlineCssStillThere, false, 'inline CSS body should have been replaced with a <link> tag');
});
