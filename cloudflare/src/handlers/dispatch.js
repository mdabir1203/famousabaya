/**
 * AbayaTrack — cloudflare/src/handlers/dispatch.js
 *
 * Cloudflare Worker routes for the material dispatch leaderboard.
 * Auth model:
 *   - Factory ↔ Worker calls: X-Bridge-Secret header
 *   - WhatsApp webhook: X-Hub-Signature-256 HMAC (or verify-token for handshake GET)
 *
 * Routes handled here (called from index.js):
 *   GET  /dispatch/invoices                   → list active invoices from D1
 *   PATCH /dispatch/invoices/:id/status       → update status (factory → cloud)
 *   GET  /dispatch/webhook/whatsapp           → Meta handshake
 *   POST /dispatch/webhook/whatsapp           → inbound supplier messages
 */

import { jsonRes, errRes } from '../http-response.js';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isBridgeAuthed(request, env) {
  const secret = String(env.DISPATCH_BRIDGE_SECRET || '').trim();
  if (!secret) return false;
  return (request.headers.get('X-Bridge-Secret') || '').trim() === secret;
}

// ─── D1 helpers ───────────────────────────────────────────────────────────────

function rowToInvoice(row) {
  let items = [];
  try { items = JSON.parse(row.items || '[]'); } catch (_) {}
  return {
    id: row.id,
    supplier: row.supplier,
    targetQueue: row.target_queue,
    status: row.status,
    slaDeadline: Number(row.sla_deadline),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    source: row.source || null,
    items,
    audioId: row.audio_id || null,
    notes: row.notes || null,
  };
}

async function getActiveInvoices(db) {
  const res = await db
    .prepare(`SELECT * FROM dispatch_invoices WHERE status != 'DELIVERED' ORDER BY sla_deadline ASC`)
    .all();
  return (res.results || []).map(rowToInvoice);
}

async function getInvoiceById(db, id) {
  const res = await db
    .prepare(`SELECT * FROM dispatch_invoices WHERE id = ?`)
    .bind(id)
    .first();
  return res ? rowToInvoice(res) : null;
}

async function upsertInvoiceD1(db, inv) {
  const itemsJson = JSON.stringify(inv.items || []);
  await db
    .prepare(`
      INSERT INTO dispatch_invoices (id, supplier, target_queue, status, sla_deadline, created_at, updated_at, source, items, audio_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        supplier     = excluded.supplier,
        target_queue = excluded.target_queue,
        status       = excluded.status,
        sla_deadline = excluded.sla_deadline,
        updated_at   = excluded.updated_at,
        source       = excluded.source,
        items        = excluded.items,
        audio_id     = COALESCE(excluded.audio_id, dispatch_invoices.audio_id),
        notes        = COALESCE(excluded.notes, dispatch_invoices.notes)
    `)
    .bind(
      inv.id,
      inv.supplier,
      inv.targetQueue || '',
      inv.status || 'PENDING',
      inv.slaDeadline,
      inv.createdAt || Date.now(),
      inv.updatedAt || Date.now(),
      inv.source || null,
      itemsJson,
      inv.audioId || null,
      inv.notes || null
    )
    .run();
}

