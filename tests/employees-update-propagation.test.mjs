// tests/employees-update-propagation.test.mjs
//
// Regression for the 2026-09-07 production bug:
//
//   "A new employee added via POST /api/employees does not appear on the kiosk
//    until the operator refreshes the browser or the file watcher eventually
//    fires (1.5–2.5s after the write)."
//
// Root cause: in persistEmployeeRosterAndReload's xlsx branch, the
// loadEmployeesFromXlsxFile() call sat INSIDE the try/finally block that
// holds the employeesXlsxWriteInProgress lock. The function's own early-return
// guard (line 3060) saw the lock flag as true and returned without updating
// EMPLOYEES, calling emitEmployeesChanged(), or rewriting EMP_PERF. Result:
//   - The on-disk xlsx had the new row.
//   - The in-memory EMPLOYEES array did NOT.
//   - The socket.io 'employees_update' event was never broadcast.
//   - Kiosk clients (and the LAN dashboard) kept rendering the old roster
//     until the chokidar file watcher eventually fired (chokidar's mtime
//     short-circuit made this 1.5–2.5s, sometimes never).
//   - Worse: a new employee's FIRST Start/Finish session silently failed to
//     reach the cloud (server.js:2240 `if (emp) { pushToCloudflare(...); }`
//     skipped because EMPLOYEES was stale).
//
// Fix applied: move loadEmployeesFromXlsxFile() to AFTER the try/finally so
// the lock is cleared before the reload runs. The in-memory state now updates
// synchronously, the socket event fires, and kiosks re-fetch the new roster
// in <100ms.
//
// What this test proves:
//   1. With EMPLOYEES_XLSX_PATH set, POST /api/employees returns 200.
//   2. Immediately after, GET /api/employees returns the new row.
//   3. The new employee's id follows the AGENTS.md e_bc_<digits> contract.
//   4. The xlsx file on disk was rewritten and contains both rows.
//
// We don't directly test the socket.io broadcast here — that would require
// pulling socket.io-client as a dev dep just for one assertion. Instead we
// verify the side effect that proves the fix: the in-memory EMPLOYEES
// array was updated, which is the precondition for emitEmployeesChanged()
// (line 3094) firing. The existing socket.io wiring is otherwise unchanged
// from the manual-JSON branch which has been working in production.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SERVER_PATH = join(REPO_ROOT, 'server.js');

/**
 * Allocate a free TCP port on 127.0.0.1, then close the listener so server.js
 * can bind. Tiny race window between close and server bind, but acceptable
 * for a single-test process.
 */
async function allocateFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Write a minimal employees.xlsx with the given roster. Mirrors the column
 * headers the server's parseEmployeesXlsxFile expects (server.js:3165):
 *   ['emp_no', 'ac_no', 'name', 'barcode', 'process', 'code', 'color', 'photo']
 */
function buildEmployeesXlsx(filePath, employees) {
  const headers = ['emp_no', 'ac_no', 'name', 'barcode', 'process', 'code', 'color', 'photo'];
  const aoa = [headers];
  for (const e of employees) {
    aoa.push([
      e.emp_no,
      e.ac_no,
      e.name,
      e.barcode,
      e.process,
      e.code || ('EMP' + e.emp_no),
      e.color || '',
      e.photo || '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  XLSX.writeFile(wb, filePath);
}

/** Read the on-disk xlsx and return its rows for assertion. */
function readEmployeesXlsxRows(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false, cellNF: false, cellText: false });
  const sheetName = wb.SheetNames.includes('Employees') ? 'Employees' : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
}

/** Poll /api/health until the server is accepting requests, or fail. */
async function waitForServerReady(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await sleep(150);
  }
  throw new Error(`server did not become ready on port ${port} within ${timeoutMs}ms (last error: ${lastErr && lastErr.message})`);
}

/**
 * Touch an xlsx file's mtime so chokidar (which uses ignoreInitial: true at
 * server.js:4246) sees it as a fresh "change" event and fires the debounced
 * reload. Without this nudge, the server boots with EMPLOYEES = DEFAULT_EMPLOYEES
 * (the 26-row demo list) because nothing in the boot path calls
 * loadEmployeesFromXlsxFile() — the only call sites are the chokidar
 * debounced reload and the persistEmployeeRosterAndReload write path
 * (which is exactly what we're regression-testing). 800ms awaitWriteFinish
 * + 1500ms debounce + small safety margin = 3000ms total wait.
 */
async function bumpXlsxMtimeAndAwaitReload(filePath) {
  const now = new Date();
  utimesSync(filePath, now, now);
  await sleep(3000);
}

