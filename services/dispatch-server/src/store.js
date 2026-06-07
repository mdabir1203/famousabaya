/**
 * AbayaTrack Dispatch Server — src/store.js
 *
 * Single source of truth for all active invoices.
 * Persists to data/invoices.json on every mutation so restarts / crashes
 * resume with full state intact.
 */

'use strict';

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const _dir      = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(_dir, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'invoices.json');
// Registry of distinct materials ever used — powers a future drag-and-drop
// material palette in the invoice-creation UI. See recordMaterials/getMaterials.
const MATERIALS_FILE = join(DATA_DIR, 'materials.json');

// ─── Types (JSDoc) ────────────────────────────────────────────────────────────
/**
 * Lifecycle: PENDING → ARRIVED → READY (supervisor material check done) → DELIVERED.
 * @typedef {'PENDING'|'ARRIVED'|'READY'|'URGENT'|'DELIVERED'} InvoiceStatus
 *
 * @typedef {Object} InvoiceItem
 * @property {number} pos          - Abaya position 1–4
 * @property {string} materialSpec - Material description (e.g. "Silk Premium Nida")
 * @property {string} [color]      - Colour (e.g. "Midnight Black")
 * @property {string} [qty]        - Quantity string (e.g. "2.5m")
 * @property {boolean} [done]      - Whether this abaya has been completed
 * @property {number|null} [doneAt]- Unix ms when marked done (null if not done)
 *
 * @typedef {Object} Invoice
 * @property {string}        id           - Unique invoice reference (e.g. INV-2026-94B)
 * @property {string}        supplier     - Supplier name
 * @property {InvoiceItem[]} items        - Up to 4 abaya material selections
 * @property {string}        targetQueue  - Linked abaya batch / queue code
 * @property {InvoiceStatus} status       - Current status
 * @property {number}        slaDeadline  - Unix ms timestamp for SLA deadline
 * @property {number}        createdAt    - Unix ms timestamp of creation
 * @property {number}        updatedAt    - Unix ms timestamp of last mutation
 * @property {string|null}   source       - 'whatsapp' | 'vision' | 'api' | 'cloud' | null
 * @property {string|null}   audioId      - WhatsApp media ID of supplier voice note (optional)
 * @property {string|null}   notes        - Special recommendations from supplier (voice note summary, handling instructions)
 * @property {string|null}   customerPhone- Customer phone (E.164-ish) parsed from notes; null if none found
 */

// ─── Constants ───────────────────────────────────────────────────────────────

// DELIVERED invoices are kept in memory and on disk for 48 h, then pruned.
// This keeps _persist() fast: JSON.stringify of a small Map is O(n) and
// blocking; after weeks the Map would otherwise grow into thousands of entries.
const DELIVERED_PRUNE_AFTER_MS = 48 * 60 * 60 * 1_000;

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Write current store to disk synchronously — called after every mutation. */
function _persist() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(Array.from(_invoices.values()), null, 2), 'utf8');
  } catch (e) {
    console.warn('[store] persist failed:', e.message);
  }
}

/** Load persisted invoices from disk at startup. */
function _load() {
  try {
    if (!existsSync(DATA_FILE)) return;
    const rows = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(rows)) {
      for (const inv of rows) _invoices.set(inv.id, inv);
      console.log(`[store] restored ${rows.length} invoice(s) from disk`);
    }
  } catch (e) {
    console.warn('[store] load failed — starting fresh:', e.message);
  }
}

/** Persist the materials registry (separate file — changes far less often). */
function _persistMaterials() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const rows = Array.from(_materials.values()).map((m) => ({ ...m, colors: Array.from(m.colors) }));
    writeFileSync(MATERIALS_FILE, JSON.stringify(rows, null, 2), 'utf8');
  } catch (e) {
    console.warn('[store] materials persist failed:', e.message);
  }
}

