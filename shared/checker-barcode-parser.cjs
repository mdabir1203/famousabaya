'use strict';

/** Total paste size guard (characters). */
const MAX_CHECKER_BC_RAW_CHARS = 500000;
/** Upper bound on number of barcode tokens (practical ceiling). */
const MAX_CHECKER_BC_TOKENS = 100000;
/** Max length of a single barcode token after trim. */
const MAX_CHECKER_BC_TOKEN_CHARS = 500;

/**
 * Parse comma-separated (and newline-separated) checker barcodes.
 * Splits each line on commas only; trims each token; empty tokens skipped.
 *
 * @returns {{ ok: boolean, error?: string, normalized?: string }}
 */
function parseCheckerBarcodeList(raw) {
  const str = String(raw ?? '');
  if (str.length > MAX_CHECKER_BC_RAW_CHARS) {
    return {
      ok: false,
      error:
        'List is too long. Use at most ' +
        MAX_CHECKER_BC_RAW_CHARS +
        ' characters or split across sessions.',
    };
  }
  const lines = str.replace(/\uFEFF/g, '').split(/\r?\n/);
  const parts = [];
  for (let li = 0; li < lines.length; li++) {
    const segs = lines[li].split(',');
    for (let si = 0; si < segs.length; si++) {
      const t = segs[si].trim();
      if (t) parts.push(t);
    }
  }
  if (parts.length < 1) {
    return { ok: false, error: 'Enter at least one barcode (separate with commas).' };
  }
  if (parts.length > MAX_CHECKER_BC_TOKENS) {
    return {
      ok: false,
      error: 'Too many barcodes (max ' + MAX_CHECKER_BC_TOKENS + ' per session).',
    };
  }
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > MAX_CHECKER_BC_TOKEN_CHARS) {
      const show = parts[i].length > 40 ? parts[i].slice(0, 40) + '\u2026' : parts[i];
      return {
        ok: false,
        error:
          'Barcode too long: "' +
          show +
          '" (max ' +
          MAX_CHECKER_BC_TOKEN_CHARS +
          ' characters per value).',
      };
    }
  }
  return { ok: true, error: '', normalized: parts.join(',') };
}

module.exports = {
  MAX_CHECKER_BC_RAW_CHARS,
  MAX_CHECKER_BC_TOKENS,
  MAX_CHECKER_BC_TOKEN_CHARS,
  parseCheckerBarcodeList,
};