/**
 * Spawn server.js with the given env, wait for /api/health, run `scenario`,
 * then kill the child. Returns collected stderr/stdout for diagnostics.
 */
async function withServer({ env }, scenario) {
  const port = await allocateFreePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      // Belt-and-suspenders: don't let any inherited .env in the parent shell
      // override what the test wants. node:test's process.env is the test
      // runner's env, which on dev boxes is usually clean.
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', (d) => { stdout += d.toString(); });

  try {
    await waitForServerReady(port, 20000);
    await scenario({
      port,
      fetch: (url, opts) => fetch(`http://127.0.0.1:${port}${url}`, opts),
    });
  } finally {
    child.kill('SIGTERM');
    // Give it 2s to exit cleanly, then SIGKILL.
    const exited = await Promise.race([
      new Promise((r) => child.once('exit', () => r(true))),
      sleep(2000).then(() => false),
    ]);
    if (!exited) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  }
  return { stderr, stdout };
}

test('xlsx branch: POST /api/employees updates in-memory EMPLOYEES and persists (regression for 2026-09-07 kiosk bug)', async (t) => {
  // Temp ABAYA_DATA_DIR so the test does NOT touch repo data/ or the factory's
  // real .env. The xlsx master lives here too — keeps the test fully isolated.
  const dataDir = mkdtempSync(join(tmpdir(), 'emp-xlsx-test-'));
  const xlsxPath = join(dataDir, 'employees.xlsx');
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });

  // Initial roster: 1 employee. Anything beyond that would be incidental.
  buildEmployeesXlsx(xlsxPath, [
    { emp_no: 200, ac_no: 50, name: 'Initial Worker', barcode: '00000200', process: 'Tailor (01)' },
  ]);

  // Random-ish secret so a parallel test run on the same host can't collide.
  const secret = 'test-secret-' + Math.random().toString(36).slice(2, 10);

  const out = await withServer(
    {
      env: {
        ABAYA_DATA_DIR: dataDir,
        EMPLOYEES_XLSX_PATH: xlsxPath,
        CATALOG_INGEST_SECRET: secret,
        // Disable cloud roster seeding so the local xlsx is the only source.
        CF_WORKER_URL: '',
        CF_INGEST_SECRET: '',
      },
    },
    async ({ fetch }) => {
      // chokidar uses ignoreInitial: true at server.js:4246, so the xlsx is
      // NOT auto-loaded at boot. Touch the file to trigger the debounced
      // reload, then verify the initial state matches the xlsx content.
      await bumpXlsxMtimeAndAwaitReload(xlsxPath);

      // 1. Initial state: 1 employee from the xlsx.
      const beforeRes = await fetch('/api/employees');
      assert.equal(beforeRes.status, 200);
      const before = await beforeRes.json();
      assert.equal(before.employees.length, 1, 'initial roster has 1 employee from xlsx');
      assert.equal(before.employees[0].barcode, '00000200');
      assert.equal(before.employees[0].id, 'e_bc_00000200', 'initial id follows e_bc_<digits> contract');

      // 2. Add a new employee via POST /api/employees.
      const postRes = await fetch('/api/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Pass': secret,
        },
        body: JSON.stringify({
          name: 'New Worker',
          emp_no: 201,
          ac_no: 51,
          barcode: '00000201',
          process: 'Tailor (01)',
        }),
      });
      assert.equal(postRes.status, 200, 'POST /api/employees returns 200');
      const postBody = await postRes.json();
      assert.equal(postBody.ok, true, 'POST body has ok=true');
      assert.equal(postBody.employee.id, 'e_bc_00000201', 'new id follows AGENTS.md e_bc_<digits> rule');

      // 3. CRITICAL: /api/employees must now return 2 employees.
      //    This is exactly what was broken — before the fix, the xlsx branch
      //    called loadEmployeesFromXlsxFile() INSIDE the lock window so the
      //    reload was a no-op, EMPLOYEES stayed at 1, and kiosks saw the old
      //    roster until the chokidar watcher eventually fired.
      const afterRes = await fetch('/api/employees');
      assert.equal(afterRes.status, 200);
      const after = await afterRes.json();
      assert.equal(after.employees.length, 2, 'roster grew from 1 to 2 (in-memory EMPLOYEES updated)');
      const newEmp = after.employees.find((e) => e.barcode === '00000201');
      assert.ok(newEmp, 'new employee appears in /api/employees response');
      assert.equal(newEmp.name, 'New Worker');
      assert.equal(newEmp.id, 'e_bc_00000201');
      assert.equal(newEmp.emp_no, 201);
      assert.equal(newEmp.ac_no, 51);
      assert.equal(newEmp.process, 'Tailor (01)');

      // 4. The on-disk xlsx must also contain the new row. The fix re-reads
      //    via parseEmployeesXlsxFile so the buffer we wrote via atomicWrite
      //    is verified to round-trip.
      assert.ok(existsSync(xlsxPath), 'xlsx file still exists on disk');
      const onDisk = readEmployeesXlsxRows(xlsxPath);
      assert.equal(onDisk.length, 2, 'xlsx on disk has 2 rows');
      const onDiskNew = onDisk.find((r) => String(r.barcode).trim() === '00000201');
      assert.ok(onDiskNew, 'new row exists in xlsx on disk');
      assert.equal(String(onDiskNew.name).trim(), 'New Worker');

      // 5. AC map rebuilt — /api/ac-map (or any endpoint that walks the AC
      //    map) should know about the new AC. We don't add a new endpoint just
      //    for the test; the on-disk + in-memory checks above are sufficient
      //    because rebuildACMap() runs unconditionally inside
      //    loadEmployeesFromXlsxFile() (line 3093) and is what would have
      //    silently stayed stale before the fix.
    },
  );

  // Sanity: no fatal errors in server stderr.
  // (Warnings about "no employees.xlsx" / "DEMO employees" are fine here
  // because we DID set EMPLOYEES_XLSX_PATH and the file exists.)
  assert.ok(
    !out.stderr.includes('Uncaught Exception') && !out.stderr.includes('TypeError:'),
    'no uncaught exceptions in server stderr: ' + out.stderr,
  );
});

