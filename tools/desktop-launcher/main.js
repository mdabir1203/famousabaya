'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, powerMonitor, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync, execFileSync } = require('child_process');

/** Resolve the runtime root for both source runs and packaged installs. */
function resolveRepoRoot() {
  // All-in-one packaged build: the factory server is bundled into resources/ via
  // extraResources (server.js, public, shared, install, package.json, node_modules).
  // Prefer resources/ so the installed exe runs the whole system with no repo.
  if (app && app.isPackaged) {
    const res = process.resourcesPath;
    if (res && fs.existsSync(path.join(res, 'server.js'))) return res;
  }
  const candidates = [
    process.env.ABAYA_REPO_ROOT,
    process.env.ABAYA_APP_ROOT,
    __dirname,
    app && typeof app.getAppPath === 'function' ? app.getAppPath() : '',
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..'),
    process.cwd(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'server.js')) && fs.existsSync(path.join(resolved, 'install')) && fs.existsSync(path.join(resolved, 'package.json'))) {
      return resolved;
    }
  }
  return path.resolve(__dirname, '..', '..');
}

const REPO_ROOT = resolveRepoRoot();

// Stable, update-safe, transferable data root. In the packaged all-in-one this is
// %APPDATA%\AbaYa Track (outside the install dir), so reinstalls/updates never wipe
// it and the whole folder — factory data + .env (cloud credentials) — copies to a
// new laptop, which then re-syncs the latest from the cloud automatically.
// In dev it stays inside the repo so nothing pollutes the user profile.
const STABLE_DATA_ROOT = (app && app.isPackaged)
  ? path.join(app.getPath('appData'), 'AbaYa Track')
  : path.join(REPO_ROOT, 'data');
const FACTORY_DATA_DIR = (app && app.isPackaged)
  ? path.join(STABLE_DATA_ROOT, 'factory-data')
  : path.join(REPO_ROOT, 'data');
const FACTORY_ENV_FILE = (app && app.isPackaged)
  ? path.join(STABLE_DATA_ROOT, '.env')
  : path.join(REPO_ROOT, '.env');

const LAUNCHER_DATA_DIR = (app && app.isPackaged)
  ? path.join(STABLE_DATA_ROOT, 'launcher')
  : path.join(REPO_ROOT, 'data', 'desktop-launcher');
const LAUNCHER_CACHE_DIR = path.join(LAUNCHER_DATA_DIR, 'cache');
const LAUNCHER_GPU_CACHE_DIR = path.join(LAUNCHER_DATA_DIR, 'gpu-cache');
const UPDATE_POLICY_PATH = path.join(REPO_ROOT, 'config', 'update-policy.json');
const RELEASE_MOMENT_PATH = path.join(REPO_ROOT, 'config', 'release-moment.json');
const UPDATE_AUDIT_LOG_PATH = path.join(LAUNCHER_DATA_DIR, 'update-events.jsonl');
const UPDATE_META_PATH = path.join(LAUNCHER_DATA_DIR, 'pending-update.json');
const LAUNCHER_PKG_PATH = path.join(__dirname, 'package.json');
const APP_MODE_PATH = path.join(REPO_ROOT, 'config', 'app-mode.json');
const DEFAULT_APP_MODE = 'production';
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

function ensureLauncherRuntimeDirs() {
  try {
    fs.mkdirSync(LAUNCHER_DATA_DIR, { recursive: true });
    fs.mkdirSync(LAUNCHER_CACHE_DIR, { recursive: true });
    fs.mkdirSync(LAUNCHER_GPU_CACHE_DIR, { recursive: true });
    fs.mkdirSync(FACTORY_DATA_DIR, { recursive: true });
    // First run of the packaged app: seed the stable .env from the bundled example
    // so the factory server has a config file to edit (and cloud creds persist).
    if (app && app.isPackaged && !fs.existsSync(FACTORY_ENV_FILE)) {
      const example = path.join(REPO_ROOT, '.env.example');
      if (fs.existsSync(example)) fs.copyFileSync(example, FACTORY_ENV_FILE);
    }
  } catch (_) {}
}

ensureLauncherRuntimeDirs();
// Keep Chromium cache writable and local to repo runtime data.
app.setPath('userData', LAUNCHER_DATA_DIR);
app.setPath('sessionData', LAUNCHER_DATA_DIR);
app.setPath('cache', LAUNCHER_CACHE_DIR);
app.commandLine.appendSwitch('disk-cache-dir', LAUNCHER_CACHE_DIR);
app.commandLine.appendSwitch('gpu-disk-cache-dir', LAUNCHER_GPU_CACHE_DIR);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// The launcher is a static 2D control panel — GPU compositing buys nothing here.
// Disabling hardware acceleration removes the whole GPU helper process (~50–100 MB
// RAM) with no visible impact on this UI. Must be called before app is ready.
app.disableHardwareAcceleration();

/**
 * Read .env values into a plain map (same convention as LAUNCH-ALL.bat).
 * @returns {Record<string, string>}
 */
function readDotenvMap(repoRoot) {
  const out = {};
  const envPath = path.join(repoRoot, '.env');
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx < 1) return;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      out[k] = v;
    });
  } catch (_) {}
  return out;
}

/**
 * Parse PORT from .env at repo root (same convention as LAUNCH-ALL.bat).
 * @returns {number}
 */
function readPortFromDotenv(repoRoot) {
  const env = readDotenvMap(repoRoot);
  const n = parseInt(env.PORT || env.port || '', 10);
  if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  return 3000;
}

function readIngestSecretFromDotenv(repoRoot) {
  const env = readDotenvMap(repoRoot);
  return String(env.CF_INGEST_SECRET || env.cf_ingest_secret || '').trim();
}

/** Same payload shape as factory `GET /api/release-moment` (without `_comment`). */
function readReleaseMomentForLauncher() {
  try {
    const raw = fs.readFileSync(RELEASE_MOMENT_PATH, 'utf8');
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { enabled: false };
    const out = Object.assign({}, o);
    delete out._comment;
    return out;
  } catch (_) {
    return { enabled: false };
  }
}

let mainWindow = null;
let serverProc = null;
let watcherProc = null;
let dispatchProc = null;
let allowWindowClose = false;
/** After one LAN feed error, fall back to GitHub once per process (electron-updater). */
let githubFallbackAfterLanError = false;
const FACTORY_PORT = readPortFromDotenv(REPO_ROOT);
let updateCheckTimer = null;
let updatePolicy = Object.assign({}, DEFAULT_UPDATE_POLICY);
/**
 * App mode — 'production' (default) or 'development'. Production sets NODE_ENV
 * on all spawned servers and enables the auto-updater; development disables
 * updates and marks child processes as dev. Toggled from the GUI, persisted.
 */
