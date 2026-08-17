import { jsonRes, CEO_JSON_NO_STORE } from '../http-response.js';
import {
  FACTORY_HOURLY_START,
  FACTORY_HOURLY_END,
  factoryTodayString,
  getWorkingHoursConfig,
  weekdayKeyInTz,
  windowsForDay,
  overlapSecWithWindows,
  isInWorkingWindow,
  workingStatusNow,
} from '../working-hours.js';
import { canonicalEmpProcess, emptyProcessSplit } from '../domain/process.js';

/** GET /api/state — single D1.batch for reads (fewer internal round trips).
 *
 * Query params:
 *   ?days=<n>   how many days of history to include in the `logs` field.
 *               Defaults to 1 (realtime behavior) and is clamped to [1, 400].
 *               The dashboard's report panel asks for `?days=400` so weekly /
 *               monthly / yearly reports can be aggregated from the bundle
 *               instead of having to issue a separate /api/report call.
 *   ?limit=<n>  hard cap on log rows; clamped to [1, 5000].
 */
export async function handleState(env, url) {
  const factoryToday = factoryTodayString(env);
  const workingCfg = await getWorkingHoursConfig(env);
  const todayKey = weekdayKeyInTz(Math.floor(Date.now() / 1000), workingCfg.timezone || 'Asia/Dubai');
  const windowsToday = windowsForDay(workingCfg, todayKey);
  const hourStart = windowsToday.length ? Math.floor(windowsToday[0][0] / 60) : FACTORY_HOURLY_START;
  const hourEnd = windowsToday.length
    ? Math.floor((windowsToday[windowsToday.length - 1][1] - 1) / 60)
    : FACTORY_HOURLY_END;

  // Resolve the log lookback from ?days= (or default to 1 to preserve
  // legacy realtime behavior — no unbounded queries against D1).
  const rawDays = parseInt((url && url.searchParams && url.searchParams.get('days')) || '1', 10);
  const days = Math.max(1, Math.min(400, Number.isFinite(rawDays) ? rawDays : 1));
  // Default cap is 100 for the realtime "last 24 hours" path, but when the
  // caller asks for a wider window (?days>=7) they want the full history that
  // the window covers — silently truncating to 100 was the root cause of
  // "monthly/weekly/yearly reports all show the same numbers" on the cloud
  // dashboard. Callers can still override with ?limit=N (capped at 5000).
  const rawLimit = parseInt((url && url.searchParams && url.searchParams.get('limit')) || '', 10);
  const defaultLimit = days >= 7 ? 5000 : 100;
  const limit = Math.max(
    1,
    Math.min(5000, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit)
  );

  // Compute the lower bound day_date in the factory timezone, then keep
  // everything in one D1 round trip via WHERE day_date >= ?.
  const [ty, tm, td] = factoryToday.split('-').map(Number);
  const startDate = new Date(Date.UTC(ty, tm - 1, td));
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const fromYmd = startDate.getUTCFullYear() + '-' +
    String(startDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(startDate.getUTCDate()).padStart(2, '0');

  const stmtActive = env.DB.prepare(`
      SELECT emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
        abaya_id, abaya_code, station, started_at
      FROM active_sessions ORDER BY started_at ASC
    `);
  const stmtLogs = env.DB.prepare(`
      SELECT id, emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
        abaya_id, abaya_code, station, started_at, ended_at, duration_sec,
        hour_of_day, day_date, invoice_count, invoice_serial,
        NULL as quantity, NULL as checker_barcode
      FROM sessions WHERE day_date >= ? AND day_date <= ?
      ORDER BY ended_at DESC LIMIT ?
    `).bind(fromYmd, factoryToday, limit);
  // Per-employee perf: pick the *latest* emp_name / emp_process / emp_code /
  // emp_color / emp_initials (by ended_at), not the alphabetical MAX().
  // MAX() on TEXT is alphabetical in SQLite, so when one emp_id is reused
  // for a new joiner the dashboard would show the alphabetically-later name
  // — which is the wrong person. Subquery picks the most-recent row per emp.
  const stmtPerf = env.DB.prepare(`
      WITH agg AS (
        SELECT emp_id, COUNT(*) as units,
               ROUND(AVG(duration_sec)) as avg_sec,
               SUM(duration_sec) as total_sec
        FROM sessions
        WHERE day_date = ?
        GROUP BY emp_id
      ),
      latest AS (
        SELECT s.emp_id, s.emp_name, s.emp_process, s.emp_color, s.emp_initials
        FROM sessions s
        JOIN (
          SELECT emp_id, MAX(ended_at) AS last_end
          FROM sessions
          WHERE day_date = ?
          GROUP BY emp_id
        ) m ON m.emp_id = s.emp_id AND m.last_end = s.ended_at
      )
      SELECT agg.emp_id, latest.emp_name, latest.emp_process, latest.emp_color, latest.emp_initials,
        agg.units, agg.avg_sec, agg.total_sec
      FROM agg JOIN latest ON latest.emp_id = agg.emp_id
      ORDER BY agg.units DESC
    `).bind(factoryToday, factoryToday);
  const stmtDaily = env.DB.prepare(`
      SELECT stat_date, total_units, total_sec, cutting_units, stitch_units, finish_units,
        tailor_01_units, tailor_02_units, hand_work_units, stone_work_units,
        button_units, embroidery_units, ari_work_units, hand_designing_units,
        invoice_maker_units, packaging_units, checker_units, peak_hour, updated_at
      FROM daily_stats ORDER BY stat_date DESC LIMIT 7
    `);
  const stmtAgg = env.DB.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(duration_sec), 0) as total_sec
      FROM sessions WHERE day_date = ?
    `).bind(factoryToday);
  const stmtProcSplit = env.DB.prepare(`
      SELECT emp_process, COUNT(*) as cnt FROM sessions
      WHERE day_date = ? GROUP BY emp_process
    `).bind(factoryToday);
  const stmtHourly = env.DB.prepare(`
      SELECT hour_of_day, COUNT(*) as cnt FROM sessions
      WHERE day_date = ? AND hour_of_day >= ? AND hour_of_day <= ?
      GROUP BY hour_of_day
    `).bind(factoryToday, hourStart, hourEnd);
  const stmtGarment = env.DB.prepare(`
      SELECT abaya_id, MAX(abaya_code) as abaya_code,
        COUNT(*) as segments,
        COALESCE(SUM(duration_sec), 0) as completed_sec
      FROM sessions
      WHERE day_date = ?
      GROUP BY abaya_id
      ORDER BY SUM(duration_sec) DESC
      LIMIT 800
    `).bind(factoryToday);

  const [
    activeRes,
    logsRes,
    perfRes,
    dailyRes,
    todayAggRes,
    procSplitRes,
    hourlyRes,
    garmentTodayRes,
  ] = await env.DB.batch([
    stmtActive,
    stmtLogs,
    stmtPerf,
    stmtDaily,
    stmtAgg,
    stmtProcSplit,
    stmtHourly,
    stmtGarment,
  ]);

  const nowSecForActive = Math.floor(Date.now() / 1000);
  const inWindowNow = isInWorkingWindow(nowSecForActive, workingCfg);
  const active = {};
  (activeRes.results || []).forEach((row) => {
    const startedSec = Number(row.started_at) || 0;
    const overlapSec = overlapSecWithWindows(startedSec, nowSecForActive, workingCfg);
    active[row.emp_id] = {
      emp_name: row.emp_name,
      emp_code: row.emp_code,
      emp_process: row.emp_process,
      process: row.emp_process,
      emp_color: row.emp_color,
      emp_initials: row.emp_initials,
      abaya_id: row.abaya_id,
      abaya_code: row.abaya_code,
      station: row.station,
      started_at: row.started_at * 1000,
      windowed_elapsed_sec: overlapSec,
      outside_shift: !inWindowNow || overlapSec === 0,
    };
  });

  const perf = (perfRes.results || []).map((p) => {
    const targetSec = p.units * 2700;
    const eff = p.total_sec > 0 ? Math.min(100, Math.round((targetSec / p.total_sec) * 100)) : 0;
    return {
      id: p.emp_id,
      name: p.emp_name,
      process: p.emp_process,
      color: p.emp_color,
      initials: p.emp_initials,
      units: p.units,
      avg_sec: p.avg_sec,
      eff,
    };
  });

  const agg = (todayAggRes && todayAggRes.results && todayAggRes.results[0]) || {
    cnt: 0,
    total_sec: 0,
  };
  const completedToday = Number(agg.cnt) || 0;
  const totalSecToday = Number(agg.total_sec) || 0;
  const avgCycleSecToday = completedToday > 0 ? Math.round(totalSecToday / completedToday) : 0;
  const targetSecToday = completedToday * 2700;
  const efficiencyToday =
    totalSecToday > 0 ? Math.min(100, Math.round((targetSecToday / totalSecToday) * 100)) : 0;

  const processSplitToday = emptyProcessSplit();
  (procSplitRes.results || []).forEach((row) => {
    const key = canonicalEmpProcess(row.emp_process);
    if (processSplitToday[key] !== undefined) {
      processSplitToday[key] += Number(row.cnt) || 0;
    }
  });

  const hourlyToday = {};
  const hoursInWindowToday = new Set();
  windowsToday.forEach(([startMin, endMin]) => {
    const sH = Math.floor(startMin / 60);
    const eH = Math.floor((endMin - 1) / 60);
    for (let h = sH; h <= eH; h++) hoursInWindowToday.add(h);
  });
  if (hoursInWindowToday.size === 0) {
    for (let h = hourStart; h <= hourEnd; h++) hourlyToday[h] = 0;
  } else {
    Array.from(hoursInWindowToday)
      .sort((a, b) => a - b)
      .forEach((h) => {
        hourlyToday[h] = 0;
      });
  }
  (hourlyRes.results || []).forEach((row) => {
    const h = Number(row.hour_of_day);
    if (Object.prototype.hasOwnProperty.call(hourlyToday, h)) {
      hourlyToday[h] = Number(row.cnt) || 0;
    }
  });

  const garmentMap = new Map();
  (garmentTodayRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || id === '') return;
    garmentMap.set(String(id), {
      abaya_id: row.abaya_id,
      abaya_code: row.abaya_code != null ? String(row.abaya_code) : '',
      segments: Number(row.segments) || 0,
      completed_sec: Math.floor(Number(row.completed_sec) || 0),
    });
  });
  (activeRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || id === '') return;
    const sid = String(id);
    if (!garmentMap.has(sid)) {
      garmentMap.set(sid, {
        abaya_id: row.abaya_id,
        abaya_code: row.abaya_code != null ? String(row.abaya_code) : '',
        segments: 0,
        completed_sec: 0,
      });
    }
  });
  const garment_totals_today = Array.from(garmentMap.values()).sort((a, b) => {
    const ca = a.completed_sec || 0;
    const cb = b.completed_sec || 0;
    if (cb !== ca) return cb - ca;
    return String(a.abaya_code || a.abaya_id).localeCompare(String(b.abaya_code || b.abaya_id));
  });
  const serverNowTs = Date.now();
  const latestFinishedMs =
    ((logsRes.results || []).length && Number((logsRes.results || [])[0].ended_at) * 1000) || 0;
  const latestActiveStartedMs = (activeRes.results || []).reduce((mx, row) => {
    const v = Number(row && row.started_at) * 1000;
    return Number.isFinite(v) ? Math.max(mx, v) : mx;
  }, 0);
  const sourceTs = Math.max(latestFinishedMs, latestActiveStartedMs, serverNowTs);
  const ingestLagMs = Math.max(0, serverNowTs - Math.max(latestFinishedMs, latestActiveStartedMs));
  // Lag thresholds (ms): "hot" = within typical D1 query latency + push queue.
  // "warm" = no event in 5 min but factory likely just paused. "idle" = 30 min+ of
  // silence — the factory isn't pushing because there's no activity, not because
  // the cloud is broken. "stale" is reserved for genuine problems (D1 issues,
  // long-running write queue, clock skew). Anything > 4h is a yellow flag the
  // factory hasn't sent anything in a long time.
  let lagMode;
  if (ingestLagMs <= 5000) lagMode = 'hot';
  else if (ingestLagMs <= 5 * 60 * 1000) lagMode = 'warm';
  else if (ingestLagMs <= 30 * 60 * 1000) lagMode = 'idle';
  else if (ingestLagMs <= 4 * 60 * 60 * 1000) lagMode = 'stale';
  else lagMode = 'no-data';

  return jsonRes(
    {
      ok: true,
      ts: serverNowTs,
      source_ts: sourceTs,
      db_snapshot_ts: latestFinishedMs || serverNowTs,
      server_now_ts: serverNowTs,
      ingest_lag_ms: ingestLagMs,
      logs_window_days: days,
      logs_from_ymd: fromYmd,
      logs_to_ymd: factoryToday,
      state_meta: {
        source: 'cloudflare-worker-d1',
        lag_mode: lagMode,
        logs_window_days: days,
        logs_from_ymd: fromYmd,
        logs_to_ymd: factoryToday,
      },
      factory_today: factoryToday,
      completed_today: completedToday,
      avg_cycle_sec_today: avgCycleSecToday,
      efficiency_today: efficiencyToday,
      process_split_today: processSplitToday,
      hourly_today: hourlyToday,
      working_hours: workingCfg,
      working_status: workingStatusNow(workingCfg),
      active,
      garment_totals_today,
      logs: (logsRes.results || []).map((r) => ({
        ...r,
        process: r.emp_process,
        end: r.ended_at * 1000,
        started_at: r.started_at * 1000,
        ended_at: r.ended_at * 1000,
      })),
      perf,
      daily: dailyRes.results || [],
    },
    200,
    CEO_JSON_NO_STORE
  );
}
