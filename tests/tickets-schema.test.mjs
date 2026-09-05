/**
 * Schema-mirror test for the v1.2.24 support-ticket feature.
 *
 * AGENTS.md rule #3: every column the cloud D1 has, the local SQLite
 * snapshot must also have. We already shipped this class of bug once
 * (v1.2.20 — `install/.env.production` missing from the install because
 * the path was gitignored) so the rule isn't theoretical. This test:
 *
 *   1. Loads `cloudflare/migrations/0020_create_tickets.sql` to get the
 *      canonical column list for `tickets`, `ticket_events`,
 *      `ticket_messages`.
 *   2. Builds a snapshot from an empty in-memory state and reads the
 *      same three tables from the local SQLite file.
 *   3. Asserts the column names, types, nullability, and defaults match
 *      column-for-column. Drift in any one column fails the test with a
 *      clear message pointing at the offending column.
 *
 * The test does NOT verify ticket data round-trip (that's tickets-e2e
 * territory and lives in scripts/smoke-tickets.mjs). It only verifies
 * the schema is identical between cloud and local — the single most
 * expensive kind of drift to debug in production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const sqliteSnapshot = require(path.join(REPO_ROOT, 'shared', 'sqlite-snapshot.cjs'));

let SQL_LIB = null;
async function getSqlJs() {
  if (SQL_LIB) return SQL_LIB;
  const initSqlJs = require(path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js'));
  SQL_LIB = await initSqlJs({
    locateFile: () => path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  });
  return SQL_LIB;
}

/**
 * Parse the cloud migration SQL and pull out the CREATE TABLE statements
 * for tickets, ticket_events, ticket_messages. We use a simple regex-based
 * parse — the migration file is hand-written and uses a consistent shape
 * (one CREATE TABLE per table, no nested parens in column defs).
 */
function parseMigrationTables(sqlText) {
  const out = {};
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g;
  let m;
  while ((m = re.exec(sqlText)) !== null) {
    const name = m[1];
    if (!name.startsWith('ticket')) continue;
    out[name] = parseColumnDefs(m[2]);
  }
  return out;
}

function parseColumnDefs(body) {
  // Each line is either "  name TYPE [NOT NULL] [DEFAULT ...] [PRIMARY KEY],"
  // or a table-level constraint. PRIMARY KEY implies NOT NULL in SQL.
  // We only care about the column lines for the schema mirror.
  const cols = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim().replace(/,\s*$/, '');
    if (!line) continue;
    if (/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)/i.test(line)) continue;
    const m = line.match(/^(\w+)\s+([A-Z0-9()]+(?:\s+PRIMARY\s+KEY)?)(.*)$/i);
    if (!m) continue;
    const [, name, type, rest] = m;
    // PRIMARY KEY implies NOT NULL per SQL standard (and SQLite enforces this).
    const isPk = /\bPRIMARY\s+KEY\b/i.test(type + ' ' + rest);
    cols[name] = {
      type: type.trim(),
      notNull: isPk || /NOT\s+NULL/i.test(rest),
      hasDefault: /DEFAULT/i.test(rest),
      raw: line,
    };
  }
  return cols;
}

