// tests/session-dedup.test.mjs
//
// Unit tests for shared/session-dedup.cjs → isDuplicateSessionFinish.
//
// This is the v1.2.43 idempotency guard for session_finish pushes. See
// docs/releases/v1.2.43.md for the original incident report (Wahid on
// 2026-09-16 had 3 rows on the daily report with the same started_at
// but different ended_at — the cloud D1 sessions table has
// PK = 'WL-' + emp_id + '-' + ended_at so each push was a new row).
//
// What this test proves:
//   1. Empty / null / missing inputs return false (no false-positives).
//   2. A row with the SAME (emp_id, start) is detected.
//   3. A row with the same emp_id but DIFFERENT start is NOT a duplicate.
//   4. A row with a different emp_id but SAME start is NOT a duplicate.
//   5. Both legacy `start` (ms) and new `started_at` (ms) field names
//      work — the helper falls back to whichever is present.
//   6. Numeric coercion: string emp_id matches numeric, numeric start
//      matches string-typed start.
//
// The helper is the factory-side mirror of the cloud D1's natural PK.
// It is invoked by server.js req_finishWork and close-stale-sessions.

import test from 'node:test';
import assert from 'node:assert/strict';

const { isDuplicateSessionFinish } = await import(
  '../shared/session-dedup.cjs'
);

test('isDuplicateSessionFinish returns false on empty / null / missing inputs', () => {
  const logs = [{ emp_id: 'e_bc_00000138', start: 1788156388000 }];
  assert.equal(isDuplicateSessionFinish(logs, '', 1788156388000), false);
  assert.equal(isDuplicateSessionFinish(logs, null, 1788156388000), false);
  assert.equal(isDuplicateSessionFinish(logs, undefined, 1788156388000), false);
  assert.equal(isDuplicateSessionFinish(logs, 'e_bc_00000138', null), false);
  assert.equal(isDuplicateSessionFinish(logs, 'e_bc_00000138', 0), false);
  assert.equal(isDuplicateSessionFinish(logs, 'e_bc_00000138', -1), false);
  assert.equal(isDuplicateSessionFinish(logs, 'e_bc_00000138', 'not-a-number'), false);
  assert.equal(isDuplicateSessionFinish(null, 'e_bc_00000138', 1788156388000), false);
  assert.equal(isDuplicateSessionFinish(undefined, 'e_bc_00000138', 1788156388000), false);
  assert.equal(isDuplicateSessionFinish([], 'e_bc_00000138', 1788156388000), false);
});

test('isDuplicateSessionFinish detects a matching (emp_id, start) row', () => {
  const logs = [
    { emp_id: 'e_bc_00000138', start: 1788156388000, end: 1788770079000 },
    { emp_id: 'e_bc_00000140', start: 1788500000000, end: 1788510000000 },
  ];
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1788156388000),
    true
  );
});

test('isDuplicateSessionFinish does NOT match on different start time', () => {
  const logs = [{ emp_id: 'e_bc_00000138', start: 1788156388000 }];
  // Same emp_id, start differs by 1 ms.
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1788156388001),
    false
  );
  // Same emp_id, start differs by 1 hour.
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1788156388000 + 3600 * 1000),
    false
  );
});

test('isDuplicateSessionFinish does NOT match on different emp_id', () => {
  const logs = [{ emp_id: 'e_bc_00000138', start: 1788156388000 }];
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000140', 1788156388000),
    false
  );
  // Different emp_id shape (one of the synthetic ids that 0018 rejects).
  assert.equal(
    isDuplicateSessionFinish(logs, 'e1', 1788156388000),
    false
  );
});

test('isDuplicateSessionFinish handles legacy `start` and new `started_at` field names', () => {
  const logs = [
    { emp_id: 'e_bc_00000111', start: 1788156388000 },          // legacy
    { emp_id: 'e_bc_00000111', started_at: 1789484311000 },     // new
  ];
  assert.equal(isDuplicateSessionFinish(logs, 'e_bc_00000111', 1788156388000), true);
  assert.equal(isDuplicateSessionFinish(logs, 'e_bc_00000111', 1789484311000), true);
  // start=1788156388000 != 1789484311000, so the second one does NOT match the first
  assert.equal(isDuplicateSessionFinish(logs.slice(0, 1), 'e_bc_00000111', 1789484311000), false);
});

test('isDuplicateSessionFinish handles string-typed emp_id and start in logs', () => {
  // Some offline-report loads may coerce fields to strings. The helper
  // should still match.
  const logs = [
    {
      emp_id: 'e_bc_00000138',
      start: '1788156388000', // string-typed
      end: '1788770079000',
    },
  ];
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1788156388000),
    true
  );
});

test('isDuplicateSessionFinish returns false when log entries are sparse (missing start)', () => {
  // A row with no usable start should not crash the helper; it should
  // be skipped so a missing field never blocks a real finish.
  const logs = [
    { emp_id: 'e_bc_00000138' },                                  // no start
    { emp_id: 'e_bc_00000138', start: null },                     // null start
    { emp_id: 'e_bc_00000138', start: 'not-a-number' },           // bad start
    { emp_id: 'e_bc_00000140', start: 1788156388000 },            // different emp_id
  ];
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1788156388000),
    false
  );
});

test('isDuplicateSessionFinish reflects the live Wahid/Mojeeb dup cluster shape', () => {
  // Replica of the actual Wahid cluster the operator saw on 2026-09-17:
  // 8 sessions with the same emp_id + started_at, different ended_at.
  // The first row was the LAN's persisted COMPLETED_LOGS entry;
  // subsequent rows are the close-stale-sessions pushes that polluted
  // the cloud. Each new close-stale call would re-enter with the SAME
  // (emp_id, start) and the helper must return true to suppress the push.
  //
  // Scenario: server starts. ACTIVE_SESSIONS has the Wahid orphan
  // (started_at = 1787574720000). COMPLETED_LOGS is empty.
  const logs = [];

  // First push — operator runs close-stale for the first time.
  // The session's start is in ACTIVE_SESSIONS as 1787574720000;
  // COMPLETED_LOGS does NOT yet have this (emp_id, start) row.
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1787574720000),
    false,
    'first call: COMPLETED_LOGS empty, push proceeds (the cloud gets the first row)'
  );

  // The first call appended to COMPLETED_LOGS and persisted. Now the
  // operator runs close-stale again — but the (emp_id, start) is now
  // already represented locally.
  logs.push({
    emp_id: 'e_bc_00000138',
    abaya_id: '3439',
    process: 'Show Button',
    start: 1787574720000,
    end: 1787578182000,
    duration_sec: 2077,
  });
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1787574720000),
    true,
    'second call: COMPLETED_LOGS has (emp_id, start); push suppressed'
  );

  // A different worker tapping Start on a different station at a
  // different time should NOT be flagged as a duplicate.
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000140', 1787574720000),
    false,
    'different emp_id is not a duplicate'
  );
  assert.equal(
    isDuplicateSessionFinish(logs, 'e_bc_00000138', 1787574721000),
    false,
    'same emp_id but different start is not a duplicate'
  );
});
