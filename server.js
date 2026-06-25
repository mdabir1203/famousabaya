'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');
const { parseInvoiceNumberList } = require('./shared/invoice-parser.cjs');
const { parseCheckerBarcodeList } = require('./shared/checker-barcode-parser.cjs');
const {
  buildFloorExportPayload,
  floorSessionsToCsv,
  normalizeImportedFloorSessions,
} = require('./shared/floor-session-transfer.cjs');
const offlineReportStore = require('./shared/offline-report-store.cjs');
const sqliteSnapshot = require('./shared/sqlite-snapshot.cjs');
const reconcileCloudflare = require('./shared/reconcile-cloudflare.cjs');
const resendAlerts = require('./shared/alerting/resend-alerts.cjs');
const chokidar = require('chokidar');

/** Default 3000; override with PORT in .env */
const PORT = process.env.PORT || 3000;

function parseEnvPositiveIntOrNull(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function readAppPackageVersion() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return String(p.version || '1.0.0');
  } catch (_) {
    return '1.0.0';
  }
}

const SERVER_STARTED_AT = Date.now();
const APP_PACKAGE_VERSION = readAppPackageVersion();

const app = express();
app.use(cors());
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      const lower = String(filePath || '').toLowerCase();
      /** HTML stays fresh (LAN hub / kiosk shells); hashed assets preferred for immutable long TTL */
      if (lower.endsWith('.html')) {
        res.setHeader('Cache-Control', 'private, no-cache');
        return;
      }
      /** Versioned-ish static JS/CSS reduces repeat downloads without breaking kiosk updates mid-shift */
      if (lower.endsWith('.js') || lower.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=86400');
      }
    },
  })
);
app.use(express.json());

/** LAN mirror for Electron desktop launcher updates (publish `latest.yml` + artifacts per channel). */
const LAN_UPDATE_MIRROR_ROOT = (() => {
  const raw = String(process.env.ABAYA_LAN_UPDATE_MIRROR_DIR || '').trim();
  if (raw && path.isAbsolute(raw)) return raw;
  if (raw) return path.resolve(__dirname, raw);
  return path.join(__dirname, 'data', 'lan-update-mirror');
})();

function ensureLanUpdateMirrorDirs() {
  try {
    fs.mkdirSync(path.join(LAN_UPDATE_MIRROR_ROOT, 'stable'), { recursive: true });
    fs.mkdirSync(path.join(LAN_UPDATE_MIRROR_ROOT, 'beta'), { recursive: true });
  } catch (e) {
    console.warn('[lan-update-mirror] could not create dirs:', e.message);
  }
}
ensureLanUpdateMirrorDirs();

function setLanUpdateMirrorHeaders(res, filePath) {
  const lower = String(filePath || '').toLowerCase();
  /** Always revalidate update metadata and installers on LAN */
  res.setHeader('Cache-Control', 'no-store');
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  }
}

app.use(
  '/updates/stable',
  express.static(path.join(LAN_UPDATE_MIRROR_ROOT, 'stable'), {
    setHeaders(res, fp) {
      setLanUpdateMirrorHeaders(res, fp);
    },
  })
);
app.use(
  '/updates/beta',
  express.static(path.join(LAN_UPDATE_MIRROR_ROOT, 'beta'), {
    setHeaders(res, fp) {
      setLanUpdateMirrorHeaders(res, fp);
    },
  })
);

/** Health + inventory for operators (see docs/ONLINE_UPDATES.md — LAN mirror). */
app.get('/api/updates/mirror-health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const channels = ['stable', 'beta'];
  const out = {
    ok: true,
    root: LAN_UPDATE_MIRROR_ROOT,
    channels: {},
  };
  for (const ch of channels) {
    const dir = path.join(LAN_UPDATE_MIRROR_ROOT, ch);
    let latestYml = null;
    try {
      const p = path.join(dir, 'latest.yml');
      if (fs.existsSync(p)) {
        const st = fs.statSync(p);
        latestYml = { size: st.size, mtimeMs: st.mtimeMs };
      }
    } catch (_) {}
    let files = [];
    try {
      if (fs.existsSync(dir)) {
        files = fs.readdirSync(dir);
      }
    } catch (_) {}
    out.channels[ch] = {
      latestYml,
      fileCount: files.length,
      files,
    };
  }
  out.ok = !!(out.channels.stable.latestYml || out.channels.beta.latestYml);
  res.json(out);
});

const UPLOADS_PUBLIC = path.join(__dirname, 'public', 'uploads');
const UPLOAD_EMP_DIR = path.join(UPLOADS_PUBLIC, 'employees');
const UPLOAD_ITEM_DIR = path.join(UPLOADS_PUBLIC, 'items');

function ensurePublicUploadDirs() {
  try {
    fs.mkdirSync(UPLOAD_EMP_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_ITEM_DIR, { recursive: true });
  } catch (e) {
    console.warn('[uploads] Could not create dirs:', e.message);
  }
}

/** If unset, employee/item image uploads are open (factory LAN). If set, require matching header. */
const ASSET_UPLOAD_SECRET = String(process.env.ASSET_UPLOAD_SECRET || '').trim();

function assertAssetUploadAllowed(req, res) {
  if (!ASSET_UPLOAD_SECRET) return true;
  const h = String(req.headers['x-asset-upload-secret'] || req.query.secret || '').trim();
  if (h !== ASSET_UPLOAD_SECRET) {
    res.status(401).json({
      ok: false,
      error: 'Missing or invalid X-Asset-Upload-Secret (must match ASSET_UPLOAD_SECRET in .env).',
    });
    return false;
  }
  return true;
}

function sanitizeUploadToken(s) {
  return String(s || '').replace(/[^\w.-]+/g, '_').slice(0, 120);
}

const uploadImageMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const mt = String(file.mimetype || '');
    if (/^image\/(jpeg|pjpeg|png|gif|webp)$/i.test(mt)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, GIF, or WebP images are allowed'));
  },
});

const uploadXlsxMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const mt = String(file.mimetype || '');
    const name = String(file.originalname || '').toLowerCase();
    if (
      name.endsWith('.xlsx') ||
      /spreadsheetml\.sheet/i.test(mt) ||
      mt === 'application/octet-stream'
    ) {
      return cb(null, true);
    }
    cb(new Error('Only .xlsx files are allowed'));
  },
});

/** Link employees to uploads/employees/emp_{barcode}.ext when photo column empty. */
function attachEmployeeImagesFromDisk() {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  for (let i = 0; i < EMPLOYEES.length; i++) {
    const e = EMPLOYEES[i];
    if (e.photo && String(e.photo).trim()) continue;
    const base = 'emp_' + sanitizeUploadToken(e.barcode);
    for (let xi = 0; xi < exts.length; xi++) {
      const rel = 'uploads/employees/' + base + exts[xi];
      if (fs.existsSync(path.join(__dirname, 'public', rel))) {
        e.photo = rel;
        break;
      }
    }
  }
}

/** Link catalog rows to uploads/items/item_{barcode}.ext when icon empty. */
function attachItemImagesFromDisk() {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  for (let i = 0; i < abayaCatalog.length; i++) {
    const a = abayaCatalog[i];
    if (a.icon != null && String(a.icon).trim() !== '') continue;
    const base = 'item_' + sanitizeUploadToken(a.barcode);
    for (let xi = 0; xi < exts.length; xi++) {
      const rel = 'uploads/items/' + base + exts[xi];
      if (fs.existsSync(path.join(__dirname, 'public', rel))) {
        a.icon = rel;
        break;
      }
    }
  }
}

const server = http.createServer(app);
const SOCKET_PING_INTERVAL_MS = Number(process.env.SOCKET_PING_INTERVAL_MS) > 0
  ? Number(process.env.SOCKET_PING_INTERVAL_MS)
  : 15000;
const SOCKET_PING_TIMEOUT_MS = Number(process.env.SOCKET_PING_TIMEOUT_MS) > 0
  ? Number(process.env.SOCKET_PING_TIMEOUT_MS)
  : 20000;

const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  cookie: false,
  allowEIO3: true,
  pingInterval: SOCKET_PING_INTERVAL_MS,
  pingTimeout: SOCKET_PING_TIMEOUT_MS,
});

// ─── CLOUDFLARE PUSH LAYER ────────────────────────────────────────────────────
// Set these in a .env file or environment variables before starting the server:
//   CF_WORKER_URL=https://dashboard.farewellabaya.com   (custom domain; see cloudflare/wrangler.toml)
//   or https://abaya-track.<account>.workers.dev if you use the default Workers URL
//   CF_INGEST_SECRET=your_shared_secret_here
const CF_URL    = process.env.CF_WORKER_URL || '';
const CF_SECRET = process.env.CF_INGEST_SECRET || '';
const REQUIRE_CLOUD_SYNC = ['1', 'true', 'yes'].includes(
  String(process.env.REQUIRE_CLOUD_SYNC || '').trim().toLowerCase()
);
if (REQUIRE_CLOUD_SYNC && (!CF_URL || !CF_SECRET)) {
  throw new Error('REQUIRE_CLOUD_SYNC=true but CF_WORKER_URL / CF_INGEST_SECRET is missing.');
}

/** Durable NDJSON queue when factory has no internet — replayed when CF is reachable again. */
const CEO_QUEUE_DIR = String(process.env.CEO_INGEST_QUEUE_DIR || '').trim()
  ? path.resolve(process.env.CEO_INGEST_QUEUE_DIR)
  : path.join(__dirname, 'data');
const CEO_QUEUE_FILE = (() => {
  const env = String(process.env.CEO_INGEST_QUEUE_FILE || '').trim();
  if (env) return path.isAbsolute(env) ? env : path.join(__dirname, env);
  return path.join(CEO_QUEUE_DIR, 'ceo-ingest-queue.jsonl');
})();
const CEO_QUEUE_DRAIN = CEO_QUEUE_FILE + '.draining';
const CEO_INGEST_RETRY_MS = Math.max(
  5000,
  Number(process.env.CEO_INGEST_RETRY_INTERVAL_MS) > 0
    ? Number(process.env.CEO_INGEST_RETRY_INTERVAL_MS)
    : 30000
);

let ceoIngestPendingCount = 0;
let ceoQueueFlushRunning = false;

const { EventEmitter } = require('events');
const ingestEvents = new EventEmitter();
const REJECTED_QUEUE_FILE = path.join(path.dirname(CEO_QUEUE_FILE), 'ceo-ingest-rejected.jsonl');
const ingestStats = {
  pushOk: 0,
  pushQueued: 0,
  pushPermanentRejected: 0,
  pushAuthRejected: 0,
  drainSuccess: 0,
  drainAttempts: 0,
  drainHardFailures: 0,
  lastSuccessAt: null,
  lastAuthError: null,
  lastPermanentError: null,
  lastTransientError: null,
  queueDepthMaxSeen: 0,
  backlogSinceMs: null,
};

function getIngestStats() {
  return Object.assign({}, ingestStats);
}

const QUEUE_BACKLOG_THRESHOLD = (() => {
  const v = parseEnvPositiveIntOrNull('CEO_INGEST_BACKLOG_THRESHOLD');
  return v != null ? v : 25;
})();
const QUEUE_BACKLOG_DURATION_MS = (() => {
  const v = parseEnvPositiveIntOrNull('CEO_INGEST_BACKLOG_DURATION_MS');
  return v != null ? Math.max(60 * 1000, v) : 10 * 60 * 1000;
})();

function noteQueueDepthChanged() {
  if (ceoIngestPendingCount > ingestStats.queueDepthMaxSeen) {
    ingestStats.queueDepthMaxSeen = ceoIngestPendingCount;
  }
  if (ceoIngestPendingCount >= QUEUE_BACKLOG_THRESHOLD) {
    if (ingestStats.backlogSinceMs == null) {
      ingestStats.backlogSinceMs = Date.now();
    } else if (Date.now() - ingestStats.backlogSinceMs >= QUEUE_BACKLOG_DURATION_MS) {
      ingestEvents.emit('queue-backlog', {
        pending: ceoIngestPendingCount,
        sinceMs: ingestStats.backlogSinceMs,
        thresholdPending: QUEUE_BACKLOG_THRESHOLD,
        thresholdMs: QUEUE_BACKLOG_DURATION_MS,
      });
    }
  } else {
    ingestStats.backlogSinceMs = null;
  }
}

function getCeoSyncMode() {
  if (!CF_URL || !CF_SECRET) return 'local-cache-fallback';
  if (ceoQueueFlushRunning || ceoIngestPendingCount > 0) return 're-syncing';
  return 'cloud-live';
}

function ensureCeoQueueDir() {
  try {
    fs.mkdirSync(path.dirname(CEO_QUEUE_FILE), { recursive: true });
  } catch (e) {
    console.warn('[ceo-queue] mkdir:', e.message);
  }
}

function countQueueLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    if (fs.statSync(filePath).size === 0) return 0;
    const buf = fs.readFileSync(filePath, 'utf8');
    if (!buf.trim()) return 0;
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf.charCodeAt(i) === 10) n += 1;
    }
    if (buf.charCodeAt(buf.length - 1) !== 10) n += 1;
    return n;
  } catch (_) {
    return 0;
  }
}

function syncCeoPendingCountFromDisk() {
  ceoIngestPendingCount = countQueueLines(CEO_QUEUE_FILE);
}

function getRejectedQueueStats() {
  if (!fs.existsSync(REJECTED_QUEUE_FILE)) return { exists: false, lines: 0, sizeBytes: 0 };
  try {
    const stat = fs.statSync(REJECTED_QUEUE_FILE);
    return { exists: true, lines: countQueueLines(REJECTED_QUEUE_FILE), sizeBytes: stat.size, file: REJECTED_QUEUE_FILE };
  } catch (_) {
    return { exists: false, lines: 0, sizeBytes: 0 };
  }
}

/** If server died mid-flush, merge partial drain file back into the live queue. */
function recoverCeoIngestQueue() {
  ensureCeoQueueDir();
  if (!fs.existsSync(CEO_QUEUE_DRAIN)) return;
  try {
    const chunk = fs.readFileSync(CEO_QUEUE_DRAIN, 'utf8');
    if (chunk.trim()) {
      fs.appendFileSync(CEO_QUEUE_FILE, chunk.endsWith('\n') ? chunk : chunk + '\n', 'utf8');
    }
    fs.unlinkSync(CEO_QUEUE_DRAIN);
    console.log('[ceo-queue] Recovered incomplete flush (.draining merged)');
  } catch (e) {
    console.warn('[ceo-queue] Recovery failed:', e.message);
  }
}

function appendCeoIngestFailed(type, payload, meta) {
  if (!CF_URL || !CF_SECRET) return;
  ensureCeoQueueDir();
  const rec = {
    v: 1,
    id: crypto.randomUUID(),
    type,
    payload,
    queuedAt: Date.now(),
  };
  if (meta && typeof meta === 'object') Object.assign(rec, meta);
  try {
    fs.appendFileSync(CEO_QUEUE_FILE, JSON.stringify(rec) + '\n', 'utf8');
    ceoIngestPendingCount += 1;
    ingestStats.pushQueued += 1;
    noteQueueDepthChanged();
    console.warn('[ceo-queue] Buffered for CEO sync, pending=', ceoIngestPendingCount);
  } catch (e) {
    console.error('[ceo-queue] Could not persist event:', e.message);
  }
}

