/**
 * AbaYa Track — Cloudflare Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles 4 concerns in one worker:
 *
 *  POST /api/event           ← Factory server pushes session events (ingest)
 *  GET  /api/state           ← CEO dashboard polls for real-time data
 *  GET  /api/report?type=    ← CEO requests shift reports
 *  GET  /api/catalog/abayas ← Public catalog for factory server (D1)
 *  PUT  /api/catalog/abayas ← Office watcher (X-Ingest-Secret) replaces catalog
 *  GET  /                    ← Serves the CEO dashboard HTML
 *  GET  /scheduled           ← Cron trigger for EOD summary
 *
 * Environment variables (set via `wrangler secret put`):
 *   INGEST_SECRET  — used by factory server to authenticate POSTs
 *   CEO_TOKEN      — CEO password for dashboard access
 *
 * Optional `[vars]` in wrangler.toml:
 *   FACTORY_TZ     — IANA timezone for day_date / reports (default: Asia/Dubai)
 *
 * Bindings (set in wrangler.toml):
 *   DB      — D1 database
 *   EXPORTS — R2 bucket (for future PDF exports)
 */

// ─── CORS HEADERS ─────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Ingest-Secret',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function errRes(msg, status = 400) {
  return jsonRes({ ok: false, error: msg }, status);
}

const MAX_INVOICE_NUMBERS = 500;
const MAX_INVOICE_DIGITS_PER = 20;
const MAX_INVOICE_RAW_CHARS = 12000;
const INVOICE_TOKEN_RE = /^\d{1,20}$/;

function parseInvoiceNumberList(raw) {
  const str = String(raw ?? '');
  if (str.length > MAX_INVOICE_RAW_CHARS) {
    return {
      ok: false,
      error: `List is too long. Use at most ${MAX_INVOICE_RAW_CHARS} characters or split across sessions.`,
      nums: [],
    };
  }
  const parts = str
    .trim()
    .split(/[\r\n,;\s\u00a0]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nums = [];
  const seen = new Set();
  for (const p of parts) {
    if (!INVOICE_TOKEN_RE.test(p)) {
      const show = p.length > 24 ? `${p.slice(0, 24)}\u2026` : p;
      return {
        ok: false,
        error: `Invalid value "${show}": each invoice number must be digits only, 1\u2013${MAX_INVOICE_DIGITS_PER} digits.`,
        nums: [],
      };
    }
    if (seen.has(p)) {
      return { ok: false, error: `Duplicate invoice number: ${p}. Remove the duplicate.`, nums: [] };
    }
    seen.add(p);
    nums.push(p);
  }
  if (nums.length < 1) {
    return { ok: false, error: 'Enter at least one invoice number.', nums: [] };
  }
  if (nums.length > MAX_INVOICE_NUMBERS) {
    return { ok: false, error: `Too many invoice numbers (max ${MAX_INVOICE_NUMBERS} per session).`, nums: [] };
  }
  return { ok: true, error: '', nums };
}

// ─── FACTORY TIMEZONE (day boundaries & hour-of-day for analytics) ────────────
function getFactoryTz(env) {
  const t = env.FACTORY_TZ;
  return typeof t === 'string' && t.trim() ? t.trim() : 'Asia/Dubai';
}

/** CEO hourly chart: include all hours where completions can occur (shift windows). */
const FACTORY_HOURLY_START = 9;
const FACTORY_HOURLY_END = 23;

function factoryDateStringForUnix(env, unixSec) {
  const tz = getFactoryTz(env);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSec * 1000));
}

function factoryHourForUnix(env, unixSec) {
  const tz = getFactoryTz(env);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(unixSec * 1000));
  const h = parts.find((p) => p.type === 'hour');
  return h ? parseInt(h.value, 10) : 0;
}

function factoryTodayString(env) {
  return factoryDateStringForUnix(env, Math.floor(Date.now() / 1000));
}

// ─── WORK TYPES (job card “Type of Work” + Hand Designing) ───────────────────
const WORK_TYPES = [
  'Tailor (01)',
  'Tailor (02)',
  'Hand Work',
  'Stone Work',
  'Button',
  'Embroidery',
  'Ari Work',
  'Hand Designing',
  'Invoice maker',
  'Packaging',
  'Checker',
];

const PROCESS_TO_DAILY_COL = {
  'Tailor (01)': 'tailor_01_units',
  'Tailor (02)': 'tailor_02_units',
  'Hand Work': 'hand_work_units',
  'Stone Work': 'stone_work_units',
  Button: 'button_units',
  Embroidery: 'embroidery_units',
  'Ari Work': 'ari_work_units',
  'Hand Designing': 'hand_designing_units',
  'Invoice maker': 'invoice_maker_units',
  Packaging: 'packaging_units',
  Checker: 'checker_units',
  Cutting: 'tailor_01_units',
  Stitching: 'tailor_02_units',
  Finishing: 'hand_work_units',
};

function dailyStatsColumnForProcess(proc) {
  return PROCESS_TO_DAILY_COL[proc] || 'tailor_01_units';
}

function canonicalEmpProcess(raw) {
  if (raw === 'Cutting') return 'Tailor (01)';
  if (raw === 'Stitching') return 'Tailor (02)';
  if (raw === 'Finishing') return 'Hand Work';
  if (WORK_TYPES.includes(raw)) return raw;
  return raw || 'Tailor (01)';
}

function emptyProcessSplit() {
  const o = {};
  WORK_TYPES.forEach((t) => { o[t] = 0; });
  return o;
}

const SUMMARY_WT_CASES = `
  SUM(CASE WHEN emp_process IN ('Tailor (01)','Cutting') THEN 1 ELSE 0 END) as tailor_01,
  SUM(CASE WHEN emp_process IN ('Tailor (02)','Stitching') THEN 1 ELSE 0 END) as tailor_02,
  SUM(CASE WHEN emp_process IN ('Hand Work','Finishing') THEN 1 ELSE 0 END) as hand_work,
  SUM(CASE WHEN emp_process='Stone Work' THEN 1 ELSE 0 END) as stone_work,
  SUM(CASE WHEN emp_process='Button' THEN 1 ELSE 0 END) as button,
  SUM(CASE WHEN emp_process='Embroidery' THEN 1 ELSE 0 END) as embroidery,
  SUM(CASE WHEN emp_process='Ari Work' THEN 1 ELSE 0 END) as ari_work,
  SUM(CASE WHEN emp_process='Hand Designing' THEN 1 ELSE 0 END) as hand_designing,
  SUM(CASE WHEN emp_process='Invoice maker' THEN 1 ELSE 0 END) as invoice_maker,
  SUM(CASE WHEN emp_process='Packaging' THEN 1 ELSE 0 END) as packaging,
  SUM(CASE WHEN emp_process='Checker' THEN 1 ELSE 0 END) as checker
`;

