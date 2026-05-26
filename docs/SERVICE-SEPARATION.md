# AbaYa Track — Service Separation & Boundaries

> **Who this is for:** anyone maintaining the system who needs to understand how the
> **leaderboard server** and the **dashboard** relate — whether they can interfere with
> each other, what they share, and how data crosses between them safely.
>
> **Short answer:** they are two **independent processes** that cannot crash, block, or
> corrupt each other. Their only connection is a one-way, secret-gated sync through the
> Cloudflare cloud.

---

## 1. The three components

```
                FACTORY LAPTOP                                  CLOUD (Cloudflare)
 ┌───────────────────────────────────────────┐      ┌──────────────────────────────┐
 │                                             │      │                              │
 │  ┌─────────────────────┐  ┌──────────────┐ │      │  Worker: abaya-track         │
 │  │ MAIN / DASHBOARD     │  │ LEADERBOARD  │ │      │  https://dashboard           │
 │  │ server.js            │  │ dispatch     │ │ push │       .farewellabaya.com     │
 │  │ port 3000            │  │ server.js    │─┼──────┼─►  D1 db: abaya-db            │
 │  │ Express + Socket.IO  │  │ port 3111    │ │      │  CEO dashboard (JWT auth)    │
 │  │ PM2: abaya-server    │  │ PM2:         │◄┼──────┼─   (reads D1)                 │
 │  │ data/ (sqlite)       │  │ abaya-       │ │ sync │                              │
 │  │ kiosk + dashboard.html│ │ dispatch     │ │      │                              │
 │  └─────────────────────┘  │ data/        │ │      └──────────────────────────────┘
 │                            │ invoices.json│ │
 │                            └──────────────┘ │
 └───────────────────────────────────────────┘
```

| # | Component | What it is |
|---|-----------|------------|
| 1 | **Leaderboard server** | `services/dispatch-server/server.js` — the factory-floor material dispatch leaderboard (tablets). |
| 2 | **Main / dashboard server** | root `server.js` — kiosk + local `public/dashboard.html` + Cloudflare sync feeder. |
| 3 | **Cloud dashboard** | Cloudflare Worker `abaya-track` + D1 `abaya-db` — the CEO dashboard at `dashboard.farewellabaya.com`. |

---

## 2. Separation matrix (leaderboard ↔ main)

| Dimension | Leaderboard server | Main / dashboard server | Shared? |
|-----------|--------------------|-------------------------|---------|
| **Port** | `3111` (`DISPATCH_PORT`) | `3000` (`PORT`) | ❌ no conflict |
| **Process** | PM2 app `abaya-dispatch` (own `ecosystem.config.cjs`) | PM2 app `abaya-server` (root `ecosystem.config.cjs`) | ❌ separate processes |
| **Crash domain** | crashes independently; auto-restarts via its own PM2 | unaffected if leaderboard dies | ✅ isolated |
| **Data store** | `services/dispatch-server/data/invoices.json` | repo-root `data/` (sqlite-snapshots, ceo-ingest-queue, …) | ❌ separate folders |
| **Code** | standalone; imports only `node:` builtins + `skywalking-backend-js` | Yarn PnP, Express, socket.io, sql.js | ❌ zero cross-imports |
| **Runtime** | Node (despite the `bun` naming on the `experiment/bun` branch) | Node | — |

**Key point:** there is **no shared port, no shared file, and no shared code**. One server
cannot take the other down or corrupt its data. They are only "related" because they serve
the same business.

---

## 3. The one intentional link — the cloud bridge

The leaderboard does **not** talk to the main server directly. It syncs through the cloud:

```
leaderboard server ──(PATCH status, X-Bridge-Secret)──► Worker /dispatch/... ──► D1 ──► CEO dashboard
leaderboard server ◄──(GET invoices, X-Bridge-Secret)── Worker /dispatch/invoices
```