function appendCeoIngestRejected(type, payload, statusCode, snippet) {
  if (!CF_URL) return;
  ensureCeoQueueDir();
  const rec = {
    v: 1,
    id: crypto.randomUUID(),
    type,
    payload,
    rejectedAt: Date.now(),
    statusCode,
    snippet: snippet ? String(snippet).slice(0, 240) : null,
  };
  try {
    fs.appendFileSync(REJECTED_QUEUE_FILE, JSON.stringify(rec) + '\n', 'utf8');
  } catch (e) {
    console.error('[ceo-queue] Could not persist rejected event:', e.message);
  }
}

async function tryPostCeoIngestOnce(type, payload) {
  const base = String(CF_URL || '').replace(/\/+$/, '');
  return fetch(base + '/api/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Secret': CF_SECRET,
    },
    body: JSON.stringify({ type, payload }),
    signal: AbortSignal.timeout(8000),
  });
}

async function pushToCloudflare(type, payload) {
  if (!CF_URL || !CF_SECRET) return;
  try {
    const res = await tryPostCeoIngestOnce(type, payload);
    if (res.ok) {
      console.log('[CF] Pushed:', type, payload.emp_id || '');
      ingestStats.pushOk += 1;
      ingestStats.lastSuccessAt = Date.now();
      void drainCeoIngestQueue();
      return;
    }
    const txt = await res.text();
    const snip = txt.slice(0, 160);
    if (res.status === 401 || res.status === 403) {
      ingestStats.pushAuthRejected += 1;
      ingestStats.lastAuthError = { ts: Date.now(), status: res.status, snippet: snip };
      console.warn('[CF] Auth rejected (queued; fix CF_INGEST_SECRET):', type, res.status, snip);
      appendCeoIngestFailed(type, payload, { reasonStatus: res.status, reason: 'auth' });
      ingestEvents.emit('auth-error', ingestStats.lastAuthError);
      return;
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      ingestStats.pushPermanentRejected += 1;
      ingestStats.lastPermanentError = { ts: Date.now(), status: res.status, snippet: snip, type };
      console.warn('[CF] Push permanently rejected (recorded):', type, res.status, snip);
      appendCeoIngestRejected(type, payload, res.status, snip);
      ingestEvents.emit('permanent-error', ingestStats.lastPermanentError);
      return;
    }
    ingestStats.lastTransientError = { ts: Date.now(), status: res.status, snippet: snip };
    console.warn('[CF] Push failed (queued for retry):', type, res.status, snip);
    appendCeoIngestFailed(type, payload, { reasonStatus: res.status, reason: 'transient' });
  } catch (e) {
    ingestStats.lastTransientError = { ts: Date.now(), status: 0, snippet: e && e.message ? e.message : String(e) };
    console.warn('[CF] Push error (queued for retry):', e.message);
    appendCeoIngestFailed(type, payload, { reason: 'network', error: ingestStats.lastTransientError.snippet });
  }
}

// ─── SHIFT-WINDOW (WORKING HOURS) ─────────────────────────────────────────────
// Single source of truth lives on the Cloudflare worker (D1 worker_settings.working_hours_v1).
// We cache it locally and fall back to a static mirror of cloud's defaultWorkingHoursConfig().
const WORKING_HOURS_WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function defaultWorkingHoursConfigLocal() {
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

let WORKING_HOURS_CACHE = defaultWorkingHoursConfigLocal();
let WORKING_HOURS_LAST_FETCH_OK_AT = 0;

function getWorkingHoursConfigLocal() {
  return WORKING_HOURS_CACHE || defaultWorkingHoursConfigLocal();
}

function parseHHMMToMinuteLocal(text) {
  const s = String(text || '').trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function weekdayKeyInTz(epochSec, tz) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    .format(new Date(epochSec * 1000))
    .toLowerCase()
    .slice(0, 3);
  return WORKING_HOURS_WEEKDAY_KEYS.includes(wd) ? wd : 'sun';
}

function minuteOfDayInTz(epochSec, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSec * 1000));
  const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
  const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
  return hh * 60 + mm;
}

function windowsForDay(config, weekdayKey) {
  const arr = config && config.days && Array.isArray(config.days[weekdayKey]) ? config.days[weekdayKey] : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const win = arr[i] || [];
    const st = parseHHMMToMinuteLocal(win[0]);
    const en = parseHHMMToMinuteLocal(win[1]);
    if (st == null || en == null || en <= st) continue;
    out.push([st, en]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

function isInWorkingWindow(epochSec, config) {
  const cfg = config || getWorkingHoursConfigLocal();
  const tz = (cfg && cfg.timezone) || 'Asia/Dubai';
  const k = weekdayKeyInTz(epochSec, tz);
  const minute = minuteOfDayInTz(epochSec, tz);
  const windows = windowsForDay(cfg, k);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (minute >= w[0] && minute < w[1]) return true;
  }
  return false;
}

/** Sum of seconds inside [startSec, endSec] that overlap any of the configured shift windows. */
function overlapSecWithWindows(startSec, endSec, config) {
  const cfg = config || getWorkingHoursConfigLocal();
  const st = Math.floor(Number(startSec) || 0);
  const en = Math.floor(Number(endSec) || 0);
  if (en <= st) return 0;
  let total = 0;
  // Walk minute-by-minute; cheap and exact for the durations we deal with (max 24h).
  for (let t = st; t < en; t += 60) {
    const t2 = Math.min(en, t + 60);
    if (isInWorkingWindow(t, cfg)) total += (t2 - t);
  }
  return total;
}

async function refreshWorkingHoursFromCloud() {
  if (!CF_URL || !CF_SECRET) return;
  try {
    const base = String(CF_URL || '').replace(/\/+$/, '');
    const url = base + '/api/settings/working-hours';
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + CF_SECRET,
        'X-Ingest-Secret': CF_SECRET,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn('[working-hours] Worker HTTP', res.status, '— keeping cached config');
      return;
    }
    const j = await res.json();
    if (!j || !j.ok || !j.working_hours) return;
    const wh = j.working_hours;
    if (!wh || !wh.days || typeof wh.days !== 'object') return;
    WORKING_HOURS_CACHE = wh;
    WORKING_HOURS_LAST_FETCH_OK_AT = Date.now();
  } catch (e) {
    console.warn('[working-hours] refresh failed (non-fatal):', e.message);
  }
}

/**
 * Flush buffered CEO ingest events (oldest first). Safe to call often; uses rename + replay.
 * Worker uses INSERT OR IGNORE / REPLACE so duplicates after a crash recovery are acceptable.
 */
