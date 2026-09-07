import { handleCatalogAbayasGet, handleCatalogAbayasPut } from './modules/catalog.js';
import {
  handleEmployeesGet,
  handleEmployeesPut,
  handleWorkTypesGet,
  handleWorkTypesPut,
} from './modules/roster.js';
import { CORS, jsonRes, errRes, CEO_JSON_NO_STORE, isD1Error, d1ErrorResponse } from './http-response.js';
import { rateLimitOr429, rateLimitClientKey } from './ratelimit.js';
import {
  extractCeoToken,
  extractRefreshToken,
  appendCeoSessionCookies,
  appendClearCeoSessionCookies,
} from './auth/ceo-token.js';
import { isCeoAuthenticated } from './auth/ceo-auth.js';
import { ceoPasswordOk } from './auth/ceo-login.js';
import { mintCeoSessionPair, verifyRefreshToken } from './auth/ceo-jwt.js';
import { getWorkingHoursConfig, saveWorkingHoursConfig } from './working-hours.js';
import { handleIngest } from './handlers/ingest.js';
import { handleState } from './handlers/state.js';
import { handleHistory } from './handlers/history.js';
import { handleReport } from './handlers/report.js';
import { handleEmployeeDay } from './handlers/employee-day.js';
import { handleAnalytics } from './handlers/analytics.js';
import { handleGarmentTrace } from './handlers/trace.js';
import { handleDispatch, runTunnelProbe, getMessagingStatus, setMessagingEnabled } from './handlers/dispatch.js';
import { handleCheckDeliveryReport, handleCheckDeliveryConfig, handleCancellationsPost, handleCancellationsList, handleCheckReport, handleCheckReportConfig } from './handlers/check-report.js';
import {
  handleCreateTicket, handleListTickets, handleGetTicket,
  handleResolveTicket, handleReopenTicket, handleOperatorReply,
  handleResolvePage, handleWhatsappIncoming, handleSetBotUrl,
  handleGetSupportConfig, handleSetSupportConfig,
} from './handlers/tickets.js';
import { sendEODSummary } from './eod-summary.js';
import { getLoginPage, getCEODashboard, getServiceWorkerCleanupScript, getPrivacyPolicyPage, getTermsOfServicePage } from './ui/ceo-pages.js';
import { DASHBOARD_CSS_BODY, dashboardCssHref, getDashboardHtmlEtag } from './ui/ceo-static.js';
// Inlined instead of imported as a JSON module — Cloudflare Workers' bundler
// doesn't always honor `assert { type: 'json' }` / `with { type: 'json' }`
// import attributes, and a stale bundle crashed with 1027 on every request.
// Mirror ./data/release-moment.json here whenever it changes.
const releaseMomentData = {
  enabled: true,
  momentId: '2026-05-evolution-1',
  eyebrow: 'Just evolved',
  hook: 'The executive lens widened.',
  outcome: 'Spot drift sooner—same Cloud pulse, calmer read.',
  ctaLabel: 'Jump to reports',
  ctaPath: '#exec-reports',
  secondaryCtaLabel: '',
  secondaryCtaPath: '',
};

