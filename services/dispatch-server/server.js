// AbayaTrack Dispatch Server — services/dispatch-server/server.js
// Node.js entry point. Run: node server.js  (from this directory)

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { networkInterfaces } from 'node:os';

import { upsertInvoice, updateInvoiceStatus, getLeaderboard, getInvoice } from './src/store.js';
import { parseInboundMessages, extractInvoiceFromText } from './src/whatsapp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.DISPATCH_PORT || '3001', 10);
const INGEST_SECRET = process.env.DISPATCH_INGEST_SECRET || '';
const WA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const CF_WORKER_URL = (process.env.CF_WORKER_URL || '').replace(/\/+$/, '');
const BRIDGE_SECRET = process.env.DISPATCH_BRIDGE_SECRET || '';
// Public URL reachable over the internet (cloudflared tunnel, e.g. https://factory.farewellabaya.com)
// Required when tablets connect over mobile SIM rather than LAN WiFi.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// ─── LAN IP detection ─────────────────────────────────────────────────────────
function getLocalIp() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ─── SSE Client Registry ───────────────────────────────────────────────────────
/** @type {Set<import('node:http').ServerResponse>} */
const _clients = new Set();

function broadcast(eventName, payload) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  const dead = [];
  for (const res of _clients) {
    try { res.write(msg); } catch (_) { dead.push(res); }
  }
  dead.forEach(r => _clients.delete(r));
}

function clientCount() { return _clients.size; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Secret',
};

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function checkSecret(req) {
  if (!INGEST_SECRET) return true;
  return (req.headers['x-ingest-secret'] || '') === INGEST_SECRET;
}

function checkBridgeSecret(req) {
  if (!BRIDGE_SECRET) return false;
  return (req.headers['x-bridge-secret'] || '') === BRIDGE_SECRET;
}