async function drainCeoIngestQueue() {
  if (!CF_URL || !CF_SECRET) return;
  if (ceoQueueFlushRunning) return;
  if (!fs.existsSync(CEO_QUEUE_FILE) || fs.statSync(CEO_QUEUE_FILE).size === 0) {
    ceoIngestPendingCount = 0;
    noteQueueDepthChanged();
    return;
  }

  ceoQueueFlushRunning = true;
  ingestStats.drainAttempts += 1;
  const failed = [];
  let drained = 0;
  let droppedClientError = 0;
  try {
    try {
      fs.renameSync(CEO_QUEUE_FILE, CEO_QUEUE_DRAIN);
    } catch (e) {
      console.warn('[ceo-queue] rename skip:', e.message);
      return;
    }
    const raw = fs.readFileSync(CEO_QUEUE_DRAIN, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      let rec;
      try {
        rec = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (!rec || rec.v !== 1 || !rec.type || rec.payload == null) continue;
      try {
        const res = await tryPostCeoIngestOnce(rec.type, rec.payload);
        if (!res.ok) {
          const st = res.status;
          if (st === 401 || st === 403) {
            /** Auth error during drain — preserve everything until secret is fixed. */
            ingestStats.pushAuthRejected += 1;
            ingestStats.lastAuthError = { ts: Date.now(), status: st, snippet: 'drain' };
            console.warn('[ceo-queue] Auth error during drain (preserving queue):', rec.type, st);
            failed.push(rec);
            ingestEvents.emit('auth-error', ingestStats.lastAuthError);
            continue;
          }
          if (st >= 400 && st < 500 && st !== 408 && st !== 429) {
            const snip = await safeReadText(res);
            console.warn('[ceo-queue] Drop on replay (client error):', rec.type, st);
            droppedClientError += 1;
            ingestStats.pushPermanentRejected += 1;
            ingestStats.lastPermanentError = { ts: Date.now(), status: st, type: rec.type, snippet: snip };
            appendCeoIngestRejected(rec.type, rec.payload, st, snip);
            ingestEvents.emit('permanent-error', ingestStats.lastPermanentError);
            continue;
          }
          failed.push(rec);
        } else {
          drained += 1;
        }
      } catch {
        failed.push(rec);
      }
    }
    if (failed.length) {
      const body = failed.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n';
      fs.appendFileSync(CEO_QUEUE_FILE, body, 'utf8');
    } else {
      ingestStats.drainSuccess += 1;
    }
    if (drained > 0) {
      ingestStats.lastSuccessAt = Date.now();
    }
    if (droppedClientError > 0 || failed.length > 0) {
      ingestStats.drainHardFailures += droppedClientError;
    }
    fs.unlinkSync(CEO_QUEUE_DRAIN);
  } catch (e) {
    console.error('[ceo-queue] drain error:', e.message);
    try {
      if (fs.existsSync(CEO_QUEUE_DRAIN)) {
        if (!fs.existsSync(CEO_QUEUE_FILE)) {
          fs.renameSync(CEO_QUEUE_DRAIN, CEO_QUEUE_FILE);
        } else {
          const chunk = fs.readFileSync(CEO_QUEUE_DRAIN, 'utf8');
          if (chunk.trim()) {
            fs.appendFileSync(CEO_QUEUE_FILE, chunk.endsWith('\n') ? chunk : chunk + '\n', 'utf8');
          }
          fs.unlinkSync(CEO_QUEUE_DRAIN);
        }
      }
    } catch (_) {}
  } finally {
    ceoQueueFlushRunning = false;
    syncCeoPendingCountFromDisk();
    noteQueueDepthChanged();
  }
}

async function safeReadText(res) {
  try { return (await res.text()).slice(0, 240); } catch (_) { return null; }
}
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================
// MASTER CLOUD STATE (In-Memory Database)
// ============================================================
const DEFAULT_EMPLOYEES = [
  {id:'e1', emp_no:109, ac_no:1,  name:'Misbah',        code:'EMP109', barcode:'00000109', process:'Tailor (01)',   color:'#6a5fc1', initials:'MI', photo:'uploads/Misbah.jpeg'},
  {id:'e2', emp_no:110, ac_no:2,  name:'Cyril',         code:'EMP110', barcode:'00000110', process:'Tailor (02)', color:'#a78bfa', initials:'CY'},
  {id:'e3', emp_no:111, ac_no:3,  name:'Irfan',         code:'EMP111', barcode:'00000111', process:'Hand Work', color:'#c2ef4e', initials:'IR'},
  {id:'e4', emp_no:112, ac_no:4,  name:'Mohammed',      code:'EMP112', barcode:'00000112', process:'Stone Work',   color:'#ffb287', initials:'MO'},
  {id:'e5', emp_no:113, ac_no:5,  name:'Mojeeb',        code:'EMP113', barcode:'00000113', process:'Button', color:'#fa7faa', initials:'MO'},
  {id:'e6', emp_no:114, ac_no:6,  name:'Sheron',        code:'EMP114', barcode:'00000114', process:'Embroidery', color:'#14b8a6', initials:'SH'},
  {id:'e7', emp_no:115, ac_no:7,  name:'Arif',          code:'EMP115', barcode:'00000115', process:'Ari Work',   color:'#ffb287', initials:'AR'},
  {id:'e8', emp_no:116, ac_no:8,  name:'Ridowan',       code:'EMP116', barcode:'00000116', process:'Hand Designing', color:'#ef4444', initials:'RI'},
  {id:'e9', emp_no:117, ac_no:9,  name:'Amirull',       code:'EMP117', barcode:'00000117', process:'Tailor (01)', color:'#8b5cf6', initials:'AM'},
  {id:'e10',emp_no:118, ac_no:10, name:'Arman',         code:'EMP118', barcode:'00000118', process:'Tailor (02)',   color:'#14b8a6', initials:'AR'},
  {id:'e11',emp_no:119, ac_no:11, name:'Shahid',        code:'EMP119', barcode:'00000119', process:'Hand Work', color:'#ffb287', initials:'SH'},
  {id:'e12',emp_no:120, ac_no:12, name:'Shabaj',        code:'EMP120', barcode:'00000120', process:'Stone Work', color:'#6a5fc1', initials:'SH'},
  {id:'e13',emp_no:121, ac_no:13, name:'Alazar',        code:'EMP121', barcode:'00000121', process:'Button',   color:'#fa7faa', initials:'AL'},
  {id:'e14',emp_no:122, ac_no:14, name:'Hafiz',         code:'EMP122', barcode:'00000122', process:'Embroidery', color:'#a78bfa', initials:'HA'},
  {id:'e15',emp_no:123, ac_no:15, name:'Anasari',       code:'EMP123', barcode:'00000123', process:'Ari Work', color:'#c2ef4e', initials:'AN'},
  {id:'e16',emp_no:124, ac_no:16, name:'Maishad',       code:'EMP124', barcode:'00000124', process:'Hand Designing',   color:'#14b8a6', initials:'MA'},
  {id:'e17',emp_no:125, ac_no:17, name:'Mouthirrahman', code:'EMP125', barcode:'00000125', process:'Invoice maker', color:'#c2ef4e', initials:'MO'},
  {id:'e19',emp_no:128, ac_no:19, name:'Ibrahim',       code:'EMP128', barcode:'00000128', process:'Packaging', color:'#79628c', initials:'IB'},
  {id:'e20',emp_no:129, ac_no:20, name:'Farhan',        code:'EMP129', barcode:'00000129', process:'Checker',   color:'#6a5fc1', initials:'FA'},
  {id:'e21',emp_no:130, ac_no:21, name:'Naserulla',     code:'EMP130', barcode:'00000130', process:'Cutting master', color:'#14b8a6', initials:'NA'},
  {id:'e22',emp_no:131, ac_no:22, name:'Mamush',        code:'EMP131', barcode:'00000131', process:'Button', color:'#ffb287', initials:'MA'},
  {id:'e23',emp_no:132, ac_no:23, name:'Wasim',         code:'EMP132', barcode:'00000132', process:'Embroidery',   color:'#6a5fc1', initials:'WA'},
  {id:'e24',emp_no:133, ac_no:24, name:'Anwar',         code:'EMP133', barcode:'00000133', process:'Ari Work', color:'#fa7faa', initials:'AN'},
  {id:'e25',emp_no:134, ac_no:25, name:'Raees',         code:'EMP134', barcode:'00000134', process:'Hand Designing', color:'#a78bfa', initials:'RA'},
  {id:'e26',emp_no:135, ac_no:26, name:'ArmanAnasari',  code:'EMP135', barcode:'00000135', process:'Tailor (01)',   color:'#c2ef4e', initials:'AR'},
];
let EMPLOYEES = DEFAULT_EMPLOYEES.slice();

const DEFAULT_ABAYA_CATALOG = [
  {id:'a1', code:'AB-0041',barcode:'AB00000041',design:'Classic Black Bisht',    process:'Cutting master',    tier:'Standard',   icon: ''},
  {id:'a2', code:'AB-0042',barcode:'AB00000042',design:'Embroidered Ceremonial', process:'Tailor (02)',    tier:'Premium',    icon: ''},
  {id:'a3', code:'AB-0043',barcode:'AB00000043',design:'Casual Linen Blend',     process:'Hand Work',     tier:'Plain Abaya',icon: ''},
  {id:'a4', code:'AB-0044',barcode:'AB00000044',design:'Royal Velvet Edition',   process:'Stone Work',    tier:'Luxury',     icon: ''},
  {id:'a5', code:'AB-0045',barcode:'AB00000045',design:'Minimal White Abaya',    process:'Button',        tier:'Plain Abaya',icon: ''},
  {id:'a6', code:'AB-0046',barcode:'AB00000046',design:'Sport Performance',      process:'Embroidery',    tier:'Standard',   icon: ''},
  {id:'a7', code:'AB-0047',barcode:'AB00000047',design:'Heritage Embossed',      process:'Ari Work',      tier:'Premium',    icon: ''},
  {id:'a8', code:'AB-0048',barcode:'AB00000048',design:'Silk Ceremonial',        process:'Hand Designing',tier:'Luxury',     icon: ''},
  {id:'a9', code:'AB-0049',barcode:'AB00000049',design:'Invoice batch',          process:'Invoice maker', tier:'',           icon: ''},
  {id:'a10',code:'AB-0050',barcode:'AB00000050',design:'Packaging queue',        process:'Packaging',     tier:'',           icon: ''},
  {id:'a11',code:'AB-0051',barcode:'AB00000051',design:'QC inspection lot',      process:'Checker',       tier:'',           icon: ''},
];

let abayaCatalog = DEFAULT_ABAYA_CATALOG.map(function (a) {
  return { id: a.id, code: a.code, barcode: a.barcode, design: a.design, process: a.process, icon: a.icon || '' };
});
let catalogCloudVersion = 'local';
/** Bumped on every employee directory change (xlsx, API, photo upload) — clients poll + socket. */
let employeesDataVersion = 0;
let lastEmployeesXlsxMtime = 0;
let lastCatalogXlsxMtime = 0;
/** True after cold start restored dashboard logs/perf from disk (24h window). */
let offlineReportRestored = false;

function emitEmployeesChanged() {
  employeesDataVersion += 1;
  io.emit('employees_update', { count: EMPLOYEES.length, version: employeesDataVersion });
}

/** Master list for kiosk role buttons, employee default process, asset-upload (matches public/data.js defaults). */
const DEFAULT_FACTORY_WORK_TYPES = [
  'Tailor (01)',
  'Cutting master',
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
const WORK_TYPES_JSON_PATH = path.join(__dirname, 'data', 'work-types.json');
let FACTORY_WORK_TYPES = DEFAULT_FACTORY_WORK_TYPES.slice();
let workTypesDataVersion = 0;

function loadFactoryWorkTypesFromDisk() {
  try {
    fs.mkdirSync(path.dirname(WORK_TYPES_JSON_PATH), { recursive: true });
    if (!fs.existsSync(WORK_TYPES_JSON_PATH)) {
      fs.writeFileSync(WORK_TYPES_JSON_PATH, JSON.stringify(DEFAULT_FACTORY_WORK_TYPES, null, 2), 'utf8');
      FACTORY_WORK_TYPES = DEFAULT_FACTORY_WORK_TYPES.slice();
      console.log('[work-types] Created default file', WORK_TYPES_JSON_PATH);
      return;
    }
    const raw = JSON.parse(fs.readFileSync(WORK_TYPES_JSON_PATH, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) {
      FACTORY_WORK_TYPES = DEFAULT_FACTORY_WORK_TYPES.slice();
      console.warn('[work-types] Invalid or empty array in file — using defaults');
      return;
    }
    FACTORY_WORK_TYPES = raw.map(function (s) {
      return String(s == null ? '' : s).trim();
    }).filter(Boolean);
    console.log('[work-types] Loaded', FACTORY_WORK_TYPES.length, 'types from disk');
  } catch (e) {
    console.warn('[work-types] Load failed — using defaults:', e.message);
    FACTORY_WORK_TYPES = DEFAULT_FACTORY_WORK_TYPES.slice();
  }
}

function isProcessAllowedOnFactory(processName) {
  const t = String(processName == null ? '' : processName).trim();
  if (!t) return false;
  for (let i = 0; i < FACTORY_WORK_TYPES.length; i++) {
    if (FACTORY_WORK_TYPES[i] === t) return true;
  }
  return false;
}

/**
 * @returns {{ ok: true, normalized: string[] }|{ ok: false, error: string }}
 */
function validateFactoryWorkTypesReplace(rawList) {
  const MAX_LEN = 80;
  const MAX_COUNT = 64;
  if (!Array.isArray(rawList)) {
    return { ok: false, error: 'workTypes must be an array of strings' };
  }
  const normalized = [];
  const seen = new Set();
  for (let i = 0; i < rawList.length; i++) {
    const t = String(rawList[i] == null ? '' : rawList[i]).trim();
    if (!t) {
      return { ok: false, error: 'Empty process name is not allowed (check row ' + (i + 1) + ')' };
    }
    if (t.length > MAX_LEN) {
      return { ok: false, error: 'Process name too long (max ' + MAX_LEN + ' chars): ' + t.slice(0, 40) + '…' };
    }
    if (seen.has(t)) {
      return { ok: false, error: 'Duplicate process name: ' + t };
    }
    seen.add(t);
    normalized.push(t);
  }
  if (normalized.length === 0) {
    return { ok: false, error: 'At least one work type is required' };
  }
  if (normalized.length > MAX_COUNT) {
    return { ok: false, error: 'Too many work types (max ' + MAX_COUNT + ')' };
  }
  const set = new Set(normalized);
  for (let ei = 0; ei < EMPLOYEES.length; ei++) {
    const p = String(EMPLOYEES[ei].process == null ? '' : EMPLOYEES[ei].process).trim();
    if (p && !set.has(p)) {
      return {
        ok: false,
        error:
          'Cannot save: employee "' +
          (EMPLOYEES[ei].name || EMPLOYEES[ei].id) +
          '" still uses process "' +
          p +
          '" which is not in the new list. Add that name to the list or change the employee first.',
      };
    }
  }
  const activeIds = Object.keys(ACTIVE_SESSIONS);
  for (let ai = 0; ai < activeIds.length; ai++) {
    const sess = ACTIVE_SESSIONS[activeIds[ai]];
    if (!sess) continue;
    const sp = String(sess.process == null ? '' : sess.process).trim();
    if (sp && !set.has(sp)) {
      return {
        ok: false,
        error:
          'Cannot save: an active session uses process "' +
          sp +
          '". Finish that session or include this name in the new list.',
      };
    }
  }
  return { ok: true, normalized: normalized };
}

function saveFactoryWorkTypesToDisk(nextList) {
  const dir = path.dirname(WORK_TYPES_JSON_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.work-types.json.tmp.' + process.pid + '.' + Date.now());
  fs.writeFileSync(tmp, JSON.stringify(nextList, null, 2), 'utf8');
  try {
    fs.unlinkSync(WORK_TYPES_JSON_PATH);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  fs.renameSync(tmp, WORK_TYPES_JSON_PATH);
  FACTORY_WORK_TYPES = nextList.slice();
  workTypesDataVersion += 1;
}

function emitWorkTypesChanged() {
  io.emit('work_types_update', {
    workTypes: FACTORY_WORK_TYPES.slice(),
    version: workTypesDataVersion,
  });
  io.emit('sync_versions', getClientSyncPayload());
}

function getClientSyncPayload() {
  const persistence = getPersistenceHealth();
  const reconcile = getReconcileHealth();
  const sqliteSnapshot = getSqliteSnapshotHealth();
  const ingestStatsNow = getIngestStats();
  return {
    ok: true,
    appVersion: APP_PACKAGE_VERSION,
    serverStartedAt: SERVER_STARTED_AT,
    catalogVersion: catalogCloudVersion,
    employeesVersion: employeesDataVersion,
    catalogRows: abayaCatalog.length,
    employeeRows: EMPLOYEES.length,
    ceoIngestCloud: !!(CF_URL && CF_SECRET),
    ceoSyncMode: getCeoSyncMode(),
    ceoIngestPending: ceoIngestPendingCount,
    offlineReportRestored: offlineReportRestored,
    persistence: persistence,
    database: {
      source: 'local-memory',
      cloudConfigured: !!(CF_URL && CF_SECRET),
      syncMode: getCeoSyncMode(),
      pendingQueue: ceoIngestPendingCount,
      rejectedQueue: getRejectedQueueStats(),
      reconcile: reconcile,
      sqliteSnapshot: sqliteSnapshot,
      ingestStats: ingestStatsNow,
      alerts: getAlertHealth(),
    },
    working_hours: getWorkingHoursConfigLocal(),
    working_hours_synced_at: WORKING_HOURS_LAST_FETCH_OK_AT,
    workTypesVersion: workTypesDataVersion,
    workTypes: FACTORY_WORK_TYPES.slice(),
  };
}

function normalizeAbayaCatalogRows(rows) {
  return rows.map(function (a) {
    return {
      id: String(a.id),
      code: String(a.code),
      barcode: String(a.barcode),
      design: String(a.design != null ? a.design : ''),
      process: String(a.process != null ? a.process : ''),
      tier: a.tier != null ? String(a.tier) : '',
      icon: a.icon != null ? String(a.icon) : '',
    };
  });
}

async function refreshAbayaCatalogFromCloud() {
  if (!CF_URL) return;
  try {
    const res = await fetch(CF_URL + '/api/catalog/abayas', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn('[catalog] Worker HTTP', res.status);
      return;
    }
    const j = await res.json();
    if (!j.ok || !Array.isArray(j.abayas)) return;
    const ver = j.version != null ? String(j.version) : '0';
    if (j.abayas.length === 0 && ver === '0') {
      return;
    }
    const prev = catalogCloudVersion;
    abayaCatalog = normalizeAbayaCatalogRows(j.abayas);
    attachItemImagesFromDisk();
    catalogCloudVersion = ver;
    if (prev !== catalogCloudVersion) {
      io.emit('catalog_update', { version: catalogCloudVersion });
    }
  } catch (e) {
    console.warn('[catalog] refresh failed (non-fatal):', e.message);
  }
}

let ACTIVE_SESSIONS = {};
let COMPLETED_LOGS = [];
let EMP_PERF = EMPLOYEES.map(e => ({id: e.id, units: 0, eff: 0, act: 0, idl: 0}));

const STATE_LOG_WINDOW_MS = Math.max(
  60000,
  Number(process.env.STATE_LOG_WINDOW_MS) > 0 ? Number(process.env.STATE_LOG_WINDOW_MS) : 24 * 60 * 60 * 1000
);
const STATE_LOG_MAX_ROWS = Math.max(
  100,
  Number(process.env.STATE_LOG_MAX_ROWS) > 0 ? Number(process.env.STATE_LOG_MAX_ROWS) : 20000
);
const OFFLINE_RESTORE_MAX_AGE_MS = parseEnvPositiveIntOrNull('OFFLINE_RESTORE_MAX_AGE_MS');
const OFFLINE_LOG_WINDOW_MS = parseEnvPositiveIntOrNull('OFFLINE_LOG_WINDOW_MS');
const OFFLINE_SNAPSHOT_RETENTION_DAYS = parseEnvPositiveIntOrNull('OFFLINE_SNAPSHOT_RETENTION_DAYS');
/** Default 48h; override with RESTORE_ACTIVE_SESSION_MAX_AGE_MS (positive integer, ms). */
const RESTORE_ACTIVE_SESSION_DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

let AC_MAP = {};
function rebuildACMap() {
  AC_MAP = {};
  const seenAc = new Set();
  EMPLOYEES.forEach((e) => {
    if (seenAc.has(e.ac_no)) {
      console.warn('[ac-map] Duplicate ac_no', e.ac_no, '(' + (e.name || e.id) + ') — last row wins for fingerprint lookup');
    }
    seenAc.add(e.ac_no);
    AC_MAP[e.ac_no] = e;
  });
}
rebuildACMap();
const OFFLINE_REPORT_DIR_RESOLVED = offlineReportStore.defaultDir();

function checkPathWritable(targetPath) {
  try {
    fs.mkdirSync(targetPath, { recursive: true });
    fs.accessSync(targetPath, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function getPersistenceHealth() {
  const offlineDir = OFFLINE_REPORT_DIR_RESOLVED;
  const queueDir = path.dirname(CEO_QUEUE_FILE);
  const sqliteDir = sqliteSnapshot.defaultDir();
  return {
    offlineReportDir: offlineDir,
    offlineReportDirWritable: checkPathWritable(offlineDir),
    offlineSnapshotFile: path.join(offlineDir, offlineReportStore.LATEST_NAME),
    ceoQueueDir: queueDir,
    ceoQueueDirWritable: checkPathWritable(queueDir),
    ceoQueueFile: CEO_QUEUE_FILE,
    sqliteSnapshotDir: sqliteDir,
    sqliteSnapshotDirWritable: checkPathWritable(sqliteDir),
    sqliteSnapshotFile: path.join(sqliteDir, sqliteSnapshot.LATEST_NAME),
  };
}

/**
 * Restore ACTIVE_SESSIONS from disk snapshot (employee must exist; session not stale).
 * @param {Record<string, unknown>} activeRaw
 * @param {{ now?: number }} [opts]
 * @returns {Record<string, { emp_id: string, abaya_id: string, log_id: string, started_at: number, process: string }>}
 */
function reviveActiveSessionsFromSnapshot(activeRaw, opts) {
  const now = opts && opts.now != null ? opts.now : Date.now();
  const envMax = parseEnvPositiveIntOrNull('RESTORE_ACTIVE_SESSION_MAX_AGE_MS');
  const maxAgeMs = envMax != null ? envMax : RESTORE_ACTIVE_SESSION_DEFAULT_MAX_AGE_MS;
  const ids = new Set(EMPLOYEES.map(function (e) {
    return String(e.id);
  }));
  /** @type {Record<string, { emp_id: string, abaya_id: string, log_id: string, started_at: number, process: string }>} */
  const out = {};
  if (!activeRaw || typeof activeRaw !== 'object') return out;

  Object.keys(activeRaw).forEach(function (key) {
    const sess = activeRaw[key];
    if (!sess || typeof sess !== 'object') return;
    const empId =
      'emp_id' in sess && sess.emp_id != null && String(sess.emp_id).trim() !== ''
        ? String(sess.emp_id).trim()
        : String(key);
    if (!ids.has(empId)) {
      console.warn('[offline-report] Skipping restored session for unknown employee id', empId);
      return;
    }
    const started = Number(sess.started_at);
    if (!Number.isFinite(started) || now - started > maxAgeMs || started > now + 60000) {
      console.warn(
        '[offline-report] Dropping restored active session for',
        empId,
        '(invalid or stale started_at)'
      );
      return;
    }
    const empRow = EMPLOYEES.find(function (e) {
      return String(e.id) === empId;
    });
    const procFromSess = String(sess.process != null ? sess.process : '').trim();
    const proc =
      procFromSess ||
      (empRow ? String(empRow.process != null ? empRow.process : '').trim() : '') ||
      'Tailor (01)';
    const abayaId =
      'abaya_id' in sess && sess.abaya_id != null && String(sess.abaya_id).trim() !== ''
        ? String(sess.abaya_id).trim()
        : '';
    const logIdRaw = 'log_id' in sess && sess.log_id != null ? String(sess.log_id).trim() : '';
    const log_id = logIdRaw || 'WL-' + empId + '-' + started;
    out[empId] = {
      emp_id: empId,
      abaya_id: abayaId,
      log_id: log_id,
      started_at: started,
      process: proc,
    };
  });
  return out;
}

(function restoreOfflineDashboardFromDisk() {
  const snap = offlineReportStore.loadRestorableSnapshot({
    maxAgeMs: OFFLINE_RESTORE_MAX_AGE_MS,
    logWindowMs: OFFLINE_LOG_WINDOW_MS,
  });
  if (!snap) return;

  const hasLogs = Array.isArray(snap.logs) && snap.logs.length > 0;
  const activeRaw =
    snap.active && typeof snap.active === 'object' ? snap.active : {};
  const hasPerf = Array.isArray(snap.perf) && snap.perf.length > 0;
  const hasActiveIncoming = Object.keys(activeRaw).length > 0;

  if (!hasLogs && !hasActiveIncoming && !hasPerf) return;

  if (hasLogs) {
    COMPLETED_LOGS = snap.logs.slice();
  }

  if (hasPerf) {
    const byId = new Map(snap.perf.map((p) => [String(p.id), p]));
    EMP_PERF = EMP_PERF.map(function (e) {
      const p = byId.get(String(e.id));
      if (!p) return e;
      return {
        id: e.id,
        units: Number(p.units) || 0,
        eff: Number(p.eff) || 0,
        act: Number(p.act) || 0,
        idl: Number(p.idl) || 0,
      };
    });
  }

  let revivedActive = 0;
  if (hasActiveIncoming) {
    ACTIVE_SESSIONS = reviveActiveSessionsFromSnapshot(activeRaw, {});
    revivedActive = Object.keys(ACTIVE_SESSIONS).length;
  }

  offlineReportRestored = true;
  console.log(
    '[offline-report] Restored snapshot:',
    COMPLETED_LOGS.length,
    'completed log row(s);',
    revivedActive,
    'active session(s) from disk'
  );
})();

function filterCompletedLogs(logs, sinceMs, maxRows) {
  const acc = [];
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    if (!l || typeof l.end !== 'number') continue;
    if (sinceMs == null || l.end >= sinceMs) acc.push(l);
  }
  if (acc.length > maxRows) return acc.slice(acc.length - maxRows);
  return acc;
}

function parseStateSinceMs(qSince, now) {
  const n = parseInt(String(qSince || ''), 10);
  if (Number.isFinite(n) && n > 0) return Math.min(now, n);
  return null;
}

function parseStateLimit(qLimit) {
  const n = parseInt(String(qLimit || ''), 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, STATE_LOG_MAX_ROWS);
  return null;
}

/**
 * Bounded logs for HTTP + Socket.IO (default: last STATE_LOG_WINDOW_MS, cap STATE_LOG_MAX_ROWS).
 * Optional query: ?since=<epoch_ms>&limit=<n>
 */
function getRealtimeStateBundle(req) {
  const now = Date.now();
  const q = req && req.query ? req.query : {};
  let sinceMs = parseStateSinceMs(q.since, now);
  if (sinceMs == null) sinceMs = now - STATE_LOG_WINDOW_MS;
  let maxRows = parseStateLimit(q.limit);
  if (maxRows == null) maxRows = STATE_LOG_MAX_ROWS;

  let inWindowBeforeCap = 0;
  for (let i = 0; i < COMPLETED_LOGS.length; i++) {
    const l = COMPLETED_LOGS[i];
    if (l && typeof l.end === 'number' && l.end >= sinceMs) inWindowBeforeCap += 1;
  }

  const logsFiltered = filterCompletedLogs(COMPLETED_LOGS, sinceMs, maxRows);
  const truncated = inWindowBeforeCap > logsFiltered.length;

  return {
    active: ACTIVE_SESSIONS,
    logs: logsFiltered,
    perf: EMP_PERF,
    generated_at: now,
    state_meta: {
      source: 'factory-server-local-memory',
      cloudConfigured: !!(CF_URL && CF_SECRET),
      syncMode: getCeoSyncMode(),
      pendingQueue: ceoIngestPendingCount,
      logs_total_in_memory: COMPLETED_LOGS.length,
      logs_returned: logsFiltered.length,
      logs_in_window_before_cap: inWindowBeforeCap,
      logs_truncated: truncated,
      logs_since_ms: sinceMs,
      restored_from_offline_cache: offlineReportRestored,
    },
    workTypes: FACTORY_WORK_TYPES.slice(),
    workTypesVersion: workTypesDataVersion,
  };
}

function persistOfflineDashboardReport() {
  try {
    const now = Date.now();
    const since = OFFLINE_LOG_WINDOW_MS != null ? now - OFFLINE_LOG_WINDOW_MS : null;
    const logs = filterCompletedLogs(COMPLETED_LOGS, since, STATE_LOG_MAX_ROWS);
    offlineReportStore.saveSnapshot({
      version: 1,
      savedAt: now,
      windowStartMs: since != null ? since : 0,
      windowEndMs: now,
      summary: {
        completedSessionsInWindow: logs.length,
        activeSessionsCount: Object.keys(ACTIVE_SESSIONS).length,
      },
      logs: logs,
      perf: EMP_PERF,
      active: ACTIVE_SESSIONS,
    }, undefined, {
      retentionDays: OFFLINE_SNAPSHOT_RETENTION_DAYS,
    });
  } catch (e) {
    console.warn('[offline-report] save failed:', e.message);
  }
}

const SQLITE_SNAPSHOT_ENABLED = (() => {
  const raw = String(process.env.SQLITE_SNAPSHOT_ENABLED || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return true;
})();
const SQLITE_SNAPSHOT_INTERVAL_MS = (() => {
  const v = parseEnvPositiveIntOrNull('SQLITE_SNAPSHOT_INTERVAL_MS');
  return v != null ? Math.max(30 * 1000, v) : 5 * 60 * 1000;
})();
const SQLITE_SNAPSHOT_RETENTION_DAYS = parseEnvPositiveIntOrNull('SQLITE_SNAPSHOT_RETENTION_DAYS');
const SQLITE_SNAPSHOT_DIR_RESOLVED = sqliteSnapshot.defaultDir();
let _sqliteSnapshotInFlight = false;
let _sqliteSnapshotPending = false;
let _sqliteSnapshotLastOk = null;
let _sqliteSnapshotLastErr = null;

function buildSqliteSnapshotState() {
  return {
    activeSessions: ACTIVE_SESSIONS,
    completedLogs: COMPLETED_LOGS,
    employees: EMPLOYEES,
    perf: EMP_PERF,
    catalog: abayaCatalog,
    catalogVersion: catalogCloudVersion,
    workerSettings: { working_hours: WORKING_HOURS_CACHE || null },
    appVersion: APP_PACKAGE_VERSION,
    savedAt: Date.now(),
  };
}

/**
 * Build a real .db snapshot mirroring the Cloudflare D1 schema.
 * Coalesces concurrent calls so we never run two builds in parallel.
 */
function persistSqliteSnapshot() {
  if (!SQLITE_SNAPSHOT_ENABLED) return Promise.resolve(null);
  if (_sqliteSnapshotInFlight) {
    _sqliteSnapshotPending = true;
    return Promise.resolve(null);
  }
  _sqliteSnapshotInFlight = true;
  const state = buildSqliteSnapshotState();
  return sqliteSnapshot
    .writeSnapshot(state, {
      dir: SQLITE_SNAPSHOT_DIR_RESOLVED,
      archive: true,
      retentionDays: SQLITE_SNAPSHOT_RETENTION_DAYS,
    })
    .then((info) => {
      _sqliteSnapshotLastOk = { at: Date.now(), info };
      return info;
    })
    .catch((err) => {
      _sqliteSnapshotLastErr = { at: Date.now(), message: err && err.message ? err.message : String(err) };
      console.warn('[sqlite-snapshot] save failed:', _sqliteSnapshotLastErr.message);
      return null;
    })
    .finally(() => {
      _sqliteSnapshotInFlight = false;
      if (_sqliteSnapshotPending) {
        _sqliteSnapshotPending = false;
        setImmediate(() => { void persistSqliteSnapshot(); });
      }
    });
}

function getSqliteSnapshotHealth() {
  return {
    enabled: SQLITE_SNAPSHOT_ENABLED,
    dir: SQLITE_SNAPSHOT_DIR_RESOLVED,
    intervalMs: SQLITE_SNAPSHOT_INTERVAL_MS,
    retentionDays: SQLITE_SNAPSHOT_RETENTION_DAYS,
    lastOk: _sqliteSnapshotLastOk,
    lastErr: _sqliteSnapshotLastErr,
  };
}

const RECONCILE_ENABLED = (() => {
  if (!CF_URL || !CF_SECRET) return false;
  const raw = String(process.env.RECONCILE_ENABLED || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return true;
})();
const RECONCILE_INTERVAL_MS = (() => {
  const v = parseEnvPositiveIntOrNull('RECONCILE_INTERVAL_MS');
  return v != null ? Math.max(60 * 1000, v) : 5 * 60 * 1000;
})();
const RECONCILE_MAX_REPUSH = (() => {
  const v = parseEnvPositiveIntOrNull('RECONCILE_MAX_REPUSH_PER_CYCLE');
  return v != null ? Math.min(500, v) : 50;
})();
let reconcileLoopHandle = null;

function getReconcileLocalState() {
  return {
    activeSessions: ACTIVE_SESSIONS,
    completedLogs: COMPLETED_LOGS,
    employees: EMPLOYEES,
    catalog: abayaCatalog,
  };
}

function getReconcileHealth() {
  return {
    enabled: RECONCILE_ENABLED,
    intervalMs: RECONCILE_INTERVAL_MS,
    maxRepushPerCycle: RECONCILE_MAX_REPUSH,
    status: reconcileLoopHandle ? reconcileLoopHandle.getStatus() : null,
  };
}

let alertManager = null;
let alertWiringHandle = null;
function ensureAlertManager() {
  if (alertManager) return alertManager;
  if (!resendAlerts.isEnabled({ apiKey: process.env.RESEND_API_KEY, to: process.env.ALERTS_TO })) {
    return null;
  }
  alertManager = new resendAlerts.AlertManager({
    log: (...args) => console.log('[alerts]', ...args),
    getContext() {
      return {
        host: os.hostname(),
        ceoSyncMode: getCeoSyncMode(),
        pendingQueue: ceoIngestPendingCount,
        lastIngestSuccess: ingestStats.lastSuccessAt,
        snapshotLastOk: _sqliteSnapshotLastOk && _sqliteSnapshotLastOk.at,
        reconcileStatus: reconcileLoopHandle ? reconcileLoopHandle.getStatus() : null,
      };
    },
  });
  alertWiringHandle = resendAlerts.wireServerEvents(alertManager, {
    ingestEvents,
    getReconcileStatus: () => (reconcileLoopHandle ? reconcileLoopHandle.getStatus() : null),
    getSnapshotStatus: () => getSqliteSnapshotHealth(),
    pollIntervalMs: 5 * 60 * 1000,
  });
  return alertManager;
}

function getAlertHealth() {
  if (!alertManager) {
    return {
      enabled: resendAlerts.isEnabled({ apiKey: process.env.RESEND_API_KEY, to: process.env.ALERTS_TO }),
      initialized: false,
    };
  }
  return Object.assign({ initialized: true }, alertManager.getStats());
}

// Broadcast bounded state to all connected dashboard and kiosk clients
function broadcastState() {
  io.emit('state_update', getRealtimeStateBundle());
}

/**
 * Active sessions are not auto-finished when the wall clock leaves shift windows (scheduled
 * breaks, gaps between blocks, overnight). One Start keeps the same abaya + process until the
 * worker taps Finish; duration_sec on finish still uses overlapSecWithWindows in req_finishWork
 * so only configured working hours count. After a break, fingerprint lookup (is_active) resumes
 * the same session without a second Start while the server keeps running.
 */

function logSocketSignal(kind, details) {
  try {
    console.log('[socket]', kind, JSON.stringify(details));
  } catch (e) {
    console.log('[socket]', kind, details);
  }
}

// ============================================================
// WEBSOCKET ROUTES
// ============================================================
io.on('connection', (socket) => {
  const transport = socket.conn && socket.conn.transport ? socket.conn.transport.name : 'unknown';
  logSocketSignal('connect', {
    id: socket.id,
    transport,
    ip: socket.handshake.address || '',
    ua: socket.handshake.headers && socket.handshake.headers['user-agent']
      ? String(socket.handshake.headers['user-agent']).slice(0, 180)
      : '',
  });
  
  // Immediately send current state to the single new client
  socket.emit('state_update', getRealtimeStateBundle());
  socket.emit('sync_versions', getClientSyncPayload());

  socket.on('req_lookup', (ac_no, callback) => {
    var emp = AC_MAP[ac_no];
    if (!emp) return callback({ok:false, error:'No employee found for AC-No. ' + ac_no});
    var is_active = !!ACTIVE_SESSIONS[emp.id];
    var activeSession = is_active ? ACTIVE_SESSIONS[emp.id] : null;
    var abaya_code = null;
    if (activeSession) {
      var abIdx = abayaCatalog.findIndex(a => a.id === activeSession.abaya_id);
      abaya_code = abIdx >= 0 ? abayaCatalog[abIdx].code : null;
    }
    var session_process = activeSession ? activeSession.process : null;
    var session_started_at = activeSession ? Number(activeSession.started_at) : null;
    callback({
      ok:true,
      employee:emp,
      is_active:is_active,
      abaya_code:abaya_code,
      session_process:session_process,
      session_started_at: Number.isFinite(session_started_at) ? session_started_at : null,
    });
  });

  socket.on('req_startWork', (data, callback) => {
    const { emp_id, abaya_id, process: selectedProcess } = data;
    if (ACTIVE_SESSIONS[emp_id]) return callback({ok:false, error:'Already has active session'});

    const nowSec = Math.floor(Date.now() / 1000);
    if (!isInWorkingWindow(nowSec)) {
      return callback({
        ok: false,
        error: 'Outside shift hours. Sessions can only be started within working windows.',
      });
    }

    const emp = EMPLOYEES.find(e => e.id === emp_id);
    const ab  = abayaCatalog.find(a => a.id === abaya_id);
    // Use the role the employee selected on the kiosk, fall back to their default
    const selectedProcessClean = String(selectedProcess != null ? selectedProcess : '').trim();
    const sessionProcess = selectedProcessClean || (emp ? emp.process : 'Tailor (01)');
    if (!isProcessAllowedOnFactory(sessionProcess)) {
      return callback({
        ok: false,
        error: 'Invalid work type. Refresh the page and choose a role from the factory list.',
      });
    }
    const log_id = 'WL-' + emp_id + '-' + Date.now();
    const started_at_sec = nowSec;
    ACTIVE_SESSIONS[emp_id] = { emp_id, abaya_id, log_id, started_at: Date.now(), process: sessionProcess };

    broadcastState();
    setImmediate(persistOfflineDashboardReport);
    callback({ ok: true, log_id });

    // ← Non-blocking push to Cloudflare (fire-and-forget)
    if (emp) {
      pushToCloudflare('session_start', {
        emp_id, emp_name: emp.name, emp_code: emp.code,
        emp_process: sessionProcess, emp_color: emp.color, emp_initials: emp.initials,
        abaya_id, abaya_code: ab ? ab.code : null,
        station: 'S-02', started_at: started_at_sec,
      });
    }
  });

  socket.on('req_finishWork', (payload, callback) => {
    var emp_id = typeof payload === 'object' && payload && payload.emp_id != null
      ? payload.emp_id : payload;
    var invoice_count = typeof payload === 'object' && payload ? payload.invoice_count : undefined;
    var invoice_serial = typeof payload === 'object' && payload ? payload.invoice_serial : undefined;
    var quantity = typeof payload === 'object' && payload ? payload.quantity : undefined;
    var sess = ACTIVE_SESSIONS[emp_id];
    if (!sess) return callback({ok:false, error:'No active session found'});

    if (sess.process === 'Invoice maker') {
      var invParsed = parseInvoiceNumberList(invoice_serial);
      if (!invParsed.ok) return callback({ ok: false, error: invParsed.error });
      var clientIc =
        invoice_count != null && invoice_count !== ''
          ? parseInt(String(invoice_count), 10)
          : NaN;
      if (Number.isFinite(clientIc) && clientIc !== invParsed.nums.length) {
        return callback({
          ok: false,
          error: 'Invoice count does not match the number of invoice numbers in your list.',
        });
      }
      invoice_count = invParsed.nums.length;
      invoice_serial = invParsed.nums.join(',');
    } else {
      invoice_count = undefined;
      invoice_serial = undefined;
    }

    var checker_barcode = '';

    if (sess.process === 'Checker') {
      var qtyParsed =
        quantity != null && quantity !== ''
          ? parseInt(String(quantity), 10)
          : NaN;
      if (!Number.isFinite(qtyParsed) || qtyParsed <= 0) {
        return callback({ ok: false, error: 'Checker quantity must be a positive number.' });
      }
      quantity = qtyParsed;
      var chkRaw =
        typeof payload === 'object' && payload && payload.checker_barcode != null
          ? payload.checker_barcode
          : '';
      var chkParsed = parseCheckerBarcodeList(chkRaw);
      if (!chkParsed.ok) {
        return callback({ ok: false, error: chkParsed.error });
      }
      checker_barcode = chkParsed.normalized;
    } else {
      quantity = undefined;
    }

    var now = Date.now();
    // Count only seconds that fall within configured shift windows so that breaks / off-hours
    // never inflate productivity numbers. start/end timestamps are preserved unchanged.
    var duration_seconds = Math.floor(
      overlapSecWithWindows(Math.floor(sess.started_at / 1000), Math.floor(now / 1000))
    );

    var record = {
      emp_id: emp_id,
      abaya_id: sess.abaya_id,
      process: sess.process,
      start: sess.started_at,
      end: now,
      duration_sec: duration_seconds,
      hour: new Date(now).getHours(),
      invoice_count: invoice_count,
      invoice_serial: invoice_serial,
      quantity: quantity,
      checker_barcode: sess.process === 'Checker' ? checker_barcode : undefined,
    };
    COMPLETED_LOGS.push(record);
    setImmediate(persistOfflineDashboardReport);
    setImmediate(() => { void persistSqliteSnapshot(); });

    var ep = EMP_PERF.find(i => i.id === emp_id);
    if (ep) {
      ep.units += 1;
      ep.act += Math.round(duration_seconds / 60);
      var targetTime = ep.units * 45;
      ep.eff = Math.min(100, Math.round((targetTime / Math.max(1, ep.act)) * 100));
    }

    const emp = EMPLOYEES.find(e => e.id === emp_id);
    const abEnd = abayaCatalog.findIndex(a => a.id === record.abaya_id);
    const abaya_code = abEnd >= 0 ? abayaCatalog[abEnd].code : null;
    const abaya_barcode = abEnd >= 0 ? abayaCatalog[abEnd].barcode : null;

    delete ACTIVE_SESSIONS[emp_id];
    broadcastState();
    var cbPayload = {
      ok: true,
      duration_seconds,
      abaya_code,
      abaya_barcode,
      session_process: record.process,
      invoice_count: record.invoice_count,
      invoice_serial: record.invoice_serial,
      quantity: record.quantity,
      checker_barcode: record.checker_barcode != null ? record.checker_barcode : undefined,
    };
    callback(cbPayload);

    if (emp) {
      var cfPayload = {
        emp_id, emp_name: emp.name, emp_code: emp.code,
        emp_process: record.process, emp_color: emp.color, emp_initials: emp.initials,
        abaya_id: record.abaya_id, abaya_code,
        station: 'S-02',
        started_at: Math.floor(record.start / 1000),
        ended_at: Math.floor(record.end / 1000),
        duration_sec: duration_seconds,
      };
      if (record.process === 'Invoice maker') {
        cfPayload.invoice_count = record.invoice_count;
        cfPayload.invoice_serial = record.invoice_serial;
      }
      if (record.process === 'Checker') {
        cfPayload.quantity = record.quantity;
        cfPayload.checker_barcode = checker_barcode;
      }
      pushToCloudflare('session_finish', cfPayload);
    }
  });

  socket.on('disconnect', (reason) => {
    logSocketSignal('disconnect', {
      id: socket.id,
      reason: String(reason || 'unknown'),
      transport: socket.conn && socket.conn.transport ? socket.conn.transport.name : 'unknown',
    });
  });
});

io.engine.on('connection_error', (err) => {
  logSocketSignal('engine_connection_error', {
    code: err && err.code,
    message: err && err.message ? String(err.message).slice(0, 220) : '',
    context: err && err.context && err.context.message ? String(err.context.message).slice(0, 220) : '',
  });
});

app.get('/api/catalog/abayas', (req, res) => {
  res.json({ ok: true, version: catalogCloudVersion, abayas: abayaCatalog });
});

/** HTTP fallback for dashboards when websocket connectivity is unstable. */
app.get('/api/state', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, state: getRealtimeStateBundle(req) });
});

app.get('/api/employees', (req, res) => {
  res.json({
    ok: true,
    employees: EMPLOYEES.map(function (e) {
      return {
        id: e.id, name: e.name, code: e.code,
        emp_no: e.emp_no, ac_no: e.ac_no,
        process: e.process, barcode: e.barcode,
        color: e.color || '#6a5fc1',
        initials: e.initials || (e.name || '?').slice(0, 2).toUpperCase(),
        photo: e.photo || '',
      };
    }),
  });
});

app.get('/api/work-types', function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, workTypes: FACTORY_WORK_TYPES.slice(), version: workTypesDataVersion });
});

const CATALOG_INGEST_SECRET = process.env.CATALOG_INGEST_SECRET || process.env.CF_INGEST_SECRET || '';

app.put('/api/work-types', function (req, res) {
  if (!CATALOG_INGEST_SECRET || req.headers['x-ingest-secret'] !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  var body = req.body;
  if (!body || !Array.isArray(body.workTypes)) {
    return res.status(400).json({ ok: false, error: 'JSON body must include workTypes: string[]' });
  }
  var v = validateFactoryWorkTypesReplace(body.workTypes);
  if (!v.ok) {
    return res.status(400).json({ ok: false, error: v.error });
  }
  try {
    saveFactoryWorkTypesToDisk(v.normalized);
  } catch (e) {
    console.error('[work-types] save failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message || 'Could not save work-types.json' });
  }
  emitWorkTypesChanged();
  return res.json({ ok: true, workTypes: FACTORY_WORK_TYPES.slice(), version: workTypesDataVersion });
});

function getFloorExportSecretEffective() {
  const ex = String(process.env.FLOOR_EXPORT_SECRET || '').trim();
  return ex || CATALOG_INGEST_SECRET;
}


function recomputeEmpPerfFromLogs() {
  const byId = Object.create(null);
  for (let i = 0; i < EMPLOYEES.length; i++) {
    const e = EMPLOYEES[i];
    byId[e.id] = { id: e.id, units: 0, eff: 0, act: 0, idl: 0 };
  }
  for (let i = 0; i < COMPLETED_LOGS.length; i++) {
    const l = COMPLETED_LOGS[i];
    if (!l || !l.emp_id) continue;
    const row = byId[l.emp_id];
    if (!row) continue;
    const durSec = Number(l.duration_sec);
    row.units += 1;
    row.act += Number.isFinite(durSec) && durSec > 0 ? Math.round(durSec / 60) : 0;
  }
  EMP_PERF = EMPLOYEES.map(function (e) {
    const row = byId[e.id] || { id: e.id, units: 0, eff: 0, act: 0, idl: 0 };
    const targetTime = row.units * 45;
    row.eff = Math.min(100, Math.round((targetTime / Math.max(1, row.act)) * 100));
    return row;
  });
}


/** Add a single employee (supervisor use). Protected by ingest secret. Persists to employees.xlsx or employees-manual.json. */
app.post('/api/employees', function (req, res) {
  if (!CATALOG_INGEST_SECRET || req.headers['x-ingest-secret'] !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  var b = req.body;
  if (!b || !b.name || b.emp_no == null || b.ac_no == null || !b.barcode || !b.process) {
    return res.status(400).json({ ok: false, error: 'Required: name, emp_no, ac_no, barcode, process' });
  }
  var empNo = parseInt(b.emp_no, 10);
  var acNo = parseInt(b.ac_no, 10);
  if (isNaN(empNo) || isNaN(acNo)) {
    return res.status(400).json({ ok: false, error: 'emp_no and ac_no must be integers' });
  }
  if (!isProcessAllowedOnFactory(b.process)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid process: must match a name in the factory work-types list (Asset upload → Work types).',
    });
  }
  var barcodeKey = String(b.barcode).trim();
  enqueueEmployeeMasterWrite(async function () {
    if (EMPLOYEES.some(function (e) { return String(e.barcode).trim() === barcodeKey; })) {
      var e409 = new Error('Employee with this barcode already exists');
      e409.statusCode = 409;
      throw e409;
    }
    if (EMPLOYEES.some(function (e) { return Number(e.ac_no) === acNo; })) {
      var eAc = new Error('Another employee already uses AC number ' + acNo);
      eAc.statusCode = 409;
      throw eAc;
    }
    if (EMPLOYEES.some(function (e) { return Number(e.emp_no) === empNo; })) {
      var eEn = new Error('Another employee already uses employee number ' + empNo);
      eEn.statusCode = 409;
      throw eEn;
    }
    var id = stableEmployeeIdFromXlsxBarcode(barcodeKey);
    var emp = {
      id: id,
      emp_no: empNo,
      ac_no: acNo,
      name: String(b.name).trim(),
      code: b.code ? String(b.code).trim() : ('EMP' + empNo),
      barcode: barcodeKey,
      process: String(b.process).trim(),
      color: b.color || EMP_COLOR_PALETTE[EMPLOYEES.length % EMP_COLOR_PALETTE.length],
      initials: (String(b.name) || '?').slice(0, 2).toUpperCase(),
      photo: b.photo ? String(b.photo).trim() : '',
    };
    await persistEmployeeRosterAndReload(EMPLOYEES.concat([emp]));
  })
    .then(function () {
      var emp = EMPLOYEES.find(function (e) { return String(e.barcode).trim() === barcodeKey; });
      return res.json({ ok: true, employee: emp });
    })
    .catch(function (e) {
      var sc = e && e.statusCode;
      if (sc === 409) return res.status(409).json({ ok: false, error: e.message });
      console.error('[api/employees POST]', e);
      return res.status(500).json({ ok: false, error: e.message || 'Server error' });
    });
});

/** Update an existing employee. Protected by ingest secret. Persists master file when configured. */
app.put('/api/employees/:id', function (req, res) {
  if (!CATALOG_INGEST_SECRET || req.headers['x-ingest-secret'] !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  var targetId = req.params.id;
  var b = req.body || {};
  enqueueEmployeeMasterWrite(async function () {
    var idx = EMPLOYEES.findIndex(function (e) { return e.id === targetId; });
    if (idx < 0) {
      var nf = new Error('Employee not found');
      nf.statusCode = 404;
      throw nf;
    }
    var next = EMPLOYEES.slice();
    var emp = Object.assign({}, next[idx]);
    if (b.name != null && String(b.name).trim() !== '') emp.name = String(b.name).trim();
    if (b.emp_no != null && String(b.emp_no).trim() !== '') {
      var en = parseInt(b.emp_no, 10);
      if (isNaN(en)) {
        var bad = new Error('emp_no must be an integer');
        bad.statusCode = 400;
        throw bad;
      }
      emp.emp_no = en;
    }
    if (b.ac_no != null && String(b.ac_no).trim() !== '') {
      var ac = parseInt(b.ac_no, 10);
      if (isNaN(ac)) {
        var badAc = new Error('ac_no must be an integer');
        badAc.statusCode = 400;
        throw badAc;
      }
      emp.ac_no = ac;
    }
    if (b.barcode != null && String(b.barcode).trim() !== '') emp.barcode = String(b.barcode).trim();
    if (b.process != null && String(b.process).trim() !== '') emp.process = String(b.process).trim();
    if (b.code != null) emp.code = String(b.code).trim();
    if (b.color != null) emp.color = String(b.color).trim();
    if (b.photo != null) emp.photo = String(b.photo).trim();
    emp.initials = (emp.name || '?').slice(0, 2).toUpperCase();
    if (!isProcessAllowedOnFactory(emp.process)) {
      var badP = new Error('Invalid process: must match a name in the factory work-types list.');
      badP.statusCode = 400;
      throw badP;
    }
    for (var i = 0; i < next.length; i++) {
      if (i === idx) continue;
      if (String(next[i].barcode).trim() === String(emp.barcode).trim()) {
        var bc = new Error('Another employee already uses this barcode');
        bc.statusCode = 409;
        throw bc;
      }
      if (Number(next[i].ac_no) === Number(emp.ac_no)) {
        var acC = new Error('Another employee already uses AC number ' + emp.ac_no);
        acC.statusCode = 409;
        throw acC;
      }
      if (Number(next[i].emp_no) === Number(emp.emp_no)) {
        var enC = new Error('Another employee already uses employee number ' + emp.emp_no);
        enC.statusCode = 409;
        throw enC;
      }
    }
    next[idx] = emp;
    await persistEmployeeRosterAndReload(next);
  })
    .then(function () {
      var emp = EMPLOYEES.find(function (e) { return e.id === targetId; });
      return res.json({ ok: true, employee: emp });
    })
    .catch(function (e) {
      var sc = e && e.statusCode;
      if (sc === 404) return res.status(404).json({ ok: false, error: e.message });
      if (sc === 400) return res.status(400).json({ ok: false, error: e.message });
      if (sc === 409) return res.status(409).json({ ok: false, error: e.message });
      console.error('[api/employees PUT]', e);
      return res.status(500).json({ ok: false, error: e.message || 'Server error' });
    });
});

/** Remove an employee from the roster. Blocked if they have an active session. */
app.delete('/api/employees/:id', function (req, res) {
  if (!CATALOG_INGEST_SECRET || req.headers['x-ingest-secret'] !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const id = req.params.id;
  enqueueEmployeeMasterWrite(async function () {
    if (ACTIVE_SESSIONS[id]) {
      var act = new Error('Employee has an active session — finish it first');
      act.statusCode = 409;
      throw act;
    }
    const idx = EMPLOYEES.findIndex(function (e) { return e.id === id; });
    if (idx < 0) {
      var nf = new Error('Employee not found');
      nf.statusCode = 404;
      throw nf;
    }
    const next = EMPLOYEES.filter(function (e) { return e.id !== id; });
    await persistEmployeeRosterAndReload(next);
  })
    .then(function () {
      return res.json({ ok: true });
    })
    .catch(function (e) {
      var sc = e && e.statusCode;
      if (sc === 404) return res.status(404).json({ ok: false, error: e.message });
      if (sc === 409) return res.status(409).json({ ok: false, error: e.message });
      console.error('[api/employees DELETE]', e);
      return res.status(500).json({ ok: false, error: e.message || 'Server error' });
    });
});

// ─── IMAGE UPLOADS (employees + catalog items) ────────────────────────────────
app.post(
  '/api/upload/employee-image',
  function (req, res, next) {
    if (!assertAssetUploadAllowed(req, res)) return;
    next();
  },
  uploadImageMem.single('image'),
  function (req, res) {
    try {
      const barcode = String(req.body.barcode || '').trim();
      if (!barcode || !req.file) {
        return res.status(400).json({ ok: false, error: 'Multipart field "image" and form field "barcode" are required.' });
      }
      const emp = EMPLOYEES.find(function (e) {
        return String(e.barcode).trim() === barcode;
      });
      if (!emp) {
        return res.status(404).json({ ok: false, error: 'No employee with barcode: ' + barcode });
      }
      ensurePublicUploadDirs();
      const ext = (path.extname(req.file.originalname || '') || '.jpg').toLowerCase();
      const safeExt = /^\.(jpe?g|png|gif|webp)$/.test(ext) ? ext : '.jpg';
      const base = 'emp_' + sanitizeUploadToken(barcode) + safeExt;
      const rel = 'uploads/employees/' + base;
      fs.writeFileSync(path.join(UPLOAD_EMP_DIR, base), req.file.buffer);
      emp.photo = rel;
      emp.initials = (emp.name || '?').slice(0, 2).toUpperCase();
      if (EMPLOYEES_XLSX_PATH) {
        enqueueEmployeeMasterWrite(async function () {
          await persistEmployeeRosterAndReload(EMPLOYEES.slice());
        })
          .then(function () {
            const fresh = EMPLOYEES.find(function (e) {
              return String(e.barcode).trim() === barcode;
            });
            return res.json({
              ok: true,
              photo: rel,
              employeeId: fresh ? fresh.id : emp.id,
              name: fresh ? fresh.name : emp.name,
            });
          })
          .catch(function (err) {
            console.error('[employee-image] persist xlsx:', err);
            return res.status(500).json({
              ok: false,
              error: err.message || 'Photo saved on disk but failed to update employees roster file',
            });
          });
        return;
      }
      emitEmployeesChanged();
      res.json({ ok: true, photo: rel, employeeId: emp.id, name: emp.name });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || 'Upload failed' });
    }
  },
);

app.post(
  '/api/upload/catalog-item-image',
  function (req, res, next) {
    if (!assertAssetUploadAllowed(req, res)) return;
    next();
  },
  uploadImageMem.single('image'),
  function (req, res) {
    try {
      const barcode = String(req.body.barcode || '').trim();
      if (!barcode || !req.file) {
        return res.status(400).json({ ok: false, error: 'Multipart field "image" and form field "barcode" are required.' });
      }
      const item = abayaCatalog.find(function (a) {
        return String(a.barcode).trim() === barcode;
      });
      if (!item) {
        return res.status(404).json({ ok: false, error: 'No catalog item with barcode: ' + barcode });
      }
      ensurePublicUploadDirs();
      const ext = (path.extname(req.file.originalname || '') || '.jpg').toLowerCase();
      const safeExt = /^\.(jpe?g|png|gif|webp)$/.test(ext) ? ext : '.jpg';
      const base = 'item_' + sanitizeUploadToken(barcode) + safeExt;
      const rel = 'uploads/items/' + base;
      fs.writeFileSync(path.join(UPLOAD_ITEM_DIR, base), req.file.buffer);
      item.icon = rel;
      catalogCloudVersion = String(Date.now());
      io.emit('catalog_update', { version: catalogCloudVersion });
      res.json({ ok: true, icon: rel, code: item.code, barcode: item.barcode });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || 'Upload failed' });
    }
  },
);

// ─── LOCAL XLSX DATA (catalog + employees) ───────────────────────────────────
// Optional EXCEL_DATA_DIR: folder containing items_export.xlsx and employees.xlsx.
// Explicit CATALOG_XLSX_PATH / EMPLOYEES_XLSX_PATH in .env override those defaults.
const EXCEL_DATA_DIR_RAW = String(process.env.EXCEL_DATA_DIR || '').trim();
const CATALOG_XLSX_PATH_RAW = String(process.env.CATALOG_XLSX_PATH || '').trim();
const EMPLOYEES_XLSX_PATH_RAW = String(process.env.EMPLOYEES_XLSX_PATH || '').trim();
const _excelDataDir = EXCEL_DATA_DIR_RAW
  ? (path.isAbsolute(EXCEL_DATA_DIR_RAW) ? EXCEL_DATA_DIR_RAW : path.join(__dirname, EXCEL_DATA_DIR_RAW))
  : '';
const EMPLOYEES_XLSX_PATH = EMPLOYEES_XLSX_PATH_RAW
  || (_excelDataDir ? path.join(_excelDataDir, 'employees.xlsx') : '');
const EMPLOYEES_XLSX_INTERVAL_MS = Math.max(Number(process.env.EMPLOYEES_XLSX_INTERVAL_MS) || 0, 3600000) || 86400000;

const EMP_COLOR_PALETTE = [
  '#6a5fc1','#a78bfa','#c2ef4e','#ffb287','#fa7faa',
  '#14b8a6','#ef4444','#8b5cf6','#79628c','#3b82f6',
];

// ─── MANUAL EMPLOYEE FILE (Dashboard add/delete, no-xlsx setups only) ────────
// When EMPLOYEES_XLSX_PATH is set, xlsx is always the master and these are skipped.
const EMPLOYEES_MANUAL_PATH = path.join(__dirname, 'data', 'employees-manual.json');

function loadEmployeesFromManualFile() {
  if (EMPLOYEES_XLSX_PATH) return;
  if (!fs.existsSync(EMPLOYEES_MANUAL_PATH)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(EMPLOYEES_MANUAL_PATH, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) return;
    EMPLOYEES = raw;
    rebuildACMap();
    EMP_PERF = EMPLOYEES.map(function (e) {
      return { id: e.id, units: 0, eff: 0, act: 0, idl: 0 };
    });
    console.log('[employees-manual] Loaded', EMPLOYEES.length, 'employees from', EMPLOYEES_MANUAL_PATH);
  } catch (e) {
    console.warn('[employees-manual] Load failed (non-fatal):', e.message);
  }
}

function saveEmployeesToManualFile() {
  if (EMPLOYEES_XLSX_PATH) return;
  try {
    fs.mkdirSync(path.dirname(EMPLOYEES_MANUAL_PATH), { recursive: true });
    fs.writeFileSync(EMPLOYEES_MANUAL_PATH, JSON.stringify(EMPLOYEES, null, 2), 'utf8');
  } catch (e) {
    console.warn('[employees-manual] Save failed (non-fatal):', e.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────
const EMP_XLSX_COL_ALIASES = {
  emp_no:  ['emp_no', 'employee_no', 'employee_number', 'empno'],
  ac_no:   ['ac_no', 'access_no', 'ac', 'access_control'],
  name:    ['name', 'employee_name', 'emp_name', 'full_name'],
  barcode: ['barcode', 'badge', 'badge_barcode', 'employee_barcode'],
  process: ['process', 'work_type', 'department', 'role'],
  code:    ['code', 'emp_code', 'employee_code'],
  color:   ['color', 'colour', 'hex_color'],
  photo:   ['photo', 'image', 'picture', 'avatar'],
};
const EMP_XLSX_REVERSE = {};
for (const [field, aliases] of Object.entries(EMP_XLSX_COL_ALIASES)) {
  for (const alias of aliases) {
    EMP_XLSX_REVERSE[alias.toLowerCase().replace(/[\s\u00a0-]+/g, '_')] = field;
  }
}

/** Stable id so COMPLETED_LOGS + EMP_PERF stay valid after employees.xlsx reorder / hot reload. */
function stableEmployeeIdFromXlsxBarcode(barcode) {
  const t = sanitizeUploadToken(barcode);
  return 'e_bc_' + (t || 'x');
}

function parseEmployeesXlsxFile(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: false, cellNF: false, cellText: false });
  const sheetName = wb.SheetNames.includes('Employees') ? 'Employees' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  const employees = [];
  const seenBc = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const out = { emp_no: '', ac_no: '', name: '', barcode: '', process: '', code: '', color: '', photo: '' };
    for (const [k, v] of Object.entries(row)) {
      const norm = k.trim().toLowerCase().replace(/[\s\u00a0-]+/g, '_');
      const field = EMP_XLSX_REVERSE[norm];
      if (field && out[field] === '') out[field] = String(v || '').trim();
    }
    if (!out.name && !out.emp_no && !out.barcode) continue;
    const empNo = parseInt(out.emp_no, 10);
    const acNo = parseInt(out.ac_no, 10);
    if (!out.name || isNaN(empNo) || isNaN(acNo) || !out.barcode || !out.process) {
      console.warn('[employees-xlsx] Row ' + (i + 2) + ': skipping — missing required field (name, emp_no, ac_no, barcode, process)');
      continue;
    }
    const barcodeKey = String(out.barcode || '').trim();
    if (seenBc.has(barcodeKey)) continue;
    seenBc.add(barcodeKey);
    out.barcode = barcodeKey;
    const id = stableEmployeeIdFromXlsxBarcode(barcodeKey);
    const code = out.code || ('EMP' + empNo);
    const color = out.color || EMP_COLOR_PALETTE[employees.length % EMP_COLOR_PALETTE.length];
    const initials = (out.name || '?').slice(0, 2).toUpperCase();
    var photo = out.photo || '';
    if (!photo) {
      var uploadsBase = path.join(__dirname, 'public', 'uploads');
      var nameVariants = [out.name, out.name.toLowerCase(), out.name.replace(/\s+/g, '')];
      var photoExts = ['.jpeg', '.jpg', '.png'];
      for (var ni = 0; ni < nameVariants.length && !photo; ni++) {
        for (var ei = 0; ei < photoExts.length && !photo; ei++) {
          var candidate = path.join(uploadsBase, nameVariants[ni] + photoExts[ei]);
          if (fs.existsSync(candidate)) photo = 'uploads/' + nameVariants[ni] + photoExts[ei];
        }
      }
    }
    employees.push({ id, emp_no: empNo, ac_no: acNo, name: out.name, code, barcode: out.barcode, process: out.process, color, initials, photo });
  }
  return employees;
}

function loadEmployeesFromXlsxFile() {
  if (!EMPLOYEES_XLSX_PATH) return;
  const resolved = path.isAbsolute(EMPLOYEES_XLSX_PATH)
    ? EMPLOYEES_XLSX_PATH
    : path.join(__dirname, EMPLOYEES_XLSX_PATH);
  if (!fs.existsSync(resolved)) {
    console.warn('[employees-xlsx] File not found:', resolved, '— fix .env (EXCEL_DATA_DIR or EMPLOYEES_XLSX_PATH) or copy employees.xlsx there; until then built-in demo employees are used.');
    return;
  }
  try {
    const mt = Math.floor(fs.statSync(resolved).mtimeMs);
    if (lastEmployeesXlsxMtime !== 0 && mt === lastEmployeesXlsxMtime) {
      return;
    }
    const parsed = parseEmployeesXlsxFile(resolved);
    if (parsed.length === 0) { console.warn('[employees-xlsx] No valid rows found in', resolved); return; }
    lastEmployeesXlsxMtime = mt;
    const prevPerfById = Object.create(null);
    for (let pi = 0; pi < EMP_PERF.length; pi++) {
      const row = EMP_PERF[pi];
      prevPerfById[row.id] = row;
    }
    EMPLOYEES = parsed;
    attachEmployeeImagesFromDisk();
    EMP_PERF = EMPLOYEES.map(function (e) {
      const prev = prevPerfById[e.id];
      if (prev) {
        return { id: e.id, units: prev.units, eff: prev.eff, act: prev.act, idl: prev.idl };
      }
      return { id: e.id, units: 0, eff: 0, act: 0, idl: 0 };
    });
    rebuildACMap();
    emitEmployeesChanged();
    console.log('[employees-xlsx] Loaded', parsed.length, 'employees from', resolved);
  } catch (e) {
    console.error('[employees-xlsx] Parse error (non-fatal):', e.message);
  }
}

/** Serialized writes so concurrent add/delete/photo updates cannot corrupt employees.xlsx. */
let employeeMasterWriteChain = Promise.resolve();

function enqueueEmployeeMasterWrite(fn) {
  const run = function () {
    return Promise.resolve().then(fn);
  };
  const p = employeeMasterWriteChain.then(run, run);
  employeeMasterWriteChain = p.catch(function (e) {
    console.warn('[employees-master-write-queue]', e && e.message ? e.message : e);
  });
  return p;
}

function resolveEmployeesXlsxAbsolutePath() {
  if (!EMPLOYEES_XLSX_PATH) return '';
  return path.isAbsolute(EMPLOYEES_XLSX_PATH)
    ? EMPLOYEES_XLSX_PATH
    : path.join(__dirname, EMPLOYEES_XLSX_PATH);
}

/** @returns {{ok:true}|{ok:false,error:string}} */
function validateEmployeeRosterIntegrity(arr) {
  const seenBc = new Map();
  const seenAc = new Map();
  const seenEn = new Map();
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    const bc = String(e.barcode == null ? '' : e.barcode).trim();
    const ac = Number(e.ac_no);
    const en = Number(e.emp_no);
    if (!bc) {
      return { ok: false, error: 'Roster has a row with an empty barcode' };
    }
    if (seenBc.has(bc)) {
      return { ok: false, error: 'Duplicate barcode: ' + bc };
    }
    seenBc.set(bc, true);
    if (Number.isFinite(ac)) {
      if (seenAc.has(ac)) {
        return { ok: false, error: 'Duplicate AC number: ' + ac };
      }
      seenAc.set(ac, true);
    }
    if (Number.isFinite(en)) {
      if (seenEn.has(en)) {
        return { ok: false, error: 'Duplicate employee number: ' + en };
      }
      seenEn.set(en, true);
    }
  }
  return { ok: true };
}

function getEmployeesWorkbookSheetNameForWrite(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 'Employees';
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: false, cellNF: false, cellText: false });
  if (!wb.SheetNames || !wb.SheetNames.length) return 'Employees';
  return wb.SheetNames.includes('Employees') ? 'Employees' : wb.SheetNames[0];
}

