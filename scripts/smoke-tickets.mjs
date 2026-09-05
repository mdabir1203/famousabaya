#!/usr/bin/env node
/**
 * Pre-deploy smoke test for the support-ticket feature (v1.2.24).
 *
 * Why this exists: the Worker handler in cloudflare/src/handlers/tickets.js
 * can compile fine, ship to the edge, and still 500 on the first request
 * if a route exemption is missing, a column name is misspelled, or the
 * schema-mirroring drifted. This script exercises the live API the way
 * the launcher does, and exits non-zero on any failure so CI / a manual
 * `yarn smoke:tickets` blocks bad deploys.
 *
 * Usage:
 *   # Against the deployed production Worker:
 *   node scripts/smoke-tickets.mjs --base https://dashboard.farewellabaya.com
 *
 *   # Against a local wrangler dev process:
 *   #   (in another shell) cd cloudflare && npx wrangler dev --port 8788
 *   node scripts/smoke-tickets.mjs --base http://127.0.0.1:8788
 *
 *   # With a custom ingest secret (defaults to abaya2026):
 *   node scripts/smoke-tickets.mjs --base <url> --secret <value>
 *
 * What it checks (each step is independent — a failure in step N does
 * NOT skip step N+1, it just reports both):
 *   1. /api/health               — basic Worker liveness
 *   2. POST /api/tickets         — create a ticket (happy path)
 *   3. GET  /api/tickets         — list returns the new ticket
 *   4. GET  /api/tickets/:id     — detail with empty events/messages
 *   5. POST /api/tickets/:id/resolve — mark resolved
 *   6. GET  /r/:id               — magic-link resolve page returns HTML
 *   7. POST /api/tickets (no auth) — must return 401
 *   8. POST /api/tickets (bad category) — must return 422
 *   9. POST /api/tickets (synthetic emp_id) — must return 422
 */

import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    base:    { type: 'string', default: 'https://dashboard.farewellabaya.com' },
    secret:  { type: 'string', default: 'abaya2026' },
    timeout: { type: 'string', default: '15000' },
  },
});
const BASE = args.values.base.replace(/\/+$/, '');
const SECRET = args.values.secret;
const TIMEOUT_MS = parseInt(args.values.timeout, 10);

let passed = 0;
let failed = 0;
const results = [];

function logPass(name) { console.log(`  ✓ ${name}`); passed++; results.push({ name, ok: true }); }
function logFail(name, msg) { console.error(`  ✗ ${name}\n    ${msg}`); failed++; results.push({ name, ok: false, msg }); }

