# AbaYa-Track — Codebase Flow Map

> A line-by-line walk of AbaYa-Track, the production tracking system that
> runs Famous Abaya's Dubai shop floor. Every request is traced from the
> wire through the factory server, the Cloudflare Worker, D1, R2, the
> dispatch leaderboard, the desktop launcher, and back. Read it once, you
> have the whole model.

---

## 0. TL;DR

AbaYa-Track is a three-tier real-time system. It turns a factory floor into
one observable operation:

1. **Factory tier** — `server.js`, 4 338 LOC. A long-lived Express + Socket.IO
   process that holds the in-memory master state: employees, abaya catalog,
   active sessions, completed logs, per-employee performance. Pushes every
   Start / Finish to the cloud, hydrates from the cloud on a fresh install,
   and serves a LAN dashboard, a kiosk, and an asset-upload PWA.
2. **Cloud tier** — `cloudflare/src/index.js`. A Cloudflare Worker that
   persists factory events in D1 (`sessions`, `active_sessions`, `daily_stats`,
   `abaya_time_map`, `employees`, `abaya_catalog`, `catalog_meta`,
   `worker_settings`, `dispatch_invoices`, `tunnel_probes`). Renders the CEO
   dashboard server-side, handles CEO cookie/JWT auth, proxies the operator
   leaderboard for the Check Delivery Report, stores employee + item photos
   in R2, and serves the Electron desktop launcher OTA feed.
3. **Dispatch / leaderboard tier** — `services/dispatch-server/server.js`. A
   separate Node.js process that turns WhatsApp messages and operator scans
   into a delivery leaderboard. Bridges to the Worker over `X-Bridge-Secret`
   for status sync; exposes a public HTTPS tunnel for tablets on mobile SIM.

The desktop launcher (`tools/desktop-launcher/start-electron.cjs`) is a thin
Electron shell that boots the factory server, runs an env wizard on first
launch, and auto-updates from R2 via `electron-updater`. A Cloudflare
Tunnel (`cloudflared`) fronts the factory server so a CEO can reach the
Worker without a static IP; the Worker probes the tunnel every minute.

The system is **offline-first by design**. A factory that loses its WAN
mid-shift keeps recording. Every event is buffered to a durable NDJSON queue
and a local snapshot; the queue drains automatically when the Worker is
reachable again.

---

## 1. Physical architecture (where the bytes live)

```
┌──────────────────────┐    LAN / Wi-Fi     ┌──────────────────────────────┐
│  Tablet Kiosk        │ ◄────────────────► │  Factory laptop (server.js)  │
│  public/kiosk.html   │   Socket.IO + HTTP │  in-memory master + D1-snap  │
│  public/kiosk.js     │                    │                              │
└──────────────────────┘                    │  public/dashboard.html       │
                                           │  public/dashboard.js         │
┌──────────────────────┐    LAN / Wi-Fi     │  public/asset-upload.html    │
│  Asset-upload PWA    │ ◄────────────────► │  /api/upload/* (multer)     │
│  (operator laptop)   │                    │                              │
└──────────────────────┘                    │  /updates/stable  /updates/  │
                                           │      beta  ─────► R2 mirror  │
┌──────────────────────┐    Tunnel (cloudflared)               │       │
│  CEO anywhere        │ ◄─────────────────────► Cloudflare Worker       │
│  Browser              │     HTTPS / cookie    (cloudflare/src/index.js)│
└──────────────────────┘                       │                            │
                                               │  D1 binding:  DB          │
┌──────────────────────┐    LAN/Wi-Fi/Tunnel │  R2 binding:  UPDATES      │
│  Operator tablet     │ ◄────────────────► │                              │
│  dispatch leaderboard│  Bridge secret      │  /dispatch/*  ◄──► Worker  │
│  services/dispatch-  │                     │  /api/internal/sync-trigger │
│  server/server.js    │ ──► Worker ──► D1   │                              │
└──────────────────────┘  WhatsApp webhook   │  CF Workers Builds (CD)     │
                          via Meta graph API │  wrangler.jsonc (account_id)│
                                               │                            │
┌──────────────────────┐    HTTPS            │                            │
│  Desktop launcher    │ ◄────────────────► │  /updates/<ch>/<file> → R2 │
│  (factory laptops)   │   electron-updater │                            │
└──────────────────────┘                     └──────────────────────────────┘
```

Identity anchors:
- `account_id`  `cac65f11aecab7f7dc4446390d49f4f2`  (`wrangler.jsonc`).
- Custom domain  `dashboard.farewellabaya.com`  (Worker).
- D1 database  `5d61fb15-2ead-491b-80e2-fe2b2fd46d23`  (Worker).
- R2 bucket  `abaya-updates`  (Worker).
- `FACTORY_TZ`  `Asia/Dubai`  (both tiers; the only timezone that ever matters).

---

## 2. Boot sequence — `server.js`

One process. Boot is a deterministic cascade; every failure path is
non-fatal and falls back to an honest degraded mode.

### 2.1 Top-of-file (lines 1–80)

`server.js` reads `.env` (or `ABAYA_ENV_FILE` if the launcher relocated it),
resolves a single writable `DATA_DIR` (honors `ABAYA_DATA_DIR`, default
`./data`), and computes a stable uploads root
(`STABLE_UPLOADS_PUBLIC = <data>/public/uploads`) so a future `.exe` reinstall
never wipes employee or item photos. Default port 3000, default bind
`0.0.0.0`. A `127.0.0.1` bind logs a loud warning because tablets on the same
Wi-Fi won't reach it.

```js
require('dotenv').config({ path: process.env.ABAYA_ENV_FILE || ./.env });
const DATA_DIR   = process.env.ABAYA_DATA_DIR || path.join(__dirname, 'data');
const STABLE_UPLOADS_PUBLIC = <data>/public/uploads;  // null when dev
const PORT = 3000; const HOST = '0.0.0.0';
const SERVER_BOOT_ID = crypto.randomUUID();
const APP_PACKAGE_VERSION = readAppPackageVersion();
```

### 2.2 Middleware stack (lines 96–183)

The middleware order is load-bearing; static assets must short-circuit before
the trailing-slash redirector or express.json body parser.

| Order | Mount                          | Purpose                                         |
|-------|--------------------------------|-------------------------------------------------|
| 1     | `cors()`                       | Open CORS — kiosk is same-origin anyway, dev tools need it. |
| 2     | `express.static('public')`     | HTML `no-cache`, hashed JS/CSS `max-age=600, swr=86400`. |
| 3     | `express.static(STABLE_UPLOADS_PUBLIC)` at `/uploads` | Photo cache headers; only mounted when `ABAYA_DATA_DIR` is set. |
| 4     | `express.json()`               | 100 KB default body limit.                      |
| 5     | `normalizeTrailingSlash`       | 308 redirect `/api/state/` → `/api/state` for legacy tablets. |
| 6     | `/updates/stable` static       | LAN mirror for Electron auto-update; `no-store`, `.yml` → `text/yaml`. |
| 7     | `/updates/beta` static         | Same, for the beta channel.                     |
| 8     | `app.get('/api/updates/mirror-health')` | Operator-visible inventory of the LAN mirror (line 185). |

After the HTTP layer, `server.js` creates the raw `http.createServer(app)`,
tunes TCP keep-alive to 120 s (so Android Chrome doesn't get
`ERR_CONNECTION_ABORTED` on idle sockets), and instantiates Socket.IO with
`transports: ['websocket', 'polling']` plus relaxed ping settings
(`pingInterval=25s`, `pingTimeout=60s`) for factory Wi-Fi jitter.

### 2.3 Cloudflare push layer (lines 449–687)

`CF_URL` and `CF_SECRET` are loaded from env. When `REQUIRE_CLOUD_SYNC=true`
they are mandatory; otherwise the server runs offline-only.

The push subsystem has three pieces:

