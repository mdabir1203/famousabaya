// Check Report handlers for the cloud CEO dashboard.
//
// Three routes:
//   GET  /api/check-report/config          — list of factories + defaults
//   GET  /api/check-report?from=...&to=... — production report for a date range
//   POST /api/cancellations                — record a cancellation
//
// The report is built from three D1 sources:
//   - sessions: completed / invoice-bearing work for the range
//   - cancellations: explicit cancellation records
//   - abaya_catalog: code / barcode mapping (for the per-row display)
//
// "Invoices" are derived from sessions that have invoice_count > 0
// (or invoice_serial set). Each unique invoice_serial becomes one
// invoice bucket; sessions without an invoice_serial are grouped
// under a synthetic "(no invoice)" bucket so they're still counted.
//
// "Delivered" vs "Pending" status per abaya is derived from the
// sessions.invoice_count + invoice_serial — when an invoice_serial
// is set the abaya is treated as Delivered (the factory's invoice
// note confirms it). Sessions without an invoice_serial are Pending
// (waiting for invoice). Cancelled abayas come from the cancellations
// table (matched by abaya_code OR invoice_no).

import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { factoryTodayString, factoryDateStringForUnix } from '../working-hours.js';

const FACTORY_TZ = 'Asia/Dubai';
// Single-factory deployment: the dashboard's "Factory" dropdown is
// cosmetic. We always report against the main factory.
const DEFAULT_FACTORY = 'Main Factory';
const FACTORIES = [DEFAULT_FACTORY];

export async function handleCheckReportConfig(env, url) {
  // factory_today in Asia/Dubai (matches the dashboard's "Production Report" header).
  const today = factoryTodayString(env);
  return jsonRes({
    ok: true,
    factories: FACTORIES,
    defaultFactory: DEFAULT_FACTORY,
    timezone: FACTORY_TZ,
    todayYmd: today,
  }, 200, CEO_JSON_NO_STORE);
}

function safeYmd(s, fallback) {
  const t = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return fallback;
  return t;
}
function todayYmdUtcFallback(env) {
  return factoryTodayString(env);
}
function ymdToRange(ymd) {
  // Asia/Dubai day → [startMs, endMs) in UTC.
  // Use Intl to get the offset, then compute noon UTC as a stable anchor
  // (noon avoids DST edge cases at midnight).
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  // Build a date at 00:00 local Dubai by computing the UTC instant that
  // is 00:00 Dubai on that day. We approximate with 4 hours back from
  // UTC, which is the worst case for Asia/Dubai (UTC+4).
  const startMs = Date.UTC(y, m - 1, d, -4, 0, 0, 0);
  // End of day: 24h later.
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return [startMs, endMs];
}
function ymdToRangeSafe(ymd, env) {
  const fallback = todayYmdUtcFallback(env);
  const ok = safeYmd(ymd, fallback);
  const r = ymdToRange(ok);
  if (!r) return ymdToRangeSafe(fallback, env);
  return { ymd: ok, startMs: r[0], endMs: r[1] };
}

function longFmt(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  const noon = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: FACTORY_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date(noon));
  } catch (_) { return ymd; }
}

