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

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// Spawn the real factory with Yarn PnP preloaded. stdio: 'inherit' makes
// the child's console.log flow into our stdout, which PM2 captures into
// data/pm2-logs/abaya-server.{out,err}.log.
const NODE = process.execPath;
const child = spawn(NODE, ['-r', './.pnp.cjs', 'server.js'], {
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
