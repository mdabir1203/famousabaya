-- Add per–work-type unit columns for job-card processes (Type of Work).
-- Apply to existing D1 database:
--   wrangler d1 execute abaya-db --remote --file=migrations/0002_work_types.sql
-- (omit --remote for local preview DB)

ALTER TABLE daily_stats ADD COLUMN tailor_01_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN tailor_02_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN hand_work_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN stone_work_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN button_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN embroidery_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN ari_work_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN hand_designing_units INTEGER DEFAULT 0;
