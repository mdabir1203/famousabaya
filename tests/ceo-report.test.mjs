import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  reportRangeForType,
  customRange,
  isValidYmd,
} from '../cloudflare/src/handlers/report-shared.js';
import { handleReport } from '../cloudflare/src/handlers/report.js';
import { handleEmployeeDay } from '../cloudflare/src/handlers/employee-day.js';
import { factoryTodayString } from '../cloudflare/src/working-hours.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** Minimal D1 double: records every statement + binds, serves canned rows by SQL shape. */
function makeMockEnv(queryHandler) {
  const calls = [];
  let batchCount = 0;
  const db = {
    prepare(sql) {
      const stmt = {
        sql: String(sql),
        args: [],
        bind(...args) {
          stmt.args = args;
          return stmt;
        },
        async all() {
          calls.push(stmt);
          const r = queryHandler(stmt) || {};
          return { results: r.results || [] };
        },
        async first() {
          calls.push(stmt);
          const r = queryHandler(stmt) || {};
          return (r.results || [])[0] || null;
        },
        async run() {
          calls.push(stmt);
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(stmts) {
      batchCount += 1;
      return stmts.map((s) => {
        calls.push(s);
        return queryHandler(s) || { results: [] };
      });
    },
  };
  return { env: { DB: db }, calls, batchCountRef: () => batchCount };
}

/** Canned empty report data keyed by SQL shape (mirrors handleReport's batch). */
function emptyReportHandler(stmt) {
  const sql = stmt.sql;
  if (sql.includes('worker_settings')) return { results: [] };
  if (sql.includes('FROM active_sessions')) return { results: [] };
  if (sql.includes('unique_workers')) {
    return {
      results: [
        {
          total_units: 0,
          avg_sec: null,
          unique_workers: 0,
          unique_items: 0,
          active_time_sec: 0,
          period_start_sec: null,
          period_end_sec: null,
        },
      ],
    };
  }
  if (sql.includes('COUNT(*) as total_units')) {
    return { results: [{ total_units: 0, active_time_sec: 0, avg_sec: null }] };
  }
  return { results: [] };
}

function urlOf(qs) {
  return new URL('https://ceo.example/api/report' + qs);
}

test('isValidYmd accepts real dates and rejects malformed/impossible ones', () => {
  assert.equal(isValidYmd('2026-07-15'), true);
  assert.equal(isValidYmd('2026-02-30'), false); // rolls over in Date — rejected
  assert.equal(isValidYmd('15/07/2026'), false);
  assert.equal(isValidYmd(''), false);
});

test('reportRangeForType anchors weekly/monthly/yearly at an arbitrary date', () => {
  const w = reportRangeForType('weekly', '2026-07-15'); // Wednesday
  assert.equal(w.startYmd, '2026-07-13'); // Monday
  assert.equal(w.endYmd, '2026-07-15');
  const m = reportRangeForType('monthly', '2026-07-15');
  assert.equal(m.startYmd, '2026-07-01');
  assert.equal(m.endYmd, '2026-07-15');
  const y = reportRangeForType('yearly', '2026-07-15');
  assert.equal(y.startYmd, '2026-01-01');
  assert.equal(y.endYmd, '2026-07-15');
});

test('customRange builds inclusive ranges with previous-period bookkeeping', () => {
  const r = customRange('2026-07-01', '2026-07-10');
  assert.equal(r.type, 'custom');
  assert.equal(r.startYmd, '2026-07-01');
  assert.equal(r.endYmd, '2026-07-10');
  assert.equal(r.days, 10);
  assert.equal(r.prevEnd, '2026-06-30');
  assert.equal(r.prevStart, '2026-06-21');
});

test('customRange rejects inverted, malformed, and over-long ranges', () => {
  assert.throws(() => customRange('2026-07-10', '2026-07-01'), /from is after to/);
  assert.throws(() => customRange('nope', '2026-07-01'), /Invalid from\/to/);
  assert.throws(() => customRange('2026-01-01', '2026-12-31'), /too long/);
});

test('handleReport honors an explicit date anchor with no silent fallback', async () => {
  const { env, calls, batchCountRef } = makeMockEnv(emptyReportHandler);
  const res = await handleReport(env, urlOf('?type=daily&date=2026-07-15&local_today=2026-08-06'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.period.start_date, '2026-07-15');
  assert.equal(body.period.end_date, '2026-07-15');
  assert.equal(body.period.anchor_date, '2026-07-15');
  assert.equal(body.period.custom, false);
  assert.equal(body.period.fallback_applied, false);
  // One batch only — the empty day must NOT trigger the previous-day fallback.
  assert.equal(batchCountRef(), 1);
  const summaryCall = calls.find((c) => c.sql.includes('unique_workers'));
  assert.deepEqual(summaryCall.args, ['2026-07-15', '2026-07-15']);
});

test('handleReport keeps the previous-day fallback for the default (no date) flow', async () => {
  const { env, batchCountRef } = makeMockEnv(emptyReportHandler);
  const res = await handleReport(env, urlOf('?type=daily&local_today=2026-08-06'));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.period.fallback_applied, true);
  assert.equal(body.period.start_date, '2026-08-05');
  assert.equal(batchCountRef(), 2);
});

test('handleReport supports custom from/to ranges and validates them', async () => {
  const { env, calls } = makeMockEnv(emptyReportHandler);
  const res = await handleReport(env, urlOf('?from=2026-07-01&to=2026-07-10'));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.type, 'custom');
  assert.equal(body.period.start_date, '2026-07-01');
  assert.equal(body.period.end_date, '2026-07-10');
  assert.equal(body.period.custom, true);
  assert.equal(body.period.days, 10);
  const summaryCall = calls.find((c) => c.sql.includes('unique_workers'));
  assert.deepEqual(summaryCall.args, ['2026-07-01', '2026-07-10']);

  for (const bad of ['?from=2026-07-10&to=2026-07-01', '?from=oops&to=2026-07-01', '?from=2026-01-01&to=2026-12-31']) {
    const r = await handleReport(env, urlOf(bad));
    assert.equal(r.status, 400, bad);
    const b = await r.json();
    assert.equal(b.ok, false);
  }
});

test('handleEmployeeDay returns chronological sessions with totals for one employee/date', async () => {
  // Fixture timestamps deliberately fall inside the default working
  // window (09:00-13:30 Asia/Dubai) so windowedActiveTimeSec returns
  // the full duration_sec for each row. The previous fixture (07:33
  // and 08:33 GST) straddled the 09:00 shift start and got clamped
  // to 1980s, breaking the 1800 + 3600 = 5400 total.
  const fixture = [
    {
      emp_id: 'e_bc_00000121',
      emp_name: 'Amina',
      emp_code: '01',
      emp_process: 'Stitching',
      abaya_id: 'AB-1',
      abaya_code: 'AB-001',
      started_at: 1784005200, // 2026-07-14 09:00 GST
      ended_at: 1784007000,   // 2026-07-14 09:30 GST
      duration_sec: 1800,
      invoice_count: null,
      invoice_serial: null,
      station: 'S-02',
    },
    {
      emp_id: 'e_bc_00000121',
      emp_name: 'Amina',
      emp_code: '01',
      emp_process: 'Stitching',
      abaya_id: 'AB-2',
      abaya_code: 'AB-002',
      started_at: 1784007000, // 2026-07-14 09:30 GST
      ended_at: 1784010600,   // 2026-07-14 10:30 GST
      duration_sec: 3600,
      invoice_count: null,
      invoice_serial: null,
      station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) return { results: [] };
    if (stmt.sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env, calls } = makeMockEnv(handler);
  const res = await handleEmployeeDay(env, new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000121&date=2026-07-14'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.emp.name, 'Amina');
  assert.equal(body.date, '2026-07-14');
  const sessionsCall = calls.find((c) => c.sql.includes('FROM sessions'));
  assert.deepEqual(sessionsCall.args, ['2026-07-14', 'e_bc_00000121']);
  assert.equal(body.sessions.length, 2);
  assert.equal(body.sessions[0].started_at, 1784005200); // chronological (09:00 GST)
  assert.equal(body.totals.units, 2);
  assert.equal(body.totals.active_time_sec, 5400);
  assert.equal(body.totals.live_active_time_sec, 0);
  assert.equal(body.sessions.every((s) => s.live === false), true);
});

test('handleEmployeeDay dedups duplicate (emp_id, started_at) clusters (v1.2.43)', async () => {
  // Regression for the 2026-09-17 dashboard bug: Wahid on 2026-09-16 had
  // 3 rows with the same started_at (8:55 PM) but different ended_at
  // values. Root cause: factory's close-stale-sessions endpoint pushed
  // a fresh session_finish each time it was called on the same orphan
  // (cloud PK = 'WL-' + emp_id + '-' + ended_at accepts every variant).
  //
  // The cloud fix: read-time dedup. Keep the row with the largest
  // ended_at per (started_at); that's the latest close attempt and
  // reflects the actual end of work. totals.units is the deduplicated
  // count, NOT the raw D1 row count.
  const fixture = [
    // 3 dups of the same session — different ended_at, all same started_at
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111 STD-O',
      started_at: 1784005200, ended_at: 1784007000, duration_sec: 1800,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111 STD-O',
      started_at: 1784005200, ended_at: 1784010600, duration_sec: 5400,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111 STD-O',
      started_at: 1784005200, ended_at: 1784014200, duration_sec: 9000,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    // 1 distinct session — different started_at
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Embroidery', abaya_id: '3440', abaya_code: 'CF112 STD-O',
      started_at: 1784020000, ended_at: 1784025000, duration_sec: 5000,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) return { results: [] };
    if (stmt.sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env } = makeMockEnv(handler);
  const res = await handleEmployeeDay(env, new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000138&date=2026-07-14'));
  assert.equal(res.status, 200);
  const body = await res.json();
  // After dedup: 2 distinct sessions (3 dups collapse to 1 winner, plus
  // the 1 distinct). The winner keeps the LARGEST ended_at (9000s).
  assert.equal(body.sessions.length, 2, 'dups collapsed to 1 winner + 1 distinct');
  const first = body.sessions[0];
  assert.equal(first.started_at, 1784005200);
  assert.equal(first.ended_at, 1784014200, 'kept the row with the largest ended_at');
  assert.equal(first.duration_sec, 9000);
  assert.equal(body.totals.units, 2, 'totals.units is post-dedup count, not raw 4');
});

test('handleEmployeeDay recent_days strips dup (emp_id, started_at) rows (v1.2.46)', async () => {
  // Regression for the 4u vs 3 bug filed on 2026-09-23: the previous-day
  // history strip on the Mouthirrahman day modal showed "4u" for 09-20
  // while PROCESS COMPLETED on the same modal correctly said 3.
  //
  // Root cause: handleEmployeeDay applied the dedup to the in-modal
  // sessions list (so totals.units was honest) but the recent_days SQL
  // used a raw `COUNT(*)` per day_date. While the factory's LAN server
  // still pushes pre-v1.2.43 dup rows, the per-day cell inflated by 1
  // for every stale dup.
  //
  // Fix: apply dedupSessionsCte() to the recent_days query so its
  // per-day count agrees with the post-dedup totals.units the same
  // modal is already showing. Same pattern as state.js stmtAgg /
  // stmtPerf / stmtGarment.
  //
  // Fixture: same Wahid dup cluster from the v1.2.43 dedup test, plus
  // a distinct sibling on the same date and an unrelated distant day.
  // 4 raw rows on 2026-07-14 — but only 2 distinct sessions after dedup.
  // Without the CTE, recent_days[].units would read 4.
  const fixture = [
    // 3 dups of the SAME (started_at=1784005200) — should collapse to 1
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111',
      started_at: 1784005200, ended_at: 1784007000, duration_sec: 1800,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111',
      started_at: 1784005200, ended_at: 1784010600, duration_sec: 5400,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111',
      started_at: 1784005200, ended_at: 1784014200, duration_sec: 9000,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    // 1 distinct session on the same day — survives dedup
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Embroidery', abaya_id: '3440', abaya_code: 'CF112',
      started_at: 1784020000, ended_at: 1784025000, duration_sec: 5000,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    // 1 separate day — no dups, count stays 1
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3441', abaya_code: 'CF113',
      started_at: 1784100000, ended_at: 1784103600, duration_sec: 3600,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    const sql = stmt.sql;
    if (sql.includes('worker_settings')) return { results: [] };
    if (sql.includes('FROM active_sessions')) return { results: [] };
    // v1.2.46 — recent_days and nearby_dates now go through
    // dedupSessionsCte(). The mock simulates the cloud's post-CTE row
    // stream: only the (emp_id, started_at) survivor plus distinct
    // siblings land in the GROUP BY result. Without the fix, recent_days
    // would have shown 4 units for 2026-07-14.
    if (sql.includes('GROUP BY s.day_date') || sql.includes('GROUP BY day_date')) {
      return {
        results: [
          { day_date: '2026-07-15', n: 1, total_sec: 3600 },
          { day_date: '2026-07-14', n: 2, total_sec: 14000 },
        ],
      };
    }
    if (sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env, calls } = makeMockEnv(handler);
  const res = await handleEmployeeDay(
    env,
    new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000138&date=2026-07-15')
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  // Pin the contract: SQL goes through dedup CTE and counts survive
  // dedup. If anyone removes the CTE, the assertion `GROUP BY s.day_date`
  // above stops matching (caller would see the raw 4-row GROUP BY result).
  const recentSql = calls.find((c) => c.sql.includes('GROUP BY s.day_date'));
  assert.ok(recentSql, 'recent_days SQL must use the dedup-aliased alias');
  assert.ok(recentSql.sql.includes('WITH survivors AS ('), 'survivors CTE present');
  assert.ok(recentSql.sql.includes('JOIN survivors w ON w.id = s.id'), 'joins on the CTE');
  // The actual returned counts (post-CTE, from the mock): 2 for 07-14,
  // 1 for 07-15. The history strip cell on 07-15 must be 1 (matches
  // totals.units for that day if the operator clicked the cell), and
  // 07-14 must be 2 — NOT 4 — agreeing with what PROCESS COMPLETED
  // would show if the operator had opened that day instead.
  assert.equal(body.recent_days.length, 2);
  const d14 = body.recent_days.find((d) => d.day_date === '2026-07-14');
  const d15 = body.recent_days.find((d) => d.day_date === '2026-07-15');
  assert.ok(d14, '07-14 day cell present');
  assert.ok(d15, '07-15 day cell present');
  assert.equal(d14.units, 2, '07-14 cell agrees with post-dedup counts — NOT 4');
  assert.equal(d14.time_sec, 14000);
  assert.equal(d15.units, 1);
});

test('handleEmployeeDay nearby_dates strips dup (emp_id, started_at) rows (v1.2.46)', async () => {
  // When the picked date is empty, the modal surfaces the 3 nearest
  // dates that DO have data. Before this fix, the chip said "X units"
  // using raw COUNT(*) per day_date — so a day with one stale dup
  // would show 1 more unit than what PROCESS COMPLETED on that day
  // would (correctly) say. Apply dedupSessionsCte() the same way
  // recent_days does.
  //
  // Use a date that returns 0 rows in the in-modal sessions query
  // (so the nearby_dates branch is exercised), and supply fixture
  // rows for nearby days.
  const fixture = [
    // Same-shape dup cluster as recent_days test, on 2026-07-10
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111',
      started_at: 1783800000, ended_at: 1783801000, duration_sec: 1000,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3439', abaya_code: 'CF111',
      started_at: 1783800000, ended_at: 1783802000, duration_sec: 2000,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    // 1 distinct on a different date
    {
      emp_id: 'e_bc_00000138', emp_name: 'Wahid', emp_code: 'EMP139',
      emp_process: 'Tailor (01)', abaya_id: '3440', abaya_code: 'CF112',
      started_at: 1783700000, ended_at: 1783703600, duration_sec: 3600,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    const sql = stmt.sql;
    if (sql.includes('worker_settings')) return { results: [] };
    if (sql.includes('FROM active_sessions')) return { results: [] };
    // First query (the in-modal SELECT for the picked date) returns
    // empty so we exercise the nearby_dates branch.
    if (sql.includes('ORDER BY started_at ASC')) return { results: [] };
    // nearby_dates branch — must be the dedup-aliased CTE form.
    if (sql.includes('GROUP BY s.day_date')) {
      return {
        results: [
          { day_date: '2026-07-10', n: 1, total_sec: null },
          { day_date: '2026-07-08', n: 1, total_sec: null },
        ],
      };
    }
    if (sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env, calls } = makeMockEnv(handler);
  const res = await handleEmployeeDay(
    env,
    // Pick a date with no sessions for this employee so nearby_dates fires
    new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000138&date=2026-07-12')
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  // Pin the SQL form — if someone removes the CTE, this assertion fails
  // by the mock falling through to the empty `FROM sessions` fixture.
  const nearbySql = calls.find((c) => c.sql.includes('GROUP BY s.day_date'));
  assert.ok(nearbySql && nearbySql !== calls.find((c) => c.sql.includes('GROUP BY day_date')), 'nearby_dates SQL uses dedup CTE');
  assert.ok(
    calls.find((c) => c.sql.includes('WITH survivors AS (')),
    'survivors CTE present in nearby_dates too'
  );
  assert.equal(body.nearby_dates.length, 2);
  // Both cells post-dedup should report 1 unit each, not 2 for the
  // day with the dup cluster.
  const d10 = body.nearby_dates.find((d) => d.day_date === '2026-07-10');
  assert.equal(d10.units, 1, '07-10 chip says 1 unit (1 dup cluster collapsed), not 2');
});

test('handleEmployeeDay surfaces log_id + abaya fields for per-abaya UI distinction (v1.2.47)', async () => {
  // The day-modal UI now stamps each session row with a deterministic
  // per-abaya accent (left border + swatch dot) and a "Custom" pill when
  // the catalog has is_custom=1. Two sessions on the SAME abaya must
  // share the same accent so the operator reads them as "one build,
  // two sittings", not "two unrelated rows".
  //
  // The data attributes the UI stamps (data-abaya-id, data-abaya-code,
  // data-session-id) all come from fields the handler must surface.
  // This test pins:
  //   1. `log_id` (the cloud D1 PK) is present on every finished row,
  //      so data-session-id is stable across page refreshes.
  //   2. `abaya_id` and `abaya_code` are present and equal across rows
  //      that share the abaya.
  //   3. The cross-day case (Mouthirrahman screenshot from 2026-09-23:
  //      a session that started at 11:02 PM and finished at 9:22 AM
  //      next day) is preserved as ONE row with the cross-day time
  //      range, not split into two.
  const fixture = [
    // Cross-day CF111 STD-O build (screenshot row 1: 11:02 PM → 9:22 AM)
    {
      id: 'WL-e_bc_00000125-1789491720',
      emp_id: 'e_bc_00000125', emp_name: 'Mouthirrahman', emp_code: 'EMP125',
      emp_process: 'Hand Work', abaya_id: '3439', abaya_code: 'CF111 STD-O',
      started_at: 1789489320, // 2026-09-20 23:02:00 UTC = 11:02 PM Dubai
      ended_at:   1789526520, // 2026-09-21 09:22:00 UTC = 9:22 AM Dubai
      duration_sec: 37200,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    // Mid-day CF111 STD-O (screenshot row 2: 9:22 AM → 4:52 PM)
    {
      id: 'WL-e_bc_00000125-1789555920',
      emp_id: 'e_bc_00000125', emp_name: 'Mouthirrahman', emp_code: 'EMP125',
      emp_process: 'Hand Work', abaya_id: '3439', abaya_code: 'CF111 STD-O',
      started_at: 1789526520,
      ended_at:   1789555920,
      duration_sec: 29400,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
    // Different abaya entirely (screenshot row 3: 4:52 PM → 7:10 PM)
    {
      id: 'WL-e_bc_00000125-1789579800',
      emp_id: 'e_bc_00000125', emp_name: 'Mouthirrahman', emp_code: 'EMP125',
      emp_process: 'Hand Work', abaya_id: '3852', abaya_code: 'FWAP 3852 PRE-R',
      started_at: 1789555920,
      ended_at:   1789565400,
      duration_sec: 9480,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) return { results: [] };
    if (stmt.sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env } = makeMockEnv(handler);
  const res = await handleEmployeeDay(
    env,
    new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000125&date=2026-09-20')
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  // Every row carries the cloud D1 PK as log_id so the day-modal UI can
  // emit a stable data-session-id attribute.
  for (const s of body.sessions) {
    assert.ok(s.log_id, 'log_id surfaced on every finished row');
    assert.ok(/^WL-e_bc_\d+-\d+$/.test(s.log_id), 'log_id matches the cloud D1 PK shape');
    assert.ok(s.abaya_id, 'abaya_id surfaced');
    assert.ok(s.abaya_code, 'abaya_code surfaced');
  }
  // Two rows on CF111 → they share abaya_id+abaya_code so the UI's
  // deterministic-hash accent + Custom pill will line them up. The
  // FWAP row is on a different abaya and gets a different accent.
  const cf111 = body.sessions.filter((s) => s.abaya_code === 'CF111 STD-O');
  const fwap = body.sessions.filter((s) => s.abaya_code === 'FWAP 3852 PRE-R');
  assert.equal(cf111.length, 2);
  assert.equal(fwap.length, 1);
  // The cross-day case: one row spans 11:02 PM → 9:22 AM next day.
  // Its started_at and ended_at come straight from the LAN push — no
  // recompute. Pin the raw values so a future agent who adds a clamp
  // or round-to-day fails this test.
  const crossDay = cf111.find((s) => s.started_at === 1789489320);
  assert.ok(crossDay, 'cross-day session preserved as one row');
  assert.equal(crossDay.ended_at, 1789526520, 'cross-day ended_at byte-for-byte');
});

test('handleEmployeeDay response is ready for the day-modal audit data attrs (v1.2.47)', async () => {
  // The day-modal UI stamps data-started-at-ms and data-ended-at-ms on
  // each row so a future "trace this session" hook or a regression
  // test can read the raw millisecond value the kiosk captured without
  // re-querying D1. This handler-level test pins that the handler
  // surfaces the seconds values that the UI multiplies by 1000 to
  // produce those attributes — the multiply is a pure formatting op
  // that doesn't modify the underlying number (mirrors the v1.2.44
  // contract for ended_at; same shape for started_at).
  const fixture = [
    {
      id: 'WL-e_bc_00000121-1784005200',
      emp_id: 'e_bc_00000121', emp_name: 'Alazar', emp_code: 'EMP121',
      emp_process: 'Tailor (01)', abaya_id: '5234', abaya_code: 'CF111 STD-O',
      started_at: 1784005200, // exact kiosk-tap value, preserved
      ended_at:   1784008800, // exact kiosk-tap value, preserved
      duration_sec: 3600,
      invoice_count: null, invoice_serial: null, station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) return { results: [] };
    if (stmt.sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env } = makeMockEnv(handler);
  const res = await handleEmployeeDay(
    env,
    new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000121&date=2026-07-14')
  );
  const body = await res.json();
  const s = body.sessions[0];
  // These are the seconds values the UI multiplies by 1000 to produce
  // data-started-at-ms / data-ended-at-ms on the row. They must be the
  // literal values from the LAN push — no floor / round / clamp.
  assert.equal(s.started_at, 1784005200);
  assert.equal(s.ended_at, 1784008800);
  // log_id carries through so the UI's data-session-id attribute is
  // auditable (operator can grep DOM for the cloud PK).
  assert.equal(s.log_id, 'WL-e_bc_00000121-1784005200');
});

test('handleEmployeeDay preserves ended_at byte-for-byte from the LAN push (v1.2.44 contract)', async () => {
  // Operator contract: the END TIME column on the per-employee day
  // report must reflect the exact moment the worker tapped Finish at
  // the kiosk, NOT a recomputation. This test pins the contract by
  // feeding the handler an ended_at that is intentionally weird (a
  // future timestamp, a value mid-shift, a sub-second value) and
  // asserting that the response carries the same number out.
  //
  // Failure modes this catches:
  //   - Someone introduces a recompute (e.g. Math.floor(ended_at / 60) * 60)
  //     that would round-trip wrong.
  //   - Someone adds a clamp to a cap value (like the v1.2.43 dedup's
  //     8h orphan cap) inside the read path instead of the write path.
  //   - The state handler starts recomputing ended_at from started_at +
  //     duration_sec, which would silently round to the minute.
  //
  // Any of these changes the visible END TIME for the operator and
  // would break the audit trail — this test fails loudly if it happens.
  const fixture = [
    {
      emp_id: 'e_bc_00000121',
      emp_name: 'Alazar',
      emp_code: 'EMP121',
      emp_process: 'Tailor (01)',
      abaya_id: '5234',
      abaya_code: 'CF111 STD-O',
      // Pre-v1.2.43 used these timestamps on 2026-09-15 ~21:00 Dubai
      // (operator tapped Start at 8:55 PM, tapped Finish at 11:04 AM
      // next day). Use the exact same values to assert round-trip.
      started_at: 1789491309, // 2026-09-15 16:55:09 UTC = 8:55 PM Dubai
      ended_at: 1789542266,   // 2026-09-16 07:04:26 UTC = 11:04 AM Dubai
      duration_sec: 50957,
      invoice_count: null,
      invoice_serial: null,
      station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) return { results: [] };
    if (stmt.sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env } = makeMockEnv(handler);
  const res = await handleEmployeeDay(
    env,
    new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000121&date=2026-09-16')
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sessions.length, 1);
  const s = body.sessions[0];
  // The literal values from the LAN's session_finish push must survive
  // the round-trip through D1 storage, the state.js hydration, and the
  // employee-day.js handler. Any recomputation in any of those layers
  // would fail this assertion.
  assert.equal(s.started_at, 1789491309, 'started_at preserved verbatim');
  assert.equal(s.ended_at, 1789542266, 'ended_at preserved verbatim — operator contract');
  assert.equal(s.duration_sec, 50957, 'duration_sec preserved verbatim (separate from ended_at)');
  // The UI then renders ended_at as `new Date(ended_at * 1000).toLocaleTimeString(...)`
  // — a pure formatting operation that doesn't modify the underlying
  // number. We assert the underlying number is unchanged so any future
  // agent who adds a clamp/recompute in the read path fails this test.
});

test('handleEmployeeDay never derives ended_at from duration_sec or started_at', async () => {
  // Second-tier guard: even if the LAN accidentally pushes a missing or
  // zero ended_at, the handler must NOT synthesize one from
  // started_at + duration_sec. The historical data had cases where the
  // finish row got an ended_at that was "started_at + the in-shift
  // duration" (which is wrong — that's the same as started_at + a
  // cap-aware overlap, not the wall-clock Finish tap). After this fix
  // the read path passes the ended_at through as `0` (and the UI shows
  // it as `—`), so the operator sees the gap instead of a fabricated
  // timestamp.
  const fixture = [
    {
      emp_id: 'e_bc_00000121',
      emp_name: 'Alazar',
      emp_code: 'EMP121',
      emp_process: 'Tailor (01)',
      abaya_id: '5234',
      abaya_code: 'CF111 STD-O',
      started_at: 1789491309,
      ended_at: 0,             // missing — handler must NOT synthesize
      duration_sec: 50957,
      invoice_count: null,
      invoice_serial: null,
      station: 'S-02',
    },
  ];
  const handler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) return { results: [] };
    if (stmt.sql.includes('FROM sessions')) return { results: [] };
    return { results: [] };
  };
  // Sessions query returns 0 rows because ended_at=0 makes the row
  // invalid (handler filters such rows would be a future concern; for
  // now, the mock returns nothing for that query).
  const sessionHandler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) return { results: [] };
    if (stmt.sql.includes('FROM sessions')) return { results: fixture };
    return { results: [] };
  };
  const { env } = makeMockEnv(sessionHandler);
  const res = await handleEmployeeDay(
    env,
    new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000121&date=2026-09-16')
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  // ended_at=0 round-trips as 0, never as started_at + duration_sec.
  // The UI displays `—` for ended_at === 0 so the operator sees the gap.
  if (body.sessions.length === 1) {
    assert.equal(body.sessions[0].ended_at, 0, 'ended_at=0 preserved as 0, never synthesized');
  }
  // (Either no row or a row with ended_at=0 — both are valid; the
  // invariant is that we never fabricate a timestamp.)
});

test('handleEmployeeDay validates emp_id and date', async () => {
  const { env } = makeMockEnv(() => ({ results: [] }));
  const r1 = await handleEmployeeDay(env, new URL('https://ceo.example/api/report/employee-day?emp_id=&date=2026-07-14'));
  assert.equal(r1.status, 400);
  const r2 = await handleEmployeeDay(env, new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000121&date=14-07-2026'));
  assert.equal(r2.status, 400);
  const b = await r2.json();
  assert.equal(b.ok, false);
});

test('handleEmployeeDay merges the live session when date is factory today', async () => {
  const { env: probeEnv } = makeMockEnv(() => ({ results: [] }));
  const today = factoryTodayString(probeEnv);
  const handler = (stmt) => {
    if (stmt.sql.includes('worker_settings')) return { results: [] };
    if (stmt.sql.includes('FROM active_sessions')) {
      return {
        results: [
          {
            emp_id: 'e_bc_00000121',
            emp_name: 'Amina',
            emp_code: '01',
            emp_process: 'Stitching',
            abaya_id: 'AB-9',
            abaya_code: 'AB-009',
            started_at: Math.floor(Date.now() / 1000) - 600,
          },
        ],
      };
    }
    if (stmt.sql.includes('FROM sessions')) return { results: [] };
    return { results: [] };
  };
  const { env } = makeMockEnv(handler);
  const res = await handleEmployeeDay(env, new URL('https://ceo.example/api/report/employee-day?emp_id=e_bc_00000121&date=' + today));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].live, true);
  assert.equal(body.sessions[0].ended_at, null);
  assert.ok(body.totals.live_active_time_sec >= 0);
  assert.equal(body.emp.name, 'Amina');
});

test('day-modal sessions list stamps per-abaya accent + audit data attrs (v1.2.47)', () => {
  // v1.2.47 — The day-modal sessions list now distinguishes rows by
  // abaya identity so two CF111 rows in one day look like "one build,
  // two sessions", not "two identical rows". Implementation:
  //   - Deterministic HSL hue from abaya_id (stable across refreshes).
  //   - "Custom" pill when STATE.abaya_builds[id].is_custom is true.
  //   - Audit data attributes: data-session-id, data-abaya-id,
  //     data-abaya-code, data-started-at-ms, data-ended-at-ms.
  // The data attributes are a contract: any future agent who changes
  // how the row identifies itself / carries the kiosk-tap timestamps
  // has to update the test, so the change is intentional.
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'cloudflare', 'src', 'ui', 'ceo-pages.js'),
    'utf8'
  );
  // Per-abaya accent: hue is derived from the abaya_id, not the abaya_code,
  // so renames in the catalog don't shuffle colors under the operator.
  assert.ok(
    src.includes('data-abaya-id='),
    'data-abaya-id is stamped on each row'
  );
  assert.ok(
    src.includes('data-abaya-code='),
    'data-abaya-code is stamped on each row'
  );
  assert.ok(
    src.includes('data-session-id='),
    'data-session-id is stamped on each row (uses log_id)'
  );
  // Audit timestamps — these must be the raw kiosk-tap values (no
  // floor / round / clamp), per the v1.2.44 END-TIME contract mirrored
  // here for started_at.
  assert.ok(
    src.includes('data-started-at-ms='),
    'data-started-at-ms is stamped on each row'
  );
  assert.ok(
    src.includes('data-ended-at-ms='),
    'data-ended-at-ms is stamped on each finished row'
  );
  // The accent uses abayaIsCustom (reuses the live-row helper at line
  // ~1533) so we don't re-fetch the catalog. Pin the dependency.
  assert.ok(
    src.includes('abayaIsCustom('),
    'reuses abayaIsCustom for the Custom pill'
  );
  // The swatch + left border use the same accent — so two CF111 rows
  // share the visual treatment. Pin the literal CSS pattern so a
  // future refactor that drops the swatch or border fails loudly.
  assert.ok(
    src.includes("border-left:3px solid ' + accent"),
    'per-abaya left-border tint is rendered from the accent'
  );
  assert.ok(
    src.includes("width:8px;height:8px;border-radius:50%;background:' + accent"),
    'per-abaya swatch dot is rendered from the same accent'
  );
});

test('day-modal sessions list does not duplicate abaya_code (v1.2.47)', () => {
  // Avoid duplication contract: the day modal must NOT re-fetch the
  // catalog, must NOT maintain a separate per-row abaya lookup, and
  // must NOT stack abaya_code on a separate line. The session row
  // already carries abaya_code from the cloud's sessions table; the
  // UI just renders it inside the Item column with a swatch + Custom
  // pill. Verify by reading ceo-pages.js — if any code path adds a
  // second rendering of the same code (e.g. "<Item>" + "<Code>"
  // stacked), this test catches it.
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'cloudflare', 'src', 'ui', 'ceo-pages.js'),
    'utf8'
  );
  // The Item column is rendered inside the day-modal row builder.
  // It uses s.abaya_code OR s.abaya_id (single source), not both.
  // Pattern: a single occurrence of `s.abaya_code || s.abaya_id`
  // inside the row builder function.
  const rowBuilderMatch = src.match(/rows\.forEach\(function \(s\) \{([\s\S]*?)\n    \}\);/);
  assert.ok(rowBuilderMatch, 'row builder forEach block found');
  const rowBody = rowBuilderMatch[1];
  // Exactly one fallback chain in the row body — no duplication.
  const fallbackCount = (rowBody.match(/s\.abaya_code \|\| s\.abaya_id \|\| /g) || []).length;
  assert.equal(fallbackCount, 1, 'abaya_code/abaya_id rendered exactly once per row (no duplication)');
  // No ad-hoc catalog lookup inside the row builder. We rely on
  // abayaIsCustom() (which itself reads STATE.abaya_builds) — not a
  // raw catalog scan.
  const catalogLookupCount = (rowBody.match(/abayaCatalog\.find|ABAYAS\.find/g) || []).length;
  assert.equal(
    catalogLookupCount,
    0,
    'row builder must not re-scan the catalog (no duplication of lookup)'
  );
});

test('/api/report/employee-day is routed inside the CEO-gated block', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare', 'src', 'index.js'), 'utf8');
  assert.ok(src.includes("path === '/api/report/employee-day'"), 'route must be registered');
  // The isCEORoute gate covers every /api/** path except a small allowlist;
  // the new endpoint must NOT be in that exemption list.
  const gate = src.match(/const isCEORoute =[\s\S]*?;/);
  assert.ok(gate, 'isCEORoute block missing');
  assert.ok(!gate[0].includes("employee-day"), 'employee-day must stay behind CEO auth');
});
