/** Factory timezone, working windows, D1 persistence — hot path for /api/state and ingest. */

/** CEO hourly chart default span when no windows. */
export const FACTORY_HOURLY_START = 9;
export const FACTORY_HOURLY_END = 23;

const WORKING_HOURS_KEY = 'working_hours_v1';
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
  if (!row || row.v == null) return defaultWorkingHoursConfig();
  try {
    return normalizeWorkingHoursConfig(JSON.parse(String(row.v)));
  } catch (_) {
    return defaultWorkingHoursConfig();
  }
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
 */
export function overlapSecWithWindows(startSec, endSec, config) {
  const st0 = Math.floor(Number(startSec) || 0);
  const en0 = Math.floor(Number(endSec) || 0);
  if (en0 <= st0) return 0;
  const HARD_CAP_SEC = 48 * 3600;
  const st = en0 - st0 > HARD_CAP_SEC ? en0 - HARD_CAP_SEC : st0;
  const en = en0;
  const stepSec = Math.min(3600, Math.max(60, en - st));
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
