-- 0011_normalize_emp_process.sql
--
-- One-shot data fix for sessions whose emp_process arrived at the worker in a
-- case the rollup queries didn't recognize. Before this fix, the worker's
-- canonicalEmpProcess() was case-sensitive and 109 rows (92 lowercase
-- "cutting" + 17 all-caps "KHAKA WORK") were silently dropped from the
-- tailor_01 and the missing-process rollups in the Monthly/Yearly report.
--
-- Idempotent: re-running on a normalized DB is a no-op.
--
-- Apply with:
--   wrangler d1 execute abaya-db --remote --file=migrations/0011_normalize_emp_process.sql

-- Lowercase "cutting" / "cutting master" → "Tailor (01)" (same as Title case already does).
UPDATE sessions
SET emp_process = 'Tailor (01)'
WHERE lower(trim(emp_process)) IN ('cutting', 'cutting master');

-- Title-case aliases that were already handled but the inverse case wasn't.
UPDATE sessions
SET emp_process = 'Tailor (02)'
WHERE lower(trim(emp_process)) = 'stitching';

UPDATE sessions
SET emp_process = 'Hand Work'
WHERE lower(trim(emp_process)) = 'finishing';

-- "KHAKA WORK" / "khaka work" — not in WORK_TYPES today; bucket under Hand Work
-- so the by_process table and the process rollups at least aggregate it. If
-- the factory wants a dedicated KHAKA WORK column, add it to WORK_TYPES +
-- daily_stats schema in a follow-up migration.
UPDATE sessions
SET emp_process = 'Hand Work'
WHERE lower(trim(emp_process)) = 'khaka work';
