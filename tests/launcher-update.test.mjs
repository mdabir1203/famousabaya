import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_UPDATE_POLICY,
  loadUpdatePolicy,
  computeDeviceBucket,
  getDesiredUpdateRing,
  mapRingToUpdaterChannel,
  normalizeMirrorBaseUrl,
  buildLanGenericFeedUrl,
  getNextCheckDelayMs,
} = require('../tools/desktop-launcher/update-policy.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLISH_SCRIPT = path.join(REPO_ROOT, 'scripts', 'publish-lan-update-mirror.mjs');

test('mapRingToUpdaterChannel: stable ring uses conventional latest channel', () => {
  assert.deepEqual(mapRingToUpdaterChannel('stable'), { channel: 'latest', allowPrerelease: false });
  assert.deepEqual(mapRingToUpdaterChannel('beta'), { channel: 'beta', allowPrerelease: true });
  // Unknown input falls back to the safe stable mapping.
  assert.deepEqual(mapRingToUpdaterChannel('nightly'), { channel: 'latest', allowPrerelease: false });
  assert.deepEqual(mapRingToUpdaterChannel(''), { channel: 'latest', allowPrerelease: false });
});

test('electron-updater fetches the yml our pipeline actually publishes', () => {
  // Guard the root-cause fix: getChannelFilename(channel) must name a file the
  // release pipeline produces for that ring (latest.yml / beta.yml).
  const { getChannelFilename } = require('../tools/desktop-launcher/node_modules/electron-updater/out/util.js');
  assert.equal(getChannelFilename(mapRingToUpdaterChannel('stable').channel), 'latest.yml');
  assert.equal(getChannelFilename(mapRingToUpdaterChannel('beta').channel), 'beta.yml');
});

test('normalizeMirrorBaseUrl adds http scheme and strips trailing slashes', () => {
  assert.equal(normalizeMirrorBaseUrl('192.168.1.10:3000'), 'http://192.168.1.10:3000');
  assert.equal(normalizeMirrorBaseUrl('http://192.168.1.10:3000/'), 'http://192.168.1.10:3000');
  assert.equal(normalizeMirrorBaseUrl('https://updates.example.com///'), 'https://updates.example.com');
  assert.equal(normalizeMirrorBaseUrl(''), '');
  assert.equal(normalizeMirrorBaseUrl('   '), '');
});

test('buildLanGenericFeedUrl encodes the ring in the path', () => {
  assert.equal(buildLanGenericFeedUrl('192.168.1.10:3000', 'stable'), 'http://192.168.1.10:3000/updates/stable/');
  assert.equal(buildLanGenericFeedUrl('http://192.168.1.10:3000/', 'beta'), 'http://192.168.1.10:3000/updates/beta/');
  assert.equal(buildLanGenericFeedUrl('https://updates.example.com', 'beta'), 'https://updates.example.com/updates/beta/');
});

test('loadUpdatePolicy returns clamped defaults for missing or invalid input', () => {
  assert.deepEqual(loadUpdatePolicy(null), DEFAULT_UPDATE_POLICY);
  assert.deepEqual(loadUpdatePolicy('not-an-object'), DEFAULT_UPDATE_POLICY);

  const p = loadUpdatePolicy({
    defaultChannel: 'BETA',
    betaPercent: 250,
    checkIntervalMinutes: 1,
    retryIntervalMinutes: 9999,
    maxBackoffMinutes: -5,
    jitterPercent: 500,
  });
  assert.equal(p.defaultChannel, 'beta');
  assert.equal(p.betaPercent, 100);
  assert.equal(p.checkIntervalMinutes, 15); // clamped to minimum
  assert.equal(p.retryIntervalMinutes, 180); // clamped to maximum
  assert.equal(p.maxBackoffMinutes, p.retryIntervalMinutes); // clamped to >= retryInterval
  assert.equal(p.jitterPercent, 40); // clamped to maximum
});

test('loadUpdatePolicy honors an explicit 0 for optional knobs', () => {
  const p = loadUpdatePolicy({ jitterPercent: 0, betaPercent: 0 });
  assert.equal(p.jitterPercent, 0);
  assert.equal(p.betaPercent, 0);
});

test('getDesiredUpdateRing honors env override, then policy, then rollout bucket', () => {
  const stablePolicy = loadUpdatePolicy({ defaultChannel: 'stable', betaPercent: 0 });
  assert.equal(getDesiredUpdateRing('beta', stablePolicy), 'beta');
  assert.equal(getDesiredUpdateRing('STABLE', stablePolicy), 'stable');
  assert.equal(getDesiredUpdateRing('', stablePolicy), 'stable');

  const betaDefault = loadUpdatePolicy({ defaultChannel: 'beta', betaPercent: 0 });
  assert.equal(getDesiredUpdateRing('', betaDefault), 'beta');

  const allBeta = loadUpdatePolicy({ defaultChannel: 'stable', betaPercent: 100 });
  assert.equal(getDesiredUpdateRing('', allBeta), 'beta');
});

test('computeDeviceBucket is deterministic and within [0, 99]', () => {
  const a = computeDeviceBucket('seed', 'host-1', 'user-1');
  const b = computeDeviceBucket('seed', 'host-1', 'user-1');
  const c = computeDeviceBucket('seed', 'host-2', 'user-1');
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 99);
  assert.notEqual(a, c); // different device → different bucket (overwhelmingly likely)
});

