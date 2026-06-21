# Maintainability Baseline and Non-Regression Checklist

This checklist is the conservative baseline used before and after refactor batches.

## Core runtime flows

- Local server runtime: `server.js`
- Cloud worker runtime: `cloudflare/src/index.js`
- Kiosk UI: `public/kiosk.html` + `public/kiosk.js`
- Dashboard UI: `public/dashboard.html` + `public/dashboard.js`

## Contract-critical APIs

- `POST /api/event`
- `GET /api/state`
- `GET|PUT /api/catalog/abayas`

## Manual smoke checks

1. Kiosk scan/start/finish session still works for a normal role.
2. Invoice maker flow still validates serial list and submits.
3. Dashboard receives live updates and renders KPIs.
4. Catalog refresh still resolves barcodes and item cards.
5. PWA kiosk still boots, reconnects, and records sessions.

## Data write checks

- Worker ingest still writes `active_sessions`, `sessions`, and `daily_stats`.
- Catalog PUT still updates `abaya_catalog` and `catalog_meta`.

## Refactor guardrails

- Keep route paths and response shapes unchanged.
- Prefer extracting pure helpers and wrappers first.
- Avoid schema-breaking DB changes in this pass.
