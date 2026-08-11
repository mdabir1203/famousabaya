'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  formatBytes,
  buildActionPlan,
  dirSizeBytes,
  resolveAppDataRoot,
  listPidsListeningOnPort,
} = require('./uninstaller-policy.cjs');

test('formatBytes rounds cleanly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.00 GB');
});

test('resolveAppDataRoot honors ABAYA_DATA_DIR override', () => {
  const prev = process.env.ABAYA_DATA_DIR;
  try {
    process.env.ABAYA_DATA_DIR = 'C:/factory/override';
    assert.equal(resolveAppDataRoot(), 'C:/factory/override');
    process.env.ABAYA_DATA_DIR = '/abs/path';
    assert.equal(resolveAppDataRoot(), '/abs/path');
  } finally {
    if (prev == null) delete process.env.ABAYA_DATA_DIR;
    else process.env.ABAYA_DATA_DIR = prev;
  }
});

test('dirSizeBytes returns null for missing path', () => {
  const res = dirSizeBytes('Z:/definitely/does/not/exist/' + Date.now());
  assert.equal(res, null);
});

test('dirSizeBytes walks nested dirs and skips unreadable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-uninst-'));
  try {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'sub', 'b.txt'), 'world!');
    const res = dirSizeBytes(tmp);
    assert.ok(res);
    assert.equal(res.bytes, 11);
    assert.equal(res.files, 2);
    assert.equal(res.dirs, 1);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
});

test('buildActionPlan is empty by default (no choices means no destruction)', () => {
  const plan = buildActionPlan({});
  assert.equal(plan.length, 0);
});

test('buildActionPlan maps wipe choices to typed ops', () => {
  const plan = buildActionPlan({
    wipeFactoryData: true,
    wipeEnv: true,
    wipeLauncherCache: true,
    installDir: 'C:/Program Files/AbaYa Track Launcher',
    removeInstall: true,
    wipeBundledPhotos: true,
    killPids: [{ pid: 1234, name: 'node.exe' }],
    exportEnvTo: 'C:/Users/Operator/Desktop/.env.backup',
  });
  const types = plan.map((p) => p.type);
  assert.ok(types.includes('wipeDir'));
  assert.ok(types.includes('wipeFile'));
  assert.ok(types.includes('removeInstall'));
  assert.ok(types.includes('killPid'));
  assert.ok(types.includes('exportEnv'));
  const wipeDirPaths = plan.filter((p) => p.type === 'wipeDir').map((p) => p.path);
  assert.ok(wipeDirPaths.some((p) => p.endsWith('factory-data')));
  assert.ok(wipeDirPaths.some((p) => p.endsWith('launcher')));
  assert.ok(wipeDirPaths.some((p) => p.endsWith(path.join('resources', 'public', 'uploads'))));
});

test('buildActionPlan does not include killPids when not provided', () => {
  const plan = buildActionPlan({ wipeFactoryData: true });
  assert.equal(plan.filter((p) => p.type === 'killPid').length, 0);
});

test('buildActionPlan does not include install ops without installDir', () => {
  const plan = buildActionPlan({ removeInstall: true, wipeBundledPhotos: true });
  assert.equal(plan.filter((p) => p.type === 'removeInstall' || p.type === 'wipeDir').length, 0);
});

test('listPidsListeningOnPort is a no-op off win32', () => {
  if (process.platform !== 'win32') {
    assert.deepEqual(listPidsListeningOnPort(3111), []);
  } else {
    // On win32 we just confirm the function returns an array (may be empty)
    assert.ok(Array.isArray(listPidsListeningOnPort(3111)));
  }
});
