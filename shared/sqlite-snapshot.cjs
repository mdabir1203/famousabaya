'use strict';

/**
 * Local SQLite snapshot store.
 *
 * Produces real SQLite (.db) files whose schema mirrors the Cloudflare D1
 * database (cloudflare/schema.sql + migrations). Files can be opened with any
 * SQLite tool (DB Browser for SQLite, sqlite3 CLI, DataGrip, …) and replayed
 * into D1 via scripts/import-snapshot.cjs.
 *
 * Pure-WASM via sql.js so it works under Yarn PnP without native build tooling.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const snapshotManifest = require('./snapshot-manifest.cjs');

const LATEST_NAME = 'abaya-snapshot-latest.db';
const ARCHIVE_PREFIX = 'abaya-snapshot-';
const SNAPSHOT_FORMAT_VERSION = 1;

const PROCESS_TO_DAILY_COL = {
  'Tailor (01)': 'tailor_01_units',
  'Tailor (02)': 'tailor_02_units',
  'Hand Work': 'hand_work_units',
  'Stone Work': 'stone_work_units',
  Button: 'button_units',
  Embroidery: 'embroidery_units',
  'Ari Work': 'ari_work_units',
  'Hand Designing': 'hand_designing_units',
  'Invoice maker': 'invoice_maker_units',
  Packaging: 'packaging_units',
  Checker: 'checker_units',
  Cutting: 'tailor_01_units',
  'Cutting master': 'tailor_01_units',
  Stitching: 'tailor_02_units',
  Finishing: 'hand_work_units',
};

/**
 * Normalize a process name to the canonical Title-case form the cloud D1
 * stores. **This MUST mirror `cloudflare/src/domain/process.js` →
 * `canonicalEmpProcess` exactly** — when the snapshot's per-process totals
 * differ from the cloud's, the local dashboard contradicts the CEO view.
 *
 * The cloud is the source of truth. If a new alias is added there (e.g.
 * "khaka work" → "Hand Work"), add it here in the same commit. A unit test
 * in `tests/sqlite-snapshot.test.mjs` exercises the full alias matrix so
 * drift is caught at CI.
 */
function canonicalProcess(raw) {
  if (raw == null) return 'Tailor (01)';
  const t = String(raw).trim();
  if (!t) return 'Tailor (01)';
  // Case-insensitive aliases — the floor terminals don't always send Title
  // case, and we used to silently drop "cutting" / "KHAKA WORK" / etc. from
  // the report rollups. Normalize on read so old D1 rows and new push values
  // land in the same bucket.
  const lo = t.toLowerCase();
  if (lo === 'cutting' || lo === 'cutting master') return 'Tailor (01)';
  if (lo === 'stitching') return 'Tailor (02)';
  if (lo === 'finishing') return 'Hand Work';
  if (lo === 'khaka work') return 'Hand Work';
  // Keep Title case for the canonical names so the per-process totals
  // visually match the cloud's process_split_today payload.
  if (
    t === 'Tailor (01)' || t === 'Tailor (02)' || t === 'Hand Work' ||
    t === 'Stone Work' || t === 'Button' || t === 'Embroidery' ||
    t === 'Ari Work' || t === 'Hand Designing' || t === 'Invoice maker' ||
    t === 'Packaging' || t === 'Checker'
  ) return t;
  // Unknown process — pass through unchanged. It will land in the
  // tailor_01_units column (dailyStatsColumnForProcess default) so it's
  // still counted, just under a bucket the operator should notice.
  return t;
}

function dailyStatsColumnForProcess(proc) {
  return PROCESS_TO_DAILY_COL[proc] || 'tailor_01_units';
}

function defaultDir() {
  if (String(process.env.SQLITE_SNAPSHOT_DIR || '').trim()) {
    return path.resolve(process.env.SQLITE_SNAPSHOT_DIR);
  }
  return path.join(__dirname, '..', 'data', 'sqlite-snapshots');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteBytes(filePath, bytes) {
  const tmp = filePath + '.tmp.' + process.pid + '.' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, Buffer.from(bytes));
  if (fs.existsSync(filePath)) {
    snapshotManifest.clearReadOnly(filePath);
  }
  fs.renameSync(tmp, filePath);
  snapshotManifest.setReadOnly(filePath);
}

