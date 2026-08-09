import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import {
  factoryTodayString,
  workingHoursConfigFromRow,
  WORKING_HOURS_KEY,
  overlapSecWithWindows,
} from '../working-hours.js';
import { isValidYmd } from './report-shared.js';

/**
 * GET /api/report/employee-day?emp_id=X&date=YYYY-MM-DD
 *
 * One employee, one factory date: every completed station session in
 * chronological order, plus the live session row when the date is the
 * factory's today. Powers the dashboard "what is this employee doing" view.
 */
export async function handleEmployeeDay(env, url) {
  const t0 = Date.now();
  const empId = String(url.searchParams.get('emp_id') || '').trim();
  const date = String(url.searchParams.get('date') || '').trim();
  if (!empId) return errRes('Missing emp_id', 400);
  if (!isValidYmd(date)) return errRes('Invalid date (use YYYY-MM-DD)', 400);

  const factoryToday = factoryTodayString(env);
  const isToday = date === factoryToday;

  // One D1 round trip: day sessions (+ working-hours config and live session
  // when the requested date is the factory's today).
  const stmts = [
    env.DB.prepare(
      `
      SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code,
        started_at, ended_at, duration_sec, invoice_count, invoice_serial, station
      FROM sessions
      WHERE day_date = ? AND emp_id = ?
      ORDER BY started_at ASC
    `
    ).bind(date, empId),
  ];
  if (isToday) {
    stmts.push(env.DB.prepare(`SELECT v FROM worker_settings WHERE k = ?`).bind(WORKING_HOURS_KEY));
    stmts.push(
      env.DB.prepare(
        `
        SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code, started_at
        FROM active_sessions
        WHERE emp_id = ?
      `
      ).bind(empId)
    );
  }
  const tDb = Date.now();
  const [sessionsRes, whRes, activeRes] = await env.DB.batch(stmts);
  const dbMs = Date.now() - tDb;
  const rows = (sessionsRes && sessionsRes.results) || [];

  const sessions = rows.map((r) => ({
    emp_process: r.emp_process || '—',
    abaya_id: r.abaya_id != null ? String(r.abaya_id) : '',
    abaya_code: r.abaya_code != null ? String(r.abaya_code) : '',
    started_at: Number(r.started_at) || 0,
    ended_at: Number(r.ended_at) || 0,
    duration_sec: Math.max(0, Math.floor(Number(r.duration_sec) || 0)),
    invoice_count: r.invoice_count != null && r.invoice_count !== '' ? Number(r.invoice_count) : null,
    invoice_serial: r.invoice_serial != null && r.invoice_serial !== '' ? String(r.invoice_serial) : null,
    station: r.station || '',
    live: false,
  }));

  let liveSec = 0;
  if (isToday) {
    const workingCfg = workingHoursConfigFromRow(whRes && whRes.results && whRes.results[0]);
    const activeRows = (activeRes && activeRes.results) || [];
    if (activeRows.length) {
      const r = activeRows[0];
      const nowUnix = Math.floor(Date.now() / 1000);
      liveSec = overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
      sessions.push({
        emp_process: r.emp_process || '—',
        abaya_id: r.abaya_id != null ? String(r.abaya_id) : '',
        abaya_code: r.abaya_code != null ? String(r.abaya_code) : '',
        started_at: Number(r.started_at) || 0,
        ended_at: null,
        duration_sec: liveSec,
        invoice_count: null,
        invoice_serial: null,
        station: '',
        live: true,
        emp_name: r.emp_name,
        emp_code: r.emp_code,
      });
    }
  }

  const lastRaw = rows.length ? rows[rows.length - 1] : null;
  const liveRow = sessions.length && sessions[sessions.length - 1].live ? sessions[sessions.length - 1] : null;
  const activeSec = sessions.reduce((s, x) => s + (x.live ? 0 : x.duration_sec), 0);
  const emp = {
    id: empId,
    name: (liveRow && liveRow.emp_name) || (lastRaw && lastRaw.emp_name) || '',
    code: (liveRow && liveRow.emp_code) || (lastRaw && lastRaw.emp_code) || '',
    process: (liveRow && liveRow.emp_process) || (lastRaw && lastRaw.emp_process) || '',
  };

  return jsonRes(
    {
      ok: true,
      date,
      factory_today: factoryToday,
      emp,
      totals: {
        units: rows.length,
        active_time_sec: activeSec,
        live_active_time_sec: liveSec,
        full_time_sec: activeSec + liveSec,
        first_started_at: sessions.length ? sessions[0].started_at : null,
        last_ended_at: rows.length ? Number(rows[rows.length - 1].ended_at) || null : null,
      },
      sessions,
    },
    200,
    Object.assign({}, CEO_JSON_NO_STORE, {
      'Server-Timing': 'db;dur=' + dbMs + ', total;dur=' + (Date.now() - t0),
    })
  );
}
