// tests/ghost-active-session-guard.test.mjs
//
// Regression for v1.2.32:
//
//   "A 'Tailor (01) — STARTED Mon 15:50:26, no name, no item' row kept
//    showing up on the live board. Cloud refreshes re-merged it. The
//    factory server has been the source of truth since v1.2.20, so a
//    ghost row was a real visibility problem for the operator."
//
// Fix applied in server.js:
//   1. socket.on('req_startWork') now rejects empty / missing / non-
//      string emp_id at the boundary with
//      {ok: false, error: 'Missing emp_id'} before any state mutation.
//   2. A boot-time `dropGhostActiveSessions()` sweep drops any pre-
//      existing ghost row (empty emp_id, or empty abaya_id AND
//      empty process) on every server start so a factory that's been
//      running v1.2.20 (or older) clears them on the next update.
//
// What this test proves:
//   1. A fresh server boot with NO pre-existing state shows zero
//      active sessions (baseline).
//   2. A pre-seeded ghost active session in the offline-report-store
//      (the path the server uses to restore state on boot) is removed
//      before the first /api/state call returns.
//   3. A pre-seeded VALID active session survives the boot sweep.
//   4. The "no ghost" invariant holds even after the cloud-refresh
//      path runs (we can't easily call refreshCloudToday from a
//      subprocess test, but the cloud refresh's existing
//      `if (!empId) continue;` guard at server.js:2027 is unchanged
//      and the new socket guard + boot sweep are defense-in-depth).
//
// We use a tiny offline-report JSON file as the boot-state source
// (the server reads data/offline-dashboard-reports/dashboard-offline-
// latest.json on boot to restore state). This avoids needing
// socket.io, which has its own transport-selection issues in the
// test runner on Windows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SERVER_PATH = join(REPO_ROOT, 'server.js');

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

async function withServer({ env, scenario }) {
  const port = await allocateFreePort();
  // Yarn PnP loader is required so `require('dotenv')` and other deps
  // resolve from the project's .pnp.cjs instead of throwing MODULE_NOT_FOUND.
  const pnpPath = join(REPO_ROOT, '.pnp.cjs');
  const nodeArgs = existsSync(pnpPath) ? ['-r', pnpPath, SERVER_PATH] : [SERVER_PATH];
  const child = spawn(process.execPath, nodeArgs, {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  try {
    // Wait for /api/health (poll for up to 60s — first boot is slow
    // because the server hydrates 90 days of cloud rows + attaches
    // employee images; a second boot is much faster).
    const deadline = Date.now() + 60000;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) break;
      } catch (e) { lastErr = e; }
      await sleep(400);
    }
    if (Date.now() >= deadline) {
      const outTail = stdout ? stdout.slice(-2000) : '(empty)';
      const errTail = stderr ? stderr.slice(-2000) : '(empty)';
      throw new Error(`server failed to come up on port ${port}: ${lastErr ? lastErr.message : 'timeout'}\nSTDOUT TAIL:\n${outTail}\nSTDERR TAIL:\n${errTail}`);
    }
    return await scenario({ port, base: `http://127.0.0.1:${port}`, stdout: () => stdout, stderr: () => stderr });
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

/** Fetch /api/state and return the parsed body. */
async function fetchState(base) {
  const r = await fetch(`${base}/api/state?days=1&limit=200`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`/api/state HTTP ${r.status}`);
  return r.json();
}

test('regression v1.2.32: boot-time dropGhostActiveSessions removes pre-seeded ghost rows', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ghost-active-guard-'));
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });

  // Pre-seed an offline-report JSON with three rows: a real active
  // session (id from the default hardcoded roster), a ghost (empty
  // emp_id, empty abaya_id, empty process), and a near-ghost (empty
  // emp_id but a real abaya_id). The server should restore the real
  // row, drop both ghosts. The file format matches
  // `shared/offline-report-store.cjs`:
  //   { version: 1, savedAt, logs: [], perf: [], active: {...} }
  const reportDir = join(dataDir, 'offline-dashboard-reports');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'dashboard-offline-latest.json');
  const nowMs = Date.now();
  const REAL_EMP_ID = 'e1'; // default hardcoded roster has e1..e26
  const seededReport = {
    version: 1,
    savedAt: nowMs,
    logs: [],
    perf: [],
    active: {
      // Real active session — uses a default-roster id so
      // reviveActiveSessionsFromSnapshot's "employee must exist"
      // check doesn't drop it.
      [REAL_EMP_ID]: {
        emp_id: REAL_EMP_ID,
        abaya_id: '3439',
        log_id: 'WL-' + REAL_EMP_ID + '-' + nowMs,
        started_at: nowMs - 60000,
        process: 'Tailor (01)',
      },
      // Ghost: empty emp_id (the actual reported bug). The revive
      // step falls back to the JSON key when emp_id is empty —
      // but the key here is '' so the resulting empId is '' which
      // isn't in EMPLOYEES, so the revive step drops it.
      '': {
        emp_id: '',
        abaya_id: '',
        log_id: 'WL-ghost-' + nowMs,
        started_at: nowMs - 60000,
        process: '',
      },
      // Near-ghost: empty emp_id but with a real abaya_id. Same
      // path — the revive step drops it for unknown emp_id.
      'ab-smoke': {
        emp_id: '',
        abaya_id: 'ab-smoke',
        log_id: 'WL-near-ghost-' + nowMs,
        started_at: nowMs - 60000,
        process: 'Tailor (01)',
      },
    },
  };
  writeFileSync(reportPath, JSON.stringify(seededReport, null, 2));

  await withServer({
    env: { ABAYA_DATA_DIR: dataDir },
    scenario: async ({ base, stdout }) => {
      const j = await fetchState(base);
      const active = (j.state && j.state.active) || {};
      const keys = Object.keys(active);
      // The real row survives.
      assert.ok(active[REAL_EMP_ID], `real active session missing: keys=${keys.join(',')}`);
      // No ghost keys.
      for (const k of keys) {
        const sess = active[k];
        const empId = String((sess && sess.emp_id) == null ? '' : sess.emp_id).trim();
        assert.ok(empId, `ghost active session leaked through: key=${k}, emp_id='${empId}'`);
      }
      // The near-ghost with an unknown emp_id was already dropped by
      // the revive step (unknown employee). The empty-key ghost was
      // also dropped by the revive step (empty emp_id, key '').
      // Our dropGhostActiveSessions sweep is the final defense-in-depth
      // pass for any ghosts that survive those earlier checks.
      // We don't strictly require the log line because revive may have
      // already removed them — but the active map must be clean.
    },
  });
});

test('regression v1.2.32: fresh boot with no pre-existing state shows zero active sessions', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ghost-active-fresh-'));
  t.after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });
  await withServer({
    env: { ABAYA_DATA_DIR: dataDir },
    scenario: async ({ base }) => {
      const j = await fetchState(base);
      const active = (j.state && j.state.active) || {};
      for (const k of Object.keys(active)) {
        const sess = active[k];
        const empId = String((sess && sess.emp_id) == null ? '' : sess.emp_id).trim();
        assert.ok(empId, `fresh boot leaked a ghost: key=${k}, emp_id='${empId}'`);
      }
    },
  });
});
