# AbaYa Track — Operations Runbook

This runbook covers the always-on, alignment, and alerting behaviour added in
the PM2 + reconciliation rollout. It is intended for the IT person on the
factory PC (or office laptop running the catalog watcher).

## 1. PM2 boot persistence

Setup (one-time, elevated PowerShell):

```powershell
yarn pm2:setup
```

This installs `pm2`, `pm2-windows-startup`, registers a logon trigger, starts
`ecosystem.config.cjs`, and persists the process list with `pm2 save`.

Daily ops:

```powershell
yarn pm2:status      # processes + HTTP probe + recent logs
pm2 status
pm2 logs abaya-server
pm2 restart abaya-server
pm2 reload all       # zero-downtime reload after `git pull && yarn install`
```

Apps managed:

| Name                | Conditional on                                                         |
|---------------------|------------------------------------------------------------------------|
| `abaya-server`      | always — `server.js`                                                   |
| `cloudflared-tunnel`| `cloudflared` on PATH **and** `%USERPROFILE%\.cloudflared\config.yml`  |
| `catalog-watcher`   | `tools/catalog-watcher/config.json` exists                             |

Disable an optional app by setting `PM2_DISABLE_TUNNEL=1` or
`PM2_DISABLE_WATCHER=1` in the environment before `pm2 start`.

## 2. Reconciliation (local-priority)

A guarded loop pulls `/api/state` from the Cloudflare Worker every
`RECONCILE_INTERVAL_MS` (default 5 min) and:

- re-pushes any local completed sessions whose deterministic id
  (`WL-<emp_id>-<ended_at_sec>`) is missing in D1;
- re-pushes active sessions present locally but absent in D1's `active_sessions`;
- counts cloud-only rows (read-only — local stays authoritative);
- counts conflict rows (id present in both with different process/duration).

Health: `GET /api/ceo-ingest-status` returns the latest tick metrics under
`reconcile.status.lastResult`. Manual run:

```bash
curl -X POST -H "X-Ingest-Secret: $CF_INGEST_SECRET" \
  http://localhost:3000/api/reconcile-now
```

Backoff: on consecutive failures the interval doubles (capped at 30 min).

## 3. Ingest hardening

`pushToCloudflare` now:

- always queues retriable failures (network, 5xx, 408, 429);
- queues 401/403 too — fix the secret then `pm2 restart abaya-server` and the
  events flush automatically;
- records non-retriable 4xx in `data/ceo-ingest-rejected.jsonl` so an operator
  can replay them after fixing the payload contract.

`ingestStats` exposed at `/api/ceo-ingest-status`:

- `pushOk`, `pushQueued`, `pushPermanentRejected`, `pushAuthRejected`;
- `lastSuccessAt`, `lastAuthError`, `lastPermanentError`, `lastTransientError`;
- `queueDepthMaxSeen`, `backlogSinceMs` (set when pending ≥ threshold).

Backlog alert thresholds: `CEO_INGEST_BACKLOG_THRESHOLD` (default 25 events)
and `CEO_INGEST_BACKLOG_DURATION_MS` (default 10 min).

## 4. SQLite snapshots

Already covered in the snapshot rollout. Quick reminders:

```bash
yarn snapshot:db        # build manually
yarn snapshot:info      # show row counts + meta
yarn snapshot:verify    # detect tampering (HMAC chain)
yarn snapshot:harden    # one-time NTFS ACL hardening (elevated)
yarn snapshot:import --to-d1 [--remote]   # replay into D1
```

## 5. Email alerts (Resend)

Configuration (`.env`):

```
RESEND_API_KEY=...
ALERTS_TO=ops@example.com,ceo@example.com
ALERTS_FROM=AbaYa Track <alerts@example.com>
ALERTS_ENABLED=1
ALERTS_DEDUP_MS=1800000
ALERTS_MAX_PER_HOUR=8
```

Test from the LAN:

```bash
curl -X POST -H "X-Ingest-Secret: $CF_INGEST_SECRET" \
  http://localhost:3000/api/alerts/test
```

Triggered alert kinds:

