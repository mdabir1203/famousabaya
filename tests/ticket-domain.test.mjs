/**
 * Unit tests for the support-ticket domain helpers
 * (cloudflare/src/domain/ticket.js). These are the pure-function
 * utilities the Worker handler depends on:
 *
 *   - newTicketId(now)         → T-YYYY-MM-DD-XXXX (sortable, base36)
 *   - isValidCategory(s)       → closed set {login,app,network,hardware,catalog,other}
 *   - isValidPriority(s)       → {normal,urgent}
 *   - isValidStatus(s)         → {open,pending,resolved,closed}
 *   - isRosterEmpId(s)         → /^e_bc_\d+$/ (AGENTS.md rule #1)
 *   - buildWaMeUrl(phone,text) → https://wa.me/<digits>?text=<URL-encoded>
 *   - buildTicketText(ticket)  → multi-line human-readable text the
 *                                 operator sends to the office
 *
 * These are pure functions with no DB / env access. The Worker handler
 * uses them on every ticket create. Drift in any one of them = broken
 * wa.me links or wrong roster guards in production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// The domain file is ESM. Load it via dynamic import. On Windows the
// path needs a `file://` URL prefix.
const ticket = await import(pathToFileURL(path.join(REPO_ROOT, 'cloudflare', 'src', 'domain', 'ticket.js')).href);

// ── isValidCategory ────────────────────────────────────────────────────
test('isValidCategory accepts the closed set and rejects everything else', () => {
  for (const v of ['login', 'app', 'network', 'hardware', 'catalog', 'other']) {
    assert.equal(ticket.isValidCategory(v), true, `${v} should be valid`);
  }
  for (const v of ['', 'unknown', 'LOGIN', null, undefined, 42, {}, []]) {
    assert.equal(ticket.isValidCategory(v), false, `${JSON.stringify(v)} should be rejected`);
  }
  // Note: ' login ' is accepted because isValidCategory trims the input.
  // That's intentional — the launcher form may have whitespace.
});

// ── isValidPriority ────────────────────────────────────────────────────
test('isValidPriority is exactly {normal, urgent}', () => {
  assert.equal(ticket.isValidPriority('normal'), true);
  assert.equal(ticket.isValidPriority('urgent'), true);
  for (const v of ['high', 'low', 'critical', '', null, 'NORMAL']) {
    assert.equal(ticket.isValidPriority(v), false);
  }
});

// ── isValidStatus ──────────────────────────────────────────────────────
test('isValidStatus covers the lifecycle', () => {
  for (const v of ['open', 'pending', 'resolved', 'closed']) {
    assert.equal(ticket.isValidStatus(v), true);
  }
  for (const v of ['in_progress', 'done', 'cancelled', '', null]) {
    assert.equal(ticket.isValidStatus(v), false);
  }
});

// ── isRosterEmpId ──────────────────────────────────────────────────────
test('isRosterEmpId accepts only e_bc_<digits>', () => {
  for (const v of ['e_bc_0', 'e_bc_1', 'e_bc_00000129', 'e_bc_9999999']) {
    assert.equal(ticket.isRosterEmpId(v), true, `${v} should be a valid roster id`);
  }
  for (const v of [
    'e1', 'e26', 'TEST', 'test-smoke-emp', 'ALIGN_DEMO_1',
    'e_bc_', 'e_bc_abc', 'e_bc_12a', 'e_bc_-1',
    '', null, undefined, 123, {},
  ]) {
    assert.equal(ticket.isRosterEmpId(v), false, `${JSON.stringify(v)} should be rejected`);
  }
});

// ── newTicketId ────────────────────────────────────────────────────────
test('newTicketId format is T-YYYY-MM-DD-XXXX (sortable, base36)', () => {
  for (let i = 0; i < 50; i++) {
    const id = ticket.newTicketId(new Date('2026-09-04T03:00:00Z'));
    assert.match(id, /^T-\d{4}-\d{2}-\d{2}-[0-9a-z]{4}$/,
      `${id} must be T-YYYY-MM-DD-XXXX (4 base36 chars)`);
  }
});

test('newTicketId uses the caller-provided date (sortable by created_at)', () => {
  const a = ticket.newTicketId(new Date('2026-01-15T00:00:00Z'));
  const b = ticket.newTicketId(new Date('2026-12-31T00:00:00Z'));
  assert.match(a, /^T-2026-01-15-/);
  assert.match(b, /^T-2026-12-31-/);
});

test('newTicketId collision rate is well below 1% in 1000 calls (4-char base36 = 24^4 ≈ 331k)', () => {
  // The 4-char base36 suffix gives ~331k unique values per date. At
  // 1000 random draws the birthday-paradox collision probability is
  // ~0.15% — well below 1% but technically non-zero. We assert "no more
  // than 5 collisions in 1000 calls" so the test is stable on any
  // reasonably-random Math.random() and still fails loudly if a future
  // change reduces the suffix length or the alphabet.
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    seen.add(ticket.newTicketId(new Date()));
  }
  assert.ok(seen.size >= 995, `expected ≥995 unique ids, got ${seen.size} (collisions in a 1000-call burst should be <5)`);
});

// ── buildWaMeUrl ───────────────────────────────────────────────────────
test('buildWaMeUrl strips the + prefix per Meta wa.me format', () => {
  assert.equal(ticket.buildWaMeUrl('+971543618066', 'hello'),
    'https://wa.me/971543618066?text=hello');
  assert.equal(ticket.buildWaMeUrl('971543618066', 'hello'),
    'https://wa.me/971543618066?text=hello');
});

test('buildWaMeUrl URL-encodes special characters in the text', () => {
  const url = ticket.buildWaMeUrl('+971543618066', 'help! port 3111 is down');
  assert.match(url, /^https:\/\/wa\.me\/971543618066\?text=/);
  // The space and ! must be percent-encoded (or '+' for space, the
  // x-www-form-urlencoded default that the URL API uses).
  assert.ok(url.includes('help') && url.includes('port'), 'text should be in the URL');
  assert.ok(/(%20|\+)/.test(url), 'spaces should be percent-encoded as %20 or + (form encoding)');
  assert.ok(/%21/.test(url), '! should be percent-encoded as %21');
});

test('buildWaMeUrl handles null/empty inputs gracefully', () => {
  assert.equal(ticket.buildWaMeUrl(null, 'hi'), null);
  assert.equal(ticket.buildWaMeUrl('', 'hi'), null);
  assert.equal(ticket.buildWaMeUrl('+971543618066', null),
    'https://wa.me/971543618066');  // no text param
  assert.equal(ticket.buildWaMeUrl('+abc!@#', 'hi'), null,
    'phone with non-digits should be rejected');
});

// ── buildTicketText ────────────────────────────────────────────────────
test('buildTicketText puts the id in the first line (so the office can quote it back)', () => {
  const t = {
    id: 'T-2026-09-04-a1b2',
    subject: 'Scanner beeps twice',
    category: 'hardware', priority: 'normal',
    created_by: 'e_bc_00000129', created_by_name: 'Farhan',
    description: 'It beeps and skips the scan.',
  };
  const txt = ticket.buildTicketText(t);
  const firstLine = txt.split('\n')[0];
  assert.equal(firstLine, '[T-2026-09-04-a1b2] Scanner beeps twice',
    'first line must be [id] subject so the office can quote the id back');
});

test('buildTicketText includes the description body', () => {
  const t = {
    id: 'T-2026-09-04-x', subject: 's', category: 'login', priority: 'normal',
    created_by: 'e_bc_1', description: 'multi\nline\nbody',
  };
  const txt = ticket.buildTicketText(t);
  assert.ok(txt.includes('multi\nline\nbody'),
    'description must be preserved including newlines');
});

test('buildTicketText omits the name when created_by_name is missing (no null/empty noise)', () => {
  const t = {
    id: 'T-x', subject: 's', category: 'app', priority: 'normal',
    created_by: 'e_bc_1', description: 'd',
  };
  const txt = ticket.buildTicketText(t);
  assert.ok(txt.includes('From: e_bc_1'), 'should fall back to the bare emp_id');
  assert.ok(!/null/.test(txt), 'should not print the literal string "null"');
});
