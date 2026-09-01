'use strict';

/**
 * Self-heal a stale user-stable `.env` by reconciling a small allow-list of
 * keys against a freshly-bundled `.env.production`.
 *
 * Extracted from main.js so it can be unit-tested without booting Electron.
 * The function is pure-ish: takes two file paths and a write callback, returns
 * the migration report. No fs writes happen in the unit tests.
 *
 * Only the keys in `HEAL_KEYS` are considered. The user's CF_INGEST_SECRET,
 * GH_TOKEN, and any other operator-edited values are NEVER touched — losing
 * those silently would be a far worse outage than the stale LAN IP we're
 * fixing here.
 */

const fs = require('fs');

const HEAL_KEYS = [
  // Network binding — the local factory server must always be on PORT 3111
  // after an update, otherwise the launcher dashboard / kiosk / CEO pages
  // can't reach it. NSIS per-machine-state preservation of the user's
  // `.env` is not enough on its own — if the user's old `.env` is missing
  // PORT, the install would have no PORT and the server would bind to the
  // express default (often 3000), breaking the dashboard. Adding these to
  // HEAL_KEYS forces the migration to (a) add them if missing, (b) rewrite
  // them to the bundled values if they differ. See the 2026-09-02 incident:
  // v1.2.17 published with a working build but HEAL_KEYS didn't include
  // PORT/HOST/CF_WORKER_URL, and the factory laptop lost 3111 after the
  // auto-update path ran. Kept here so the v1.2.18+ migration never
  // re-creates the bug.
  'PORT',
  'HOST',
  'CF_WORKER_URL',
  // Update-feed URLs (LAN mirror + cloud R2) — keep these in sync with the
  // bundled `.env.production` so the launcher's auto-updater always probes
  // the right feed on first boot after an update.
  'ABAYA_UPDATE_MIRROR_BASE_URL',
  'ABAYA_CLOUD_UPDATE_BASE_URL',
  'LAN_IP',
  // NOTE: CF_INGEST_SECRET, GH_TOKEN, GITHUB_TOKEN are intentionally NOT
  // here — those are operator-edited and the migration must never silently
  // overwrite them (losing the ingest secret would be a far worse outage
  // than a stale LAN IP).
];

/** @returns {string[]} raw lines (with newlines already stripped). */
function readRawDotenvLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split(/\r?\n/).map(function (ln) { return ln; });
  } catch (_) {
    return [];
  }
}

/** @returns {Record<string, string>} */
function parseDotenvLines(lines) {
  const out = {};
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    out[k] = v;
  }
  return out;
}

/**
 * @param {string} userEnvPath  path to the existing user-stable .env
 * @param {string} prodEnvPath  path to the freshly-bundled .env.production
 * @returns {{
 *   changed: boolean,
 *   migrations: Array<{ key: string, from: string, to: string }>,
 *   nextContent: string
 * }}
 */
function planEnvMigration(userEnvPath, prodEnvPath) {
  const curRaw = readRawDotenvLines(userEnvPath);
  const prodRaw = readRawDotenvLines(prodEnvPath);
  const curMap = parseDotenvLines(curRaw);
  const prodMap = parseDotenvLines(prodRaw);
  const migrations = [];
  const nextLines = curRaw.slice();
  for (const key of HEAL_KEYS) {
    const cur = String(curMap[key] || '').trim();
    const prod = String(prodMap[key] || '').trim();
    if (!prod) continue; // bundled .env.production didn't set this key
    if (cur === prod) continue; // already in sync
    let rewritten = false;
    for (let i = 0; i < nextLines.length; i++) {
      const line = nextLines[i];
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && m[1] === key) {
        nextLines[i] = key + '=' + prod;
        rewritten = true;
        break;
      }
    }
    if (!rewritten) {
      nextLines.push(key + '=' + prod);
    }
    migrations.push({ key: key, from: cur || '(unset)', to: prod });
  }
  return {
    changed: migrations.length > 0,
    migrations: migrations,
    nextContent: nextLines.join('\n') + (nextLines.length ? '\n' : ''),
  };
}

module.exports = { HEAL_KEYS, readRawDotenvLines, parseDotenvLines, planEnvMigration };
