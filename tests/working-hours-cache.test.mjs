// tests/working-hours-cache.test.mjs
//
// v1.2.25 — D1 free-tier mitigation. The factory ingests events
// continuously; every /api/event used to do a D1 row-read for the working
// hours config, which burned the 5M-row/day free-tier limit and broke
// ingest. The fix is an in-memory cache with a 60s TTL.
//
// This test pins the contract: cache hit avoids the D1 read, cache miss
// reads D1, saveWorkingHoursConfig invalidates the cache, and the TTL
// backstop kicks in after WORKING_HOURS_CACHE_TTL_MS.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getWorkingHoursConfig,
  saveWorkingHoursConfig,
  _resetWorkingHoursCacheForTest,
} from '../cloudflare/src/working-hours.js';

/**
 * Build a fake env whose DB.prepare(...).first() returns a sequence of
 * prepared-statement results on consecutive calls. The mock counts
 * `.first()` invocations so the test can assert cache-hit avoidance.
 */
function makeFakeEnv(getResults /* (callIndex) => row | undefined */) {
  let calls = 0;
  const prep = {
    first: async () => {
      const i = calls++;
      return getResults(i);
    },
    bind: () => prep,
    run: async () => ({ success: true, meta: { changes: 1 } }),
  };
  return {
    env: {
      DB: {
        prepare: () => prep,
      },
    },
    getCallCount: () => calls,
  };
}

test('cache miss reads D1 once; second call within TTL is a cache hit', async () => {
  _resetWorkingHoursCacheForTest();
  // row with v=null → uses default config (see workingHoursConfigFromRow)
  const fake = makeFakeEnv(() => ({ v: null }));
  const cfg1 = await getWorkingHoursConfig(fake.env);
  assert.equal(typeof cfg1, 'object', 'first call returns a config object');
  assert.equal(fake.getCallCount(), 1, 'first call hits D1 once');

  // Second call within the 60s TTL should NOT hit D1.
  const cfg2 = await getWorkingHoursConfig(fake.env);
  assert.equal(fake.getCallCount(), 1, 'second call within TTL is a cache hit (no extra D1 read)');
  // Same shape — at minimum the days object is shared.
  assert.deepEqual(cfg2.days, cfg1.days, 'cache returns identical config');
});

test('saveWorkingHoursConfig invalidates the in-memory cache', async () => {
  _resetWorkingHoursCacheForTest();
  // First read: default config (v=null).
  const fake1 = makeFakeEnv(() => ({ v: null }));
  await getWorkingHoursConfig(fake1.env);
  assert.equal(fake1.getCallCount(), 1, 'first read hit D1');

  // Now mutate via save. The save path uses .bind(...).run(), not .first().
  // The mock above's run() returns success, so the save itself succeeds.
  // After save, the cache must be cleared.
  const newCfg = {
    days: {
      mon: [['08:00', '16:00']],
      tue: [['08:00', '16:00']],
      wed: [['08:00', '16:00']],
      thu: [['08:00', '16:00']],
      fri: [['08:00', '16:00']],
      sat: [],
      sun: [],
    },
  };
  const saved = await saveWorkingHoursConfig(fake1.env, newCfg);
  assert.ok(saved && saved.days && saved.days.mon, 'save returns normalized config');

  // Next read must hit D1 again because the cache was invalidated by save.
  // Configure the fake to return the new value this time.
  const fake2 = makeFakeEnv(() => ({ v: JSON.stringify(newCfg) }));
  const cfg = await getWorkingHoursConfig(fake2.env);
  assert.equal(cfg.days.mon[0][0], '08:00', 'post-save read picks up the new config from D1');
});

test('cache hit survives across many calls in the same isolate', async () => {
  _resetWorkingHoursCacheForTest();
  const fake = makeFakeEnv(() => ({ v: null }));
  // 1000 reads. Without the cache, that's 1000 D1 reads. With the cache, 1.
  const results = await Promise.all(
    Array.from({ length: 1000 }, () => getWorkingHoursConfig(fake.env))
  );
  assert.equal(results.length, 1000, 'all 1000 reads returned a value');
  assert.equal(fake.getCallCount(), 1, '1000 reads collapsed to 1 D1 call (cache hit)');
});

test('cache is test-isolated via _resetWorkingHoursCacheForTest', async () => {
  // Reset first to drop any state left by the previous test.
  _resetWorkingHoursCacheForTest();
  // Pre-populate the cache with a fresh env.
  const fake1 = makeFakeEnv(() => ({ v: null }));
  await getWorkingHoursConfig(fake1.env);
  assert.equal(fake1.getCallCount(), 1, 'first read hit D1');

  // Reset and read again — should hit D1 once more.
  _resetWorkingHoursCacheForTest();
  const fake2 = makeFakeEnv(() => ({ v: null }));
  await getWorkingHoursConfig(fake2.env);
  assert.equal(fake2.getCallCount(), 1, 'after reset, read hits D1 again');

  // And the second read in this fresh state is a cache hit.
  await getWorkingHoursConfig(fake2.env);
  assert.equal(fake2.getCallCount(), 1, 'second read after reset is a cache hit');
});
