// tests/dashboard-live-tick.test.mjs
//
// v1.2.30 — LAN dashboard realtime stream. The local factory server's
// /dashboard.html pushes STATE.active via socket, so the live session
// card already updates within ~16ms of a Start/Finish event. The
// remaining problem is the elapsed-time counter ("active today" /
// "this build") which previously rebuilt the full row innerHTML every
// 2.5s — visibly stale when an operator is staring at a busy board.
// The fix is a 1Hz `tickLiveSessions()` that updates ONLY the
// elapsed-time cells via targeted textContent writes, plus pure
// helper functions `computeInShiftSec` / `computeActiveTodaySec` that
// the tick function calls (also reused by the existing
// renderLiveSessions so we don't recompute the same value twice).
//
// These tests verify:
//   1. The two helper functions compute the right elapsed seconds for
//      single-day, cross-day, and out-of-window cases.
//   2. The dashboard schedules `setInterval(tickLiveSessions, 1000)`
//      and NOT the previous 2.5s renderLiveSessions() loop.
//   3. The data-tick attributes on the live row cells are present so
//      the tick function can find them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_JS = path.join(__dirname, '..', 'public', 'dashboard.js');
const SRC = fs.readFileSync(DASHBOARD_JS, 'utf8');

// Extract a function's argument list and body from dashboard.js source.
// The dashboard file is a plain script (no module wrapping), so the
// helpers can be moved into a small sandbox with controlled dependencies
// (inWindowClient, ymdInTimezone) as the only injected parameters.
function extractFunction(name) {
  const re = new RegExp(
    'function\\s+' + name + '\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}'
  );
  const m = SRC.match(re);
  if (!m) throw new Error('Could not find function ' + name + ' in dashboard.js');
  return {
    argNames: m[1].split(',').map((s) => s.trim()),
    body: m[2],
  };
}

// Build a sandbox that contains BOTH helpers with their dependencies
// (inWindowClient, ymdInTimezone) injected as sandboxed consts. Returns
// the two helpers as plain functions. The dependencies are passed in as
// the factory's parameters and assigned to local consts at the top of
// the sandbox so the helper bodies resolve them by closure.
function buildHelpers(inWindowClient, ymdInTimezone) {
  const inShift = extractFunction('computeInShiftSec');
  const active = extractFunction('computeActiveTodaySec');
  // Build a single sandbox that:
  //   1. Declares the dependencies as consts (so the helper bodies see them).
  //   2. Re-declares both helpers with their original arg signatures
  //      and original bodies.
  //   3. Returns them as a plain object so the test can call them.
  const sandbox = `
    const inWindowClient = __inWindow;
    const ymdInTimezone = __ymd;
    function computeInShiftSec(${inShift.argNames.join(',')}) {${inShift.body}}
    function computeActiveTodaySec(${active.argNames.join(',')}) {${active.body}}
    return { computeInShiftSec, computeActiveTodaySec };
  `;
  const factory = new Function('__inWindow', '__ymd', sandbox);
  return factory(inWindowClient, ymdInTimezone);
}

test('computeInShiftSec: counts in-window seconds between start and now', () => {
  const inWindow = () => true;
  const { computeInShiftSec } = buildHelpers(inWindow, () => '');
  assert.equal(computeInShiftSec(1000, 1900), 900, '900s range, all in window -> 900s');
  const noWindow = () => false;
  const { computeInShiftSec: fn2 } = buildHelpers(noWindow, () => '');
  assert.equal(fn2(1000, 1900), 0, '900s range, no in window -> 0s');
  const oddOnly = (t) => Math.floor(t / 60) % 2 === 1;
  const { computeInShiftSec: fn3 } = buildHelpers(oddOnly, () => '');
  // 1000..1900 = 900s = 15 minutes. The walk starts at t=1000 (even,
  // skipped) and visits t=1060, 1120, 1180, 1240, 1300, 1360, 1420,
  // 1480, 1540, 1600, 1660, 1720, 1780, 1840. The odd-minutes are at
  // floor(t/60) odd -> t=1060, 1180, 1300, 1420, 1540, 1660, 1780
  // (7 minutes × 60s = 420s).
  assert.equal(fn3(1000, 1900), 420, 'odd-minutes only -> 420s of 900s');
  const { computeInShiftSec: fn4 } = buildHelpers(inWindow, () => '');
  assert.equal(fn4(1234, 1234), 0, 'start == now -> 0s');
  assert.equal(fn4(1234, 1000), 0, 'now < start -> 0s');
});

test('computeInShiftSec: 60s granularity with partial last minute', () => {
  const inWindow = () => true;
  const { computeInShiftSec } = buildHelpers(inWindow, () => '');
  assert.equal(computeInShiftSec(1000, 1060), 60, '60s exact -> 60s');
  assert.equal(computeInShiftSec(1000, 1059), 59, '59s range -> 59s (partial minute)');
  assert.equal(computeInShiftSec(1000, 1001), 1, '1s range -> 1s');
});

