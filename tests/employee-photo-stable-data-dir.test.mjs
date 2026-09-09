// tests/employee-photo-stable-data-dir.test.mjs
//
// Regression for v1.2.31 (the "employee photo not loading" bug):
//
//   On a factory laptop, the launcher sets ABAYA_DATA_DIR so employee
//   photos live under <ABAYA_DATA_DIR>/public/uploads/ (the "stable
//   data dir"). When the roster comes from an xlsx without a `photo`
//   column, the xlsx parser at server.js:3060-3069 used to fall back
//   to a name-based photo search — but ONLY against
//   __dirname/public/uploads (the install-relative dir). It never
//   looked in the stable data dir, so a photo named Misbah.jpeg that
//   lived in the data dir was silently missed. The browser then
//   showed initials instead of the photo, and the operator saw the
//   kio/dashboard avatar fall back to the colored circle.
//
// Fix: the xlsx parser's name-based fallback now searches the same
// dual roots as attachEmployeeImagesFromDisk (stable data dir +
// install-relative), and also checks the `employees/` subfolder
// where the upload endpoint writes. attachEmployeeImagesFromDisk
// already searched both roots in the `employees/` subfolder for
// `emp_<barcode>.<ext>`; the legacy name-based naming is now also
// covered in the same dual-root + dual-subfolder pattern.
//
// What this test proves:
//   1. With ABAYA_DATA_DIR pointing to a temp data dir, a
//      <data>/public/uploads/employees/Misbah.jpeg file exists.
//   2. The xlsx has no `photo` column, just name + barcode + process.
//   3. After loadEmployeesFromXlsxFile runs, /api/employees returns
//      emp.photo = "employees/Misbah.jpeg" for Misbah.
//   4. Same scenario but with the file in the root (not
//      `employees/`) — also found, path set without `employees/` prefix.
//   5. Same scenario with the file in the install-relative dir
//      (legacy/dev fallback) — also found.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SERVER_PATH = join(REPO_ROOT, 'server.js');

/** Allocate a free TCP port on 127.0.0.1, then close the listener. */
async function allocateFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Build a minimal employees.xlsx without a `photo` column. */
function buildEmployeesXlsx(filePath, employees) {
  const headers = ['emp_no', 'ac_no', 'name', 'barcode', 'process', 'code', 'color'];
  const aoa = [headers];
  for (const e of employees) {
    aoa.push([
      e.emp_no, e.ac_no, e.name, e.barcode, e.process,
      e.code || ('EMP' + e.emp_no), e.color || '#6a5fc1',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  XLSX.writeFile(wb, filePath);
}

/** Poll /api/debug-kiosk until employeesCount equals expected. */
async function waitForEmployeesCount(port, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/debug-kiosk`);
      if (r.ok) {
        const j = await r.json();
        last = j.employeesCount;
        if (last === expected) return last;
      }
    } catch (_) { /* keep polling */ }
    await sleep(200);
  }
  throw new Error(`employeesCount never became ${expected} (last seen: ${last})`);
}

/** Spawn server.js with the given env, wait for /api/health, run scenario, kill. */
async function withServer({ env }, scenario) {
  const port = await allocateFreePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) break;
      } catch (_) { /* keep polling */ }
      await sleep(150);
    }
    return await scenario({ port, base: `http://127.0.0.1:${port}` });
  } finally {
    child.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise((r) => child.once('exit', () => r(true))),
      sleep(2000).then(() => false),
    ]);
    if (!exited) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  }
}

