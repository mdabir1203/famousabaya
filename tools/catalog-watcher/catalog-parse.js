'use strict';

/**
 * Keep in sync with WORK_TYPES in public/data.js (kiosk role / process names).
 */
const PROCESS_WHITELIST = new Set([
  'Tailor (01)',
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
]);

/** Normalized header (lowercase, underscores) -> canonical field */
const HEADER_ALIASES = {
  // ── id ───────────────────────────────────────────────────────────────────────
  // Optional: auto-derived from barcode when absent.
  id: 'id',
  abaya_id: 'id',
  item_id: 'id',

  // ── code ─────────────────────────────────────────────────────────────────────
  // Optional: auto-derived from barcode when absent.
  code: 'code',
  item_code: 'code',
  sku: 'code',
  abaya_code: 'code',
  product_code: 'code',

  // ── barcode ───────────────────────────────────────────────────────────────────
  // "Barcode Display Name" is the exact column name in the factory Excel export.
  barcode: 'barcode',
  bar_code: 'barcode',
  bc: 'barcode',
  barcode_display_name: 'barcode',
  display_name: 'barcode',
  barcode_name: 'barcode',

  // ── design (description shown on kiosk card) ──────────────────────────────────
  // "Item Name" is the exact column name in the factory Excel export.
  // If both "Item Name" and "Description" exist the first non-empty value is used
  // (no hard error for optional fields).
  design: 'design',
  description: 'design',
  item_name: 'design',
  name: 'design',
  title: 'design',

  // ── process ───────────────────────────────────────────────────────────────────
  // "Item Category" is the exact column name in the factory Excel export.
  process: 'process',
  work_type: 'process',
  department: 'process',
  role: 'process',
  item_category: 'process',
  category: 'process',

  // ── tier (quality grade: Standard, Premium, Luxury, Plain Abaya) ─────────────
  tier: 'tier',
  grade: 'tier',
  abaya_tier: 'tier',
  abaya_grade: 'tier',
  item_grade: 'tier',
  abaya_category: 'tier',

  // ── icon ──────────────────────────────────────────────────────────────────────
  icon: 'icon',
  emoji: 'icon',
};

// id and code are auto-derived from barcode when absent — only barcode + process
// must be supplied as explicit columns.
const REQUIRED_CANONICAL = ['barcode', 'process'];
// Optional canonical fields that may be absent or have duplicate source columns
// without causing a hard error.
const OPTIONAL_CANONICAL = new Set(['id', 'code', 'design', 'icon', 'tier']);

