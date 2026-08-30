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
