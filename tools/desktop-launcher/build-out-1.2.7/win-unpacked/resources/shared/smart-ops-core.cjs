'use strict';

/**
 * Smart Operations — pure delay-detection logic (no I/O).
 *
 * Shared by the factory server (which detects delays from its live sessions and posts
 * them to the dispatch server) and reused for WhatsApp template formatting. Kept pure
 * so it is unit-testable without a running server or a live WhatsApp connection.
 */

/** Median of a numeric array. Returns 0 for an empty array. */
function median(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Per-station baseline = median completed duration for that process, but only for
 * processes with at least `minSamples` completed sessions (so a station with too
 * little history can never trigger a false alert).
 *
 * @param {{process:string, durationSec:number}[]} completed
 * @param {number} minSamples
 * @returns {Map<string, number>} process -> baseline seconds
 */
function computeBaselines(completed, minSamples) {
  const byProcess = new Map();
  for (const c of completed || []) {
    const p = String((c && c.process) || '').trim();
    const d = Number(c && c.durationSec);
    if (!p || !Number.isFinite(d) || d <= 0) continue;
    if (!byProcess.has(p)) byProcess.set(p, []);
    byProcess.get(p).push(d);
  }
  const out = new Map();
  for (const [p, arr] of byProcess) {
    if (arr.length >= minSamples) out.set(p, median(arr));
  }
  return out;
}

/**
 * Active sessions whose time-on-station exceeds baseline × multiplier. Sessions on a
 * process with no baseline (too few samples) or a baseline below `minBaselineSec` are
 * skipped — never alert on trivially short or unproven stations.
 *
 * @param {{id:string, process:string, startedAt:number, label?:string}[]} active
 * @param {Map<string, number>} baselines
 * @param {{multiplier:number, minBaselineSec:number, now:number}} opts
 * @returns {{id:string, process:string, elapsedSec:number, baselineSec:number, label:string}[]}
 */
function detectDelays(active, baselines, opts) {
  const { multiplier, minBaselineSec, now } = opts;
  const out = [];
  for (const s of active || []) {
    const proc = String((s && s.process) || '').trim();
    const baseline = baselines.get(proc);
    if (!Number.isFinite(baseline) || baseline < minBaselineSec) continue;
    const startedAt = Number(s.startedAt);
    if (!Number.isFinite(startedAt)) continue;
    const elapsedSec = Math.round((now - startedAt) / 1000);
    if (elapsedSec > baseline * multiplier) {
      out.push({
        id: String(s.id),
        process: proc,
        elapsedSec,
        baselineSec: Math.round(baseline),
        label: String(s.label || s.id),
      });
    }
  }
  return out;
}

/** Whole minutes, human-friendly (95 -> "1h 35m", 40 -> "40m"). */
function fmtMinutes(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

/**
 * WhatsApp `delay_alert` template params, in order:
 * {{1}} item, {{2}} station, {{3}} elapsed, {{4}} usual.
 * @param {{label:string, process:string, elapsedSec:number, baselineSec:number}} d
 * @returns {string[]}
 */
function formatAlertParams(d) {
  return [d.label, d.process, fmtMinutes(d.elapsedSec), '~' + fmtMinutes(d.baselineSec)];
}

/**
 * Dedup + prune. Removes tracking entries for sessions that are no longer active (so a
 * later genuine re-delay can alert again), then returns the delays not yet alerted —
 * marking them as alerted. `alerted` is a caller-owned Set that persists across ticks.
 *
 * @param {{id:string}[]} delays
 * @param {{id:string}[]} active
 * @param {Set<string>} alerted
 * @returns {typeof delays} the subset not previously alerted
 */
function selectNewAlerts(delays, active, alerted) {
  const activeIds = new Set((active || []).map((s) => String(s.id)));
  for (const id of Array.from(alerted)) {
    if (!activeIds.has(id)) alerted.delete(id);
  }
  const fresh = [];
  for (const d of delays) {
    if (alerted.has(d.id)) continue;
    alerted.add(d.id);
    fresh.push(d);
  }
  return fresh;
}

module.exports = { computeBaselines, detectDelays, formatAlertParams, selectNewAlerts };
