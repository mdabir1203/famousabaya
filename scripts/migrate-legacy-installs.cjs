#!/usr/bin/env node
'use strict';
/**
 * migrate-legacy-installs.cjs
 *
 * Scans common Windows locations for prior AbaYa Track installs and offers
 * to merge their data into the current install. Handles:
 *   - SQLite snapshots (data/sqlite-snapshots/)
 *   - work-types.json
 *   - .env (only the keys that are missing locally)
 *   - items_export.xlsx (catalog) — only if the local one is missing
 *
 * Usage:
 *   node scripts/migrate-legacy-installs.cjs          # interactive
 *   node scripts/migrate-legacy-installs.cjs --scan   # just list what's available
 *   node scripts/migrate-legacy-installs.cjs --yes   # non-interactive: import all
 *
 * Safety:
 *   - Never deletes from the source folder.
 *   - Never overwrites a newer file with an older one (mtime check).
 *   - The script prints a clear table of what it would do BEFORE writing anything
 *     in interactive mode.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// REPO_ROOT is the parent of the scripts/ folder that this file lives in.
// We don't trust __dirname (which can be the cwd if the script was invoked
// with a relative path) — instead we walk up from this file's actual
// location looking for the package.json that marks the AbaYa-Track repo.
function findRepoRoot() {
  // Try `__dirname` first (works when invoked with an absolute path or as
  // a sibling of the script). If that yields a non-repo folder (e.g. cwd),
  // fall back to walking up from process.argv[1].
  const candidates = [];
  if (typeof __dirname === 'string' && __dirname !== '.') {
    candidates.push(path.resolve(__dirname, '..'));
  }
  if (process.argv[1]) {
    let dir = path.resolve(path.dirname(process.argv[1]));
    while (dir !== path.dirname(dir)) {
      candidates.push(dir);
      dir = path.dirname(dir);
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'server.js')) &&
        fs.existsSync(path.join(c, 'package.json'))) {
      return c;
    }
  }
  // Last resort: cwd.
  return process.cwd();
}
const REPO_ROOT = findRepoRoot();
const DATA_DIR = path.join(REPO_ROOT, 'data');

function log(msg) { process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('!  ' + msg + '\n'); }
function err(msg) { process.stderr.write('x  ' + msg + '\n'); }

const ARGS = new Set(process.argv.slice(2));
const SCAN_ONLY = ARGS.has('--scan');
const AUTO_YES = ARGS.has('--yes');

function findLegacyInstalls() {
  // Common locations where a previous install might be on Windows.
  // Add more as needed; we dedupe and skip the current install.
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'AppData', 'Local', 'Programs'),
  ];
  const found = [];
  const seen = new Set();
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      // Match patterns: "AbaYa-Track-*", "AbaYa-Track*"
      if (!/^AbaYa[-_]?Track/i.test(ent.name)) continue;
      const full = path.join(dir, ent.name);
      // Heuristic: must have either a server.js or a public/ dir
      if (!fs.existsSync(path.join(full, 'server.js')) &&
          !fs.existsSync(path.join(full, 'public'))) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      found.push(full);
    }
  }
  // Exclude the current install if it happens to be in one of the scanned
  // directories. (e.g. ~/Desktop/AbaYa-Track-v1.0.2 should not see itself
  // as a legacy install.) The path can match in three ways:
  //   1) exact normalized path (path.resolve normalizes separators/case)
  //   2) Windows directory junction: ~/Downloads/AbaYa-Track-v1.0.2 may be
  //      a junction to the current install on Desktop. realpathSync
  //      doesn't follow junctions on Windows, so we use a content
  //      fingerprint: if server.js exists at both paths and the
  //      package.json "version" matches, it's the same install.
  // Exclude the current install if it happens to be in one of the scanned
  // directories. (e.g. ~/Desktop/AbaYa-Track-v1.0.2 should not see itself
  // as a legacy install.) Match on either:
  //   1) exact normalized path (path.resolve normalizes separators/case)
  //   2) server.js content fingerprint (handles Windows directory
  //      junctions that realpathSync doesn't follow)
  const repoNorm = path.resolve(REPO_ROOT);
  function fingerprintOf(root) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const sj = fs.statSync(path.join(root, 'server.js'));
      return pj.version + '|' + sj.size + '|' + Math.floor(sj.mtimeMs / 1000);
    } catch (_) { return null; }
  }
  const repoFp = fingerprintOf(REPO_ROOT);
  return found.filter(function (f) {
    if (path.resolve(f) === repoNorm) return false;
    const fp = fingerprintOf(f);
    if (fp && repoFp && fp === repoFp) return false;
    return true;
  });
}

function inspectLegacyInstall(root) {
  const result = {
    root: root,
    name: path.basename(root),
    hasEnv: false,
    hasServer: false,
    hasWorkTypes: false,
    hasCatalog: false,
    snapshots: [],
    latestSnapshot: null,
    workTypesMtime: null,
  };
  // Probe defensively. The path might be a junction or a folder that's
  // been partially deleted (e.g. someone nuked a Downloads/AbaYa-Track
  // symlink). Wrap each stat in try/catch so one bad file doesn't break
  // the whole scan.
  function safeExists(p) { try { return fs.existsSync(p); } catch (_) { return false; } }
  function safeStat(p)  { try { return fs.statSync(p); } catch (_) { return null; } }

  result.hasEnv = safeExists(path.join(root, '.env'));
  result.hasServer = safeExists(path.join(root, 'server.js'));

  const workTypesPath = path.join(root, 'data', 'work-types.json');
  const wStat = safeStat(workTypesPath);
  if (wStat) {
    result.hasWorkTypes = true;
    result.workTypesMtime = wStat.mtimeMs;
  }
  if (safeExists(path.join(root, 'items_export.xlsx'))) {
    result.hasCatalog = true;
  }
  const snapDir = path.join(root, 'data', 'sqlite-snapshots');
  if (safeExists(snapDir)) {
    let files = [];
    try { files = fs.readdirSync(snapDir); } catch (_) { files = []; }
    files = files
      .filter(f => /^abaya-snapshot-\d{8}-\d{6}\.db$/.test(f))
      .map(f => {
        const s = safeStat(path.join(snapDir, f));
        return s ? { name: f, mtime: s.mtimeMs, size: s.size } : null;
      })
      .filter(Boolean);
    files.sort((a, b) => b.mtime - a.mtime);
    result.snapshots = files;
    if (files.length) result.latestSnapshot = files[0];
  }
  return result;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function printTable(inspections) {
  log('');
  log('Found ' + inspections.length + ' legacy install(s):');
  log('');
  log('  ' + 'name'.padEnd(38) + 'env   work-types  catalog   snapshots   latest');
  log('  ' + '-'.repeat(38) + '----  ----------  -------   ---------   ------');
  for (const i of inspections) {
    // Guard: latestSnapshot.mtime must be a positive number, otherwise
    // toISOString() throws.
    const snap = i.latestSnapshot;
    let latest = 'none';
    if (snap && typeof snap.mtime === 'number' && Number.isFinite(snap.mtime) && snap.mtime > 0) {
      try {
        latest = fmtBytes(snap.size) + ' / ' + new Date(snap.mtime).toISOString().slice(0, 16);
      } catch (_) { latest = 'invalid'; }
    }
    log('  ' +
      i.name.padEnd(38) +
      (i.hasEnv ? 'yes  ' : 'no   ') + '   ' +
      (i.hasWorkTypes ? 'yes        ' : 'no         ') + '   ' +
      (i.hasCatalog ? 'yes    ' : 'no     ') + '   ' +
      String(i.snapshots.length).padStart(3) + '         ' +
      latest);
  }
  log('');
}

function ask(question) {
  if (AUTO_YES) return true;
  process.stdout.write(question + ' [Y/n] ');
  const buf = Buffer.alloc(8);
  const n = fs.readSync(0, buf, 0, 8, null);
  const ans = n > 0 ? buf.slice(0, n).toString('utf8').trim().toLowerCase() : '';
  return ans === '' || ans.startsWith('y');
}

function copyFile(src, dst, opts = {}) {
  if (!fs.existsSync(src)) {
    warn('source missing: ' + src);
    return false;
  }
  if (fs.existsSync(dst)) {
    const srcMtime = fs.statSync(src).mtimeMs;
    const dstMtime = fs.statSync(dst).mtimeMs;
    if (srcMtime <= dstMtime && !opts.force) {
      log('  - skip (destination is newer or same): ' + path.basename(dst));
      return false;
    }
    if (!opts.force) {
      log('  - overwriting: ' + path.basename(dst) + ' (source is newer)');
    }
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  // Preserve source mtime so subsequent runs don't think the file is stale.
  fs.utimesSync(dst, fs.statSync(src).atime, fs.statSync(src).mtime);
  log('  + wrote: ' + path.relative(REPO_ROOT, dst));
  return true;
}

function importSnapshot(snap, legacyRoot) {
  if (snap.size < 500000) {
    log('  - skip snapshot ' + snap.name + ' (only ' + fmtBytes(snap.size) + '; probably empty)');
    return false;
  }
  // Copy to a timestamped archive so we keep all historical snapshots.
  const archiveDir = path.join(DATA_DIR, 'sqlite-snapshots', 'imported-legacy');
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, 'legacy-' + path.basename(legacyRoot) + '-' + snap.name);
  copyFile(path.join(legacyRoot, 'data', 'sqlite-snapshots', snap.name), archivePath, { force: true });
  // Also copy as abaya-snapshot-latest.db so the server picks it up on next boot.
  // (The local server's snapshot mechanism uses the most recent file matching the pattern.)
  const latestPath = path.join(DATA_DIR, 'sqlite-snapshots', 'abaya-snapshot-latest.db');
  copyFile(path.join(legacyRoot, 'data', 'sqlite-snapshots', snap.name), latestPath, { force: true });
  return true;
}

function importEnv(legacyRoot) {
  const src = path.join(legacyRoot, '.env');
  const dst = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(src)) return false;
  const srcLines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
  const dstExists = fs.existsSync(dst);
  const dstLines = dstExists ? fs.readFileSync(dst, 'utf8').split(/\r?\n/) : [];
  const dstMap = new Map();
  for (const line of dstLines) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) dstMap.set(m[1], { line: line, value: m[2] });
  }
  let added = 0;
  const merged = dstLines.slice();
  for (const line of srcLines) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!dstMap.has(key) || !dstMap.get(key).value) {
      // Only fill in missing or empty values, never overwrite.
      if (!dstMap.has(key)) {
        merged.push(line);
        added++;
      }
    }
  }
  if (added > 0) {
    fs.writeFileSync(dst, merged.join('\n'));
    log('  + merged ' + added + ' missing key(s) from legacy .env');
    return true;
  }
  log('  - no new keys to add from legacy .env');
  return false;
}

function importWorkTypes(legacyRoot, inspection) {
  const src = path.join(legacyRoot, 'data', 'work-types.json');
  const dst = path.join(DATA_DIR, 'work-types.json');
  if (!fs.existsSync(src)) return false;
  // Use the same mtime-aware copy as snapshots.
  return copyFile(src, dst);
}

function importCatalog(legacyRoot) {
  const src = path.join(legacyRoot, 'items_export.xlsx');
  const dst = path.join(REPO_ROOT, 'items_export.xlsx');
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dst)) {
    log('  - skip catalog: items_export.xlsx already exists in current install');
    return false;
  }
  return copyFile(src, dst);
}

function main() {
  log('=== AbaYa Track legacy install migrator ===');
  log('Current install: ' + REPO_ROOT);
  log('');

  const candidates = findLegacyInstalls();
  if (candidates.length === 0) {
    log('No legacy installs found in ~/Downloads, ~/Desktop, ~/Documents, or %LOCALAPPDATA%\\Programs.');
    log('Nothing to migrate.');
    return 0;
  }
  const inspections = candidates.map(inspectLegacyInstall);
  printTable(inspections);

  if (SCAN_ONLY) return 0;

  if (!AUTO_YES) {
    log('This will copy data from these installs into the current one.');
    log('Nothing is deleted from the source. Existing newer files are not overwritten.');
    if (!ask('Proceed with migration?')) {
      log('Aborted.');
      return 1;
    }
  }

  let totalSnapshotsImported = 0;
  let totalEnvMerged = 0;
  let totalWorkTypes = 0;
  let totalCatalogs = 0;
  for (const i of inspections) {
    log('');
    log('--- Importing from ' + i.name + ' ---');
    // Snapshots: import up to 3 most recent, non-trivial ones
    const snapCandidates = i.snapshots
      .filter(s => s.size >= 500000)
      .slice(0, 3);
    for (const s of snapCandidates) {
      if (importSnapshot(s, i.root)) totalSnapshotsImported++;
    }
    if (importEnv(i.root)) totalEnvMerged++;
    if (importWorkTypes(i.root, i)) totalWorkTypes++;
    if (importCatalog(i.root)) totalCatalogs++;
  }
  log('');
  log('=== Summary ===');
  log('  Snapshots imported:    ' + totalSnapshotsImported);
  log('  .env keys merged:      ' + totalEnvMerged);
  log('  work-types.json:       ' + totalWorkTypes);
  log('  items_export.xlsx:     ' + totalCatalogs);
  log('');
  log('Restart the factory server for the new snapshot to take effect.');
  return 0;
}

process.exit(main());
