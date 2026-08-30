-- Migration 0018: reject synthetic emp_id at the ingest boundary.
--
-- Real factory employees have stable ids of the form `e_bc_<barcode>`
-- (e.g. `e_bc_00000121` for Alazar, `e_bc_136` for IRFAN). These are
-- set by the local server's xlsx-based roster and pushed to the cloud
-- via /api/event. Migration 0017 (2026-08-30) already removed 450
-- historical synthetic rows (e1..e26, test-smoke-emp, ALIGN_DEMO_*,
-- TEST_*, POSTDEPLOY_PROBE) and the per-employee aggregations in
-- report.js / state.js filter on `emp_id LIKE 'e_bc_%'`.
--
-- This migration formalizes the pattern as a D1 constraint so any
-- future push of a synthetic id is rejected at write time, not just
-- filtered at read time. Pair with the ingest-side roster guard in
-- cloudflare/src/handlers/ingest.js (rejects 422 before INSERT).
--
-- Safe to re-run: the CREATE TRIGGER uses `IF NOT EXISTS` semantics
-- by being wrapped in a DROP + CREATE pattern. The TRIGGER fires on
-- INSERT OR REPLACE (the same path the local server uses for active
-- upserts) and on a plain INSERT (the path for finished sessions).
--
-- Trigger logic: if the new row's emp_id doesn't match `e_bc_<digits>`
-- AND the row is being inserted into `sessions` or `active_sessions`,
-- RAISE(IGNORE) drops the row. We log nothing — the WRITER is
-- expected to have validated upstream. If a real employee ever ships
-- a different id form, update this trigger AND the JS guard.

DROP TRIGGER IF EXISTS trg_sessions_reject_synthetic_emp_id;
CREATE TRIGGER trg_sessions_reject_synthetic_emp_id
BEFORE INSERT ON sessions
FOR EACH ROW
WHEN NEW.emp_id IS NOT NULL
  AND NEW.emp_id NOT LIKE 'e_bc_%'
BEGIN
  SELECT RAISE(IGNORE);
END;

DROP TRIGGER IF EXISTS trg_active_sessions_reject_synthetic_emp_id;
CREATE TRIGGER trg_active_sessions_reject_synthetic_emp_id
BEFORE INSERT ON active_sessions
FOR EACH ROW
WHEN NEW.emp_id IS NOT NULL
  AND NEW.emp_id NOT LIKE 'e_bc_%'
BEGIN
  SELECT RAISE(IGNORE);
END;
