-- 0012_rebuild_daily_stats.sql
--
-- After 0011_normalize_emp_process.sql normalized the 109 mis-cased rows
-- in the sessions table, the daily_stats rollup table still has the old
-- totals. The session-finish handler writes daily_stats at ingest time, so
-- rows that were originally written with emp_process='cutting' (or 'KHAKA
-- WORK') hit the wrong daily_stats column. Recompute the affected columns
-- from sessions so the per-day process split matches reality.
--
-- We rebuild total_units / total_sec / tailor_01_units / hand_work_units.
-- Other per-process columns (button, embroidery, etc.) were never affected
-- by 0011, but we recompute them too for safety using the same rollup shape
-- the ingest handler uses.
--
-- Idempotent: re-running gives the same numbers.

DELETE FROM daily_stats;

INSERT INTO daily_stats (
  stat_date, total_units, total_sec,
  tailor_01_units, tailor_02_units, hand_work_units, stone_work_units,
  button_units, embroidery_units, ari_work_units, hand_designing_units,
  invoice_maker_units, packaging_units, checker_units, cutting_units,
  stitch_units, finish_units, updated_at
)
SELECT
  day_date,
  COUNT(*) AS total_units,
  COALESCE(SUM(duration_sec), 0) AS total_sec,
  SUM(CASE WHEN emp_process = 'Tailor (01)' THEN 1 ELSE 0 END) AS tailor_01_units,
  SUM(CASE WHEN emp_process = 'Tailor (02)' THEN 1 ELSE 0 END) AS tailor_02_units,
  SUM(CASE WHEN emp_process = 'Hand Work' THEN 1 ELSE 0 END) AS hand_work_units,
  SUM(CASE WHEN emp_process = 'Stone Work' THEN 1 ELSE 0 END) AS stone_work_units,
  SUM(CASE WHEN emp_process = 'Button' THEN 1 ELSE 0 END) AS button_units,
  SUM(CASE WHEN emp_process = 'Embroidery' THEN 1 ELSE 0 END) AS embroidery_units,
  SUM(CASE WHEN emp_process = 'Ari Work' THEN 1 ELSE 0 END) AS ari_work_units,
  SUM(CASE WHEN emp_process = 'Hand Designing' THEN 1 ELSE 0 END) AS hand_designing_units,
  SUM(CASE WHEN emp_process = 'Invoice maker' THEN 1 ELSE 0 END) AS invoice_maker_units,
  SUM(CASE WHEN emp_process = 'Packaging' THEN 1 ELSE 0 END) AS packaging_units,
  SUM(CASE WHEN emp_process = 'Checker' THEN 1 ELSE 0 END) AS checker_units,
  0 AS cutting_units,    -- legacy columns, kept at 0 — Tailor (01) absorbs these now
  0 AS stitch_units,
  0 AS finish_units,
  unixepoch() AS updated_at
FROM sessions
WHERE day_date IS NOT NULL AND day_date != ''
GROUP BY day_date;
