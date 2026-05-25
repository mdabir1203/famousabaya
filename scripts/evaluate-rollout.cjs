#!/usr/bin/env node
'use strict';

/**
 * End-to-end evaluation of the PM2 + reconciliation + snapshots + alerts rollout.
 *
 * Run:   node -r ./.pnp.cjs scripts/evaluate-rollout.cjs
 * Exit:  0 if every check passes, 1 if anything fails.
 *
 * The script never touches real cloud endpoints. It mocks fetch where needed
 * and uses a temp dir for snapshot artefacts.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log('[' + tag + '] ' + name + (detail ? ' — ' + detail : ''));
}

function check(name, fn) {
  try {
    const detail = fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (e) {
    record(name, false, e && e.message ? e.message : String(e));
  }
}

async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (e) {
    record(name, false, e && e.message ? e.message : String(e));
  }
}

(async function main() {
  console.log('AbaYa Track rollout evaluation');
  console.log('  repo: ' + REPO);
  console.log('  node: ' + process.version);
  console.log('');

  /** ── Section 1: PM2 ecosystem ──────────────────────────────────────────── */
  check('S1 ecosystem.config.cjs loads', () => {
    const eco = require(path.join(REPO, 'ecosystem.config.cjs'));
    assert(Array.isArray(eco.apps) && eco.apps.length >= 1, 'apps array empty');
    const server = eco.apps.find((a) => a.name === 'abaya-server');
    assert(server, 'abaya-server app missing');
    assert(server.autorestart === true, 'autorestart not enabled');
    assert(server.max_restarts > 0, 'max_restarts not set');
    assert(server.min_uptime > 0, 'min_uptime not set');
    return 'apps=' + eco.apps.map((a) => a.name).join(',');
  });

  check('S1 PM2 log dir prepared', () => {
    const logDir = path.join(REPO, 'data', 'pm2-logs');
    assert(fs.existsSync(logDir), logDir + ' missing');
  });

  /** ── Section 2: PM2 boot scripts + docs ───────────────────────────────── */
  check('S2 install/SETUP-PM2-BOOT.ps1 exists', () => {
    const p = path.join(REPO, 'install', 'SETUP-PM2-BOOT.ps1');
    assert(fs.existsSync(p), p + ' missing');
    const txt = fs.readFileSync(p, 'utf8');
    assert(/pm2-windows-startup/.test(txt), 'pm2-windows-startup install missing');
    assert(/pm2 save/.test(txt) || /'save'/.test(txt), 'pm2 save not invoked');
  });

  check('S2 install/CHECK-PM2-STATUS.ps1 exists', () => {
    const p = path.join(REPO, 'install', 'CHECK-PM2-STATUS.ps1');
    assert(fs.existsSync(p), p + ' missing');
    const txt = fs.readFileSync(p, 'utf8');
    assert(/pm2 jlist|jlist/.test(txt), 'pm2 jlist not used');
  });

  check('S2 docs updated to PM2-first', () => {
    const startHere = fs.readFileSync(path.join(REPO, 'START HERE.txt'), 'utf8');
    const office = fs.readFileSync(path.join(REPO, 'docs', 'OFFICE_LAPTOP.md'), 'utf8');
    assert(/SETUP-PM2-BOOT\.ps1/.test(startHere), 'START HERE.txt missing PM2 setup');
    assert(/PM2|pm2/.test(office), 'OFFICE_LAPTOP.md missing PM2 mention');
  });

  check('S2 package.json scripts wired', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const need = ['pm2:setup', 'pm2:status', 'pm2:start', 'pm2:reload', 'pm2:logs',
      'snapshot:db', 'snapshot:verify', 'snapshot:info', 'snapshot:import', 'snapshot:harden'];
    const missing = need.filter((s) => !(s in (pkg.scripts || {})));
    assert(missing.length === 0, 'missing scripts: ' + missing.join(','));
  });

  /** ── Section 3: Reconciliation module behaviour ────────────────────────── */
  await checkAsync('S3 reconcile module local-priority semantics', async () => {
    const reconcile = require(path.join(REPO, 'shared', 'reconcile-cloudflare.cjs'));
    const cloudState = {
      ok: true,
      ingest_lag_ms: 1200,
      active: { e3: { emp_id: 'e3', emp_name: 'Irfan', started_at: 1777400000 * 1000 } },
      logs: [
        { id: 'WL-e1-1777403346', emp_id: 'e1', emp_process: 'Tailor (01)', duration_sec: 3500, ended_at: 1777403346 },
        { id: 'WL-e2-1777403396', emp_id: 'e2', emp_process: 'Tailor (02)', duration_sec: 4200, ended_at: 1777403396 },
        { id: 'WL-e9-2000000000', emp_id: 'e9', emp_process: 'Hand Work', duration_sec: 1000, ended_at: 2000000000 },
      ],
    };
    const localCompletedLogs = [
      { emp_id: 'e1', abaya_id: '00000112', process: 'Tailor (01)', start: 1777399846 * 1000, end: 1777403346 * 1000, duration_sec: 3500 },
      { emp_id: 'e2', abaya_id: '3454', process: 'Stitching', start: 1777399036 * 1000, end: 1777403396 * 1000, duration_sec: 5000 },
      { emp_id: 'e5', abaya_id: '3439', process: 'Button', start: 1777403415 * 1000, end: 1777442768 * 1000, duration_sec: 39353 },
    ];
    const localActive = {
      e3: { emp_id: 'e3', abaya_id: '3439', started_at: 1777400000 * 1000, process: 'Hand Work' },
      e7: { emp_id: 'e7', abaya_id: '3500', started_at: 1777401000 * 1000, process: 'Embroidery' },
    };
    const employees = [
      { id: 'e1', name: 'Misbah', code: 'EMP109', process: 'Tailor (01)' },
      { id: 'e2', name: 'Cyril', code: 'EMP110', process: 'Tailor (02)' },
      { id: 'e3', name: 'Irfan', code: 'EMP111', process: 'Hand Work' },
      { id: 'e5', name: 'Mojeeb', code: 'EMP113', process: 'Button' },
      { id: 'e7', name: 'Anwar', code: 'EMP115', process: 'Embroidery' },
    ];
    const catalog = [
      { id: '00000112', code: '00000112', barcode: '00000112', process: 'Tailor (01)' },
      { id: '3454', code: '3454', barcode: '3454', process: 'Tailor (02)' },
      { id: '3439', code: '3439', barcode: '3439', process: 'Hand Work' },
      { id: '3500', code: '3500', barcode: '3500', process: 'Embroidery' },
    ];

    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, async json() { return cloudState; } });
    const pushed = [];
    try {
      const r = await reconcile.reconcileOnce(
        {
          cfUrl: 'https://example.invalid', cfSecret: 'shhh',
          getLocalState: () => ({
            activeSessions: localActive,
            completedLogs: localCompletedLogs,
            employees, catalog,
          }),
          push: (type, payload) => pushed.push({ type, payload }),
        },
        { log: () => {}, maxRepushPerCycle: 100 }
      );
      assert.strictEqual(r.ok, true, 'reconcile not ok');
      assert.strictEqual(r.replayed_finishes, 1, 'expected 1 finish replay');
      assert.strictEqual(r.replayed_starts, 1, 'expected 1 start replay');
      assert.strictEqual(r.conflicts_resolved_local, 1, 'expected 1 conflict counted');
      assert.strictEqual(r.cloud_only_seen, 1, 'expected 1 cloud-only seen');
      assert.strictEqual(r.hard_failures, 0, 'expected 0 hard_failures');
      const finishes = pushed.filter((p) => p.type === 'session_finish');
      const starts = pushed.filter((p) => p.type === 'session_start');
      assert.strictEqual(finishes.length, 1, 'finish push count');
      assert.strictEqual(finishes[0].payload.emp_id, 'e5', 'finish for e5');
      assert.strictEqual(starts[0].payload.emp_id, 'e7', 'start for e7');
      return 'finishes=1, starts=1, conflicts=1, cloud_only=1';
    } finally {
      global.fetch = originalFetch;
    }
  });

  /** ── Section 4: Ingest hardening ───────────────────────────────────────── */
  check('S4 ingest stats getters exposed in server.js', () => {
    const txt = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
    assert(/function getIngestStats\(/.test(txt), 'getIngestStats missing');
    assert(/REJECTED_QUEUE_FILE/.test(txt), 'rejected queue path missing');
    assert(/appendCeoIngestRejected/.test(txt), 'appendCeoIngestRejected missing');
    assert(/ingestEvents\.emit\('auth-error'/.test(txt), 'auth-error event not emitted');
    assert(/ingestEvents\.emit\('permanent-error'/.test(txt), 'permanent-error event not emitted');
    assert(/queue-backlog/.test(txt), 'queue-backlog wiring missing');
  });

  /** ── Section 5: Verification + runbook ─────────────────────────────────── */
  check('S5 docs/OPERATIONS_RUNBOOK.md exists', () => {
    const p = path.join(REPO, 'docs', 'OPERATIONS_RUNBOOK.md');
    assert(fs.existsSync(p), p + ' missing');
    const txt = fs.readFileSync(p, 'utf8');
    [
      'Reboot persistence',
      'Outage handling',
      'Auth failure path',
      'Permanent rejection path',
      'Local-priority reconciliation',
      'Snapshot integrity',
    ].forEach((needle) => {
      assert(txt.indexOf(needle) >= 0, 'runbook missing: ' + needle);
    });
  });

  /** ── Section 6: Automated SQLite snapshots end-to-end ──────────────────── */
  await checkAsync('S6 snapshot writeSnapshot + verify chain', async () => {
    const sqliteSnapshot = require(path.join(REPO, 'shared', 'sqlite-snapshot.cjs'));
    const snapshotManifest = require(path.join(REPO, 'shared', 'snapshot-manifest.cjs'));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-eval-'));
    const previousSecret = process.env.SNAPSHOT_SIGNING_SECRET;
    process.env.SNAPSHOT_SIGNING_SECRET = 'evaluation-secret';
    try {
      const state = {
        version: 1,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        activeSessions: {},
        completedLogs: [
          {
            emp_id: 'e1', process: 'Tailor (01)',
            abaya_id: '3439',
            start: Date.now() - 3500 * 1000, end: Date.now(),
            duration_sec: 3500,
          },
        ],
        perf: [],
        employees: [{ id: 'e1', name: 'Misbah', code: 'EMP109', process: 'Tailor (01)', color: '#6a5fc1', initials: 'MI' }],
        catalog: [{ id: '3439', code: '3439', barcode: '3439', process: 'Tailor (01)' }],
        workingHours: { profile: 'normal', timezone: 'Asia/Dubai', days: {} },
      };
      const info = await sqliteSnapshot.writeSnapshot(state, { dir: tmpDir, source: 'eval' });
      assert(info && fs.existsSync(info.latestPath), 'latest.db missing');
      assert(info.archivePath && fs.existsSync(info.archivePath), 'archive .db missing');
      const verify = snapshotManifest.verifyManifest({ dir: tmpDir });
      assert(verify.ok === true, 'verify reports tampering: ' + JSON.stringify(verify.errors || []));
      assert(verify.snapshots >= 2, 'expected at least 2 snapshot manifest records (latest + archive), got ' + verify.snapshots);
      const handle = await sqliteSnapshot.openSnapshotDatabase(info.latestPath);
      try {
        const sessionsRow = handle.db.exec("SELECT COUNT(*) AS n FROM sessions")[0];
        const empRow = handle.db.exec("SELECT COUNT(*) AS n FROM employees")[0];
        const catRow = handle.db.exec("SELECT COUNT(*) AS n FROM abaya_catalog")[0];
        assert.strictEqual(Number(sessionsRow.values[0][0]), 1, 'sessions row count');
        assert.strictEqual(Number(empRow.values[0][0]), 1, 'employees row count');
        assert.strictEqual(Number(catRow.values[0][0]), 1, 'catalog row count');
      } finally {
        handle.close();
      }
      return 'tmp=' + tmpDir + ', sessions=1, employees=1, catalog=1';
    } finally {
      if (previousSecret == null) delete process.env.SNAPSHOT_SIGNING_SECRET;
      else process.env.SNAPSHOT_SIGNING_SECRET = previousSecret;
    }
  });

  await checkAsync('S6 snapshot tamper detection', async () => {
    const sqliteSnapshot = require(path.join(REPO, 'shared', 'sqlite-snapshot.cjs'));
    const snapshotManifest = require(path.join(REPO, 'shared', 'snapshot-manifest.cjs'));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-tamper-'));
    const prev = process.env.SNAPSHOT_SIGNING_SECRET;
    process.env.SNAPSHOT_SIGNING_SECRET = 'evaluation-secret';
    try {
      const info = await sqliteSnapshot.writeSnapshot(
        { version: 1, savedAt: Date.now(), active: {}, logs: [], perf: [], employees: [], catalog: [], workingHours: {} },
        { dir: tmpDir, source: 'eval-tamper', archive: true }
      );
      const archive = info.archivePath;
      try { fs.chmodSync(archive, 0o644); } catch (_) { /* ignore */ }
      fs.appendFileSync(archive, Buffer.from([0x00, 0x01]));
      const verify = snapshotManifest.verifyManifest({ dir: tmpDir });
      assert.strictEqual(verify.ok, false, 'expected tampering detected, got ok');
      const reasons = (verify.errors || []).map((e) => e.kind || '').filter(Boolean).join(',');
      assert(/size_mismatch|hash_mismatch/.test(reasons), 'expected size_mismatch or hash_mismatch, got: ' + reasons);
      return 'reasons=' + reasons;
    } finally {
      if (prev == null) delete process.env.SNAPSHOT_SIGNING_SECRET;
      else process.env.SNAPSHOT_SIGNING_SECRET = prev;
    }
  });

  /** ── Section 7: Resend alerts dry-run ──────────────────────────────────── */
  await checkAsync('S7 alerts dry-run + cooldown', async () => {
    const alerts = require(path.join(REPO, 'shared', 'alerting', 'resend-alerts.cjs'));
    const mgr = new alerts.AlertManager({
      apiKey: 'eval-key',
      to: 'qa@example.com',
      from: 'AbaYa Eval <eval@example.com>',
      dedupMs: 60 * 60 * 1000,
      hourlyCap: 5,
      dryRun: true,
      log: () => {},
      getContext: () => ({ host: 'eval-host' }),
    });
    assert.strictEqual(mgr.isEnabled(), true, 'alert manager disabled with valid config');
    const r1 = await mgr.notify('eval-kind', { message: 'first' });
    assert(r1.ok, 'first notify failed');
    const r2 = await mgr.notify('eval-kind', { message: 'second within cooldown' });
    assert(r2.ok === false && r2.reason === 'cooldown', 'cooldown not enforced: ' + JSON.stringify(r2));
    return 'first=ok, second=cooldown';
  });

  check('S7 server wires Resend module', () => {
    const txt = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
    assert(/require\('\.\/shared\/alerting\/resend-alerts\.cjs'\)/.test(txt), 'resend-alerts not required');
    assert(/wireServerEvents\(alertManager/.test(txt), 'alert wiring missing');
    assert(/api\/alerts\/test/.test(txt), 'POST /api/alerts/test missing');
  });

  /** ── Database UI reflection ────────────────────────────────────────────── */
  check('UI dashboard database panel wired', () => {
    const html = fs.readFileSync(path.join(REPO, 'public', 'dashboard.html'), 'utf8');
    const js = fs.readFileSync(path.join(REPO, 'public', 'dashboard.js'), 'utf8');
    assert(/database-status-panel/.test(html), 'panel container missing in HTML');
    assert(/db-ui-source/.test(html), 'db-ui-source tile missing in HTML');
    assert(/updateDatabaseStatusPanel/.test(js), 'render fn missing in JS');
    assert(/db-snapshot/.test(js), 'snapshot tile binding missing in JS');
  });

  check('UI server exposes database block in /api/client-config', () => {
    const txt = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
    assert(/database: \{/.test(txt), 'database block missing in client-config');
    assert(/syncMode: getCeoSyncMode\(\)/.test(txt), 'syncMode not surfaced');
    assert(/sqliteSnapshot: sqliteSnapshot/.test(txt), 'sqliteSnapshot not surfaced');
    assert(/reconcile: reconcile/.test(txt), 'reconcile not surfaced');
  });

  /** ── Launcher GUI wiring ──────────────────────────────────────────────── */
  check('Launcher GUI exposes pm2/sync/reconcile bridges', () => {
    const main = fs.readFileSync(path.join(REPO, 'tools', 'desktop-launcher', 'main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(REPO, 'tools', 'desktop-launcher', 'preload.js'), 'utf8');
    const html = fs.readFileSync(path.join(REPO, 'tools', 'desktop-launcher', 'index.html'), 'utf8');
    const renderer = fs.readFileSync(path.join(REPO, 'tools', 'desktop-launcher', 'renderer.js'), 'utf8');
    assert(/pm2Snapshot\(/.test(main), 'pm2Snapshot helper missing');
    assert(/'reconcile-now'/.test(main), 'reconcile-now IPC missing');
    assert(/'sync-status'/.test(main), 'sync-status IPC missing');
    assert(/reconcileNow/.test(preload), 'preload reconcileNow missing');
    assert(/syncStatus/.test(preload), 'preload syncStatus missing');
    assert(/Sync Mode/.test(html), 'sync mode tile missing in launcher HTML');
    assert(/Reconcile Now/.test(html), 'reconcile button missing in launcher HTML');
    assert(/applySyncStatus/.test(renderer), 'renderer applySyncStatus missing');
  });

  /** ── Module load smoke ─────────────────────────────────────────────────── */
  check('Smoke: ecosystem + shared modules load', () => {
    const eco = require(path.join(REPO, 'ecosystem.config.cjs'));
    require(path.join(REPO, 'shared', 'reconcile-cloudflare.cjs'));
    require(path.join(REPO, 'shared', 'sqlite-snapshot.cjs'));
    require(path.join(REPO, 'shared', 'snapshot-manifest.cjs'));
    require(path.join(REPO, 'shared', 'alerting', 'resend-alerts.cjs'));
    require(path.join(REPO, 'shared', 'offline-report-store.cjs'));
    return 'apps=' + eco.apps.map((a) => a.name).join(',');
  });

  /** ── Summary ──────────────────────────────────────────────────────────── */
  console.log('');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log('Total: ' + results.length + ', passed: ' + passed + ', failed: ' + failed);
  if (failed > 0) {
    console.log('');
    console.log('Failed checks:');
    results.filter((r) => !r.ok).forEach((r) => console.log(' - ' + r.name + ': ' + r.detail));
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error('evaluation crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
