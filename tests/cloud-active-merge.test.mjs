// tests/cloud-active-merge.test.mjs
//
// Unit tests for the cloud-active merge helper.
//
// This is the v1.2.51 regression test for the Arman Reza resurrection
// bug. Before this fix, refreshCloudToday unconditionally re-added a
// worker to ACTIVE_SESSIONS whenever the cloud still had the worker's
// stale `active_sessions` row — which it does for 30-60 s after a
// worker Finish tap, because the cloud's session_finish push takes a
// while to reach and be processed.
//
// The helper now consults a recent-finish tombstone and skips any
// emp_id whose tombstone is live. This file proves:
//   1. Without a tombstone, the merge adds (legacy behavior).
//   2. With a tombstone, the merge skips that emp_id for the TTL
//      window and counts it as suppressed.
//   3. After the tombstone expires, the merge resumes adding.
//   4. A real new Start within the tombstone window still works (LAN
//      has the worker active locally, so the merge path is "update
//      fields", not "add").
//   5. Roster translation (e_bc_<barcode> → local eN) still works.
//   6. Mixed workloads — some tombstoned, some not — all behave as
//      expected in one merge pass.
//
// What this test file does NOT cover (covered elsewhere):
//   - The server-subprocess integration of refreshCloudToday
//     (server.js → setInterval 30 s). See tests/ghost-active-session-
//     guard.test.mjs for the boot-time sweep pattern; v1.2.51 doesn't
//     change that flow.
//   - The actual session_finish push to the cloud. See
//     shared/recent-finish-tombstone.test.mjs for the tombstone TTL
//     edge cases; this file focuses on the merge decision.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const require = createRequire(join(REPO_ROOT, 'package.json'));
const { mergeCloudActiveIntoLocal, translateCloudEmpIdToLocal } = require(
  join(REPO_ROOT, 'shared', 'cloud-active-merge.cjs')
);
const { makeRecentFinishTombstone } = require(
  join(REPO_ROOT, 'shared', 'recent-finish-tombstone.cjs')
);

// Controllable clock for the tombstone. The merge tests pass an
// explicit TTL (5 min) so they're independent of the helper's default
// (10 min — matches server.js RECENT_FINISH_TOMBSTONE_MS).
function makeClock(initialMs) {
  let t = Number.isFinite(initialMs) ? initialMs : 1_700_000_000_000;
  return {
    now: () => t,
    tick: (ms) => { t += Number(ms) || 0; return t; },
    set: (newMs) => { t = Number(newMs); return t; },
  };
}

// A trivial Map-backed "ACTIVE_SESSIONS" stand-in with get/set callbacks
// the helper expects.
function makeLocalMap(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    map: m,
    getLocal: (id) => m.get(id),
    setLocal: (id, val) => { m.set(id, val); },
  };
}

test('baseline: without a tombstone, the merge adds the worker (legacy behavior)', () => {
  // This is the resurrection behavior the user reported. Without the
  // tombstone, the merge re-adds Arman Reza. With the tombstone, it
  // doesn't (next test).
  const local = makeLocalMap();
  const cloudActive = {
    'k1': {
      emp_id: 'e_bc_00000135', // Arman Reza
      process: 'Tailor (01)',
      abaya_id: 'CF111',
      started_at: 1_700_000_000, // seconds (cloud format)
      emp_name: 'Arman Raza',
    },
  };
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
  });
  assert.equal(stats.activeAdded, 1);
  assert.equal(stats.activeReplaced, 0);
  assert.equal(stats.activeSuppressedByTombstone, 0);
  assert.ok(local.map.has('e_bc_00000135'), 'worker should be in local map');
});

