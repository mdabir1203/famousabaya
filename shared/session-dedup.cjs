// shared/session-dedup.cjs
//
// Idempotency check for session_finish pushes to the cloud.
//
// The cloud's `sessions` table has PK = 'WL-' + emp_id + '-' + ended_at,
// so two pushes with the same (emp_id, started_at) but different
// ended_at values land as two distinct rows. This was the root cause of
// the "every row on the daily report shows the same start time" bug
// the operator reported on 2026-09-17: the factory's close-stale-sessions
// endpoint pushed a fresh session_finish each time it was called on the
// same orphan, and a power blip / repeated boot re-hydrated
// ACTIVE_SESSIONS from the offline-report before each call saw it.
//
// Two call sites in server.js use this helper:
//   1. req_finishWork socket handler — guards the worker-tapped-Finish
//      path against a duplicate push.
//   2. /api/admin/close-stale-sessions — guards the operator-driven
//      orphan-close path. The guard here also drops the in-memory
//      ACTIVE_SESSIONS row so the next call won't retry.
//
// Extracted to a shared module so the unit test in
// tests/session-dedup.test.mjs can exercise the matching logic
// without spinning up a server subprocess.

/**
 * Returns true if a session with the same (emp_id, started_at) already
 * exists in the given completed-logs array.
 *
 * @param {Array} completedLogs - The LAN's COMPLETED_LOGS array.
 * @param {string} emp_id - The xlsx-stable employee id (e.g. 'e_bc_00000138').
 * @param {number} started_at_ms - The session's started_at in milliseconds.
 *                                 LAN stores ms in COMPLETED_LOGS.start.
 * @returns {boolean} true if a duplicate (emp_id, started_at) row exists.
 */
function isDuplicateSessionFinish(completedLogs, emp_id, started_at_ms) {
  const eid = String(emp_id || '').trim();
  const startMs = Number(started_at_ms);
  if (!eid || !Number.isFinite(startMs) || startMs <= 0) return false;
  if (!Array.isArray(completedLogs) || completedLogs.length === 0) return false;
  for (let i = 0; i < completedLogs.length; i++) {
    const r = completedLogs[i];
    if (!r) continue;
    if (String(r.emp_id || '') !== eid) continue;
    const recStart = Number(r.start != null ? r.start : r.started_at);
    if (!Number.isFinite(recStart) || recStart <= 0) continue;
    // Use exact equality on ms (the LAN's `start` is already ms; the
    // cloud's `started_at` is sec but always converted to ms before push).
    if (recStart === startMs) return true;
  }
  return false;
}

module.exports = { isDuplicateSessionFinish };
