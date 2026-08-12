// scripts/test-check-report-dates.mjs
// Verify the timezone-aware date helpers from server.js produce the
// exact values the spec mandates (11 August 2026 → Tuesday, etc.).

import { strict as assert } from 'node:assert';

// Inline copies of the helpers (kept in sync with server.js). We re-implement
// them here to avoid running the whole server just to assert dates.

const FACTORY_TZ = 'Asia/Dubai';

function ymdInTimezone(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = (parts.find((p) => p.type === 'year')  || {}).value || '0000';
  const m = (parts.find((p) => p.type === 'month') || {}).value || '00';
  const d = (parts.find((p) => p.type === 'day')   || {}).value || '00';
  return `${y}-${m}-${d}`;
}

function startOfDayInTimezone(ymd, tz) {
  const [y, m, d] = String(ymd).split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return NaN;
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  if (ymdInTimezone(noonUtc, 'UTC') !== ymd) return NaN;
  let inside = noonUtc;
  for (let i = 0; i < 96; i++) {
    const prev = inside - 30 * 60 * 1000;
    if (ymdInTimezone(prev, tz) !== ymd) {
      return inside;
    }
    inside = prev;
  }
  return NaN;
}

function endOfDayInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return NaN;
  return start + 24 * 60 * 60 * 1000 - 1;
}

function weekdayInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(start));
}

function longDateInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return ymd;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(new Date(start));
  const weekday = (parts.find((p) => p.type === 'weekday') || {}).value || '';
  const day     = (parts.find((p) => p.type === 'day')     || {}).value || '';
  const month   = (parts.find((p) => p.type === 'month')   || {}).value || '';
  const year    = (parts.find((p) => p.type === 'year')    || {}).value || '';
  return `${weekday}, ${day} ${month} ${year}`.trim();
}

// ─── Spec assertions ────────────────────────────────────────────────────────
console.log('TZ:', FACTORY_TZ);

const cases = [
  { ymd: '2026-08-11', weekday: 'Tuesday'   },
  { ymd: '2026-08-12', weekday: 'Wednesday' },
  { ymd: '2026-08-13', weekday: 'Thursday'  },
  { ymd: '2026-08-14', weekday: 'Friday'    },
  { ymd: '2026-08-15', weekday: 'Saturday'  },
];
for (const c of cases) {
  const wd = weekdayInTimezone(c.ymd, FACTORY_TZ);
  const long = longDateInTimezone(c.ymd, FACTORY_TZ);
  console.log(`  ${c.ymd} → ${wd}  | ${long}`);
  assert.equal(wd, c.weekday, `expected ${c.ymd} = ${c.weekday}, got ${wd}`);
}

// Day bounds
const start = startOfDayInTimezone('2026-08-11', FACTORY_TZ);
const end   = endOfDayInTimezone('2026-08-11', FACTORY_TZ);
console.log(`  2026-08-11 bounds: ${new Date(start).toISOString()} → ${new Date(end).toISOString()}`);
assert.equal(ymdInTimezone(start, FACTORY_TZ), '2026-08-11', 'start should be in same ymd in factory tz');
assert.equal(ymdInTimezone(end,   FACTORY_TZ), '2026-08-11', 'end should be in same ymd in factory tz');
assert.equal(end - start, 24*60*60*1000 - 1, 'end should be 23:59:59.999 after start');

// Range
const startA = startOfDayInTimezone('2026-08-11', FACTORY_TZ);
const endB   = endOfDayInTimezone('2026-08-15', FACTORY_TZ);
console.log(`  range 2026-08-11 → 2026-08-15: ${new Date(startA).toISOString()} → ${new Date(endB).toISOString()}`);
// Aug 11 to Aug 15 = 5 days, 4 day-edges, 5 * 24h - 1ms total
const expectedMs = 5 * 24 * 60 * 60 * 1000 - 1;
assert.equal(endB - startA, expectedMs, 'range bounds should span exactly 5 days - 1ms');

// Today (in the factory timezone) should not be a hardcoded value
const todayYmd = ymdInTimezone(Date.now(), FACTORY_TZ);
console.log(`  today (factory tz): ${todayYmd}`);
assert.match(todayYmd, /^\d{4}-\d{2}-\d{2}$/);

console.log('\n✅ All date helper assertions passed.');
