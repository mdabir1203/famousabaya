// Logic test for the new currentShiftStartSec() helper in working-hours.js.
import {
  currentShiftStartSec,
  defaultWorkingHoursConfig,
  isInWorkingWindow,
} from '../src/working-hours.js';

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
function ok(msg) { console.log('OK   ' + msg); }
function eq(actual, expected, label) {
  if (actual !== expected) fail(label + ' expected=' + expected + ' actual=' + actual);
  ok(label + ' = ' + actual);
}

const cfg = defaultWorkingHoursConfig();
const tz = cfg.timezone;

// Test plan: each test pins a "now" timestamp to a known minute-of-day
// in Asia/Dubai, then asserts currentShiftStartSec() returns the right
// shift-start unix second.
//
// Default working hours (Asia/Dubai, all days except Fri):
//   ['09:00', '13:30']  (morning)
//   ['15:00', '20:00']  (afternoon)
//   ['20:40', '23:30']  (evening)
// Friday: ['15:00', '20:00'], ['20:40', '23:30'] (no morning)

// Helper: convert a "2026-08-24 10:30 Asia/Dubai" to unix seconds.
// We use Date.UTC with -4h offset since Asia/Dubai is UTC+4 fixed.
function ymdHmToUnix(ymd, hh, mm) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, hh - 4, mm, 0) / 1000);
}

// 1. Mid-morning on a Monday -> shift started at 09:00
{
  const now = ymdHmToUnix('2026-08-24', 10, 30);  // Mon 10:30 Dubai
  const exp = ymdHmToUnix('2026-08-24', 9, 0);    // Mon 09:00 Dubai
  const got = currentShiftStartSec(now, cfg);
  eq(got, exp, 'Mon 10:30 -> shift started 09:00');
}

// 2. During the 15:00-20:00 window -> shift started at 15:00
{
  const now = ymdHmToUnix('2026-08-24', 17, 0);
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-24', 15, 0), 'Mon 17:00 -> shift started 15:00');
}

// 3. During the 20:40-23:30 window -> shift started at 20:40
{
  const now = ymdHmToUnix('2026-08-24', 22, 0);
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-24', 20, 40), 'Mon 22:00 -> shift started 20:40');
}

// 4. Friday 14:00 -> before Friday's first shift (which is 15:00),
//    expect the most recent past window: Thursday evening 20:40.
{
  const now = ymdHmToUnix('2026-08-28', 14, 0);  // Fri 14:00 Dubai
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-27', 20, 40), 'Fri 14:00 (before Fri first shift) -> Thu evening 20:40');
}

// 5. Friday 16:00 -> afternoon window, started 15:00
{
  const now = ymdHmToUnix('2026-08-28', 16, 0);
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-28', 15, 0), 'Fri 16:00 -> shift started 15:00');
}

// 6. Tuesday 14:00 -> between morning and afternoon, expect MOST RECENT
//    PAST WINDOW (morning 09:00)
{
  const now = ymdHmToUnix('2026-08-25', 14, 0);
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-25', 9, 0), 'Tue 14:00 (lunch break) -> morning shift 09:00');
}

// 7. Tuesday 22:30 -> evening window, started 20:40
{
  const now = ymdHmToUnix('2026-08-25', 22, 30);
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-25', 20, 40), 'Tue 22:30 -> shift started 20:40');
}

// 8. Sanity: isInWorkingWindow and currentShiftStartSec agree
{
  const now = ymdHmToUnix('2026-08-24', 11, 0);
  const inWin = isInWorkingWindow(now, cfg);
  const shiftStart = currentShiftStartSec(now, cfg);
  if (inWin && shiftStart == null) fail('isInWorkingWindow=true but currentShiftStartSec=null at 11:00');
  if (!inWin && shiftStart != null) fail('isInWorkingWindow=false but currentShiftStartSec!=null at 11:00');
  ok('isInWorkingWindow / currentShiftStartSec agree at 11:00');
}

// 9. CASE 3: Tuesday 02:00 AM (way before morning shift) -> most recent
//    shift is yesterday's evening (Mon Aug 24 20:40).
{
  const now = ymdHmToUnix('2026-08-25', 2, 0);  // Tue 02:00 Dubai
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-24', 20, 40), 'Tue 02:00 -> yesterday evening 20:40');
}

// 10. CASE 3: Friday 10:00 AM (before Fri's first shift at 15:00) -> most
//     recent shift is Thursday evening 20:40.
{
  const now = ymdHmToUnix('2026-08-28', 10, 0);  // Fri 10:00 Dubai
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-27', 20, 40), 'Fri 10:00 (before Fri first shift) -> Thu evening 20:40');
}

// 11. CASE 3: Friday 14:00 (between morning close and afternoon open on a
//     normal day, but Friday never opened yet today) -> still yesterday
//     evening, since Friday's first shift is 15:00.
{
  const now = ymdHmToUnix('2026-08-28', 14, 0);
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-27', 20, 40), 'Fri 14:00 (Fri not yet started) -> Thu evening 20:40');
}

// 12. CASE 2: Tuesday 23:50 (after last window of the day) -> most
//     recent is today's evening 20:40.
{
  const now = ymdHmToUnix('2026-08-25', 23, 50);
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-25', 20, 40), 'Tue 23:50 (after last window) -> today evening 20:40');
}

// 13. CASE 3: Monday 00:30 AM (after Sun's last window but before Mon's
//     morning) -> most recent is yesterday (Sun) evening 20:40.
{
  const now = ymdHmToUnix('2026-08-24', 0, 30);  // Mon 00:30 Dubai
  const got = currentShiftStartSec(now, cfg);
  eq(got, ymdHmToUnix('2026-08-23', 20, 40), 'Mon 00:30 -> Sun evening 20:40');
}

// 14. The actual production case: the "Stuck" session from the user's
//     screenshot -- Amirull started 19:34 on Sun and is still open at
//     Mon 23:50. Cap should be Sun evening 19:40 (the actual evening
//     window that contains the start time).
{
  const started = ymdHmToUnix('2026-08-23', 19, 34);  // Sun 19:34
  const now = ymdHmToUnix('2026-08-24', 23, 50);       // Mon 23:50
  const got = currentShiftStartSec(now, cfg);
  // The cap is the start of the most recent past window, which at
  // Mon 23:50 is Mon evening 20:40 (today). The started_at doesn't
  // matter for the cap -- what matters is "which shift is the worker
  // being measured against", and the operator's intent is the current
  // shift (today's evening).
  eq(got, ymdHmToUnix('2026-08-24', 20, 40), 'Stuck session: Mon 23:50 -> today evening 20:40');
}

console.log('---');
console.log('currentShiftStartSec OK -- shift start pinned correctly across all windows and break gaps.');
