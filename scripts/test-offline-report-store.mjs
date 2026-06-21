#!/usr/bin/env node
/**
 * Unit-style checks for shared/offline-report-store.cjs (no running server).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const store = require('../shared/offline-report-store.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-offline-'));

let failed = 0;
function ok(name) {
  console.log('  OK', name);
}
function bad(name, err) {
  failed += 1;
  console.error('  FAIL', name + ':', err?.message || err);
}

const now = Date.now();
const freshLog = { emp_id: 'e1', abaya_id: 'a1', end: now - 1000, duration_sec: 10 };
const staleLog = { emp_id: 'e1', abaya_id: 'a1', end: now - 48 * 60 * 60 * 1000, duration_sec: 5 };

store.saveSnapshot(
  {
    version: 1,
    savedAt: now,
    windowStartMs: now - 3600000,
    windowEndMs: now,
    summary: { completedSessionsInWindow: 1, activeSessionsCount: 0 },
    logs: [freshLog, staleLog],
    perf: [{ id: 'e1', units: 2, eff: 50, act: 10, idl: 0 }],
    active: {},
  },
  tmp
);

const snap = store.loadRestorableSnapshot({ dir: tmp, maxAgeMs: 24 * 60 * 60 * 1000, logWindowMs: 24 * 60 * 60 * 1000 });
if (snap && snap.logs.length === 1 && snap.logs[0].end === freshLog.end) {
  ok('loadRestorableSnapshot filters stale log rows');
} else bad('loadRestorableSnapshot filters stale log rows', new Error('unexpected snapshot'));

const keepAll = store.loadRestorableSnapshot({ dir: tmp });
if (keepAll && keepAll.logs.length === 2) {
  ok('loadRestorableSnapshot keeps all logs by default (unlimited)');
} else bad('loadRestorableSnapshot keeps all logs by default (unlimited)', new Error('unexpected default retention behavior'));

store.saveSnapshot(
  {
    version: 1,
    savedAt: now - 25 * 60 * 60 * 1000,
    windowStartMs: now - 26 * 60 * 60 * 1000,
    windowEndMs: now - 25 * 60 * 60 * 1000,
    summary: {},
    logs: [staleLog],
    perf: [],
    active: {},
  },
  tmp
);
const empty = store.loadRestorableSnapshot({ dir: tmp, maxAgeMs: 24 * 60 * 60 * 1000, logWindowMs: 24 * 60 * 60 * 1000 });
if (empty == null) {
  ok('loadRestorableSnapshot returns null when file stale and no fresh logs');
} else bad('loadRestorableSnapshot returns null when file stale and no fresh logs', new Error('expected null'));

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (_) {}

process.exit(failed ? 1 : 0);