function buildEmployeesXlsxBuffer(employees, sheetName) {
  const XLSX = require('xlsx');
  const headers = ['emp_no', 'ac_no', 'name', 'barcode', 'process', 'code', 'color', 'photo'];
  const aoa = [headers];
  for (let i = 0; i < employees.length; i++) {
    const e = employees[i];
    aoa.push([
      e.emp_no,
      e.ac_no,
      e.name,
      String(e.barcode || '').trim(),
      e.process,
      e.code || ('EMP' + e.emp_no),
      e.color || '',
      e.photo || '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function atomicWriteBufferReplaceFile(destPath, buffer) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(destPath);
  const tmp = path.join(dir, '.' + base + '.tmp.' + process.pid + '.' + Date.now());
  fs.writeFileSync(tmp, buffer);
  try {
    fs.unlinkSync(destPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  fs.renameSync(tmp, destPath);
}

/**
 * Replace in-memory roster + disk master (xlsx or JSON). Caller must run inside enqueueEmployeeMasterWrite.
 * After xlsx write, reloads from disk so attachEmployeeImagesFromDisk and mtime stay consistent.
 */
async function persistEmployeeRosterAndReload(nextEmployees) {
  const check = validateEmployeeRosterIntegrity(nextEmployees);
  if (!check.ok) {
    const err = new Error(check.error);
    err.statusCode = 409;
    throw err;
  }
  if (EMPLOYEES_XLSX_PATH) {
    const resolved = resolveEmployeesXlsxAbsolutePath();
    if (!resolved) {
      const err = new Error('EMPLOYEES_XLSX_PATH is not resolvable');
      err.statusCode = 500;
      throw err;
    }
    const sheetName = getEmployeesWorkbookSheetNameForWrite(resolved);
    const buf = buildEmployeesXlsxBuffer(nextEmployees, sheetName);
    atomicWriteBufferReplaceFile(resolved, buf);
    lastEmployeesXlsxMtime = 0;
    loadEmployeesFromXlsxFile();
  } else {
    const prevPerfById = Object.create(null);
    for (let pi = 0; pi < EMP_PERF.length; pi++) {
      prevPerfById[EMP_PERF[pi].id] = EMP_PERF[pi];
    }
    EMPLOYEES = nextEmployees;
    rebuildACMap();
    EMP_PERF = EMPLOYEES.map(function (e) {
      const prev = prevPerfById[e.id];
      if (prev) {
        return { id: e.id, units: prev.units, eff: prev.eff, act: prev.act, idl: prev.idl };
      }
      return { id: e.id, units: 0, eff: 0, act: 0, idl: 0 };
    });
    saveEmployeesToManualFile();
    emitEmployeesChanged();
  }
}

// Catalog path priority:
// 1) CATALOG_XLSX_PATH
// 2) EXCEL_DATA_DIR/items_export.xlsx
// 3) docs/samples/items_export.xlsx (repo fallback sample)
const CATALOG_XLSX_FALLBACK = path.join(__dirname, 'docs', 'samples', 'items_export.xlsx');
const CATALOG_XLSX_PATH = CATALOG_XLSX_PATH_RAW
  || (_excelDataDir ? path.join(_excelDataDir, 'items_export.xlsx') : '')
  || (fs.existsSync(CATALOG_XLSX_FALLBACK) ? CATALOG_XLSX_FALLBACK : '');
const CATALOG_XLSX_INTERVAL_MS = Math.max(Number(process.env.CATALOG_XLSX_INTERVAL_MS) || 0, 3600000) || 86400000;
const DEFAULT_CATALOG_PROCESS = String(process.env.DEFAULT_CATALOG_PROCESS || 'Tailor (01)').trim() || 'Tailor (01)';

// Column aliases mirror catalog-parse.js — keep in sync.
// "Barcode Display Name" and "Item Category" are the factory Excel column names.
const XLSX_COL_ALIASES = {
  id:      ['id', 'abaya_id', 'item_id'],
  code:    ['code', 'item_code', 'sku', 'abaya_code', 'product_code'],
  barcode: ['barcode', 'bar_code', 'bc', 'barcode_display_name', 'display_name', 'barcode_name'],
  design:  ['design', 'description', 'item_name', 'name', 'title'],
  // process is set from folder name by the catalog-watcher, never from Excel columns.
  process: ['process', 'work_type', 'department', 'role'],
  // "Item Category" in the factory Excel = abaya quality grade (Standard/Premium/Luxury/Plain Abaya).
  tier:    ['tier', 'grade', 'abaya_tier', 'abaya_grade', 'item_grade', 'abaya_category', 'item_category', 'category'],
  icon:    ['icon', 'emoji'],
};
const XLSX_REVERSE_MAP = {};
for (const [field, aliases] of Object.entries(XLSX_COL_ALIASES)) {
  for (const alias of aliases) {
    XLSX_REVERSE_MAP[alias.toLowerCase().replace(/[\s\u00a0-]+/g, '_')] = field;
  }
}

function parseCatalogXlsxFile(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: false, cellNF: false, cellText: false });
  return parseCatalogWorkbook(wb);
}

function parseCatalogWorkbook(wb) {
  const XLSX = require('xlsx');
  const sheetName = wb.SheetNames.includes('Items') ? 'Items' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  const abayas = [];
  const seenKey = new Set();
  for (const row of rows) {
    const out = { id: '', code: '', barcode: '', design: '', process: '', tier: '', icon: '' };
    for (const [k, v] of Object.entries(row)) {
      const norm = k.trim().toLowerCase().replace(/[\s\u00a0-]+/g, '_');
      const field = XLSX_REVERSE_MAP[norm];
      if (field && out[field] === '') out[field] = String(v || '').trim();
    }
    if (!out.id && !out.code && !out.barcode) continue;
    if (!out.barcode) continue;
    if (!String(out.process || '').trim()) out.process = DEFAULT_CATALOG_PROCESS;
    if (!out.code && out.barcode) out.code = out.barcode;
    var procKey = String(out.process || '').trim().toLowerCase();
    var bcKey = String(out.barcode || '').trim().toLowerCase();
    var rowKey = bcKey + '|' + procKey;
    if (seenKey.has(rowKey)) continue;
    seenKey.add(rowKey);
    if (!out.id && out.barcode) {
      var idBase = out.barcode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      var procSlug = procKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      out.id = procSlug ? (idBase + '--' + procSlug) : idBase;
    }
    abayas.push(out);
  }
  return abayas;
}

function parseCatalogXlsxBuffer(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellNF: false, cellText: false });
  return parseCatalogWorkbook(wb);
}

function loadCatalogFromXlsxFile() {
  if (!CATALOG_XLSX_PATH) return;
  const resolved = path.isAbsolute(CATALOG_XLSX_PATH)
    ? CATALOG_XLSX_PATH
    : path.join(__dirname, CATALOG_XLSX_PATH);
  if (!fs.existsSync(resolved)) {
    console.warn('[catalog-xlsx] File not found:', resolved, '— fix .env (EXCEL_DATA_DIR or CATALOG_XLSX_PATH) or copy items_export.xlsx there; until then built-in demo catalog is used.');
    return;
  }
  try {
    const mt = Math.floor(fs.statSync(resolved).mtimeMs);
    if (lastCatalogXlsxMtime !== 0 && mt === lastCatalogXlsxMtime) {
      return;
    }
    const abayas = parseCatalogXlsxFile(resolved);
    if (abayas.length === 0) { console.warn('[catalog-xlsx] No valid rows found in', resolved); return; }
    lastCatalogXlsxMtime = mt;
    abayaCatalog = normalizeAbayaCatalogRows(abayas);
    attachItemImagesFromDisk();
    catalogCloudVersion = String(Date.now());
    io.emit('catalog_update', { version: catalogCloudVersion });
    console.log('[catalog-xlsx] Loaded', abayas.length, 'items from', resolved);
  } catch (e) {
    console.error('[catalog-xlsx] Parse error (non-fatal):', e.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function validateCatalogPutRows(rows) {
  if (!Array.isArray(rows)) {
    return { ok: false, error: 'Body must be a JSON array or { abayas: [...] }' };
  }
  const norm = [];
  const seenId = new Set();
  const seenKey = new Set();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || typeof r !== 'object') {
      return { ok: false, error: 'Row ' + (i + 1) + ': must be an object' };
    }
    var id = String(r.id != null ? r.id : '').trim();
    var code = String(r.code != null ? r.code : '').trim();
    var barcode = String(r.barcode != null ? r.barcode : '').trim();
    var design = String(r.design != null ? r.design : '').trim();
    var process = String(r.process != null ? r.process : '').trim();
    var tier = String(r.tier != null ? r.tier : '').trim();
    var iconRaw = r.icon;
    var icon = iconRaw == null || iconRaw === '' ? '' : String(iconRaw);
    if (!barcode) {
      continue;
    }
    if (!process) {
      process = DEFAULT_CATALOG_PROCESS;
    }
    if (!code) code = barcode;
    var procKey = String(process || '').trim().toLowerCase();
    var bcKey = String(barcode || '').trim().toLowerCase();
    var uniqKey = bcKey + '|' + procKey;
    if (!id) {
      var idBase = barcode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      var procSlug = procKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      id = procSlug ? (idBase + '--' + procSlug) : idBase;
    }
    if (seenId.has(id) || seenKey.has(uniqKey)) continue;
    seenId.add(id);
    seenKey.add(uniqKey);
    norm.push({ id: id, code: code, barcode: barcode, design: design, process: process, tier: tier, icon: icon });
  }
  return { ok: true, norm: norm };
}

/** Same contract as Cloudflare PUT /api/catalog/abayas (office watcher or curl). */
app.put('/api/catalog/abayas', (req, res) => {
  if (!CATALOG_INGEST_SECRET) {
    return res.status(503).json({
      ok: false,
      error: 'Catalog ingest disabled: set CATALOG_INGEST_SECRET or CF_INGEST_SECRET in .env',
    });
  }
  var secret = req.headers['x-ingest-secret'];
  if (!secret || secret !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized ingest request' });
  }
  var rows = Array.isArray(req.body) ? req.body : req.body && req.body.abayas;
  var v = validateCatalogPutRows(rows);
  if (!v.ok) {
    return res.status(400).json({ ok: false, error: v.error });
  }
  abayaCatalog = normalizeAbayaCatalogRows(v.norm);
  attachItemImagesFromDisk();
  catalogCloudVersion = String(Date.now());
  io.emit('catalog_update', { version: catalogCloudVersion });
  res.json({ ok: true, version: catalogCloudVersion, count: abayaCatalog.length });
});

/**
 * Dashboard import path: upload items_export-style xlsx and replace catalog in memory.
 * Protected by same ingest secret as /api/catalog/abayas.
 */
app.post('/api/import/catalog-xlsx', uploadXlsxMem.single('file'), (req, res) => {
  if (!CATALOG_INGEST_SECRET) {
    return res.status(503).json({
      ok: false,
      error: 'Catalog ingest disabled: set CATALOG_INGEST_SECRET or CF_INGEST_SECRET in .env',
    });
  }
  var secret = String(req.headers['x-ingest-secret'] || '').trim();
  if (!secret || secret !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized import request' });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: 'Missing file upload (.xlsx)' });
  }
  try {
    const abayas = parseCatalogXlsxBuffer(req.file.buffer);
    if (!abayas.length) {
      return res.status(400).json({ ok: false, error: 'No valid rows found in uploaded workbook' });
    }
    const v = validateCatalogPutRows(abayas);
    if (!v.ok) {
      return res.status(400).json({ ok: false, error: v.error });
    }
    abayaCatalog = normalizeAbayaCatalogRows(v.norm);
    attachItemImagesFromDisk();
    catalogCloudVersion = String(Date.now());
    io.emit('catalog_update', { version: catalogCloudVersion });
    res.json({ ok: true, version: catalogCloudVersion, count: abayaCatalog.length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Could not parse uploaded xlsx' });
  }
});

// ─── TABLET SETUP / QR CODE ENDPOINTS ────────────────────────────────────────

function getLanIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

/** Outcome-first release moment for LAN dashboard / kiosk (see config/release-moment.json). */
app.get('/api/release-moment', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config', 'release-moment.json'), 'utf8');
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') {
      return res.json({ enabled: false });
    }
    const out = Object.assign({}, o);
    delete out._comment;
    return res.json(out);
  } catch (_) {
    return res.json({ enabled: false });
  }
});

/** Returns detected LAN IPs and server port so the setup page can build kiosk URLs. */
app.get('/api/server-info', (req, res) => {
  res.json({ ok: true, ips: getLanIPs(), port: PORT });
});

/** Version snapshot for browsers (auto-refresh catalog/employees, detect server restart). */
app.get('/api/client-config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(getClientSyncPayload());
});