function cookieHttps(request) {
  return new URL(request.url).protocol === 'https:';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (path === '/api/health' && request.method === 'GET') {
      return jsonRes({ ok: true, service: 'abaya-track-worker' });
    }

    // ── v1.2.28 — External CSS for the CEO dashboard ─────────────────────────
    // The dashboard's <style> block used to be 25 KB of inline CSS in the
    // HTML response. Lifting it to a separate route with Cache-Control:
    // immutable means the browser only downloads it on the first page
    // load, then hits disk. The query string (?v=) carries the FNV-1a
    // content hash so the URL changes (and the browser refetches) only
    // when the CSS body changes.
    //
    // Open by design: the login page uses the same CSS, and the CSS
    // body itself doesn't contain anything sensitive. The 25 KB file
    // is served as a module-level string, so Worker cold-start cost is
    // a single read of DASHBOARD_CSS_BODY.
    if (path === '/static/ceo.css' && (request.method === 'GET' || request.method === 'HEAD')) {
      const headers = new Headers();
      headers.set('Content-Type', 'text/css; charset=utf-8');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(request.method === 'HEAD' ? null : DASHBOARD_CSS_BODY, { headers });
    }

    // ── Desktop launcher OTA feed ─────────────────────────────────────────────
    // GET /updates/<channel>/<file> streams the release artifacts from R2 so
    // electron-updater can auto-update client laptops over the internet — no
    // public repo, no embedded token. Deliberately unauthenticated (installers
    // are not secrets) and read-only: only GET/HEAD, only stable|beta channels,
    // and no path traversal (single filename segment).
    if (path.startsWith('/updates/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return errRes('Method not allowed', 405);
      }
      if (!env.UPDATES) return errRes('Update feed not configured', 503);
      const seg = path.slice('/updates/'.length).split('/').filter(Boolean);
      if (seg.length !== 2) return errRes('Not found', 404);
      const [channel, file] = seg;
      if (channel !== 'stable' && channel !== 'beta') return errRes('Not found', 404);
      if (!/^[A-Za-z0-9._-]+$/.test(file)) return errRes('Not found', 404);
      const obj = await env.UPDATES.get(channel + '/' + file);
      if (!obj) return errRes('Not found', 404);
      const headers = new Headers(CORS);
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      // latest.yml must stay fresh (update checks); binaries are immutable per version.
      headers.set(
        'Cache-Control',
        file.endsWith('.yml') ? 'public, max-age=60' : 'public, max-age=31536000, immutable'
      );
      return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
    }

    // ── CEO cookie session (no prior auth required) ────────────────────────────
    if (path === '/api/ceo/session' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const p = String((body && body.password) || '').trim();
        if (!ceoPasswordOk(env, p)) {
          return errRes('Invalid access code', 401);
        }
        const pair = await mintCeoSessionPair(env);
        if (!pair.ok) {
          return errRes(
            'Login unavailable: set Wrangler secret CEO_JWT_SECRET (see cloudflare/wrangler.toml).',
            503
          );
        }
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        Object.assign(headers, CORS);
        const sec = cookieHttps(request);
        appendCeoSessionCookies(headers, pair, sec);
        return new Response(
          JSON.stringify({ ok: true, expires_at: pair.exp }),
          { status: 200, headers }
        );
      } catch (_) {
        return errRes('Session error', 500);
      }
    }

    if (path === '/api/ceo/session/refresh' && request.method === 'POST') {
      const ceoRl0 = await rateLimitOr429(
        env.CEO_READ_RATE_LIMIT,
        rateLimitClientKey(request, 'ceo-read'),
        'Too many dashboard requests. Slow down polling.'
      );
      if (ceoRl0) return ceoRl0;
      const rt = extractRefreshToken(request);
      if (!rt) {
        return errRes('Session expired. Please sign in again.', 401);
      }
      const v = await verifyRefreshToken(rt, env);
      if (!v.ok) {
        return errRes('Session expired. Please sign in again.', 401);
      }
      const pair = await mintCeoSessionPair(env);
      if (!pair.ok) {
        return errRes('Session refresh unavailable (CEO_JWT_SECRET).', 503);
      }
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      Object.assign(headers, CORS);
      appendCeoSessionCookies(headers, pair, cookieHttps(request));
      return new Response(JSON.stringify({ ok: true, expires_at: pair.exp }), { status: 200, headers });
    }

    if (path === '/api/ceo/logout' && request.method === 'POST') {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      Object.assign(headers, CORS);
      appendClearCeoSessionCookies(headers, cookieHttps(request));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    // ── Catalog API ───────────────────────────────────────────────────────────
    if (path === '/api/catalog/abayas') {
      try {
        if (request.method === 'GET') {
          return await handleCatalogAbayasGet(env, jsonRes);
        }
        if (request.method === 'PUT') {
          return await handleCatalogAbayasPut(request, env, { errRes, jsonRes, rateLimitOr429 });
        }
        return errRes('Method not allowed', 405);
      } catch (e) {
        console.error('Catalog error:', e);
        return errRes('Catalog error: ' + e.message, 500);
      }
    }

    // ── Roster API (employee list + factory work types) ───────────────────────
    // Same contract as the catalog: open GET so a fresh install can seed itself,
    // X-Ingest-Secret on PUT. Keeps a new laptop off demo/default data.
    if (path === '/api/employees' || path === '/api/work-types') {
      const isEmployees = path === '/api/employees';
      try {
        if (request.method === 'GET') {
          return isEmployees ? await handleEmployeesGet(env, jsonRes) : await handleWorkTypesGet(env, jsonRes);
        }
        if (request.method === 'PUT') {
          const helpers = { errRes, jsonRes, rateLimitOr429 };
          return isEmployees
            ? await handleEmployeesPut(request, env, helpers)
            : await handleWorkTypesPut(request, env, helpers);
        }
        return errRes('Method not allowed', 405);
      } catch (e) {
        console.error('Roster error:', e);
        return errRes('Roster error: ' + e.message, 500);
      }
    }

    if ((path === '/sw.js' || path === '/service-worker.js') && request.method === 'GET') {
      return new Response(getServiceWorkerCleanupScript(), {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'CDN-Cache-Control': 'no-store',
        },
      });
    }

    // ── Public legal pages (no auth) — for OAuth/Login dialog review & users ────
    if ((path === '/privacy' || path === '/privacy.html') && request.method === 'GET') {
      return new Response(getPrivacyPolicyPage(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    if ((path === '/terms' || path === '/terms.html') && request.method === 'GET') {
      return new Response(getTermsOfServicePage(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const isWorkingHoursReadable = path === '/api/settings/working-hours' && request.method === 'GET';
    if (isWorkingHoursReadable) {
      const ceoToken = extractCeoToken(request, url);
      const ingestSecret = (request.headers.get('X-Ingest-Secret') || '').trim();
      const ceoOk = ceoToken && (await isCeoAuthenticated(request, env, url));
      const ingestOk = ingestSecret && ingestSecret === (env.INGEST_SECRET || '').trim();
      if (!ceoOk && !ingestOk) {
        return errRes('Unauthorized (use CEO token/cookie or X-Ingest-Secret)', 401);
      }
      const cfg = await getWorkingHoursConfig(env);
      return jsonRes({ ok: true, working_hours: cfg }, 200, CEO_JSON_NO_STORE);
    }

    // ── Dispatch routes (bridge-secret auth, not CEO-gated) ──────────────────
    if (path.startsWith('/dispatch/')) {
      return handleDispatch(request, env, url);
    }

    const isCEORoute =
      path === '/' ||
      path === '/ceo' ||
      path === '/dashboard.html' ||
      (path.startsWith('/api/') &&
        path !== '/api/event' &&
        path !== '/api/catalog/abayas' &&
        // Roster endpoints authenticate with X-Ingest-Secret (factory server),
        // not the CEO cookie — same exemption the catalog already has.
        path !== '/api/employees' &&
        path !== '/api/work-types' &&
        // History hydration: factory server pulls last N days of sessions at
        // boot. Uses X-Ingest-Secret like the other factory-callable routes.
        path !== '/api/state/history' &&
        // Support tickets (v1.2.24+): factory launcher creates/reads tickets
        // via X-Ingest-Secret. GETs are also reachable from the office's
        // whatsapp-web.js bot (no auth) so it can poll the latest ticket
        // id when an incoming message arrives.
        !(path === '/api/tickets' || path.startsWith('/api/tickets/')) &&
        // /api/worker-settings/support — operator edits office numbers from
        // the launcher's settings panel; X-Ingest-Secret.
        path !== '/api/worker-settings/support' &&
        // v1.2.27 — D1 health probe. Open by design: the factory server
        // and the CEO dashboard's "data is stale" banner both want to
        // poll this without a CEO cookie. The endpoint only does a tiny
        // `SELECT 1` so it can't leak any sensitive data.
        path !== '/api/d1-health');

    if (isCEORoute) {
      const token = extractCeoToken(request, url);
      const authed = token && (await isCeoAuthenticated(request, env, url));
      // Factory server (reconcile loop, manual snapshots, ops scripts) uses the
      // shared ingest secret to read the same state without needing a CEO
      // session. Restricted to GET on state-shaped endpoints so a leaked
      // INGEST_SECRET still can't push or mutate data.
      const ingestSecret = (request.headers.get('X-Ingest-Secret') || '').trim();
      const ingestOk =
        request.method === 'GET' &&
        ingestSecret &&
        ingestSecret === (env.INGEST_SECRET || '').trim() &&
        (path === '/api/state' || path === '/api/state/history');
      if (!authed && !ingestOk) {
        if (path.startsWith('/api/')) {
          return errRes('Session expired. Please sign in again.', 401);
        }
        return new Response(getLoginPage(), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
          },
        });
      }
      const ceoRl = await rateLimitOr429(
        env.CEO_READ_RATE_LIMIT,
        rateLimitClientKey(request, 'ceo-read'),
        'Too many dashboard requests. Slow down polling.'
      );
      if (ceoRl) return ceoRl;
    }

    try {
      if (path === '/api/release-moment' && request.method === 'GET') {
        const payload = Object.assign({}, releaseMomentData);
        delete payload._comment;
        return jsonRes(payload, 200, CEO_JSON_NO_STORE);
      }

      if (path === '/api/event' && request.method === 'POST') {
        return handleIngest(request, env);
      }

      // v1.2.27 — explicit D1 health probe. Returns 200 if a tiny SELECT
      // succeeds, 503 if it fails. Used by the dashboard's "stale" banner
      // and the factory server's self-check. Doesn't touch working hours
      // (avoids the cache) and doesn't bump any state-mutating counters.
      if (path === '/api/d1-health' && request.method === 'GET') {
        try {
          const r = await env.DB.prepare('SELECT 1 as ok').first();
          if (r && r.ok === 1) {
            return jsonRes({ ok: true, d1: 'healthy' }, 200, CEO_JSON_NO_STORE);
          }
          return jsonRes({ ok: false, d1: 'unexpected response' }, 503, { 'Retry-After': '10' });
        } catch (e) {
          if (isD1Error(e)) {
            return d1ErrorResponse(e, 10);
          }
          return errRes('D1 health probe failed: ' + e.message, 500);
        }
      }

      if (path === '/api/state' && request.method === 'GET') {
        return handleState(env, url);
      }
      if (path === '/api/state/history' && request.method === 'GET') {
        return await handleHistory(env, url);
      }

      if (path === '/api/report' && request.method === 'GET') {
        // Await so report/D1 failures stay inside this try/catch and return JSON.
        // Without await, rejected report promises escape to the Worker runtime, which
        // can render an HTML error page that the dashboard then tries to parse as JSON.
        return await handleReport(env, url);
      }

      if (path === '/api/report/employee-day' && request.method === 'GET') {
        return await handleEmployeeDay(env, url);
      }

      if (path === '/api/settings/working-hours' && request.method === 'PUT') {
        const body = await request.json();
        const cfg = await saveWorkingHoursConfig(env, body && body.working_hours ? body.working_hours : body);
        return jsonRes({ ok: true, working_hours: cfg }, 200, CEO_JSON_NO_STORE);
      }

      // ─── Support tickets (v1.2.24+) ────────────────────────────────────────────
      if (path === '/api/tickets' && request.method === 'POST') {
        return handleCreateTicket(request, env);
      }
      if (path === '/api/tickets' && request.method === 'GET') {
        return handleListTickets(request, env);
      }
      const ticketMatch = path.match(/^\/api\/tickets\/([A-Za-z0-9._-]+)(?:\/(resolve|reopen|reply))?$/);
      if (ticketMatch) {
        const id = ticketMatch[1];
        const action = ticketMatch[2];
        if (!action && request.method === 'GET') return handleGetTicket(request, env, id);
        if (action === 'resolve' && request.method === 'POST') return handleResolveTicket(request, env, id);
        if (action === 'reopen' && request.method === 'POST') return handleReopenTicket(request, env, id);
        if (action === 'reply' && request.method === 'POST') return handleOperatorReply(request, env, id);
      }
      // /r/<id> — one-tap resolve page (HTML, no auth)
      const resolvePageMatch = path.match(/^\/r\/([A-Za-z0-9._-]+)$/);
      if (resolvePageMatch && request.method === 'GET') {
        return handleResolvePage(env, resolvePageMatch[1]);
      }
      // /api/worker-settings/support — operator can change office WhatsApp number
      if (path === '/api/worker-settings/support' && request.method === 'GET') {
        return handleGetSupportConfig(request, env);
      }
      if (path === '/api/worker-settings/support' && request.method === 'PUT') {
        return handleSetSupportConfig(request, env);
      }
      // /api/worker-settings/bot-url — bot registers itself on startup (Phase 2)
      if (path === '/api/worker-settings/bot-url' && request.method === 'POST') {
        return handleSetBotUrl(request, env);
      }
      // /webhook/whatsapp-incoming — bot → Worker (Phase 2)
      if (path === '/webhook/whatsapp-incoming' && request.method === 'POST') {
        return handleWhatsappIncoming(request, env);
      }

      if (path === '/api/analytics' && request.method === 'GET') {
        return handleAnalytics(env, url);
      }

      // Check Delivery Report — calendar + per-factory (showroom) breakdown
      // + cancellations. Pulls the operator-leaderboard's invoice / abaya /
      // showroom data via server-side proxy, so the CEO dashboard sees the
      // same data the leaderboard's own modal does. Older `/api/check-report`
      // and `/api/check-report/config` paths are still registered (legacy
      // shim) so any older dashboard build keeps working.
      if (path === '/api/check-delivery-report/config' && request.method === 'GET') {
        return handleCheckDeliveryConfig(env, url);
      }
      if (path === '/api/check-delivery-report' && request.method === 'GET') {
        return handleCheckDeliveryReport(env, url);
      }
      if (path === '/api/check-report/config' && request.method === 'GET') {
        return handleCheckReportConfig(env, url);
      }
      if (path === '/api/check-report' && request.method === 'GET') {
        return handleCheckReport(env, url);
      }
      if (path === '/api/cancellations' && request.method === 'POST') {
        return handleCancellationsPost(env, request);
      }
      if (path === '/api/cancellations' && request.method === 'GET') {
        return handleCancellationsList(env, url);
      }

      if (path === '/api/trace' && request.method === 'GET') {
        return handleGarmentTrace(env, url);
      }

      // ── Customer-messaging add-on (CEO toggles; metered for billing) ─────────
      if (path === '/api/messaging/status' && request.method === 'GET') {
        return jsonRes(await getMessagingStatus(env), 200, CEO_JSON_NO_STORE);
      }
      if (path === '/api/messaging/toggle' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const res = await setMessagingEnabled(env, !!(b && b.enabled));
        return jsonRes(res, res.ok ? 200 : 500, CEO_JSON_NO_STORE);
      }

      if ((path === '/' || path === '/dashboard.html' || path === '/ceo') && request.method === 'GET') {
        const qp = url.searchParams.get('token');
        const qpTrim = qp && qp.trim();
        const okTok = qpTrim && ceoPasswordOk(env, qpTrim);
        if (okTok) {
          const pair = await mintCeoSessionPair(env);
          if (!pair.ok) {
            return errRes(
              'Bootstrap unavailable: set Wrangler secret CEO_JWT_SECRET, then use the login page.',
              503
            );
          }
          const redirectUrl = `${url.origin}${path}`;
          const headers = new Headers();
          headers.set('Location', redirectUrl);
          appendCeoSessionCookies(headers, pair, cookieHttps(request));
          return new Response(null, { status: 302, headers });
        }
        // v1.2.28: ETag/304 round-trip. The HTML is the same for all
        // authed users of a given origin, so a weak ETag derived from
        // (HTML version, CSS version, origin) lets the browser serve
        // 304-with-no-body on page refresh instead of re-downloading
        // the 200 KB HTML body. We use Cache-Control: private,
        // no-cache (not no-store) so the browser stores the response
        // and revalidates with If-None-Match on the next request.
        // private keeps the CDN out of the loop (the response carries
        // the CEO session cookie).
        const htmlEtag = getDashboardHtmlEtag(url.origin);
        const ifNoneMatch = (request.headers.get('If-None-Match') || '').trim();
        if (ifNoneMatch && ifNoneMatch === htmlEtag) {
          // Hit — return 304 with no body. ETag is echoed so the
          // browser can match against the original response.
          const notModifiedHeaders = new Headers();
          notModifiedHeaders.set('ETag', htmlEtag);
          notModifiedHeaders.set('Cache-Control', 'private, no-cache');
          return new Response(null, { status: 304, headers: notModifiedHeaders });
        }
        return new Response(getCEODashboard(url.origin), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-cache',
            'CDN-Cache-Control': 'no-store',
            ETag: htmlEtag,
          },
        });
      }

      return errRes('Not found', 404);
    } catch (e) {
      // v1.2.27: D1 errors are transient (limit, network, internal). Surface
      // them as 503 + Retry-After so the factory server's local queue
      // replays them rather than treating them as permanent failures, and
      // so the CEO dashboard can show a "data is stale" banner instead
      // of "Service unavailable" with no signal.
      if (isD1Error(e)) {
        console.error('Worker D1 error (returning 503):', e && e.message ? e.message : e);
        return d1ErrorResponse(e, 30);
      }
      console.error('Worker error:', e);
      return errRes('Internal server error: ' + e.message, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Multiple crons share this handler — see wrangler.toml [triggers].crons.
    // Unknown cron strings fall through to the EOD summary to preserve prior
    // behavior if a cron is renamed without updating this switch.
    switch (event.cron) {
      case '* * * * *':
      case '*/5 * * * *':
        // v1.2.26: cadence reduced from every-minute to every-5-min to
        // save ~1,152 D1 row-reads/day. Both expressions are accepted
        // here so a re-deploy with the old cron string still routes
        // correctly (one last migration cycle).
        ctx.waitUntil(runTunnelProbe(env));
        break;
      case '0 14 * * *':
      default:
        ctx.waitUntil(sendEODSummary(env));
        break;
    }
  },
};
