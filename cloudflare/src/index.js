import { handleCatalogAbayasGet, handleCatalogAbayasPut } from './modules/catalog.js';
import { CORS, jsonRes, errRes, CEO_JSON_NO_STORE } from './http-response.js';
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
import { handleReport } from './handlers/report.js';
import { handleAnalytics } from './handlers/analytics.js';
import { handleGarmentTrace } from './handlers/trace.js';
import { sendEODSummary } from './eod-summary.js';
import { getLoginPage, getCEODashboard, getServiceWorkerCleanupScript } from './ui/ceo-pages.js';
import releaseMomentData from './data/release-moment.json';

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

    const isCEORoute =
      path === '/' ||
      path === '/ceo' ||
      path === '/dashboard.html' ||
      (path.startsWith('/api/') && path !== '/api/event' && path !== '/api/catalog/abayas');

    if (isCEORoute) {
      const token = extractCeoToken(request, url);
      const authed = token && (await isCeoAuthenticated(request, env, url));
      if (!authed) {
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

      if (path === '/api/state' && request.method === 'GET') {
        return handleState(env);
      }

      if (path === '/api/report' && request.method === 'GET') {
        return handleReport(env, url);
      }

      if (path === '/api/settings/working-hours' && request.method === 'PUT') {
        const body = await request.json();
        const cfg = await saveWorkingHoursConfig(env, body && body.working_hours ? body.working_hours : body);
        return jsonRes({ ok: true, working_hours: cfg }, 200, CEO_JSON_NO_STORE);
      }

      if (path === '/api/analytics' && request.method === 'GET') {
        return handleAnalytics(env, url);
      }

      if (path === '/api/trace' && request.method === 'GET') {
        return handleGarmentTrace(env, url);
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
        return new Response(getCEODashboard(url.origin), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
          },
        });
      }

      return errRes('Not found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return errRes('Internal server error: ' + e.message, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendEODSummary(env));
  },
};