/** LAN: how many session events are waiting to reach the CEO Worker (offline / outage). */
app.get('/api/ceo-ingest-status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const persistence = getPersistenceHealth();
  res.json({
    ok: true,
    enabled: !!(CF_URL && CF_SECRET),
    mode: getCeoSyncMode(),
    pending: ceoIngestPendingCount,
    retryMs: CEO_INGEST_RETRY_MS,
    queueBasename: path.basename(CEO_QUEUE_FILE),
    queueFile: persistence.ceoQueueFile,
    queueDirWritable: persistence.ceoQueueDirWritable,
    offlineReportDir: persistence.offlineReportDir,
    offlineReportDirWritable: persistence.offlineReportDirWritable,
    reconcile: getReconcileHealth(),
    sqliteSnapshot: getSqliteSnapshotHealth(),
    ingestStats: getIngestStats(),
    rejectedQueue: getRejectedQueueStats(),
    alerts: getAlertHealth(),
  });
});

/** Send a test alert email to verify Resend wiring (auth via X-Ingest-Secret). */
app.post('/api/alerts/test', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = String(req.headers['x-ingest-secret'] || '').trim();
  if (!CF_SECRET || secret !== CF_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const mgr = ensureAlertManager();
  if (!mgr) {
    return res.status(409).json({ ok: false, error: 'alerts-not-configured', hint: 'Set RESEND_API_KEY and ALERTS_TO in .env.' });
  }
  const result = await mgr.notify('test-alert', {
    message: 'This is a test alert from /api/alerts/test.',
    initiatedBy: req.ip || 'unknown',
  });
  return res.json({ ok: true, result, stats: mgr.getStats() });
});

