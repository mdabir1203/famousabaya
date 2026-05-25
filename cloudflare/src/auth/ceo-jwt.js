/**
 * CEO session JWTs (HS256, Web Crypto). Access + refresh tokens; dual signing secrets for rotation overlap.
 */

const encoder = new TextEncoder();

function b64urlEncodeBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '===='.slice(0, 4 - pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return b64urlEncodeBytes(new Uint8Array(sig));
}

async function hmacVerify(message, signatureB64url, secret) {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sig = b64urlDecode(signatureB64url);
    return crypto.subtle.verify('HMAC', key, sig, encoder.encode(message));
  } catch (_) {
    return false;
  }
}

function parsePositiveIntEnv(env, key, def, maxSec) {
  const n = parseInt(String(env[key] || ''), 10);
  if (!Number.isFinite(n) || n <= 0 || n > maxSec) return def;
  return n;
}

/** Integer in [vars]; bump to revoke all CEO JWTs (emergency or password policy). */
export function getCredentialVersion(env) {
  const n = parseInt(String(env.CEO_CREDENTIAL_VERSION ?? '1'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Short-lived access JWT TTL (seconds). Default 1h. */
export function getAccessTtlSec(env) {
  return parsePositiveIntEnv(env, 'CEO_ACCESS_TTL_SEC', 3600, 86400);
}

/** Refresh JWT TTL (seconds). Default 7d. */
export function getRefreshTtlSec(env) {
  return parsePositiveIntEnv(env, 'CEO_REFRESH_TTL_SEC', 604800, 60 * 86400);
}

export function collectJwtSecrets(env) {
  const primary = String(env.CEO_JWT_SECRET || '').trim();
  const prev = String(env.CEO_JWT_SECRET_PREVIOUS || '').trim();
  const out = [];
  if (primary) out.push(primary);
  if (prev && prev !== primary) out.push(prev);
  return out;
}

export async function signCeoJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = b64urlEncodeBytes(encoder.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncodeBytes(encoder.encode(JSON.stringify(payload)));
  const msg = headerB64 + '.' + payloadB64;
  const sig = await hmacSign(msg, secret);
  return msg + '.' + sig;
}

const CLOCK_SKEW_SEC = 90;

/**
 * @param {string} token
 * @param {string[]} secrets
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, error: string, payload?: object }>}
 */
export async function verifyCeoJwt(token, secrets) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed' };
  const [h, p, s] = parts;
  const msg = h + '.' + p;
  let okSig = false;
  for (let i = 0; i < secrets.length; i++) {
    if (!secrets[i]) continue;
    if (await hmacVerify(msg, s, secrets[i])) {
      okSig = true;
      break;
    }
  }
  if (!okSig) return { ok: false, error: 'bad_sig' };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch (_) {
    return { ok: false, error: 'bad_payload' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - CLOCK_SKEW_SEC) {
    return { ok: false, error: 'expired', payload };
  }
  if (typeof payload.iat === 'number' && payload.iat > now + CLOCK_SKEW_SEC) {
    return { ok: false, error: 'future_iat' };
  }
  return { ok: true, payload };
}

export async function verifyAccessToken(token, env) {
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) return { ok: false, error: 'no_jwt_secret' };
  const r = await verifyCeoJwt(token, secrets);
  if (!r.ok) return r;
  const pl = r.payload;
  if (pl.sub !== 'ceo' || pl.typ !== 'ceo_access') {
    return { ok: false, error: 'wrong_typ', payload: pl };
  }
  if (Number(pl.cv) !== getCredentialVersion(env)) {
    return { ok: false, error: 'cv_mismatch', payload: pl };
  }
  return { ok: true, payload: pl };
}

export async function verifyRefreshToken(token, env) {
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) return { ok: false, error: 'no_jwt_secret' };
  const r = await verifyCeoJwt(token, secrets);
  if (!r.ok) return r;
  const pl = r.payload;
  if (pl.sub !== 'ceo' || pl.typ !== 'ceo_refresh') {
    return { ok: false, error: 'wrong_typ' };
  }
  if (Number(pl.cv) !== getCredentialVersion(env)) {
    return { ok: false, error: 'cv_mismatch' };
  }
  return { ok: true, payload: pl };
}

/** @param {Record<string, unknown>} env */
export async function mintCeoSessionPair(env) {
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) {
    return { ok: false, error: 'missing_CEO_JWT_SECRET' };
  }
  const secret = secrets[0];
  const nowSec = Math.floor(Date.now() / 1000);
  const cv = getCredentialVersion(env);
  const accessTtl = getAccessTtlSec(env);
  const refreshTtl = getRefreshTtlSec(env);
  const access = await signCeoJwt(
    { sub: 'ceo', typ: 'ceo_access', iat: nowSec, exp: nowSec + accessTtl, cv },
    secret
  );
  const refresh = await signCeoJwt(
    { sub: 'ceo', typ: 'ceo_refresh', iat: nowSec, exp: nowSec + refreshTtl, cv },
    secret
  );
  return { ok: true, access, refresh, accessTtl, refreshTtl, exp: nowSec + accessTtl };
}
