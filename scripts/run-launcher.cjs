'use strict';

/**
 * `yarn launcher` — start the desktop GUI from source (dev convenience).
 * Production clients use the packaged NSIS .exe (tools/desktop-launcher: yarn dist:win).
 *
 * The launcher is a standalone node-modules project, so we just delegate to its
 * own start script. No Yarn PnP wiring here anymore.
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

// Run the launcher's own start-electron.cjs with its local Electron.
const child = spawn(process.execPath, [path.join(LAUNCHER_DIR, 'start-electron.cjs')], {
  cwd: LAUNCHER_DIR,
  stdio: 'inherit',
  shell: false,
});
child.on('exit', (code) => process.exit(code == null ? 1 : code));
child.on('error', (err) => {
  console.error('[launcher] spawn failed:', err && err.message ? err.message : String(err));
  process.exit(1);
});
