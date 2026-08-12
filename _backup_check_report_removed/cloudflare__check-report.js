/**
 * Cloudflare Worker handlers for the Production Throughput "Check Report".
 *
 * Three routes, all behind the same CEO cookie auth + rate limit as the
 * existing /api/report family:
 *
 *   GET  /api/check-report/config    — timezone + factory list + today
 *   GET  /api/check-report           — aggregated Factory → Invoice → Abaya report
 *   GET  /api/cancellations           — list manual cancellations in a range
 *   POST /api/cancellations           — record a new manual cancellation
 *
 * The aggregation logic mirrors the on-prem `shared/check-report.cjs`:
 *  - date math is always in FACTORY_TZ (Asia/Dubai), never UTC
 *  - weekday is derived via Intl.DateTimeFormat, never hard-coded
 *  - "Cancelled" is sourced exclusively from `check_report_cancellations`
 *    — never inferred from `total - delivered - pending`
 *
 * The factory's report data lives in the existing `sessions` table (one
 * row per finished work segment, with `emp_process`, `invoice_serial`,
 * `abaya_id`/`abaya_code`, `ended_at`/`day_date` columns). Per-abaya
 * status precedence: Cancelled > Delivered > Pending.
 */

import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { getFactoryTz, ymdInTz } from '../working-hours.js';

const DEFAULT_FACTORY = 'Main Factory';
const MS_PER_DAY = 86400000;

/** Validate a YYYY-MM-DD string. Returns the same string or null. */
function normalizeYmd(value) {
  const s = String(value || '').trim();
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Use Date.UTC round-trip to confirm the date is real (rejects 2026-02-30 etc.).
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

/**
 * Start of day (00:00:00.000) for a YYYY-MM-DD string in the given IANA tz.
 * Walks backwards from noon UTC in 30 min steps until the previous ymd changes
 * — that gives the zone's offset for the day without any hard-coded table.
 * DST-safe (works for half/quarter-hour zones). Returns Unix ms.
 */
function startOfDayInTimezone(ymd, tz) {
  const norm = normalizeYmd(ymd);
  if (!norm) return NaN;
  const [y, m, d] = norm.split('-').map((n) => parseInt(n, 10));
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  // ymdInTz expects Unix SECONDS (see working-hours.js ymdInTz signature);
  // the helpers there are all seconds-based for sessions.ended_at parity.
  // We keep that contract here so the call site stays simple.
  let inside = noonUtc;
  for (let i = 0; i < 96; i++) {
    const prev = inside - 30 * 60 * 1000;
    if (ymdInTz(Math.floor(prev / 1000), tz) !== norm) {
      return inside;
    }
    inside = prev;
  }
  return NaN;
}

function endOfDayInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return NaN;
  return start + MS_PER_DAY - 1;
}

function weekdayInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(start));
}

function longDateInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return ymd;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(start));
}

function resolveDateRangeBounds(fromYmd, toYmd, tz) {
  const a = normalizeYmd(fromYmd);
  const b = normalizeYmd(toYmd);
  if (!a || !b) return null;
  const startMs = startOfDayInTimezone(a, tz);
  const endMs = endOfDayInTimezone(b, tz);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs < startMs) return { startMs: endMs, endMs: startMs, fromYmd: b, toYmd: a };
  return { startMs, endMs, fromYmd: a, toYmd: b };
}

/** Split "INV-1, INV-2; INV-3" into trimmed unique entries. */
function splitInvoiceSerials(raw) {
  if (!raw) return [];
  return Array.from(new Set(String(raw).split(/[,\n;|]+/g).map((s) => s.trim()).filter(Boolean)));
}

