-- AbaYa Track — Migration 0006: Dispatch Invoices
-- Run: cd cloudflare && npx wrangler d1 execute abaya-db --file=migrations/0006_dispatch_invoices.sql [--remote]
--
-- Each delivery invoice covers up to 4 abaya material selections.
-- Items are stored as a JSON array in the `items` column to avoid
-- a join on every leaderboard query (small payload, read-heavy).
--
-- items JSON shape:
--   [{ "pos": 1, "materialSpec": "Silk Nida", "color": "Black", "qty": "2.5m" }, ...]

CREATE TABLE IF NOT EXISTS dispatch_invoices (
  id           TEXT    PRIMARY KEY,
  supplier     TEXT    NOT NULL,
  target_queue TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'PENDING', -- PENDING | ARRIVED | DELIVERED
  sla_deadline INTEGER NOT NULL,                   -- Unix ms
  created_at   INTEGER NOT NULL,                   -- Unix ms
  updated_at   INTEGER NOT NULL,                   -- Unix ms
  source       TEXT    DEFAULT NULL,               -- 'whatsapp' | 'vision' | 'api'
  items        TEXT    NOT NULL DEFAULT '[]',       -- JSON array (see above)
  audio_id     TEXT    DEFAULT NULL,                -- WhatsApp media ID of supplier voice note
  notes        TEXT    DEFAULT NULL                 -- Customer name, measurements, tailor info (e.g. "Amal / AUH / 23+27+40 / Sheila 25-81")
);

CREATE INDEX IF NOT EXISTS idx_dispatch_inv_status_sla
  ON dispatch_invoices(status, sla_deadline);
