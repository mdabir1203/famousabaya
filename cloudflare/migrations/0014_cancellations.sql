-- AbaYa Track — Migration 0014: Cancellations log for the Check Report
-- Run: cd cloudflare && npx wrangler d1 execute abaya-db --remote --file=migrations/0014_cancellations.sql
--
-- The cloud CEO dashboard's "Check Report" panel lets the supervisor
-- record cancellations (e.g. material defect, customer change-of-mind)
-- against a specific invoice / abaya code / factory. The cancellation
-- is a first-class record — it persists in D1, shows up in the
-- production report, and survives server restarts.
--
-- Schema is intentionally lightweight: the front-end enforces the
-- "at least one of invoice / abaya code" rule (so the cancellation
-- stays traceable), the API just stores whatever the supervisor typed.
--
-- Cancelled_at is stored in Unix ms so the report can range-filter
-- across day boundaries in the production timezone (Asia/Dubai).

CREATE TABLE IF NOT EXISTS cancellations (
  id            TEXT    PRIMARY KEY,
  factory       TEXT    NOT NULL DEFAULT '',
  invoice_no    TEXT    NOT NULL DEFAULT '',
  abaya_code    TEXT    NOT NULL DEFAULT '',
  cancelled_at  INTEGER NOT NULL,                  -- Unix ms
  cancelled_by  TEXT    NOT NULL DEFAULT '',
  reason        TEXT    NOT NULL DEFAULT '',
  source        TEXT    NOT NULL DEFAULT 'ceo',     -- 'ceo' (dashboard), 'auto' (future)
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_cancellations_cancelled_at
  ON cancellations(cancelled_at DESC);

CREATE INDEX IF NOT EXISTS idx_cancellations_invoice_no
  ON cancellations(invoice_no);

CREATE INDEX IF NOT EXISTS idx_cancellations_abaya_code
  ON cancellations(abaya_code);
