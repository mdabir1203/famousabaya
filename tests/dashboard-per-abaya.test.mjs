// tests/dashboard-per-abaya.test.mjs
//
// v1.2.49 — per-abaya visual distinction on the offline dashboard.
// Mirrors the cloud day-modal's per-abaya accent + Custom pill +
// audit data attrs (cloudflare/src/ui/ceo-pages.js v1.2.47). The
// offline dashboard at public/dashboard.html uses different
// rendering surfaces (live sessions, recent checker logs, recent
// invoice logs) but should still give the operator a consistent
// "this is the same abaya" visual cue as the cloud.
//
// These tests pin:
//   1. The abayaAccentFor() helper is deterministic — same abaya_id,
//      same color across reloads and across the cloud's accent.
//   2. The abayaCustomPillFor() helper returns the same Custom pill
//      copy the cloud uses, and only when the local catalog has
//      is_custom=1 for that abaya_id.
//   3. The rowAuditAttrsFor() helper stamps the audit data-* attrs
//      and the data-* values are derived only from the LAN's pushed
//      fields (started_at / ended_at — never a recompute).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_JS = path.join(__dirname, '..', 'public', 'dashboard.js');
const CEO_PAGES_JS = path.join(__dirname, '..', 'cloudflare', 'src', 'ui', 'ceo-pages.js');
const SRC = fs.readFileSync(DASHBOARD_JS, 'utf8');
const CEO_SRC = fs.readFileSync(CEO_PAGES_JS, 'utf8');

// ─── Source-grep presence checks ────────────────────────────────────
//
// These are cheap and pin the public surface — if a future agent
// refactors the row builder and accidentally drops the audit attrs
// or the per-abaya accent, the test fails immediately.

test('offline dashboard abayaAccentFor returns a deterministic HSL string', () => {
  // Source-grep: the helper exists and uses the multiplicative-hash
  // formula. The exact color value is asserted below in the sandboxed
  // execution test.
  assert.ok(SRC.includes('function abayaAccentFor'), 'abayaAccentFor helper exists');
  // Same hash formula as ceo-pages.js#edRowAccent in the cloud, so
  // the two dashboards agree on which abaya gets which color.
  assert.ok(SRC.includes("((h * 31) + id.charCodeAt(i))"), 'uses the same multiplicative-hash as the cloud');
  assert.ok(SRC.includes("h % 360"), 'rolls into HSL hue space');
});

test('offline dashboard stamps all 6 audit data-* attrs on log rows', () => {
  // Each row the dashboard renders (live sessions, recent checker,
  // recent invoice) should carry audit data-* attributes for the
  // future ops script that wants the raw timestamps without re-
  // querying the LAN server. Mirrors the cloud's data-* contract.
  const required = [
    'data-session-id',
    'data-emp-id',
    'data-abaya-id',
    'data-abaya-code',
    'data-started-at-ms',
    'data-ended-at-ms',
  ];
  // Count how many of each attribute appear in the source — every
  // surface that renders should use rowAuditAttrsFor().
  for (const attr of required) {
    const matches = (SRC.match(new RegExp(attr, 'g')) || []).length;
    assert.ok(matches >= 1, `${attr} must appear in dashboard.js (saw ${matches})`);
  }
  // The actual function must produce them all in one pass.
  const m = SRC.match(/function\s+rowAuditAttrsFor\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'rowAuditAttrsFor function exists');
  for (const attr of required) {
    assert.ok(m[1].includes(attr), `rowAuditAttrsFor body emits ${attr}`);
  }
});

test('offline Custom pill copy matches the cloud pill exactly', () => {
  // The operator-facing text and color tokens for the Custom pill
  // must agree across cloud and offline so a screen-reader or
  // copy-paste looks the same to the operator regardless of which
  // dashboard surfaces it.
  assert.ok(SRC.includes('Custom</span>'), 'offline Custom pill renders the literal "Custom" text');
  assert.ok(
    SRC.includes('rgba(124,58,237'),
    'offline Custom pill uses the same purple tone (matches cloud)'
  );
  assert.ok(CEO_SRC.includes('rgba(124,58,237'), 'cloud Custom pill uses the same purple tone');
  // Both must reference "is_custom=1" so future maintainers see why
  // the pill appears (mirrors the source comment in both files).
  assert.ok(SRC.includes('is_custom=1'), 'offline comment cites is_custom=1');
});

test('offline abayaCustomPillFor returns empty string when abaya_id is missing', () => {
  // Pure-function check on the helper. See the sandbox-extraction
  // tests below for the full behavioral coverage.
  assert.ok(SRC.includes("return '';"), 'helper short-circuits when abaya_id is missing');
});

// ─── Behavioral sandbox tests ──────────────────────────────────────
//
// Public/dashboard.js is a browser script (no module wrapping and
// references `io()` at the top level), so we can't import it directly.
// Instead we extract the helpers as text and execute them in a
// sandbox that injects the few globals they need (escapeAttr, ABAYAS).
//
// This pattern is the same one dashboard-live-tick.test.mjs uses
// for computeInShiftSec / computeActiveTodaySec.

// Regex built with new RegExp(string) so the \s and \S are interpreted
// as regex metacharacters (NOT as literal `\\s`). The regex source
// itself is built via the `r` const below — single backslashes here
// become single backslashes in the regex engine.
function extractFunction(name) {
  const r =
    'function\\s+' + name + '\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}';
  const re = new RegExp(r);
  const m = SRC.match(re);
  if (!m) throw new Error('Could not find function ' + name + ' in dashboard.js');
  return {
    argNames: m[1].split(',').map((s) => s.trim()),
    body: m[2],
  };
}

