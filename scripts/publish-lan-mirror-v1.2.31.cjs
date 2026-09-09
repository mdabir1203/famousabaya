// scripts/publish-lan-mirror-v1.2.31.cjs (idempotent re-run)
// Pulls the v1.2.31 release assets from GitHub Releases, drops them into
// install/ and data/lan-update-mirror/stable/. Skips files that already
// exist with the correct size.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const INSTALL = path.join(ROOT, 'install');
const MIRROR = path.join(ROOT, 'data', 'lan-update-mirror', 'stable');
const BASE = 'https://github.com/mdabir1203/famousabaya/releases/download/v1.2.31';
// Sizes from the GitHub release page (bytes, post-compression). Used as
// the "expected size" check so we can skip files that already match.
const FILES = {
  'AbaYa-Track-Launcher-Setup-1.2.31.exe': 92736192,
  'AbaYa-Track-Launcher-Setup-1.2.31.exe.blockmap': 96330,
  'latest.yml': 371,
};

function download(rawUrl, out, redirectsLeft) {
  redirectsLeft = redirectsLeft == null ? 5 : redirectsLeft;
  return new Promise((resolve, reject) => {
    const u = new URL(rawUrl);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'abirx-mirror-publisher' },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many redirects for ' + rawUrl));
        return resolve(download(new URL(res.headers.location, rawUrl).toString(), out, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + rawUrl));
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const tmp = out + '.tmp';
      const ws = fs.createWriteStream(tmp);
      let lastPct = -1;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && (pct % 10 === 0)) {
            process.stdout.write(`\r  ${path.basename(out)}  ${(received/1048576).toFixed(2)} / ${(total/1048576).toFixed(2)} MB  ${pct}%`);
            lastPct = pct;
          }
        }
      });
      res.pipe(ws);
      ws.on('finish', () => {
        ws.close(() => {
          if (total && received !== total) {
            try { fs.unlinkSync(tmp); } catch (_) {}
            return reject(new Error(`size mismatch for ${out}: expected ${total}, got ${received}`));
          }
          fs.renameSync(tmp, out);
          process.stdout.write(`\r  ${path.basename(out)}  ${(received/1048576).toFixed(2)} MB  OK\n`);
          resolve({ url: rawUrl, out, size: received });
        });
      });
      ws.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(INSTALL, { recursive: true });
  fs.mkdirSync(MIRROR, { recursive: true });
  // Clean up stale .tmp from interrupted runs.
  for (const f of Object.keys(FILES)) {
    for (const d of [INSTALL, MIRROR]) {
      try { fs.unlinkSync(path.join(d, f + '.tmp')); } catch (_) { /* not present */ }
    }
  }
  for (const [f, expectedSize] of Object.entries(FILES)) {
    const url = `${BASE}/${f}`;
    const installOut = path.join(INSTALL, f);
    const mirrorOut = path.join(MIRROR, f);
    let installSize = 0;
    try { installSize = fs.statSync(installOut).size; } catch (_) {}
    // For latest.yml, always re-download — same size across releases
    // (371 B) so a size check can't tell the old manifest from the new.
    const isManifest = f === 'latest.yml';
    if (!isManifest && installSize === expectedSize) {
      process.stdout.write(`[skip] install/${f}  already ${(installSize/1048576).toFixed(2)} MB\n`);
    } else {
      process.stdout.write(`[download] ${url}  (expected ${(expectedSize/1048576).toFixed(2)} MB)\n`);
      const r = await download(url, installOut);
      process.stdout.write(`  -> install/${f}  ${(r.size/1048576).toFixed(2)} MB\n`);
    }
    fs.copyFileSync(installOut, mirrorOut);
    process.stdout.write(`  -> mirror/${f}  synced\n`);
  }
  // Verify the manifest matches the installer.
  const manifest = fs.readFileSync(path.join(INSTALL, 'latest.yml'), 'utf8');
  const sha = (manifest.match(/^sha512:\s*(\S+)/m) || [])[1];
  const version = (manifest.match(/^version:\s*(\S+)/m) || [])[1];
  const pathInManifest = (manifest.match(/^path:\s*(\S+)/m) || [])[1];
  const installerPath = path.join(INSTALL, 'AbaYa-Track-Launcher-Setup-1.2.31.exe');
  const actualSize = fs.statSync(installerPath).size;
  const actualSha = crypto.createHash('sha512').update(fs.readFileSync(installerPath)).digest('base64');
  if (sha !== actualSha) {
    throw new Error(`manifest sha mismatch:\n  manifest: ${sha}\n  actual:   ${actualSha}`);
  }
  if (version !== '1.2.31') {
    throw new Error(`manifest version is ${version}, expected 1.2.31`);
  }
  if (pathInManifest !== 'AbaYa-Track-Launcher-Setup-1.2.31.exe') {
    throw new Error(`manifest path is ${pathInManifest}, expected AbaYa-Track-Launcher-Setup-1.2.31.exe`);
  }
  process.stdout.write(`[verify] install/latest.yml version=${version} path=${pathInManifest} sha512 OK\n`);
  // Sanity: also verify the mirror copy.
  const mirrorInstaller = path.join(MIRROR, 'AbaYa-Track-Launcher-Setup-1.2.31.exe');
  const mirrorSize = fs.statSync(mirrorInstaller).size;
  const mirrorSha = crypto.createHash('sha512').update(fs.readFileSync(mirrorInstaller)).digest('base64');
  if (mirrorSize !== actualSize || mirrorSha !== actualSha) {
    throw new Error('mirror copy does not match install copy');
  }
  process.stdout.write(`[verify] mirror copy matches install copy\n`);
  process.stdout.write(`[done] v1.2.31 published to install/ and data/lan-update-mirror/stable/\n`);
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
