/**
 * AbayaTrack Dispatch Server — src/wa-media.js
 *
 * Download a WhatsApp Cloud API media object (used for PDF invoices).
 * Two steps, both Bearer-authed with WHATSAPP_TOKEN:
 *   1. GET /v19.0/<media-id>   → { url, mime_type, file_size }
 *   2. GET <url>               → the bytes
 *
 * Returns the bytes in memory — the caller extracts text and discards them, so
 * nothing is written to the (chronically-full) factory disk. View-on-demand
 * re-fetches via the same path.
 */

'use strict';

const GRAPH = 'https://graph.facebook.com/v19.0';

/**
 * @param {string} mediaId
 * @param {string} token   WHATSAPP_TOKEN
 * @param {{ metaTimeoutMs?: number, fetchTimeoutMs?: number, maxBytes?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, mimeType: string, byteLength: number }>}
 */
export async function downloadWhatsAppMedia(mediaId, token, opts = {}) {
  if (!mediaId) throw new Error('mediaId required');
  if (!token) throw new Error('WHATSAPP_TOKEN not set — cannot download media');
  const metaTimeoutMs = opts.metaTimeoutMs || 8_000;
  const fetchTimeoutMs = opts.fetchTimeoutMs || 30_000;
  const maxBytes = opts.maxBytes || 25 * 1024 * 1024; // 25 MB ceiling

  const metaRes = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(metaTimeoutMs),
  });
  if (!metaRes.ok) throw new Error(`media meta lookup failed (${metaRes.status})`);
  const { url, mime_type } = await metaRes.json();
  if (!url) throw new Error('media meta missing url');

  const fileRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  if (!fileRes.ok) throw new Error(`media download failed (${fileRes.status})`);
  const ab = await fileRes.arrayBuffer();
  if (ab.byteLength > maxBytes) throw new Error(`media too large (${ab.byteLength} bytes)`);

  return { buffer: Buffer.from(ab), mimeType: String(mime_type || ''), byteLength: ab.byteLength };
}
