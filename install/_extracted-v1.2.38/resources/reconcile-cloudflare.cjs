'use strict';

/**
 * Local-priority reconciliation between the factory in-memory state and the
 * Cloudflare D1 view exposed by the Worker (/api/state).
 *
 * Behavior:
 *   - Pull the cloud snapshot once per cycle.
 *   - For local completed sessions whose deterministic `WL-<emp>-<ended_at_sec>`
 *     id is missing in cloud, re-push as `session_finish`.
 *   - For local active sessions whose emp_id is missing in cloud `active`,
 *     re-push as `session_start`.
 *   - Cloud-only rows are recorded (never mutated locally) since the local
 *     dataset is authoritative for current operations.
 *   - Field-level differences on shared rows are counted as
 *     `conflicts_resolved_local`; cloud uses `INSERT OR IGNORE` so we cannot
 *     overwrite there, but local stays canonical for dashboards.
 *
 * The module is side-effect-free: it asks the caller to hand it a state
 * snapshot and a `push(type, payload)` function (server.js already has
 * `pushToCloudflare` which queues retries on failure).
 */

const DEFAULT_MAX_REPUSH_PER_CYCLE = 50;
const DEFAULT_FETCH_TIMEOUT_MS = 8000;

function buildSessionId(empId, endedAtSec) {
  return 'WL-' + String(empId) + '-' + Number(endedAtSec);
}

function localCompletedToCloudPayload(rec, employees, catalog) {
  const empRow = employees.find((e) => String(e.id) === String(rec.emp_id)) || {};
  const ab = catalog.find((a) => String(a.id) === String(rec.abaya_id || '')) || null;
  const startedSec = Math.floor(Number(rec.start) / 1000);
  const endedSec = Math.floor(Number(rec.end) / 1000);
  const payload = {
    emp_id: String(rec.emp_id),
    emp_name: empRow.name || '',
    emp_code: empRow.code || '',
    emp_process: rec.process || empRow.process || 'Tailor (01)',
    emp_color: empRow.color || null,
    emp_initials: empRow.initials || null,
    abaya_id: rec.abaya_id != null ? String(rec.abaya_id) : null,
    abaya_code: ab ? String(ab.code || '') : null,
    station: 'S-02',
    started_at: startedSec,
    ended_at: endedSec,
    duration_sec: Math.max(0, Number(rec.duration_sec) || 0),
  };
  if (rec.process === 'Invoice maker') {
    if (rec.invoice_count != null) payload.invoice_count = rec.invoice_count;
    if (rec.invoice_serial != null) payload.invoice_serial = rec.invoice_serial;
  }
  if (rec.process === 'Checker') {
    if (rec.quantity != null) payload.quantity = rec.quantity;
    if (rec.checker_barcode != null) payload.checker_barcode = rec.checker_barcode;
  }
  return payload;
}

function localActiveToCloudPayload(sess, employees, catalog) {
  const empRow = employees.find((e) => String(e.id) === String(sess.emp_id)) || {};
  const ab = catalog.find((a) => String(a.id) === String(sess.abaya_id || '')) || null;
  return {
    emp_id: String(sess.emp_id),
    emp_name: empRow.name || '',
    emp_code: empRow.code || '',
    emp_process: sess.process || empRow.process || 'Tailor (01)',
    emp_color: empRow.color || null,
    emp_initials: empRow.initials || null,
    abaya_id: sess.abaya_id != null ? String(sess.abaya_id) : null,
    abaya_code: ab ? String(ab.code || '') : null,
    station: 'S-02',
    started_at: Math.floor(Number(sess.started_at) / 1000),
  };
}