test('getNextCheckDelayMs uses check interval on success and backs off on failures', () => {
  const policy = loadUpdatePolicy({
    checkIntervalMinutes: 360,
    retryIntervalMinutes: 15,
    maxBackoffMinutes: 60,
    jitterPercent: 0,
  });
  assert.equal(getNextCheckDelayMs(policy, 0), 360 * 60 * 1000);
  assert.equal(getNextCheckDelayMs(policy, 1), 15 * 60 * 1000);
  assert.equal(getNextCheckDelayMs(policy, 2), 30 * 60 * 1000);
  assert.equal(getNextCheckDelayMs(policy, 3), 60 * 60 * 1000); // hits cap
  assert.equal(getNextCheckDelayMs(policy, 10), 60 * 60 * 1000); // stays capped
});

test('getNextCheckDelayMs jitter stays within ±jitterPercent', () => {
  const policy = loadUpdatePolicy({ checkIntervalMinutes: 100, jitterPercent: 20 });
  const base = 100 * 60 * 1000;
  const lo = getNextCheckDelayMs(policy, 0, () => 0);
  const hi = getNextCheckDelayMs(policy, 0, () => 0.999999);
  assert.ok(lo >= Math.floor(base * 0.8));
  assert.ok(hi <= Math.ceil(base * 1.2));
});

function makeFixtureBuildDir(t, ymlName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-update-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const yml = [
    'version: 1.2.4-beta.1',
    'files:',
    '  - url: AbaYa-Track-Launcher-Setup-1.2.4-beta.1.exe',
    '    sha512: deadbeef',
    '    size: 42',
    'path: AbaYa-Track-Launcher-Setup-1.2.4-beta.1.exe',
    'sha512: deadbeef',
    "releaseDate: '2026-01-01T00:00:00.000Z'",
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, ymlName), yml);
  fs.writeFileSync(path.join(dir, 'AbaYa-Track-Launcher-Setup-1.2.4-beta.1.exe'), 'fake-installer');
  fs.writeFileSync(path.join(dir, 'AbaYa-Track-Launcher-Setup-1.2.4-beta.1.exe.blockmap'), 'fake-blockmap');
  return dir;
}

function runPublish(args) {
  return spawnSync(process.execPath, [PUBLISH_SCRIPT, ...args], { encoding: 'utf8' });
}

test('publish-lan-update-mirror publishes latest.yml for stable builds', (t) => {
  const from = makeFixtureBuildDir(t, 'latest.yml');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-update-dest-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const r = runPublish(['--channel', 'stable', '--from', from, '--dest', dest]);
  assert.equal(r.status, 0, r.stderr);

  assert.ok(fs.existsSync(path.join(dest, 'latest.yml')));
  assert.ok(fs.existsSync(path.join(dest, 'AbaYa-Track-Launcher-Setup-1.2.4-beta.1.exe')));
  assert.ok(fs.existsSync(path.join(dest, 'AbaYa-Track-Launcher-Setup-1.2.4-beta.1.exe.blockmap')));
});

test('publish-lan-update-mirror publishes beta.yml AND latest.yml for beta builds', (t) => {
  const from = makeFixtureBuildDir(t, 'beta.yml');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-update-dest-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const r = runPublish(['--channel', 'beta', '--from', from, '--dest', dest]);
  assert.equal(r.status, 0, r.stderr);

  // beta-ring clients fetch beta.yml; the launcher probe and mirror-health
  // endpoint key on latest.yml — both must exist.
  assert.ok(fs.existsSync(path.join(dest, 'beta.yml')), 'beta.yml must be published');
  assert.ok(fs.existsSync(path.join(dest, 'latest.yml')), 'latest.yml copy must be published');
});

test('publish-lan-update-mirror fails when no metadata yml exists', (t) => {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-update-fixture-'));
  t.after(() => fs.rmSync(from, { recursive: true, force: true }));
  fs.writeFileSync(path.join(from, 'AbaYa-Track-Launcher-Setup-1.2.3.exe'), 'fake-installer');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-update-dest-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const r = runPublish(['--channel', 'stable', '--from', from, '--dest', dest]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No update metadata yml/);
});
