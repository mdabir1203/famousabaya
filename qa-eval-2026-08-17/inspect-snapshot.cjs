const fs = require('fs');
const initSqlJs = require('sql.js');
(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('data/sqlite-snapshots/abaya-snapshot-latest.db'));
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const names = tables[0].values.map((r) => r[0]);
  console.log('tables: ' + names.join(', '));
  for (const t of names) {
    try {
      const c = db.exec('SELECT COUNT(*) FROM "' + t + '"');
      console.log('  ' + t + ': ' + c[0].values[0][0] + ' rows');
    } catch (e) {
      console.log('  ' + t + ': ERR ' + e.message);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
