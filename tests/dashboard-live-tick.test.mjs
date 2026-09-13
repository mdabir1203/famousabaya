// tests/dashboard-live-tick.test.mjs
//
// v1.2.30 — LAN dashboard realtime stream. The local factory server's
// /dashboard.html pushes STATE.active via socket, so the live session
// card already updates within ~16ms of a Start/Finish event. The
// remaining problem is the elapsed-time counter ("active today" /
// "this build") which previously rebuilt the full row innerHTML every
// 2.5s — visibly stale when an operator is staring at a busy board.
// The fix is a 1Hz `tickLiveSessions()` that updates ONLY the
// elapsed-time cells via targeted textContent writes, plus pure
// helper functions `computeInShiftSec` / `computeActiveTodaySec` that
// the tick function calls (also reused by the existing
// renderLiveSessions so we don't recompute the same value twice).
//
// These tests verify:
//   1. The two helper functions compute the right elapsed seconds for
//      single-day, cross-day, and out-of-window cases.
//   2. The dashboard schedules `setInterval(tickLiveSessions, 1000)`
//      and NOT the previous 2.5s renderLiveSessions() loop.
//   3. The data-tick attributes on the live row cells are present so
//      the tick function can find them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_JS = path.join(__dirname, '..', 'public', 'dashboard.js');
const SRC = fs.readFileSync(DASHBOARD_JS, 'utf8');

// Extract a function's argument list and body from dashboard.js source.
// The dashboard file is a plain script (no module wrapping), so the
// helpers can be moved into a small sandbox with controlled dependencies
// (inWindowClient, ymdInTimezone) as the only injected parameters.
function extractFunction(name) {
  const re = new RegExp(
    'function\\s+' + name + '\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}'
  );
  const m = SRC.match(re);
  if (!m) throw new Error('Could not find function ' + name + ' in dashboard.js');
  return {
    argNames: m[1].split(',').map((s) => s.trim()),
    body: m[2],
  };
}

// Build a sandbox that contains BOTH helpers with their dependencies
// (inWindowClient, ymdInTimezone) injected as sandboxed consts. Returns
// the two helpers as plain functions. The dependencies are passed in as
// the factory's parameters and assigned to local consts at the top of
// the sandbox so the helper bodies resolve them by closure.
function buildHelpers(inWindowClient, ymdInTimezone) {
  const inShift = extractFunction('computeInShiftSec');
  const active = extractFunction('computeActiveTodaySec');
  // Build a single sandbox that:
  //   1. Declares the dependencies as consts (so the helper bodies see them).
  //   2. Re-declares both helpers with their original arg signatures
  //      and original bodies.
  //   3. Returns them as a plain object so the test can call them.
  const sandbox = `
    const inWindowClient = __inWindow;
    const ymdInTimezone = __ymd;
    function computeInShiftSec(${inShift.argNames.join(',')}) {${inShift.body}}
    function computeActiveTodaySec(${active.argNames.join(',')}) {${active.body}}
    return { computeInShiftSec, computeActiveTodaySec };
  `;
  const factory = new Function('__inWindow', '__ymd', sandbox);
  return factory(inWindowClient, ymdInTimezone);
}

test('computeInShiftSec: counts in-window seconds between start and now', () => {
  const inWindow = () => true;
  const { computeInShiftSec } = buildHelpers(inWindow, () => '');
  assert.equal(computeInShiftSec(1000, 1900), 900, '900s range, all in window -> 900s');
  const noWindow = () => false;
  const { computeInShiftSec: fn2 } = buildHelpers(noWindow, () => '');
  assert.equal(fn2(1000, 1900), 0, '900s range, no in window -> 0s');
  const oddOnly = (t) => Math.floor(t / 60) % 2 === 1;
  const { computeInShiftSec: fn3 } = buildHelpers(oddOnly, () => '');
  // 1000..1900 = 900s = 15 minutes. The walk starts at t=1000 (even,
  // skipped) and visits t=1060, 1120, 1180, 1240, 1300, 1360, 1420,
  // 1480, 1540, 1600, 1660, 1720, 1780, 1840. The odd-minutes are at
  // floor(t/60) odd -> t=1060, 1180, 1300, 1420, 1540, 1660, 1780
  // (7 minutes × 60s = 420s).
  assert.equal(fn3(1000, 1900), 420, 'odd-minutes only -> 420s of 900s');
  const { computeInShiftSec: fn4 } = buildHelpers(inWindow, () => '');
  assert.equal(fn4(1234, 1234), 0, 'start == now -> 0s');
  assert.equal(fn4(1234, 1000), 0, 'now < start -> 0s');
});

