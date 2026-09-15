const fs = require('fs');
const src = fs.readFileSync('cloudflare/src/ui/ceo-pages.js', 'utf8');
const lines = src.split('\n');
let odd = 0;
for (let i = 0; i < lines.length; i++) {
  let backtickCount = 0;
  for (const ch of lines[i]) if (ch === '`') backtickCount++;
  odd += backtickCount;
  if (backtickCount % 2 === 1) {
    console.log((i + 1) + ':' + backtickCount + ' odd: ' + lines[i].slice(0, 100));
  }
}
console.log('TOTAL backticks:', odd, 'parity:', odd % 2 === 0 ? 'EVEN' : 'ODD');
