// diagnostic helper — finds the failing script tag in the rendered ceo-pages output.
import { getCEODashboard } from '../../cloudflare/src/ui/ceo-pages.js';

const html = getCEODashboard('http://localhost');
const re = /<script(?![^>]*\bsrc=)(?![^>]*\btype=module)[^>]*>([\s\S]*?)<\/script>/g;
let m2;
let i = 0, fails = 0;
while ((m2 = re.exec(html)) !== null) {
  i++;
  const src = m2[1];
  try {
    new Function(src);
    console.log('script #' + i + ' OK (' + src.length + ' bytes)');
  } catch (e) {
    fails++;
    console.log('script #' + i + ' FAIL: ' + e.message);
    // Binary search for the bad token
    try {
      let lo = 0, hi = src.length;
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        try { new Function(src.substring(0, mid)); lo = mid; } catch (_) { hi = mid; }
      }
      const badStart = lo;
      const ctx = src.substring(Math.max(0, badStart - 80), Math.min(src.length, badStart + 120));
      console.log('--- context around parse failure (offset ' + badStart + ') ---');
      console.log(ctx);
      console.log('---');
    } catch (_) {}
  }
}
process.exit(fails ? 1 : 0);
