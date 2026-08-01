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

// Period ends via the standard calendar-math trick: start of the NEXT period,
// minus one day. Same technique for all three units — no unit-specific edge
// cases (leap years, 30- vs 31-day months, ISO week rollover) to get wrong.
export function weekEndYmd(ymd) {
  return addUtcDays(weekStartMondayYmd(ymd), 6);
}

export function monthEndYmd(ymd) {
  const nextMonthStart = monthStartYmd(addUtcDays(monthStartYmd(ymd), 31));
  return addUtcDays(nextMonthStart, -1);
}

export function yearEndYmd(ymd) {
  const d = parseYmdUtc(ymd);
  d.setUTCMonth(11, 31);
  return ymdFromUtcDate(d);
}

/**
 * Resolve the [start, end] window for a report type anchored at `anchorYmd`
 * (the date the user picked — defaults to today when they haven't picked one).
 *
 * `todayYmd` (defaults to `anchorYmd` for full backward compatibility) caps the
 * window so it never reaches into the future: a period still in progress ends
 * at today; a period that has already fully elapsed (any past date the user
 * explicitly picks) shows its complete range, not just "start through the
 * picked day" — that's what makes a picked date actually useful for browsing
 * history rather than only ever repeating "today's" truncated window.
 */
export function reportRangeForType(type, anchorYmd, todayYmd) {
  const t = type === 'daily' || type === 'weekly' || type === 'monthly' || type === 'yearly' ? type : 'daily';
  const today = todayYmd || anchorYmd;
  let startYmd = anchorYmd;
  let naturalEndYmd = anchorYmd;
  if (t === 'weekly') {
    startYmd = weekStartMondayYmd(anchorYmd);
    naturalEndYmd = weekEndYmd(anchorYmd);
  } else if (t === 'monthly') {
    startYmd = monthStartYmd(anchorYmd);
    naturalEndYmd = monthEndYmd(anchorYmd);
  } else if (t === 'yearly') {
    startYmd = yearStartYmd(anchorYmd);
    naturalEndYmd = yearEndYmd(anchorYmd);
  }
  const endYmd = naturalEndYmd < today ? naturalEndYmd : today;
  const days = dayDiffInclusive(startYmd, endYmd);
  const prevEnd = addUtcDays(startYmd, -1);
  const prevStart = addUtcDays(prevEnd, -(days - 1));
  return { type: t, startYmd, endYmd, prevStart, prevEnd, days };
}

export function safeYmdOrFallback(value, fallbackYmd) {
  const s = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallbackYmd;
}

export function sessionsFilterForPeriod(period, anchorYmd, todayYmd) {
  const range = reportRangeForType(period, anchorYmd, todayYmd);
  return {
    where: 'WHERE day_date >= ? AND day_date <= ?',
    binds: [range.startYmd, range.endYmd],
    range,
  };
}
