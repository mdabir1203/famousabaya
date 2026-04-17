'use strict';

/**
 * Optional durable state on the factory PC (SQLite via better-sqlite3).
 * Disabled when LOCAL_SQLITE=0 or when better-sqlite3 fails to load.
 *
 * Persists: active sessions, recent completed logs, per-employee perf counters.
 */

const path = require('path');
const fs = require('fs');

let db = null;
let _enabled = false;
let _root = '';

function isEnabled() {
  return !!(_enabled && db);
}

function getDbPath(rootDir) {
  const dir = String(process.env.LOCAL_SQLITE_DIR || '').trim()
    ? path.resolve(process.env.LOCAL_SQLITE_DIR)
    : path.join(rootDir, 'data');
  return path.join(dir, 'local-state.sqlite');
}

const LOG_LIMIT_DEFAULT = Math.max(
  100,
  Math.min(100000, Number(process.env.LOCAL_SQLITE_LOG_LIMIT) || 8000)
);

function init(rootDir) {
  _root = rootDir;
  if (String(process.env.LOCAL_SQLITE || '').trim() === '0') {
    console.log('[local-store] Disabled (LOCAL_SQLITE=0)');
    return;
  }
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.warn('[local-store] better-sqlite3 not available — running in-memory only:', e.message);
    return;
  }
  const fp = getDbPath(rootDir);
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
  } catch (e) {
    console.warn('[local-store] mkdir:', e.message);
    return;
  }
  try {
    db = new Database(fp);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS active_sessions (
        emp_id TEXT PRIMARY KEY NOT NULL,
        abaya_id TEXT NOT NULL,
        log_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        process TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS completed_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        emp_id TEXT NOT NULL,
        abaya_id TEXT NOT NULL,
        process TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        duration_sec INTEGER NOT NULL,
        hour INTEGER NOT NULL,
        invoice_count INTEGER,
        invoice_serial TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_completed_end ON completed_logs(end_ts);
      CREATE TABLE IF NOT EXISTS emp_perf (
        emp_id TEXT PRIMARY KEY NOT NULL,
        units INTEGER NOT NULL DEFAULT 0,
        eff INTEGER NOT NULL DEFAULT 0,
        act INTEGER NOT NULL DEFAULT 0,
        idl INTEGER NOT NULL DEFAULT 0
      );
    `);
    _trimOldLogs();
    _enabled = true;
    console.log('[local-store] SQLite:', fp);
  } catch (e) {
    console.error('[local-store] Init failed:', e.message);
    db = null;
  }
}

function _trimOldLogs() {
  if (!db) return;
  const lim = LOG_LIMIT_DEFAULT;
  db.exec(`
    DELETE FROM completed_logs WHERE id NOT IN (
      SELECT id FROM completed_logs ORDER BY id DESC LIMIT ${lim}
    );
  `);
}

/**
 * @returns {{ active: Object, logs: Array, perf: Array<{id:string,units:number,eff:number,act:number,idl:number}> } | null}
 */
function loadState(employeeIds) {
  if (!isEnabled()) return null;
  const active = {};
  const rows = db.prepare('SELECT emp_id, abaya_id, log_id, started_at, process FROM active_sessions').all();
  for (const r of rows) {
    active[r.emp_id] = {
      emp_id: r.emp_id,
      abaya_id: r.abaya_id,
      log_id: r.log_id,
      started_at: r.started_at,
      process: r.process,
    };
  }
  const logs = db
    .prepare(
      `SELECT emp_id, abaya_id, process, start_ts, end_ts, duration_sec, hour, invoice_count, invoice_serial
       FROM completed_logs ORDER BY id ASC`
    )
    .all()
    .map((r) => ({
      emp_id: r.emp_id,
      abaya_id: r.abaya_id,
      process: r.process,
      start: r.start_ts,
      end: r.end_ts,
      duration_sec: r.duration_sec,
      hour: r.hour,
      invoice_count: r.invoice_count == null ? undefined : r.invoice_count,
      invoice_serial: r.invoice_serial == null ? undefined : r.invoice_serial,
    }));
  const perfRows = db.prepare('SELECT emp_id, units, eff, act, idl FROM emp_perf').all();
  const perfMap = new Map(perfRows.map((p) => [p.emp_id, p]));
  const perf = [];
  for (const id of employeeIds) {
    const p = perfMap.get(id);
    if (p) {
      perf.push({ id: p.emp_id, units: p.units, eff: p.eff, act: p.act, idl: p.idl });
    } else {
      perf.push({ id, units: 0, eff: 0, act: 0, idl: 0 });
    }
  }
  return { active, logs, perf };
}

function replaceActiveSessions(map) {
  if (!isEnabled()) return;
  const tx = db.transaction(() => {
    db.exec('DELETE FROM active_sessions');
    const ins = db.prepare(
      `INSERT INTO active_sessions (emp_id, abaya_id, log_id, started_at, process)
       VALUES (@emp_id, @abaya_id, @log_id, @started_at, @process)`
    );
    for (const k of Object.keys(map)) {
      const s = map[k];
      ins.run({
        emp_id: s.emp_id,
        abaya_id: s.abaya_id,
        log_id: s.log_id,
        started_at: s.started_at,
        process: s.process,
      });
    }
  });
  tx();
}

function upsertActiveSession(sess) {
  if (!isEnabled()) return;
  db.prepare(
    `INSERT OR REPLACE INTO active_sessions (emp_id, abaya_id, log_id, started_at, process)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sess.emp_id, sess.abaya_id, sess.log_id, sess.started_at, sess.process);
}

function deleteActiveSession(empId) {
  if (!isEnabled()) return;
  db.prepare('DELETE FROM active_sessions WHERE emp_id = ?').run(empId);
}

function appendCompleted(record) {
  if (!isEnabled()) return;
  db.prepare(
    `INSERT INTO completed_logs
     (emp_id, abaya_id, process, start_ts, end_ts, duration_sec, hour, invoice_count, invoice_serial)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.emp_id,
    record.abaya_id,
    record.process,
    record.start,
    record.end,
    record.duration_sec,
    record.hour,
    record.invoice_count == null ? null : record.invoice_count,
    record.invoice_serial == null ? null : String(record.invoice_serial)
  );
  _trimOldLogs();
}

function saveEmpPerf(perfArr) {
  if (!isEnabled()) return;
  const upsert = db.prepare(
    `INSERT INTO emp_perf (emp_id, units, eff, act, idl) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(emp_id) DO UPDATE SET
       units = excluded.units, eff = excluded.eff, act = excluded.act, idl = excluded.idl`
  );
  const tx = db.transaction(() => {
    for (const p of perfArr) {
      upsert.run(p.id, p.units, p.eff, p.act, p.idl);
    }
  });
  tx();
}

module.exports = {
  init,
  isEnabled,
  loadState,
  replaceActiveSessions,
  upsertActiveSession,
  deleteActiveSession,
  appendCompleted,
  saveEmpPerf,
};
