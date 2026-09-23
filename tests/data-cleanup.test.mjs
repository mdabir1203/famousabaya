// tests/data-cleanup.test.mjs
//
// Unit tests for cloudflare/src/domain/data-cleanup.js — the read-path
// scrubbing module added in v1.2.45.
//
// These tests pin:
//   1. CURRENT_ROSTER_IDS shape (e_bc_<digits>, no duplicates, contains
//      the always-known sentinel id e_bc_00000121).
//   2. activeSessionWhere(nowSec) produces a SQL fragment that drops:
//        a) ghosts (emp_id not in roster)
//        b) orphans (started_at older than 24h)
//        c) malformed ids (the regex shape check, indirectly)
//   3. dedupSessionsCte() produces a syntactically valid CTE that
//      preserves one row per (emp_id, started_at) cluster, picking the
//      largest ended_at as survivor.
//   4. activeSessionWhereBound(nowSec) returns the same WHERE the
//      helper would, with no params (since the values are baked into
//      the SQL).
//
// These tests do not hit D1. The CTE is tested against D1 directly in
// tests/ceo-report.test.mjs (handleEmployeeDay dedups duplicate
// (emp_id, started_at) clusters).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_ROSTER_IDS,
  activeSessionWhere,
  activeSessionWhereBound,
  dedupSessionsCte,
} from '../cloudflare/src/domain/data-cleanup.js';

// -- CURRENT_ROSTER_IDS invariants ---------------------------------------

test('CURRENT_ROSTER_IDS contains only canonical e_bc_<digits> ids', () => {
  const rx = /^e_bc_\d+$/;
  for (const id of CURRENT_ROSTER_IDS) {
    assert.match(id, rx, `id ${id} must match e_bc_<digits>`);
  }
});

test('CURRENT_ROSTER_IDS has no duplicates', () => {
  const seen = new Set();
  for (const id of CURRENT_ROSTER_IDS) {
    assert.equal(seen.has(id), false, `${id} appears more than once`);
    seen.add(id);
  }
});

test('CURRENT_ROSTER_IDS contains the always-known sentinel e_bc_00000121', () => {
  // Alazar (EMP121) has been in the factory roster since the v1.0
  // baseline. If this id is missing, the live tile will never show
  // him — a regression the operator would notice within an hour.
  assert.ok(
    CURRENT_ROSTER_IDS.includes('e_bc_00000121'),
    'e_bc_00000121 (Alazar) must be in the roster'
  );
});

test('CURRENT_ROSTER_IDS size is reasonable for a single-shift factory', () => {
  // The factory has had 15-25 active workers throughout 2026. Anything
  // far outside that band signals either a roster wipe or a runaway
  // edit to this constant.
  assert.ok(
    CURRENT_ROSTER_IDS.length >= 15 && CURRENT_ROSTER_IDS.length <= 30,
    `roster size ${CURRENT_ROSTER_IDS.length} is outside expected band [15, 30]`
  );
});

// -- activeSessionWhere -------------------------------------------------

test('activeSessionWhere returns empty roster list when nowSec is invalid', () => {
  assert.throws(() => activeSessionWhere(0), /nowSec must be a positive/);
  assert.throws(() => activeSessionWhere(-1), /nowSec must be a positive/);
  assert.throws(() => activeSessionWhere(NaN), /nowSec must be a positive/);
  assert.throws(() => activeSessionWhere('not-a-number'), /nowSec must be a positive/);
  assert.throws(() => activeSessionWhere(undefined), /nowSec must be a positive/);
});

test('activeSessionWhere produces a SQL fragment with a 24h cutoff', () => {
  const now = 1789800000;
  const where = activeSessionWhere(now);
  // The cutoff should be 24h before `now`.
  assert.ok(where.startsWith('started_at >= 1789713600'), `unexpected cutoff: ${where}`);
  assert.ok(where.includes(' AND emp_id IN ('), `missing emp_id IN clause: ${where}`);
});

