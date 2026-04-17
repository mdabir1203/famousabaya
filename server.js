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
const localStore = require('./lib/local-store');

/** Default 3000; override with PORT in .env */
const PORT = process.env.PORT || 3000;

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
      if (lower.endsWith('.html') || lower.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);
app.use(express.json());

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

function appendCeoIngestFailed(type, payload) {
  if (!CF_URL || !CF_SECRET) return;
  ensureCeoQueueDir();
  const rec = {
    v: 1,
    id: crypto.randomUUID(),
    type,
    payload,
    queuedAt: Date.now(),
  };
  try {
    fs.appendFileSync(CEO_QUEUE_FILE, JSON.stringify(rec) + '\n', 'utf8');
    ceoIngestPendingCount += 1;
    console.warn('[ceo-queue] Buffered for CEO sync, pending=', ceoIngestPendingCount);
  } catch (e) {
    console.error('[ceo-queue] Could not persist event:', e.message);
  }
}

async function tryPostCeoIngestOnce(type, payload) {
  return fetch(CF_URL + '/api/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Secret': CF_SECRET,
    },
    body: JSON.stringify({ type, payload }),
    signal: AbortSignal.timeout(8000),
  });
}

/** Optional: drain NDJSON queue via POST /api/sync/v1/batch (HMAC + secret). Set CF_SYNC_USE_BATCH=1 */
const CF_SYNC_USE_BATCH = String(process.env.CF_SYNC_USE_BATCH || '').trim() === '1';

function hmacIngestBodySha256(bodyUtf8) {
  return crypto.createHmac('sha256', CF_SECRET).update(bodyUtf8, 'utf8').digest('hex');
}

async function tryPostCeoIngestBatch(events) {
  if (!CF_URL || !CF_SECRET || !events.length) return { ok: false, status: 0 };
  const raw = JSON.stringify({ events });
  const sig = hmacIngestBodySha256(raw);
  const res = await fetch(CF_URL + '/api/sync/v1/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Secret': CF_SECRET,
      'X-Sync-Signature': sig,
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: raw,
    signal: AbortSignal.timeout(20000),
  });
  return { ok: res.ok, status: res.status, res };
}

var MAX_INVOICE_NUMBERS = 500;
var MAX_INVOICE_DIGITS_PER = 20;
var MAX_INVOICE_RAW_CHARS = 12000;
var INVOICE_TOKEN_RE = /^\d{1,20}$/;

function parseInvoiceNumberList(raw) {
  var str = String(raw == null ? '' : raw);
  if (str.length > MAX_INVOICE_RAW_CHARS) {
    return { ok: false, error: 'List is too long. Use at most ' + MAX_INVOICE_RAW_CHARS + ' characters or split across sessions.', nums: [] };
  }
  var parts = str.trim().split(/[\r\n,;\s\u00a0]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  var nums = [];
  var seen = new Set();
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!INVOICE_TOKEN_RE.test(p)) {
      var show = p.length > 24 ? p.slice(0, 24) + '\u2026' : p;
      return {
        ok: false,
        error: 'Invalid value "' + show + '": each invoice number must be digits only, 1\u2013' + MAX_INVOICE_DIGITS_PER + ' digits.',
        nums: [],
      };
    }
    if (seen.has(p)) {
      return { ok: false, error: 'Duplicate invoice number: ' + p + '. Remove the duplicate.', nums: [] };
    }
    seen.add(p);
    nums.push(p);
  }
  if (nums.length < 1) {
    return { ok: false, error: 'Enter at least one invoice number.', nums: [] };
  }
  if (nums.length > MAX_INVOICE_NUMBERS) {
    return { ok: false, error: 'Too many invoice numbers (max ' + MAX_INVOICE_NUMBERS + ' per session).', nums: [] };
  }
  return { ok: true, error: '', nums: nums };
}

