const MAX_INVOICE_NUMBERS = 500;
const MAX_INVOICE_DIGITS_PER = 20;
const MAX_INVOICE_RAW_CHARS = 12000;
const INVOICE_TOKEN_RE = /^\d{1,20}$/;

function parseInvoiceNumberList(raw) {
  const str = String(raw ?? '');
  if (str.length > MAX_INVOICE_RAW_CHARS) {
    return {
      ok: false,
      error:
        'List is too long. Use at most ' +
        MAX_INVOICE_RAW_CHARS +
        ' characters or split across sessions.',
      nums: [],
    };
  }
  const parts = str
    .trim()
    .split(/[\r\n,;\s\u00a0]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nums = [];
  const seen = new Set();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!INVOICE_TOKEN_RE.test(p)) {
      const show = p.length > 24 ? p.slice(0, 24) + '\u2026' : p;
      return {
        ok: false,
        error:
          'Invalid value "' +
          show +
          '": each invoice number must be digits only, 1–' +
          MAX_INVOICE_DIGITS_PER +
          ' digits.',
        nums: [],
      };
    }
    if (seen.has(p)) {
      return { ok: false, error: 'Duplicate invoice number: ' + p + '. Remove the duplicate.', nums: [] };
    }
    seen.add(p);
    nums.push(p);
  }
  if (nums.length < 1) {
    return { ok: false, error: 'Enter at least one invoice number.', nums: [] };
  }
  if (nums.length > MAX_INVOICE_NUMBERS) {
    return {
      ok: false,
      error: 'Too many invoice numbers (max ' + MAX_INVOICE_NUMBERS + ' per session).',
      nums: [],
    };
  }
  return { ok: true, error: '', nums };
}

module.exports = {
  MAX_INVOICE_NUMBERS,
  MAX_INVOICE_DIGITS_PER,
  MAX_INVOICE_RAW_CHARS,
  INVOICE_TOKEN_RE,
  parseInvoiceNumberList,
};
