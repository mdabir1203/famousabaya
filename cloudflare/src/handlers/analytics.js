import { jsonRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { factoryTodayString } from '../working-hours.js';
import { safeYmdOrFallback, sessionsFilterForPeriod } from './report-shared.js';

/** GET /api/analytics?period= */
export async function handleAnalytics(env, url) {
  const period = url.searchParams.get('period') || 'daily';
  const factoryToday = factoryTodayString(env);
  const localToday = safeYmdOrFallback(url.searchParams.get('local_today'), factoryToday);
  let { where, binds, range } = sessionsFilterForPeriod(period, localToday);
  let dailyFallbackApplied = false;
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
      fastest_per_process: Object.values(fastestPerProcess).sort((a, b) =>
        String(a.emp_process).localeCompare(String(b.emp_process))
      ),
      speed_leaders: leaderRes.results || [],
    },
    200,
    CEO_JSON_NO_STORE
  );
}
