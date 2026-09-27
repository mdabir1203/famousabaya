// tests/server-cloud-pull-guards.test.mjs
//
// Wiring audit for the v1.2.52 LAN-local-vs-cloud-stale guards. The
// unit tests in recent-mutation-tombstone.test.mjs and
// cloud-history-merge.test.mjs pin the helper behavior. This file pins
// the WIRING: that every catalog / employees / work-types mutation
// callsite calls the corresponding note() helper, and every refresh
// from cloud calls the corresponding isLive() guard.
//
// The audit runs as a server-side source-grep: read server.js, look
// for the expected patterns in their expected contexts. A wiring
// regression (someone adds a new mutation path without noting the
// tombstone, or refactors refresh<X>FromCloud to remove the guard) is
// caught here.
//
// This is deliberately not a subprocess test — the cloud-LAN sync
// patterns are tested at the unit level (helpers) and at the source
// level (wiring). Adding a full HTTP / spawn round-trip would add
// minutes of test time for marginal coverage.
//
// What this test file covers
// --------------------------
//   1. Every catalog mutation callsite calls noteCatalogLocalMutation().
//   2. refreshAbayaCatalogFromCloud gates on isCatalogLocalMutationTombstoneLive().
//   3. Every employees mutation callsite calls noteEmployeesLocalMutation().
//   4. refreshEmployeesFromCloud gates on isEmployeesLocalMutationTombstoneLive().
//   5. Every work-types mutation callsite calls noteWorkTypesLocalMutation().
//   6. refreshWorkTypesFromCloud gates on isWorkTypesLocalMutationTombstoneLive().
//   7. The boot hydration calls mergeCloudHistoryWithLocalOverlay (the
//      local-overlay guard) — not the raw wholesale-replace that lost
//      rows in pre-v1.2.52 boots.
//   8. The release-notes tombstone helper is the same one the unit
//      tests cover (shared/recent-mutation-tombstone.cjs is imported
//      and the makeRecentMutationTombstone factory is used).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SERVER_JS = join(REPO_ROOT, 'server.js');

const serverSrc = readFileSync(SERVER_JS, 'utf8');

