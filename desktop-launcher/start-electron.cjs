'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/**
 * Electron runs a separate embedded Node for the main process. It does not inherit
 * the parent CLI `-r ./.pnp.cjs`, so Yarn PnP deps (e.g. electron-updater) must be
 * registered via NODE_OPTIONS or resolution fails with MODULE_NOT_FOUND.
 */
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
  try {
    return require('electron');
  } catch (_) {
    return '';
  }
}

function looksWrongForHost(electronBin) {
  if (!electronBin) return true;
  if (process.platform === 'win32') {
    return !/electron\.exe$/i.test(String(electronBin));
  }
  return false;
}

function clearElectronUnpluggedIfPresent() {
  const unpluggedDir = path.join(__dirname, '.yarn', 'unplugged');
  try {
    const names = fs.readdirSync(unpluggedDir);
    names.forEach(function (name) {
      if (/^electron-npm-/i.test(name)) {
        fs.rmSync(path.join(unpluggedDir, name), { recursive: true, force: true });
      }
    });
  } catch (_) {}
}

function ensureElectronBinary() {
  let electronBin = resolveElectronPath();
  if (electronBin && fs.existsSync(electronBin) && !looksWrongForHost(electronBin)) return electronBin;

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

const electronBin = ensureElectronBinary();
const electronArgs = ['.'].concat(process.argv.slice(2));
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
