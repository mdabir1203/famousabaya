// Open dashboard, kill the busy render loop (remove state_update handler
// + clear intervals), then screenshot.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright', 'chromium_headless_shell-1234', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Dubai' });

  // Block external (non-localhost) requests so fonts don't slow us down
  await ctx.route('**/*', (route, request) => {
    const url = request.url();
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return route.continue();
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[err]', m.text().slice(0, 120));
  });

  await page.goto('http://localhost:3111/dashboard.html', { waitUntil: 'commit', timeout: 8000 });
  console.log('Committed. Waiting 5s.');
  await page.waitForTimeout(5000);

  // Stop all intervals to break any busy loop
  await page.evaluate(() => {
    // Highest interval id we can reach
    let cleared = 0;
    for (let i = 1; i < 100000; i++) {
      try { window.clearInterval(i); cleared++; } catch (_) {}
    }
    console.log('[eval] Cleared ' + cleared + ' interval ids');
    // Also nuke the socket if any
    try { if (window.socket && window.socket.disconnect) window.socket.disconnect(); } catch (_) {}
  });

  console.log('Wait 2s after killing intervals...');
  await page.waitForTimeout(2000);

  console.log('Screenshot...');
  const start = Date.now();
  try {
    await page.screenshot({ path: path.join(__dirname, 'dashboard.png'), fullPage: true, timeout: 30000 });
    console.log('OK', Date.now() - start, 'ms');
  } catch (e) {
    console.log('FAIL', Date.now() - start, 'ms:', e.message);
  }
  await browser.close().catch(() => {});
})();
