/** HTTP helpers for JSON/CORS (CEO dashboard no-store). */

/** Recursively sanitize data for JSON serialization. Handles BigInt, undefined, functions, etc. */
export function sanitizeForJson(obj, path = '', depth = 0) {
  if (depth > 50) return null; // Prevent runaway recursion
  if (obj === null) return null;
  if (obj === undefined) return null;

  // Handle primitives
  if (typeof obj === 'boolean' || typeof obj === 'string') return obj;

  // Handle numbers (convert non-finite to null)
  if (typeof obj === 'number') {
    if (!isFinite(obj)) {
      console.warn(`[sanitizeForJson] non-finite number at ${path}: ${obj}`);
      return 0;
    }
    return obj;
  }

  // Handle BigInt
  if (typeof obj === 'bigint') {
    console.warn(`[sanitizeForJson] BigInt at ${path}: converting to string`);
    return String(obj);
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((v, i) => sanitizeForJson(v, `${path}[${i}]`, depth + 1));
  }

  // Handle objects
  if (typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      const sanitized = sanitizeForJson(v, `${path}.${k}`, depth + 1);
      if (sanitized !== undefined) {
        result[k] = sanitized;
      }
    }
    return result;
  }

  // Skip functions and other non-serializable types
  if (typeof obj === 'function' || typeof obj === 'symbol') {
    console.warn(`[sanitizeForJson] non-serializable type at ${path}: ${typeof obj}`);
    return undefined;
  }

  // Fallback
  console.warn(`[sanitizeForJson] unknown type at ${path}: ${typeof obj}`);
  return undefined;
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Ingest-Secret',
};

/** Stops browsers and the Cloudflare CDN from caching CEO JSON (fixes stale dashboard). */
export const CEO_JSON_NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  'CDN-Cache-Control': 'no-store',
};

export function jsonRes(data, status = 200, extraHeaders = {}) {
  try {
    // Sanitize data to ensure JSON serializability
    const sanitized = sanitizeForJson(data);
    const jsonStr = JSON.stringify(sanitized);
    if (!jsonStr || jsonStr === '{}') {
      console.warn('[jsonRes] data sanitized to empty object');
    }
    return new Response(jsonStr, {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
    });
  } catch (e) {
    console.error('[jsonRes] JSON serialization failed:', e.message);
    // Return safe error response
    return new Response(JSON.stringify({ ok: false, error: 'JSON serialization failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
    });
  }
}

export function errRes(msg, status = 400) {
  return jsonRes({ ok: false, error: msg }, status);
}
