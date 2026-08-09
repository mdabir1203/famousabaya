'use strict';

/**
 * Update policy + channel-mapping helpers for the desktop launcher.
 *
 * Extracted from main.js so the update decision logic is unit-testable
 * (tests/launcher-update.test.mjs) and verifiable without booting Electron.
 * Everything here is pure: external inputs (env value, hostname, user, RNG)
 * are parameters with production defaults.
 */

const crypto = require('crypto');
const os = require('os');

const DEFAULT_UPDATE_POLICY = {
  defaultChannel: 'stable',
  betaPercent: 0,
  checkIntervalMinutes: 360,
  retryIntervalMinutes: 15,
  maxBackoffMinutes: 720,
  jitterPercent: 20,
  rolloutSeed: 'abaya-track-default-seed',
  auditLogMaxBytes: 2 * 1024 * 1024,
  auditLogMaxArchives: 5,
};

function normalizePositiveInt(v, fallback, min, max) {
  // Note: String(v), not String(v || '') — an explicit 0 is a valid value
  // (e.g. jitterPercent: 0 disables jitter) and must not fall back.
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  const lo = Number.isFinite(min) ? min : n;
  const hi = Number.isFinite(max) ? max : n;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Merge a parsed config/update-policy.json object over defaults and clamp
 * every field into a safe range. Non-object input yields pure defaults.
 * @param {any} fromFile
 */
function loadUpdatePolicy(fromFile) {
  const merged = Object.assign({}, DEFAULT_UPDATE_POLICY, fromFile && typeof fromFile === 'object' ? fromFile : {});
  merged.defaultChannel = String(merged.defaultChannel || 'stable').toLowerCase() === 'beta' ? 'beta' : 'stable';
  merged.betaPercent = Math.max(0, Math.min(100, Number(merged.betaPercent) || 0));
  merged.checkIntervalMinutes = normalizePositiveInt(merged.checkIntervalMinutes, DEFAULT_UPDATE_POLICY.checkIntervalMinutes, 15, 24 * 60);
  merged.retryIntervalMinutes = normalizePositiveInt(merged.retryIntervalMinutes, DEFAULT_UPDATE_POLICY.retryIntervalMinutes, 1, 180);
  merged.maxBackoffMinutes = normalizePositiveInt(
    merged.maxBackoffMinutes,
    DEFAULT_UPDATE_POLICY.maxBackoffMinutes,
    merged.retryIntervalMinutes,
    7 * 24 * 60
  );
  merged.jitterPercent = normalizePositiveInt(merged.jitterPercent, DEFAULT_UPDATE_POLICY.jitterPercent, 0, 40);
  merged.rolloutSeed = String(merged.rolloutSeed || DEFAULT_UPDATE_POLICY.rolloutSeed);
  merged.auditLogMaxBytes = normalizePositiveInt(
    merged.auditLogMaxBytes,
    DEFAULT_UPDATE_POLICY.auditLogMaxBytes,
    256 * 1024,
    50 * 1024 * 1024
  );
  merged.auditLogMaxArchives = normalizePositiveInt(
    merged.auditLogMaxArchives,
    DEFAULT_UPDATE_POLICY.auditLogMaxArchives,
    1,
    50
  );
  return merged;
}

/**
 * Deterministic rollout bucket in [0, 99] for this device.
 * @param {string} seed
 * @param {string} [host]
 * @param {string} [user]
 */
function computeDeviceBucket(seed, host, user) {
  const h = typeof host === 'string' && host ? host : (os.hostname() || process.env.COMPUTERNAME || 'unknown-host');
  const u = typeof user === 'string' && user ? user : (process.env.USERNAME || process.env.USER || 'unknown-user');
  const base = String(seed || '') + '|' + String(h) + '|' + String(u);
  const digest = crypto.createHash('sha256').update(base).digest();
  const n = digest.readUInt32BE(0);
  return n % 100;
}

/**
 * Resolve the rollout ring ('stable' | 'beta') for this device.
 * @param {string} envChannel raw ABAYA_UPDATE_CHANNEL value (may be empty)
 * @param {object} policy normalized policy from loadUpdatePolicy()
 * @returns {'stable' | 'beta'}
 */
function getDesiredUpdateRing(envChannel, policy) {
  const p = policy && typeof policy === 'object' ? policy : DEFAULT_UPDATE_POLICY;
  const raw = String(envChannel || '').trim().toLowerCase();
  if (raw === 'beta' || raw === 'stable') return raw;
  const pct = Number(p.betaPercent);
  const fallback = String(p.defaultChannel || 'stable') === 'beta' ? 'beta' : 'stable';
  if (!Number.isFinite(pct) || pct <= 0) {
    return fallback;
  }
  const bucket = computeDeviceBucket(p.rolloutSeed || DEFAULT_UPDATE_POLICY.rolloutSeed);
  if (bucket < Math.min(100, Math.max(0, pct))) return 'beta';
  return fallback;
}

/**
 * Map the product rollout ring to the electron-updater channel.
 *
 * electron-updater resolves update metadata as `<channel>.yml`
 * (out/util.js getChannelFilename). electron-builder publishes `latest.yml`
 * for normal versions and `<prerelease>.yml` (e.g. `beta.yml`) for versions
 * like 1.2.4-beta.1 (detectUpdateChannel default). Naming a channel 'stable'
 * therefore makes every check 404 — the stable ring MUST use the conventional
 * 'latest' channel.
 *
 * @param {string} ring 'stable' | 'beta'
 * @returns {{ channel: 'latest' | 'beta', allowPrerelease: boolean }}
 */
function mapRingToUpdaterChannel(ring) {
  if (ring === 'beta') {
    return { channel: 'beta', allowPrerelease: true };
  }
  return { channel: 'latest', allowPrerelease: false };
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeMirrorBaseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    return 'http://' + s.replace(/^\/+/, '');
  }
  return s.replace(/\/+$/, '');
}

