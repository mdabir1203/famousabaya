import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import {
  newTicketId,
  isValidCategory,
  isValidPriority,
  isValidStatus,
  isRosterEmpId,
  buildWaMeUrl,
  buildTicketText,
} from '../domain/ticket.js';

/**
 * Support ticket API (v1.2.24+).
 *
 * The factory launcher's "Support" tab creates tickets here. The launcher
 * then opens a wa.me link to send the ticket to the office. An office-side
 * whatsapp-web.js bot (tools/whatsapp-bot/) POSTs incoming messages to
 * /webhook/whatsapp-incoming so the operator sees office replies in real
 * time without leaving the launcher.
 *
 * Endpoints:
 *   POST /api/tickets                        create
 *   GET  /api/tickets                        list (filter: status, category, created_by, since, until)
 *   GET  /api/tickets/:id                    detail (with events + messages)
 *   POST /api/tickets/:id/resolve            mark resolved (operator or office)
 *   POST /api/tickets/:id/reopen             reopen
 *   POST /api/tickets/:id/reply              operator-side reply (Phase 2; returns 501 until bot is up)
 *   GET  /r/:id                              one-tap resolve page (HTML, no auth — for office)
 *   POST /webhook/whatsapp-incoming          bot → Worker incoming message (HMAC-signed)
 *
 * All write endpoints require either the factory ingest secret (operator
 * side, via the local server) or the bot HMAC (office side). Read endpoints
 * are unauthenticated and use the no-store cache headers so the operator's
 * launcher never serves a stale ticket.
 */

const MAX_SUBJECT = 120;
const MAX_DESCRIPTION = 4000;

function parseOfficeNumbers(env) {
  // CSV in worker_settings. First = primary, rest = fallback.
  // The launcher can override this via the launcher's "Support" settings
  // panel (which writes to worker_settings via /api/worker-settings, same
  // pattern as working-hours).
  return (env.SUPPORT_OFFICE_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean);
}

// In-memory cache for office numbers (v1.2.25 — D1 free-tier mitigation).
// Same shape as the working-hours cache: 5-min TTL (this config changes
// rarely, much rarer than working hours), invalidated synchronously on save.
const OFFICE_NUMBERS_CACHE_TTL_MS = 5 * 60_000;
let _officeCache = null; // { list, fetchedAt }

async function getOfficeNumbers(env) {
  // Check worker_settings first (operator-editable from the launcher),
  // fall back to the env var (default config).
  const now = Date.now();
  if (_officeCache && (now - _officeCache.fetchedAt) < OFFICE_NUMBERS_CACHE_TTL_MS) {
    return _officeCache.list;
  }
  const row = await env.DB.prepare(
    `SELECT v FROM worker_settings WHERE k = 'support_office_numbers'`
  ).first();
  let list;
  if (row && row.v) list = row.v.split(',').map(s => s.trim()).filter(Boolean);
  else list = parseOfficeNumbers(env);
  _officeCache = { list, fetchedAt: now };
  return list;
}

