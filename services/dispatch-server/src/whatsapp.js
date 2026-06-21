/**
 * AbayaTrack Dispatch Server — src/whatsapp.js
 * Commit 6: Inbound WhatsApp Cloud API reader.
 *
 * READ-ONLY integration — we never send messages from here.
 * We only:
 *  1. Verify the webhook handshake (GET)
 *  2. Parse incoming invoice notifications from suppliers (POST)
 *  3. Return structured invoice data for the store
 */

'use strict';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const BEARER_TOKEN = process.env.WHATSAPP_TOKEN || '';

// ─── Verification Handshake (GET) ─────────────────────────────────────────────

/**
 * Handle the Meta webhook verification challenge.
 * Meta sends GET with hub.mode, hub.verify_token, hub.challenge.
 * We must echo back hub.challenge if the token matches.
 *
 * @param {URL} url
 * @returns {Response}
 */
export function handleVerification(url) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[whatsapp] Webhook verification successful');
    return new Response(challenge, { status: 200 });
  }

  console.warn('[whatsapp] Webhook verification failed — token mismatch');
  return new Response('Forbidden', { status: 403 });
}

// ─── Inbound Message Parser (POST) ────────────────────────────────────────────

/**
 * Parse a raw WhatsApp Cloud API webhook payload.
 * Extracts text or audio message metadata from supplier messages.
 *
 * Returns an array of structured invoice-candidate objects.
 * Callers decide whether to pass these to upsertInvoice().
 *
 * @param {object} body - Parsed JSON body from Meta webhook POST
 * @returns {{ type: 'text'|'audio', from: string, body: string, timestamp: number }[]}
 */
export function parseInboundMessages(body) {
  const results = [];

  try {
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        const messages = change?.value?.messages ?? [];
        for (const msg of messages) {
          const from = String(msg.from || '');
          const ts = Number(msg.timestamp || 0) * 1000; // Meta sends Unix seconds

          if (msg.type === 'text') {
            results.push({
              type: 'text',
              from,
              body: String(msg.text?.body || ''),
              timestamp: ts,
            });
          } else if (msg.type === 'audio') {
            // Voice note from supplier/customer — capture the media id so it can be played.
            results.push({
              type: 'audio',
              from,
              body: `[audio:${msg.audio?.id || 'unknown'}]`,
              audioId: String(msg.audio?.id || ''),
              mimeType: String(msg.audio?.mime_type || ''),
              timestamp: ts,
            });
          } else if (msg.type === 'image') {
            // Photo (e.g. a snapshot of a paper invoice or a reference picture).
            // Captured for viewing; OCR of invoice photos is a separate path.
            results.push({
              type: 'image',
              from,
              body: `[image:${msg.image?.id || 'unknown'}]`,
              imageId: String(msg.image?.id || ''),
              mimeType: String(msg.image?.mime_type || ''),
              caption: String(msg.image?.caption || ''),
              timestamp: ts,
            });
          } else if (msg.type === 'document') {
            // PDF (or other) invoice attachment — capture media ID + metadata.
            // The caller downloads it (needs WHATSAPP_TOKEN), extracts text, and
            // either auto-fills the invoice or files a manual-review stub.
            results.push({
              type: 'document',
              from,
              body: `[document:${msg.document?.id || 'unknown'}]`,
              documentId: String(msg.document?.id || ''),
              filename: String(msg.document?.filename || ''),
              mimeType: String(msg.document?.mime_type || ''),
              caption: String(msg.document?.caption || ''),
              timestamp: ts,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp] Failed to parse inbound payload:', err.message);
  }

  return results;
}

/**
 * Attempt to extract a structured invoice from a plain text message body.
 * Suppliers may send a free-text like:
 *   "INV-2026-94B | Al-Mansoor | Silk Premium Nida | 450m | 2026-05-24T16:00:00Z"
 *
 * Returns null if the message does not match the expected pattern.
 *
 * @param {string} text
 * @returns {{ id: string, supplier: string, materialSpec: string, quantity: string, slaDeadline: number } | null}
 */
export function extractInvoiceFromText(text) {
  // Accept pipe-delimited or comma-delimited formats
  const parts = text.split(/\s*[|,]\s*/).map((s) => s.trim());
  if (parts.length < 4) return null;

  const [id, supplier, materialSpec, quantity, slaRaw] = parts;
  if (!id.startsWith('INV-')) return null;

  let slaDeadline = Date.now() + 4 * 60 * 60 * 1000; // default 4h
  if (slaRaw) {
    const parsed = Date.parse(slaRaw);
    if (!isNaN(parsed)) slaDeadline = parsed;
  }

  return { id, supplier, materialSpec, quantity, slaDeadline };
}

/**
 * Simple bearer token check for outbound API calls if needed in future.
 * Not used for inbound — Meta validates via the verify token.
 * @returns {boolean}
 */
export function hasBearerToken() {
  return BEARER_TOKEN.length > 0;
}