test('xlsx branch: duplicate barcode POST returns 409 (no EMPLOYEES update)', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'emp-xlsx-test-'));
  const xlsxPath = join(dataDir, 'employees.xlsx');
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  buildEmployeesXlsx(xlsxPath, [
    { emp_no: 300, ac_no: 60, name: 'Existing Worker', barcode: '00000300', process: 'Tailor (01)' },
  ]);

  const secret = 'test-secret-' + Math.random().toString(36).slice(2, 10);

  await withServer(
    {
      env: {
        ABAYA_DATA_DIR: dataDir,
        EMPLOYEES_XLSX_PATH: xlsxPath,
        CATALOG_INGEST_SECRET: secret,
        CF_WORKER_URL: '',
        CF_INGEST_SECRET: '',
      },
    },
    async ({ fetch }) => {
      // chokidar uses ignoreInitial: true; nudge the xlsx mtime so the
      // initial roster is actually loaded.
      await bumpXlsxMtimeAndAwaitReload(xlsxPath);

      // Try to add an employee with a barcode that already exists.
      const postRes = await fetch('/api/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Pass': secret,
        },
        body: JSON.stringify({
          name: 'Duplicate',
          emp_no: 301,
          ac_no: 61,
          barcode: '00000300', // collision with existing
          process: 'Tailor (01)',
        }),
      });
      assert.equal(postRes.status, 409, 'duplicate barcode returns 409');
      const body = await postRes.json();
      assert.equal(body.ok, false);
      assert.match(body.error, /barcode already exists/i);

      // EMPLOYEES should still be 1 (the failed POST did not corrupt state).
      const after = await (await fetch('/api/employees')).json();
      assert.equal(after.employees.length, 1, 'roster still 1 after rejected duplicate');
    },
  );
});

test('xlsx branch: missing required field returns 400 (no EMPLOYEES update)', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'emp-xlsx-test-'));
  const xlsxPath = join(dataDir, 'employees.xlsx');
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  buildEmployeesXlsx(xlsxPath, [
    { emp_no: 400, ac_no: 70, name: 'Only Worker', barcode: '00000400', process: 'Tailor (01)' },
  ]);

  const secret = 'test-secret-' + Math.random().toString(36).slice(2, 10);

  await withServer(
    {
      env: {
        ABAYA_DATA_DIR: dataDir,
        EMPLOYEES_XLSX_PATH: xlsxPath,
        CATALOG_INGEST_SECRET: secret,
        CF_WORKER_URL: '',
        CF_INGEST_SECRET: '',
      },
    },
    async ({ fetch }) => {
      // chokidar uses ignoreInitial: true; nudge the xlsx mtime so the
      // initial roster is actually loaded.
      await bumpXlsxMtimeAndAwaitReload(xlsxPath);

      // Missing 'process' field.
      const postRes = await fetch('/api/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Pass': secret,
        },
        body: JSON.stringify({
          name: 'No Process',
          emp_no: 401,
          ac_no: 71,
          barcode: '00000401',
        }),
      });
      assert.equal(postRes.status, 400, 'missing required field returns 400');
      const after = await (await fetch('/api/employees')).json();
      assert.equal(after.employees.length, 1, 'roster unchanged after rejected POST');
    },
  );
});
