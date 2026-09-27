// tests/cloud-history-merge.test.mjs
//
// Unit tests for shared/cloud-history-merge.cjs — the boot-hydration
// local-overlay guard. Defends the LAN's local-only rows against being
// overwritten by the cloud's stale view during the boot-time
// /api/state/history round-trip (5-30 s).
//
// This is the v1.2.52 boot-hydrate sibling of:
//   - shared/recent-finish-tombstone.cjs (ACTIVE_SESSIONS, see v1.2.51)
//   - shared/recent-mutation-tombstone.cjs (catalog, employees, work
//     types, see v1.2.52)
// Both guard against the same root-cause class: LAN-local-vs-cloud-
// stale. The merge helper below is the per-row dedup that runs at
// hydration completion.
//
// What this test file covers
// --------------------------
//   1. Empty cloud + empty local → empty merged (no-op sanity).
//   2. Cloud rows only, empty local → all cloud rows preserved.
//   3. Local rows only, empty cloud → all local rows preserved.
//   4. Mixed: cloud and local with NO overlap → both sets preserved,
//      cloud rows first.
//   5. Mixed with overlap by id → local duplicate is skipped, counters
//      report it.
//   6. Mixed with overlap by (emp_id, started_at) but different id →
//      local duplicate is still skipped (catch the push-not-landed case).
//   7. Local row with missing id is deduped only by composite key.
//   8. Multiple local rows for the same (emp_id, started_at) — only
//      the first is preserved (no duplicate append).
//   9. Malformed rows (null, undefined) are skipped, not crashed on.
//  10. Counters are accurate across realistic mixed loads.
//  11. Custom idOf / keyOf extractors are honored.
//  12. Cloud row order is preserved (cloud comes first).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const require = createRequire(join(REPO_ROOT, 'package.json'));
const { mergeCloudHistoryWithLocalOverlay } = require(
  join(REPO_ROOT, 'shared', 'cloud-history-merge.cjs')
);

const ROW = (id, empId, startedAt, endedAt, name) => ({
  id,
  emp_id: empId,
  emp_name: name || 'Worker',
  started_at: startedAt,
  ended_at: endedAt || startedAt + 600,
  duration_sec: 600,
});

test('empty cloud + empty local → empty merged', () => {
  const r = mergeCloudHistoryWithLocalOverlay([], []);
  assert.equal(r.merged.length, 0);
  assert.equal(r.localPreserved, 0);
  assert.equal(r.localDuplicatesSkipped, 0);
});

test('cloud rows only, empty local → all cloud rows preserved', () => {
  const cloud = [
    ROW('WL-e1-100', 'e_bc_00000121', 100),
    ROW('WL-e2-200', 'e_bc_00000122', 200),
  ];
  const r = mergeCloudHistoryWithLocalOverlay(cloud, []);
  assert.equal(r.merged.length, 2);
  assert.equal(r.merged[0].id, 'WL-e1-100');
  assert.equal(r.merged[1].id, 'WL-e2-200');
  assert.equal(r.localPreserved, 0);
  assert.equal(r.localDuplicatesSkipped, 0);
});

test('local rows only, empty cloud → all local rows preserved', () => {
  const local = [
    ROW(undefined, 'e_bc_00000121', 100),
    ROW(undefined, 'e_bc_00000122', 200),
  ];
  const r = mergeCloudHistoryWithLocalOverlay([], local);
  assert.equal(r.merged.length, 2);
  assert.equal(r.merged[0].emp_id, 'e_bc_00000121');
  assert.equal(r.merged[1].emp_id, 'e_bc_00000122');
  assert.equal(r.localPreserved, 2);
  assert.equal(r.localDuplicatesSkipped, 0);
});

test('mixed cloud + local with no overlap → both sets preserved, cloud first', () => {
  const cloud = [
    ROW('WL-e1-100', 'e_bc_00000121', 100),
    ROW('WL-e2-200', 'e_bc_00000122', 200),
  ];
  const local = [
    ROW(undefined, 'e_bc_00000123', 300), // local Finish during the fetch
    ROW(undefined, 'e_bc_00000124', 400), // another local Finish
  ];
  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  assert.equal(r.merged.length, 4);
  assert.equal(r.merged[0].id, 'WL-e1-100');
  assert.equal(r.merged[1].id, 'WL-e2-200');
  assert.equal(r.merged[2].emp_id, 'e_bc_00000123');
  assert.equal(r.merged[3].emp_id, 'e_bc_00000124');
  assert.equal(r.localPreserved, 2);
  assert.equal(r.localDuplicatesSkipped, 0);
});

