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
 *
 * emp_id translation:
 *   The CEO dashboard's "Pick a person" dropdown is populated from
 *   /api/employees which returns the local roster's id (e.g. "e20" for
 *   Farhan). The cloud's `sessions` table, however, stores the
 *   xlsx-stable id ("e_bc_00000129" for Farhan — see ingest.js's
 *   stableEmployeeIdFromBarcode path). The two are different on purpose
 *   (the local roster is hand-edited, the cloud ingests use the
 *   barcoded badges), so we have to translate.
 *
 *   We accept either form:
 *     - "eN"            → look up employees.barcode, derive "e_bc_<bc>"
 *     - "e_bc_<bc>"     → pass through (already in cloud form)
 *     - raw emp_code    → look up employees.code, then derive bc
 *   The WHERE clause uses `emp_id IN (?,?)` so we match BOTH the
 *   original and the translated form, which keeps old clients working
 *   even if they didn't know about the translation.
 */
export async function handleEmployeeDay(env, url) {
  const t0 = Date.now();
  const empIdRaw = String(url.searchParams.get('emp_id') || '').trim();
  const date = String(url.searchParams.get('date') || '').trim();
  if (!empIdRaw) return errRes('Missing emp_id', 400);
  if (!isValidYmd(date)) return errRes('Invalid date (use YYYY-MM-DD)', 400);

  // ---- Translate the local roster id → cloud (xlsx-stable) id ----
  // We always run the roster lookup so a fresh "eN" id never silently
  // returns 0 sessions (which is the bug this method exists to fix).
  const rosterRes = await env.DB.prepare(
    `SELECT id, name, code, process, barcode FROM employees WHERE id = ? OR code = ?`
  ).bind(empIdRaw, empIdRaw).first();
  // If the caller passed an xlsx-stable id (e_bc_*) we still want to
  // surface the human name for the report header — look it up by barcode.
  const rosterByBarcode = empIdRaw.startsWith('e_bc_')
    ? await env.DB.prepare(
        `SELECT id, name, code, process, barcode FROM employees
         WHERE barcode = ? OR REPLACE(barcode, '0', '') = REPLACE(?, '0', '')`
      ).bind(empIdRaw.slice('e_bc_'.length), empIdRaw.slice('e_bc_'.length)).first()
    : null;
  const emp = rosterRes || rosterByBarcode || null;

  // Build the candidate list of emp_ids to match against sessions.emp_id.
  const candidateIds = new Set([empIdRaw]);
  if (emp && emp.barcode) {
    // Cloud's stable id for this employee: 'e_bc_' + barcode.
    candidateIds.add('e_bc_' + String(emp.barcode));
    // Some ingest paths also store the numeric form (no leading zeros).
    const numeric = String(Number(emp.barcode));
    if (numeric && numeric !== 'NaN') candidateIds.add('e_bc_' + numeric);
  }
  if (emp && emp.id) {
    // Defensive: also include the local roster id in case the cloud's
    // sessions table ever stored the LAN's `eN` form (e.g. an older
    // server version before the e_bc_* migration was complete). This
    // is cheap and prevents "0 sessions" surprises on legacy rows.
    candidateIds.add(String(emp.id));
  }
  if (emp && emp.code) {
    // The CEO dashboard's "Pick a person" dropdown sends the LAN's local
    // `eN` id, but older clients (or manual curls) sometimes sent the
    // human-readable `code` (e.g. "EMP124") directly. Try that form too.
    candidateIds.add(String(emp.code));
  }
  if (empIdRaw.startsWith('e_bc_')) {
    // Caller passed xlsx-stable directly — also try the literal original
    // in case a legacy row stored the local id.
    candidateIds.add(empIdRaw);
  }
  const empIdList = Array.from(candidateIds);
  const empIdPlaceholders = empIdList.map(() => '?').join(',');

  const factoryToday = factoryTodayString(env);
  const isToday = date === factoryToday;

  // One D1 round trip: day sessions (+ working-hours config and live session
  // when the requested date is the factory's today). The WHERE clause matches
  // any candidate emp_id (local or xlsx-stable) so callers don't need to
  // know which form the sessions table actually uses.
  const stmts = [
    env.DB.prepare(
      `
      SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code,
        started_at, ended_at, duration_sec, invoice_count, invoice_serial, station
      FROM sessions
      WHERE day_date = ? AND emp_id IN (${empIdPlaceholders})
      ORDER BY started_at ASC
    `
    ).bind(date, ...empIdList),
  ];
  if (isToday) {
    stmts.push(env.DB.prepare(`SELECT v FROM worker_settings WHERE k = ?`).bind(WORKING_HOURS_KEY));
    stmts.push(
      env.DB.prepare(
        `
        SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code, started_at
        FROM active_sessions
        WHERE emp_id IN (${empIdPlaceholders})
      `
      ).bind(...empIdList)
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
  // Build the response `emp` block. We prefer the roster (which the
  // dashboard uses for the dropdown), then fall back to the most-recent
  // session row for fields the roster doesn't have (station etc).
  const roster = emp; // alias for readability
  const empResp = {
    id: (roster && roster.id) || empIdRaw,
    name: (roster && roster.name) || (liveRow && liveRow.emp_name) || (lastRaw && lastRaw.emp_name) || '',
    code: (roster && roster.code) || (liveRow && liveRow.emp_code) || (lastRaw && lastRaw.emp_code) || '',
    process: (roster && roster.process) || (liveRow && liveRow.emp_process) || (lastRaw && lastRaw.emp_process) || '',
    barcode: (roster && roster.barcode) || '',
    matchedIds: empIdList, // debug aid: shows the client which ids we tried
  };

  // ---- When the requested date is empty, surface the nearest 3 dates
  // that DO have data for this employee. Without this, "No sessions on
  // this date" leaves the CEO guessing whether the picker is wrong or the
  // employee just didn't work. (Adds one cheap D1 round trip, only when
  // the primary query returned 0 rows.) ----
  let nearbyDates = [];
  if (rows.length === 0 && empIdList.length) {
    try {
      const nearbyRes = await env.DB.prepare(
        `SELECT day_date, COUNT(*) AS n
         FROM sessions
         WHERE emp_id IN (${empIdPlaceholders})
         GROUP BY day_date
         ORDER BY ABS(julianday(day_date) - julianday(?)) ASC
         LIMIT 3`
      ).bind(...empIdList, date).all();
      nearbyDates = (nearbyRes.results || []).map((r) => ({
        day_date: r.day_date,
        units: Number(r.n) || 0,
      }));
    } catch (e) {
      // Non-fatal — the user still gets the honest "no sessions" answer.
      console.error('[employee-day] nearby-dates query failed:', e && (e.message || e));
    }
  }

  // Last 14 days for this employee (always run, cheap). Lets the
  // day-report modal render a clickable 14-day history strip so the
  // CEO can see at a glance which dates actually have data.
  let recentDays = [];
  if (empIdList.length) {
    try {
      const start = date || factoryToday;
      const parts = start.split('-').map(Number);
      const fromYmd = (function () {
        if (!parts[0] || !parts[1] || !parts[2]) return factoryToday;
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        d.setUTCDate(d.getUTCDate() - 13);
        return d.getUTCFullYear() + '-' +
          String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
          String(d.getUTCDate()).padStart(2, '0');
      })();
      const recentRes = await env.DB.prepare(
        `SELECT day_date, COUNT(*) AS n, COALESCE(SUM(duration_sec), 0) AS total_sec
         FROM sessions
         WHERE emp_id IN (${empIdPlaceholders}) AND day_date >= ? AND day_date <= ?
         GROUP BY day_date
         ORDER BY day_date DESC
         LIMIT 14`
      ).bind(...empIdList, fromYmd, start).all();
      recentDays = (recentRes.results || []).map((r) => ({
        day_date: r.day_date,
        units: Number(r.n) || 0,
        time_sec: Number(r.total_sec) || 0,
      }));
    } catch (e) {
      console.error('[employee-day] recent-days query failed:', e && (e.message || e));
    }
  }

  return jsonRes(
    {
      ok: true,
      date,
      factory_today: factoryToday,
      emp: empResp,
      totals: {
        units: rows.length,
        active_time_sec: activeSec,
        live_active_time_sec: liveSec,
        full_time_sec: activeSec + liveSec,
        first_started_at: sessions.length ? sessions[0].started_at : null,
        last_ended_at: rows.length ? Number(rows[rows.length - 1].ended_at) || null : null,
      },
      sessions,
      nearby_dates: nearbyDates,
      recent_days: recentDays,
    },
    200,
    Object.assign({}, CEO_JSON_NO_STORE, {
      'Server-Timing': 'db;dur=' + dbMs + ', total;dur=' + (Date.now() - t0),
    })
  );
}
