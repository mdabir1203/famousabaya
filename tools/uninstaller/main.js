'use strict';

/**
 * Electron main process for the AbaYa Track standalone uninstaller.
 *
 * Responsibilities:
 *   - Detect installed app + data dirs (via uninstaller-policy.cjs)
 *   - Detect running factory/watcher/dispatch/tunnel processes
 *   - Hand inventory to the renderer
 *   - Apply the operator's choices (kill, wipe, remove, export)
 *   - Log every step to a sidecar file in the user's temp dir
 *
 * Safety posture: nothing destructive is performed automatically. The
 * renderer collects explicit per-item Wipe choices, the user must click
 * Apply, and the user must confirm a second time before any wipe runs.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, execSync } = require('child_process');

const policy = require('./uninstaller-policy.cjs');

// Force a stable, predictable userData dir for the wrapper so we can
// reliably find the audit log after the run.
const WRAPPER_USER_DATA = path.join(process.env.TEMP || os.tmpdir(), 'AbaYa-Track-Uninstaller');
try { fs.mkdirSync(WRAPPER_USER_DATA, { recursive: true }); } catch (_) {}
app.setPath('userData', WRAPPER_USER_DATA);
app.setPath('sessionData', WRAPPER_USER_DATA);

const AUDIT_LOG_PATH = path.join(WRAPPER_USER_DATA, 'uninstall-audit.log');

function audit(line) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(AUDIT_LOG_PATH, '[' + ts + '] ' + line + '\n', 'utf8');
  } catch (_) { /* best-effort */ }
  console.log('[uninstaller]', line);
}

let mainWindow = null;

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#1f1633',
    title: 'AbaYa Track Uninstaller',
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webgl: false,
      enableWebSQL: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', function () { mainWindow = null; });
}

app.whenReady().then(function () {
  audit('boot: app ready, building inventory');
  createWindow();
});

app.on('window-all-closed', function () { app.quit(); });

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle('inventory:build', function () {
  audit('inventory: build requested');
  return policy.buildInventory();
});

ipcMain.handle('plan:build', function (_evt, choices) {
  const plan = policy.buildActionPlan(choices || {});
  audit('plan: ' + plan.length + ' op(s) — ' + plan.map((p) => p.type).join(','));
  return plan;
});

ipcMain.handle('apply:run', function (_evt, plan) {
  audit('apply: run with ' + (plan ? plan.length : 0) + ' op(s)');
  if (!Array.isArray(plan) || plan.length === 0) {
    return { ok: true, results: [] };
  }
  const results = [];
  for (const op of plan) {
    const r = runOp(op);
    results.push(r);
  }
  const allOk = results.every((r) => r.ok);
  audit('apply: done — ok=' + allOk + ', ' + results.filter((r) => r.ok).length + '/' + results.length + ' succeeded');
  return { ok: allOk, results };
});

ipcMain.handle('env:export', function (_evt, destPath) {
  audit('env:export to ' + destPath);
  return safeCopyFile(policy.resolveAppDataRoot() + path.sep + '.env', destPath);
});

ipcMain.handle('dialog:saveEnv', function () {
  return dialog.showSaveDialog(mainWindow, {
    title: 'Save .env backup',
    defaultPath: path.join(app.getPath('desktop') || os.homedir(), '.env.abaya-backup'),
    filters: [{ name: 'env file', extensions: ['env', '*'] }],
  });
});

ipcMain.handle('ui:openAudit', function () {
  shell.openPath(AUDIT_LOG_PATH);
});

// ─── Action implementations ──────────────────────────────────────────────────

function runOp(op) {
  try {
    switch (op.type) {
      case 'wipeDir':   return wipeDir(op);
      case 'wipeFile':  return wipeFile(op);
      case 'removeInstall': return removeInstall(op);
      case 'killPid':   return killPid(op);
      case 'exportEnv': return safeCopyFile(op.from, op.to);
      default:
        return { ok: false, type: op.type, error: 'unknown op type' };
    }
  } catch (e) {
    audit('op failed: ' + op.type + ' — ' + e.message);
    return { ok: false, type: op.type, error: String(e && e.message || e) };
  }
}

function wipeDir(op) {
  if (!op.path || !fs.existsSync(op.path)) {
    return { ok: true, type: op.type, path: op.path, skipped: 'not-found' };
  }
  fs.rmSync(op.path, { recursive: true, force: true });
  audit('wiped dir: ' + op.path);
  return { ok: true, type: op.type, path: op.path };
}

function wipeFile(op) {
  if (!op.path || !fs.existsSync(op.path)) {
    return { ok: true, type: op.type, path: op.path, skipped: 'not-found' };
  }
  fs.rmSync(op.path, { force: true });
  audit('wiped file: ' + op.path);
  return { ok: true, type: op.type, path: op.path };
}

function removeInstall(op) {
  if (!op.path || !fs.existsSync(op.path)) {
    return { ok: true, type: op.type, path: op.path, skipped: 'not-found' };
  }
  // Prefer the registered NSIS uninstaller for cleanest removal. Fall
  // back to recursive delete if the uninstaller isn't found.
  const uninst = findNsisUninstaller(op.path);
  if (uninst && fs.existsSync(uninst)) {
    try {
      execFileSync('"' + uninst + '"', ['/S'], { stdio: 'ignore', windowsHide: true });
      audit('nsis uninstaller ran: ' + uninst);
      return { ok: true, type: op.type, path: op.path, via: 'nsis-uninst' };
    } catch (e) {
      audit('nsis uninstaller failed: ' + e.message + ' — falling back to rmSync');
    }
  }
  // Direct delete fallback. Best-effort: Windows can hold files open
  // briefly after a child process exits.
  fs.rmSync(op.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  audit('install dir removed: ' + op.path);
  return { ok: true, type: op.type, path: op.path, via: 'rmSync' };
}

function findNsisUninstaller(installDir) {
  // NSIS places the uninstaller as Uninst.exe in the install root.
  const candidates = [
    path.join(installDir, 'Uninst.exe'),
    path.join(installDir, 'uninst.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function killPid(op) {
  if (!op.pid) return { ok: false, type: op.type, error: 'no pid' };
  if (process.platform !== 'win32') {
    try { process.kill(op.pid, 'SIGTERM'); } catch (_) {}
    return { ok: true, type: op.type, pid: op.pid };
  }
  try {
    execFileSync('taskkill', ['/PID', String(op.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    audit('killed pid ' + op.pid + ' (' + op.name + ')');
    return { ok: true, type: op.type, pid: op.pid };
  } catch (e) {
    return { ok: false, type: op.type, pid: op.pid, error: String(e && e.message || e) };
  }
}

function safeCopyFile(from, to) {
  if (!from || !to) return { ok: false, error: 'from/to required' };
  if (!fs.existsSync(from)) return { ok: false, error: 'source not found: ' + from };
  try {
    fs.copyFileSync(from, to);
    audit('copied: ' + from + ' -> ' + to);
    return { ok: true, from: from, to: to };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
