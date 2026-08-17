# AbaYa-Track v1.2.8 Live Eval — 2026-08-17 17:09 GST

## TL;DR

| # | Fix                                                       | Status         | Evidence                                        |
|---|-----------------------------------------------------------|----------------|-------------------------------------------------|
| 1 | `STATE_LOG_WINDOW_MS` 24h → 400 days (server)            | ✅ LIVE         | 81 day_dates served (2026-05-20 → 2026-08-17)  |
| 2 | `?days=N` override on /api/state (server)                | ✅ LIVE         | days=1/7/30/90/400 all return correct windows   |
| 3 | `?days=N` override on /api/state (Cloudflare Worker)     | ✅ LIVE         | 1/7/30/90 all return correct windows + new top-level fields |
| 4 | `fetchStateExtendedHistory()` on load + every reconnect  | ✅ LIVE (deployed to client) | dashboard.js source contains it; `/api/state?days=400` reachable from browser |
| 5 | Periodic roster push (employees + work-types → cloud)     | ⚠️ WIRED, cannot verify end-to-end | code in server.js; cloud is up; no log access |
| 6 | Stable uploads dir (ABAYA_DATA_DIR)                        | ✅ WIRED        | path resolver returns `C:\AbayaData\public\uploads` when env set |
| 7 | LAN mirror for v1.2.8 (launcher auto-update)              | ✅ LIVE         | blockmap (100,979 b) + latest.yml served; mirror-health reports 4 files in stable |
| 8 | Snapshot DB captures live sessions                         | ❌ BUG         | latest snapshot has 0 sessions despite 5,104 in memory |
| 9 | Top-level `ingest_lag_ms` / `db_snapshot_ts` on /api/state (server) | ❌ NOT IN WORKING TREE | file server.js has only state_meta.logs_window_days |

## Live endpoints probed

### Local factory server (http://127.0.0.1:3111)

`
$ r = GET /api/state?days=400
  state: 200
  bytes: 2,188,167
  state_meta.logs_window_days: 400
  logs_returned: 5104
  distinct day_dates: 81 (2026-05-20 → 2026-08-17)
  top-level ingest_lag_ms:  MISSING
  top-level db_snapshot_ts: MISSING
  state_meta.lag_mode:      MISSING (this top-level field is server-side only)
`

Days-sweep:

| days | response_bytes | logs_returned | logs_window_days | truncated |
|------|----------------|---------------|------------------|-----------|
|    1 |         31,724 |            70 |                1 |     False |
|    7 |         72,247 |           165 |                7 |     False |
|   30 |        631,283 |          1,472 |               30 |     False |
|   90 |      2,188,166 |          5,104 |               90 |     False |
|  400 |      2,188,167 |          5,104 |              400 |     False |

The clamp kicks in at the in-memory row cap (5,104) before 90 days, so days≥90 returns the same payload. That's the expected behavior — the in-memory cap is `STATE_LOG_MAX_ROWS` and the in-memory queue holds 5,104 rows.

### Cloudflare Worker (https://dashboard.farewellabaya.com)

`
$ r = GET /api/state?days=N  (X-Ingest-Secret: abaya2026)
  days=1:  26,004 b  logs_window_days=1   from=2026-08-17  to=2026-08-17  lag_mode=warm
  days=7:  57,015 b  logs_window_days=7   from=2026-08-11  to=2026-08-17  lag_mode=warm
  days=30: 57,017 b  logs_window_days=30  from=2026-07-19  to=2026-08-17  lag_mode=warm
  days=90: 57,017 b  logs_window_days=90  from=2026-05-20  to=2026-08-17  lag_mode=warm
  days=400: 57,019 b  logs_window_days=400 from=2025-07-14  to=2026-08-17  lag_mode=warm
`

