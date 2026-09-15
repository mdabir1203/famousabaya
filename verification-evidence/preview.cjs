// Quick preview: take a screenshot ASAP after the page loads. No
// state inspection. The page may have JS errors but we just want
// the rendered DOM for the user to see.
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

  console.log('Navigating...');
  // Use 'commit' waitUntil so we get the page as fast as possible
  // without waiting for full load (which might block on socket).
  await page.goto(BASE_URL + '/dashboard.html', { waitUntil: 'commit', timeout: 8000 }).catch((e) => console.log('nav:', e.message));
  console.log('Committed. Waiting 4s for socket.io to populate STATE.');
  await new Promise((r) => setTimeout(r, 4000));
  console.log('Taking screenshot...');
  await page.screenshot({ path: path.join(OUT, 'preview.png'), fullPage: true }).catch((e) => console.log('ss err:', e.message));
  console.log('Done. Closing browser.');
  await browser.close().catch(() => {});
})();
