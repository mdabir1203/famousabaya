// shared/cloud-history-merge.cjs
//
// Pure merge logic for hydrateCompletedLogsFromCloud's local-overlay
// guard. Defends the LAN's local-only rows against being overwritten
// by the cloud's stale view during the boot-time /api/state/history
// round-trip (5-30 s). Same root-cause class as the recent-finish
// tombstone (ACTIVE_SESSIONS, see shared/recent-finish-tombstone.cjs)
// and the resource-level mutation tombstones (catalog, employees,
// work types — see shared/recent-mutation-tombstone.cjs), generalized
// to the boot-hydration pull path.
//
// Why this exists
// ---------------
//
// The factory local server hydrates `COMPLETED_LOGS` from the cloud on
// every fresh boot. The hydrate is gated on `COMPLETED_LOGS.length === 0`
// at function entry, but the fetch itself takes 5-30 s, during which
// the kiosk IS listening and workers CAN tap Finish. A Finish during
// the fetch window lands in local COMPLETED_LOGS. Without this guard,
// the hydrate's `COMPLETED_LOGS = hydrated` line would overwrite those
// local-only rows.
//
// Before v1.2.52, the race silently lost 1-N rows per boot. Operators
// saw "this morning's sessions disappeared after the laptop rebooted".
// v1.2.52 captures any local rows that arrived during the fetch and
// appends them to the cloud view, deduplicated by (id) or
// (emp_id, started_at).
//
// What this function does
// -----------------------
//
// Given the cloud-view rows (already normalized to the LAN shape) and
// the local-only rows that arrived during the fetch, return a merged
// array with cloud rows first (chronological) followed by any local
// rows that don't duplicate a cloud row. Counters report what was
// preserved / skipped so callers can log them.
//
// Dedup keys
// ----------
//
//   1. `id` — the cloud's WL-<emp_id>-<ended_at> stable id. If a local
//      row has the same id (push landed during fetch, cloud includes
//      it), the local row is a duplicate of a cloud row and is
//      skipped.
//
//   2. `emp_id` + `started_at` — composite. Catches the case where
//      the local row's id is empty (push hasn't landed yet, the local
//      Finish row was just appended to COMPLETED_LOGS and doesn't
//      have a cloud-stable id). If a cloud row has the same emp_id
//      + started_at (with ANY ended_at), it's the same session and
//      the local row is skipped.
//
// If BOTH keys are absent on a local row (malformed, edge case), the
// row is preserved as-is. The merge is conservative: false positives
// (skipping a row that wasn't really a duplicate) are worse than
// false negatives (preserving a row that was a duplicate). One
// duplicate in the merged output is a small accounting error; losing
// a real session row is a factory audit failure.
//
// Scope
// -----
//
// Pure function. No I/O, no clock, no module state. Tests pass any
// inputs and assert the merged result + counters directly.
//
// Used by:
//   - server.js → hydrateCompletedLogsFromCloud (boot-time D1 hydration)
//
// Unit tests live at tests/cloud-history-merge.test.mjs.

/**
 * Merge the cloud-view rows with the local-only rows that arrived
 * during the fetch window. Cloud rows come first (chronological as the
 * cloud returned them); local-only rows that don't duplicate a cloud
 * row are appended at the end.
 *
 * @param {Array<object>} cloudRows - The cloud's `state.logs` after
 *   normalization to the LAN shape. May be empty.
 * @param {Array<object>} localRows - The COMPLETED_LOGS snapshot taken
 *   between the fetch return and the overwrite. May be empty.
 * @param {object} [opts]
 * @param {function(*): string} [opts.idOf] - Custom id extractor for
 *   dedup by id. Default: `row => row && row.id != null ? String(row.id) : ''`.
 * @param {function(*): string} [opts.keyOf] - Custom composite-key
 *   extractor for dedup by (emp_id, started_at). Default:
 *   `row => String(row.emp_id || '') + '|' + Number(row.started_at || 0)`.
 * @returns {{
 *   merged: Array<object>,
 *   localPreserved: number,
 *   localDuplicatesSkipped: number,
 * }}
 */
function mergeCloudHistoryWithLocalOverlay(cloudRows, localRows, opts) {
  const idOf = opts && typeof opts.idOf === 'function'
    ? opts.idOf
    : function defaultIdOf(row) {
        return row && row.id != null ? String(row.id) : '';
      };
  const keyOf = opts && typeof opts.keyOf === 'function'
    ? opts.keyOf
    : function defaultKeyOf(row) {
        return String(row && row.emp_id || '') + '|' + Number(row && row.started_at || 0);
      };

  const cloudIds = new Set();
  const cloudKeys = new Set();
  const safeCloud = [];
  if (Array.isArray(cloudRows)) {
    for (const row of cloudRows) {
      if (!row) continue; // skip malformed entries (null / undefined / falsy)
      const id = idOf(row);
      if (id) cloudIds.add(id);
      cloudKeys.add(keyOf(row));
      safeCloud.push(row);
    }
  }

  const localOnlyPreserved = [];
  let localDuplicatesSkipped = 0;
  if (Array.isArray(localRows)) {
    for (const row of localRows) {
      if (!row) continue;
      const id = idOf(row);
      if (id && cloudIds.has(id)) {
        localDuplicatesSkipped += 1;
        continue;
      }
      const key = keyOf(row);
      if (cloudKeys.has(key)) {
        localDuplicatesSkipped += 1;
        continue;
      }
      localOnlyPreserved.push(row);
    }
  }

  return {
    merged: safeCloud.concat(localOnlyPreserved),
    localPreserved: localOnlyPreserved.length,
    localDuplicatesSkipped,
  };
}

module.exports = {
  mergeCloudHistoryWithLocalOverlay,
};
