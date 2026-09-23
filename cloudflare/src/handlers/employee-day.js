import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import {
  factoryTodayString,
  workingHoursConfigFromRow,
  WORKING_HOURS_KEY,
  overlapSecWithWindows,
} from '../working-hours.js';
import { isValidYmd } from './report-shared.js';
import { windowedActiveTimeSec } from './report.js';
// v1.2.46 — read-path scrub: the previous-day history strip ("4u 9h 55m" on
// 09-20) and the empty-day "nearby dates" hint used a raw `COUNT(*)` GROUP
// BY day_date. While the factory's LAN server still pushes pre-v1.2.43 dup
// rows, those numbers disagreed with PROCESS COMPLETED on the same modal
// (the in-modal dedup pass at lines below kept totals.units honest, but
// recent_days didn't go through it). Apply dedupSessionsCte() to both
// queries — same pattern as state.js stmtAgg / stmtPerf. See AGENTS.md §11.
import { dedupSessionsCte } from '../domain/data-cleanup.js';

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
      SELECT id, emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code,
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
    // v1.2.47 — surface the cloud D1 PK (`WL-<emp_id>-<ended_at>` shape)
    // so the day-modal UI can stamp an audit-stable data-session-id on
    // each row. Pair with the raw started_at_ms / ended_at_ms data
    // attributes the UI emits (see ceo-pages.js edFmtRange block) to
    // give every future "trace this session" hook a stable identifier
    // without re-querying D1.
    log_id: r.id != null ? String(r.id) : '',
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

  // v1.2.43 — defense-in-depth dedup. Historical data on the cloud may
  // still carry duplicate (emp_id, started_at) clusters from before the
  // server-side idempotency guard landed (see migration 0023 for the
  // one-time cleanup and server.js isDuplicateSessionFinish for the
  // runtime guard). Keep the row with the largest ended_at per cluster;
  // that's the latest close attempt and reflects the actual end of
  // work. (emp_id is constant within this query — it's filtered by the
  // empIdPlaceholders — so the dedup key reduces to started_at.)
  if (sessions.length > 1) {
    const dedupByStart = new Map();
    for (const s of sessions) {
      const startKey = Number(s.started_at || 0);
      const prev = dedupByStart.get(startKey);
      if (!prev || Number(s.ended_at || 0) > Number(prev.ended_at || 0)) {
        dedupByStart.set(startKey, s);
      }
    }
    if (dedupByStart.size < sessions.length) {
      const dedupedSessions = Array.from(dedupByStart.values()).sort(
        (a, b) => Number(a.started_at || 0) - Number(b.started_at || 0)
      );
      sessions.length = 0;
      sessions.push(...dedupedSessions);
    }
  }

  // Always load workingCfg — we use it both for the live session (today only)
  // and to window every finished session's duration (always).
  const workingCfg = workingHoursConfigFromRow(whRes && whRes.results && whRes.results[0]);

  let liveSec = 0;
  if (isToday) {
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
  // Windowed: each finished session's contribution is its in-shift
  // minutes only. The D1 `duration_sec` is the raw wall-clock sum, which
  // would over-count any session that started before lunch and finished
  // after (or that ran past the end of a shift because the worker forgot
  // to tap Finish). The total below is the operator's real "how much
  // time did this person actually work today" answer.
  const finishedRows = sessions
    .filter((x) => !x.live)
    .map((x) => ({ active_time_sec: x.duration_sec, min_started_at: x.started_at, max_ended_at: x.ended_at }));
  let activeSec = 0;
  for (const r of finishedRows) {
    activeSec += windowedActiveTimeSec(r, workingCfg);
  }
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
      // v1.2.46 — read-path scrub: deduplicate (emp_id, started_at)
      // clusters so the "X units" chip matches what PROCESS COMPLETED
      // would show if the operator jumped to that day. Raw COUNT(*)
      // would inflate the chip on days with stale dup-pushed rows.
      const nearbyRes = await env.DB.prepare(
        `${dedupSessionsCte()}
         SELECT s.day_date, COUNT(*) AS n
         FROM sessions s JOIN survivors w ON w.id = s.id
         WHERE s.emp_id IN (${empIdPlaceholders})
         GROUP BY s.day_date
         ORDER BY ABS(julianday(s.day_date) - julianday(?)) ASC
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

  // Last 30 days for this employee (always run, cheap). Lets the
  // day-report modal render a clickable 30-day history strip so the
  // CEO can see at a glance which dates actually have data. The strip
  // caps at 30 cells (5×6 of a 7-col grid is also fine); the SQL is
  // bounded to a single employee so the indexed day_date scan is fast.
  const RECENT_DAYS_N = 30;
  let recentDays = [];
  if (empIdList.length) {
    try {
      const start = date || factoryToday;
      const parts = start.split('-').map(Number);
      const fromYmd = (function () {
        if (!parts[0] || !parts[1] || !parts[2]) return factoryToday;
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        d.setUTCDate(d.getUTCDate() - (RECENT_DAYS_N - 1));
        return d.getUTCFullYear() + '-' +
          String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
          String(d.getUTCDate()).padStart(2, '0');
      })();
      // v1.2.46 — read-path scrub: deduplicate (emp_id, started_at)
      // clusters BEFORE counting. Before this fix, a single emp-day with
      // one stale dup-pushed row would show "4u" on the history strip
      // while PROCESS COMPLETED on the same modal correctly said 3. The
      // operator-visible mismatch was the 4u vs 3 bug filed on 2026-09-23.
      // Apply dedupSessionsCte() — same pattern as state.js stmtAgg /
      // stmtPerf / stmtGarment — so the per-day count agrees with the
      // post-dedup totals.units the modal header is already showing.
      const recentRes = await env.DB.prepare(
        `${dedupSessionsCte()}
         SELECT s.day_date, COUNT(*) AS n, COALESCE(SUM(s.duration_sec), 0) AS total_sec
         FROM sessions s JOIN survivors w ON w.id = s.id
         WHERE s.emp_id IN (${empIdPlaceholders}) AND s.day_date >= ? AND s.day_date <= ?
         GROUP BY s.day_date
         ORDER BY s.day_date DESC
         LIMIT ?`
      ).bind(...empIdList, fromYmd, start, RECENT_DAYS_N).all();
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
        // v1.2.43 — count distinct sessions (post-dedup), not raw D1 rows.
        // rows.length still reflects the pre-dedup cluster sizes for any
        // legacy duplicates that haven't been cleaned up by migration 0023
        // yet. The operator's KPI is "how many sessions did this worker
        // complete today" — which is the deduped count.
        units: sessions.filter((x) => !x.live).length,
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