/**
 * The LAN generic feed URL encodes the ring in the path
 * (e.g. http://host:3000/updates/beta/), so the mirror directory itself
 * separates stable from beta artifacts.
 * @param {string} baseUrlNorm
 * @param {string} ring 'stable' | 'beta'
 * @returns {string}
 */
function buildLanGenericFeedUrl(baseUrlNorm, ring) {
  const base = normalizeMirrorBaseUrl(baseUrlNorm);
  const ch = ring === 'beta' ? 'beta' : 'stable';
  return new URL('/updates/' + ch + '/', base.endsWith('/') ? base : base + '/').href;
}

/**
 * Delay until the next update check: fixed interval on success, exponential
 * backoff after consecutive failures, plus symmetric jitter to avoid
 * thundering-herd check storms after restart waves.
 * @param {object} policy normalized policy
 * @param {number} failureCount consecutive check failures
 * @param {() => number} [rng] random source in [0,1), defaults to Math.random
 * @returns {number} delay in milliseconds
 */
function getNextCheckDelayMs(policy, failureCount, rng) {
  const p = policy && typeof policy === 'object' ? policy : DEFAULT_UPDATE_POLICY;
  const failures = Number.isFinite(failureCount) && failureCount > 0 ? Math.floor(failureCount) : 0;
  const baseMinutes = failures > 0
    ? Math.min(p.maxBackoffMinutes, p.retryIntervalMinutes * Math.pow(2, failures - 1))
    : p.checkIntervalMinutes;
  const baseMs = baseMinutes * 60 * 1000;
  const jitterRatio = (Number(p.jitterPercent) || 0) / 100;
  if (jitterRatio <= 0) return baseMs;
  const rand = typeof rng === 'function' ? rng : Math.random;
  const min = Math.floor(baseMs * (1 - jitterRatio));
  const max = Math.ceil(baseMs * (1 + jitterRatio));
  return Math.floor(min + rand() * Math.max(1, max - min));
}

module.exports = {
  DEFAULT_UPDATE_POLICY,
  normalizePositiveInt,
  loadUpdatePolicy,
  computeDeviceBucket,
  getDesiredUpdateRing,
  mapRingToUpdaterChannel,
  normalizeMirrorBaseUrl,
  buildLanGenericFeedUrl,
  getNextCheckDelayMs,
};
