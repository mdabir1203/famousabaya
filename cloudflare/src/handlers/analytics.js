import { jsonRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { factoryTodayString } from '../working-hours.js';
import { safeYmdOrFallback, sessionsFilterForPeriod, isValidYmd, customRange } from './report-shared.js';

/** GET /api/analytics?period=&from=&to= */
export async function handleAnalytics(env, url) {
  const period = url.searchParams.get('period') || 'daily';
  const factoryToday = factoryTodayString(env);
  const localToday = safeYmdOrFallback(url.searchParams.get('local_today'), factoryToday);
  // Explicit from/to win over period. When the CEO picks a date on the
  // dashboard, the analytics modal (Process & garment analytics) should
  // scope to that day — not silently fall back to the period anchored at
  // today. Without from/to, fall back to the legacy period-based window.
  const fromParam = String((url && url.searchParams && url.searchParams.get('from')) || '').trim();
  const toParam = String((url && url.searchParams && url.searchParams.get('to')) || '').trim();
  const explicitRange = isValidYmd(fromParam) || isValidYmd(toParam);
  let where, binds, range;
  let dailyFallbackApplied = false;
  if (explicitRange) {
    try {
      range = customRange(
        isValidYmd(fromParam) ? fromParam : (isValidYmd(toParam) ? toParam : factoryToday),
        isValidYmd(toParam) ? toParam : (isValidYmd(fromParam) ? fromParam : factoryToday),
        { maxDays: 92 }
      );
    } catch (e) {
      return jsonRes({ ok: false, error: String((e && e.message) || e) }, 400, CEO_JSON_NO_STORE);
    }
    where = 'WHERE day_date >= ? AND day_date <= ?';
    binds = [range.startYmd, range.endYmd];
  } else {
    ({ where, binds, range } = sessionsFilterForPeriod(period, localToday));
    if (range.type === 'daily') {
      const cntRes = await env.DB.prepare(`SELECT COUNT(*) as c FROM sessions ${where}`).bind(...binds).first();
      if ((Number(cntRes && cntRes.c) || 0) === 0) {
        const fallbackYmd = range.prevStart;
        const fallback = sessionsFilterForPeriod(period, fallbackYmd);
        where = fallback.where;
        binds = fallback.binds;
        range = fallback.range;
        dailyFallbackApplied = true;
      }
    }
  }
  const fromSessions = `FROM sessions ${where}`;

  const [byProcessRes, splitRes, leaderRes] = await env.DB.batch([
    env.DB.prepare(
      `
    SELECT emp_process, COUNT(*) as units,
      ROUND(AVG(duration_sec)) as avg_sec,
      MIN(duration_sec) as min_sec,
      MAX(duration_sec) as max_sec
    ${fromSessions}
    GROUP BY emp_process
    ORDER BY avg_sec DESC
  `
    ).bind(...binds),
    env.DB.prepare(
      `
    SELECT emp_id,
      MAX(emp_name) as emp_name,
      MAX(emp_code) as emp_code,
      emp_process,
      COUNT(*) as units,
      ROUND(AVG(duration_sec)) as avg_sec
    ${fromSessions}
    GROUP BY emp_id, emp_process
    HAVING COUNT(*) >= 1
  `
    ).bind(...binds),
    env.DB.prepare(
      `
    SELECT emp_id,
      MAX(emp_name) as emp_name,
      MAX(emp_code) as emp_code,
      MAX(emp_process) as emp_process,
      COUNT(*) as units,
      ROUND(AVG(duration_sec)) as avg_sec
    ${fromSessions}
    GROUP BY emp_id
    HAVING COUNT(*) >= 2
    ORDER BY avg_sec ASC
    LIMIT 40
  `
    ).bind(...binds),
  ]);

  const splits = splitRes.results || [];
  const MIN_UNITS_FASTEST = 2;
  const fastestPerProcess = {};
  for (const r of splits) {
    if (Number(r.units) < MIN_UNITS_FASTEST) continue;
    const p = r.emp_process;
    const avg = Number(r.avg_sec);
    if (!fastestPerProcess[p] || avg < Number(fastestPerProcess[p].avg_sec)) {
      fastestPerProcess[p] = { ...r, avg_sec: r.avg_sec };
    }
  }

  // Per-employee rollup across all processes. Same shape the modal
  // expects for the "By employee — tap a name to see their day" table.
  // Sum units + active/elapsed/live/full + avg (weighted) per emp_id.
  const byEmployeeMap = new Map();
  for (const r of splits) {
    const eid = String(r.emp_id || '');
    if (!eid) continue;
    const prev = byEmployeeMap.get(eid) || {
      emp_id: eid,
      emp_name: r.emp_name || '',
      emp_code: r.emp_code || '',
      units: 0,
      _sumSec: 0,
      _sumActive: 0,
      _sumElapsed: 0,
      _sumLive: 0,
      _sumFull: 0,
    };
    prev.units += Number(r.units) || 0;
    prev._sumSec += (Number(r.avg_sec) || 0) * (Number(r.units) || 0);
    // splits doesn't carry time totals — fall back to duration_sec-based
    // estimate using avg * units. That's exact for completed sessions
    // because the avg is over duration_sec.
    const active = (Number(r.avg_sec) || 0) * (Number(r.units) || 0);
    prev._sumActive += active;
    prev._sumElapsed += active;
    prev._sumFull += active;
    if (!prev.emp_name && r.emp_name) prev.emp_name = r.emp_name;
    if (!prev.emp_code && r.emp_code) prev.emp_code = r.emp_code;
    byEmployeeMap.set(eid, prev);
  }
  // Add a per-employee process string for the UI ("Tailor (01) · Hand Work")
  const byEmployee = Array.from(byEmployeeMap.values()).map((e) => ({
    emp_id: e.emp_id,
    emp_name: e.emp_name,
    emp_code: e.emp_code,
    emp_process: '',
    units: e.units,
    active_time_sec: e._sumActive,
    elapsed_time_sec: e._sumElapsed,
    live_active_time_sec: 0, // splits don't surface live overlap; the work-time stat card handles that
    full_time_sec: e._sumFull,
    tolerance_sec: 0,
    adjusted_full_time_sec: e._sumFull,
  })).sort((a, b) => (b.units || 0) - (a.units || 0));

  return jsonRes(
    {
      ok: true,
      period,
      effective_period: range.type,
      factory_today: factoryToday,
      local_today: localToday,
      start_date: range.startYmd,
      end_date: range.endYmd,
      effective_date: range.type === 'daily' ? range.startYmd : '',
      fallback_applied: dailyFallbackApplied,
      generated: new Date().toISOString(),
      by_process: byProcessRes.results || [],
      employee_process_splits: splits,
      by_employee: byEmployee,
      fastest_per_process: Object.values(fastestPerProcess).sort((a, b) =>
        String(a.emp_process).localeCompare(String(b.emp_process))
      ),
      speed_leaders: leaderRes.results || [],
    },
    200,
    CEO_JSON_NO_STORE
  );
}
