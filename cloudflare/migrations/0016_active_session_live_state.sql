-- ─── ACTIVE SESSION LIVE-STATE COLUMNS ──────────────────────────────────────
-- The local factory server is now the source of truth for the in-shift
-- elapsed, the cross-day cap, and the outside-shift flag. We store the
-- cap-aware effective_start (unix seconds) plus the live windowed_elapsed
-- and outside_shift flags so /api/state reads on the cloud dashboard show
-- the same number the local dashboard shows.
--
--   effective_started_at  - unix sec, the post-cap Start the in-shift walk
--                           anchors at. For same-day rows this equals
--                           started_at; for cross-day rows it equals
--                           max(started_at, current_shift_start_sec).
--   windowed_elapsed_sec  - in-shift seconds from effective_started_at
--                           through now (snapshot at push time; cloud
--                           re-walks at read time using this anchor).
--   outside_shift         - 0/1. True when the row is currently outside
--                           a shift window OR the cap left us with 0
--                           in-shift seconds.
--   is_cross_day          - 0/1. Diagnostic; mirrors liveRowState.is_cross_day.
--
-- The original started_at column is kept for raw wall-clock display
-- (Started label, age_sec) and for matching against sessions rows.
ALTER TABLE active_sessions ADD COLUMN effective_started_at INTEGER;
ALTER TABLE active_sessions ADD COLUMN windowed_elapsed_sec INTEGER DEFAULT 0;
ALTER TABLE active_sessions ADD COLUMN outside_shift      INTEGER DEFAULT 0;
ALTER TABLE active_sessions ADD COLUMN is_cross_day       INTEGER DEFAULT 0;
