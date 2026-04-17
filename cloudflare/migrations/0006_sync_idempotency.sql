-- Batch sync idempotency (POST /api/sync/v1/batch with X-Idempotency-Key)
-- From repo root:  yarn cf:d1:0006
CREATE TABLE IF NOT EXISTS sync_idempotency (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
