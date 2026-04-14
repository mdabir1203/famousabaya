'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');

/** Default 3000; override with PORT in .env */
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const server = http.createServer(app);
const SOCKET_PING_INTERVAL_MS = Number(process.env.SOCKET_PING_INTERVAL_MS) > 0
  ? Number(process.env.SOCKET_PING_INTERVAL_MS)
  : 25000;
const SOCKET_PING_TIMEOUT_MS = Number(process.env.SOCKET_PING_TIMEOUT_MS) > 0
  ? Number(process.env.SOCKET_PING_TIMEOUT_MS)
  : 60000;

const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  pingInterval: SOCKET_PING_INTERVAL_MS,
  pingTimeout: SOCKET_PING_TIMEOUT_MS,
});

// ─── CLOUDFLARE PUSH LAYER ────────────────────────────────────────────────────
// Set these in a .env file or environment variables before starting the server:
//   CF_WORKER_URL=https://abaya-track.yourname.workers.dev
//   CF_INGEST_SECRET=your_shared_secret_here
const CF_URL    = process.env.CF_WORKER_URL || '';
const CF_SECRET = process.env.CF_INGEST_SECRET || '';

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
  if (!CF_URL || !CF_SECRET) return; // Skip if not configured
  try {
    const res = await fetch(CF_URL + '/api/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Secret': CF_SECRET,
      },
      body: JSON.stringify({ type, payload }),
      signal: AbortSignal.timeout(8000), // 8-second timeout, non-blocking
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('[CF] Push failed:', type, err.slice(0, 120));
    } else {
      console.log('[CF] Pushed:', type, payload.emp_id || '');
    }
  } catch (e) {
    console.warn('[CF] Push error (non-fatal):', e.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================
// MASTER CLOUD STATE (In-Memory Database)
// ============================================================
const EMPLOYEES = [
  {id:'e1', emp_no:109, ac_no:1,  name:'Misbah',        code:'EMP109', barcode:'00000109', process:'Tailor (01)',   color:'#3b82f6', initials:'MI', photo:'uploads/Misbah.jpeg'},
  {id:'e2', emp_no:110, ac_no:2,  name:'Cyril',         code:'EMP110', barcode:'00000110', process:'Tailor (02)', color:'#a78bfa', initials:'CY'},
  {id:'e3', emp_no:111, ac_no:3,  name:'Irfan',         code:'EMP111', barcode:'00000111', process:'Hand Work', color:'#22c55e', initials:'IR'},
  {id:'e4', emp_no:112, ac_no:4,  name:'Mohammed',      code:'EMP112', barcode:'00000112', process:'Stone Work',   color:'#f59e0b', initials:'MO'},
  {id:'e5', emp_no:113, ac_no:5,  name:'Mojeeb',        code:'EMP113', barcode:'00000113', process:'Button', color:'#ec4899', initials:'MO'},
  {id:'e6', emp_no:114, ac_no:6,  name:'Sheron',        code:'EMP114', barcode:'00000114', process:'Embroidery', color:'#06b6d4', initials:'SH'},
  {id:'e7', emp_no:115, ac_no:7,  name:'Arif',          code:'EMP115', barcode:'00000115', process:'Ari Work',   color:'#f97316', initials:'AR'},
  {id:'e8', emp_no:116, ac_no:8,  name:'Ridowan',       code:'EMP116', barcode:'00000116', process:'Hand Designing', color:'#ef4444', initials:'RI'},
  {id:'e9', emp_no:117, ac_no:9,  name:'Amirull',       code:'EMP117', barcode:'00000117', process:'Tailor (01)', color:'#8b5cf6', initials:'AM'},
  {id:'e10',emp_no:118, ac_no:10, name:'Arman',         code:'EMP118', barcode:'00000118', process:'Tailor (02)',   color:'#10b981', initials:'AR'},
  {id:'e11',emp_no:119, ac_no:11, name:'Shahid',        code:'EMP119', barcode:'00000119', process:'Hand Work', color:'#f59e0b', initials:'SH'},
  {id:'e12',emp_no:120, ac_no:12, name:'Shabaj',        code:'EMP120', barcode:'00000120', process:'Stone Work', color:'#3b82f6', initials:'SH'},
  {id:'e13',emp_no:121, ac_no:13, name:'Alazar',        code:'EMP121', barcode:'00000121', process:'Button',   color:'#ec4899', initials:'AL'},
  {id:'e14',emp_no:122, ac_no:14, name:'Hafiz',         code:'EMP122', barcode:'00000122', process:'Embroidery', color:'#a78bfa', initials:'HA'},
  {id:'e15',emp_no:123, ac_no:15, name:'Anasari',       code:'EMP123', barcode:'00000123', process:'Ari Work', color:'#22c55e', initials:'AN'},
  {id:'e16',emp_no:124, ac_no:16, name:'Maishad',       code:'EMP124', barcode:'00000124', process:'Hand Designing',   color:'#06b6d4', initials:'MA'},
  {id:'e17',emp_no:125, ac_no:17, name:'Mouthirrahman', code:'EMP125', barcode:'00000125', process:'Invoice maker', color:'#eab308', initials:'MO'},
  {id:'e19',emp_no:128, ac_no:19, name:'Ibrahim',       code:'EMP128', barcode:'00000128', process:'Packaging', color:'#84cc16', initials:'IB'},
  {id:'e20',emp_no:129, ac_no:20, name:'Farhan',        code:'EMP129', barcode:'00000129', process:'Checker',   color:'#0ea5e9', initials:'FA'},
  {id:'e21',emp_no:130, ac_no:21, name:'Naserulla',     code:'EMP130', barcode:'00000130', process:'Tailor (01)', color:'#10b981', initials:'NA'},
  {id:'e22',emp_no:131, ac_no:22, name:'Mamush',        code:'EMP131', barcode:'00000131', process:'Button', color:'#f59e0b', initials:'MA'},
  {id:'e23',emp_no:132, ac_no:23, name:'Wasim',         code:'EMP132', barcode:'00000132', process:'Embroidery',   color:'#3b82f6', initials:'WA'},
  {id:'e24',emp_no:133, ac_no:24, name:'Anwar',         code:'EMP133', barcode:'00000133', process:'Ari Work', color:'#ec4899', initials:'AN'},
  {id:'e25',emp_no:134, ac_no:25, name:'Raees',         code:'EMP134', barcode:'00000134', process:'Hand Designing', color:'#a78bfa', initials:'RA'},
  {id:'e26',emp_no:135, ac_no:26, name:'ArmanAnasari',  code:'EMP135', barcode:'00000135', process:'Tailor (01)',   color:'#22c55e', initials:'AR'},
];

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

const AC_MAP = {};
EMPLOYEES.forEach(e => AC_MAP[e.ac_no] = e);

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

/** Minimal fields for office catalog watcher (employee folder names ↔ process alignment). */
app.get('/api/employees', (req, res) => {
  res.json({
    ok: true,
    employees: EMPLOYEES.map(function (e) {
      return {
        id: e.id,
        name: e.name,
        code: e.code,
        emp_no: e.emp_no,
        ac_no: e.ac_no,
        process: e.process,
      };
    }),
  });
});

const CATALOG_INGEST_SECRET = process.env.CATALOG_INGEST_SECRET || process.env.CF_INGEST_SECRET || '';

// ─── LOCAL XLSX CATALOG LOADER ────────────────────────────────────────────────
// Set CATALOG_XLSX_PATH in .env to a local items_export.xlsx.
// The server reads it at startup and refreshes every CATALOG_XLSX_INTERVAL_MS (default 24 h).
const CATALOG_XLSX_PATH = process.env.CATALOG_XLSX_PATH || '';
const CATALOG_XLSX_INTERVAL_MS = Math.max(Number(process.env.CATALOG_XLSX_INTERVAL_MS) || 0, 3600000) || 86400000;

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
  const sheetName = wb.SheetNames.includes('Items') ? 'Items' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  const abayas = [];
  for (const row of rows) {
    const out = { id: '', code: '', barcode: '', design: '', process: '', tier: '', icon: '' };
    for (const [k, v] of Object.entries(row)) {
      const norm = k.trim().toLowerCase().replace(/[\s\u00a0-]+/g, '_');
      const field = XLSX_REVERSE_MAP[norm];
      // For optional fields (design, tier, icon, id, code) use first non-empty value only.
      if (field && out[field] === '') out[field] = String(v || '').trim();
    }
    if (!out.id && !out.code && !out.barcode) continue;
    // Auto-derive code from barcode; id from barcode slug (supports repeated product codes).
    if (!out.code && out.barcode) out.code = out.barcode;
    if (!out.id && out.barcode) {
      out.id = out.barcode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    // process is set externally (folder name / catalog-watcher); only barcode is required.
    if (out.barcode) abayas.push(out);
  }
  return abayas;
}

function loadCatalogFromXlsxFile() {
  if (!CATALOG_XLSX_PATH) return;
  const resolved = path.isAbsolute(CATALOG_XLSX_PATH)
    ? CATALOG_XLSX_PATH
    : path.join(__dirname, CATALOG_XLSX_PATH);
  if (!fs.existsSync(resolved)) {
    console.warn('[catalog-xlsx] File not found:', resolved);
    return;
  }
  try {
    const abayas = parseCatalogXlsxFile(resolved);
    if (abayas.length === 0) { console.warn('[catalog-xlsx] No valid rows found in', resolved); return; }
    abayaCatalog = normalizeAbayaCatalogRows(abayas);
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
    if (!barcode || !process) {
      return {
        ok: false,
        error: 'Row ' + (i + 1) + ': barcode and process are required (design may be empty)',
      };
    }
    if (!code) code = barcode;
    if (!id) id = barcode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (seenId.has(id)) return { ok: false, error: 'Duplicate id in upload: ' + id };
    if (seenBc.has(barcode)) return { ok: false, error: 'Duplicate barcode in upload: ' + barcode };
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


// ─────────────────────────────────────────────────────────────────────────────

// START SERVER
server.listen(PORT, () => {
  const lanIPs = getLanIPs();
  const lanIp = lanIPs.length ? lanIPs[0].address : 'localhost';
  console.log(`Abaya Central Server running on http://localhost:${PORT}`);
  console.log(`  Kiosk:     http://localhost:${PORT}/kiosk.html`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  QR Setup:  http://localhost:${PORT}/setup   (LAN: http://${lanIp}:${PORT}/setup)`);
  console.log(`  Socket.IO: pingInterval=${SOCKET_PING_INTERVAL_MS}ms pingTimeout=${SOCKET_PING_TIMEOUT_MS}ms`);
  refreshAbayaCatalogFromCloud();
  setInterval(refreshAbayaCatalogFromCloud, 60000);
  // Local xlsx catalog: load at startup then refresh daily
  if (CATALOG_XLSX_PATH) {
    setTimeout(loadCatalogFromXlsxFile, 3000);
    setInterval(loadCatalogFromXlsxFile, CATALOG_XLSX_INTERVAL_MS);
    console.log(`  Catalog:   ${path.resolve(__dirname, CATALOG_XLSX_PATH)} (refreshes every ${Math.round(CATALOG_XLSX_INTERVAL_MS / 3600000)}h)`);
  }
});
