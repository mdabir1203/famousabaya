# AbaYa Track — Observability with Apache SkyWalking

> **Who this doc is for:** Anyone who needs to install, operate, or debug the SkyWalking
> monitoring stack on the factory-floor laptop or a new machine.  
> No prior knowledge of SkyWalking required.

---

## Table of Contents

1. [What is SkyWalking and why we use it](#1-what-is-skywalking-and-why-we-use-it)
2. [Architecture overview](#2-architecture-overview)
3. [Quick-start — first-time install](#3-quick-start--first-time-install)
4. [Starting and stopping](#4-starting-and-stopping)
5. [Ports and URLs](#5-ports-and-urls)
6. [What each container does](#6-what-each-container-does)
7. [How to use the UI](#7-how-to-use-the-ui)
8. [Instrumenting AbaYa Track services](#8-instrumenting-abaya-track-services)
9. [Day-to-day operations](#9-day-to-day-operations)
10. [Disk and memory usage](#10-disk-and-memory-usage)
11. [Upgrading SkyWalking](#11-upgrading-skywalking)
12. [Troubleshooting](#12-troubleshooting)
13. [Glossary](#13-glossary)

---

## 1. What is SkyWalking and why we use it

**Apache SkyWalking** is an open-source Application Performance Monitoring (APM) and
observability platform. Think of it as a doctor for your running software — it watches
every request, measures how long things take, and alerts you when something is sick.

### What it gives AbaYa Track

| Problem | SkyWalking solves it by… |
|---|---|
| "The server is slow, but where?" | Distributed tracing: shows each step a request took and its exact duration |
| "PM2 restarted three times last night, why?" | Metrics: CPU/memory graphs with timestamps so you can correlate crashes to load spikes |
| "The WhatsApp webhook stopped working" | Endpoint health: marks dependent services red the moment they stop responding |
| "How many invoices did we process today?" | Custom metrics pushed from `server.js` via the SkyWalking Node.js agent |
| "Was it slow before or after we deployed?" | Timeline comparison: pick two time ranges and diff them |

---

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                   Factory Laptop                        │
│                                                         │
│  ┌─────────────────────┐    ┌──────────────────────┐   │
│  │  AbaYa Track        │    │  Docker (SkyWalking)  │   │
│  │                     │    │                       │   │
│  │  server.js          │───►│  OAP Server :11800    │   │
│  │  dispatch-server    │    │  (collects traces)    │   │
│  │  (SW agent inside)  │    │         │             │   │
│  └─────────────────────┘    │         ▼             │   │
│                             │  BanyanDB :17912      │   │
│  Browser / Tablet           │  (stores traces)      │   │
│  http://localhost:8080 ◄────│         │             │   │
│                             │  UI :8080             │   │
│                             │  (the dashboard)      │   │
│                             └──────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Data flow in plain English:**
1. `server.js` runs with the SkyWalking Node.js agent embedded.
2. Every HTTP request and outbound call is automatically timed and recorded.
3. The agent sends those records ("spans") to the **OAP server** on port `11800`.
4. OAP stores them in **BanyanDB** (an embedded time-series database).
5. You open **`http://localhost:8080`** in a browser to see dashboards and traces.

---

## 3. Quick-start — first-time install

### Prerequisites

- Docker Desktop installed and **running** (whale icon in system tray)
- Internet connection for the first pull (images total ~1.5 GB)
- At least 3 GB free RAM and 4 GB free disk

### One-command install

Open a terminal (Git Bash, WSL, or PowerShell with Git Bash):

```bash
SW_STORAGE=banyandb bash <(curl -sSL https://skywalking.apache.org/quickstart-docker.sh)
```

> **Windows note:** The `SW_STORAGE=banyandb` prefix skips the interactive menu.
> If running from plain PowerShell, use the manual steps below instead.

### Manual install (Windows PowerShell / if the one-liner fails)

```powershell
# 1. Download the compose file
New-Item -ItemType Directory -Force -Path "$env:TEMP\skywalking"
Invoke-WebRequest -Uri "https://github.com/apache/skywalking/raw/master/docker/docker-compose.yml" `
    -OutFile "$env:TEMP\skywalking\docker-compose.yml"

# 2. Patch the health check (curl is not in the OAP image from 10.4.0 onward)
#    This replaces the curl check with a raw TCP connection test.
(Get-Content "$env:TEMP\skywalking\docker-compose.yml" -Raw) `
    -replace "curl http://localhost:12800/internal/l7check", "bash -c 'echo >/dev/tcp/localhost/12800'" `
    -replace "start_period: 10s", "start_period: 120s" |
    Set-Content "$env:TEMP\skywalking\docker-compose.yml" -Encoding utf8

# 3. Launch (BanyanDB storage, pinned versions)
$env:BANYANDB_IMAGE = "apache/skywalking-banyandb:0.10.2"
$env:OAP_IMAGE      = "apache/skywalking-oap-server:10.4.0"
$env:UI_IMAGE       = "apache/skywalking-ui:10.4.0"

docker compose -f "$env:TEMP\skywalking\docker-compose.yml" `
    --project-name=skywalking-quickstart `
    --profile=banyandb `
    up --detach --wait
```

First run pulls ~1.5 GB. Subsequent starts take under 30 seconds.

### Verify it worked

Open `http://localhost:8080` — you should see the SkyWalking Rocketbot UI.  
If the page shows a loading spinner for more than 2 minutes, see [Troubleshooting](#12-troubleshooting).

---

## 4. Starting and stopping

### Start (after machine reboot)

```bash
# Bash / Git Bash
docker compose --project-name=skywalking-quickstart start
```

```powershell
# PowerShell
docker compose --project-name=skywalking-quickstart start
```

### Stop (graceful — keeps data)

```bash
docker compose --project-name=skywalking-quickstart stop
```

### Stop and remove everything (data is deleted)

```bash
docker compose --project-name=skywalking-quickstart down -v
```

> ⚠️ The `-v` flag deletes BanyanDB's stored trace data. Omit it if you want to keep history.

### Restart a single container

```bash
docker restart oap          # Restart only the OAP server
docker restart banyandb     # Restart only the database
docker restart ui           # Restart only the web UI
```

### Auto-start on Windows boot (optional)

Docker Desktop already restarts containers marked "always restart". Enable it with:

```bash
docker update --restart=always banyandb oap ui
```

---

## 5. Ports and URLs

| Service | Port | URL / Purpose |
|---|---|---|
| **SkyWalking UI** | `8080` | `http://localhost:8080` — dashboard you open in a browser |
| **OAP gRPC** | `11800` | `localhost:11800` — Node.js agent sends traces here |
| **OAP HTTP REST** | `12800` | `localhost:12800` — health check + GraphQL queries |
| **OAP Admin** | `17128` | `localhost:17128` — UI admin operations (templates, rules) |
| **BanyanDB gRPC** | `17912` | Internal only — OAP connects here to store data |
| **BanyanDB UI** | `17913` | `http://localhost:17913` — BanyanDB's own web console |

> **Tablet / LAN access:** The SkyWalking UI is only accessible from the laptop itself
> (`localhost`). It does NOT need to be exposed to tablets — tablets only talk to
> `server.js` (port `3111`), not to SkyWalking.

---

## 6. What each container does

### `banyandb` — the database

- **Image:** `apache/skywalking-banyandb:0.10.2`
- **Role:** Stores all traces, metrics, and logs that OAP collects.
- **Data location inside container:** `/tmp/stream-data`, `/tmp/measure-data`
- **Important:** BanyanDB data does NOT persist across `docker compose down -v`.
  For long-term storage, mount a named volume (see [Day-to-day operations](#9-day-to-day-operations)).
- **Health check:** TCP check on port `17912` every 5 s, up to 10 minutes on cold start.

### `oap` — the Observability Analysis Platform

- **Image:** `apache/skywalking-oap-server:10.4.0`
- **Role:** The brain. Receives spans from agents, runs analysis, stores to BanyanDB,
  serves the GraphQL API that the UI queries.
- **Memory:** JVM heap set to `2 GB` (`-Xms2048m -Xmx2048m`). Reduce to `1 GB` on
  memory-constrained laptops (edit the compose file's `JAVA_OPTS`).
- **Health check:** TCP check on port `12800`.  
  *(Was originally a `curl` check, but SkyWalking 10.4.0 removed curl from the image —
  hence the patch in the install steps.)*

### `ui` — the Web Dashboard

- **Image:** `apache/skywalking-ui:10.4.0`
- **Role:** Serves the Rocketbot web interface at port `8080`. Talks to OAP over the
  internal Docker network (not directly to your browser).
- **Nothing to configure here** — it just needs OAP to be healthy.

---

## 7. How to use the UI

Open `http://localhost:8080`.

### General Layout

```
Top nav: Dashboard | Topology | Trace | Log | Alarm
                                    ↑
                              Most useful for debugging
```

### Dashboard tab

Shows pre-built metric panels for:
- **Services** — list of instrumented apps (e.g. `abaya-dispatch`)
- **Instances** — individual process instances
- **Endpoints** — individual URL routes (e.g. `POST /api/invoices`)

Click any service name → drill into its response-time histogram and error rate.

### Trace tab — the most powerful tool

1. Select a service from the dropdown.
2. Set the time range (top-right clock icon).
3. Click any trace row to expand it into a **flame graph** showing every function/call
   and its duration.

**Reading a trace:**
```
POST /api/invoices ──────────────────────────── 145 ms
  └─ readBody() ──── 2 ms
  └─ upsertInvoice() ──── 8 ms
  └─ broadcast() SSE ──── 1 ms
  └─ fetch CF Worker ────────────────── 130 ms  ← bottleneck
```
A wide bar = slow. Red bar = error.

### Topology tab

Visual map of all services and how they call each other. Useful for spotting if the
Cloudflare Worker integration is failing (the edge between `dispatch` and `cf-worker`
goes red).

### Alarm tab

Configured rules trigger alerts here (e.g. "endpoint response time > 1 s for 3 minutes").
Default rules ship with OAP — no extra configuration needed.

---

## 8. Instrumenting AbaYa Track services

SkyWalking needs a **language agent** installed in each Node.js process to collect data.

### Install the Node.js agent

```bash
cd services/dispatch-server
npm install skywalking-backend-js
```

### Add 2 lines to `server.js` — at the very top, before any other import

```js
// ─── SkyWalking APM ──────────────────────────────────────────────────────────
import agent from 'skywalking-backend-js';
agent.start({
  serviceName:  'abaya-dispatch',   // shown in SkyWalking UI
  serviceInstance: 'factory-laptop',
  collectorAddress: 'localhost:11800',
  // Set to false in production to reduce log noise:
  logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'error',
});
// ─────────────────────────────────────────────────────────────────────────────
```

### Verify the agent connected

1. Start `server.js` (`pm2 start ecosystem.config.cjs` or `node server.js`).
2. Make one request to any endpoint (e.g. open the leaderboard in a browser).
3. In SkyWalking UI → **Trace** tab → select service `abaya-dispatch` → the trace should appear within 30 s.

### For the main `server.js` (root)

Same steps — use `serviceName: 'abaya-main'` so traces from both services are separate.

### What gets auto-instrumented (zero extra code)

- All incoming HTTP requests (method, path, status, duration)
- All outgoing `fetch()` / `http.request()` calls
- Errors thrown inside route handlers
- CPU and memory metrics (sampled every 10 s)

---

## 9. Day-to-day operations

### Check container health

```bash
docker compose --project-name=skywalking-quickstart ps
```

All three containers should show `healthy` or `running`.

### View OAP logs (useful when traces aren't arriving)

```bash
docker logs oap --tail=50 --follow
```

Look for lines starting with `ERROR` or `WARN`. A healthy OAP prints:
```
INFO - OAP started successfully.
INFO - Register agent [abaya-dispatch] ...
```

### View BanyanDB logs

```bash
docker logs banyandb --tail=50
```

### How much disk is SkyWalking using?

```bash
docker system df
```

BanyanDB stores data inside the container by default. To see container-level size:

```bash
docker inspect banyandb --format='{{.SizeRootFs}}'
```

### Persist BanyanDB data across restarts

By default, data lives inside the container and is lost on `down -v`. To persist it,
add a volume to the compose file:

```yaml
# In docker-compose.yml, under the banyandb service:
volumes:
  - banyandb-data:/tmp/stream-data
  - banyandb-measure:/tmp/measure-data

# At the bottom of the file:
volumes:
  banyandb-data:
  banyandb-measure:
```

Then re-run `docker compose ... up --detach`.

### Trim old data (prevent disk bloat)

BanyanDB automatically TTL-expires traces. Default retention:
- Traces: **7 days**
- Metrics: **7 days**

To change it, set env vars on `oap-bdb` in the compose file:
```yaml
environment:
  SW_CORE_RECORD_DATA_TTL: 3       # days to keep traces
  SW_CORE_METRICS_DATA_TTL: 3      # days to keep metrics
```

### Push a custom metric from code

```js
// Example: track invoice count in server.js
import { MeterProvider } from 'skywalking-backend-js';
const meter = MeterProvider.getMeter('abaya-dispatch');
const invoiceCounter = meter.createCounter('invoices_processed_total');

// Inside the POST /api/invoices handler:
invoiceCounter.add(1, { status: invoice.status });
```

---

## 10. Disk and memory usage

### RAM (approximate)

| Container | Idle RAM |
|---|---|
| BanyanDB | ~150 MB |
| OAP (JVM) | ~800 MB – 1.2 GB |
| UI (Node) | ~80 MB |
| **Total** | **~1.1 – 1.5 GB** |

> The laptop has enough RAM as long as PM2 processes are counted too.
> If RAM is tight, lower OAP's heap: set `JAVA_OPTS: "-Xms512m -Xmx512m"` in the
> compose file.

### Disk

- Initial image pull: ~1.5 GB (one time only)
- Running data (7-day retention): ~200–500 MB for light traffic

---

## 11. Upgrading SkyWalking

1. **Check the release notes** at https://skywalking.apache.org/docs/ for breaking changes.
2. Stop the current stack: `docker compose --project-name=skywalking-quickstart down`
3. Update the image tags in your compose file or re-run the quickstart script with the
   new `SW_VERSION`:
   ```bash
   SW_VERSION=10.5.0 SW_STORAGE=banyandb bash <(curl -sSL https://skywalking.apache.org/quickstart-docker.sh)
   ```
4. Verify: open `http://localhost:8080`, check the version in the bottom-left corner.

> **Note:** BanyanDB and OAP versions must be compatible. The quickstart script always
> picks a tested pair. If upgrading manually, check the compatibility matrix in the docs.

---

## 12. Troubleshooting

### UI shows "Loading…" forever

**Cause:** OAP hasn't finished starting (takes up to 2 minutes on first launch).  
**Fix:** Wait, then check `docker logs oap --tail=30` for `OAP started successfully`.

---

### No traces showing up in the Trace tab

1. Confirm the Node.js agent started: look for `[skywalking]` lines in `server.js` output.
2. Confirm OAP is healthy: `docker inspect oap --format='{{.State.Health.Status}}'` should return `healthy`.
3. Make a real request (e.g. `curl http://localhost:3111/api/leaderboard`).
4. Wait 30 s — traces are batched, not real-time.
5. Check the agent config: `collectorAddress` must be `localhost:11800`, not `127.0.0.1:11800`.

---

### `Error: ECONNREFUSED localhost:11800`

OAP container is not running.  
**Fix:** `docker compose --project-name=skywalking-quickstart start`

---

### OAP container restarts repeatedly

```bash
docker logs oap --tail=100 | grep -E "ERROR|FATAL|Exception"
```

Most common cause: not enough heap memory.  
**Fix:** In the compose file change `JAVA_OPTS: "-Xms512m -Xmx512m"` then restart OAP.

---

### Port 8080 already in use

Another app is using port 8080.  
**Fix:** Change the UI port in the compose file:
```yaml
ports:
  - "8088:8080"   # expose on 8088 instead
```
Then access `http://localhost:8088`.

---

### `docker compose` command not found

Use `docker-compose` (with hyphen) — older Docker Desktop versions install it separately.

---

### BanyanDB health check failing on startup

BanyanDB can take up to 2 minutes on first start on a slow machine. The `start_period: 120s`
patch we applied accounts for this. If it still fails:
```bash
docker logs banyandb --tail=30
```

---

## 13. Glossary

| Term | Plain-English meaning |
|---|---|
| **Span** | One operation (e.g. "handle POST /api/invoices took 45 ms") |
| **Trace** | A chain of spans for one complete request, from first call to last |
| **OAP** | Observability Analysis Platform — the SkyWalking server process |
| **BanyanDB** | Apache's purpose-built time-series DB for SkyWalking (replaces Elasticsearch for small deployments) |
| **Agent** | A small library added to `server.js` that captures spans and sends them to OAP |
| **Service** | A named application in SkyWalking (e.g. `abaya-dispatch`) |
| **Instance** | A single running process of a service |
| **Endpoint** | A specific URL route (e.g. `GET /api/leaderboard`) |
| **Metric** | A number measured over time (e.g. requests/sec, CPU %) |
| **Alarm** | A rule that fires when a metric crosses a threshold |
| **TTL** | Time-to-Live — how long data is kept before being deleted |
| **Profile** | Docker Compose concept: a named group of containers activated with `--profile` |

---

*Last updated: 2026-05-25 | SkyWalking 10.4.0 + BanyanDB 0.10.2*
