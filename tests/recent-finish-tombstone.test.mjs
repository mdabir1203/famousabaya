// tests/recent-finish-tombstone.test.mjs
//
// Unit tests for the recent-finish tombstone helper.
//
// The tombstone is the v1.2.51 fix for the Arman Reza resurrection bug:
// after a worker taps Finish at the kiosk, refreshCloudToday (every
// 30 s) used to unconditionally re-add the worker from the cloud's
// stale `active_sessions` row. The tombstone lets the merge skip the
// worker for a TTL window so the LAN's "Arman is finished" stays
// authoritative until the cloud catches up.
//
// What this test file covers
// --------------------------
//   1. note() / isLive() basic cycle — TTL window honored.
//   2. isLive() returns false after the TTL elapses.
//   3. Custom TTL is respected (1 ms, 60 s, 5 min).
//   4. Multiple emp_ids are tracked independently.
//   5. note() with the same emp_id refreshes the timestamp (resets the
//      TTL window).
//   6. consume() removes the tombstone AND reports whether it was live.
//   7. pruneExpired() removes only the expired entries.
//   8. Edge cases: empty / whitespace / non-string emp_ids are ignored.
//   9. Default TTL is 10 minutes (matches server.js RECENT_FINISH_TOMBSTONE_MS).
//  10. Constructor clock injection works (tests run with a fake clock).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const require = createRequire(join(REPO_ROOT, 'package.json'));
const { makeRecentFinishTombstone } = require(join(REPO_ROOT, 'shared', 'recent-finish-tombstone.cjs'));

// A controllable clock — starts at a fixed instant, advances only when
// tests call `clock.tick(ms)`. Default Date.now() is captured at
// module load so the "real" baseline exists for sanity checks.
function makeClock(initialMs) {
  let t = Number.isFinite(initialMs) ? initialMs : 1_700_000_000_000;
  const api = {
    now: () => t,
    tick: (ms) => {
      t += Number(ms) || 0;
      return api.now();
    },
    set: (newMs) => {
      t = Number(newMs);
      return api.now();
    },
  };
  return api;
}

test('note() + isLive(): a freshly noted tombstone is live for the TTL window', () => {
  const clock = makeClock();
  const t = makeRecentFinishTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('e_bc_00000135'); // Arman Reza
  assert.equal(t.isLive('e_bc_00000135'), true, 'fresh tombstone should be live');
});

test('isLive() returns false once the TTL has elapsed', () => {
  const clock = makeClock();
  const t = makeRecentFinishTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('e_bc_00000135');
  clock.tick(30_000);
  assert.equal(t.isLive('e_bc_00000135'), true, '30 s in is still inside 60 s TTL');
  clock.tick(30_001);
  assert.equal(t.isLive('e_bc_00000135'), false, '60.001 s in is past the TTL');
});

test('Custom TTLs are honored (1 ms, 1 s, 5 min)', () => {
  const clock = makeClock();
  // 1 ms TTL
  const t1 = makeRecentFinishTombstone({ ttlMs: 1, now: clock.now });
  t1.note('a');
  assert.equal(t1.isLive('a'), true);
  clock.tick(2);
  assert.equal(t1.isLive('a'), false, '1 ms TTL should expire after 2 ms');

  // 1 s TTL
  clock.set(0);
  const t2 = makeRecentFinishTombstone({ ttlMs: 1000, now: clock.now });
  t2.note('b');
  clock.tick(999);
  assert.equal(t2.isLive('b'), true);
  clock.tick(2);
  assert.equal(t2.isLive('b'), false, '1 s TTL should expire after 1001 ms');

  // 5 min TTL
  clock.set(0);
  const t3 = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000, now: clock.now });
  t3.note('c');
  clock.tick(4 * 60 * 1000);
  assert.equal(t3.isLive('c'), true);
  clock.tick(60 * 1000 + 1);
  assert.equal(t3.isLive('c'), false, '5 min TTL should expire at 5 min + 1 ms');
});

test('Multiple emp_ids are tracked independently', () => {
  const clock = makeClock();
  const t = makeRecentFinishTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('arman_reza');
  t.note('wahid');
  t.note('alazar');

  clock.tick(45_000);
  // Re-note arman_reza to refresh his TTL — he was just finished again
  t.note('arman_reza');

  clock.tick(30_000); // total 75 s since first note
  assert.equal(t.isLive('arman_reza'), true, 'refreshed at 45 s, only 30 s since refresh');
  assert.equal(t.isLive('wahid'), false, '75 s since first note, 60 s TTL — expired');
  assert.equal(t.isLive('alazar'), false, '75 s since first note, 60 s TTL — expired');
});

test('note() with the same emp_id refreshes the timestamp (resets the TTL window)', () => {
  const clock = makeClock();
  const t = makeRecentFinishTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('a');
  clock.tick(50_000);
  assert.equal(t.isLive('a'), true, '50 s into 60 s TTL');
  t.note('a'); // refresh
  clock.tick(50_000); // 100 s since first note, but 50 s since refresh
  assert.equal(t.isLive('a'), true, 'note() reset the clock');
  clock.tick(11_000); // 61 s since refresh
  assert.equal(t.isLive('a'), false, 'past the refreshed TTL');
});

test('consume() removes the tombstone and reports whether it was live', () => {
  const clock = makeClock();
  const t = makeRecentFinishTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('a');
  assert.equal(t.consume('a'), true, 'was live before consume');
  assert.equal(t.isLive('a'), false, 'gone after consume');
  assert.equal(t.consume('a'), false, 'no longer live');
});

