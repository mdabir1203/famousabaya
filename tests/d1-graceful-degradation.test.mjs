// tests/d1-graceful-degradation.test.mjs
//
// v1.2.27 — D1 graceful degradation. When D1 errors propagate out of a
// handler, the Worker's top-level catch should classify them and return
// 503 (Service Unavailable) with a Retry-After header, NOT 500
// (Internal Server Error). This is what tells the factory server's
// retry queue to back off instead of escalating to a permanent failure
// record, and what tells the CEO dashboard to show "data is stale" rather
// than "site is broken".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isD1Error, d1ErrorResponse, errRes } from '../cloudflare/src/http-response.js';

test('isD1Error returns true for messages prefixed with D1_ERROR', () => {
  assert.equal(isD1Error(new Error('D1_ERROR: quota exceeded')), true);
  assert.equal(isD1Error(new Error('D1_ERROR: read-only mode')), true);
  // Real D1 errors in production are typically Error instances with
  // `.message` starting with D1_ERROR. The Worker tail JSON shows that
  // exact prefix from the Cloudflare runtime.
});

test('isD1Error returns false for non-D1 errors', () => {
  assert.equal(isD1Error(new Error('ReferenceError: foo is not defined')), false);
  assert.equal(isD1Error(new Error('TypeError: cannot read property')), false);
  assert.equal(isD1Error(new Error('')), false);
  assert.equal(isD1Error(null), false);
  assert.equal(isD1Error(undefined), false);
  assert.equal(isD1Error('plain string'), false);
});

test('d1ErrorResponse returns 503 with Retry-After header and stable shape', async () => {
  const r = d1ErrorResponse(new Error('D1_ERROR: limit'), 30);
  assert.equal(r.status, 503, 'D1 errors map to 503 (transient) not 500 (programmer error)');
  assert.equal(r.headers.get('Retry-After'), '30', 'Retry-After is set so clients back off');
  const body = await r.json();
  assert.equal(body.ok, false, 'response body has stable shape { ok: false, error: ... }');
  assert.equal(body.error, 'database temporarily unavailable, retry shortly', 'human-friendly error message');
});

test('d1ErrorResponse honors the retryAfterSec argument', async () => {
  const r = d1ErrorResponse(new Error('D1_ERROR: x'), 5);
  assert.equal(r.headers.get('Retry-After'), '5', 'short retries when caller asks for them');
});

test('errRes still produces 4xx/5xx for non-D1 paths', async () => {
  const r = errRes('Bad request: missing field', 400);
  assert.equal(r.status, 400, 'errRes preserves status code');
  const body = await r.json();
  assert.equal(body.error, 'Bad request: missing field');
  assert.equal(r.headers.get('Retry-After'), null, 'errRes does NOT set Retry-After (only D1 errors do)');
});
