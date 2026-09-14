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
const fs = require('fs');

const WATCHER_DIR = path.resolve(__dirname, '..', 'tools', 'catalog-watcher');
process.chdir(WATCHER_DIR);

const NODE = process.execPath;
// v1.2.36: detect whether .pnp.cjs exists in the watcher's own dir. The CI
// build uses `npm install` (creates node_modules/) not `yarn install`
// (would create .pnp.cjs), so the bundled installer ships node_modules/ but
// NOT .pnp.cjs. The previous hardcoded `-r ./.pnp.cjs` then crashed with
// `Cannot find module ... .pnp.cjs` from the cjs/loader on the factory
// laptop. Mirror the same fallback as install/lib/bootstrap.cjs#serverInvocation.
//
// v1.2.39 (install-coherence-2026-09-14): also check that the Yarn 4 PnP cache
// (`.yarn/cache/`) exists. A factory laptop that has run LAUNCH-ALL.bat once
// will have .pnp.cjs but the .yarn/cache/ can be wiped/empty — then .pnp.cjs
// loads, tries to resolve chokidar at
// .yarn/cache/chokidar-npm-3.6.0-<hash>.zip/node_modules/chokidar/, fails,
// and the watcher exits (1). PM2 then crash-loops it. Same shape on the
// factory-server wrapper (pm2-abaya-wrapper.js).
const PNP_PATH = path.join(WATCHER_DIR, '.pnp.cjs');
const YARN_CACHE = path.join(WATCHER_DIR, '.yarn');
const usePnp = fs.existsSync(PNP_PATH) && fs.existsSync(YARN_CACHE);
if (!usePnp && fs.existsSync(PNP_PATH) && !fs.existsSync(YARN_CACHE)) {
  console.warn('[pm2-catalog-watcher-wrapper] .pnp.cjs present but .yarn/cache/ missing — falling back to plain node. The watcher will use node_modules/ instead of PnP.');
}
const args = usePnp
  ? ['-r', './.pnp.cjs', 'watch-catalog.js']
  : ['watch-catalog.js'];

const child = spawn(NODE, args, {
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
