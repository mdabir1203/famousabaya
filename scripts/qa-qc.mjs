#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
}

function summarizeResults(results) {
  const summary = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const item of results) {
    if (item.status === 'passed') summary.passed += 1;
    else if (item.status === 'failed') summary.failed += 1;
    else if (item.status === 'skipped') summary.skipped += 1;
  }

  summary.overallStatus = summary.failed > 0 ? 'failed' : summary.passed > 0 ? 'passed' : 'skipped';
  return summary;
}

function formatMarkdownReport(results) {
  const summary = summarizeResults(results);
  const lines = [
    '# QA/QC Report',
    '',
    `- Status: ${summary.overallStatus}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Skipped: ${summary.skipped}`,
    '',
  ];

  for (const item of results) {
    const icon = item.status === 'passed' ? 'x' : item.status === 'failed' ? ' ' : '-';
    lines.push(`- [${icon}] ${item.name}`);
    if (item.error) lines.push(`  - Error: ${item.error}`);
    if (item.reason) lines.push(`  - Reason: ${item.reason}`);
  }

  return lines.join('\n');
}

function createCheck(name, command, args, options = {}) {
  const result = runCommand(command, args, options);
  return {
    name,
    status: result.status === 0 ? 'passed' : 'failed',
    error: result.status === 0 ? null : (result.error || result.stderr || result.stdout || 'command failed'),
    details: result,
  };
}

async function runSystemSmokeCheck() {
  const server = spawn('node', ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: '3111', TEST_FACTORY_URL: 'http://127.0.0.1:3111' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const ready = await new Promise((resolve) => {
    const deadline = Date.now() + 15000;
    const attempt = async () => {
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      try {
        const response = await fetch('http://127.0.0.1:3111/api/server-info');
        if (response.ok) {
          resolve(true);
          return;
        }
      } catch {
        // keep waiting
      }
      setTimeout(attempt, 1000);
    };
    attempt();
  });

  let smokeResult;
  if (!ready) {
    smokeResult = { status: 1, stdout: output, stderr: '', error: 'smoke test timed out waiting for server startup' };
  } else {
    smokeResult = runCommand('node', ['scripts/test-system.mjs'], {
      env: { ...process.env, PORT: '3111', TEST_FACTORY_URL: 'http://127.0.0.1:3111' },
    });
  }

  server.kill('SIGTERM');
  return {
    name: 'system-smoke',
    status: smokeResult.status === 0 ? 'passed' : 'failed',
    error: smokeResult.status === 0 ? null : (smokeResult.error || smokeResult.stderr || smokeResult.stdout || 'system smoke test failed'),
    details: smokeResult,
  };
}

async function main() {
  const checks = [
    createCheck('node-unit-tests', 'node', ['--test', 'tests/qa-qc.test.mjs']),
    await runSystemSmokeCheck(),
    createCheck('offline-store', 'node', ['scripts/test-offline-report-store.mjs']),
    createCheck('employee-xlsx-roundtrip', 'node', ['scripts/verify-employee-xlsx-roundtrip.mjs']),
  ];

  const report = formatMarkdownReport(checks);
  console.log(report);

  const summary = summarizeResults(checks);
  process.exit(summary.failed > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { summarizeResults, formatMarkdownReport, createCheck, runCommand };
