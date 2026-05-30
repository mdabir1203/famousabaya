# AbaYa Track — Productization Roadmap

> **Audience:** the founders / business owner deciding how to monetize this system long-term.
> **Verdict in one line:** the real revenue path is **licensing this to other tailoring factories**, not ad pixels.

---

## 1. Why productize at all?

Today AbaYa Track is a single-tenant factory-floor system built for *Famous Ladies Gowns Tailoring LLC*. The functionality it provides — material-dispatch leaderboard, WhatsApp ingest, CEO dashboard, mobile-SIM-resilient tablets — is **completely generic** to garment manufacturing. Every abaya/kandura/sari/uniform factory in the Gulf and South Asia has the same pain points (orders silently lost between WhatsApp and the floor; no visibility from the owner's office; offline-during-power-cut workflows).

The math compared to the ad-revenue path we evaluated:

| Path | Realistic monthly revenue (1 year out) | Notes |
|---|---|---|
| Pixel ads on internal tablets/dashboard | **~$0** | No public traffic. Plus data-leak risk to ad networks. |
| Affiliate links on a future marketing page | $50–$300 | Only if the page actually attracts factory-owner traffic. |
| **License the system to 20 factories @ $149/mo** | **$2,980** | Conservative target; ceiling is much higher. |
| License to 100 factories @ $149/mo | $14,900 | Achievable in year 2 with a real GTM motion. |

The licensing path **dwarfs the ad path by 1–2 orders of magnitude** and matches the B2B nature of the product. This doc is the rough plan for getting there without breaking the existing customer.

---

## 2. Single-tenant assumptions today (what needs to change)

A concrete list of "this is hardcoded for one factory" spots reviewers can grep:

| Surface | Current single-tenant assumption | What multi-tenant looks like |
|---|---|---|
| **D1 database** | One D1 binding (`DB` → `abaya-db`) for everything | Either shared DB with `tenant_id` columns, or one DB per tenant (Cloudflare allows scripted creation) |
| **Bridge secret** | One `DISPATCH_BRIDGE_SECRET` shared between Worker and the single factory | Per-tenant secrets, looked up by `tenant_id` derived from request domain or header |
| **CEO JWT secret** | One `CEO_JWT_SECRET`; CEO login authenticates against one `CEO_TOKEN` password | Per-tenant CEO password + JWT keyed by tenant |
| **Custom domain** | `dashboard.farewellabaya.com` is the one custom domain | Per-tenant subdomain (`<tenant>.abaya-track.com`) or own-domain via Cloudflare for SaaS |
| **Cloudflared tunnel** | One factory tunnel URL in `FACTORY_TUNNEL_URL` | Per-tenant tunnel, looked up by tenant |
| **D1 schema** | No `tenant_id` on `dispatch_invoices`, `dispatch_settings`, `idempotency_keys`, `tunnel_probes`, `floor_state`, `analytics_events`, … | Add `tenant_id TEXT NOT NULL` to every table + composite indexes |
| **Worker rate limits** | Three namespaces (`INGEST_RATE_LIMIT`, `CATALOG_PUT_RATE_LIMIT`, `CEO_READ_RATE_LIMIT`) | Same namespaces, but keyed by `tenant_id` in `rateLimitClientKey` |
| **SkyWalking instance** | One `serviceInstance: 'factory-laptop'` | One service per tenant; instance per laptop |
| **Factory `.env`** | Hand-deployed per machine | Generated per-tenant during onboarding, downloaded as a zip with cloudflared + PM2 setup |
| **WhatsApp Business** | One Meta business account, one webhook | Per-tenant Meta Business or shared with tenant routing in the webhook |

None of these are hard problems individually — they're just spread across many surfaces. The risk is that without a deliberate plan, the multi-tenant change touches 50+ files in one mega-PR.

---

## 3. Staged path

Each stage ships independently and is reversible until the next one starts.

### Stage 0 — today (single tenant, hand-deployed)
What we have. Famous Ladies Gowns is live. Don't touch it.

### Stage 1 — add `tenant_id` everywhere (no behavior change)
Goal: prove the schema works **without** introducing real multi-tenancy.

- Migration adding `tenant_id TEXT NOT NULL DEFAULT 'famous-ladies'` to every business table.
- Update every D1 query in `cloudflare/src/handlers/*.js` to filter `WHERE tenant_id = ?`, defaulting to a constant `'famous-ladies'` derived from a single env var (`DEFAULT_TENANT_ID`).
- Same in the factory `services/dispatch-server/src/store.js` (an `invoices.json` becomes `<tenant>.invoices.json`, single file today).
- **No new tenants signed up.** This is purely structural prep.
- **Verification:** existing system continues to work bit-identically. Run the full curl matrix from the previous PR.

**Effort:** 1 week of careful work. Mostly mechanical. ~25 files touched.

### Stage 2 — second tenant on shared infra
Goal: prove a second factory can run side-by-side without code changes.

- Tenant lookup: derive `tenant_id` from the request host (`<tenant>.abaya-track.com`) on the Worker, or from the `X-Tenant-Id` header for factory→Worker calls.
- Per-tenant secrets in a new `tenants` D1 table: `tenant_id`, `bridge_secret`, `ceo_jwt_secret`, `ceo_password_hash`, `factory_tunnel_url`, `whatsapp_phone_id`, `whatsapp_verify_token`, `created_at`, `plan`.
- Onboarding script: `npm run onboard <tenant_id>` generates a `.env` zip + cloudflared config + welcome email.
- Marketing landing page at `abaya-track.com` (separate from `dashboard.<tenant>.com`) with a signup form.
- **Verification:** stand up a `tenant_id='demo-factory'` and run the full E2E flow without re-deploying the Worker.

**Effort:** 2–3 weeks. The marketing site is half the work; the data isolation is the other half.

### Stage 3 — self-serve + billing
- Stripe integration for monthly billing tied to `tenants.plan`.
- Self-serve signup → automated `tenant_id` provisioning + first-month free trial.
- Per-tenant SkyWalking namespace (`serviceName: 'abaya-dispatch-<tenant_id>'`).
- Per-tenant cloudflared subdomain on the factory side (operator deploys a one-line script).
- Per-tenant rate-limit keys.

**Effort:** 2–4 weeks. Billing is the long pole.

### Stage 4 — white-label and partnerships
Optional. Resell to ERP integrators (Zoho, Odoo) at a higher tier. Per-tenant theming, custom domain support via Cloudflare for SaaS.

---

## 4. Monetization model — the explicit policy

### What we will do
- **Subscription licensing** in three tiers. Indicative numbers:
  - **Starter** — $99/mo · up to 200 invoices/mo · 5 tablets · email support.
  - **Standard** — $249/mo · 2,000 invoices/mo · unlimited tablets · WhatsApp business support · custom domain.
  - **Pro** — $599/mo · unlimited · SLA · dedicated SkyWalking namespace · white-label.
- **One-time onboarding fee** for the first deploy (hardware-list consult, cloudflared setup, WhatsApp Business app registration) — $300–$800 depending on tier.
- **Affiliate / referral revenue** on a future *public* marketing surface (fabric suppliers, sewing machines, label printers). Tracked links, no third-party tracking pixels.

### What we will *not* do
**No pixel ads on any auth-gated surface.** This is a hard policy, not a maybe:

- The leaderboard server (`services/dispatch-server`) — never. Tablets are internal tools. Embedding a Meta/Google/AdSense pixel would leak every supplier name, material spec, and customer note (visible in the URL/referrer/cookies sent to the ad network). For a factory, that's a competitive-intelligence breach.
- The CEO dashboard — never. The CEO *is* the paying customer; showing them ads is hostile and contradicts the SLA tier.
- The Cloudflare Worker API endpoints — irrelevant (no rendered HTML).

The only place ads are even *considered* is a future public marketing site (e.g., `abaya-track.com/`) — and even there, prefer affiliate links and sponsored content over JS-based ad pixels. AEO-grade structured data (`Organization` / `SoftwareApplication` / `FAQPage` JSON-LD) + clean content is the long-term presence strategy, not display ads.

---

## 5. Open questions (the founder needs to decide)

These are decision points, not implementation details. Each unblocks a stage.

1. **Pricing tier targets** — are the $99 / $249 / $599 numbers above in the right zone for the Gulf/SEA garment factory market, or do they need recalibration after a few customer conversations?
2. **Target launch geographies** — UAE first (existing customer is here), or also KSA + Bangladesh? Each adds language/currency/payment-method complexity.
3. **Sales motion** — founder-led for the first 10 customers (recommended), then partnerships, then content + organic? Or paid GTM from day one?
4. **White-label timing** — offer in Stage 2 to attract larger customers, or hold for Stage 4 to keep the brand focused?
5. **WhatsApp Business consolidation** — run on one Meta Business account with tenant routing, or require each tenant to bring their own? The former is operationally simpler; the latter is more isolated and lets the tenant own their relationship with Meta.
6. **Hosting cost model** — Cloudflare Workers + D1 are essentially free at the volumes we're talking about (well under 100K req/day per tenant). At what tenant count does this stop being true? (Rough answer: D1 free tier limit is 5 GB and 5M reads/day; we're probably fine past 1,000 tenants.)

---

## 6. What this roadmap does *not* cover

- Internationalization (RTL Arabic UI is already partial; Stage 2+ would need a translation pipeline).
- Hardware-side replication (a second factory laptop for cold-failover).
- Anti-abuse on the public signup flow (would need to be added in Stage 2 alongside Stripe).
- A formal SOC 2 or ISO 27001 program — defer until Stage 3+ when enterprise tier is real.

---

## 7. Immediate next step (if this plan is approved)

Stage 1 — add `tenant_id` everywhere with a hardcoded constant. It's the highest-value structural prep that doesn't change behavior for the existing customer, and once done, every future tenant becomes a config row instead of a code change.

> *This doc is intentionally rough — it's a starting frame for a real GTM conversation, not a final go-to-market plan. Update as decisions are made.*
