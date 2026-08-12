import { jsonRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { factoryTodayString } from '../working-hours.js';

/**
 * GET /api/state/history?days=90
 *
 * Returns the last `days` days of completed sessions for hydration of a
 * fresh install or after a long offline period. The LAN dashboard uses
 * this to seed its in-memory STATE.logs so the report panels and per-day
 * breakdowns have real history from the very first paint.
 *
 * - `days` is clamped to [1, 365] to keep the response bounded.
 * - Caps the row count at 50,000 to stay within a single Worker response.
 * - Returns a flat array of session rows in the same shape as
 *   `handleState`'s `logs` field so the LAN side can drop them straight in.
 */
export async function handleHistory(env, url) {
  const daysParam = parseInt(url.searchParams.get('days') || '90', 10);
  const days = Math.max(1, Math.min(365, Number.isFinite(daysParam) ? daysParam : 90));
  const MAX_ROWS = 50000;

  // day_date is the production-timezone date; we filter on it directly so
  // we don't depend on ended_at timezone arithmetic.
  const today = factoryTodayString(env);
  // Compute the inclusive start date in the factory timezone.
  // factoryTodayString returns 'YYYY-MM-DD'; subtract N-1 days to get the start.
  const [ty, tm, td] = today.split('-').map(Number);
  const startDate = new Date(Date.UTC(ty, tm - 1, td));
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const startYmd = startDate.getUTCFullYear() + '-' +
    String(startDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(startDate.getUTCDate()).padStart(2, '0');

  const stmt = env.DB.prepare(`
      SELECT id, emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
        abaya_id, abaya_code, station, started_at, ended_at, duration_sec,
        hour_of_day, day_date, invoice_count, invoice_serial,
        NULL as quantity, NULL as checker_barcode
      FROM sessions
      WHERE day_date >= ? AND day_date <= ?
      ORDER BY ended_at DESC
      LIMIT ?
    `).bind(startYmd, today, MAX_ROWS);

  const res = await stmt.all();
  const rows = res.results || [];
  const truncated = rows.length === MAX_ROWS;

  // Reshape to match /api/state's `logs` field so the LAN side can use
  // the same parser.
  const logs = rows.map((r) => ({
    ...r,
    process: r.emp_process,
    end: r.ended_at * 1000,
    started_at: r.started_at * 1000,
    ended_at: r.ended_at * 1000,
  }));

  return jsonRes(
    {
      ok: true,
      timezone: env.FACTORY_TZ || FACTORY_TZ,
      fromYmd: startYmd,
      toYmd: today,
      requestedDays: days,
      rowCount: logs.length,
      truncated,
      logs,
    },
    200,
    CEO_JSON_NO_STORE
  );
}
