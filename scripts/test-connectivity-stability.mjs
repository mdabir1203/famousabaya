#!/usr/bin/env node
/**
 * Connectivity soak — kiosk HTTP endpoints + dashboard state API.
 * Run with factory server up: yarn start (another terminal), then:
 *   node scripts/test-connectivity-stability.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadDotEnv() {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotEnv();

const BASE = (process.env.TEST_FACTORY_URL || `http://127.0.0.1:${process.env.PORT || 3111}`).replace(/\/+$/, '');
const ROUNDS = Number(process.env.CONNECTIVITY_ROUNDS) > 0 ? Number(process.env.CONNECTIVITY_ROUNDS) : 60;
const PARALLEL = Number(process.env.CONNECTIVITY_PARALLEL) > 0 ? Number(process.env.CONNECTIVITY_PARALLEL) : 6;
const REQ_TIMEOUT_MS = 12000;

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

async function fetchTimed(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    return { status: r.status, text, headers: r.headers };
  } finally {
    clearTimeout(t);
  }
}

async function probeTabletPing() {
  const { status } = await fetchTimed(`${BASE}/api/tablet-ping`, { method: 'GET' });
  if (status !== 204) throw new Error(`tablet-ping status ${status}`);
}

async function probeKioskState() {
  const { status, text } = await fetchTimed(`${BASE}/api/kiosk/state`, {
    headers: { Accept: 'application/json' },
  });
  if (status !== 200) throw new Error(`kiosk/state status ${status}`);
  const j = JSON.parse(text);
  if (!j.ok || !j.state || typeof j.state.active !== 'object') throw new Error('invalid kiosk state shape');
}

async function probeHealth() {
  const { status, text } = await fetchTimed(`${BASE}/api/health`, {
    headers: { Accept: 'application/json' },
  });
  if (status !== 200) throw new Error(`health status ${status}`);
  const j = JSON.parse(text);
  if (!j.ok) throw new Error('health ok=false');
  if (j.floorKioskTransport !== 'http') throw new Error('expected floorKioskTransport=http');
}

async function probeDashboardState() {
  const { status, text } = await fetchTimed(`${BASE}/api/state`, {
    headers: { Accept: 'application/json' },
  });
  if (status !== 200) throw new Error(`state status ${status}`);
  const j = JSON.parse(text);
  if (!j.ok || !j.state) throw new Error('invalid /api/state');
}

async function sequentialSoak(label, fn, rounds) {
  const latencies = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now();
    await fn();
    latencies.push(Date.now() - t0);
  }
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const max = latencies[latencies.length - 1] || 0;
  if (max > REQ_TIMEOUT_MS) throw new Error(`${label} max latency ${max}ms`);
  ok(`${label} x${rounds} (p95=${p95}ms max=${max}ms)`);
}

async function parallelBurst(label, fn, n) {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: n }, () => fn()));
  const elapsed = Date.now() - t0;
  if (elapsed > REQ_TIMEOUT_MS) throw new Error(`${label} burst took ${elapsed}ms`);
  ok(`${label} parallel x${n} (${elapsed}ms)`);
}

async function main() {
  console.log('\n=== AbaYa connectivity stability ===\n');
  console.log(`Base: ${BASE}`);
  console.log(`Rounds: ${ROUNDS}  Parallel: ${PARALLEL}\n`);

  try {
    await probeHealth();
    ok('initial /api/health');
  } catch (e) {
    bad('initial /api/health', e);
    console.error('\n  Start factory server: yarn start\n');
    process.exit(1);
  }

  const jobs = [
    ['tablet-ping', probeTabletPing],
    ['kiosk/state', probeKioskState],
    ['dashboard /api/state', probeDashboardState],
    ['health', probeHealth],
  ];

  for (const [name, fn] of jobs) {
    try {
      await sequentialSoak(name, fn, ROUNDS);
    } catch (e) {
      bad(name + ' sequential', e);
    }
  }

  try {
    await parallelBurst('mixed burst', async () => {
      const pick = jobs[Math.floor(Math.random() * jobs.length)][1];
      await pick();
    }, PARALLEL);
  } catch (e) {
    bad('parallel burst', e);
  }

  try {
    const { status, text } = await fetchTimed(`${BASE}/api/state/`, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
    if (status === 308 || status === 301 || status === 302) ok('/api/state/ trailing slash redirects');
    else if (status === 200 && JSON.parse(text).ok) ok('/api/state/ served (no redirect)');
    else bad('/api/state/ trailing slash', new Error('status ' + status));
  } catch (e) {
    bad('/api/state/ trailing slash', e);
  }

  console.log(`\nDone: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
