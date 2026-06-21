-- AbaYa Track — Migration 0008: Tunnel health probe log
-- Run: cd cloudflare && npx wrangler d1 execute abaya-db --file=migrations/0008_tunnel_probes.sql [--remote]
--
-- Records every Worker-side synthetic probe of FACTORY_TUNNEL_URL/health.
-- One row per probe (cron fires every minute), pruned lazily to 7 d of history
-- by the runTunnelProbe handler in cloudflare/src/handlers/dispatch.js.
--
-- Purpose: catch the silent-cloudflared-failure mode where the process is alive
-- but the tunnel itself is broken. The CEO dashboard reads the latest probe via
-- GET /dispatch/tunnel-health and renders a banner when status flips to 'fail'.

CREATE TABLE IF NOT EXISTS tunnel_probes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,                       -- Unix ms of probe attempt
  status     TEXT    NOT NULL,                       -- 'ok' | 'fail'
  http_code  INTEGER,                                -- HTTP status returned, NULL on network error
  latency_ms INTEGER,                                -- end-to-end ms, NULL on timeout
  error      TEXT                                    -- short error label when status='fail'
);

CREATE INDEX IF NOT EXISTS idx_tunnel_probes_ts
  ON tunnel_probes(ts DESC);
