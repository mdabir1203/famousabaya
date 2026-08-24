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
  currentShiftStartSec,
  workingStatusNow,
} from '../working-hours.js';
import { canonicalEmpProcess, emptyProcessSplit } from '../domain/process.js';
import { isValidYmd } from './report-shared.js';

/** GET /api/state — single D1.batch for reads (fewer internal round trips).
 *
 * Query params:
 *   ?from=<YYYY-MM-DD>  inclusive lower bound for the log lookback window.
 *                       When set, the dashboard's per-day KPIs (Completed,
 *                       Active Workers, Process Split, Employee Performance,
 *                       Garment Totals, Recent Invoice Logs) all scope to
 *                       this date instead of today. The CEO date picker
 *                       drives this — picking Aug 17 with no `to` collapses
 *                       the window to a single day.
 *   ?to=<YYYY-MM-DD>    inclusive upper bound. Defaults to `from` when only
 *                       `from` is set, otherwise to today. Together with
 *                       `from` this makes the endpoint behave like a tiny
 *                       report for any past day.
 *   ?days=<n>           how many days of history to include in the `logs`
 *                       field. Ignored when `from` is set (the range
 *                       overrides the lookback). Defaults to 1 and is
 *                       clamped to [1, 400]. The dashboard's report panel
 *                       asks for `?days=400` so weekly / monthly / yearly
 *                       reports can be aggregated from the bundle.
 *   ?limit=<n>          hard cap on log rows; clamped to [1, 5000].
 *
 * The endpoint stays backwards compatible: callers that only pass `?days=`
 * get the original "today + last N days of history" payload.
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

  // ---- Resolve the date window ----
  // If the CEO picks a date, the per-day KPIs (Completed Today, Employee
  // Performance — Today, Process Split Today, Garment Totals Today) all
  // scope to that date. Without an explicit `from`/`to`, we fall back to
  // the legacy `?days=` lookback against `factoryToday`.
  const fromParam = String((url && url.searchParams && url.searchParams.get('from')) || '').trim();
  const toParam = String((url && url.searchParams && url.searchParams.get('to')) || '').trim();
  const explicitRange = isValidYmd(fromParam) || isValidYmd(toParam);
  // The "anchor" is the single day that drives Completed / Employee Perf /
  // Process Split / Garment Totals / Recent Invoice Logs. When the CEO
  // picks a date, that's the anchor. Without a picked date, anchor = today.
  let anchorYmd = factoryToday;
  let toYmd = factoryToday;
  if (explicitRange) {
    const f = isValidYmd(fromParam) ? fromParam : (isValidYmd(toParam) ? toParam : factoryToday);
    const t = isValidYmd(toParam) ? toParam : f;
    if (f > t) {
      return jsonRes(
        { ok: false, error: 'Invalid range: from is after to' },
        400,
        CEO_JSON_NO_STORE
      );
    }
    anchorYmd = f;
    toYmd = t;
  }

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
  // When the CEO picked a date, the log lookback is the picked range —
  // not "the last N days" — so the recent-activity feed reflects what
  // they actually asked for. Otherwise fall back to the legacy N-day tail.
  let fromYmd;
  if (explicitRange) {
    fromYmd = anchorYmd;
  } else {
    const [ty, tm, td] = factoryToday.split('-').map(Number);
    const startDate = new Date(Date.UTC(ty, tm - 1, td));
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    fromYmd = startDate.getUTCFullYear() + '-' +
      String(startDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(startDate.getUTCDate()).padStart(2, '0');
  }

  // `logs` window upper bound: when the CEO picked a date, cap at toYmd;
  // otherwise include everything up to today.
  const logsToYmd = explicitRange ? toYmd : factoryToday;

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
    `).bind(fromYmd, logsToYmd, limit);
  // Per-employee perf: pick the *latest* emp_name / emp_process / emp_code /
  // emp_color / emp_initials (by ended_at), not the alphabetical MAX().
  // MAX() on TEXT is alphabetical in SQLite, so when one emp_id is reused
  // for a new joiner the dashboard would show the alphabetically-later name
  // — which is the wrong person. Subquery picks the most-recent row per emp.
  // Anchor = the picked day (or today) so the perf list reflects that day.
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
    `).bind(anchorYmd, anchorYmd);
  const stmtDaily = env.DB.prepare(`
      SELECT stat_date, total_units, total_sec, cutting_units, stitch_units, finish_units,
        tailor_01_units, tailor_02_units, hand_work_units, stone_work_units,
        button_units, embroidery_units, ari_work_units, hand_designing_units,
        invoice_maker_units, packaging_units, checker_units, peak_hour, updated_at
      FROM daily_stats WHERE stat_date >= ? AND stat_date <= ?
      ORDER BY stat_date DESC LIMIT 30
    `).bind(fromYmd, toYmd);
  const stmtAgg = env.DB.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(duration_sec), 0) as total_sec
      FROM sessions WHERE day_date >= ? AND day_date <= ?
    `).bind(anchorYmd, toYmd);
  const stmtProcSplit = env.DB.prepare(`
      SELECT emp_process, COUNT(*) as cnt FROM sessions
      WHERE day_date >= ? AND day_date <= ? GROUP BY emp_process
    `).bind(anchorYmd, toYmd);
  const stmtHourly = env.DB.prepare(`
      SELECT hour_of_day, COUNT(*) as cnt FROM sessions
      WHERE day_date = ? AND hour_of_day >= ? AND hour_of_day <= ?
      GROUP BY hour_of_day
    `).bind(anchorYmd, hourStart, hourEnd);
  const stmtGarment = env.DB.prepare(`
      SELECT abaya_id, MAX(abaya_code) as abaya_code,
        COUNT(*) as segments,
        COALESCE(SUM(duration_sec), 0) as completed_sec
      FROM sessions
      WHERE day_date >= ? AND day_date <= ?
      GROUP BY abaya_id
      ORDER BY SUM(duration_sec) DESC
      LIMIT 800
    `).bind(anchorYmd, toYmd);

  // Lifetime cumulative in-window seconds per abaya from abaya_time_map.
  // This is the "total on item" number the operator expects on the Live
  // Active Sessions row: it counts every in-window second this abaya has
  // ever had work logged against it, across the full multi-day build, not
  // just the picked-day or today window. The dashboard previously showed
  // today's `completed_sec` only, which under-reported long-running abayas
  // and over-reported abayas with forgotten-Finish sessions in the picked
  // day. Required for multi-day builds — never auto-close a session that
  // started days ago, because that abaya is still being built.
  const stmtAbayaLifetime = env.DB.prepare(`
      SELECT abaya_id, abaya_code, cumulative_in_window_sec,
        first_started_at, last_ended_at
      FROM abaya_time_map
    `);

  const [
    activeRes,
    logsRes,
    perfRes,
    dailyRes,
    todayAggRes,
    procSplitRes,
    hourlyRes,
    garmentTodayRes,
    abayaLifetimeRes,
  ] = await env.DB.batch([
    stmtActive,
    stmtLogs,
    stmtPerf,
    stmtDaily,
    stmtAgg,
    stmtProcSplit,
    stmtHourly,
    stmtGarment,
    stmtAbayaLifetime,
  ]);

  // Per-build aggregation for live abayas. The operator's mental model is
  // "this build of CF111" = the most recent contiguous run of sessions on
  // the same abaya_id, where a build boundary is a 24h+ gap between
  // consecutive sessions. Computing from `sessions` (source of truth, no
  // double-count bug) gives a sane number; the legacy abaya_time_map
  // cumulative mixes multiple builds and is inflated by the replay-dedup
  // bug, so we keep that field for back-compat and add this one for
  // "this build" on the Live row.
  //
  // We have to do this as a second D1 call (not part of the batch) because
  // the live abaya_ids only exist once the first batch returns. Cheap
  // anyway -- a single window-function query bounded to ~5-10 abayas.
  const liveAbayaIds = Array.from(
    new Set(
      (activeRes.results || [])
        .map((r) => (r.abaya_id != null && String(r.abaya_id) !== '' ? String(r.abaya_id) : ''))
        .filter(Boolean)
    )
  );
  let abayaBuildsRes = { results: [] };
  if (liveAbayaIds.length > 0) {
    const placeholders = liveAbayaIds.map(() => '?').join(',');
    abayaBuildsRes = await env.DB
      .prepare(
        `WITH ordered AS (
          SELECT abaya_id, abaya_code, started_at, ended_at, duration_sec,
            LAG(ended_at) OVER (PARTITION BY abaya_id ORDER BY started_at) AS prev_end
          FROM sessions
          WHERE abaya_id IN (${placeholders})
        ),
        with_boundary AS (
          SELECT *,
            CASE WHEN prev_end IS NULL OR (started_at - prev_end) >= 86400 THEN 1 ELSE 0 END AS is_new_build
          FROM ordered
        ),
        with_seq AS (
          SELECT *, SUM(is_new_build) OVER (PARTITION BY abaya_id ORDER BY started_at) AS build_seq
          FROM with_boundary
        ),
        latest AS (
          SELECT abaya_id, MAX(build_seq) AS last_seq FROM with_seq GROUP BY abaya_id
        )
        SELECT s.abaya_id, s.abaya_code,
          COUNT(*) AS units,
          COALESCE(SUM(s.duration_sec), 0) AS total_in_window_sec,
          MIN(s.started_at) AS build_start_unix,
          MAX(s.ended_at) AS last_session_unix,
          MAX(s.ended_at) - MIN(s.started_at) AS wall_clock_span_sec
        FROM with_seq s
        JOIN latest l ON l.abaya_id = s.abaya_id AND l.last_seq = s.build_seq
        GROUP BY s.abaya_id`
      )
      .bind(...liveAbayaIds)
      .all();
  }

  const nowSecForActive = Math.floor(Date.now() / 1000);
  const inWindowNow = isInWorkingWindow(nowSecForActive, workingCfg);
  const active = {};
  // When the operator asks for "this step (in shift)" on a Live row, they
  // want the time since the CURRENT shift window started, not the
  // total in-shift time across multiple days of an open session. A
  // worker who tapped Start at 7:34 PM yesterday and is still on the
  // floor at 9 AM today should read "1h 6m" (since today's 8 AM shift),
  // not "13h 40m" (yesterday's + today's in-shift sum). Cap the start
  // of the overlap window at the current shift's start time when
  // `now` is inside a working window; otherwise the cap does nothing
  // and `outside_shift` below handles the rest.
  const shiftStartSec = currentShiftStartSec(nowSecForActive, workingCfg);
  (activeRes.results || []).forEach((row) => {
    const rawStartedSec = Number(row.started_at) || 0;
    // If the session started in a previous shift window, the floor for
    // "this step" is the start of the current shift. If it started
    // during the current shift, the natural start is its own.
    const startedSec = shiftStartSec != null
      ? Math.max(rawStartedSec, shiftStartSec)
      : rawStartedSec;
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
  // Median session duration for the picked day. The mean is dominated by
  // forgotten-Finish sessions (workers who tap Start and walk away, leaving
  // a session open for hours); the median is much closer to a real per-step
  // cycle time and is the number the operator should look at when judging
  // "is my floor healthy". Renamed in the UI from "Avg Cycle Time" to
  // "Avg Session Time" with sub "median per finished step today".
  const dayDurations = (logsRes.results || [])
    .map((r) => Math.floor(Number(r.duration_sec) || 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  let medianSecToday = 0;
  if (dayDurations.length > 0) {
    const mid = Math.floor(dayDurations.length / 2);
    medianSecToday =
      dayDurations.length % 2 === 1
        ? dayDurations[mid]
        : Math.floor((dayDurations[mid - 1] + dayDurations[mid]) / 2);
  }
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

  // Lifetime cumulative in-window seconds per abaya. Used by the Live
  // Active Sessions row's "total on item" so the operator sees the full
  // multi-day build cost instead of just the picked-day slice. Multi-day
  // builds are valid — never auto-close a session that started days ago.
  const abayaLifetimeMap = {};
  (abayaLifetimeRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || id === '') return;
    abayaLifetimeMap[String(id)] = {
      abaya_id: row.abaya_id,
      abaya_code: row.abaya_code != null ? String(row.abaya_code) : '',
      cumulative_in_window_sec: Math.floor(Number(row.cumulative_in_window_sec) || 0),
      first_started_at: row.first_started_at != null ? Number(row.first_started_at) : null,
      last_ended_at: row.last_ended_at != null ? Number(row.last_ended_at) : null,
    };
  });

  // Per-build (current contiguous run) stats for every abaya that has a
  // live session right now. Computed from `sessions` with a 24h-gap
  // build-boundary rule. The legacy abaya_time_map cumulative above mixes
  // multiple builds of the same abaya_code and is inflated by a replay-
  // dedup bug; this map is the source of truth for "this build" on the
  // Live row. For live abayas the active session is folded in as a virtual
  // last row (added below).
  const abayaBuildsMap = {};
  (abayaBuildsRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || id === '') return;
    abayaBuildsMap[String(id)] = {
      abaya_id: row.abaya_id,
      abaya_code: row.abaya_code != null ? String(row.abaya_code) : '',
      units: Math.floor(Number(row.units) || 0),
      total_in_window_sec: Math.floor(Number(row.total_in_window_sec) || 0),
      build_start_unix: row.build_start_unix != null ? Number(row.build_start_unix) : null,
      last_session_unix: row.last_session_unix != null ? Number(row.last_session_unix) : null,
      wall_clock_span_sec: Math.floor(Number(row.wall_clock_span_sec) || 0),
    };
  });
  // Live sessions are NOT folded into total_in_window_sec on the server.
  // The client adds the live contribution via activeSecondsOnGarment()
  // (= server's windowed_elapsed_sec snapshot + seconds since last poll).
  // Folding here would double-count the snapshot. We only need the live
  // session's started_at to decide if it belongs to the current build
  // (i.e. within 24h of the most recent finished session).
  (activeRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || String(id) === '') return;
    const sid = String(id);
    const startedSec = Number(row.started_at) || 0;
    if (!startedSec) return;
    const b = abayaBuildsMap[sid];
    if (!b) {
      // No finished sessions for this abaya yet -- the live session is the
      // start of a brand new build. Emit an empty build entry (no finished
      // segments yet) so the Live row can still show a "build started"
      // caption and the client can add the live contribution.
      abayaBuildsMap[sid] = {
        abaya_id: row.abaya_id,
        abaya_code: row.abaya_code != null ? String(row.abaya_code) : '',
        units: 0,
        total_in_window_sec: 0,
        build_start_unix: startedSec,
        last_session_unix: startedSec,
        wall_clock_span_sec: 0,
      };
    }
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
      logs_to_ymd: logsToYmd,
      // The KPIs (Completed / Process Split / Employee Performance /
      // Garment Totals) and the Recent Invoice Logs feed are all anchored
      // to a single day, not "today" — when the CEO picks a date from
      // the date picker, the whole dashboard flips to that day.
      kpi_anchor_ymd: anchorYmd,
      kpi_to_ymd: toYmd,
      kpi_window_days: explicitRange ? (toYmd >= anchorYmd ? Math.floor((Date.parse(toYmd) - Date.parse(anchorYmd)) / 86400000) + 1 : 1) : 1,
      state_meta: {
        source: 'cloudflare-worker-d1',
        lag_mode: lagMode,
        logs_window_days: days,
        logs_from_ymd: fromYmd,
        logs_to_ymd: logsToYmd,
        kpi_anchor_ymd: anchorYmd,
        kpi_to_ymd: toYmd,
      },
      factory_today: factoryToday,
      completed_today: completedToday,
      avg_cycle_sec_today: avgCycleSecToday,
      median_session_sec_today: medianSecToday,
      efficiency_today: efficiencyToday,
      process_split_today: processSplitToday,
      hourly_today: hourlyToday,
      working_hours: workingCfg,
      working_status: workingStatusNow(workingCfg),
      active,
      garment_totals_today,
      abaya_lifetime: abayaLifetimeMap,
      abaya_builds: abayaBuildsMap,
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
