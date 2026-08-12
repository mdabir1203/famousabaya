// shared/check-report.cjs
//
// Pure aggregation for the Production Throughput "Check Report".
// Extracted from server.js so the test harness can exercise the logic
// without booting the full HTTP server. The server requires this file
// and forwards the in-memory data sources to `aggregateCheckReport`.
//
// The module is intentionally stateless (all live state is passed in)
// so the same code path is unit-testable and runtime-isolable.

'use strict';

// ─── Timezone-aware date helpers ──────────────────────────────────────────────
// The Check Report feature requires date arithmetic in the production
// timezone, NOT the browser's local zone. A factory in Dubai but viewed
// from a tablet set to America/Detroit must still bucket an 11 August
// cancellation into the 11 August production day.

/**
 * YYYY-MM-DD for a given epoch ms in the given IANA timezone.
 * @param {number} ms
 * @param {string} tz
 * @returns {string}
 */
function ymdInTimezone(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = (parts.find((p) => p.type === 'year')  || {}).value || '0000';
  const m = (parts.find((p) => p.type === 'month') || {}).value || '00';
  const d = (parts.find((p) => p.type === 'day')   || {}).value || '00';
  return `${y}-${m}-${d}`;
}

/**
 * Start-of-day (00:00:00.000) for a YYYY-MM-DD string interpreted in tz.
 *
 * Implementation: we know the day exists in the zone (verified via noon-UTC
 * formatToParts). Starting from any instant inside the day, we walk backwards
 * in 30-minute steps until we cross into the previous ymd — the previous
 * step is the zone's start-of-day. This is DST-safe (works for any zone
 * including those with non-hour offsets like Asia/Kolkata) because we never
 * hardcode an offset; we read it implicitly via Intl.DateTimeFormat.
 * @param {string} ymd YYYY-MM-DD
 * @param {string} tz IANA timezone
 * @returns {number} epoch ms at start of that day in tz
 */
function startOfDayInTimezone(ymd, tz) {
  const [y, m, d] = String(ymd).split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return NaN;
  // Pick a moment safely inside the day in tz: noon UTC, then verify the
  // Intl-reported ymd matches (it always does for noon UTC, even across DST).
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  if (ymdInTimezone(noonUtc, 'UTC') !== ymd) return NaN;
  let inside = noonUtc;
  for (let i = 0; i < 96; i++) {
    const prev = inside - 30 * 60 * 1000;
    if (ymdInTimezone(prev, tz) !== ymd) {
      return inside;
    }
    inside = prev;
  }
  return NaN;
}

/**
 * End-of-day (23:59:59.999) for a YYYY-MM-DD string in tz.
 */
function endOfDayInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return NaN;
  return start + 24 * 60 * 60 * 1000 - 1;
}

/**
 * Weekday name (English) for a YYYY-MM-DD in tz. Calculated programmatically —
 * never hard-coded — so a date like 2026-08-11 always resolves to "Tuesday".
 * @returns {string} e.g. "Tuesday"
 */
function weekdayInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(start));
}

/**
 * Long human label for a YYYY-MM-DD in tz, e.g. "Tuesday, 11 August 2026".
 */
function longDateInTimezone(ymd, tz) {
  const start = startOfDayInTimezone(ymd, tz);
  if (!Number.isFinite(start)) return ymd;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(new Date(start));
  const weekday = (parts.find((p) => p.type === 'weekday') || {}).value || '';
  const day     = (parts.find((p) => p.type === 'day')     || {}).value || '';
  const month   = (parts.find((p) => p.type === 'month')   || {}).value || '';
  const year    = (parts.find((p) => p.type === 'year')    || {}).value || '';
  return `${weekday}, ${day} ${month} ${year}`.trim();
}

/**
 * Validate a YYYY-MM-DD string; return it or null.
 */
function normalizeYmd(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Resolve [fromYmd, toYmd] to { startMs, endMs, fromYmd, toYmd } in factory tz,
 * swapping if from > to. Returns null on invalid input.
 */
function resolveDateRangeBounds(fromYmd, toYmd, tz) {
  const a = normalizeYmd(fromYmd);
  const b = normalizeYmd(toYmd);
  if (!a || !b) return null;
  const startMs = startOfDayInTimezone(a, tz);
  const endMs   = endOfDayInTimezone(b,   tz);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs < startMs) {
    return { startMs: endMs, endMs: startMs, fromYmd: b, toYmd: a };
  }
  return { startMs, endMs, fromYmd: a, toYmd: b };
}

/**
 * Split a comma-separated invoice_serial string into trimmed unique entries.
 * Logs sometimes store "INV-001,INV-002" or "INV-001, INV-002" depending on
 * the parser; we normalise both shapes.
 */