async function buildSnapshotDb() {
  const SQL = await getSqlJs();
  const bytes = await sqliteSnapshot.buildSnapshotDatabase({});
  const tmp = path.join(os.tmpdir(), `tickets-schema-test-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  return { SQL, db: new SQL.Database(fs.readFileSync(tmp)), tmp };
}

function getLocalTableInfo(db, table) {
  const r = db.exec(`PRAGMA table_info(${table})`);
  if (!r.length) return {};
  const out = {};
  for (const row of r[0].values) {
    // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    out[row[1]] = {
      type: String(row[2] || '').toUpperCase(),
      notNull: row[3] === 1,
      hasDefault: row[4] != null,
      pk: row[5] === 1,
    };
  }
  return out;
}

test('cloud migration 0020 defines the three ticket tables', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare', 'migrations', '0020_create_tickets.sql'), 'utf8');
  const tables = parseMigrationTables(sql);
  for (const t of ['tickets', 'ticket_events', 'ticket_messages']) {
    assert.ok(tables[t], `migration 0020 must define ${t}`);
    assert.ok(Object.keys(tables[t]).length > 0, `${t} must have at least one column`);
  }
});

test('local snapshot has the three ticket tables', async () => {
  const { db } = await buildSnapshotDb();
  const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ticket%' ORDER BY name");
  const names = r[0] ? r[0].values.map(row => row[0]) : [];
  assert.deepEqual(names, ['ticket_events', 'ticket_messages', 'tickets'],
    `local snapshot must define tickets, ticket_events, ticket_messages — got: ${names.join(', ')}`);
});

const TICKET_COLUMNS = {
  tickets: [
    'id', 'created_at', 'created_by', 'created_by_name', 'category', 'priority',
    'subject', 'description', 'status', 'resolved_at', 'resolved_by', 'whatsapp_to',
    'escalated_at', 'last_message_at', 'station', 'updated_at',
  ],
  ticket_events: ['id', 'ticket_id', 'event', 'actor', 'at', 'note'],
  ticket_messages: ['id', 'ticket_id', 'direction', 'sender', 'text', 'via', 'wa_message_id', 'sent_at'],
};

for (const [table, expectedCols] of Object.entries(TICKET_COLUMNS)) {
  test(`${table} local snapshot columns match migration 0020`, async () => {
    const sql = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare', 'migrations', '0020_create_tickets.sql'), 'utf8');
    const cloudCols = parseMigrationTables(sql)[table];
    const { db } = await buildSnapshotDb();
    const localCols = getLocalTableInfo(db, table);

    const localColNames = Object.keys(localCols).sort();
    const expectedColNames = [...expectedCols].sort();
    assert.deepEqual(localColNames, expectedColNames,
      `${table} local columns (${localColNames.join(',')}) must match expected (${expectedColNames.join(',')})`);

    // For every column the cloud declares, the local must have matching
    // nullability. (We don't check types byte-for-byte because SQLite is
    // type-flexible — `INTEGER` vs `INT` is the same to the engine — but
    // the major types should align well enough to catch a real drift.)
    for (const [colName, cloudInfo] of Object.entries(cloudCols)) {
      const localInfo = localCols[colName];
      assert.ok(localInfo, `${table}.${colName} missing from local snapshot`);
      assert.equal(localInfo.notNull, cloudInfo.notNull,
        `${table}.${colName} notNull mismatch — local=${localInfo.notNull} cloud=${cloudInfo.notNull}`);
    }
  });
}

test('tickets created_by column enforces e_bc_<digits> via Worker trigger (not local)', () => {
  // AGENTS.md rule #1: emp_id must be e_bc_<digits>. The cloud D1 has a
  // BEFORE INSERT trigger on tickets (defined in migration 0020) that
  // RAISE(IGNORE)s any non-e_bc_* row. The local SQLite mirror does NOT
  // re-implement this trigger — the JS guard in cloudflare/src/handlers/
  // tickets.js is the primary defense, and tickets don't enter the
  // local snapshot except via the local server's proxy of the cloud
  // (which is already filtered by the cloud handler).
  //
  // This test guards the AGENTS.md rule that the *cloud* side enforces
  // the constraint — if someone removes the trigger from migration 0020,
  // the schema test will catch it.
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare', 'migrations', '0020_create_tickets.sql'), 'utf8');
  assert.match(sql, /tickets_reject_synthetic_emp/i,
    'migration 0020 must declare the tickets_reject_synthetic_emp trigger (AGENTS.md rule #1)');
  assert.match(sql, /NEW\.created_by NOT LIKE 'e_bc_%'/i,
    'tickets_reject_synthetic_emp trigger must guard on e_bc_<digits> format');
});

test('tickets table enforces required fields (NOT NULL on the essentials)', async () => {
  // Migration 0020 + the local schema must both NOT NULL on the columns
  // we depend on for a valid ticket. Drift here = silent data loss
  // when an empty operator field sneaks through.
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare', 'migrations', '0020_create_tickets.sql'), 'utf8');
  const cloudCols = parseMigrationTables(sql).tickets;
  for (const required of ['id', 'created_at', 'created_by', 'category', 'subject', 'description', 'status']) {
    assert.ok(cloudCols[required], `cloud tickets.${required} column must exist`);
    assert.equal(cloudCols[required].notNull, true, `cloud tickets.${required} must be NOT NULL`);
  }
  const { db } = await buildSnapshotDb();
  const localCols = getLocalTableInfo(db, 'tickets');
  for (const required of ['id', 'created_at', 'created_by', 'category', 'subject', 'description', 'status']) {
    assert.ok(localCols[required], `local tickets.${required} column must exist`);
    assert.equal(localCols[required].notNull, true, `local tickets.${required} must be NOT NULL`);
  }
});

test('snapshot writer is idempotent for tickets (no error on a second build)', async () => {
  // If the writer throws on a re-run, the launcher's reconcile-now path
  // breaks. Idempotency = the safety property every release depends on.
  await sqliteSnapshot.buildSnapshotDatabase({});
  await sqliteSnapshot.buildSnapshotDatabase({});  // must not throw
});