1. **NDJSON queue** — `CEO_QUEUE_FILE = <DATA_DIR>/ceo-ingest-queue.jsonl`.
   `appendCeoIngestFailed(type, payload, meta)` (line 596) appends a
   `{v:1,id:uuid,type,payload,queuedAt,reason,reasonStatus}` record and bumps
   `ceoIngestPendingCount`. `appendCeoIngestRejected` writes to a parallel
   `ceo-ingest-rejected.jsonl` for 4xx errors that won't recover.
2. **Push primitive** — `pushToCloudflare(type, payload)` (line 650) POSTs
   `{type, payload}` to `${CF_URL}/api/event` with an 8 s `AbortSignal`. On
   `2xx` it counts `pushOk` and triggers a drain. On `401|403` it queues the
   record, marks the auth error, and emits `auth-error` on the
   `ingestEvents` EventEmitter (used by the alert manager). On
   `4xx ∉ {401,403,408,429}` it writes to the rejected queue (no retry). On
   `408, 429, 5xx` or any thrown network error it queues the record for
   retry and emits nothing.
3. **Drain loop** — `drainCeoIngestQueue()` (line 818). Atomically renames
   the queue to `ceo-ingest-queue.jsonl.draining`, replays oldest-first via
   `tryPostCeoIngestOnce`. Auth errors preserve the entire queue. Client
   errors are recorded as rejected. Network errors roll the batch back into
   the live queue. The drain is also auto-invoked from `pushToCloudflare`'s
   success branch so a single successful push flushes the backlog.

Boot-time recovery: `recoverCeoIngestQueue()` (line 581) merges any stale
`.draining` file back into the live queue in case the process died mid-flush.

### 2.4 Shift-window local mirror (lines 689–812)

The factory server caches the Worker's `worker_settings.working_hours_v1` and
ships it on every `state_update` so the dashboard and kiosk never see a
different "in-shift" definition than the server uses to stamp `duration_sec`
on Finish. `refreshWorkingHoursFromCloud()` polls the Worker every 5 min.
`overlapSecWithWindows(startSec, endSec, config)` walks minute-by-minute
through configured windows (`{sat:[…], sun:[…]}`) using the
`Asia/Dubai` timezone; this is the canonical "in-shift seconds" everywhere
on the factory side.

### 2.5 Master in-memory state (lines 920–1117)

| Symbol           | Initialized from                                                | Updated by |
|------------------|-----------------------------------------------------------------|------------|
| `EMPLOYEES`      | `DEFAULT_EMPLOYEES` 25 hardcoded, or `employees.xlsx`, or `data/employees-manual.json` | API, photo upload, xlsx reload |
| `abayaCatalog`   | `DEFAULT_ABAYA_CATALOG` 11, or `items_export.xlsx`, or `data/catalog-manual.json` | API, xlsx upload, photo upload |
| `FACTORY_WORK_TYPES` | `data/work-types.json` (default = 12)                      | `PUT /api/work-types` |
| `AC_MAP`         | `rebuildACMap()` from `EMPLOYEES` keyed by `ac_no`             | roster reload |
| `ACTIVE_SESSIONS`| `{}` — `{emp_id → {emp_id, abaya_id, log_id, started_at, process}}` | start/finish handlers |
| `COMPLETED_LOGS` | `[]` (or restored from offline snapshot)                        | finish handler |
| `EMP_PERF`       | `[]` (one `{id,units,eff,act,idl}` per employee)               | finish handler, recompute |

Catalog + employees are kept consistent across the factory LAN by:

- **Excel master** (priority 1): `EXCEL_DATA_DIR` / `CATALOG_XLSX_PATH` /
  `EMPLOYEES_XLSX_PATH`. Loaded at boot, polled every `CATALOG_XLSX_INTERVAL_MS`
  / `EMPLOYEES_XLSX_INTERVAL_MS` (default 24h), and watched with `chokidar`
  (1.5 s debounce) so a supervisor's edit is picked up live.
- **Manual JSON** (priority 2): `data/employees-manual.json` /
  `data/catalog-manual.json` when no Excel is configured. Saves survive a
  restart.
- **Cloud pull** (priority 3): every 60 s the server calls
  `/api/employees` and `/api/work-types` on the Worker and applies the
  change only when the cloud `version` advances.

Catalog xlsx writes are atomic — `atomicWriteBufferReplaceFile` writes
`.<file>.tmp.<pid>.<ts>`, unlinks the old file, renames. Backups go to
`<dir>/catalog-backups/items_export_<ISOstamp>.xlsx` (default keep 30).

### 2.6 Cold-start restore (lines 1507–1661)

A factory laptop that reboots mid-shift restores:

1. **Offline report snapshot** — `restoreOfflineDashboardFromDisk()` calls
   `offlineReportStore.loadRestorableSnapshot({maxAgeMs, logWindowMs})`. The
   latest `data/offline-dashboard-reports/dashboard-offline-latest.json`
   holds `{active, logs, perf}`. `reviveActiveSessionsFromSnapshot()` (line
   1513) drops sessions for unknown employees and any older than
   `RESTORE_ACTIVE_SESSION_MAX_AGE_MS` (default 48 h).
2. **First-boot D1 hydration** — `startCloudD1Hydration()` (line 1632) calls
   `hydrateCompletedLogsFromCloud(90)` which fetches
   `GET /api/state/history?days=90`, normalizes each row into the local log
   shape, drops them into `COMPLETED_LOGS`, and writes a fresh snapshot so
   the next boot is a no-op cache hit. Skipped if `COMPLETED_LOGS` is
   non-empty or the cloud isn't configured.

### 2.7 WebSocket layer (lines 2296–2522)

`io.on('connection', socket => …)` immediately sends two envelopes:

```js
socket.emit('state_update', getRealtimeStateBundle());   // full snapshot
socket.emit('sync_versions', getClientSyncPayload());   // version diffs
```

The six socket RPCs are:

| Event             | Direction    | Effect on server                                          | Effect on cloud |
|-------------------|--------------|-----------------------------------------------------------|-----------------|
| `req_lookup`      | kiosk → svr  | `AC_MAP[ac_no]` + active session + abaya code             | — |
| `req_startWork`   | kiosk → svr  | `ACTIVE_SESSIONS[emp_id] = {…}`, live-row decorate, broadcast | `pushToCloudflare('session_start', …)` |
| `req_finishWork`  | kiosk → svr  | `COMPLETED_LOGS.push(record)`, delete from `ACTIVE_SESSIONS`, update `EMP_PERF`, `persistOfflineDashboardReport`, `persistSqliteSnapshot`, broadcast | `pushToCloudflare('session_finish', …)` (with `invoice_count/invoice_serial` for Invoice maker, `quantity/checker_barcode` for Checker) |
| `disconnect`      | kiosk → svr  | log only — active sessions stay alive on purpose            | — |

The `state_update` envelope is the realtime master feed. It is built by
`getRealtimeStateBundle(req)` (line 1746) and contains:

```jsonc
{
  "active":  {emp_id: {..., windowed_elapsed_sec, outside_shift, is_cross_day, is_stale, age_sec, effective_started_at}},
  "logs":    [/* up to STATE_LOG_MAX_ROWS=20 000, since window defaults to 400 days */],
  "perf":    [{id, units, eff, act, idl}],
  "workTypes":[...], "workTypesVersion": 0,
  "working_hours": {profile, timezone, days:{...}},
  "state_meta":    {source, syncMode, pendingQueue, restored_from_offline_cache, d1_hydration:{...}}
}
```

Two outbound server events that fire on roster/catalog edits:

| Event              | Trigger                                              | Payload              |
|--------------------|------------------------------------------------------|----------------------|
| `employees_update` | photo upload, xlsx reload, manual edit, cloud pull  | `{count, version}`   |
| `catalog_update`   | photo upload, xlsx import, cloud pull                | `{version}`          |
| `work_types_update`| local edit or cloud pull                             | `{workTypes, version}`|
| `sync_versions`    | after every roster or work-type change               | full payload         |

### 2.8 HTTP route map (lines 2532–4220)

The HTTP layer is the kiosk / dashboard's fallback path, and the upload +
admin surface. Sorted by route family:

