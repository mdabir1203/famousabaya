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

// ─── Types (JSDoc) ────────────────────────────────────────────────────────────
/**
 * @typedef {'PENDING'|'ARRIVED'|'URGENT'|'DELIVERED'} InvoiceStatus
 *
 * @typedef {Object} InvoiceItem
 * @property {number} pos          - Abaya position 1–4
 * @property {string} materialSpec - Material description (e.g. "Silk Premium Nida")
 * @property {string} [color]      - Colour (e.g. "Midnight Black")
 * @property {string} [qty]        - Quantity string (e.g. "2.5m")
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

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Map<string, Invoice>} */
const _invoices = new Map();

_load(); // restore on startup

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute urgency score for leaderboard sorting.
 * Lower score = more urgent = ranks higher.
 * URGENT status gets a 2x penalty multiplier on remaining time.
 * @param {Invoice} inv
 * @returns {number}
 */
function _urgencyScore(inv) {
  if (inv.status === 'DELIVERED') return Infinity;   // sink to bottom
  if (inv.status === 'ARRIVED')   return -Infinity;  // float to top — supervisor needed NOW
  const msRemaining = inv.slaDeadline - Date.now();
  const urgencyMultiplier = inv.status === 'URGENT' ? 0.5 : 1;
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
  /** @type {Invoice} */
  const invoice = {
    id: String(data.id || '').trim(),
    supplier: String(data.supplier || '').trim(),
    items: Array.isArray(data.items) ? data.items : (existing ? existing.items : []),
    targetQueue: String(data.targetQueue || '').trim(),
    status: data.status || 'PENDING',
    slaDeadline: Number(data.slaDeadline) || now + 4 * 60 * 60 * 1000,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    source: data.source || null,
    // Keep existing audioId if new data doesn't supply one (audio arrives separately)
    audioId: data.audioId != null ? String(data.audioId) : (existing ? existing.audioId : null),
    notes: data.notes != null ? String(data.notes) : (existing ? (existing.notes ?? null) : null),
  };

  if (!invoice.id) throw new Error('Invoice id is required');
  _invoices.set(invoice.id, invoice);
  _persist();
  return invoice;
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
    .map((inv, i) => ({
      ...inv,
      rank: i + 1,
      timeRemaining: fmtTimeRemaining(inv.slaDeadline),
    }));
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