/** Manual reconciliation trigger (LAN-only; requires CF_INGEST_SECRET like other admin endpoints). */
app.post('/api/reconcile-now', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = String(req.headers['x-ingest-secret'] || '').trim();
  if (!CF_SECRET || secret !== CF_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (!reconcileLoopHandle) {
    return res.status(409).json({ ok: false, error: 'reconcile-loop-not-running' });
  }
  void reconcileLoopHandle.triggerNow();
  return res.json({ ok: true, status: reconcileLoopHandle.getStatus() });
});

/**
 * Backup NDJSON for ops: email/USB when internet was down. Same secret as factory → Worker ingest.
 * CEO side can later run a small replay script against the Worker, or you wait for auto-retry on the PC.
 */
app.get('/api/ceo-ingest-export', (req, res) => {
  const secret = String(req.headers['x-ingest-secret'] || '').trim();
  if (!CF_SECRET || secret !== CF_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized (use X-Ingest-Secret matching CF_INGEST_SECRET)' });
  }
  recoverCeoIngestQueue();
  syncCeoPendingCountFromDisk();
  try {
    let body = '';
    if (fs.existsSync(CEO_QUEUE_FILE)) body += fs.readFileSync(CEO_QUEUE_FILE, 'utf8');
    if (fs.existsSync(CEO_QUEUE_DRAIN)) body += fs.readFileSync(CEO_QUEUE_DRAIN, 'utf8');
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ceo-ingest-queue.ndjson"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body || '');
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Floor session export (in-memory COMPLETED_LOGS). Auth: X-Export-Secret = FLOOR_EXPORT_SECRET or CATALOG_INGEST_SECRET.
 * Query: from, to (epoch ms or ISO date), year (shortcut), summary=1 for byYearMonth rollups.
 */
app.get('/api/export/floor-sessions.json', function (req, res) {
  const secret = String(req.headers['x-export-secret'] || '').trim();
  const expected = getFloorExportSecretEffective();
  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'Export disabled: set FLOOR_EXPORT_SECRET or CATALOG_INGEST_SECRET / CF_INGEST_SECRET in .env',
    });
  }
  if (secret !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized (X-Export-Secret)' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(
    buildFloorExportPayload({
      query: req.query,
      logs: COMPLETED_LOGS,
      employees: EMPLOYEES,
      abayaCatalog: abayaCatalog,
      appVersion: APP_PACKAGE_VERSION,
    })
  );
});

