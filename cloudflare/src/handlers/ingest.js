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
import { broadcastRealtimeEvent } from './realtime-sse.js';

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

    // v1.2.40 — bump the factory_sync watermark. Failure here is logged
    // but NOT fatal: the active_sessions row is the source of truth for
    // the live board, and we'd rather show a stale seq than reject the
    // event (which would queue it back on the LAN side and create a
    // real sync gap). See migration 0021 for the table contract.
    const seqStart = await updateFactorySeqWatermark(env, payload, 'session_start');
    // Fan out to every open SSE listener so dashboards see the new active
    // row within sub-second of the LAN POST. Module-scoped connections set;
    // see realtime-sse.js for the lifecycle and reconnection guarantees.
    broadcastRealtimeEvent({
      kind: 'session_start',
      seq: seqStart,
      at: now,
      emp_id: payload.emp_id,
      abaya_id: payload.abaya_id || null,
    });

    return jsonRes({ ok: true, event: 'session_start', seq: seqStart });
  }

  const p = payload;
  if (!p.emp_id || p.ended_at == null) {
    return errRes('session_finish requires emp_id and ended_at', 400);
  }

  // v1.2.44 — END-TIME CONTRACT INVARIANT
  // -------------------------------------------------------------------------
  // `p.ended_at` MUST be the exact Unix second at which the worker tapped
  // Finish at the kiosk (or, for /api/admin/close-stale-sessions orphan
  // closes, the synthetic end time the LAN's close-stale code computed —
  // which is itself Date.now() at the moment of close, capped at 8 hours
  // after Start). It is NEVER to be derived from any formula on this side
  // of the boundary. The CEO dashboard's per-employee day report shows
  // this value verbatim in the SESSIONS table — see ceo-pages.js edFmtRange
  // — and the operator's audit depends on it being the actual tap time.
  //
  // Three runtime guards below catch the cases that broke the contract in
  // pre-v1.2.43 history (when close-stale-sessions re-runs on the same
  // orphan pushed a fresh session_finish with endMs = Date.now(), creating
  // duplicate rows with three different "end times" for one Start). After
  // v1.2.43 the LAN side has its own isDuplicateSessionFinish guard that
  // suppresses the re-push; these guards are defense in depth so a future
  // regression on either side is rejected loudly instead of silently
  // overwriting a real worker's Finish tap.
  //
  // DO NOT change this block without re-reading AGENTS.md §2
  // (timestamp contract) and the v1.2.43 release notes — these guards are
  // the operator-facing guarantee that the displayed END TIME matches
  // the kiosk tap.
  // -------------------------------------------------------------------------
  const startedAtSec = Number(p.started_at);
  const endedAtSec = Number(p.ended_at);
  if (!Number.isFinite(startedAtSec) || startedAtSec <= 0) {
    return errRes('session_finish requires started_at > 0 (the worker tap time on Start)', 400);
  }
  if (!Number.isFinite(endedAtSec) || endedAtSec <= 0) {
    return errRes('session_finish requires ended_at > 0 (the worker tap time on Finish)', 400);
  }
  if (endedAtSec <= startedAtSec) {
    return errRes(
      'session_finish ended_at must be strictly greater than started_at ' +
      '(got ended_at=' + endedAtSec + ', started_at=' + startedAtSec + ')',
      400
    );
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

  // v1.2.40 — bump factory_sync watermark and fan out to any open SSE
  // dashboard. Order matters: persist first (durable), then broadcast
  // (transient). A listener that misses a broadcast because it
  // disconnected / just subscribed will pick up the steady state on the
  // next /api/state hydration. See migration 0021 + realtime-sse.js.
  const seqFinish = await updateFactorySeqWatermark(env, p, 'session_finish');
  broadcastRealtimeEvent({
    kind: 'session_finish',
    seq: seqFinish,
    at: p.ended_at || now,
    session_id: sessionId,
    emp_id: p.emp_id,
    abaya_id: p.abaya_id || null,
    duration_sec: inWindowDuration,
    process: storedProcess,
  });

  return jsonRes({ ok: true, event: 'session_finish', session_id: sessionId, seq: seqFinish });
}

/**
 * v1.2.40 — Upsert the factory_sync watermark with the highest local_seq
 * the cloud has seen. Idempotent (MAX of current + incoming) so a queue
 * replay that delivers an older seq is a no-op while a newer seq (or
 * restart-rebased lower seq) still records the actual high water mark.
 *
 * Returns the post-upsert seq_value, or null on D1 failure so the caller
 * can log without rejecting the event itself.
 */
async function updateFactorySeqWatermark(env, payload, eventType) {
  try {
    const incoming = Number(payload && payload.local_seq);
    if (!Number.isFinite(incoming) || incoming <= 0) {
      // Legacy / non-stamped push — don't write a watermark row, but
      // also don't reject. The cloud-side seq tracking is opt-in for
      // v1.2.40; older factory servers continue to work unchanged.
      return null;
    }
    const empId = payload && payload.emp_id ? String(payload.emp_id) : null;
    await env.DB
      .prepare(
        `INSERT INTO factory_sync (seq_type, seq_value, last_event_type, last_emp_id, updated_at)
         VALUES ('events_seq', ?, ?, ?, unixepoch())
         ON CONFLICT(seq_type) DO UPDATE SET
           seq_value = MAX(factory_sync.seq_value, excluded.seq_value),
           last_event_type = excluded.last_event_type,
           last_emp_id = excluded.last_emp_id,
           updated_at = excluded.updated_at`
      )
      .bind(incoming, eventType, empId)
      .run();
    // Return the watermark we just committed so the broadcast / response
    // surfaces the actual stored value, not the inbound value (which may
    // be lower after a restart-and-replay).
    const row = await env.DB
      .prepare(`SELECT seq_value, updated_at FROM factory_sync WHERE seq_type='events_seq'`)
      .first();
    return row && Number(row.seq_value) ? Number(row.seq_value) : incoming;
  } catch (e) {
    console.warn('[ingest] factory_sync upsert failed (non-fatal):', e && e.message);
    return null;
  }
}
