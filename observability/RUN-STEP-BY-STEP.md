# SkyWalking — Step-by-Step Run Guide (AbaYa Track)

> A copy-paste checklist to get monitoring running on the factory laptop.
> For background/concepts, see [`docs/OBSERVABILITY.md`](../docs/OBSERVABILITY.md).
> Everything here is specific to **this** codebase.

---

## ⚠️ STOP — read this first: disk space

This laptop has been running **critically low on disk** (recently ~200 MB free).
SkyWalking's Docker images need ~1.5 GB, and BanyanDB keeps writing trace data.
**If the disk fills, both SkyWalking AND the AbaYa server will crash.**

Before starting, free up space:

```powershell
# 1. Check free space (need at least 3 GB to run SkyWalking comfortably)
(Get-PSDrive C).Free / 1GB

# 2. Trim old SQLite snapshots — keep only the 5 newest (this alone frees ~340 MB)
$dir = "C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\data\sqlite-snapshots"
Get-ChildItem $dir -Filter "abaya-snapshot-2*.db" |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 |
    Remove-Item -Force

# 3. Reclaim Docker space (removes stopped containers + dangling images)
docker system prune -f
```

> 🔧 **Permanent fix needed:** the SQLite snapshot job has no retention policy and
> regenerates hundreds of files. This is tracked separately — until it's fixed,
> re-run step 2 periodically or SkyWalking will run out of room.

---

## Part A — Start SkyWalking (the monitoring stack)

### Step 1 — Make sure Docker Desktop is running

Look for the whale icon in the system tray. If it's not there:

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Wait until `docker info` succeeds (about 30–60 s after launch):

```powershell
docker info
```

### Step 2 — Start the stack

Double-click **`observability\start.bat`**, or run:

```powershell
cd C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\observability
.\start.bat
```

This launches three containers: **banyandb** (database), **oap** (collector), **ui** (dashboard).

### Step 3 — Wait for OAP to become healthy (up to 2 minutes)

```powershell
docker inspect oap --format "{{.State.Health.Status}}"
```

Repeat until it prints `healthy`. (First start is slow — the Java collector boots cold.)

### Step 4 — Open the dashboard

Browse to **http://localhost:8080**

You'll see the SkyWalking UI. It will be empty until the AbaYa server sends data (Part B).

---

## Part B — Connect the AbaYa Dispatch Server

The dispatch server is **already configured** to send traces. Two things make it work:

| File | What it does |
|------|--------------|
| `services/dispatch-server/sw-instrument.mjs` | Starts the APM agent before the server boots |
| `services/dispatch-server/ecosystem.config.cjs` | PM2 loads the agent via `--import` and sets `SW_AGENT_COLLECTOR_BACKEND_SERVICES=localhost:11800` |

### Step 5 — Install the APM agent (one time)

```powershell
cd C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\services\dispatch-server
npm install
```

> This pulls `skywalking-backend-js` (~30 MB) into a local `node_modules`.
> If the package is missing, the server still runs fine — it just won't send traces
> (the bootstrap prints a one-line warning and continues).

### Step 6 — (Re)start the dispatch server under PM2

```powershell
cd C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\services\dispatch-server

# Fresh start:
pm2 start ecosystem.config.cjs

# OR, if it's already running, reload to pick up the new config:
pm2 reload abaya-dispatch --update-env
```

### Step 7 — Confirm the agent connected

Check the PM2 logs for the startup line:

```powershell
pm2 logs abaya-dispatch --lines 20
```

You should see:

```
[skywalking] APM agent started → localhost:11800 (service: abaya-dispatch)
```

If instead you see `APM agent NOT started: Cannot find package` → go back to Step 5.

### Step 8 — Generate some traffic, then look in the UI

```powershell
# Hit a few endpoints to create traces
curl http://localhost:3111/api/leaderboard
curl http://localhost:3111/api/info
```

Open **http://localhost:8080** → **Trace** tab → select service **`abaya-dispatch`**.
Traces appear within ~30 seconds (data is batched, not instant).

---

## Everyday commands

| Task | Command |
|------|---------|
| Start SkyWalking | `observability\start.bat` |
| Stop SkyWalking (keep data) | `observability\stop.bat` |
| Check container status | `observability\status.bat` |
| OAP health | `docker inspect oap --format "{{.State.Health.Status}}"` |
| OAP logs (debug) | `docker logs oap --tail 50` |
| Dispatch server logs | `pm2 logs abaya-dispatch` |
| Reclaim Docker disk | `docker system prune -f` |

---

## Turning monitoring OFF

You don't need to uninstall anything. Just clear one env var.

**Option 1 — disable tracing but keep SkyWalking running:**
Edit `ecosystem.config.cjs`, set `SW_AGENT_COLLECTOR_BACKEND_SERVICES: ''`, then:
```powershell
pm2 reload abaya-dispatch --update-env
```

**Option 2 — shut down SkyWalking entirely (frees ~1.5 GB RAM):**
```powershell
observability\stop.bat
```
The dispatch server keeps running normally — the agent just can't reach a collector,
which it handles silently.

---

## If something goes wrong

| Symptom | Fix |
|---------|-----|
| `start.bat` says "Failed to start" | Docker Desktop isn't running — see Step 1 |
| UI stuck on "Loading…" | OAP not healthy yet — wait, then `docker logs oap --tail 30` |
| No traces in UI | Confirm Step 7 log line; confirm OAP is `healthy`; wait 30 s after traffic |
| `pm2: command not found` | From repo root: `yarn pm2:start` (root uses Yarn PnP for pm2) |
| OAP keeps restarting | Out of memory — lower heap in `observability/docker-compose.yml` (`JAVA_OPTS`) |
| Disk full errors | Run the disk-cleanup steps at the top of this doc |

---

## What is NOT instrumented (and why)

- **The main root server** (`/server.js`, Express + socket.io) uses **Yarn PnP**, which
  needs a different agent-loading approach. It's intentionally left out for now to keep
  this change small and low-risk. See `docs/OBSERVABILITY.md` § 8 if you want to add it.
- **Outbound `fetch()` calls** (to the Cloudflare Worker) may not auto-trace, because
  Node's `fetch` uses `undici` rather than the classic `http` module the agent hooks.
  **Incoming** HTTP requests to the dispatch server ARE fully traced — that's the main value.

---

*Configured for: dispatch-server (Node ESM, port 3111, PM2) + SkyWalking 10.4.0 / BanyanDB 0.10.2*
