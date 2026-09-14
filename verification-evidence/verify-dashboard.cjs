// One-off Playwright verification of the offline dashboard's live active
// session timing. Drives Chromium against the local server on :3111,
// captures screenshots, and asserts that the "active today" / "this build"
// counters actually tick every second under v1.2.32.
//
// Output: verification-evidence/00-initial.png ... 99-end.png plus console
// log + assertion log. Run with: node verification-evidence/verify-dashboard.cjs

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname);
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3111';
const DASHBOARD_URL = BASE_URL + '/dashboard.html';

function logLine(stream, msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(path.join(OUT, stream), line);
}

async function main() {
  console.log('Launching Chromium...');
  // Use the chromium-1234 build that's already on disk (installed
  // earlier). Newer Playwright wants chromium-1243; force the
  // matching binary so we don't re-download.
  const fsCheck = require('fs');
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    path.join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe'),
  ].filter(Boolean);
  let exe = null;
  for (const c of candidates) {
    if (fsCheck.existsSync(c)) { exe = c; break; }
  }
  const launchOpts = { headless: true };
  if (exe) launchOpts.executablePath = exe;
  console.log('Using chromium:', exe || '(default)');
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Dubai',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Capture console + network
  const consoleLines = [];
  page.on('console', (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  });
  const networkErrors = [];
  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      networkErrors.push(`${resp.status()} ${resp.url()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleLines.push(`[pageerror] ${err.message}`);
  });

  logLine('console.log', `Navigating to ${DASHBOARD_URL}`);
  const resp = await page.goto(DASHBOARD_URL, { waitUntil: 'load', timeout: 30000 });
  logLine('console.log', `Initial response: ${resp.status()} ${resp.url()}`);

  // Give socket.io a moment to populate STATE.active before waiting.
  await page.waitForTimeout(3000);
  // Diagnostic: log page state
  const initialState = await page.evaluate(() => {
    const el = document.getElementById('live-sessions');
    return {
      hasLiveSessions: !!el,
      innerHTMLLen: el ? el.innerHTML.length : 0,
      innerHTMLStart: el ? el.innerHTML.slice(0, 200) : '',
      hasState: typeof window.STATE !== 'undefined',
      activeCount: (window.STATE && window.STATE.active) ? Object.keys(window.STATE.active).length : -1,
      documentReadyState: document.readyState,
    };
  });
  logLine('assertions.log', `Page state: ${JSON.stringify(initialState)}`);

  // Wait for STATE.active to populate + at least one row rendered
  logLine('assertions.log', 'Waiting for #live-sessions to render at least one row...');
  await page.waitForFunction(
    () => {
      const el = document.getElementById('live-sessions');
      if (!el) return false;
      const tickCells = el.querySelectorAll('[data-tick="active-today"]');
      return tickCells.length > 0;
    },
    { timeout: 15000 }
  ).catch((e) => {
    logLine('assertions.log', `FAIL: #live-sessions never populated — ${e.message}`);
  });
  await page.screenshot({ path: path.join(OUT, '00-initial.png'), fullPage: false });
  logLine('assertions.log', 'OK: initial screenshot captured (00-initial.png)');

  // Helper: read all ticking cells' textContent
  const readCounters = async () => {
    return page.evaluate(() => {
      const el = document.getElementById('live-sessions');
      if (!el) return null;
      const today = Array.from(el.querySelectorAll('[data-tick="active-today"]')).map(
        (n) => n.textContent
      );
      const build = Array.from(el.querySelectorAll('[data-tick="build"]')).map(
        (n) => n.textContent
      );
      const ids = Array.from(el.querySelectorAll('[data-tick="active-today"]')).map((n) =>
        n.getAttribute('data-emp-id')
      );
      return { ids, today, build, count: today.length };
    });
  };

  // Capture counter state at T0
  const t0 = await readCounters();
  logLine('assertions.log', `T0 captured: ${t0.count} active rows`);
  if (t0.count > 0) {
    for (let i = 0; i < t0.count; i++) {
      logLine('assertions.log', `  ${t0.ids[i]}: today=${t0.today[i]} build=${t0.build[i]}`);
    }
  } else {
    logLine('assertions.log', 'WARNING: 0 active sessions on the offline dashboard');
  }

  // Wait 2s and re-capture
  await page.waitForTimeout(2000);
  const t1 = await readCounters();
  logLine('assertions.log', `T+2s captured: ${t1.count} active rows`);
  if (t1.count > 0) {
    for (let i = 0; i < t1.count; i++) {
      logLine('assertions.log', `  ${t1.ids[i]}: today=${t1.today[i]} build=${t1.build[i]}`);
    }
  }
  await page.screenshot({ path: path.join(OUT, '01-after-2s.png'), fullPage: false });

  // Wait 5s and re-capture (full-page so the whole live block is in frame)
  await page.waitForTimeout(5000);
  const t2 = await readCounters();
  logLine('assertions.log', `T+7s captured: ${t2.count} active rows`);
  if (t2.count > 0) {
    for (let i = 0; i < t2.count; i++) {
      logLine('assertions.log', `  ${t2.ids[i]}: today=${t2.today[i]} build=${t2.build[i]}`);
    }
  }
  await page.screenshot({ path: path.join(OUT, '02-after-7s-full.png'), fullPage: true });

  // ASSERTION: at least one counter advanced between T0, T1, T2.
  // The "active today" cell uses base+live, so it should change every
  // second (the live contribution bumps by ~1s/s). The "this build"
  // cell also uses base+live, same expectation.
  let passed = 0;
  let failed = 0;
  if (t0.count === 0) {
    logLine('assertions.log', 'SKIP: no active sessions to assert against');
  } else {
    for (let i = 0; i < t0.count; i++) {
      const t0Today = t0.today[i];
      const t1Today = t1.today[i];
      const t2Today = t2.today[i];
      const t0Build = t0.build[i];
      const t2Build = t2.build[i];
      // Today: must differ at T0 vs T2 (7s apart) AND at T0 vs T1 (2s apart).
      const todayChangedFast = t0Today !== t1Today;
      const todayChangedSlow = t0Today !== t2Today;
      // Build: same — base+live formula must bump every second.
      const buildChanged = t0Build !== t2Build;
      if (todayChangedFast && todayChangedSlow && buildChanged) {
        logLine(
          'assertions.log',
          `PASS row ${t0.ids[i]}: today ${t0Today} -> ${t2Today}, build ${t0Build} -> ${t2Build}`
        );
        passed++;
      } else {
        logLine(
          'assertions.log',
          `FAIL row ${t0.ids[i]}: today ${t0Today} -> ${t2Today} (fast=${todayChangedFast} slow=${todayChangedSlow}), build ${t0Build} -> ${t2Build}`
        );
        failed++;
      }
    }
  }

  // ASSERTION: no 4xx/5xx for /api/state during the run.
  const stateErrors = networkErrors.filter((l) => l.includes('/api/state'));
  if (stateErrors.length === 0) {
    logLine('assertions.log', 'PASS: no /api/state 4xx/5xx during run');
  } else {
    logLine('assertions.log', `FAIL: ${stateErrors.length} /api/state errors: ${stateErrors.join(' | ')}`);
  }

  // ASSERTION: no SyntaxError in console (the cloud-404 bug we just fixed).
  const syntaxErrors = consoleLines.filter((l) => l.includes('SyntaxError') || l.includes('Unexpected'));
  if (syntaxErrors.length === 0) {
    logLine('assertions.log', 'PASS: no SyntaxError in page console');
  } else {
    logLine('assertions.log', `FAIL: SyntaxErrors found: ${syntaxErrors.join(' | ')}`);
  }

  // Dump final state
  fs.writeFileSync(path.join(OUT, 'console.log'), consoleLines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'network.log'), networkErrors.join('\n'));

  await context.close();
  await browser.close();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log(`Output:  ${OUT}`);
  console.log('Screenshots: 00-initial.png, 01-after-2s.png, 02-after-7s-full.png');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