test('regression v1.2.31: xlsx name-based photo fallback searches STABLE_UPLOADS_PUBLIC (employees/ subfolder)', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'photo-stable-emp-'));
  const xlsxPath = join(dataDir, 'employees.xlsx');
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  // Place a name-based photo in the stable data dir, under
  // `employees/` — this is where the upload endpoint writes, and
  // also where operators manually copy legacy photos.
  mkdirSync(join(dataDir, 'public', 'uploads', 'employees'), { recursive: true });
  // Minimal 1x1 JPEG bytes (the real factory photos are large, but
  // existence is what the lookup checks; size doesn't matter).
  const MINIMAL_JPEG = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
    0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
    0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
    0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
    0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
    0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
    0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD0, 0xFF, 0xD9,
  ]);
  writeFileSync(join(dataDir, 'public', 'uploads', 'employees', 'Misbah.jpeg'), MINIMAL_JPEG);

  // xlsx without a `photo` column — this is the realistic factory shape
  // because supervisors usually maintain the roster in Excel and don't
  // bother populating photo paths.
  buildEmployeesXlsx(xlsxPath, [
    { emp_no: 109, ac_no: 1, name: 'Misbah', barcode: '00000109', process: 'Tailor (01)' },
  ]);

  await withServer({
    env: {
      ABAYA_DATA_DIR: dataDir,
      EMPLOYEES_XLSX_PATH: xlsxPath,
      // 3s interval so the test doesn't depend on chokidar's debounce
      // (same trick as admin-close-stale-cloud-push.test.mjs).
      EMPLOYEES_XLSX_INTERVAL_MS: '3000',
    },
  }, async ({ base }) => {
    // 1. Wait for the xlsx to load and EMPLOYEES to have the one Misbah row.
    const port = parseInt(base.split(':').pop(), 10);
    await waitForEmployeesCount(port, 1, 10000);
    await sleep(500);

    // 2. Pull the roster and assert emp.photo is the name-based path.
    const r = await fetch(`${base}/api/employees`);
    const j = await r.json();
    const misbah = (j.employees || []).find((e) => e.name === 'Misbah');
    assert.ok(misbah, 'Misbah should be in the roster');
    assert.equal(
      misbah.photo,
      'employees/Misbah.jpeg',
      `expected name-based photo path to be set from STABLE_UPLOADS_PUBLIC, got "${misbah.photo}"`,
    );
  });
});

test('regression v1.2.31: xlsx name-based photo fallback also finds photos in the root (not employees/) subfolder', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'photo-stable-root-'));
  const xlsxPath = join(dataDir, 'employees.xlsx');
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  // Place a name-based photo in the root of the data dir's uploads
  // (not under employees/). Some operators did this for the demo
  // list (Misbah.jpeg directly under public/uploads/).
  mkdirSync(join(dataDir, 'public', 'uploads'), { recursive: true });
  const MINIMAL_JPEG = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
  ]);
  writeFileSync(join(dataDir, 'public', 'uploads', 'Cyril.jpg'), MINIMAL_JPEG);

  buildEmployeesXlsx(xlsxPath, [
    { emp_no: 110, ac_no: 2, name: 'Cyril', barcode: '00000110', process: 'Tailor (02)' },
  ]);

  await withServer({
    env: {
      ABAYA_DATA_DIR: dataDir,
      EMPLOYEES_XLSX_PATH: xlsxPath,
      EMPLOYEES_XLSX_INTERVAL_MS: '3000',
    },
  }, async ({ base }) => {
    const port = parseInt(base.split(':').pop(), 10);
    await waitForEmployeesCount(port, 1, 10000);
    await sleep(500);

    const r = await fetch(`${base}/api/employees`);
    const j = await r.json();
    const cyril = (j.employees || []).find((e) => e.name === 'Cyril');
    assert.ok(cyril, 'Cyril should be in the roster');
    // Path is the root form (no `employees/` prefix) because the file
    // was found at <data>/public/uploads/Cyril.jpg, not under
    // <data>/public/uploads/employees/. The static handler serves
    // /uploads/ from the same root, so /Cyril.jpg resolves correctly.
    assert.equal(
      cyril.photo,
      'Cyril.jpg',
      `expected root-level name-based photo path, got "${cyril.photo}"`,
    );
  });
});
