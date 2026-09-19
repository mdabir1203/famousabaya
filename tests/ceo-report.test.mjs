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

test('/api/report/employee-day is routed inside the CEO-gated block', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare', 'src', 'index.js'), 'utf8');
  assert.ok(src.includes("path === '/api/report/employee-day'"), 'route must be registered');
  // The isCEORoute gate covers every /api/** path except a small allowlist;
  // the new endpoint must NOT be in that exemption list.
  const gate = src.match(/const isCEORoute =[\s\S]*?;/);
  assert.ok(gate, 'isCEORoute block missing');
  assert.ok(!gate[0].includes("employee-day"), 'employee-day must stay behind CEO auth');
});