test('v1.2.51 fix: tombstoned emp_id is SKIPPED — no resurrection', () => {
  // The Arman Reza scenario:
  //   T=0:    Arman taps Finish. recentFinishTombstone.note('e_bc_00000135').
  //   T=2s:   refreshCloudToday runs. Cloud still has Arman. With the
  //           tombstone live, the merge MUST skip him.
  const clock = makeClock();
  const tombstone = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000, now: clock.now });
  tombstone.note('e_bc_00000135');

  const local = makeLocalMap();
  const cloudActive = {
    'k1': {
      emp_id: 'e_bc_00000135',
      process: 'Tailor (01)',
      abaya_id: 'CF111',
      started_at: 1_700_000_000,
      emp_name: 'Arman Raza',
    },
  };
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    tombstone,
  });
  assert.equal(stats.activeAdded, 0, 'no resurrection');
  assert.equal(stats.activeReplaced, 0, 'no resurrection');
  assert.equal(stats.activeSuppressedByTombstone, 1, 'counted as suppressed');
  assert.equal(local.map.size, 0, 'local map stays empty');
});

test('After tombstone expires, the merge resumes adding the worker', () => {
  // T=0: note the tombstone. T=4m: still live. T=6m: expired.
  const clock = makeClock();
  const tombstone = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000, now: clock.now });
  tombstone.note('e_bc_00000135');

  // Local map is empty (Arman was finished earlier).
  const local = makeLocalMap();
  const cloudActive = {
    'k1': { emp_id: 'e_bc_00000135', process: 'Tailor (01)', started_at: 1_700_000_000 },
  };

  // T=4m — tombstone still live
  clock.tick(4 * 60 * 1000);
  let stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    tombstone,
  });
  assert.equal(stats.activeAdded, 0, 'still skipped at T=4m');
  assert.equal(local.map.size, 0);

  // T=6m — tombstone expired. The cloud STILL has the worker (e.g.
  // because the LAN's session_finish push never landed). The merge
  // now adds him back — this is the "real" resurrection case the
  // tombstone eventually gives up on, surfacing the underlying
  // problem to the operator rather than hiding it forever.
  clock.tick(2 * 60 * 1000);
  stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    tombstone,
  });
  assert.equal(stats.activeAdded, 1, 'resumes after TTL');
  assert.ok(local.map.has('e_bc_00000135'));
});

test('A real new Start within the tombstone window still works', () => {
  // T=0: Arman finishes (tombstone set).
  // T=30s: Arman starts again. ACTIVE_SESSIONS['e_bc_00000135'] = {started_at: T+30s}.
  // T=33s: refreshCloudToday runs. Cloud has stale row (started_at = T=0,
  //        from before the Finish). The merge sees the local entry
  //        exists → "update fields only" path, which does NOT add a
  //        new row. The tombstone check happens BEFORE the local
  //        check though — so the tombstone blocks even the "update"
  //        path. That's intentional: the cloud is stale relative to
  //        the LAN's reality, and the LAN's fields are authoritative.
  //        The local entry remains correct without the cloud's
  //        (stale) display fields overwriting it.
  const clock = makeClock();
  const tombstone = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000, now: clock.now });
  tombstone.note('e_bc_00000135');

  clock.tick(30_000); // T=30s
  const localStartedAt = clock.now();
  const local = makeLocalMap({
    'e_bc_00000135': {
      emp_id: 'e_bc_00000135',
      abaya_id: 'CF222', // different abaya from the new Start
      started_at: localStartedAt,
      process: 'Tailor (01)',
      log_id: 'WL-start2-' + localStartedAt,
    },
  });

  // Cloud's stale row still has the OLD start time + OLD abaya from
  // before the Finish.
  const cloudActive = {
    'k1': { emp_id: 'e_bc_00000135', process: 'Tailor (02)', abaya_id: 'CF111', started_at: 0 },
  };

  clock.tick(3_000); // T=33s
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    tombstone,
  });
  assert.equal(stats.activeAdded, 0, 'no add');
  assert.equal(stats.activeReplaced, 0, 'no update — tombstone still wins');
  assert.equal(stats.activeSuppressedByTombstone, 1, 'cloud merge skipped');
  // Local entry untouched — abaya_id still CF222 (the new Start's abaya).
  assert.equal(local.map.get('e_bc_00000135').abaya_id, 'CF222', 'LAN fields preserved');
});

