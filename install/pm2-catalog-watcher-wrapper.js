'use strict';
/**
 * PM2 entry wrapper for the catalog-watcher. Same pattern as
 * pm2-abaya-wrapper.js — plain Node, no PnP. Spawns the real watcher
 * (with PnP) in a child process and forwards stdio + signals.
 *
 * The watcher lives under tools/catalog-watcher/ and uses its own
 * PnP setup, so we cd into that dir before spawning.
 */

const { spawn } = require('child_process');
const path = require('path');

const WATCHER_DIR = path.resolve(__dirname, '..', 'tools', 'catalog-watcher');
process.chdir(WATCHER_DIR);

const NODE = process.execPath;
const child = spawn(NODE, ['-r', './.pnp.cjs', 'watch-catalog.js'], {
  cwd: WATCHER_DIR,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

const forward = (sig) => {
  try { child.kill(sig); } catch (_) { /* child may have exited */ }
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
process.on('SIGHUP', () => forward('SIGHUP'));

child.on('exit', (code, signal) => {
  if (signal) {
    try { process.kill(process.pid, signal); } catch (_) { /* ignore */ }
  } else {
    process.exit(code == null ? 1 : code);
  }
});
