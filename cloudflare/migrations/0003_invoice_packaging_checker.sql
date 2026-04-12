-- Invoice maker (with optional session fields), Packaging, Checker work types.
-- wrangler d1 execute abaya-db --remote --file=migrations/0003_invoice_packaging_checker.sql

ALTER TABLE sessions ADD COLUMN invoice_count INTEGER;
ALTER TABLE sessions ADD COLUMN invoice_serial TEXT;

ALTER TABLE daily_stats ADD COLUMN invoice_maker_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN packaging_units INTEGER DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN checker_units INTEGER DEFAULT 0;
