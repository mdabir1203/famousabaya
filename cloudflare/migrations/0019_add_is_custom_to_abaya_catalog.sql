-- Migration 0019: add is_custom flag to abaya_catalog
--
-- Some abaya codes are CUSTOM (complex, multi-week builds that legitimately
-- span many 24h-gap build windows). The current "this build" cell shows
-- the wall-clock age of the current build, so a custom abaya that's been
-- continuously worked for 15+ days will display "373h" without context.
-- An operator unfamiliar with that code's lifecycle might read the big
-- number as a bug.
--
-- This migration adds an `is_custom` flag (default 0) to the abaya_catalog
-- so the operator can mark a code (and all physical abayas that share
-- the code) as custom. The live row's "this build" cell then renders a
-- small "Custom" pill so the operator immediately knows why the build
-- age is unusually long.
--
-- Note: catalog rows are per-abaya_id, but the operator typically marks
-- a STYLE code as custom. The simplest workflow is to mark each new
-- physical abaya of that style as custom when adding it to the catalog.
-- A future enhancement could promote this to a per-code override, but
-- the per-row flag is enough for the v1.2.16 fix.

ALTER TABLE abaya_catalog ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0;

-- Mark the known long-running custom abaya (CF111 STD-O, abaya_id 3439)
-- that the v1.2.15 audit flagged as a 4-month, 2977-session build.
-- The factory makes these by hand and the same physical garment can
-- stay on the floor for weeks at a time.
UPDATE abaya_catalog SET is_custom = 1 WHERE id = '3439';
