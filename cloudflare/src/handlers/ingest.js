import { parseInvoiceNumberList } from '../../../shared/invoice-parser.mjs';
import { jsonRes, errRes } from '../http-response.js';
import { rateLimitOr429, rateLimitClientKey } from '../ratelimit.js';
import {
  getWorkingHoursConfig,
  isInWorkingWindow,
  overlapSecWithWindows,
  factoryDateStringForUnix,
  factoryHourForUnix,
} from '../working-hours.js';
import { canonicalEmpProcess, dailyStatsColumnForProcess } from '../domain/process.js';

/** POST /api/event — factory session ingest */
export async function handleIngest(request, env) {
  const rlBlock = await rateLimitOr429(
    env.INGEST_RATE_LIMIT,
    rateLimitClientKey(request, 'factory-ingest'),
    'Too many ingest requests. Wait and retry.'
  );
  if (rlBlock) return rlBlock;

  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized ingest request', 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return errRes('Invalid JSON body', 400);
  }

  if (!body || typeof body !== 'object') {
    return errRes('Body must be a JSON object', 400);
  }

  const { type, payload } = body;
  const now = Math.floor(Date.now() / 1000);

  if (type !== 'session_start' && type !== 'session_finish') {
    return errRes('Unknown event type: ' + String(type), 400);
  }

  if (!payload || typeof payload !== 'object') {
    return errRes('Missing or invalid payload', 400);
  }

  // Roster guard: real factory employees have stable ids in the form
  // `e_bc_<barcode>` (set by the local server's xlsx-based roster).
  // Anything else is a smoke-test, a post-deploy probe, or a misconfigured
  // local server, and it would otherwise leak into the per-employee
  // aggregations and the live row. Reject at the ingest boundary so the
  // bad row never lands in D1 in the first place. The local server maps
  // its short numeric `emp_id` to the barcoded form before pushing (see
  // server.js's `stableEmployeeIdFromBarcode`), so any non-`e_bc_*`
  // payload here is by definition wrong.
  const incomingEmpId = String((payload && payload.emp_id) || '').trim();
  if (!incomingEmpId) {
    return errRes('Missing emp_id in payload', 400);
  }
  if (!/^e_bc_\d+$/.test(incomingEmpId)) {
    console.warn('[ingest] rejected non-roster emp_id:', incomingEmpId, 'type=', type);
    return errRes('emp_id must be in the form e_bc_<barcode> (roster guard)', 422);
  }

  if (type === 'session_start') {
    const startSec = Number(payload.started_at) || now;
    const startCfg = await getWorkingHoursConfig(env);
    if (!isInWorkingWindow(startSec, startCfg)) {
      return errRes('Outside shift hours. Sessions can only start within working windows.', 422);
    }
    try {
      const insertRes = await env.DB.prepare(`
        INSERT OR REPLACE INTO active_sessions
          (emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
           abaya_id, abaya_code, station, started_at,
           effective_started_at, windowed_elapsed_sec, outside_shift, is_cross_day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          payload.emp_id,
          payload.emp_name,
          payload.emp_code,
          canonicalEmpProcess(payload.emp_process),
          payload.emp_color,
          payload.emp_initials,
          payload.abaya_id,
          payload.abaya_code,
          payload.station || 'S-02',
          payload.started_at || now,
          // Live-state columns (local server is canonical for these — see
          // shared/live-row-state.cjs). Fall back to the raw started_at
          // and "in shift" defaults for legacy push payloads that don't
          // ship the new fields.
          Number.isFinite(Number(payload.effective_started_at))
            ? Number(payload.effective_started_at)
            : (payload.started_at || now),
          Math.max(0, Math.floor(Number(payload.windowed_elapsed_sec) || 0)),
          payload.outside_shift ? 1 : 0,
          payload.is_cross_day ? 1 : 0
        )
        .run();
      // D1 returns { success, meta: { changes, last_row_id, ... } }. Log so
      // tail shows the actual write count — useful when the active_sessions
      // row appears missing on read.
      console.log('[ingest] session_start wrote', payload.emp_id, 'changes=', insertRes && insertRes.meta && insertRes.meta.changes);
    } catch (insertErr) {
      // Surface the actual D1 error so we stop guessing why the row
      // isn't appearing in /api/state reads.
      console.error('[ingest] session_start INSERT failed for', payload.emp_id, ':', insertErr && insertErr.message);
      return errRes('Failed to persist session_start: ' + (insertErr && insertErr.message ? insertErr.message : String(insertErr)), 500);
    }

    return jsonRes({ ok: true, event: 'session_start' });
  }

  const p = payload;
  if (!p.emp_id || p.ended_at == null) {
    return errRes('session_finish requires emp_id and ended_at', 400);
  }

  const sessionId = 'WL-' + p.emp_id + '-' + p.ended_at;
  const dayDate = factoryDateStringForUnix(env, p.ended_at);
  const hourOfDay = factoryHourForUnix(env, p.ended_at);
  const workingCfg = await getWorkingHoursConfig(env);
  const inWindowDuration = overlapSecWithWindows(p.started_at, p.ended_at, workingCfg);
  const storedProcess = canonicalEmpProcess(p.emp_process);
  const procCol = dailyStatsColumnForProcess(p.emp_process);

  let invCount = null;
  let invSerial = null;
  if (storedProcess === 'Invoice maker') {
    const invParsed = parseInvoiceNumberList(p.invoice_serial);
    if (!invParsed.ok) return errRes('Invoice maker: ' + invParsed.error, 400);
    const clientIc =
      p.invoice_count != null && p.invoice_count !== '' ? parseInt(String(p.invoice_count), 10) : NaN;
    if (Number.isFinite(clientIc) && clientIc !== invParsed.nums.length) {
      return errRes(
        'Invoice maker: invoice count does not match the number of invoice numbers in the list.',
        400
      );
    }
    invCount = invParsed.nums.length;
    invSerial = invParsed.nums.join(',');
  }

  const insertStmt = env.DB.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
         abaya_id, abaya_code, station, started_at, ended_at, duration_sec,
         hour_of_day, day_date, invoice_count, invoice_serial)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
    sessionId,
    p.emp_id,
    p.emp_name,
    p.emp_code,
    storedProcess,
    p.emp_color,
    p.emp_initials,
    p.abaya_id,
    p.abaya_code,
    p.station || 'S-02',
    p.started_at,
    p.ended_at,
    inWindowDuration,
    hourOfDay,
    dayDate,
    invCount,
    invSerial
  );

  const deleteStmt = env.DB.prepare(`DELETE FROM active_sessions WHERE emp_id = ?`).bind(p.emp_id);

  const upsertStmt = env.DB.prepare(`
      INSERT INTO daily_stats (stat_date, total_units, total_sec, ${procCol}, updated_at)
      VALUES (?, 1, ?, 1, unixepoch())
      ON CONFLICT(stat_date) DO UPDATE SET
        total_units = total_units + 1,
        total_sec   = total_sec + ?,
        ${procCol}  = ${procCol} + 1,
        updated_at  = unixepoch()
    `).bind(dayDate, inWindowDuration, inWindowDuration);

  /** Table ensured by schema.sql / migrations — never DDL on hot ingest path */
  const extra = [];
  if (p.abaya_id != null && String(p.abaya_id) !== '') {
    extra.push(
      env.DB.prepare(`
          INSERT INTO abaya_time_map
            (abaya_id, abaya_code, cumulative_in_window_sec, first_started_at, last_ended_at, updated_at)
          VALUES (?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT(abaya_id) DO UPDATE SET
            abaya_code = COALESCE(excluded.abaya_code, abaya_time_map.abaya_code),
            cumulative_in_window_sec = abaya_time_map.cumulative_in_window_sec + excluded.cumulative_in_window_sec,
            first_started_at = CASE
              WHEN abaya_time_map.first_started_at IS NULL THEN excluded.first_started_at
              WHEN excluded.first_started_at < abaya_time_map.first_started_at THEN excluded.first_started_at
              ELSE abaya_time_map.first_started_at
            END,
            last_ended_at = CASE
              WHEN abaya_time_map.last_ended_at IS NULL THEN excluded.last_ended_at
              WHEN excluded.last_ended_at > abaya_time_map.last_ended_at THEN excluded.last_ended_at
              ELSE abaya_time_map.last_ended_at
            END,
            updated_at = unixepoch()
        `).bind(p.abaya_id, p.abaya_code || '', inWindowDuration, p.started_at, p.ended_at)
    );
  }

  try {
    const batchRes = await env.DB.batch([insertStmt, deleteStmt, upsertStmt, ...extra]);
    // batchRes is an array; the order matches the input stmts.
    // Index 0 = sessions INSERT OR IGNORE, 1 = active_sessions DELETE,
    // 2 = daily_stats UPSERT, 3+ = abaya_time_map (if any).
    const sessionsMeta = batchRes && batchRes[0] && batchRes[0].meta;
    const activeDeleteMeta = batchRes && batchRes[1] && batchRes[1].meta;
    console.log(
      '[ingest] session_finish',
      sessionId,
      'sessions_changes=',
      sessionsMeta && sessionsMeta.changes,
      'active_delete_changes=',
      activeDeleteMeta && activeDeleteMeta.changes
    );
  } catch (finishErr) {
    console.error('[ingest] session_finish BATCH failed for', sessionId, ':', finishErr && finishErr.message);
    return errRes(
      'Failed to persist session_finish: ' + (finishErr && finishErr.message ? finishErr.message : String(finishErr)),
      500
    );
  }

  return jsonRes({ ok: true, event: 'session_finish', session_id: sessionId });
}
