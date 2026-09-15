'use strict';

/**
 * One-off: writes docs/samples/items_export.xlsx matching CATALOG_EXCEL_SPEC.md
 * Run from repo: node tools/catalog-watcher/generate-sample-xlsx.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const outDir = path.join(__dirname, '../../docs/samples');
const outfile = path.join(outDir, 'items_export.xlsx');

const aoa = [
  ['Abaya ID', 'Item Code', 'Barcode', 'Design', 'Process', 'Icon'],
  ['a1', 'AB-0041', 'AB00000041', 'Classic Black Bisht', 'Tailor (01)', '&#129509;'],
  ['a2', 'AB-0042', 'AB00000042', 'Embroidered Ceremonial', 'Tailor (02)', '&#10024;'],
  ['a3', 'AB-0043', 'AB00000043', 'Casual Linen Blend', 'Hand Work', '&#129525;'],
];

fs.mkdirSync(outDir, { recursive: true });
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Items');
XLSX.writeFile(wb, outfile);
console.log('Wrote', outfile);
