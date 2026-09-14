'use strict';

function parseFloorExportRange(query) {
  const q = query || {};
  let fromMs = NaN;
  let toMs = NaN;
  if (q.from) {
    const raw = String(q.from).trim();
    if (/^\d+$/.test(raw)) fromMs = Number(raw);
    else fromMs = Date.parse(raw);
  }
  if (q.to) {
    const raw = String(q.to).trim();
    if (/^\d+$/.test(raw)) toMs = Number(raw);
    else toMs = Date.parse(raw);
  }
  const y = parseInt(String(q.year || ''), 10);
  if (!Number.isFinite(fromMs) && Number.isFinite(y) && y >= 1970 && y <= 2100) {
    fromMs = new Date(y, 0, 1).getTime();
    toMs = new Date(y, 11, 31, 23, 59, 59, 999).getTime();
  }
  return {
    fromMs: Number.isFinite(fromMs) ? fromMs : null,
    toMs: Number.isFinite(toMs) ? toMs : null,
  };
}

function filterLogsForExport(logs, fromMs, toMs) {
  return logs.filter(function (l) {
    const end = l && l.end;
    if (typeof end !== 'number') return false;
    if (fromMs != null && end < fromMs) return false;
    if (toMs != null && end > toMs) return false;
    return true;
  });
}

function escapeCsvField(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildFloorExportPayload(opts) {
  const query = (opts && opts.query) || {};
  const logs = (opts && opts.logs) || [];
  const employees = (opts && opts.employees) || [];
  const abayaCatalog = (opts && opts.abayaCatalog) || [];
  const appVersion = (opts && opts.appVersion) || '';
  const range = parseFloorExportRange(query);
  const wantSummary =
    String(query.summary || '') === '1' || String(query.summary || '').toLowerCase() === 'true';
  const filtered = filterLogsForExport(logs, range.fromMs, range.toMs);
  const empById = Object.create(null);
  for (let i = 0; i < employees.length; i++) empById[employees[i].id] = employees[i];
  const abayaById = Object.create(null);
  for (let i = 0; i < abayaCatalog.length; i++) abayaById[abayaCatalog[i].id] = abayaCatalog[i];

  const sessions = filtered.map(function (l) {
    const d = new Date(l.end);
    const emp = empById[l.emp_id];
    const ab = abayaById[l.abaya_id];
    return {
      emp_id: l.emp_id,
      emp_name: emp ? emp.name : '',
      emp_code: emp ? emp.code : '',
      abaya_id: l.abaya_id,
      abaya_code: ab ? ab.code : '',
      abaya_barcode: ab ? ab.barcode : '',
      process: l.process || '',
      start: l.start,
      end: l.end,
      end_iso: d.toISOString(),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      duration_sec: l.duration_sec,
      hour: l.hour,
      quantity: l.quantity != null ? l.quantity : '',
      checker_barcode: l.checker_barcode != null ? l.checker_barcode : '',
      invoice_count: l.invoice_count != null ? l.invoice_count : '',
      invoice_serial: l.invoice_serial != null ? l.invoice_serial : '',
    };
  });

  let byYearMonth = null;
  if (wantSummary) {
    byYearMonth = Object.create(null);
    for (let i = 0; i < sessions.length; i++) {
      const row = sessions[i];
      const key = row.year + '-' + String(row.month).padStart(2, '0');
      if (!byYearMonth[key]) byYearMonth[key] = { sessions: 0, totalDurationSec: 0 };
      byYearMonth[key].sessions += 1;
      byYearMonth[key].totalDurationSec += Number(row.duration_sec) || 0;
    }
  }

  const meta = {
    generatedAt: Date.now(),
    generatedAtIso: new Date().toISOString(),
    rowCount: sessions.length,
    filters: { fromMs: range.fromMs, toMs: range.toMs },
    appVersion: appVersion,
    note: 'Factory PC in-memory sessions only; cloud CEO / D1 is system of record for long cross-site history.',
  };
  if (sessions.length > 100000) meta.warning = 'Large export; consider narrowing date range.';

  return { ok: true, meta: meta, sessions: sessions, byYearMonth: byYearMonth };
}

function floorSessionsToCsv(sessions) {
  const headers = [
    'emp_id', 'emp_name', 'emp_code', 'abaya_id', 'abaya_code', 'abaya_barcode',
    'process', 'start', 'end', 'end_iso', 'year', 'month', 'duration_sec', 'hour',
    'quantity', 'checker_barcode', 'invoice_count', 'invoice_serial',
  ];
  const lines = [headers.join(',')];
  for (let i = 0; i < sessions.length; i++) {
    const r = sessions[i];
    lines.push(headers.map(function (h) { return escapeCsvField(r[h]); }).join(','));
  }
  return lines.join('\r\n');
}

function normalizeImportedFloorSessions(rows) {
  if (!Array.isArray(rows)) return { ok: false, error: 'Body must include sessions: []' };
  const out = [];
  const seen = new Set();
  function pickFirst(obj, keys) {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
    }
    return '';
  }
  function parseMs(v) {
    if (v == null || v === '') return NaN;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(String(v));
    return Number.isFinite(d) ? d : NaN;
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') continue;
    const emp_id = String(pickFirst(r, ['emp_id', 'employee_id', 'empId'])).trim();
    const abaya_id = String(
      pickFirst(r, ['abaya_id', 'item_id', 'itemId', 'abaya_code', 'abaya_barcode'])
    ).trim();
    const process = String(
      pickFirst(r, ['process', 'emp_process', 'work_type', 'station', 'role'])
    ).trim();
    let start = parseMs(pickFirst(r, ['start', 'started_at', 'start_at', 'start_iso']));
    const end = parseMs(pickFirst(r, ['end', 'ended_at', 'end_at', 'end_iso']));
    if (!Number.isFinite(start)) {
      const dur = Number(r.duration_sec);
      if (Number.isFinite(dur) && Number.isFinite(end) && dur >= 0) {
        start = end - Math.floor(dur * 1000);
      }
    }
    if (!emp_id || !abaya_id || !process || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const duration_sec = Number.isFinite(Number(r.duration_sec))
      ? Math.max(0, Math.floor(Number(r.duration_sec)))
      : Math.floor((end - start) / 1000);
    const key = [emp_id, abaya_id, process, start, end].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      emp_id: emp_id,
      abaya_id: abaya_id,
      process: process,
      start: start,
      end: end,
      duration_sec: duration_sec,
      hour: Number.isFinite(Number(r.hour)) ? Number(r.hour) : new Date(end).getHours(),
      invoice_count: r.invoice_count != null && r.invoice_count !== '' ? Number(r.invoice_count) : undefined,
      invoice_serial: r.invoice_serial != null && r.invoice_serial !== '' ? String(r.invoice_serial) : undefined,
      quantity: r.quantity != null && r.quantity !== '' ? Number(r.quantity) : undefined,
      checker_barcode: r.checker_barcode != null && r.checker_barcode !== '' ? String(r.checker_barcode) : undefined,
    });
  }
  if (!out.length) return { ok: false, error: 'No valid session rows found in imported JSON' };
  return { ok: true, rows: out };
}

module.exports = {
  buildFloorExportPayload,
  floorSessionsToCsv,
  normalizeImportedFloorSessions,
};
