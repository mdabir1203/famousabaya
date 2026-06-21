'use strict';

/**
 * Run the npm-installed Wrangler under cloudflare/ without Yarn PnP preloaded.
 * When NODE_OPTIONS contains --require …/.pnp.cjs, PnP intercepts require() and
 * Wrangler's internal require('esbuild') fails ("isn't declared in your dependencies").
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const cfDir = path.join(root, 'cloudflare');
const wranglerJs = path.join(cfDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function dropYarnPnpPreload(nodeOptions) {
  if (nodeOptions == null || String(nodeOptions).trim() === '') return undefined;
  const s = String(nodeOptions);
  // Yarn PnP: --require .pnp.cjs and/or --import / experimental-loader with pnp.loader.mjs.
  // Leaving any of it lets PnP hijack Wrangler's require('esbuild') and breaks the bundle.
  if (s.includes('.pnp.') || s.includes('pnp.loader')) return undefined;
  return s.trim() || undefined;
}

const env = { ...process.env };
const cleaned = dropYarnPnpPreload(env.NODE_OPTIONS);
if (cleaned === undefined) delete env.NODE_OPTIONS;
else env.NODE_OPTIONS = cleaned;

let args = process.argv.slice(2);
if (args.length === 0) {
  args = ['deploy', '--config', 'wrangler.toml'];
}

const r = spawnSync(process.execPath, [wranglerJs, ...args], {
  cwd: cfDir,
  env,
  stdio: 'inherit',
});

if (r.error) {
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status === 0 || r.status === null ? 0 : r.status);
