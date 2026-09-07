/** HTTP helpers for JSON/CORS (CEO dashboard no-store). */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  // Cache-Control + Pragma are non-safelisted request headers, so cross-origin
  // fetches (e.g. embeded dashboards on other domains) need a CORS preflight.
  // Whitelist them so the CEO JSON stays fresh.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Ingest-Secret, Cache-Control, Pragma',
  'Access-Control-Max-Age': '86400',
};

/** Stops browsers and the Cloudflare CDN from caching CEO JSON (fixes stale dashboard). */
export const CEO_JSON_NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  'CDN-Cache-Control': 'no-store',
};

export function jsonRes(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
  });
}

export function errRes(msg, status = 400, extraHeaders = {}) {
  return jsonRes({ ok: false, error: msg }, status, extraHeaders);
}

/**
 * v1.2.27 — D1 graceful degradation.
 *
 * Distinguishes a D1 failure (transient, retryable) from a real bug
 * (programmer error, never retryable) so the top-level catch in src/index.js
 * can return 503 instead of 500. A 503 with `Retry-After` tells clients
 * (the factory server, the CEO dashboard) to back off and try later
 * instead of treating it as a permanent failure.
 *
 * Pattern is from Cloudflare's docs — D1 throws errors with messages that
 * start with `D1_ERROR:`. We match that prefix without depending on the
 * exact wording of the rest of the message (which can change between
 * Workers runtime versions).
 */
export function isD1Error(err) {
  if (!err) return false;
  const msg = (err && err.message) ? String(err.message) : String(err);
  return msg.startsWith('D1_ERROR');
}

export function d1ErrorResponse(err, retryAfterSec = 30) {
  return errRes(
    'database temporarily unavailable, retry shortly',
    503,
    { 'Retry-After': String(retryAfterSec) }
  );
}

