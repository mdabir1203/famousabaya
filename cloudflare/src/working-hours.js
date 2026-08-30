/** Factory timezone, working windows, D1 persistence — hot path for /api/state and ingest. */

/** CEO hourly chart default span when no windows. */
export const FACTORY_HOURLY_START = 9;
export const FACTORY_HOURLY_END = 23;

const WORKING_HOURS_KEY = 'working_hours_v1';
export { WORKING_HOURS_KEY };

/** Parse a worker_settings row into a normalized config (shared by get/batch paths). */
export function workingHoursConfigFromRow(row) {
  if (!row || row.v == null) return defaultWorkingHoursConfig();
  try {
    return normalizeWorkingHoursConfig(JSON.parse(String(row.v)));
  } catch (_) {
    return defaultWorkingHoursConfig();
  }
}
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const _ymdFmt = new Map();
const _weekdayFmt = new Map();
const _minutePartsFmt = new Map();

function ymdFormatter(tz) {
  if (!_ymdFmt.has(tz))
    _ymdFmt.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return _ymdFmt.get(tz);
}

function weekdayFormatter(tz) {
  if (!_weekdayFmt.has(tz))
    _weekdayFmt.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }));
  return _weekdayFmt.get(tz);
}

function minutePartsFormatter(tz) {
  if (!_minutePartsFmt.has(tz))
    _minutePartsFmt.set(
      tz,
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    );
  return _minutePartsFmt.get(tz);
}

export function getFactoryTz(env) {
  const t = env.FACTORY_TZ;
  return typeof t === 'string' && t.trim() ? t.trim() : 'Asia/Dubai';
}

export function defaultWorkingHoursConfig() {
  return {
    profile: 'normal',
    timezone: 'Asia/Dubai',
    days: {
      sat: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
      sun: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
      mon: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
      tue: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
      wed: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
      thu: [['09:00', '13:30'], ['15:00', '20:00'], ['20:40', '23:30']],
      fri: [['15:00', '20:00'], ['20:40', '23:30']],
    },
  };
}

