import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planEnvMigration, parseDotenvLines, readRawDotenvLines, HEAL_KEYS } =
  require('../tools/desktop-launcher/env-migrate.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function withTempEnvFiles(t, userBody, prodBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-migrate-test-'));
  const userPath = path.join(dir, '.env');
  const prodPath = path.join(dir, '.env.production');
  fs.writeFileSync(userPath, userBody, 'utf8');
  fs.writeFileSync(prodPath, prodBody, 'utf8');
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });
  return { userPath, prodPath, dir };
}

test('HEAL_KEYS is the documented allow-list (no CF_INGEST_SECRET, no GH_TOKEN)', () => {
  assert.ok(HEAL_KEYS.includes('ABAYA_UPDATE_MIRROR_BASE_URL'));
  assert.ok(HEAL_KEYS.includes('ABAYA_CLOUD_UPDATE_BASE_URL'));
  assert.ok(HEAL_KEYS.includes('LAN_IP'));
  // The whole point: never silently overwrite operator-edited secrets.
  assert.ok(!HEAL_KEYS.includes('CF_INGEST_SECRET'));
  assert.ok(!HEAL_KEYS.includes('GH_TOKEN'));
  assert.ok(!HEAL_KEYS.includes('GITHUB_TOKEN'));
  assert.ok(!HEAL_KEYS.includes('CF_WORKER_URL'));
});

test('rewrites a stale LAN mirror IP to the freshly-bundled one', (t) => {
  const ctx = withTempEnvFiles(
    t,
    '# --- user file ---\nPORT=3111\nABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.101:3111\nLAN_IP=192.168.0.101\nCF_INGEST_SECRET=user-edited-secret-keep-me\n',
    'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.105:3111\nLAN_IP=192.168.0.105\nCF_INGEST_SECRET=should-never-overwrite\n'
  );
  const plan = planEnvMigration(ctx.userPath, ctx.prodPath);
  assert.equal(plan.changed, true);
  const keys = plan.migrations.map((m) => m.key);
  assert.deepEqual(keys.sort(), ['ABAYA_UPDATE_MIRROR_BASE_URL', 'LAN_IP']);
  // The rewritten content must keep CF_INGEST_SECRET untouched (the bug we're guarding against).
  assert.match(plan.nextContent, /CF_INGEST_SECRET=user-edited-secret-keep-me/);
  // And the new IPs are present.
  assert.match(plan.nextContent, /ABAYA_UPDATE_MIRROR_BASE_URL=http:\/\/192\.168\.0\.105:3111/);
  assert.match(plan.nextContent, /LAN_IP=192\.168\.0\.105/);
  // Comments + PORT line are preserved.
  assert.match(plan.nextContent, /# --- user file ---/);
  assert.match(plan.nextContent, /^PORT=3111/m);
});

test('no-op when the user .env already matches the bundled one', (t) => {
  const ctx = withTempEnvFiles(
    t,
    'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.105:3111\nLAN_IP=192.168.0.105\n',
    'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.105:3111\nLAN_IP=192.168.0.105\n'
  );
  const plan = planEnvMigration(ctx.userPath, ctx.prodPath);
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.migrations, []);
});

test('appends a key that is missing from the user .env', (t) => {
  const ctx = withTempEnvFiles(
    t,
    'PORT=3111\n',
    'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.105:3111\nLAN_IP=192.168.0.105\nABAYA_CLOUD_UPDATE_BASE_URL=https://dashboard.farewellabaya.com\n'
  );
  const plan = planEnvMigration(ctx.userPath, ctx.prodPath);
  assert.equal(plan.changed, true);
  // All three heal keys get appended.
  assert.equal(plan.migrations.length, 3);
  for (const m of plan.migrations) {
    assert.equal(m.from, '(unset)');
  }
  assert.match(plan.nextContent, /ABAYA_CLOUD_UPDATE_BASE_URL=https:\/\/dashboard\.farewellabaya\.com/);
});

test('skips a key when the bundled .env.production did not set it', (t) => {
  // Some real-world install/.env.production files may omit LAN_IP, relying on
  // ABAYA_UPDATE_MIRROR_BASE_URL alone. The migration must not invent a value
  // out of thin air and clobber the user's existing LAN_IP.
  const ctx = withTempEnvFiles(
    t,
    'LAN_IP=192.168.0.101\nABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.101:3111\n',
    'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.105:3111\n'
  );
  const plan = planEnvMigration(ctx.userPath, ctx.prodPath);
  const keys = plan.migrations.map((m) => m.key);
  assert.deepEqual(keys, ['ABAYA_UPDATE_MIRROR_BASE_URL']);
  // The user's LAN_IP stays exactly as they had it.
  assert.match(plan.nextContent, /^LAN_IP=192\.168\.0\.101/m);
});

test('parses lines that have inline comments and quoted values', () => {
  const lines = [
    '# header',
    '',
    'PORT=3111  # default factory port',
    "GH_TOKEN=\"ghp_abc123\"",
    "SINGLE_QUOTED='value with spaces'",
    'NO_VALUE_LINE',
    '=no_key',
  ];
  const map = parseDotenvLines(lines);
  assert.equal(map.PORT, '3111  # default factory port');
  assert.equal(map.GH_TOKEN, 'ghp_abc123');
  assert.equal(map.SINGLE_QUOTED, 'value with spaces');
  assert.equal(map.NO_VALUE_LINE, undefined);
  assert.equal(map[''], undefined);
});

test('regression: LAN mirror URL fix is in the same release as the .env heal (v1.2.11)', (t) => {
  // This guards the root-cause: in v1.2.10 the launcher had a broken
  // `latest.yml/latest.yml` cloud feed. In v1.2.11 we ship the heal so any
  // existing user with the wrong LAN IP gets pointed at the new factory in
  // one restart, no manual .env editing. If a future change separates these,
  // users will be stuck on a dead LAN IP with no path to recovery.
  const ctx = withTempEnvFiles(
    t,
    'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.101:3111\nLAN_IP=192.168.0.101\n',
    'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.105:3111\nLAN_IP=192.168.0.105\n'
  );
  const plan = planEnvMigration(ctx.userPath, ctx.prodPath);
  // The whole point: ONE restart, no human in the loop.
  assert.equal(plan.changed, true);
  // And after the heal the user's .env would feed a correct LAN URL into
  // the (also-fixed-in-v1.2.11) updater feed chain.
  const healed = plan.nextContent;
  assert.match(healed, /ABAYA_UPDATE_MIRROR_BASE_URL=http:\/\/192\.168\.0\.105:3111/);
  // The directory shape of buildLanGenericFeedUrl ends with `/`, so the
  // updater's GenericProvider can append `latest.yml` correctly.
  const buildLanGenericFeedUrl = require('../tools/desktop-launcher/update-policy.cjs').buildLanGenericFeedUrl;
  const url = buildLanGenericFeedUrl('http://192.168.0.105:3111', 'stable');
  assert.ok(url.endsWith('/'), 'LAN feed URL must be a directory for GenericProvider');
  assert.ok(!url.includes('latest.yml'), 'LAN feed URL must NOT already include latest.yml');
});

test('planEnvMigration returns no changes if the bundled .env.production is missing', (t) => {
  // Missing prod file → nothing to heal from. Caller (main.js) returns early.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-migrate-missing-'));
  const userPath = path.join(dir, '.env');
  fs.writeFileSync(userPath, 'ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.101:3111\n', 'utf8');
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
  const plan = planEnvMigration(userPath, path.join(dir, '.env.production.missing'));
  assert.equal(plan.changed, false);
});
