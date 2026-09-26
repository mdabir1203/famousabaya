// cloudflare/src/domain/data-cleanup.js
//
// Read-path scrubbing for the cloud D1, applied at the SQL layer.
//
// Why this exists:
//
// The factory's LAN server may push stale or duplicate rows to the cloud
// before it picks up v1.2.43+ (the close-stale-sessions idempotency guard
// and the active_sessions trim). Until every factory laptop has caught
// up to v1.2.44, the cloud's `active_sessions` and `sessions` tables can
// accumulate:
//
//   1. Ghost active_sessions rows for emp_ids not in the current roster
//      (e_bc_999998 sentinel, e_bc_00000141 / Ashanfi who left the roster,
//      future rosters). These appear on the Live Active Sessions tile.
//   2. Orphan active_sessions rows older than 24h with no matching
//      session_finish (close-stale-sessions never ran, or crashed before
//      pushing). v1.2.34 hides these from the live board but only on the
//      client side; the cloud still returns them.
//   3. Duplicate sessions rows: same (emp_id, started_at), different
//      ended_at. Pre-v1.2.43 the close-stale-sessions endpoint pushed a
//      fresh session_finish on every call. The cloud D1 sessions PK is
//      'WL-<emp_id>-<ended_at>' so each variant landed as a new row.
//      employee-day.js already dedups at read time; the broader /api/state
//      aggregations do not.
//
// Until the factory's deployed server has the v1.2.43 server-side
// idempotency + the v1.2.42 ghost-trim migration 0022 fully covering
// new pushes, the **cloud read path** is responsible for hiding this
// noise from the CEO dashboard.
//
// Defense in depth layers (from cheapest to most expensive):
//
//   SQL filter (here, applied in state.js/report.js)  -> drops noise at
//                                                        the source, uses
//                                                        no extra row_read
//                                                        budget.
//   In-memory dedup (employee-day.js)                 -> catches anything
//                                                        the SQL filter
//                                                        missed.
//   D1 migration 0022 / 0023 (one-time cleanups)      -> historical.
//
// Read AGENTS.md §1 (emp_id contract), §2.1 (END TIME), §3 (schema
// mirroring) before changing any of the constants below.

// Current factory roster, sourced from data/employees-manual.json.
// 19 employees as of 2026-09-19. The 20th entry `e_bc_136` (IRFAN) has
// a non-zero-padded suffix that does not match the canonical
// `e_bc_<digits>` format, so we exclude it here too — the SQL filter
// `emp_id LIKE 'e_bc_%'` already requires the regex match for shape,
// and the AGENTS.md §1 contract says only canonical IDs reach the cloud.
//
// IMPORTANT: when the operator adds / removes employees from
// data/employees-manual.json, mirror that change here in the same
// commit. Mismatch = either a real worker is hidden from the live tile
// or a former employee ghosts back. The unit test
// tests/data-cleanup.test.mjs enforces the size (>= 15, <= 30) and the
// presence of the always-known sentinel id `e_bc_00000121` (Alazar).

export const CURRENT_ROSTER_IDS = Object.freeze([
  'e_bc_00000110', // EMP110 Cyril     Checker
  'e_bc_00000111', // EMP111 Irfan     Tailor (01)
  'e_bc_00000113', // EMP113 Mojeeb    Tailor (01)
  'e_bc_00000115', // EMP115 Arif      Tailor (01)
  'e_bc_00000116', // EMP116 Ridowan   Tailor (01)
  'e_bc_00000117', // EMP117 Amirull   Tailor (01)
  'e_bc_00000118', // EMP118 Arman     Tailor (02)
  'e_bc_00000121', // EMP121 Alazar    Button
  'e_bc_00000123', // EMP123 Anasari   Embroidery
  'e_bc_00000125', // EMP125 Mouthirrahman Hand Work
  'e_bc_00000128', // EMP128 Ibrahim   Packaging
  'e_bc_00000129', // EMP129 Farhan    Hand Work
  'e_bc_00000130', // EMP130 Naserulla Hand Work
  'e_bc_00000132', // EMP132 Wasim     Hand Work
  'e_bc_00000133', // EMP133 Anwar     Hand Work
  'e_bc_00000134', // EMP134 Raees     Hand Work
  'e_bc_00000135', // EMP135 Arman Raza Tailor (01)
  'e_bc_00000138', // EMP139 Wahid     Packaging
  'e_bc_00000140', // EMP140 Saddam    Tailor (01)
]);

// "Live" = started within the last 24h AND in the current roster.
// Anything older than 24h without a session_finish is, by definition, an
// orphan. See activeSessionWhere() below for the SQL form.

