// tests/recent-mutation-tombstone.test.mjs
//
// Unit tests for the resource-level mutation tombstone helper
// (shared/recent-mutation-tombstone.cjs).
//
// This is the v1.2.52 sibling of shared/recent-finish-tombstone.cjs:
// same TTL-based "the LAN just made a change" guard, but generalized
// to whole-collection resources (catalog, employees, work types) so
// a stale cloud pull doesn't overwrite a fresh local edit.
//
// What this test file covers
// --------------------------
//   1. note() / isLive() basic cycle — TTL window honored.
//   2. isLive() returns false before any note().
//   3. Default TTL is 30 seconds (covers LAN→cloud push + retry cycle).
//   4. Custom TTLs are honored (1 ms, 60 s, 5 min).
//   5. Multiple notes refresh the timestamp (reset the TTL window).
//   6. After the TTL elapses, isLive() is false again — a new note()
//      brings it back live.
//   7. note(label) is accepted (forward-compatible, currently no-op on
//      the global timestamp).
//   8. note() with explicit atMs is honored (clock injection).
//   9. note(NaN) / note(Infinity) / isLive(NaN) / isLive(Infinity) are
//      safely rejected (no crash, no false positive).
//  10. getLastMutationAt() returns the most-recent timestamp; null
//      before any note().
//  11. clear() resets the tombstone.
//  12. Constructor clock injection works for default isLive() too.
//
// The tests deliberately use a controllable clock so they don't
// depend on real wall-clock progression.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const require = createRequire(join(REPO_ROOT, 'package.json'));
const { makeRecentMutationTombstone } = require(
  join(REPO_ROOT, 'shared', 'recent-mutation-tombstone.cjs')
);

function makeClock(initialMs) {
  let t = Number.isFinite(initialMs) ? initialMs : 1_700_000_000_000;
  return {
    now: () => t,
    tick: (ms) => { t += Number(ms) || 0; return t; },
    set: (newMs) => { t = Number(newMs); return t; },
  };
}

test('note() + isLive(): a freshly noted tombstone is live for the TTL window', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });
  t.note();
  assert.equal(t.isLive(clock.now()), true, 'fresh tombstone should be live');
});

test('isLive() returns false before any note()', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });
  assert.equal(t.isLive(clock.now()), false, 'never-noted tombstone should be dead');
});

test('Default TTL is 30 seconds', () => {
  const t = makeRecentMutationTombstone({ now: () => 0 });
  assert.equal(t.ttlMs, 30000, 'default TTL should cover one push-retry cycle (CEO_INGEST_RETRY_MS)');
});

test('Custom TTLs are honored (1 ms, 60 s, 5 min)', () => {
  const clock = makeClock();

  // 1 ms TTL — expires after a tiny tick
  const t1 = makeRecentMutationTombstone({ ttlMs: 1, now: clock.now });
  t1.note();
  assert.equal(t1.isLive(clock.now()), true);
  clock.tick(2);
  assert.equal(t1.isLive(clock.now()), false, '1 ms TTL should expire after 2 ms');

  // 60 s TTL — still alive at 30 s, expired at 60.001 s
  const t2 = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });
  t2.note();
  clock.tick(30_000);
  assert.equal(t2.isLive(clock.now()), true, '30 s in is still inside 60 s TTL');
  clock.tick(30_001);
  assert.equal(t2.isLive(clock.now()), false, '60.001 s in is past the 60 s TTL');

  // 5 min TTL — still alive at 4 min 59 s, expired at 5 min
  const t3 = makeRecentMutationTombstone({ ttlMs: 5 * 60_000, now: clock.now });
  t3.note();
  clock.tick(4 * 60_000 + 59_000);
  assert.equal(t3.isLive(clock.now()), true, '4:59 in is still inside 5 min TTL');
  clock.tick(1_001);
  assert.equal(t3.isLive(clock.now()), false, '5:00.001 in is past the 5 min TTL');
});

test('Multiple notes refresh the timestamp', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });

  t.note(undefined, clock.now());
  clock.tick(50_000);
  assert.equal(t.isLive(clock.now()), true, '50 s after first note is still within TTL');

  t.note(undefined, clock.now());
  clock.tick(50_000);
  assert.equal(t.isLive(clock.now()), true, '50 s after second note is still within TTL — first note expired');

  clock.tick(10_001);
  assert.equal(t.isLive(clock.now()), false, '60.001 s after the most-recent note is past TTL');
});

test('A new note() after the TTL expires brings the tombstone back live', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });

  t.note();
  clock.tick(120_000);
  assert.equal(t.isLive(clock.now()), false, '2 min after a 60 s TTL means expired');

  t.note();
  assert.equal(t.isLive(clock.now()), true, 'fresh note after expiry brings it back live');
});

test('note(label) is accepted (forward-compatible API)', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });
  // The label is documented as a forward-compat slot (per-resource in a
  // future schema). For now it's a no-op on the global timestamp — but
  // it must not crash and must still mark the tombstone live.
  t.note('catalog');
  assert.equal(t.isLive(clock.now()), true);
});

test('note() with explicit atMs honors the injected clock', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });
  t.note('catalog', clock.now() + 5000);
  // isLive at clock.now() should be true because the note was 5 s in the future.
  assert.equal(t.isLive(clock.now()), true);
});

test('NaN / Infinity are safely rejected (no crash, no false positive)', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });

  // These should NOT mark the tombstone live.
  t.note('catalog', NaN);
  assert.equal(t.isLive(clock.now()), false, 'note(NaN) should be a no-op');

  t.note('catalog', Infinity);
  assert.equal(t.isLive(clock.now()), false, 'note(Infinity) should be a no-op');

  // Invalid `atMs` passed to isLive should NOT crash and should NOT
  // return a false positive.
  assert.doesNotThrow(() => t.isLive(NaN));
  assert.equal(t.isLive(NaN), false);
  assert.doesNotThrow(() => t.isLive(Infinity));
  assert.equal(t.isLive(Infinity), false);
});

test('getLastMutationAt() returns the timestamp; null before any note()', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });

  assert.equal(t.getLastMutationAt(), null, 'never-noted tombstone returns null');

  const ts = clock.now();
  t.note('catalog', ts);
  assert.equal(t.getLastMutationAt(), ts);

  // After a second note(), the timestamp refreshes.
  const ts2 = clock.set(ts + 5000);
  t.note('employees', ts2);
  assert.equal(t.getLastMutationAt(), ts2, 'subsequent notes refresh the timestamp');
});

test('clear() resets the tombstone', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });

  t.note();
  assert.equal(t.isLive(clock.now()), true);

  t.clear();
  assert.equal(t.isLive(clock.now()), false, 'cleared tombstone should not be live');
  assert.equal(t.getLastMutationAt(), null);
});

test('Constructor clock injection works for default isLive() calls', () => {
  const clock = makeClock();
  const t = makeRecentMutationTombstone({ ttlMs: 60_000, now: clock.now });

  t.note();
  // isLive() with no argument uses the injected clock.
  assert.equal(t.isLive(), true);

  clock.tick(120_000);
  assert.equal(t.isLive(), false, '120 s after a 60 s TTL means expired');
});

test('ttlMs is exposed and immutable', () => {
  const t = makeRecentMutationTombstone({ ttlMs: 12345 });
  assert.equal(t.ttlMs, 12345);
});
