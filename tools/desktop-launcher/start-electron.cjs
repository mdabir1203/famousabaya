'use strict';

/**
 * Dev launcher for the Electron GUI (run from source). Production clients use the
 * packaged NSIS .exe (`yarn dist:win`) instead of this path.
 *
 * With nodeLinker: node-modules, `require('electron')` resolves the bundled
 * electron binary from node_modules directly — no Yarn PnP, no NODE_OPTIONS
 * injection, and no unplugged-binary "repair" dance (all removed).
 */
const fs = require('fs');
const { spawn } = require('child_process');

let electronBin;
try {
  electronBin = require('electron');
} catch (_) {
  console.error('[launcher:gui] Electron not installed. Run `yarn install` in tools/desktop-launcher first.');
  process.exit(1);
}
if (!electronBin || !fs.existsSync(electronBin)) {
  console.error('[launcher:gui] Electron binary missing. Run `yarn install` in tools/desktop-launcher.');
  process.exit(1);
}

// WSL has no display server for the GPU sandbox; disable it there only.
let isWsl = false;
if (process.platform === 'linux') {
  try {
    isWsl = !!process.env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8'));
  } catch (_) {}
}
const extraArgs = isWsl ? ['--no-sandbox', '--disable-gpu-sandbox'] : [];

const child = spawn(electronBin, ['.', ...extraArgs, ...process.argv.slice(2)], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: false,
});
child.on('exit', (code) => process.exit(code == null ? 1 : code));
child.on('error', (err) => {
  console.error('[launcher:gui] failed to start electron:', err && err.message ? err.message : String(err));
  process.exit(1);
});
