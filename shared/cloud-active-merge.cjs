// shared/cloud-active-merge.cjs
//
// Pure logic for merging the cloud's `state.active` snapshot into the
// LAN's ACTIVE_SESSIONS map. Factored out of server.js → refreshCloudToday
// so it can be unit-tested without spinning up a server subprocess.
//
// Two layers of defense are baked in here:
//
//   1. Roster translation. Cloud's emp_id is the xlsx-stable form
//      `e_bc_<barcode>`. The LAN's roster may be either that form or
//      the hardcoded `eN` form. We translate e_bc_<barcode> to the
//      matching local id so the merged row is visible on the LAN
//      dashboard.
//
//   2. Recent-finish tombstone. When the LAN just finished a worker
//      locally (req_finishWork / close-stale-sessions), the cloud's
//      `active_sessions` row can linger for 30-60 s while the
//      session_finish push is in-flight or queued for retry. During
//      that window, the cloud's view of "still active" is stale — the
//      LAN is authoritative. The tombstone lets the merge skip the
//      worker so the kiosk doesn't briefly show him as working again.
//      See shared/recent-finish-tombstone.cjs and v1.2.51 release notes.
//
// The function is pure: it doesn't touch module-level state, doesn't
// fetch, doesn't log. The caller (server.js → refreshCloudToday) wires
// it into ACTIVE_SESSIONS via the get/set callbacks and owns the
// `stats` reporting / broadcast.

/**
 * Translate the cloud's `e_bc_<barcode>` id to the matching local emp_id,
 * if we have a roster mapping. Otherwise return the cloud id unchanged
 * (the merge will still work — the row will live in ACTIVE_SESSIONS under
 * the cloud id, which is fine if the LAN uses the xlsx roster already).
 *
 * @param {string} empId - The cloud's emp_id (already extracted from the
 *                         row payload).
 * @param {Object<string, {id: string}>} bcToLocalEmp - Mapping from
 *                         barcode string → local employee record. Empty
 *                         when the LAN uses the xlsx roster directly.
 * @returns {string} The local emp_id.
 */
function translateCloudEmpIdToLocal(empId, bcToLocalEmp) {
  if (typeof empId !== 'string' || !empId) return '';
  if (!empId.startsWith('e_bc_')) return empId;
  const bc = empId.slice('e_bc_'.length);
  const lookup = bcToLocalEmp || Object.create(null);
  const localEmp = lookup[bc] || lookup[String(Number(bc)).padStart(8, '0')];
  return localEmp && localEmp.id ? localEmp.id : empId;
}

/**
 * Merge the cloud's active-session snapshot into the LAN's active map.
 *
 * Per-row behavior:
 *   - emp_id missing → skip
 *   - tombstone.isLive(localEmpId) → skip (counts as suppressed)
 *   - ACTIVE_SESSIONS already has the id → update display fields only
 *     (process, emp_name) — trust local for abaya_id and started_at
 *   - otherwise → create the row in ACTIVE_SESSIONS
 *
 * @param {Object} cloudActive - The cloud's state.active object
 *                                (keyed by anything; values carry
 *                                emp_id / process / abaya_id / etc.).
 * @param {Object} opts
 * @param {function(string): any} opts.getLocal - Reads the current
 *                                ACTIVE_SESSIONS entry for an emp_id
 *                                (returns undefined if absent).
 * @param {function(string, any): void} opts.setLocal - Writes/updates
 *                                ACTIVE_SESSIONS[emp_id].
 * @param {Object<string, {id: string}>} [opts.bcToLocalEmp] -
 *                                Optional barcode → local emp map. Pass
 *                                an empty object if the LAN already uses
 *                                xlsx ids.
 * @param {{isLive: (empId: string) => boolean}} [opts.tombstone] -
 *                                Optional recent-finish tombstone. When
 *                                provided, merge skips live tombstones.
 *                                Omit in tests that don't exercise the
 *                                tombstone path.
 * @param {function(string): number} [opts.parseStartedAt] -
 *                                Optional custom parser for started_at
 *                                (ms vs sec). Defaults to: number → as-is,
 *                                string → number * 1000, otherwise now().
 *                                Mainly for tests that pass pre-cooked
 *                                started_at values.
 * @returns {{activeAdded: number, activeReplaced: number,
 *           activeSuppressedByTombstone: number}} Per-call counters.
 */
function mergeCloudActiveIntoLocal(cloudActive, opts) {
  const getLocal = opts && opts.getLocal;
  const setLocal = opts && opts.setLocal;
  const bcToLocalEmp = (opts && opts.bcToLocalEmp) || Object.create(null);
  const tombstone = opts && opts.tombstone;
  const parseStartedAt =
    opts && typeof opts.parseStartedAt === 'function'
      ? opts.parseStartedAt
      : function defaultParseStartedAt(v) {
          if (typeof v === 'number') return v;
          if (v) {
            const n = Number(v);
            if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
          }
          return Date.now();
        };

  const stats = {
    activeAdded: 0,
    activeReplaced: 0,
    activeSuppressedByTombstone: 0,
  };

  if (!cloudActive || typeof cloudActive !== 'object') return stats;
  if (typeof getLocal !== 'function' || typeof setLocal !== 'function') return stats;

  for (const k of Object.keys(cloudActive)) {
    const ca = cloudActive[k] || {};
    let empId = ca.emp_id != null ? String(ca.emp_id) : (typeof k === 'string' && k.startsWith('e_') ? k : '');
    if (!empId) continue;
    empId = translateCloudEmpIdToLocal(empId, bcToLocalEmp);

    // v1.2.51 — recent-finish tombstone. The LAN just finished this
    // emp_id locally; the cloud's stale "still active" row is NOT
    // authoritative here.
    if (tombstone && typeof tombstone.isLive === 'function' && tombstone.isLive(empId)) {
      stats.activeSuppressedByTombstone += 1;
      continue;
    }

    const started = parseStartedAt(ca.started_at);
    const log_id = 'WL-cloudmirror-' + empId + '-' + started;
    const local = getLocal(empId);
    if (local) {
      if (ca.process && local.process !== ca.process) local.process = ca.process;
      if (ca.emp_name) local.emp_name = ca.emp_name;
      // Persist the (possibly mutated) local entry back so the caller's
      // map picks up the field updates.
      setLocal(empId, local);
      stats.activeReplaced += 1;
    } else {
      setLocal(empId, {
        emp_id: empId,
        abaya_id: ca.abaya_id != null ? String(ca.abaya_id) : '',
        log_id,
        started_at: started,
        process: ca.process || ca.emp_process || '',
        emp_name: ca.emp_name || '',
      });
      stats.activeAdded += 1;
    }
  }

  return stats;
}

module.exports = {
  translateCloudEmpIdToLocal,
  mergeCloudActiveIntoLocal,
};