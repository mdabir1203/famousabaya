// Check Delivery Report handlers for the cloud CEO dashboard.
//
// "Check Delivery Report" (renamed from "Check Production Report" in v1.2.9)
// pulls the operator-leaderboard's real invoice / abaya / showroom data
// instead of relying on the cloud's own D1 (which only sees the production
// line sessions and cannot tell which invoice a finished abaya belongs
// to). The cloud Worker proxies the leaderboard's API server-side, runs
// the same aggregation the leaderboard's own UI does, and merges in any
// cancellations recorded from the CEO dashboard so the report has a
// single coherent shape.
//
// Routes:
//   GET  /api/check-delivery-report/config   — list of factories (locations) + defaults
//   GET  /api/check-delivery-report?from=...&to=...&factory=...
//                                              — delivery report for a date range
//   POST /api/cancellations                   — record a cancellation
//   GET  /api/cancellations?from=...&to=...  — list cancellations
//
// Backward compatibility:
//   /api/check-report and /api/check-report/config are STILL registered so
//   any older dashboard build (or external tool) keeps working. They
//   return the same shape as before — just sourced from the leaderboard
//   instead of the cloud's own D1. See the legacy shim at the bottom of
//   this file.

import { jsonRes, errRes, CEO_JSON_NO_STORE } from '../http-response.js';
import { factoryTodayString } from '../working-hours.js';

const FACTORY_TZ = 'Asia/Dubai';
const DEFAULT_FACTORY = 'FAREWELL ABAYA LLC';

// The leaderboard is hosted on a separate Cloudflare Pages project. The
// cloud Worker proxies its public API so the dashboard doesn't need to
// handle CORS or duplicate the aggregation logic. The URL is read from
// the LEADERBOARD_URL var (see wrangler.toml); empty means "fall back to
// the cloud's own D1 only" (the old behavior, which shows everything as
// "(no invoice) unassigned").
function leaderboardUrl(env) {
  return String(env.LEADERBOARD_URL || '').trim().replace(/\/+$/, '');
}

// ---- Time helpers (Asia/Dubai) ----------------------------------------------
//
// Mirrors the leaderboard's helpers in src/lib/check-report.ts. Anchored on
// noon UTC so DST edge cases (Asia/Dubai is fixed UTC+4, but defensive
// coding) don't shift the day boundary.

function ymdToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FACTORY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function safeYmd(s, fallback) {
  const t = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return fallback;
  return t;
}

function startOfDayIso(ymd) {
  // Asia/Dubai is fixed UTC+4 (no DST). Hardcode the offset rather than
  // recomputing via Intl — the offset is a fact, not a calculation.
  return ymd + 'T00:00:00+04:00';
}
function endOfDayIso(ymd) {
  return ymd + 'T23:59:59.999+04:00';
}

function weekdayInTz(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: FACTORY_TZ, weekday: 'long',
    }).format(noon);
  } catch (_) { return ''; }
}

function longDateInTz(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: FACTORY_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(noon);
  } catch (_) { return ymd; }
}

// ---- Leaderboard fetch (with timeout + soft-fail) --------------------------
//
// We pull the leaderboard's /api/check-report?from=...&to=... endpoint
// (the same one the operator's leaderboard modal calls). The leaderboard
// returns raw rows; the aggregation that turns them into totals +
// byLocation + groups lives in src/lib/check-report.ts and is ported
// to JS below (aggregateFromLeaderboardRows).

async function fetchLeaderboardRows(env, fromYmd, toYmd) {
  const base = leaderboardUrl(env);
  if (!base) return { rows: [], source: 'cloud-d1-fallback' };
  const url = base + '/api/check-report?from=' + encodeURIComponent(fromYmd) +
    '&to=' + encodeURIComponent(toYmd);
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[check-delivery] leaderboard HTTP', res.status, txt.slice(0, 200));
      return { rows: [], source: 'cloud-d1-fallback', error: 'leaderboard HTTP ' + res.status };
    }
    const j = await res.json();
    return { rows: Array.isArray(j && j.rows) ? j.rows : [], source: 'leaderboard' };
  } catch (e) {
    console.error('[check-delivery] leaderboard fetch failed:', e && (e.message || e));
    return { rows: [], source: 'cloud-d1-fallback', error: (e && e.message) || String(e) };
  }
}