async function pushToCloud(id, status) {
  if (!CF_WORKER_URL || !BRIDGE_SECRET) return;
  try {
    await fetch(`${CF_WORKER_URL}/dispatch/invoices/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': BRIDGE_SECRET },
      body: JSON.stringify({ status }),
    });
  } catch (_) {}
}

async function syncFromCloud() {
  if (!CF_WORKER_URL || !BRIDGE_SECRET) return;
  try {
    const r = await fetch(`${CF_WORKER_URL}/dispatch/invoices`, {
      headers: { 'X-Bridge-Secret': BRIDGE_SECRET },
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!Array.isArray(data.invoices)) return;
    for (const inv of data.invoices) upsertInvoice(inv);
    if (data.invoices.length > 0) pushLeaderboard();
    console.log(`[dispatch] synced ${data.invoices.length} invoices from cloud`);
  } catch (e) {
    console.warn('[dispatch] cloud sync failed:', e.message);
  }
}

function pushLeaderboard() {
  broadcast('leaderboard-update', { leaderboard: getLeaderboard({ includeDelivered: true }), ts: Date.now() });
}

async function sendWhatsAppAlert(invoice) {
  if (!WA_TOKEN || !WA_PHONE_ID) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: process.env.WHATSAPP_RECIPIENT || '',
        type: 'text',
        text: {
          body: `✅ Material Delivered\n\nRef: ${invoice.id}\nSupplier: ${invoice.supplier}\nMaterial: ${invoice.materialSpec}\nQty: ${invoice.quantity}\nQueue: ${invoice.targetQueue || '—'}`,
        },
      }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

const leaderboardHtmlPath = join(__dirname, 'public', 'leaderboard.html');

// ─── HTTP Server ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // Health
  if (pathname === '/health' && req.method === 'GET') {
    return sendJson(res, { ok: true, clients: clientCount(), whatsapp: !!(WA_TOKEN && WA_PHONE_ID) });
  }

  // Server info — LAN IP for tablet setup, plus public tunnel URL if configured
  if (pathname === '/api/info' && req.method === 'GET') {
    const ip = getLocalIp();
    return sendJson(res, {
      ip,
      port: PORT,
      url: `http://${ip}:${PORT}`,
      // publicUrl is set when tablets connect over mobile SIM via cloudflared tunnel
      publicUrl: PUBLIC_URL || null,
    });
  }

  // Config — tells UI whether WhatsApp is wired
  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, { whatsappConfigured: !!(WA_TOKEN && WA_PHONE_ID) });
  }

  // List invoices (REST fallback)
  if (pathname === '/api/invoices' && req.method === 'GET') {
    return sendJson(res, getLeaderboard({ includeDelivered: true }));
  }

  // Manual invoice creation (UI form)
  if (pathname === '/api/invoices' && req.method === 'POST') {
    if (!checkSecret(req)) return sendJson(res, { error: 'unauthorized' }, 401);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, { error: 'bad json' }, 400); }
    try {
      const invoice = upsertInvoice({
        id: body.id || ('INV-' + Date.now().toString(36).toUpperCase()),
        supplier: body.supplier,
        items: Array.isArray(body.items) ? body.items : [],
        targetQueue: body.targetQueue || '',
        status: 'PENDING',
        slaDeadline: body.slaDeadline || (Date.now() + 4 * 60 * 60 * 1000),
        source: 'api',
        notes: body.notes || null,
      });
      pushLeaderboard();
      return sendJson(res, { ok: true, invoice }, 201);
    } catch (e) {
      return sendJson(res, { error: e.message }, 400);
    }
  }

  // Vision engine ingest — Zhipu or similar
  if (pathname === '/api/vision/ingest' && req.method === 'POST') {
    if (!checkSecret(req)) return sendJson(res, { error: 'unauthorized' }, 401);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, { error: 'bad json' }, 400); }
    const invoice = upsertInvoice({
      id: body.id || body.invoiceNumber || ('VIS-' + Date.now().toString(36).toUpperCase()),
      supplier: body.supplier || body.vendor || 'Vision Engine',
      items: Array.isArray(body.items) ? body.items : [],
      targetQueue: body.targetQueue || body.orderRef || '',
      status: 'PENDING',
      slaDeadline: body.slaDeadline || body.expectedAt || (Date.now() + 4 * 60 * 60 * 1000),
      source: 'vision',
      notes: body.notes || null,
    });
    pushLeaderboard();
    return sendJson(res, { ok: true, invoice }, 201);
  }

  // Inbound push from Cloudflare Worker
  if (pathname === '/api/internal/sync-trigger' && req.method === 'POST') {
    if (!checkBridgeSecret(req)) return sendJson(res, { error: 'unauthorized' }, 401);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, { error: 'bad json' }, 400); }
    try {
      const invoice = upsertInvoice({ ...body, source: body.source || 'cloud' });
      pushLeaderboard();
      return sendJson(res, { ok: true, invoice });
    } catch (e) {
      return sendJson(res, { error: e.message }, 400);
    }
  }

  // Double-confirmation Step 1: PENDING → ARRIVED
  const m1 = pathname.match(/^\/api\/delivery\/step1\/([^/]+)$/);
  if (m1 && req.method === 'POST') {
    const inv = getInvoice(m1[1]);
    if (!inv) return sendJson(res, { error: 'not found' }, 404);
    if (inv.status !== 'PENDING') return sendJson(res, { error: 'invalid state', current: inv.status }, 409);
    const updated = updateInvoiceStatus(m1[1], 'ARRIVED');
    pushLeaderboard();
    pushToCloud(m1[1], 'ARRIVED').catch(() => {});
    return sendJson(res, { ok: true, invoice: updated });
  }

  // Double-confirmation Step 2: ARRIVED → DELIVERED
  const m2 = pathname.match(/^\/api\/delivery\/step2\/([^/]+)$/);
  if (m2 && req.method === 'POST') {
    const inv = getInvoice(m2[1]);
    if (!inv) return sendJson(res, { error: 'not found' }, 404);
    if (inv.status !== 'ARRIVED') return sendJson(res, { error: 'invalid state', current: inv.status }, 409);
    const updated = updateInvoiceStatus(m2[1], 'DELIVERED');
    pushLeaderboard();
    pushToCloud(m2[1], 'DELIVERED').catch(() => {});
    sendWhatsAppAlert(updated).catch(() => {});
    return sendJson(res, { ok: true, invoice: updated, whatsappConfigured: !!(WA_TOKEN && WA_PHONE_ID) });
  }

  // WhatsApp webhook verification
  if (pathname === '/api/whatsapp/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  // WhatsApp inbound messages
  if (pathname === '/api/whatsapp/webhook' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, { error: 'bad json' }, 400); }
    const messages = parseInboundMessages(body);
    let ingested = 0;
    for (const msg of messages) {
      if (msg.type === 'text') {
        const parsed = extractInvoiceFromText(msg.body);
        if (parsed) {
          upsertInvoice({ ...parsed, status: 'PENDING', source: 'whatsapp' });
          ingested++;
        }
      }
    }
    if (ingested > 0) pushLeaderboard();
    return sendJson(res, { ok: true, ingested });
  }

  // Audio proxy — streams WA voice notes
  const audioMatch = pathname.match(/^\/api\/audio\/([^/]+)$/);
  if (audioMatch && req.method === 'GET') {
    const mediaId = audioMatch[1];
    if (!WA_TOKEN) return sendJson(res, { error: 'WhatsApp not configured — cannot serve audio' }, 503);
    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(mediaId)}`,
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
      if (!metaRes.ok) return sendJson(res, { error: 'media not found' }, 404);
      const { url: mediaUrl, mime_type } = await metaRes.json();
      const audioRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
      if (!audioRes.ok) return sendJson(res, { error: 'audio fetch failed' }, 502);
      res.writeHead(200, {
        'Content-Type': mime_type || 'audio/ogg',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      await pipeline(Readable.fromWeb(audioRes.body), res);
    } catch (e) {
      if (!res.headersSent) sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // SSE leaderboard stream
  if (pathname === '/api/leaderboard/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    _clients.add(res);
    req.on('close', () => _clients.delete(res));
    pushLeaderboard();
    return;
  }

  // PWA assets — manifest, service worker, icon
  if (pathname === '/manifest.json' && req.method === 'GET') {
    let data;
    try { data = readFileSync(join(__dirname, 'public', 'manifest.json')); } catch { data = '{}'; }
    res.writeHead(200, { 'Content-Type': 'application/manifest+json', ...CORS });
    res.end(data);
    return;
  }
  if (pathname === '/sw.js' && req.method === 'GET') {
    let data;
    try { data = readFileSync(join(__dirname, 'public', 'sw.js')); } catch { data = ''; }
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache',
      ...CORS,
    });
    res.end(data);
    return;
  }
  if (pathname === '/icon.svg' && req.method === 'GET') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#1f1633"/><rect width="512" height="512" rx="80" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a5fc1"/><stop offset="1" stop-color="#422082"/></linearGradient></defs><text y="360" x="76" font-size="320" font-family="serif">🧵</text></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    res.end(svg);
    return;
  }

  // Serve leaderboard HTML
  if (pathname === '/' || pathname === '/leaderboard' || pathname === '/leaderboard.html') {
    let html;
    try { html = readFileSync(leaderboardHtmlPath); } catch (_) { html = '<html><body>leaderboard.html not found</body></html>'; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
    res.end(html);
    return;
  }

  sendJson(res, { error: 'not found' }, 404);
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  const lanUrl    = `http://${ip}:${PORT}`;
  const publicMsg = PUBLIC_URL ? `  public: ${PUBLIC_URL}` : '  public: NOT SET (tablets need same WiFi)';
  console.log(`[dispatch] :${PORT}  LAN: ${lanUrl}${publicMsg}  whatsapp:${WA_TOKEN ? 'configured' : 'not set'}`);
  syncFromCloud();
});
