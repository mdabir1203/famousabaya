import { extractCeoToken } from './ceo-token.js';
import { collectJwtSecrets, verifyAccessToken } from './ceo-jwt.js';

/**
 * CEO is authenticated if: access JWT valid, or legacy cookie/bearer/query equals CEO password
 * (current or optional CEO_TOKEN_PREVIOUS during password rotation).
 */
export async function isCeoAuthenticated(request, env, url) {
  const token = extractCeoToken(request, url);
  if (!token) return false;
  const primary = String(env.CEO_TOKEN || '').trim();
  const prevPw = String(env.CEO_TOKEN_PREVIOUS || '').trim();
  if (token === primary || (prevPw && token === prevPw)) {
    return true;
  }
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) {
    return false;
  }
  const v = await verifyAccessToken(token, env);
  return v.ok === true;
}
