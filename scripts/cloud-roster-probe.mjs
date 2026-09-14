// Probe the cloud roster via the Worker HTTP endpoint with CEO auth.
// Doesn't need wrangler memory-hungry JSON parsing.

const SEC = 'abaya2026';
const URL = 'https://dashboard.farewellabaya.com';

async function main() {
  // 1. Hit /api/employees with X-Ingest-Secret (the same path the factory uses)
  const r1 = await fetch(URL + '/api/employees', { headers: { 'X-Ingest-Secret': SEC } });
  const j = await r1.json();
  console.log('GET /api/employees (X-Ingest-Secret):');
  console.log('  ok:', j.ok, ' version:', j.version, ' count:', (j.employees||[]).length);
  console.log('  first:', j.employees && j.employees[0]);

  // 2. Try /api/admin/roster (if exists) for richer info
  for (const ep of ['/api/admin/roster', '/api/admin/employees', '/api/employees-admin']) {
    try {
      const r = await fetch(URL + ep, { headers: { 'X-Ingest-Secret': SEC } });
      if (r.status !== 404) {
        console.log(ep, '->', r.status, '(length', (await r.text()).length, ')');
      }
    } catch (_) {}
  }

  // 3. /api/health to confirm Worker is alive
  const rh = await fetch(URL + '/api/health');
  console.log('/api/health ->', rh.status, await rh.text());
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
