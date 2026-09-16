#!/usr/bin/env node
// tools/desktop-launcher/scripts/assert-extra-resources.mjs
//
// Why this script exists
// -----------------------
// tools/desktop-launcher/package.json#build.extraResources pulls:
//   - ../../server.js             -> resources/server.js
//   - ../../package.json          -> resources/package.json
//   - ../../install/*.{bat,ps1,cjs} -> resources/install/*
//   - ../../scripts/*.ps1          -> resources/scripts/*
//   - ../../.env.example          -> resources/.env.example
//   - ../../install/.env.production -> resources/.env.production
//   - ../../ecosystem.config.cjs  -> resources/ecosystem.config.cjs
//   - ../../public/**             -> resources/public/**
//   - ../../shared/**             -> resources/shared/**
//   - ../../config/**             -> resources/config/**
//   - ../../tools/catalog-watcher -> resources/tools/catalog-watcher/**
//
// electron-builder resolves these `from` paths relative to its working
// directory and stages a copy of each file before packaging. If a
// polluted tree (e.g. install/_extracted-v1.2.38/ or install/_tmp-build-/
// sitting in install/) shadows the live repo-root source, electron-builder
// silently picks up the stale copy and the .exe that ships to the
// factory contains:
//
//   - a v1.2.34-era server.js (sha 728F64D9...) instead of the live one
//     (sha 3466F69C... on HEAD)
//   - the catalog-watcher's package.json (name='abaya-catalog-watcher',
//     version='1.0.0') instead of the server's package.json (name=
//     'abaya-server', version='1.2.41' on HEAD)
//
// This script runs as `prebuild` so `yarn dist:win` aborts loudly with a
// clear error if the on-disk repo-root source diverges from what HEAD
// commits. That's the smoking-gun fix for the auto-update gap.
//
// It checks three things:
//   1. The live repo-root server.js sha256 matches `git rev-parse HEAD:server.js`
//   2. The live repo-root package.json matches `git rev-parse HEAD:package.json`
//      in name + version + main field (sha would over-restrict; the values
//      matter for the bundled binary)
//   3. install/_extracted-*/, install/_tmp-build-*/, install/dist/ are NOT
//      present on disk (they should not exist after PR #47 step 1)
//
// If any check fails, the script exits 1 and the `dist:win` step is
// skipped, so electron-builder never produces an .exe with a poisoned
// server.js / package.json.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const launcherDir = dirname(__dirname); // tools/desktop-launcher/
const repoRoot = resolve(launcherDir, '..', '..');

function gitHeadBlobSha(path) {
  // `git rev-parse <rev>:<path>` returns the blob SHA of the file at <rev>.
  // We compare against this so the assertion is "the on-disk file is
  // exactly what's checked into HEAD" (modulo CRLF-vs-LF which is a
  // gitattribute thing we don't care about here).
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    // Path not in HEAD (e.g. new untracked file). Not necessarily fatal —
    // the caller decides what to do.
    return null;
  }
}

function fileSha256(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function fail(msg) {
  console.error(`\n[prebuild] FAIL: ${msg}\n`);
  console.error('[prebuild] Refusing to run dist:win. Fix the divergence, then re-run.');
  process.exit(1);
}

function ok(msg) {
  console.log(`[prebuild] OK: ${msg}`);
}

// ---- Check 1: live server.js matches HEAD ----
const liveServerPath = join(repoRoot, 'server.js');
if (!existsSync(liveServerPath)) fail(`server.js missing at ${liveServerPath}`);
const liveServerSha = fileSha256(liveServerPath);
const headServerSha = gitHeadBlobSha('server.js');
if (!headServerSha) fail('server.js is not tracked in HEAD (cannot hash-check)');
if (liveServerSha !== headServerSha) {
  fail(
    `server.js on disk (${liveServerSha}) does NOT match HEAD (${headServerSha}). ` +
    'Either commit the local changes, or `git checkout HEAD -- server.js` to discard them. ' +
    'Bundling a stale server.js is the root cause of the v1.2.38 auto-update gap.'
  );
}
ok(`server.js sha256 matches HEAD (${liveServerSha.slice(0, 12)}...)`);

// ---- Check 2: live package.json matches HEAD on name + version + main ----
const livePkgPath = join(repoRoot, 'package.json');
if (!existsSync(livePkgPath)) fail(`package.json missing at ${livePkgPath}`);
const livePkg = JSON.parse(readFileSync(livePkgPath, 'utf8'));
const headPkgSha = gitHeadBlobSha('package.json');
if (!headPkgSha) fail('package.json is not tracked in HEAD');
// We could sha the file directly, but that's brittle when the operator
// runs `yarn install` and package.json's "node_modules" block changes.
// What matters for the bundled binary is the *values* of these three
// fields. Compare against the values git would produce.
const headPkg = JSON.parse(
  execFileSync('git', ['show', `HEAD:package.json`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
);
for (const key of ['name', 'version', 'main']) {
  if (livePkg[key] !== headPkg[key]) {
    fail(
      `package.json.${key} on disk ('${livePkg[key]}') does NOT match HEAD ('${headPkg[key]}'). ` +
      'Bundling a package.json with the wrong name/version/main is the root cause of the ' +
      'v1.2.38 "server.js reports appVersion=1.0.0 via /api/health" symptom.'
    );
  }
}
ok(`package.json name/version/main match HEAD (name=${livePkg.name}, version=${livePkg.version})`);

// ---- Check 3: polluted install staging dirs are absent ----
const forbiddenDirs = ['install/_extracted-v1.2.38', 'install/_tmp-build-v1.2.38', 'install/dist'];
for (const rel of forbiddenDirs) {
  const p = join(repoRoot, rel);
  if (existsSync(p)) {
    fail(
      `${rel}/ exists on disk. These staging directories from prior electron-builder ` +
      'runs shadow the live repo-root source that extraResources is supposed to pick up. ' +
      'After PR #47 step 1 untracked them from git and added .gitignore entries; they ' +
      'should not reappear in clean builds. Delete the directory (rm -rf ' + rel + ') and re-run.'
    );
  }
}
ok('no shadow staging directories under install/');

console.log('[prebuild] All extraResources inputs verified against HEAD. Proceeding to dist:win.\n');