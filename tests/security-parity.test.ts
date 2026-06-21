/**
 * Adversarial parity checks against a running factory server (Node or Bun).
 * Run with server up: same shell convention as scripts/test-system.mjs (loads root .env).
 *
 *   PORT=3099 bun server.js   # terminal A
 *   PORT=3099 bun test tests/security-parity.test.ts   # terminal B
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

function loadDotEnv() {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotEnv();

const BASE = (
  process.env.TEST_FACTORY_URL ||
  `http://127.0.0.1:${process.env.PORT || 3000}`
).replace(/\/+$/, '');

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/client-config`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

describe('factory security parity', () => {
  test('factory server reachable', async () => {
    expect(await reachable()).toBe(true);
  });

  test('GET /api/export/floor-sessions.json rejects missing secret when export enabled', async () => {
    const noHdr = await fetch(`${BASE}/api/export/floor-sessions.json`);
    const wrongHdr = await fetch(`${BASE}/api/export/floor-sessions.json`, {
      headers: { 'X-Export-Secret': 'definitely-not-the-real-secret' },
    });
    expect([401, 503]).toContain(noHdr.status);
    expect([401, 503]).toContain(wrongHdr.status);
    if (noHdr.status === 503 && wrongHdr.status === 503) {
      expect(await noHdr.json().catch(() => ({}))).toHaveProperty('ok', false);
    }
  });

  test('GET unknown API route returns 404', async () => {
    const r = await fetch(`${BASE}/api/nonexistent-route-abaya-test`);
    expect(r.status).toBe(404);
  });

  test('employee-image rejects missing upload secret when ASSET_UPLOAD_SECRET is set', async () => {
    const secret = String(process.env.ASSET_UPLOAD_SECRET || '').trim();
    if (!secret) return;

    const fd = new FormData();
    fd.append('barcode', 'dummy-barcode-abaya-test');
    fd.append(
      'image',
      new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], {
        type: 'image/jpeg',
      }),
      'parity.jpg'
    );

    const r = await fetch(`${BASE}/api/upload/employee-image`, {
      method: 'POST',
      body: fd,
    });
    expect(r.status).toBe(401);
    const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
    expect(j && typeof j === 'object').toBe(true);
    expect(j?.ok).toBe(false);
  });
});
