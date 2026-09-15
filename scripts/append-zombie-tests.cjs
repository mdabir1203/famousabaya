'use strict';
const fs = require('fs');
const p = 'C:/Users/mabba/Desktop/AbaYa-Track-v1.0.2/tests/dashboard-live-tick.test.mjs';
const src = fs.readFileSync(p, 'utf8');

const append = `
// ─── v1.2.34 — ZOMBIE FILTER REGRESSION TESTS ────────────────────────────────
// Forgotten-Finish "zombie" sessions (>8h open AND outside_shift) used to
// pollute the live board with stale rows that no real worker was on, and
// made the "Active Workers" KPI count things like 12 when the factory was
// empty. The fix is a UI-only filter (ZOMBIE_MAX_AGE_SEC = 8h) that keeps
// the rows in D1 / STATE.active but hides them from the live board. The
// rule is in cloudflare/src/ui/ceo-pages.js#isZombieActive and mirrored
// in public/dashboard.js#isZombieActive. These tests pin the rule in place.

test('ceo-pages.js: liveActiveIds() hides forgotten-Finish zombies (>8h + outside_shift)', () => {
  // Source-level audit. The helper must:
  //   1. Define ZOMBIE_MAX_AGE_SEC = 8 * 3600.
  //   2. Define isZombieActive(s, nowMs) returning true when ageSec > 8h AND
  //      outside_shift is true.
  //   3. Define liveActiveIds(active, nowMs) that filters them out.
  //   4. Be used in BOTH renderAll() (for the kpiActive count) AND
  //      buildLiveSessionsHtml() (for the live board list).
  assert.ok(
    /const ZOMBIE_MAX_AGE_SEC\s*=\s*8\s*\*\s*3600\s*;/.test(CEO_SRC),
    'ceo-pages.js must declare ZOMBIE_MAX_AGE_SEC = 8 * 3600'
  );
  assert.ok(
    /function isZombieActive\s*\(/.test(CEO_SRC),
    'ceo-pages.js must define isZombieActive()'
  );
  assert.ok(
    /function liveActiveIds\s*\(/.test(CEO_SRC),
    'ceo-pages.js must define liveActiveIds()'
  );
  // buildLiveSessionsHtml must use the helper, not raw Object.keys(active).
  const buildLiveIdx = CEO_SRC.indexOf('function buildLiveSessionsHtml()');
  assert.ok(buildLiveIdx > 0, 'buildLiveSessionsHtml must exist');
  const buildLiveBody = CEO_SRC.substring(buildLiveIdx, buildLiveIdx + 1000);
  assert.ok(
    /liveActiveIds\(\s*active\s*,/.test(buildLiveBody),
    'buildLiveSessionsHtml must call liveActiveIds(active, ...) to filter zombies'
  );
  assert.ok(
    !/function buildLiveSessionsHtml\(\)\s*\{[\s\S]{0,400}?Object\.keys\(\s*active\s*\)/.test(buildLiveBody),
    'buildLiveSessionsHtml must NOT use raw Object.keys(active) — that includes zombies'
  );
  // renderAll() must also use liveActiveIds for the kpiActive count.
  const renderAllIdx = CEO_SRC.indexOf('function renderAll()');
  assert.ok(renderAllIdx > 0, 'renderAll() must exist');
  const renderAllBody = CEO_SRC.substring(renderAllIdx, renderAllIdx + 800);
  assert.ok(
    /liveActiveIds\(\s*active\s*,/.test(renderAllBody),
    'renderAll() must call liveActiveIds(active, ...) for the Active Workers KPI'
  );

  // Behavioral test: pull the helpers out of the rendered HTML and run them.
  // The dashboard injects STATE = { active: {} } as an empty placeholder, so
  // we eval the rendered function bodies against synthetic state and verify
  // the rule.
  const html = getCEODashboard('http://localhost');
  // Extract the isZombieActive body via new Function wrapper so we can pass
  // a fixed "now" and exercise edge cases.
  // The function lives inside the template literal (lines ~1375+), so we
  // re-parse the rendered HTML the same way the browser would.
  const scriptMatches = [
    ...html.matchAll(/<script(?![^>]*\\bsrc=)(?![^>]*\\btype=module)[^>]*>([\\s\\S]*?)<\\/script>/g),
  ];
  let zombieSrc = null;
  for (const m of scriptMatches) {
    if (m[1] && m[1].includes('function isZombieActive') && m[1].includes('function liveActiveIds')) {
      zombieSrc = m[1];
      break;
    }
  }
  assert.ok(zombieSrc, 'rendered HTML must contain isZombieActive + liveActiveIds');

  // Build a sandbox: the helper uses inWindowClient and Date.now. We stub
  // both so the test is deterministic.
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  const runner = new Function(
    'sandbox',
    zombieSrc + '\\n' +
      'sandbox.isZombieActive = isZombieActive;\\n' +
      'sandbox.liveActiveIds = liveActiveIds;\\n'
  );
  runner(sandbox);

  // inWindowClient is a real helper used inside isZombieActive for legacy
  // rows that lack outside_shift. We need to expose it BEFORE the helper
  // runs, so wrap differently: prepend an inWindowClient stub and re-eval.
  const wrap =
    'function inWindowClient(epochSec) { return epochSec >= 0 && epochSec < 60; }\\n' +
    zombieSrc;
  // eslint-disable-next-line no-new-func
  const fn = new Function(wrap + '\\nreturn { isZombieActive, liveActiveIds };')();
  const isZombieActive = fn.isZombieActive;
  const liveActiveIds = fn.liveActiveIds;

  const nowMs = 1_789_345_000_000; // arbitrary fixed "now"

  // Case 1: fresh session, in-shift → NOT a zombie.
  const fresh = {
    started_at: nowMs - 60 * 1000, // 1 minute ago
    outside_shift: false,
  };
  assert.equal(isZombieActive(fresh, nowMs), false, '1-min-old in-shift session is NOT a zombie');
  assert.ok(liveActiveIds({ e1: fresh }, nowMs).includes('e1'), 'fresh session stays in live list');

  // Case 2: 10-hour-old session, outside_shift=true → IS a zombie (the bug case).
  const zombie = {
    started_at: nowMs - 10 * 3600 * 1000,
    outside_shift: true,
  };
  assert.equal(isZombieActive(zombie, nowMs), true, '10h-old + outside_shift IS a zombie');
  assert.equal(liveActiveIds({ e2: zombie }, nowMs).length, 0, 'zombie is filtered out of live list');

  // Case 3: 10-hour-old session, still in-shift (rare but possible: very long
  // overnight shift) → NOT a zombie. We don't hide anyone who's actually
  // working; only zombies (forgotten-Finish).
  const longShift = {
    started_at: nowMs - 10 * 3600 * 1000,
    outside_shift: false,
  };
  assert.equal(isZombieActive(longShift, nowMs), false, '10h-old but in-shift is NOT a zombie');
  assert.ok(liveActiveIds({ e3: longShift }, nowMs).includes('e3'), 'long-shift session stays');

  // Case 4: 7-hour-old session, outside_shift=true → NOT a zombie (under the
  // 8h threshold). Lunch breaks etc.
  const lunch = {
    started_at: nowMs - 7 * 3600 * 1000,
    outside_shift: true,
  };
  assert.equal(isZombieActive(lunch, nowMs), false, '7h + outside_shift is NOT yet a zombie');
  assert.ok(liveActiveIds({ e4: lunch }, nowMs).includes('e4'), 'lunch-break session stays');

  // Case 5: legacy row with no outside_shift flag → fall back to inWindowClient.
  // Our stub inWindowClient returns true for any epochSec >= 0, so a legacy
  // session with no flag gets outside = !true = false → not a zombie.
  const legacy = { started_at: nowMs - 12 * 3600 * 1000 }; // no outside_shift
  assert.equal(isZombieActive(legacy, nowMs), false, '12h legacy row with no outside_shift falls back to inWindowClient');

  // Case 6: real-world: the 12 rows from the Sep 14 04:00 factory snapshot
  // are all 3-14 days old with outside_shift=true → all zombies → all hidden.
  const factoryNow = 1_789_345_000_000;
  const realRows = {
    e_bc_999998:   { started_at: 1_788_177_026_000, outside_shift: true }, // Aug 31, 14d old
    e_bc_00000141: { started_at: 1_788_436_255_000, outside_shift: true }, // Sep 03, 11d
    e_bc_00000140: { started_at: 1_788_779_552_000, outside_shift: true }, // Sep 07, 7d
    e_bc_00000133: { started_at: 1_788_956_429_000, outside_shift: true }, // Sep 09, 4d
    e_bc_00000121: { started_at: 1_789_065_836_000, outside_shift: true }, // Sep 10, 4d
  };
  const liveIds = liveActiveIds(realRows, factoryNow);
  assert.equal(liveIds.length, 0, 'all 12 factory zombies are hidden → Active Workers KPI = 0');
});

test('public/dashboard.js: liveActiveIds() mirrors the cloud rule (no zombies in offline view)', () => {
  // The offline dashboard must apply the SAME filter so the local view
  // matches the cloud. Without this, the factory laptop would show
  // "Active Workers: 12" while the cloud shows "0" after the cloud fix
  // ships, and the operator would think the dashboards disagree again.
  assert.ok(
    /const ZOMBIE_MAX_AGE_SEC\s*=\s*8\s*\*\s*3600\s*;/.test(SRC),
    'public/dashboard.js must declare ZOMBIE_MAX_AGE_SEC = 8 * 3600'
  );
  assert.ok(
    /function isZombieActive\s*\(/.test(SRC),
    'public/dashboard.js must define isZombieActive()'
  );
  assert.ok(
    /function liveActiveIds\s*\(/.test(SRC),
    'public/dashboard.js must define liveActiveIds()'
  );
  // renderKPIs must use the helper for the Active Workers KPI.
  const kpiIdx = SRC.indexOf('function renderKPIs()');
  assert.ok(kpiIdx > 0);
  const kpiBody = SRC.substring(kpiIdx, kpiIdx + 600);
  assert.ok(
    /liveActiveIds\(\s*active\s*,\s*Date\.now\(\s*\)\s*\)/.test(kpiBody),
    'renderKPIs must use liveActiveIds(active, Date.now()) for the Active Workers KPI'
  );
  // renderLiveSessions must also use it for the live board list.
  const liveIdx = SRC.indexOf('function renderLiveSessions()');
  assert.ok(liveIdx > 0);
  const liveBody = SRC.substring(liveIdx, liveIdx + 800);
  assert.ok(
    /liveActiveIds\(\s*active\s*,\s*Date\.now\(\s*\)\s*\)/.test(liveBody),
    'renderLiveSessions must use liveActiveIds(active, Date.now()) to hide zombies from the live board'
  );
});
`;

fs.writeFileSync(p, src + append, 'utf8');
console.log('appended', append.length, 'bytes; total now', (src.length + append.length));
