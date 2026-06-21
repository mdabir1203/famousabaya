#!/usr/bin/env node
'use strict';

/**
 * Import a local SQLite (.db) snapshot.
 *
 * Modes:
 *   --info                   Print row counts and metadata (default).
 *   --to-sql <out.sql>       Emit D1-compatible UPSERT SQL for the listed tables.
 *   --to-d1 [--remote]       Pipe the generated SQL into Cloudflare D1 via wrangler.
 *
 * Notes:
 *   * Cloudflare D1 cannot import a raw .db file; we emit SQL instead.
 *   * Local SQLite tools (DB Browser, sqlite3 CLI) can open the .db directly.
 *   * Sessions use INSERT OR IGNORE; daily_stats / abaya_time_map use ON CONFLICT
 *     DO UPDATE so cloud aggregates merge with what is already there.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sqliteSnapshot = require('../shared/sqlite-snapshot.cjs');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--info') args.info = true;
    else if (a === '--to-sql' && argv[i + 1]) args.toSql = argv[++i];
    else if (a === '--to-d1') args.toD1 = true;
    else if (a === '--remote') args.remote = true;
    else if (a === '--db' && argv[i + 1]) args.db = argv[++i];
    else if (a === '--db-name' && argv[i + 1]) args.dbName = argv[++i];
    else if (a === '--config' && argv[i + 1]) args.config = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else args._.push(a);
  }
  if (!args.db && args._.length) args.db = args._[0];
  return args;
}

function escapeSqlValue(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function rowsToObjects(stmt) {
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.reset();
  return out;
}

function tableRows(db, table) {
  try {
    const stmt = db.prepare(`SELECT * FROM ${table}`);
    const rows = rowsToObjects(stmt);
    stmt.free();
    return rows;
  } catch (_) {
    return [];
  }
}

function buildInsertOrIgnore(table, rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const head = `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES`;
  const lines = rows.map((r) => `  (${cols.map((c) => escapeSqlValue(r[c])).join(', ')})`);
  return `${head}\n${lines.join(',\n')};\n`;
}

function buildDailyStatsUpsert(rows) {
  if (!rows.length) return '';
  const numericCols = [
    'total_units', 'total_sec',
    'tailor_01_units', 'tailor_02_units', 'hand_work_units', 'stone_work_units',
    'button_units', 'embroidery_units', 'ari_work_units', 'hand_designing_units',
    'invoice_maker_units', 'packaging_units', 'checker_units',
  ];
  const stmts = [];
  for (const r of rows) {
    const cols = ['stat_date', ...numericCols, 'updated_at'];
    const values = cols.map((c) => escapeSqlValue(r[c] != null ? r[c] : (c === 'updated_at' ? Math.floor(Date.now() / 1000) : 0)));
    const setParts = numericCols.map((c) => `${c} = ${c} + excluded.${c}`).concat(['updated_at = unixepoch()']);
    stmts.push(
      `INSERT INTO daily_stats (${cols.join(', ')}) VALUES (${values.join(', ')})\n` +
        `ON CONFLICT(stat_date) DO UPDATE SET ${setParts.join(', ')};`
    );
  }
  return stmts.join('\n') + '\n';
}

function buildAbayaTimeUpsert(rows) {
  if (!rows.length) return '';
  const stmts = [];
  for (const r of rows) {
    const vals = [
      escapeSqlValue(r.abaya_id),
      escapeSqlValue(r.abaya_code),
      escapeSqlValue(r.cumulative_in_window_sec || 0),
      escapeSqlValue(r.first_started_at),
      escapeSqlValue(r.last_ended_at),
    ];
    stmts.push(
      `INSERT INTO abaya_time_map (abaya_id, abaya_code, cumulative_in_window_sec, first_started_at, last_ended_at, updated_at) ` +
        `VALUES (${vals.join(', ')}, unixepoch())\n` +
        `ON CONFLICT(abaya_id) DO UPDATE SET\n` +
        `  abaya_code = COALESCE(excluded.abaya_code, abaya_time_map.abaya_code),\n` +
        `  cumulative_in_window_sec = abaya_time_map.cumulative_in_window_sec + excluded.cumulative_in_window_sec,\n` +
        `  first_started_at = CASE WHEN abaya_time_map.first_started_at IS NULL THEN excluded.first_started_at ` +
        `WHEN excluded.first_started_at < abaya_time_map.first_started_at THEN excluded.first_started_at ` +
        `ELSE abaya_time_map.first_started_at END,\n` +
        `  last_ended_at = CASE WHEN abaya_time_map.last_ended_at IS NULL THEN excluded.last_ended_at ` +
        `WHEN excluded.last_ended_at > abaya_time_map.last_ended_at THEN excluded.last_ended_at ` +
        `ELSE abaya_time_map.last_ended_at END,\n` +
        `  updated_at = unixepoch();`
    );
  }
  return stmts.join('\n') + '\n';
}

async function readSnapshotSummary(filePath) {
  const handle = await sqliteSnapshot.openSnapshotDatabase(filePath);
  const tables = ['sessions', 'active_sessions', 'daily_stats', 'abaya_catalog', 'abaya_time_map', 'employees', 'snapshot_meta'];
  const summary = {};
  for (const t of tables) {
    try {
      const stmt = handle.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`);
      stmt.step();
      summary[t] = stmt.getAsObject().n;
      stmt.free();
    } catch (_) {
      summary[t] = null;
    }
  }
  let meta = {};
  try {
    const stmt = handle.db.prepare(`SELECT k, v FROM snapshot_meta`);
    while (stmt.step()) {
      const r = stmt.getAsObject();
      meta[r.k] = r.v;
    }
    stmt.free();
  } catch (_) { /* ignore */ }
  handle.close();
  return { summary, meta };
}

