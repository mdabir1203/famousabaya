// Verify Arif / Wahid stop timing — are their finish times recorded
// in `sessions`, or are they stuck in `active_sessions` with no end?
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

function fmtUnix(sec) {
  if (!sec) return '(none)';
  const d = new Date(Number(sec) * 1000);
  return d.toISOString() + '  (' + d.toUTCString() + ')  Asia/Dubai=' + d.toLocaleString('en-US', { timeZone: 'Asia/Dubai' });
}

(async () => {
  const SQL = await initSqlJs();
  const dbPath = process.env.ABA_DB || path.join(__dirname, '..', 'data', 'sqlite-snapshots', 'abaya-snapshot-latest.db');
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const now = Math.floor(Date.now() / 1000);
  const metaSchema = db.exec("PRAGMA table_info(snapshot_meta)");
  console.log('snapshot_meta cols:', JSON.stringify(metaSchema[0] || { values: [] }, null, 2));
  const snapMeta = db.exec("SELECT * FROM snapshot_meta");
  console.log('snapshot_meta rows:', JSON.stringify(snapMeta[0] || { values: [] }, null, 2));

  for (const empId of ['e_bc_00000115', 'e_bc_00000138']) {
    console.log('\n==========', empId, '==========');
    const emp = db.exec(`SELECT * FROM employees WHERE id='${empId}'`);
    console.log('  employee row:', JSON.stringify(emp[0] || { values: [] }, null, 2));

    const active = db.exec(`SELECT * FROM active_sessions WHERE emp_id='${empId}'`);
    const aRows = (active[0] || { values: [] }).values;
    if (aRows.length === 0) {
      console.log('  ACTIVE: none — no live session for this emp');
    } else {
      const aCols = (active[0]).columns;
      for (const r of aRows) {
        const obj = {};
        aCols.forEach((c, i) => { obj[c] = r[i]; });
        const ageSec = now - Number(obj.started_at || 0);
        console.log('  ACTIVE row:', obj);
        console.log('  ACTIVE started_at =', fmtUnix(obj.started_at), ' age=', (ageSec / 3600).toFixed(2), 'h');
      }
    }

    const sess = db.exec(`SELECT id, emp_name, abaya_id, abaya_code, started_at, ended_at, duration_sec, day_date, hour_of_day FROM sessions WHERE emp_id='${empId}' ORDER BY ended_at DESC LIMIT 20`);
    const sCols = (sess[0] || { columns: [] }).columns;
    const sRows = (sess[0] || { values: [] }).values;
    console.log('  sessions (last 20, ORDER BY ended_at DESC):', sRows.length);
    sRows.forEach((r) => {
      const o = {}; sCols.forEach((c, i) => { o[c] = r[i]; });
      console.log('   -', o.id, o.abaya_code, 'started', fmtUnix(o.started_at), '-> ended', fmtUnix(o.ended_at), 'dur', o.duration_sec, 'day', o.day_date);
    });

    // last 5 by created_at too — to catch any rows that may have
    // landed without a valid ended_at
    const recent = db.exec(`SELECT id, emp_name, abaya_id, started_at, ended_at, duration_sec, day_date, created_at FROM sessions WHERE emp_id='${empId}' ORDER BY created_at DESC LIMIT 5`);
    const rCols = (recent[0] || { columns: [] }).columns;
    const rRows = (recent[0] || { values: [] }).values;
    console.log('  sessions (last 5, ORDER BY created_at DESC):', rRows.length);
    rRows.forEach((r) => {
      const o = {}; rCols.forEach((c, i) => { o[c] = r[i]; });
      console.log('   -', o.id, o.abaya_code, 'started', fmtUnix(o.started_at), '-> ended', fmtUnix(o.ended_at), 'created', fmtUnix(o.created_at));
    });

    // If there's a live row, the *most recent* session's ended_at
    // SHOULD be < the active row's started_at. If it's not, the
    // Finish never landed.
    if (aRows.length && sRows.length) {
      const a = aRows[0];
      const sCols2 = (active[0]).columns;
      const activeStarted = Number(a[sCols2.indexOf('started_at')]);
      const lastEnded = Number(sRows[0][sCols.indexOf('ended_at')]);
      console.log('  CHECK: active.started_at=' + fmtUnix(activeStarted) + '  last_session.ended_at=' + fmtUnix(lastEnded));
      if (lastEnded && lastEnded < activeStarted) {
        console.log('   -> finish landed BEFORE the current start, looks correct');
      } else if (!lastEnded) {
        console.log('   -> sessions row exists but ended_at=0 / NULL — Finish was NOT recorded');
      } else {
        console.log('   -> last ended_at is AFTER the active start, looks wrong (active started after a finished session)');
      }
    }
  }
})();