async function updateStatusD1(db, id, status) {
  await db
    .prepare(`UPDATE dispatch_invoices SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, Date.now(), id)
    .run();
}

// ─── Tunnel health probe ──────────────────────────────────────────────────────
// Called from src/index.js scheduled handler on the every-minute cron.
// Catches the silent-cloudflared-failure mode: the local cloudflared process
// is alive but the tunnel itself is broken — nobody notices until a missed
// delivery. The probe fetches /health (no auth required on the factory) and
// records one row per attempt. Lazily prunes >7 d of history in the same batch
// so the table stays bounded without a separate cleanup job.

export async function runTunnelProbe(env) {
  const tunnelUrl = String(env.FACTORY_TUNNEL_URL || '').trim();
  if (!tunnelUrl) return; // probe disabled until the tunnel is configured

  const ts = Date.now();
  let status = 'fail';
  let httpCode = null;
  let latencyMs = null;
  let error = null;

  try {
    const start = Date.now();
    const r = await fetch(`${tunnelUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    latencyMs = Date.now() - start;
    httpCode = r.status;
    if (r.ok) {
      // Defensive: tunnel could 200 with a non-AbaYa body (rare misconfig).
      const data = await r.json().catch(() => null);
      if (data && data.ok === true) status = 'ok';
      else error = 'health body not ok';
    } else {
      error = `http ${r.status}`;
    }
  } catch (e) {
    error = String((e && e.message) || e).slice(0, 200);
  }

  const cutoff = ts - 7 * 24 * 60 * 60 * 1000;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tunnel_probes (ts, status, http_code, latency_ms, error) VALUES (?, ?, ?, ?, ?)`
      ).bind(ts, status, httpCode, latencyMs, error),
      env.DB.prepare(`DELETE FROM tunnel_probes WHERE ts < ?`).bind(cutoff),
    ]);
  } catch (_) {
    // Probe must never throw out of the scheduled handler — silent on D1 errors.
  }
}

// ─── Factory sync-trigger ─────────────────────────────────────────────────────

async function notifyFactory(invoice, env) {
  const tunnelUrl = String(env.FACTORY_TUNNEL_URL || '').trim();
  const secret = String(env.DISPATCH_BRIDGE_SECRET || '').trim();
  if (!tunnelUrl || !secret) return;
  try {
    await fetch(`${tunnelUrl}/api/internal/sync-trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': secret },
      body: JSON.stringify(invoice),
    });
  } catch (_) {}
}

// ─── WhatsApp message parser ──────────────────────────────────────────────────

/**
 * Parse a supplier's WhatsApp text into a structured invoice.
 *
 * Expected format (flexible — blank lines ignored):
 *   INV-2026-94B
 *   Al-Mansoor Textiles
 *   1. Silk Premium Nida | Black | 2.5m
 *   2. Cotton Lawn Standard | White | 3m
 *   3. Chiffon Lightweight | Navy | 2m
 *   4. Crepe DeLuxe | Beige | 2.5m
 *   Queue: Q-AB-04
 *   SLA: 2026-05-25T16:00:00Z
 *
 * Returns null if the message cannot be parsed as an invoice.
 */
function parseWhatsAppInvoice(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // First line must start with INV-
  const idLine = lines[0];
  if (!idLine.startsWith('INV-') && !idLine.toUpperCase().startsWith('INV-')) return null;
  const id = idLine.split(/\s/)[0].toUpperCase();

  const supplier = lines[1];
  let targetQueue = '';
  let slaDeadline = Date.now() + 4 * 60 * 60 * 1000;

  const items = [];
  for (const line of lines.slice(2)) {
    // Numbered item: "1. Silk Nida | Black | 2.5m" or "1: ..."
    const itemMatch = line.match(/^([1-4])[.:]\s*(.+)/);
    if (itemMatch) {
      const pos = parseInt(itemMatch[1], 10);
      const parts = itemMatch[2].split(/\s*[|,]\s*/);
      items.push({
        pos,
        materialSpec: parts[0] || '',
        color: parts[1] || '',
        qty: parts[2] || '',
      });
      continue;
    }
    // Queue: Q-AB-04
    const qMatch = line.match(/^Queue:\s*(.+)/i);
    if (qMatch) { targetQueue = qMatch[1].trim(); continue; }
    // SLA: 2026-05-25T16:00:00Z
    const slaMatch = line.match(/^SLA:\s*(.+)/i);
    if (slaMatch) {
      const parsed = Date.parse(slaMatch[1].trim());
      if (!isNaN(parsed)) slaDeadline = parsed;
    }
  }

  if (items.length === 0) return null;
  return { id, supplier, targetQueue, items, slaDeadline };
}