// ─── ABAYA CATALOG (D1) ───────────────────────────────────────────────────────
async function handleCatalogAbayasGet(env) {
  const verRow = await env.DB.prepare('SELECT v FROM catalog_meta WHERE k = ?').bind('version').first();
  const version = verRow && verRow.v != null ? String(verRow.v) : '0';
  const { results } = await env.DB.prepare(
    'SELECT id, code, barcode, design, process, icon FROM abaya_catalog ORDER BY code ASC'
  ).all();
  const abayas = (results || []).map((r) => ({
    id: r.id,
    code: r.code,
    barcode: r.barcode,
    design: r.design,
    process: r.process,
    icon: r.icon != null ? r.icon : '',
  }));
  return jsonRes({ ok: true, version, abayas });
}

async function handleCatalogAbayasPut(request, env) {
  const secret = request.headers.get('X-Ingest-Secret');
  if (!secret || secret !== env.INGEST_SECRET) {
    return errRes('Unauthorized ingest request', 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errRes('Invalid JSON body', 400);
  }

  const rows = Array.isArray(body) ? body : body && body.abayas;
  if (!Array.isArray(rows)) {
    return errRes('Body must be a JSON array or { abayas: [...] }', 400);
  }

  const norm = [];
  const seenId = new Set();
  const seenCode = new Set();
  const seenBc = new Set();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') {
      return errRes(`Row ${i + 1}: must be an object`, 400);
    }
    const id = String(r.id ?? '').trim();
    const code = String(r.code ?? '').trim();
    const barcode = String(r.barcode ?? '').trim();
    const design = String(r.design ?? '').trim();
    const process = String(r.process ?? '').trim();
    const iconRaw = r.icon;
    const icon = iconRaw == null || iconRaw === '' ? '' : String(iconRaw);

    if (!id || !code || !barcode || !process) {
      return errRes(
        `Row ${i + 1}: id, code, barcode, and process are required (design may be empty)`,
        400
      );
    }
    if (seenId.has(id)) return errRes(`Duplicate id in upload: ${id}`, 400);
    if (seenCode.has(code)) return errRes(`Duplicate code in upload: ${code}`, 400);
    if (seenBc.has(barcode)) return errRes(`Duplicate barcode in upload: ${barcode}`, 400);
    seenId.add(id);
    seenCode.add(code);
    seenBc.add(barcode);
    norm.push({ id, code, barcode, design, process, icon });
  }

  const newVersion = String(Date.now());
  const stmts = [env.DB.prepare('DELETE FROM abaya_catalog')];
  for (const r of norm) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO abaya_catalog (id, code, barcode, design, process, icon, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch())`
      ).bind(r.id, r.code, r.barcode, r.design, r.process, r.icon || null)
    );
  }
  stmts.push(
    env.DB.prepare('INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)').bind('version', newVersion)
  );

  await env.DB.batch(stmts);
  return jsonRes({ ok: true, version: newVersion, count: norm.length });
}

// ─── MAIN FETCH HANDLER ───────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ── Catalog API (no CEO token; PUT uses INGEST_SECRET) ─────────────────────
    if (path === '/api/catalog/abayas') {
      try {
        if (request.method === 'GET') {
          return await handleCatalogAbayasGet(env);
        }
        if (request.method === 'PUT') {
          return await handleCatalogAbayasPut(request, env);
        }
        return errRes('Method not allowed', 405);
      } catch (e) {
        console.error('Catalog error:', e);
        return errRes('Catalog error: ' + e.message, 500);
      }
    }

    // ── CEO AUTH CHECK (for all /api/* and / except ingest + catalog) ──────────
    const isCEORoute =
      path === '/' ||
      (path.startsWith('/api/') && path !== '/api/event' && path !== '/api/catalog/abayas');
    if (isCEORoute) {
      // Accept token from query param or Authorization header
      const token = url.searchParams.get('token') ||
        (request.headers.get('Authorization') || '').replace('Bearer ', '');
      if (token !== env.CEO_TOKEN) {
        // Serve the login page if no token
        const loginHtml = getLoginPage(url.origin);
        return new Response(loginHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    }

    // ── ROUTES ────────────────────────────────────────────────────────────────
    try {
      // [A] Factory Ingest — POST /api/event
      if (path === '/api/event' && request.method === 'POST') {
        return handleIngest(request, env);
      }

      // [B] CEO State Poll — GET /api/state
      if (path === '/api/state' && request.method === 'GET') {
        return handleState(request, env, url);
      }

      // [C] CEO Report — GET /api/report
      if (path === '/api/report' && request.method === 'GET') {
        return handleReport(request, env, url);
      }

      // [D] CEO Dashboard UI — GET /
      if (path === '/' && request.method === 'GET') {
        const token = url.searchParams.get('token');
        return new Response(getCEODashboard(token, url.origin), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return errRes('Not found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return errRes('Internal server error: ' + e.message, 500);
    }
  },

  // ── CRON TRIGGER — End of Day Summary ───────────────────────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendEODSummary(env));
  },
};

// ─── [A] FACTORY INGEST ───────────────────────────────────────────────────────
async function handleIngest(request, env) {
  // Authenticate factory server
  const secret = request.headers.get('X-Ingest-Secret');
  if (!secret || secret !== env.INGEST_SECRET) {
    return errRes('Unauthorized ingest request', 401);
  }

  const body = await request.json();
  const { type, payload } = body;
  const now = Math.floor(Date.now() / 1000);

  if (type === 'session_start') {
    // Upsert active session
    await env.DB.prepare(`
      INSERT OR REPLACE INTO active_sessions
        (emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
         abaya_id, abaya_code, station, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payload.emp_id, payload.emp_name, payload.emp_code,
      canonicalEmpProcess(payload.emp_process), payload.emp_color, payload.emp_initials,
      payload.abaya_id, payload.abaya_code,
      payload.station || 'S-02',
      payload.started_at || now
    ).run();

    return jsonRes({ ok: true, event: 'session_start' });
  }

  if (type === 'session_finish') {
    const p = payload;
    const sessionId = 'WL-' + p.emp_id + '-' + p.ended_at;
    const dayDate = factoryDateStringForUnix(env, p.ended_at);
    const hourOfDay = factoryHourForUnix(env, p.ended_at);
    const storedProcess = canonicalEmpProcess(p.emp_process);
    const procCol = dailyStatsColumnForProcess(p.emp_process);

    let invCount = null;
    let invSerial = null;
    if (storedProcess === 'Invoice maker') {
      const invParsed = parseInvoiceNumberList(p.invoice_serial);
      if (!invParsed.ok) return errRes('Invoice maker: ' + invParsed.error, 400);
      const clientIc =
        p.invoice_count != null && p.invoice_count !== ''
          ? parseInt(String(p.invoice_count), 10)
          : NaN;
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
      sessionId, p.emp_id, p.emp_name, p.emp_code, storedProcess,
      p.emp_color, p.emp_initials,
      p.abaya_id, p.abaya_code, p.station || 'S-02',
      p.started_at, p.ended_at, p.duration_sec,
      hourOfDay, dayDate, invCount, invSerial
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
    `).bind(dayDate, p.duration_sec, p.duration_sec);

    await env.DB.batch([insertStmt, deleteStmt, upsertStmt]);

    return jsonRes({ ok: true, event: 'session_finish', session_id: sessionId });
  }

  return errRes('Unknown event type: ' + type);
}

// ─── [B] CEO STATE ────────────────────────────────────────────────────────────
async function handleState(request, env, url) {
  const factoryToday = factoryTodayString(env);

  const [
    activeRes,
    logsRes,
    perfRes,
    dailyRes,
    todayAggRes,
    procSplitRes,
    hourlyRes,
  ] = await Promise.all([
    env.DB.prepare(`SELECT * FROM active_sessions ORDER BY started_at ASC`).all(),
    env.DB.prepare(`SELECT * FROM sessions ORDER BY ended_at DESC LIMIT 100`).all(),
    env.DB.prepare(`
      SELECT emp_id, emp_name, emp_process, emp_color, emp_initials,
        COUNT(*) as units,
        ROUND(AVG(duration_sec)) as avg_sec,
        SUM(duration_sec) as total_sec
      FROM sessions
      WHERE day_date = ?
      GROUP BY emp_id
      ORDER BY units DESC
    `).bind(factoryToday).all(),
    env.DB.prepare(`SELECT * FROM daily_stats ORDER BY stat_date DESC LIMIT 7`).all(),
    env.DB.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(duration_sec), 0) as total_sec
      FROM sessions WHERE day_date = ?
    `).bind(factoryToday).first(),
    env.DB.prepare(`
      SELECT emp_process, COUNT(*) as cnt FROM sessions
      WHERE day_date = ? GROUP BY emp_process
    `).bind(factoryToday).all(),
    env.DB.prepare(`
      SELECT hour_of_day, COUNT(*) as cnt FROM sessions
      WHERE day_date = ? AND hour_of_day >= ? AND hour_of_day <= ?
      GROUP BY hour_of_day
    `).bind(factoryToday, FACTORY_HOURLY_START, FACTORY_HOURLY_END).all(),
  ]);

  // Build active sessions map (keyed by emp_id)
  const active = {};
  (activeRes.results || []).forEach(row => {
    active[row.emp_id] = {
      emp_name: row.emp_name, emp_code: row.emp_code, emp_process: row.emp_process,
      emp_color: row.emp_color, emp_initials: row.emp_initials,
      abaya_id: row.abaya_id, abaya_code: row.abaya_code,
      station: row.station, started_at: row.started_at * 1000, // back to ms
    };
  });

  // Build perf array with efficiency
  const perf = (perfRes.results || []).map(p => {
    const targetSec = p.units * 2700; // 45 min target per unit
    const eff = p.total_sec > 0 ? Math.min(100, Math.round((targetSec / p.total_sec) * 100)) : 0;
    return {
      id: p.emp_id, name: p.emp_name, process: p.emp_process,
      color: p.emp_color, initials: p.emp_initials,
      units: p.units, avg_sec: p.avg_sec, eff,
    };
  });

  const agg = todayAggRes || { cnt: 0, total_sec: 0 };
  const completedToday = Number(agg.cnt) || 0;
  const totalSecToday = Number(agg.total_sec) || 0;
  const avgCycleSecToday = completedToday > 0 ? Math.round(totalSecToday / completedToday) : 0;
  const targetSecToday = completedToday * 2700;
  const efficiencyToday = totalSecToday > 0
    ? Math.min(100, Math.round((targetSecToday / totalSecToday) * 100))
    : 0;

  const processSplitToday = emptyProcessSplit();
  (procSplitRes.results || []).forEach((row) => {
    const key = canonicalEmpProcess(row.emp_process);
    if (processSplitToday[key] !== undefined) {
      processSplitToday[key] += Number(row.cnt) || 0;
    }
  });

  const hourlyToday = {};
  for (let h = FACTORY_HOURLY_START; h <= FACTORY_HOURLY_END; h++) hourlyToday[h] = 0;
  (hourlyRes.results || []).forEach((row) => {
    const h = Number(row.hour_of_day);
    if (h >= FACTORY_HOURLY_START && h <= FACTORY_HOURLY_END) {
      hourlyToday[h] = Number(row.cnt) || 0;
    }
  });

  return jsonRes({
    ok: true,
    ts: Date.now(),
    factory_today: factoryToday,
    completed_today: completedToday,
    avg_cycle_sec_today: avgCycleSecToday,
    efficiency_today: efficiencyToday,
    process_split_today: processSplitToday,
    hourly_today: hourlyToday,
    active,
    logs: (logsRes.results || []).map(r => ({
      ...r,
      started_at: r.started_at * 1000,
      ended_at: r.ended_at * 1000,
    })),
    perf,
    daily: dailyRes.results || [],
  });
}