function normHeaderKey(k) {
  return String(k != null ? k : '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[\s\u00a0]+/g, '_');
}

function mapNormalizedHeaderToCanonical(normKey) {
  if (!normKey) return null;
  if (HEADER_ALIASES[normKey]) return HEADER_ALIASES[normKey];
  if (['id', 'code', 'barcode', 'design', 'process', 'icon'].includes(normKey)) return normKey;
  return null;
}

function cellToString(val) {
  if (val == null) return '';
  if (typeof val === 'number' && Number.isFinite(val)) {
    return String(val);
  }
  return String(val).trim();
}

/**
 * From header row keys (Excel column titles), ensure required canonical fields are covered.
 */
function validateHeadersPresent(columnKeys) {
  const mapped = new Map();
  for (const k of columnKeys) {
    const nk = normHeaderKey(k);
    const canon = mapNormalizedHeaderToCanonical(nk);
    if (!canon) continue;
    if (!mapped.has(canon)) mapped.set(canon, []);
    mapped.get(canon).push(k);
  }

  const requiredAmbiguous = [];
  for (const [canon, originals] of mapped) {
    if (originals.length > 1 && !OPTIONAL_CANONICAL.has(canon)) {
      requiredAmbiguous.push(`${canon} (columns: ${originals.map((x) => JSON.stringify(x)).join(', ')})`);
    } else if (originals.length > 1) {
      // Optional field with multiple matching columns — use first non-empty value per row.
      console.warn(
        '[catalog-parse] Multiple columns map to optional field "' + canon + '": ' +
          originals.map((x) => JSON.stringify(x)).join(', ') +
          ' — first non-empty value per row will be used.'
      );
    }
  }
  if (requiredAmbiguous.length) {
    throw new Error(
      'Each logical field must map from at most one column. Fix: ' + requiredAmbiguous.join('; ')
    );
  }

  const missing = REQUIRED_CANONICAL.filter((c) => !mapped.has(c));
  if (missing.length) {
    throw new Error(
      'Missing required column(s) for: ' +
        missing.join(', ') +
        '. Required headers: "Barcode Display Name" (or barcode/bc) and "Item Category" (or process/category). ' +
        'Optional: Item Name / design, id, code / Item Code. See docs/CATALOG_EXCEL_SPEC.md'
    );
  }
  return mapped;
}

function rowToCanonical(rowObj, excelRowNumber, headerToCanonical) {
  const sources = {
    id: [],
    code: [],
    barcode: [],
    design: [],
    process: [],
    tier: [],
    icon: [],
  };

  for (const [header, val] of Object.entries(rowObj)) {
    const nk = normHeaderKey(header);
    const canon = mapNormalizedHeaderToCanonical(nk);
    if (!canon) continue;
    const s = cellToString(val);
    sources[canon].push({ header, value: s });
  }

  const out = { id: '', code: '', barcode: '', design: '', process: '', tier: '', icon: '' };
  for (const c of ['id', 'code', 'barcode', 'design', 'process', 'tier', 'icon']) {
    const arr = sources[c];
    const nonEmpty = arr.filter((x) => x.value !== '');
    if (nonEmpty.length > 1 && !OPTIONAL_CANONICAL.has(c)) {
      throw new Error(
        `Row ${excelRowNumber}: multiple columns map to "${c}": ${nonEmpty.map((x) => x.header).join(', ')}`
      );
    }
    // For optional fields with multiple sources, use the first non-empty value.
    out[c] = nonEmpty.length ? nonEmpty[0].value : '';
  }

  return out;
}

function validateProcessValue(process, excelRowNumber) {
  if (!process) return;
  if (!PROCESS_WHITELIST.has(process)) {
    const allowed = [...PROCESS_WHITELIST].sort().join(', ');
    throw new Error(
      `Row ${excelRowNumber}: unknown Process ${JSON.stringify(process)}. Must be exactly one of: ${allowed}`
    );
  }
}

/**
 * Parse items_export-style xlsx to abaya rows for PUT /api/catalog/abayas.
 * @param {string} filePath
 * @param {{ preferredSheetName?: string }} [opts]
 * @returns {{ abayas: Array<{id:string,code:string,barcode:string,design:string,process:string,icon:string}>, sheetUsed: string }}
 */
function parseItemsXlsx(filePath, opts) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: false, cellNF: false, cellText: false });
  const preferred = (opts && opts.preferredSheetName) || 'Items';
  let sheetName = wb.SheetNames.includes(preferred) ? preferred : wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');
  const sheet = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rows.length) throw new Error(`Sheet "${sheetName}" has no data rows`);

  const columnKeys = Object.keys(rows[0]);
  validateHeadersPresent(columnKeys);

  const seenId = new Set();
  const seenCode = new Set();
  const seenBc = new Set();
  const abayas = [];

  for (let i = 0; i < rows.length; i++) {
    const excelRow = i + 2;
    const a = rowToCanonical(rows[i], excelRow);

    if (!a.id && !a.code && !a.barcode) continue;

    // Auto-derive code from barcode when no explicit code column.
    if (!a.code && a.barcode) a.code = a.barcode;
    // Auto-derive id from code (slug) when no explicit id column.
    if (!a.id && a.code) {
      a.id = a.code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    if (!a.barcode || !a.process) {
      throw new Error(
        `Row ${excelRow}: "Barcode Display Name" (barcode) and "Item Category" (process) are required. Got: ${JSON.stringify(a)}`
      );
    }

    validateProcessValue(a.process, excelRow);

    if (seenId.has(a.id)) throw new Error(`Row ${excelRow}: duplicate id ${JSON.stringify(a.id)}`);
    if (seenCode.has(a.code)) throw new Error(`Row ${excelRow}: duplicate code ${JSON.stringify(a.code)}`);
    if (seenBc.has(a.barcode)) {
      throw new Error(`Row ${excelRow}: duplicate barcode ${JSON.stringify(a.barcode)}`);
    }
    seenId.add(a.id);
    seenCode.add(a.code);
    seenBc.add(a.barcode);
    abayas.push({
      id: a.id,
      code: a.code,
      barcode: a.barcode,
      design: a.design,
      process: a.process,
      tier: a.tier,
      icon: a.icon,
    });
  }

  if (!abayas.length) throw new Error('No valid data rows after skipping empty lines');

  return { abayas, sheetUsed: sheetName };
}

/**
 * When a workbook lives in an employee-named subfolder, validate or force Process per row.
 * @param {Array<{id:string,code:string,barcode:string,design:string,process:string,icon:string}>} abayas
 * @param {{ name: string, process: string } | null} employee
 * @param {'off'|'strict'|'folder'} mode off=no check; strict=each row.process must match employee.process; folder=set process from employee
 */
function alignAbayasToEmployeeProcess(abayas, employee, mode) {
  if (!employee || mode === 'off' || !mode) return abayas;
  if (mode === 'folder') {
    return abayas.map((a) => ({ ...a, process: employee.process }));
  }
  if (mode === 'strict') {
    for (let i = 0; i < abayas.length; i++) {
      const a = abayas[i];
      if (a.process !== employee.process) {
        throw new Error(
          `Item ${JSON.stringify(a.id)}: Process ${JSON.stringify(a.process)} does not match employee folder "${employee.name}" (expected ${JSON.stringify(employee.process)}). Fix the Excel Process column or use alignProcess "folder" in config.`
        );
      }
    }
  }
  return abayas;
}

module.exports = {
  PROCESS_WHITELIST,
  HEADER_ALIASES,
  REQUIRED_CANONICAL,
  normHeaderKey,
  mapNormalizedHeaderToCanonical,
  parseItemsXlsx,
  alignAbayasToEmployeeProcess,
};