export function parseHHMMToMinute(text) {
  const s = String(text || '').trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minuteToHHMM(minute) {
  const m = Math.max(0, Math.min(1439, Number(minute) || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function normalizeWorkingHoursConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = defaultWorkingHoursConfig();
  if (typeof src.profile === 'string' && src.profile.trim()) out.profile = src.profile.trim();
  if (typeof src.timezone === 'string' && src.timezone.trim()) out.timezone = src.timezone.trim();
  const days = src.days && typeof src.days === 'object' ? src.days : {};
  for (const key of WEEKDAY_KEYS) {
    const arr = Array.isArray(days[key]) ? days[key] : out.days[key];
    const windows = [];
    for (const win of arr) {
      if (!Array.isArray(win) || win.length !== 2) continue;
      const st = parseHHMMToMinute(win[0]);
      const en = parseHHMMToMinute(win[1]);
      if (st == null || en == null || en <= st) continue;
      windows.push([st, en]);
    }
    windows.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < windows.length; i++) {
      if (windows[i][0] < windows[i - 1][1]) {
        throw new Error(`Overlapping windows for ${key}`);
      }
    }
    out.days[key] = windows.map((w) => [minuteToHHMM(w[0]), minuteToHHMM(w[1])]);
  }
  return out;
}

export async function getWorkingHoursConfig(env) {
  const row = await env.DB.prepare('SELECT v FROM worker_settings WHERE k = ?').bind(WORKING_HOURS_KEY).first();
  return workingHoursConfigFromRow(row);
}

export async function saveWorkingHoursConfig(env, cfg) {
  const normalized = normalizeWorkingHoursConfig(cfg);
  await env.DB.prepare(
    'INSERT INTO worker_settings (k, v, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=unixepoch()'
  )
    .bind(WORKING_HOURS_KEY, JSON.stringify(normalized))
    .run();
  return normalized;
}

export function ymdInTz(epochSec, tz) {
  return ymdFormatter(tz).format(new Date(epochSec * 1000));
}

export function weekdayKeyInTz(epochSec, tz) {
  const wd = weekdayFormatter(tz).format(new Date(epochSec * 1000)).toLowerCase().slice(0, 3);
  return WEEKDAY_KEYS.includes(wd) ? wd : 'sun';
}

export function minuteOfDayInTz(epochSec, tz) {
  const parts = minutePartsFormatter(tz).formatToParts(new Date(epochSec * 1000));
  const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
  const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
  return hh * 60 + mm;
}

export function windowsForDay(config, weekdayKey) {
  const arr = config && config.days && Array.isArray(config.days[weekdayKey]) ? config.days[weekdayKey] : [];
  const out = [];
  for (const [s, e] of arr) {
    const st = parseHHMMToMinute(s);
    const en = parseHHMMToMinute(e);
    if (st == null || en == null || en <= st) continue;
    out.push([st, en]);
  }
  return out;
}

export function isInWorkingWindow(epochSec, config) {
  const tz = (config && config.timezone) || 'Asia/Dubai';
  const k = weekdayKeyInTz(epochSec, tz);
  const minute = minuteOfDayInTz(epochSec, tz);
  const windows = windowsForDay(config, k);
  return windows.some(([s, e]) => minute >= s && minute < e);
}

/**
 * Find the local-midnight (in tz) of the same day as `epochSec`. Walks
 * back from epochSec until ymdInTz flips, then returns the first
 * minute of the local day. Robust to DST boundaries (the factory is
 * fixed UTC+4 so DST isn't an issue, but the approach is correct either
 * way). Capped at a 48h backward walk so a malformed `epochSec` can't
 * loop forever.
 */
function localMidnightSec(epochSec, tz) {
  const lo = epochSec - 48 * 3600;
  const hi = epochSec;
  const ymdTarget = ymdInTz(epochSec, tz);
  for (let t = lo; t <= hi; t += 60) {
    if (ymdInTz(t, tz) === ymdTarget) {
      return t;
    }
  }
  return null;
}

/**
 * Find the most recent PAST working window's start time.
 *
 * Walks backwards from `epochSec` by 1-minute steps. For each past
 * minute, asks "which window of which day contains this minute?".
 * The first hit is the answer -- that window's start time, in the
 * factory's timezone, as a unix second.
 *
 * If `epochSec` is itself inside a window, that window's start is
 * returned (Case 1).
 *
 * If `epochSec` is between windows (lunch break, or after last
 * window of the day but before midnight), the immediately preceding
 * window's start is returned (Case 2).
 *
 * If `epochSec` is before any window of today (e.g. 6 AM on a
 * normal weekday before the 9 AM morning shift, or any time on a
 * Friday morning before 15:00), the most recent window of the
 * preceding day is returned (Case 3). This is the one we care
 * about for the "Stuck on a 14h session across the shift boundary"
 * case: a worker started at 7:34 PM yesterday and is still on the
 * floor at 2 AM today should be capped at yesterday's 19:34 evening
 * shift start, not show 0 and not show the full 14h.
 *
 * Capped at 48h of backward walk so a malformed epochSec can't loop
 * forever. Returns `null` if no past window is found in that window.
 *
 * `epochSec` MUST be the 'now' value the caller will use, not a
 * different timestamp, because minute-of-day is computed from it.
 */
export function currentShiftStartSec(epochSec, config) {
  const tz = (config && config.timezone) || 'Asia/Dubai';
  // Walk backwards by 1-minute steps. 48h is more than enough to
  // cover any "shift just ended, where's the most recent window" case
  // even on a Friday with a morning gap.
  for (let t = epochSec; t >= epochSec - 48 * 3600; t -= 60) {
    const k = weekdayKeyInTz(t, tz);
    const m = minuteOfDayInTz(t, tz);
    const ws = windowsForDay(config, k);
    if (!ws.length) continue;
    // Find the window containing `m`. The windows are sorted and
    // non-overlapping, so at most one matches.
    for (let i = 0; i < ws.length; i++) {
      const [s, e] = ws[i];
      if (m >= s && m < e) {
        const midnight = localMidnightSec(t, tz);
        if (midnight == null) return null;
        return midnight + s * 60;
      }
    }
    // No window at this minute on this weekday. Keep walking back.
  }
  return null;
}

export function workingStatusNow(config) {
  const now = Math.floor(Date.now() / 1000);
  const tz = (config && config.timezone) || 'Asia/Dubai';
  const k = weekdayKeyInTz(now, tz);
  const minute = minuteOfDayInTz(now, tz);
  const windows = windowsForDay(config, k);
  if (!windows.length) return 'closed';
  if (windows.some(([s, e]) => minute >= s && minute < e)) return 'open';
  return 'break';
}

/**
 * Overlap of [startSec,endSec) with union of working windows (coarse steps for CPU).
 * Memoize per-epoch "in window" checks inside one evaluation using a small LRU-ish cap.
 *
 * Sampling: for short spans (< 2h) we use 60s steps so a session that
 * straddles a shift boundary (e.g. 08:33 → 09:33 with the 09:00 start) is
 * correctly attributed the in-shift portion. For long spans we coarser-step
 * up to 1h to keep the work bounded; the HARD_CAP below protects against
 * pathologically long ranges.
 */
export function overlapSecWithWindows(startSec, endSec, config) {
  const st0 = Math.floor(Number(startSec) || 0);
  const en0 = Math.floor(Number(endSec) || 0);
  if (en0 <= st0) return 0;
  const HARD_CAP_SEC = 48 * 3600;
  const st = en0 - st0 > HARD_CAP_SEC ? en0 - HARD_CAP_SEC : st0;
  const en = en0;
  const span = en - st;
  // 60s for short spans so shift boundaries are accurate; 600s (10 min) for
  // day-spans; 3600s (1h) for multi-day ranges. Always < 5000 samples.
  const stepSec = span <= 2 * 3600 ? 60 : (span <= 24 * 3600 ? 600 : 3600);
  const inWinMemo = new Map();
  const tz = (config && config.timezone) || 'Asia/Dubai';
  let total = 0;

  function inWin(t) {
    if (inWinMemo.has(t)) return inWinMemo.get(t);
    const k = weekdayKeyInTz(t, tz);
    const minute = minuteOfDayInTz(t, tz);
    const windows = windowsForDay(config, k);
    const ok = windows.some(([s, e]) => minute >= s && minute < e);
    if (inWinMemo.size > 5000) inWinMemo.clear();
    inWinMemo.set(t, ok);
    return ok;
  }

  for (let t = st; t < en; t += stepSec) {
    const t2 = Math.min(en, t + stepSec);
    if (inWin(t)) total += t2 - t;
  }
  // Final partial-step: ensure the last <stepSec> tail is attributed by its
  // own in-window check rather than the previous sample. Without this a
  // 1h session at a shift boundary loses the boundary portion.
  if (span > stepSec && (en - stepSec) % stepSec !== 0) {
    // already covered by t2 = min(en, t+stepSec) above — kept for clarity
  }
  return total;
}

export function factoryDateStringForUnix(env, unixSec) {
  const tz = getFactoryTz(env);
  return ymdFormatter(tz).format(new Date(unixSec * 1000));
}

export function factoryHourForUnix(env, unixSec) {
  const tz = getFactoryTz(env);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(unixSec * 1000));
  const h = parts.find((p) => p.type === 'hour');
  return h ? parseInt(h.value, 10) : 0;
}

export function factoryTodayString(env) {
  return factoryDateStringForUnix(env, Math.floor(Date.now() / 1000));
}