test('computeInShiftSec: 60s granularity with partial last minute', () => {
  const inWindow = () => true;
  const { computeInShiftSec } = buildHelpers(inWindow, () => '');
  assert.equal(computeInShiftSec(1000, 1060), 60, '60s exact -> 60s');
  assert.equal(computeInShiftSec(1000, 1059), 59, '59s range -> 59s (partial minute)');
  assert.equal(computeInShiftSec(1000, 1001), 1, '1s range -> 1s');
});

test('computeActiveTodaySec: clamps cross-day sessions to today midnight', () => {
  // Factory TZ is Asia/Dubai (UTC+4).
  // serverNowMs = 2026-09-07 10:00:00 +04:00 = Date.UTC(2026, 8, 7, 6, 0, 0)
  // startedMs   = 2026-09-06 14:00:00 +04:00 = Date.UTC(2026, 8, 6, 10, 0, 0)
  // ymdInTimezone returns 2026-09-06 for startedMs, 2026-09-07 for serverNowMs.
  // For 2026-09-07 the cross-day clamp puts effStart at today 00:00 +04:00
  // = 2026-09-06 20:00:00 UTC.
  // serverNowMs - effStartMs = (06:00 UTC) - (20:00 UTC the day before)
  //                        = 10 hours = 36000 seconds.
  const serverNowMs = Date.UTC(2026, 8, 7, 6, 0, 0);
  const startedMs = Date.UTC(2026, 8, 6, 10, 0, 0);
  const serverNowSec = Math.floor(serverNowMs / 1000);
  const tz = 'Asia/Dubai';
  const todayYmd = '2026-09-07';
  const ymdInTimezone = (ms, _tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: _tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(ms));
  const inWindow = () => true;
  const { computeActiveTodaySec } = buildHelpers(inWindow, ymdInTimezone);
  const sec = computeActiveTodaySec(startedMs, serverNowMs, serverNowSec, tz, todayYmd);
  assert.equal(sec, 36000, 'cross-day session clamped to today 00:00 +04:00 -> 10h in window');
});

test('computeActiveTodaySec: same-day session does not clamp to midnight', () => {
  const serverNowMs = Date.UTC(2026, 8, 7, 6, 0, 0);  // 10:00 +04:00
  const startedMs = Date.UTC(2026, 8, 7, 3, 0, 0);    // 07:00 +04:00 (3h ago)
  const serverNowSec = Math.floor(serverNowMs / 1000);
  const tz = 'Asia/Dubai';
  const todayYmd = '2026-09-07';
  const ymdInTimezone = (ms, _tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: _tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(ms));
  const inWindow = () => true;
  const { computeActiveTodaySec } = buildHelpers(inWindow, ymdInTimezone);
  const sec = computeActiveTodaySec(startedMs, serverNowMs, serverNowSec, tz, todayYmd);
  // 3 hours, all in window -> 10800 seconds.
  assert.equal(sec, 10800, 'same-day 3h session, all in window -> 10800s');
});

test('dashboard.js schedules tickLiveSessions at 1Hz (not 2.5s renderLiveSessions)', () => {
  // v1.2.30: the old `setInterval(renderLiveSessions, 2500)` line
  // should be GONE; the new `setInterval(tickLiveSessions, 1000)`
  // should be present. This is a simple source-level guard against
  // accidental regression.
  assert.ok(
    /setInterval\(\s*tickLiveSessions\s*,\s*1000\s*\)/.test(SRC),
    'dashboard.js must schedule setInterval(tickLiveSessions, 1000)'
  );
  assert.ok(
    !/setInterval\(\s*renderLiveSessions\s*,\s*2500\s*\)/.test(SRC),
    'dashboard.js must NOT keep the old 2.5s renderLiveSessions loop'
  );
});

