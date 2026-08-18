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

export function errRes(msg, status = 400) {
  return jsonRes({ ok: false, error: msg }, status);
}