function parsePositiveIntOrNull(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

/**
 * Normalize a timestamp to Unix seconds.
 *
 * The completedLogs pipeline has been seen in three flavors:
 *   - ms integers  (e.g. 1786971839000, 13 digits,  r.started_at / r.ended_at)
 *   - legacy ms on `start`/`end` (older in-memory shape)
 *   - already-seconds (D1-shaped, < 1e12)
 *
 * Anything > 1e12 is unambiguously ms (year 2001+ in seconds is still < 1e10;
 * 1e12 seconds is far past year 33658). 1e12 ms = Sep 2001 in seconds, so a
 * value just above 1e12 could in theory be either — but anything that
 * survives a real-world session filter is > 1.6e12 in ms (≈ 2020+).
 */
function normalizeToUnixSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function dateStringForUnix(unixSec) {
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hourForUnix(unixSec) {
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getHours();
}

let _sqlJsPromise = null;
function loadSqlJs() {
  if (_sqlJsPromise) return _sqlJsPromise;
  const initSqlJs = require('sql.js');
  _sqlJsPromise = initSqlJs({
    locateFile(file) {
      return require.resolve('sql.js/dist/' + file);
    },
  });
  return _sqlJsPromise;
}

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT    PRIMARY KEY,
  emp_id        TEXT    NOT NULL,
  emp_name      TEXT    NOT NULL,
  emp_code      TEXT    NOT NULL,
  emp_process   TEXT    NOT NULL,
  emp_color     TEXT,
  emp_initials  TEXT,
  abaya_id      TEXT,
  abaya_code    TEXT,
  station       TEXT    DEFAULT 'S-02',
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  duration_sec  INTEGER NOT NULL,
  hour_of_day   INTEGER,
  day_date      TEXT,
  invoice_count INTEGER,
  invoice_serial TEXT,
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS active_sessions (
  emp_id        TEXT    PRIMARY KEY,
  emp_name      TEXT    NOT NULL,
  emp_code      TEXT    NOT NULL,
  emp_process   TEXT    NOT NULL,
  emp_color     TEXT,
  emp_initials  TEXT,
  abaya_id      TEXT,
  abaya_code    TEXT,
  station       TEXT    DEFAULT 'S-02',
  started_at    INTEGER NOT NULL,
  -- Cloud migration 0016: live-state columns the local server pushes so
  -- the CEO view can render the in-shift elapsed without a re-walk. The
  -- factory server is the source of truth for these (see ingest.js
  -- fallback to started_at when the push didn't ship the new fields).
  effective_started_at INTEGER,
  windowed_elapsed_sec INTEGER DEFAULT 0,
  outside_shift      INTEGER DEFAULT 0,
  is_cross_day       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_stats (
  stat_date             TEXT    PRIMARY KEY,
  total_units           INTEGER DEFAULT 0,
  total_sec             INTEGER DEFAULT 0,
  cutting_units         INTEGER DEFAULT 0,
  stitch_units          INTEGER DEFAULT 0,
  finish_units          INTEGER DEFAULT 0,
  tailor_01_units       INTEGER DEFAULT 0,
  tailor_02_units       INTEGER DEFAULT 0,
  hand_work_units       INTEGER DEFAULT 0,
  stone_work_units      INTEGER DEFAULT 0,
  button_units          INTEGER DEFAULT 0,
  embroidery_units      INTEGER DEFAULT 0,
  ari_work_units        INTEGER DEFAULT 0,
  hand_designing_units  INTEGER DEFAULT 0,
  invoice_maker_units   INTEGER DEFAULT 0,
  packaging_units       INTEGER DEFAULT 0,
  checker_units         INTEGER DEFAULT 0,
  peak_hour             INTEGER DEFAULT 0,
  updated_at            INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sessions_emp    ON sessions(emp_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date   ON sessions(day_date);
CREATE INDEX IF NOT EXISTS idx_sessions_proc   ON sessions(emp_process);
CREATE INDEX IF NOT EXISTS idx_sessions_end    ON sessions(ended_at);

CREATE TABLE IF NOT EXISTS abaya_catalog (
  id            TEXT    PRIMARY KEY,
  code          TEXT    NOT NULL,
  barcode       TEXT    NOT NULL UNIQUE,
  design        TEXT    NOT NULL DEFAULT '',
  process       TEXT    NOT NULL,
  icon          TEXT,
  -- Cloud migration 0019: lets the operator mark a style (per-physical
  -- abaya) as a multi-week CUSTOM build. The live row's "this build"
  -- cell then renders a "Custom" pill so a 373h build doesn't look like
  -- a bug. Default 0 keeps existing rows coherent.
  is_custom     INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_abaya_catalog_code ON abaya_catalog(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_abaya_catalog_barcode ON abaya_catalog(barcode);

CREATE TABLE IF NOT EXISTS catalog_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS abaya_time_map (
  abaya_id TEXT PRIMARY KEY,
  abaya_code TEXT,
  cumulative_in_window_sec INTEGER DEFAULT 0,
  first_started_at INTEGER,
  last_ended_at INTEGER,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS employees (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  code      TEXT,
  ac_no     TEXT,
  process   TEXT,
  color     TEXT,
  initials  TEXT,
  units     INTEGER DEFAULT 0,
  eff       INTEGER DEFAULT 0,
  act       INTEGER DEFAULT 0,
  idl       INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS snapshot_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

/**
 * Build a SQLite database in-memory from the given application state.
 *
 * @param {{
 *   activeSessions?: Record<string, any>,
 *   completedLogs?: Array<any>,
 *   employees?: Array<any>,
 *   perf?: Array<any>,
 *   catalog?: Array<any>,
 *   catalogVersion?: number,
 *   workerSettings?: Record<string, string|number|object>,
 *   savedAt?: number,
 *   appVersion?: string,
 * }} state
 * @returns {Promise<Uint8Array>} SQLite file bytes
 */
async function buildSnapshotDatabase(state) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    db.run(SCHEMA_DDL);

    const now = Number(state && state.savedAt) || Date.now();
    const nowSec = Math.floor(now / 1000);

    const employees = Array.isArray(state && state.employees) ? state.employees : [];
    const perfById = new Map();
    if (Array.isArray(state && state.perf)) {
      for (const p of state.perf) {
        if (p && p.id != null) perfById.set(String(p.id), p);
      }
    }
    const empById = new Map();
    for (const e of employees) {
      if (e && e.id != null) empById.set(String(e.id), e);
    }

    const catalog = Array.isArray(state && state.catalog) ? state.catalog : [];
    const catalogById = new Map();
    for (const a of catalog) {
      if (a && a.id != null) catalogById.set(String(a.id), a);
    }

    const insertEmp = db.prepare(`
      INSERT OR REPLACE INTO employees
        (id, name, code, ac_no, process, color, initials, units, eff, act, idl, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of employees) {
      const perf = perfById.get(String(e.id)) || { units: 0, eff: 0, act: 0, idl: 0 };
      insertEmp.run([
        String(e.id || ''),
        String(e.name || ''),
        e.code != null ? String(e.code) : null,
        e.ac_no != null ? String(e.ac_no) : null,
        e.process != null ? String(e.process) : null,
        e.color != null ? String(e.color) : null,
        e.initials != null ? String(e.initials) : null,
        Number(perf.units) || 0,
        Number(perf.eff) || 0,
        Number(perf.act) || 0,
        Number(perf.idl) || 0,
        nowSec,
      ]);
    }
    insertEmp.free();

    const insertCatalog = db.prepare(`
      INSERT OR REPLACE INTO abaya_catalog
        (id, code, barcode, design, process, icon, is_custom, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of catalog) {
      if (!a || a.id == null) continue;
      // Cloud migration 0019: is_custom flag. The cloud is the source of
      // truth — if a row arrives from the cloud PUT as is_custom=1, we
      // preserve it; otherwise default to 0.
      const isCustom = a.is_custom === 1 || a.is_custom === '1' || a.is_custom === true ? 1 : 0;
      insertCatalog.run([
        String(a.id),
        String(a.code || ''),
        String(a.barcode || a.id),
        String(a.design || ''),
        canonicalProcess(a.process || a.process_type || 'Tailor (01)'),
        a.icon != null ? String(a.icon) : null,
        isCustom,
        Number(a.updated_at) || nowSec,
      ]);
    }
    insertCatalog.free();

    const insertCatalogMeta = db.prepare(`
      INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)
    `);
    if (state && state.catalogVersion != null) {
      insertCatalogMeta.run(['version', String(state.catalogVersion)]);
    }
    insertCatalogMeta.run(['rows', String(catalog.length)]);
    insertCatalogMeta.free();

    const insertActive = db.prepare(`
      INSERT OR REPLACE INTO active_sessions
        (emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
         abaya_id, abaya_code, station, started_at,
         effective_started_at, windowed_elapsed_sec, outside_shift, is_cross_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const active = state && state.activeSessions && typeof state.activeSessions === 'object'
      ? state.activeSessions : {};
    let activeInserted = 0;
    for (const key of Object.keys(active)) {
      const sess = active[key];
      if (!sess || typeof sess !== 'object') continue;
      const empId = String(sess.emp_id != null ? sess.emp_id : key);
      // Mirror the cloud D1 trigger (migration 0018) — only real factory
      // employees with a barcoded id (e_bc_<digits>) are persisted.
      if (!/^e_bc_\d+$/.test(empId)) continue;
      const emp = empById.get(empId) || {};
      const ab = catalogById.get(String(sess.abaya_id || '')) || null;
      const startedSec = normalizeToUnixSec(sess.started_at) || nowSec;
      // Cloud migration 0016 live-state columns. The local server doesn't
      // push these yet, so the offline JSON may not have them; fall back to
      // safe defaults so the snapshot stays valid (and ready for the day
      // the local server starts pushing them).
      const effectiveStarted = Number(sess.effective_started_at);
      const effectiveStartedSec = Number.isFinite(effectiveStarted) && effectiveStarted > 0
        ? (effectiveStarted > 1e12 ? Math.floor(effectiveStarted / 1000) : Math.floor(effectiveStarted))
        : null;
      const windowedElapsed = Math.max(0, Math.floor(Number(sess.windowed_elapsed_sec) || 0));
      const outsideShift = sess.outside_shift ? 1 : 0;
      const isCrossDay = sess.is_cross_day ? 1 : 0;
      insertActive.run([
        empId,
        String(emp.name || ''),
        emp.code != null ? String(emp.code) : '',
        canonicalProcess(sess.process || emp.process || 'Tailor (01)'),
        emp.color != null ? String(emp.color) : null,
        emp.initials != null ? String(emp.initials) : null,
        sess.abaya_id != null ? String(sess.abaya_id) : null,
        ab ? String(ab.code || '') : null,
        'S-02',
        startedSec,
        effectiveStartedSec,
        windowedElapsed,
        outsideShift,
        isCrossDay,
      ]);
      activeInserted += 1;
    }
    insertActive.free();

    const insertSession = db.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
         abaya_id, abaya_code, station, started_at, ended_at, duration_sec,
         hour_of_day, day_date, invoice_count, invoice_serial, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const completedLogs = Array.isArray(state && state.completedLogs)
      ? state.completedLogs : [];
    /** @type {Map<string, { total_units: number, total_sec: number, cols: Record<string, number>, peak: number }>} */
    const dailyAgg = new Map();
    /** @type {Map<string, { abaya_code: string|null, cum: number, first: number, last: number }>} */
    const abayaTime = new Map();
    /** Count of completedLog rows that actually landed in the snapshot. */
    let sessionsInserted = 0;
    /** Count of completedLog rows rejected by the e_bc_* filter (diagnostic). */
    let sessionsFilteredSynthetic = 0;

    for (const r of completedLogs) {
      if (!r || r.emp_id == null) continue;
      const empIdStr = String(r.emp_id);
      // Mirror the cloud D1 trigger (migration 0018) — only real factory
      // employees with a barcoded id (e_bc_<digits>) are persisted. This keeps
      // the local snapshot's per-employee / per-day counts coherent with the
      // cloud dashboard, and prevents test/smoke sessions from leaking in.
      if (!/^e_bc_\d+$/.test(empIdStr)) {
        sessionsFilteredSynthetic += 1;
        continue;
      }
      // The pipeline has been seen with both `started_at`/`ended_at` (the
      // canonical ms shape produced by server.js hydration) and the older
      // `start`/`end` fields. Prefer the new names; fall back for legacy.
      const startedSec = normalizeToUnixSec(r.started_at != null ? r.started_at : r.start);
      const endedSec = normalizeToUnixSec(r.ended_at != null ? r.ended_at : r.end);
      if (startedSec == null || endedSec == null) continue;
      const sessionId = `WL-${empIdStr}-${endedSec}`;
      const dayDate = dateStringForUnix(endedSec);
      const hourOfDay = hourForUnix(endedSec);
      const emp = empById.get(String(r.emp_id)) || {};
      const ab = catalogById.get(String(r.abaya_id || '')) || null;
      const proc = canonicalProcess(r.process || emp.process || 'Tailor (01)');
      const dur = Math.max(0, Number(r.duration_sec) || 0);
      const invCount = r.invoice_count != null && r.invoice_count !== '' ? Number(r.invoice_count) : null;
      const invSerial = r.invoice_serial != null && r.invoice_serial !== '' ? String(r.invoice_serial) : null;

      insertSession.run([
        sessionId,
        String(r.emp_id),
        String(emp.name || ''),
        emp.code != null ? String(emp.code) : '',
        proc,
        emp.color != null ? String(emp.color) : null,
        emp.initials != null ? String(emp.initials) : null,
        r.abaya_id != null ? String(r.abaya_id) : null,
        ab ? String(ab.code || '') : null,
        'S-02',
        startedSec,
        endedSec,
        dur,
        hourOfDay,
        dayDate,
        Number.isFinite(invCount) ? invCount : null,
        invSerial,
        nowSec,
      ]);
      sessionsInserted += 1;

      if (dayDate) {
        let agg = dailyAgg.get(dayDate);
        if (!agg) {
          agg = { total_units: 0, total_sec: 0, cols: {}, peak: 0 };
          dailyAgg.set(dayDate, agg);
        }
        agg.total_units += 1;
        agg.total_sec += dur;
        const col = dailyStatsColumnForProcess(proc);
        agg.cols[col] = (agg.cols[col] || 0) + 1;
      }

      if (r.abaya_id != null && String(r.abaya_id) !== '') {
        const key = String(r.abaya_id);
        let cur = abayaTime.get(key);
        if (!cur) {
          cur = {
            abaya_code: ab ? String(ab.code || '') : null,
            cum: 0,
            first: startedSec,
            last: endedSec,
          };
          abayaTime.set(key, cur);
        }
        cur.cum += dur;
        if (startedSec < cur.first) cur.first = startedSec;
        if (endedSec > cur.last) cur.last = endedSec;
      }
    }
    insertSession.free();

    const insertDaily = db.prepare(`
      INSERT OR REPLACE INTO daily_stats (
        stat_date, total_units, total_sec,
        tailor_01_units, tailor_02_units, hand_work_units, stone_work_units,
        button_units, embroidery_units, ari_work_units, hand_designing_units,
        invoice_maker_units, packaging_units, checker_units,
        peak_hour, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [day, agg] of dailyAgg.entries()) {
      insertDaily.run([
        day,
        agg.total_units,
        agg.total_sec,
        agg.cols.tailor_01_units || 0,
        agg.cols.tailor_02_units || 0,
        agg.cols.hand_work_units || 0,
        agg.cols.stone_work_units || 0,
        agg.cols.button_units || 0,
        agg.cols.embroidery_units || 0,
        agg.cols.ari_work_units || 0,
        agg.cols.hand_designing_units || 0,
        agg.cols.invoice_maker_units || 0,
        agg.cols.packaging_units || 0,
        agg.cols.checker_units || 0,
        agg.peak || 0,
        nowSec,
      ]);
    }
    insertDaily.free();

    const insertAbayaTime = db.prepare(`
      INSERT OR REPLACE INTO abaya_time_map
        (abaya_id, abaya_code, cumulative_in_window_sec, first_started_at, last_ended_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [abayaId, v] of abayaTime.entries()) {
      insertAbayaTime.run([abayaId, v.abaya_code, v.cum, v.first, v.last, nowSec]);
    }
    insertAbayaTime.free();

    const insertSetting = db.prepare(`
      INSERT OR REPLACE INTO worker_settings (k, v, updated_at) VALUES (?, ?, ?)
    `);
    if (state && state.workerSettings && typeof state.workerSettings === 'object') {
      for (const k of Object.keys(state.workerSettings)) {
        const raw = state.workerSettings[k];
        const v = typeof raw === 'string' ? raw : JSON.stringify(raw == null ? null : raw);
        insertSetting.run([String(k), v, nowSec]);
      }
    }
    insertSetting.free();

    const insertMeta = db.prepare(`INSERT OR REPLACE INTO snapshot_meta (k, v) VALUES (?, ?)`);
    insertMeta.run(['format_version', String(SNAPSHOT_FORMAT_VERSION)]);
    insertMeta.run(['created_at', String(nowSec)]);
    insertMeta.run(['created_at_iso', new Date(now).toISOString()]);
    insertMeta.run(['host', String(os.hostname() || 'unknown')]);
    insertMeta.run(['platform', String(os.platform() || '')]);
    insertMeta.run(['app_version', String((state && state.appVersion) || '')]);
    insertMeta.run(['completed_count', String(sessionsInserted)]);
    insertMeta.run(['completed_logs_received', String(completedLogs.length)]);
    insertMeta.run(['completed_logs_filtered_synthetic', String(sessionsFilteredSynthetic)]);
    insertMeta.run(['active_count', String(activeInserted)]);
    insertMeta.run(['employees_count', String(employees.length)]);
    insertMeta.run(['catalog_count', String(catalog.length)]);
    if (state && state.catalogVersion != null) {
      insertMeta.run(['catalog_version', String(state.catalogVersion)]);
    }
    insertMeta.free();

    return db.export();
  } finally {
    try { db.close(); } catch (_) { /* noop */ }
  }
}

function timestampForFilename(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Persist a snapshot to disk as a real .db file (atomic) and optionally an
 * archived rotation file. Old archives are pruned by retention.
 *
 * @param {object} state — see buildSnapshotDatabase
 * @param {{
 *   dir?: string,
 *   archive?: boolean,
 *   retentionDays?: number,
 * }} [options]
 * @returns {Promise<{ latestPath: string, archivePath: string|null, bytes: number }>}
 */
async function writeSnapshot(state, options) {
  const opts = options || {};
  const dir = opts.dir || defaultDir();
  ensureDir(dir);
  const bytes = await buildSnapshotDatabase(state);
  const latestPath = path.join(dir, LATEST_NAME);
  atomicWriteBytes(latestPath, bytes);

  let archivePath = null;
  if (opts.archive !== false) {
    const stamp = timestampForFilename(Date.now());
    archivePath = path.join(dir, `${ARCHIVE_PREFIX}${stamp}.db`);
    if (fs.existsSync(archivePath)) {
      archivePath = path.join(
        dir,
        `${ARCHIVE_PREFIX}${stamp}-${crypto.randomBytes(2).toString('hex')}.db`
      );
    }
    try {
      atomicWriteBytes(archivePath, bytes);
    } catch (_) {
      archivePath = null;
    }
  }

  let manifestRecord = null;
  let manifestArchiveRecord = null;
  try {
    const targetForManifest = archivePath || latestPath;
    manifestRecord = snapshotManifest.appendRecord({
      filePath: targetForManifest,
      dir,
      source: opts.source || 'auto',
    });
    if (archivePath && manifestRecord) {
      manifestArchiveRecord = manifestRecord;
      manifestRecord = snapshotManifest.appendRecord({
        filePath: latestPath,
        dir,
        source: opts.source ? `${opts.source}-latest` : 'auto-latest',
      });
    }
  } catch (e) {
    /* signing failure must not block primary persistence */
    manifestRecord = manifestRecord || { error: e && e.message ? e.message : String(e) };
  }

  const retentionDays = parsePositiveIntOrNull(opts.retentionDays);
  if (retentionDays != null) {
    pruneOldDbSnapshots(dir, Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  }

  return {
    latestPath,
    archivePath,
    bytes: bytes.byteLength,
    manifest: manifestRecord,
    manifestArchive: manifestArchiveRecord,
  };
}

/**
 * Remove auxiliary archive files older than cutoff (keeps latest .db).
 * @param {string} dir
 * @param {number} cutoffMs
 */
function pruneOldDbSnapshots(dir, cutoffMs) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return;
  }
  for (const name of names) {
    if (name === LATEST_NAME || !name.endsWith('.db')) continue;
    if (!name.startsWith(ARCHIVE_PREFIX)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoffMs) {
        snapshotManifest.clearReadOnly(full);
        fs.unlinkSync(full);
        try {
          snapshotManifest.appendRetire({ dir, filename: name, reason: 'retention' });
        } catch (_) { /* manifest is best-effort */ }
      }
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Open a .db snapshot for read-only inspection.
 * @param {string} filePath
 * @returns {Promise<{ db: any, sql: any, close: () => void }>}
 */
async function openSnapshotDatabase(filePath) {
  const SQL = await loadSqlJs();
  const data = fs.readFileSync(filePath);
  const db = new SQL.Database(new Uint8Array(data));
  return {
    db,
    sql: SQL,
    close() {
      try { db.close(); } catch (_) { /* noop */ }
    },
  };
}

module.exports = {
  defaultDir,
  buildSnapshotDatabase,
  writeSnapshot,
  pruneOldDbSnapshots,
  openSnapshotDatabase,
  LATEST_NAME,
  ARCHIVE_PREFIX,
  SNAPSHOT_FORMAT_VERSION,
};
