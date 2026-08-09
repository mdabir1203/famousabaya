#!/usr/bin/env node
/**
 * Factory PC tablet LAN diagnostics (run while server is up).
 * Usage: node scripts/diagnose-tablet-lan.mjs
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

const PORT = process.env.PORT || '3000';
const BASE = (process.env.TEST_FACTORY_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
const LOG = path.join(root, 'debug-590497.log');

let issues = 0;
function pass(msg) {
  console.log('  OK  ' + msg);
}
function fail(msg) {
  issues += 1;
  console.error('  FAIL ' + msg);
}
function warn(msg) {
  console.warn('  WARN ' + msg);
}

async function get(pathname) {
  const r = await fetch(BASE + pathname, { cache: 'no-store' });
  const text = await r.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch (_) {}
  return { status: r.status, j, text };
}

console.log('\n=== Tablet LAN diagnostics ===\n');
console.log('Base: ' + BASE + '\n');

try {
  const h = await get('/api/health');
  if (h.status === 200 && h.j && h.j.ok && h.j.floorKioskTransport === 'http') {
    pass('/api/health (floorKioskTransport=http)');
    console.log('       LAN IPs: ' + (h.j.lanIps || []).join(', '));
    console.log('       Boot id: ' + (h.j.serverBootId || '-'));
  } else fail('/api/health');
} catch (e) {
  fail('/api/health — ' + (e.message || e));
}

try {
  const p = await fetch(BASE + '/api/tablet-ping', { method: 'GET', cache: 'no-store' });
  if (p.status === 204) pass('/api/tablet-ping -> 204');
  else fail('/api/tablet-ping status ' + p.status);
} catch (e) {
  fail('/api/tablet-ping — ' + (e.message || e));
}

try {
  const k = await get('/api/kiosk/state');
  if (k.status === 200 && k.j && k.j.ok && k.j.state) pass('/api/kiosk/state');
  else fail('/api/kiosk/state');
} catch (e) {
  fail('/api/kiosk/state — ' + (e.message || e));
}

try {
  const d = await get('/api/connectivity-diagnostics');
  if (d.status === 200 && d.j && d.j.ok) {
    pass('/api/connectivity-diagnostics');
    if (d.j.recommendedEndpoint) console.log('       Recommended: ' + d.j.recommendedEndpoint);
  } else fail('/api/connectivity-diagnostics');
} catch (e) {
  fail('/api/connectivity-diagnostics — ' + (e.message || e));
}

if (fs.existsSync(LOG)) {
  const lines = fs.readFileSync(LOG, 'utf8').trim().split(/\n/).slice(-100);
  const tabletIps = new Set();
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      const ip = j.data && j.data.clientIp;
      if (ip && ip !== '127.0.0.1' && !String(ip).includes('127.0.0.1')) tabletIps.add(ip);
    } catch (_) {}
  }
  if (tabletIps.size) {
    pass('debug-590497.log shows tablet/LAN IPs: ' + [...tabletIps].join(', '));
  } else {
    warn('debug-590497.log has no non-localhost clientIp in last 100 lines');
    warn('Open lan-check.html on a tablet, then re-run');
  }
} else {
  warn('No debug-590497.log yet — start server and use tablet once');
}

console.log('\nOn tablet: open http://<PC-IP>:' + PORT + '/lan-check.html then /kiosk.html?reset=server\n');
process.exit(issues > 0 ? 1 : 0);
