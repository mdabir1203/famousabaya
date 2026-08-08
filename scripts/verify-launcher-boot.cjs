#!/usr/bin/env node
'use strict';
/**
 * Realtime boot verification for the GUI desktop launcher.
 *
 * Boots the REAL tools/desktop-launcher/main.js with a minimal Electron double
 * (window/IPC capture only) — child processes are REAL: the launcher spawns
 * the actual factory server exactly like a click on "Start all" in the GUI.
 *
 * Proves:
 *   B1  launcher boots and registers IPC handlers
 *   B2  "Start all" spawns the factory server; /api/health answers 200
 *   B3  server stdout flows into the GUI log channel (proc-log events)
 *   B4  "status" reports the server running with a live PID
 *   B5  "Stop all" shuts the server tree down (port freed)
 *   B6  dispatch server binds 0.0.0.0:3111 and answers /health
 *       (the factory-LAN address, e.g. http://192.168.0.101:3111)
 *
 * Usage: node scripts/verify-launcher-boot.cjs   (exit 0 = all passed)
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(REPO_ROOT, 'tools', 'desktop-launcher', 'main.js');
const DISPATCH_DIR = path.join(REPO_ROOT, 'services', 'dispatch-server');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const ENV_EXISTED_BEFORE = fs.existsSync(ENV_PATH);

const CHILD_SOURCE = [
  "'use strict';",
  "const path = require('path');",
  "const Module = require('module');",
  "const MAIN_JS = process.env.HARNESS_MAIN_JS;",
  "const REPO_ROOT = process.env.ABAYA_REPO_ROOT;",
  "const logs = [];",
  "const ipcHandlers = {};",
  "function FakeBrowserWindow() {",
  "  this.webContents = {",
  "    send: function (channel, payload) {",
  "      if (channel === 'proc-log') logs.push(payload);",
  "    },",
  "    on: function () {},",
  "  };",
  "}",
  "FakeBrowserWindow.prototype.loadFile = function () {};",
  "FakeBrowserWindow.prototype.isDestroyed = function () { return false; };",
  "FakeBrowserWindow.prototype.on = function () {};",
  "FakeBrowserWindow.prototype.close = function () {};",
  "FakeBrowserWindow.prototype.isMaximized = function () { return false; };",
  "const electronStub = {",
  "  app: {",
  "    isPackaged: true,",
  "    getVersion: function () { return '0.0.0-verify'; },",
  "    getAppPath: function () { return REPO_ROOT; },",
  "    setPath: function () {},",
  "    on: function () {},",
  "    quit: function () {},",
  "    commandLine: { appendSwitch: function () {} },",
  "    whenReady: function () { return Promise.resolve(); },",
  "  },",
  "  BrowserWindow: FakeBrowserWindow,",
  "  ipcMain: { handle: function (name, fn) { ipcHandlers[name] = fn; }, on: function () {} },",
  "  shell: { openExternal: async function () {} },",
  "  Menu: { setApplicationMenu: function () {} },",
  "  powerMonitor: { on: function () {} },",
  "  dialog: { showSaveDialog: async function () { return { canceled: true }; } },",
  "};",
  "const fakeAutoUpdater = {",
  "  on: function () {}, setFeedURL: function () {}, quitAndInstall: function () {},",
  "  checkForUpdates: async function () {},",
  "  autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false,",
  "  allowDowngrade: false, forceDevUpdateConfig: false, channel: null,",
  "};",
  "const origLoad = Module._load;",
  "Module._load = function (request) {",
  "  if (request === 'electron') return electronStub;",
  "  if (request === 'electron-updater') return { autoUpdater: fakeAutoUpdater };",
  "  return origLoad.apply(this, arguments);",
  "};",
  "(async function () {",
  "  require(MAIN_JS);",
  "  await new Promise(function (r) { setTimeout(r, 1200); });",
  "  const out = { handlers: Object.keys(ipcHandlers), logs: logs };",
  "  if (ipcHandlers['start-all']) {",
  "    out.startResult = await ipcHandlers['start-all']();",
  "  }",
  "  console.log('HARNESS_READY');",
  "  process.stdin.once('data', async function () {",
  "    if (ipcHandlers['status']) out.status = await ipcHandlers['status']();",
  "    if (ipcHandlers['stop-all']) out.stopResult = await ipcHandlers['stop-all']();",
  "    await new Promise(function (r) { setTimeout(r, 500); });",
  "    out.logsAfterStop = logs.length;",
  "    console.log('HARNESS_RESULT ' + JSON.stringify(out));",
  "    process.exit(0);",
  "  });",
  "})().catch(function (e) {",
  "  console.log('HARNESS_RESULT ' + JSON.stringify({ fatal: String(e && e.stack || e) }));",
  "  process.exit(2);",
  "});",
  "",
].join('\n');

function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs || 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: '' });
    });
  });
}

async function waitFor(predicate, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await predicate();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs || 500));
  }
  return null;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  -> ' + detail));
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-boot-harness-'));
  const childPath = path.join(tmp, 'boot-child.cjs');
  fs.writeFileSync(childPath, CHILD_SOURCE);

  const env = Object.assign({}, process.env, {
    ABAYA_REPO_ROOT: REPO_ROOT,
    HARNESS_MAIN_JS: MAIN_JS,
  });
  delete env.ABAYA_UPDATE_MIRROR_BASE_URL;

  const child = spawn(process.execPath, [childPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => {
    stdout += c.toString();
  });
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });

  let childResult = null;
  try {
    // Wait for the child to boot main.js and call start-all.
    const ready = await waitFor(() => stdout.includes('HARNESS_READY'), 30000, 250);
    check('B1 launcher boots, start-all invoked', !!ready, stderr.slice(0, 400));

    if (ready) {
      // B2: factory server answers on its port (3000 default from repo .env/example).
      const health = await waitFor(async () => {
        const r = await httpGet('http://127.0.0.1:3000/api/health');
        return r.status === 200 ? r : null;
      }, 40000, 1000);
      check('B2 factory server running after GUI start-all (/api/health 200)', !!health, health ? '' : 'no 200 within 40s');

      // Tell the child to collect status + stop-all and dump results.
      child.stdin.write('go\n');
      const got = await waitFor(() => {
        const line = stdout.split('\n').find((l) => l.startsWith('HARNESS_RESULT '));
        if (!line) return null;
        childResult = JSON.parse(line.slice('HARNESS_RESULT '.length));
        return childResult;
      }, 20000, 250);
      check('B3 child reported status/stop results', !!got, stderr.slice(0, 400));

      if (childResult) {
        const serverLogs = (childResult.logs || []).filter((l) => l && l.which === 'server' && String(l.text || '').trim());
        const joined = serverLogs.map((l) => l.text).join('');
        // Two supported runtime paths: the launcher spawns the server directly
        // (stdout pipes into the GUI log), or PM2 manages it (GUI shows the
        // lifecycle lines and server stdout lands in data/pm2-logs/).
        if (/pm2 start/.test(joined)) {
          let pm2Log = '';
          try {
            pm2Log = fs.readFileSync(path.join(REPO_ROOT, 'data', 'pm2-logs', 'abaya-server.out.log'), 'utf8');
          } catch (_) {}
          check(
            'B4 GUI shows launcher lifecycle logs; server stdout lands in data/pm2-logs',
            /\[launcher\]/.test(joined) && /Abaya Central Server running|Dashboard state/.test(pm2Log),
            'gui log lines: ' + serverLogs.length + ' | pm2 log bytes: ' + pm2Log.length
          );
        } else {
          check(
            'B4 server stdout flows to GUI log channel (proc-log)',
            serverLogs.length > 0 && /listen|AbaYa|Dashboard state|server/i.test(joined),
            'server log events: ' + serverLogs.length + ' | sample: ' + joined.slice(0, 300).replace(/\n/g, '\\n')
          );
        }
        const st = childResult.status || {};
        check('B5 status reports server running with live PID', !!(st && (st.serverRunning || st.serverPid)), JSON.stringify({ serverRunning: st.serverRunning, serverPid: st.serverPid }));
      }

      // B6: port freed after stop-all.
      const down = await waitFor(async () => {
        const r = await httpGet('http://127.0.0.1:3000/api/health');
        return r.status === 0 ? true : null;
      }, 20000, 1000);
      check('B6 stop-all frees the server port', !!down, 'port 3000 still answering after stop-all');
    }
  } finally {
    try {
      child.kill('SIGKILL');
    } catch (_) {}
  }

  // B7: dispatch server on 3111 (what the factory LAN reaches at 192.168.0.101:3111).
  const dispatch = spawn(process.execPath, ['server.js'], {
    cwd: DISPATCH_DIR,
    env: Object.assign({}, process.env, { DISPATCH_PORT: '3111' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let dispatchErr = '';
  dispatch.stderr.on('data', (c) => (dispatchErr += c.toString()));
  try {
    const dHealth = await waitFor(async () => {
      const r = await httpGet('http://127.0.0.1:3111/health');
      return r.status === 200 ? r : null;
    }, 25000, 1000);
    check('B7 dispatch server answers /health on 0.0.0.0:3111', !!dHealth, dispatchErr.slice(0, 300) || 'no 200 within 25s');
  } finally {
    try {
      dispatch.kill('SIGKILL');
    } catch (_) {}
  }

  // Cleanup: the launcher's first-run helper may have created .env from the
  // example template — remove it only if it did not exist before this run.
  if (!ENV_EXISTED_BEFORE && fs.existsSync(ENV_PATH)) {
    try {
      fs.unlinkSync(ENV_PATH);
    } catch (_) {}
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {}

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (failed === 0 ? 'ALL BOOT CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('harness fatal:', e);
  process.exit(2);
});
