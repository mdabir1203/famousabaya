/** @param {Record<string, unknown>} env @param {string} p */
export function ceoPasswordOk(env, p) {
  const t = String(p || '').trim();
  if (!t) return false;
  const primary = String(env.CEO_TOKEN || '').trim();
  const prev = String(env.CEO_TOKEN_PREVIOUS || '').trim();
  return t === primary || (!!prev && t === prev);
}
