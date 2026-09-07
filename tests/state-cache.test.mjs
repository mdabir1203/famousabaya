// tests/state-cache.test.mjs
//
// v1.2.26 — D1 free-tier mitigation. The CEO dashboard auto-refreshes
// /api/state every few seconds, and each call triggers a D1.batch of 8+
// prepared statements. At 5.8M rows_read in 24h on the free tier (5M/day),
// this single endpoint is a major contributor. The fix is an in-memory
// 5s response cache, keyed by URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleState,
  _invalidateStateCache,
  _resetStateCacheForTest,
} from '../cloudflare/src/handlers/state.js';

function makeFakeEnv() {
  // Count D1.prepare() / .batch() / .first() / .all() invocations.
  let prepCount = 0;
  let allCount = 0;
  let batchCount = 0;
  const mkPrep = () => {
    prepCount++;
    return {
      bind: () => mkPrep(),
      first: async () => null,
      all: async () => { allCount++; return { results: [] }; },
      run: async () => ({ success: true, meta: { changes: 0 } }),
    };
  };
  return {
    env: {
      DB: {
        prepare: () => mkPrep(),
        batch: async (stmts) => {
          batchCount++;
          // return a result shaped like a D1 batch: array of {success, results, meta}
          const out = stmts.map(() => ({ success: true, results: [] }));
          return out;
        },
      },
      FACTORY_TZ: 'Asia/Dubai',
      DEFAULT_CATALOG_PROCESS: 'Tailor (01)',
    },
    getCounts: () => ({ prepCount, allCount, batchCount }),
  };
}

test('cache miss triggers D1.batch; second call within TTL is a cache hit', async () => {
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const url = new URL('https://example.com/api/state?days=1');
  const r1 = await handleState(fake.env, url);
  assert.equal(r1.status, 200, 'first call returns 200');
  const c1 = fake.getCounts();
  assert.ok(c1.batchCount >= 1, 'first call hits D1 at least once');

  // Second call with the same URL within the 5s TTL: must NOT hit D1.
  const r2 = await handleState(fake.env, url);
  assert.equal(r2.status, 200, 'second call returns 200');
  const c2 = fake.getCounts();
  assert.equal(c2.batchCount, c1.batchCount, 'second call within TTL is a cache hit (no extra D1 batch)');
  // v1.2.27: cache hit response includes a `_cache: { hit: true, age_sec: N }`
  // field so the CEO dashboard can render a "data is Ns old" banner.
  const body2 = await r2.json();
  assert.equal(body2._cache.hit, true, 'cache-hit response carries _cache.hit = true');
  assert.ok(typeof body2._cache.age_sec === 'number', 'cache-hit response carries _cache.age_sec');
});

test('different query params bypass the cache (different cache key)', async () => {
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const urlA = new URL('https://example.com/api/state?days=1');
  const urlB = new URL('https://example.com/api/state?days=7');
  await handleState(fake.env, urlA);
  const c1 = fake.getCounts();
  await handleState(fake.env, urlB);
  const c2 = fake.getCounts();
  assert.ok(c2.batchCount > c1.batchCount, 'different query params trigger a fresh D1 batch');
});

test('_invalidateStateCache forces a fresh D1 batch on the next call', async () => {
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const url = new URL('https://example.com/api/state?days=1');
  await handleState(fake.env, url);
  const c1 = fake.getCounts();
  _invalidateStateCache();
  await handleState(fake.env, url);
  const c2 = fake.getCounts();
  assert.ok(c2.batchCount > c1.batchCount, 'after invalidation, next call hits D1 again');
});
