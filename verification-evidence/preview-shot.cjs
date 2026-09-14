// Take three screenshots of the preview.html to show the counter ticking.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const PREVIEW = 'file://' + path.join(OUT, 'preview.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
    timeout: 5000,
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: 'Asia/Dubai' });
  const page = await ctx.newPage();

  console.log('Opening preview...');
  // Use 'commit' to avoid blocking on any external resources.
  await page.goto(PREVIEW, { waitUntil: 'commit', timeout: 5000 });
  await page.waitForTimeout(500);

  for (let i = 0; i < 3; i++) {
    await page.screenshot({ path: path.join(OUT, 'preview-' + i + '.png'), fullPage: true, timeout: 5000 }).catch((e) => console.log('ss err:', e.message));
    console.log('Captured preview-' + i + '.png at T+' + (i * 1500) + 'ms');
    await page.waitForTimeout(1500);
  }

  await browser.close().catch(() => {});
  console.log('Done.');
})();