let appMode = DEFAULT_APP_MODE;
function loadAppMode() {
  const o = readJsonFileSafe(APP_MODE_PATH);
  const m = o && String(o.mode || '').toLowerCase();
  return m === 'development' ? 'development' : 'production';
}
function saveAppMode(mode) {
  const m = String(mode || '').toLowerCase() === 'development' ? 'development' : 'production';
  try {
    fs.mkdirSync(path.dirname(APP_MODE_PATH), { recursive: true });
    fs.writeFileSync(APP_MODE_PATH, JSON.stringify({ mode: m }, null, 2));
  } catch (_) {}
  appMode = m;
  return m;
}
function isProductionMode() {
  return appMode === 'production';
}
function hasDevUpdateConfig() {
  try {
    return fs.existsSync(path.join(__dirname, 'dev-app-update.yml'));
  } catch (_) {
    return false;
  }
}
appMode = loadAppMode();
let updateFailureCount = 0;
/** @type {{ from: string } | null} */
let pendingUpdateApplyResult = null;
let updateState = {
  enabled: false,
  phase: 'idle',
  channel: 'stable',
  version: app.getVersion(),
  availableVersion: '',
  downloaded: false,
  progress: 0,
  message: 'Updates not initialized',
  checkedAt: 0,
  error: '',
  lastCheckedAt: 0,
  nextCheckAt: 0,
  retryInMs: 0,
  lastErrorAt: 0,
  lastErrorMessage: '',
  releaseNotesUrl: '',
  updateJustApplied: false,
  updateAppliedFromVersion: '',
  updateFeedSource: '',
  updateMirrorBaseUrl: '',
  updateMirrorFeedUrl: '',
  updateMirrorProbeOk: false,
  updateMirrorProbeMessage: '',
};

function emitUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', getPublicUpdateState());
  }
}

function setUpdateState(patch) {
  updateState = Object.assign({}, updateState, patch || {});
  emitUpdateState();
}