```
GET  /api/health                                   → {ok, service, ts, uptime}
GET  /api/server-info                              → version, bootId, lanIp, mode
GET  /api/release-moment                           → {enabled, momentId, hook, cta…}
GET  /api/client-config                            → {catalogVersion, employeesVersion, workTypes, workTypesVersion, ceoSyncMode, persistence, working_hours, ...}
GET  /api/ceo-ingest-status                        → queue depth, ingestStats, alerts, snapshot health, cloud-today health
POST /api/cloud-today/refresh                      → force refreshCloudToday({force:true})
POST /api/alerts/test                              → smoke-test Resend wiring
POST /api/reconcile-now                            → force-trigger the reconcile loop
GET  /api/ceo-ingest-export                        → NDJSON download for USB mail-in
GET  /api/catalog/abayas                           → open GET
PUT  /api/catalog/abayas                           → X-Ingest-Secret; persists xlsx + manual JSON; mirrors to cloud
POST /api/import/catalog-xlsx                      → multer xlsx upload, 20 MB cap, X-Ingest-Secret OR CATALOG_UPLOAD_PASS
GET  /api/catalog/export.xlsx                      → items_export-format workbook
GET  /api/employees                                → open GET
POST /api/employees                                → add (validates duplicates)
PUT  /api/employees/:id                            → update
DELETE /api/employees/:id                          → delete
GET  /api/work-types                               → open GET
PUT  /api/work-types                               → validates active sessions aren't orphaned
GET  /api/state                                    → full realtime bundle (HTTP fallback)
GET  /api/kiosk/state                              → identical to /api/state (kiosk REST path)
POST /api/kiosk/lookup                             → fingerprint-lookup
POST /api/kiosk/start-work                         → legacy REST start (alternate to socket)
POST /api/kiosk/finish-work                        → legacy REST finish
POST /api/upload/employee-image                    → multer image 8 MB, ASSET_UPLOAD_SECRET optional
POST /api/upload/catalog-item-image                → multer image 8 MB
GET  /api/qr                                       → server-rendered SVG QR (for setup.html)
GET  /api/connectivity-diagnostics                 → LAN probe
POST /api/tablet-ping                              → for kiosk liveness
GET  /api/export/floor-sessions.json               → X-Export-Secret; full history
GET  /api/export/floor-sessions.csv                → ditto, CSV
POST /api/import/floor-sessions.json               → dedupe-by-key, append to COMPLETED_LOGS
GET  /api/debug-kiosk                              → factory-only diagnostics
GET  /                                              → redirects to /kiosk.html (handled by static)
```

Error contracts: every `err(...)` becomes JSON. The only HTML path is the
default Express error page, which we neutralize with the 4222-line
`err` middleware that converts `LIMIT_FILE_SIZE` and the multer image/xlsx
guards to `400 {ok:false, error:msg}`.

### 2.9 Background loops (line 4414 `server.listen` callback)

The `listen` callback is the real boot orchestrator. It runs, in order:

1. `ensurePublicUploadDirs()`, `ensureCeoQueueDir()`,
   `recoverCeoIngestQueue()`, `syncCeoPendingCountFromDisk()`,
   `void drainCeoIngestQueue()`.
2. If `CF_URL && CF_SECRET`, schedule `drainCeoIngestQueue` every
   `CEO_INGEST_RETRY_MS` (default 30 s).
3. `attachEmployeeImagesFromDisk()` / `attachItemImagesFromDisk()` —
   backfill `uploads/employees/emp_<barcode>.<ext>` references for any
   employee / item row that has no `photo` / `icon`.
4. `void syncAssetsFromRemote()` — pull employee + item photos from the
   LAN share (`ABAYA_LAN_ASSETS_DIR`) and the cloud R2 bucket so a freshly
   unboxed laptop sees the full gallery.
5. `loadEmployeesFromManualFile()` and `loadCatalogFromManualFile()` —
   restore the in-memory rosters from disk.
6. `void seedRosterFromCloudIfLocalMissing()` — only when no local source
   exists, fetch `/api/employees` and `/api/work-types` from the cloud and
   persist locally. Logs a clear warning when running on built-in demo data.
7. `void startCloudD1Hydration()` — see §2.6.
8. `getLanIPs()` — `os.networkInterfaces()` sorted by `lanIpPriority()`
   that prefers 192.168.x.x, then 10.x, then 172.16-31, with a CGNAT
   penalty (100.64/10) so the QR code doesn't print a Tailscale address.
9. `refreshAbayaCatalogFromCloud()` + `setInterval(…, 60_000)`,
   `refreshEmployeesFromCloud()` + `refreshWorkTypesFromCloud()` (60 s).
10. Roster push interval (300 s) — periodic `PUT /api/employees` and
    `PUT /api/work-types` to the cloud so the dashboard sees the full
    directory even on a fresh install.
11. `setInterval(persistOfflineDashboardReport, 60_000)` + `setImmediate(…)`
    so the snapshot is on disk before the first client hits `/api/state`.
12. `setInterval(persistSqliteSnapshot, SQLITE_SNAPSHOT_INTERVAL_MS)` (5 min
    default). `persistSqliteSnapshot()` is a coalesced writer that builds a
    real `.db` mirroring the D1 schema via `shared/sqlite-snapshot.cjs`.
13. `refreshWorkingHoursFromCloud()` + `setInterval(…, 5 * 60_000)`.
14. Cloud-today mirror — `setTimeout(refreshCloudToday, 8_000)` then
    `setInterval(refreshCloudToday, 30_000)`. See §5.2.
15. `ensureAlertManager()` — `shared/alerting/resend-alerts.cjs` wires
    `ingestEvents` (`auth-error`, `permanent-error`, `queue-backlog`) and a
    5-min health poll to a Resend-based email alert manager with dedup +
    hourly cap.
16. `reconcileCloudflare.startReconcileLoop(...)` — every 5 min, walk
    `COMPLETED_LOGS` and `ACTIVE_SESSIONS` and re-push any
    `WL-<emp>-<ended>` id that's missing on the cloud.
17. `setTimeout(loadCatalogFromXlsxFile, 3_000)` + `setInterval(…,
    CATALOG_XLSX_INTERVAL_MS)`. Same for employees.
18. `startExcelFileWatchers()` — chokidar with `awaitWriteFinish: 800ms
    stability` to ignore half-written saves from Excel.

`process.on('SIGTERM')` and `SIGINT` flush the offline report and sqlite
snapshot, stop the reconcile loop, stop the alert manager, and exit — the
PM2 manifest restarts the process.

---

## 3. The realtime Start / Finish path

The most-traveled path in the system. The kiosk calls two socket RPCs; the
server updates three in-memory structures, broadcasts to N clients, persists
three things to disk, and pushes one event to the cloud. Below is the exact
cascade with the function names you would grep for.

### 3.1 Start Work

```
kiosk.js:979   socket.emit('req_startWork', {emp_id, abaya_id, process:selRole}, cb)
        │
        ▼
server.js:2333 socket.on('req_startWork', …)
   1.  guard: ACTIVE_SESSIONS[emp_id] already set? → error 'Already has active session'
   2.  guard: nowSec in working window? → error 'Outside shift hours'
   3.  resolve emp + abaya, validate sessionProcess ∈ FACTORY_WORK_TYPES
   4.  log_id = 'WL-' + emp_id + '-' + Date.now()
   5.  ACTIVE_SESSIONS[emp_id] = {emp_id, abaya_id, log_id, started_at, process}
   6.  broadcastState()                                 // see §4
   7.  setImmediate(persistOfflineDashboardReport)     // see §4
   8.  callback({ok:true, log_id})
   9.  (non-blocking) liveRowState.computeLiveRowState(started_at, now, cfg)
            → {effectiveStartSec, windowed_elapsed_sec, outside_shift, is_cross_day}
       pushToCloudflare('session_start', {
         emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
         abaya_id, abaya_code, station:'S-02',
         started_at, effective_started_at, windowed_elapsed_sec,
         outside_shift, is_cross_day
       })
```

