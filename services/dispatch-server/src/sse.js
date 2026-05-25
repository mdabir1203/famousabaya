/**
 * AbayaTrack Dispatch Server — src/sse.js
 * Commit 5: SSE client registry and broadcaster.
 *
 * ⚠️  NOT IMPORTED by server.js — this is the Web Streams API version
 *     designed for Bun / Cloudflare Workers runtimes.  server.js uses its
 *     own Node.js http-native SSE implementation directly.
 *
 * Maintains a Set of open ReadableStream controllers.
 * Any module can call broadcast() after a state mutation —
 * all connected leaderboard tabs/tablets repaint instantly.
 */

'use strict';

// ─── Client Registry ──────────────────────────────────────────────────────────

/** @type {Set<ReadableStreamDefaultController>} */
const _clients = new Set();

// Hoisted to module scope — avoids allocating a new TextEncoder on every call.
const _encoder = new TextEncoder();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new SSE Response for a connecting client.
 * The stream stays open until the client disconnects.
 *
 * @returns {Response}
 */
export function createSSEStream() {
  let controller;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      _clients.add(controller);

      // Send an immediate "connected" ping so the client knows the stream is live
      const ping = `event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`;
      controller.enqueue(_encoder.encode(ping));
    },
    cancel() {
      // Client disconnected — remove from registry
      _clients.delete(controller);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering if behind proxy
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Broadcast a named SSE event to ALL connected clients.
 * Fire-and-forget — dead clients are pruned automatically.
 *
 * @param {string} eventName - e.g. 'leaderboard-update' | 'invoice-delivered'
 * @param {unknown} payload  - Will be JSON-serialized into the data field
 */
export function broadcast(eventName, payload) {
  if (_clients.size === 0) return;

  const encoded = _encoder.encode(
    `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
  );

  const dead = [];
  for (const ctrl of _clients) {
    try {
      ctrl.enqueue(encoded);
    } catch (_) {
      // Stream closed on client side — mark for cleanup
      dead.push(ctrl);
    }
  }
  dead.forEach((ctrl) => _clients.delete(ctrl));
}

/**
 * Return the number of currently connected SSE clients.
 * @returns {number}
 */
export function clientCount() {
  return _clients.size;
}
