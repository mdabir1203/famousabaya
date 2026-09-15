const https = require('https');
function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: Object.assign({ 'User-Agent': 'abirx-checker' }, headers || {}) }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    }).on('error', reject);
  });
}
async function main() {
  const r = await get('https://dashboard.farewellabaya.com/api/state?days=7&limit=20', { 'X-Ingest-Secret': 'abaya2026' });
  const j = JSON.parse(r.body);
  const activeKeys = j.state && j.state.active ? Object.keys(j.state.active) : [];
  const logCount = j.state && j.state.logs ? j.state.logs.length : 0;
  console.log('logs (7d):', logCount);
  console.log('active:', activeKeys.length);
  if (activeKeys.length) {
    for (const k of activeKeys.slice(0, 5)) {
      const a = j.state.active[k];
      console.log('  ', k, 'emp_name=', a.emp_name, 'process=', a.process, 'started=', new Date(a.started_at).toISOString());
    }
  }
  // kpi_ymd is "today" Dubai. kpi_to_ymd is the end. logs range.
  console.log('kpi:', j.kpi_anchor_ymd, '..', j.kpi_to_ymd);
  console.log('factory_today:', j.factory_today, 'completed_today:', j.completed_today);
  console.log('source_ts:', new Date(j.source_ts).toISOString(), 'db_snapshot_ts:', new Date(j.db_snapshot_ts).toISOString());
  if (j.state_meta) {
    console.log('state_meta.lag_mode:', j.state_meta.lag_mode);
  }
  // logs count by day
  if (j.state && j.state.logs) {
    const byDay = {};
    for (const l of j.state.logs) {
      const d = new Date(l.end * 1000).toISOString().slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
    }
    console.log('logs by day:', JSON.stringify(byDay));
  }
}
main().catch((e) => console.log('ERR:', e.message));
