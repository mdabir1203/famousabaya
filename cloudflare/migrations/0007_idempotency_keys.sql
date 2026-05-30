-- AbaYa Track — Migration 0007: Idempotency keys for the factory ↔ Worker bridge
-- Run: cd cloudflare && npx wrangler d1 execute abaya-db --file=migrations/0007_idempotency_keys.sql [--remote]
--
-- Stores the X-Idempotency-Key header value seen on each PATCH /dispatch/invoices/:id/status.
-- A retry of the same status transition replays the same key, lets the Worker short-circuit
-- without re-applying state or re-firing notifyFactory().
--
-- TTL is enforced lazily by the handler (DELETE WHERE created_at < now - 24h on every check).
-- 24 h is generous slack for any conceivable factory ↔ Worker retry window.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL                       -- Unix ms
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at
  ON idempotency_keys(created_at);
