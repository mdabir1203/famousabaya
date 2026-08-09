import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResults, formatMarkdownReport } from '../scripts/qa-qc.mjs';

test('summarizeResults counts passed, failed, and skipped checks', () => {
  const results = [
    { name: 'unit-tests', status: 'passed' },
    { name: 'smoke-tests', status: 'failed', error: 'timeout' },
    { name: 'snapshot-check', status: 'skipped', reason: 'no snapshot dir' },
  ];

  const summary = summarizeResults(results);

  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.overallStatus, 'failed');
});

test('formatMarkdownReport renders a readable summary', () => {
  const report = formatMarkdownReport([
    { name: 'lint', status: 'passed' },
    { name: 'smoke', status: 'failed', error: 'server not reachable' },
  ]);

  assert.match(report, /# QA\/QC Report/);
  assert.match(report, /Status: failed/);
  assert.match(report, /- \[x\] lint/);
  assert.match(report, /- \[ ] smoke/);
});