function getDesiredUpdateChannel() {
  const raw = String(process.env.ABAYA_UPDATE_CHANNEL || '').trim().toLowerCase();
  if (raw === 'beta' || raw === 'stable') return raw;
  const pct = Number(updatePolicy.betaPercent);
  if (!Number.isFinite(pct) || pct <= 0) {
    return String(updatePolicy.defaultChannel || 'stable') === 'beta' ? 'beta' : 'stable';
  }
  const bucket = computeDeviceBucket(updatePolicy.rolloutSeed || DEFAULT_UPDATE_POLICY.rolloutSeed);
  if (bucket < Math.min(100, Math.max(0, pct))) return 'beta';
  return String(updatePolicy.defaultChannel || 'stable') === 'beta' ? 'beta' : 'stable';
}

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizePositiveInt(v, fallback, min, max) {
  const n = parseInt(String(v || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  const lo = Number.isFinite(min) ? min : n;
  const hi = Number.isFinite(max) ? max : n;
  return Math.max(lo, Math.min(hi, n));
}

function loadUpdatePolicy() {
  const fromFile = readJsonFileSafe(UPDATE_POLICY_PATH) || {};
  const merged = Object.assign({}, DEFAULT_UPDATE_POLICY, fromFile);
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

function computeDeviceBucket(seed) {
  const host = os.hostname() || process.env.COMPUTERNAME || 'unknown-host';
  const user = process.env.USERNAME || process.env.USER || 'unknown-user';
  const base = String(seed || '') + '|' + String(host) + '|' + String(user);
  const digest = crypto.createHash('sha256').update(base).digest();
  const n = digest.readUInt32BE(0);
  return n % 100;
}

/** @returns {any | null} */
function readLauncherPublishEntry() {
  try {
    const pkg = readJsonFileSafe(LAUNCHER_PKG_PATH);
    const pub = pkg && pkg.build && Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : null;
    if (!pub || pub.provider !== 'github' || !pub.owner || !pub.repo) return null;
    return pub;
  } catch (_) {
    return null;
  }
}

/** @returns {{ owner: string, repo: string } | null} */
function readLauncherPublishGithub() {
  const pub = readLauncherPublishEntry();
  if (!pub) return null;
  return { owner: String(pub.owner), repo: String(pub.repo) };
}

/**
 * @param {string} version
 * @returns {string}
 */
function buildGithubReleaseUrl(version) {
  const pub = readLauncherPublishGithub();
  if (!pub) return '';
  const ver = String(version || '').trim();
  if (!ver) return '';
  const tag = ver.startsWith('v') ? ver : 'v' + ver;
  return 'https://github.com/' + pub.owner + '/' + pub.repo + '/releases/tag/' + encodeURIComponent(tag);
}

/**
 * @param {any} info
 * @returns {string}
 */
function deriveReleaseNotesUrl(info) {
  if (!info) return '';
  try {
    if (typeof info.releaseNotes === 'string' && /^https?:\/\//i.test(info.releaseNotes)) {
      return info.releaseNotes.trim();
    }
  } catch (_) {}
  return buildGithubReleaseUrl(String((info && info.version) || ''));
}

function applyGithubUpdaterFeedFromPackage() {
  const pub = readLauncherPublishEntry();
  if (!pub) return false;
  try {
    const opts = {
      provider: 'github',
      owner: String(pub.owner),
      repo: String(pub.repo),
    };
    if (typeof pub.releaseType === 'string') opts.releaseType = pub.releaseType;
    if (typeof pub.token === 'string' && pub.token) opts.token = pub.token;
    autoUpdater.setFeedURL(opts);
    return true;
  } catch (e) {
    appendUpdateAudit('github-feed-error', {
      error: String(e && e.message ? e.message : e),
    });
    return false;
  }
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
 * Mirror base is factory origin only, e.g. `http://192.168.1.10:3000` (no `/updates` suffix required).
 * @returns {string}
 */
function resolveUpdateMirrorBaseUrl() {
  const fromEnv = String(process.env.ABAYA_UPDATE_MIRROR_BASE_URL || '').trim();
  if (fromEnv) return fromEnv;
  const map = readDotenvMap(REPO_ROOT);
  return String(map.ABAYA_UPDATE_MIRROR_BASE_URL || '').trim();
}

/**
 * @param {string} baseUrlNorm
 * @param {string} channel
 * @returns {string}
 */
function buildLanGenericFeedUrl(baseUrlNorm, channel) {
  const base = normalizeMirrorBaseUrl(baseUrlNorm);
  const ch = channel === 'beta' ? 'beta' : 'stable';
  return new URL('/updates/' + ch + '/', base.endsWith('/') ? base : base + '/').href;
}

/**
 * @param {string} baseUrlNorm
 * @param {string} channel
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, error: string, url?: string }>}
 */
function probeLanMirrorLatestYml(baseUrlNorm, channel, timeoutMs) {
  const base = normalizeMirrorBaseUrl(baseUrlNorm);
  if (!base) return Promise.resolve({ ok: false, error: 'empty-base' });
  const ch = channel === 'beta' ? 'beta' : 'stable';
  let fullUrl;
  try {
    fullUrl = new URL('/updates/' + ch + '/latest.yml', base.endsWith('/') ? base : base + '/').href;
  } catch (_) {
    return Promise.resolve({ ok: false, error: 'bad-url' });
  }
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 3500;
  return new Promise(function (resolve) {
    let settled = false;
    const done = function (ok, err) {
      if (settled) return;
      settled = true;
      resolve({ ok: !!ok, error: String(err || ''), url: fullUrl });
    };
    try {
      const u = new URL(fullUrl);
      const isHttps = u.protocol === 'https:';
      const mod = isHttps ? https : http;
      const port = u.port ? Number(u.port) : (isHttps ? 443 : 80);
      const req = mod.request(
        {
          hostname: u.hostname,
          port: port,
          path: u.pathname + (u.search || ''),
          method: 'GET',
          headers: { Accept: 'text/yaml, application/yaml, */*' },
        },
        function (res) {
          let size = 0;
          res.on('data', function (c) {
            size += c.length;
            if (size > 65536) {
              try {
                req.destroy();
              } catch (_) {}
            }
          });
          res.on('end', function () {
            const ok = res.statusCode >= 200 && res.statusCode < 300 && size > 0;
            done(ok, ok ? '' : 'http-' + String(res.statusCode || 0));
          });
        }
      );
      req.setTimeout(timeout, function () {
        try {
          req.destroy(new Error('timeout'));
        } catch (_) {}
      });
      req.on('error', function (e) {
        done(false, e && e.message ? e.message : 'request-error');
      });
      req.end();
    } catch (e2) {
      done(false, e2 && e2.message ? e2.message : 'probe-exception');
    }
  });
}

function pruneOldAuditArchives(keep) {
  const k = Math.max(1, Number(keep) || 5);
  try {
    const names = fs.readdirSync(LAUNCHER_DATA_DIR);
    const files = names
      .filter(function (f) {
        return /^update-events\..+\.jsonl$/.test(f);
      })
      .map(function (f) {
        const full = path.join(LAUNCHER_DATA_DIR, f);
        let t = 0;
        try {
          t = fs.statSync(full).mtimeMs;
        } catch (_) {}
        return { full: full, t: t };
      })
      .sort(function (a, b) {
        return b.t - a.t;
      });
    for (let i = k; i < files.length; i++) {
      try {
        fs.unlinkSync(files[i].full);
      } catch (_) {}
    }
  } catch (_) {}
}

function rotateUpdateAuditLogIfNeeded() {
  const maxBytes =
    Number(updatePolicy.auditLogMaxBytes) > 0
      ? Number(updatePolicy.auditLogMaxBytes)
      : DEFAULT_UPDATE_POLICY.auditLogMaxBytes;
  const maxArch =
    Number(updatePolicy.auditLogMaxArchives) > 0
      ? Number(updatePolicy.auditLogMaxArchives)
      : DEFAULT_UPDATE_POLICY.auditLogMaxArchives;
  try {
    if (!fs.existsSync(UPDATE_AUDIT_LOG_PATH)) return;
    const st = fs.statSync(UPDATE_AUDIT_LOG_PATH);
    if (!st.isFile() || st.size < maxBytes) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotated = path.join(LAUNCHER_DATA_DIR, 'update-events.' + stamp + '.jsonl');
    fs.renameSync(UPDATE_AUDIT_LOG_PATH, rotated);
    pruneOldAuditArchives(maxArch);
  } catch (_) {}
}

function writePendingUpdateMeta(previousVersion, expectedVersion) {
  try {
    const exp = String(expectedVersion || '').trim();
    if (!exp) return;
    const payload = {
      previousVersion: String(previousVersion || ''),
      expectedVersion: exp,
      writtenAt: new Date().toISOString(),
    };
    fs.mkdirSync(LAUNCHER_DATA_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_META_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * After a successful install+restart, current app version matches expected in meta.
 * @returns {{ from: string } | null}
 */
function readAndConsumePendingUpdateSuccess() {
  try {
    if (!fs.existsSync(UPDATE_META_PATH)) return null;
    const raw = readJsonFileSafe(UPDATE_META_PATH);
    if (!raw) {
      try {
        fs.unlinkSync(UPDATE_META_PATH);
      } catch (_) {}
      return null;
    }
    const cur = app.getVersion();
    const prev = String(raw.previousVersion || '');
    const exp = String(raw.expectedVersion || '');
    if (exp && cur === exp) {
      try {
        fs.unlinkSync(UPDATE_META_PATH);
      } catch (_) {}
      return { from: prev || 'unknown' };
    }
    if (exp && prev && cur === prev) {
      return null;
    }
    try {
      fs.unlinkSync(UPDATE_META_PATH);
    } catch (_) {}
    return null;
  } catch (_) {
    return null;
  }
}

function getPublicUpdateState() {
  const now = Date.now();
  const next = Number(updateState.nextCheckAt) || 0;
  const retryInMs = next > now ? next - now : 0;
  return Object.assign({}, updateState, {
    version: app.getVersion(),
    retryInMs: retryInMs,
  });
}

function appendUpdateAudit(eventName, extra) {
  try {
    rotateUpdateAuditLogIfNeeded();
    const row = Object.assign(
      {
        at: new Date().toISOString(),
        event: String(eventName || 'unknown'),
        appVersion: app.getVersion(),
        channel: updateState.channel || 'stable',
        phase: updateState.phase || 'idle',
      },
      extra || {}
    );
    fs.appendFileSync(UPDATE_AUDIT_LOG_PATH, JSON.stringify(row) + '\n');
  } catch (_) {}
}

function readAuditLogTail(maxLines) {
  const max = Math.min(500, Math.max(1, Number(maxLines) || 300));
  try {
    if (!fs.existsSync(UPDATE_AUDIT_LOG_PATH)) return [];
    const raw = fs.readFileSync(UPDATE_AUDIT_LOG_PATH, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const slice = lines.slice(-max);
    return slice.map(function (ln) {
      try {
        return JSON.parse(ln);
      } catch (_) {
        return { raw: ln };
      }
    });
  } catch (_) {
    return [];
  }
}

function buildDiagnosticsPayload() {
  const listening = listPidsListeningOnPort(FACTORY_PORT);
  const pm2 = pm2Snapshot();
  const pm2Server = pm2.apps ? pm2.apps.find((a) => a.name === 'abaya-server') : null;
  const pm2Watcher = pm2.apps ? pm2.apps.find((a) => a.name === 'catalog-watcher') : null;
  const pm2Tunnel = pm2.apps ? pm2.apps.find((a) => a.name === 'cloudflared-tunnel') : null;
  return {
    exportedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    },
    update: getPublicUpdateState(),
    updatePolicy: updatePolicy,
    publisher: readLauncherPublishGithub(),
    listenPort: FACTORY_PORT,
    portBusy: listening.length > 0,
    portPids: listening,
    pm2: pm2,
    pm2Summary: {
      server: pm2Server || null,
      watcher: pm2Watcher || null,
      tunnel: pm2Tunnel || null,
    },
    auditLogTail: readAuditLogTail(300),
  };
}

function getNextCheckDelayMs() {
  const baseMinutes = updateFailureCount > 0
    ? Math.min(updatePolicy.maxBackoffMinutes, updatePolicy.retryIntervalMinutes * Math.pow(2, updateFailureCount - 1))
    : updatePolicy.checkIntervalMinutes;
  const baseMs = baseMinutes * 60 * 1000;
  const jitterRatio = (Number(updatePolicy.jitterPercent) || 0) / 100;
  if (jitterRatio <= 0) return baseMs;
  const min = Math.floor(baseMs * (1 - jitterRatio));
  const max = Math.ceil(baseMs * (1 + jitterRatio));
  return Math.floor(min + Math.random() * Math.max(1, max - min));
}

function scheduleNextUpdateCheck(reason) {
  if (!updateState.enabled) return;
  if (updateCheckTimer) {
    clearTimeout(updateCheckTimer);
    updateCheckTimer = null;
  }
  const delayMs = getNextCheckDelayMs();
  setUpdateState({
    nextCheckAt: Date.now() + delayMs,
  });
  appendUpdateAudit('check-scheduled', {
    reason: String(reason || 'periodic'),
    delayMs,
    failureCount: updateFailureCount,
  });
  updateCheckTimer = setTimeout(async function () {
    await checkForUpdatesSafe('scheduled');
    scheduleNextUpdateCheck('scheduled-loop');
  }, delayMs);
}

async function checkForUpdatesSafe(reason) {
  if (!updateState.enabled) return;
  try {
    await autoUpdater.checkForUpdates();
    updateFailureCount = 0;
    appendUpdateAudit('check-ok', { reason: String(reason || 'unknown') });
  } catch (err) {
    updateFailureCount += 1;
    const msg = String(err && err.message ? err.message : err);
    setUpdateState({
      phase: 'error',
      error: msg,
      message: 'Update check failed',
      checkedAt: Date.now(),
      lastErrorAt: Date.now(),
      lastErrorMessage: msg,
    });
    appendUpdateAudit('check-failed', {
      reason: String(reason || 'unknown'),
      error: msg,
      failureCount: updateFailureCount,
    });
  }
}

function setupAutoUpdates() {
  updatePolicy = loadUpdatePolicy();
  const channel = getDesiredUpdateChannel();
  const isPackaged = app.isPackaged;
  // Updates run only in production. From source (unpackaged) they additionally
  // require a dev-app-update.yml, per electron-updater.
  const updatesDisabled = appMode === 'development' || (!isPackaged && !hasDevUpdateConfig());
  if (updatesDisabled) {
    const patch = {
      enabled: false,
      channel: channel,
      phase: 'disabled',
      message:
        appMode === 'development'
          ? 'Development mode — updates disabled'
          : 'Production (from source) — add dev-app-update.yml or use the packaged .exe to enable updates',
      updateFeedSource: 'n/a',
      updateMirrorBaseUrl: '',
      updateMirrorFeedUrl: '',
      updateMirrorProbeOk: false,
      updateMirrorProbeMessage: '',
    };
    if (pendingUpdateApplyResult) {
      const from = pendingUpdateApplyResult.from;
      pendingUpdateApplyResult = null;
      patch.updateJustApplied = true;
      patch.updateAppliedFromVersion = from;
      patch.message = 'Update applied successfully. Version ' + app.getVersion() + '.';
    }
    setUpdateState(patch);
    return;
  }

  // Production from source: let electron-updater read dev-app-update.yml.
  if (!isPackaged) {
    try {
      autoUpdater.forceDevUpdateConfig = true;
    } catch (_) {}
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.allowDowngrade = false;
  if (typeof autoUpdater.channel === 'string') {
    autoUpdater.channel = channel;
  }
  setUpdateState({ channel: channel });

  autoUpdater.on('checking-for-update', function () {
    setUpdateState({
      phase: 'checking',
      message: 'Checking for updates...',
      checkedAt: Date.now(),
      error: '',
    });
    appendUpdateAudit('checking-for-update');
  });

  autoUpdater.on('update-available', function (info) {
    const notesUrl = deriveReleaseNotesUrl(info) || buildGithubReleaseUrl(String((info && info.version) || ''));
    setUpdateState({
      phase: 'downloading',
      availableVersion: String((info && info.version) || ''),
      downloaded: false,
      progress: 0,
      message: 'Update available, downloading in background',
      checkedAt: Date.now(),
      lastCheckedAt: Date.now(),
      error: '',
      lastErrorMessage: '',
      releaseNotesUrl: notesUrl,
    });
    appendUpdateAudit('update-available', {
      version: String((info && info.version) || ''),
    });
  });

  autoUpdater.on('update-not-available', function () {
    setUpdateState({
      phase: 'idle',
      availableVersion: '',
      downloaded: false,
      progress: 0,
      message: 'App is up to date',
      checkedAt: Date.now(),
      lastCheckedAt: Date.now(),
      error: '',
      lastErrorMessage: '',
    });
    appendUpdateAudit('update-not-available');
  });

  autoUpdater.on('download-progress', function (progressObj) {
    const progress = Number(progressObj && progressObj.percent);
    setUpdateState({
      phase: 'downloading',
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
      message: 'Downloading update...',
      error: '',
    });
    appendUpdateAudit('download-progress', {
      percent: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
    });
  });

  autoUpdater.on('update-downloaded', function (info) {
    const newVer = String((info && info.version) || updateState.availableVersion || '');
    writePendingUpdateMeta(app.getVersion(), newVer);
    const notesUrl = deriveReleaseNotesUrl(info) || buildGithubReleaseUrl(newVer);
    setUpdateState({
      phase: 'downloaded',
      downloaded: true,
      progress: 100,
      availableVersion: newVer,
      message: 'Update downloaded. Restart app to apply.',
      error: '',
      lastCheckedAt: Date.now(),
      releaseNotesUrl: notesUrl,
    });
    appendUpdateAudit('update-downloaded', {
      version: newVer,
    });
  });

  autoUpdater.on('error', function (err) {
    const msg = String(err && err.message ? err.message : err);
    if (updateState.updateFeedSource === 'lan' && !githubFallbackAfterLanError) {
      githubFallbackAfterLanError = true;
      if (applyGithubUpdaterFeedFromPackage()) {
        setUpdateState({
          phase: 'ready',
          error: '',
          lastErrorMessage: '',
          updateFeedSource: 'github',
          updateMirrorFeedUrl: '',
          updateMirrorProbeOk: false,
          updateMirrorProbeMessage: 'fallback-after-lan-error',
          message: 'LAN update mirror failed; retrying via cloud update source.',
        });
        appendUpdateAudit('updater-fallback-github-after-lan-error', {
          error: msg,
        });
        setTimeout(function () {
          checkForUpdatesSafe('after-lan-fallback');
        }, 400);
        return;
      }
    }
    setUpdateState({
      phase: 'error',
      error: msg,
      message: 'Updater encountered an error',
      checkedAt: Date.now(),
      lastErrorAt: Date.now(),
      lastErrorMessage: msg,
    });
    appendUpdateAudit('updater-error', {
      error: msg,
    });
  });

  autoUpdater.on('before-quit-for-update', function () {
    writePendingUpdateMeta(app.getVersion(), updateState.availableVersion);
    appendUpdateAudit('before-quit-for-update', {
      expectedVersion: String(updateState.availableVersion || ''),
    });
  });

  void (async function configureFeedAndStart() {
    const mirrorBaseRaw = resolveUpdateMirrorBaseUrl();
    const mirrorBaseNorm = normalizeMirrorBaseUrl(mirrorBaseRaw);
    let source = 'github';
    let mirrorFeedUrl = '';
    let probeOk = false;
    let probeMsg = mirrorBaseNorm ? 'pending' : 'no-mirror-config';

    if (mirrorBaseNorm) {
      const probe = await probeLanMirrorLatestYml(mirrorBaseNorm, channel, 3500);
      probeOk = probe.ok;
      probeMsg = probe.ok ? 'ok' : String(probe.error || 'probe-failed');
      if (probe.ok) {
        mirrorFeedUrl = buildLanGenericFeedUrl(mirrorBaseNorm, channel);
        try {
          autoUpdater.setFeedURL({ provider: 'generic', url: mirrorFeedUrl });
          source = 'lan';
        } catch (e) {
          probeMsg = 'setFeedURL-failed: ' + String(e && e.message ? e.message : e);
          source = 'github';
          mirrorFeedUrl = '';
        }
      }
    }

    if (source !== 'lan') {
      applyGithubUpdaterFeedFromPackage();
      source = 'github';
      if (mirrorBaseNorm && !probeOk) {
        probeMsg = 'lan-unavailable: ' + probeMsg;
      }
    }

    setUpdateState({
      enabled: true,
      channel: channel,
      phase: 'ready',
      message: source === 'lan' ? 'Update service ready (LAN mirror)' : 'Update service ready (cloud)',
      error: '',
      updateFeedSource: source,
      updateMirrorBaseUrl: mirrorBaseRaw || '',
      updateMirrorFeedUrl: mirrorFeedUrl,
      updateMirrorProbeOk: probeOk,
      updateMirrorProbeMessage: probeMsg,
    });
    appendUpdateAudit('updater-ready', {
      policyPath: UPDATE_POLICY_PATH,
      defaultChannel: updatePolicy.defaultChannel,
      betaPercent: updatePolicy.betaPercent,
      checkIntervalMinutes: updatePolicy.checkIntervalMinutes,
      updateFeedSource: source,
      updateMirrorBaseUrl: mirrorBaseRaw || '',
      updateMirrorFeedUrl: mirrorFeedUrl,
      updateMirrorProbeOk: probeOk,
      updateMirrorProbeMessage: probeMsg,
    });

    if (pendingUpdateApplyResult) {
      const from = pendingUpdateApplyResult.from;
      pendingUpdateApplyResult = null;
      setUpdateState({
        updateJustApplied: true,
        updateAppliedFromVersion: from,
        message: 'Update applied successfully. Current version: ' + app.getVersion() + '.',
      });
      appendUpdateAudit('update-applied-success', { fromVersion: from });
    }

    checkForUpdatesSafe('startup');
    scheduleNextUpdateCheck('startup');
    if (powerMonitor && typeof powerMonitor.on === 'function') {
      powerMonitor.on('resume', function () {
        checkForUpdatesSafe('system-resume');
        scheduleNextUpdateCheck('system-resume');
      });
    }
  })();
}

function sendLog(which, text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('proc-log', { which, text });
  }
}

function pidAlive(proc) {
  return !!(proc && proc.pid && !proc.killed);
}

function listPidsListeningOnPort(port) {
  if (process.platform !== 'win32') return [];
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const lines = String(out || '').split(/\r?\n/);
    const want = ':' + String(port);
    const pids = new Set();
    lines.forEach(function (ln) {
      const line = ln.trim();
      if (!line) return;
      if (line.indexOf('LISTENING') < 0) return;
      const cols = line.split(/\s+/);
      if (cols.length < 5) return;
      const local = cols[1] || '';
      if (!local.endsWith(want)) return;
      const pid = parseInt(cols[4], 10);
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    });
    return Array.from(pids);
  } catch (_) {
    return [];
  }
}

function killPidTreeSync(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    execSync('taskkill /PID ' + String(pid) + ' /T /F', { stdio: 'ignore' });
  } catch (_) {}
}

function ensurePortFreedSync(port, keepPids) {
  if (process.platform !== 'win32') return;
  const keep = new Set((keepPids || []).filter(Number.isFinite));
  const found = listPidsListeningOnPort(port);
  found.forEach(function (pid) {
    if (keep.has(pid)) return;
    killPidTreeSync(pid);
  });
}

/**
 * @param {import('child_process').ChildProcess} proc
 * @param {'server'|'watcher'} which
 */
function pipeChild(proc, which) {
  proc.stdout.on('data', function (buf) {
    sendLog(which, buf.toString());
  });
  proc.stderr.on('data', function (buf) {
    sendLog(which, buf.toString());
  });
  proc.on('close', function (code) {
    sendLog(which, '\n--- process exited (' + String(code) + ') ---\n');
    if (which === 'server') serverProc = null;
    if (which === 'watcher') watcherProc = null;
    if (which === 'dispatch') dispatchProc = null;
  });
  proc.on('error', function (err) {
    sendLog(which, '\n[spawn error] ' + String(err.message) + '\n');
  });
}

function ensureServerJs() {
  return fs.existsSync(path.join(REPO_ROOT, 'server.js'));
}

function ensureRuntimeSeedFiles() {
  const envPath = path.join(REPO_ROOT, '.env');
  const envExamplePath = path.join(REPO_ROOT, '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    try {
      fs.copyFileSync(envExamplePath, envPath);
      sendLog('server', '[launcher] Created .env from .env.example for first-run setup.\n');
    } catch (_) {}
  }

  const watcherConfigPath = path.join(REPO_ROOT, 'tools', 'catalog-watcher', 'config.json');
  const watcherExamplePath = path.join(REPO_ROOT, 'tools', 'catalog-watcher', 'config.example.json');
  if (!fs.existsSync(watcherConfigPath) && fs.existsSync(watcherExamplePath)) {
    try {
      fs.copyFileSync(watcherExamplePath, watcherConfigPath);
      sendLog('watcher', '[launcher] Created tools/catalog-watcher/config.json from the example template.\n');
    } catch (_) {}
  }
}

function watcherCanStart() {
  const cw = path.join(REPO_ROOT, 'tools', 'catalog-watcher');
  const cfg = path.join(cw, 'config.json');
  const hasPnp = fs.existsSync(path.join(cw, '.pnp.cjs'));
  const hasNm = fs.existsSync(path.join(cw, 'node_modules'));
  return fs.existsSync(cfg) && fs.existsSync(path.join(cw, 'watch-catalog.js')) && (hasPnp || hasNm);
}

function useBun() {
  return String(process.env.ABAYA_RUNTIME || '').toLowerCase() === 'bun';
}

function buildChildEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  // Prevent mixed-host Yarn cache/path leaks (WSL -> Windows) from breaking PnP resolution.
  delete env.YARN_CACHE_FOLDER;
  delete env.YARN_GLOBAL_FOLDER;
  delete env.npm_config_cache;
  delete env.NPM_CONFIG_CACHE;
  // App mode drives the runtime posture of every spawned server.
  env.NODE_ENV = isProductionMode() ? 'production' : 'development';
  env.ABAYA_MODE = appMode;
  // Point the factory server at the stable, update-safe data root + .env so its
  // snapshots, roster files, and cloud credentials live outside the install dir.
  env.ABAYA_DATA_DIR = FACTORY_DATA_DIR;
  env.ABAYA_ENV_FILE = FACTORY_ENV_FILE;
  return env;
}

/** Resolve `pm2` binary on PATH; returns null when not installed. */
/**
 * PM2 is driven through the project wrapper install/run-pm2.cjs — NEVER a global
 * `pm2`. A global pm2 cannot run this Yarn-PnP repo, and on Windows
 * `execFileSync('pm2.cmd', …)` throws EINVAL (Node refuses to execFile a .cmd).
 * The wrapper runs the bundled PM2 with the PnP loader and an isolated PM2_HOME.
 * Returns the wrapper path only when it and an installed dep graph both exist.
 */
function resolvePm2Wrapper() {
  const wrapper = path.join(REPO_ROOT, 'install', 'run-pm2.cjs');
  try {
    if (fs.existsSync(wrapper) && factoryDepsInstalled()) return wrapper;
  } catch (_) { /* ignore */ }
  return null;
}

/** Spawn the wrapper via Electron-as-node so no external `node` is required. */
function execPm2Wrapper(args, opts) {
  const wrapper = resolvePm2Wrapper();
  if (!wrapper) return { ok: false, error: 'pm2 wrapper unavailable (install/run-pm2.cjs or deps missing)' };
  try {
    const out = execFileSync(process.execPath, [wrapper, ...args], Object.assign({
      cwd: REPO_ROOT,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PM2_RUNNER_PIPE: '1' }),
    }, opts || {}));
    return { ok: true, output: String(out || '').trim() };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/** Run `pm2 jlist` through the wrapper and parse it. null when pm2 is unavailable. */
function pm2ListSync() {
  if (!resolvePm2Wrapper()) return null;
  const r = execPm2Wrapper(['jlist'], { timeout: 8000 });
  if (!r.ok) return null;
  try {
    // The wrapper may print a PnP experimental-loader notice before the JSON.
    const s = r.output;
    const start = s.indexOf('[');
    const parsed = JSON.parse(start >= 0 ? s.slice(start) : s || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return null;
  }
}

/** Returns `pm2`-managed status for the apps the ecosystem registers. */
function pm2Snapshot() {
  const list = pm2ListSync();
  if (list == null) return { available: false, apps: [] };
  const want = new Set(['abaya-server', 'cloudflared-tunnel', 'catalog-watcher']);
  const apps = list
    .filter((p) => p && want.has(p.name))
    .map((p) => ({
      name: p.name,
      status: p.pm2_env ? p.pm2_env.status : 'unknown',
      pid: p.pid || 0,
      restarts: p.pm2_env ? Number(p.pm2_env.restart_time || 0) : 0,
      uptimeMs: p.pm2_env && p.pm2_env.pm_uptime ? Date.now() - Number(p.pm2_env.pm_uptime) : null,
      cpu: p.monit ? Number(p.monit.cpu) : null,
      memMb: p.monit ? Math.round(Number(p.monit.memory || 0) / (1024 * 1024)) : null,
    }));
  return { available: true, apps };
}

function pm2HasOnlineServer() {
  const snap = pm2Snapshot();
  if (!snap.available) return false;
  return snap.apps.some((a) => a.name === 'abaya-server' && a.status === 'online');
}

function runPm2Command(args) {
  return execPm2Wrapper(args);
}

/** GET an HTTP URL on localhost and return parsed JSON (best-effort). */
function fetchLocalJson(port, urlPath, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        headers: headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          } else {
            reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs || 4000, () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

function postLocalJson(port, urlPath, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: Object.assign({ 'Content-Length': '0' }, headers || {}),
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch (_) { resolve({ ok: true, raw: body }); }
          } else {
            reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs || 6000, () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

/**
 * Node args for a PnP-or-node_modules project. Only inject the PnP loader when
 * `.pnp.cjs` actually exists, and reference it by ABSOLUTE path — a relative
 * `-r ./.pnp.cjs` crashes with `Cannot find module './.pnp.cjs'` whenever the
 * child's effective CWD differs or the loader was preloaded via NODE_OPTIONS.
 * When there is no PnP manifest, plain `node` uses node_modules.
 * @param {string} scriptDir directory whose `.pnp.cjs` governs this script
 * @param {string} script    entry filename
 */
function nodeRunArgs(scriptDir, script) {
  const pnp = path.join(scriptDir, '.pnp.cjs');
  return fs.existsSync(pnp) ? ['-r', pnp, script] : [script];
}

/** True when the repo has an installed dependency graph (PnP or real node_modules). */
function factoryDepsInstalled() {
  if (fs.existsSync(path.join(REPO_ROOT, '.pnp.cjs'))) return true;
  return fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'express'));
}

function spawnFactoryServer() {
  const opts = { cwd: REPO_ROOT, shell: false, env: buildChildEnv() };
  if (useBun()) return spawn(resolveNodeLikeBin('bun'), ['server.js'], opts);
  return spawn(process.execPath, nodeRunArgs(REPO_ROOT, 'server.js'), childNodeOpts(opts));
}

function spawnWatcher() {
  const watcherDir = path.join(REPO_ROOT, 'tools', 'catalog-watcher');
  const opts = { cwd: watcherDir, shell: false, env: buildChildEnv() };
  if (useBun()) return spawn(resolveNodeLikeBin('bun'), ['watch-catalog.js'], opts);
  return spawn(process.execPath, nodeRunArgs(watcherDir, 'watch-catalog.js'), childNodeOpts(opts));
}

/** Resolve bun (per-user install else PATH). */
function resolveNodeLikeBin(name) {
  if (name === 'bun') return resolveBunBin();
  return name;
}

/**
 * Run child Node scripts through Electron's own binary via ELECTRON_RUN_AS_NODE=1
 * (process.execPath is electron.exe in a packaged app, and system `node` may not be
 * on PATH). This makes the factory server independent of any external Node install.
 */
function childNodeOpts(opts) {
  const env = Object.assign({}, opts.env, { ELECTRON_RUN_AS_NODE: '1' });
  return Object.assign({}, opts, { env: env });
}

// ── Dispatch (Bun) server — WhatsApp leaderboard / invoice upload ─────────────
const DISPATCH_PORT = 3111;
const DISPATCH_DIR = path.join(REPO_ROOT, 'services', 'dispatch-server');

/** The per-user Bun install, else `bun` on PATH. */
function resolveBunBin() {
  const p = path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  return fs.existsSync(p) ? p : 'bun';
}

function dispatchCanStart() {
  return fs.existsSync(path.join(DISPATCH_DIR, 'server.js'));
}

function spawnDispatchServer() {
  // Bun runs server.js directly and auto-loads services/dispatch-server/.env — no PnP.
  return spawn(resolveBunBin(), ['server.js'], { cwd: DISPATCH_DIR, shell: false, env: buildChildEnv() });
}

/**
 * Stop a child tree (yarn → node); Windows uses taskkill /T.
 * @param {import('child_process').ChildProcess | null} proc
 */
function killTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        shell: true,
        stdio: 'ignore',
        detached: true,
      });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (_) {}
}

function stopAllProcs() {
  killTree(watcherProc);
  watcherProc = null;
  killTree(serverProc);
  serverProc = null;
  killTree(dispatchProc);
  dispatchProc = null;
  // Ensure clean restart path: free server port even if stray process remains.
  ensurePortFreedSync(FACTORY_PORT, []);
}

function createWindow() {
  allowWindowClose = false;
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#1f1633',
    title: 'AbaYa Track',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Memory + security: sandbox the renderer (preload only uses contextBridge +
      // ipcRenderer, which are sandbox-safe), skip the spellcheck dictionary, and
      // disable renderer features this control panel never uses.
      sandbox: true,
      spellcheck: false,
      webgl: false,
      enableWebSQL: false,
      backgroundThrottling: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('did-finish-load', function () {
    emitUpdateState();
  });
  mainWindow.on('close', function (event) {
    if (allowWindowClose) return;
    event.preventDefault();
    try {
      mainWindow.webContents.send('request-window-close-confirmation');
    } catch (_) {}
  });
  mainWindow.on('closed', function () {
    mainWindow = null;
    allowWindowClose = false;
  });
}

function shouldAutoStartSilently() {
  const flag = String(process.env.ABAYA_SILENT_BOOT || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

app.whenReady().then(function () {
  pendingUpdateApplyResult = readAndConsumePendingUpdateSuccess();
  createWindow();
  setupAutoUpdates();
  ensureRuntimeSeedFiles();
  if (shouldAutoStartSilently()) {
    setTimeout(function () {
      startAllServers().catch(function (err) {
        sendLog('server', '[launcher] auto-start failed: ' + String(err && err.message ? err.message : err) + '\n');
      });
      startDispatchRuntime().catch(function (err) {
        sendLog('dispatch', '[launcher] auto-dispatch failed: ' + String(err && err.message ? err.message : err) + '\n');
      });
    }, 800);
  }
});

app.on('window-all-closed', function () {
  if (updateCheckTimer) {
    clearTimeout(updateCheckTimer);
    updateCheckTimer = null;
  }
  stopAllProcs();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', function () {
  stopAllProcs();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-defaults', function () {
  return {
    port: readPortFromDotenv(REPO_ROOT),
    repoRoot: REPO_ROOT,
  };
});

ipcMain.handle('get-mode', function () {
  return { mode: appMode, defaultMode: DEFAULT_APP_MODE, isPackaged: app.isPackaged };
});

/**
 * Switch production/development. Persists, re-applies the updater posture live,
 * and reports whether running servers need a restart to pick up the new
 * NODE_ENV (they inherit the env only when (re)spawned).
 */
ipcMain.handle('set-mode', function (_e, mode) {
  const previous = appMode;
  const applied = saveAppMode(mode);
  setupAutoUpdates();
  const serversRunning = !!(serverProc || watcherProc || dispatchProc);
  return {
    mode: applied,
    isPackaged: app.isPackaged,
    changed: applied !== previous,
    restartServersToApply: applied !== previous && serversRunning,
  };
});

ipcMain.handle('get-release-moment', function () {
  return readReleaseMomentForLauncher();
});

ipcMain.handle('status', function () {
  const listening = listPidsListeningOnPort(FACTORY_PORT);
  const pm2 = pm2Snapshot();
  const pm2Server = pm2.apps.find((a) => a.name === 'abaya-server');
  const pm2Watcher = pm2.apps.find((a) => a.name === 'catalog-watcher');
  const pm2Tunnel = pm2.apps.find((a) => a.name === 'cloudflared-tunnel');
  const serverManagedByPm2 = !!(pm2Server && pm2Server.status === 'online');
  const watcherManagedByPm2 = !!(pm2Watcher && pm2Watcher.status === 'online');
  return {
    serverRunning: pidAlive(serverProc) || serverManagedByPm2,
    watcherRunning: pidAlive(watcherProc) || watcherManagedByPm2,
    serverPid: pidAlive(serverProc) ? serverProc.pid : (pm2Server ? pm2Server.pid : null),
    watcherPid: pidAlive(watcherProc) ? watcherProc.pid : (pm2Watcher ? pm2Watcher.pid : null),
    port: FACTORY_PORT,
    portBusy: listening.length > 0,
    portPids: listening,
    pm2: {
      available: pm2.available,
      managedServer: serverManagedByPm2,
      managedWatcher: watcherManagedByPm2,
      apps: pm2.apps,
      tunnelOnline: !!(pm2Tunnel && pm2Tunnel.status === 'online'),
    },
  };
});

ipcMain.handle('pm2-action', async function (_e, action) {
  const allowed = new Set(['start', 'reload', 'stop', 'restart']);
  if (!allowed.has(String(action || ''))) {
    return { ok: false, error: 'unknown action: ' + action };
  }
  const args = action === 'stop'
    ? ['stop', 'ecosystem.config.cjs']
    : [action, 'ecosystem.config.cjs', '--update-env'];
  const r = runPm2Command(args);
  sendLog('server', '[pm2] ' + ['pm2'].concat(args).join(' ') + '\n');
  if (r.output) sendLog('server', r.output + '\n');
  if (!r.ok) sendLog('server', '[pm2] failed: ' + r.error + '\n');
  return r;
});

ipcMain.handle('sync-status', async function () {
  try {
    const data = await fetchLocalJson(FACTORY_PORT, '/api/ceo-ingest-status', {}, 4000);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('reconcile-now', async function () {
  const secret = readIngestSecretFromDotenv(REPO_ROOT);
  if (!secret) {
    return { ok: false, error: 'CF_INGEST_SECRET missing in .env — cannot authenticate.' };
  }
  try {
    const data = await postLocalJson(
      FACTORY_PORT,
      '/api/reconcile-now',
      { 'X-Ingest-Secret': secret },
      8000
    );
    sendLog('server', '[reconcile] manual run requested → ' + JSON.stringify(data) + '\n');
    return { ok: true, data };
  } catch (e) {
    sendLog('server', '[reconcile] failed: ' + (e && e.message ? e.message : String(e)) + '\n');
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('open-url', function (_e, url) {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
  return true;
});

ipcMain.handle('window-minimize', function () {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  return true;
});

ipcMain.handle('window-toggle-maximize', function () {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});

ipcMain.handle('window-close', function () {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('request-window-close-confirmation');
    } catch (_) {}
  }
  return true;
});

ipcMain.handle('confirm-window-close', function (_e, shouldClose) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!shouldClose) {
    allowWindowClose = false;
    return false;
  }
  allowWindowClose = true;
  mainWindow.close();
  return true;
});

ipcMain.handle('window-is-maximized', function () {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return mainWindow.isMaximized();
});

ipcMain.handle('update-status', function () {
  return getPublicUpdateState();
});

ipcMain.handle('update-check-now', async function () {
  await checkForUpdatesSafe('manual');
  scheduleNextUpdateCheck('manual');
  return getPublicUpdateState();
});

ipcMain.handle('update-install-now', function () {
  if (!updateState.downloaded) {
    return { ok: false, error: 'No downloaded update available yet.' };
  }
  writePendingUpdateMeta(app.getVersion(), updateState.availableVersion);
  setUpdateState({ message: 'Applying update and restarting...' });
  appendUpdateAudit('install-requested');
  setTimeout(function () {
    autoUpdater.quitAndInstall();
  }, 250);
  return { ok: true };
});

ipcMain.handle('dismiss-update-success', function () {
  setUpdateState({ updateJustApplied: false, updateAppliedFromVersion: '' });
  return { ok: true };
});

ipcMain.handle('export-diagnostics', async function () {
  try {
    const payload = buildDiagnosticsPayload();
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res =
      win && !win.isDestroyed()
        ? await dialog.showSaveDialog(win, {
            title: 'Export launcher diagnostics',
            defaultPath: path.join(app.getPath('documents'), 'abaya-launcher-diagnostics-' + Date.now() + '.json'),
            filters: [{ name: 'JSON', extensions: ['json'] }],
          })
        : await dialog.showSaveDialog({
            title: 'Export launcher diagnostics',
            defaultPath: path.join(app.getPath('documents'), 'abaya-launcher-diagnostics-' + Date.now() + '.json'),
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
    if (res.canceled || !res.filePath) {
      return { ok: false, error: 'cancelled' };
    }
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    appendUpdateAudit('diagnostics-exported', { path: res.filePath });
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

async function startAllServers() {
  if (!ensureServerJs()) {
    return { ok: false, error: 'server.js not found (expected repo root): ' + REPO_ROOT };
  }

  // Dependencies must be installed before anything can start. Fail with a clear,
  // actionable message instead of a cryptic MODULE_NOT_FOUND crash in the child.
  if (!useBun() && !factoryDepsInstalled()) {
    const msg = 'Dependencies are not installed. Run START.bat (or `corepack yarn install`) in ' + REPO_ROOT + ' first.';
    sendLog('server', '[launcher] ' + msg + '\n');
    return { ok: false, error: msg };
  }

  // PM2 wins. If `abaya-server` is already online under PM2, do not spawn a duplicate
  // (would just steal the port and fight pm2 over restarts).
  if (pm2HasOnlineServer()) {
    sendLog('server', '[launcher] PM2 is managing abaya-server; skipping inline spawn. Use Reload (PM2) for code updates.\n');
    return { ok: true, managedByPm2: true };
  }

  // If pm2 is usable (project wrapper + deps), prefer it so reboot persistence is intact.
  if (resolvePm2Wrapper()) {
    const r = runPm2Command(['start', 'ecosystem.config.cjs', '--update-env']);
    sendLog('server', '[launcher] pm2 start ecosystem.config.cjs → ' + (r.ok ? 'ok' : r.error) + '\n');
    if (r.ok) {
      runPm2Command(['save']);
      return { ok: true, managedByPm2: true };
    }
    sendLog('server', '[launcher] PM2 start failed; falling back to inline spawn.\n');
  }

  if (serverProc !== null && !serverProc.killed) {
    return { ok: false, error: 'Server already running' };
  }
  // Always pre-clean the target port before starting.
  ensurePortFreedSync(FACTORY_PORT, []);

  try {
    serverProc = spawnFactoryServer();
    pipeChild(serverProc, 'server');
    sendLog('server', '[launcher] Started factory server in ' + REPO_ROOT + '\n');
  } catch (e) {
    serverProc = null;
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }

  if (watcherCanStart()) {
    try {
      watcherProc = spawnWatcher();
      pipeChild(watcherProc, 'watcher');
      sendLog('watcher', '[launcher] Started catalog watcher\n');
    } catch (e2) {
      sendLog(
        'watcher',
        '[launcher] watcher failed: ' + String(e2 && e2.message ? e2.message : e2) + '\n'
      );
    }
  } else {
    sendLog(
      'watcher',
      '[launcher] Catalog watcher skipped (need config.json + watch-catalog.js + Yarn deps in tools/catalog-watcher).\n'
    );
  }

  return { ok: true };
}

ipcMain.handle('start-all', async function () {
  return startAllServers();
});

ipcMain.handle('stop-all', async function () {
  // If PM2 is running our apps, stop them via PM2 so the boot path stays consistent.
  if (pm2HasOnlineServer()) {
    const r = runPm2Command(['stop', 'ecosystem.config.cjs']);
    sendLog('server', '[launcher] pm2 stop ecosystem.config.cjs → ' + (r.ok ? 'ok' : r.error) + '\n');
  }
  stopAllProcs();
  return { ok: true };
});

async function startDispatchRuntime() {
  if (!dispatchCanStart()) {
    return { ok: false, error: 'dispatch server.js not found: ' + DISPATCH_DIR };
  }
  if (pidAlive(dispatchProc)) return { ok: true, already: true };
  // Respect an externally-started dispatch (e.g. START-BUN.bat) — do not spawn a rival.
  if (listPidsListeningOnPort(DISPATCH_PORT).length) {
    sendLog('dispatch', '[launcher] A dispatch server is already listening on ' + DISPATCH_PORT + ' — leaving it as is.\n');
    return { ok: true, already: true, external: true };
  }
  try {
    dispatchProc = spawnDispatchServer();
    pipeChild(dispatchProc, 'dispatch');
    sendLog('dispatch', '[launcher] Started dispatch (Bun) on port ' + DISPATCH_PORT + ' — ' + DISPATCH_DIR + '\n');
    return { ok: true, pid: dispatchProc.pid, port: DISPATCH_PORT };
  } catch (e) {
    dispatchProc = null;
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

ipcMain.handle('dispatch-start', async function () {
  return startDispatchRuntime();
});

ipcMain.handle('dispatch-stop', async function () {
  // Only stop what the launcher itself started — never a dispatch someone ran another way.
  if (!pidAlive(dispatchProc)) {
    return { ok: true, already: true, note: 'not launcher-owned' };
  }
  killTree(dispatchProc);
  dispatchProc = null;
  sendLog('dispatch', '[launcher] Dispatch stopped.\n');
  return { ok: true };
});

ipcMain.handle('dispatch-status', function () {
  const owned = pidAlive(dispatchProc);
  const listening = listPidsListeningOnPort(DISPATCH_PORT).length > 0;
  return { running: owned || listening, launcherOwned: owned, external: !owned && listening, port: DISPATCH_PORT };
});