| kind                    | trigger                                                           |
|-------------------------|-------------------------------------------------------------------|
| `cloud-auth-error`      | first 401/403 from CF push or drain                               |
| `cloud-permanent-error` | first non-retriable 4xx (recorded in rejected queue)              |
| `cloud-queue-backlog`   | pending ≥ threshold for the configured duration                   |
| `reconcile-failure`     | tick reports error or `hard_failures > 0`                         |
| `snapshot-failure`      | sqlite-snapshot writer reports a new error                        |

Each alert kind has its own cooldown (default 30 min) and the manager caps
total emails per hour. `ALERTS_DRY_RUN=1` logs without HTTP calls.

## 6. Deterministic validation checklist

Run this checklist after deploying. It assumes a working Cloudflare Worker
and a non-empty CF_WORKER_URL/CF_INGEST_SECRET.

### A. Reboot persistence

1. `yarn pm2:setup` (elevated, once).
2. Reboot the PC.
3. Log in. Wait 60s.
4. `yarn pm2:status` → `abaya-server` is `online`, HTTP probe returns 200.
5. Open `http://localhost:<PORT>/dashboard.html` and confirm fresh data.

### B. Outage handling

1. With server running, open `/api/ceo-ingest-status` — note `pending: 0`.
2. Block outbound traffic (Wi-Fi off / firewall rule) so the Worker is
   unreachable.
3. Drive 3-5 sessions via the kiosk (or `curl` `req_finishWork`).
4. Refresh `/api/ceo-ingest-status` — `pending` increments, `mode` becomes
   `re-syncing`, `ingestStats.lastTransientError` is populated.
5. Restore connectivity. Within `CEO_INGEST_RETRY_INTERVAL_MS`, `pending`
   drops to 0 and `ingestStats.drainSuccess` increments. No data lost.

### C. Auth failure path

1. Temporarily change `CF_INGEST_SECRET` in `.env` so it does **not** match
   the Worker secret. `pm2 restart abaya-server`.
2. Drive a session.
3. `/api/ceo-ingest-status` → `pending` increments and
   `ingestStats.lastAuthError` is populated. An email alert (kind
   `cloud-auth-error`) should arrive (or be logged in dry-run mode).
4. Restore the correct secret, restart, confirm queue drains.

### D. Permanent rejection path

1. Send a malformed payload (e.g., POST to `/api/event` with `type:'session_finish'`
   missing `ended_at`) using `X-Ingest-Secret`.
2. Confirm Worker returns 400.
3. Verify `ingestStats.lastPermanentError` populated and a row exists in
   `data/ceo-ingest-rejected.jsonl`. No retry storm against the Worker.

### E. Local-priority reconciliation

1. Stop the server. Edit `data/offline-dashboard-reports/...` to remove a
   recent session OR drive a session locally while the worker is unreachable.
2. Bring the worker back; `pm2 start abaya-server`.
3. Wait one reconciliation interval (or POST `/api/reconcile-now`).
4. `reconcile.status.lastResult.replayed_finishes >= 1` and the missing
   session id appears in CF `/api/state` `logs[]`.
5. Compare factory dashboard vs CEO Worker dashboard for the affected day —
   counts match.

### F. Snapshot integrity

1. `yarn snapshot:db && yarn snapshot:verify` → exit 0.
2. Append a byte to one archive file, re-run verify → exit 2 with
   `size_mismatch`.
3. Restore the file, re-run verify → exit 0.

## 7. Recovery commands

| Symptom | Command |
|---|---|
| Server unresponsive | `pm2 restart abaya-server` |
| Update code | `git pull && yarn install && pm2 reload ecosystem.config.cjs --update-env` |
| Force resurrect after reboot | `pm2 resurrect` |
| Inspect queue | `Get-Content data\ceo-ingest-queue.jsonl -Tail 20` |
| Drain queue manually | restart server (auto-drain) or `curl -XPOST /api/reconcile-now` |
| Stop everything | `pm2 stop all` (re-enable with `pm2 start ecosystem.config.cjs`) |
| Disable startup at boot | `pm2-startup uninstall` (then `pm2 kill`) |