async function fetchCloudState(cfUrl, cfSecret, timeoutMs) {
  const base = String(cfUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('CF_WORKER_URL not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs || DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(base + '/api/state?days=400&limit=5000', {
      method: 'GET',
      headers: cfSecret
        ? {
            Authorization: 'Bearer ' + cfSecret,
            'X-Ingest-Secret': cfSecret,
          }
        : {},
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a single reconciliation pass.
 *
 * @param {object} deps
 * @param {string} deps.cfUrl
 * @param {string} deps.cfSecret
 * @param {() => { activeSessions: Record<string, any>, completedLogs: Array<any>, employees: Array<any>, catalog: Array<any> }} deps.getLocalState
 * @param {(type: string, payload: any) => any} deps.push
 * @param {object} [opts]
 * @param {number} [opts.maxRepushPerCycle]
 * @param {number} [opts.fetchTimeoutMs]
 * @param {(...args: any[]) => void} [opts.log]
 * @returns {Promise<object>} metrics
 */
async function reconcileOnce(deps, opts) {
  const options = opts || {};
  const log = options.log || (() => {});
  const maxRepush = Math.max(1, Number(options.maxRepushPerCycle) || DEFAULT_MAX_REPUSH_PER_CYCLE);
  const startedAt = Date.now();

  const result = {
    ok: true,
    started_at: startedAt,
    finished_at: null,
    duration_ms: 0,
    cloud_logs_seen: 0,
    cloud_active_seen: 0,
    local_logs_seen: 0,
    local_active_seen: 0,
    replayed_finishes: 0,
    replayed_starts: 0,
    conflicts_resolved_local: 0,
    cloud_only_seen: 0,
    hard_failures: 0,
    error: null,
    ingest_lag_ms: null,
  };

  if (!deps.cfUrl || !deps.cfSecret) {
    result.ok = false;
    result.error = 'cloud-not-configured';
    result.finished_at = Date.now();
    result.duration_ms = result.finished_at - startedAt;
    return result;
  }

  let cloudState;
  try {
    cloudState = await fetchCloudState(deps.cfUrl, deps.cfSecret, options.fetchTimeoutMs);
  } catch (e) {
    result.ok = false;
    result.error = 'cloud-fetch:' + (e && e.message ? e.message : String(e));
    result.finished_at = Date.now();
    result.duration_ms = result.finished_at - startedAt;
    log('reconcile: fetch failed', result.error);
    return result;
  }

  const cloudLogs = Array.isArray(cloudState.logs) ? cloudState.logs : [];
  const cloudActive = cloudState.active && typeof cloudState.active === 'object' ? cloudState.active : {};
  const cloudIds = new Set(cloudLogs.map((l) => String(l.id)));
  const cloudByLog = new Map(cloudLogs.map((l) => [String(l.id), l]));

  result.cloud_logs_seen = cloudLogs.length;
  result.cloud_active_seen = Object.keys(cloudActive).length;
  result.ingest_lag_ms = Number(cloudState.ingest_lag_ms) || null;

  const local = deps.getLocalState();
  const completedLogs = Array.isArray(local && local.completedLogs) ? local.completedLogs : [];
  const activeSessions = local && local.activeSessions && typeof local.activeSessions === 'object'
    ? local.activeSessions : {};
  const employees = Array.isArray(local && local.employees) ? local.employees : [];
  const catalog = Array.isArray(local && local.catalog) ? local.catalog : [];

  result.local_logs_seen = completedLogs.length;
  result.local_active_seen = Object.keys(activeSessions).length;

  const localIds = new Set();

  /** Identify completed sessions to repush. */
  let repushedFinishes = 0;
  for (let i = completedLogs.length - 1; i >= 0 && repushedFinishes < maxRepush; i -= 1) {
    const rec = completedLogs[i];
    if (!rec || rec.emp_id == null) continue;
    const endedSec = Math.floor(Number(rec.end) / 1000);
    if (!Number.isFinite(endedSec)) continue;
    const id = buildSessionId(rec.emp_id, endedSec);
    localIds.add(id);

    const cloudRow = cloudByLog.get(id);
    if (cloudRow) {
      /** Same id present in both — check field-level difference. */
      const cloudDur = Number(cloudRow.duration_sec);
      const localDur = Number(rec.duration_sec);
      const cloudProc = String(cloudRow.process || cloudRow.emp_process || '');
      const localProc = String(rec.process || '');
      if (
        (Number.isFinite(cloudDur) && Number.isFinite(localDur) && Math.abs(cloudDur - localDur) > 1) ||
        (cloudProc && localProc && cloudProc !== localProc)
      ) {
        result.conflicts_resolved_local += 1;
      }
      continue;
    }

    /** Missing in cloud — re-push. push() returns whatever the caller's queueing wrapper returns; we do not block on it. */
    try {
      const payload = localCompletedToCloudPayload(rec, employees, catalog);
      await Promise.resolve(deps.push('session_finish', payload));
      repushedFinishes += 1;
      result.replayed_finishes += 1;
    } catch (e) {
      result.hard_failures += 1;
      log('reconcile: repush finish failed', id, e && e.message);
    }
  }

  /** Identify active sessions present locally but missing in cloud. */
  let repushedStarts = 0;
  for (const empId of Object.keys(activeSessions)) {
    if (repushedStarts >= maxRepush) break;
    const sess = activeSessions[empId];
    if (!sess || sess.emp_id == null) continue;
    if (cloudActive[String(sess.emp_id)]) continue;
    try {
      const payload = localActiveToCloudPayload(sess, employees, catalog);
      await Promise.resolve(deps.push('session_start', payload));
      repushedStarts += 1;
      result.replayed_starts += 1;
    } catch (e) {
      result.hard_failures += 1;
      log('reconcile: repush start failed', empId, e && e.message);
    }
  }

  /** Cloud-only rows: present in cloud's last 100 but not in our local memory. */
  for (const id of cloudIds) {
    if (!localIds.has(id)) result.cloud_only_seen += 1;
  }

  result.finished_at = Date.now();
  result.duration_ms = result.finished_at - startedAt;
  return result;
}

/**
 * Start a guarded reconciliation loop. Returns a stop() function and a
 * getStatus() function exposing the latest metrics.
 *
 * Backoff: on consecutive failures we multiply the interval by 2 (capped).
 * On success we reset to the base interval.
 */
function startReconcileLoop(deps, opts) {
  const options = opts || {};
  const baseIntervalMs = Math.max(60 * 1000, Number(options.intervalMs) || 5 * 60 * 1000);
  const maxIntervalMs = Math.max(baseIntervalMs * 2, Number(options.maxIntervalMs) || 30 * 60 * 1000);
  const log = options.log || (() => {});
  let timer = null;
  let running = false;
  let stopped = false;
  let currentInterval = baseIntervalMs;
  let consecutiveFailures = 0;
  /** @type {object | null} */
  let lastResult = null;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const r = await reconcileOnce(deps, options);
      lastResult = r;
      if (r.ok) {
        consecutiveFailures = 0;
        currentInterval = baseIntervalMs;
      } else {
        consecutiveFailures += 1;
        currentInterval = Math.min(maxIntervalMs, baseIntervalMs * Math.pow(2, consecutiveFailures));
      }
      log('reconcile: tick',
        'replayed_finishes=' + r.replayed_finishes,
        'replayed_starts=' + r.replayed_starts,
        'conflicts=' + r.conflicts_resolved_local,
        'cloud_only=' + r.cloud_only_seen,
        'hard_failures=' + r.hard_failures,
        'duration_ms=' + r.duration_ms,
        r.error ? 'error=' + r.error : '');
    } catch (e) {
      consecutiveFailures += 1;
      currentInterval = Math.min(maxIntervalMs, baseIntervalMs * Math.pow(2, consecutiveFailures));
      lastResult = {
        ok: false,
        error: 'tick-throw:' + (e && e.message ? e.message : String(e)),
        finished_at: Date.now(),
      };
      log('reconcile: tick threw', lastResult.error);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, currentInterval);
    }
  }

  timer = setTimeout(tick, Math.min(15000, baseIntervalMs));

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    getStatus() {
      return {
        running,
        stopped,
        currentIntervalMs: currentInterval,
        consecutiveFailures,
        lastResult,
      };
    },
    triggerNow() {
      if (timer) clearTimeout(timer);
      return tick();
    },
  };
}

module.exports = {
  reconcileOnce,
  startReconcileLoop,
  buildSessionId,
};
