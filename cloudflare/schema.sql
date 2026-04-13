-- AbaYa Track — D1 Database Schema
-- Run: wrangler d1 execute abaya-db --file=schema.sql

-- ─── COMPLETED SESSIONS (permanent ledger) ───────────────────────────────────
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

-- ─── LIVE ACTIVE SESSIONS (overwritten on start, deleted on finish) ──────────
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
  started_at    INTEGER NOT NULL
);

-- ─── DAILY AGGREGATES (updated on each finish) ───────────────────────────────
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

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_emp    ON sessions(emp_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date   ON sessions(day_date);
CREATE INDEX IF NOT EXISTS idx_sessions_proc   ON sessions(emp_process);
CREATE INDEX IF NOT EXISTS idx_sessions_end    ON sessions(ended_at);

-- ─── ABAYA CATALOG (office Excel → Worker PUT → D1) ───────────────────────────
CREATE TABLE IF NOT EXISTS abaya_catalog (
  id            TEXT    PRIMARY KEY,
  code          TEXT    NOT NULL UNIQUE,
  barcode       TEXT    NOT NULL UNIQUE,
  design        TEXT    NOT NULL DEFAULT '',
  process       TEXT    NOT NULL,
  icon          TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS catalog_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