test('computeActiveTodaySec: clamps cross-day sessions to today midnight', () => {
  // Factory TZ is Asia/Dubai (UTC+4).
  // serverNowMs = 2026-09-07 10:00:00 +04:00 = Date.UTC(2026, 8, 7, 6, 0, 0)
  // startedMs   = 2026-09-06 14:00:00 +04:00 = Date.UTC(2026, 8, 6, 10, 0, 0)
  // ymdInTimezone returns 2026-09-06 for startedMs, 2026-09-07 for serverNowMs.
  // For 2026-09-07 the cross-day clamp puts effStart at today 00:00 +04:00
  // = 2026-09-06 20:00:00 UTC.
  // serverNowMs - effStartMs = (06:00 UTC) - (20:00 UTC the day before)
  //                        = 10 hours = 36000 seconds.
  const serverNowMs = Date.UTC(2026, 8, 7, 6, 0, 0);
  const startedMs = Date.UTC(2026, 8, 6, 10, 0, 0);
  const serverNowSec = Math.floor(serverNowMs / 1000);
  const tz = 'Asia/Dubai';
  const todayYmd = '2026-09-07';
  const ymdInTimezone = (ms, _tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: _tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(ms));
  const inWindow = () => true;
  const { computeActiveTodaySec } = buildHelpers(inWindow, ymdInTimezone);
  const sec = computeActiveTodaySec(startedMs, serverNowMs, serverNowSec, tz, todayYmd);
  assert.equal(sec, 36000, 'cross-day session clamped to today 00:00 +04:00 -> 10h in window');
});

test('computeActiveTodaySec: same-day session does not clamp to midnight', () => {
  const serverNowMs = Date.UTC(2026, 8, 7, 6, 0, 0);  // 10:00 +04:00
  const startedMs = Date.UTC(2026, 8, 7, 3, 0, 0);    // 07:00 +04:00 (3h ago)
  const serverNowSec = Math.floor(serverNowMs / 1000);
  const tz = 'Asia/Dubai';
  const todayYmd = '2026-09-07';
  const ymdInTimezone = (ms, _tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: _tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(ms));
  const inWindow = () => true;
  const { computeActiveTodaySec } = buildHelpers(inWindow, ymdInTimezone);
  const sec = computeActiveTodaySec(startedMs, serverNowMs, serverNowSec, tz, todayYmd);
  // 3 hours, all in window -> 10800 seconds.
  assert.equal(sec, 10800, 'same-day 3h session, all in window -> 10800s');
});

test('dashboard.js schedules tickLiveSessions at 1Hz (not 2.5s renderLiveSessions)', () => {
  // v1.2.30: the old `setInterval(renderLiveSessions, 2500)` line
  // should be GONE; the new `setInterval(tickLiveSessions, 1000)`
  // should be present. This is a simple source-level guard against
  // accidental regression.
  assert.ok(
    /setInterval\(\s*tickLiveSessions\s*,\s*1000\s*\)/.test(SRC),
    'dashboard.js must schedule setInterval(tickLiveSessions, 1000)'
  );
  assert.ok(
    !/setInterval\(\s*renderLiveSessions\s*,\s*2500\s*\)/.test(SRC),
    'dashboard.js must NOT keep the old 2.5s renderLiveSessions loop'
  );
});

test('dashboard.js renderLiveSessions tags the elapsed cells with data-tick', () => {
  // The tick function finds cells via `[data-tick="active-today"]` and
  // `[data-tick="build"]`. Verify both attributes are emitted in the
  // row markup so the 1Hz tick can find them.
  assert.ok(
    /data-tick="active-today"/.test(SRC),
    'renderLiveSessions must emit data-tick="active-today" on the active-today cell'
  );
  assert.ok(
    /data-tick="build"/.test(SRC),
    'renderLiveSessions must emit data-tick="build" on the this-build cell'
  );
  // And each cell needs data-emp-id so the tick can match per-worker.
  const activeTodayOk =
    /data-tick="active-today"[^>]*data-emp-id="/.test(SRC) ||
    /data-emp-id="[^"]*"[^>]*data-tick="active-today"/.test(SRC);
  assert.ok(activeTodayOk, 'active-today cell must also carry data-emp-id for per-worker lookup');
  const buildOk =
    /data-tick="build"[^>]*data-emp-id="/.test(SRC) ||
    /data-emp-id="[^"]*"[^>]*data-tick="build"/.test(SRC);
  assert.ok(buildOk, 'build cell must also carry data-emp-id for per-worker lookup');
});
