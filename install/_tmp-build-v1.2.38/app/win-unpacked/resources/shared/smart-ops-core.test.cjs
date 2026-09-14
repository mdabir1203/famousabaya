'use strict';
const assert = require('node:assert/strict');
const { computeBaselines, detectDelays, formatAlertParams, selectNewAlerts } = require('./smart-ops-core.cjs');

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ok -', name); };

// computeBaselines
{
  const completed = [
    { process: 'Stone Work', durationSec: 600 },
    { process: 'Stone Work', durationSec: 800 },
    { process: 'Stone Work', durationSec: 1000 },
    { process: 'Button', durationSec: 300 }, // 1 sample -> no baseline
  ];
  const base = computeBaselines(completed, 3);
  assert.equal(base.get('Stone Work'), 800);
  assert.equal(base.has('Button'), false);
  ok('computeBaselines: median + min-samples filter');
}

// detectDelays
{
  const now = 1_000_000_000_000;
  const baselines = new Map([['Stone Work', 800], ['Packaging', 60]]);
  const active = [
    { id: 's1', process: 'Stone Work', startedAt: now - 1300 * 1000, label: 'AB-0044' }, // 1300 > 1200 -> delayed
    { id: 's2', process: 'Stone Work', startedAt: now - 900 * 1000 },                     // 900 < 1200 -> ok
    { id: 's3', process: 'Packaging',  startedAt: now - 5000 * 1000 },                    // baseline 60 < 300 -> skip
    { id: 's4', process: 'Unknown',    startedAt: now - 9999 * 1000 },                    // no baseline -> skip
  ];
  const delays = detectDelays(active, baselines, { multiplier: 1.5, minBaselineSec: 300, now });
  assert.equal(delays.length, 1);
  assert.equal(delays[0].id, 's1');
  assert.equal(delays[0].elapsedSec, 1300);
  assert.equal(delays[0].baselineSec, 800);
  assert.equal(delays[0].label, 'AB-0044');
  ok('detectDelays: threshold + min-baseline + unknown-process');
}

// formatAlertParams
{
  assert.deepEqual(
    formatAlertParams({ label: 'AB-0044', process: 'Stone Work', elapsedSec: 5700, baselineSec: 3600 }),
    ['AB-0044', 'Stone Work', '1h 35m', '~1h 0m']
  );
  ok('formatAlertParams: ordered params + human time');
}

// selectNewAlerts: dedup + prune + re-alert
{
  const active = [{ id: 's1' }];
  const delays = [{ id: 's1' }];
  const alerted = new Set();

  assert.equal(selectNewAlerts(delays, active, alerted).length, 1, 'first pass alerts once');
  assert.equal(selectNewAlerts(delays, active, alerted).length, 0, 'second pass deduped');
  assert.equal(selectNewAlerts([], [], alerted).length, 0);
  assert.equal(alerted.has('s1'), false, 'entry pruned once session no longer active');
  assert.equal(selectNewAlerts(delays, active, alerted).length, 1, 're-delay after finishing alerts again');
  ok('selectNewAlerts: dedup + prune + re-alert');
}

console.log(`\nAll ${passed} smart-ops-core test groups passed.`);
