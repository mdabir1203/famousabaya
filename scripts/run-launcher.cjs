'use strict';

/**
 * `yarn launcher` — start the desktop GUI from source (dev convenience).
 * Production clients use the packaged NSIS .exe (tools/desktop-launcher: yarn dist:win).
 *
 * The launcher is a standalone node-modules project, so we just delegate to its
 * own start script. No Yarn PnP wiring here anymore.
 *
 * IMPORTANT: the parent process (this one) is launched by Yarn under the root
 * repo's PnP loader (NODE_OPTIONS=-r <root>/.pnp.cjs). That loader can't see
 * the launcher's own node_modules/electron — it only sees PnP-mapped packages.
 * We MUST strip NODE_OPTIONS in the child env so the launcher runs in a clean
 * node-modules context. Otherwise `require('electron')` inside start-electron.cjs
 * resolves to "" and the launcher falls into the "missing binary" recovery path
 * (which then runs `yarn install`, which crashes on the corepack/PnP collision).
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LAUNCHER_DIR = path.join(ROOT, 'tools', 'desktop-launcher');

if (!fs.existsSync(path.join(LAUNCHER_DIR, 'node_modules'))) {
  console.error(
    '[launcher] Dependencies missing. Run `yarn install` in tools/desktop-launcher (or install\\START-Launcher-GUI.bat).'
  );
  process.exit(1);
}

// Build a clean child env. Keep PATH and other essentials, but drop NODE_OPTIONS
// so the PnP loader from the root repo doesn't leak into the launcher's process
// and shadow its own node_modules.
const childEnv = Object.assign({}, process.env);
delete childEnv.NODE_OPTIONS;

// Run the launcher's own start-electron.cjs with its local Electron.
const child = spawn(process.execPath, [path.join(LAUNCHER_DIR, 'start-electron.cjs')], {
  cwd: LAUNCHER_DIR,
  stdio: 'inherit',
  shell: false,
  env: childEnv,
});
child.on('exit', (code) => process.exit(code == null ? 1 : code));
child.on('error', (err) => {
  console.error('[launcher] spawn failed:', err && err.message ? err.message : String(err));
  process.exit(1);
});
