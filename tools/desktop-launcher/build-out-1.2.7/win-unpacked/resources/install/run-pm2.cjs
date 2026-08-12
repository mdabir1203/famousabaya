'use strict';
/**
 * Run project-bundled PM2 CLI (works with Yarn PnP — no global pm2 required).
 * Usage: node [-r ./.pnp.cjs] install/run-pm2.cjs <pm2-args...>
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
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

let cliPath;
try {
  cliPath = require.resolve('pm2/lib/binaries/CLI.js');
} catch (e) {
  console.error('[pm2] Package not found. Run install\\INSTALL.bat or: yarn install');
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}

function isZipVirtualPath(p) {
  const s = String(p || '');
  return s.includes('.zip\\') || s.includes('.zip/');
}

/**
 * PM2 daemon is spawned by plain Node and cannot execute a main script inside
 * Yarn zipfs virtual paths. Ensure PM2 is unplugged to a real on-disk path.
 */
function ensurePm2CliPathOnDisk(initialPath) {
  if (!isZipVirtualPath(initialPath)) return initialPath;
  const runners = [
    { cmd: 'corepack', args: ['yarn', 'unplug', 'pm2'] },
    { cmd: 'yarn', args: ['unplug', 'pm2'] },
  ];
  let unplugged = false;
  for (const r of runners) {
    const rr = spawnSync(r.cmd, r.args, {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: true,
      windowsHide: true,
    });
    if (!rr.error && rr.status === 0) {
      unplugged = true;
      break;
    }
  }
  try {
    cliPath = require.resolve('pm2/lib/binaries/CLI.js');
  } catch (_) {
    cliPath = initialPath;
  }
  if (isZipVirtualPath(cliPath)) {
    if (unplugged) {
      console.error('[pm2] PM2 still resolves to Yarn zipfs path after unplug.');
    }
    console.error('[pm2] Run `yarn unplug pm2` and retry.');
    process.exit(1);
  }
  return cliPath;
}

cliPath = ensurePm2CliPathOnDisk(cliPath);

const nodeArgs = [];
if (fs.existsSync(pnpPath)) {
  nodeArgs.push('-r', pnpPath);
}
nodeArgs.push(cliPath, ...userArgs);

const portableNodeDir = path.join(root, '.bin', 'node-v20.12.2-win-x64');
const pm2Home = path.join(root, 'data', 'pm2-home');
try {
  fs.mkdirSync(pm2Home, { recursive: true });
} catch (_) {}

const env = Object.assign({}, process.env, { PM2_HOME: pm2Home });
if (process.platform === 'win32' && fs.existsSync(path.join(portableNodeDir, 'node.exe'))) {
  env.PATH = portableNodeDir + path.delimiter + (env.PATH || '');
}
if (fs.existsSync(pnpPath)) {
  const existingNodeOpts = String(env.NODE_OPTIONS || '').trim();
  const preloadOpt = '-r ' + pnpPath.replace(/\\/g, '/');
  if (!existingNodeOpts.includes(pnpPath)) {
    env.NODE_OPTIONS = existingNodeOpts ? (existingNodeOpts + ' ' + preloadOpt) : preloadOpt;
  }
}

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
