#!/usr/bin/env node
'use strict';

/**
 * Build a SQLite (.db) snapshot from the current local state without needing
 * the running server. Sources, in priority:
 *   1) Live HTTP /api/state (if --url provided or PORT is reachable)
 *   2) Latest offline JSON snapshot under OFFLINE_REPORT_DIR
 *
 * Usage:
 *   node scripts/snapshot-now.cjs                # build from offline JSON
 *   node scripts/snapshot-now.cjs --out snap.db  # also copy to custom path
 *   node scripts/snapshot-now.cjs --url http://localhost:3000/api/state
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sqliteSnapshot = require('../shared/sqlite-snapshot.cjs');
const offlineReportStore = require('../shared/offline-report-store.cjs');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) {
      args.url = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      args.out = argv[++i];
    } else if (a === '--dir' && argv[i + 1]) {
      args.dir = argv[++i];
    } else if (a === '--no-archive') {
      args.archive = false;
    } else if (a === '--source' && argv[i + 1]) {
      args.source = argv[++i];
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode == null || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(Math.max(1000, Number(timeoutMs) || 5000), () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function liveStateToSnapshot(payload) {
  const state = payload && payload.state ? payload.state : payload || {};
  return {
    activeSessions: state.active || {},
    completedLogs: Array.isArray(state.logs) ? state.logs : [],
    employees: Array.isArray(state.employees) ? state.employees : [],
    perf: Array.isArray(state.perf) ? state.perf : [],
    catalog: Array.isArray(state.abayas) ? state.abayas : (Array.isArray(state.catalog) ? state.catalog : []),
    catalogVersion: state.catalogVersion != null ? state.catalogVersion : null,
    workerSettings: { working_hours: state.workingHours || null },
    appVersion: state.appVersion || '',
    savedAt: Date.now(),
    source: 'live',
  };
}

function offlineJsonToSnapshot() {
  const snap = offlineReportStore.loadRestorableSnapshot({});
  if (!snap) return null;
  return {
    activeSessions: snap.active || {},
    completedLogs: Array.isArray(snap.logs) ? snap.logs : [],
    employees: [],
    perf: Array.isArray(snap.perf) ? snap.perf : [],
    catalog: [],
    catalogVersion: null,
    workerSettings: {},
    appVersion: '',
    savedAt: Number(snap.savedAt) || Date.now(),
    source: 'offline-json',
  };
}

async function gatherState(args) {
  const tryUrl = args.url || (args.source === 'live' ? `http://localhost:${process.env.PORT || 3000}/api/state` : null);
  if (tryUrl) {
    try {
      const payload = await fetchJson(tryUrl, 4000);
      console.log(`[snapshot-now] source=live url=${tryUrl}`);
      return liveStateToSnapshot(payload);
    } catch (e) {
      if (args.url) {
        throw new Error(`Live source failed: ${e.message}`);
      }
      console.warn(`[snapshot-now] live source unavailable (${e.message}); falling back to offline JSON`);
    }
  }
  const off = offlineJsonToSnapshot();
  if (!off) {
    throw new Error('No live server reachable and no offline JSON snapshot found.');
  }
  console.log('[snapshot-now] source=offline-json');
  return off;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      'snapshot-now: build SQLite snapshot from local state\n' +
        'Options:\n' +
        '  --url <http://...>    fetch /api/state from running server\n' +
        '  --source live         try live first then offline JSON\n' +
        '  --dir <path>          override snapshot output directory\n' +
        '  --out <file.db>       additional copy of the .db at this path\n' +
        '  --no-archive          do not write the timestamped archive copy\n' +
        '  -h, --help            show this message\n'
    );
    return;
  }
  const state = await gatherState(args);
  const dir = args.dir || sqliteSnapshot.defaultDir();
  const info = await sqliteSnapshot.writeSnapshot(state, {
    dir,
    archive: args.archive !== false,
    retentionDays: (() => {
      const n = Number(process.env.SQLITE_SNAPSHOT_RETENTION_DAYS);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
  });
  console.log(`[snapshot-now] wrote: ${info.latestPath}  (${info.bytes} bytes)`);
  if (info.archivePath) console.log(`[snapshot-now] archive: ${info.archivePath}`);
  if (args.out) {
    fs.copyFileSync(info.latestPath, path.resolve(args.out));
    console.log(`[snapshot-now] copy:    ${path.resolve(args.out)}`);
  }
}

main().catch((err) => {
  console.error('[snapshot-now] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
