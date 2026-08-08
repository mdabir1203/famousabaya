/** Shared helpers for /api/report and /api/analytics date ranges */

export function parseYmdUtc(ymd) {
  const s = String(ymd || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return new Date(Date.now());
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function ymdFromUtcDate(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

export function addUtcDays(ymd, days) {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return ymdFromUtcDate(d);
}

export function dayDiffInclusive(startYmd, endYmd) {
  const a = parseYmdUtc(startYmd);
  const b = parseYmdUtc(endYmd);
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
  return Math.max(0, diff) + 1;
}

export function weekStartMondayYmd(ymd) {
  const d = parseYmdUtc(ymd);
  const wd = d.getUTCDay();
  const offset = wd === 0 ? -6 : 1 - wd;
  d.setUTCDate(d.getUTCDate() + offset);
  return ymdFromUtcDate(d);
}

export function monthStartYmd(ymd) {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(1);
  return ymdFromUtcDate(d);
}

export function yearStartYmd(ymd) {
  const d = parseYmdUtc(ymd);
  d.setUTCMonth(0, 1);
  return ymdFromUtcDate(d);
}

export function reportRangeForType(type, factoryToday) {
  const t = type === 'daily' || type === 'weekly' || type === 'monthly' || type === 'yearly' ? type : 'daily';
  let startYmd = factoryToday;
  if (t === 'weekly') startYmd = weekStartMondayYmd(factoryToday);
  if (t === 'monthly') startYmd = monthStartYmd(factoryToday);
  if (t === 'yearly') startYmd = yearStartYmd(factoryToday);
  const endYmd = factoryToday;
  const days = dayDiffInclusive(startYmd, endYmd);
  const prevEnd = addUtcDays(startYmd, -1);
  const prevStart = addUtcDays(prevEnd, -(days - 1));
  return { type: t, startYmd, endYmd, prevStart, prevEnd, days };
}

export function safeYmdOrFallback(value, fallbackYmd) {
  const s = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallbackYmd;
}

export function isValidYmd(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseYmdUtc(s);
  return ymdFromUtcDate(d) === s;
}

/**
 * Explicit custom report range [from, to] (inclusive, YYYY-MM-DD).
 * Throws Error with a client-safe message on invalid input.
 * @param {string} from
 * @param {string} to
 * @param {{ maxDays?: number }} [opts]
 */
export function customRange(from, to, opts) {
  const maxDays = Math.max(1, Number(opts && opts.maxDays) || 92);
  if (!isValidYmd(from) || !isValidYmd(to)) {
    throw new Error('Invalid from/to date (use YYYY-MM-DD)');
  }
  if (from > to) {
    throw new Error('Invalid range: from is after to');
  }
  const days = dayDiffInclusive(from, to);
  if (days > maxDays) {
    throw new Error('Range too long (max ' + maxDays + ' days)');
  }
  const prevEnd = addUtcDays(from, -1);
  const prevStart = addUtcDays(prevEnd, -(days - 1));
  return { type: 'custom', startYmd: from, endYmd: to, prevStart, prevEnd, days };
}

export function sessionsFilterForPeriod(period, anchorYmd) {
  const range = reportRangeForType(period, anchorYmd);
  return {
    where: 'WHERE day_date >= ? AND day_date <= ?',
    binds: [range.startYmd, range.endYmd],
    range,
  };
}