/** Load the materials registry at startup. */
function _loadMaterials() {
  try {
    if (!existsSync(MATERIALS_FILE)) return;
    const rows = JSON.parse(readFileSync(MATERIALS_FILE, 'utf8'));
    if (Array.isArray(rows)) {
      for (const m of rows) {
        if (!m || !m.key) continue;
        _materials.set(m.key, {
          key: m.key,
          name: m.name || m.key,
          count: Number(m.count) || 0,
          lastUsed: Number(m.lastUsed) || 0,
          colors: new Set(Array.isArray(m.colors) ? m.colors : []),
        });
      }
      console.log(`[store] restored ${rows.length} material(s) from disk`);
    }
  } catch (e) {
    console.warn('[store] materials load failed — starting fresh:', e.message);
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Map<string, Invoice>} */
const _invoices = new Map();

/**
 * Materials registry: normalised material name → usage stats.
 * @type {Map<string, { key: string, name: string, count: number, lastUsed: number, colors: Set<string> }>}
 */
const _materials = new Map();

_load();          // restore invoices on startup
_loadMaterials(); // restore materials registry on startup

/**
 * Record the materials used by an invoice's items so they can later power a
 * drag-and-drop material picker. Increments usage count, tracks last-used and
 * any colours seen. Keyed on a normalised material name (case/space-insensitive).
 * @param {InvoiceItem[]} items
 */
function recordMaterials(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const now = Date.now();
  let changed = false;
  for (const it of items) {
    const name = String(it?.materialSpec || '').trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    let m = _materials.get(key);
    if (!m) { m = { key, name, count: 0, lastUsed: 0, colors: new Set() }; _materials.set(key, m); }
    m.count += 1;
    m.lastUsed = now;
    m.name = name; // keep the most recent original casing
    const color = String(it?.color || '').trim();
    if (color) m.colors.add(color);
    changed = true;
  }
  if (changed) _persistMaterials();
}

// ─── Constants (urgency) ───────────────────────────────────────────────────────
// An order with abayas still pending is "urgent" once it's within this window of
// (or past) its SLA deadline. Surfaced on the leaderboard so the floor unblocks it.
const URGENCY_THRESHOLD_MS = 60 * 60 * 1_000; // 60 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Best-effort parse of a customer phone number out of the free-text notes.
 * Recognises +9715XXXXXXXX, 05XXXXXXXX (UAE local), or any 7–15 digit run.
 * Returns a normalised string (digits, optional leading +) or null if none found.
 * @param {string|null|undefined} notes
 * @returns {string|null}
 */
export function extractCustomerPhone(notes) {
  if (!notes) return null;
  const text = String(notes);
  // Prefer an explicit international number, then a local 05x, then any long digit run.
  const patterns = [
    /\+\d[\d\s().-]{6,16}\d/,        // +971 50 123 4567
    /\b0\d[\d\s().-]{6,12}\d\b/,     // 050 123 4567
    /\b\d[\d\s().-]{6,14}\d\b/,      // bare 7–15 digit run
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const digits = m[0].replace(/[^\d+]/g, '');
      // Sanity: 7–16 chars including optional leading '+'
      const bare = digits.replace(/^\+/, '');
      if (bare.length >= 7 && bare.length <= 15) return digits;
    }
  }
  return null;
}

/**
 * Per-abaya completion progress for an invoice.
 * @param {Invoice} inv
 * @returns {{ doneCount: number, total: number, pendingCount: number }}
 */
export function itemsProgress(inv) {
  const items = Array.isArray(inv?.items) ? inv.items : [];
  const total = items.length;
  const doneCount = items.filter((it) => it && it.done === true).length;
  return { doneCount, total, pendingCount: total - doneCount };
}

/**
 * Whether an invoice should be surfaced as urgent: not yet delivered, has abayas
 * still pending, and is within URGENCY_THRESHOLD_MS of (or past) its SLA.
 * @param {Invoice} inv
 * @returns {boolean}
 */
function _isUrgent(inv) {
  if (inv.status === 'DELIVERED') return false;
  const { pendingCount, total } = itemsProgress(inv);
  // If there are no items listed yet, fall back to "any pending work" = true.
  const hasPending = total === 0 ? true : pendingCount > 0;
  if (!hasPending) return false;
  return (inv.slaDeadline - Date.now()) <= URGENCY_THRESHOLD_MS;
}

