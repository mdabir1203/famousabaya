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
let skipped = 0;

function ok(name) {
  passed += 1;
  console.log(`  OK  ${name}`);
}
function bad(name, err) {
  failed += 1;
  console.error(`  FAIL ${name}:`, err?.message || err);
}
// `skip` is the cloud-degraded path. The factory's local server is the
// source of truth for the smoke gate; the cloud Worker is just an
// extra-check that the local server's events land. If the cloud returns
// 5xx / error 1101 (which dashboard.farewellabaya.com does intermittently
// in Sep 2026) the smoke test must NOT fail the release — it just
// reports the cloud call as skipped so the operator can see the cloud
// was unreachable. The local-only path still runs and verifies the
// factory server, which is what the gate actually needs to confirm.
function skip(name, reason) {
  skipped += 1;
  console.log(`  SKIP ${name}${reason ? ` — ${reason}` : ''}`);
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
      typeof data.ceoIngestPending === 'number' &&
      typeof data.offlineReportRestored === 'boolean' &&
      data.persistence &&
      typeof data.persistence.offlineReportDir === 'string' &&
      typeof data.persistence.offlineReportDirWritable === 'boolean'
    ) {
      ok('factory GET /api/client-config');
    } else bad('factory GET /api/client-config', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/client-config', e);
  }

  try {
    const { status, data } = await getJson(`${FACTORY}/api/ceo-ingest-status`);
    if (
      status === 200 &&
      data.ok &&
      typeof data.pending === 'number' &&
      typeof data.queueDirWritable === 'boolean' &&
      typeof data.offlineReportDirWritable === 'boolean'
    ) {
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
    if (
      status === 200 &&
      data.ok &&
      data.state &&
      data.state.state_meta &&
      typeof data.state.state_meta.logs_returned === 'number' &&
      typeof data.state.state_meta.restored_from_offline_cache === 'boolean'
    ) {
      ok('factory GET /api/state (bounded + state_meta)');
    } else bad('factory GET /api/state', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/state', e);
  }

  try {
    const { status, data } = await getJson(`${FACTORY}/api/state?since=1&limit=5`);
    if (
      status === 200 &&
      data.ok &&
      data.state &&
      Array.isArray(data.state.logs) &&
      data.state.logs.length <= 5
    ) {
      ok('factory GET /api/state?since=&limit=');
    } else bad('factory GET /api/state?since=&limit=', new Error(`status ${status}`));
  } catch (e) {
    bad('factory GET /api/state?since=&limit=', e);
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

  const EXPORT_SEC =
    process.env.FLOOR_EXPORT_SECRET || process.env.CATALOG_INGEST_SECRET || process.env.CF_INGEST_SECRET || '';
  try {
    const r = await fetch(`${FACTORY}/api/export/floor-sessions.json`, {
      headers: { Accept: 'application/json', 'X-Export-Secret': 'wrong' },
    });
    if (r.status === 401) ok('factory GET /api/export/floor-sessions.json rejects bad secret');
    else bad('factory export auth', new Error('expected 401, got ' + r.status));
  } catch (e) {
    bad('factory export auth', e);
  }
  if (EXPORT_SEC) {
    try {
      const { status, data } = await getJson(`${FACTORY}/api/export/floor-sessions.json?summary=1`, {
        headers: { 'X-Export-Secret': EXPORT_SEC },
      });
      if (
        status === 200 &&
        data.ok &&
        data.meta &&
        typeof data.meta.rowCount === 'number' &&
        Array.isArray(data.sessions) &&
        data.byYearMonth != null &&
        typeof data.byYearMonth === 'object'
      ) {
        ok('factory GET /api/export/floor-sessions.json (authenticated)');
      } else bad('factory export json', new Error(`status ${status} ${JSON.stringify(data).slice(0, 120)}`));
    } catch (e) {
      bad('factory export json', e);
    }
    try {
      const r = await fetch(`${FACTORY}/api/export/floor-sessions.csv`, {
        headers: { 'X-Export-Secret': EXPORT_SEC },
      });
      const text = await r.text();
      if (r.status === 200 && text.includes('emp_id') && text.includes('end_iso')) {
        ok('factory GET /api/export/floor-sessions.csv');
      } else bad('factory export csv', new Error('status ' + r.status));
    } catch (e) {
      bad('factory export csv', e);
    }
  } else {
    console.log('  (skip) Set FLOOR_EXPORT_SECRET or CATALOG_INGEST_SECRET to test export downloads.\n');
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
      } else if (status >= 500) {
        skip('worker GET /api/catalog/abayas', `cloud 5xx (status ${status}) — dashboard degraded`);
      } else bad('worker GET /api/catalog/abayas', new Error(`status ${status}`));
    } catch (e) {
      skip('worker GET /api/catalog/abayas', `cloud unreachable (${e?.message || e})`);
    }

    try {
      const { status, data } = await getJson(`${WORKER}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': 'wrong' },
        body: JSON.stringify({ type: 'session_start', payload: {} }),
      });
      if (status === 401) ok('worker POST /api/event rejects bad secret (401)');
      else if (status >= 500) skip('worker POST /api/event (bad secret)', `cloud 5xx (status ${status})`);
      else bad('worker ingest auth', new Error(`expected 401, got ${status} ${JSON.stringify(data).slice(0, 80)}`));
    } catch (e) {
      skip('worker POST /api/event (bad secret)', `cloud unreachable (${e?.message || e})`);
    }

    if (INGEST) {
      try {
        const { status, data } = await getJson(`${WORKER}/api/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': INGEST },
          body: JSON.stringify({
            type: 'session_start',
            payload: {
              // Use a real e_bc_<digits> format so the cloud's v1.2.15
              // roster guard (cloudflare/src/handlers/ingest.js:62)
              // accepts the payload. The cloud doesn't FK-check emp_id,
              // so a synthetic-but-form-valid id (e_bc_999998) is fine
              // for a smoke test. The id is high enough not to collide
              // with the real factory roster (which tops out at
              // ~e_bc_00000140 per the Aug 2026 snapshot).
              emp_id: 'e_bc_999998',
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
        else if (status >= 500) skip('worker POST session_start', `cloud 5xx (status ${status})`);
        else bad('worker POST session_start', new Error(`status ${status} ${JSON.stringify(data).slice(0, 120)}`));

        const fin = Math.floor(Date.now() / 1000);
        const { status: st2, data: d2 } = await getJson(`${WORKER}/api/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': INGEST },
          body: JSON.stringify({
            type: 'session_finish',
            payload: {
              emp_id: 'e_bc_999998',
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
        else if (st2 >= 500) skip('worker POST session_finish', `cloud 5xx (status ${st2})`);
        else bad('worker POST session_finish', new Error(`status ${st2} ${JSON.stringify(d2).slice(0, 120)}`));
      } catch (e) {
        skip('worker ingest smoke', `cloud unreachable (${e?.message || e})`);
      }
    } else {
      console.log('  (skip) No CF_INGEST_SECRET — ingest success path not tested.\n');
    }

    if (CEO) {
      const enc = encodeURIComponent(CEO);
      try {
        const { status, data } = await getJson(`${WORKER}/api/state?token=${enc}`);
        if (status === 200 && data.ok) ok('worker GET /api/state?token= (CEO)');
        else if (status >= 500) skip('worker GET /api/state?token=', `cloud 5xx (status ${status})`);
        else bad('worker GET /api/state', new Error(`status ${status}`));
      } catch (e) {
        skip('worker GET /api/state?token=', `cloud unreachable (${e?.message || e})`);
      }
    } else {
      console.log('  (skip) No CEO_TOKEN — CEO /api/state not tested.\n');
    }
  }

  console.log(`\n=== Done: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
