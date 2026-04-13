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

/** Default 3050 — less common than 3000 (fewer clashes); override with PORT in .env */
const PORT = process.env.PORT || 3050;

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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

// Broadcast full state to all connected dashboard and kiosk clients
function broadcastState() {
  io.emit('state_update', {
    active: ACTIVE_SESSIONS,
    logs: COMPLETED_LOGS,
    perf: EMP_PERF
  });
}

// ============================================================
// WEBSOCKET ROUTES
// ============================================================
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Immediately send current state to the single new client
  socket.emit('state_update', {
    active: ACTIVE_SESSIONS,
    logs: COMPLETED_LOGS,
    perf: EMP_PERF
  });

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

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.get('/api/catalog/abayas', (req, res) => {
  res.json({ ok: true, version: catalogCloudVersion, abayas: abayaCatalog });
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
    // Auto-derive code → barcode; id → slug of code.
    if (!out.code && out.barcode) out.code = out.barcode;
    if (!out.id && out.code) {
      out.id = out.code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
  const seenCode = new Set();
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
    if (!id || !code || !barcode || !process) {
      return {
        ok: false,
        error: 'Row ' + (i + 1) + ': id, code, barcode, and process are required (design may be empty)',
      };
    }
    if (seenId.has(id)) return { ok: false, error: 'Duplicate id in upload: ' + id };
    if (seenCode.has(code)) return { ok: false, error: 'Duplicate code in upload: ' + code };
    if (seenBc.has(barcode)) return { ok: false, error: 'Duplicate barcode in upload: ' + barcode };
    seenId.add(id);
    seenCode.add(code);
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

/** QR setup page: `/setup` — generates per-tablet QR codes for all factories. */
app.get('/setup', async (req, res) => {
  const ips = getLanIPs();
  const firstIp = ips.length ? ips[0].address : 'localhost';

  // Build one blank QR SVG as a placeholder (real ones generated client-side via JS)
  // We pre-generate the default kiosk QR server-side so it displays even without JS.
  let defaultQrSvg = '';
  try {
    defaultQrSvg = await QRCode.toString(
      `http://${firstIp}:${PORT}/kiosk.html`,
      { type: 'svg', margin: 1, width: 200 }
    );
  } catch (_) {}

  const ipOptions = ips
    .map((i) => `<option value="${i.address}">${i.address} (${i.name})</option>`)
    .join('') || `<option value="localhost">localhost (no LAN found)</option>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AbaYa Track — Tablet QR Setup</title>
<style>
:root{--bg:#0f0e0d;--s1:#1a1917;--s2:#242220;--bd:rgba(255,255,255,.1);--tx:#f0ede8;--tx2:#9c9890;--tx3:#6b6760;--gr:#22c55e;--bl:#3b82f6;--am:#f59e0b;--rd:#ef4444;--fn:'Segoe UI',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:var(--fn);padding:0 0 60px}
.header{background:var(--s1);border-bottom:1px solid var(--bd);padding:16px 24px;display:flex;align-items:center;gap:14px}
.logo{width:40px;height:40px;background:linear-gradient(135deg,#d4a574,#a0785a);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.header h1{font-size:18px;font-weight:700}
.header p{font-size:12px;color:var(--tx3);margin-top:2px}
.container{max-width:960px;margin:0 auto;padding:28px 20px 0}
.card{background:var(--s1);border:1px solid var(--bd);border-radius:16px;padding:24px;margin-bottom:24px}
.card h2{font-size:15px;font-weight:700;margin-bottom:16px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;font-size:11px}
.row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
label{display:block;font-size:12px;color:var(--tx3);margin-bottom:6px}
input,select{background:var(--s2);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:14px;padding:9px 12px;width:100%;outline:none}
input:focus,select:focus{border-color:var(--bl)}
.field{flex:1;min-width:160px}
.btn{background:var(--bl);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .15s}
.btn:hover{opacity:.85}
.btn-ghost{background:var(--s2);color:var(--tx);border:1px solid var(--bd)}
.btn-print{background:var(--gr)}
.factories-list{display:flex;flex-direction:column;gap:10px}
.factory-row{display:flex;gap:10px;align-items:center}
.factory-row input{flex:1}
.remove-btn{background:var(--s2);border:1px solid var(--bd);color:var(--tx3);border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.remove-btn:hover{color:var(--rd);border-color:var(--rd)}
.add-btn{font-size:13px;color:var(--bl);background:none;border:none;cursor:pointer;padding:4px 0;text-decoration:underline}
#qr-output{display:none}
.qr-section-label{font-size:13px;font-weight:700;color:var(--am);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--bd)}
.qr-factory-block{margin-bottom:36px}
.qr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
.qr-card{background:var(--s2);border:1px solid var(--bd);border-radius:14px;padding:16px;text-align:center;page-break-inside:avoid}
.qr-card svg,.qr-card img{width:160px;height:160px;display:block;margin:0 auto 10px;border-radius:8px;background:#fff;padding:4px}
.qr-factory-name{font-size:13px;font-weight:700;color:var(--am);margin-bottom:3px}
.qr-tablet-name{font-size:15px;font-weight:800;margin-bottom:6px}
.qr-url{font-size:9px;color:var(--tx3);word-break:break-all;line-height:1.4}
.qr-instruction{font-size:11px;color:var(--tx2);margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)}
.status-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(34,197,94,.12);color:var(--gr);margin-bottom:16px}
@media print{
  body{background:#fff;color:#000;padding:0}
  .header,.card:first-of-type,.no-print{display:none!important}
  #qr-output{display:block!important}
  .qr-card{background:#fff;border:1px solid #ddd;border-radius:8px;break-inside:avoid}
  .qr-card svg,.qr-card img{width:140px;height:140px}
  .qr-factory-name,.qr-tablet-name,.qr-url,.qr-instruction{color:#333}
  .qr-section-label{color:#666;border-bottom:1px solid #ddd}
  .qr-grid{grid-template-columns:repeat(4,1fr);gap:10px}
}
</style>
</head>
<body>
<div class="header">
  <div class="logo">&#129525;</div>
  <div>
    <h1>AbaYa Track — Tablet QR Setup</h1>
    <p>Generate QR codes to deploy the kiosk to tablets across all factories</p>
  </div>
</div>

<div class="container">

  <!-- Server info -->
  <div class="card no-print">
    <h2>Server Details</h2>
    <div class="row">
      <div class="field">
        <label>Server LAN IP</label>
        <select id="sel-ip">${ipOptions}</select>
      </div>
      <div class="field" style="max-width:120px">
        <label>Port</label>
        <input type="number" id="inp-port" value="${PORT}" min="1" max="65535">
      </div>
      <div class="field" style="max-width:220px">
        <label>Custom base URL (optional — overrides IP+port)</label>
        <input type="text" id="inp-custom-url" placeholder="https://abaya.yourcompany.com">
      </div>
    </div>
    <p style="font-size:11px;color:var(--tx3);margin-top:12px">
      &#9432; Make sure tablets are on the same Wi-Fi network as this server, or use a Cloudflare Tunnel URL above for cross-network access.
    </p>
  </div>

  <!-- Factory config -->
  <div class="card no-print">
    <h2>Factories &amp; Tablets</h2>
    <div id="factories-list" class="factories-list"></div>
    <button class="add-btn" onclick="addFactory()" style="margin-top:12px">+ Add another factory</button>
    <div class="row" style="margin-top:20px">
      <button class="btn" onclick="generateAll()">&#9654; Generate QR Codes</button>
      <button class="btn btn-ghost btn-print" onclick="window.print()">&#128438; Print All</button>
    </div>
  </div>

  <!-- QR output -->
  <div id="qr-output">
    <div id="qr-inner"></div>
  </div>

</div>

<script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
<script>
// ── Factory row management ───────────────────────────────────────────────────
let factoryCount = 0;
const DEFAULT_FACTORIES = [
  { name: 'Factory 1', tablets: 5 },
  { name: 'Factory 2', tablets: 5 },
];

function addFactory(name, tablets) {
  factoryCount++;
  const id = factoryCount;
  const div = document.createElement('div');
  div.className = 'factory-row';
  div.id = 'factory-row-' + id;
  div.innerHTML = \`
    <input type="text" placeholder="Factory name (e.g. Abu Dhabi Factory)" value="\${name || ''}" id="fname-\${id}">
    <input type="number" min="1" max="50" value="\${tablets || 5}" id="ftabs-\${id}" style="max-width:80px" title="Number of tablets">
    <button class="remove-btn" onclick="removeFactory(\${id})" title="Remove">&#215;</button>
  \`;
  document.getElementById('factories-list').appendChild(div);
}

function removeFactory(id) {
  const el = document.getElementById('factory-row-' + id);
  if (el) el.remove();
}

function getFactories() {
  const rows = document.querySelectorAll('.factory-row');
  const out = [];
  rows.forEach(row => {
    const id = row.id.replace('factory-row-', '');
    const name = (document.getElementById('fname-' + id) || {}).value || '';
    const tabs = parseInt((document.getElementById('ftabs-' + id) || {}).value || '5', 10);
    if (name.trim()) out.push({ name: name.trim(), tablets: Math.max(1, Math.min(50, tabs || 5)) });
  });
  return out;
}

function getBaseUrl() {
  const custom = document.getElementById('inp-custom-url').value.trim().replace(/\\/$/, '');
  if (custom) return custom;
  const ip = document.getElementById('sel-ip').value;
  const port = document.getElementById('inp-port').value;
  return 'http://' + ip + ':' + port;
}

// ── QR generation ────────────────────────────────────────────────────────────
async function generateAll() {
  const factories = getFactories();
  if (!factories.length) { alert('Add at least one factory.'); return; }
  const base = getBaseUrl();
  const inner = document.getElementById('qr-inner');
  inner.innerHTML = '<p style="color:var(--tx3);font-size:13px;padding:10px">Generating QR codes...</p>';
  document.getElementById('qr-output').style.display = 'block';
  inner.scrollIntoView({ behavior: 'smooth' });

  let html = '';
  for (const f of factories) {
    html += \`<div class="qr-factory-block">
      <div class="qr-section-label">&#127981; \${esc(f.name)} — \${f.tablets} tablet\${f.tablets !== 1 ? 's' : ''}</div>
      <div class="qr-grid" id="grid-\${esc(f.name.replace(/\\s+/g, '-'))}"></div>
    </div>\`;
  }
  inner.innerHTML = html;

  for (const f of factories) {
    const gridId = 'grid-' + esc(f.name.replace(/\\s+/g, '-'));
    const grid = document.getElementById(gridId);
    if (!grid) continue;
    for (let t = 1; t <= f.tablets; t++) {
      const label = 'T-' + String(t).padStart(2, '0');
      const url = base + '/kiosk.html?factory=' + encodeURIComponent(f.name) + '&tablet=' + encodeURIComponent(label);
      const card = document.createElement('div');
      card.className = 'qr-card';
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 160;
      card.appendChild(canvas);
      card.innerHTML += \`
        <div class="qr-factory-name">\${esc(f.name)}</div>
        <div class="qr-tablet-name">Tablet \${esc(label)}</div>
        <div class="qr-url">\${esc(url)}</div>
        <div class="qr-instruction">&#128247; Scan with tablet camera<br>or Chrome QR reader</div>
      \`;
      grid.appendChild(card);
      try {
        await QRCode.toCanvas(canvas, url, { margin: 1, width: 160, color: { dark: '#000000', light: '#ffffff' } });
      } catch(e) { canvas.style.background = '#333'; }
    }
  }
  document.getElementById('qr-output').style.display = 'block';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ─────────────────────────────────────────────────────────────────────
DEFAULT_FACTORIES.forEach(f => addFactory(f.name, f.tablets));

// Auto-refresh server info
fetch('/api/server-info').then(r=>r.json()).then(d=>{
  if (!d.ok) return;
  const sel = document.getElementById('sel-ip');
  const portInp = document.getElementById('inp-port');
  if (d.ips && d.ips.length) {
    sel.innerHTML = d.ips.map(i=>\`<option value="\${i.address}">\${i.address} (\${i.name})</option>\`).join('');
  }
  if (d.port) portInp.value = d.port;
}).catch(()=>{});
</script>
</body>
</html>`;

  res.send(html);
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
  refreshAbayaCatalogFromCloud();
  setInterval(refreshAbayaCatalogFromCloud, 60000);
  // Local xlsx catalog: load at startup then refresh daily
  if (CATALOG_XLSX_PATH) {
    setTimeout(loadCatalogFromXlsxFile, 3000);
    setInterval(loadCatalogFromXlsxFile, CATALOG_XLSX_INTERVAL_MS);
    console.log(`  Catalog:   ${path.resolve(__dirname, CATALOG_XLSX_PATH)} (refreshes every ${Math.round(CATALOG_XLSX_INTERVAL_MS / 3600000)}h)`);
  }
});