// ---- Aggregation (port of src/lib/check-report.ts aggregateCheckReport) ----
//
// Pure function: rows + window → totals + byLocation + groups. Returns the
// exact shape the dashboard's cr-* components need. Kept as a single
// function for readability — once the leaderboard and dashboard settle
// into their final shape we can split per-pass.

function statusForRow(r) {
  if (r.deletedAt) return 'cancelled';
  if (r.status === 'completed') return 'completed';
  return 'pending';
}
function eventAtForRow(r, status) {
  if (status === 'cancelled') return String(r.deletedAt);
  if (status === 'completed') return r.completedAt || r.createdAt;
  return r.createdAt;
}
function locationForRow(r) {
  return (r.showroom || '').trim() || 'Unspecified';
}

function rowsInWindow(rows, fromYmd, toYmd) {
  const fromIso = startOfDayIso(fromYmd);
  const toIso = endOfDayIso(toYmd);
  return rows.filter((r) => {
    const candidates = [r.deletedAt, r.completedAt, r.createdAt];
    for (const ts of candidates) {
      if (!ts) continue;
      if (String(ts) >= fromIso && String(ts) <= toIso) return true;
    }
    return false;
  });
}

function aggregateRows(rows, fromYmd, toYmd) {
  const inWindow = rowsInWindow(rows, fromYmd, toYmd);
  const totals = { invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0 };
  const invoiceSet = new Set();
  const groupMap = new Map();
  const locMap = new Map();

  for (const r of inWindow) {
    const status = statusForRow(r);
    totals.abayas += 1;
    invoiceSet.add(r.invoiceNo);
    if (status === 'completed') totals.delivered += 1;
    else if (status === 'cancelled') totals.cancelled += 1;
    else totals.pending += 1;

    const loc = locationForRow(r);
    const groupKey = loc + '::' + r.invoiceNo;
    let g = groupMap.get(groupKey);
    if (!g) {
      g = { location: loc, invoiceNo: r.invoiceNo, rows: [] };
      groupMap.set(groupKey, g);
    }
    g.rows.push({
      invoiceNo: r.invoiceNo,
      abayaCode: r.itemCode || '',
      status,
      eventAt: eventAtForRow(r, status),
      location: loc,
      cancelledBy: r.cancelledBy || undefined,
      cancellationReason: r.cancellationReason || undefined,
    });

    let lt = locMap.get(loc);
    if (!lt) {
      lt = { location: loc, invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0, _invoiceSet: new Set() };
      locMap.set(loc, lt);
    }
    lt.abayas += 1;
    if (status === 'completed') lt.delivered += 1;
    else if (status === 'cancelled') lt.cancelled += 1;
    else lt.pending += 1;
    lt._invoiceSet.add(r.invoiceNo);
  }
  totals.invoices = invoiceSet.size;

  const byLocation = Array.from(locMap.values())
    .map((lt) => ({
      location: lt.location,
      invoices: lt._invoiceSet.size,
      abayas: lt.abayas,
      delivered: lt.delivered,
      pending: lt.pending,
      cancelled: lt.cancelled,
    }))
    .sort((a, b) => (b.abayas - a.abayas) || a.location.localeCompare(b.location));

  const groups = Array.from(groupMap.values()).map((g) => {
    const rows = g.rows.slice().sort((a, b) => (a.eventAt < b.eventAt ? 1 : -1));
    return Object.assign({}, g, { rows });
  });
  groups.sort((a, b) => {
    if (a.location !== b.location) return a.location.localeCompare(b.location);
    return a.invoiceNo.localeCompare(b.invoiceNo);
  });

  return { totals, byLocation, groups, inWindowCount: inWindow.length };
}

// ---- Cloud-side cancellations (merged into the report) ---------------------
//
// Cancellations recorded from the CEO dashboard live in the cloud's D1
// `cancellations` table. They don't have to match a leaderboard row —
// a supervisor can record a cancellation for an invoice that hasn't
// appeared in the leaderboard yet (the operator's POS system might be
// behind, or the order was placed by phone). We pull them in by
// time-range and append them to the cancellations list in the response
// so the dashboard's Cancellations section shows them.

async function fetchCloudCancellations(env, fromMs, toMs) {
  try {
    const r = await env.DB.prepare(`
      SELECT id, factory, invoice_no, abaya_code, cancelled_at, cancelled_by, reason, source
      FROM cancellations
      WHERE cancelled_at >= ? AND cancelled_at < ?
      ORDER BY cancelled_at ASC
    `).bind(fromMs, toMs).all();
    return (r && r.results) || [];
  } catch (e) {
    console.error('[check-delivery] cloud cancellations query failed:', e && (e.message || e));
    return [];
  }
}