test('After tombstone expires AND Arman has a real new session, cloud view syncs in', () => {
  // T=0:    Finish → tombstone.
  // T=30s:  Start again (local has him, with new started_at).
  // T=6m:   tombstone expires. Cloud now agrees (Start push landed).
  // T=6m30s: refreshCloudToday runs. Tombstone gone, local has him,
  //          merge sees local entry → updates display fields. New
  //          process / emp_name from cloud sync in.
  const clock = makeClock();
  const tombstone = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000, now: clock.now });
  tombstone.note('e_bc_00000135');

  clock.tick(30_000); // T=30s
  const local = makeLocalMap({
    'e_bc_00000135': {
      emp_id: 'e_bc_00000135', abaya_id: 'CF222', started_at: clock.now(),
      process: 'Tailor (01)', log_id: 'WL-start2-' + clock.now(),
    },
  });
  const cloudActive = {
    'k1': { emp_id: 'e_bc_00000135', process: 'Tailor (01)', abaya_id: 'CF222', started_at: Math.floor(clock.now() / 1000), emp_name: 'Arman Raza' },
  };

  clock.tick(5 * 60 * 1000 + 30_000); // T=6m30s
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    tombstone,
  });
  assert.equal(stats.activeAdded, 0);
  assert.equal(stats.activeReplaced, 1, 'cloud agrees, fields updated');
  assert.equal(stats.activeSuppressedByTombstone, 0);
  assert.equal(local.map.get('e_bc_00000135').emp_name, 'Arman Raza', 'display field synced');
});

test('Roster translation: cloud e_bc_<barcode> → local eN (hardcoded roster)', () => {
  // LAN uses hardcoded roster (e1, e2, ...). Cloud pushes e_bc_<barcode>.
  const local = makeLocalMap();
  const bcToLocalEmp = {
    '121': { id: 'e5' }, // Alazar in the hardcoded roster
    '00000121': { id: 'e5' },
  };
  const cloudActive = {
    'k1': { emp_id: 'e_bc_00000121', process: 'Button', started_at: 1_700_000_000, emp_name: 'Alazar' },
  };
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    bcToLocalEmp,
  });
  assert.equal(stats.activeAdded, 1);
  assert.ok(local.map.has('e5'), 'translated to local e5');
  assert.equal(local.map.get('e5').emp_id, 'e5');
});

test('Mixed workload: tombstoned + non-tombstoned workers in one merge pass', () => {
  const clock = makeClock();
  const tombstone = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000, now: clock.now });
  tombstone.note('e_bc_00000135'); // Arman Reza — tombstoned
  // Wahid (e_bc_00000138) is NOT tombstoned.

  const local = makeLocalMap();
  const cloudActive = {
    'k1': { emp_id: 'e_bc_00000135', process: 'Tailor (01)', started_at: 1_700_000_000 }, // tombstoned
    'k2': { emp_id: 'e_bc_00000138', process: 'Packaging', started_at: 1_700_000_100 },     // free
  };
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    tombstone,
  });
  assert.equal(stats.activeAdded, 1, 'Wahid added');
  assert.equal(stats.activeReplaced, 0);
  assert.equal(stats.activeSuppressedByTombstone, 1, 'Arman suppressed');
  assert.ok(!local.map.has('e_bc_00000135'), 'no Arman');
  assert.ok(local.map.has('e_bc_00000138'), 'Wahid present');
});

