# Farewellabaya.com — hostname contract (frozen)

This document locks **which hostname serves which role**. Follow it for DNS, tunnels, and deployments so HTTPS kiosks, the CEO surface, and factory realtime stay compatible.

## Production hostnames

| Hostname | Service | Purpose |
|----------|---------|---------|
| `dashboard.farewellabaya.com` | **Cloudflare Worker** ([cloudflare/wrangler.toml](../cloudflare/wrangler.toml)) | CEO HTML + `GET /api/state`, reports, catalog API, **`POST /api/event`** factory ingest, **`POST /api/sync/v1/batch`** optional batch+HMAC ingest |
| `kiosk.farewellabaya.com` | **Cloudflare Pages** (project `abaya-kiosk`, folder `kiosk-pwa/`) | Static PWA shell only — **no** Socket.IO. Tablets load this, then connect to the factory API URL from QR (`server=`). |
| `api.farewellabaya.com` | **Cloudflare Tunnel → factory PC** ([config/cloudflared.config.yml](../config/cloudflared.config.yml), [install/SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1](../install/SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1)) | **Must** terminate at `server.js` (REST + **WebSocket / `wss://`**). Used so HTTPS tablets are not blocked by mixed content. |

## Rules

1. **Do not** point `api.farewellabaya.com` at the Worker. Tablets need **`wss://`** to the **same origin** as the REST API (`server.js`). Moving `api` to the edge would break Socket.IO unless you redesign transport.
2. **Do not** serve the factory Node API from `kiosk.farewellabaya.com` — that host is **Pages** (static). The kiosk app shell and the API are intentionally separate.
3. **Optional** machine-only ingest hostname: if you ever split CEO UI from factory traffic, add a **new** subdomain (e.g. `sync.farewellabaya.com` or `ingest.farewellabaya.com`) as a **Worker route** with the same secrets — **never** reuse `api.` for that.

## Environment pointers

- Factory `.env`: `CF_WORKER_URL=https://dashboard.farewellabaya.com`, `CF_INGEST_SECRET=…` (see [START HERE.txt](../START%20HERE.txt)).
- Kiosk QR / setup: [public/setup.html](../public/setup.html) — **Custom URL** = `https://kiosk.farewellabaya.com`, **Factory API for QR** = `https://api.farewellabaya.com` (or your tunnel hostname).

## Related docs

- [REMOTE_ACCESS.md](REMOTE_ACCESS.md) — HTTPS kiosk + tunnel checklist  
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) — full system context  