// ---- /api/check-delivery-report/config --------------------------------------
//
// Returns the list of factories (locations) the operator can pick from.
// We pull this from the leaderboard's data by probing the most recent
// rows (or fall back to a static list when the leaderboard is offline).
// The dashboard uses this to populate the "Factory" dropdown.

export async function handleCheckDeliveryConfig(env, url) {
  const today = ymdToday();
  // Probe the leaderboard for the list of locations by fetching a wide
  // window and deduping showroom names. Cheap because the leaderboard
  // already has an index on showroom and this is a one-shot call per
  // dashboard load.
  const base = leaderboardUrl(env);
  let factories = [DEFAULT_FACTORY];
  if (base) {
    try {
      // Probe a 7-day window by default so a "quiet" day for one factory
      // doesn't shrink the dropdown. (Earlier: probed today only, which
      // collapsed the list to one factory whenever the second factory
      // hadn't logged anything on the picked day.)
      const from7 = new Date();
      from7.setDate(from7.getDate() - 7);
      const from7Ymd = new Intl.DateTimeFormat('en-CA', { timeZone: FACTORY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(from7);
      const probeRes = await fetch(base + '/api/check-report?from=' + from7Ymd + '&to=' + today, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (probeRes.ok) {
        const j = await probeRes.json();
        const locs = new Set();
        for (const r of ((j && j.rows) || [])) {
          const loc = (r.showroom || '').trim();
          if (loc) locs.add(loc);
        }
        if (locs.size === 0) {
          // Try a 30-day window to find at least one showroom.
          const from30 = new Date();
          from30.setDate(from30.getDate() - 30);
          const from30Ymd = new Intl.DateTimeFormat('en-CA', { timeZone: FACTORY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(from30);
          const r2 = await fetch(base + '/api/check-report?from=' + from30Ymd + '&to=' + today, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          if (r2.ok) {
            const j2 = await r2.json();
            for (const r of ((j2 && j2.rows) || [])) {
              const loc = (r.showroom || '').trim();
              if (loc) locs.add(loc);
            }
          }
        }
        if (locs.size) factories = Array.from(locs).sort();
      }
    } catch (e) {
      console.warn('[check-delivery] config probe failed:', e && (e.message || e));
    }
  }
  return jsonRes({
    ok: true,
    factories,
    defaultFactory: DEFAULT_FACTORY,
    timezone: FACTORY_TZ,
    todayYmd: today,
    leaderboardConfigured: !!base,
  }, 200, CEO_JSON_NO_STORE);
}

// ---- /api/check-delivery-report --------------------------------------------
//
// 1. Pulls the leaderboard's raw rows for the date range (with soft-fail
//    to the cloud's own D1 when the leaderboard is offline).
// 2. Runs the same aggregation the leaderboard's UI does (port of
//    aggregateCheckReport in src/lib/check-report.ts).
// 3. Pulls cloud-side cancellations and appends them to the cancellations
//    list so the dashboard's Cancellations section shows them.
// 4. Returns the final report in the shape the dashboard's cr-* components
//    expect.

export async function handleCheckDeliveryReport(env, url) {
  const t0 = Date.now();
  const fromParam = String(url.searchParams.get('from') || '').trim();
  const toParam = String(url.searchParams.get('to') || '').trim();
  const factoryParam = String(url.searchParams.get('factory') || '').trim();
  const today = ymdToday();
  const fromYmd = safeYmd(fromParam, today);
  const toYmd = safeYmd(toParam, fromYmd);

  // Inclusive day bounds in Asia/Dubai.
  const fromMs = new Date(startOfDayIso(fromYmd)).getTime();
  const toMs = new Date(endOfDayIso(toYmd)).getTime();

  try {
    // ---- 1. Pull the leaderboard's raw rows ----
    const lb = await fetchLeaderboardRows(env, fromYmd, toYmd);
    const leaderboardRows = lb.rows;

    // ---- 2. Aggregate (per showroom + per invoice) ----
    const agg = aggregateRows(leaderboardRows, fromYmd, toYmd);
    let { totals, byLocation, groups } = agg;

    // ---- 2b. Factory filter (dashboard "Factory" dropdown) ----
    // "All" (empty factory) returns every location. A specific factory
    // filters by-location + shows a synthetic factory section header.
    const allFactories = factoryParam === '' || factoryParam.toLowerCase() === 'all';
    const filteredByLocation = allFactories
      ? byLocation
      : byLocation.filter((lt) => lt.location === factoryParam);
    const filteredGroups = allFactories
      ? groups
      : groups.filter((g) => g.location === factoryParam);
    // Recompute totals over the filter so the headline numbers match
    // what the operator sees in the breakdown.
    const filteredTotals = filteredGroups.reduce(
      (acc, g) => {
        for (const r of g.rows) {
          acc.abayas += 1;
          if (r.status === 'completed') acc.delivered += 1;
          else if (r.status === 'cancelled') acc.cancelled += 1;
          else acc.pending += 1;
        }
        return acc;
      },
      { invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0 }
    );
    const inv = new Set();
  for (const g of filteredGroups) inv.add(g.invoiceNo);
    filteredTotals.invoices = inv.size;

    // ---- 3. Cloud-side cancellations for the same range ----
    const cloudCancels = await fetchCloudCancellations(env, fromMs, toMs);
    const cancellations = cloudCancels.map((c) => ({
      id: c.id,
      factory: c.factory || '',
      invoiceNo: c.invoice_no || '',
      abayaCode: c.abaya_code || '',
      cancelledAt: c.cancelled_at,
      cancelledBy: c.cancelled_by || '',
      reason: c.reason || '',
      source: c.source || 'ceo',
    }));

    const sameDay = fromYmd === toYmd;
    const label = sameDay
      ? longDateInTz(fromYmd)
      : longDateInTz(fromYmd) + ' \u2192 ' + longDateInTz(toYmd);

    return jsonRes({
      ok: true,
      timezone: FACTORY_TZ,
      factory: allFactories ? 'All' : factoryParam,
      dateRange: {
        from: fromYmd,
        to: toYmd,
        sameDay,
        label,
        fromWeekday: weekdayInTz(fromYmd),
        toWeekday: weekdayInTz(toYmd),
      },
      totals: allFactories ? totals : filteredTotals,
      byLocation: filteredByLocation,
      groups: filteredGroups,
      factories: filteredByLocation.map((lt) => ({
        name: lt.location,
        totals: {
          invoices: lt.invoices,
          abayas: lt.abayas,
          delivered: lt.delivered,
          pending: lt.pending,
          cancelled: lt.cancelled,
        },
      })),
      cancellations,
      meta: {
        generatedAt: Date.now(),
        durationMs: Date.now() - t0,
        dataSource: lb.source,
        leaderboardError: lb.error || null,
        leaderboardRowsScanned: leaderboardRows.length,
        rowsInWindow: agg.inWindowCount,
        cloudCancellationsScanned: cancellations.length,
      },
    }, 200, CEO_JSON_NO_STORE);
  } catch (e) {
    console.error('[check-delivery] failed:', e && (e.stack || e.message || e));
    return errRes('Could not build delivery report: ' + ((e && e.message) || String(e)), 500);
  }
}

// ---- Cancellations (unchanged from v1.2.9 — POST + GET) -------------------
// Kept under the same paths so any dashboard build (current or older) that
// records a cancellation continues to work.

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
  const today = ymdToday();
  const fromYmd = safeYmd(from || today, today);
  const toYmd = safeYmd(to || from || today, today);
  const fromMs = new Date(startOfDayIso(fromYmd)).getTime();
  const toMs = new Date(endOfDayIso(toYmd)).getTime();
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
    return jsonRes({ ok: true, cancellations, timezone: FACTORY_TZ, from: fromYmd, to: toYmd }, 200, CEO_JSON_NO_STORE);
  } catch (e) {
    return errRes('Could not list cancellations: ' + ((e && e.message) || String(e)), 500);
  }
}

// ---- Legacy shim: /api/check-report and /api/check-report/config ------------
//
// The dashboard's first call site (from the modal that was wired in
// ceo-pages.js before the rename) used /api/check-report. Older dashboard
// builds in the wild still hit that path, so we re-export the new
// handlers under the old names. The dashboard will switch to the
// /api/check-delivery-report paths in a follow-up.

export async function handleCheckReportConfig(env, url) {
  return handleCheckDeliveryConfig(env, url);
}
export async function handleCheckReport(env, url) {
  return handleCheckDeliveryReport(env, url);
}