app.get('/api/export/floor-sessions.csv', function (req, res) {
  const secret = String(req.headers['x-export-secret'] || '').trim();
  const expected = getFloorExportSecretEffective();
  if (!expected) {
    return res.status(503).send('Export disabled: set FLOOR_EXPORT_SECRET or CATALOG_INGEST_SECRET');
  }
  if (secret !== expected) {
    return res.status(401).send('Unauthorized');
  }
  const payload = buildFloorExportPayload({
    query: req.query,
    logs: COMPLETED_LOGS,
    employees: EMPLOYEES,
    abayaCatalog: abayaCatalog,
    appVersion: APP_PACKAGE_VERSION,
  });
  const csv = floorSessionsToCsv(payload.sessions);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="floor-sessions.csv"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

/**
 * Import floor sessions JSON previously exported from /api/export/floor-sessions.json.
 * Auth: X-Export-Secret = FLOOR_EXPORT_SECRET or CATALOG_INGEST_SECRET.
 */
app.post('/api/import/floor-sessions.json', (req, res) => {
  const secret = String(req.headers['x-export-secret'] || '').trim();
  const expected = getFloorExportSecretEffective();
  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'Import disabled: set FLOOR_EXPORT_SECRET or CATALOG_INGEST_SECRET / CF_INGEST_SECRET in .env',
    });
  }
  if (secret !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized (X-Export-Secret)' });
  }
  const body = req.body || {};
  const sessions = Array.isArray(body.sessions) ? body.sessions : [];
  const n = normalizeImportedFloorSessions(sessions);
  if (!n.ok) return res.status(400).json({ ok: false, error: n.error });

  const existing = new Set();
  for (let i = 0; i < COMPLETED_LOGS.length; i++) {
    const l = COMPLETED_LOGS[i];
    existing.add([l.emp_id, l.abaya_id, l.process, l.start, l.end].join('|'));
  }
  let added = 0;
  for (let i = 0; i < n.rows.length; i++) {
    const r = n.rows[i];
    const k = [r.emp_id, r.abaya_id, r.process, r.start, r.end].join('|');
    if (existing.has(k)) continue;
    existing.add(k);
    COMPLETED_LOGS.push(r);
    added += 1;
  }
  if (added > 0) {
    recomputeEmpPerfFromLogs();
    persistOfflineDashboardReport();
    broadcastState();
  }
  return res.json({ ok: true, imported: added, totalInMemory: COMPLETED_LOGS.length });
});

