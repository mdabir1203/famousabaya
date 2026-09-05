/**
 * Support-ticket domain helpers (v1.2.24+).
 *
 * Pure functions only — no DB / env access. Tested via the same patterns
 * the rest of the Worker domain code uses (see domain/process.js for the
 * sibling).
 *
 * Rules:
 *   - Ticket IDs are human-readable + sortable: T-YYYY-MM-DD-<4-char base36>
 *   - Categories are a fixed closed set (v1.2.24)
 *   - Priorities are 2 levels: normal | urgent
 *   - Statuses are a state machine: open → pending → resolved → (closed) → (reopen → open)
 *   - created_by must be e_bc_<digits> (AGENTS.md rule #1)
 */

const CATEGORIES = new Set(['login', 'app', 'network', 'hardware', 'catalog', 'other']);
const PRIORITIES = new Set(['normal', 'urgent']);
const STATUSES = new Set(['open', 'pending', 'resolved', 'closed']);

export function isValidCategory(s) { return CATEGORIES.has(String(s || '').trim()); }
export function isValidPriority(s) { return PRIORITIES.has(String(s || '').trim()); }
export function isValidStatus(s)   { return STATUSES.has(String(s || '').trim()); }

export function isRosterEmpId(s) { return /^e_bc_\d+$/.test(String(s || '').trim()); }

/**
 * Generate a human-readable, sortable ticket id.
 * Format: T-YYYY-MM-DD-XXXX  where XXXX is 4 random base36 chars
 * (24^4 = ~330k, no collision concern at factory scale).
 */
export function newTicketId(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `T-${y}-${m}-${d}-${s}`;
}

/**
 * Build the wa.me URL the launcher opens.
 * Format: https://wa.me/<E.164-no-plus>?text=<URL-encoded text>
 * Per Meta's wa.me docs, the number has no + prefix; text must be URL-encoded.
 */
export function buildWaMeUrl(phoneE164, text) {
  if (!phoneE164) return null;
  const num = String(phoneE164).replace(/^\+/, '').replace(/[^\d]/g, '');
  if (!num) return null;
  const u = new URL('https://wa.me/' + num);
  if (text) u.searchParams.set('text', text);
  return u.toString();
}

/**
 * Build the pre-filled text the operator sends.
 * Compact, human-readable, includes the ticket id so office can reply
 * with the same id and the bot can correlate.
 */
export function buildTicketText(ticket) {
  if (!ticket) return '';
  const lines = [];
  lines.push(`[${ticket.id}] ${ticket.subject}`);
  lines.push(`Category: ${ticket.category} · Priority: ${ticket.priority}`);
  if (ticket.created_by_name) lines.push(`From: ${ticket.created_by_name} (${ticket.created_by})`);
  else lines.push(`From: ${ticket.created_by}`);
  if (ticket.station) lines.push(`Station: ${ticket.station}`);
  lines.push('');
  lines.push(ticket.description);
  return lines.join('\n');
}
