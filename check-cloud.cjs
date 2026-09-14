const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'abirx-checker' } }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: d }));
    }).on('error', reject);
  });
}
async function main() {
  const r = await get('https://dashboard.farewellabaya.com/ceo');
  console.log('STATUS:', r.status);
  console.log('ETag:', r.headers.etag);
  console.log('Cache-Control:', r.headers['cache-control']);
  console.log('X-Worker-Version:', r.headers['x-worker-version'] || '(none)');
  console.log('CF-Cache-Status:', r.headers['cf-cache-status'] || '(none)');
  const m = r.body.match(/<title>([^<]+)<\/title>/);
  console.log('title:', m ? m[1] : '(no title)');
  const styleMatch = r.body.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/);
  console.log('css href:', styleMatch ? styleMatch[1] : '(inline)');
  const etagMeta = r.body.match(/<meta[^>]+etag[^>]*>/i);
  console.log('etag meta:', etagMeta ? etagMeta[0] : '(none)');
  const cacheMeta = r.body.match(/<meta[^>]+cache[^>]*>/i);
  console.log('cache meta:', cacheMeta ? cacheMeta[0] : '(none)');
  const kpiMatch = r.body.match(/DASHBOARD_HTML_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (kpiMatch) console.log('DASHBOARD_HTML_VERSION:', kpiMatch[1]);
  const cssMatch = r.body.match(/DASHBOARD_CSS_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (cssMatch) console.log('DASHBOARD_CSS_VERSION:', cssMatch[1]);
  const allMeta = Array.from(r.body.matchAll(/<meta[^>]+name="([^"]+)"[^>]+content="([^"]+)"/gi));
  console.log('all meta:');
  for (const x of allMeta) console.log('  ', x[1], '=', x[2]);
}
main().catch((e) => console.log('ERR:', e.message));