/**
 * QR code as SVG: GET /api/qr?url=<encoded-url>&size=256
 * Used by setup.html — server-side generation via the qrcode package (no CDN needed).
 */
app.get('/api/qr', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).send('Missing ?url= parameter');
  const size = Math.min(Math.max(parseInt(req.query.size) || 256, 64), 512);
  try {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      width: size,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch (e) {
    res.status(500).send('QR generation failed: ' + e.message);
  }
});

/** Setup page: redirect to the static PWA at /setup.html */
app.get('/setup', (req, res) => {
  res.redirect('/setup.html');
});

app.get('/asset-upload', (req, res) => {
  res.redirect('/asset-upload.html');
});

app.use(function (err, req, res, next) {
  if (!err) return next();
  const code = err.code != null ? String(err.code) : '';
  if (code.indexOf('LIMIT_') === 0) {
    return res.status(400).json({ ok: false, error: err.message || code });
  }
  const msg = String(err.message || '');
  if (msg.indexOf('Only JPEG') >= 0) {
    return res.status(400).json({ ok: false, error: msg });
  }
  next(err);
});

// ─────────────────────────────────────────────────────────────────────────────

function shutdownPersistOfflineReport() {
  try {
    persistOfflineDashboardReport();
  } catch (_) {}
}
function shutdownPersistSqliteSnapshot() {
  if (!SQLITE_SNAPSHOT_ENABLED) return Promise.resolve();
  return persistSqliteSnapshot().catch(() => null);
}
function gracefulShutdown(signal) {
  shutdownPersistOfflineReport();
  if (reconcileLoopHandle) {
    try { reconcileLoopHandle.stop(); } catch (_) { /* ignore */ }
  }
  if (alertWiringHandle) {
    try { alertWiringHandle.stop(); } catch (_) { /* ignore */ }
  }
  Promise.race([
    shutdownPersistSqliteSnapshot(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).finally(() => {
    console.log(`[shutdown] ${signal} — snapshots flushed.`);
    process.exit(0);
  });
}
process.on('SIGINT', function () { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', function () { gracefulShutdown('SIGTERM'); });

let excelWatchCatalogTimer = null;
let excelWatchEmpTimer = null;

function resolveXlsxPathForWatch(p) {
  if (!p) return '';
  return path.isAbsolute(p) ? p : path.join(__dirname, p);
}

function debouncedExcelCatalogReload() {
  if (excelWatchCatalogTimer) clearTimeout(excelWatchCatalogTimer);
  excelWatchCatalogTimer = setTimeout(function () {
    excelWatchCatalogTimer = null;
    try {
      loadCatalogFromXlsxFile();
    } catch (e) {
      console.warn('[excel-watch] catalog reload:', e.message);
    }
  }, 1500);
}

function debouncedExcelEmployeesReload() {
  if (excelWatchEmpTimer) clearTimeout(excelWatchEmpTimer);
  excelWatchEmpTimer = setTimeout(function () {
    excelWatchEmpTimer = null;
    try {
      loadEmployeesFromXlsxFile();
    } catch (e) {
      console.warn('[excel-watch] employees reload:', e.message);
    }
  }, 1500);
}

function startExcelFileWatchers() {
  const flag = String(process.env.EXCEL_FILE_WATCH || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') {
    console.log('[excel-watch] Disabled (EXCEL_FILE_WATCH=false)');
    return;
  }
  const cat = resolveXlsxPathForWatch(CATALOG_XLSX_PATH);
  const emp = resolveXlsxPathForWatch(EMPLOYEES_XLSX_PATH);
  let n = 0;
  if (cat && fs.existsSync(cat)) {
    chokidar
      .watch(cat, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 100 },
      })
      .on('all', function () {
        debouncedExcelCatalogReload();
      });
    n += 1;
    console.log('[excel-watch] Catalog:', cat);
  }
  if (emp && fs.existsSync(emp)) {
    chokidar
      .watch(emp, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 100 },
      })
      .on('all', function () {
        debouncedExcelEmployeesReload();
      });
    n += 1;
    console.log('[excel-watch] Employees:', emp);
  }
  if (!n && (CATALOG_XLSX_PATH || EMPLOYEES_XLSX_PATH)) {
    console.log('[excel-watch] No xlsx file found on disk yet; using interval reload only.');
  }
}

loadFactoryWorkTypesFromDisk();

// START SERVER
server.listen(PORT, () => {
  ensurePublicUploadDirs();
  ensureCeoQueueDir();
  recoverCeoIngestQueue();
  syncCeoPendingCountFromDisk();
  void drainCeoIngestQueue();
  if (CF_URL && CF_SECRET) {
    setInterval(function () { void drainCeoIngestQueue(); }, CEO_INGEST_RETRY_MS);
    console.log(
      `  CEO queue: ${CEO_QUEUE_FILE} (flush every ${CEO_INGEST_RETRY_MS}ms when pending)`
    );
  }
  attachEmployeeImagesFromDisk();
  attachItemImagesFromDisk();
  loadEmployeesFromManualFile();
  const lanIPs = getLanIPs();
  const lanIp = lanIPs.length ? lanIPs[0].address : 'localhost';
  console.log(`Abaya Central Server running on http://localhost:${PORT}`);
  console.log(`  Kiosk:     http://localhost:${PORT}/kiosk.html`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  QR Setup:  http://localhost:${PORT}/setup   (LAN: http://${lanIp}:${PORT}/setup)`);
  console.log(`  Media:     http://localhost:${PORT}/asset-upload   (employee + item images)`);
  console.log(`  Socket.IO: pingInterval=${SOCKET_PING_INTERVAL_MS}ms pingTimeout=${SOCKET_PING_TIMEOUT_MS}ms cookie=false allowEIO3=true`);
  const persistence = getPersistenceHealth();
  console.log(
    `  Cloud sync mode: ${getCeoSyncMode()} (CEO ingest pending: ${ceoIngestPendingCount})`
  );
  console.log(`  Offline snapshot: ${persistence.offlineSnapshotFile} (writable=${persistence.offlineReportDirWritable})`);
  console.log(`  CEO queue file:   ${persistence.ceoQueueFile} (writable=${persistence.ceoQueueDirWritable})`);
  refreshAbayaCatalogFromCloud();
  setInterval(refreshAbayaCatalogFromCloud, 60000);
  setInterval(persistOfflineDashboardReport, 60000);
  setImmediate(persistOfflineDashboardReport);
  if (SQLITE_SNAPSHOT_ENABLED) {
    setInterval(() => { void persistSqliteSnapshot(); }, SQLITE_SNAPSHOT_INTERVAL_MS);
    setTimeout(() => { void persistSqliteSnapshot(); }, 5000);
    console.log(
      `  SQLite snapshot: ${SQLITE_SNAPSHOT_DIR_RESOLVED} (every ${Math.round(SQLITE_SNAPSHOT_INTERVAL_MS / 1000)}s` +
        (SQLITE_SNAPSHOT_RETENTION_DAYS != null ? `, retention ${SQLITE_SNAPSHOT_RETENTION_DAYS}d` : ', no rotation cleanup') +
        ')'
    );
  } else {
    console.log('  SQLite snapshot: disabled (SQLITE_SNAPSHOT_ENABLED=0)');
  }
  refreshWorkingHoursFromCloud();
  setInterval(refreshWorkingHoursFromCloud, 5 * 60 * 1000);
  const alerts = ensureAlertManager();
  if (alerts) {
    console.log(`  Alerts: Resend → ${alerts.to.join(', ')} (cooldown ${Math.round(alerts.dedupMs / 60000)}m, cap ${alerts.hourlyCap}/h${alerts.dryRun ? ', DRY_RUN' : ''})`);
  } else {
    console.log('  Alerts: disabled (set RESEND_API_KEY + ALERTS_TO to enable)');
  }
  if (RECONCILE_ENABLED) {
    reconcileLoopHandle = reconcileCloudflare.startReconcileLoop(
      {
        cfUrl: CF_URL,
        cfSecret: CF_SECRET,
        getLocalState: getReconcileLocalState,
        push: pushToCloudflare,
      },
      {
        intervalMs: RECONCILE_INTERVAL_MS,
        maxRepushPerCycle: RECONCILE_MAX_REPUSH,
        log: (...args) => console.log('[reconcile]', ...args),
      }
    );
    console.log(
      `  Reconciliation: every ${Math.round(RECONCILE_INTERVAL_MS / 1000)}s, max repush=${RECONCILE_MAX_REPUSH}`
    );
  } else if (CF_URL && CF_SECRET) {
    console.log('  Reconciliation: disabled (RECONCILE_ENABLED=0)');
  }
  console.log(
    `  Dashboard state: logs window ${Math.round(STATE_LOG_WINDOW_MS / 3600000)}h, max ${STATE_LOG_MAX_ROWS} rows (STATE_LOG_* env to override)`
  );
  if (CATALOG_XLSX_PATH) {
    setTimeout(loadCatalogFromXlsxFile, 3000);
    setInterval(loadCatalogFromXlsxFile, CATALOG_XLSX_INTERVAL_MS);
    console.log(`  Catalog:   ${path.resolve(__dirname, CATALOG_XLSX_PATH)} (refreshes every ${Math.round(CATALOG_XLSX_INTERVAL_MS / 3600000)}h)`);
  }
  if (EMPLOYEES_XLSX_PATH) {
    setTimeout(loadEmployeesFromXlsxFile, 2000);
    setInterval(loadEmployeesFromXlsxFile, EMPLOYEES_XLSX_INTERVAL_MS);
    console.log(`  Employees: ${path.resolve(__dirname, EMPLOYEES_XLSX_PATH)} (refreshes every ${Math.round(EMPLOYEES_XLSX_INTERVAL_MS / 3600000)}h)`);
  }
  startExcelFileWatchers();
});