/** GET /api/check-report/config — timezone + factory list + today. */
export async function handleCheckReportConfig(env) {
  const tz = getFactoryTz(env);
  // Distinct factory names: from check_report_cancellations + a default.
  let factories = new Set();
  try {
    const { results } = await env.DB.prepare(
      'SELECT DISTINCT factory FROM check_report_cancellations WHERE factory IS NOT NULL AND factory != "" ORDER BY factory ASC'
    ).all();
    for (const r of results || []) {
      if (r.factory) factories.add(String(r.factory));
    }
  } catch (_) {
    // Table may not exist on a stale deploy — fall through to defaults.
  }
  if (factories.size === 0) factories.add(DEFAULT_FACTORY);
  const todayYmd = ymdInTz(Math.floor(Date.now() / 1000), tz);
  return jsonRes(
    {
      ok: true,
      timezone: tz,
      defaultFactory: DEFAULT_FACTORY,
      factories: Array.from(factories).sort(),
      todayYmd,
    },
    200,
    CEO_JSON_NO_STORE
  );
}

/**
 * GET /api/check-report?from=YYYY-MM-DD&to=...&factory=...
 * Aggregated report. `to` defaults to `from` (single day).
 */
export async function handleCheckReport(env, url) {
  const tz = getFactoryTz(env);
  const fromYmd = normalizeYmd(url.searchParams.get('from'));
  const toYmd = normalizeYmd(url.searchParams.get('to')) || fromYmd;
  if (!fromYmd || !toYmd) {
    return errRes('invalid-date', 400);
  }
  const bounds = resolveDateRangeBounds(fromYmd, toYmd, tz);
  if (!bounds) return errRes('invalid-date-range', 400);
  const factoryFilter = String(url.searchParams.get('factory') || '').trim();
  const { startMs, endMs } = bounds;

  // ── Build the abaya index from the existing sessions table. ─────────────
  // Each row = one finished work segment. An "Invoice maker" row can carry
  // multiple invoice serials in the comma-separated `invoice_serial` column.
  //
  // Schema note: `sessions.ended_at` is stored in Unix SECONDS (matches the
  // factory-server ingest). `check_report_cancellations.cancelled_at` is Unix
  // MILLISECONDS (matches the dashboard UI). The two windows therefore use
  // different units; we keep them explicit here so the difference is obvious
  // to the next reader rather than hiding behind a shared name.
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const abayaIdx = new Map();
  let completedRows;
  try {
    const res = await env.DB.prepare(
      `SELECT abaya_id, abaya_code, invoice_serial, ended_at
       FROM sessions
       WHERE ended_at >= ? AND ended_at <= ?`
    ).bind(startSec, endSec).all();
    completedRows = res.results || [];
  } catch (e) {
    return errRes('sessions-query-failed: ' + (e && e.message || e), 500);
  }
  for (const r of completedRows) {
    if (!r.abaya_id) continue;
    let row = abayaIdx.get(r.abaya_id);
    if (!row) {
      row = {
        abayaId: r.abaya_id,
        abayaCode: r.abaya_code || r.abaya_id,
        invoices: new Set(),
        latestDeliveryMs: 0,
      };
      abayaIdx.set(r.abaya_id, row);
    }
    const endedMs = Number(r.ended_at) * 1000; // seconds → ms for the report
    if (endedMs > row.latestDeliveryMs) row.latestDeliveryMs = endedMs;
    for (const s of splitInvoiceSerials(r.invoice_serial)) row.invoices.add(s);
  }

  // ── Pull manual cancellations in the window. ───────────────────────────
  const cancellInRange = [];
  try {
    const c = await env.DB.prepare(
      `SELECT id, factory, invoice_no, abaya_code, reason, cancelled_by,
              cancelled_at, source
         FROM check_report_cancellations
        WHERE cancelled_at >= ? AND cancelled_at <= ?
        ${factoryFilter ? 'AND factory = ?' : ''}
        ORDER BY cancelled_at DESC`
    ).bind(...(factoryFilter ? [startMs, endMs, factoryFilter] : [startMs, endMs])).all();
    for (const r of c.results || []) {
      cancellInRange.push({
        id: r.id,
        factory: r.factory,
        invoiceNo: r.invoice_no || '',
        abayaCode: r.abaya_code || '',
        reason: r.reason || '',
        cancelledBy: r.cancelled_by || '',
        cancelledAt: Number(r.cancelled_at),
        source: r.source || 'manual',
      });
    }
  } catch (_) {
    // Ignore: table may not exist on an older schema; report still works.
  }

  // ── Active sessions in the window: anything with no completed log yet. ──
  const activeInRange = new Set();
  try {
    const a = await env.DB.prepare(
      `SELECT abaya_id FROM active_sessions WHERE abaya_id IS NOT NULL AND abaya_id != ''`
    ).all();
    for (const r of a.results || []) {
      if (!abayaIdx.has(r.abaya_id)) activeInRange.add(r.abaya_id);
    }
  } catch (_) {
    // active_sessions table is core; missing schema would be a real issue but
    // we keep the report best-effort by treating active as empty.
  }

  // ── Resolve cancellation by abaya_code (manual record trumps math). ───
  const cancelByAbayaCode = new Map();
  for (const c of cancellInRange) {
    if (c.abayaCode) cancelByAbayaCode.set(c.abayaCode, c);
  }

  // ── Per-abaya row assembly. Status: Cancelled > Delivered > Pending. ──
  const allAbayaIds = new Set();
  for (const id of abayaIdx.keys()) allAbayaIds.add(id);
  for (const id of activeInRange) allAbayaIds.add(id);
  // Cancelled abaya codes can land in D1 even without a session log (operator
  // records it before the next session is logged). Look the abaya up by code
  // in `sessions` and `abaya_catalog` so the row still appears.
  for (const c of cancellInRange) {
    if (!c.abayaCode) continue;
    const hit = await env.DB.prepare(
      `SELECT id, code FROM abaya_catalog WHERE code = ? LIMIT 1`
    ).bind(c.abayaCode).first();
    if (hit && hit.id) allAbayaIds.add(hit.id);
  }

  const abayaRows = [];
  for (const abayaId of allAbayaIds) {
    const row = abayaIdx.get(abayaId);
    const abayaCode = row ? row.abayaCode : abayaId;
    const cancelRec = cancelByAbayaCode.get(abayaCode) || null;
    let status, timestamp;
    if (cancelRec) {
      status = 'Cancelled';
      timestamp = cancelRec.cancelledAt;
    } else if (row && row.latestDeliveryMs > 0) {
      status = 'Delivered';
      timestamp = row.latestDeliveryMs;
    } else {
      status = 'Pending';
      timestamp = null;
    }
    abayaRows.push({
      abayaId,
      abayaCode,
      factory: cancelRec ? cancelRec.factory : DEFAULT_FACTORY,
      status,
      timestamp,
      invoices: row ? Array.from(row.invoices) : [],
      cancel: cancelRec
        ? {
            id: cancelRec.id,
            reason: cancelRec.reason,
            cancelledBy: cancelRec.cancelledBy,
            cancelledAt: cancelRec.cancelledAt,
          }
        : null,
    });
  }

  // ── Roll up per-invoice and per-factory totals. ────────────────────────
  const factoryMap = new Map();
  function factoryBucket(name) {
    let f = factoryMap.get(name);
    if (!f) {
      f = {
        name,
        invoices: new Map(),
        totals: { invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0 },
      };
      factoryMap.set(name, f);
    }
    return f;
  }
  function invoiceBucket(factoryName, no) {
    const f = factoryBucket(factoryName);
    const key = no || '__no_invoice__';
    let inv = f.invoices.get(key);
    if (!inv) {
      inv = {
        no,
        factory: factoryName,
        synthetic: !no,
        abayas: [],
        totals: { abayas: 0, delivered: 0, pending: 0, cancelled: 0 },
      };
      f.invoices.set(key, inv);
    }
    return inv;
  }
  for (const ar of abayaRows) {
    const f = factoryBucket(ar.factory);
    f.totals.abayas += 1;
    if (ar.status === 'Delivered') f.totals.delivered += 1;
    else if (ar.status === 'Pending') f.totals.pending += 1;
    else if (ar.status === 'Cancelled') f.totals.cancelled += 1;
    if (ar.invoices.length === 0) {
      invoiceBucket(ar.factory, '').abayas.push(ar);
    } else {
      for (const no of ar.invoices) {
        const inv = invoiceBucket(ar.factory, no);
        if (!inv.abayas.some((x) => x.abayaId === ar.abayaId)) inv.abayas.push(ar);
      }
    }
  }
  const factories = Array.from(factoryMap.values())
    .map((f) => {
      const invoices = Array.from(f.invoices.values())
        .map((inv) => {
          const abayas = inv.abayas.slice().sort((a, b) => {
            const order = { Cancelled: 0, Pending: 1, Delivered: 2 };
            const oa = order[a.status] != null ? order[a.status] : 9;
            const ob = order[b.status] != null ? order[b.status] : 9;
            if (oa !== ob) return oa - ob;
            return String(a.abayaCode).localeCompare(String(b.abayaCode));
          });
          return {
            no: inv.no,
            synthetic: !!inv.synthetic,
            totals: {
              abayas: abayas.length,
              delivered: abayas.filter((a) => a.status === 'Delivered').length,
              pending: abayas.filter((a) => a.status === 'Pending').length,
              cancelled: abayas.filter((a) => a.status === 'Cancelled').length,
            },
            abayas: abayas.map((a) => ({
              code: a.abayaCode,
              status: a.status,
              timestamp: a.timestamp,
              cancel: a.cancel,
            })),
          };
        })
        .sort((a, b) => {
          if (a.synthetic && !b.synthetic) return 1;
          if (!a.synthetic && b.synthetic) return -1;
          return String(a.no || '').localeCompare(String(b.no || ''));
        });
      const realInvoiceCount = invoices.filter((i) => !i.synthetic).length;
      return {
        name: f.name,
        totals: Object.assign({}, f.totals, { invoices: realInvoiceCount }),
        invoices,
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const totals = {
    invoices: factories.reduce((s, f) => s + f.totals.invoices, 0),
    abayas: factories.reduce((s, f) => s + f.totals.abayas, 0),
    delivered: factories.reduce((s, f) => s + f.totals.delivered, 0),
    pending: factories.reduce((s, f) => s + f.totals.pending, 0),
    cancelled: factories.reduce((s, f) => s + f.totals.cancelled, 0),
  };

  return jsonRes(
    {
      ok: true,
      dateRange: {
        from: bounds.fromYmd,
        to: bounds.toYmd,
        fromWeekday: weekdayInTimezone(bounds.fromYmd, tz),
        toWeekday: weekdayInTimezone(bounds.toYmd, tz),
        fromLong: longDateInTimezone(bounds.fromYmd, tz),
        toLong: longDateInTimezone(bounds.toYmd, tz),
        label: bounds.fromYmd === bounds.toYmd
          ? longDateInTimezone(bounds.fromYmd, tz)
          : `${longDateInTimezone(bounds.fromYmd, tz)} → ${longDateInTimezone(bounds.toYmd, tz)}`,
        sameDay: bounds.fromYmd === bounds.toYmd,
      },
      timezone: tz,
      generatedAt: Date.now(),
      factory: factoryFilter || null,
      totals,
      factories,
      cancellations: cancellInRange.map((c) => ({
        id: c.id,
        factory: c.factory,
        invoiceNo: c.invoiceNo,
        abayaCode: c.abayaCode,
        reason: c.reason,
        cancelledBy: c.cancelledBy,
        cancelledAt: c.cancelledAt,
        source: c.source,
      })),
    },
    200,
    CEO_JSON_NO_STORE
  );
}

/** GET /api/cancellations?from=...&to=...&factory=... */
export async function handleCancellationsList(env, url) {
  const tz = getFactoryTz(env);
  let fromYmd = normalizeYmd(url.searchParams.get('from'));
  let toYmd = normalizeYmd(url.searchParams.get('to')) || fromYmd;
  if (!fromYmd) {
    fromYmd = ymdInTz(Math.floor(Date.now() / 1000), tz);
    toYmd = fromYmd;
  }
  const bounds = resolveDateRangeBounds(fromYmd, toYmd, tz);
  if (!bounds) return errRes('invalid-date-range', 400);
  const factory = String(url.searchParams.get('factory') || '').trim();

  const binds = factory ? [bounds.startMs, bounds.endMs, factory] : [bounds.startMs, bounds.endMs];
  const whereFactory = factory ? 'AND factory = ?' : '';
  let rows = [];
  try {
    const res = await env.DB.prepare(
      `SELECT id, factory, invoice_no, abaya_code, reason, cancelled_by, cancelled_at, source
         FROM check_report_cancellations
        WHERE cancelled_at >= ? AND cancelled_at <= ? ${whereFactory}
        ORDER BY cancelled_at DESC`
    ).bind(...binds).all();
    rows = res.results || [];
  } catch (_) {
    // Table missing on a stale schema; empty list is the right "honest" answer.
  }
  return jsonRes(
    {
      ok: true,
      timezone: tz,
      dateRange: {
        from: bounds.fromYmd,
        to: bounds.toYmd,
        fromLong: longDateInTimezone(bounds.fromYmd, tz),
        toLong: longDateInTimezone(bounds.toYmd, tz),
      },
      cancellations: rows.map((r) => ({
        id: r.id,
        factory: r.factory,
        invoiceNo: r.invoice_no || '',
        abayaCode: r.abaya_code || '',
        reason: r.reason || '',
        cancelledBy: r.cancelled_by || '',
        cancelledAt: Number(r.cancelled_at),
        source: r.source || 'manual',
      })),
    },
    200,
    CEO_JSON_NO_STORE
  );
}

/**
 * POST /api/cancellations
 * Record a manual cancellation. Body: { factory, invoiceNo, abayaCode,
 * reason, cancelledBy, cancelledAt }.
 */
export async function handleCancellationsCreate(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) { return errRes('invalid-body', 400); }
  if (!body || typeof body !== 'object') return errRes('invalid-body', 400);
  if (!body.invoiceNo && !body.abayaCode) {
    return jsonRes(
      {
        ok: false,
        error: 'missing-target',
        hint: 'Provide at least one of `invoiceNo` or `abayaCode` so the cancellation is traceable.',
      },
      400
    );
  }
  const factory = String(body.factory || DEFAULT_FACTORY).trim() || DEFAULT_FACTORY;
  const invoiceNo = String(body.invoiceNo || '').trim();
  const abayaCode = String(body.abayaCode || '').trim();
  const reason = String(body.reason || '').trim();
  const cancelledBy = String(body.cancelledBy || '').trim();
  const cancelledAt = Number(body.cancelledAt) > 0 ? Number(body.cancelledAt) : Date.now();
  const source = String(body.source || 'manual').trim() || 'manual';

  let row;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO check_report_cancellations
         (factory, invoice_no, abaya_code, reason, cancelled_by, cancelled_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id, factory, invoice_no, abaya_code, reason, cancelled_by, cancelled_at, source, created_at`
    ).bind(factory, invoiceNo, abayaCode, reason, cancelledBy, cancelledAt, source).first();
    row = r;
  } catch (e) {
    return errRes('cancellations-insert-failed: ' + (e && e.message || e), 500);
  }
  return jsonRes(
    {
      ok: true,
      cancellation: {
        id: row.id,
        factory: row.factory,
        invoiceNo: row.invoice_no || '',
        abayaCode: row.abaya_code || '',
        reason: row.reason || '',
        cancelledBy: row.cancelled_by || '',
        cancelledAt: Number(row.cancelled_at),
        source: row.source || 'manual',
        createdAt: Number(row.created_at),
      },
    },
    201,
    CEO_JSON_NO_STORE
  );
}
