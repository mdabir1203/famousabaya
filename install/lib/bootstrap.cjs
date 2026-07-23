'use strict';

/**
 * Unified AbaYa Track bootstrap — the one place install + run + autostart logic
 * lives, shared by START.bat (CLI) and the desktop GUI. Node is guaranteed to be
 * on PATH by the caller (START.bat provisions portable Node when missing); this
 * module does everything after that.
 *
 * Modes (argv[2]):
 *   ensure   deps + .env only (no processes)   — used by the GUI on first run
 *   run      ensure + autostart + start server + wait health + open browser (default)
 *   health   wait for /api/health only
 *
 * Windows-first (the client target); non-Windows falls back to a plain start.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const INSTALL_DIR = path.join(ROOT, 'install');
const IS_WIN = process.platform === 'win32';

function log(msg) {
  console.log('[bootstrap] ' + msg);
}
function sh(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: true, cwd: ROOT, env: process.env }, opts || {}));
}

function readPort() {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return parseInt(m[1], 10);
  } catch (_) {}
  return 3000;
}

function ensureEnv() {
  const envPath = path.join(ROOT, '.env');
  const example = path.join(ROOT, '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(example)) {
    fs.copyFileSync(example, envPath);
    log('Created .env from .env.example — set CF_INGEST_SECRET for cloud sync.');
  }
}

function ensureCorepack() {
  const r = sh('corepack', ['enable'], { stdio: 'ignore' });
  if (r.status !== 0) log('corepack enable skipped (already enabled or unavailable).');
}

function depsPresent() {
  return fs.existsSync(path.join(ROOT, '.pnp.cjs')) || fs.existsSync(path.join(ROOT, 'node_modules'));
}

function ensureDeps() {
  if (depsPresent()) {
    log('Server dependencies present.');
    return;
  }
  log('Installing server dependencies (first run, ~1 min)…');
  const r = sh('corepack', ['yarn', 'install']);
  if (r.status !== 0) {
    const y = sh('yarn', ['install']);
    if (y.status !== 0) {
      log('ERROR: dependency install failed.');
      process.exit(1);
    }
  }
}

/** Server run command: PnP loader when present, plain node otherwise. */
function serverInvocation() {
  const node = process.execPath;
  if (fs.existsSync(path.join(ROOT, '.pnp.cjs'))) {
    return '"' + node + '" -r ./.pnp.cjs server.js';
  }
  return '"' + node + '" server.js';
}

/**
 * Write a self-restarting hidden runner (crash → restart) plus a VBS that runs it
 * with no console window — the proven pattern, generated instead of hand-maintained.
 */
function writeRunner() {
  const runnerBat = path.join(INSTALL_DIR, 'run-server.bat');
  const runnerVbs = path.join(INSTALL_DIR, 'silent-runner.vbs');
  const bat = [
    '@echo off',
    'cd /d "' + ROOT + '"',
    ':loop',
    serverInvocation(),
    'echo [server] exited — restarting in 5s…',
    'timeout /t 5 /nobreak >nul',
    'goto loop',
    '',
  ].join('\r\n');
  fs.writeFileSync(runnerBat, bat, 'utf8');
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    'sh.Run chr(34) & "' + runnerBat + '" & chr(34), 0',
    'Set sh = Nothing',
    '',
  ].join('\r\n');
  fs.writeFileSync(runnerVbs, vbs, 'utf8');
  return { runnerBat, runnerVbs };
}

/** Per-user logon autostart via a Startup-folder shortcut (no admin). Idempotent. */
function registerAutostart(runnerVbs) {
  if (!IS_WIN) return;
  if (String(process.env.ABAYA_SKIP_AUTOSTART || '') === '1') {
    log('Auto-start skipped (ABAYA_SKIP_AUTOSTART=1).');
    return;
  }
  const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const lnk = path.join(startupDir, 'AbaYa Track Server.lnk');
  const vbsMaker = path.join(os.tmpdir(), 'abaya-autostart.vbs');
  const esc = (p) => p.replace(/"/g, '""');
  const body = [
    'Set sh = CreateObject("WScript.Shell")',
    'Set sc = sh.CreateShortcut("' + esc(lnk) + '")',
    'sc.TargetPath = "wscript.exe"',
    'sc.Arguments = """' + esc(runnerVbs) + '"""',
    'sc.WorkingDirectory = "' + esc(ROOT) + '"',
    'sc.Description = "AbaYa Track background server (auto-start on login)"',
    'sc.Save',
    '',
  ].join('\r\n');
  try {
    fs.writeFileSync(vbsMaker, body, 'utf8');
    const r = spawnSync('cscript', ['//nologo', vbsMaker], { stdio: 'ignore', shell: true });
    if (r.status === 0) log('Auto-start on login registered.');
    fs.unlinkSync(vbsMaker);
  } catch (e) {
    log('Auto-start registration skipped: ' + (e && e.message ? e.message : e));
  }
}

/** Stop only the process listening on our port (precise — never a broad node kill). */
function killPriorOnPort(port) {
  if (!IS_WIN) return;
  const ps =
    "$c = Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue;" +
    " if ($c) { $c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }";
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', shell: true });
}

function startServerHidden(runnerVbs) {
  if (IS_WIN) {
    spawn('wscript.exe', [runnerVbs], { cwd: ROOT, detached: true, stdio: 'ignore', shell: false }).unref();
  } else {
    spawn('sh', ['-c', serverInvocation().replace(/"/g, '') + ' &'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
  }
}

function waitHealth(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 30000);
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => req.destroy());
    };
    const retry = () => (Date.now() > deadline ? resolve(false) : setTimeout(tick, 700));
    tick();
  });
}

function openBrowser(port) {
  const urls = ['http://localhost:' + port + '/dashboard.html', 'http://localhost:' + port + '/kiosk.html'];
  urls.forEach((u) => {
    if (IS_WIN) spawnSync('cmd', ['/c', 'start', '""', u], { stdio: 'ignore', shell: true });
    else spawnSync('sh', ['-c', '(xdg-open "' + u + '" || open "' + u + '") >/dev/null 2>&1'], { stdio: 'ignore' });
  });
}

async function main() {
  const mode = (process.argv[2] || 'run').toLowerCase();
  const port = readPort();

  if (mode === 'health') {
    const ok = await waitHealth(port, 30000);
    process.exit(ok ? 0 : 1);
  }

  ensureCorepack();
  ensureDeps();
  ensureEnv();
  if (mode === 'ensure') {
    log('Dependencies and .env ready.');
    return;
  }

  const { runnerVbs } = writeRunner();
  registerAutostart(runnerVbs);
  log('Starting server on port ' + port + '…');
  killPriorOnPort(port);
  startServerHidden(runnerVbs);
  const ok = await waitHealth(port, 30000);
  if (!ok) {
    log('WARNING: server did not answer /api/health within 30s. Check install\\run-server.bat output.');
    process.exit(1);
  }
  log('Server healthy. Opening dashboard + kiosk…');
  openBrowser(port);
  log('Done. AbaYa Track is running and will auto-start on login.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[bootstrap] fatal:', e && e.stack ? e.stack : e);
    process.exit(1);
  });
}

module.exports = { ensureCorepack, ensureDeps, ensureEnv, registerAutostart, writeRunner, killPriorOnPort, startServerHidden, waitHealth, openBrowser, readPort };
