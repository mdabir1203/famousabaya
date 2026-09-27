// shared/recent-mutation-tombstone.cjs
//
// Resource-level "the LAN just wrote something" tombstone. Defends the LAN
// against a cloud pull that arrives in the brief window between a local
// mutation and the push-to-cloud landing — the same class of race the
// recent-finish-tombstone solves for ACTIVE_SESSIONS (see
// shared/recent-finish-tombstone.cjs and v1.2.51 release notes), but
// generalized to whole-collection resources (catalog, employees, work
// types) where per-row granularity would be overkill.
//
// Why this exists
// ---------------
//
// The factory local server is the source of truth for who is on the floor
// (AGENTS.md §1 / §11). Mutations made on the LAN must round-trip to the
// cloud before a cloud → LAN pull can be considered authoritative for
// the same data.
//
// Two cloud-LAN merge paths run on best-effort timing:
//
//   - LAN mutates locally at T0
//   - LAN calls pushCatalogToCloud / pushEmployeesToCloud at T1
//   - Push takes 200 ms-30 s to land (network latency + auth retry + queue)
//   - Meanwhile, the 60 s cloud pull (refreshAbayaCatalogFromCloud /
//     refreshEmployeesFromCloud) runs on a fixed cadence
//   - If the pull lands at T2 where T1 < T2 < T3 (push lands), the LAN
//     mutates gets overwritten with the cloud's stale view
//
// Before v1.2.52, the cloud pull was unconditional: any time the cloud
// version differed from the LAN version, the LAN array was wholesale
// replaced with the cloud's rows. This was correct in steady state but
// silently reverted operator edits in the race window.
//
// Fix: track the last-mutation timestamp per resource. While the
// tombstone is live (T2 - T0 < TTL), the cloud pull is skipped — the
// LAN's "this resource just changed" is treated as authoritative until
// the push has had a chance to land. After the TTL elapses, the pull
// resumes (so two-laptop convergence still works).
//
// Why a global resource-level tombstone, not per-row
// --------------------------------------------------
//
// Per-row tombstones (one per catalog row, one per employee) would be
// accurate but expensive: a 5,000-row catalog × 60 s of churn could
// accumulate thousands of Map entries. The "any mutation in flight"
// semantic is sufficient because:
//
//   - Operator edits (the race we're defending against) are typically
//     rare and involve 1-2 rows per edit.
//   - The full 60 s next-pull cycle will pick up the LAN state once the
//     tombstone expires — even if one specific row's change is older
//     than the mutation that triggered the tombstone, the post-pull
//     merge will reconcile once the push has landed and bumped the
//     cloud version.
//   - A more granular (per-row, per-tombstoned-id) implementation would
//     double the helper's surface area for marginal gain. If a future
//     need requires per-row tombstones (e.g. two laptops racing the
//     SAME row), extend this module or add a sibling, don't fork.
//
// Scope
// -----
//
// - In-process / per-server. Lost on restart — that's fine: on restart
//   the LAN re-hydrates from the offline-report snapshot and the cloud
//   pull sees a clean slate.
// - TTL-bounded (default 30 s). Configurable via the factory's `ttlMs`
//   arg. The 30 s default covers push latency (200 ms - 30 s, per
//   cloudflare/CEO_INGEST_RETRY_MS ceiling) plus a safety margin.
// - Not shared between factory laptops — same gap as the
//   recent-finish-tombstone. If Laptop A mutates and Laptop B's 60 s
//   pull races before A's push, B overwrites the cloud with stale data.
//   Fixing that requires either a cloud-side "row touched" cache or a
//   two-phase commit; both out of scope for v1.2.52. The TTL still
//   bounds the worst case to 30 s of staleness, which the operator can
//   spot and recover from (re-edit the row).
//
// Unit tests live at tests/recent-mutation-tombstone.test.mjs.

/**
 * Construct a resource-level mutation tombstone. The tombstone tracks the
 * millisecond timestamp of the most recent `note()` call and exposes
 * `isLive(atMs)` — true iff the most recent mutation was within
 * `ttlMs` of `atMs`.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=30000] - How long the tombstone stays
 *   live after the most recent `note()`. 30 s by default; must be > 0.
 *   Set this to cover at least push latency + retry cadence.
 * @param {function} [opts.now=Date.now] - Clock function. Tests pass a
 *   controllable clock.
 * @returns {{
 *   note: (label?: string, atMs?: number) => void,
 *   isLive: (atMs?: number) => boolean,
 *   getLastMutationAt: () => (number|null),
 *   ttlMs: number,
 *   clear: () => void,
 * }}
 */
function makeRecentMutationTombstone(opts) {
  const ttlMs =
    opts && Number.isFinite(opts.ttlMs) && opts.ttlMs > 0
      ? Math.floor(opts.ttlMs)
      : 30000;
  const now = opts && typeof opts.now === 'function' ? opts.now : Date.now;

  // 0 means "never noted". Using null would require an extra
  // Number.isFinite check on every isLive() call.
  let lastMutationAt = 0;

  function note(label, atMs) {
    // `label` is reserved for future per-resource subdivision; today
    // the tombstone is global so we accept and ignore it.
    let t;
    if (atMs === undefined) {
      t = now();
    } else if (Number.isFinite(atMs)) {
      t = atMs;
    } else {
      // Explicit invalid input (NaN, Infinity, null when treated as
      // number). Skip — let the next legitimate note() / TTL expiry
      // determine liveness. A NaN-as-timestamp would otherwise
      // silently corrupt liveness checks downstream.
      return;
    }
    if (!Number.isFinite(t)) return;
    lastMutationAt = t;
  }

  function isLive(atMs) {
    if (!Number.isFinite(lastMutationAt) || lastMutationAt === 0) return false;
    const t = Number.isFinite(atMs) ? atMs : now();
    if (!Number.isFinite(t)) return false;
    return t - lastMutationAt < ttlMs;
  }

  function getLastMutationAt() {
    return lastMutationAt === 0 ? null : lastMutationAt;
  }

  function clear() {
    lastMutationAt = 0;
  }

  return {
    note,
    isLive,
    getLastMutationAt,
    clear,
    ttlMs,
  };
}

module.exports = { makeRecentMutationTombstone };