The `effective_started_at` and `windowed_elapsed_sec` are pre-baked by the
local server so the cloud's read path can re-walk from that anchor in
real time without re-deriving the cross-day cap. This is the only reason
the local-side cap anchor can survive a slow or stale cloud schedule.

### 3.2 Finish Work

```
kiosk.js:1346  socket.emit('req_finishWork', payload, cb)
        │
        ▼
server.js:2388 socket.on('req_finishWork', …)
   1.  parse payload (string-or-object, ext legacy)
   2.  guard: ACTIVE_SESSIONS[emp_id] exists? → error
   3.  IF process === 'Invoice maker':
         parseInvoiceNumberList(invoice_serial)              → shared/invoice-parser.cjs
         validate invoice_count == nums.length
         normalize invoice_serial = nums.join(',')
   4.  IF process === 'Checker':
         parseInt quantity; require >0
         parseCheckerBarcodeList(checker_barcode)           → shared/checker-barcode-parser.cjs
   5.  duration_seconds = floor(overlapSecWithWindows(startSec, endSec, WH))
   6.  record = {emp_id, abaya_id, process, start, end, duration_sec, hour, invoice_count, invoice_serial, quantity, checker_barcode}
   7.  COMPLETED_LOGS.push(record)                          // append-only
   8.  setImmediate(persistOfflineDashboardReport)          // see §4
   9.  setImmediate(() => void persistSqliteSnapshot())     // coalesced, see §4
   10. EMP_PERF[emp_id].units += 1
       EMP_PERF[emp_id].act   += round(duration_seconds/60)
       EMP_PERF[emp_id].eff   = min(100, round(units*45 / act * 100))
   11. delete ACTIVE_SESSIONS[emp_id]                      // timer stops now
   12. broadcastState()                                    // see §4
   13. callback({ok, duration_seconds, abaya_code, abaya_barcode, session_process, invoice_count, invoice_serial, quantity, checker_barcode})
   14. (non-blocking) pushToCloudflare('session_finish', {emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials, abaya_id, abaya_code, station:'S-02', started_at, ended_at, duration_sec, + invoice fields if applicable})
```

The order matters. The local in-memory update is synchronous so the kiosk
sees the change in the very next `state_update`; the disk write is
asynchronous so a slow disk doesn't block the socket; the cloud push is
fire-and-forget so a worker offline is invisible to the operator. The
deterministic log id is built downstream by the Worker's ingest handler
(`'WL-' + emp_id + '-' + ended_at`) so a reconcile loop can re-push safely.

### 3.3 Ingest at the Worker

```
cloudflare/src/handlers/ingest.js:14  handleIngest(request, env)
   1.  rateLimitOr429(INGEST_RATE_LIMIT, …)            → wrangler rate-limit binding
   2.  X-Ingest-Secret === env.INGEST_SECRET?           → 401 otherwise
   3.  body = await request.json(); type ∈ {session_start, session_finish}? → 400
   4.  IF session_start:
         isInWorkingWindow(started_at, cfg)            → 422 if not in shift
         INSERT OR REPLACE INTO active_sessions
            (emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
             abaya_id, abaya_code, station, started_at,
             effective_started_at, windowed_elapsed_sec, outside_shift, is_cross_day)
         canonicalEmpProcess(emp_process)              → domain/process.js
         return {ok:true, event:'session_start'}
   5.  IF session_finish:
         canonicalEmpProcess; dailyStatsColumnForProcess
         IF process === 'Invoice maker':
            parseInvoiceNumberList + count-validate   → 400 on mismatch
         sessionId = 'WL-' + emp_id + '-' + ended_at
         dayDate   = factoryDateStringForUnix(ended_at)
         hourOfDay = factoryHourForUnix(ended_at)
         inWindow  = overlapSecWithWindows(start, end, cfg)
         BATCH:
           [0] INSERT OR IGNORE INTO sessions
                 (id, emp_id, emp_name, …, duration_sec, hour_of_day, day_date,
                  invoice_count, invoice_serial)
           [1] DELETE FROM active_sessions WHERE emp_id = ?
           [2] INSERT INTO daily_stats (stat_date, total_units, total_sec,
                                        <procCol>, updated_at) VALUES (?, 1, ?, 1, unixepoch())
                ON CONFLICT(stat_date) DO UPDATE SET
                  total_units = total_units + 1, total_sec = total_sec + ?,
                  <procCol> = <procCol> + 1, updated_at = unixepoch()
           [3..N] (if abaya_id) UPSERT abaya_time_map
                    (abaya_id, abaya_code, cumulative_in_window_sec += inWindow,
                     first_started_at MIN, last_ended_at MAX, updated_at)
         return {ok:true, event:'session_finish', session_id}
```

`INSERT OR IGNORE` on `sessions` makes the entire path **idempotent**. A
duplicate push from a retried drain, a re-pushed reconcile row, or a
stale network replay all collapse to a single row. The only piece that
isn't idempotent is the `daily_stats` upsert, and the local server is the
canonical source — the reconcile loop only re-pushes sessions whose cloud
id is missing, so a duplicate push won't double-count there either.

---

## 4. The realtime broadcast path

`broadcastState()` is one line: `io.emit('state_update', getRealtimeStateBundle())`.
The bundle is computed every call by walking the in-memory master and
decorating each active session with `decorateActiveSessionsForEmit(active, now)`
which calls `liveRowState.computeLiveRowState(startedSec, now, cfg)` for each
row and merges the result back in. This is the only function that ships
`windowed_elapsed_sec`, `outside_shift`, `is_cross_day`, `is_stale`,
`age_sec`, and `effective_started_at` to clients, and it's the only place
where the cap-aware clock and the legacy "in-shift now" flag are kept in
sync with the server's own decision at Finish.

`persistOfflineDashboardReport()` is a sibling of broadcast that snapshots
the same state to `data/offline-dashboard-reports/dashboard-offline-latest.json`
on every Start / Finish and every 60 s. The snapshot shape is intentionally
a superset of what the dashboard renders so a cold boot can paint
immediately without a server-side recompute.

`persistSqliteSnapshot()` builds a real SQLite database that mirrors the D1
schema (`shared/sqlite-snapshot.cjs`, `lib/local-store.js`). It runs
coalesced — concurrent calls set a `_sqliteSnapshotPending` flag and the
`.finally` chain re-fires once. The snapshot lives at
`<DATA_DIR>/sqlite-snapshots/abaya-track-snapshot.db` (default 5 min
cadence, retention configurable).

The full sequence of a single Finish:

```
finish handler
   ├── COMPLETED_LOGS.push(record)              (sync, in-memory)
   ├── broadcastState()                         (sync, to N Socket.IO clients)
   │      └── getRealtimeStateBundle() → decorate active → emit
   ├── setImmediate(persistOfflineDashboardReport)   (next tick)
   │      └── atomicWriteJson(<DATA_DIR>/offline-dashboard-reports/dashboard-offline-latest.json)
   ├── setImmediate(persistSqliteSnapshot)          (coalesced)
   │      └── shared/sqlite-snapshot.cjs.writeSnapshot(...)
   ├── delete ACTIVE_SESSIONS[emp_id]
   ├── callback({ok, …})                        (back to kiosk)
   └── pushToCloudflare('session_finish', …)    (next tick, with NDJSON queue fallback)
```

---

## 5. The cloud mirror — three independent safety nets

A factory loses its WAN, or the Worker's container restarts, or a single
event times out. The system survives all three. The mechanisms stack, in
order of latency to detection:

### 5.1 Push queue (per-event, sub-second)

`pushToCloudflare` (§2.3) writes any non-2xx, 408, 429, 5xx, or thrown
network error to `ceo-ingest-queue.jsonl` and emits a metric. The drain
loop renames the file, replays oldest-first, splits into success/permanent-
rejected/transient-failed, appends the failed batch back to the live queue,
and unlinks `.draining` on success. The 8 s `AbortSignal.timeout` on
`tryPostCeoIngestOnce` keeps one slow Worker from blocking a backlog.

### 5.2 Cloud-today mirror (every 30 s)

