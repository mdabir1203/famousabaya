'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    const rel = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8').toLowerCase();
    return rel.includes('microsoft') || rel.includes('wsl');
  } catch (_) {
    return false;
  }
}

function run(cmd, args, opts) {
  const child = spawn(cmd, args, opts);
  child.on('exit', function (code) {
    process.exit(code == null ? 1 : code);
  });
  child.on('error', function (err) {
    console.error('[launcher] spawn failed:', err && err.message ? err.message : String(err));
    process.exit(1);
  });
}

function buildLauncherEnv() {
  const env = Object.assign({}, process.env);
  // `yarn launcher` injects root PnP loader flags into NODE_OPTIONS.
  // The desktop launcher must run with its own workspace PnP hook only.
  delete env.NODE_OPTIONS;
  delete env.YARN_PNP_CJS_PATH;
  delete env.YARN_PNP_LOADER_PATH;
  return env;
}

function repairPoisonedRootPnpIfNeeded() {
  const pnpPath = path.join(ROOT, '.pnp.cjs');
  let pnpText = '';
  try {
    pnpText = fs.readFileSync(pnpPath, 'utf8');
  } catch (_) {
    return;
  }
  if (!/\/tmp\/abaya-yarn-cache/.test(pnpText)) return;
  console.log('[launcher] Detected poisoned root .pnp.cjs (/tmp/abaya-yarn-cache). Rebuilding lock state...');
  const env = Object.assign({}, process.env);
  delete env.YARN_CACHE_FOLDER;
  delete env.YARN_GLOBAL_FOLDER;
  delete env.npm_config_cache;
  delete env.NPM_CONFIG_CACHE;
  const r = spawnSync('yarn', ['install'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: env,
  });
  if ((r && typeof r.status === 'number' && r.status !== 0) || r.error) {
    throw new Error('Failed to rebuild root .pnp.cjs via yarn install');
  }
}

const dryRun = process.argv.includes('--dry-run') || process.env.ABAYA_LAUNCHER_DRY_RUN === '1';
if (!dryRun) repairPoisonedRootPnpIfNeeded();

if (isWsl()) {
  if (dryRun) {
    console.log(
      '[launcher] WSL detected, would run: node -r ./tools/desktop-launcher/.pnp.cjs ./tools/desktop-launcher/start-electron.cjs --no-sandbox --disable-gpu-sandbox'
    );
    process.exit(0);
  }
  console.log('[launcher] WSL detected. Launching Electron with no-sandbox flags...');
  run(
    'node',
    [
      '-r',
      './tools/desktop-launcher/.pnp.cjs',
      './tools/desktop-launcher/start-electron.cjs',
      '--no-sandbox',
      '--disable-gpu-sandbox',
    ],
    {
      stdio: 'inherit',
      cwd: ROOT,
      shell: true,
      env: buildLauncherEnv(),
    }
  );
} else {
  if (dryRun) {
    console.log('[launcher] native host, would run: node -r ./tools/desktop-launcher/.pnp.cjs ./tools/desktop-launcher/start-electron.cjs');
    process.exit(0);
  }
  run('node', ['-r', './tools/desktop-launcher/.pnp.cjs', './tools/desktop-launcher/start-electron.cjs'], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: true,
    env: buildLauncherEnv(),
  });
}
