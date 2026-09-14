'use strict';
/**
 * PM2 entry wrapper for the AbaYa Track factory server.
 *
 * Background: PM2's normal fork mode wraps the user script in
 * C:\Users\mabba\AppData\Local\nvm\<v>\node_modules\pm2\lib\ProcessContainerFork.js.
 * That wrapper does `require('pm2-io-bpm')` at startup. With Yarn PnP
 * preloaded (`-r ./.pnp.cjs`), PnP rejects pm2's own internal deps (debug,
 * etc.) with "isn't declared in your dependencies" because PnP only knows
 * about packages declared in package.json.
 *
 * Fix: this wrapper is a plain Node script (NO PnP, NO pm2-io-bpm, just
 * built-ins). PM2 launches it via its own wrapper. The wrapper can require
 * PM2's deps without PnP. Then THIS script spawns the actual server.js
 * with `-r ./.pnp.cjs` in a separate process, so PnP only applies to the
 * factory server (where it should apply) and not to PM2's own code.
 *
 * Why a .js file and not a .cmd: PM2 with `interpreter: 'none'` spawns
 * the script directly without a shell, which fails on .cmd files with
 * spawn EINVAL. Using `interpreter: 'node'` makes PM2 launch it via
 * node, which works on Windows.
 *
 * Used from ecosystem.config.cjs as the `script` for the abaya-server app.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// v1.2.37: mirror the watcher's .pnp.cjs fallback. The bundled install ships
// node_modules/ (from the CI `Bundle factory runtime deps` step's `npm install`)
// but NOT .pnp.cjs (only `yarn install` produces that). On a freshly-installed
// factory laptop that hasn't run LAUNCH-ALL.bat yet, `./.pnp.cjs` doesn't
// exist and `node -r ./.pnp.cjs server.js` crashes with the cjs/loader error.
// Same fix as install/pm2-catalog-watcher-wrapper.js.
const PNP_PATH = path.join(ROOT, '.pnp.cjs');
const args = fs.existsSync(PNP_PATH)
  ? ['-r', './.pnp.cjs', 'server.js']
  : ['server.js'];

const NODE = process.execPath;
const child = spawn(NODE, args, {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

const forward = (sig) => {
  try {
    child.kill(sig);
  } catch (_) {
    /* child may have already exited */
  }
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
process.on('SIGHUP', () => forward('SIGHUP'));

// PM2 sends SIGINT to its wrapper (us) for graceful shutdown; we forward
// it to the child. The child is expected to handle SIGINT cleanly.
child.on('exit', (code, signal) => {
  if (signal) {
    try { process.kill(process.pid, signal); } catch (_) { /* ignore */ }
  } else {
    process.exit(code == null ? 1 : code);
  }
});
