#!/usr/bin/env node
'use strict';
/**
 * Publish a desktop-launcher build to the R2 OTA feed.
 *
 * Uploads latest.yml + the installer + its .blockmap to the abaya-updates bucket
 * under <channel>/, which the Worker serves at
 *   https://dashboard.farewellabaya.com/updates/<channel>/<file>
 * That URL is what clients put in ABAYA_UPDATE_MIRROR_BASE_URL, so electron-updater
 * can auto-update over the internet with no public repo and no embedded token.
 *
 * Usage:
 *   node scripts/publish-r2-update.mjs                     # stable, from install/
 *   node scripts/publish-r2-update.mjs --channel beta
 *   node scripts/publish-r2-update.mjs --from dist/release-client
 *   node scripts/publish-r2-update.mjs --dry-run
 *
 * Build first: powershell -File scripts/build-windows-installer.ps1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'abaya-updates';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const channel = argOf('channel', 'stable');
const fromDir = path.resolve(ROOT, argOf('from', 'install'));
const dryRun = argv.includes('--dry-run');

if (channel !== 'stable' && channel !== 'beta') {
  console.error('[publish-r2] --channel must be "stable" or "beta"');
  process.exit(1);
}

const ymlPath = path.join(fromDir, 'latest.yml');
if (!fs.existsSync(ymlPath)) {
  console.error('[publish-r2] latest.yml not found in ' + fromDir + '. Build first.');
  process.exit(1);
}

// The manifest names the exact installer filename the updater will request — upload
// precisely that, so a name mismatch can never break downloads.
const yml = fs.readFileSync(ymlPath, 'utf8');
const m = yml.match(/^path:\s*(.+)$/m);
if (!m) {
  console.error('[publish-r2] could not read "path:" from latest.yml');
  process.exit(1);
}
const exeName = m[1].trim();
const files = [ymlPath, path.join(fromDir, exeName), path.join(fromDir, exeName + '.blockmap')];

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error('[publish-r2] missing artifact: ' + f);
    process.exit(1);
  }
}

const version = (yml.match(/^version:\s*(.+)$/m) || [, '?'])[1].trim();
console.log('[publish-r2] channel=' + channel + ' version=' + version);

for (const f of files) {
  const key = channel + '/' + path.basename(f);
  const sizeMb = (fs.statSync(f).size / (1024 * 1024)).toFixed(1);
  if (dryRun) {
    console.log('[publish-r2] DRY RUN would upload ' + key + ' (' + sizeMb + ' MB)');
    continue;
  }
  console.log('[publish-r2] uploading ' + key + ' (' + sizeMb + ' MB)...');
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', BUCKET + '/' + key, '--file', f, '--remote'],
    { cwd: path.join(ROOT, 'cloudflare'), stdio: 'inherit', shell: true }
  );
}

console.log(
  dryRun
    ? '[publish-r2] dry run complete.'
    : '[publish-r2] done. Clients with ABAYA_UPDATE_MIRROR_BASE_URL=https://dashboard.farewellabaya.com will pick up v' + version + '.'
);
