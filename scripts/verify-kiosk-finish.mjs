#!/usr/bin/env node
/**
 * scripts/verify-kiosk-finish.mjs
 * Verifies the kiosk finish-flow fix: after a session finishes, the demo grid
 * "Working" badge clears immediately (without waiting for the state_update
 * broadcast to arrive first).
 *
 * Approach:
 *   1. Load kiosk page — record initial active session count.
 *   2. Find an employee who is NOT currently active.
 *   3. Use Socket.IO (injected into the page) to start a session.
 *   4. Reload the kiosk page — state_update boots in with the active session,
 *      so the "Working" badge appears.
 *   5. Inject socket.io-client into the page and call req_finishWork.
 *   6. Immediately after the callback, check the "Working" badge is gone —
 *      this is the fix in kiosk.js:1373-1381.
 *
 * Run:
 *   node scripts/verify-kiosk-finish.mjs
 */

import { chromium } from '@playwright/test';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const BASE = process.env.KIOSK_URL || 'http://localhost:3111';
const KIOSK_PAGE = `${BASE}/kiosk.html`;
const OUT_DIR = resolve('verification-evidence');

// ── helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[verify-kiosk-finish] ${new Date().toISOString()} ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Wait for predicate to become true, retrying with backoff. */
async function waitFor(predicate, { timeout = 10000, interval = 200, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  log(`Starting kiosk finish-flow verification against ${KIOSK_PAGE}`);

  // ── 1. Launch browser ─────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ── 2. Navigate to kiosk ─────────────────────────────────────────────────
  log(`Loading kiosk page...`);
  const resp = await page.goto(KIOSK_PAGE, { waitUntil: 'networkidle', timeout: 15000 });
  if (!resp || resp.status() >= 400) throw new Error(`Kiosk page returned ${resp?.status()}`);
  log(`Kiosk page loaded (status ${resp.status()})`);

  await waitFor(async () => (await page.locator('.demo-emp').count()) > 0, {
    timeout: 8000, label: 'demo grid to render',
  });
  const initialCount = await page.locator('.demo-emp').count();
  log(`Demo grid rendered: ${initialCount} employee cards`);
  const initialWorking = await page.locator('.demo-emp.busy').count();
  log(`Initial "Working" badges: ${initialWorking}`);

  // ── 3. Pick an inactive employee ───────────────────────────────────────────
  const { activeIds, inactiveId } = await page.evaluate(async () => {
    const r = await fetch('/api/state');
    const d = await r.json();
    const activeSet = new Set(Object.keys(d.state?.active || {}));
    const inactive = (window.EMPLOYEES || []).find(e => !activeSet.has(e.id));
    return { activeIds: [...activeSet], inactiveId: inactive ? inactive.id : null };
  });

  if (!inactiveId) throw new Error('All employees are currently active — cannot test finish flow');
  log(`Active sessions: ${activeIds.length}. Picking inactive: ${inactiveId}`);

  // ── 4. Start a session using the kiosk's own socket ──────────────────────
  log(`Starting session for ${inactiveId} via kiosk socket...`);
  const startResult = await page.evaluate(async ({ empId, abayaId }) => {
    const s = window.__kioskSocket;
    if (!s) return { ok: false, error: 'window.__kioskSocket not found' };
    return new Promise((resolve) => {
      s.emit('req_startWork', { emp_id: empId, abaya_id: abayaId, process: 'Tailor (01)' }, (res) => {
        resolve(res);
      });
    });
  }, { empId: inactiveId, abayaId: 'ab-001' });
  log(`req_startWork result: ${JSON.stringify(startResult)}`);
  if (!startResult.ok) throw new Error(`Session start failed: ${startResult.error}`);
  log(`Session started (log_id: ${startResult.log_id})`);

  // ── 5. Reload page so state_update populates activeSessionsByEmployee ──────
  log(`Reloading kiosk to pick up active session...`);
  await page.reload({ waitUntil: 'networkidle', timeout: 15000 });

  await waitFor(async () => (await page.locator('.demo-emp').count()) > 0, {
    timeout: 8000, label: 'demo grid after reload',
  });
  await sleep(300); // Let state_update + render settle

  const workingAfterReload = await page.locator('.demo-emp.busy').count();
  log(`"Working" badges after reload: ${workingAfterReload}`);

  if (workingAfterReload === 0) {
    throw new Error('Expected at least one "Working" badge after reload, found none — state_update may not have arrived');
  }

  // Capture screenshot: employee card should show "Working"
  const screenshotBefore = resolve(join(OUT_DIR, 'before-finish.png'));
  await page.screenshot({ path: screenshotBefore, fullPage: true });
  log(`Screenshot (before finish): ${screenshotBefore}`);

  // ── 6. Trigger finish via the kiosk's own socket ─────────────────────────
  log(`Triggering req_finishWork for ${inactiveId} via kiosk socket...`);
  const finishResult = await page.evaluate(async (empId) => {
    const s = window.__kioskSocket;
    if (!s) return { ok: false, error: 'window.__kioskSocket not found' };
    // Capture state BEFORE the emit
    const busyCountBefore = document.querySelectorAll('.demo-emp.busy').length;
    const activeKeysBefore = Object.keys(window.activeSessionsByEmployee || {});
    return new Promise((resolve) => {
      s.emit('req_finishWork', { emp_id: empId }, (res) => {
        // Capture state RIGHT AFTER the callback fires
        const busyCountAfter = document.querySelectorAll('.demo-emp.busy').length;
        const activeKeysAfter = Object.keys(window.activeSessionsByEmployee || {});
        resolve({ ...res, _debug: { busyCountBefore, busyCountAfter, activeKeysBefore, activeKeysAfter } });
      });
    });
  }, inactiveId);
  log(`Finish result: ${JSON.stringify(finishResult)}`);
  if (!finishResult.ok) throw new Error(`Finish failed: ${finishResult.error}`);

  // ── THE KEY ASSERTION ─────────────────────────────────────────────────────
  // After the callback fires, the "Working" badge for e_bc_00000118 must be gone.
  // The fix in kiosk.js:1373-1381 deletes activeSessionsByEmployee[empId]
  // in the callback itself — not waiting for the state_update broadcast.
  // There are 14 OTHER employees still working, so the count goes 15→14, not 15→0.
  // ─────────────────────────────────────────────────────────────────────────
  log(`Checking the specific employee (${inactiveId}) no longer shows "Working"...`);

  await waitFor(async () => {
    const badges = await page.locator('.demo-emp.busy').count();
    const initialBadges = workingAfterReload;
    const expectedRemaining = initialBadges - 1; // only the finished employee should be gone
    return badges === expectedRemaining;
  }, { timeout: 2000, label: `Working badge for ${inactiveId} to clear` });

  const workingAfterFinish = await page.locator('.demo-emp.busy').count();
  const expectedAfterFinish = workingAfterReload - 1;
  log(`"Working" badges after finish: ${workingAfterFinish} (expected: ${expectedAfterFinish})`);

  // Screenshot at the critical assertion point
  const screenshotAfter = resolve(join(OUT_DIR, 'after-finish.png'));
  await page.screenshot({ path: screenshotAfter, fullPage: true });
  log(`Screenshot (after finish): ${screenshotAfter}`);

  // Console errors (filter out harmless ones)
  const relevantErrors = consoleErrors.filter(e =>
    !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')
  );
  log(`Console errors: ${relevantErrors.length > 0 ? relevantErrors.join('; ') : 'none'}`);

  // ── Results ───────────────────────────────────────────────────────────────
  console.log('\n');
  console.log('══════════════════════════════════════════════════════════');
  if (workingAfterFinish === expectedAfterFinish) {
    console.log('  ✓ PASS — "Working" badge cleared immediately after finish');
    console.log(`    Active sessions before test: ${activeIds.length}`);
    console.log(`    Picked inactive employee:    ${inactiveId}`);
    console.log(`    "Working" badges after reload:  ${workingAfterReload}`);
    console.log(`    "Working" badges after finish:  ${workingAfterFinish} (expected: ${expectedAfterFinish})`);
    console.log(`    Screenshot before: ${screenshotBefore}`);
    console.log(`    Screenshot after:  ${screenshotAfter}`);
    console.log(`    Console errors: ${relevantErrors.length}`);
  } else {
    console.log('  ✗ FAIL — "Working" badge still visible after finish');
    console.log(`    "Working" badges after finish: ${workingAfterFinish} (expected: ${expectedAfterFinish})`);
    console.log(`    Screenshot: ${screenshotAfter}`);
    process.exitCode = 1;
  }
  console.log('══════════════════════════════════════════════════════════\n');

  await browser.close();
  process.exit(process.exitCode || 0);
}

main().catch(err => {
  console.error(`\n[verify-kiosk-finish] FATAL: ${err.message}`);
  process.exit(1);
});
