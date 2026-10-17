# Wavelink Live — AbayaTrack prototype

An isolated, opt-in prototype for a browser PWA voice interface over AbayaTrack's existing Cloudflare Worker. It does not modify the production Worker or factory workflow.

## What is included

- Provider adapter contract with an initial OpenAI GPT-Live WebRTC adapter.
- Browser WebRTC audio path; the browser never receives the long-lived provider API key.
- Password-protected, signed, HttpOnly session cookie for the prototype.
- One read-only tool: `get_factory_summary`, backed by the existing authenticated `GET /api/state` endpoint.
- Asynchronous tool execution: tool calls run on the app server while WebRTC media continues.
- Client-side measurements for session startup, tool round-trip and response-event latency.
- No business write operations.

## Requirements

- Node.js 18+ (Node 22 LTS recommended for local development).
- Dependencies installed from the repository root with `yarn install`.
- A project API key enabled for GPT-Live.
- AbayaTrack CEO token with read access to `/api/state`.

## Configure

Set these environment variables in your local environment; do not commit secrets:

```dotenv
LIVE_APP_PASSWORD=use-a-long-random-local-password
LIVE_SESSION_SECRET=use-a-different-random-secret-at-least-32-characters
LIVE_PUBLIC_ORIGIN=http://127.0.0.1:4178
LIVE_HOST=127.0.0.1
LIVE_PORT=4178
OPENAI_API_KEY=
ABAYATRACK_WORKER_URL=https://dashboard.farewellabaya.com
ABAYATRACK_CEO_TOKEN=
```

Keep `LIVE_HOST` on loopback for local development. To expose this to other users, integrate it with the existing AbayaTrack identity/session system and deploy behind HTTPS; do not expose this standalone password gate directly to the public internet.

## Run

From the repository root:

```bash
node services/wavelink-live/server.mjs
```

Open `http://127.0.0.1:4178`. Sign in with `LIVE_APP_PASSWORD`, then start a voice session and ask: “Give me today's factory summary.”

## Security boundaries

- The server enforces exact Origin checks for state-changing requests.
- Session cookies are HttpOnly, SameSite=Strict, signed, short-lived, and Secure when using HTTPS.
- Provider and AbayaTrack credentials remain server-side.
- The factory tool reads only the existing state endpoint and returns a narrow summary, not employee-level or customer-level records.
- Tool arguments are ignored; the tool has no mutation capability.
- This is a prototype, not a production authentication system. Before multi-user deployment add identity integration, per-user/tenant authorization, rate limits, CSRF/security headers, monitoring, and formal privacy/retention controls.

## Provider adapter

`providers/openai-live.mjs` implements `createAnswer({ sdp, instructions, tools })`. A future provider can implement the same contract and be selected via `LIVE_VOICE_PROVIDER`; unknown providers fail closed.

## Latency definitions

- **Startup:** user clicks Start → remote SDP answer applied and data channel open.
- **Tool round-trip:** server receives tool request → structured result returned to the browser.
- **Response event:** browser receives a model response-start event after a tool result is submitted.

These are client-observed prototype timings, not p50/p95 production SLOs. Do not record audio or persist transcripts in this prototype.
