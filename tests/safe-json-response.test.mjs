import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isJsonContentType,
  parseJsonText,
  parseHttpBodyAsJson,
  formatApiReadError,
} from '../shared/safe-json-response.cjs';

describe('safe-json-response', () => {
  it('isJsonContentType accepts application/json', () => {
    assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
    assert.equal(isJsonContentType('text/html'), false);
  });

  it('parseJsonText rejects invalid JSON with clear message', () => {
    const r = parseJsonText('{not-json');
    assert.equal(r.ok, false);
    assert.match(r.parseMessage, /JSON|Unexpected token|parse/i);
  });

  it('parseHttpBodyAsJson rejects HTML error pages', () => {
    const r = parseHttpBodyAsJson({
      status: 502,
      contentType: 'text/html',
      bodyText: '<html><body>Bad Gateway</body></html>',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /Expected JSON/);
    assert.match(r.error, /502/);
    assert.doesNotMatch(r.error, /Unexpected token/);
  });

  it('parseHttpBodyAsJson accepts valid JSON error payload', () => {
    const r = parseHttpBodyAsJson({
      status: 500,
      contentType: 'application/json',
      bodyText: JSON.stringify({ ok: false, error: 'Report query failed' }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.ok, false);
    assert.equal(r.data.error, 'Report query failed');
  });

  it('formatApiReadError includes preview for diagnostics', () => {
    const msg = formatApiReadError({
      status: 503,
      contentType: 'text/plain',
      bodyText: 'Service Unavailable - try later',
    });
    assert.match(msg, /503/);
    assert.match(msg, /Service Unavailable/);
  });
});

describe('lan-url', () => {
  it('normalizeLanBaseUrl accepts IP:port shorthand', async () => {
    const { normalizeLanBaseUrl } = await import('../shared/lan-url.cjs');
    assert.equal(normalizeLanBaseUrl('192.168.0.101:3111', 3000), 'http://192.168.0.101:3111');
    assert.equal(normalizeLanBaseUrl('192.168.0.101', 3111), 'http://192.168.0.101:3111');
  });

  it('collectLanIPv4 skips virtual and link-local addresses', async () => {
    const { collectLanIPv4 } = await import('../shared/lan-url.cjs');
    const fake = {
      'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.22.64.1' }],
      'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.0.101' }],
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    };
    const ips = collectLanIPv4(fake);
    assert.equal(ips.length, 1);
    assert.equal(ips[0].address, '192.168.0.101');
  });
});

describe('report-shared ranges', () => {
  it('monthly and yearly ranges resolve with inclusive day span', async () => {
    const { reportRangeForType } = await import('../cloudflare/src/handlers/report-shared.js');
    const monthly = reportRangeForType('monthly', '2026-05-17');
    assert.equal(monthly.type, 'monthly');
    assert.equal(monthly.startYmd, '2026-05-01');
    assert.equal(monthly.endYmd, '2026-05-17');
    assert.ok(monthly.days >= 17);

    const yearly = reportRangeForType('yearly', '2026-05-17');
    assert.equal(yearly.type, 'yearly');
    assert.equal(yearly.startYmd, '2026-01-01');
    assert.equal(yearly.endYmd, '2026-05-17');
  });
});
