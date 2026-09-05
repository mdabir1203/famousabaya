﻿-- AbaYa Track — D1 Database Schema
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
  code          TEXT    NOT NULL,
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

-- ─── WORKER SETTINGS (working-hours, profiles, etc.) ─────────────────────────
CREATE TABLE IF NOT EXISTS worker_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- ─── CROSS-DAY ABAYA TIME MAPPING (persistent lifecycle rollup) ─────────────
CREATE TABLE IF NOT EXISTS abaya_time_map (
  abaya_id TEXT PRIMARY KEY,
  abaya_code TEXT,
  cumulative_in_window_sec INTEGER DEFAULT 0,
  first_started_at INTEGER,
  last_ended_at INTEGER,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- ─── SUPPORT TICKETS (v1.2.24+) ────────────────────────────────────────────────
-- See cloudflare/migrations/0020_create_tickets.sql for the full rationale.
-- The launcher lets operators create tickets; wa.me sends them to the office;
-- an office-side whatsapp-web.js bot (Phase 2) captures replies via webhook.
CREATE TABLE IF NOT EXISTS tickets (
  id              TEXT    PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  created_by      TEXT    NOT NULL,
  created_by_name TEXT,
  category        TEXT    NOT NULL,
  priority        TEXT    NOT NULL DEFAULT 'normal',
  subject         TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'open',
  resolved_at     INTEGER,
  resolved_by     TEXT,
  whatsapp_to     TEXT,
  escalated_at    INTEGER,
  last_message_at INTEGER,
  station         TEXT,
  updated_at      INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT    NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event       TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  at          INTEGER NOT NULL,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     TEXT    NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  direction     TEXT    NOT NULL,
  sender        TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  via           TEXT    NOT NULL DEFAULT 'wa.me',
  wa_message_id TEXT,
  sent_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_status        ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at    ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by    ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_category      ON tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_priority      ON tickets(priority, status);
CREATE INDEX IF NOT EXISTS idx_tickets_last_message  ON tickets(last_message_at);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket  ON ticket_events(ticket_id, at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_dedup  ON ticket_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;