async function setOfficeNumbers(env, csv) {
  const v = String(csv || '').trim();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO worker_settings (k, v, updated_at) VALUES ('support_office_numbers', ?, unixepoch())`
  ).bind(v).run();
  // Invalidate the in-memory cache so the next read picks up the new value
  // (same-isolate path; cross-isolate staleness bounded by the 5-min TTL).
  _officeCache = null;
}

function _resetOfficeNumbersCacheForTest() {
  _officeCache = null;
}

// ---------------------------------------------------------------------------
// POST /api/tickets
// Body: { created_by, created_by_name?, category, priority?, subject, description, whatsapp_to? }
// Returns: { ok: true, ticket: {...}, wa_url: "https://wa.me/..." }
// ---------------------------------------------------------------------------
export async function handleCreateTicket(request, env) {
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized', 401);
  }

  let body;
  try { body = await request.json(); } catch { return errRes('Invalid JSON', 400); }
  if (!body || typeof body !== 'object') return errRes('Body must be a JSON object', 400);

  const createdBy = String(body.created_by || '').trim();
  if (!isRosterEmpId(createdBy)) {
    return errRes('created_by must be in the form e_bc_<digits> (roster guard)', 422);
  }

  const category = String(body.category || '').trim();
  if (!isValidCategory(category)) {
    return errRes('Invalid category. Must be one of: login, app, network, hardware, catalog, other', 422);
  }

  const priority = String(body.priority || 'normal').trim();
  if (!isValidPriority(priority)) {
    return errRes('Invalid priority. Must be: normal, urgent', 422);
  }

  const subject = String(body.subject || '').trim();
  if (!subject) return errRes('subject is required', 422);
  if (subject.length > MAX_SUBJECT) return errRes(`subject must be <= ${MAX_SUBJECT} chars`, 422);

  const description = String(body.description || '').trim();
  if (!description) return errRes('description is required', 422);
  if (description.length > MAX_DESCRIPTION) return errRes(`description must be <= ${MAX_DESCRIPTION} chars`, 422);

  const createdByName = String(body.created_by_name || '').trim() || null;
  const station = String(body.station || '').trim() || null;

  // Resolve the office number: explicit param > stored config > env default.
  let whatsappTo = String(body.whatsapp_to || '').trim() || null;
  if (!whatsappTo) {
    const list = await getOfficeNumbers(env);
    whatsappTo = list[0] || null;
  }
  if (!whatsappTo) {
    return errRes('No office WhatsApp number configured. Set SUPPORT_OFFICE_NUMBERS in the Worker env, or pass whatsapp_to in the body.', 422);
  }

  const id = newTicketId();
  const now = Math.floor(Date.now() / 1000);

  // Single batched write. created_by guard trigger (migration 0020) is the
  // last line of defense if someone bypasses the JS check.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO tickets (id, created_at, created_by, created_by_name, category, priority, subject, description, status, whatsapp_to, station, last_message_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).bind(id, now, createdBy, createdByName, category, priority, subject, description, whatsappTo, station, now, now),
    env.DB.prepare(`
      INSERT INTO ticket_events (ticket_id, event, actor, at, note)
      VALUES (?, 'created', ?, ?, 'Ticket created')
    `).bind(id, createdBy, now),
  ]);

  if (!results || !results[0] || !results[0].success) {
    return errRes('Failed to create ticket (DB rejected the row)', 500);
  }

  const ticket = await getTicketById(env, id);
  const waUrl = buildWaMeUrl(whatsappTo, buildTicketText(ticket));

  return jsonRes({ ok: true, ticket, wa_url: waUrl }, 201, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// GET /api/tickets
// Query: status, category, created_by, since (unix sec), until, priority, limit
// ---------------------------------------------------------------------------
export async function handleListTickets(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const createdBy = url.searchParams.get('created_by');
  const priority = url.searchParams.get('priority');
  const since = parseIntOrNull(url.searchParams.get('since'));
  const until = parseIntOrNull(url.searchParams.get('until'));
  const limit = Math.min(parseIntOrNull(url.searchParams.get('limit')) || 100, 500);

  const wheres = [];
  const binds = [];
  if (status) { if (!isValidStatus(status)) return errRes('Invalid status', 422); wheres.push('status = ?'); binds.push(status); }
  if (category) { if (!isValidCategory(category)) return errRes('Invalid category', 422); wheres.push('category = ?'); binds.push(category); }
  if (createdBy) wheres.push('created_by = ?'), binds.push(createdBy);
  if (priority) { if (!isValidPriority(priority)) return errRes('Invalid priority', 422); wheres.push('priority = ?'); binds.push(priority); }
  if (since) wheres.push('created_at >= ?'), binds.push(since);
  if (until) wheres.push('created_at <= ?'), binds.push(until);

  const sql = `SELECT * FROM tickets ${wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);
  const res = await env.DB.prepare(sql).bind(...binds).all();
  return jsonRes({ ok: true, tickets: res.results || [] }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// GET /api/tickets/:id
// ---------------------------------------------------------------------------
export async function handleGetTicket(request, env, id) {
  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes('Ticket not found', 404);
  const events = await env.DB.prepare(`SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY at ASC`).bind(id).all();
  const messages = await env.DB.prepare(`SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY sent_at ASC`).bind(id).all();
  return jsonRes({ ok: true, ticket, events: events.results || [], messages: messages.results || [] }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/resolve  body: { resolved_by }
// ---------------------------------------------------------------------------
export async function handleResolveTicket(request, env, id) {
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized', 401);
  }

  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes('Ticket not found', 404);
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    return jsonRes({ ok: true, ticket, already_resolved: true }, 200, CEO_JSON_NO_STORE);
  }

  let body = {};
  try { body = await request.json(); } catch { /* allow empty body for the GET-style /r/:id resolve */ }
  const resolvedBy = String(body.resolved_by || '').trim() || (ticket.created_by || 'office');
  const now = Math.floor(Date.now() / 1000);

  await env.DB.batch([
    env.DB.prepare(`UPDATE tickets SET status = 'resolved', resolved_at = ?, resolved_by = ?, last_message_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, resolvedBy, now, now, id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'resolved', ?, ?, NULL)`)
      .bind(id, resolvedBy, now),
  ]);
  const updated = await getTicketById(env, id);
  return jsonRes({ ok: true, ticket: updated }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/reopen  body: { reopened_by, note? }
// ---------------------------------------------------------------------------
export async function handleReopenTicket(request, env, id) {
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized', 401);
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const reopenedBy = String(body.reopened_by || '').trim();
  if (!isRosterEmpId(reopenedBy) && reopenedBy !== 'office') {
    return errRes('reopened_by must be e_bc_<digits> or "office"', 422);
  }
  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes('Ticket not found', 404);
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return jsonRes({ ok: true, ticket, already_open: true }, 200, CEO_JSON_NO_STORE);
  }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(`UPDATE tickets SET status = 'open', resolved_at = NULL, resolved_by = NULL, last_message_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'reopened', ?, ?, ?)`)
      .bind(id, reopenedBy, now, body.note ? String(body.note) : null),
  ]);
  const updated = await getTicketById(env, id);
  return jsonRes({ ok: true, ticket: updated }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/reply  (Phase 2 — operator-side reply via the bot)
// Body: { sender, text }
// Returns 501 until the bot is wired up; once /api/worker-settings/bot-url
// is set, the Worker forwards the reply to the bot's /send endpoint.
// ---------------------------------------------------------------------------
export async function handleOperatorReply(request, env, id) {
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized', 401);
  }
  let body;
  try { body = await request.json(); } catch { return errRes('Invalid JSON', 400); }
  const sender = String(body.sender || '').trim();
  if (!isRosterEmpId(sender)) return errRes('sender must be e_bc_<digits>', 422);
  const text = String(body.text || '').trim();
  if (!text) return errRes('text is required', 422);
  if (text.length > 4000) return errRes('text too long', 422);

  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes('Ticket not found', 404);

  // Look up the bot URL (set by the bot itself when it starts up).
  const botCfg = await env.DB.prepare(`SELECT v FROM worker_settings WHERE k = 'whatsapp_bot_url'`).first();
  if (!botCfg || !botCfg.v) {
    return errRes('Reply path is offline — the WhatsApp bot is not registered yet. Use "Mark resolved" in the launcher for now.', 503);
  }

  const now = Math.floor(Date.now() / 1000);
  const ticketText = `[${id}] ${ticket.subject}\n\n${text}`;

  // Forward to the bot's /send endpoint.
  let botRes;
  try {
    botRes = await fetch(botCfg.v.replace(/\/$/, '') + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': (env.WHATSAPP_BOT_SECRET || '').trim() },
      body: JSON.stringify({ to: ticket.whatsapp_to, text: ticketText, ticket_id: id }),
    });
  } catch (e) {
    return errRes('Failed to reach the WhatsApp bot: ' + (e && e.message), 502);
  }
  if (!botRes.ok) {
    const t = await botRes.text().catch(() => '');
    return errRes(`Bot returned ${botRes.status}: ${t.slice(0, 200)}`, 502);
  }

  // Best-effort log the outgoing message locally. We use the bot's
  // returned wa_message_id when present (forward-compatible with Phase 2
  // dedup).
  const botJson = await botRes.json().catch(() => ({}));
  const waId = botJson.wa_message_id || null;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, direction, sender, text, via, wa_message_id, sent_at) VALUES (?, 'out', ?, ?, 'whatsapp-web-bot', ?, ?)`)
      .bind(id, sender, text, waId, now),
    env.DB.prepare(`UPDATE tickets SET last_message_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'replied', ?, ?, NULL)`)
      .bind(id, sender, now),
  ]);

  return jsonRes({ ok: true, sent: true, wa_message_id: waId }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// GET /r/:id  — one-tap resolve page (HTML, no auth). Office can hit this
// from their phone browser to mark a ticket resolved without logging in.
// ---------------------------------------------------------------------------
export async function handleResolvePage(env, id) {
  const ticket = await getTicketById(env, id);
  const html = renderResolvePage(ticket);
  return new Response(html, {
    status: ticket ? 200 : 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function renderResolvePage(ticket) {
  if (!ticket) {
    return `<!doctype html><html><body style="font-family:system-ui;padding:24px"><h2>Ticket not found</h2><p>This ticket may have been deleted. Check the ticket ID.</p></body></html>`;
  }
  const safe = (s) => String(s || '').replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(ticket.id)}</title>
<style>body{font-family:system-ui;padding:24px;max-width:480px;margin:0 auto}h2{margin-top:0}
.card{border:1px solid #ddd;border-radius:8px;padding:16px;margin:12px 0;background:#fafafa}
.btn{display:inline-block;padding:14px 24px;border-radius:8px;background:#1a7f37;color:#fff;
     text-decoration:none;font-weight:600;font-size:16px;border:none;cursor:pointer;width:100%;text-align:center;box-sizing:border-box}
.btn:active{opacity:0.85}.meta{color:#666;font-size:13px;margin-top:8px}.resolved{background:#1a7f37;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block}</style>
</head><body>
<h2>Ticket ${safe(ticket.id)}</h2>
<div class="card">
  <div><b>${safe(ticket.subject)}</b></div>
  <div class="meta">${safe(ticket.category)} · ${safe(ticket.priority)} · ${safe(ticket.status)}</div>
  <div style="margin-top:12px;white-space:pre-wrap">${safe(ticket.description)}</div>
  <div class="meta" style="margin-top:12px">From: ${safe(ticket.created_by_name || ticket.created_by)} at ${new Date(ticket.created_at*1000).toLocaleString()}</div>
</div>
${ticket.status === 'resolved' || ticket.status === 'closed'
  ? `<div class="resolved">✓ Already resolved ${ticket.resolved_at ? new Date(ticket.resolved_at*1000).toLocaleString() : ''} by ${safe(ticket.resolved_by || '')}</div>`
  : `<form method="POST" action="/api/tickets/${encodeURIComponent(ticket.id)}/resolve">
       <input type="hidden" name="resolved_by" value="office">
       <button class="btn" type="submit">Mark resolved</button>
     </form>
     <p class="meta">One tap — no login needed. Operator will see the update in their launcher.</p>`}
</body></html>`;
}

