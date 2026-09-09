// tests/admin-close-stale-cloud-push.test.mjs
//
// Regression for v1.2.31:
//
//   "When an employee tapped Finish but the local EMPLOYEES roster no
//    longer contained their emp_id (most commonly: a mid-session xlsx
//    roster reload that reissued their barcode), the cloud
//    session_finish push was silently skipped. The local delete +
//    COMPLETED_LOGS push happened, but the cloud D1 kept the
//    active_sessions row. Every 30 s refreshCloudToday re-merged the
//    row back into local ACTIVE_SESSIONS and the LAN dashboard
//    re-broadcast the employee as active forever — on both the factory
//    TV and the CEO cloud page — until a server restart or manual
//    intervention."
//
// Root cause: the `req_finishWork` socket handler (server.js:2355) and
// the `/api/admin/close-stale-sessions` admin endpoint (server.js:2481)
// wrapped `pushToCloudflare` inside `if (emp) { ... }`. The `emp` came
// from `EMPLOYEES.find(e => e.id === emp_id)` and was used to enrich
// the payload with emp_name/emp_code/emp_color/emp_initials. The Worker
// only requires emp_id + ended_at (cloudflare/src/handlers/ingest.js
// :118-121), so the enrichment was never load-bearing. Gating the push
// on it was the bug.
//
// Fix applied: the cfPayload is now built unconditionally with
// `emp ? emp.x : null` for the optional fields, and pushToCloudflare is
// called unconditionally. A console.warn fires when the local emp
// lookup misses so a mid-session roster mismatch is visible in the
// server log with the stuck emp_id.
//
// What this test proves:
//   1. With EMPLOYEES_XLSX_PATH set to a temp xlsx, the server starts
//      a session for the one roster employee via socket.io req_startWork.
//   2. The xlsx is rewritten to a different roster, chokidar reloads,
//      and the original emp_id is no longer in EMPLOYEES.
//   3. socket.io req_finishWork for that orphan emp_id still results in
//      a session_finish POST to the fake Cloudflare Worker — the cloud
//      D1 receives its DELETE, and the orphan row will not be reanimated
//      on the next refreshCloudToday tick.
//
// We use a tiny in-process HTTP server as the fake Worker so the test
// is hermetic and doesn't depend on Cloudflare being reachable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const { io } = require('socket.io-client');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SERVER_PATH = join(REPO_ROOT, 'server.js');

const INGEST_SECRET = 'orphan-test-secret-' + Date.now();

/** Build a minimal employees.xlsx with the given roster. */
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

/** Poll /api/debug-kiosk until employeesCount equals expected. */
async function waitForEmployeesCount(port, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let lastRaw = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/debug-kiosk`);
      if (r.ok) {
        const j = await r.json();
        lastRaw = JSON.stringify(j).slice(0, 200);
        last = j.employeesCount;
        if (last === expected) return last;
      } else {
        lastRaw = `status=${r.status}`;
      }
    } catch (e) { lastRaw = `err=${e.message}`; }
    await sleep(200);
  }
  throw new Error(`employeesCount never became ${expected} (last seen: ${last}, lastRaw: ${lastRaw})`);
}

/** Spawn server.js with the given env, wait for /api/health, run
 *  `scenario`, then kill the child. Returns captured stdout/stderr. */
async function withServer({ env }, scenario) {
  const port = await allocateFreePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', (d) => { stdout += d.toString(); });

  try {
    // waitForServerReady equivalent: poll /api/health
    const deadline = Date.now() + 20000;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) break;
      } catch (e) { lastErr = e; }
      await sleep(150);
    }
    return await scenario({
      port,
      base: `http://127.0.0.1:${port}`,
      stdout: () => stdout,
      stderr: () => stderr,
    });
    // Capture for the closure below — node passes these by reference so
    // the scenario function sees the post-scenario stdout even after we
    // return.
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

