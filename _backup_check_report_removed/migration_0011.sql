-- AbaYa Track — Migration 0011: Check Report manual cancellations
--
-- Why: the Production Throughput "Check Report" feature exposes manually
-- recorded cancellations as a first-class operational state. We never derive
-- Cancelled = total - delivered - pending; the dashboard reads these rows
-- directly so a real record is required to mark an abaya as cancelled.
--
-- Storage:
--   - A single D1 table keyed on auto-incrementing `id`.
--   - Indexed on (factory, cancelled_at) so the report's windowed
--     "WHERE factory=? AND cancelled_at BETWEEN ? AND ?" is a single seek.
--   - Either `invoice_no` or `abaya_code` is non-empty — the server
--     enforces this on POST so every cancellation stays traceable to the
--     factory → invoice → abaya hierarchy the spec requires.
--
-- Apply:
--   npx wrangler d1 execute abaya-db --remote --config wrangler.toml \
--     --file=cloudflare/migrations/0011_check_report_cancellations.sql
-- Or via the deploy script (idempotent; CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS check_report_cancellations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  factory       TEXT    NOT NULL,
  invoice_no    TEXT    NOT NULL DEFAULT '',
  abaya_code    TEXT    NOT NULL DEFAULT '',
  reason        TEXT    NOT NULL DEFAULT '',
  cancelled_by  TEXT    NOT NULL DEFAULT '',
  cancelled_at  INTEGER NOT NULL,                 -- Unix ms
  source        TEXT    NOT NULL DEFAULT 'manual',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- One row per (factory, abaya_code, cancelled_at) keeps the dashboard view
-- idempotent: re-recording the same abaya in the same minute won't duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_check_report_cancellations_dedupe
  ON check_report_cancellations(factory, abaya_code, cancelled_at)
  WHERE abaya_code != '';

CREATE INDEX IF NOT EXISTS idx_check_report_cancellations_window
  ON check_report_cancellations(factory, cancelled_at DESC);
