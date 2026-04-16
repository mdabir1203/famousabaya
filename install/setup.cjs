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

console.log('\n=== AbaYa Track — install (local-first) ===\n');

console.log('[1/4] Enabling Corepack (Yarn)…');
sh('corepack', ['enable']);

console.log('[2/4] Factory server dependencies…');
sh('yarn', ['install']);

console.log('[3/4] Catalog watcher dependencies…');
const watcher = path.join(root, 'tools', 'catalog-watcher');
if (!fs.existsSync(path.join(watcher, 'package.json'))) {
  console.warn('  (skipped) tools/catalog-watcher not found');
} else {
  sh('yarn', ['install'], watcher);
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
  const bat = path.join(installDir, 'LAUNCH-ALL.bat');
  const vbs = path.join(os.tmpdir(), 'abaya-create-shortcut.vbs');
  const esc = (p) => p.replace(/"/g, '""');
  const body = [
    'Set sh = CreateObject("WScript.Shell")',
    `Set sc = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\\AbaYa Track.lnk")`,
    `sc.TargetPath = "${esc(bat)}"`,
    `sc.WorkingDirectory = "${esc(installDir)}"`,
    'sc.Description = "AbaYa Track — factory server, kiosk, dashboard"',
    'sc.Save',
  ].join('\r\n');
  try {
    fs.writeFileSync(vbs, body, 'utf8');
    const r = spawnSync('cscript', ['//nologo', vbs], { stdio: 'inherit', shell: true });
    if (r.status === 0) {
      console.log('\n  Desktop shortcut: AbaYa Track.lnk → LAUNCH-ALL.bat');
    } else {
      console.warn('\n  Could not create Desktop shortcut (non-fatal). Run install\\LAUNCH-ALL.bat manually.');
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
console.log('  Kiosk/Dashboard work fully offline on LAN; cloud sync is optional (CF_*).\n');
