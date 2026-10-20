import 'dotenv/config';
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVoiceProvider } from './providers/index.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const HOST = process.env.LIVE_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.LIVE_PORT || '4178', 10);
const PUBLIC_ORIGIN = process.env.LIVE_PUBLIC_ORIGIN || `http://127.0.0.1:${PORT}`;
const COOKIE_NAME = 'wavelink_live_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const MAX_BODY_BYTES = 128 * 1024;
const TOOL_TIMEOUT_MS = 3_500;

const INSTRUCTIONS = [
  'You are Wavelink Live, a concise voice assistant for the AbayaTrack factory operations team.',
  'For questions about current factory operations, delegate to the application to retrieve a verified factory summary. Do not guess while the lookup is running.',
  'Clearly state when data is unavailable or stale. Do not invent counts, causes, delayed orders, employee details, or business facts.',
  'Keep spoken answers short. Explain metrics in plain language.',
  'The available application action is read-only. Never claim to have changed an order, contacted a customer, or performed a write operation.',
].join(' ');

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function constantTimeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function sessionSecret() {
  const secret = String(process.env.LIVE_SESSION_SECRET || '');
  return secret.length >= 32 ? secret : null;
}

function signSession(expiry) {
  return createHmac('sha256', sessionSecret()).update(String(expiry)).digest('base64url');
}

function cookieValue(req) {
  const raw = String(req.headers.cookie || '');
  const item = raw.split(';').map((v) => v.trim()).find((v) => v.startsWith(COOKIE_NAME + '='));
  return item ? decodeURIComponent(item.slice(COOKIE_NAME.length + 1)) : '';
}

function authenticated(req) {
  if (!sessionSecret()) return false;
  const value = cookieValue(req);
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const expiry = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!/^\d{10,}$/.test(expiry) || Number(expiry) <= Math.floor(Date.now() / 1000)) return false;
  return constantTimeStringEqual(signature, signSession(expiry));
}

function originAllowed(req) {
  return req.headers.origin === PUBLIC_ORIGIN;
}

function setSessionCookie(res) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const value = `${expiry}.${signSession(expiry)}`;
  const secure = PUBLIC_ORIGIN.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function clearSessionCookie(res) {
  const secure = PUBLIC_ORIGIN.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

async function getFactorySummary() {
  const base = String(process.env.ABAYATRACK_WORKER_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.ABAYATRACK_CEO_TOKEN || '').trim();
  if (!base || !token) {
    const error = new Error('Factory data source is not configured');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`${base}/api/state?days=1&limit=100`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error('Factory data source is unavailable');
    error.statusCode = response.status === 429 ? 429 : 502;
    throw error;
  }

  const state = await response.json();
  if (state?.ok !== true) {
    const error = new Error('Factory data source returned an invalid response');
    error.statusCode = 502;
    throw error;
  }

  const active = state.active && typeof state.active === 'object' ? state.active : {};
  const completedToday = Number(state.completed_today);
  const efficiencyToday = Number(state.efficiency_today);
  const asOfMs = Number(state.ts);

  return {
    source: 'abayatrack',
    factory_day: typeof state.factory_today === 'string' ? state.factory_today : null,
    completed_today: Number.isFinite(completedToday) ? completedToday : null,
    active_workers: Object.keys(active).length,
    efficiency_today_pct: Number.isFinite(efficiencyToday) ? efficiencyToday : null,
    data_as_of: Number.isFinite(asOfMs) && asOfMs > 0 ? new Date(asOfMs).toISOString() : null,
    ingest_lag_ms: Number.isFinite(Number(state.ingest_lag_ms)) ? Number(state.ingest_lag_ms) : null,
  };
}

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requested).replace(/^([.][.][/\\\\])+/, '').replace(/^[/\\\\]+/, '');
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 404, { error: 'Not found' });
  try {
    const content = await readFile(filePath);
    const type = ({
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
    })[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'microphone=(self)',
    });
    res.end(content);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', PUBLIC_ORIGIN);
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, service: 'wavelink-live', provider: process.env.LIVE_VOICE_PROVIDER || 'openai-live' });
    }
    if (method === 'GET' && url.pathname === '/api/auth/status') {
      return json(res, 200, { authenticated: authenticated(req) });
    }
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      if (!originAllowed(req)) return json(res, 403, { error: 'Origin rejected' });
      if (!sessionSecret()) return json(res, 503, { error: 'Session security is not configured' });
      const configuredPassword = String(process.env.LIVE_APP_PASSWORD || '');
      if (!configuredPassword) return json(res, 503, { error: 'Login is not configured' });
      const body = JSON.parse(await readBody(req));
      if (!constantTimeStringEqual(body?.password || '', configuredPassword)) return json(res, 401, { error: 'Invalid credentials' });
      setSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!originAllowed(req)) return json(res, 403, { error: 'Origin rejected' });
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authenticated(req)) return json(res, 401, { error: 'Authentication required' });
      if (!originAllowed(req)) return json(res, 403, { error: 'Origin rejected' });

      if (method === 'POST' && url.pathname === '/api/live/session') {
        const sdp = await readBody(req, 96 * 1024);
        if (!sdp.trim().startsWith('v=')) return json(res, 400, { error: 'A valid SDP offer is required' });
        const provider = getVoiceProvider();
        const result = await provider.createAnswer({ sdp, instructions: INSTRUCTIONS });
        return json(res, 201, { sdp: result.sdp, session_id: result.sessionId });
      }

      if (method === 'POST' && url.pathname === '/api/tools/factory-summary') {
        const body = JSON.parse((await readBody(req, 4 * 1024)) || '{}');
        if (body?.tool !== 'get_factory_summary') return json(res, 400, { error: 'Unknown tool' });
        const startedAt = performance.now();
        try {
          const result = await getFactorySummary();
          return json(res, 200, { ok: true, result, tool_latency_ms: Math.round(performance.now() - startedAt) });
        } catch (error) {
          return json(res, Number(error?.statusCode) || 502, { ok: false, error: 'Factory summary unavailable' });
        }
      }

      return json(res, 404, { error: 'Not found' });
    }
    if (method === 'GET' || method === 'HEAD') return await serveStatic(url.pathname, res);
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    return json(res, status, { error: status >= 500 ? 'Request failed' : (error.message || 'Invalid request') });
  }
});

server.listen(PORT, HOST, () => process.stdout.write(`Wavelink Live listening on http://${HOST}:${PORT}\n`));