`refreshCloudToday({force:false})` (line 2020) — the LAN dashboard reads
state from the LAN server, but the **terminals** may be talking to the
Worker directly over a tunnel. So even when a tablet's `req_startWork`
hits a cloud-only kiosk, the operator's LAN dashboard still sees the
change. Every 30 s the server pulls
`${CF_URL}/api/state?days=1&limit=500` and merges:

- **Logs** by `id`; existing rows get mutable display fields refreshed,
  new rows are normalized into the local shape and appended.
- **Active sessions** by `emp_id`; cloud's `e_bc_<barcode>` ids are
  translated to the local `eN` ids via barcode lookup (the dispatch
  between hardcoded and xlsx rosters is reconciled here).
- After both, `recomputeEmpPerfFromLogs()` and `broadcastState()` so the
  operator sees the merged data within 30 s of a tablet-only Start.

The 10-s throttle per call site prevents an alert-storm from being
amplified by a misbehaving client. The `?force=true` flag is exposed as
`POST /api/cloud-today/refresh` and used by the dispatch bridge when a
status change should propagate immediately.

### 5.3 Periodic reconciliation (every 5 min)

`reconcileCloudflare.startReconcileLoop(...)` (line 4539) walks local
state and re-pushes any cloud id that is missing. Bounded to 50 rows
per cycle (`RECONCILE_MAX_REPUSH_PER_CYCLE`) so a single corrupted
night's data doesn't generate a thundering herd. Cloud uses
`INSERT OR IGNORE` so the re-push is harmless. Manual trigger:
`POST /api/reconcile-now` (X-Ingest-Secret).

### 5.4 D1 hydration (one-shot on first boot)

`startCloudD1Hydration()` (line 1632) — only when local snapshot is empty.
Fetches up to 90 days of completed sessions from the cloud and seeds
`COMPLETED_LOGS`. Skipped if the local snapshot is already populated or
the cloud isn't configured. Saves a fresh snapshot so the next boot is
a no-op cache hit.

### 5.5 Asset replication (v1.2.13+)

`scheduleAssetReplication(absLocalPath)` (line 268) runs on every
employee or item photo upload. It schedules a `setImmediate` that:

1. **LAN share** — copies the file to `ABAYA_LAN_ASSETS_DIR` under
   `items/<file>` or `employees/<file>`, deduped by sha256.
2. **Cloud R2** — PUTs the raw image to
   `${CF_URL}/api/assets/upload?key=items|employees/<file>` with header
   `X-Content-SHA256`. The Worker (`cloudflare/src/handlers/assets.js`)
   validates the secret, validates the key, validates the
   `image/*` content-type, validates ≤ 8 MB, computes the sha256 server-
   side, and stores in R2 with `cacheControl: max-age=31536000,
   immutable`.

Boot-time: `syncAssetsFromRemote()` pulls from the LAN share first, then
the cloud, and backfills any file the local server doesn't have.

---

## 6. CEO Dashboard — auth, render, read paths

The CEO dashboard is rendered **server-side** in the Worker
(`cloudflare/src/ui/ceo-pages.js`, 221 KB). On first paint the browser
gets a complete HTML page, then a thin client script wires up polling +
live events. Authentication is cookie-based JWT with a refresh pair.

### 6.1 Auth flow

`cloudflare/src/index.js:52` is the entry. Every request is matched in
order:

1. **CORS preflight** (line 57) — short-circuit.
2. **`/api/health`** (line 61) — open.
3. **`/updates/<channel>/<file>`** (line 71) — Electron auto-update feed.
   Channel ∈ {stable, beta}, file `^[A-Za-z0-9._-]+$`. Read from R2,
   `latest.yml` cached 60 s, binaries cached immutable.
4. **CEO session bootstrap** (lines 95–155):
   - `POST /api/ceo/session` with `{password}` → mints an access+refresh
     JWT pair via `auth/ceo-jwt.js`, sets HttpOnly `SameSite=Lax`
     `Secure` (when HTTPS) cookies `abaya_ceo_session` and
     `abaya_ceo_refresh`. The password is `env.CEO_TOKEN` (or the
     previous value during a rotation window).
   - `POST /api/ceo/session/refresh` with the refresh cookie → mints a
     fresh pair.
   - `POST /api/ceo/logout` → clears both cookies.
5. **Roster + catalog** (lines 158–193) — handled by `modules/catalog.js`
   and `modules/roster.js`. GET is open (a fresh factory install needs
   to read this to seed itself), PUT requires `X-Ingest-Secret` and is
   rate-limited.
6. **`/api/settings/working-hours` GET** (line 224) — accepts either
   CEO token or factory `X-Ingest-Secret`. The factory server polls
   this every 5 min.
7. **Dispatch** (line 238) — `/dispatch/*` is `X-Bridge-Secret` auth,
   not CEO. See §8.
8. **CEO routes** (line 242) — everything else under `/api/*` (except
   the explicit factory-callable endpoints like `/api/assets/*`,
   `/api/state/history`, `/api/event`) is CEO-gated. The check is:
   ```js
   const ceoOk   = token && isCeoAuthenticated(request, env, url);
   const ingestOk =
        request.method === 'GET' &&
        ingestSecret === env.INGEST_SECRET &&
        (path === '/api/state' || path === '/api/state/history');
   ```
   If neither is true: API routes get 401, page routes get the login
   HTML. Every CEO route is also rate-limited at
   `CEO_READ_RATE_LIMIT` (800 req / 60 s by namespace ID 18703).
9. **CEO token-in-query bootstrap** (line 415) — `?token=<CEO_TOKEN>`
   on `/`, `/dashboard.html`, or `/ceo` mints a session pair and 302s
   the browser back to the same URL without the token in the query.

### 6.2 Render path

`getCEODashboard(url.origin)` is the inlined HTML/JS bundle. The script
hits:

- `GET /api/state?days=400&limit=5000` — the full bundle (or 1-day
  default). The dashboard polls `/api/state` every 3 s in HTTP fallback
  mode (used when the page was loaded over the LAN rather than through
  the Worker).
- `GET /api/report?type=daily|weekly|monthly|yearly&from&to&date` —
  `handlers/report.js` runs a single `env.DB.batch([…])` of 8 prepared
  statements: a header aggregate, a per-employee aggregate, a per-process
  aggregate, the recent-invoice list, the per-abaya list, the per-abaya
  time map, the previous-period aggregate, and the previous-period
  per-employee aggregate. The `windowedActiveTimeSec(row, cfg)` helper
  re-walks the (min_started, max_ended) span against current shift
  windows to stamp the right "in-shift minutes" for the period.
- `GET /api/analytics` — KPI-only subset for the executive summary.
- `GET /api/check-delivery-report?from&to&factory` — proxies
  `${LEADERBOARD_URL}/api/check-report?from&to`, aggregates
  `totals / byLocation / groups`, merges `cancellations`.
- `GET /api/trace?abaya_id=` — full session history for one garment.
- `GET /api/cancellations` / `POST /api/cancellations` — list / record.

### 6.3 KPI contracts

The dashboard and the LAN dashboard JS agree on the *number* of every
KPI cell, but the source differs:

- **Local dashboard (LAN)** — `public/dashboard.js` `aggregateRealtime()`,
  called on every `state_update` (or HTTP fallback poll at 3 s). Uses
  the realtime bundle's `logs` (default 400-day window) + the server-
  computed `windowed_elapsed_sec` from `decorateActiveSessionsForEmit`.
- **Cloud dashboard (Worker)** — `handleState` runs a 10-statement
  `env.DB.batch`, returns the same shape. KPI calculation is in the
  handler, not a separate aggregator.

Both paths re-walk `(min_started, max_ended)` against the **current**
working-hours config to defend against a schedule change mid-build, and
both cap the walk at the raw `duration_sec` sum so a multi-day span can
never inflate beyond what was actually stamped.

---

## 7. Catalog & roster write path

The catalog and the roster are the only two collections where the
factory is canonical and the cloud is a downstream cache. Both flows
have the same shape:

