// Quick employee lookup for the live verification.
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = process.env.ABA_DB || path.join(__dirname, '..', 'data', 'sqlite-snapshots', 'abaya-snapshot-latest.db');
  if (!fs.existsSync(dbPath)) {
    console.error('no snapshot at', dbPath);
    process.exit(2);
  }
  const db = new SQL.Database(fs.readFileSync(dbPath));

  // Discover the actual employees schema (the snapshot's employees
  // table may have a different shape than the live server's).
  const empSchema = db.exec("PRAGMA table_info(employees)");
  console.log('employees cols:', JSON.stringify(empSchema[0] || { values: [] }, null, 2));

  const asSchema = db.exec("PRAGMA table_info(active_sessions)");
  console.log('active_sessions cols:', JSON.stringify(asSchema[0] || { values: [] }, null, 2));

  const sSchema = db.exec("PRAGMA table_info(sessions)");
  console.log('sessions cols:', JSON.stringify(sSchema[0] || { values: [] }, null, 2));

  // Build a column list from the employees PRAGMA, then query.
  const cols = (empSchema[0] || { values: [] }).values.map((v) => v[1]);
  const nameCol = cols.find((c) => /name/i.test(c)) || 'name';
  const idCols = cols.filter((c) => /^(id|emp_id|barcode|code)$/i.test(c));
  const selectList = cols.join(', ');
  const sql = `SELECT ${selectList} FROM employees WHERE LOWER(${nameCol}) LIKE '%arif%' OR LOWER(${nameCol}) LIKE '%wahif%' OR LOWER(${nameCol}) LIKE '%wahef%' OR LOWER(${nameCol}) LIKE '%wahid%' OR LOWER(${nameCol}) LIKE '%wareesha%' OR LOWER(${nameCol}) LIKE '%warisha%' OR LOWER(${nameCol}) LIKE '%rashid%' ORDER BY ${nameCol} LIMIT 50`;
  const q = db.exec(sql);
  console.log('SEARCH:', JSON.stringify(q[0] || { values: [] }, null, 2));

  // active_sessions present
  const active = db.exec("SELECT * FROM active_sessions LIMIT 10");
  console.log('active_sessions rows:', JSON.stringify(active[0] || { values: [] }, null, 2));

  // last 8 sessions
  const sample = db.exec("SELECT * FROM sessions ORDER BY ended_at DESC LIMIT 8");
  console.log('sessions last 8:', JSON.stringify(sample[0] || { values: [] }, null, 2));
})();
