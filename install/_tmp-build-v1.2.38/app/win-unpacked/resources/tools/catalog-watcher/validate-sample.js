'use strict';

/**
 * Validates docs/samples/items_export.xlsx using the same parser as the watcher (no upload).
 */
const path = require('path');
const { parseItemsXlsx } = require('./catalog-parse');

const sample = path.join(__dirname, '../../docs/samples/items_export.xlsx');
const fs = require('fs');

if (!fs.existsSync(sample)) {
  console.error('Missing sample file:', sample);
  console.error('Run: node tools/catalog-watcher/generate-sample-xlsx.js');
  process.exit(1);
}

try {
  const { abayas, sheetUsed } = parseItemsXlsx(sample);
  console.log('OK sheet=', sheetUsed, 'rows=', abayas.length);
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
