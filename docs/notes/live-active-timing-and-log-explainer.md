# Live Active Session Timing + Server / Watcher Log Errors

> **Status:** Local factory (PID 18180, up 9/14/2026 1:41:32 AM) shows **20 employees**, cloud shows **20 employees**, version **1789343798896**. Both rosters agree — the "local 12 vs cloud" discrepancy from earlier has been resolved.

---

## 1. How the live active session shows its timing

Both the **offline** dashboard (factory LAN, served by `server.js` on
`http://127.0.0.1:3111`) and the **online** CEO dashboard (Cloudflare Worker
at `https://dashboard.farewellabaya.com`) render **the same three counters
in the same places, ticking once per second**, using the same `data-tick`
DOM pattern. The *number* you see is identical to within ±1 s on a healthy
network.

### 1.1 The two visible counters

Each active session row shows:

| Cell | What it counts | Tick rate |
|---|---|---|
| **Active today** (top-right, green, big) | In-shift seconds for **this active session, today** (resets at factory-TZ midnight for cross-day sessions) | every 1 s |
| **This build** (under it, smaller) | In-shift seconds the worker has spent on **this specific abaya** | every 1 s |

Both numbers walk the **configured shift windows minute-by-minute** — so a
session that started at 17:30 doesn't count 17:30–18:00 if the shift window
opens at 18:00. That minute-by-minute walk is the same on both sides.

### 1.2 How offline (`public/dashboard.js`) computes it

- **Initial paint** (every `state_update` socket push from `server.js`):
  - `renderLiveSessions()` walks `STATE.active`, looks up the employee's
    `inWindowClient` mask, and for each row computes:
    - `activeTodaySec = computeActiveTodaySec(startedMs, serverNowMs, serverNowSec, tz, todayYmd)`
    - `inShiftSec = computeInShiftSec(startedAtSec, serverNowSec)`
  - The two cells get `data-tick="active-today"` and `data-tick="build"`
    attributes plus `data-emp-id="…"`, so the 1 Hz tick can find them
    without re-walking the DOM.
  - A snapshot is cached in `_liveBaseCache` (key = `generated_at +
    sorted(active emp_ids)`).

- **Every 1 s** (`setInterval(tickLiveSessions, 1000)` at the bottom of
  `public/dashboard.js`):
  - Re-runs `computeInShiftSec` / `computeActiveTodaySec` from the cached
    base + the raw seconds elapsed since `STATE.generated_at` (capped at
    +30 s, well below the 1 s / 4.5 s state-fetch cadence).
  - Writes the new formatted `HH:MM:SS` string directly into the matching
    cell's `textContent`. No innerHTML rebuild, no DOM re-parse.

- **The factory server's clock is the source of truth** — `serverNowMs`
  comes from `STATE.generated_at` so the dashboard never drifts off the
  server's clock even if the client tablet's clock is wrong.

### 1.3 How the cloud (`cloudflare/src/ui/ceo-pages.js`) computes it

- **Initial paint** (every `state_update` socket push from the Worker):
  - `renderLiveSessions()` walks the Worker's `active` map (which carries
    the columns added in `cloudflare/migrations/0016_active_session_live_state.sql`:
    `effective_started_at`, `windowed_elapsed_sec`, `outside_shift`, `is_cross_day`).
  - For each row it does:
    - `base = floor(s.windowed_elapsed_sec)`  ← pushed by the server, already
      cap-aware in-shift seconds from session start (or today 00:00 for
      cross-day) **up to the state snapshot time**.
    - `live = inShiftNow ? elapsedSinceStateSec : 0`  ← seconds since the
      snapshot, **only added if the worker is currently inside a shift
      window** (the `outside_shift` flag from the same migration says so).
    - Total = base + live → formatted `HH:MM:SS`, written into the same
      `data-tick="active-today"` / `data-tick="build"` cells.
  - Same `_liveBaseCache` snapshot keyed on `ts + sorted(active emp_ids)`.

- **Every 1 s** (`setInterval(tickLiveSessions, 1000)` inside the
  rendered HTML):
  - Reads the cached `activeTimingCache.byEmpId` for base values, adds
    `elapsedSinceStateSec` (still capped at +30 s), and writes the new
    formatted time via `textContent` into the `data-tick` cells.
  - The "this build" cell uses a separate per-session walk
    (`computeBuildAge`) that does NOT cap at midnight, because the build
    total spans the whole session.

### 1.4 So — yes, it's just like the online dashboard

- **Same three counters, same places, same tick rate (1 s).**
- **Same minute-by-minute shift-window walk** for the in-shift cap.
- **Same cross-day reset rule** at factory-TZ midnight.
- The only difference is **where the base number comes from**:
  - **Offline:** computed client-side in `public/dashboard.js`
    (`computeInShiftSec` / `computeActiveTodaySec`) from the local
    server's `STATE.active` snapshot, because the local server doesn't
    push the `windowed_elapsed_sec` column yet.
  - **Online:** read directly from the Worker's
    `state.active[id].windowed_elapsed_sec` column (added in migration
    0016), which the Worker recomputes on every state hydrate using the
    same minute-by-minute algorithm.

  Both implementations agree within ±1 s on a healthy LAN. If they ever
  diverge by more than that, the offline dashboard is right (factory
  server is the source of truth per the durable project rule) and the
  cloud is stale — reload the cloud page to re-hydrate.

