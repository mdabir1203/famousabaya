// Probe the live factory server for what the dashboard actually has.
const http = require('http');
const fs = require('fs');
const path = require('path');

function get(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: Object.assign({ 'X-Ingest-Secret': 'abaya2026' }, headers || {}) }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    }).on('error', reject);
  });
}

(async () => {
  const out = {};
  for (const [name, url] of [
    ['employees', 'http://127.0.0.1:3111/api/employees'],
    ['items',     'http://127.0.0.1:3111/api/items'],
    ['abayas',    'http://127.0.0.1:3111/api/abayas'],
    ['summary',   'http://127.0.0.1:3111/api/dashboard-summary'],
    ['status',    'http://127.0.0.1:3111/api/status'],
    ['health',    'http://127.0.0.1:3111/api/health'],
  ]) {
    try {
      const r = await get(url);
      let parsed = null, error = null;
      try { parsed = JSON.parse(r.body); } catch (_) { error = r.body.slice(0, 200); }
      out[name] = { status: r.status, bodyLen: r.body.length, parsed, error };
    } catch (e) {
      out[name] = { error: e.message };
    }
  }
  console.log('=== /api/employees ===');
  console.log(JSON.stringify(out.employees, null, 2).slice(0, 1500));
  console.log('\n=== /api/items ===');
  console.log(JSON.stringify(out.items, null, 2).slice(0, 1500));
  console.log('\n=== /api/abayas ===');
  console.log(JSON.stringify(out.abayas, null, 2).slice(0, 1500));
  console.log('\n=== /api/status ===');
  console.log(JSON.stringify(out.status, null, 2).slice(0, 1500));
  console.log('\n=== /api/health ===');
  console.log(JSON.stringify(out.health, null, 2).slice(0, 1500));
})();