async function req(path, opts) {
  const r = await fetch(BASE + path, {
    ...opts,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', ...(opts && opts.headers || {}) },
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { ok: false, error: text }; }
  return { status: r.status, body, rawText: text };
}

async function step(name, fn) {
  try { await fn(); } catch (e) { logFail(name, e.message); }
}

console.log(`\nAbaYa Track — Support-ticket smoke test`);
console.log(`  base:    ${BASE}`);
console.log(`  timeout: ${TIMEOUT_MS}ms\n`);

await step('1. /api/health returns ok', async () => {
  const r = await req('/api/health');
  if (r.status !== 200) throw new Error(`status=${r.status} body=${JSON.stringify(r.body)}`);
  if (!r.body.ok) throw new Error(`body.ok not true: ${JSON.stringify(r.body)}`);
  logPass('/api/health');
});

const ticketIdHolder = { id: null };

await step('2. POST /api/tickets creates a ticket (happy path)', async () => {
  const payload = {
    created_by: 'e_bc_00000129',
    created_by_name: 'Smoke Test',
    category: 'app', priority: 'normal',
    subject: 'smoke test from scripts/smoke-tickets.mjs',
    description: 'If you see this ticket in the dashboard, the smoke test passed.',
  };
  const r = await req('/api/tickets', { method: 'POST', body: JSON.stringify(payload), headers: { 'X-Ingest-Secret': SECRET } });
  if (r.status !== 201) throw new Error(`expected 201, got ${r.status} — ${JSON.stringify(r.body)}`);
  if (!r.body.ok) throw new Error(`body.ok not true: ${JSON.stringify(r.body)}`);
  if (!r.body.ticket || !r.body.ticket.id) throw new Error('ticket.id missing from response');
  if (!r.body.wa_url || !r.body.wa_url.startsWith('https://wa.me/')) {
    throw new Error(`wa_url missing or wrong shape: ${r.body.wa_url}`);
  }
  if (!/^T-\d{4}-\d{2}-\d{2}-[0-9a-z]{4}$/.test(r.body.ticket.id)) {
    throw new Error(`ticket id has wrong format: ${r.body.ticket.id}`);
  }
  ticketIdHolder.id = r.body.ticket.id;
  logPass(`POST /api/tickets → ${ticketIdHolder.id}`);
});

await step('3. GET /api/tickets?limit=10 returns the new ticket', async () => {
  if (!ticketIdHolder.id) throw new Error('skipped — step 2 did not produce a ticket id');
  const r = await req('/api/tickets?limit=10');
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  if (!Array.isArray(r.body.tickets)) throw new Error('body.tickets not an array');
  const found = r.body.tickets.find(t => t.id === ticketIdHolder.id);
  if (!found) throw new Error(`new ticket ${ticketIdHolder.id} not in list of ${r.body.tickets.length}`);
  logPass(`GET /api/tickets (found ${r.body.tickets.length} tickets)`);
});

await step('4. GET /api/tickets/:id returns detail with events + messages arrays', async () => {
  if (!ticketIdHolder.id) throw new Error('skipped');
  const r = await req(`/api/tickets/${ticketIdHolder.id}`);
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  if (!r.body.ticket || r.body.ticket.id !== ticketIdHolder.id) throw new Error('ticket mismatch');
  if (!Array.isArray(r.body.events)) throw new Error('events not an array');
  if (!Array.isArray(r.body.messages)) throw new Error('messages not an array');
  // The ticket was just created, so it should have at least one 'created' event.
  if (!r.body.events.find(e => e.event === 'created')) {
    throw new Error('expected a "created" event in the timeline');
  }
  logPass(`GET /api/tickets/:id (events=${r.body.events.length}, messages=${r.body.messages.length})`);
});

await step('5. POST /api/tickets/:id/resolve marks the ticket resolved', async () => {
  if (!ticketIdHolder.id) throw new Error('skipped');
  const r = await req(`/api/tickets/${ticketIdHolder.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolved_by: 'office' }),
    headers: { 'X-Ingest-Secret': SECRET },
  });
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  if (r.body.ticket.status !== 'resolved') throw new Error(`status not resolved: ${r.body.ticket.status}`);
  if (!r.body.ticket.resolved_at) throw new Error('resolved_at not set');
  logPass('POST /api/tickets/:id/resolve');
});

await step('6. GET /r/:id returns a one-tap resolve page (HTML, 200)', async () => {
  if (!ticketIdHolder.id) throw new Error('skipped');
  const r = await fetch(BASE + '/r/' + ticketIdHolder.id, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const text = await r.text();
  if (!/Ticket/.test(text)) throw new Error('response does not look like the resolve page');
  if (!/Mark resolved|Already resolved/.test(text)) throw new Error('resolve page missing the action button');
  logPass('GET /r/:id (HTML page)');
});

await step('7. POST /api/tickets without auth is rejected (401)', async () => {
  const r = await req('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ created_by: 'e_bc_1', category: 'app', subject: 'x', description: 'y' }),
  });
  if (r.status !== 401) throw new Error(`expected 401, got ${r.status} — ${JSON.stringify(r.body)}`);
  logPass('unauth POST /api/tickets → 401');
});

await step('8. POST /api/tickets with an unknown category is rejected (422)', async () => {
  const r = await req('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ created_by: 'e_bc_1', category: 'unknown', subject: 'x', description: 'y' }),
    headers: { 'X-Ingest-Secret': SECRET },
  });
  if (r.status !== 422) throw new Error(`expected 422, got ${r.status} — ${JSON.stringify(r.body)}`);
  logPass('bad-category POST /api/tickets → 422');
});

await step('9. POST /api/tickets with a synthetic emp_id is rejected (422)', async () => {
  const r = await req('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ created_by: 'e1', category: 'app', subject: 'x', description: 'y' }),
    headers: { 'X-Ingest-Secret': SECRET },
  });
  if (r.status !== 422) throw new Error(`expected 422, got ${r.status} — ${JSON.stringify(r.body)}`);
  logPass('synthetic-emp_id POST /api/tickets → 422');
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nSmoke test FAILED. Do not deploy.');
  process.exit(1);
}
console.log('Smoke test PASSED. Safe to deploy.');