export async function handleCheckReport(env, url) {
  const t0 = Date.now();
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const factoryParam = String(url.searchParams.get('factory') || '').trim();
  const factory = factoryParam || DEFAULT_FACTORY;

  const today = todayYmdUtcFallback(env);
  const fromR = ymdToRangeSafe(fromParam, env);
  // If no to, default to same as from.
  const toR = ymdToRangeSafe(toParam || fromParam, env);
  // Clamp to the same-day case when from > to (e.g. user picked one day).
  const fromMs = Math.min(fromR.startMs, toR.startMs);
  const toMs = Math.max(fromR.endMs, toR.endMs);

  try {
    // ---- Pull sessions for the range (bounded so we don't blow memory) ----
    const SESS_LIMIT = 5000;
    const sessStmt = env.DB.prepare(`
      SELECT id, emp_id, emp_name, abaya_id, abaya_code, station,
             started_at, ended_at, duration_sec, emp_process,
             day_date, invoice_count, invoice_serial
      FROM sessions
      WHERE ended_at >= ? AND ended_at < ?
      ORDER BY ended_at ASC
      LIMIT ?
    `).bind(Math.floor(fromMs / 1000), Math.floor(toMs / 1000), SESS_LIMIT);
    const sessRes = await sessStmt.all();
    const sessions = sessRes.results || [];

    // ---- Pull abaya catalog for code/barcode lookup ----
    const catRes = await env.DB.prepare(
      `SELECT id, code, barcode FROM abaya_catalog`
    ).all();
    const codeByBarcode = Object.create(null);
    const codeById = Object.create(null);
    for (const r of (catRes.results || [])) {
      if (r.barcode) codeByBarcode[String(r.barcode)] = r;
      if (r.id) codeById[String(r.id)] = r;
    }

    // ---- Pull cancellations for the range ----
    const cancRes = await env.DB.prepare(`
      SELECT id, factory, invoice_no, abaya_code, cancelled_at, cancelled_by, reason
      FROM cancellations
      WHERE cancelled_at >= ? AND cancelled_at < ?
      ORDER BY cancelled_at ASC
    `).bind(fromMs, toMs).all();
    const cancellations = cancRes.results || [];

    // ---- Build per-invoice buckets ----
    // Bucket key: invoice_serial if present, else a synthetic key per-abaya
    // so each non-invoiced abaya is its own row (not "Pending 1,2,3..." with
    // no traceability).
    const buckets = [];              // { no, abayas: [...], totals: {...} }
    const bucketByNo = new Map();
    function getOrCreateBucket(no, isSynthetic) {
      const key = isSynthetic ? ('__synth__:' + no) : ('inv:' + no);
      let b = bucketByNo.get(key);
      if (!b) {
        b = { no: isSynthetic ? '' : no, synthetic: !!isSynthetic, abayas: [], totals: { abayas: 0, delivered: 0, pending: 0, cancelled: 0 } };
        bucketByNo.set(key, b);
        buckets.push(b);
      }
      return b;
    }
    // Index abaya_code → cancellation (first match) for status tagging.
    const cancByAbayaCode = new Map();
    const cancByInvoiceNo = new Map();
    for (const c of cancellations) {
      if (c.abaya_code) cancByAbayaCode.set(String(c.abaya_code), c);
      if (c.invoice_no) cancByInvoiceNo.set(String(c.invoice_no), c);
    }

    for (const s of sessions) {
      const code = s.abaya_code || s.abaya_id || '(unknown)';
      const serial = s.invoice_serial ? String(s.invoice_serial) : '';
      const b = serial
        ? getOrCreateBucket(serial, false)
        : getOrCreateBucket(s.id, true);
      // Status: cancelled if there's a matching cancellation; delivered
      // if serial present; else pending.
      const canc = cancByAbayaCode.get(String(code)) || (serial ? cancByInvoiceNo.get(serial) : null);
      const status = canc ? 'CANCELLED' : (serial ? 'DELIVERED' : 'PENDING');
      const row = {
        code: code,
        barcode: s.abaya_id && codeById[String(s.abaya_id)] ? codeById[String(s.abaya_id)].barcode : '',
        process: s.emp_process || '',
        timestamp: (s.ended_at || 0) * 1000,
        durationSec: Number(s.duration_sec) || 0,
        emp: s.emp_name || '',
        // Lowercase for the cr-status CSS class on the dashboard.
        status: status.charAt(0) + status.slice(1).toLowerCase(),
        cancellation: canc ? {
          cancelledAt: canc.cancelled_at,
          cancelledBy: canc.cancelled_by || '',
          reason: canc.reason || '',
        } : null,
      };
      b.abayas.push(row);
    }

    // Compute per-bucket + global totals.
    const totals = { invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0 };
    for (const b of buckets) {
      let delivered = 0, pending = 0, cancelled = 0;
      for (const a of b.abayas) {
        if (a.status === 'DELIVERED') delivered++;
        else if (a.status === 'CANCELLED') cancelled++;
        else pending++;
      }
      b.totals.abayas = b.abayas.length;
      b.totals.delivered = delivered;
      b.totals.pending = pending;
      b.totals.cancelled = cancelled;
      totals.abayas += b.abayas.length;
      totals.delivered += delivered;
      totals.pending += pending;
      totals.cancelled += cancelled;
    }
    // "Invoices" = non-synthetic buckets with ≥1 delivered abaya.
    // (We don't double-count synthetic rows.)
    for (const b of buckets) {
      if (!b.synthetic && b.totals.delivered > 0) totals.invoices += 1;
    }

    // ---- Build factory section ----
    const factorySection = {
      name: factory,
      totals: {
        invoices: totals.invoices,
        abayas: totals.abayas,
        delivered: totals.delivered,
        pending: totals.pending,
        cancelled: totals.cancelled,
      },
      invoices: buckets
        // Show synthetic buckets at the bottom, real invoices at top.
        .slice()
        .sort((a, b) => (a.synthetic === b.synthetic ? 0 : (a.synthetic ? 1 : -1)))
        .map((b) => ({
          no: b.no,
          synthetic: b.synthetic,
          totals: b.totals,
          abayas: b.abayas,
        })),
    };

    // ---- Cancellations list (for the Cancellations section) ----
    const cancellationRows = cancellations.map((c) => ({
      id: c.id,
      factory: c.factory || '',
      invoiceNo: c.invoice_no || '',
      abayaCode: c.abaya_code || '',
      cancelledAt: c.cancelled_at,
      cancelledBy: c.cancelled_by || '',
      reason: c.reason || '',
    }));

    const sameDay = fromR.ymd === toR.ymd;
    const label = sameDay
      ? longFmt(fromR.ymd)
      : longFmt(fromR.ymd) + ' \u2192 ' + longFmt(toR.ymd);

    return jsonRes({
      ok: true,
      timezone: FACTORY_TZ,
      factory,
      dateRange: {
        from: fromR.ymd,
        to: toR.ymd,
        sameDay,
        label,
      },
      totals,
      factories: [factorySection],
      cancellations: cancellationRows,
      meta: {
        generatedAt: Date.now(),
        durationMs: Date.now() - t0,
        sessionsScanned: sessions.length,
        cancellationsScanned: cancellations.length,
      },
    }, 200, CEO_JSON_NO_STORE);
  } catch (e) {
    console.error('[check-report] failed:', e && (e.stack || e.message || e));
    return errRes('Could not build report: ' + ((e && e.message) || String(e)), 500);
  }
}

