'use strict';
/**
 * One-shot Windows install: dependencies + .env + Desktop shortcut.
 * No PowerShell required (shortcut uses a temporary VBScript + cscript).
 * Run: node install/setup.cjs   or   install\INSTALL.bat
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const installDir = path.resolve(__dirname);
const root = path.resolve(installDir, '..');
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'server.js'))) {
  fail('Expected server.js in repo root (parent of install/).');
}

const major = parseInt(process.versions.node, 10);
if (major < 18) {
  fail(`Node.js 18+ required. You have ${process.version}. Install LTS from https://nodejs.org`);
}

function sh(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd, env: process.env });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
}

/**
 * Execute Yarn deterministically across Windows/WSL/macOS/Linux.
 * Prefer Corepack-backed Yarn, then fall back to plain yarn.
 */
function runYarn(args, cwd = root, opts = {}) {
  const quiet = !!opts.quiet;
  const stdio = quiet ? 'pipe' : 'inherit';
  const corepack = spawnSync('corepack', ['yarn', ...args], {
    stdio,
    shell: true,
    cwd,
    env: process.env,
    encoding: 'utf8',
  });
  if (!corepack.error && corepack.status === 0) {
    return corepack;
  }
  const yarn = spawnSync('yarn', args, {
    stdio,
    shell: true,
    cwd,
    env: process.env,
    encoding: 'utf8',
  });
  if (yarn.error || yarn.status !== 0) {
    if (!quiet) {
      const cpErr = corepack.error || (corepack.status !== 0 ? corepack.stderr || corepack.stdout : '');
      const yErr = yarn.error || yarn.stderr || yarn.stdout || '';
      console.error('[yarn] corepack and yarn execution failed.');
      if (cpErr) console.error(String(cpErr).trim());
      if (yErr) console.error(String(yErr).trim());
    }
    process.exit((yarn && yarn.status) || (corepack && corepack.status) || 1);
  }
  return yarn;
}

function cleanupLegacyNodeModules(workspaceDir, label) {
  const nm = path.join(workspaceDir, 'node_modules');
  if (!fs.existsSync(nm)) return;
  console.log(`  [clean] removing legacy node_modules in ${label}...`);
  try {
    fs.rmSync(nm, { recursive: true, force: true });
  } catch (_) {
    if (process.platform === 'win32') {
      spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', nm], { stdio: 'ignore', shell: true });
    } else {
      spawnSync('rm', ['-rf', nm], { stdio: 'ignore', shell: true });
    }
  }
}

function dnsLookupSyncSafe(hostname) {
  try {
    const r = spawnSync('nslookup', [hostname], { shell: true, encoding: 'utf8' });
    if (r.status !== 0) {
      return { ok: false, address: '', family: '', error: String((r.stderr || r.stdout || '').trim() || 'lookup failed') };
    }
    const out = String(r.stdout || '');
    const m = out.match(/Address:\s*([^\r\n]+)/i);
    return { ok: true, address: m ? m[1].trim() : '', family: '' };
  } catch (e) {
    return { ok: false, address: '', family: '', error: String(e && e.message ? e.message : e) };
  }
}

console.log('\n=== AbaYa Track — install (local-first) ===\n');

console.log('[1/4] Enabling Corepack (Yarn)…');
sh('corepack', ['enable']);

try {
  runYarn(['config', 'get', 'npmRegistryServer'], root, { quiet: true });
} catch (_) {}

const dnsYarn = dnsLookupSyncSafe('registry.yarnpkg.com');
const dnsNpm = dnsLookupSyncSafe('registry.npmjs.org');

if (!dnsYarn.ok && dnsNpm.ok) {
  process.env.npm_config_registry = 'https://registry.npmjs.org/';
  process.env.NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org/';
  runYarn(['config', 'set', 'npmRegistryServer', 'https://registry.npmjs.org/'], root, { quiet: true });
}

console.log('[2/4] Factory server dependencies…');
cleanupLegacyNodeModules(root, 'repo root');
runYarn(['install']);

console.log('[3/4] Catalog watcher dependencies…');
const watcher = path.join(root, 'tools', 'catalog-watcher');
if (!fs.existsSync(path.join(watcher, 'package.json'))) {
  console.warn('  (skipped) tools/catalog-watcher not found');
} else {
  cleanupLegacyNodeModules(watcher, 'catalog watcher');
  runYarn(['install'], watcher);
}

console.log('[3b/4] Desktop launcher (optional Electron)…');
const launcherPkg = path.join(root, 'tools', 'desktop-launcher');
if (!fs.existsSync(path.join(launcherPkg, 'package.json'))) {
  console.warn('  (skipped) tools/desktop-launcher not found');
} else {
  cleanupLegacyNodeModules(launcherPkg, 'desktop launcher');
  runYarn(['install'], launcherPkg);
}

const envPath = path.join(root, '.env');
const example = path.join(root, '.env.example');
if (!fs.existsSync(envPath) && fs.existsSync(example)) {
  fs.copyFileSync(example, envPath);
  console.log('[4/4] Created .env from .env.example (edit paths and optional CF_*).');
} else if (fs.existsSync(envPath)) {
  console.log('[4/4] .env already present — left unchanged.');
} else {
  console.log('[4/4] No .env.example — create .env manually if needed.');
}

if (process.platform === 'win32') {
  const startBat = path.join(root, 'START.bat');
  const vbs = path.join(os.tmpdir(), 'abaya-create-shortcut.vbs');
  const esc = (p) => p.replace(/"/g, '""');
  const body = [
    'Set sh = CreateObject("WScript.Shell")',
    `Set sc = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\\AbaYa Track.lnk")`,
    `sc.TargetPath = "${esc(startBat)}"`,
    `sc.WorkingDirectory = "${esc(root)}"`,
    'sc.Description = "AbaYa Track — install, auto-start, and run (server + kiosk + dashboard)"',
    'sc.Save',
  ].join('\r\n');
  try {
    fs.writeFileSync(vbs, body, 'utf8');
    const r = spawnSync('cscript', ['//nologo', vbs], { stdio: 'inherit', shell: true });
    if (r.status === 0) {
      console.log('\n  Desktop shortcut created: AbaYa Track.lnk → START.bat');
    } else {
      console.warn('\n  Could not create Desktop shortcut (non-fatal). Double-click START.bat manually.');
    }
  } catch (e) {
    console.warn('\n  Shortcut:', e.message);
  }
  try {
    fs.unlinkSync(vbs);
  } catch (_) {}
} else {
  console.log('\n  (non-Windows) No shortcut created. Run: yarn start or node server.js');
}

console.log('\n=== Install finished ===');
console.log('  Next: edit .env (Excel paths), then Desktop "AbaYa Track" or install\\LAUNCH-ALL.bat');
console.log('  Optional GUI (same processes as batch): yarn launcher   (or cd tools\\desktop-launcher && yarn start)');
console.log('  Kiosk/Dashboard work fully offline on LAN; cloud sync is optional (CF_*).\n');
