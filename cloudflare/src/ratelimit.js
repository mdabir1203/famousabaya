import { errRes } from './http-response.js';

/** Cloudflare Rate Limiting binding (optional in older wrangler / local dev). */
export async function rateLimitOr429(rl, key, message) {
  try {
    if (!rl || typeof rl.limit !== 'function') return null;
    const out = await rl.limit({ key });
    if (out && out.success === false) {
      return errRes(message || 'Too many requests. Try again shortly.', 429);
    }
    return null;
  } catch (e) {
    console.error('Rate limit binding error:', e && e.message ? e.message : e);
    return null;
  }
}

/** Prefer per-client keys to avoid one noisy IP throttling everyone. */
export function rateLimitClientKey(request, prefix) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf && cf.trim()) return `${prefix}:${cf.trim()}`;
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return `${prefix}:${first}`;
  }
  return `${prefix}:unknown`;
}