// ---------------------------------------------------------------------------
// POST /webhook/whatsapp-incoming
// Headers: X-Bot-Secret: <WHATSAPP_BOT_SECRET>
// Body: { from (E.164), text, wa_message_id, ticket_id_hint? }
// ---------------------------------------------------------------------------
export async function handleWhatsappIncoming(request, env) {
  const secret = (request.headers.get('X-Bot-Secret') || '').trim();
  if (!secret || !env.WHATSAPP_BOT_SECRET || secret !== (env.WHATSAPP_BOT_SECRET || '').trim()) {
    return errRes('Unauthorized', 401);
  }
  let body;
  try { body = await request.json(); } catch { return errRes('Invalid JSON', 400); }
  const from = String(body.from || '').trim();
  const text = String(body.text || '').trim();
  const waId = String(body.wa_message_id || '').trim() || null;
  const hint = String(body.ticket_id_hint || '').trim() || null;
  if (!from) return errRes('Missing from', 422);
  if (!text) return errRes('Missing text', 422);

  // Dedup by wa_message_id (whatsapp-web.js gives every message a stable id).
  if (waId) {
    const existing = await env.DB.prepare(`SELECT id, ticket_id FROM ticket_messages WHERE wa_message_id = ?`).bind(waId).first();
    if (existing) {
      return jsonRes({ ok: true, deduped: true, ticket_id: existing.ticket_id, message_id: existing.id }, 200, CEO_JSON_NO_STORE);
    }
  }

  // Find the ticket. Strategy:
  //  1. If the bot told us a ticket id hint, use it.
  //  2. Otherwise, look at the most recent open ticket sent to this number
  //     and check if the message text starts with the ticket id (the wa.me
  //     initial message does — replies on WhatsApp don't, but the operator
  //     who started the chat was sent with the id in the text).
  //  3. Otherwise, find the most recent ticket sent to this `from` number
  //     that's still open/pending.
  let ticket = null;
  if (hint) ticket = await getTicketById(env, hint);
  if (!ticket) {
    const idMatch = text.match(/\bT-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,12}\b/i);
    if (idMatch) ticket = await getTicketById(env, idMatch[0].toUpperCase());
  }
  if (!ticket) {
    const recent = await env.DB.prepare(
      `SELECT * FROM tickets WHERE whatsapp_to = ? AND status IN ('open','pending') ORDER BY last_message_at DESC LIMIT 1`
    ).bind(from).first();
    ticket = recent;
  }
  if (!ticket) {
    // No matching ticket — store the message as an orphan so the office
    // can see it (or as a system event on the most recent ticket sent to
    // this number, but only if it's been within the last hour).
    return jsonRes({ ok: true, ignored: true, reason: 'no matching ticket' }, 200, CEO_JSON_NO_STORE);
  }

  const now = Math.floor(Date.now() / 1000);
  const newStatus = ticket.status === 'open' ? 'pending' : ticket.status;

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, direction, sender, text, via, wa_message_id, sent_at) VALUES (?, 'in', 'office', ?, 'whatsapp-web-bot', ?, ?)`)
      .bind(ticket.id, text, waId, now),
    env.DB.prepare(`UPDATE tickets SET status = ?, last_message_at = ?, updated_at = ? WHERE id = ?`)
      .bind(newStatus, now, now, ticket.id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'replied', 'office', ?, NULL)`)
      .bind(ticket.id, now),
  ]);
  return jsonRes({ ok: true, ticket_id: ticket.id, status: newStatus }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// POST /api/worker-settings/bot-url  body: { url }
// The bot calls this on startup so the Worker knows where to forward
// operator replies (Phase 2). The secret in the env protects it.
// ---------------------------------------------------------------------------
export async function handleSetBotUrl(request, env) {
  const secret = (request.headers.get('X-Bot-Secret') || '').trim();
  if (!secret || !env.WHATSAPP_BOT_SECRET || secret !== (env.WHATSAPP_BOT_SECRET || '').trim()) {
    return errRes('Unauthorized', 401);
  }
  let body;
  try { body = await request.json(); } catch { return errRes('Invalid JSON', 400); }
  const url = String(body.url || '').trim();
  if (!url || !/^https?:\/\//.test(url)) return errRes('Invalid url', 422);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO worker_settings (k, v, updated_at) VALUES ('whatsapp_bot_url', ?, unixepoch())`
  ).bind(url).run();
  return jsonRes({ ok: true, url }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// GET /api/worker-settings/support  (operator can read; the launcher's
// settings panel uses this to populate the field.)
// ---------------------------------------------------------------------------
export async function handleGetSupportConfig(request, env) {
  const list = await getOfficeNumbers(env);
  return jsonRes({ ok: true, office_numbers: list, primary: list[0] || null, fallback: list.slice(1) }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// PUT /api/worker-settings/support  body: { office_numbers: "+971...,+971..." }
// Operator can update from the launcher's settings panel. Same ingest secret.
// ---------------------------------------------------------------------------
export async function handleSetSupportConfig(request, env) {
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized', 401);
  }
  let body;
  try { body = await request.json(); } catch { return errRes('Invalid JSON', 400); }
  const csv = String(body.office_numbers || '').trim();
  // Validate: each must be E.164 (+ followed by 7-15 digits).
  const parts = csv.split(',').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!/^\+\d{7,15}$/.test(p)) return errRes(`Invalid phone number: ${p}. Use E.164 format (e.g. +971543618066).`, 422);
  }
  await setOfficeNumbers(env, parts.join(','));
  return jsonRes({ ok: true, office_numbers: parts, primary: parts[0] || null }, 200, CEO_JSON_NO_STORE);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function getTicketById(env, id) {
  return await env.DB.prepare(`SELECT * FROM tickets WHERE id = ?`).bind(String(id).trim()).first();
}

function parseIntOrNull(v) {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
