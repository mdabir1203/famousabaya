// scripts/test-check-report-aggregate.mjs
//
// End-to-end test of the Check Report aggregation logic, using the shared
// module directly (no HTTP server needed). Seeds:
//   - a fake abaya catalog (with abayas assigned to "Factory A" and "Factory B")
//   - three completed logs (delivered)
//   - one active session (pending)
//   - one manual cancellation
//
// Asserts the aggregate matches the spec's shape (cancelled count is
// sourced from the manual record, NOT derived from total - delivered - pending).

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const checkReport = require('../shared/check-report.cjs');

// ─── Seed data ─────────────────────────────────────────────────────────────
const t = Date.UTC(2026, 7, 11, 6, 0, 0); // 10:00 Dubai on 2026-08-11

const abayaCatalog = [
  { id: 'a1', code: 'ABY-00481', factory: 'Factory A', barcode: 'X' },
  { id: 'a2', code: 'ABY-00482', factory: 'Factory A', barcode: 'Y' },
  { id: 'a3', code: 'ABY-00483', factory: 'Factory A', barcode: 'Z' },
  { id: 'a4', code: 'ABY-00484', factory: 'Factory A', barcode: 'W' },
  { id: 'a5', code: 'ABY-00501', factory: 'Factory B', barcode: 'V' },
  { id: 'a6', code: 'ABY-00502', factory: 'Factory B', barcode: 'U' },
];

const completedLogs = [
  { id: 'log1', abaya_id: 'a1', process: 'Tailor (01)', end: t,         duration_sec: 600, invoice_serial: 'INV-2026-00128' },
  { id: 'log2', abaya_id: 'a2', process: 'Tailor (02)', end: t + 3600000, duration_sec: 720, invoice_serial: 'INV-2026-00128' },
  { id: 'log3', abaya_id: 'a5', process: 'Tailor (01)', end: t + 60000,  duration_sec: 100, invoice_serial: 'INV-2026-00131' },
];

const activeSessions = {
  e99: { abaya_id: 'a4', process: 'Tailor (01)', started_at: t + 7200000 },
};

const cancellations = [{
  id: 'CNL-test-1',
  factory: 'Factory A',
  invoiceNo: 'INV-2026-00128',
  abayaCode: 'ABY-00483',
  reason: 'material defect',
  cancelledBy: 'Misbah',
  cancelledAt: t + 4 * 3600 * 1000, // 14:00 Dubai
  source: 'manual',
}];

// ─── Aggregate ─────────────────────────────────────────────────────────────
const report = checkReport.aggregateCheckReport({
  fromYmd: '2026-08-11',
  toYmd: '2026-08-11',
  timezone: 'Asia/Dubai',
  defaultFactory: 'Main Factory',
  completedLogs,
  activeSessions,
  cancellations,
  abayaCatalog,
});

// ─── Assertions ───────────────────────────────────────────────────────────
assert.equal(report.ok, true, 'aggregate should succeed');
assert.equal(report.timezone, 'Asia/Dubai', 'timezone should be Asia/Dubai');
assert.equal(report.dateRange.from, '2026-08-11');
assert.equal(report.dateRange.to, '2026-08-11');
assert.equal(report.dateRange.fromWeekday, 'Tuesday', '11 Aug 2026 is Tuesday');
assert.equal(report.dateRange.toWeekday, 'Tuesday');
assert.equal(report.dateRange.sameDay, true);
assert.equal(report.dateRange.fromLong, 'Tuesday, 11 August 2026');

assert.equal(report.totals.invoices, 2, '2 real invoices (INV-2026-00128, INV-2026-00131)');
assert.equal(report.totals.abayas, 5, '5 abayas touched (a1-a5): a1, a2 delivered, a3 cancelled, a4 pending, a5 delivered');
assert.equal(report.totals.delivered, 3, 'a1, a2, a5 delivered');
assert.equal(report.totals.pending, 1, 'a4 active session');
assert.equal(report.totals.cancelled, 1, 'a3 cancelled manually');

// Critical: cancellation NOT inferred from math
const r2 = checkReport.aggregateCheckReport({
  fromYmd: '2026-08-11', toYmd: '2026-08-11',
  timezone: 'Asia/Dubai', defaultFactory: 'Main Factory',
  completedLogs: completedLogs.concat([
    { id: 'log4', abaya_id: 'a6', process: 'Tailor (01)', end: t + 120000, duration_sec: 50, invoice_serial: 'INV-2026-00132' },
  ]),
  activeSessions, cancellations, abayaCatalog,
});
assert.equal(r2.totals.cancelled, 1, 'cancelled count must NOT change when deliveries change');
assert.equal(r2.totals.delivered, 4, 'new delivery is counted');

// Drilldown: Factory A
const factoryA = r2.factories.find((f) => f.name === 'Factory A');
assert.ok(factoryA, 'Factory A should exist');
assert.equal(factoryA.totals.abayas, 4, 'Factory A has a1-a4');
assert.equal(factoryA.totals.delivered, 2, 'a1 + a2');
assert.equal(factoryA.totals.pending, 1, 'a4');
assert.equal(factoryA.totals.cancelled, 1, 'a3');

// Drill into invoice INV-2026-00128
const inv128 = factoryA.invoices.find((i) => i.no === 'INV-2026-00128');
assert.ok(inv128, 'INV-2026-00128 should exist under Factory A');
assert.equal(inv128.totals.abayas, 2, 'INV-2026-00128 has a1 and a2');
assert.deepEqual(inv128.abayas.map((a) => a.code).sort(), ['ABY-00481', 'ABY-00482']);

// Synthetic invoice bucket for a3/a4
const synth = factoryA.invoices.find((i) => i.synthetic);
assert.ok(synth, 'synthetic invoice bucket for a3/a4 should exist');

// Cancellations list
assert.equal(r2.cancellations.length, 1);
assert.equal(r2.cancellations[0].abayaCode, 'ABY-00483');
assert.equal(r2.cancellations[0].reason, 'material defect');

// Date range: Aug 11 → Aug 15
const rangeReport = checkReport.aggregateCheckReport({
  fromYmd: '2026-08-11', toYmd: '2026-08-15',
  timezone: 'Asia/Dubai', defaultFactory: 'Main Factory',
  completedLogs: completedLogs.concat([
    { id: 'log5', abaya_id: 'a6', process: 'Tailor (02)', end: Date.UTC(2026, 7, 13, 7, 0, 0), duration_sec: 50, invoice_serial: 'INV-2026-00132' },
  ]),
  activeSessions, cancellations, abayaCatalog,
});
assert.equal(rangeReport.dateRange.fromWeekday, 'Tuesday');
assert.equal(rangeReport.dateRange.toWeekday, 'Saturday');
assert.equal(rangeReport.dateRange.sameDay, false);
assert.equal(rangeReport.totals.delivered, 4);

// Factory filter
const filtered = checkReport.aggregateCheckReport({
  fromYmd: '2026-08-11', toYmd: '2026-08-11',
  factory: 'Factory B',
  timezone: 'Asia/Dubai', defaultFactory: 'Main Factory',
  completedLogs, activeSessions, cancellations, abayaCatalog,
});
assert.equal(filtered.totals.delivered, 1, 'only a5 in Factory B');
assert.equal(filtered.factories.length, 1, 'only Factory B in the report');
assert.equal(filtered.factories[0].name, 'Factory B');

console.log('Report shape:');
console.log(JSON.stringify(report, null, 2));
console.log('\n✅ All aggregate assertions passed.');
