import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { getWorkingHoursConfig, overlapSecWithWindows } from '../working-hours.js';

/** GET /api/trace */
export async function handleGarmentTrace(env, url) {
  const q = (url.searchParams.get('q') || url.searchParams.get('abaya_id') || '').trim();
  if (!q) {
    return errRes('Missing q (abaya id or item code)', 400);
  }

  const res = await env.DB.prepare(
    `
    SELECT id, emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code,
      duration_sec, started_at, ended_at, day_date
    FROM sessions
    WHERE abaya_id = ? OR abaya_code = ?
    ORDER BY ended_at ASC
    LIMIT 100
  `
  )
    .bind(q, q)
    .all();

  const rows = res.results || [];
  let sumSec = 0;
  for (const r of rows) {
    sumSec += Math.floor(Number(r.duration_sec) || 0);
  }

  const actRes = await env.DB.prepare(
    `
    SELECT emp_id, emp_name, emp_process, abaya_id, abaya_code, started_at
    FROM active_sessions
    WHERE abaya_id = ? OR abaya_code = ?
  `
  )
    .bind(q, q)
    .all();

  const nowUnix = Math.floor(Date.now() / 1000);
  const workingCfg = await getWorkingHoursConfig(env);
  let activeSec = 0;
  (actRes.results || []).forEach((r) => {
    const st = Number(r.started_at);
    if (Number.isFinite(st)) activeSec += overlapSecWithWindows(st, nowUnix, workingCfg);
  });

  return jsonRes(
    {
      ok: true,
      q,
      rows,
      session_count: rows.length,
      sum_duration_sec: sumSec,
      active_sessions: actRes.results || [],
      active_seconds: activeSec,
      sum_with_active_sec: sumSec + activeSec,
      note:
        'Sum of finished segment times plus any in-progress work on the floor for this item. Wall-clock may differ if steps overlap.',
    },
    200,
    CEO_JSON_NO_STORE
  );
}