// ─── [C] CEO REPORT ───────────────────────────────────────────────────────────
async function handleReport(request, env, url) {
  const type = url.searchParams.get('type') || 'daily';
  const factoryToday = factoryTodayString(env);

  let summary;
  let breakdown;
  let invMaker;

  if (type === 'daily') {
    [summary, breakdown, invMaker] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) as total_units, ROUND(AVG(duration_sec)) as avg_sec,
          COUNT(DISTINCT emp_id) as unique_workers,
          ${SUMMARY_WT_CASES}
        FROM sessions WHERE day_date = ?
      `).bind(factoryToday).first(),
      env.DB.prepare(`
        SELECT emp_name, emp_process, emp_code,
          COUNT(*) as units, ROUND(AVG(duration_sec)) as avg_sec
        FROM sessions WHERE day_date = ?
        GROUP BY emp_id ORDER BY units DESC
      `).bind(factoryToday).all(),
      env.DB.prepare(`
        SELECT emp_name, emp_code, abaya_code, invoice_count, invoice_serial, duration_sec, ended_at
        FROM sessions
        WHERE day_date = ? AND emp_process = 'Invoice maker'
          AND invoice_serial IS NOT NULL AND invoice_serial != ''
        ORDER BY ended_at DESC
        LIMIT 100
      `).bind(factoryToday).all(),
    ]);
  } else if (type === 'weekly') {
    const dayFilter = `WHERE started_at > unixepoch('now', '-7 days')`;
    [summary, breakdown, invMaker] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) as total_units, ROUND(AVG(duration_sec)) as avg_sec,
          COUNT(DISTINCT emp_id) as unique_workers,
          ${SUMMARY_WT_CASES}
        FROM sessions ${dayFilter}
      `).first(),
      env.DB.prepare(`
        SELECT emp_name, emp_process, emp_code,
          COUNT(*) as units, ROUND(AVG(duration_sec)) as avg_sec
        FROM sessions ${dayFilter}
        GROUP BY emp_id ORDER BY units DESC
      `).all(),
      env.DB.prepare(`
        SELECT emp_name, emp_code, abaya_code, invoice_count, invoice_serial, duration_sec, ended_at
        FROM sessions
        ${dayFilter} AND emp_process = 'Invoice maker'
          AND invoice_serial IS NOT NULL AND invoice_serial != ''
        ORDER BY ended_at DESC
        LIMIT 150
      `).all(),
    ]);
  } else {
    [summary, breakdown, invMaker] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) as total_units, ROUND(AVG(duration_sec)) as avg_sec,
          COUNT(DISTINCT emp_id) as unique_workers,
          ${SUMMARY_WT_CASES}
        FROM sessions
      `).first(),
      env.DB.prepare(`
        SELECT emp_name, emp_process, emp_code,
          COUNT(*) as units, ROUND(AVG(duration_sec)) as avg_sec
        FROM sessions
        GROUP BY emp_id ORDER BY units DESC
      `).all(),
      env.DB.prepare(`
        SELECT emp_name, emp_code, abaya_code, invoice_count, invoice_serial, duration_sec, ended_at
        FROM sessions
        WHERE emp_process = 'Invoice maker'
          AND invoice_serial IS NOT NULL AND invoice_serial != ''
        ORDER BY ended_at DESC
        LIMIT 200
      `).all(),
    ]);
  }

  return jsonRes({
    ok: true, type,
    factory_today: factoryToday,
    generated: new Date().toISOString(),
    summary,
    by_employee: breakdown.results || [],
    invoice_maker_sessions: invMaker.results || [],
  });
}

// ─── EOD CRON SUMMARY ─────────────────────────────────────────────────────────
async function sendEODSummary(env) {
  const today = factoryTodayString(env);
  const stats = await env.DB.prepare(
    `SELECT * FROM daily_stats WHERE stat_date = ?`
  ).bind(today).first();

  const sessions = await env.DB.prepare(
    `SELECT emp_name, emp_process, COUNT(*) as units FROM sessions WHERE day_date = ? GROUP BY emp_id ORDER BY units DESC LIMIT 5`
  ).bind(today).all();

  const avgSec = stats && stats.total_units > 0
    ? Math.round(stats.total_sec / stats.total_units) : 0;

  let msg = '\uD83D\uDCCA *AbaYa Track — End of Day Report*\n';
  msg += '_' + today + '_\n\n';
  msg += '\uD83D\uDC54 *Production Summary*\n';
  msg += '\u2022 Total Completed: *' + (stats ? stats.total_units : 0) + ' units*\n';
  msg += '\u2022 Avg Cycle Time: *' + fmtHMS(avgSec) + '*\n';
  const u = stats || {};
  msg += '\u2022 Tailor (01): ' + (u.tailor_01_units || 0) + ' | Tailor (02): ' + (u.tailor_02_units || 0)
    + ' | Hand Work: ' + (u.hand_work_units || 0) + '\n';
  msg += '\u2022 Stone Work: ' + (u.stone_work_units || 0) + ' | Button: ' + (u.button_units || 0)
    + ' | Embroidery: ' + (u.embroidery_units || 0) + '\n';
  msg += '\u2022 Ari Work: ' + (u.ari_work_units || 0) + ' | Hand Designing: ' + (u.hand_designing_units || 0) + '\n';
  msg += '\u2022 Invoice maker: ' + (u.invoice_maker_units || 0) + ' | Packaging: ' + (u.packaging_units || 0)
    + ' | Checker: ' + (u.checker_units || 0) + '\n\n';
  msg += '\uD83C\uDFC6 *Top Performers Today*\n';
  (sessions.results || []).forEach((r, i) => {
    msg += (i + 1) + '. ' + r.emp_name + ' \u2014 ' + r.units + ' units (' + r.emp_process + ')\n';
  });
  msg += '\n\u2705 _Auto-generated by AbaYa Track Server_';

  // Store in R2 for audit log
  if (env.EXPORTS) {
    await env.EXPORTS.put(`eod/${today}.txt`, msg, {
      httpMetadata: { contentType: 'text/plain' },
    });
  }

  console.log('EOD Summary generated for', today, ':', stats);
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function fmtHMS(sec) {
  if (!sec || sec < 1) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function getLoginPage(origin) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AbaYa Track — CEO Access</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0e0d;color:#f0ede8;font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .box{background:#1a1917;border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:40px;width:100%;max-width:360px;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.6)}
  .logo{width:64px;height:64px;background:linear-gradient(135deg,#d4a574,#a0785a);border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 20px}
  h1{font-size:22px;font-weight:800;margin-bottom:6px}
  p{color:#6b6760;font-size:13px;margin-bottom:28px}
  input{width:100%;padding:14px 18px;background:#242220;border:1px solid rgba(255,255,255,.16);border-radius:12px;color:#f0ede8;font-size:16px;text-align:center;letter-spacing:3px;outline:none;transition:border-color .2s;margin-bottom:12px}
  input:focus{border-color:#3b82f6}
  button{width:100%;padding:15px;background:#3b82f6;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;transition:all .2s}
  button:hover{background:#2563eb}
  .err{color:#ef4444;font-size:13px;margin-top:10px;min-height:20px}
</style></head><body>
<div class="box">
  <div class="logo">&#129525;</div>
  <h1>CEO Access</h1>
  <p>AbaYa Track &mdash; Executive Dashboard</p>
  <input type="password" id="tok" placeholder="Enter Access Code" maxlength="64" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">&#128274; Access Dashboard</button>
  <div class="err" id="err"></div>
</div>
<script>
function login() {
  const t = document.getElementById('tok').value.trim();
  if (!t) { document.getElementById('err').textContent = 'Enter access code'; return; }
  window.location.href = '/?token=' + encodeURIComponent(t);
}
</script></body></html>`;
}

