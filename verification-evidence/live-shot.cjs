// Capture without timeout — wait for page to settle naturally.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3111';
const DASHBOARD_URL = BASE_URL + '/dashboard.html';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Dubai' });
  const page = await ctx.newPage();

  console.log('Navigating...');
  await page.goto(DASHBOARD_URL, { waitUntil: 'commit', timeout: 8000 });
  await page.waitForTimeout(3000);

  console.log('Calling screenshot with no timeout...');
  const start = Date.now();
  const result = await page.screenshot({ path: path.join(OUT, 'live.png'), fullPage: true });
  console.log('Screenshot took', Date.now() - start, 'ms. Bytes:', result.length);
  await browser.close().catch(() => {});
  console.log('Done.');
})();
