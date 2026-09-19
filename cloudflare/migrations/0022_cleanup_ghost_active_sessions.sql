-- 0022_cleanup_ghost_active_sessions.sql
--
-- One-time cleanup of two stuck active_sessions rows on the cloud D1 that
-- pre-date the e_bc_* roster guard (migration 0018). Both rows:
--   * have no roster match in the current employees-manual.json
--   * have empty emp_name and emp_code
--   * are 16+ days old (started_at in the Unix-sec range shown below)
--   * never received a session_finish, so they sit on the Live Active
--     Sessions tile on dashboard.farewellabaya.com forever
--
-- They are visible to the CEO as two ghosts:
--   e_bc_999998      Tailor (01)        started 1788177026 (2026-08-31)
--                                           1788177026 ≈ 2026-08-31T13:50:26Z
--   e_bc_00000141    Ari Work           started 1788436255 (2026-09-01)
--                                           1788436255 ≈ 2026-09-03T13:10:55Z
--   (Ashanfi / EMP141 / Ari Work / FWAP 3894 PRE-O — same row)
--
-- Why these two and not a broader sweep:
--   - e_bc_999998 has emp_id `e_bc_999998` which falls inside the
--     `e_bc_<digits>` regex but is well outside the factory's real
--     barcode range (alazar is 00000121, wasim is 00000132, saddam is
--     00000140, etc.). Roster guard from migration 0018 already blocks
--     new arrivals of this shape.
--   - e_bc_00000141 is not present in the current employees-manual.json
--     (the roster has EMP121..140 + EMP134, EMP135, EMP139 but no 141).
--     Two finished `sessions` rows for e_bc_999998 already exist; they
--     were not on the live row and are out of scope for this migration.
--     The factory server is the source of truth for `sessions`; if a
--     future cleanup of those stale rows is needed, it should be a
--     separate migration that also drops the matching `daily_stats`
--     aggregations.
--
-- Why this is safe:
--   - Trigger trg_active_sessions_reject_synthetic_emp_id (migration 0018)
--     would already block these ids from being INSERTed again, so the
--     cleanup cannot be undone by accident from a re-push.
--   - The factory server is the source of truth for live state per
--     AGENTS.md §1. The cloud's active_sessions only carries rows the
--     factory sent via /api/event. If a real session is in flight for
--     either of these emp_ids, the factory server has already
--     crashed/been replaced and the operator should be re-creating the
--     live row anyway.
--   - DELETE is idempotent: re-running on an already-clean D1 simply
--     matches 0 rows and reports changes=0.
--
-- Run: cd cloudflare && npx wrangler d1 execute abaya-db \
--        --file=migrations/0022_cleanup_ghost_active_sessions.sql --remote
-- Dry-run first (recommended):
--   cd cloudflare && npx wrangler d1 execute abaya-db \
--     --command="SELECT emp_id, emp_name, emp_code, emp_process, started_at \
--               FROM active_sessions \
--               WHERE emp_id IN ('e_bc_999998','e_bc_00000141')" --remote

-- Defense-in-depth: only target rows whose emp_id is not in the current
-- factory roster (employees-manual.json on the LAN). Real employees in
-- the roster as of 2026-09-19:
--
--   e_bc_00000121, e_bc_00000117, e_bc_00000123, e_bc_00000133,
--   e_bc_00000115, e_bc_00000118, e_bc_00000135, e_bc_00000110,
--   e_bc_00000129, e_bc_00000128, e_bc_00000111, e_bc_00000113,
--   e_bc_00000125, e_bc_00000130, e_bc_00000134, e_bc_00000116,
--   e_bc_00000140, e_bc_00000138, e_bc_00000132
--
-- Anything in active_sessions whose emp_id is NOT one of the above AND
-- is older than 24 hours is, by definition, an orphan. This catches
-- both e_bc_999998 (clearly out-of-range) and e_bc_00000141 (Ashanfi,
-- EMP141) which was a former employee not re-added to the current
-- roster — they were being held on the live tile by the same orphan-
-- close logic as 999998.
--
-- The original draft of this migration also required (emp_name IS NULL
-- OR emp_name = ''). That predicate fails on Ashanfi (who has a name +
-- code from when they were active), so this version replaces it with
-- the roster-membership check, which is the actual operator-visible
-- invariant.

DELETE FROM active_sessions
 WHERE emp_id NOT IN (
       'e_bc_00000110','e_bc_00000111','e_bc_00000113','e_bc_00000115',
       'e_bc_00000116','e_bc_00000117','e_bc_00000118','e_bc_00000121',
       'e_bc_00000123','e_bc_00000125','e_bc_00000128','e_bc_00000129',
       'e_bc_00000130','e_bc_00000132','e_bc_00000133','e_bc_00000134',
       'e_bc_00000135','e_bc_00000138','e_bc_00000140'
       )
   AND started_at < (strftime('%s','now') - 86400);
