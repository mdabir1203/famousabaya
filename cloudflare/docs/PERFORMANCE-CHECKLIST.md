# Performance & Web Vitals gate (post-deploy)

Targets are **lab** (Lighthouse) + **smoke** (Worker latency). Field CWV (CrUX) depends on users and cannot be forced to 100.

## 1) Worker smoke (TTFB / errors)

From a machine with `CEO_TOKEN` (CEO login password), optional `INGEST_SECRET`, and a deployed Worker that has **`CEO_JWT_SECRET`** set (required for browser login; optional for legacy `?token=` password on `/api/state`):

```bash
# Health
curl -sS "https://YOUR_DASH_HOST/api/health" | jq .

# State using legacy query param (password still accepted for API smoke tests)
curl -sS "https://YOUR_DASH_HOST/api/state?token=YOUR_CEO_PASSWORD" | jq '.ok, .ts'

# Optional: bootstrap browser session (302 + Set-Cookie with access + refresh JWTs)
curl -sSI "https://YOUR_DASH_HOST/ceo?token=YOUR_CEO_PASSWORD"

# After browser login: cookies are HttpOnly JWTs (abaya_ceo_session + abaya_ceo_refresh).
# Scripted access: POST /api/ceo/session with JSON {"password":"..."}, capture Set-Cookie headers.

# Refresh access JWT without retyping password (same-origin cookie jar)
curl -sS -X POST "https://YOUR_DASH_HOST/api/ceo/session/refresh" \
  -H "Cookie: abaya_ceo_refresh=YOUR_REFRESH_JWT" | jq .
```

**Budget (guidance):** `/api/health` p95 &lt; 150ms edge; `/api/state` p95 &lt; 800ms with representative D1 size (tune if exceeded).

## 2) Lighthouse (local or CI)

 against **CEO dashboard URL** and **factory `public/index.html` / kiosk** (via local server or tunnel):

```bash
npx lighthouse "$URL" --only-categories=performance --chrome-flags="--headless" --output=json --output-path=./lh-report.json
```

Review LCP element, CLS (layout shifts), and **Interactions** / INP proxies (Total Blocking Time).

## 3) Iterate

- Prefer **thin HTML first paint** (`display=optional` fonts, defer non-critical CSS).
- Reduce **polling + full `innerHTML` rebuilds** (already throttled in CEO Worker UI + LAN dashboard boot).
- Add **immutable filenames** (`app.[hash].js`) before setting `Cache-Control: immutable` long TTL on JS.