test('dashboard.js renderLiveSessions tags the elapsed cells with data-tick', () => {
  // The tick function finds cells via `[data-tick="active-today"]` and
  // `[data-tick="build"]`. Verify both attributes are emitted in the
  // row markup so the 1Hz tick can find them.
  assert.ok(
    /data-tick="active-today"/.test(SRC),
    'renderLiveSessions must emit data-tick="active-today" on the active-today cell'
  );
  assert.ok(
    /data-tick="build"/.test(SRC),
    'renderLiveSessions must emit data-tick="build" on the this-build cell'
  );
  // And each cell needs data-emp-id so the tick can match per-worker.
  const activeTodayOk =
    /data-tick="active-today"[^>]*data-emp-id="/.test(SRC) ||
    /data-emp-id="[^"]*"[^>]*data-tick="active-today"/.test(SRC);
  assert.ok(activeTodayOk, 'active-today cell must also carry data-emp-id for per-worker lookup');
  const buildOk =
    /data-tick="build"[^>]*data-emp-id="/.test(SRC) ||
    /data-emp-id="[^"]*"[^>]*data-tick="build"/.test(SRC);
  assert.ok(buildOk, 'build cell must also carry data-emp-id for per-worker lookup');
});

// v1.2.32 — both "active today" and "this build" cells must tick
// every second. Before this fix, the cloud's "this build" cell used a
// minute-by-minute walk that only changed the displayed text when
// crossing a minute boundary, and the offline's tickLiveSessions()
// re-ran the same walk every second (same snapping). The fix is the
// base+live formula: base = in-shift seconds at STATE arrival, live =
// min(30, browserMs - snapshotMs) if currently in shift. So a session
// that's been in shift for 60 minutes, 5 seconds, shows "1h 0m 5s"
// not "1h 0m 0s". The two attributes above are how the tick function
// finds the cells; the formula below is what it writes.
test('dashboard.js tickLiveSessions uses base+live formula (ticks every second)', () => {
  // The tick must add elapsed-since-snapshot to the per-session base,
  // not re-walk minute-by-minute on every tick. Source-level guard:
  //   1. computeLiveBaseCache() exists and is memoized on the snapshot
  //      timestamp + the sorted active-id list.
  //   2. tickLiveSessions() reads from that cache and adds the live
  //      contribution (elapsedSinceSec, capped at 30).
  assert.ok(
    /function computeLiveBaseCache\s*\(/.test(SRC),
    'dashboard.js must define computeLiveBaseCache() to memoize the per-session base'
  );
  assert.ok(
    /computeLiveBaseCache\s*\(\s*\)/.test(SRC),
    'tickLiveSessions must read from computeLiveBaseCache()'
  );
  // The cache must be busted on STATE.generated_at changes — otherwise
  // the base would never refresh after a state_update lands.
  assert.ok(
    /_liveBaseCache\s*=/.test(SRC),
    'computeLiveBaseCache must write to the _liveBaseCache module-level slot'
  );
  // The 1Hz tick must compute live = min(30, ...) so a stale tab
  // doesn't accumulate wild drift between poll-driven renders.
  assert.ok(
    /min\s*\(\s*30\s*,\s*Math\.floor\s*\(\s*\(\s*browserMs\s*-\s*snapshotMs\s*\)\s*\/\s*1000/.test(SRC),
    'tickLiveSessions must compute live as min(30, (browserMs-snapshotMs)/1000)'
  );
});

test('ceo-pages.js (cloud) adds data-tick and 1Hz tickLiveSessions', () => {
  // v1.2.32 mirror — the cloud dashboard must also emit the two
  // data-tick cells and schedule a 1Hz tickLiveSessions() that drives
  // the "active today" / "this build" counters. Without this, the
  // cloud dashboard's "this build" cell only updated once a minute
  // (minute-by-minute in-shift walk in buildLiveSessionsHtml) while
  // the offline dashboard already ticked every second — operators
  // saw the same factory event rendered at different granularities on
  // the two dashboards, which made the cloud look frozen.
  const CEO_PAGES_JS = path.join(__dirname, '..', 'cloudflare', 'src', 'ui', 'ceo-pages.js');
  const ceoSrc = fs.readFileSync(CEO_PAGES_JS, 'utf8');
  assert.ok(
    /data-tick="active-today"/.test(ceoSrc),
    'ceo-pages.js buildLiveSessionsHtml must emit data-tick="active-today"'
  );
  assert.ok(
    /data-tick="build"/.test(ceoSrc),
    'ceo-pages.js buildLiveSessionsHtml must emit data-tick="build"'
  );
  assert.ok(
    /function tickLiveSessions\s*\(/.test(ceoSrc),
    'ceo-pages.js must define tickLiveSessions() — the 1Hz cloud tick'
  );
  assert.ok(
    /setInterval\s*\(\s*function\s*\(\s*\)\s*\{[\s\S]*?tickLiveSessions\(\)/.test(ceoSrc),
    'ceo-pages.js must schedule setInterval(... tickLiveSessions(), 1000)'
  );
  // The cloud tick must use the base+live formula, not a fresh minute
  // walk per second. thisBuildSecondsFor() is the helper that reads
  // the memoized thisBuildBaseCache and adds the live contribution.
  assert.ok(
    /function thisBuildSecondsFor\s*\(/.test(ceoSrc),
    'ceo-pages.js must define thisBuildSecondsFor() — base+live resolver for the cloud tick'
  );
  assert.ok(
    /function computeThisBuildBaseCache\s*\(/.test(ceoSrc),
    'ceo-pages.js must define computeThisBuildBaseCache() — memoized per-session base'
  );
});

test('ceo-pages.js (cloud) parses cleanly — guards against unescaped backticks in template literals', () => {
  // v1.2.32: getCEODashboard() returns a giant template literal spanning
  // thousands of lines. Any unescaped backtick (\\`) inside the template
  // literal body — even inside what looks like a JS comment — closes the
  // template prematurely and leaves the trailing JS to be parsed as code,
  // breaking the entire Worker bundle. When the bundle fails to parse,
  // every route (including /api/state) returns 404 to the dashboard,
  // and the operator sees an empty cloud dashboard.
  //
  // This regression test runs node --check on the file. It catches:
  //   - Unescaped backticks inside getCEODashboard() / getLoginPage() /
  //     getPrivacyPolicyPage() / getTermsOfServicePage() template bodies
  //   - Any other JS syntax error that would break the wrangler bundle.
  // Run with: `node --check cloudflare/src/ui/ceo-pages.js` — must exit 0.
  const CEO_PAGES_JS = path.join(__dirname, '..', 'cloudflare', 'src', 'ui', 'ceo-pages.js');
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, ['--check', CEO_PAGES_JS], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    // Surface the actual parser error so a future regression names the
    // line + column instead of just "the cloud is 404ing again".
    const msg = (e && e.stderr ? e.stderr.toString() : '') || (e && e.message) || String(e);
    assert.fail('ceo-pages.js failed node --check: ' + msg);
  }
  assert.ok(typeof stdout === 'string', 'ceo-pages.js parses cleanly');
});

test('public/dashboard.js parses cleanly', () => {
  // Same guard for the offline dashboard. The file is a single script
  // (no template literals wrapping it), but a syntax error here still
  // bricks the LAN kiosk dashboard — the operator would see a blank
  // page with no console errors. The 8 dashboard-live-tick tests
  // already load the file via fs.readFileSync (regex only) but never
  // actually parse it; this test runs node --check so a typo in a
  // helper name or a missing brace fails CI before it hits the floor.
  const DASHBOARD_JS = path.join(__dirname, '..', 'public', 'dashboard.js');
  try {
    execFileSync(process.execPath, ['--check', DASHBOARD_JS], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e && e.stderr ? e.stderr.toString() : '') || (e && e.message) || String(e);
    assert.fail('public/dashboard.js failed node --check: ' + msg);
  }
});

test('ceo-pages.js: every regex/replacement inside the getCEODashboard template literal escapes backslashes correctly', () => {
  // v1.2.33: getCEODashboard() returns a giant template literal spanning
  // lines 108..4505 of ceo-pages.js. ANY regex literal or string
  // replacement INSIDE that template literal must have its backslashes
  // DOUBLED, because the template-literal parser eats `\\` -> `\` on the
  // way out. v1.2.32 introduced cssEscapeAttr() (line 1620) inside the
  // template-literal scope as part of the 1Hz tick refactor and wrote
  // `/\\/g` (single-backslash escape in source), which the template
  // literal collapsed to `/\/g` in the rendered HTML — a regex literal
  // that the browser's JS parser rejected with "Invalid regular
  // expression: /\/g, '\\').replace(/: Unmatched ')'" on every /ceo
  // page load. The Worker bundle parsed fine (so /api/state kept
  // returning JSON), but the inline script in /ceo was unparseable.
  //
  // This test scans the template-literal body for every regex literal
  // and verifies that the template-literal collapse doesn't break it.
  // We do that by simulating the template-literal collapse ourselves
  // (replace every \\ with \ EXCEPT \\ that the JS source would
  // actually emit) and re-checking each regex is still well-formed.
  //
  // The collapse model is intentionally simple: any backslash in the
  // template body that isn't itself escaped (\\), and isn't part of an
  // intentional template escape (\`, \$, \\), will be preserved
  // verbatim by the template literal. For our purposes we just need to
  // know "if the source contains N backslashes inside a regex literal,
  // will the rendered regex still be a valid regex?" — the answer is
  // yes iff the source N is even (each pair collapses to one in output,
  // which the JS regex parser still accepts).
  const CEO_PAGES_JS = path.join(__dirname, '..', 'cloudflare', 'src', 'ui', 'ceo-pages.js');
  const ceoSrc = fs.readFileSync(CEO_PAGES_JS, 'utf8');
  const lines = ceoSrc.split('\n');

  // Find the bounds of the getCEODashboard() template literal. We
  // scan for the opening "return `<!DOCTYPE html>" and the matching
  // closing "`);" at column 0.
  let tplStart = -1;
  let tplEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (tplStart < 0 && /^\s*return `<!DOCTYPE html>/.test(lines[i])) {
      tplStart = i;
    } else if (tplStart >= 0 && /^\s*`\);\s*$/.test(lines[i])) {
      tplEnd = i;
      break;
    }
  }
  assert.notEqual(tplStart, -1, 'could not locate getCEODashboard() opening backtick');
  assert.notEqual(tplEnd, -1, 'could not locate getCEODashboard() closing backtick');
  assert.ok(tplEnd > tplStart, 'getCEODashboard template literal is empty?');

  // Pull out each regex literal between tplStart and tplEnd and
  // verify the backslashes inside it are doubled (so that after the
  // template-literal collapse, the regex is still valid JS).
  //
  // Regex-literal matcher: /pattern/flags. We approximate the regex
  // pattern with a non-greedy class that matches anything except /
  // or newlines, plus escaped chars. This won't perfectly identify
  // every regex in the file (some regexes contain / via \/, others
  // span lines) but it will catch the common case AND it will
  // false-positive on comment / string text. To make it precise, we
  // skip any line that starts with `//` (single-line comment) and
  // track open/close of /* */ block comments so we don't catch
  // regex-shaped text inside JSDoc.
  const regexLiterals = [];
  const regexRe = /\/((?:[^\/\n\\]|\\.)+)\/([gimsuy]*)/g;
  let inBlockComment = false;
  for (let i = tplStart; i <= tplEnd; i++) {
    const line = lines[i];
    // Skip pure comment lines and lines inside /* */ block comments.
    if (inBlockComment) {
      if (/\*\//.test(line)) inBlockComment = false;
      continue;
    }
    if (/^\s*\/\//.test(line)) continue;
    if (/^\s*\/\*/.test(line) && !/\*\//.test(line)) { inBlockComment = true; continue; }
    if (/^\s*\/\*/.test(line) && /\*\//.test(line)) continue;

    let m;
    regexRe.lastIndex = 0;
    while ((m = regexRe.exec(line)) !== null) {
      // Skip false positives: text that is clearly prose. Heuristic:
      //   - regex is preceded by `://` (HTML/JS URL)
      //   - regex contains spaces, < or > (HTML markers)
      //   - regex body is preceded by a quote on the same line (could
      //     be a string literal that happens to look regex-ish, e.g.
      //     inside a CSS string)
      const before = line.slice(0, m.index);
      if (/:\/\//.test(before.slice(-10))) continue;
      if (/[\s<>]/.test(m[1])) continue;
      regexLiterals.push({
        line: i + 1,
        pattern: m[1],
        flags: m[2],
        fullMatch: m[0],
      });
    }
  }

  // For each regex literal, count the backslashes in the pattern.
  // After the template-literal collapse, every backslash in the
  // output corresponds to TWO backslashes in the source. So if the
  // source pattern has an ODD number of "ordinary" backslashes
  // (i.e. backslashes that are NOT part of a \`-style backtick
  // escape), the output pattern is malformed.
  //
  // The v1.2.32 cssEscapeAttr() bug had source pattern `\\` (one
  // backslash) — the template literal collapsed that to `\` in
  // output and the regex became `/\/g` (invalid). The v1.2.32
  // escWA() fix on line 1225 uses `\`` to escape a backtick
  // inside the template literal; that single backslash is a
  // template-literal escape, NOT a regex-backslash-escape, so it
  // is correct as-is and should NOT be flagged.
  const offenders = [];
  for (const rl of regexLiterals) {
    // Count backslashes in the pattern that are NOT part of a `\``
    // (backtick escape). Strip `\`` pairs first, then count what's
    // left. What's left must be an EVEN count (each pair collapses
    // to one backslash in the output, which the JS regex parser
    // can handle).
    const withoutBacktickEscapes = rl.pattern.replace(/\\`/g, '');
    const bs = (withoutBacktickEscapes.match(/\\/g) || []).length;
    if (bs % 2 !== 0) {
      offenders.push({
        line: rl.line,
        pattern: rl.pattern,
        sourceBackslashes: bs,
        fullMatch: rl.fullMatch,
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'ceo-pages.js: every regex literal inside the getCEODashboard template literal must have an EVEN number of backslashes in the source (so the template-literal collapse produces a valid regex in the rendered HTML). Offenders: ' +
      JSON.stringify(offenders, null, 2)
  );

  // Bonus check: verify cssEscapeAttr() works correctly after the template
  // collapse. Render the dashboard, find the function in the rendered
  // HTML, eval it, and assert its behavior matches the original
  // intended semantics: backslashes doubled, double-quotes backslash-
  // escaped. See the next test below for the full execution.
});

test('ceo-pages.js: rendered cssEscapeAttr() correctly escapes backslashes and quotes', () => {
  // v1.2.33: render the dashboard, locate the cssEscapeAttr() function
  // inside the inline script, execute it, and verify it produces the
  // expected escape output. This is the EXACT function the cloud
  // dashboard's tickLiveSessions() calls on every 1Hz tick to build a
  // CSS attribute selector — if it returns garbage, the row.querySelector
  // returns null, the tick silently no-ops on every active session, and
  // the operator sees the same :00-second frozen counter as v1.2.31.
  const CEO_PAGES_JS = path.join(__dirname, '..', 'cloudflare', 'src', 'ui', 'ceo-pages.js');
  return import('../cloudflare/src/ui/ceo-pages.js').then((m) => {
    const html = m.getCEODashboard('http://localhost');
    const lines = html.split('\n');
    let fnStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^function cssEscapeAttr\(s\) \{$/.test(lines[i])) {
        fnStart = i;
        break;
      }
    }
    assert.notEqual(fnStart, -1, 'cssEscapeAttr() must be present in the rendered /ceo HTML');
    const fnText = lines.slice(fnStart, fnStart + 3).join('\n');
    // Eval the function in a sandbox and verify behavior.
    const factory = new Function(fnText + '\nreturn cssEscapeAttr;');
    const fn = factory();
    assert.equal(fn('e_bc_00001'), 'e_bc_00001', 'plain emp_id is unchanged');
    assert.equal(fn('a\\b'), 'a\\\\b', 'each backslash is doubled');
    assert.equal(fn('a"b'), 'a\\"b', 'double-quote is escaped with a single backslash');
    assert.equal(fn('a\\"b'), 'a\\\\\\"b', 'both backslashes AND double-quotes are escaped');
    assert.equal(fn(''), '', 'empty string passes through');
    assert.equal(fn(null), 'null', 'null becomes the string "null" (mirrors String(null))');
  });
});
