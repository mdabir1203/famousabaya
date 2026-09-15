'use strict';

/**
 * PM2 ecosystem for AbaYa Track.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup     # one-time: register PM2 at OS boot
 *
 * Apps:
 *   factory-server     - main Node server (server.js). Always-on.
 *   cloudflared-tunnel - optional Cloudflare tunnel; only included when the
 *                        cloudflared binary and its config file are present.
 *   catalog-watcher    - optional office-side watcher; only included when
 *                        tools/catalog-watcher/config.json exists.
 *
 * Logs land in ./data/pm2-logs/<app>.{out,err}.log so they sit next to other
 * runtime artifacts and survive the standard backup/snapshot story.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'data', 'pm2-logs');

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (_) { /* best-effort */ }

const COMMON_RESTART = {
  autorestart: true,
  max_restarts: 50,
  restart_delay: 5000,
  exp_backoff_restart_delay: 250,
  min_uptime: 30000,
  kill_timeout: 8000,
  wait_ready: false,
  watch: false,
};

function logPath(name) {
  return {
    out_file: path.join(LOG_DIR, `${name}.out.log`),
    error_file: path.join(LOG_DIR, `${name}.err.log`),
    merge_logs: true,
    time: true,
  };
}

const factoryServer = Object.assign(
  {
    name: 'abaya-server',
    cwd: ROOT,
    // v1.2.33: launch via a plain-Node wrapper instead of `-r ./.pnp.cjs`
    // directly. PM2 wraps every fork-mode app in its own
    // ProcessContainerFork.js, which `require('pm2-io-bpm')` at startup.
    // With `-r ./.pnp.cjs` in the same process, PnP rejects pm2's own
    // internal deps (debug, etc.) with "isn't declared in your
    // dependencies" before our server.js ever loads. The wrapper script
    // is plain Node (NO PnP) — PM2's wrapper can safely require
    // pm2-io-bpm. The wrapper then spawns the real server.js with
    // `-r ./.pnp.cjs` in a CHILD process, where PnP applies only to
    // the factory code. See install/pm2-abaya-wrapper.js.
    //
    // We use `interpreter: 'node'` (no interpreter_args, no node_args)
    // so PM2 launches `node <pm2-wrapper> install/pm2-abaya-wrapper.js`
    // cleanly. The pm2 wrapper does its own require('pm2-io-bpm') first,
    // then requires our wrapper.js, which is plain Node and has no
    // PnP-aware deps to load.
    script: 'install\\pm2-abaya-wrapper.js',
    interpreter: 'node',
    env: {
      NODE_ENV: 'production',
      PM2_MANAGED: '1',
    },
  },
  COMMON_RESTART,
  logPath('abaya-server')
);

const apps = [factoryServer];

/** ── Cloudflared tunnel (optional) ───────────────────────────────────────── */
function detectCloudflared() {
  const cfgEnv = String(process.env.CLOUDFLARED_CONFIG || '').trim();
  const candidates = [];
  if (cfgEnv) candidates.push(cfgEnv);
  candidates.push(path.join(os.homedir(), '.cloudflared', 'config.yml'));

  let cfgPath = null;
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) {
        cfgPath = c;
        break;
      }
    } catch (_) { /* ignore */ }
  }
  if (!cfgPath) return null;

  const binEnv = String(process.env.CLOUDFLARED_BIN || '').trim();
  if (binEnv && fs.existsSync(binEnv)) return { binary: binEnv, configPath: cfgPath };

  /** Look on PATH and standard install locations on Windows. */
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  for (const dir of pathDirs) {
    try {
      const full = path.join(dir, exeName);
      if (fs.existsSync(full)) return { binary: full, configPath: cfgPath };
    } catch (_) { /* ignore */ }
  }
  if (process.platform === 'win32') {
    const guesses = [
      path.join(process.env['ProgramFiles'] || 'C:/Program Files', 'cloudflared', 'cloudflared.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
    ];
    for (const g of guesses) {
      try { if (fs.existsSync(g)) return { binary: g, configPath: cfgPath }; } catch (_) { /* ignore */ }
    }
  }
  return null;
}

const cf = detectCloudflared();
if (cf && process.env.PM2_DISABLE_TUNNEL !== '1') {
  apps.push(
    Object.assign(
      {
        name: 'cloudflared-tunnel',
        cwd: ROOT,
        script: cf.binary,
        args: ['tunnel', '--config', cf.configPath, 'run'],
        interpreter: 'none',
      },
      COMMON_RESTART,
      logPath('cloudflared-tunnel'),
      { restart_delay: 10000 }
    )
  );
}

/** ── Catalog watcher (optional office side) ─────────────────────────────── */
const watcherDir = path.join(ROOT, 'tools', 'catalog-watcher');
const watcherCfg = path.join(watcherDir, 'config.json');
const watcherEntry = path.join(watcherDir, 'watch-catalog.js');
if (fs.existsSync(watcherCfg) && fs.existsSync(watcherEntry) && process.env.PM2_DISABLE_WATCHER !== '1') {
  // v1.2.33: same plain-Node wrapper pattern as the factory server.
  // See the long block comment above the factoryServer app for the
  // full PnP-vs-PM2-wrapper rationale. The wrapper script lives in
  // install/ and cd's into the watcher dir before spawning.
  apps.push(
    Object.assign(
      {
        name: 'catalog-watcher',
        cwd: watcherDir,
        script: '..\\..\\install\\pm2-catalog-watcher-wrapper.js',
        interpreter: 'node',
        env: { NODE_ENV: 'production', PM2_MANAGED: '1' },
      },
      COMMON_RESTART,
      logPath('catalog-watcher')
    )
  );
}

module.exports = { apps };
