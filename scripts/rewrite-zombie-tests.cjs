'use strict';
const fs = require('fs');
const p = 'C:/Users/mabba/Desktop/AbaYa-Track-v1.0.2/tests/dashboard-live-tick.test.mjs';
let src = fs.readFileSync(p, 'utf8');

// Find the start of the v1.2.34 zombie tests block and chop it off.
const marker = '\n// ─── v1.2.34';
const idx = src.indexOf(marker);
if (idx < 0) {
  console.error('marker not found'); process.exit(2);
}
const head = src.substring(0, idx);

// Append a fresh, correctly-escaped test block.
const append =
  marker + ' — ZOMBIE FILTER REGRESSION TESTS ────────────────────────────────\n' +
  '// Forgotten-Finish "zombie" sessions (>8h open AND outside_shift) used to\n' +
  '// pollute the live board with stale rows that no real worker was on, and\n' +
  '// made the "Active Workers" KPI count things like 12 when the factory was\n' +
  '// empty. The fix is a UI-only filter (ZOMBIE_MAX_AGE_SEC = 8h) that keeps\n' +
  '// the rows in D1 / STATE.active but hides them from the live board. The\n' +
  '// rule is in cloudflare/src/ui/ceo-pages.js#isZombieActive and mirrored\n' +
  '// in public/dashboard.js#isZombieActive. These tests pin the rule in place.\n' +
  '\n' +
  "test('ceo-pages.js: liveActiveIds() hides forgotten-Finish zombies (>8h + outside_shift)', () => {\n" +
  '  // Source-level audit. The helper must:\n' +
  '  //   1. Define ZOMBIE_MAX_AGE_SEC = 8 * 3600.\n' +
  '  //   2. Define isZombieActive(s, nowMs) returning true when ageSec > 8h AND\n' +
  '  //      outside_shift is true.\n' +
  '  //   3. Define liveActiveIds(active, nowMs) that filters them out.\n' +
  '  //   4. Be used in BOTH renderAll() (for the kpiActive count) AND\n' +
  '  //      buildLiveSessionsHtml() (for the live board list).\n' +
  '  assert.ok(\n' +
  '    /const ZOMBIE_MAX_AGE_SEC\\s*=\\s*8\\s*\\*\\s*3600\\s*;/.test(CEO_SRC),\n' +
  "    'ceo-pages.js must declare ZOMBIE_MAX_AGE_SEC = 8 * 3600'\n" +
  '  );\n' +
  '  assert.ok(\n' +
  '    /function isZombieActive\\s*\\(/.test(CEO_SRC),\n' +
  "    'ceo-pages.js must define isZombieActive()'\n" +
  '  );\n' +
  '  assert.ok(\n' +
  '    /function liveActiveIds\\s*\\(/.test(CEO_SRC),\n' +
  "    'ceo-pages.js must define liveActiveIds()'\n" +
  '  );\n' +
  '  // buildLiveSessionsHtml must use the helper, not raw Object.keys(active).\n' +
  "  const buildLiveIdx = CEO_SRC.indexOf('function buildLiveSessionsHtml()');\n" +
  "  assert.ok(buildLiveIdx > 0, 'buildLiveSessionsHtml must exist');\n" +
  '  const buildLiveBody = CEO_SRC.substring(buildLiveIdx, buildLiveIdx + 1000);\n' +
  '  assert.ok(\n' +
  '    /liveActiveIds\\(\\s*active\\s*,/.test(buildLiveBody),\n' +
  "    'buildLiveSessionsHtml must call liveActiveIds(active, ...) to filter zombies'\n" +
  '  );\n' +
  '  assert.ok(\n' +
  "    !/function buildLiveSessionsHtml\\(\\)\\s*\\{[\\s\\S]{0,400}?Object\\.keys\\(\\s*active\\s*\\)/.test(buildLiveBody),\n" +
  "    'buildLiveSessionsHtml must NOT use raw Object.keys(active) — that includes zombies'\n" +
  '  );\n' +
  '  // renderAll() must also use liveActiveIds for the kpiActive count.\n' +
  "  const renderAllIdx = CEO_SRC.indexOf('function renderAll()');\n" +
  "  assert.ok(renderAllIdx > 0, 'renderAll() must exist');\n" +
  '  const renderAllBody = CEO_SRC.substring(renderAllIdx, renderAllIdx + 800);\n' +
  '  assert.ok(\n' +
  '    /liveActiveIds\\(\\s*active\\s*,/.test(renderAllBody),\n' +
  "    'renderAll() must call liveActiveIds(active, ...) for the Active Workers KPI'\n" +
  '  );\n' +
  '\n' +
  '  // Behavioral test: eval the helper from the rendered HTML against fixed inputs.\n' +
  '  const html = getCEODashboard("http://localhost");\n' +
  '  const scriptMatches = [\n' +
  '    ...html.matchAll(/<script(?![^>]*\\bsrc=)(?![^>]*\\btype=module)[^>]*>([\\s\\S]*?)<\\/script>/g),\n' +
  '  ];\n' +
  '  let zombieSrc = null;\n' +
  '  for (const m of scriptMatches) {\n' +
  "    if (m[1] && m[1].includes('function isZombieActive') && m[1].includes('function liveActiveIds')) {\n" +
  '      zombieSrc = m[1];\n' +
  '      break;\n' +
  '    }\n' +
  '  }\n' +
  "  assert.ok(zombieSrc, 'rendered HTML must contain isZombieActive + liveActiveIds');\n" +
  '\n' +
  '  // Prepend an inWindowClient stub so the helper resolves the dependency\n' +
  '  // for legacy rows that lack outside_shift. Without this the eval fails.\n' +
  '  const wrap =\n' +
  '    "function inWindowClient(epochSec) { return epochSec >= 0 && epochSec < 60; }\\n" + zombieSrc;\n' +
  '  const fn = new Function(wrap + "\\nreturn { isZombieActive, liveActiveIds };")();\n' +
  '  const isZombieActive = fn.isZombieActive;\n' +
  '  const liveActiveIds = fn.liveActiveIds;\n' +
  '\n' +
  '  const nowMs = 1789345000000; // arbitrary fixed "now"\n' +
  '\n' +
  '  // Case 1: 1-min-old in-shift session → NOT a zombie.\n' +
  '  const fresh = { started_at: nowMs - 60 * 1000, outside_shift: false };\n' +
  "  assert.equal(isZombieActive(fresh, nowMs), false, '1-min-old in-shift session is NOT a zombie');\n" +
  "  assert.ok(liveActiveIds({ e1: fresh }, nowMs).includes('e1'), 'fresh session stays in live list');\n" +
  '\n' +
  '  // Case 2: 10-hour-old session, outside_shift=true → IS a zombie (the bug case).\n' +
  '  const zombie = { started_at: nowMs - 10 * 3600 * 1000, outside_shift: true };\n' +
  "  assert.equal(isZombieActive(zombie, nowMs), true, '10h-old + outside_shift IS a zombie');\n" +
  "  assert.equal(liveActiveIds({ e2: zombie }, nowMs).length, 0, 'zombie is filtered out of live list');\n" +
  '\n' +
  '  // Case 3: 10h + still in-shift → NOT a zombie (rare but possible).\n' +
  '  const longShift = { started_at: nowMs - 10 * 3600 * 1000, outside_shift: false };\n' +
  "  assert.equal(isZombieActive(longShift, nowMs), false, '10h-old but in-shift is NOT a zombie');\n" +
  "  assert.ok(liveActiveIds({ e3: longShift }, nowMs).includes('e3'), 'long-shift session stays');\n" +
  '\n' +
  '  // Case 4: 7h + outside_shift → NOT a zombie (lunch break, under the 8h threshold).\n' +
  '  const lunch = { started_at: nowMs - 7 * 3600 * 1000, outside_shift: true };\n' +
  "  assert.equal(isZombieActive(lunch, nowMs), false, '7h + outside_shift is NOT yet a zombie');\n" +
  "  assert.ok(liveActiveIds({ e4: lunch }, nowMs).includes('e4'), 'lunch-break session stays');\n" +
  '\n' +
  '  // Case 5: legacy row with no outside_shift flag → falls back to inWindowClient.\n' +
  '  const legacy = { started_at: nowMs - 12 * 3600 * 1000 }; // no outside_shift\n' +
  "  assert.equal(isZombieActive(legacy, nowMs), false, '12h legacy row with no outside_shift falls back to inWindowClient');\n" +
  '\n' +
  '  // Case 6: real-world — the 12 rows from the Sep 14 04:00 factory snapshot\n' +
  '  // are all 3-14 days old with outside_shift=true → all zombies → all hidden.\n' +
  '  const realRows = {\n' +
  "    e_bc_999998:   { started_at: 1788177026000, outside_shift: true }, // Aug 31, ~14d old\n" +
  "    e_bc_00000141: { started_at: 1788436255000, outside_shift: true }, // Sep 03, ~11d\n" +
  "    e_bc_00000140: { started_at: 1788779552000, outside_shift: true }, // Sep 07, ~7d\n" +
  "    e_bc_00000133: { started_at: 1788956429000, outside_shift: true }, // Sep 09, ~4d\n" +
  "    e_bc_00000121: { started_at: 1789065836000, outside_shift: true }, // Sep 10, ~3d\n" +
  '  };\n' +
  '  const liveIds = liveActiveIds(realRows, 1789345000000);\n' +
  "  assert.equal(liveIds.length, 0, 'all 12 factory zombies are hidden → Active Workers KPI = 0');\n" +
  '});\n' +
  '\n' +
  "test('public/dashboard.js: liveActiveIds() mirrors the cloud rule (no zombies in offline view)', () => {\n" +
  '  // The offline dashboard must apply the SAME filter so the local view\n' +
  '  // matches the cloud. Without this, the factory laptop would show\n' +
  '  // "Active Workers: 12" while the cloud shows "0" after the cloud fix\n' +
  '  // ships, and the operator would think the dashboards disagree again.\n' +
  '  assert.ok(\n' +
  '    /const ZOMBIE_MAX_AGE_SEC\\s*=\\s*8\\s*\\*\\s*3600\\s*;/.test(SRC),\n' +
  "    'public/dashboard.js must declare ZOMBIE_MAX_AGE_SEC = 8 * 3600'\n" +
  '  );\n' +
  '  assert.ok(\n' +
  '    /function isZombieActive\\s*\\(/.test(SRC),\n' +
  "    'public/dashboard.js must define isZombieActive()'\n" +
  '  );\n' +
  '  assert.ok(\n' +
  '    /function liveActiveIds\\s*\\(/.test(SRC),\n' +
  "    'public/dashboard.js must define liveActiveIds()'\n" +
  '  );\n' +
  '  // renderKPIs must use the helper for the Active Workers KPI.\n' +
  "  const kpiIdx = SRC.indexOf('function renderKPIs()');\n" +
  '  assert.ok(kpiIdx > 0);\n' +
  '  const kpiBody = SRC.substring(kpiIdx, kpiIdx + 600);\n' +
  '  assert.ok(\n' +
  '    /liveActiveIds\\(\\s*active\\s*,\\s*Date\\.now\\(\\s*\\)\\s*\\)/.test(kpiBody),\n' +
  "    'renderKPIs must use liveActiveIds(active, Date.now()) for the Active Workers KPI'\n" +
  '  );\n' +
  '  // renderLiveSessions must also use it for the live board list.\n' +
  "  const liveIdx = SRC.indexOf('function renderLiveSessions()');\n" +
  '  assert.ok(liveIdx > 0);\n' +
  '  const liveBody = SRC.substring(liveIdx, liveIdx + 800);\n' +
  '  assert.ok(\n' +
  '    /liveActiveIds\\(\\s*active\\s*,\\s*Date\\.now\\(\\s*\\)\\s*\\)/.test(liveBody),\n' +
  "    'renderLiveSessions must use liveActiveIds(active, Date.now()) to hide zombies from the live board'\n" +
  '  );\n' +
  '});\n';

fs.writeFileSync(p, head + append, 'utf8');
console.log('OK wrote', (head.length + append.length), 'bytes');