function parseInboundWAMessages(body) {
  const results = [];
  try {
    for (const entry of (body?.entry ?? [])) {
      for (const change of (entry?.changes ?? [])) {
        for (const msg of (change?.value?.messages ?? [])) {
          const from = String(msg.from || '');
          if (msg.type === 'text') {
            results.push({ type: 'text', from, body: String(msg.text?.body || '') });
          } else if (msg.type === 'audio') {
            // Voice note from supplier — media ID used to stream audio on demand
            results.push({ type: 'audio', from, audioId: String(msg.audio?.id || '') });
          }
        }
      }
    }
  } catch (_) {}
  return results;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function handleDispatch(request, env, url) {
  const path = url.pathname;

  // ── GET /dispatch/invoices ─────────────────────────────────────────────────
  if (path === '/dispatch/invoices' && request.method === 'GET') {
    if (!isBridgeAuthed(request, env)) return errRes('unauthorized', 401);
    const invoices = await getActiveInvoices(env.DB);
    return jsonRes({ ok: true, invoices });
  }

  // ── GET /dispatch/tunnel-health ────────────────────────────────────────────
  // Returns the last N probe rows so the CEO dashboard can render a connectivity
  // banner. Bridge-secret-gated — same trust boundary as the rest of /dispatch.
  if (path === '/dispatch/tunnel-health' && request.method === 'GET') {
    if (!isBridgeAuthed(request, env)) return errRes('unauthorized', 401);
    const requested = parseInt(url.searchParams.get('limit') || '60', 10);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 60, 1), 500);
    let probes = [];
    try {
      const res = await env.DB
        .prepare(`SELECT ts, status, http_code AS httpCode, latency_ms AS latencyMs, error
                  FROM tunnel_probes ORDER BY ts DESC LIMIT ?`)
        .bind(limit).all();
      probes = res.results || [];
    } catch (_) {
      // Migration 0008 not applied yet → report empty history rather than 500.
    }
    return jsonRes({ ok: true, last: probes[0] || null, probes });
  }

  // ── PATCH /dispatch/invoices/:id/status ───────────────────────────────────
  const patchMatch = path.match(/^\/dispatch\/invoices\/([^/]+)\/status$/);
  if (patchMatch && request.method === 'PATCH') {
    if (!isBridgeAuthed(request, env)) return errRes('unauthorized', 401);
    const id = decodeURIComponent(patchMatch[1]);

    // Idempotency: if the factory retries with the same X-Idempotency-Key, return
    // the current state without re-applying or re-firing notifyFactory. Migration
    // 0007 creates the idempotency_keys table. Header is optional for backward compat
    // with pre-0007 factory builds — those simply skip the dedup path.
    const idemKey = (request.headers.get('X-Idempotency-Key') || '').trim();
    if (idemKey) {
      try {
        const dup = await env.DB
          .prepare(`SELECT 1 FROM idempotency_keys WHERE key = ? LIMIT 1`)
          .bind(idemKey).first();
        if (dup) {
          const current = await getInvoiceById(env.DB, id);
          return jsonRes({ ok: true, invoice: current, idempotent: true });
        }
      } catch (_) {
        // Migration 0007 not applied yet → skip dedup and proceed normally.
        // The status PATCH is naturally idempotent, so the worst case is a
        // duplicate notifyFactory — far better than 500-ing every update.
      }
    }

    let body;
    try { body = await request.json(); } catch { return errRes('bad json', 400); }
    const status = String(body.status || '');
    if (!['ARRIVED', 'DELIVERED'].includes(status)) return errRes('invalid status', 400);
    const inv = await getInvoiceById(env.DB, id);
    if (!inv) return errRes('not found', 404);
    await updateStatusD1(env.DB, id, status);

    // Record the key + lazily prune anything older than 24 h. Batched in one
    // round-trip; DELETE is cheap thanks to the idx_idempotency_keys_created_at index.
    if (idemKey) {
      try {
        const now = Date.now();
        const cutoff = now - 24 * 60 * 60 * 1000;
        await env.DB.batch([
          env.DB.prepare(`INSERT OR IGNORE INTO idempotency_keys (key, created_at) VALUES (?, ?)`).bind(idemKey, now),
          env.DB.prepare(`DELETE FROM idempotency_keys WHERE created_at < ?`).bind(cutoff),
        ]);
      } catch (_) {
        // idempotency_keys table missing → best-effort record, never fail the request.
      }
    }

    const updated = { ...inv, status, updatedAt: Date.now() };
    // Notify factory so leaderboard stays live even if worker is the authority
    notifyFactory(updated, env);
    return jsonRes({ ok: true, invoice: updated });
  }

  // ── GET /dispatch/webhook/whatsapp (Meta handshake) ───────────────────────
  if (path === '/dispatch/webhook/whatsapp' && request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = String(env.WHATSAPP_VERIFY_TOKEN || '').trim();
    if (!verifyToken) return errRes('WHATSAPP_VERIFY_TOKEN not set', 503);
    if (mode === 'subscribe' && token === verifyToken) {
      return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return errRes('Forbidden', 403);
  }

  // ── POST /dispatch/webhook/whatsapp (inbound supplier messages) ───────────
  if (path === '/dispatch/webhook/whatsapp' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return errRes('bad json', 400); }
    const messages = parseInboundWAMessages(body);

    // Pass 1: create invoices from text messages, track sender → invoice id
    const senderToInvoice = new Map(); // from → invoice (for audio association)
    let ingested = 0;
    for (const msg of messages) {
      if (msg.type !== 'text') continue;
      const parsed = parseWhatsAppInvoice(msg.body);
      if (!parsed) continue;
      const now = Date.now();
      const invoice = { ...parsed, status: 'PENDING', createdAt: now, updatedAt: now, source: 'whatsapp' };
      await upsertInvoiceD1(env.DB, invoice);
      senderToInvoice.set(msg.from, invoice);
      notifyFactory(invoice, env);
      ingested++;
    }

    // Pass 2: attach audio notes to matching invoice (same sender, same webhook payload
    // OR most recent PENDING invoice from that sender within 15 minutes)
    for (const msg of messages) {
      if (msg.type !== 'audio' || !msg.audioId) continue;
      let target = senderToInvoice.get(msg.from) || null;

      if (!target) {
        // Look up most recent PENDING/ARRIVED invoice from this sender in the last 15 min
        const cutoff = Date.now() - 15 * 60 * 1000;
        const res = await env.DB.prepare(
          `SELECT * FROM dispatch_invoices WHERE source = 'whatsapp' AND status IN ('PENDING','ARRIVED')
           AND created_at >= ? ORDER BY created_at DESC LIMIT 1`
        ).bind(cutoff).first();
        if (res) target = rowToInvoice(res);
      }

      if (target) {
        // Attach audio to the matched invoice
        const updated = { ...target, audioId: msg.audioId, updatedAt: Date.now() };
        await upsertInvoiceD1(env.DB, updated);
        notifyFactory(updated, env);
      } else {
        // No recent invoice — create a placeholder so the voice note isn't lost
        const now = Date.now();
        const placeholder = {
          id: 'AUDIO-' + now.toString(36).toUpperCase(),
          supplier: 'Voice Note',
          items: [],
          targetQueue: '',
          status: 'PENDING',
          slaDeadline: now + 4 * 60 * 60 * 1000,
          createdAt: now,
          updatedAt: now,
          source: 'whatsapp',
          audioId: msg.audioId,
        };
        await upsertInvoiceD1(env.DB, placeholder);
        notifyFactory(placeholder, env);
        ingested++;
      }
    }

    return jsonRes({ ok: true, ingested });
  }

  return errRes('not found', 404);
}
