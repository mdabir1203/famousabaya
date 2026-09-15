// Push the canonical roster (git HEAD:data/employees-manual.json) back to the cloud.
import fs from 'node:fs';
import path from 'node:path';

const SEC = process.env.CF_INGEST_SECRET || 'abaya2026';
const URL = (process.env.CF_WORKER_URL || 'https://dashboard.farewellabaya.com').replace(/\/+$/, '');

const src = process.argv[2] || path.resolve('data/employees-manual.json');
const raw = fs.readFileSync(src, 'utf8');
const roster = JSON.parse(raw);
if (!Array.isArray(roster)) throw new Error('roster is not an array');
console.log('loaded', roster.length, 'employees from', src);

const res = await fetch(URL + '/api/employees', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'X-Ingest-Secret': SEC,
  },
  body: JSON.stringify(roster),
});
const text = await res.text();
console.log('PUT /api/employees ->', res.status);
console.log(text.slice(0, 600));
if (!res.ok) process.exit(1);

// Verify by GETting it back
const r2 = await fetch(URL + '/api/employees', { headers: { 'X-Ingest-Secret': SEC } });
const j = await r2.json();
console.log('\nGET /api/employees after PUT:');
console.log('  ok:', j.ok, ' version:', j.version, ' count:', (j.employees || []).length);