async function pushToCloudflare(type, payload) {
  if (!CF_URL || !CF_SECRET) return;
  try {
    const res = await tryPostCeoIngestOnce(type, payload);
    if (res.ok) {
      console.log('[CF] Pushed:', type, payload.emp_id || '');
      void drainCeoIngestQueue();
      return;
    }
    const txt = await res.text();
    const snip = txt.slice(0, 160);
    if (res.status === 401 || res.status === 403) {
      console.warn('[CF] Push rejected (fix secret; not queued):', type, res.status, snip);
      return;
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      console.warn('[CF] Push rejected (not queued):', type, res.status, snip);
      return;
    }
    console.warn('[CF] Push failed (queued for retry):', type, res.status, snip);
    appendCeoIngestFailed(type, payload);
  } catch (e) {
    console.warn('[CF] Push error (queued for retry):', e.message);
    appendCeoIngestFailed(type, payload);
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
    return;
  }

  ceoQueueFlushRunning = true;
  const failed = [];
  try {
    try {
      fs.renameSync(CEO_QUEUE_FILE, CEO_QUEUE_DRAIN);
    } catch (e) {
      console.warn('[ceo-queue] rename skip:', e.message);
      return;
    }
    const raw = fs.readFileSync(CEO_QUEUE_DRAIN, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const recs = [];
    for (let li = 0; li < lines.length; li++) {
      try {
        const rec = JSON.parse(lines[li]);
        if (rec && rec.v === 1 && rec.type && rec.payload != null) recs.push(rec);
      } catch {
        /* skip bad line */
      }
    }

    if (CF_SYNC_USE_BATCH && recs.length >= 2) {
      try {
        const events = recs.map(function (r) {
          return { type: r.type, payload: r.payload };
        });
        const br = await tryPostCeoIngestBatch(events);
        if (br.ok) {
          fs.unlinkSync(CEO_QUEUE_DRAIN);
          console.log('[ceo-queue] Batch posted', recs.length, 'events to /api/sync/v1/batch');
          return;
        }
        console.warn('[ceo-queue] Batch replay failed HTTP', br.status, '— falling back to single-event POSTs');
      } catch (e) {
        console.warn('[ceo-queue] Batch replay error:', e.message);
      }
    }

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
          if (st === 401 || st === 403 || (st >= 400 && st < 500 && st !== 408 && st !== 429)) {
            console.warn('[ceo-queue] Drop on replay (client error):', rec.type, st);
            continue;
          }
          failed.push(rec);
        }
      } catch {
        failed.push(rec);
      }
    }
    if (failed.length) {
      const body = failed.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n';
      fs.appendFileSync(CEO_QUEUE_FILE, body, 'utf8');
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
  }
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
  {id:'e21',emp_no:130, ac_no:21, name:'Naserulla',     code:'EMP130', barcode:'00000130', process:'Tailor (01)', color:'#14b8a6', initials:'NA'},
  {id:'e22',emp_no:131, ac_no:22, name:'Mamush',        code:'EMP131', barcode:'00000131', process:'Button', color:'#ffb287', initials:'MA'},
  {id:'e23',emp_no:132, ac_no:23, name:'Wasim',         code:'EMP132', barcode:'00000132', process:'Embroidery',   color:'#6a5fc1', initials:'WA'},
  {id:'e24',emp_no:133, ac_no:24, name:'Anwar',         code:'EMP133', barcode:'00000133', process:'Ari Work', color:'#fa7faa', initials:'AN'},
  {id:'e25',emp_no:134, ac_no:25, name:'Raees',         code:'EMP134', barcode:'00000134', process:'Hand Designing', color:'#a78bfa', initials:'RA'},
  {id:'e26',emp_no:135, ac_no:26, name:'ArmanAnasari',  code:'EMP135', barcode:'00000135', process:'Tailor (01)',   color:'#c2ef4e', initials:'AR'},
];
let EMPLOYEES = DEFAULT_EMPLOYEES.slice();

