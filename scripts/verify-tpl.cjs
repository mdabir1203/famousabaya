// Helper to verify ceo-pages.js template-literal pairing (kept as a
// one-time sanity check; safe to delete).
const fs = require('fs');
const src = fs.readFileSync('cloudflare/src/ui/ceo-pages.js', 'utf8');
let inSingle = false, inDouble = false, inTpl = false, inLineComment = false, inBlockComment = false;
let inEsc = false;
const chars = src.split('');
for (let i = 0; i < chars.length; i++) {
  const c = chars[i];
  const n = chars[i + 1];
  if (inEsc) { inEsc = false; continue; }
  if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
  if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i++; } continue; }
  if (inSingle) { if (c === '\\') { inEsc = true; continue; } if (c === "'") inSingle = false; continue; }
  if (inDouble) { if (c === '\\') { inEsc = true; continue; } if (c === '"') inDouble = false; continue; }
  if (inTpl) { if (c === '\\') { inEsc = true; continue; } if (c === '`') inTpl = false; continue; }
  if (c === '/' && n === '/') { inLineComment = true; i++; continue; }
  if (c === '/' && n === '*') { inBlockComment = true; i++; continue; }
  if (c === "'") { inSingle = true; continue; }
  if (c === '"') { inDouble = true; continue; }
  if (c === '`') { inTpl = true; continue; }
}
console.log('Final: inTpl=' + inTpl + ' inSingle=' + inSingle + ' inDouble=' + inDouble + ' inBlockComment=' + inBlockComment);
