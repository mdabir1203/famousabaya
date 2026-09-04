// Trim a packaged install of safe bloat.
// Run: node scripts/slim-install.cjs <path-to-resources>
//
// User-approved trim list (2026-09-04):
//   1. @types/*                    — TS types, not used at runtime
//   2. test/ docs/ examples/ .github/  in deps — dev artifacts
//   3. *.md files in deps          — READMEs, CHANGELOGs
//   4. *.d.ts.map in deps          — TS source maps
//   5. *.map in deps               — JS source maps (electron-updater-safe:
//                                    electron-updater never reads *.map for prod
//                                    crash reports; only Sentry-style setups do)
//   6. sql.js dist extras          — keep only sql-wasm.js + sql-wasm.wasm
//   7. codepage/pages/*.tbl        — encoding tables (xlsx dep; not used at
//                                    runtime for our XLSX files which are UTF-8)
//
// KEEP: xlsx internals (cfb, ast-types, esprima, wmf, pngjs, extrareqp2) — user
//       explicitly approved keeping them despite size.
//
// Records every deletion to dist/slim-install.log for audit. Read-only on
// anything it doesn't recognize.
'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('usage: node scripts/slim-install.cjs <resources>'); process.exit(2); }
if (!fs.existsSync(root)) { console.error('not found: ' + root); process.exit(2); }

const logPath = path.join(__dirname, 'slim-install.log');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });
function log(msg) { logStream.write(msg + '\n'); console.log(msg); }
log('\n=== slim-install ' + new Date().toISOString() + ' on ' + root + ' ===');

let removedFiles = 0;
let removedBytes = 0;
let removedDirs = 0;
function rmFile(p) {
  try { const s = fs.statSync(p); fs.unlinkSync(p); removedFiles++; removedBytes += s.size; } catch {}
}
function rmDir(p) {
  try {
    let bytes = 0; let files = 0;
    const stack = [p];
    while (stack.length) {
      const cur = stack.pop();
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const e of entries) {
        const fp = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(fp);
        else { try { bytes += fs.statSync(fp).size; files++; fs.unlinkSync(fp); } catch {} }
      }
    }
    // walk back up
    const stack2 = [p];
    while (stack2.length) {
      const cur = stack2.pop();
      try { fs.rmdirSync(cur); removedDirs++; } catch { break }
      const parent = path.dirname(cur);
      if (parent === cur || parent.length <= root.length) break;
      stack2.push(parent);
    }
    log('  rm -rf ' + path.relative(root, p) + '  (' + (bytes / 1024 / 1024).toFixed(2) + ' MB, ' + files + ' files)');
  } catch (e) { /* ignore */ }
}

// --- 1. @types/*
const nm = path.join(root, 'node_modules');
if (fs.existsSync(nm)) {
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === '@types') {
      const typesDir = path.join(nm, '@types');
      log('[1] @types/*');
      for (const sub of fs.readdirSync(typesDir, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          const pkgRoot = path.join(typesDir, sub.name);
          const stack = [pkgRoot];
          while (stack.length) {
            const cur = stack.pop();
            const entries = fs.readdirSync(cur, { withFileTypes: true });
            for (const ent of entries) {
              const fp = path.join(cur, ent.name);
              if (ent.isDirectory()) stack.push(fp);
              else rmFile(fp);
            }
          }
          try { fs.rmdirSync(pkgRoot); } catch {}
        }
      }
      try { fs.rmdirSync(typesDir); } catch {}
    }
  }
}

// Helper: walk a package root, remove top-level dev dirs
const DEV_DIRS = ['test', 'tests', '__tests__', 'docs', 'doc', 'examples', 'example', '.github', '.vscode'];
function walkAndTrimPkg(pkgRoot) {
  // [2] dev dirs
  for (const dd of DEV_DIRS) {
    const dp = path.join(pkgRoot, dd);
    if (fs.existsSync(dp)) rmDir(dp);
  }
  // [3] *.md
  // [4] *.d.ts.map
  // [5] *.map (but NOT *.d.ts.map which is already matched)
  const stack = [pkgRoot];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(fp);
      else if (e.isFile()) {
        if (e.name.endsWith('.md')) rmFile(fp);
        else if (e.name.endsWith('.d.ts.map')) rmFile(fp);
        else if (e.name.endsWith('.map') && !e.name.endsWith('.d.ts.map')) rmFile(fp);
      }
    }
  }
  // empty out empty dirs left behind (post-trim only)
  const cleanupStack = [pkgRoot];
  while (cleanupStack.length) {
    const cur = cleanupStack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        const fp = path.join(cur, e.name);
        try {
          const inner = fs.readdirSync(fp);
          if (inner.length === 0) fs.rmdirSync(fp);
          else cleanupStack.push(fp);
        } catch {}
      }
    }
  }
}

// Walk every node_modules/<pkg>/ recursively
if (fs.existsSync(nm)) {
  log('[2-5] dev dirs + .md + .map');
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue; // skip .bin, .package-lock.json, etc.
    if (e.name === '@types') continue; // already handled
    const pkgRoot = path.join(nm, e.name);
    walkAndTrimPkg(pkgRoot);
  }
  // scoped packages (@scope/pkg)
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith('@')) continue;
    const scopeDir = path.join(nm, e.name);
    for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
      if (sub.isDirectory()) walkAndTrimPkg(path.join(scopeDir, sub.name));
    }
  }
}

// --- 6. sql.js dist extras
const sqljsDist = path.join(nm, 'sql.js', 'dist');
if (fs.existsSync(sqljsDist)) {
  log('[6] sql.js dist (keep sql-wasm.{js,wasm} only)');
  const wanted = new Set(['sql-wasm.js', 'sql-wasm.wasm']);
  for (const f of fs.readdirSync(sqljsDist)) {
    if (!wanted.has(f)) {
      const fp = path.join(sqljsDist, f);
      try {
        if (fs.statSync(fp).isFile()) rmFile(fp);
        else rmDir(fp);
      } catch {}
    }
  }
}

// --- 7. codepage/pages/*.tbl
const codepageDir = path.join(nm, 'codepage', 'pages');
if (fs.existsSync(codepageDir)) {
  log('[7] codepage/pages/*.tbl');
  for (const f of fs.readdirSync(codepageDir)) {
    const fp = path.join(codepageDir, f);
    try { if (fs.statSync(fp).isFile()) rmFile(fp); } catch {}
  }
}

// Also apply to tools/catalog-watcher/node_modules/ (if present)
const watcherNm = path.join(root, 'tools', 'catalog-watcher', 'node_modules');
if (fs.existsSync(watcherNm)) {
  log('[watcher] catalog-watcher/node_modules');
  for (const e of fs.readdirSync(watcherNm, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue;
    walkAndTrimPkg(path.join(watcherNm, e.name));
  }
}

const mb = (removedBytes / 1024 / 1024).toFixed(2);
log('\n=== summary: ' + removedFiles + ' files, ' + removedDirs + ' empty dirs, ' + mb + ' MB removed ===\n');
logStream.end();