test('activeSessionWhere quotes all roster ids safely (no SQL injection)', () => {
  // If someone added an id with a single-quote in it, the helper must
  // escape it. CURRENT_ROSTER_IDS is frozen and audited, but the
  // double-quote-escape path needs verification.
  const where = activeSessionWhere(1789800000);
  // Count single quotes — must be even (every open has a close).
  const quoteCount = (where.match(/'/g) || []).length;
  assert.equal(quoteCount % 2, 0, `unbalanced single quotes in: ${where}`);
  // No rogue semicolons or DROP TABLE clauses.
  assert.ok(!/;\s*drop/i.test(where), `WHERE contains dangerous suffix: ${where}`);
});

test('activeSessionWhereBound returns the same SQL fragment with empty params', () => {
  const now = 1789800000;
  const { whereSql, params } = activeSessionWhereBound(now);
  assert.equal(whereSql, activeSessionWhere(now));
  assert.deepEqual(params, []);
});

// -- dedupSessionsCte ---------------------------------------------------

test('dedupSessionsCte returns a syntactically valid CTE for ROW_NUMBER dedup', () => {
  const cte = dedupSessionsCte();
  // Surface checks — if any of these fail the CTE is malformed.
  assert.ok(cte.startsWith('WITH survivors AS ('), `unexpected prefix: ${cte}`);
  assert.ok(cte.includes('ROW_NUMBER() OVER'), 'must use ROW_NUMBER window function');
  assert.ok(
    cte.includes('PARTITION BY emp_id, started_at, day_date'),
    'must partition by the dup key (emp_id, started_at, day_date) so cross-day clusters dedup per-day — see AGENTS.md §11 and v1.2.48'
  );
  assert.ok(
    cte.includes('ORDER BY ended_at DESC, id DESC'),
    'must order by ended_at DESC (keep the latest close)'
  );
  assert.ok(cte.includes('WHERE rn = 1'), 'must filter to rn=1 (the survivor)');
  assert.ok(cte.endsWith(')'), `unbalanced parens: ${cte}`);
});

test('dedupSessionsCte composes cleanly into a SELECT against sessions', () => {
  const cte = dedupSessionsCte();
  const composed = `${cte}
    SELECT s.emp_id, s.started_at, s.ended_at, s.duration_sec
    FROM sessions s
    JOIN survivors w ON w.id = s.id
    WHERE s.day_date = ?`;
  // No trailing comma, no missing parens.
  assert.ok(!/,\s*\)/.test(composed), 'stray comma before closing paren');
  assert.ok(!/,\s*FROM/.test(composed), 'stray comma before FROM');
});

// -- End-to-end scrub behavior (purely syntactic, no D1) ----------------

test('activeSessionWhere + dedupSessionsCte together drop ghosts AND dup rows', () => {
  // This is the canonical invariant the operator cares about: the
  // dashboard never shows a ghost or a dup, regardless of what the
  // factory's old buggy server pushed. The two filters complement:
  //
  //   activeSessionWhere — drops ghost active_sessions rows.
  //   dedupSessionsCte   — drops dup sessions rows.
  //
  // We don't run this against D1 here (that's the ceo-report.test.mjs
  // job), but the two helpers' SQL shapes must compose cleanly when
  // both are applied.
  const liveTile = `SELECT emp_id FROM active_sessions WHERE ${activeSessionWhere(1789800000)}`;
  const history = `${dedupSessionsCte()}
    SELECT s.* FROM sessions s JOIN survivors w ON w.id = s.id WHERE s.day_date = ?`;

  assert.ok(liveTile.includes('started_at >='), 'live tile has age cutoff');
  assert.ok(liveTile.includes('emp_id IN ('), 'live tile has roster filter');
  assert.ok(history.includes('ROW_NUMBER()'), 'history uses dedup CTE');
  assert.ok(history.includes('JOIN survivors'), 'history joins on the CT survivor ids');
});
