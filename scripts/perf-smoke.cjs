// scripts/perf-smoke.cjs
// Quick smoke test for the offline dashboard perf changes.
const fs = require('fs');
const src = fs.readFileSync('public/dashboard.js', 'utf8');
const lines = src.split('\n');

function findLine(prefix) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(prefix)) return i;
  }
  return -1;
}

const lineBuild = findLine('function aggregateBuildsByAbaya(');
const lineTodayFp = findLine('function todayFingerprint(');
const lineAgg = findLine('function aggregateRealtime(');
if (lineBuild < 0 || lineTodayFp < 0 || lineAgg < 0) {
  console.log('FAIL: could not find function lines');
  process.exit(1);
}

// slice [start, end) — end exclusive
const buildSrc = lines.slice(lineBuild, lineTodayFp).join('\n');
const todayFpSrc = lines.slice(lineTodayFp, lineAgg).join('\n');
const aggSrc = lines.slice(lineAgg, 2007).join('\n');

const sandbox = `
  const ymdInTimezone = function (ts, tz) {
    const d = new Date(Number(ts));
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(d);
  };
  const logDurationSec = function (l) {
    const n = Number(l && l.duration_sec);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  };
  ${buildSrc}
  ${todayFpSrc}
  ${aggSrc}
  return { __todayFingerprint, __aggregateRealtime, __aggregateBuildsByAbaya };
`;
const factory = new Function(sandbox);
const helpers = factory();

const now = Date.now();
const dayMs = 86400000;
const tz = 'Asia/Dubai';

function ymdInTz(ts, tzz) {
  const d = new Date(Number(ts));
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}
const todayYmd = ymdInTz(now, tz);

const logs = [];
for (let i = 0; i < 5400; i++) {
  const isToday = i < 400;
  const endMs = now - (isToday ? i * 60_000 : (i + 5000) * 60_000);
  logs.push({
    end: Math.floor(endMs / 1000),
    duration_sec: 1800 + (i % 13) * 60,
    emp_id: 'e_bc_00000' + String(i % 20).padStart(3, '0'),
    process: ['Tailor (01)', 'Hand Work', 'Stone Work', 'Button'][i % 4],
    abaya_id: 'abaya_' + (i % 100),
  });
}

const t1 = Date.now();
const r1 = helpers.__aggregateRealtime(logs, tz, todayYmd);
const d1 = Date.now() - t1;
console.log('cold aggregateRealtime:', d1 + 'ms', 'todayCount:', r1.todayCount, 'itemAgg:', Object.keys(r1.itemAgg).length, 'todayEmp:', Object.keys(r1.todayEmp).length, 'todayProc:', Object.keys(r1.todayProc).length, 'hourBuckets:', Object.keys(r1.hourBuckets).length);

const t2 = Date.now();
const r2 = helpers.__aggregateRealtime(logs, tz, todayYmd);
const d2 = Date.now() - t2;
console.log('warm aggregateRealtime:', d2 + 'ms (ref eq:', r1 === r2, ')');

const t3 = Date.now();
const r3 = helpers.__aggregateBuildsByAbaya(logs);
const d3 = Date.now() - t3;
console.log('cold aggregateBuildsByAbaya:', d3 + 'ms, abayas:', Object.keys(r3).length);

const t4 = Date.now();
const r4 = helpers.__aggregateBuildsByAbaya(logs);
const d4 = Date.now() - t4;
console.log('warm aggregateBuildsByAbaya:', d4 + 'ms (ref eq:', r3 === r4, ')');

const logs2 = logs.slice();
logs2.push({ end: Math.floor((now - 5 * dayMs) / 1000), duration_sec: 60, emp_id: 'e_bc_000010', process: 'Hand Work', abaya_id: 'abaya_999' });
const r5 = helpers.__aggregateRealtime(logs2, tz, todayYmd);
console.log('historical-only change: todayCount=', r5.todayCount, '(want 400), itemAgg=', Object.keys(r5.itemAgg).length, '(want 101)');

const logs3 = logs.slice();
logs3.push({ end: Math.floor(now / 1000) + 60, duration_sec: 600, emp_id: 'e_bc_000020', process: 'Hand Work', abaya_id: 'abaya_5000' });
const r6 = helpers.__aggregateRealtime(logs3, tz, todayYmd);
console.log('today-only change:     todayCount=', r6.todayCount, '(want 401), itemAgg=', Object.keys(r6.itemAgg).length, '(want 101)');
