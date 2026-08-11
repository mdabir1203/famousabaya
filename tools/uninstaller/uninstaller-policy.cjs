'use strict';

/**
 * Pure detection + action policy for the AbaYa Track uninstaller wrapper.
 *
 * No I/O, no Electron. Everything here is testable from Node directly.
 * The wrapper's main.js calls these helpers and translates results into
 * IPC payloads / fs.rmSync calls.
 *
 * Design principles:
 *   - Default to "keep" — never destructive without an explicit choice.
 *   - Show every path with its size so the operator can see what they're
 *     affecting; a wipe that is several GB of factory data needs a
 *     different mental state than a wipe of 5 KB of cache.
 *   - Never assume; the user must opt in per item.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const APP_NAME = 'AbaYa Track';
const APP_ID = 'com.abaya.track.launcher';
const APP_DATA_BASENAME = 'AbaYa Track';

/**
 * Resolve the canonical AppData root. Honors ABAYA_DATA_DIR for dev but
 * defaults to the same path the launcher uses when packaged.
 */
function resolveAppDataRoot() {
  const override = String(process.env.ABAYA_DATA_DIR || '').trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_DATA_BASENAME);
}

/**
 * Detect the install dir. The packaged launcher stores its location in
 * the Windows uninstall registry; we read it. Falls back to a few well
 * known paths.
 */
function detectInstallDir() {
  if (process.platform !== 'win32') {
    return { found: false, installDir: null, source: 'non-windows' };
  }
  const candidates = [
    readInstallDirFromRegistry(),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AbaYa Track Launcher'),
    path.join(process.env.LOCALAPPDATA || '', 'AbaYa Track Launcher'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'AbaYa Track Launcher'),
  ];
  for (const c of candidates) {
    if (c && c.installDir && fs.existsSync(c.installDir)) {
      return c;
    }
  }
  return { found: false, installDir: null, source: 'no-match' };
}

function readInstallDirFromRegistry() {
  try {
    // Two views: per-user (HKCU) and per-machine (HKLM, requires elevation).
    // Per-user is the default for this app (perMachine: false).
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + APP_ID;
    const out = execSync(
      ['reg', 'query', '"' + key + '"', '/v', 'InstallLocation'].join(' '),
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    );
    const m = out.match(/InstallLocation\s+REG_SZ\s+(.+?)\r?\n/);
    if (m) {
      return { found: true, installDir: m[1].trim(), source: 'registry-hkcu' };
    }
  } catch (_) {
    // fall through
  }
  return { found: false, installDir: null, source: 'registry-hkcu-miss' };
}

/**
 * Recursive directory size in bytes. Skips files that throw on stat
 * (locked, permission). Returns null if the path doesn't exist.
 */
function dirSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  let total = 0;
  let fileCount = 0;
  let dirCount = 0;
  const walk = (p) => {
    let entries;
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const ent of entries) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) {
        dirCount += 1;
        walk(full);
      } else if (ent.isFile()) {
        try {
          const st = fs.statSync(full);
          total += st.size;
          fileCount += 1;
        } catch (_) { /* skip */ }
      }
    }
  };
  walk(dirPath);
  return { bytes: total, files: fileCount, dirs: dirCount };
}

function listFilesByExt(dirPath, exts) {
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  const walk = (p) => {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        const lower = ent.name.toLowerCase();
        if (exts.some((e) => lower.endsWith(e))) out.push(full);
      }
    }
  };
  walk(dirPath);
  return out;
}

/**
 * Inventory all the things the wrapper can act on. Pure-read; no side effects.
 * Returned object is JSON-safe (Date -> string, etc.) and ready for IPC.
 */
function buildInventory() {
  const appDataRoot = resolveAppDataRoot();
  const install = detectInstallDir();

  const dataDir = path.join(appDataRoot, 'factory-data');
  const envFile = path.join(appDataRoot, '.env');
  const launcherCache = path.join(appDataRoot, 'launcher');
  const photosEmployees = install.found ? path.join(install.installDir, 'resources', 'public', 'uploads', 'employees') : null;
  const photosItems = install.found ? path.join(install.installDir, 'resources', 'public', 'uploads', 'items') : null;

  const dataSize = dirSizeBytes(dataDir);
  const launcherSize = dirSizeBytes(launcherCache);
  const photosEmpSize = photosEmployees ? dirSizeBytes(photosEmployees) : null;
  const photosItemsSize = photosItems ? dirSizeBytes(photosItems) : null;

  const dataFiles = dataSize ? listFilesByExt(dataDir, ['.db', '.json']) : [];
  const envExists = fs.existsSync(envFile);
  const envSize = envExists ? fs.statSync(envFile).size : 0;

  return {
    app: {
      name: APP_NAME,
      version: readInstalledVersion(install.installDir),
    },
    install: {
      found: install.found,
      installDir: install.installDir || null,
      detectedVia: install.source || null,
    },
    appData: {
      root: appDataRoot,
      factoryData: {
        path: dataDir,
        exists: !!dataSize,
        bytes: dataSize ? dataSize.bytes : 0,
        files: dataSize ? dataSize.files : 0,
        subdirs: dataSize ? dataSize.dirs : 0,
        dbCount: dataFiles.filter((f) => f.endsWith('.db')).length,
        jsonCount: dataFiles.filter((f) => f.endsWith('.json')).length,
      },
      envFile: {
        path: envFile,
        exists: envExists,
        bytes: envSize,
        keys: envExists ? readEnvKeys(envFile) : [],
      },
      launcherCache: {
        path: launcherCache,
        exists: !!launcherSize,
        bytes: launcherSize ? launcherSize.bytes : 0,
        files: launcherSize ? launcherSize.files : 0,
      },
    },
    bundledPhotos: {
      employees: photosEmployees
        ? { path: photosEmployees, exists: !!photosEmpSize, bytes: photosEmpSize ? photosEmpSize.bytes : 0, files: photosEmpSize ? photosEmpSize.files : 0 }
        : { path: null, exists: false, bytes: 0, files: 0 },
      items: photosItems
        ? { path: photosItems, exists: !!photosItemsSize, bytes: photosItemsSize ? photosItemsSize.bytes : 0, files: photosItemsSize ? photosItemsSize.files : 0 }
        : { path: null, exists: false, bytes: 0, files: 0 },
    },
    running: detectRunningProcesses(),
  };
}