test('overlap by id → local duplicate is skipped', () => {
  // Scenario: push landed during the fetch (cloud has the row with
  // its stable id), but the local row was already captured before
  // the merge.
  const cloud = [ROW('WL-e1-100', 'e_bc_00000121', 100)];
  const local = [ROW('WL-e1-100', 'e_bc_00000121', 100)]; // same id
  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  assert.equal(r.merged.length, 1, 'local duplicate skipped');
  assert.equal(r.merged[0].id, 'WL-e1-100');
  assert.equal(r.localPreserved, 0);
  assert.equal(r.localDuplicatesSkipped, 1);
});

test('overlap by (emp_id, started_at) but different id → still skipped', () => {
  // Scenario: local Finish landed; push hasn't landed yet, so the
  // local row has no id. Cloud view has the same (emp_id, started_at)
  // for a different (ended_at) — same session, just timed differently
  // on the cloud because the push was processed mid-Finish.
  const cloud = [ROW('WL-e1-100', 'e_bc_00000121', 100, 130)];
  const local = [
    ROW(undefined, 'e_bc_00000121', 100, 130), // local, no id, same session
  ];
  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  assert.equal(r.merged.length, 1);
  assert.equal(r.localPreserved, 0);
  assert.equal(r.localDuplicatesSkipped, 1);
});

test('local row with missing id is deduped by composite key', () => {
  // Local: id absent (just-finished). Cloud has the same session.
  const cloud = [ROW(undefined, 'e_bc_00000121', 100, 130, 'Ahmad')];
  const local = [ROW(undefined, 'e_bc_00000121', 100, 130, 'Ahmad')];
  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  assert.equal(r.merged.length, 1);
  assert.equal(r.localDuplicatesSkipped, 1);
});

test('multiple local rows for the same (emp_id, started_at) — all preserved (helper only dedups local-vs-cloud)', () => {
  // Edge case: three local Finish events with the same composite key
  // and no id. The helper dedups local-vs-CLOUD but not local-vs-local:
  // when the LAN has a row we don't know, we trust the LAN. If the LAN
  // is buggy (double-append), we preserve all rows and let the operator
  // notice in the dashboard. Silently dropping a real session row is
  // worse than double-counting a malformed one — see the docstring's
  // "Dedup keys" section.
  const local = [
    ROW(undefined, 'e_bc_00000121', 100, 130),
    ROW(undefined, 'e_bc_00000121', 100, 130),
    ROW(undefined, 'e_bc_00000121', 100, 130),
  ];
  const r = mergeCloudHistoryWithLocalOverlay([], local);
  assert.equal(r.merged.length, 3);
  assert.equal(r.localPreserved, 3);
  assert.equal(r.localDuplicatesSkipped, 0);
});

test('malformed rows are skipped, not crashed on', () => {
  const cloud = [
    null,
    undefined,
    ROW('WL-e1-100', 'e_bc_00000121', 100),
  ];
  const local = [null, undefined, ROW(undefined, 'e_bc_00000122', 200)];
  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  assert.equal(r.merged.length, 2);
  assert.equal(r.localPreserved, 1);
  assert.equal(r.localDuplicatesSkipped, 0);
});

