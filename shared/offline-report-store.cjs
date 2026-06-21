'use strict';

const fs = require('fs');
const path = require('path');

const LATEST_NAME = 'dashboard-offline-latest.json';

function defaultDir() {
  if (String(process.env.OFFLINE_REPORT_DIR || '').trim()) {
    return path.resolve(process.env.OFFLINE_REPORT_DIR);
  }
  return path.join(__dirname, '..', 'data', 'offline-dashboard-reports');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath, obj) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function parsePositiveIntOrNull(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

/**
 * @param {object} payload
 * @param {string} [dir]
 * @param {{ retentionDays?: number }} [options]
 */
function saveSnapshot(payload, dir, options) {
  const d = dir || defaultDir();
  ensureDir(d);
  const filePath = path.join(d, LATEST_NAME);
  atomicWriteJson(filePath, payload);
  const retentionDays = parsePositiveIntOrNull(options && options.retentionDays);
  if (retentionDays != null) {
    pruneOldSnapshots(d, Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  }
}

/**
 * Remove auxiliary snapshot files older than cutoff (keeps latest.json).
 * @param {string} dir
 * @param {number} cutoffMs
 */
function pruneOldSnapshots(dir, cutoffMs) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === LATEST_NAME || !name.endsWith('.json')) continue;
    if (!/^dashboard-offline-/.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoffMs) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.maxAgeMs] — max age of `savedAt` to trust file without fresh log rows
 * @param {number} [options.logWindowMs] — keep logs with end >= Date.now() - logWindowMs
 * @param {string} [options.dir]
 * @returns {null | { logs: any[], perf: any[], active: object, savedAt: number, summary?: object, version: number }}
 */
function loadRestorableSnapshot(options) {
  const opts = options || {};
  const maxAgeMs = parsePositiveIntOrNull(opts.maxAgeMs);
  const logWindowMs = parsePositiveIntOrNull(opts.logWindowMs);
  const dir = opts.dir || defaultDir();
  const filePath = path.join(dir, LATEST_NAME);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.version !== 1 || !Array.isArray(data.logs)) {
    return null;
  }
  const now = Date.now();
  const savedAt = Number(data.savedAt);
  if (!Number.isFinite(savedAt)) return null;

  const logsInWindow = data.logs.filter(function (l) {
    if (!l || typeof l.end !== 'number') return false;
    if (logWindowMs == null) return true;
    return l.end >= now - logWindowMs;
  });

  const fileStale = maxAgeMs != null && now - savedAt > maxAgeMs;
  if (fileStale && logsInWindow.length === 0) {
    return null;
  }

  let perf = Array.isArray(data.perf) ? data.perf : [];
  const active = data.active && typeof data.active === 'object' ? data.active : {};

  return {
    version: 1,
    savedAt,
    logs: logsInWindow,
    perf,
    active,
    summary: data.summary && typeof data.summary === 'object' ? data.summary : undefined,
  };
}

module.exports = {
  defaultDir,
  saveSnapshot,
  loadRestorableSnapshot,
  pruneOldSnapshots,
  LATEST_NAME,
};
