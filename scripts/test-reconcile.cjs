#!/usr/bin/env node
'use strict';

/**
 * Deterministic smoke test for shared/reconcile-cloudflare.cjs.
 *
 * Runs without contacting any real Worker: we mock global fetch and the push()
 * callback to assert local-priority semantics (missing-in-cloud → repush,
 * conflicts → counted but not overwritten, cloud-only → recorded).
 *
 * Usage:
 *   node -r ./.pnp.cjs scripts/test-reconcile.cjs
 */

const assert = require('assert');
const reconcile = require('../shared/reconcile-cloudflare.cjs');

function makeFakeFetch(cloudState) {
  return async function fakeFetch(_url, _init) {
    return {
      ok: true,
      status: 200,
      async json() { return cloudState; },
    };
  };
}

async function main() {
  /** State the cloud reports back. Last 100 sessions + active. */
  const cloudState = {
    ok: true,
    ingest_lag_ms: 1200,
    active: {
      e3: { emp_id: 'e3', emp_name: 'Irfan', started_at: 1777400000 * 1000 },
    },
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
    { id: 'e1', name: 'Misbah', code: 'EMP109', process: 'Tailor (01)', color: '#6a5fc1', initials: 'MI' },
    { id: 'e2', name: 'Cyril', code: 'EMP110', process: 'Tailor (02)', color: '#a78bfa', initials: 'CY' },
    { id: 'e3', name: 'Irfan', code: 'EMP111', process: 'Hand Work', color: '#c2ef4e', initials: 'IR' },
    { id: 'e5', name: 'Mojeeb', code: 'EMP113', process: 'Button', color: '#fa7faa', initials: 'MO' },
    { id: 'e7', name: 'Anwar', code: 'EMP115', process: 'Embroidery', color: '#7ad', initials: 'AN' },
  ];

  const catalog = [
    { id: '00000112', code: '00000112', barcode: '00000112', process: 'Tailor (01)' },
    { id: '3454', code: '3454', barcode: '3454', process: 'Tailor (02)' },
    { id: '3439', code: '3439', barcode: '3439', process: 'Hand Work' },
    { id: '3500', code: '3500', barcode: '3500', process: 'Embroidery' },
  ];

  const originalFetch = global.fetch;
  global.fetch = makeFakeFetch(cloudState);

  const pushed = [];
  const push = (type, payload) => {
    pushed.push({ type, payload });
  };

  try {
    const r = await reconcile.reconcileOnce(
      {
        cfUrl: 'https://example.invalid',
        cfSecret: 'shhh',
        getLocalState: () => ({
          activeSessions: localActive,
          completedLogs: localCompletedLogs,
          employees,
          catalog,
        }),
        push,
      },
      {
        log: (...args) => console.log('  -', ...args),
        maxRepushPerCycle: 100,
      }
    );

    console.log('result:', JSON.stringify(r, null, 2));

    assert.strictEqual(r.ok, true, 'reconcile should succeed against mocked cloud');
    assert.strictEqual(r.cloud_logs_seen, 3, 'sees all 3 cloud logs');
    assert.strictEqual(r.local_logs_seen, 3, 'reports local log count');
    assert.strictEqual(r.replayed_finishes, 1, 'exactly 1 missing-in-cloud finish replayed (e5)');
    assert.strictEqual(r.replayed_starts, 1, 'exactly 1 missing-in-cloud start replayed (e7)');
    assert.strictEqual(r.conflicts_resolved_local, 1, 'e2 has different process AND duration');
    assert.strictEqual(r.cloud_only_seen, 1, 'e9 is cloud-only');
    assert.strictEqual(r.hard_failures, 0, 'no hard failures');

    /** Check pushed payload semantics. */
    const finishPushes = pushed.filter((p) => p.type === 'session_finish');
    const startPushes = pushed.filter((p) => p.type === 'session_start');
    assert.strictEqual(finishPushes.length, 1, 'one session_finish push');
    assert.strictEqual(finishPushes[0].payload.emp_id, 'e5', 'finish push is for e5');
    assert.strictEqual(finishPushes[0].payload.ended_at, 1777442768, 'finish push uses sec timestamp');
    assert.strictEqual(startPushes.length, 1, 'one session_start push');
    assert.strictEqual(startPushes[0].payload.emp_id, 'e7', 'start push is for e7');

    console.log('\nAll assertions passed.');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((err) => {
  console.error('test-reconcile failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