// ─── CEO DASHBOARD HTML (served by the Worker itself) ─────────────────────────
function getCEODashboard(token, origin) {
  const apiBase = origin;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AbaYa Track — CEO Dashboard</title>
<style>
:root{--bg:#0f0e0d;--s1:#1a1917;--s2:#242220;--s3:#2e2c29;--bd:rgba(255,255,255,.08);--bd2:rgba(255,255,255,.16);--tx:#f0ede8;--tx2:#9c9890;--tx3:#6b6760;--gr:#22c55e;--grb:rgba(34,197,94,.12);--rd:#ef4444;--bl:#3b82f6;--blb:rgba(59,130,246,.15);--am:#f59e0b;--pu:#a78bfa;--fn:'SF Pro Display','Segoe UI',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:var(--fn);min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:11px 18px;background:var(--s1);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:100}
.tb-brand{display:flex;align-items:center;gap:10px}
.tb-logo{width:32px;height:32px;background:linear-gradient(135deg,#d4a574,#a0785a);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px}
.tb-name{font-size:15px;font-weight:600}
.tb-sub{font-size:11px;color:var(--tx3)}
.live-badge{display:flex;align-items:center;gap:5px;background:rgba(239,68,68,.12);color:var(--rd);padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--rd);animation:blink 1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.dash{padding:16px;max-width:1100px;margin:0 auto}
.dh{font-size:20px;font-weight:700;margin-bottom:2px}
.ds{font-size:12px;color:var(--tx3);margin-bottom:18px}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.stat-card{background:var(--s1);border:1px solid var(--bd);border-radius:14px;padding:18px}
.stat-lbl{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-weight:600}
.stat-val{font-size:28px;font-weight:800;margin:6px 0 2px}
.stat-sub{font-size:11px;color:var(--tx3)}
.dash-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.dash-card{background:var(--s1);border:1px solid var(--bd);border-radius:14px;padding:18px}
.dct{font-size:11px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.emp-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;transition:background .15s}
.emp-row:hover{background:rgba(255,255,255,.03)}
.emp-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}
.bar-wrap{flex:1;height:5px;background:var(--s3);border-radius:3px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px}
.rep-panel{background:linear-gradient(135deg,rgba(59,130,246,.1),rgba(167,139,250,.07));border:1px solid rgba(59,130,246,.25);border-radius:14px;padding:16px;margin-bottom:16px}
.rep-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.rep-btn{display:flex;align-items:center;gap:6px;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--bd2);background:var(--s2);color:var(--tx);font-family:var(--fn);transition:all .2s}
.rep-btn:hover{background:var(--blb);border-color:var(--bl);color:var(--bl);transform:translateY(-1px)}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:999;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(8px);overflow-y:auto}
.modal-overlay.open{display:flex}
.modal-box{background:var(--s1);border:1px solid var(--bd2);border-radius:20px;padding:24px;width:100%;max-width:600px;margin:auto;box-shadow:0 24px 80px rgba(0,0,0,.7);animation:pop .25s ease}
@keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.btn-export{flex:1;padding:13px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-weight:700;border:none;border-radius:12px;font-size:15px;cursor:pointer;font-family:var(--fn);transition:all .2s}
.btn-export:hover{opacity:.9}
.btn-close{padding:13px 22px;background:var(--s2);color:var(--tx2);font-weight:600;border:1px solid var(--bd2);border-radius:12px;font-size:14px;cursor:pointer;font-family:var(--fn)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:#1e1e1e;border:1px solid var(--bd2);border-radius:12px;padding:11px 18px;font-size:13px;font-weight:500;z-index:9999;transition:transform .35s cubic-bezier(.175,.885,.32,1.275);white-space:nowrap}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast.success{border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.1);color:var(--gr)}
.toast.error{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:var(--rd)}
#proc-split{max-height:220px;overflow-y:auto;padding-right:4px}
@media(max-width:700px){.stat-row{grid-template-columns:1fr 1fr}.dash-row{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="topbar">
  <div class="tb-brand">
    <div class="tb-logo">&#129525;</div>
    <div><div class="tb-name">AbaYa Track</div><div class="tb-sub">CEO Dashboard &mdash; Global View</div></div>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <div style="font-size:11px;color:var(--tx3)" id="sync-status">Syncing...</div>
    <div class="live-badge"><div class="live-dot"></div>LIVE</div>
  </div>
</div>

<div class="dash">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:4px">
    <div class="dh">Production Overview</div>
    <div style="font-size:11px;color:var(--tx3)">&#128274; Secure CEO View &mdash; Cloudflare Global Network</div>
  </div>
  <div class="ds" id="dash-date">Loading...</div>

  <div class="rep-panel">
    <div style="font-size:15px;font-weight:700;color:var(--bl);display:flex;align-items:center;gap:8px">&#128274; Executive Reports</div>
    <div style="font-size:11px;color:var(--tx2);margin-top:4px">View report, then export to WhatsApp in one tap</div>
    <div class="rep-btns">
      <button class="rep-btn" onclick="openReport('daily')">&#128467; Daily Report</button>
      <button class="rep-btn" onclick="openReport('weekly')">&#128196; Weekly Report</button>
      <button class="rep-btn" onclick="openReport('monthly')">&#128202; Monthly Report</button>
    </div>
  </div>

  <div class="stat-row">
    <div class="stat-card"><div class="stat-lbl">Completed Today</div><div class="stat-val" id="kpi-done" style="color:var(--gr)">—</div><div class="stat-sub">units finished</div></div>
    <div class="stat-card"><div class="stat-lbl">Active Workers</div><div class="stat-val" id="kpi-active" style="color:var(--bl)">—</div><div class="stat-sub">on floor now</div></div>
    <div class="stat-card"><div class="stat-lbl">Avg Cycle Time</div><div class="stat-val" id="kpi-avg" style="color:var(--am)">—</div><div class="stat-sub">per unit</div></div>
    <div class="stat-card"><div class="stat-lbl">Efficiency Score</div><div class="stat-val" id="kpi-eff">—</div><div class="stat-sub">vs 45-min target</div></div>
  </div>

  <div class="dash-row">
    <div class="dash-card">
      <div class="dct">&#9201; Live Active Sessions</div>
      <div id="live-sessions"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No active sessions</div></div>
    </div>
    <div class="dash-card">
      <div class="dct">Process Split Today</div>
      <div id="proc-split"><div style="color:var(--tx3);font-size:12px;padding:10px">No data</div></div>
    </div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="dct" style="margin:0">Employee Performance — Today</div>
      <div style="font-size:10px;color:var(--tx3)">&#11088; top 20%</div>
    </div>
    <div id="emp-perf"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No sessions yet today</div></div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div class="dct">Invoice maker — numbers logged</div>
    <div style="font-size:11px;color:var(--tx2);margin-bottom:10px">From last 100 completed sessions synced to D1</div>
    <div id="recent-invoice-logs"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">Loading...</div></div>
  </div>

  <div class="dash-card">
    <div class="dct">Hourly output (9–23, factory shift window)</div>
    <div style="font-size:10px;color:var(--tx2);line-height:1.35;margin-bottom:8px">Sat–Thu: 9:00–13:30, 15:00–20:00, 20:40–23:30. Fri: 15:00–20:00, 20:40–23:30.</div>
    <div id="hourly" style="display:flex;align-items:flex-end;gap:2px;height:72px;margin-top:2px"></div>
    <div id="hlbl" style="display:flex;gap:3px;margin-top:4px"></div>
  </div>
</div>

<!-- REPORT MODAL -->
<div class="modal-overlay" id="modal">
  <div class="modal-box">
    <div style="font-size:19px;font-weight:700;margin-bottom:4px" id="modal-title">Report</div>
    <div style="font-size:12px;color:var(--tx2);margin-bottom:16px" id="modal-ts"></div>
    <div id="modal-body"></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn-export" onclick="exportWA()">&#128241; Send via WhatsApp</button>
      <button class="btn-close" onclick="closeModal()">Close</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const TOKEN = '${token}';
const BASE = '${apiBase}';
const WORK_TYPES_ORDER = ['Tailor (01)','Tailor (02)','Hand Work','Stone Work','Button','Embroidery','Ari Work','Hand Designing','Invoice maker','Packaging','Checker'];
function procColorUI(p) {
  const c = {
    'Tailor (01)':'var(--bl)','Tailor (02)':'#6366f1','Hand Work':'var(--gr)','Stone Work':'var(--am)',
    'Button':'#ec4899','Embroidery':'var(--pu)','Ari Work':'#14b8a6','Hand Designing':'#f97316',
    'Invoice maker':'#eab308','Packaging':'#84cc16','Checker':'#0ea5e9'
  };
  return c[p] || 'var(--tx2)';
}
let STATE = {
  active:{}, logs:[], perf:[], daily:[],
  factory_today:'', completed_today:0, avg_cycle_sec_today:0, efficiency_today:0,
  process_split_today:{},
  hourly_today:{}
};
let activeReportType = 'daily';
let lastReportData = null;

// ─── POLLING ──────────────────────────────────────────────────────────────────
async function poll() {
  try {
    const r = await fetch(BASE + '/api/state?token=' + TOKEN);
    if (r.status === 200) {
      STATE = await r.json();
      renderAll();
      document.getElementById('sync-status').textContent = 'Updated ' + new Date().toLocaleTimeString();
    } else {
      document.getElementById('sync-status').textContent = 'Auth error';
    }
  } catch(e) {
    document.getElementById('sync-status').textContent = 'Offline \u2014 retrying...';
  }
}

function fmtHMS(sec) {
  if (!sec || sec < 1) return '0s';
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  if (h > 0) return h+'h '+m+'m '+s+'s';
  if (m > 0) return m+'m '+s+'s';
  return s+'s';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRecentInvoiceLogs() {
  const el = document.getElementById('recent-invoice-logs');
  if (!el) return;
  const logs = STATE.logs || [];
  const rows = logs.filter(function (l) {
    return (l.emp_process || '') === 'Invoice maker' && l.invoice_serial;
  }).slice(0, 25);
  if (!rows.length) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">No invoice-maker rows in the last 100 ledger entries.</div>';
    return;
  }
  let html = '<div style="max-height:260px;overflow-y:auto">';
  rows.forEach(function (l) {
    const endMs = l.ended_at != null ? Number(l.ended_at) : 0;
    const t = new Date(endMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nums = esc(String(l.invoice_serial || '')).replace(/,/g, ', ');
    html +=
      '<div style="display:grid;grid-template-columns:48px 1fr 36px;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd);font-size:11px;align-items:start">' +
      '<span style="color:var(--tx3)">' +
      t +
      '</span>' +
      '<span style="word-break:break-word;font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;color:var(--tx2)">' +
      nums +
      '</span>' +
      '<span style="text-align:right;font-weight:700;color:var(--am)">' +
      (l.invoice_count != null ? esc(String(l.invoice_count)) : '') +
      '</span></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function renderAll() {
  const active = STATE.active || {};
  const perf = STATE.perf || [];
  const activeIds = Object.keys(active);

  const completed = Number(STATE.completed_today) || 0;
  document.getElementById('kpi-done').textContent = completed;
  document.getElementById('kpi-active').textContent = activeIds.length;
  if (completed > 0) {
    document.getElementById('kpi-avg').textContent = fmtHMS(STATE.avg_cycle_sec_today || 0);
    const eff = Number(STATE.efficiency_today) || 0;
    document.getElementById('kpi-eff').textContent = eff + '%';
    document.getElementById('kpi-eff').style.color = eff >= 80 ? 'var(--gr)' : eff >= 60 ? 'var(--am)' : 'var(--rd)';
  } else {
    document.getElementById('kpi-avg').textContent = '\u2014';
    document.getElementById('kpi-eff').textContent = '\u2014';
    document.getElementById('kpi-eff').style.color = '';
  }

  const ft = STATE.factory_today || '';
  document.getElementById('dash-date').textContent =
    (ft ? 'Factory day ' + ft + ' \u2014 ' : '') + new Date().toLocaleTimeString();

  // Live sessions
  const el = document.getElementById('live-sessions');
  if (activeIds.length === 0) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No active sessions right now</div>';
  } else {
    el.innerHTML = activeIds.map(id => {
      const s = active[id];
      const elapsed = Math.floor((Date.now() - s.started_at) / 1000);
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)">' +
        '<div class="emp-av" style="background:'+s.emp_color+'">'+s.emp_initials+'</div>' +
        '<div style="flex:1"><div style="font-size:13px;font-weight:600">'+s.emp_name+'</div>' +
        '<div style="font-size:11px;color:var(--tx3)">'+s.emp_code+' &middot; '+s.emp_process+' &middot; '+(s.abaya_code||'\u2014')+'</div></div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--gr)">'+fmtHMS(elapsed)+'</div></div>';
    }).join('');
  }

  // Emp perf bars
  const sorted = perf.slice().sort((a,b)=>b.units-a.units);
  const maxU = sorted.length ? sorted[0].units : 1;
  const topN = Math.max(1, Math.ceil(sorted.length*0.2));
  document.getElementById('emp-perf').innerHTML = sorted.length === 0
    ? '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No sessions yet</div>'
    : sorted.map((p,i)=>{
      const w = Math.max(2,Math.round((p.units/maxU)*100));
      return '<div class="emp-row">' +
        '<div class="emp-av" style="background:'+(p.color||'#666')+'">'+p.initials+'</div>' +
        '<div style="width:120px;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(i<topN?'\u2B50 ':'')+p.name+'<div style="font-size:10px;color:var(--tx3)">'+p.process+'</div></div>' +
        '<div class="bar-wrap"><div class="bar-fill" style="width:'+w+'%;background:'+(p.color||'#3b82f6')+'88"></div></div>' +
        '<div style="width:32px;text-align:right;font-size:13px;font-weight:700">'+p.units+'</div>' +
        '<div style="width:38px;text-align:right;font-size:11px;color:var(--tx2)">'+p.eff+'%</div></div>';
    }).join('');

  const split = STATE.process_split_today || {};
  const total = WORK_TYPES_ORDER.reduce(function(s,t){ return s + (Number(split[t])||0); }, 0) || 1;
  document.getElementById('proc-split').innerHTML = WORK_TYPES_ORDER.map(function(p){
    var v = Number(split[p])||0;
    var pct = Math.round((v/total)*100);
    var col = procColorUI(p);
    return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="font-weight:600">'+p+'</span><span style="color:'+col+';font-weight:700">'+v+' units ('+pct+'%)</span></div>' +
      '<div style="height:5px;background:var(--s3);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:3px;transition:width .5s"></div></div></div>';
  }).join('');

  const hours = {};
  for (let h = ${FACTORY_HOURLY_START}; h <= ${FACTORY_HOURLY_END}; h++) {
    hours[h] = (STATE.hourly_today && STATE.hourly_today[h] != null) ? STATE.hourly_today[h] : 0;
  }
  const hVals = Object.values(hours);
  const hMax = Math.max(...hVals,1);
  document.getElementById('hourly').innerHTML = Object.entries(hours).map(([h,v])=>{
    const ht = Math.max(4, Math.round((v/hMax)*68));
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">' +
      '<div style="font-size:9px;color:var(--tx3)">'+(v||'')+'</div>' +
      '<div style="width:100%;height:'+ht+'px;background:linear-gradient(180deg,var(--bl),var(--pu));border-radius:3px 3px 0 0;opacity:'+(v?1:0.12)+'"></div></div>';
  }).join('');
  document.getElementById('hlbl').innerHTML = Object.keys(hours).map(h=>'<div style="flex:1;font-size:8px;color:var(--tx3);text-align:center">'+h+'</div>').join('');

  renderRecentInvoiceLogs();
}

// ─── REPORT MODAL ─────────────────────────────────────────────────────────────
async function openReport(type) {
  activeReportType = type;
  document.getElementById('modal-title').textContent = type.charAt(0).toUpperCase()+type.slice(1)+' Report';
  document.getElementById('modal-ts').textContent = 'Fetching data from Cloudflare D1...';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');

  try {
    const r = await fetch(BASE+'/api/report?type='+type+'&token='+TOKEN);
    const data = await r.json();
    lastReportData = data;
    document.getElementById('modal-ts').textContent = 'Generated: '+new Date().toLocaleString()+' \u2014 via Cloudflare D1';

    const s = data.summary || {};
    let html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
      card('&#129532; Units', s.total_units||0, 'var(--gr)') +
      card('&#9202; Avg Cycle', fmtHMS(s.avg_sec), 'var(--am)') +
      card('&#128101; Workers', s.unique_workers||0, 'var(--bl)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">By work type</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;font-size:11px">' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">T01: <b>'+(s.tailor_01||0)+'</b> &middot; T02: <b>'+(s.tailor_02||0)+'</b><br>Hand: <b>'+(s.hand_work||0)+'</b> &middot; Stone: <b>'+(s.stone_work||0)+'</b></div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">Btn: <b>'+(s.button||0)+'</b> &middot; Emb: <b>'+(s.embroidery||0)+'</b><br>Ari: <b>'+(s.ari_work||0)+'</b> &middot; H.Des: <b>'+(s.hand_designing||0)+'</b></div>' +
      '<div style="grid-column:1/-1;background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">Inv: <b>'+(s.invoice_maker||0)+'</b> &middot; Pack: <b>'+(s.packaging||0)+'</b> &middot; Chk: <b>'+(s.checker||0)+'</b></div></div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden">' +
      '<div style="display:grid;grid-template-columns:1fr 60px 80px;gap:8px;padding:9px 12px;font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--bd)">' +
      '<span>Employee</span><span style="text-align:right">Units</span><span style="text-align:right">Avg Time</span></div>' +
      '<div style="max-height:220px;overflow-y:auto">';

    (data.by_employee||[]).forEach(e => {
      html += '<div style="display:grid;grid-template-columns:1fr 60px 80px;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.03);font-size:12px">' +
        '<span style="font-weight:600">'+e.emp_name+'<span style="color:var(--tx3);font-weight:400"> &middot; '+e.emp_process+'</span></span>' +
        '<span style="text-align:right;font-weight:700">'+e.units+'</span>' +
        '<span style="text-align:right;color:var(--gr);font-weight:700">'+fmtHMS(e.avg_sec)+'</span></div>';
    });
    if (!data.by_employee||!data.by_employee.length) {
      html += '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:12px">No data for this period</div>';
    }
    html += '</div></div>';

    const invRows = data.invoice_maker_sessions || [];
    html += '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:18px 0 8px">Invoice maker \u2014 numbers logged</div>';
    if (!invRows.length) {
      html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;padding:14px;font-size:12px;color:var(--tx3)">No invoice-maker sessions with saved invoice numbers in this period.</div>';
    } else {
      html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;max-height:320px;overflow-y:auto">' +
        '<div style="display:grid;grid-template-columns:48px minmax(0,1fr) 36px minmax(0,1.2fr);gap:6px;padding:8px 10px;font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--bd);align-items:center">' +
        '<span>Time</span><span>Employee</span><span style="text-align:right">#</span><span>Invoice numbers</span></div>';
      invRows.forEach(function (row) {
        const t = new Date((Number(row.ended_at) || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const nums = esc(String(row.invoice_serial || '')).replace(/,/g, ', ');
        html += '<div style="display:grid;grid-template-columns:48px minmax(0,1fr) 36px minmax(0,1.2fr);gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;align-items:start">' +
          '<span style="color:var(--tx3);white-space:nowrap">' + t + '</span>' +
          '<span style="font-weight:600;min-width:0">' + esc(row.emp_name || '') + '<span style="color:var(--tx3);font-weight:400"> \u00b7 ' + esc(row.abaya_code || '\u2014') + '</span></span>' +
          '<span style="text-align:right;font-weight:700;color:var(--am)">' + (row.invoice_count != null ? esc(String(row.invoice_count)) : '\u2014') + '</span>' +
          '<span style="word-break:break-word;font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;color:var(--tx2);min-width:0">' + nums + '</span></div>';
      });
      html += '</div>';
    }

    document.getElementById('modal-body').innerHTML = html;
  } catch(e) {
    document.getElementById('modal-body').innerHTML = '<div style="color:var(--rd);text-align:center;padding:20px">Failed to load report: '+e.message+'</div>';
  }
}

function card(label, val, color) {
  return '<div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center;border:1px solid var(--bd)">' +
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;margin-bottom:4px">'+label+'</div>' +
    '<div style="font-size:20px;font-weight:800;color:'+color+'">'+val+'</div></div>';
}

function closeModal() { document.getElementById('modal').classList.remove('open'); }

function exportWA() {
  if (!lastReportData) return;
  const s = lastReportData.summary || {};
  let msg = '\uD83D\uDCCA *AbaYa Track \u2014 ' + activeReportType.charAt(0).toUpperCase()+activeReportType.slice(1) + ' Report*\n';
  msg += '_' + new Date().toLocaleString() + '_\n\n';
  msg += '\uD83D\uDC54 *Summary*\n';
  msg += '\u2022 Total Output: *' + (s.total_units||0) + ' units*\n';
  msg += '\u2022 Avg Cycle: *' + fmtHMS(s.avg_sec) + '*\n';
  msg += '\u2022 T01: '+(s.tailor_01||0)+' | T02: '+(s.tailor_02||0)+' | Hand: '+(s.hand_work||0)+' | Stone: '+(s.stone_work||0)+'\n';
  msg += '\u2022 Btn: '+(s.button||0)+' | Emb: '+(s.embroidery||0)+' | Ari: '+(s.ari_work||0)+' | H.Des: '+(s.hand_designing||0)+'\n';
  msg += '\u2022 Inv: '+(s.invoice_maker||0)+' | Pack: '+(s.packaging||0)+' | Chk: '+(s.checker||0)+'\n\n';
  msg += '\uD83C\uDFC6 *Top Performers*\n';
  (lastReportData.by_employee||[]).slice(0,5).forEach((e,i)=>{ msg += (i+1)+'. '+e.emp_name+' \u2014 '+e.units+' units ('+e.emp_process+')\n'; });
  const invs = lastReportData.invoice_maker_sessions || [];
  msg += '\n\uD83E\uDDFE *Invoice maker \u2014 numbers*\n';
  if (!invs.length) {
    msg += '_No rows with saved lists in this period._\n';
  } else {
    invs.slice(0, 12).forEach(function (row, i) {
      const line = String(row.invoice_serial || '').replace(/,/g, ', ');
      const short = line.length > 100 ? line.slice(0, 100) + '\u2026' : line;
      msg +=
        (i + 1) +
        '. ' +
        row.emp_name +
        ' \u2014 count ' +
        (row.invoice_count != null ? row.invoice_count : '?') +
        ': ' +
        short +
        '\n';
    });
    if (invs.length > 12) msg += '_+' + (invs.length - 12) + ' more in dashboard report._\n';
  }
  msg += '\n\u2705 _AbaYa Track \u2014 Powered by Cloudflare_';
  window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank');
  closeModal();
}

function showToast(msg,type) {
  const t=document.getElementById('toast');
  t.className='toast '+(type||'info')+' show';
  t.textContent=msg;
  clearTimeout(t._t);
  t._t=setTimeout(()=>t.classList.remove('show'),3500);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
poll();
setInterval(poll, 5000); // Poll every 5 seconds for real-time updates
setInterval(() => {
  // Refresh live session timers every second (client-side)
  const active = STATE.active || {};
  const el = document.getElementById('live-sessions');
  if (Object.keys(active).length > 0) {
    el.querySelectorAll('[data-elapsed]') || [];
    // Re-render active sessions only (lightweight)
    const activeIds = Object.keys(active);
    let html = '';
    activeIds.forEach(id => {
      const s = active[id];
      const elapsed = Math.floor((Date.now() - s.started_at) / 1000);
      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)">' +
        '<div class="emp-av" style="background:'+s.emp_color+'">'+s.emp_initials+'</div>' +
        '<div style="flex:1"><div style="font-size:13px;font-weight:600">'+s.emp_name+'</div>' +
        '<div style="font-size:11px;color:var(--tx3)">'+s.emp_code+' &middot; '+s.emp_process+' &middot; '+(s.abaya_code||'\u2014')+'</div></div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--gr)">'+fmtHMS(elapsed)+'</div></div>';
    });
    el.innerHTML = html;
  }
  const d=document.getElementById('dash-date');
  const ft = STATE.factory_today || '';
  if(d) d.textContent=(ft?'Factory day '+ft+' \u2014 ':'')+new Date().toLocaleTimeString();
}, 1000);
</script>
</body>
</html>`;
}
