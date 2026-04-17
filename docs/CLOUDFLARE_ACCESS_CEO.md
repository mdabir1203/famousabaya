# Cloudflare Access for the CEO dashboard

The Worker at `dashboard.farewellabaya.com` normally protects the HTML and `/api/*` routes with a shared **`CEO_TOKEN`** (query `?token=` or `Authorization: Bearer`).

For production, you can put **Cloudflare Access** in front of the same hostname so users sign in with Google, email OTP, or your IdP — no shared password in URLs.

## Worker behavior

- **`REQUIRE_CF_ACCESS=0`** (default in [cloudflare/wrangler.toml](../cloudflare/wrangler.toml)): only **`CEO_TOKEN`** is checked (existing behavior).
- **`REQUIRE_CF_ACCESS=1`**: if the request includes **`Cf-Access-Authenticated-User-Email`** (set by Access after login), the Worker treats the user as authenticated and skips **`CEO_TOKEN`**.
- If that header is **missing** (e.g. local `wrangler dev` or emergency curl), the Worker **falls back to `CEO_TOKEN`** so deploy scripts and tests still work.

Factory → Worker ingest (`POST /api/event`, `POST /api/sync/v1/batch`) still uses **`INGEST_SECRET`** / **HMAC** only — not affected by CEO auth.

## Setup (high level)

1. In Cloudflare Zero Trust → **Access** → **Applications**, add an application for `dashboard.farewellabaya.com`.
2. Set a policy (e.g. allow `@yourdomain.com` or named users).
3. Deploy the Worker, then set **`REQUIRE_CF_ACCESS = "1"`** in `wrangler.toml` `[vars]` (or via dashboard) and redeploy.

See also [DOMAIN_CONTRACT.md](DOMAIN_CONTRACT.md) for which hostnames must stay on the tunnel vs Worker.
