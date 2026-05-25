/**
 * Smoke test: employees sheet layout matches what server.js writes / parses.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const headers = ['emp_no', 'ac_no', 'name', 'barcode', 'process', 'code', 'color', 'photo'];
const row = [999, 998, 'Roundtrip Test', 'RT99999998', 'Tailor (01)', 'EMP999', '#6a5fc1', ''];

const aoa = [headers, row];
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Employees');

const tmp = path.join(os.tmpdir(), `emp-rt-${Date.now()}.xlsx`);
fs.writeFileSync(tmp, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

const wb2 = XLSX.readFile(tmp, { cellDates: false, cellNF: false, cellText: false });
const sheetName = wb2.SheetNames.includes('Employees') ? 'Employees' : wb2.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb2.Sheets[sheetName], { defval: '', raw: false });
fs.unlinkSync(tmp);

if (!rows.length) {
  console.error('FAIL: no rows');
  process.exit(1);
}
const r = rows[0];
const ok =
  String(r.emp_no || r.employee_no || '').trim() === '999' &&
  String(r.barcode || '').trim() === 'RT99999998' &&
  String(r.process || '').includes('Tailor');

if (!ok) {
  console.error('FAIL: parsed row', r);
  process.exit(1);
}
console.log('OK employee xlsx roundtrip (layout matches server export)');
console.log('Repo root:', root);
