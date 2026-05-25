/**
 * CEO auth: HttpOnly cookies — access JWT (`abaya_ceo_session`) + refresh JWT (`abaya_ceo_refresh`).
 * Legacy: cookie or Bearer may still equal CEO_TOKEN until next login (migration).
 */
export const CEO_SESSION_COOKIE = 'abaya_ceo_session';
export const CEO_REFRESH_COOKIE = 'abaya_ceo_refresh';

export function parseCookieHeader(header) {
  const out = {};
  const raw = String(header || '');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    let v = part.slice(idx + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch (_) {
      /* keep raw */
    }
    if (k) out[k] = v;
  }
  return out;
}

/**
 * @param {Request} request
 * @param {URL} url
 * @returns {string} trimmed token or ''
 */
export function extractCeoToken(request, url) {
  const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (auth) return auth;
  const cookies = parseCookieHeader(request.headers.get('Cookie'));
  const fromCookie = (cookies[CEO_SESSION_COOKIE] || '').trim();
  if (fromCookie) return fromCookie;
  return (url.searchParams.get('token') || '').trim();
}

/** Refresh token is never taken from query string. */
export function extractRefreshToken(request) {
  const cookies = parseCookieHeader(request.headers.get('Cookie'));
  return (cookies[CEO_REFRESH_COOKIE] || '').trim();
}

/**
 * @param {{ secure?: boolean, maxAge?: number }} [opts]
 * maxAge: seconds for Set-Cookie Max-Age
 */
export function buildSetCeoSessionCookie(token, opts) {
  const secure = !!(opts && opts.secure);
  const maxAge = opts && opts.maxAge != null ? Number(opts.maxAge) : 604800;
  const v = encodeURIComponent(String(token || '').trim());
  const parts = [`${CEO_SESSION_COOKIE}=${v}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  parts.push('Max-Age=' + (Number.isFinite(maxAge) && maxAge > 0 ? String(Math.floor(maxAge)) : '604800'));
  return parts.join('; ');
}

export function buildSetRefreshCookie(token, opts) {
  const secure = !!(opts && opts.secure);
  const maxAge = opts && opts.maxAge != null ? Number(opts.maxAge) : 604800;
  const v = encodeURIComponent(String(token || '').trim());
  const parts = [`${CEO_REFRESH_COOKIE}=${v}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  parts.push('Max-Age=' + (Number.isFinite(maxAge) && maxAge > 0 ? String(Math.floor(maxAge)) : '604800'));
  return parts.join('; ');
}

/** @param {{ secure?: boolean }} [opts] */
export function buildClearCeoSessionCookie(opts) {
  const secure = !!(opts && opts.secure);
  return [
    `${CEO_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** @param {{ secure?: boolean }} [opts] */
export function buildClearCeoRefreshCookie(opts) {
  const secure = !!(opts && opts.secure);
  return [
    `${CEO_REFRESH_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/**
 * @param {Headers} headers
 * @param {{ access: string, refresh: string, accessTtl: number, refreshTtl: number }} tokens
 * @param {boolean} secure
 */
export function appendCeoSessionCookies(headers, tokens, secure) {
  headers.append(
    'Set-Cookie',
    buildSetCeoSessionCookie(tokens.access, { secure, maxAge: tokens.accessTtl })
  );
  headers.append(
    'Set-Cookie',
    buildSetRefreshCookie(tokens.refresh, { secure, maxAge: tokens.refreshTtl })
  );
}

/** @param {Headers} headers @param {boolean} secure */
export function appendClearCeoSessionCookies(headers, secure) {
  headers.append('Set-Cookie', buildClearCeoSessionCookie({ secure }));
  headers.append('Set-Cookie', buildClearCeoRefreshCookie({ secure }));
}
