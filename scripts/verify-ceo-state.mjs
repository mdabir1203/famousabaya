#!/usr/bin/env node
/**
 * Smoke: GET Worker /api/state with CEO token — JSON ok:true means dashboard can load data.
 * Usage: CEO_TOKEN=secret node scripts/verify-ceo-state.mjs [WORKER_URL]
 */
const WORKER = String(process.argv[2] || process.env.CF_WORKER_URL || 'https://dashboard.farewellabaya.com').replace(
  /\/$/,
  ''
);
const CEO = String(process.env.CEO_TOKEN || '').trim();
if (!CEO) {
  console.error('Set CEO_TOKEN env to the Wrangler secret value (CEO login password).');
  process.exit(2);
}
const url = `${WORKER}/api/state?token=${encodeURIComponent(CEO)}`;
const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
const text = await res.text();
/** @type {unknown} */
let body;
try {
  body = JSON.parse(text);
} catch {
  body = null;
}
const okJson = !!(
  body &&
  typeof body === 'object' &&
  body.ok === true &&
  typeof body.active === 'object' &&
  Array.isArray(body.logs) &&
  Array.isArray(body.garment_totals_today) &&
  Array.isArray(body.perf) &&
  typeof body.factory_today === 'string'
);
const log = {
  httpStatus: res.status,
  okJson,
  factoryToday: okJson ? body.factory_today : undefined,
};
if (!okJson) log.bodyPreview = String(text || '').slice(0, 500);
console.log(JSON.stringify(log));
process.exit(okJson ? 0 : 1);