// Count occurrences of a pattern. Simple substring match — the patterns
// we use are unique enough to the v1.2.52 work that this is safe.
function countMatches(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

// Count calls of `foo(...)` at statement level — i.e. preceded by
// whitespace or `;` or `{` and followed by `;` or `)`. Excludes the
// `function foo(` declaration, the `function foo(label) { foo.note(label); }`
// helper definition, and any inline mentions in comments.
function countCalls(haystack, name) {
  // Match `name(` NOT preceded by `function ` and NOT followed by `)` only
  // (we want calls with at least one argument, not the `function name()` decl).
  const re = new RegExp('(?<!function )\\b' + name + '\\(', 'g');
  return (haystack.match(re) || []).length;
}

// Find the first occurrence of `start` after `fromOffset`, return the
// slice up to `lookahead` characters. Used to confirm a callsite
// context (e.g. "what does this mutation site look like in the
// source").
function snippetAfter(haystack, fromOffset, needle, lookahead) {
  const pos = haystack.indexOf(needle, fromOffset);
  if (pos === -1) return '';
  return haystack.slice(pos, pos + needle.length + lookahead);
}

test('server.js requires shared/recent-mutation-tombstone.cjs and shared/cloud-history-merge.cjs', () => {
  assert.ok(
    serverSrc.includes("require('./shared/recent-mutation-tombstone.cjs')"),
    'recent-mutation-tombstone.cjs must be required for the catalog/employees/work-types pull guards'
  );
  assert.ok(
    serverSrc.includes("require('./shared/cloud-history-merge.cjs')"),
    'cloud-history-merge.cjs must be required for the boot-hydrate local overlay'
  );
  assert.ok(
    serverSrc.includes("require('./shared/recent-finish-tombstone.cjs')"),
    'recent-finish-tombstone.cjs must still be required (v1.2.51 ACTIVE_SESSIONS guard)'
  );
});

test('Three tombstones are instantiated (catalog + employees + work types)', () => {
  assert.ok(countMatches(serverSrc, 'catalogLocalMutationTombstone = makeRecentMutationTombstone') === 1,
    'exactly one catalogLocalMutationTombstone instance');
  assert.ok(countMatches(serverSrc, 'employeesLocalMutationTombstone = makeRecentMutationTombstone') === 1,
    'exactly one employeesLocalMutationTombstone instance');
  assert.ok(countMatches(serverSrc, 'workTypesLocalMutationTombstone = makeRecentMutationTombstone') === 1,
    'exactly one workTypesLocalMutationTombstone instance');
});

test('refreshAbayaCatalogFromCloud gates on isCatalogLocalMutationTombstoneLive', () => {
  const guard = "if (isCatalogLocalMutationTombstoneLive()) {\n    return;\n  }";
  const refreshFnIdx = serverSrc.indexOf('async function refreshAbayaCatalogFromCloud()');
  assert.ok(refreshFnIdx !== -1, 'refreshAbayaCatalogFromCloud must exist');
  const fnBody = snippetAfter(serverSrc, refreshFnIdx, '{', 800);
  assert.ok(
    fnBody.includes('isCatalogLocalMutationTombstoneLive()'),
    'refreshAbayaCatalogFromCloud must call isCatalogLocalMutationTombstoneLive()'
  );
});

test('refreshEmployeesFromCloud gates on isEmployeesLocalMutationTombstoneLive', () => {
  const refreshFnIdx = serverSrc.indexOf('async function refreshEmployeesFromCloud()');
  assert.ok(refreshFnIdx !== -1, 'refreshEmployeesFromCloud must exist');
  const fnBody = snippetAfter(serverSrc, refreshFnIdx, '{', 1200);
  assert.ok(
    fnBody.includes('isEmployeesLocalMutationTombstoneLive()'),
    'refreshEmployeesFromCloud must call isEmployeesLocalMutationTombstoneLive()'
  );
});

test('refreshWorkTypesFromCloud gates on isWorkTypesLocalMutationTombstoneLive', () => {
  const refreshFnIdx = serverSrc.indexOf('async function refreshWorkTypesFromCloud()');
  assert.ok(refreshFnIdx !== -1, 'refreshWorkTypesFromCloud must exist');
  const fnBody = snippetAfter(serverSrc, refreshFnIdx, '{', 1200);
  assert.ok(
    fnBody.includes('isWorkTypesLocalMutationTombstoneLive()'),
    'refreshWorkTypesFromCloud must call isWorkTypesLocalMutationTombstoneLive()'
  );
});

test('Catalog mutation callsites call noteCatalogLocalMutation', () => {
  // Three known mutation sites. Each must call noteCatalogLocalMutation.
  const sites = [
    'noteCatalogLocalMutation(\'catalog-xlsx-file\')',
    'noteCatalogLocalMutation(\'catalog-xlsx-upload\')',
    'noteCatalogLocalMutation(\'catalog-put\')',
  ];
  for (const site of sites) {
    assert.ok(
      serverSrc.includes(site),
      'catalog mutation callsite must note the tombstone: ' + site
    );
  }
  // Total call count: 3 sites, 1 call each. (Excludes the helper definition.)
  assert.ok(countCalls(serverSrc, 'noteCatalogLocalMutation') === 3,
    'exactly 3 noteCatalogLocalMutation callsites expected (one per catalog mutation path)');
});

test('Employees mutation callsites call noteEmployeesLocalMutation', () => {
  // Three known mutation sites. Each must call noteEmployeesLocalMutation.
  const sites = [
    'noteEmployeesLocalMutation(\'manual-file-reload\')',
    'noteEmployeesLocalMutation(\'xlsx-file-reload\')',
    'noteEmployeesLocalMutation(\'manual-json-branch\')',
  ];
  for (const site of sites) {
    assert.ok(
      serverSrc.includes(site),
      'employees mutation callsite must note the tombstone: ' + site
    );
  }
  assert.ok(countCalls(serverSrc, 'noteEmployeesLocalMutation') === 3,
    'exactly 3 noteEmployeesLocalMutation callsites expected');
});

test('Work-types mutation callsites call noteWorkTypesLocalMutation', () => {
  const sites = [
    'noteWorkTypesLocalMutation(\'disk-load\')',
    'noteWorkTypesLocalMutation(\'operator-edit-persist\')',
  ];
  for (const site of sites) {
    assert.ok(
      serverSrc.includes(site),
      'work-types mutation callsite must note the tombstone: ' + site
    );
  }
  assert.ok(countCalls(serverSrc, 'noteWorkTypesLocalMutation') === 2,
    'exactly 2 noteWorkTypesLocalMutation callsites expected');
});

test('hydrateCompletedLogsFromCloud uses mergeCloudHistoryWithLocalOverlay (no raw wholesale replace)', () => {
  const hydrateIdx = serverSrc.indexOf('async function hydrateCompletedLogsFromCloud(days)');
  assert.ok(hydrateIdx !== -1, 'hydrateCompletedLogsFromCloud must exist');
  const fnBody = snippetAfter(serverSrc, hydrateIdx, '{', 4000);
  assert.ok(
    fnBody.includes('mergeCloudHistoryWithLocalOverlay('),
    'hydrate must call the local-overlay helper'
  );
  assert.ok(
    fnBody.includes('overlay.merged'),
    'hydrate must use the merged result from the helper, not bypass it'
  );
  assert.ok(
    fnBody.includes('overlay.localPreserved') || fnBody.includes('overlay.localDuplicatesSkipped'),
    'hydrate must surface the helper counters so the operator sees how many rows were preserved'
  );
});

test('No raw COMPLETED_LOGS = hydrated in the hydrate path (the old overwrite is gone)', () => {
  // The pre-v1.2.52 bug was a raw `COMPLETED_LOGS = hydrated` line that
  // lost local-only rows. The fix replaces it with the merge helper. The
  // raw line should no longer exist inside the hydrate function body.
  const hydrateIdx = serverSrc.indexOf('async function hydrateCompletedLogsFromCloud(days)');
  assert.ok(hydrateIdx !== -1);
  // Find the matching closing brace of the function. Easiest proxy: scan
  // forward for the next `async function` declaration.
  const nextFnIdx = serverSrc.indexOf('async function', hydrateIdx + 100);
  const fnBody = serverSrc.slice(hydrateIdx, nextFnIdx !== -1 ? nextFnIdx : hydrateIdx + 5000);
  // `COMPLETED_LOGS = hydrated` (the bug) — should not appear.
  assert.ok(
    !/\bCOMPLETED_LOGS\s*=\s*hydrated\b/.test(fnBody),
    'hydrate must not have a raw wholesale overwrite of COMPLETED_LOGS — the v1.2.52 fix replaces it with mergeCloudHistoryWithLocalOverlay'
  );
  // `COMPLETED_LOGS = overlay.merged` (the fix) — should appear.
  assert.ok(
    /\bCOMPLETED_LOGS\s*=\s*overlay\.merged\b/.test(fnBody),
    'hydrate must assign COMPLETED_LOGS = overlay.merged (the v1.2.52 fix)'
  );
});

test('RECENT_*_MUTATION_TOMBSTONE_MS env vars are wired for runtime tuning', () => {
  const envVars = [
    'RECENT_CATALOG_MUTATION_TOMBSTONE_MS',
    'RECENT_EMPLOYEES_MUTATION_TOMBSTONE_MS',
    'RECENT_WORK_TYPES_MUTATION_TOMBSTONE_MS',
  ];
  for (const envVar of envVars) {
    assert.ok(
      countMatches(serverSrc, envVar) >= 2,
      envVar + ' must be both read from process.env AND used as the makeRecentMutationTombstone ttlMs arg'
    );
  }
});

test('Boot log line reports the catalog/employees/work-types tombstones', () => {
  // The boot log at the bottom of server.listen's callback includes
  // a one-liner per tombstone so an operator inspecting factory
  // logs sees the guards are active.
  const listenIdx = serverSrc.indexOf('server.listen(PORT, bindHost, () => {');
  assert.ok(listenIdx !== -1);
  const bootBody = snippetAfter(serverSrc, listenIdx, '{', 8000);
  assert.ok(
    /Catalog local-mutation tombstone/.test(bootBody),
    'boot log must mention the catalog local-mutation tombstone'
  );
  assert.ok(
    /Employees local-mutation tombstone/.test(bootBody),
    'boot log must mention the employees local-mutation tombstone'
  );
  assert.ok(
    /Work-types local-mutation tombstone/.test(bootBody),
    'boot log must mention the work-types local-mutation tombstone'
  );
});