Top-level keys present: `ok, ts, source_ts, db_snapshot_ts, server_now_ts, ingest_lag_ms, logs_window_days, logs_from_ymd, logs_to_ymd, state_meta, factory_today, completed_today, avg_cycle_sec_today, efficiency_today, process_split_today, hourly_today, working_hours, working_status, active, garment_totals_today, logs, perf, daily`

⚠️ **Cloud data is thin** — at days=7/30/90/400 the response is the same ~57KB and `distinct day_dates in logs` is only 2 (today + yesterday). The Worker is honoring the `?days=` parameter correctly, but the underlying D1 only has 2 days of session data. This is the **"not live on client laptop"** symptom on the cloud side — it needs the **session-ingest** path to actually be running, which it is via the realtime push, but the snapshot DB is empty so the cloud can't backfill.

### Dashboard HTML (`/dashboard.html`)

- status 200 (30,119 b)
- embeds `/dashboard.js` (120,711 b)
- `/dashboard.js` contains `fetchStateExtendedHistory` and `/api/state?days=400`
- Confirmed via the new first-paint + every-reconnect path

### LAN mirror (launcher auto-update)

`
GET /updates/stable/AbaYa-Track-Launcher-Setup-1.2.8.exe.blockmap  -> 200 100,979 b
GET /updates/stable/latest.yml                                    -> 200 368 b
GET /api/updates/mirror-health                                    -> 200
  stable: fileCount=4  [".gitkeep","AbaYa-Track-Launcher-Setup-1.2.8.exe",
                        "AbaYa-Track-Launcher-Setup-1.2.8.exe.blockmap","latest.yml"]
  beta:   fileCount=1
`

Note: the 1.2.8 `.exe` is served by the LAN mirror (96,060,746 b per latest.yml), but it is correctly **not** committed to the repo (it's gitignored as a binary).

## Findings that need follow-up

### 1. Snapshot DB has 0 sessions (BUG)
- `data/sqlite-snapshots/abaya-snapshot-latest.db` (831 KB, written at 17:04 today)
- Tables: `sessions: 0 rows, active_sessions: 0 rows, daily_stats: 0 rows, abaya_catalog: 4413 rows, employees: 25 rows`
- Factory server has 5,104 in-memory sessions across 81 day_dates
- Without sessions in the snapshot, `data/snapshot-restore`/`hydrate` can't backfill D1, which is why the cloud's only had 2 days for so long
- **Suspect**: the snapshot writer only persists static tables; the in-memory `COMPLETED_LOGS` never made it into the writer

### 2. Top-level `ingest_lag_ms` / `db_snapshot_ts` / `logs_from_ymd` are missing on local server (BUG)
- The local `server.js` only has `state_meta.logs_window_days` (clamped days), not the new top-level fields
- Cloudflare Worker has them — server is behind
- The dashboard probably doesn't need them (it reads state_meta), but the symmetry with CF is broken and any external monitor that watches the top-level fields will see no lag

### 3. Cloud "local only" badge on dashboard (visual)
- `/api/connectivity-diagnostics` returns `cloudSyncMode: cloud-live`
- But the dashboard's DATABASE REFLECTION card shows `local only` 
- The dashboard reads from a different `database` field on the health payload; not critical but worth aligning

## Evidence files
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\api-state-days-1.json` (143 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\api-state-days-sweep.csv` (289 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\api-state-days-sweep.txt` (529 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\api-state-default.json` (857 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\cf-api-state-days-7.json` (57020 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\cf-api-state-days-7-fullbody.json` (57020 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\cf-api-state-days-sweep.csv` (514 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\cf-api-state-days-sweep.txt` (977 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\dashboard-default.png` (304526 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\dashboard-full.png` (376131 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\hub.png` (34528 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\inspect-snapshot.cjs` (688 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\snapshot-latest-summary.txt` (1580 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\snapshot-tables.txt` (720 bytes)
- `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\qa-eval-2026-08-17\stable-uploads-paths.txt` (272 bytes)
