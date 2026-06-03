# AbayaTrack Dispatch Server (v2.0) — Hybrid-Edge System

A modular **Hybrid-Edge** material logistics and real-time shop floor leaderboard system. Designed using a pure, reactive Karpathy-style architecture, it isolates incoming supplier webhooks (WhatsApp/Zhipu AI) at the cloud edge and maintains real-time, low-latency visual synchronization in the factory using Server-Sent Events (SSE).

---

## ─── Architecture

```
                                  +------------------------------------+
                                  |         Meta WhatsApp API          |
                                  |         Zhipu Vision AI API        |
                                  +-----------------+------------------+
                                                    | (Inbound Webhooks)
                                                    v
                                  +------------------------------------+
                                  |   Cloud Layer: Cloudflare Worker   |
                                  |       (api.yourdomain.com)         |
                                  +-------+--------------------+-------+
                                          |                    |
                                          | (Read/Write)       | (Secure POST Push)
                                          v                    v
                                  +---------------+    +-----------------------+
                                  | Master State: |    | Local Layer: Bun      |
                                  | Cloud D1 SQL  |    | Dispatch Server       |
                                  +---------------+    | (Port 3001)           |
                                                       +-------+---------------+
                                                               |
                                                               | (Reactive SSE Stream)
                                                               v
                                                       +-----------------------+
                                                       |   Active Leaderboard  |
                                                       |   (Tablet/TV Display) |
                                                       +-----------------------+
```

---

## ─── Folder Structure

```
services/dispatch-server/   ← LOCAL layer only (Node/Bun server). The CLOUD edge
│                              lives in the main Worker at ../../cloudflare/.
├── server.js            ← Local server entry point (node server.js)
├── src/
│   ├── store.js         ← In-memory sorted invoice cache
│   ├── sse.js           ← SSE client registry
│   └── whatsapp.js      ← WhatsApp payload parser (local fallback)
├── public/
│   └── leaderboard.html ← Responsive leaderboard UI
├── data/                ← Persisted invoices.json (gitignored)
├── schema.sql           ← D1 table reference (applied from cloudflare/)
├── .env.example         ← Local environment vars
├── .gitignore
├── package.json
└── README.md
```

> **Note:** there is no `cloud-worker/` or `local-server/` folder. The cloud
> Cloudflare Worker that this README originally split out was consolidated into
> the main Worker — its dispatch routes live in
> `../../cloudflare/src/handlers/dispatch.js` (`handleDispatch`). Do **not** run
> `wrangler deploy` from this folder.

---

## ─── Setup & Deployment

### 1. Cloud Layer (Cloudflare D1 & Worker) — deployed from `cloudflare/`

The dispatch edge (WhatsApp webhook + invoice bridge) is part of the **main**
Worker. Deploy and configure it from the repo's `cloudflare/` directory, not here:

```bash
cd ../../cloudflare

# Apply the D1 schema / migrations (dispatch_invoices etc.)
npx wrangler d1 execute abaya-db --remote --file=migrations/0006_dispatch_invoices.sql

# Set the dispatch/WhatsApp secrets on the main Worker
npx wrangler secret put WHATSAPP_VERIFY_TOKEN  # Webhook token for Meta verification
npx wrangler secret put WHATSAPP_TOKEN         # Permanent Meta API token
npx wrangler secret put DISPATCH_BRIDGE_SECRET # Shared key between the Worker and this local server

# Deploy the Worker
npx wrangler deploy
```

After deploy the routes are live at `https://dashboard.farewellabaya.com/dispatch/*`.
Register the Meta webhook URL as
`https://dashboard.farewellabaya.com/dispatch/webhook/whatsapp`.

### 2. Local Layer (Bun Dispatch Server)

Configure the `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
# Edit .env and set:
# - DISPATCH_PORT=3001
# - DISPATCH_BRIDGE_SECRET=your_bridge_secret
# - CLOUD_WORKER_URL=https://abaya-dispatch-worker.<your-subdomain>.workers.dev
```

Install dependencies and start the server:
```bash
# Start Bun dev server (reloads on file changes)
bun run dev
```

---

## ─── Verification Plan

Verify end-to-end functionality using the smoke test script:
```bash
bun run test
```
This script runs local assertions for state synchronization, SSE broadcasting, WhatsApp message parsing, and local update triggers.
