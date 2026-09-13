'use strict';
/**
 * Run the GLOBAL pm2 CLI against this project's ecosystem.
 *
 * Why global, not the project's pm2: the project uses Yarn 4 PnP, so the
 * project's `pm2` is "unplugged" into .yarn/unplugged/. Loading it via the
 * project's .pnp.cjs makes Yarn PnP claim ownership of pm2's own deps
 * (debug, pm2-io-bpm, etc. that live in the global nvm dir) and the Daemon
 * child crashes with "isn't declared in your dependencies" before it can
 * fork anything. That was the 2026-09-09 PM2 regression: v1.2.27 worked
 * because pm2 was globally installed and resolveable on PATH, v1.2.30
 * started using the project's unplugged pm2 via PnP and broke.
 *
 * v1.2.33: the abaya-server uses the new plain-Node wrapper
 * install/pm2-abaya-wrapper.js (PnP only in the spawned child) instead
 * of `interpreter_args: ['-r', './.pnp.cjs']` — the PnP-vs-PM2-wrapper
 * race is gone, so PM2 itself is no longer PnP-loaded. But we still
 * strip NODE_OPTIONS here as a belt-and-braces guard in case someone
 * launches run-pm2.cjs via `node -r ./.pnp.cjs install/run-pm2.cjs ...`.
 * Only PM2 itself bypasses PnP.
 *
 * Usage: node [-r ./.pnp.cjs] install/run-pm2.cjs <pm2-args...>
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
process.chdir(root);

const pnpPath = path.join(root, '.pnp.cjs');
if (fs.existsSync(pnpPath)) {
  try {
    require(pnpPath).setup();
  } catch (_) {
    /* already preloaded via -r ./.pnp.cjs */
  }
}

const userArgs = process.argv.slice(2);
if (!userArgs.length) {
  console.error('Usage: node install/run-pm2.cjs <pm2-command> [options]');
  console.error('Example: install\\PM2-CMD.bat start ecosystem.config.cjs --update-env');
  process.exit(1);
}

// Resolve the GLOBAL pm2 CLI (not the project's unplugged copy).
let cliPath = null;
const globalPm2Candidates = [
  // From the npm_node_execpath env var (Windows convention: the dir
  // holding node.exe is what `npm bin -g` reports).
  () => {
    const execpath = process.env.npm_node_execpath || process.env.NVM_BIN;
    if (!execpath) return null;
    const cliJs = path.join(path.dirname(execpath), 'node_modules', 'pm2', 'lib', 'binaries', 'CLI.js');
    return fs.existsSync(cliJs) ? cliJs : null;
  },
  // From NVM_HOME + NODE_VERSION.
  () => {
    const home = process.env.NVM_HOME || process.env.NVM_DIR;
    if (!home) return null;
    const nodeVer = process.env.NODE_VERSION;
    if (!nodeVer) return null;
    const cliJs = path.join(home, 'v' + nodeVer, 'node_modules', 'pm2', 'lib', 'binaries', 'CLI.js');
    return fs.existsSync(cliJs) ? cliJs : null;
  },
  // From the running node's own location (works for any install, including
  // choco/scoop/winget and manual installs).
  () => {
    const dir = path.dirname(process.execPath);
    const cliJs = path.join(dir, 'node_modules', 'pm2', 'lib', 'binaries', 'CLI.js');
    return fs.existsSync(cliJs) ? cliJs : null;
  },
];
for (const candidate of globalPm2Candidates) {
  try {
    const found = candidate();
    if (found) { cliPath = found; break; }
  } catch (_) { /* try next */ }
}
if (!cliPath) {
  console.error('[pm2] Global pm2 not found. Tried NVM_BIN, NVM_HOME+NODE_VERSION, and process.execPath siblings.');
  console.error('[pm2] Install pm2 globally: npm install -g pm2');
  process.exit(1);
}

const nodeArgs = [cliPath, ...userArgs];

const portableNodeDir = path.join(root, '.bin', 'node-v20.12.2-win-x64');
const pm2Home = path.join(root, 'data', 'pm2-home');
try {
  fs.mkdirSync(pm2Home, { recursive: true });
} catch (_) {}

// Strip Yarn PnP from NODE_OPTIONS before passing to PM2's CLI. PM2 is a
// standalone binary whose own deps live next to its own CLI.js (in the
// global nvm dir); the project's PnP loader must not be inherited by the
// PM2 Daemon or it will try to claim ownership of those deps and crash.
// The abaya-server still gets PnP via `interpreter_args` in
// ecosystem.config.cjs.
const env = Object.assign({}, process.env, { PM2_HOME: pm2Home });
if (process.platform === 'win32' && fs.existsSync(path.join(portableNodeDir, 'node.exe'))) {
  env.PATH = portableNodeDir + path.delimiter + (env.PATH || '');
}
delete env.NODE_OPTIONS;

const pipeMode = process.env.PM2_RUNNER_PIPE === '1';
const result = spawnSync(process.execPath, nodeArgs, {
  cwd: root,
  stdio: pipeMode ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  env,
  windowsHide: true,
});

if (result.error) {
  console.error('[pm2] Failed to run:', result.error.message || result.error);
  process.exit(1);
}
if (pipeMode) {
  if (result.stdout && result.stdout.length) process.stdout.write(result.stdout);
  if (result.stderr && result.stderr.length) process.stderr.write(result.stderr);
}
process.exit(typeof result.status === 'number' ? result.status : 1);
