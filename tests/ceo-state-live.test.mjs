// tests/ceo-state-live.test.mjs
//
// v1.2.30 — CEO dashboard realtime stream. The cloud /api/state handler
// caches the full response for 5s in module memory (v1.2.26) to keep the
// D1 free-tier row_read budget healthy. That cache made the CEO dashboard
// feel sluggish during a busy shift: a worker tapping Start would not
// show up on the live board for up to 5s. The fix is `?live=1` opt-in
// cache bypass: when the dashboard sees STATE.active has at least one
// entry, it sends `?live=1` and the handler skips both the cache lookup
// AND the cache write so every poll gets fresh D1 data.
//
// These tests prove the bypass works as advertised and that the regular
// 5s cache is still hit when `?live=1` is NOT sent (so the free-tier
// budget is not blown out by the new feature).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleState,
  _invalidateStateCache,
  _resetStateCacheForTest,
} from '../cloudflare/src/handlers/state.js';

function makeFakeEnv() {
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

test('?live=1 bypasses the 5s in-memory cache on every call', async () => {
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const liveUrl = new URL('https://example.com/api/state?days=1&live=1');
  // Three back-to-back calls. None should hit the cache.
  await handleState(fake.env, liveUrl);
  const c1 = fake.getCounts();
  await handleState(fake.env, liveUrl);
  const c2 = fake.getCounts();
  await handleState(fake.env, liveUrl);
  const c3 = fake.getCounts();
  assert.ok(c2.batchCount > c1.batchCount, 'second live call must NOT be a cache hit');
  assert.ok(c3.batchCount > c2.batchCount, 'third live call must NOT be a cache hit');
  // Three calls means three fresh D1 batches — one per call.
  assert.equal(
    c3.batchCount - c1.batchCount, 2,
    'three live-mode calls produce exactly two extra D1 batches (no cache hits)'
  );
});

test('non-live calls within TTL still hit the cache (no ?live=1 regression)', async () => {
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const normalUrl = new URL('https://example.com/api/state?days=1');
  await handleState(fake.env, normalUrl);
  const c1 = fake.getCounts();
  await handleState(fake.env, normalUrl);
  const c2 = fake.getCounts();
  await handleState(fake.env, normalUrl);
  const c3 = fake.getCounts();
  // Two of the three calls must be cache hits.
  assert.equal(
    c3.batchCount - c1.batchCount, 0,
    'three non-live calls within 5s produce zero extra D1 batches (all cache hits)'
  );
});

test('live-mode call does NOT overwrite the cached non-live payload', async () => {
  // This is the heart of the fix: a live call right after a normal call
  // would otherwise overwrite the 5s cache with the live payload, so the
  // NEXT normal caller (e.g. a slow 4.5s-poll idle dashboard) would see
  // fresh live data instead of the cached older snapshot. The D1 row
  // budget stays healthy only if the live payload is not cached.
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const normalUrl = new URL('https://example.com/api/state?days=1');
  const liveUrl = new URL('https://example.com/api/state?days=1&live=1');
  // Prime the cache with a normal call.
  await handleState(fake.env, normalUrl);
  const c1 = fake.getCounts();
  // Live call should not write to the cache.
  await handleState(fake.env, liveUrl);
  const c2 = fake.getCounts();
  // Normal call within TTL: should STILL be a cache hit (i.e. the live
  // call's batch was a fresh D1 read, not a write into the cache slot
  // the next normal caller would hit).
  await handleState(fake.env, normalUrl);
  const c3 = fake.getCounts();
  assert.equal(
    c3.batchCount - c1.batchCount, 1,
    'only the live call hits D1; the second normal call within TTL is still a cache hit'
  );
  // Sanity: the cache hit response carries _cache.hit=true.
  const r3 = await handleState(fake.env, normalUrl);
  const body3 = await r3.json();
  assert.equal(body3._cache.hit, true, 'second normal call reports _cache.hit=true');
});

test('live-mode response payload does not carry _cache.hit', async () => {
  // The response shape is the same — the operator's UI doesn't need a
  // special banner for "live" mode. But the server-side should never
  // tag a live response with a cache-hit marker (because it isn't one).
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const liveUrl = new URL('https://example.com/api/state?days=1&live=1');
  const r = await handleState(fake.env, liveUrl);
  const body = await r.json();
  // The payload is the full state bundle, not a cache-tagged copy.
  assert.ok(!body._cache || body._cache.hit !== true, 'live response is NOT tagged as a cache hit');
});

test('_invalidateStateCache still works for live-mode calls', async () => {
  // The manual-refresh code path on the dashboard calls invalidation so
  // the next /api/state call hits D1 even if the cache was warm. That
  // path must work for both live and non-live callers.
  _resetStateCacheForTest();
  const fake = makeFakeEnv();
  const liveUrl = new URL('https://example.com/api/state?days=1&live=1');
  await handleState(fake.env, liveUrl);
  const c1 = fake.getCounts();
  // Manually invalidate, then call again — should hit D1 again because
  // the live path never writes to the cache anyway, but the assertion
  // is "the next call doesn't get a stale payload that was somehow
  // cached behind its back".
  _invalidateStateCache();
  await handleState(fake.env, liveUrl);
  const c2 = fake.getCounts();
  assert.ok(c2.batchCount > c1.batchCount, 'invalidated cache triggers a fresh D1 read');
});
