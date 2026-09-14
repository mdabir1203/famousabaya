// Robust smoke: ignore JS errors, just get the page state.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3111';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Dubai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[err] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  console.log('Navigating...');
  await page.goto(BASE_URL + '/dashboard.html', { waitUntil: 'load', timeout: 15000 }).catch((e) => console.log('nav err:', e.message));
  await page.waitForTimeout(4000);

  // Inspect via direct DOM access. If a previous JS error broke the
  // page, just look at the live DOM.
  const info = await page.evaluate(() => {
    const live = document.getElementById('live-sessions');
    return {
      hasLive: !!live,
      liveHtml: live ? live.innerHTML : null,
      liveFirstChars: live ? live.innerHTML.slice(0, 500) : null,
      hasState: typeof window.STATE !== 'undefined',
      activeCount: window.STATE && window.STATE.active ? Object.keys(window.STATE.active).length : -1,
    };
  });
  console.log('Has live-sessions:', info.hasLive);
  console.log('Has STATE.active:', info.activeCount);
  console.log('First 500 chars of live-sessions HTML:', info.liveFirstChars);

  await page.screenshot({ path: path.join(OUT, 'smoke.png'), fullPage: true });
  console.log('Errors:', errors.length);
  errors.forEach((e) => console.log('  ', e));

  await browser.close();
})();
