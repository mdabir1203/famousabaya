'use strict';

/**
 * Safe JSON body parsing for API clients (browser + Node tests).
 * Avoids raw "Unexpected token" by validating content-type and surfacing previews.
 */

const DEFAULT_PREVIEW_LEN = 160;

function isJsonContentType(contentType) {
  const s = String(contentType || '').toLowerCase();
  return s.includes('application/json') || s.includes('+json');
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function bodyPreview(text, maxLen) {
  const n = maxLen != null && maxLen > 0 ? maxLen : DEFAULT_PREVIEW_LEN;
  const flat = normalizeWhitespace(text);
  if (flat.length <= n) return flat;
  return flat.slice(0, n) + '…';
}

/**
 * @param {string} text
 * @returns {{ ok: true, data: unknown } | { ok: false, parseMessage: string }}
 */
function parseJsonText(text) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) {
    return { ok: false, parseMessage: 'empty body' };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return {
      ok: false,
      parseMessage: e && e.message ? String(e.message) : 'JSON parse failed',
    };
  }
}

/**
 * @param {{ status?: number, contentType?: string, bodyText?: string, parseMessage?: string }} ctx
 * @returns {string}
 */
function formatApiReadError(ctx) {
  const status = ctx && ctx.status != null ? Number(ctx.status) : 0;
  const ct = ctx && ctx.contentType ? String(ctx.contentType) : 'unknown';
  const preview = bodyPreview(ctx && ctx.bodyText, DEFAULT_PREVIEW_LEN);
  const statusPart = Number.isFinite(status) && status > 0 ? 'HTTP ' + status : 'request failed';
  if (ctx && ctx.parseMessage) {
    return (
      'Invalid JSON response (' +
      statusPart +
      ', ' +
      ct +
      '). ' +
      ctx.parseMessage +
      (preview ? '. Preview: ' + preview : '') +
      ' Try again in a moment.'
    );
  }
  return (
    'Expected JSON but received ' +
    ct +
    ' (' +
    statusPart +
    ')' +
    (preview ? '. Preview: ' + preview : '') +
    '. Try again in a moment.'
  );
}

/**
 * Parse a fetch-like response body (text already read).
 * @param {{ status: number, contentType?: string, bodyText: string }} input
 * @returns {{ ok: true, data: unknown, status: number } | { ok: false, error: string, status: number }}
 */
function parseHttpBodyAsJson(input) {
  const status = Number(input && input.status) || 0;
  const contentType = (input && input.contentType) || '';
  const bodyText = input && input.bodyText != null ? String(input.bodyText) : '';

  if (!bodyText.trim()) {
    if (status >= 400) {
      return {
        ok: false,
        status,
        error: formatApiReadError({ status, contentType, bodyText: '' }),
      };
    }
    return { ok: true, status, data: null };
  }

  if (!isJsonContentType(contentType)) {
    return {
      ok: false,
      status,
      error: formatApiReadError({ status, contentType, bodyText }),
    };
  }

  const parsed = parseJsonText(bodyText);
  if (!parsed.ok) {
    return {
      ok: false,
      status,
      error: formatApiReadError({
        status,
        contentType,
        bodyText,
        parseMessage: parsed.parseMessage,
      }),
    };
  }

  return { ok: true, status, data: parsed.data };
}

module.exports = {
  isJsonContentType,
  bodyPreview,
  parseJsonText,
  formatApiReadError,
  parseHttpBodyAsJson,
  DEFAULT_PREVIEW_LEN,
};