/**
 * Build the SQL fragment for the active_sessions live-tile WHERE clause.
 * Centers on `nowSec` so the caller can pin a snapshot timestamp.
 *
 * Returns the fragment WITHOUT a leading `WHERE` keyword; the caller
 * composes it into the larger query. Includes the e_bc_<digits> shape
 * guard implicitly via the roster list — every entry in
 * CURRENT_ROSTER_IDS matches the regex.
 *
 * @param {number} nowSec - The "now" Unix second. Tests pass a fixed
 *                          value to make assertions deterministic; production
 *                          passes `Math.floor(Date.now() / 1000)`.
 * @returns {string} SQL fragment, e.g.
 *                   "started_at >= 1789800000 AND emp_id IN ('e_bc_00000121',...)"
 */
export function activeSessionWhere(nowSec) {
  if (!Number.isFinite(nowSec) || nowSec <= 0) {
    throw new Error('activeSessionWhere: nowSec must be a positive finite Unix second');
  }
  const ids = CURRENT_ROSTER_IDS.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  const ageCutoff = Math.floor(nowSec) - 86400;
  return `started_at >= ${ageCutoff} AND emp_id IN (${ids})`;
}

/**
 * Build a SQL CTE that picks the canonical survivor per
 * (emp_id, started_at, day_date) cluster from `sessions`. The
 * survivor is the row with the LARGEST ended_at (most recent close);
 * ties broken by id (lexicographic — the PK embeds ended_at so this
 * is consistent).
 *
 * Why include `day_date` in the partition key:
 *
 *   Each `session_finish` push lands in `sessions` with its OWN
 *   `day_date` (computed from `ended_at` in factory TZ). When a worker
 *   taps Start at 11 PM and Finish at 2 AM next day, two rows can
 *   land — one for the live Start (no ended_at, but the eventual
 *   Finish), another from a re-pushed Finish that landed on the
 *   next-day `day_date`. If dedup only PARTITIONs by `(emp_id,
 *   started_at)`, the survivor could be the next-day row even when
 *   the operator is looking at the day the Start was tapped. Adding
 *   `day_date` to the partition key scopes the dedup to the day the
 *   aggregated row actually belongs to, mirroring the JS dedup pass
 *   (which already filters by day_date first, then clusters by
 *   started_at within the filtered row set).
 *
 * Usage:
 *
 *   const sql = `
 *     ${dedupSessionsCte()}
 *     SELECT s.day_date, COUNT(*) FROM sessions s
 *     JOIN survivors w ON w.id = s.id
 *     WHERE s.day_date >= ? AND s.day_date <= ?
 *     GROUP BY s.day_date
 *   `;
 *
 * The CTE returns one row per cluster — exactly the shape the
 * dashboard needs (one Wahid row, not eight). It costs the same
 * row_read as a plain `SELECT COUNT(*)` because D1 evaluates the
 * window function in a single pass over the sessions table.
 *
 * NOTE on D1 compatibility: ROW_NUMBER() OVER is supported as of
 * compatibility_date 2024-11-01 (see cloudflare/wrangler.toml). The
 * CTE form is single-statement — no temp tables, no multi-statement
 * parsing traps like the v1.2.43 first-cut migration 0023 had.
 *
 * v1.2.47 — `day_date` was added to the partition key. Without
 * this, cross-day clusters (Start Sep 20 23:00, Finish Sep 21 02:30
 * — day_date derived from ended_at Sep 21) caused the survivor to
 * live on Sep 21 only, dropping the cluster from the Sep 20
 * recent_days aggregation even though the in-modal sessions list
 * (which uses the JS dedup pass + same-day filter) still showed it.
 * The 4u vs 3 bug from v1.2.46 became a 2u vs 3 mismatch on
 * Mouthirrahman 09-20.
 *
 * @returns {string} CTE fragment starting with "WITH survivors AS (...)".
 *                   Empty filter — works against any sessions query.
 */
export function dedupSessionsCte() {
  return `WITH survivors AS (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY emp_id, started_at, day_date
        ORDER BY ended_at DESC, id DESC
      ) AS rn
      FROM sessions
    ) WHERE rn = 1
  )`;
}

/**
 * Combine the roster/age filter for active_sessions with a parameter
 * passed at bind time. Use this when the surrounding query is
 * parameter-bound and the caller doesn't want to template the where
 * clause into the SQL string.
 *
 * Returns an object `{ whereSql, params }` — the caller does
 * `... WHERE ${whereSql}`. The age threshold is computed at call time
 * from `nowSec`; no time-dependent state in this module.
 *
 * @param {number} nowSec
 * @returns {{ whereSql: string, params: Array }}
 */
export function activeSessionWhereBound(nowSec) {
  const whereSql = activeSessionWhere(nowSec);
  return { whereSql, params: [] };
}
