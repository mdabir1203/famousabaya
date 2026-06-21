#!/usr/bin/env node
'use strict';

/**
 * Verify the SQLite snapshot directory: HMAC chain in manifest.jsonl, file
 * presence, and per-file SHA-256 hashes. Exits non-zero on any tampering
 * (deleted, modified, forged, or unsigned records).
 *
 * Usage:
 *   yarn snapshot:verify
 *   node scripts/snapshot-verify.cjs --dir C:/AbayaData/sqlite-snapshots
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sqliteSnapshot = require('../shared/sqlite-snapshot.cjs');
const snapshotManifest = require('../shared/snapshot-manifest.cjs');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1]) args.dir = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      'snapshot-verify: verify .db chain integrity\n' +
        'Options:\n' +
        '  --dir <path>   override snapshot directory\n' +
        '  --json         emit machine-readable JSON\n'
    );
    return;
  }
  const dir = args.dir || sqliteSnapshot.defaultDir();
  const result = snapshotManifest.verifyManifest({ dir });

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`Snapshot dir: ${dir}\n`);
    process.stdout.write(`Records:      ${result.total} (snapshots ${result.snapshots || 0}, retires ${result.retires || 0})\n`);
    process.stdout.write(`Status:       ${result.ok ? 'OK' : 'TAMPERED'}\n`);
    if (result.lastRecord) {
      process.stdout.write(
        `Last record:  ${result.lastRecord.filename} @ ${new Date(result.lastRecord.ts).toISOString()}\n`
      );
    }
    if (result.errors && result.errors.length) {
      process.stdout.write('\nIssues:\n');
      for (const e of result.errors) {
        process.stdout.write(`  [${e.kind}] #${e.index}: ${e.detail}\n`);
      }
    }
  }

  process.exit(result.ok ? 0 : 2);
}

main();