/** Connect a socket.io client to the running server, return a Promise<socket>. */
function connectSocket(port) {
  return new Promise((resolve, reject) => {
    const sock = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      try { sock.disconnect(); } catch (_) {}
      reject(new Error('socket connect timeout'));
    }, 6000);
    sock.on('connect', () => { clearTimeout(timer); resolve(sock); });
    sock.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Emit a socket event and wait for the ack callback. */
function emitWithAck(sock, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 5000);
    sock.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

test('regression v1.2.31: req_finishWork pushes session_finish to cloud even when local emp lookup fails', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orphan-cloud-push-'));
  const xlsxPath = join(dataDir, 'employees.xlsx');
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });

  // 1. Stand up a tiny fake Cloudflare Worker that captures every POST to /api/event.
  const fakeWorkerPort = await allocateFreePort();
  const capturedPushes = [];
  // 24/7 working hours — so the test doesn't fail when CI runs at 3 AM
  // Dubai time. Same shape the real Worker would return from
  // /api/settings/working-hours. server.js:720 only updates the cache
  // when `days` is an object, so this exact shape is what the server expects.
  const ALL_WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const ALWAYS_OPEN = [['00:00', '23:59']];
  const alwaysOnConfig = {
    profile: 'test-always-on',
    timezone: 'Asia/Dubai',
    days: Object.fromEntries(ALL_WEEK.map((d) => [d, ALWAYS_OPEN])),
  };
  const fakeWorker = createHttpServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/event') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          capturedPushes.push({ url: req.url, headers: req.headers, body: parsed });
        } catch (_) { /* ignore parse errors */ }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, event: 'session_finish' }));
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/settings/working-hours')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, working_hours: alwaysOnConfig }));
      return;
    }
    // /api/state pulls from the Worker; return empty so refreshCloudToday
    // is a no-op merge and doesn't interfere with our test of the push path.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, active: {}, logs: [], perf: [] }));
  });
  await new Promise((resolve, reject) => {
    fakeWorker.once('error', reject);
    fakeWorker.listen(fakeWorkerPort, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((r) => fakeWorker.close(() => r())));

  // 2. Initial roster: one employee (Misbah at ac_no=1).
  buildEmployeesXlsx(xlsxPath, [
    { emp_no: 109, ac_no: 1, name: 'Misbah', barcode: '00000109', process: 'Tailor (01)' },
  ]);

  await withServer({
    env: {
      ABAYA_DATA_DIR: dataDir,
      EMPLOYEES_XLSX_PATH: xlsxPath,
      // Force a 3s interval reload so the test doesn't depend on
      // chokidar's awaitWriteFinish debounce masking the second mtime
      // bump. The default 24h is fine in production but unusable in a
      // unit test. server.js:2968 reads this env var and clamps the
      // interval to a positive integer.
      EMPLOYEES_XLSX_INTERVAL_MS: '3000',
      CF_WORKER_URL: `http://127.0.0.1:${fakeWorkerPort}`,
      CF_INGEST_SECRET: INGEST_SECRET,
    },
  }, async ({ port, base, stdout: scenarioStdout }) => {
    // 3. Nudge the xlsx mtime so chokidar's first reload happens, then
    //    wait for the roster to settle on the single Misbah row.
    const now1 = new Date();
    utimesSync(xlsxPath, now1, now1);
    await waitForEmployeesCount(port, 1, 10000);

    // 4. Connect a socket.io client.
    const sock = await connectSocket(port);
    t.after(() => { try { sock.disconnect(); } catch (_) {} });

    // 5. Start a session for Misbah via socket.io. The kio's normal flow
    //    is: lookup by ac_no → emit req_startWork with the resolved emp_id.
    //    We mirror that exactly so the test exercises the real call path.
    const lookupRes = await emitWithAck(sock, 'req_lookup', 1);
    assert.equal(lookupRes.ok, true, `lookup should succeed; got ${JSON.stringify(lookupRes)}`);
    const misbahId = lookupRes.employee.id;
    assert.ok(misbahId.startsWith('e_bc_'), `xlsx-derived id should follow e_bc_<digits> contract; got ${misbahId}`);

    const startRes2 = await emitWithAck(sock, 'req_startWork', {
      emp_id: misbahId,
      abaya_id: 'a1',
      process: 'Tailor (01)',
    });
    assert.equal(startRes2.ok, true, `start should succeed; got ${JSON.stringify(startRes2)}`);

    // 6. Verify the session is live (in ACTIVE_SESSIONS).
    const stateRes1 = await fetch(`${base}/api/state`);
    const stateBody1 = await stateRes1.json();
    const activeMap1 = stateBody1.state && stateBody1.state.active;
    assert.ok(
      activeMap1 && misbahId in activeMap1,
      `Misbah's session should be live before roster swap. got keys: ${Object.keys(activeMap1 || {})}`,
    );

    // 7. Rewrite the xlsx to a *different* roster (Cyril at ac_no=2). The
    //    mtime bump + chokidar debounce will replace EMPLOYEES with
    //    [Cyril], rebuild AC_MAP, and call emitEmployeesChanged. Misbah's
    //    id is no longer in EMPLOYEES but ACTIVE_SESSIONS still has the row.
    buildEmployeesXlsx(xlsxPath, [
      { emp_no: 110, ac_no: 2, name: 'Cyril', barcode: '00000110', process: 'Tailor (02)' },
    ]);
    const now2 = new Date(now1.getTime() + 5000); // strict mtime advance
    utimesSync(xlsxPath, now2, now2);
    // The chokidar's awaitWriteFinish debounce (800ms) is unreliable in
    // tests because buildEmployeesXlsx + utimesSync happen in <50ms
    // and the chokidar sometimes debounces straight past both events.
    // The EMPLOYEES_XLSX_INTERVAL_MS=3000 env var above guarantees a
    // reload happens within ~3s regardless of chokidar. The mtime check
    // inside loadEmployeesFromXlsxFile (server.js:3094) will accept the
    // new file because the mtime has advanced.
    await waitForEmployeesCount(port, 1, 10000);
    // Wait one more poll cycle so the EMPLOYEES array is actually Cyril
    // (employeesCount is updated synchronously inside loadEmployeesFromXlsxFile,
    // but the assertion below is what actually guards the test).
    await sleep(500);

    // 8. Sanity-check: the local active map still holds Misbah's row.
    const stateRes2 = await fetch(`${base}/api/state`);
    const stateBody2 = await stateRes2.json();
    const activeMap2 = stateBody2.state && stateBody2.state.active;
    assert.ok(
      activeMap2 && misbahId in activeMap2,
      `Misbah's session should still be live after roster swap. got keys: ${Object.keys(activeMap2 || {})}`,
    );

    // 9. Sanity-check the pre-condition: only Cyril is in EMPLOYEES now
    //    (Misbah was removed by the roster swap). This is what makes the
    //    `emp = EMPLOYEES.find(...)` lookup in the Finish handler return
    //    undefined, which is the exact bug condition.
    const dbgPre = await (await fetch(`${base}/api/debug-kiosk`)).json();
    const dbgEmpList = await (await fetch(`${base}/api/employees`)).json();
    const empIds = (dbgEmpList.employees || []).map((e) => ({ id: e.id, name: e.name, ac_no: e.ac_no }));
    assert.equal(dbgPre.employeesCount, 1, 'precondition: only 1 employee in roster after swap');
    assert.equal(dbgPre.acMapSize, 1, 'precondition: only 1 ac_no mapped after swap');
    assert.equal(empIds[0].id, `e_bc_00000110`, `precondition: the remaining employee must be Cyril (got ${empIds[0].id})`);

    // 10. Capture pre-call push count. Then fire req_finishWork for Misbah.
    //     The handler should:
    //       - find ACTIVE_SESSIONS[misbahId] (in-memory row is still there)
    //       - NOT find EMPLOYEES.find(e => e.id === misbahId) (was removed)
    //       - still pushToCloudflare('session_finish', { emp_id: misbahId, ... })
    //         because emp_name etc. are optional on the Worker side.
    const pushesBefore = capturedPushes.length;
    const finishRes = await emitWithAck(sock, 'req_finishWork', { emp_id: misbahId });
    assert.equal(finishRes.ok, true, `finish should succeed; got ${JSON.stringify(finishRes)}`);

    // 10. Give the fire-and-forget push a moment to land at the fake Worker.
    await sleep(500);

    // 11. The critical assertion: the fake Worker received a session_finish
    //     push for the orphan emp_id, even though the local emp lookup
    //     failed. On the pre-fix code, this assertion FAILS because the
    //     `if (emp)` gate at server.js:2355 skips pushToCloudflare.
    const newPushes = capturedPushes.slice(pushesBefore);
    const sessionFinishForOrphan = newPushes.filter(
      (p) => p && p.body && p.body.type === 'session_finish' && p.body.payload && p.body.payload.emp_id === misbahId,
    );
    assert.equal(
      sessionFinishForOrphan.length,
      1,
      `expected exactly 1 session_finish push for emp_id=${misbahId}, got ${sessionFinishForOrphan.length}. ` +
      `all new pushes: ${JSON.stringify(newPushes.map((p) => p.body && p.body.type))}`,
    );
    // Bonus: the request must carry the X-Ingest-Secret header so the
    // Worker would accept it in production. The header is set by
    // tryPostCeoIngestOnce at server.js:551-562.
    const sentHeaders = sessionFinishForOrphan[0].headers || {};
    assert.equal(
      sentHeaders['x-ingest-secret'],
      INGEST_SECRET,
      'push must carry the factory ingest secret so the Worker accepts the DELETE',
    );
  });
});