function splitInvoiceSerials(raw) {
  if (!raw) return [];
  return Array.from(new Set(
    String(raw)
      .split(/[,\n;|]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
  ));
}

/**
 * Build the Check Report for a given date range, optionally filtered by factory.
 *
 * Traceability hierarchy: Factory → Abaya Invoice → Abaya Code → Status → Date/Time.
 * Status mapping:
 *   - "Delivered": a completed log for the abaya falls within the date range
 *                  (we use the log's end timestamp as the delivery time).
 *   - "Pending":   an active session (employee still on it) touches the abaya,
 *                  OR the abaya has no completed log yet in the window.
 *   - "Cancelled": a manual_cancellations record exists for the abaya in range.
 *
 * We never derive cancelled = total - delivered - pending. Cancellation is
 * sourced exclusively from the `cancellations` array passed in — a real
 * manual record is required to mark an abaya as cancelled.
 *
 * @param {{
 *   fromYmd: string,
 *   toYmd: string,
 *   factory?: string,
 *   timezone?: string,             // IANA tz; defaults to Asia/Dubai
 *   defaultFactory?: string,       // name used when an abaya has no factory
 *   completedLogs?: Array,         // [{ abaya_id, end, invoice_serial, ... }]
 *   activeSessions?: object,       // { [empId]: { abaya_id, started_at, ... } }
 *   cancellations?: Array,         // [{ factory, invoiceNo, abayaCode, cancelledAt, ... }]
 *   abayaCatalog?: Array,          // [{ id, code, factory }]
 * }} opts
 */
function aggregateCheckReport(opts) {
  const {
    fromYmd,
    toYmd,
    factory,
    timezone,
    defaultFactory,
    completedLogs = [],
    activeSessions = {},
    cancellations = [],
    abayaCatalog = [],
  } = opts || {};
  const tz = timezone || 'Asia/Dubai';
  const defFactory = defaultFactory || 'Main Factory';
  const bounds = resolveDateRangeBounds(fromYmd, toYmd, tz);
  if (!bounds) {
    return { ok: false, error: 'invalid-date-range' };
  }
  const { startMs, endMs } = bounds;
  const factoryFilter = factory ? String(factory).trim() : '';

  // ── Helpers scoped to this call ─────────────────────────────────────────
  function abayaCodeFor(abayaId) {
    if (abayaId == null) return '';
    const a = abayaCatalog.find((x) => x && x.id === abayaId);
    return a ? String(a.code || '') : String(abayaId);
  }
  function factoryForAbaya(abayaId) {
    if (abayaId == null) return defFactory;
    const a = abayaCatalog.find((x) => x && x.id === abayaId);
    if (!a) return defFactory;
    return String(a.factory || '').trim() || defFactory;
  }

  // ── Step 1: build an abaya → {factory, invoiceNos[], deliveries[]} index
  //            from completed logs in the window.
  const abayaIdx = new Map();
  for (let i = 0; i < completedLogs.length; i++) {
    const l = completedLogs[i];
    if (!l) continue;
    const end = Number(l.end);
    if (!Number.isFinite(end) || end < startMs || end > endMs) continue;
    const abayaId = l.abaya_id;
    if (abayaId == null) continue;
    const fac = factoryForAbaya(abayaId);
    if (factoryFilter && fac !== factoryFilter) continue;

    let row = abayaIdx.get(abayaId);
    if (!row) {
      row = { factory: fac, invoices: new Set(), deliveries: [], latestDeliveryMs: 0 };
      abayaIdx.set(abayaId, row);
    }
    if (end > row.latestDeliveryMs) row.latestDeliveryMs = end;
    row.deliveries.push(end);
    for (const s of splitInvoiceSerials(l.invoice_serial)) {
      row.invoices.add(s);
    }
  }

  // ── Step 2: filter cancellations to the window + factory
  const cancellInRange = cancellations
    .filter((c) => c && Number(c.cancelledAt) >= startMs && Number(c.cancelledAt) <= endMs)
    .filter((c) => !factoryFilter || String(c.factory) === factoryFilter);

  const cancelByAbayaCode = new Map();
  for (const c of cancellInRange) {
    const code = String(c.abayaCode || '').trim();
    if (code) cancelByAbayaCode.set(code, c);
  }

  // ── Step 3: pending state from active sessions
  const pendingAbayaIds = new Set();
  for (const empId of Object.keys(activeSessions || {})) {
    const sess = activeSessions[empId];
    if (!sess) continue;
    if (factoryFilter && factoryForAbaya(sess.abaya_id) !== factoryFilter) continue;
    if (!abayaIdx.has(sess.abaya_id)) pendingAbayaIds.add(sess.abaya_id);
  }

  // ── Step 4: assemble per-abaya rows
  const allAbayaIds = new Set();
  for (const id of abayaIdx.keys()) allAbayaIds.add(id);
  for (const id of pendingAbayaIds) allAbayaIds.add(id);
  for (const c of cancellInRange) {
    const code = String(c.abayaCode || '').trim();
    if (!code) continue;
    const a = abayaCatalog.find((x) => String(x.code || '') === code);
    if (a) allAbayaIds.add(a.id);
  }

  // Per-abaya status: precedence Cancelled > Delivered > Pending.
  // We never assign Cancelled unless a manual record exists.
  const abayaRows = [];
  for (const abayaId of allAbayaIds) {
    const code = abayaCodeFor(abayaId) || abayaId;
    const fac  = factoryForAbaya(abayaId);
    if (factoryFilter && fac !== factoryFilter) continue;
    const row = abayaIdx.get(abayaId) || { factory: fac, invoices: new Set(), deliveries: [], latestDeliveryMs: 0 };
    const cancelRec = cancelByAbayaCode.get(code) || null;

    let status, timestamp;
    if (cancelRec) {
      status = 'Cancelled';
      timestamp = cancelRec.cancelledAt;
    } else if (row.latestDeliveryMs > 0) {
      status = 'Delivered';
      timestamp = row.latestDeliveryMs;
    } else {
      status = 'Pending';
      timestamp = null;
    }

    abayaRows.push({
      id: abayaId,
      code,
      factory: fac,
      status,
      timestamp,
      invoices: Array.from(row.invoices),
      cancel: cancelRec ? {
        id: cancelRec.id,
        reason: cancelRec.reason,
        cancelledBy: cancelRec.cancelledBy,
        cancelledAt: cancelRec.cancelledAt,
      } : null,
    });
  }

  // ── Step 5: roll up per-invoice and per-factory totals
  const factoryMap = new Map();
  function _factoryBucket(name) {
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
  function _invoiceBucket(factory, no) {
    const f = _factoryBucket(factory);
    const key = no || '__no_invoice__';
    let inv = f.invoices.get(key);
    if (!inv) {
      inv = {
        no,
        factory,
        synthetic: !no,
        abayas: [],
        totals: { abayas: 0, delivered: 0, pending: 0, cancelled: 0 },
      };
      f.invoices.set(key, inv);
    }
    return inv;
  }
  for (const ar of abayaRows) {
    const f = _factoryBucket(ar.factory);
    f.totals.abayas += 1;
    if (ar.status === 'Delivered') f.totals.delivered += 1;
    else if (ar.status === 'Pending') f.totals.pending += 1;
    else if (ar.status === 'Cancelled') f.totals.cancelled += 1;

    if (ar.invoices.length === 0) {
      const inv = _invoiceBucket(ar.factory, '');
      inv.abayas.push(ar);
    } else {
      for (const invNo of ar.invoices) {
        const inv = _invoiceBucket(ar.factory, invNo);
        if (!inv.abayas.some((x) => x.id === ar.id)) inv.abayas.push(ar);
      }
    }
  }

  const factories = Array.from(factoryMap.values()).map((f) => {
    const invoices = Array.from(f.invoices.values())
      .map((inv) => {
        const abayas = inv.abayas.slice().sort((a, b) => {
          const order = { Cancelled: 0, Pending: 1, Delivered: 2 };
          const oa = order[a.status] != null ? order[a.status] : 9;
          const ob = order[b.status] != null ? order[b.status] : 9;
          if (oa !== ob) return oa - ob;
          return String(a.code).localeCompare(String(b.code));
        });
        return {
          no: inv.no,
          synthetic: !!inv.synthetic,
          totals: {
            abayas: abayas.length,
            delivered: abayas.filter((a) => a.status === 'Delivered').length,
            pending:   abayas.filter((a) => a.status === 'Pending').length,
            cancelled: abayas.filter((a) => a.status === 'Cancelled').length,
          },
          abayas: abayas.map((a) => ({
            code: a.code,
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
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const totals = {
    invoices: factories.reduce((s, f) => s + f.totals.invoices, 0),
    abayas:   factories.reduce((s, f) => s + f.totals.abayas, 0),
    delivered: factories.reduce((s, f) => s + f.totals.delivered, 0),
    pending:   factories.reduce((s, f) => s + f.totals.pending, 0),
    cancelled: factories.reduce((s, f) => s + f.totals.cancelled, 0),
  };

  return {
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
  };
}

module.exports = {
  ymdInTimezone,
  startOfDayInTimezone,
  endOfDayInTimezone,
  weekdayInTimezone,
  longDateInTimezone,
  normalizeYmd,
  resolveDateRangeBounds,
  splitInvoiceSerials,
  aggregateCheckReport,
};