test('translateCloudEmpIdToLocal: pass-through for non-e_bc_ ids', () => {
  assert.equal(translateCloudEmpIdToLocal('e_bc_00000135', {}), 'e_bc_00000135');
  assert.equal(translateCloudEmpIdToLocal('e5', {}), 'e5');
  assert.equal(translateCloudEmpIdToLocal('', {}), '');
  assert.equal(translateCloudEmpIdToLocal(null, {}), '');
  assert.equal(translateCloudEmpIdToLocal(undefined, {}), '');
});

test('translateCloudEmpIdToLocal: matches both padded and unpadded barcodes', () => {
  const map = {
    '121': { id: 'e5' },
    '00000121': { id: 'e5' },
  };
  assert.equal(translateCloudEmpIdToLocal('e_bc_121', map), 'e5');
  assert.equal(translateCloudEmpIdToLocal('e_bc_00000121', map), 'e5');
});

test('Defensive: missing callbacks return zeroed stats (no crash)', () => {
  const cloudActive = { 'k1': { emp_id: 'e_bc_00000135' } };
  // No getLocal / setLocal — helper should bail safely.
  const stats = mergeCloudActiveIntoLocal(cloudActive, {});
  assert.equal(stats.activeAdded, 0);
  assert.equal(stats.activeReplaced, 0);
  assert.equal(stats.activeSuppressedByTombstone, 0);
});

test('Defensive: cloudActive is not an object → zeroed stats', () => {
  const local = makeLocalMap();
  assert.deepEqual(mergeCloudActiveIntoLocal(null, { getLocal: local.getLocal, setLocal: local.setLocal }), {
    activeAdded: 0, activeReplaced: 0, activeSuppressedByTombstone: 0,
  });
  assert.deepEqual(mergeCloudActiveIntoLocal(undefined, { getLocal: local.getLocal, setLocal: local.setLocal }), {
    activeAdded: 0, activeReplaced: 0, activeSuppressedByTombstone: 0,
  });
  assert.deepEqual(mergeCloudActiveIntoLocal('not-an-object', { getLocal: local.getLocal, setLocal: local.setLocal }), {
    activeAdded: 0, activeReplaced: 0, activeSuppressedByTombstone: 0,
  });
});

test('Per-row emp_id extraction: also accepts the row KEY as a fallback', () => {
  // The cloud sometimes returns state.active keyed by emp_id directly
  // (no per-row emp_id field). The helper should fall back to the key.
  const local = makeLocalMap();
  const cloudActive = {
    'e_bc_00000135': { process: 'Tailor (01)', abaya_id: 'CF111', started_at: 1_700_000_000 }, // no emp_id field
  };
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
  });
  assert.equal(stats.activeAdded, 1);
  assert.ok(local.map.has('e_bc_00000135'));
});

test('Per-row emp_id extraction: rows with no emp_id and no e_ key are skipped', () => {
  const local = makeLocalMap();
  const cloudActive = {
    'some-random-key': { process: 'Tailor (01)', started_at: 1_700_000_000 },
  };
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
  });
  assert.equal(stats.activeAdded, 0);
  assert.equal(local.map.size, 0);
});

test('startup hydration is correct: cloud has a worker the LAN doesn\'t know → add', () => {
  // At boot, ACTIVE_SESSIONS is empty (server just started). Cloud has
  // a row from another factory laptop. Tombstone is empty (in-memory
  // store is empty on boot). Merge adds the worker — correct behavior.
  const tombstone = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000 });
  const local = makeLocalMap(); // empty
  const cloudActive = {
    'k1': { emp_id: 'e_bc_00000130', process: 'Hand Work', abaya_id: 'CF333', started_at: 1_700_000_000, emp_name: 'Naserulla' },
  };
  const stats = mergeCloudActiveIntoLocal(cloudActive, {
    getLocal: local.getLocal,
    setLocal: local.setLocal,
    tombstone,
  });
  assert.equal(stats.activeAdded, 1);
  assert.equal(stats.activeSuppressedByTombstone, 0);
  assert.equal(local.map.get('e_bc_00000130').emp_name, 'Naserulla');
});