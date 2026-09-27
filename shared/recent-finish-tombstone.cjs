// shared/recent-finish-tombstone.cjs
//
// Short-lived "the LAN just finished this worker" marker used to defend
// the LAN dashboard against the cloud's stale `active_sessions` row
// during the push → receipt window. See docs/releases/v1.2.51.md and
// server.js → refreshCloudToday for the call sites.
//
// Why this exists
// ---------------
//
// The factory local server is the source of truth for who is currently
// working on the floor (AGENTS.md §1 / §11 — see also the v1.2.45
// release notes). When a worker taps Finish at the kiosk, the LAN
// immediately removes them from ACTIVE_SESSIONS and broadcasts the new
// state to every kiosk client — Arman Reza disappears from the live
// board within ~50 ms.
//
// The cloud's `active_sessions` table is a write-through cache of past
// `session_start` events. The factory pushes `session_finish` when a
// worker taps Finish, and the cloud's ingest handler deletes the
// matching row from `active_sessions` at that moment. Both legs happen
// on best-effort:
//
//   1. The push is asynchronous. The cloud may take 200 ms-30 s to
//      reflect the deletion (worker latency + retry queue + eventual
//      consistency on the LAN side).
//   2. The push can fail (network blip, auth rejection, worker 5xx).
//      It then sits in the `ceo-ingest-queue.jsonl` retry buffer for
//      up to 30 s before the next attempt (CEO_INGEST_RETRY_MS).
//
// `refreshCloudToday` runs every 30 s and pulls the cloud's view of
// active sessions. It then merges any cloud row that has no matching
// local entry back into ACTIVE_SESSIONS — assuming the cloud's view is
// authoritative for that row.
//
// This is the right default for cross-laptop sync (another factory
// laptop may have started a session that this laptop doesn't know
// about), but it is **wrong** for the same-laptop case: if the local
// LAN just removed Arman from ACTIVE_SESSIONS via a worker Finish tap,
// the cloud's stale "still active" row is not authoritative — the
// local LAN is.
//
// Before v1.2.51 the merge unconditionally re-added Arman. The kiosk
// then showed him as working again, ~30-60 s after his Finish tap. The
// push would eventually succeed and Arman would disappear again, but
// the operator-visible "Arman is back" flash was confusing and showed
// up in the field on every flaky Wi-Fi moment.
//
// The fix: track a short-lived tombstone per emp_id on the LAN. While
// the tombstone is live, the merge skips that emp_id. The TTL is set
// long enough to cover at least two push-retry cycles (60 s) plus
// worker latency (5 s) — 5 minutes total by default, comfortable
// against any real-world retry cadence.
//
// Scope
// -----
//
// Tombstones are intentionally per-process / in-memory only:
//   - Lost on LAN-server restart. That's fine: on restart the LAN
//     re-hydrates ACTIVE_SESSIONS from the offline-report snapshot, and
//     a stale cloud row would correctly re-hydrate the worker — that
//     worker's session really is active on the floor.
//   - Not shared between factory laptops. That's a known gap: if Laptop
//     A's session_finish push fails AND Laptop B is running, Laptop B's
//     refreshCloudToday could still resurrect the worker. Fixing that
//     requires a cloud-side tombstone or LAN coordination, neither of
//     which is in scope for v1.2.51.
//   - TTL-bounded, so a forgotten tombstone never permanently hides a
//     worker.
//
// The 5-minute default is configurable via RECENT_FINISH_TOMBSTONE_MS
// in server.js. The floor is 30 s — anything shorter risks leaving the
// kiosk exposed during a real push retry.
//
// Unit tests live at tests/recent-finish-tombstone.test.mjs.

/**
 * Construct a tombstone store. The store is a Map keyed by emp_id with
 * the value being the millisecond timestamp the tombstone was created.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=300000] - How long a tombstone stays
 *   live. 5 minutes by default; must be > 0.
 * @param {function} [opts.now=Date.now] - Clock function. Tests pass a
 *   controllable clock.
 * @returns {{
 *   note: (empId: string, atMs?: number) => void,
 *   isLive: (empId: string, atMs?: number) => boolean,
 *   consume: (empId: string, atMs?: number) => boolean,
 *   pruneExpired: (atMs?: number) => number,
 *   size: () => number,
 *   clear: () => void,
 *   _peek: (empId: string) => (number|null),
 *   ttlMs: number,
 * }}
 */
function makeRecentFinishTombstone(opts) {
  const ttlMs =
    opts && Number.isFinite(opts.ttlMs) && opts.ttlMs > 0
      ? Math.floor(opts.ttlMs)
      : 5 * 60 * 1000;
  const now = opts && typeof opts.now === 'function' ? opts.now : Date.now;
  const map = new Map();

  function note(empId, atMs) {
    if (typeof empId !== 'string') return; // emp_id is always a string in this codebase
    const key = empId.trim();
    if (!key) return;
    const ts = Number.isFinite(atMs) ? atMs : now();
    if (!Number.isFinite(ts)) return; // reject NaN / Infinity; ts=0 is allowed (epoch tombstone — already expired)
    map.set(key, ts);
  }

  function isLive(empId, atMs) {
    if (typeof empId !== 'string') return false;
    const key = empId.trim();
    if (!key) return false;
    const ts = map.get(key);
    if (!Number.isFinite(ts)) return false;
    const t = Number.isFinite(atMs) ? atMs : now();
    if (!Number.isFinite(t)) return false;
    return t - ts < ttlMs;
  }

  function consume(empId, atMs) {
    const wasLive = isLive(empId, atMs);
    if (typeof empId === 'string' && empId.trim()) {
      map.delete(empId.trim());
    }
    return wasLive;
  }

  function pruneExpired(atMs) {
    const t = Number.isFinite(atMs) ? atMs : now();
    let removed = 0;
    for (const [k, ts] of map) {
      if (!Number.isFinite(ts) || t - ts >= ttlMs) {
        map.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  function size() {
    return map.size;
  }

  function clear() {
    map.clear();
  }

  function _peek(empId) {
    if (typeof empId !== 'string') return null;
    const key = empId.trim();
    if (!key || !map.has(key)) return null;
    return map.get(key);
  }

  return { note, isLive, consume, pruneExpired, size, clear, _peek, ttlMs };
}

module.exports = { makeRecentFinishTombstone };