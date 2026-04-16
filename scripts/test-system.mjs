#!/usr/bin/env node
/**
 * Smoke-test factory server (server.js) and optionally Cloudflare Worker.
 * Usage:
 *   1) Terminal A: yarn start   (or node server.js)
 *   2) Terminal B: node scripts/test-system.mjs
 *
 * Reads repo-root .env for CF_WORKER_URL + CF_INGEST_SECRET + CEO_TOKEN when present.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadDotEnv() {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotEnv();

const FACTORY = (process.env.TEST_FACTORY_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(
  /\/+$/,
  ''
);
const WORKER = (process.env.CF_WORKER_URL || process.env.TEST_WORKER_URL || '').replace(/\/+$/, '');
const INGEST = process.env.CF_INGEST_SECRET || '';
const CEO = process.env.CEO_TOKEN || '';

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  OK  ${name}`);
}
function bad(name, err) {
  failed += 1;
  console.error(`  FAIL ${name}:`, err?.message || err);
}

async function getJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text.slice(0, 200) };
  }
  return { status: r.status, data, headers: r.headers };
}

async function main() {
  console.log('\n=== AbaYa Track — system smoke tests ===\n');
  console.log(`Factory base: ${FACTORY}\n`);

  // ── Factory (Node server) ───────────────────────────────────────────────
  try {
    const { status, data } = await getJson(`${FACTORY}/api/client-config`);
    if (
      status === 200 &&
      data.ok &&
      data.catalogVersion != null &&
      data.serverStartedAt != null &&
      typeof data.ceoIngestPending === 'number'
    ) {
      ok('factory GET /api/client-config');
    } else bad('factory GET /api/client-config', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/client-config', e);
  }

  try {
    const { status, data } = await getJson(`${FACTORY}/api/ceo-ingest-status`);
    if (status === 200 && data.ok && typeof data.pending === 'number') {
      ok('factory GET /api/ceo-ingest-status');
    } else bad('factory GET /api/ceo-ingest-status', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/ceo-ingest-status', e);
  }

  try {
    const { status, data } = await getJson(`${FACTORY}/api/server-info`);
    if (status === 200 && data.ok) ok('factory GET /api/server-info');
    else bad('factory GET /api/server-info', new Error(`status ${status} ${JSON.stringify(data).slice(0, 120)}`));
  } catch (e) {
    bad('factory GET /api/server-info', e);
    console.error('\n  Is the factory server running? Try: yarn start\n');
  }

  try {
    const { status, data } = await getJson(`${FACTORY}/api/state`);
    if (status === 200 && data.ok && data.state) ok('factory GET /api/state');
    else bad('factory GET /api/state', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/state', e);
  }

  try {
    const { status, data } = await getJson(`${FACTORY}/api/employees`);
    if (status === 200 && data.ok && Array.isArray(data.employees)) {
      ok(`factory GET /api/employees (${data.employees.length} rows)`);
    } else bad('factory GET /api/employees', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/employees', e);
  }

  try {
    const { status, data } = await getJson(`${FACTORY}/api/catalog/abayas`);
    if (status === 200 && data.ok && Array.isArray(data.abayas)) {
      ok(`factory GET /api/catalog/abayas (${data.abayas.length} rows)`);
    } else bad('factory GET /api/catalog/abayas', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/catalog/abayas', e);
  }

  // ── Cloudflare Worker (optional) ─────────────────────────────────────────
  if (!WORKER) {
    console.log('\n  (skip) No CF_WORKER_URL in .env — Worker tests not run.\n');
  } else {
    console.log(`\nWorker base: ${WORKER}\n`);

    try {
      const { status, data, headers } = await getJson(`${WORKER}/api/catalog/abayas`);
      if (status === 200 && data.ok && Array.isArray(data.abayas)) {
        ok(`worker GET /api/catalog/abayas (${data.abayas.length} rows)`);
        const cc = headers.get('cache-control');
        if (cc && cc.includes('max-age')) ok(`worker catalog Cache-Control present (${cc.slice(0, 60)}…)`);
      } else bad('worker GET /api/catalog/abayas', new Error(`status ${status}`));
    } catch (e) {
      bad('worker GET /api/catalog/abayas', e);
    }

    try {
      const { status, data } = await getJson(`${WORKER}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': 'wrong' },
        body: JSON.stringify({ type: 'session_start', payload: {} }),
      });
      if (status === 401) ok('worker POST /api/event rejects bad secret (401)');
      else bad('worker ingest auth', new Error(`expected 401, got ${status} ${JSON.stringify(data).slice(0, 80)}`));
    } catch (e) {
      bad('worker POST /api/event (bad secret)', e);
    }

    if (INGEST) {
      try {
        const { status, data } = await getJson(`${WORKER}/api/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': INGEST },
          body: JSON.stringify({
            type: 'session_start',
            payload: {
              emp_id: 'test-smoke-emp',
              emp_name: 'Smoke Test',
              emp_code: 'EMP999',
              emp_process: 'Tailor (01)',
              emp_color: '#666',
              emp_initials: 'SM',
              abaya_id: 'ab-smoke',
              abaya_code: 'AB-SMOKE',
              station: 'S-99',
              started_at: Math.floor(Date.now() / 1000),
            },
          }),
        });
        if (status === 200 && data.ok) ok('worker POST /api/event session_start (smoke)');
        else bad('worker POST session_start', new Error(`status ${status} ${JSON.stringify(data).slice(0, 120)}`));

        const fin = Math.floor(Date.now() / 1000);
        const { status: st2, data: d2 } = await getJson(`${WORKER}/api/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': INGEST },
          body: JSON.stringify({
            type: 'session_finish',
            payload: {
              emp_id: 'test-smoke-emp',
              emp_name: 'Smoke Test',
              emp_code: 'EMP999',
              emp_process: 'Tailor (01)',
              emp_color: '#666',
              emp_initials: 'SM',
              abaya_id: 'ab-smoke',
              abaya_code: 'AB-SMOKE',
              station: 'S-99',
              started_at: fin - 120,
              ended_at: fin,
              duration_sec: 120,
            },
          }),
        });
        if (st2 === 200 && d2.ok) ok('worker POST /api/event session_finish (smoke)');
        else bad('worker POST session_finish', new Error(`status ${st2} ${JSON.stringify(d2).slice(0, 120)}`));
      } catch (e) {
        bad('worker ingest smoke', e);
      }
    } else {
      console.log('  (skip) No CF_INGEST_SECRET — ingest success path not tested.\n');
    }

    if (CEO) {
      const enc = encodeURIComponent(CEO);
      try {
        const { status, data } = await getJson(`${WORKER}/api/state?token=${enc}`);
        if (status === 200 && data.ok) ok('worker GET /api/state?token= (CEO)');
        else bad('worker GET /api/state', new Error(`status ${status}`));
      } catch (e) {
        bad('worker GET /api/state', e);
      }
    } else {
      console.log('  (skip) No CEO_TOKEN — CEO /api/state not tested.\n');
    }
  }

  console.log(`\n=== Done: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
