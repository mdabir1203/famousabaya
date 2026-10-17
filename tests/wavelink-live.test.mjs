import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 4197;
const origin = `http://127.0.0.1:${port}`;
const secret = 'test-only-session-secret-with-more-than-32-chars';
let child;

async function fetchReady(url, init) {
  return fetch(url, init);
}

test('Wavelink Live prototype protects tool routes and serves its PWA shell', async (t) => {
  child = spawn(process.execPath, ['services/wavelink-live/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIVE_HOST: '127.0.0.1',
      LIVE_PORT: String(port),
      LIVE_PUBLIC_ORIGIN: origin,
      LIVE_APP_PASSWORD: 'test-only-password',
      LIVE_SESSION_SECRET: secret,
      OPENAI_API_KEY: '',
      ABAYATRACK_CEO_TOKEN: '',
    },
    stdio: 'ignore',
  });

  t.after(() => {
    if (child && child.exitCode === null) child.kill('SIGTERM');
  });

  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetchReady(`${origin}/api/health`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.equal(ready, true, 'server should start');

  const health = await fetchReady(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'wavelink-live');

  const shell = await fetchReady(origin);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /WAVELINK/);

  const unauthenticated = await fetchReady(`${origin}/api/tools/factory-summary`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'get_factory_summary' }),
  });
  assert.equal(unauthenticated.status, 401);

  const rejectedOrigin = await fetchReady(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-only-password' }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const login = await fetchReady(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-only-password' }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.ok(setCookie?.includes('HttpOnly'));
  assert.ok(setCookie?.includes('SameSite=Strict'));
  const cookie = setCookie.split(';', 1)[0];

  const unknownTool = await fetchReady(`${origin}/api/tools/factory-summary`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'arbitrary_write_operation' }),
  });
  assert.equal(unknownTool.status, 400);

  const noKey = await fetchReady(`${origin}/api/live/session`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/sdp' },
    body: 'v=0\r\n',
  });
  assert.equal(noKey.status, 503);
});