export async function handleCancellationsPost(env, request) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return errRes('Invalid JSON body', 400);
  }
  const factory = String((body && body.factory) || DEFAULT_FACTORY).trim();
  const invoiceNo = String((body && body.invoiceNo) || '').trim();
  const abayaCode = String((body && body.abayaCode) || '').trim();
  const reason = String((body && body.reason) || '').trim();
  const cancelledBy = String((body && body.cancelledBy) || '').trim();
  const cancelledAtMs = Number(body && body.cancelledAt) || Date.now();

  if (!invoiceNo && !abayaCode) {
    return errRes('At least one of invoiceNo or abayaCode is required so the cancellation is traceable.', 400);
  }
  const id = 'cn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  try {
    await env.DB.prepare(`
      INSERT INTO cancellations
        (id, factory, invoice_no, abaya_code, cancelled_at, cancelled_by, reason, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ceo', unixepoch())
    `).bind(
      id,
      factory || DEFAULT_FACTORY,
      invoiceNo,
      abayaCode,
      cancelledAtMs,
      cancelledBy,
      reason,
    ).run();
  } catch (e) {
    console.error('[cancellations] insert failed:', e && (e.message || e));
    return errRes('Could not save cancellation: ' + ((e && e.message) || String(e)), 500);
  }
  return jsonRes({
    ok: true,
    cancellation: {
      id,
      factory: factory || DEFAULT_FACTORY,
      invoiceNo,
      abayaCode,
      cancelledAt: cancelledAtMs,
      cancelledBy,
      reason,
      source: 'ceo',
    },
  }, 201, CEO_JSON_NO_STORE);
}

export async function handleCancellationsList(env, url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const today = todayYmdUtcFallback(env);
  const fromR = ymdToRangeSafe(from || today, env);
  const toR = ymdToRangeSafe(to || from || today, env);
  const fromMs = Math.min(fromR.startMs, toR.startMs);
  const toMs = Math.max(fromR.endMs, toR.endMs);
  try {
    const res = await env.DB.prepare(`
      SELECT id, factory, invoice_no, abaya_code, cancelled_at, cancelled_by, reason, source
      FROM cancellations
      WHERE cancelled_at >= ? AND cancelled_at < ?
      ORDER BY cancelled_at ASC
    `).bind(fromMs, toMs).all();
    const cancellations = (res.results || []).map((c) => ({
      id: c.id,
      factory: c.factory || '',
      invoiceNo: c.invoice_no || '',
      abayaCode: c.abaya_code || '',
      cancelledAt: c.cancelled_at,
      cancelledBy: c.cancelled_by || '',
      reason: c.reason || '',
      source: c.source || 'ceo',
    }));
    return jsonRes({ ok: true, cancellations, timezone: FACTORY_TZ, from: fromR.ymd, to: toR.ymd }, 200, CEO_JSON_NO_STORE);
  } catch (e) {
    return errRes('Could not list cancellations: ' + ((e && e.message) || String(e)), 500);
  }
}