test('pruneExpired() removes only the expired entries', () => {
  const clock = makeClock();
  const t = makeRecentFinishTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('a');
  clock.tick(30_000);
  t.note('b'); // b has a fresh 60 s window starting at t=30 s
  clock.tick(31_000); // a is at 61 s (expired), b is at 31 s (live)

  const removed = t.pruneExpired();
  assert.equal(removed, 1, 'only a should be pruned');
  assert.equal(t.isLive('a'), false);
  assert.equal(t.isLive('b'), true);
  assert.equal(t.size(), 1);
});

test('Edge cases: empty / whitespace / non-string emp_ids are ignored', () => {
  const clock = makeClock();
  const t = makeRecentFinishTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('');
  t.note('   ');
  t.note(null);
  t.note(undefined);
  t.note(123);
  t.note(0);
  t.note({});
  assert.equal(t.size(), 0, 'no tombstone should be created');
  assert.equal(t.isLive(''), false);
  assert.equal(t.isLive(null), false);
  assert.equal(t.isLive('   '), false);
  assert.equal(t.isLive({}), false);
});

test('isLive() on a never-noted emp_id returns false (no false-positive)', () => {
  const t = makeRecentFinishTombstone({ ttlMs: 60_000 });
  assert.equal(t.isLive('never-noted'), false);
});

test('Default TTL is 10 minutes when not specified', () => {
  const t = makeRecentFinishTombstone();
  assert.equal(t.ttlMs, 10 * 60 * 1000, '10-minute default matches server.js RECENT_FINISH_TOMBSTONE_MS');
});

test('Invalid TTL falls back to the 10-minute default', () => {
  const t1 = makeRecentFinishTombstone({ ttlMs: 0 });
  assert.equal(t1.ttlMs, 10 * 60 * 1000);
  const t2 = makeRecentFinishTombstone({ ttlMs: -100 });
  assert.equal(t2.ttlMs, 10 * 60 * 1000);
  const t3 = makeRecentFinishTombstone({ ttlMs: NaN });
  assert.equal(t3.ttlMs, 10 * 60 * 1000);
  const t4 = makeRecentFinishTombstone({ ttlMs: 'not a number' });
  assert.equal(t4.ttlMs, 10 * 60 * 1000);
});

test('clear() empties the tombstone store', () => {
  const t = makeRecentFinishTombstone({ ttlMs: 60_000 });
  t.note('a');
  t.note('b');
  assert.equal(t.size(), 2);
  t.clear();
  assert.equal(t.size(), 0);
  assert.equal(t.isLive('a'), false);
});

test('isLive() accepts an explicit atMs (deterministic for snapshot tests)', () => {
  const t = makeRecentFinishTombstone({ ttlMs: 60_000 });
  t.note('a', 1_000_000);
  // Without atMs: uses Date.now() which is the real wall clock; the
  // tombstone was noted at 1_000_000 (1970-ish), so it's almost
  // certainly expired. We don't assert the wall-clock result here —
  // what matters is that explicit atMs is respected.
  assert.equal(t.isLive('a', 1_000_000 + 30_000), true, '30 s after note is still live');
  assert.equal(t.isLive('a', 1_000_000 + 60_000), false, 'exactly at TTL is expired (boundary)');
  assert.equal(t.isLive('a', 1_000_000 + 59_999), true, '1 ms before TTL is still live');
});

test('Integration: tombstone blocks a resurrection race across a 5-min window', () => {
  // This is the actual Arman Reza scenario.
  //
  // T=0    LAN: Arman taps Finish. note() the tombstone.
  // T=2s   refreshCloudToday runs. The cloud still has Arman's stale row.
  //        The merge sees isLive('e_bc_00000135') === true → SKIP.
  // T=30s  The session_finish push retries and succeeds.
  // T=33s  refreshCloudToday runs again. Cloud agrees: no row for Arman.
  //        Nothing to merge.
  // T=4m59s Still inside the 5-min window — merge still skips (defense in depth).
  // T=5m1ms  Tombstone expires. If Arman has actually started a new session
  //           and the cloud is in sync, refreshCloudToday correctly brings him in.
  const clock = makeClock(1_700_000_000_000);
  const t = makeRecentFinishTombstone({ ttlMs: 5 * 60 * 1000, now: clock.now });

  // T=0
  t.note('e_bc_00000135');

  // T=2s — resurrection attempt
  clock.tick(2_000);
  assert.equal(t.isLive('e_bc_00000135'), true, 'merge must skip Arman at T=2s');

  // T=30s — push retries
  clock.tick(28_000);
  assert.equal(t.isLive('e_bc_00000135'), true, 'merge must skip Arman at T=30s');

  // T=33s — cloud agrees
  clock.tick(3_000);
  assert.equal(t.isLive('e_bc_00000135'), true, 'merge skips at T=33s too (no harm, nothing to merge)');

  // T=4m 59s — still inside the 5-min window (elapsed = 299_000 ms)
  clock.tick(299_000 - 33_000);
  assert.equal(clock.now() - 1_700_000_000_000, 299_000, 'sanity: clock is at T=4m59s');
  assert.equal(t.isLive('e_bc_00000135'), true, 'merge skips at T=4m59s');

  // T=5m 1ms — tombstone expires (elapsed = 300_001 ms, > 5*60*1000)
  clock.tick(1_001);
  assert.equal(clock.now() - 1_700_000_000_000, 300_001, 'sanity: clock is at T=5m1ms');
  assert.equal(t.isLive('e_bc_00000135'), false, 'tombstone expires, legitimate merge allowed');
});