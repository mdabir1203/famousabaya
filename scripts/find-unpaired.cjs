// Find unpaired backticks by tracking state
const fs = require('fs');
const src = fs.readFileSync('cloudflare/src/ui/ceo-pages.js', 'utf8');
// Strip strings and comments to find unpaired backticks in real code
let depth = 0;
let inSingle = false, inDouble = false, inTpl = false, inLineComment = false, inBlockComment = false;
let inRegex = false;
const chars = src.split('');
let lineNum = 1;
let inEsc = false;
for (let i = 0; i < chars.length; i++) {
  const c = chars[i];
  const n = chars[i + 1];
  if (c === '\n') lineNum++;
  if (inEsc) { inEsc = false; continue; }
  if (inLineComment) {
    if (c === '\n') inLineComment = false;
    continue;
  }
  if (inBlockComment) {
    if (c === '*' && n === '/') { inBlockComment = false; i++; }
    continue;
  }
  if (inSingle) {
    if (c === '\\') { inEsc = true; continue; }
    if (c === "'") inSingle = false;
    continue;
  }
  if (inDouble) {
    if (c === '\\') { inEsc = true; continue; }
    if (c === '"') inDouble = false;
    continue;
  }
  if (inTpl) {
    if (c === '\\') { inEsc = true; continue; }
    if (c === '`') {
      inTpl = false;
      console.log('Template CLOSED at line', lineNum);
    }
    continue;
  }
  if (c === '/' && n === '/') { inLineComment = true; i++; continue; }
  if (c === '/' && n === '*') { inBlockComment = true; i++; continue; }
  if (c === "'") { inSingle = true; continue; }
  if (c === '"') { inDouble = true; continue; }
  if (c === '`') {
    inTpl = true;
    console.log('Template OPENED at line', lineNum);
    continue;
  }
}
console.log('FINAL: inTpl=', inTpl, 'inSingle=', inSingle, 'inDouble=', inDouble, 'inBlockComment=', inBlockComment);