1. Operator edits (dashboard, asset-upload, or xlsx reload).
2. Factory mutates `abayaCatalog` / `EMPLOYEES` in memory.
3. Factory persists to disk (xlsx or manual JSON, with backup).
4. Factory `PUT` to cloud (`/api/catalog/abayas`, `/api/employees`).
5. Cloud normalizes, validates, replaces in D1 within a single batch.
6. Cloud bumps `catalog_meta.v` / `employees_version`.
7. Every other factory poll pulls the new version within 60 s.

The xlsx is the source of truth when `EXCEL_DATA_DIR` is configured.
Catalog xlsx writes go through `persistCatalogRowsToXlsx` →
`backupExistingCatalogXlsx()` (timestamped backup, keep 30) →
`fs.writeFileSync` to a temp + `renameSync` for atomicity. The
`lastCatalogXlsxMtime` marker is bumped so the periodic reload skips
the file we just wrote.

The roster path runs the same way: `validateEmployeeRosterIntegrity`
rejects duplicates by `barcode` / `ac_no` / `emp_no`, then
`atomicWriteBufferReplaceFile` writes the buffer, then
`loadEmployeesFromXlsxFile` re-reads so `attachEmployeeImagesFromDisk`
and the mtime stay consistent.

Cloud-side: `handleCatalogAbayasPut` normalizes each row (trims,
dedupes by id and barcode, defaults `process = env.DEFAULT_CATALOG_PROCESS`),
rejects an empty list unless `allowEmpty:true`, runs the full replace
inside a D1 batch, and bumps `catalog_meta.v`. `handleEmployeesPut` does
the same on the `employees` table.

---

## 8. Dispatch & Check Delivery Report

A second process (`services/dispatch-server/server.js`, 562 LOC) handles
the supplier-side flow. It runs as a separate service so a WhatsApp
outage can't take the production line down, and so the leaderboard can be
hosted on a public tunnel while the floor network stays LAN-only.

### 8.1 Service shape

- ESM Node.js, port 3111.
- `data/invoices.json` and `data/materials.json` are the durable store
  (`src/store.js`).
- Auth: `X-Ingest-Secret` for write (`POST /api/invoices`,
  `/api/vision/ingest`), `X-View-Token` (or `?token=` for SSE) for read,
  `X-Bridge-Secret` for the cloud-bridge endpoints.
- WhatsApp Cloud API: webhook at `/api/whatsapp/webhook` (`GET` for
  Meta's verification handshake, `POST` for inbound messages).
- SSE stream: `/api/leaderboard/stream` for tablets.
- `keepAliveTimeout=65_000`, `headersTimeout=66_000`,
  `server.timeout=120_000` so the SSE stream stays alive on mobile
  networks.
- Auto-restart on port-busy: `server.on('error', EADDRINUSE)` waits
  2 s and retries.
- `pruneDelivered` daily tick keeps the JSON file from growing forever.
- 25 s SSE heartbeat (`broadcast('ping', …)`) flushes dead connections.

### 8.2 Inbound

1. Supplier sends a WhatsApp text message → `parseInboundMessages`
   (`src/whatsapp.js`) extracts the body, calls `extractInvoiceFromText`
   to pull invoice number, supplier, items, and SLA.
2. Supplier sends a PDF → `ingestDocumentInvoice` downloads the media
   via `downloadWhatsAppMedia` (`src/wa-media.js`), extracts text with
   `extractPdfText` (`src/pdf-extract.js`), and parses structured
   fields with `extractInvoiceFields`. Low confidence or no text layer
   falls back to a manual-review stub.
3. `upsertInvoice({...parsed, source:'whatsapp'})` stores in memory +
   JSON file, then `pushLeaderboard()` SSE-broadcasts the update.

### 8.3 Operator flow (kiosk + cloud bridge)

1. `POST /api/delivery/step1/:id` — `PENDING → ARRIVED`. Pushes the new
   status to the Worker via `pushToCloud` (`PATCH /dispatch/invoices/:id/status`
   with `X-Bridge-Secret` + idempotency UUID).
2. `POST /api/delivery/material-check/:id` — `ARRIVED → READY`. Same
   shape, with `cloudExtra(updated)` carrying per-abaya items + customer
   phone.
3. `POST /api/items/:id/:idx/toggle` — flip a single abaya's `done` flag.
   No PIN, this is a frequent floor action.
4. `POST /api/delivery/step2/:id` — `READY → DELIVERED`. Fires
   `sendWhatsAppAlert` locally and the cloud handles customer messaging
   (CEO-toggled, metered).

### 8.4 Cloud side

`cloudflare/src/handlers/dispatch.js` exposes:

- `GET /dispatch/invoices` — bridge secret — list active invoices.
- `PATCH /dispatch/invoices/:id/status` — bridge secret — upsert into
  `dispatch_invoices` table; idempotency-Key dedupe within 24 h.
- `GET /dispatch/webhook/whatsapp` — handshake.
- `POST /dispatch/webhook/whatsapp` — HMAC-verify, parse, ingest.
- `runTunnelProbe(env)` — every-minute cron at the top of `index.js`:
  fetch `${FACTORY_TUNNEL_URL}/health`, record `tunnel_probes` row,
  prune 7-day window. Catches "tunnel process alive but tunnel broken"
  mode.

`handleCheckDeliveryReport` (in `check-report.js`) is the CEO-side
aggregate: it proxies the leaderboard's own `/api/check-report` and
runs the same aggregation logic server-side, then merges
`cancellations`. The leaderboard and the cloud both fall back to the
cloud's own D1 when the `LEADERBOARD_URL` env is empty (older
deployments).

---

## 9. Asset replication (cloud + LAN)

The factory has three places to put a photo: local disk (the public
gallery), the LAN share (every laptop on the floor), and the cloud R2
bucket (off-site backup and CEO-dashboard access). The replication is
fire-and-forget; failure is logged but never blocks the upload response.

- `shared/asset-replication.cjs` is the shared module.
- `server.js:268 scheduleAssetReplication` does a `setImmediate` after
  the multer write so the response returns first.
- LAN copy: `copyToShare(abs, ASSETS_LAN_DIR, shareKey)` walks the
  share tree, hashes the file, dedupes by sha256, and writes a
  deduped copy.
- R2 copy: `pushToR2(abs, key, {cfUrl, ingestSecret})` PUTs raw bytes
  with the `X-Content-SHA256` header. The Worker's
  `handleAssetUpload` re-hashes, returns 200 with `sha256, size,
  shaMatches` so the client can detect in-flight corruption.

Boot-time pull: `syncAssetsFromRemote()` first pulls from the LAN
share (cheap, no auth), then from the cloud (one round-trip for list,
then one PUT per missing key).

---

## 10. Desktop launcher

The Electron launcher is a thin shell that boots the factory server and
auto-updates from R2. The key files are:

- `tools/desktop-launcher/start-electron.cjs` — spawns Electron, sets
  `ABAYA_DATA_DIR` to a per-user path so the install dir can be wiped
  on every update, runs the env-wizard on first launch.
- `tools/desktop-launcher/update-policy.cjs` — pure logic for
  `loadUpdatePolicy`, `computeDeviceBucket` (deterministic SHA-256 of
  seed + hostname + user → bucket 0–99), and `getDesiredUpdateRing`
  (stable / beta). Beta is opt-in via `ABAYA_UPDATE_CHANNEL=beta` or
  via the policy's `betaPercent` rollout.
- `tools/desktop-launcher/env-wizard.cjs` + `env-wizard-preload.cjs` —
  walks the operator through `CF_WORKER_URL`, `CF_INGEST_SECRET`,
  `ASSET_UPLOAD_SECRET`, and (optionally) `ASSETS_LAN_DIR`. Persists to
  the data-dir `.env`.
- `scripts/build-release.ps1` + `scripts/build-windows-installer.ps1` —
  produces the NSIS installer and the LAN update artifacts
  (`latest.yml` + `*.exe` + `*.blockmap`).

The auto-update flow on each machine:

1. Electron calls `autoUpdater.checkForUpdates()` every
   `checkIntervalMinutes` (default 360 = 6h).
2. `electron-updater` fetches `${updateUrl}/stable/latest.yml` from
   the Worker (`/updates/stable/latest.yml`).
3. The Worker reads `stable/latest.yml` from the R2 bucket
   (`UPDATES` binding), serves with `Cache-Control: public, max-age=60`.
4. `electron-updater` compares its `version` to the local app version.
   If newer, it streams `*.exe` + `*.blockmap` from R2, applies the
   delta, and prompts the user to relaunch.
5. Audit log writes to `data/launcher-audit.log`, rotated at 2 MB
   (default), kept 5 archives.

If the Worker is unreachable, the LAN mirror at
`http://<factory-lan-ip>:3000/updates/<channel>/<file>` (served by
`server.js` static) takes over — the launcher's `updateUrl` is
configurable in the env-wizard.

---

## 11. Observability

- **Logs** — both tiers print structured JSON-ish lines. The Worker's
  `wrangler.jsonc` has `observability.logs.enabled: true` and
  `invocation_logs: true`.
- **Ratelimits** — three named bindings in `wrangler.jsonc`:
  `INGEST_RATE_LIMIT` (3000 / 60 s), `CATALOG_PUT_RATE_LIMIT`
  (120 / 60 s), `CEO_READ_RATE_LIMIT` (800 / 60 s). Plus a per-call
  `RateLimitClientKey(request, 'factory-ingest'|'ceo-read')` so
  bursty tablets don't starve the dashboard.
- **Queue metrics** — `getIngestStats()` exposes `pushOk`,
  `pushQueued`, `pushPermanentRejected`, `pushAuthRejected`,
  `drainSuccess`, `drainAttempts`, `drainHardFailures`,
  `lastSuccessAt`, `lastAuthError`, `lastPermanentError`,
  `lastTransientError`, `queueDepthMaxSeen`, `backlogSinceMs`.
  Surfaced via `GET /api/ceo-ingest-status` and inside
  `getClientSyncPayload.database`.
- **Tunnel probe** — every minute. If a probe returns `fail` 3 times
  in a row, the alert manager fires a "cloudflared looks dead" email.
- **Alerts** — `shared/alerting/resend-alerts.cjs` is a
  Resend-backed alert manager. It listens to `ingestEvents`
  (`auth-error`, `permanent-error`, `queue-backlog`), polls the
  reconcile loop + sqlite snapshot every 5 min, dedupes by
  `dedupMs` (default 30 min), caps at `hourlyCap` (default 5) per hour.
  Local testing via `POST /api/alerts/test` (X-Ingest-Secret).
- **Health endpoints** — `GET /api/health` (factory), `GET /api/health`
  (Worker, line 62 of `index.js`). The Worker's `/api/.../health` is
  also what `runTunnelProbe` fetches.

---

## 12. Security model