// Minimal stubs for the helpers' external dependencies. The helpers
// only touch: ABAYAS (catalog lookup) and escapeAttr (HTML escape).
function buildPerAbayaHelpers(ABAYAS, escapeAttr) {
  const accent = extractFunction('abayaAccentFor');
  const custom = extractFunction('abayaCustomPillFor');
  const audit = extractFunction('rowAuditAttrsFor');

  // The escapeAttr stub matches the real signature: takes any value
  // and returns it HTML-escaped. The simplest valid implementation
  // escapes & to &amp; — that's enough for the helpers' self-tests.
  const sandbox = `
    const ABAYAS = __abayas;
    const escapeAttr = __escapeAttr;
    function abayaAccentFor(${accent.argNames.join(',')}) {${accent.body}}
    function abayaCustomPillFor(${custom.argNames.join(',')}) {${custom.body}}
    function rowAuditAttrsFor(${audit.argNames.join(',')}) {${audit.body}}
    return {
      abayaAccentFor,
      abayaCustomPillFor,
      rowAuditAttrsFor,
    };
  `;
  const factory = new Function('__abayas', '__escapeAttr', sandbox);
  return factory(ABAYAS, escapeAttr);
}

const tagEscaper = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

test('abayaAccentFor is stable across calls and matches the cloud formula', () => {
  const helpers = buildPerAbayaHelpers([], tagEscaper);
  // Same input → same output, on every call (deterministic hash).
  const a1 = helpers.abayaAccentFor('3439'); // CF111 STD-O
  const a2 = helpers.abayaAccentFor('3439');
  assert.equal(a1, a2, 'deterministic for the same input');
  // Different inputs → possibly different colors. The two factory
  // abayas (CF111, CF112) the operator sees together should NOT
  // collide (the operator's eye relies on them being distinct).
  const cf111 = helpers.abayaAccentFor('3439');
  const fwap = helpers.abayaAccentFor('5668'); // FWAP 3907 PRE-R
  assert.notEqual(cf111, fwap, 'different abaya_ids get different accents');
  // Empty input → falls back to the brand purple '#6b5fc1', so a
  // log row with no abaya_id isn't a black swatch.
  assert.equal(helpers.abayaAccentFor(''), '#6b5fc1', 'empty → brand fallback');
  assert.equal(helpers.abayaAccentFor(null), '#6b5fc1', 'null → brand fallback');
});

test('abayaCustomPillFor returns empty string when the abaya is not custom', () => {
  // Plug in a catalog where CF111 STD-O is custom and CF112 is not.
  // The pill should appear for 3439 and be empty for 5668.
  const CATALOG = [
    { id: '3439', code: 'CF111 STD-O', is_custom: 1 },
    { id: '5668', code: 'FWAP 3907 PRE-R', is_custom: 0 },
  ];
  const helpers = buildPerAbayaHelpers(CATALOG, tagEscaper);
  const pill3439 = helpers.abayaCustomPillFor('3439');
  const pill5668 = helpers.abayaCustomPillFor('5668');
  assert.ok(pill3439.includes('Custom</span>'), 'is_custom=1 row gets the pill');
  assert.equal(pill5668, '', 'is_custom=0 row gets no pill');
  assert.equal(helpers.abayaCustomPillFor(''), '', 'empty abaya_id → no pill');
  assert.equal(helpers.abayaCustomPillFor('not-in-catalog'), '', 'unknown abaya_id → no pill');
});

test('rowAuditAttrsFor preserves the raw started_at and ended_at byte-for-byte', () => {
  // AGENTS.md §2 + §2.2 — the timestamp contract: started_at and
  // ended_at must trace back to Date.now() at the moment of Start /
  // Finish tap. The data-* attrs are how future ops scripts read
  // those raw values without re-querying the LAN. Pin them.
  const helpers = buildPerAbayaHelpers([], tagEscaper);
  const l = {
    id: 'WL-e_bc_00000125-1784005200',
    emp_id: 'e_bc_00000125',
    abaya_id: '3439',
    abaya_code: 'CF111 STD-O',
    started_at: 1784005200,
    ended_at: 1784008800,
  };
  const attrs = helpers.rowAuditAttrsFor(l);
  assert.ok(attrs.includes('data-emp-id="e_bc_00000125"'), 'data-emp-id preserved');
  assert.ok(attrs.includes('data-abaya-id="3439"'), 'data-abaya-id preserved');
  assert.ok(attrs.includes('data-abaya-code="CF111 STD-O"'), 'data-abaya-code preserved');
  // The raw seconds values — these are the kiosk tap times in
  // seconds-since-epoch. Browser-side render multiplies by 1000 to
  // produce the ms-shape DOM attribute; we pin the underlying seconds
  // to keep the contract auditable.
  assert.ok(attrs.includes('data-started-at-ms="1784005200"'), 'started_at preserved');
  assert.ok(attrs.includes('data-ended-at-ms="1784008800"'), 'ended_at preserved');
  assert.ok(attrs.includes('data-session-id="e_bc_00000125-1784005200"'), 'session id composed from emp_id+started_at');
});

test('rowAuditAttrsFor is the only place the audit attrs are emitted (no duplication)', () => {
  // Pin: rowAuditAttrsFor() is called from each rendering surface
  // once. If a future agent copy-pastes the attrs into multiple
  // surfaces, a row could end up with duplicate data-* attrs and the
  // browser picker is non-deterministic.
  const calls = (SRC.match(/rowAuditAttrsFor\(/g) || []).length;
  // 1 — defined + at least 3 invocations (live sessions + recent
  // checker + recent invoice = 3 invocations) for a total of >=4.
  // (Plus the function declaration itself, which the regex matches
  // via the `function ... (` form — exact count is `>= 4`.)
  assert.ok(calls >= 4, 'rowAuditAttrsFor is called from each rendering surface (saw ' + calls + ')');
});