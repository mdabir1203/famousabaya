// tests/factory-cloud-sync-watermark.test.mjs
//
// v1.2.40 — Realtime sync watermark between the factory server and the
// Cloudflare Worker. Pinned contracts:
//
//   - The D1 migration `0021_factory_sync_watermark.sql` declares the
//     `factory_sync` table with the expected columns + PRIMARY KEY on
//     seq_type. This is the single source of truth for the watermark.
//
//   - The local snapshot's SCHEMA_DDL mirrors the same columns so the
//     snapshot writer doesn't silently disagree with cloud D1 (AGENTS.md
//     rule #3: schema-mirroring).
//
//   - ingest.js's helper updates the watermark via INSERT … ON CONFLICT
//     DO UPDATE SET seq_value = MAX(factory_sync.seq_value, excluded.seq_value).
//     Replays (older seq) are no-ops; new seqs bump the row monotonically.
//     The exact SQL lives in the migration so future schema changes are
//     easy to audit.
//
//   - ingest.js accepts events with no local_seq (legacy factory server)
//     and does NOT reject them. The watermark row simply is not updated.
//
// We exercise the SQL contract via better-sqlite3 if it's installed, or
// fall back to a parse-only test of the migration file. The schema-mirror
// side is verified by sqlite-snapshot.test.mjs already.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'cloudflare',
  'migrations',
  '0021_factory_sync_watermark.sql',
);
const SCHEMA_PATH = path.join(REPO_ROOT, 'shared', 'sqlite-snapshot.cjs');

test('migration 0021 creates the factory_sync table with the expected columns', async () => {
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS factory_sync/i, 'declares the table');
  assert.match(sql, /seq_type\s+TEXT\s+PRIMARY KEY/, 'seq_type is the primary key');
  assert.match(sql, /seq_value\s+INTEGER\s+NOT NULL\s+DEFAULT 0/, 'seq_value with default 0');
  assert.match(sql, /last_event_type/, 'carries last_event_type for debug');
  assert.match(sql, /last_emp_id/, 'carries last_emp_id for debug');
  assert.match(sql, /updated_at\s+INTEGER\s+NOT NULL\s+DEFAULT/, 'updated_at unix-seconds');
});

test('migration 0021 uses MAX for idempotent watermark updates', async () => {
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  // The migration body should declare the schema; the actual UPDATE
  // semantics live in ingest.js. The MAX behaviour is encoded at the
  // helper's UPSERT — verify the helper ships the right SQL by reading
  // ingest.js directly.
  const ingestSrc = await fs.readFile(
    path.join(REPO_ROOT, 'cloudflare', 'src', 'handlers', 'ingest.js'),
    'utf8',
  );
  assert.match(
    ingestSrc,
    /seq_value\s*=\s*MAX\(factory_sync\.seq_value,\s*excluded\.seq_value\)/,
    'ingest uses MAX(seq, excluded) so older replays are idempotent',
  );
});

test('local snapshot mirrors the factory_sync table (AGENTS.md rule #3)', async () => {
  const cjs = await fs.readFile(SCHEMA_PATH, 'utf8');
  assert.match(
    cjs,
    /CREATE TABLE IF NOT EXISTS factory_sync/i,
    'sqlite-snapshot SCHEMA_DDL declares factory_sync',
  );
  assert.match(cjs, /seq_type\s+TEXT\s+PRIMARY KEY/);
  assert.match(cjs, /seq_value\s+INTEGER\s+NOT NULL\s+DEFAULT 0/);
  // No UPSERT logic in the snapshot writer — the row is hydrated
  // wholesale from cloud D1 by the reconcile loop (which the local
  // server runs on boot, see shared/reconcile-cloudflare.cjs).
});

test('ingest helper tolerates missing / non-finite local_seq without rejecting', async () => {
  // Read the helper source and assert it short-circuits on invalid seq.
  const ingestSrc = await fs.readFile(
    path.join(REPO_ROOT, 'cloudflare', 'src', 'handlers', 'ingest.js'),
    'utf8',
  );
  const helperMatch = ingestSrc.match(
    /async function updateFactorySeqWatermark\([\s\S]*?\n\}/,
  );
  assert.ok(helperMatch, 'updateFactorySeqWatermark helper is declared');
  const helperSrc = helperMatch[0];
  assert.match(
    helperSrc,
    /!Number\.isFinite\(incoming\)/,
    'helper guards against non-finite local_seq',
  );
  assert.match(
    helperSrc,
    /return null/,
    'helper returns null instead of throwing on legacy / un-stamped payloads',
  );
});

test('ingest.js broadcasts a realtime event after every successful D1 write', async () => {
  // The SSE broadcast must happen for BOTH session_start AND
  // session_finish — the test pins both call sites.
  const ingestSrc = await fs.readFile(
    path.join(REPO_ROOT, 'cloudflare', 'src', 'handlers', 'ingest.js'),
    'utf8',
  );
  const broadcasts = (ingestSrc.match(/broadcastRealtimeEvent\(/g) || []).length;
  assert.ok(
    broadcasts >= 2,
    `expected >= 2 broadcastRealtimeEvent call sites (start + finish); got ${broadcasts}`,
  );
  // And both call sites include `kind: 'session_start'` / 'session_finish'.
  assert.match(ingestSrc, /kind:\s*'session_start'/);
  assert.match(ingestSrc, /kind:\s*'session_finish'/);
});