const DEFAULT_ABAYA_CATALOG = [
  {id:'a1', code:'AB-0041',barcode:'AB00000041',design:'Classic Black Bisht',    process:'Tailor (01)',    tier:'Standard',   icon: ''},
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

function emitEmployeesChanged() {
  employeesDataVersion += 1;
  io.emit('employees_update', { count: EMPLOYEES.length, version: employeesDataVersion });
}

function getClientSyncPayload() {
  return {
    ok: true,
    appVersion: APP_PACKAGE_VERSION,
    serverStartedAt: SERVER_STARTED_AT,
    catalogVersion: catalogCloudVersion,
    employeesVersion: employeesDataVersion,
    catalogRows: abayaCatalog.length,
    employeeRows: EMPLOYEES.length,
    ceoIngestCloud: !!(CF_URL && CF_SECRET),
    ceoIngestPending: ceoIngestPendingCount,
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

let AC_MAP = {};
function rebuildACMap() {
  AC_MAP = {};
  EMPLOYEES.forEach(e => AC_MAP[e.ac_no] = e);
}
rebuildACMap();

localStore.init(__dirname);
if (localStore.isEnabled()) {
  const hydrated = localStore.loadState(EMPLOYEES.map(function (e) {
    return e.id;
  }));
  if (hydrated) {
    ACTIVE_SESSIONS = hydrated.active;
    COMPLETED_LOGS = hydrated.logs;
    EMP_PERF = hydrated.perf;
    console.log('[local-store] Restored active sessions:', Object.keys(ACTIVE_SESSIONS).length);
  }
}

function getRealtimeState() {
  return {
    active: ACTIVE_SESSIONS,
    logs: COMPLETED_LOGS,
    perf: EMP_PERF,
    generated_at: Date.now(),
  };
}

// Broadcast full state to all connected dashboard and kiosk clients
function broadcastState() {
  io.emit('state_update', getRealtimeState());
}

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
  socket.emit('state_update', getRealtimeState());
  socket.emit('sync_versions', getClientSyncPayload());

  socket.on('req_lookup', (ac_no, callback) => {
    var emp = AC_MAP[ac_no];
    if (!emp) return callback({ok:false, error:'No employee found for AC-No. ' + ac_no});
    var is_active = !!ACTIVE_SESSIONS[emp.id];
    var abaya_code = null;
    if (is_active && ACTIVE_SESSIONS[emp.id]) {
      var abIdx = abayaCatalog.findIndex(a => a.id === ACTIVE_SESSIONS[emp.id].abaya_id);
      abaya_code = abIdx >= 0 ? abayaCatalog[abIdx].code : null;
    }
    var session_process = is_active && ACTIVE_SESSIONS[emp.id] ? ACTIVE_SESSIONS[emp.id].process : null;
    callback({ok:true, employee:emp, is_active:is_active, abaya_code:abaya_code, session_process:session_process});
  });

  socket.on('req_startWork', (data, callback) => {
    const { emp_id, abaya_id, process: selectedProcess } = data;
    if (ACTIVE_SESSIONS[emp_id]) return callback({ok:false, error:'Already has active session'});

    const emp = EMPLOYEES.find(e => e.id === emp_id);
    const ab  = abayaCatalog.find(a => a.id === abaya_id);
    // Use the role the employee selected on the kiosk, fall back to their default
    const sessionProcess = selectedProcess || (emp ? emp.process : 'Tailor (01)');
    const log_id = 'WL-' + emp_id + '-' + Date.now();
    const started_at_sec = Math.floor(Date.now() / 1000);
    ACTIVE_SESSIONS[emp_id] = { emp_id, abaya_id, log_id, started_at: Date.now(), process: sessionProcess };
    localStore.upsertActiveSession(ACTIVE_SESSIONS[emp_id]);

    broadcastState();
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

    var now = Date.now();
    var duration_seconds = Math.floor((now - sess.started_at) / 1000);

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
    };
    COMPLETED_LOGS.push(record);
    localStore.appendCompleted(record);

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

    delete ACTIVE_SESSIONS[emp_id];
    localStore.deleteActiveSession(emp_id);
    localStore.saveEmpPerf(EMP_PERF);
    broadcastState();
    var cbPayload = {
      ok: true,
      duration_seconds,
      abaya_code,
      session_process: record.process,
      invoice_count: record.invoice_count,
      invoice_serial: record.invoice_serial,
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
  res.json({ ok: true, state: getRealtimeState() });
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

const CATALOG_INGEST_SECRET = process.env.CATALOG_INGEST_SECRET || process.env.CF_INGEST_SECRET || '';

/** Add a single employee (supervisor use). Protected by ingest secret. */
app.post('/api/employees', (req, res) => {
  if (!CATALOG_INGEST_SECRET || req.headers['x-ingest-secret'] !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  var b = req.body;
  if (!b || !b.name || !b.emp_no || !b.ac_no || !b.barcode || !b.process) {
    return res.status(400).json({ ok: false, error: 'Required: name, emp_no, ac_no, barcode, process' });
  }
  var empNo = parseInt(b.emp_no, 10);
  var acNo = parseInt(b.ac_no, 10);
  if (isNaN(empNo) || isNaN(acNo)) {
    return res.status(400).json({ ok: false, error: 'emp_no and ac_no must be integers' });
  }
  if (EMPLOYEES.some(function (e) { return e.barcode === String(b.barcode); })) {
    return res.status(409).json({ ok: false, error: 'Employee with this barcode already exists' });
  }
  var id = 'e' + (EMPLOYEES.length + 1) + '-' + Date.now();
  var emp = {
    id: id, emp_no: empNo, ac_no: acNo,
    name: String(b.name).trim(), code: b.code || ('EMP' + empNo),
    barcode: String(b.barcode).trim(), process: String(b.process).trim(),
    color: b.color || EMP_COLOR_PALETTE[EMPLOYEES.length % EMP_COLOR_PALETTE.length],
    initials: (String(b.name) || '?').slice(0, 2).toUpperCase(),
    photo: b.photo || '',
  };
  EMPLOYEES.push(emp);
  rebuildACMap();
  EMP_PERF.push({ id: id, units: 0, eff: 0, act: 0, idl: 0 });
  emitEmployeesChanged();
  res.json({ ok: true, employee: emp });
});

/** Update an existing employee. Protected by ingest secret. */
app.put('/api/employees/:id', (req, res) => {
  if (!CATALOG_INGEST_SECRET || req.headers['x-ingest-secret'] !== CATALOG_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  var idx = EMPLOYEES.findIndex(function (e) { return e.id === req.params.id; });
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Employee not found' });
  var b = req.body;
  var emp = EMPLOYEES[idx];
  if (b.name) emp.name = String(b.name).trim();
  if (b.emp_no) emp.emp_no = parseInt(b.emp_no, 10);
  if (b.ac_no) emp.ac_no = parseInt(b.ac_no, 10);
  if (b.barcode) emp.barcode = String(b.barcode).trim();
  if (b.process) emp.process = String(b.process).trim();
  if (b.code) emp.code = String(b.code).trim();
  if (b.color) emp.color = String(b.color).trim();
  if (b.photo != null) emp.photo = String(b.photo).trim();
  emp.initials = (emp.name || '?').slice(0, 2).toUpperCase();
  rebuildACMap();
  emitEmployeesChanged();
  res.json({ ok: true, employee: emp });
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
    if (seenBc.has(out.barcode)) continue;
    seenBc.add(out.barcode);
    const id = 'e' + (employees.length + 1);
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
    EMPLOYEES = parsed;
    attachEmployeeImagesFromDisk();
    EMP_PERF = EMPLOYEES.map(e => ({id: e.id, units: 0, eff: 0, act: 0, idl: 0}));
    rebuildACMap();
    localStore.saveEmpPerf(EMP_PERF);
    emitEmployeesChanged();
    console.log('[employees-xlsx] Loaded', parsed.length, 'employees from', resolved);
  } catch (e) {
    console.error('[employees-xlsx] Parse error (non-fatal):', e.message);
  }
}

// Catalog path (defaults to EXCEL_DATA_DIR/items_export.xlsx when dir set).
const CATALOG_XLSX_PATH = CATALOG_XLSX_PATH_RAW
  || (_excelDataDir ? path.join(_excelDataDir, 'items_export.xlsx') : '');
const CATALOG_XLSX_INTERVAL_MS = Math.max(Number(process.env.CATALOG_XLSX_INTERVAL_MS) || 0, 3600000) || 86400000;
const DEFAULT_CATALOG_PROCESS = String(process.env.DEFAULT_CATALOG_PROCESS || 'Tailor (01)').trim() || 'Tailor (01)';

// Column aliases mirror catalog-parse.js — keep in sync.
// "Barcode Display Name" and "Item Category" are the factory Excel column names.
function normalizeTierPipe(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  if (s.indexOf('|') >= 0) {
    var parts = s.split('|').map(function (p) {
      return p.trim();
    }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }
  return s;
}

const XLSX_COL_ALIASES = {
  id:      ['id', 'abaya_id', 'item_id'],
  code:    ['code', 'item_code', 'sku', 'abaya_code', 'product_code'],
  barcode: ['barcode', 'bar_code', 'bc', 'barcode_display_name', 'barcode_disp_variation', 'display_name', 'barcode_name'],
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
  const sheetName = wb.SheetNames.includes('Items') ? 'Items' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  const abayas = [];
  const seenBc = new Set();
  for (const row of rows) {
    const out = { id: '', code: '', barcode: '', design: '', process: '', tier: '', icon: '' };
    for (const [k, v] of Object.entries(row)) {
      const norm = k.trim().toLowerCase().replace(/[\s\u00a0-]+/g, '_');
      const field = XLSX_REVERSE_MAP[norm];
      if (field && out[field] === '') out[field] = String(v || '').trim();
    }
    if (!out.id && !out.code && !out.barcode) continue;
    if (!out.code && out.barcode) out.code = out.barcode;
    if (!out.id && out.barcode) {
      out.id = out.barcode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    if (out.tier) out.tier = normalizeTierPipe(out.tier);
    if (!out.barcode) continue;
    if (!String(out.process || '').trim()) out.process = DEFAULT_CATALOG_PROCESS;
    if (seenBc.has(out.barcode)) continue;
    seenBc.add(out.barcode);
    abayas.push(out);
  }
  return abayas;
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
  const seenBc = new Set();
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
    var iconRaw = r.icon;
    var icon = iconRaw == null || iconRaw === '' ? '' : String(iconRaw);
    if (!barcode) {
      continue;
    }
    if (!process) {
      process = DEFAULT_CATALOG_PROCESS;
    }
    if (!code) code = barcode;
    if (!id) id = barcode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (seenId.has(id) || seenBc.has(barcode)) continue;
    seenId.add(id);
    seenBc.add(barcode);
    norm.push({ id: id, code: code, barcode: barcode, design: design, process: process, icon: icon });
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
  res.json({
    ok: true,
    enabled: !!(CF_URL && CF_SECRET),
    pending: ceoIngestPendingCount,
    retryMs: CEO_INGEST_RETRY_MS,
    queueBasename: path.basename(CEO_QUEUE_FILE),
  });
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
  const lanIPs = getLanIPs();
  const lanIp = lanIPs.length ? lanIPs[0].address : 'localhost';
  console.log(`Abaya Central Server running on http://localhost:${PORT}`);
  console.log(`  Kiosk:     http://localhost:${PORT}/kiosk.html`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  QR Setup:  http://localhost:${PORT}/setup   (LAN: http://${lanIp}:${PORT}/setup)`);
  console.log(`  Media:     http://localhost:${PORT}/asset-upload   (employee + item images)`);
  console.log(`  Socket.IO: pingInterval=${SOCKET_PING_INTERVAL_MS}ms pingTimeout=${SOCKET_PING_TIMEOUT_MS}ms cookie=false allowEIO3=true`);
  refreshAbayaCatalogFromCloud();
  setInterval(refreshAbayaCatalogFromCloud, 60000);
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
});
