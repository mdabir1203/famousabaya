// scripts/snapshot-live.cjs
// Snapshot the offline dashboard's #live-sessions panel into a PNG so we
// can see the timing cells (active-today + this-build) ticking.
// Reuses the Playwright install from verification-rigorous skill if present.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });

  console.log('loading http://127.0.0.1:3111/dashboard.html ...');
  await page.goto('http://127.0.0.1:3111/dashboard.html', { waitUntil: 'commit', timeout: 15000 });

  // Wait for the live panel to populate. #live-sessions contains rendered
  // rows from STATE.active. We wait until at least one row with data-tick
  // is present (the tickLiveSessions path renders these cells).
  await page.waitForSelector('#live-sessions [data-tick="active-today"]', { timeout: 15000 });

  // Pull the actual text of every live row so we can log what's on screen.
  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#live-sessions > div').forEach((row) => {
      const empId = row.getAttribute('data-emp-id') || '';
      const empName = (row.querySelector('div[style*="font-size:13px"]')?.textContent || '').trim();
      const sub = (row.querySelector('div[style*="font-size:11px"]')?.textContent || '').trim();
      const started = (row.querySelector('div[title][style*="font-size:15px"]')?.textContent || '').trim();
      const activeToday = (row.querySelector('[data-tick="active-today"]')?.textContent || '').trim();
      const build = (row.querySelector('[data-tick="build"]')?.textContent || '').trim();
      const buildCaption = (row.querySelector('[data-tick="build"] + div')?.textContent || '').trim();
      out.push({ empId, empName, sub, started, activeToday, build, buildCaption });
    });
    return out;
  });
  console.log('\nrendered live rows (' + rows.length + '):');
  for (const r of rows) {
    console.log('  ' + (r.empName || '?').padEnd(14) +
      ' started=' + (r.started || '?').padEnd(28) +
      ' activeToday=' + (r.activeToday || '?').padEnd(10) +
      ' thisBuild=' + (r.build || '?').padEnd(10) +
      ' sub=' + (r.sub || ''));
  }

  // Capture two frames, 1.5s apart, so the timing cell visibly advances.
  const out1 = 'verification-evidence/live-shot-t0.png';
  const out2 = 'verification-evidence/live-shot-t1.png';
  const el = await page.$('#live-sessions');
  if (!el) {
    console.log('#live-sessions not found');
    process.exit(1);
  }
  await el.screenshot({ path: out1 });
  await page.waitForTimeout(1500);
  await el.screenshot({ path: out2 });

  // Also capture a wider context shot of the full dashboard above-the-fold
  // (1280x1100) so the user sees how the live panel sits in the page.
  const out3 = 'verification-evidence/live-shot-page.png';
  await page.screenshot({ path: out3, clip: { x: 0, y: 0, width: 1280, height: 1100 } });

  await browser.close();
  console.log('\nwrote:');
  console.log('  ' + out1);
  console.log('  ' + out2);
  console.log('  ' + out3);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