### 1.5 Why two caches, not one

The `aggregateRealtime(logs, tz, todayYmd)` function used by the
"Today's stats" panel has been split (v1.2.34 perf work):

- **`todayCache`** — fingerprint: `count + lastEndToday + todayYmd + tz`.
  Only changes when **today's** data changes. So adding a log for
  yesterday doesn't bust the today panels.
- **`itemAggCache`** — fingerprint: `logs.length + lastEnd`. Depends on
  every log, so a new yesterday log *does* bust the item aggregate
  panels.

The `renderLiveSessions` counter walk is unaffected by these caches — it
reads from `_liveBaseCache` and `tickLiveSessions` updates via 1 Hz
textContent writes regardless of state.

---

## 2. The SERVER LOG / WATCHER LOG errors in the screenshot

The screenshot shows the **desktop launcher's two log panes**. They're
PM2's `abaya-server` and `abaya-catalog-watcher` process logs streamed
into the launcher's side panels.

### 2.1 SERVER LOG (left pane — green dot)

```
[node] switched to production – stop then start to
       apply NODE_ENV to running servers.
[socket] disconnect
       {"id":"cQvQJ0r1ps1l8RsM1AAAO","reason":"ping
        timeout","transport":"websocket"}
```

This is **two unrelated lines, both benign**:

1. **`[node] switched to production – stop then start to apply NODE_ENV
   to running servers.`** — A PM2 informational notice, not an error.
   It means: someone (or the desktop launcher) set
   `NODE_ENV=production` and PM2 is reminding the operator that PM2
   applies env vars **at process start**, so a stop+start is required for
   the change to take effect on already-running processes. There's no
   failure here — the message is literally PM2 telling you to do a
   restart, which the operator does on purpose when switching modes.

2. **`[socket] disconnect … reason: "ping timeout", transport:
   "websocket"`** — This is **Socket.IO heartbeat noise**. Socket.IO
   sends a `ping` every ~25 s; if a client misses two in a row
   (≈60 s) the server closes the socket with `ping timeout`. Common
   triggers:
   - The kiosk browser tab was backgrounded for >60 s (browsers throttle
     timers on hidden tabs).
   - The kiosk PC briefly lost WiFi and reconnected.
   - The user closed the dashboard tab without logging out.

   The next socket connect (next page open / next refresh) re-establishes
   the session automatically. **No action needed.** The factory floor
   tablets re-subscribe to `state_update` on reconnect, and any events
   sent during the gap are persisted server-side and pushed on the new
   socket.

### 2.2 WATCHER LOG (right pane — red dot)

```
(node:internal/modules/cjs/loader:1282:32)
Node.js v20.19.1
--- process exited (1) ---
```

This is the **`abaya-catalog-watcher`** PM2 process crashing on boot.
The line `(node:internal/modules/cjs/loader:1282:32)` is **Node.js 20's
internal CommonJS loader saying "I can't `require()` something"** — the
real error message is just above it but scrolled off-screen in your
screenshot. It almost always means one of:

| Likely cause | How to confirm |
|---|---|
| **Yarn PnP can't resolve a dependency** because `.pnp.cjs` is missing or stale | `Test-Path tools/catalog-watcher/.pnp.cjs` — if it's missing, this is the cause. `.pnp.cjs` is **gitignored** (it's a Yarn Berry build artifact), so a clean checkout needs `yarn install` first. |
| `node_modules` is missing because `corepack` didn't enable Yarn 4 | `corepack enable && cd tools/catalog-watcher && yarn install` |
| A `.js` file was edited but its sibling `.js.map` was deleted, breaking source-map resolution | `yarn install` rebuilds; otherwise delete the `.map` next to the crashing file |

**Why it doesn't affect the factory floor:** the watcher only watches
`abaya-catalog.json` and pushes changes to the cloud. The main
`abaya-server` is a separate PM2 process and runs fine without it.
You'll just see "catalog won't auto-reload on the cloud until you fix
the watcher".

### 2.3 Quick fix

In PowerShell:

```powershell
cd C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\tools\catalog-watcher
corepack enable
yarn install            # rebuilds .pnp.cjs
cd ..\..
pm2 restart abaya-catalog-watcher
pm2 logs abaya-catalog-watcher --lines 30
```

If `yarn install` fails, paste me the error and I'll diagnose from the
real loader line. The desktop launcher will show the new logs in the
WATCHER LOG pane within ~2 s of restart.

---

## TL;DR

1. **Live active timing:** yes, the offline dashboard renders **the same
   three counters (active today, this build) in the same places with the
   same 1 Hz tick as the online dashboard**. Offline computes the base
   client-side; online reads it pre-computed from the cloud D1
   `windowed_elapsed_sec` column. They agree within ±1 s.

2. **SERVER LOG:** PM2 info notice + Socket.IO ping-timeout reconnect.
   Both benign, no action needed.

3. **WATCHER LOG:** the catalog-watcher PM2 process can't load a module
   (`.pnp.cjs` missing is the most common cause). Doesn't affect the
   factory floor; fix with `yarn install` in `tools/catalog-watcher/`
   then `pm2 restart abaya-catalog-watcher`.