- Push: `pushToCloud()` in `services/dispatch-server/server.js` sends status changes to the Worker.
- Pull: `syncFromCloud()` pulls invoices on startup.
- Both are gated by the shared secret **`DISPATCH_BRIDGE_SECRET`** (same value on the factory
  `.env` and as a Wrangler secret on the Worker). If the secret is absent, the bridge is simply
  inactive — the leaderboard runs fully standalone.

---

## 4. Secret channels (all distinct)

| Secret | Used by | Purpose |
|--------|---------|---------|
| `DISPATCH_INGEST_SECRET` | leaderboard server | guards **writes** (POST invoices / vision ingest) via `X-Ingest-Secret` |
| `DISPATCH_VIEW_TOKEN` | leaderboard server | guards **reads** on the public tunnel (see §5) via `?token=` / `X-View-Token` |
| `DISPATCH_BRIDGE_SECRET` | leaderboard ↔ Worker | the factory↔cloud sync handshake (`X-Bridge-Secret`) |
| `CF_INGEST_SECRET` | main server → Worker | main server's separate cloud-ingest channel (`X-Ingest-Secret`) |
| CEO JWT (`CEO_TOKEN`, `CEO_JWT_SECRET`) | Worker | CEO dashboard login |

Each channel is independent — compromising one does not unlock the others.

---

## 5. Exposure model & the read token

The leaderboard server is reachable in two ways:

1. **LAN** — tablets on the same WiFi hit `http://<laptop-ip>:3111`.
2. **Public tunnel** — when `PUBLIC_URL` is set, cloudflared exposes it on the internet so
   tablets on **mobile SIM** (UAE CGNAT, no public IP) can reach it.

Because of (2), data-bearing **read** endpoints are protected by **`DISPATCH_VIEW_TOKEN`**:

| Endpoint | Protected by token? | Notes |
|----------|--------------------|-------|
| `GET /api/invoices` | ✅ | full leaderboard (suppliers, materials, customer notes) |
| `GET /api/info` | ✅ | LAN IP + public URL |
| `GET /api/leaderboard/stream` (SSE) | ✅ | live data feed |
| `GET /api/audio/:id` | ✅ | customer voice notes |
| `GET /health`, `GET /api/config` | ❌ open | liveness / capability flags only — no business data |
| `/`, `/manifest.json`, `/sw.js`, `/icon.svg` | ❌ open | static app shell — loads but shows no data without a token |
| POST writes, delivery steps, bridge sync | gated by their own secrets | see §4 |

**How the token works:** the token is accepted as `?token=` (needed because the SSE
`EventSource` and `<audio>` element cannot send headers) or the `X-View-Token` header.
Tablets open `https://<tunnel>/leaderboard?token=<value>`; the page stores it in
`localStorage` and reuses it for every data/stream/audio call.

**Fail-open when unset:** if `DISPATCH_VIEW_TOKEN` is empty, reads stay open — this keeps
LAN-only deployments simple. The server prints a **loud startup warning** if `PUBLIC_URL`
is set while the token is empty (the unsafe combination).

> Implementation: `checkViewToken()` in `services/dispatch-server/server.js`, mirroring the
> existing `checkSecret()`. Config in `.env.example` and `ecosystem.config.cjs`.

---

## 6. Known / accepted items (not yet hardened)

These were reviewed and intentionally left as-is for now:

- **CORS `*`** on both servers — allows any browser origin. Acceptable for LAN/tablet use;
  tighten to an allow-list if the threat model changes.
- **Write secret is fail-open** — `DISPATCH_INGEST_SECRET`, if unset, allows open writes.
  Set it in production.
- **Leaderboard auto-start on reboot** — the leaderboard's PM2 app must be included in
  `pm2 save` / `pm2 startup` to survive a reboot independently of the main server.
- **Local `dashboard.html`** (main server, port 3000) has no auth — it relies on being
  LAN-only and not tunneled.
