'use strict';

/**
 * Dev launcher for the Electron GUI (run from source). Production clients use the
 * packaged NSIS .exe (`yarn dist:win`) instead of this path.
 *
 * Resilient boot:
 *   1. Resolve Electron via `require('electron')` — the standard way under the
 *      node-modules linker this project uses.
 *   2. If the binary is missing or wrong-for-host (e.g. a stale unplugged linux
 *      build on Windows), repair by running `yarn install` once and re-resolve.
 *   3. Pass any PnP marker through NODE_OPTIONS so a future switch to PnP
 *      (or a different sub-project that is PnP) still works without changes.
 *   4. On Linux WSL, drop --no-sandbox so the GPU sandbox helper doesn't try to
 *      start without a display.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function envWithPnpForElectronChild(baseEnv) {
  const env = Object.assign({}, baseEnv || process.env);
  const pnpCjs = path.resolve(__dirname, '.pnp.cjs');
  if (!fs.existsSync(pnpCjs)) return env;
  const pnpFlag = '--require ' + JSON.stringify(pnpCjs);
  const prior = String(env.NODE_OPTIONS || '').trim();
  env.NODE_OPTIONS = prior ? pnpFlag + ' ' + prior : pnpFlag;
  return env;
}

function resolveElectronPath() {
  try { return require('electron'); } catch (_) { return ''; }
}

function looksWrongForHost(electronBin) {
  if (!electronBin) return true;
  if (process.platform === 'win32') {
    return !/electron\.exe$/i.test(String(electronBin));
  }
  return false;
}

function clearElectronUnpluggedIfPresent() {
  // Defensive cleanup. With nodeLinker: node-modules this directory is unused,
  // but a leftover from an earlier PnP run can confuse the resolver.
  const unpluggedDir = path.join(__dirname, '.yarn', 'unplugged');
  try {
    const names = fs.readdirSync(unpluggedDir);
    names.forEach(function (name) {
      if (/^electron-npm-/i.test(name)) {
        fs.rmSync(path.join(unpluggedDir, name), { recursive: true, force: true });
      }
    });
  } catch (_) { /* dir not present — fine */ }
}

function ensureElectronBinary() {
  let electronBin = resolveElectronPath();
  if (electronBin && fs.existsSync(electronBin) && !looksWrongForHost(electronBin)) {
    return electronBin;
  }

  console.log('[launcher:gui] electron binary missing/mismatched for this host; repairing launcher deps...');
  clearElectronUnpluggedIfPresent();
  const r = spawnSync('yarn', ['install'], {
    cwd: __dirname,
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });
  if ((r && typeof r.status === 'number' && r.status !== 0) || r.error) {
    throw new Error('yarn install failed in tools/desktop-launcher');
  }

  electronBin = resolveElectronPath();
  if (!electronBin || !fs.existsSync(electronBin)) {
    throw new Error('electron binary still missing after install');
  }
  return electronBin;
}

function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8'));
  } catch (_) {
    return false;
  }
}

const electronBin = ensureElectronBinary();
const wsl = isWsl();
const extraArgs = wsl ? ['--no-sandbox', '--disable-gpu-sandbox'] : [];
const electronArgs = ['.'].concat(extraArgs, process.argv.slice(2));

const child = spawn(electronBin, electronArgs, {
  cwd: __dirname,
  stdio: 'inherit',
  shell: false,
  env: envWithPnpForElectronChild(process.env),
});

child.on('exit', function (code) {
  process.exit(code == null ? 1 : code);
});

child.on('error', function (err) {
  console.error('[launcher:gui] failed to start electron:', err && err.message ? err.message : String(err));
  process.exit(1);
});
