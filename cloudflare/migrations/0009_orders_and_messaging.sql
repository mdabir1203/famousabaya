-- AbaYa Track — Migration 0009: customer phone + billable customer-messaging
-- Run: cd cloudflare && npx wrangler d1 execute abaya-db --file=migrations/0009_orders_and_messaging.sql [--remote]
--
-- Adds the cloud-side pieces for the order-lifecycle work:
--   1. dispatch_invoices.customer_phone — parsed from notes by the factory/Worker;
--      the destination for the "your order is ready" message on delivery.
--      (Per-abaya `done` flags ride inside the existing `items` JSON column — no
--       schema change needed for them.)
--   2. messaging_settings — a singleton row the CEO toggles from the dashboard to
--      turn customer notifications on/off "at will". Disabled by default.
--   3. customer_messages — the audit log AND billing meter: one row per send
--      attempt (sent | skipped | failed), so usage can be counted and charged.

-- 1. Customer phone on the invoice (nullable; back-compat with existing rows).
ALTER TABLE dispatch_invoices ADD COLUMN customer_phone TEXT;

-- 2. Singleton messaging config (id is always 1). Disabled until the CEO enables it.
CREATE TABLE IF NOT EXISTS messaging_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  enabled       INTEGER NOT NULL DEFAULT 0,         -- 0 = off, 1 = on (CEO toggle)
  template_mode TEXT    NOT NULL DEFAULT 'freeform', -- 'freeform' | 'template'
  template_name TEXT,                                -- Meta-approved template (when template_mode='template')
  updated_at    INTEGER
);
INSERT OR IGNORE INTO messaging_settings (id, enabled, template_mode, updated_at)
  VALUES (1, 0, 'freeform', 0);

-- 3. Per-message log / billing meter.
CREATE TABLE IF NOT EXISTS customer_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT    NOT NULL,
  to_phone   TEXT,
  status     TEXT    NOT NULL,                       -- 'sent' | 'skipped' | 'failed'
  ts         INTEGER NOT NULL,                       -- Unix ms
  error      TEXT                                    -- short reason when status != 'sent'
);
-- One successful customer notification per invoice (idempotent delivery messaging).
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_messages_sent_once
  ON customer_messages(invoice_id) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_customer_messages_ts ON customer_messages(ts DESC);
