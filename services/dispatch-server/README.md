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
services/dispatch-server/
├── cloud-worker/
│   └── index.js         ← Cloud Layer: Cloudflare Worker
├── local-server/
│   ├── server.js        ← Local Layer: Bun server entry point
│   ├── store.js         ← Local in-memory sorted cache
│   └── sse.js           ← Local SSE client registry
├── public/
│   └── leaderboard.html ← Gorgeous responsive leaderboard UI
├── test/
│   └── smoke.js         ← End-to-end integration test
├── schema.sql           ← D1 Database table structure
├── wrangler.toml        ← Wrangler worker config
├── .env.example         ← Local environment vars
├── .gitignore
├── package.json
└── README.md
```

---

## ─── Setup & Deployment

### 1. Cloud Layer (Cloudflare D1 & Worker)

Initialize the D1 SQL database table:
```bash
# Verify connection & apply schema to local/remote D1
npx wrangler d1 execute abaya-db --remote --file=schema.sql
```

Deploy the Cloud Worker:
```bash
# Set required secrets on Cloudflare Edge
npx wrangler secret put WHATSAPP_VERIFY_TOKEN  # Webhook token for Meta verification
npx wrangler secret put WHATSAPP_TOKEN         # Permanent Meta API token (read-only)
npx wrangler secret put DISPATCH_BRIDGE_SECRET # Secret shared key between Cloud and Local Bun

# Deploy worker
npx wrangler deploy
```

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
