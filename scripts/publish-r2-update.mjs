#!/usr/bin/env node
'use strict';
/**
 * Publish a desktop-launcher build to the R2 OTA feed.
 *
 * Uploads latest.yml + the installer + its .blockmap + a
 * versions-manifest.json to the abaya-updates bucket under <channel>/.
 * The Worker serves them at
 *   https://dashboard.farewellabaya.com/updates/<channel>/<file>
 * That URL is what clients put in ABAYA_UPDATE_MIRROR_BASE_URL, so
 * electron-updater auto-updates over the public internet with no
 * embedded token, and the in-app "Rollback chooser" can list every
 * version published on the channel.
 *
 * Usage:
 *   node scripts/publish-r2-update.mjs                     # stable, from install/
 *   node scripts/publish-r2-update.mjs --channel beta
 *   node scripts/publish-r2-update.mjs --from dist/release-client
 *   node scripts/publish-r2-update.mjs --no-manifest        # skip versions-manifest.json
 *   node scripts/publish-r2-update.mjs --manifest-keep=N   # keep only the N most recent versions (default 12)
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
const flag = (name) => argv.includes('--' + name);

const channel = argOf('channel', 'stable');
const fromDir = path.resolve(ROOT, argOf('from', 'install'));
const dryRun = flag('dry-run');
const writeManifest = !flag('no-manifest');
const manifestKeep = parseInt(argOf('manifest-keep', '12'), 10) || 12;
const manifestMaxBytes = parseInt(argOf('manifest-max-bytes', '524288'), 10) || 524288;

if (channel !== 'stable' && channel !== 'beta') {
  console.error('[publish-r2] --channel must be "stable" or "beta"');
  process.exit(1);
}

const ymlPath = path.join(fromDir, 'latest.yml');
if (!fs.existsSync(ymlPath)) {
  console.error('[publish-r2] latest.yml not found in ' + fromDir + '. Build first.');
  process.exit(1);
}

// The manifest names the exact installer filename the updater will request —
// upload precisely that, so a name mismatch can never break downloads.
const yml = fs.readFileSync(ymlPath, 'utf8');
function ymlField(name) {
  const re = new RegExp('^' + name + ':\\s*(.+)$', 'm');
  const mm = yml.match(re);
  return mm ? mm[1].trim() : null;
}
const exeName = ymlField('path');
const version = ymlField('version');
const sizeRaw = ymlField('size');
const sha512 = ymlField('sha512');
if (!exeName || !version) {
  console.error('[publish-r2] could not read "path:" / "version" from latest.yml');
  process.exit(1);
}
const exeSize = parseInt(sizeRaw, 10) || 0;
if (!sha512) {
  console.warn('[publish-r2] WARN: sha512 missing from latest.yml. Rollback verification will be weaker.');
}
const files = [ymlPath, path.join(fromDir, exeName), path.join(fromDir, exeName + '.blockmap')];
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error('[publish-r2] missing artifact: ' + f);
    process.exit(1);
  }
}

console.log('[publish-r2] channel=' + channel + ' version=' + version + ' exe=' + exeName + ' (' + (exeSize / 1024 / 1024).toFixed(1) + ' MB)');

function r2(args, opts) {
  return execFileSync('npx', ['wrangler', 'r2', ...args], {
    cwd: path.join(ROOT, 'cloudflare'),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    ...(opts || {}),
  }).toString();
}
function r2Stream(args) {
  return execFileSync('npx', ['wrangler', 'r2', ...args], {
    cwd: path.join(ROOT, 'cloudflare'),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
}

// 1. Upload the latest.yml + installer + blockmap (existing flow).
for (const f of files) {
  const key = channel + '/' + path.basename(f);
  const sizeMb = (fs.statSync(f).size / (1024 * 1024)).toFixed(1);
  if (dryRun) {
    console.log('[publish-r2] DRY RUN would upload ' + key + ' (' + sizeMb + ' MB)');
    continue;
  }
  console.log('[publish-r2] uploading ' + key + ' (' + sizeMb + ' MB)...');
  r2(['object', 'put', BUCKET + '/' + key, '--file', f, '--remote']);
}

// 2. Maintain versions-manifest.json so the in-app Rollback chooser can
//    offer any version on the channel (not just latest.yml).
if (!writeManifest) {
  console.log('[publish-r2] --no-manifest set: skipping manifest write.');
} else if (dryRun) {
  console.log('[publish-r2] DRY RUN would publish versions-manifest.json with v' + version + ' appended.');
} else {
  const manifestKey = channel + '/versions-manifest.json';
  let existing = { channel, latest: null, versions: [] };
  try {
    // Stream the existing manifest straight to a temp file so we don't hold
    // multi-MB JSON in memory.
    const tmpExisting = path.join(fromDir, '.versions-manifest.existing.json');
    try {
      r2Stream(['object', 'get', BUCKET + '/' + manifestKey, '--file', tmpExisting, '--remote']);
      const raw = fs.readFileSync(tmpExisting, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.versions)) {
        existing = {
          channel: parsed.channel || channel,
          latest: parsed.latest || null,
          versions: parsed.versions,
          // Preserve the warning markers / publisher metadata so we don't
          // accidentally strip operational state across publishes.
          warning: parsed.warning || null,
          publisher: parsed.publisher || null,
          schema_version: parsed.schema_version || 1,
          generated_at: parsed.generated_at || null,
        };
      }
    } catch (_) {
      // No existing manifest yet — that's fine, we start a fresh one.
    } finally {
      try { fs.unlinkSync(tmpExisting); } catch (_) {}
    }

    const baseUrl = String(process.env.ABAYA_CLOUD_UPDATE_BASE_URL || 'https://dashboard.farewellabaya.com').trim().replace(/\/+$/, '');
    const entry = {
      version: version,
      url: baseUrl + '/updates/' + channel + '/' + exeName,
      size: exeSize,
      sha512: sha512 || null,
      published_at: new Date().toISOString(),
      channel: channel,
      // The launcher uses this to drive the chooser badges.
      is_release: true,
    };
    // Upsert by version. If a duplicate exists (re-publish same version),
    // keep the original published_at so the manifest stays stable.
    const idx = existing.versions.findIndex(v => v && v.version === version);
    if (idx >= 0) existing.versions[idx] = Object.assign({}, existing.versions[idx], entry, { published_at: existing.versions[idx].published_at || entry.published_at });
    else existing.versions.push(entry);

    // Sort newest first (semver desc), trim to manifestKeep.
    existing.versions.sort((a, b) => {
      const pa = String(a.version).split('.').map(n => parseInt(n, 10) || 0);
      const pb = String(b.version).split('.').map(n => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da !== db) return db - da;
      }
      return 0;
    });
    if (existing.versions.length > manifestKeep) {
      const dropped = existing.versions.splice(manifestKeep);
      console.log('[publish-r2] manifest: trimmed to keep last ' + manifestKeep + ' versions (' + dropped.length + ' dropped).');
    }
    existing.channel = channel;
    existing.latest = version;
    existing.schema_version = Math.max(existing.schema_version || 0, 1);
    existing.publisher = existing.publisher || 'AbaYa Track';
    existing.generated_at = new Date().toISOString();

    const out = JSON.stringify(existing, null, 2);
    if (Buffer.byteLength(out, 'utf8') > manifestMaxBytes) {
      console.warn('[publish-r2] WARN: manifest ' + Buffer.byteLength(out, 'utf8') + ' bytes > ' + manifestMaxBytes + ' byte cap. R2 upload still proceeds.');
    }
    const tmpOut = path.join(fromDir, '.versions-manifest.out.json');
    fs.writeFileSync(tmpOut, out, 'utf8');
    try {
      r2(['object', 'put', BUCKET + '/' + manifestKey, '--file', tmpOut, '--remote']);
      console.log('[publish-r2] uploaded ' + manifestKey + ' (' + existing.versions.length + ' versions, ' + Buffer.byteLength(out, 'utf8') + ' bytes).');
    } finally {
      try { fs.unlinkSync(tmpOut); } catch (_) {}
    }
  } catch (err) {
    // Manifest publish is best-effort: the installer upload above already
    // succeeded, so a manifest failure must not poison the publish. Log and
    // continue; the next publish will rebuild the manifest from scratch.
    console.error('[publish-r2] manifest publish failed: ' + (err && err.message ? err.message : err) + '. Installer upload already succeeded.');
  }
}

console.log(
  dryRun
    ? '[publish-r2] dry run complete.'
    : '[publish-r2] done. Clients with ABAYA_UPDATE_MIRROR_BASE_URL=https://dashboard.farewellabaya.com will pick up v' + version + '.'
);
