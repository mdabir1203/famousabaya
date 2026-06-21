#!/usr/bin/env node
/**
 * Copy Electron-builder NSIS update artifacts into the LAN mirror folders
 * served by server.js at /updates/<channel>/ (see docs/ONLINE_UPDATES.md).
 *
 * Usage:
 *   node scripts/publish-lan-update-mirror.mjs --channel stable --from ../../dist/desktop-launcher
 *   yarn node scripts/publish-lan-update-mirror.mjs --channel beta --from dist/desktop-launcher
 */
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { channel: 'stable', from: path.join(REPO_ROOT, 'dist', 'desktop-launcher') };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--channel' && argv[i + 1]) {
      out.channel = String(argv[++i]).toLowerCase();
    } else if (a === '--from' && argv[i + 1]) {
      out.from = path.resolve(REPO_ROOT, argv[++i]);
    }
  }
  return out;
}

function assertChannel(ch) {
  if (ch !== 'stable' && ch !== 'beta') {
    console.error('Invalid --channel (use stable or beta)');
    process.exit(1);
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const args = parseArgs(process.argv);
assertChannel(args.channel);

const destDir = path.join(REPO_ROOT, 'data', 'lan-update-mirror', args.channel);
if (!fs.existsSync(args.from) || !fs.statSync(args.from).isDirectory()) {
  console.error('Source directory not found:', args.from);
  process.exit(1);
}

const names = fs.readdirSync(args.from);
const yml = names.find((n) => n === 'latest.yml' || n === 'latest-mac.yml');
if (!yml) {
  console.error('No latest.yml in', args.from, '(run electron-builder publish first)');
  process.exit(1);
}

const exes = names.filter((n) => /\.exe$/i.test(n));
const blockmaps = names.filter((n) => /\.exe\.blockmap$/i.test(n));
if (!exes.length) {
  console.error('No .exe installer found in', args.from);
  process.exit(1);
}

/** Prefer NSIS exe matching channel in filename if multiple */
let exe = exes[0];
if (exes.length > 1) {
  const want = args.channel === 'beta' ? 'beta' : 'stable';
  const scored = exes.map((n) => ({
    n,
    score: n.toLowerCase().includes(want) ? 1 : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  exe = scored[0].n;
}

const blockmap = blockmaps.find((b) => b.startsWith(exe.replace(/\.exe$/i, ''))) || blockmaps[0];

copyFile(path.join(args.from, yml), path.join(destDir, 'latest.yml'));
copyFile(path.join(args.from, exe), path.join(destDir, exe));
if (blockmap) {
  copyFile(path.join(args.from, blockmap), path.join(destDir, blockmap));
}

console.log('Published LAN update mirror:', {
  channel: args.channel,
  destDir,
  files: [yml, exe, blockmap].filter(Boolean),
});
