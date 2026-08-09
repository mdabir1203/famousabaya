import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { SUMMARY_WT_CASES, canonicalEmpProcess } from '../domain/process.js';
import {
  factoryTodayString,
  workingHoursConfigFromRow,
  WORKING_HOURS_KEY,
  overlapSecWithWindows,
  factoryDateStringForUnix,
} from '../working-hours.js';
import { reportRangeForType, safeYmdOrFallback, customRange } from './report-shared.js';

export function rowElapsedSec(row) {
  const start = Number(row && row.min_started_at);
  const end = Number(row && row.max_ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor(end - start));
}

export function round1(n) {
  const x = Number(n) || 0;
  return Math.round(x * 10) / 10;
}

const EMP_TOLERANCE_PER_SEGMENT_SEC = 90;
const EMP_TOLERANCE_DAILY_CAP_SEC = 12 * 60;
const ITEM_TOLERANCE_PER_SEGMENT_SEC = 60;

export async function handleReport(env, url) {
  const t0 = Date.now();
  const type = url.searchParams.get('type') || 'daily';
  const factoryToday = factoryTodayString(env);
  const localToday = safeYmdOrFallback(url.searchParams.get('local_today'), factoryToday);
  // Optional explicit window: from+to (custom range) or date (anchor day for
  // daily/weekly/monthly/yearly). Backwards compatible — without them the
  // report behaves exactly as before (anchored at local_today).
  const fromParam = String(url.searchParams.get('from') || '').trim();
  const toParam = String(url.searchParams.get('to') || '').trim();
  const dateParam = String(url.searchParams.get('date') || '').trim();
  let range;
  let isCustomRange = false;
  if (fromParam || toParam) {
    try {
      range = customRange(fromParam, toParam);
    } catch (e) {
      return errRes(String((e && e.message) || e), 400);
    }
    isCustomRange = true;
  } else {
    const anchorYmd = dateParam ? safeYmdOrFallback(dateParam, localToday) : localToday;
    range = reportRangeForType(type, anchorYmd);
  }
  // An explicit date/range is a deliberate choice: never silently fall back to
  // the previous day — show the honest empty window instead.
  const explicitAnchor = isCustomRange || !!dateParam;
  let dayBinds = [range.startYmd, range.endYmd];
  let prevDayBinds = [range.prevStart, range.prevEnd];
  let dailyFallbackApplied = false;
  const dayFilter = `WHERE day_date >= ? AND day_date <= ?`;

  // Total time spent in D1 report batches — surfaced via Server-Timing so
  // real-world speed can be reviewed without guessing.
  let dbMs = 0;
  const runReportBatch = (activeDayBinds, activePrevDayBinds) => {
    const t = Date.now();
    return env.DB.batch([
      env.DB.prepare(`
      SELECT COUNT(*) as total_units, ROUND(AVG(duration_sec)) as avg_sec,
        COUNT(DISTINCT emp_id) as unique_workers,
        COUNT(DISTINCT CASE WHEN abaya_id IS NOT NULL AND abaya_id != '' THEN abaya_id END) as unique_items,
        COALESCE(SUM(duration_sec), 0) as active_time_sec,
        MIN(started_at) as period_start_sec,
        MAX(ended_at) as period_end_sec,
        ${SUMMARY_WT_CASES}
      FROM sessions ${dayFilter}
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT emp_id, MAX(emp_name) as emp_name, MAX(emp_process) as emp_process, MAX(emp_code) as emp_code,
        COUNT(*) as units, ROUND(AVG(duration_sec)) as avg_sec, COALESCE(SUM(duration_sec), 0) as active_time_sec,
        MIN(started_at) as min_started_at, MAX(ended_at) as max_ended_at
      FROM sessions ${dayFilter}
      GROUP BY emp_id ORDER BY units DESC
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT emp_process, COUNT(*) as units, ROUND(AVG(duration_sec)) as avg_sec, COALESCE(SUM(duration_sec), 0) as active_time_sec,
        MIN(started_at) as min_started_at, MAX(ended_at) as max_ended_at
      FROM sessions ${dayFilter}
      GROUP BY emp_process ORDER BY units DESC
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT emp_name, emp_code, abaya_code, invoice_count, invoice_serial, duration_sec, ended_at
      FROM sessions
      ${dayFilter} AND emp_process = 'Invoice maker'
        AND invoice_serial IS NOT NULL AND invoice_serial != ''
      ORDER BY ended_at DESC
      LIMIT 200
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT abaya_id, MAX(abaya_code) as abaya_code,
        COUNT(*) as segments,
        COALESCE(SUM(duration_sec), 0) as completed_sec,
        MIN(started_at) as min_started_at, MAX(ended_at) as max_ended_at
      FROM sessions ${dayFilter}
      GROUP BY abaya_id
      ORDER BY completed_sec DESC
      LIMIT 200
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT COUNT(*) as total_units, ROUND(AVG(duration_sec)) as avg_sec,
        COALESCE(SUM(duration_sec), 0) as active_time_sec
      FROM sessions WHERE day_date >= ? AND day_date <= ?
    `).bind(...activePrevDayBinds),
      // Working-hours config + live sessions ride the same batch: one D1 round
      // trip for the whole report instead of four separate ones.
      env.DB.prepare(`SELECT v FROM worker_settings WHERE k = ?`).bind(WORKING_HOURS_KEY),
      env.DB.prepare(`
      SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code, started_at
      FROM active_sessions
    `),
    ]).then((rows) => {
      dbMs += Date.now() - t;
      return rows;
    });
  };
  let [summary, byEmployeeRes, byProcessRes, invMaker, itemTotalsRes, prevSummary, whRowRes, activeRes] = await runReportBatch(
    dayBinds,
    prevDayBinds
  );
  const firstSummaryRow = (summary && summary.results && summary.results[0]) || {};
  if (range.type === 'daily' && !explicitAnchor && (Number(firstSummaryRow.total_units) || 0) === 0) {
    const fallbackDay = range.prevStart;
    range = reportRangeForType(type, fallbackDay);
    dayBinds = [range.startYmd, range.endYmd];
    prevDayBinds = [range.prevStart, range.prevEnd];
    dailyFallbackApplied = true;
    [summary, byEmployeeRes, byProcessRes, invMaker, itemTotalsRes, prevSummary, whRowRes, activeRes] = await runReportBatch(
      dayBinds,
      prevDayBinds
    );
  }

  const workingCfg = workingHoursConfigFromRow(whRowRes && whRowRes.results && whRowRes.results[0]);

  const summaryRow = (summary && summary.results && summary.results[0]) || {};
  const prevSummaryRow = (prevSummary && prevSummary.results && prevSummary.results[0]) || {};

  const activeRows = (activeRes && activeRes.results) || [];

  const nowUnix = Math.floor(Date.now() / 1000);
  const inRangeActive = activeRows.filter((r) => {
    const d = factoryDateStringForUnix(env, Number(r.started_at) || 0);
    return d >= range.startYmd && d <= range.endYmd;
  });

  const employeeMap = new Map();
  (byEmployeeRes.results || []).forEach((row) => {
    const activeTime = Math.floor(Number(row.active_time_sec) || 0);
    const elapsedTime = rowElapsedSec(row);
    employeeMap.set(String(row.emp_id), {
      emp_id: row.emp_id,
      emp_name: row.emp_name,
      emp_process: row.emp_process,
      emp_code: row.emp_code,
      units: Number(row.units) || 0,
      avg_sec: Number(row.avg_sec) || 0,
      active_time_sec: activeTime,
      elapsed_time_sec: elapsedTime,
      live_active_time_sec: 0,
      full_time_sec: activeTime,
      efficiency_ratio: elapsedTime > 0 ? round1((activeTime / elapsedTime) * 100) : 0,
    });
  });
  inRangeActive.forEach((r) => {
    const id = String(r.emp_id || '');
    const live = overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
    if (!employeeMap.has(id)) {
      employeeMap.set(id, {
        emp_id: r.emp_id,
        emp_name: r.emp_name,
        emp_process: r.emp_process,
        emp_code: r.emp_code,
        units: 0,
        avg_sec: 0,
        active_time_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0,
        efficiency_ratio: 0,
      });
    }
    const x = employeeMap.get(id);
    x.live_active_time_sec += live;
    x.full_time_sec = x.active_time_sec + x.live_active_time_sec;
  });
  const byEmployee = Array.from(employeeMap.values()).sort((a, b) => {
    if (b.full_time_sec !== a.full_time_sec) return b.full_time_sec - a.full_time_sec;
    return String(a.emp_name || '').localeCompare(String(b.emp_name || ''));
  });
  byEmployee.forEach((e) => {
    const tol = Math.min(EMP_TOLERANCE_DAILY_CAP_SEC, (Number(e.units) || 0) * EMP_TOLERANCE_PER_SEGMENT_SEC);
    e.tolerance_sec = tol;
    e.adjusted_full_time_sec = Math.max(0, (Number(e.full_time_sec) || 0) - tol);
  });

  const processMap = new Map();
  (byProcessRes.results || []).forEach((row) => {
    const key = canonicalEmpProcess(row.emp_process);
    const activeTime = Math.floor(Number(row.active_time_sec) || 0);
    const elapsedTime = rowElapsedSec(row);
    if (!processMap.has(key)) {
      processMap.set(key, {
        emp_process: key,
        units: 0,
        avg_sec: 0,
        active_time_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0,
        efficiency_ratio: 0,
      });
    }
    const p = processMap.get(key);
    p.units += Number(row.units) || 0;
    p.active_time_sec += activeTime;
    p.elapsed_time_sec += elapsedTime;
  });
  inRangeActive.forEach((r) => {
    const key = canonicalEmpProcess(r.emp_process);
    const live = overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
    if (!processMap.has(key)) {
      processMap.set(key, {
        emp_process: key,
        units: 0,
        avg_sec: 0,
        active_time_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0,
        efficiency_ratio: 0,
      });
    }
    processMap.get(key).live_active_time_sec += live;
  });
  const byProcess = Array.from(processMap.values())
    .map((p) => {
      p.full_time_sec = p.active_time_sec + p.live_active_time_sec;
      p.avg_sec = p.units > 0 ? Math.round(p.active_time_sec / p.units) : 0;
      p.efficiency_ratio = p.elapsed_time_sec > 0 ? round1((p.active_time_sec / p.elapsed_time_sec) * 100) : 0;
      p.tolerance_sec = 0;
      p.adjusted_full_time_sec = p.full_time_sec;
      return p;
    })
    .sort((a, b) => {
      if (b.full_time_sec !== a.full_time_sec) return b.full_time_sec - a.full_time_sec;
      return String(a.emp_process || '').localeCompare(String(b.emp_process || ''));
    });
  const processTol = {};
  byEmployee.forEach((e) => {
    const key = canonicalEmpProcess(e.emp_process);
    processTol[key] = (processTol[key] || 0) + (Number(e.tolerance_sec) || 0);
  });
  byProcess.forEach((p) => {
    const t = Math.floor(Number(processTol[p.emp_process]) || 0);
    p.tolerance_sec = t;
    p.adjusted_full_time_sec = Math.max(0, (Number(p.full_time_sec) || 0) - t);
  });

  const itemMap = new Map();
  (itemTotalsRes.results || []).forEach((it) => {
    const key = String(it.abaya_id || '');
    if (!key) return;
    const activeTime = Math.floor(Number(it.completed_sec) || 0);
    itemMap.set(key, {
      abaya_id: it.abaya_id,
      abaya_code: it.abaya_code,
      segments: Number(it.segments) || 0,
      active_time_sec: activeTime,
      completed_sec: activeTime,
      elapsed_time_sec: rowElapsedSec(it),
      live_active_time_sec: 0,
      full_time_sec: activeTime,
    });
  });
  inRangeActive.forEach((r) => {
    const key = String(r.abaya_id || '');
    if (!key) return;
    if (!itemMap.has(key)) {
      itemMap.set(key, {
        abaya_id: r.abaya_id,
        abaya_code: r.abaya_code,
        segments: 0,
        active_time_sec: 0,
        completed_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0,
      });
    }
    const x = itemMap.get(key);
    x.live_active_time_sec += overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
    x.full_time_sec = x.active_time_sec + x.live_active_time_sec;
  });
  const itemTotals = Array.from(itemMap.values()).sort((a, b) => {
    if (b.full_time_sec !== a.full_time_sec) return b.full_time_sec - a.full_time_sec;
    return String(a.abaya_code || a.abaya_id || '').localeCompare(String(b.abaya_code || b.abaya_id || ''));
  });
  const itemIds = itemTotals.map((it) => String(it.abaya_id || '')).filter(Boolean);
  const lifecycleMap = {};
  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(',');
    const lifeRes = await env.DB.prepare(
      `SELECT abaya_id, cumulative_in_window_sec FROM abaya_time_map WHERE abaya_id IN (${placeholders})`
    )
      .bind(...itemIds)
      .all();
    (lifeRes.results || []).forEach((r) => {
      lifecycleMap[String(r.abaya_id)] = Math.floor(Number(r.cumulative_in_window_sec) || 0);
    });
  }
  itemTotals.forEach((it) => {
    const seg = Number(it.segments) || 0;
    const tol = Math.max(0, seg * ITEM_TOLERANCE_PER_SEGMENT_SEC);
    it.tolerance_sec = tol;
    it.adjusted_full_time_sec = Math.max(0, (Number(it.full_time_sec) || 0) - tol);
    it.cumulative_lifecycle_sec = Math.max(
      Number(it.full_time_sec) || 0,
      Number(lifecycleMap[String(it.abaya_id || '')] || 0)
    );
  });

  const summaryActiveSec = Math.floor(Number(summaryRow.active_time_sec) || 0);
  const summaryElapsedSec = rowElapsedSec({
    min_started_at: summaryRow.period_start_sec,
    max_ended_at: summaryRow.period_end_sec,
  });
  const summaryLiveSec = inRangeActive.reduce(
    (s, r) => s + overlapSecWithWindows(r.started_at, nowUnix, workingCfg),
    0
  );
  const summaryFullSec = summaryActiveSec + summaryLiveSec;
  const summaryToleranceSec = byEmployee.reduce((s, e) => s + (Number(e.tolerance_sec) || 0), 0);
  const summaryAdjustedFullSec = Math.max(0, summaryFullSec - summaryToleranceSec);
  const totalUnits = Number(summaryRow.total_units) || 0;
  const throughputUnitsPerHour = summaryActiveSec > 0 ? round1((totalUnits * 3600) / summaryActiveSec) : 0;
  const utilizationPct = summaryElapsedSec > 0 ? round1((summaryActiveSec / summaryElapsedSec) * 100) : 0;
  const prevUnits = Number(prevSummaryRow.total_units) || 0;
  const prevActive = Math.floor(Number(prevSummaryRow.active_time_sec) || 0);
  const prevAvg = Number(prevSummaryRow.avg_sec) || 0;

  // Month-by-month breakdown — only for the yearly report (one extra query, rarely run).
  let byMonth = [];
  if (range.type === 'yearly') {
    const monthRes = await env.DB.prepare(`
      SELECT substr(day_date, 1, 7) AS ym,
        COUNT(*) AS units,
        COALESCE(SUM(duration_sec), 0) AS active_time_sec,
        ROUND(AVG(duration_sec)) AS avg_sec,
        COUNT(DISTINCT emp_id) AS workers
      FROM sessions ${dayFilter}
      GROUP BY ym
      ORDER BY ym ASC
    `).bind(...dayBinds).all();
    byMonth = (monthRes.results || []).map((r) => ({
      ym: r.ym,
      units: Number(r.units) || 0,
      active_time_sec: Math.floor(Number(r.active_time_sec) || 0),
      avg_sec: Number(r.avg_sec) || 0,
      workers: Number(r.workers) || 0,
    }));
  }

  return jsonRes(
    {
      ok: true,
      type: range.type,
      factory_today: factoryToday,
      local_today: localToday,
      generated: new Date().toISOString(),
      working_hours: workingCfg,
      period: {
        start_date: range.startYmd,
        end_date: range.endYmd,
        effective_date: range.type === 'daily' ? range.startYmd : '',
        anchor_date: isCustomRange || !dateParam ? '' : range.startYmd,
        custom: isCustomRange,
        fallback_applied: dailyFallbackApplied,
        previous_start_date: range.prevStart,
        previous_end_date: range.prevEnd,
        days: range.days,
      },
      summary: {
        ...summaryRow,
        total_units: totalUnits,
        avg_sec: Number(summaryRow.avg_sec) || 0,
        unique_workers: Number(summaryRow.unique_workers) || 0,
        unique_items: Number(summaryRow.unique_items) || 0,
        active_time_sec: summaryActiveSec,
        elapsed_time_sec: summaryElapsedSec,
        live_active_time_sec: summaryLiveSec,
        full_time_sec: summaryFullSec,
        tolerance_sec: summaryToleranceSec,
        adjusted_full_time_sec: summaryAdjustedFullSec,
        throughput_units_per_hour: throughputUnitsPerHour,
        utilization_pct: utilizationPct,
      },
      tolerance_policy: {
        model: 'dual',
        employee_per_segment_sec: EMP_TOLERANCE_PER_SEGMENT_SEC,
        employee_daily_cap_sec: EMP_TOLERANCE_DAILY_CAP_SEC,
        item_per_segment_sec: ITEM_TOLERANCE_PER_SEGMENT_SEC,
        note: 'Active time excludes breaks by design; tolerance reduces mishap impact in adjusted full-time views.',
      },
      insights: {
        top_employees: byEmployee.slice(0, 5),
        bottleneck_processes: byProcess.slice(0, 5),
        top_items: itemTotals.slice(0, 10),
        trend_vs_previous: {
          total_units_delta: totalUnits - prevUnits,
          active_time_sec_delta: summaryActiveSec - prevActive,
          avg_sec_delta: (Number(summaryRow.avg_sec) || 0) - prevAvg,
        },
      },
      by_employee: byEmployee,
      by_process: byProcess,
      by_month: byMonth,
      invoice_maker_sessions: invMaker.results || [],
      item_totals: itemTotals,
    },
    200,
    Object.assign({}, CEO_JSON_NO_STORE, {
      'Server-Timing': 'db;dur=' + dbMs + ', total;dur=' + (Date.now() - t0),
    })
  );
}
