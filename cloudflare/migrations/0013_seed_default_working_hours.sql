-- 0013_seed_default_working_hours.sql
--
-- Bug 5: worker_settings was empty in D1, so the worker's getWorkingHoursConfig
-- always returned the JS default. If anyone ever saved an override on the
-- LAN, the PUT would write a row, but until then the table was empty.
--
-- Seed the default Dubai shift config so the table has the canonical value
-- the local server already uses. Idempotent: ON CONFLICT skips if the row
-- already exists.

INSERT INTO worker_settings (k, v, updated_at)
VALUES (
  'working_hours_v1',
  '{
    "profile": "normal",
    "timezone": "Asia/Dubai",
    "days": {
      "sat": [["09:00","13:30"],["15:00","20:00"],["20:40","23:30"]],
      "sun": [["09:00","13:30"],["15:00","20:00"],["20:40","23:30"]],
      "mon": [["09:00","13:30"],["15:00","20:00"],["20:40","23:30"]],
      "tue": [["09:00","13:30"],["15:00","20:00"],["20:40","23:30"]],
      "wed": [["09:00","13:30"],["15:00","20:00"],["20:40","23:30"]],
      "thu": [["09:00","13:30"],["15:00","20:00"],["20:40","23:30"]],
      "fri": [["15:00","20:00"],["20:40","23:30"]]
    }
  }',
  unixepoch()
)
ON CONFLICT(k) DO NOTHING;
