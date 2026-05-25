-- AbayaTrack Dispatch Server — schema.sql
-- Commit 2: D1 Table Schema for dispatch_invoices

CREATE TABLE IF NOT EXISTS dispatch_invoices (
  id TEXT PRIMARY KEY,
  supplier TEXT NOT NULL,
  material_spec TEXT NOT NULL,
  quantity TEXT NOT NULL,
  target_queue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, ARRIVED, PROCESSING, DELIVERED
  sla_deadline INTEGER NOT NULL,            -- Unix ms timestamp
  created_at INTEGER NOT NULL,              -- Unix ms timestamp
  updated_at INTEGER NOT NULL,              -- Unix ms timestamp
  source TEXT DEFAULT NULL                  -- 'whatsapp' | 'vision' | 'api'
);

-- Index on status and SLA to speed up active leaderboard queries
CREATE INDEX IF NOT EXISTS idx_dispatch_invoices_status_sla 
ON dispatch_invoices(status, sla_deadline);