test('Realistic mixed load (cloud has 278 rows, 4 local landed during fetch, 2 dups)', () => {
  const cloud = [];
  for (let i = 0; i < 276; i++) {
    cloud.push(ROW('WL-e' + i + '-' + (10000 + i), 'e_bc_' + String(10000 + i).padStart(8, '0'), 10000 + i));
  }
  const local = [
    ROW(undefined, 'e_bc_99999999', 99999999), // brand-new session
    ROW('WL-e_bc_00000999-99', 'e_bc_00000999', 99), // pre-pushed, will dedup by id
    ROW(undefined, 'e_bc_99999998', 99999998), // brand-new
    ROW('WL-e_bc_00000050-50', 'e_bc_00000050', 50), // dup by composite key (cloud row id absent, but emp_id+started_at matches)
  ];
  // Add the matching cloud rows for the dups so the merge has
  // something to dedup against.
  cloud.push(ROW('WL-e_bc_00000999-99', 'e_bc_00000999', 99));
  cloud.push(ROW(undefined, 'e_bc_00000050', 50, 60));

  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  // cloud = 276 + 2 added = 278
  // local preserved = 2 (the brand-new sessions)
  // local skipped = 2 (the two dups)
  // merged = 278 + 2 = 280
  assert.equal(r.merged.length, 280);
  assert.equal(r.localPreserved, 2, 'two brand-new sessions preserved');
  assert.equal(r.localDuplicatesSkipped, 2, 'one id dup + one composite-key dup skipped');
});

test('Custom idOf / keyOf extractors are honored', () => {
  // The extraction is abstracted so the same logic can be reused for
  // resources that don't have an `id` field at all (a future helper
  // that dedups purely by composite key, for example).
  const cloud = [{ code: 'A', name: 'ahmad' }, { code: 'B', name: 'wahid' }];
  const local = [{ code: 'A', name: 'ahmad' }, { code: 'C', name: 'farhan' }];

  const r = mergeCloudHistoryWithLocalOverlay(cloud, local, {
    idOf: (row) => row && row.code != null ? String(row.code) : '',
    keyOf: (row) => String(row && row.name || ''),
  });

  // The custom idOf dedups by `code` — local 'A' skips because cloud
  // has 'A'. The custom keyOf dedups by `name` — local 'A' (Ahmad)
  // also matches cloud 'A' (Ahmad); still one skip. Local 'C' (Farhan)
  // is unique on both → preserved.
  assert.equal(r.merged.length, 3); // 2 cloud + 1 local = 3
  assert.equal(r.localPreserved, 1);
  assert.equal(r.localDuplicatesSkipped, 1);
});

test('Cloud row order is preserved (cloud first, local appended)', () => {
  const cloud = [
    ROW('WL-e1-300', 'e_bc_00000121', 300),
    ROW('WL-e1-100', 'e_bc_00000121', 100), // out of order; we don't sort
    ROW('WL-e1-200', 'e_bc_00000121', 200),
  ];
  const local = [ROW(undefined, 'e_bc_00000121', 250)];
  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  assert.equal(r.merged.length, 4);
  assert.equal(r.merged[0].id, 'WL-e1-300');
  assert.equal(r.merged[1].id, 'WL-e1-100');
  assert.equal(r.merged[2].id, 'WL-e1-200');
  assert.equal(r.merged[3].started_at, 250, 'local appended at the end, not inserted by sort');
});

test('Output is a new array; input arrays are not mutated', () => {
  const cloud = [ROW('WL-e1-100', 'e_bc_00000121', 100)];
  const local = [ROW(undefined, 'e_bc_00000122', 200)];
  const r = mergeCloudHistoryWithLocalOverlay(cloud, local);
  assert.notEqual(r.merged, cloud, 'merged is not the same reference as cloud');
  assert.notEqual(r.merged, local, 'merged is not the same reference as local');
  assert.equal(cloud.length, 1, 'cloud input not mutated');
  assert.equal(local.length, 1, 'local input not mutated');
});

test('Non-array inputs are handled defensively', () => {
  // Defensive: a malformed caller passing non-arrays should not crash.
  const r = mergeCloudHistoryWithLocalOverlay(null, undefined);
  assert.equal(r.merged.length, 0);
  assert.equal(r.localPreserved, 0);
  assert.equal(r.localDuplicatesSkipped, 0);
});

test('Counter naming matches server.js hydrateCompletedLogsFromCloud response', () => {
  // The hydrate function returns { hydrated: true, count, localPreserved,
  // localDuplicatesSkipped, ... } — the helper's keys must match so
  // server.js can pass them through unchanged.
  const r = mergeCloudHistoryWithLocalOverlay([], []);
  assert.ok('merged' in r);
  assert.ok('localPreserved' in r);
  assert.ok('localDuplicatesSkipped' in r);
});
