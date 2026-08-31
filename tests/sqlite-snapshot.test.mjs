/**
 * Regression tests for the local SQLite snapshot writer
 * (shared/sqlite-snapshot.cjs).
 *
 * These tests guard against the production bug observed on 2026-08-31:
 *   - The `sessions` table came out empty even though `completed_count`
 *     meta said 5,898 — the writer was reading `r.start`/`r.end` instead
 *     of `r.started_at`/`r.ended_at` and silently skipping every row.
 *   - The writer had no synthetic-emp_id filter, so the local snapshot's
 *     per-employee / per-day counts diverged 21x from the cloud D1 (which
 *     has the migration 0018 trigger that drops non-`e_bc_*` rows).
 *
 * The tests below assert:
 *   1. Logs with `started_at`/`ended_at` (ms) land in `sessions`.
 *   2. Logs with legacy `start`/`end` (ms) still land (backward compat).
 *   3. `e_bc_<digits>` ids land; everything else is filtered and counted
 *      in the `completed_logs_filtered_synthetic` meta key.
 *   4. `completed_count` meta equals the actual inserted row count, not
 *      the input count.
 *   5. Timestamps are stored in **seconds** (matching the cloud D1 schema),
 *      not milliseconds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Lazy-load the CJS module so a single load failure is reported per test.
const sqliteSnapshot = require(path.join(REPO_ROOT, 'shared', 'sqlite-snapshot.cjs'));

// Lazy-load sql.js from the project's node_modules.
let SQL_LIB = null;
async function getSqlJs() {
  if (SQL_LIB) return SQL_LIB;
  const initSqlJs = require(path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js'));
  SQL_LIB = await initSqlJs({
    locateFile: () => path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  });
  return SQL_LIB;
}

async function buildAndInspect(state) {
  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase(state);
  const tmp = path.join(os.tmpdir(), `snap-test-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  const db = new SQL.Database(fs.readFileSync(tmp));
  const tables = {};
  for (const t of ['employees','active_sessions','sessions','daily_stats','abaya_time_map','abaya_catalog']) {
    const r = db.exec(`SELECT COUNT(*) FROM ${t}`);
    tables[t] = r[0] ? r[0].values[0][0] : 0;
  }
  const meta = {};
  const m = db.exec('SELECT k, v FROM snapshot_meta');
  for (const [k, v] of m[0].values) meta[k] = v;
  fs.unlinkSync(tmp);
  return { tables, meta };
}

const baseState = () => ({
  employees: [
    { id: 'e_bc_00000121', name: 'Test Emp', code: 'EMP121', process: 'Hand Work', color: '#6a5fc1', initials: 'TE' },
  ],
  catalog: [
    { id: '5234', code: 'FWAP 3694 PRE-O', barcode: '5234', design: 'fwap', process: 'Hand Work' },
  ],
  activeSessions: {},
  perf: [],
  catalogVersion: 1,
  workerSettings: {},
  appVersion: 'test',
  savedAt: 1788166233551,
});

test('logs with new field names (started_at/ended_at in ms) land in sessions', async () => {
  const state = baseState();
  state.completedLogs = [
    {
      emp_id: 'e_bc_00000121',
      abaya_id: '5234',
      process: 'Hand Work',
      started_at: 1787757766000,  // ms
      ended_at: 1787757900000,    // ms
      duration_sec: 134,
      hour_of_day: 19,
      day_date: '2026-08-26',
    },
  ];
  const { tables, meta } = await buildAndInspect(state);
  assert.equal(tables.sessions, 1, 'one session should be inserted');
  assert.equal(tables.daily_stats, 1, 'one daily_stats row');
  assert.equal(tables.abaya_time_map, 1, 'one abaya_time_map row');
  assert.equal(meta.completed_count, '1');
  assert.equal(meta.completed_logs_received, '1');
  assert.equal(meta.completed_logs_filtered_synthetic, '0');
});

test('logs with legacy field names (start/end in ms) still land', async () => {
  const state = baseState();
  state.completedLogs = [
    {
      emp_id: 'e_bc_00000121',
      abaya_id: '5234',
      process: 'Hand Work',
      start: 1787757766000,  // legacy ms
      end: 1787757900000,    // legacy ms
      duration_sec: 134,
      hour: 19,
      day_date: '2026-08-26',
    },
  ];
  const { tables, meta } = await buildAndInspect(state);
  assert.equal(tables.sessions, 1, 'legacy start/end should still work');
  assert.equal(meta.completed_count, '1');
});

test('synthetic emp_ids (e1..e26, TEST_*, etc.) are filtered out', async () => {
  const state = baseState();
  state.completedLogs = [
    // Real barcoded id — should land.
    {
      emp_id: 'e_bc_00000121', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134,
      hour_of_day: 19, day_date: '2026-08-26',
    },
    // Smoke-test style synthetic ids — must be rejected.
    { emp_id: 'e1',           abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134,
      hour_of_day: 19, day_date: '2026-08-26' },
    { emp_id: 'e7',           abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134,
      hour_of_day: 19, day_date: '2026-08-26' },
    { emp_id: 'test-smoke-emp', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134,
      hour_of_day: 19, day_date: '2026-08-26' },
    { emp_id: 'ALIGN_DEMO_1', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134,
      hour_of_day: 19, day_date: '2026-08-26' },
    { emp_id: 'POSTDEPLOY_PROBE', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134,
      hour_of_day: 19, day_date: '2026-08-26' },
  ];
  const { tables, meta } = await buildAndInspect(state);
  assert.equal(tables.sessions, 1, 'only the e_bc_* row should land');
  assert.equal(meta.completed_count, '1', 'completed_count reflects actual inserts');
  assert.equal(meta.completed_logs_received, '6', 'completed_logs_received preserves the input count');
  assert.equal(meta.completed_logs_filtered_synthetic, '5', '5 synthetic rows were rejected');
});

test('timestamps are stored as Unix seconds, not milliseconds', async () => {
  const state = baseState();
  // Use a value where ms and sec are visibly different: 1787757900000 ms = 1787757900 sec.
  state.completedLogs = [
    {
      emp_id: 'e_bc_00000121', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134,
      hour_of_day: 19, day_date: '2026-08-26',
    },
  ];
  const { tables } = await buildAndInspect(state);
  assert.equal(tables.sessions, 1);

  // Re-open the bytes and verify the column values.
  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase(state);
  const tmp = path.join(os.tmpdir(), `snap-units-${process.pid}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  const db = new SQL.Database(fs.readFileSync(tmp));
  const r = db.exec('SELECT started_at, ended_at FROM sessions LIMIT 1');
  const [started, ended] = r[0].values[0];
  // ms 1787757766000 → sec 1787757766
  // ms 1787757900000 → sec 1787757900
  assert.equal(started, 1787757766, 'started_at must be stored in seconds');
  assert.equal(ended,   1787757900, 'ended_at must be stored in seconds');
  // Sanity: must be the year 2026, not the year 60556 (which is what ms would give).
  const d = new Date(ended * 1000);
  assert.equal(d.getUTCFullYear(), 2026);
  fs.unlinkSync(tmp);
});

test('active_sessions also reject synthetic emp_ids', async () => {
  const state = baseState();
  state.activeSessions = {
    'e_bc_00000121': { emp_id: 'e_bc_00000121', abaya_id: '5234', started_at: 1787757766000, process: 'Hand Work' },
    'e7':            { emp_id: 'e7',            abaya_id: '5234', started_at: 1787757766000, process: 'Hand Work' },
  };
  const { tables, meta } = await buildAndInspect(state);
  assert.equal(tables.active_sessions, 1, 'only the e_bc_* active session is kept');
  assert.equal(meta.active_count, '1', 'active_count reflects actual inserts');
});

test('meta keys are honest: completed_count != completed_logs_received when filtering happens', async () => {
  const state = baseState();
  // 1 real + 4 synthetic = 5 input rows, 1 inserted.
  state.completedLogs = [
    { emp_id: 'e_bc_00000121', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134, day_date: '2026-08-26' },
    { emp_id: 'e1', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134, day_date: '2026-08-26' },
    { emp_id: 'e2', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134, day_date: '2026-08-26' },
    { emp_id: 'TEST_X', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134, day_date: '2026-08-26' },
    { emp_id: 'ALIGN_DEMO_X', abaya_id: '5234', process: 'Hand Work',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134, day_date: '2026-08-26' },
  ];
  const { meta } = await buildAndInspect(state);
  assert.equal(meta.completed_count, '1');
  assert.equal(meta.completed_logs_received, '5');
  assert.equal(meta.completed_logs_filtered_synthetic, '4');
  assert.notEqual(meta.completed_count, meta.completed_logs_received,
    'completed_count and completed_logs_received must differ when filtering is active');
});

test('canonicalProcess mirrors the cloud: case-insensitive aliases + khaka work', async () => {
  // This guards the cloud/local coherence: if the local snapshot maps
  // "khaka work" to "Hand Work" but the cloud maps it to itself, the
  // per-process totals on the local dashboard will contradict the CEO
  // view. The cloud's canonicalEmpProcess is the source of truth.
  const state = baseState();
  // Send logs with each alias; check the sessions.emp_process column.
  const cases = [
    { input: 'Tailor (01)',   want: 'Tailor (01)' },
    { input: 'cutting',       want: 'Tailor (01)' },
    { input: 'CUTTING',       want: 'Tailor (01)' },
    { input: 'Cutting master',want: 'Tailor (01)' },
    { input: 'stitching',     want: 'Tailor (02)' },
    { input: 'STITCHING',     want: 'Tailor (02)' },
    { input: 'finishing',     want: 'Hand Work' },
    { input: 'khaka work',    want: 'Hand Work' },
    { input: 'KHAKA WORK',    want: 'Hand Work' },
    { input: 'Hand Work',     want: 'Hand Work' },
    { input: 'Stone Work',    want: 'Stone Work' },
    { input: 'Embroidery',    want: 'Embroidery' },
    { input: 'Invoice maker', want: 'Invoice maker' },
  ];
  state.completedLogs = cases.map((c, i) => ({
    emp_id: 'e_bc_00000121',
    abaya_id: '5234',
    process: c.input,
    started_at: 1787757766000 + i * 1000,  // distinct start times
    ended_at:   1787757900000 + i * 1000,
    duration_sec: 134,
    hour_of_day: 19,
    day_date: '2026-08-26',
  }));

  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase(state);
  const tmp = path.join(os.tmpdir(), `snap-proc-${process.pid}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  const db = new SQL.Database(fs.readFileSync(tmp));
  const r = db.exec('SELECT id, emp_process FROM sessions ORDER BY started_at');
  const got = r[0].values.map(row => row[1]);
  fs.unlinkSync(tmp);
  for (let i = 0; i < cases.length; i++) {
    assert.equal(
      got[i], cases[i].want,
      `canonicalProcess("${cases[i].input}") → expected "${cases[i].want}", got "${got[i]}"`
    );
  }
});

test('active_sessions DDL includes the cloud migration 0016 live-state columns', async () => {
  // The local server may not push these yet, but the snapshot's DDL
  // must have the columns so the schema is forward-compatible with
  // migration 0016. Otherwise the local dashboard would silently
  // disagree with the cloud once the local server starts pushing them.
  const state = baseState();
  state.activeSessions = {
    'e_bc_00000121': { emp_id: 'e_bc_00000121', abaya_id: '5234', started_at: 1787757766000, process: 'Hand Work' },
  };
  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase(state);
  const tmp = path.join(os.tmpdir(), `snap-active-cols-${process.pid}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  const db = new SQL.Database(fs.readFileSync(tmp));
  const r = db.exec('PRAGMA table_info(active_sessions)');
  const cols = r[0].values.map(row => row[1]);
  fs.unlinkSync(tmp);
  for (const want of ['effective_started_at', 'windowed_elapsed_sec', 'outside_shift', 'is_cross_day']) {
    assert.ok(cols.includes(want), `active_sessions must have column ${want} (cloud migration 0016)`);
  }
});

test('abaya_catalog DDL includes is_custom (cloud migration 0019)', async () => {
  const state = baseState();
  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase(state);
  const tmp = path.join(os.tmpdir(), `snap-cat-cols-${process.pid}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  const db = new SQL.Database(fs.readFileSync(tmp));
  const r = db.exec('PRAGMA table_info(abaya_catalog)');
  const cols = r[0].values.map(row => row[1]);
  fs.unlinkSync(tmp);
  assert.ok(cols.includes('is_custom'),
    'abaya_catalog must have is_custom column (cloud migration 0019)');
});

test('abaya_catalog.is_custom is preserved when set on the source row', async () => {
  const state = baseState();
  state.catalog = [
    { id: '3439', code: 'CF111 STD-O', barcode: '3439', design: 'cf111', process: 'Hand Work', is_custom: 1 },
    { id: '5234', code: 'FWAP 3694 PRE-O', barcode: '5234', design: 'fwap', process: 'Hand Work' }, // no is_custom
  ];
  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase(state);
  const tmp = path.join(os.tmpdir(), `snap-custom-${process.pid}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  const db = new SQL.Database(fs.readFileSync(tmp));
  const r = db.exec('SELECT id, is_custom FROM abaya_catalog ORDER BY id');
  const byId = Object.fromEntries(r[0].values);
  fs.unlinkSync(tmp);
  assert.equal(byId['3439'], 1, 'is_custom=1 must be preserved from the source');
  assert.equal(byId['5234'], 0, 'is_custom defaults to 0 when missing');
});

test('new emp_id forms (e_bc_<digits>) keep working as the factory adds employees', async () => {
  // Forward-compat: a fresh hire is barcoded e_bc_00000999 today, then
  // e_bc_00001000 tomorrow, then e_bc_999999 next year. All should
  // land in the snapshot without code changes. The only rule is the
  // regex /^e_bc_\d+$/, which already accepts any digit count.
  const state = baseState();
  state.employees = [
    { id: 'e_bc_00000121', name: 'Test', code: 'EMP121', process: 'Hand Work' },
    { id: 'e_bc_00001000', name: 'New Hire', code: 'EMP1000', process: 'Tailor (02)' },
    { id: 'e_bc_999999',   name: 'Future',  code: 'EMP999999', process: 'Stone Work' },
  ];
  state.completedLogs = state.employees.map((e, i) => ({
    emp_id: e.id,
    abaya_id: '5234',
    process: e.process,
    started_at: 1787757766000 + i * 1000,
    ended_at:   1787757900000 + i * 1000,
    duration_sec: 134,
    hour_of_day: 19,
    day_date: '2026-08-26',
  }));
  const { tables } = await buildAndInspect(state);
  assert.equal(tables.sessions, 3, 'all 3 employee ids should land in sessions');
});

test('forward-compat: new process names bucket under tailor_01_units (silent default)', async () => {
  // If the factory adds a new process (e.g. "QC Review") that the
  // PROCESS_TO_DAILY_COL map doesn't know about, the snapshot writer
  // silently buckets it into tailor_01_units (the default). This is
  // documented behavior — the operator notices via the count, then
  // updates the map. Crucially, the session still gets counted and
  // the row still lands; nothing is silently dropped.
  const state = baseState();
  state.completedLogs = [
    { emp_id: 'e_bc_00000121', abaya_id: '5234', process: 'Brand New Process',
      started_at: 1787757766000, ended_at: 1787757900000, duration_sec: 134, day_date: '2026-08-26' },
  ];
  const { tables } = await buildAndInspect(state);
  assert.equal(tables.sessions, 1, 'unknown process still inserts a session');
  assert.equal(tables.daily_stats, 1, 'unknown process still updates daily_stats');
  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase(state);
  const tmp = path.join(os.tmpdir(), `snap-new-proc-${process.pid}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  const db = new SQL.Database(fs.readFileSync(tmp));
  const r = db.exec('SELECT tailor_01_units FROM daily_stats');
  const v = r[0].values[0][0];
  fs.unlinkSync(tmp);
  assert.equal(v, 1, 'unknown process buckets into tailor_01_units (silent default)');
});