function readInstalledVersion(installDir) {
  if (!installDir) return null;
  // Packaged Electron apps put version in resources/app/package.json or
  // in a top-level package.json. Try both.
  const candidates = [
    path.join(installDir, 'resources', 'app', 'package.json'),
    path.join(installDir, 'resources', 'app.asar.unpacked', 'package.json'),
    path.join(installDir, 'package.json'),
  ];
  for (const c of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(c, 'utf8'));
      if (pkg && pkg.version) return String(pkg.version);
    } catch (_) { /* try next */ }
  }
  return null;
}

function readEnvKeys(envPath) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const keys = [];
    raw.split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) keys.push(t.slice(0, i).trim());
    });
    return keys;
  } catch (_) {
    return [];
  }
}

/**
 * Detect running AbaYa Track processes. Pure-read; uses netstat to find
 * the PIDs listening on the factory port, then maps them to exe names.
 */
function detectRunningProcesses() {
  if (process.platform !== 'win32') return { factoryServer: [], catalogWatcher: [], dispatchServer: [], tunnel: [] };
  const portPids = listPidsListeningOnPort(3111);
  const portPids2 = listPidsListeningOnPort(3001); // dispatch alt port
  return {
    factoryServer: resolveProcessNames(portPids, ['node.exe', 'electron.exe', 'bun.exe']),
    catalogWatcher: resolveProcessNames(portPids, ['node.exe', 'bun.exe']),
    dispatchServer: resolveProcessNames(portPids2, ['node.exe', 'bun.exe']),
    tunnel: resolveProcessNames(portPids, ['cloudflared.exe']),
  };
}

function listPidsListeningOnPort(port) {
  if (process.platform !== 'win32') return [];
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
    const want = ':' + String(port);
    const pids = new Set();
    String(out || '').split(/\r?\n/).forEach((ln) => {
      const line = ln.trim();
      if (!line || line.indexOf('LISTENING') < 0) return;
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

function resolveProcessNames(pids, candidateExes) {
  if (!pids || !pids.length) return [];
  const out = [];
  for (const pid of pids) {
    try {
      const detail = execSync('tasklist /FI "PID eq ' + pid + '" /FO CSV /NH', { encoding: 'utf8', windowsHide: true });
      const m = detail.match(/^"([^"]+)"/m);
      if (m && candidateExes.includes(m[1])) {
        out.push({ pid, name: m[1] });
      }
    } catch (_) { /* ignore */ }
  }
  return out;
}

/**
 * Build the action plan from a set of user choices. Pure: returns the list
 * of operations to perform, doesn't perform them. Each op has a type
 * ('wipeDir' | 'wipeFile' | 'removeInstall' | 'killPids') and a description
 * for the summary screen.
 */
function buildActionPlan(choices) {
  const plan = [];
  if (choices.wipeFactoryData) {
    plan.push({ type: 'wipeDir', path: path.join(resolveAppDataRoot(), 'factory-data'), label: 'factory-data/' });
  }
  if (choices.wipeEnv) {
    plan.push({ type: 'wipeFile', path: path.join(resolveAppDataRoot(), '.env'), label: '.env (cloud credentials)' });
  }
  if (choices.wipeLauncherCache) {
    plan.push({ type: 'wipeDir', path: path.join(resolveAppDataRoot(), 'launcher'), label: 'launcher cache' });
  }
  if (choices.wipeBundledPhotos && choices.installDir) {
    plan.push({ type: 'wipeDir', path: path.join(choices.installDir, 'resources', 'public', 'uploads'), label: 'bundled photos' });
  }
  if (choices.removeInstall && choices.installDir) {
    plan.push({ type: 'removeInstall', path: choices.installDir, label: 'install dir' });
  }
  if (choices.killPids && choices.killPids.length) {
    for (const p of choices.killPids) {
      plan.push({ type: 'killPid', pid: p.pid, name: p.name, label: 'stop ' + p.name + ' (pid ' + p.id + ')' });
    }
  }
  if (choices.exportEnvTo) {
    plan.push({ type: 'exportEnv', from: path.join(resolveAppDataRoot(), '.env'), to: choices.exportEnvTo, label: 'export .env' });
  }
  return plan;
}

function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

module.exports = {
  APP_NAME,
  APP_ID,
  resolveAppDataRoot,
  detectInstallDir,
  dirSizeBytes,
  buildInventory,
  buildActionPlan,
  formatBytes,
  listPidsListeningOnPort,
  resolveProcessNames,
};
