#!/usr/bin/env node
'use strict';
/**
 * Produce the factory server's PRODUCTION node_modules so electron-builder can
 * bundle it into the installer as resources/node_modules (see the launcher
 * package.json extraResources). The rest of the factory (server.js, public,
 * shared, config, install) is already bundled from source by extraResources.
 *
 * Result: the packaged .exe contains the whole factory server AND its runtime
 * deps, and the launcher runs it via Electron-as-node from resources/ — no repo,
 * no separate Node, no START.bat. One install = the whole system.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAGE = path.join(ROOT, 'tools', 'desktop-launcher', '.factory-deps');

function log(m) { console.log('[bundle-factory] ' + m); }

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// Minimal package.json carrying only the runtime dependencies, installed with
// plain npm (node-modules) so the bundle resolves without Yarn PnP.
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const deps = rootPkg.dependencies || {};
fs.writeFileSync(
  path.join(STAGE, 'package.json'),
  JSON.stringify({ name: 'abaya-factory-deps', version: rootPkg.version || '1.0.0', private: true, dependencies: deps }, null, 2)
);
log('runtime deps: ' + Object.keys(deps).join(', '));

log('installing production dependencies (npm, no dev)...');
execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', { cwd: STAGE, stdio: 'inherit' });

if (!fs.existsSync(path.join(STAGE, 'node_modules', 'express'))) {
  console.error('[bundle-factory] ERROR: node_modules/express missing after install.');
  process.exit(1);
}
const count = fs.readdirSync(path.join(STAGE, 'node_modules')).filter((n) => !n.startsWith('.')).length;
log('done. Produced ' + count + ' top-level packages at ' + path.join(STAGE, 'node_modules'));
