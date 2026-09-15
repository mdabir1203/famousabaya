-- AbaYa Track — Migration 0021: Factory <-> Cloud sync watermark (v1.2.40)
-- Run: cd cloudflare && npx wrangler d1 execute abaya-db --file=migrations/0021_factory_sync_watermark.sql [--remote]
--
-- Adds a single-row watermark that records the highest monotonic `local_seq`
-- value the cloud has received from the factory server. The factory server
-- stamps every outbound POST /api/event with a strictly increasing
-- `local_seq`, so this row carries a "where the cloud is currently sitting
-- in the factory's event stream" mark. /api/state reports it so the CEO
-- dashboard can show drift; the /api/realtime/sse lane uses it to
-- filter late-arriving events. Persisted to D1 — survives Worker restarts.
--
-- Schema:
--   seq_type:        a small discriminator so future watermarks (e.g. catalog,
--                    roster) can coexist in this table.
--   seq_value:       the highest local_seq ever seen for that stream.
--   last_event_type: which ingest event was the latest (debug-only).
--   last_emp_id:     which employee triggered the latest event (debug-only).
--   updated_at:      Unix seconds; used for "stale" detection in /api/state.
--
-- Single-row PK by (seq_type) keeps the UPSERT cheap (one row, one index
-- entry) and avoids fanout writes. seq_value is monotonically increasing
-- from the factory's perspective; on replay (queue drain) the same value
-- may arrive again so the UPSERT uses MAX(seq_value, excluded.seq_value).
--
-- Local snapshot mirrors: see shared/sqlite-snapshot.cjs → SCHEMA_DDL → factory_sync.

CREATE TABLE IF NOT EXISTS factory_sync (
  seq_type        TEXT    PRIMARY KEY,
  seq_value       INTEGER NOT NULL DEFAULT 0,
  last_event_type TEXT,
  last_emp_id     TEXT,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