async function buildSqlForD1(filePath) {
  const handle = await sqliteSnapshot.openSnapshotDatabase(filePath);
  try {
    const sessions = tableRows(handle.db, 'sessions');
    const catalog = tableRows(handle.db, 'abaya_catalog');
    const catalogMeta = tableRows(handle.db, 'catalog_meta');
    const dailyStats = tableRows(handle.db, 'daily_stats');
    const abayaTime = tableRows(handle.db, 'abaya_time_map');
    const workerSettings = tableRows(handle.db, 'worker_settings');

    let out = `-- Generated by scripts/import-snapshot.cjs from ${path.basename(filePath)}\n`;
    out += `-- This script is idempotent: sessions use INSERT OR IGNORE, aggregates use ON CONFLICT DO UPDATE.\n`;
    out += `-- It does NOT delete cloud rows — only inserts/merges.\n\n`;
    out += `BEGIN;\n`;
    out += buildInsertOrIgnore('sessions', sessions);
    out += `\n-- Catalog (replace by id, keep cloud rows missing locally)\n`;
    out += buildInsertOrIgnore('abaya_catalog', catalog);
    if (catalogMeta.length) out += buildInsertOrIgnore('catalog_meta', catalogMeta);
    out += `\n-- Daily aggregates (additive)\n`;
    out += buildDailyStatsUpsert(dailyStats);
    out += `\n-- Per-abaya cumulative time\n`;
    out += buildAbayaTimeUpsert(abayaTime);
    if (workerSettings.length) {
      out += `\n-- Worker settings\n`;
      out += buildInsertOrIgnore('worker_settings', workerSettings);
    }
    out += `COMMIT;\n`;
    return out;
  } finally {
    handle.close();
  }
}

function spawnWrangler(scriptPath, args) {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd.exe' : 'sh';
  const wranglerArgs = ['d1', 'execute', ...args, '--file', scriptPath];
  const full = isWin
    ? ['/c', 'yarn', 'wrangler', ...wranglerArgs]
    : ['-c', `yarn wrangler ${wranglerArgs.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`];
  const res = spawnSync(cmd, full, { stdio: 'inherit', cwd: path.join(__dirname, '..', 'cloudflare') });
  return res.status || 0;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.db && !args.info && !args.toSql && !args.toD1)) {
    process.stdout.write(
      'import-snapshot: inspect or replay a SQLite (.db) snapshot\n' +
        'Usage:\n' +
        '  node scripts/import-snapshot.cjs --info [--db file.db]\n' +
        '  node scripts/import-snapshot.cjs --to-sql out.sql [--db file.db]\n' +
        '  node scripts/import-snapshot.cjs --to-d1 [--remote] [--db-name abaya-db] [--config wrangler.toml] [--db file.db]\n' +
        '\nWhen --db is omitted, abaya-snapshot-latest.db in the configured snapshot directory is used.\n'
    );
    return;
  }
  const target = args.db || path.join(sqliteSnapshot.defaultDir(), sqliteSnapshot.LATEST_NAME);
  if (!fs.existsSync(target)) {
    throw new Error(`Snapshot file not found: ${target}`);
  }

  if (args.info || (!args.toSql && !args.toD1)) {
    const { summary, meta } = await readSnapshotSummary(target);
    process.stdout.write(`Snapshot:\n  ${target}\nTables:\n`);
    for (const k of Object.keys(summary)) {
      process.stdout.write(`  ${k.padEnd(18)} ${summary[k] == null ? '-' : summary[k]}\n`);
    }
    if (Object.keys(meta).length) {
      process.stdout.write(`Meta:\n`);
      for (const k of Object.keys(meta)) {
        process.stdout.write(`  ${k.padEnd(18)} ${meta[k]}\n`);
      }
    }
  }

  if (args.toSql) {
    const sql = await buildSqlForD1(target);
    fs.writeFileSync(args.toSql, sql, 'utf8');
    process.stdout.write(`\nWrote SQL: ${path.resolve(args.toSql)} (${sql.length} bytes)\n`);
  }

  if (args.toD1) {
    const sql = await buildSqlForD1(target);
    const tmp = path.join(require('os').tmpdir(), `abaya-snapshot-import-${Date.now()}.sql`);
    fs.writeFileSync(tmp, sql, 'utf8');
    const dbName = args.dbName || process.env.D1_DB_NAME || 'abaya-db';
    const wranglerArgs = [dbName];
    if (args.remote) wranglerArgs.push('--remote'); else wranglerArgs.push('--local');
    if (args.config) wranglerArgs.push('--config', args.config);
    process.stdout.write(`\nApplying to D1 (${args.remote ? 'remote' : 'local'}): ${dbName}\n  via ${tmp}\n`);
    const code = spawnWrangler(tmp, wranglerArgs);
    if (code !== 0) {
      process.stderr.write(`wrangler exited with code ${code}\n`);
      process.exit(code);
    }
  }
}

main().catch((err) => {
  console.error('[import-snapshot] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
