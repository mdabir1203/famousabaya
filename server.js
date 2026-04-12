'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

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

const ABAYAS = [
  {id:'a1',code:'AB-0041',barcode:'AB00000041',design:'Classic Black Bisht',    process:'Tailor (01)'},
  {id:'a2',code:'AB-0042',barcode:'AB00000042',design:'Embroidered Ceremonial', process:'Tailor (02)'},
  {id:'a3',code:'AB-0043',barcode:'AB00000043',design:'Casual Linen Blend',     process:'Hand Work'},
  {id:'a4',code:'AB-0044',barcode:'AB00000044',design:'Royal Velvet Edition',   process:'Stone Work'},
  {id:'a5',code:'AB-0045',barcode:'AB00000045',design:'Minimal White Abaya',    process:'Button'},
  {id:'a6',code:'AB-0046',barcode:'AB00000046',design:'Sport Performance',      process:'Embroidery'},
  {id:'a7',code:'AB-0047',barcode:'AB00000047',design:'Heritage Embossed',      process:'Ari Work'},
  {id:'a8',code:'AB-0048',barcode:'AB00000048',design:'Silk Ceremonial',        process:'Hand Designing'},
  {id:'a9',code:'AB-0049',barcode:'AB00000049',design:'Invoice batch',          process:'Invoice maker'},
  {id:'a10',code:'AB-0050',barcode:'AB00000050',design:'Packaging queue',        process:'Packaging'},
  {id:'a11',code:'AB-0051',barcode:'AB00000051',design:'QC inspection lot',      process:'Checker'},
];

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
      var abIdx = ABAYAS.findIndex(a => a.id === ACTIVE_SESSIONS[emp.id].abaya_id);
      abaya_code = abIdx >= 0 ? ABAYAS[abIdx].code : null;
    }
    var session_process = is_active && ACTIVE_SESSIONS[emp.id] ? ACTIVE_SESSIONS[emp.id].process : null;
    callback({ok:true, employee:emp, is_active:is_active, abaya_code:abaya_code, session_process:session_process});
  });

  socket.on('req_startWork', (data, callback) => {
    const { emp_id, abaya_id, process: selectedProcess } = data;
    if (ACTIVE_SESSIONS[emp_id]) return callback({ok:false, error:'Already has active session'});

    const emp = EMPLOYEES.find(e => e.id === emp_id);
    const ab  = ABAYAS.find(a => a.id === abaya_id);
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
    const abEnd = ABAYAS.findIndex(a => a.id === record.abaya_id);
    const abaya_code = abEnd >= 0 ? ABAYAS[abEnd].code : null;

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

// START SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Abaya Central Server running on http://localhost:${PORT}`);
});