/**
 * Compute urgency score for leaderboard sorting.
 * Lower score = more urgent = ranks higher.
 * @param {Invoice} inv
 * @returns {number}
 */
function _urgencyScore(inv) {
  if (inv.status === 'DELIVERED') return Infinity;   // sink to bottom
  if (inv.status === 'ARRIVED')   return -Infinity;  // float to top — supervisor needed NOW
  const msRemaining = inv.slaDeadline - Date.now();
  // READY (in production): weight by how much work is still pending — more
  // pending abayas near the SLA = more urgent (lower score).
  if (inv.status === 'READY') {
    const { pendingCount, total } = itemsProgress(inv);
    const pendingRatio = total > 0 ? pendingCount / total : 1;
    // Multiplier in (0,1]: all pending → ×0.5 (more urgent); none pending → ×1.
    const mult = 1 - 0.5 * pendingRatio;
    return msRemaining * mult;
  }
  const urgencyMultiplier = (inv.status === 'URGENT' || _isUrgent(inv)) ? 0.5 : 1;
  return msRemaining * urgencyMultiplier;
}

/**
 * Format ms remaining as "HHh MMm" string.
 * @param {number} deadline
 * @returns {string}
 */
function fmtTimeRemaining(deadline) {
  const ms = deadline - Date.now();
  if (ms <= 0) return '00h 00m';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add or replace an invoice in the store.
 * @param {Omit<Invoice, 'createdAt'|'updatedAt'>} data
 * @returns {Invoice}
 */
export function upsertInvoice(data) {
  const now = Date.now();
  const existing = _invoices.get(data.id);

  // Normalise incoming items: ensure each has a `done` flag, preserving any
  // existing per-abaya completion when the incoming payload omits it (e.g. a
  // cloud sync that only carries material specs should not reset progress).
  const rawItems = Array.isArray(data.items) ? data.items : (existing ? existing.items : []);
  const items = rawItems.map((it) => {
    const prev = existing?.items?.find((p) => p && p.pos === it?.pos);
    const done = (it && typeof it.done === 'boolean') ? it.done : (prev?.done === true);
    return {
      ...it,
      done: done === true,
      doneAt: done === true ? (it?.doneAt ?? prev?.doneAt ?? now) : null,
    };
  });

  const notes = data.notes != null ? String(data.notes) : (existing ? (existing.notes ?? null) : null);

  /** @type {Invoice} */
  const invoice = {
    id: String(data.id || '').trim(),
    supplier: String(data.supplier || '').trim(),
    items,
    targetQueue: String(data.targetQueue || '').trim(),
    status: data.status || 'PENDING',
    slaDeadline: Number(data.slaDeadline) || now + 4 * 60 * 60 * 1000,
    // Order/receipt date (when the customer placed the order), distinct from the delivery deadline.
    orderDate: data.orderDate != null ? (Number(data.orderDate) || null) : (existing ? (existing.orderDate ?? null) : null),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    source: data.source || null,
    // Keep existing audioId if new data doesn't supply one (audio arrives separately)
    audioId: data.audioId != null ? String(data.audioId) : (existing ? existing.audioId : null),
    // PDF invoice attachment (WhatsApp media id + original filename), preserved like audioId.
    documentId: data.documentId != null ? String(data.documentId) : (existing ? (existing.documentId ?? null) : null),
    documentName: data.documentName != null ? String(data.documentName) : (existing ? (existing.documentName ?? null) : null),
    notes,
    // Customer phone: prefer an explicit value, else parse from notes, else keep prior.
    customerPhone: data.customerPhone != null
      ? String(data.customerPhone)
      : (extractCustomerPhone(notes) ?? (existing ? (existing.customerPhone ?? null) : null)),
  };

  if (!invoice.id) throw new Error('Invoice id is required');
  _invoices.set(invoice.id, invoice);
  _persist();
  recordMaterials(invoice.items); // grow the material palette from real usage
  return invoice;
}

/**
 * Return the recorded material palette for a future drag-and-drop picker.
 * Sorted by usage count (desc), then most-recently-used.
 * @returns {{ name: string, count: number, lastUsed: number, colors: string[] }[]}
 */
export function getMaterials() {
  return Array.from(_materials.values())
    .sort((a, b) => (b.count - a.count) || (b.lastUsed - a.lastUsed))
    .map((m) => ({ name: m.name, count: m.count, lastUsed: m.lastUsed, colors: Array.from(m.colors) }));
}

/**
 * Toggle (or set) the `done` flag of a single abaya within an invoice.
 * @param {string} id
 * @param {number} pos
 * @param {boolean} [done] - explicit value; if omitted, flips current state
 * @returns {Invoice|null} Updated invoice or null if invoice/item not found
 */
export function setItemDone(id, pos, done) {
  const inv = _invoices.get(id);
  if (!inv) return null;
  const items = Array.isArray(inv.items) ? inv.items : [];
  const idx = items.findIndex((it) => it && Number(it.pos) === Number(pos));
  if (idx === -1) return null;
  const cur = items[idx];
  const next = (typeof done === 'boolean') ? done : !(cur.done === true);
  const newItems = items.slice();
  newItems[idx] = { ...cur, done: next, doneAt: next ? Date.now() : null };
  const updated = { ...inv, items: newItems, updatedAt: Date.now() };
  _invoices.set(id, updated);
  _persist();
  return updated;
}

/**
 * Update the status of an existing invoice.
 * @param {string} id
 * @param {InvoiceStatus} status
 * @returns {Invoice|null} Updated invoice or null if not found
 */
export function updateInvoiceStatus(id, status) {
  const inv = _invoices.get(id);
  if (!inv) return null;
  const updated = { ...inv, status, updatedAt: Date.now() };
  _invoices.set(id, updated);
  _persist();
  return updated;
}

/**
 * Return the active leaderboard — invoices sorted by urgency score.
 * Delivered invoices are excluded unless `includeDelivered` is true.
 * @param {{ includeDelivered?: boolean }} opts
 * @returns {{ rank: number, timeRemaining: string } & Invoice)[]}
 */
export function getLeaderboard({ includeDelivered = false } = {}) {
  const items = Array.from(_invoices.values());
  const filtered = includeDelivered
    ? items
    : items.filter((inv) => inv.status !== 'DELIVERED');

  return filtered
    .sort((a, b) => _urgencyScore(a) - _urgencyScore(b))
    .map((inv, i) => {
      const { doneCount, total, pendingCount } = itemsProgress(inv);
      return {
        ...inv,
        rank: i + 1,
        timeRemaining: fmtTimeRemaining(inv.slaDeadline),
        // Derived per-abaya progress + urgency (UI reads these; not persisted).
        doneCount,
        total,
        pendingCount,
        isUrgent: _isUrgent(inv),
      };
    });
}

/**
 * Get a single invoice by id.
 * @param {string} id
 * @returns {Invoice|null}
 */
export function getInvoice(id) {
  return _invoices.get(id) || null;
}

/**
 * Remove DELIVERED invoices that are older than DELIVERED_PRUNE_AFTER_MS (48 h).
 * Called on startup and once per day so the in-memory Map and JSON file stay small.
 * @returns {number} number of invoices pruned
 */
export function pruneDelivered() {
  const cutoff = Date.now() - DELIVERED_PRUNE_AFTER_MS;
  let pruned = 0;
  for (const [id, inv] of _invoices) {
    if (inv.status === 'DELIVERED' && inv.updatedAt < cutoff) {
      _invoices.delete(id);
      pruned++;
    }
  }
  if (pruned > 0) {
    console.log(`[store] pruned ${pruned} delivered invoice(s) older than 48 h — map size: ${_invoices.size}`);
    _persist();
  }
  return pruned;
}

/**
 * Return a plain snapshot of the entire store (for diagnostics).
 * @returns {object}
 */
export function storeSnapshot() {
  return {
    total: _invoices.size,
    invoices: Array.from(_invoices.values()),
  };
}