| Surface | Auth | Notes |
|---|---|---|
| `dashboard.farewellabaya.com/*` (page) | CEO cookie (JWT pair) | HttpOnly, SameSite=Lax, Secure on HTTPS, 7-day refresh, 30-min access. |
| `dashboard.farewellabaya.com/api/event` | `X-Ingest-Secret` | Factory-only. Rate-limited. |
| `dashboard.farewellabaya.com/api/catalog/abayas` GET | open | Fresh-install seeding needs read access. |
| `dashboard.farewellabaya.com/api/catalog/abayas` PUT | `X-Ingest-Secret` | Rate-limited. |
| `dashboard.farewellabaya.com/api/employees` GET | open | Same as catalog. |
| `dashboard.farewellabaya.com/api/employees` PUT | `X-Ingest-Secret` | Rate-limited. |
| `dashboard.farewellabaya.com/api/work-types` GET / PUT | `X-Ingest-Secret` on PUT | Open GET. |
| `dashboard.farewellabaya.com/api/assets/{upload,list,proxy}` | `X-Ingest-Secret` | 8 MB, image/* only. |
| `dashboard.farewellabaya.com/api/state` | CEO cookie OR factory `X-Ingest-Secret` (GET only) | A leaked secret cannot push data. |
| `dashboard.farewellabaya.com/api/state/history` | CEO cookie OR factory `X-Ingest-Secret` (GET only) | Same. |
| `dashboard.farewellabaya.com/dispatch/*` | `X-Bridge-Secret` | Independent of CEO auth. Idempotency-Key dedupe. |
| `dashboard.farewellabaya.com/api/messaging/*` | CEO cookie | Toggles the customer-messaging add-on. |
| `dashboard.farewellabaya.com/updates/<ch>/<file>` | open, single-segment filename, channel ∈ {stable, beta} | Installers are not secrets. |
| `factory.lan:3000/api/kiosk/*` | LAN-only (no secret) | Tablet on factory Wi-Fi. |
| `factory.lan:3000/api/upload/*` | optional `ASSET_UPLOAD_SECRET` (`X-Asset-Upload-Secret` header) | Recommended for cross-LAN uploads. |
| `factory.lan:3000/api/ceo-ingest-export` | `X-Ingest-Secret` | NDJSON download for USB mail-in. |
| `factory.lan:3000/api/export/floor-sessions.*` | `X-Export-Secret` (= `FLOOR_EXPORT_SECRET` or fallback to ingest secret) | NDJSON / CSV history export. |
| `dispatch-service:3111/api/*` (read) | optional `X-View-Token` (or `?token=`) | Required when `PUBLIC_URL` is set. |
| `dispatch-service:3111/api/whatsapp/webhook` | HMAC `X-Hub-Signature-256` or Meta handshake | Inbound from Meta. |
| `dispatch-service:3111/api/internal/sync-trigger` | `X-Bridge-Secret` | Cloud → dispatch sync. |
| `tools/desktop-launcher` | OS user (no internal auth) | Local-only Electron. |

All worker endpoints set `Cache-Control: no-store` for personalized or
push-bearing payloads. CORS is open (`Access-Control-Allow-Origin: *`).

---

## 13. Where to start when reading the code

1. `wrangler.jsonc` + `cloudflare/src/index.js` — Worker entry.
2. `cloudflare/src/handlers/ingest.js` + `cloudflare/src/handlers/state.js`
   — the canonical write + read of the production line data.
3. `server.js` lines 1–200 (boot + middleware), 449–687 (push layer),
   1400–1900 (in-memory state, snapshots), 2296–2522 (socket RPCs).
4. `shared/asset-replication.cjs`, `shared/reconcile-cloudflare.cjs`,
   `shared/offline-report-store.cjs`, `shared/sqlite-snapshot.cjs` —
   the modules that make the offline story work.
5. `public/dashboard.js` `aggregateRealtime` (line 1802) — the LAN-side
   KPI engine, the one place the realtime bundle becomes a render.
6. `services/dispatch-server/server.js` — the dispatch + WhatsApp loop.
7. `tools/desktop-launcher/start-electron.cjs` + `update-policy.cjs` —
   the operator's updater.

Routing guide for future tickets:

- "What the dashboard shows" → `cloudflare/src/handlers/state.js` *and*
  `public/dashboard.js` together.
- "What a kiosk can do" → `public/kiosk.js` *and* `server.js` lines
  2296–2522.
- "What survives a WAN outage" → `shared/reconcile-cloudflare.cjs` *and*
  the cloud-today mirror in `server.js` line 2020.
- "Who can read what" → §12.

---

## 14. Known sharp edges (read this before editing)

These are the gotchas the code itself won't tell you. If you're picking
up a ticket, start here.

- **`shared/live-row-state.cjs` is required but missing in this snapshot.**
  `server.js:54` imports it and uses `liveRowState.computeLiveRowState`
  on every Start and on every read. Boot will throw
  `MODULE_NOT_FOUND`. Either restore the file or refactor the four call
  sites to compute the cap-aware clock inline.
- **`lib/local-store.js` is not required anywhere.** It's a SQLite
  durability layer that mirrors the in-memory state, but the factory
  server runs on its in-memory map + the JSON snapshot + the sqlite
  snapshot writer (`shared/sqlite-snapshot.cjs`). Either wire it in or
  delete it.
- **`http-response.js` exports `CORS` as a CJS-style `const CORS = …`**
  but the file is also imported from ESM Worker modules. The named
  import works because the export is plain, but if you change the
  export shape (e.g. add a default export), do it in both styles.
- **The bundled xlsx sample** (`docs/samples/items_export.xlsx`) is
  read-only shipped data. The factory server detects this and switches
  to `data/catalog-manual.json` as the writable store. Never write to
  the sample path.
- **`broadcastState()` is O(active + logs)**. With 20 000 logs and a
  few hundred clients, every Finish re-serializes the bundle N times.
  This is the largest CPU cost on the factory laptop. Don't widen
  `STATE_LOG_WINDOW_MS` past what the report panel needs.
- **`pushToCloudflare` is fire-and-forget** for callers. If you chain
  cloud-dependent work after a Start, the cloud may not have the row
  yet. `await pushToCloudflare` is only safe inside contexts that
  already await (e.g. the `req_finishWork` is intentionally sync after
  the callback to keep the kiosk responsive).
- **Cloud-today mirror's barcode translation** assumes that
  `e_bc_<barcode>` is the xlsx-style stable id. If you change
  `stableEmployeeIdFromXlsxBarcode`, update the matching string in
  `refreshCloudToday` (line 2074) or the LAN dashboard's per-employee
  panels will go dark.
- **Tailscale / CGNAT / virtual adapters** — `lanIpPriority` (line
  3776) pushes them below real NICs. If the printed QR is wrong on a
  network with a 100.64.x.x range, set `LAN_IP=192.168.x.x` in `.env`.

---

## 15. Appendix — function index

Selected functions and their owning files. Use this as a jump table.

```
Factory server (server.js):
  1.   parseEnvPositiveIntOrNull                       server.js:57
  2.   resolveServerBindHost                           server.js:65
  3.   tryEnsureWindowsFirewall                        server.js:3815
  4.   parseInvoiceNumberList (shared)                 shared/invoice-parser.cjs
  5.   parseCheckerBarcodeList (shared)                shared/checker-barcode-parser.cjs
  6.   buildFloorExportPayload (shared)                 shared/floor-session-transfer.cjs
  7.   noteQueueDepthChanged / getCeoSyncMode          server.js:515, 535
  8.   appendCeoIngestFailed / appendCeoIngestRejected server.js:596, 618
  9.   tryPostCeoIngestOnce / pushToCloudflare        server.js:637, 650
  10.  drainCeoIngestQueue / recoverCeoIngestQueue     server.js:818, 581
  11.  refreshWorkingHoursFromCloud                    server.js:786
  12.  isInWorkingWindow / overlapSecWithWindows      server.js:758, 772
  13.  loadFactoryWorkTypesFromDisk                    server.js:1008
  14.  isProcessAllowedOnFactory                       server.js:1034
  15.  validateFactoryWorkTypesReplace                 server.js:1046
  16.  emitEmployeesChanged / emitWorkTypesChanged     server.js:977, 1122
  17.  getClientSyncPayload                            server.js:1130
  18.  refreshAbayaCatalogFromCloud / pushCatalogToCloud server.js:1180, 1214
  19.  hydrateCompletedLogsFromCloud                   server.js:1249
  20.  pushEmployeesToCloud / pushWorkTypesToCloud     server.js:1355, 1359
  21.  refreshEmployeesFromCloud / refreshWorkTypesFromCloud server.js:1391, 1415
  22.  reviveActiveSessionsFromSnapshot                server.js:1513
  23.  restoreOfflineDashboardFromDisk                 server.js:1569
  24.  startCloudD1Hydration                           server.js:1632
  25.  filterCompletedLogs                             server.js:1663
  26.  decorateActiveSessionsForEmit                   server.js:1722
  27.  getRealtimeStateBundle                          server.js:1746
  28.  persistOfflineDashboardReport                   server.js:1810
  29.  buildSqliteSnapshotState / persistSqliteSnapshot server.js:1851, 1869
  30.  refreshCloudToday                               server.js:2020
  31.  migrateCloudXlsxIdsToLocalRoster                server.js:2222
  32.  io.on('connection', socket=>…)                  server.js:2296
  33.  socket.on('req_startWork')                      server.js:2333
  34.  socket.on('req_finishWork')                     server.js:2388
  35.  validateEmployeeRosterIntegrity                 server.js:3104
  36.  persistEmployeeRosterAndReload                  server.js:3185
  37.  parseCatalogWorkbook / parseCatalogXlsxBuffer   server.js:3289, 3321
  38.  persistUploadedCatalogXlsx / backupExisting     server.js:3333, 3349
  39.  buildCatalogXlsxBuffer                          server.js:3384
  40.  app.get('/api/catalog/abayas')                  server.js:2532
  41.  app.put('/api/catalog/abayas')                  server.js:3569
  42.  app.post('/api/import/catalog-xlsx')            server.js:3658
  43.  app.get('/api/catalog/export.xlsx')             server.js:3755
  44.  app.get('/api/release-moment')                  server.js:3837
  45.  app.post('/api/cloud-today/refresh')            server.js:4030
  46.  app.post('/api/reconcile-now')                  server.js:4059
  47.  app.get('/api/ceo-ingest-export')               server.js:4076
  48.  app.get('/api/export/floor-sessions.json')      server.js:4100
  49.  app.post('/api/import/floor-sessions.json')     server.js:4151
  50.  gracefulShutdown / SIGTERM, SIGINT              server.js:4246
  51.  startExcelFileWatchers                          server.js:4297
  52.  seedRosterFromCloudIfLocalMissing               server.js:4347

Cloudflare Worker (cloudflare/src/):
  53.  default fetch(request, env, ctx)                index.js:52
  54.  handleIngest                                    handlers/ingest.js:14
  55.  handleState                                     handlers/state.js:43
  56.  handleHistory                                   handlers/history.js
  57.  handleReport                                    handlers/report.js:65
  58.  handleEmployeeDay                               handlers/employee-day.js
  59.  handleAnalytics                                 handlers/analytics.js
  60.  handleGarmentTrace                              handlers/trace.js
  61.  handleDispatch / runTunnelProbe                 handlers/dispatch.js
  62.  handleCheckDeliveryReport / handleCheckReport   handlers/check-report.js
  63.  handleCancellationsPost / List                  handlers/check-report.js
  64.  handleAssetUpload / handleAssetList / Proxy     handlers/assets.js
  65.  handleCatalogAbayasGet / Put                   modules/catalog.js
  66.  handleEmployeesGet / Put                       modules/roster.js
  67.  handleWorkTypesGet / Put                       modules/roster.js
  68.  isCeoAuthenticated                             auth/ceo-auth.js:8
  69.  mintCeoSessionPair / verifyAccessToken         auth/ceo-jwt.js
  70.  getWorkingHoursConfig / saveWorkingHoursConfig  working-hours.js
  71.  getCEODashboard / getLoginPage                  ui/ceo-pages.js
  72.  sendEODSummary                                  eod-summary.js

Dispatch service (services/dispatch-server/):
  73.  pushLeaderboard / broadcast                     server.js
  74.  pushToCloud / syncFromCloud                    server.js
  75.  ingestDocumentInvoice / sendWhatsAppAlert      server.js
  76.  upsertInvoice / updateInvoiceStatus            src/store.js
  77.  parseInboundMessages / extractInvoiceFromText  src/whatsapp.js
  78.  extractPdfText / extractInvoiceFields           src/pdf-extract.js
  79.  downloadWhatsAppMedia                           src/wa-media.js

Desktop launcher (tools/desktop-launcher/):
  80.  startElectron                                   start-electron.cjs
  81.  loadUpdatePolicy                                update-policy.cjs:42
  82.  computeDeviceBucket / getDesiredUpdateRing     update-policy.cjs:77, 92
  83.  runEnvWizard                                    env-wizard.cjs
```

— end of map.
