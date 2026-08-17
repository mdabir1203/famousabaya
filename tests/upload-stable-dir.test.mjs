// Verifies the fix that moves employee/item photos to a stable, update-safe
// data dir when ABAYA_DATA_DIR is set (the launcher-spawned packaged app).
//
// Regression for: a fresh .exe install couldn't keep employee photos across
// updates/reinstalls because uploads were written under
// path.join(__dirname, 'public', 'uploads') — inside the install dir.
//
// Run with: node --test tests/upload-stable-dir.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function runProbe(env) {
  const probe = `
    const path = require('path');
    const fs = require('fs');
    const DATA_DIR = (() => {
      const d = String(process.env.ABAYA_DATA_DIR || '').trim();
      if (d) return path.isAbsolute(d) ? d : path.join(__dirname, d);
      return path.join(__dirname, 'data');
    })();
    const STABLE_UPLOADS_PUBLIC = (() => {
      const d = String(process.env.ABAYA_DATA_DIR || '').trim();
      if (!d) return null;
      const abs = path.isAbsolute(d) ? d : path.join(__dirname, d);
      return path.join(abs, 'public', 'uploads');
    })();
    const UPLOAD_EMP_DIR = STABLE_UPLOADS_PUBLIC
      ? path.join(STABLE_UPLOADS_PUBLIC, 'employees')
      : path.join(__dirname, 'public', 'uploads', 'employees');
    const out = {
      stable: STABLE_UPLOADS_PUBLIC,
      uploadEmpDir: UPLOAD_EMP_DIR,
      dataDir: DATA_DIR,
    };
    process.stdout.write(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ['-e', probe], {
    env: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('ABAYA_'))
    ).__proto__ === null ? { ...process.env, ...env } : { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error('probe failed: ' + (r.stderr || r.stdout));
  }
  return JSON.parse(String(r.stdout || '').trim());
}

test('server honors ABAYA_DATA_DIR for upload paths', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'abaya-test-'));
  const envFile = join(dataRoot, '.env');
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(envFile, 'CF_INGEST_SECRET=test-secret\nABAYA_UPDATE_MIRROR_BASE_URL=http://127.0.0.1:3111\n');

  try {
    const out = runProbe({
      ABAYA_DATA_DIR: dataRoot,
      ABAYA_ENV_FILE: envFile,
    });
    // Stable uploads root = <ABAYA_DATA_DIR>/public/uploads
    assert.equal(out.stable, join(dataRoot, 'public', 'uploads'), 'stable uploads root is <ABAYA_DATA_DIR>/public/uploads');
    assert.equal(out.uploadEmpDir, join(dataRoot, 'public', 'uploads', 'employees'), 'UPLOAD_EMP_DIR is stable/employees');
    assert.equal(out.dataDir, dataRoot, 'DATA_DIR = ABAYA_DATA_DIR');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('when ABAYA_DATA_DIR is unset, uploads stay in install-relative path', () => {
  // Strip ABAYA_* from the spawned child
  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('ABAYA_')) continue;
    cleanEnv[k] = v;
  }
  const probe = `
    const path = require('path');
    const STABLE_UPLOADS_PUBLIC = (() => {
      const d = String(process.env.ABAYA_DATA_DIR || '').trim();
      if (!d) return null;
      const abs = path.isAbsolute(d) ? d : path.join(__dirname, d);
      return path.join(abs, 'public', 'uploads');
    })();
    const UPLOAD_EMP_DIR = STABLE_UPLOADS_PUBLIC
      ? path.join(STABLE_UPLOADS_PUBLIC, 'employees')
      : path.join(__dirname, 'public', 'uploads', 'employees');
    const out = { stable: STABLE_UPLOADS_PUBLIC, uploadEmpDir: UPLOAD_EMP_DIR };
    process.stdout.write(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ['-e', probe], {
    env: cleanEnv,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, 'probe exit code');
  const out = JSON.parse(String(r.stdout || '').trim());
  assert.equal(out.stable, null, 'STABLE_UPLOADS_PUBLIC must be null without ABAYA_DATA_DIR');
  assert.ok(out.uploadEmpDir.endsWith('public' + sep + 'uploads' + sep + 'employees'),
    'UPLOAD_EMP_DIR falls back to install-relative, got: ' + out.uploadEmpDir);
});
