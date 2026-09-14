const https = require('https');
https.get({
  hostname: 'api.github.com',
  path: '/repos/mdabir1203/famousabaya/releases/tags/v1.2.31',
  headers: { 'User-Agent': 'abirx-checker', 'Accept': 'application/vnd.github+json' }
}, (r) => {
  let d = '';
  r.on('data', (c) => d += c);
  r.on('end', () => {
    const j = JSON.parse(d);
    console.log('tag:', j.tag_name);
    console.log('name:', j.name);
    console.log('draft:', j.draft);
    console.log('prerelease:', j.prerelease);
    console.log('created_at:', j.created_at);
    console.log('published_at:', j.published_at);
    console.log('assets:');
    for (const a of (j.assets || [])) {
      console.log('  ', a.name, 'size=' + a.size, 'downloads=' + a.download_count);
    }
  });
}).on('error', (e) => console.log('ERR:', e.message));
