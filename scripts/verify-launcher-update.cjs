#!/usr/bin/env node
'use strict';
/**
 * Realtime verification harness for the desktop launcher auto-update system.
 *
 * Boots the REAL tools/desktop-launcher/main.js in a child node process with a
 * scripted Electron / electron-updater double (require-cache injection), then
 * drives the actual IPC handlers and updater events to prove, at runtime:
 *
 *   C0  ring -> electron-updater channel mapping (stable -> latest, beta -> beta)
 *   C1  updater event handlers register exactly once across mode toggles
 *   C2  close-confirmation guard blocks normal quit but NOT the install quit
 *   C3  a failed check is counted once, surfaces error state, and recovers
 *   C4  an overlapping manual check is skipped (never counted as a failure)
 *   C5  Install & Restart: refused before download, quitAndInstall after,
 *       and the install quit is not intercepted by the close confirmation
 *
 * Runs the whole scenario twice: default (stable ring) and ABAYA_UPDATE_CHANNEL=beta.
 *
 * Usage: node scripts/verify-launcher-update.cjs
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(REPO_ROOT, 'tools', 'desktop-launcher', 'main.js');

// NOTE: keep this source free of backticks and ${ } (it is embedded in a
// template literal by the parent).
const CHILD_SOURCE = [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  "const Module = require('module');",
  "",
  "const MAIN_JS = process.env.HARNESS_MAIN_JS;",
  "const REPO_ROOT = process.env.ABAYA_REPO_ROOT;",
  "const EXPECT_CHANNEL = process.env.EXPECT_UPDATER_CHANNEL || 'latest';",
  "const EXPECT_PRERELEASE = EXPECT_CHANNEL === 'beta';",
  "const AUDIT_LOG = path.join(REPO_ROOT, 'data', 'desktop-launcher', 'update-events.jsonl');",
  "",
  "const results = [];",
  "function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: detail || '' }); }",
  "function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }",
  "",
  "const updaterListeners = {};",
  "const emitCounts = {};",
  "const feedCalls = [];",
  "let checkMode = 'ok';",
  "let quitAndInstallCalls = 0;",
  "",
  "const fakeAutoUpdater = {",
  "  autoDownload: false,",
  "  autoInstallOnAppQuit: false,",
  "  allowPrerelease: false,",
  "  allowDowngrade: false,",
  "  forceDevUpdateConfig: false,",
  "  channel: null,",
  "  on: function (ev, fn) { (updaterListeners[ev] = updaterListeners[ev] || []).push(fn); },",
  "  emit: function (ev, arg) {",
  "    emitCounts[ev] = (emitCounts[ev] || 0) + 1;",
  "    (updaterListeners[ev] || []).slice().forEach(function (fn) { fn(arg); });",
  "  },",
  "  listenerCount: function (ev) { return (updaterListeners[ev] || []).length; },",
  "  setFeedURL: function (opts) { feedCalls.push(opts); },",
  "  checkForUpdates: async function () {",
  "    fakeAutoUpdater.emit('checking-for-update');",
  "    if (checkMode === 'hang') { await sleep(1000); fakeAutoUpdater.emit('update-not-available'); return; }",
  "    if (checkMode === 'fail') {",
  "      const err = new Error('simulated feed failure');",
  "      fakeAutoUpdater.emit('error', err);",
  "      throw err;",
  "    }",
  "    fakeAutoUpdater.emit('update-not-available');",
  "  },",
  "  quitAndInstall: function () { quitAndInstallCalls += 1; },",
  "};",
  "",
  "const ipcHandlers = {};",
  "let windowCloseHandler = null;",
  "function FakeBrowserWindow() {",
  "  this.webContents = { send: function () {}, on: function () {} };",
  "}",
  "FakeBrowserWindow.prototype.loadFile = function () {};",
  "FakeBrowserWindow.prototype.isDestroyed = function () { return false; };",
  "FakeBrowserWindow.prototype.on = function (ev, fn) { if (ev === 'close') windowCloseHandler = fn; };",
  "FakeBrowserWindow.prototype.close = function () {};",
  "FakeBrowserWindow.prototype.isMaximized = function () { return false; };",
  "",
  "const electronStub = {",
  "  app: {",
  "    isPackaged: true,",
  "    getVersion: function () { return '1.2.3'; },",
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
  "",
  "const origLoad = Module._load;",
  "Module._load = function (request) {",
  "  if (request === 'electron') return electronStub;",
  "  if (request === 'electron-updater') return { autoUpdater: fakeAutoUpdater };",
  "  return origLoad.apply(this, arguments);",
  "};",
  "",
  "function readAuditEvents() {",
  "  try {",
  "    return fs.readFileSync(AUDIT_LOG, 'utf8').split(/\\r?\\n/).filter(Boolean).map(function (ln) {",
  "      try { return JSON.parse(ln); } catch (_) { return null; }",
  "    }).filter(Boolean);",
  "  } catch (_) { return []; }",
  "}",
  "function hasAudit(name, pred) {",
  "  return readAuditEvents().some(function (e) { return e.event === name && (!pred || pred(e)); });",
  "}",
  "",
  "(async function run() {",
  "  require(MAIN_JS);",
  "  await sleep(800);",
  "",
  "  const st0 = ipcHandlers['update-status']();",
  "  check('C0 updater enabled on cloud feed', st0.enabled === true && st0.updateFeedSource === 'github',",
  "    JSON.stringify({ enabled: st0.enabled, feed: st0.updateFeedSource, probe: st0.updateMirrorProbeMessage }));",
  "  check('C0b ring maps to updater channel ' + EXPECT_CHANNEL,",
  "    st0.updaterChannel === EXPECT_CHANNEL && fakeAutoUpdater.channel === EXPECT_CHANNEL,",
  "    JSON.stringify({ state: st0.updaterChannel, updater: fakeAutoUpdater.channel }));",
  "  check('C0c allowPrerelease matches ring', fakeAutoUpdater.allowPrerelease === EXPECT_PRERELEASE,",
  "    String(fakeAutoUpdater.allowPrerelease));",
  "  check('C0d startup check ran exactly once', (emitCounts['checking-for-update'] || 0) === 1,",
  "    String(emitCounts['checking-for-update']));",
  "",
  "  await ipcHandlers['set-mode'](null, 'development');",
  "  await sleep(200);",
  "  await ipcHandlers['set-mode'](null, 'production');",
  "  await sleep(400);",
  "  await ipcHandlers['set-mode'](null, 'development');",
  "  await sleep(200);",
  "  await ipcHandlers['set-mode'](null, 'production');",
  "  await sleep(400);",
  "  const events = ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error', 'before-quit-for-update'];",
  "  const counts = {};",
  "  events.forEach(function (ev) { counts[ev] = fakeAutoUpdater.listenerCount(ev); });",
  "  check('C1 updater handlers registered exactly once across mode toggles',",
  "    events.every(function (ev) { return counts[ev] === 1; }), JSON.stringify(counts));",
  "",
  "  let prevented = false;",
  "  windowCloseHandler({ preventDefault: function () { prevented = true; } });",
  "  check('C2a normal quit still shows close confirmation', prevented === true);",
  "  fakeAutoUpdater.emit('before-quit-for-update');",
  "  prevented = false;",
  "  windowCloseHandler({ preventDefault: function () { prevented = true; } });",
  "  check('C2b before-quit-for-update passes the close guard', prevented === false);",
  "",
  "  checkMode = 'fail';",
  "  await ipcHandlers['update-check-now']();",
  "  checkMode = 'ok';",
  "  const stFail = ipcHandlers['update-status']();",
  "  check('C3a failed check surfaces error state', stFail.phase === 'error' && !!stFail.lastErrorMessage,",
  "    JSON.stringify({ phase: stFail.phase, err: stFail.lastErrorMessage }));",
  "  check('C3b failure counted exactly once', hasAudit('check-failed', function (e) { return e.failureCount === 1; }), '');",
  "  await ipcHandlers['update-check-now']();",
  "  const stOk = ipcHandlers['update-status']();",
  "  check('C3c next successful check recovers to idle', stOk.phase === 'idle' && stOk.error === '',",
  "    JSON.stringify({ phase: stOk.phase }));",
  "",
  "  checkMode = 'hang';",
  "  const p1 = ipcHandlers['update-check-now']();",
  "  await sleep(200);",
  "  const stSkip = await ipcHandlers['update-check-now']();",
  "  checkMode = 'ok';",
  "  check('C4a overlapping check reports in-progress', stSkip.message === 'Update check already in progress', stSkip.message);",
  "  await p1;",
  "  check('C4b skip audited in update-events log', hasAudit('check-skipped-in-flight'), '');",
  "",
  "  const r0 = await ipcHandlers['update-install-now']();",
  "  check('C5a install refused before download', r0 && r0.ok === false, JSON.stringify(r0));",
  "  fakeAutoUpdater.emit('update-downloaded', { version: '9.9.9' });",
  "  const r1 = await ipcHandlers['update-install-now']();",
  "  check('C5b install accepted after download', r1 && r1.ok === true, JSON.stringify(r1));",
  "  await sleep(500);",
  "  check('C5c quitAndInstall invoked', quitAndInstallCalls === 1, String(quitAndInstallCalls));",
  "  prevented = false;",
  "  windowCloseHandler({ preventDefault: function () { prevented = true; } });",
  "  check('C5d install quit not intercepted by close confirmation', prevented === false);",
  "",
  "  const failed = results.filter(function (r) { return !r.ok; }).length;",
  "  console.log('HARNESS_RESULT ' + JSON.stringify({ results: results }));",
  "  process.exit(failed ? 1 : 0);",
  "})().catch(function (e) {",
  "  console.log('HARNESS_RESULT ' + JSON.stringify({ results: results, fatal: String(e && e.stack || e) }));",
  "  process.exit(2);",
  "});",
  "",
].join('\n');

function runScenario(label, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abaya-update-harness-'));
  let out;
  try {
    // Minimal fake repo root so resolveRepoRoot() accepts it (server.js + install/ + package.json).
    fs.writeFileSync(path.join(tmp, 'server.js'), '// harness stub\n');
    fs.mkdirSync(path.join(tmp, 'install'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'harness-root', version: '0.0.0' }));
    const childPath = path.join(tmp, 'harness-child.cjs');
    fs.writeFileSync(childPath, CHILD_SOURCE);

    const env = Object.assign({}, process.env, extraEnv || {}, {
      ABAYA_REPO_ROOT: tmp,
      HARNESS_MAIN_JS: MAIN_JS,
    });
    // Deterministic feed/channel per scenario.
    delete env.ABAYA_UPDATE_MIRROR_BASE_URL;
    if (!extraEnv || !extraEnv.ABAYA_UPDATE_CHANNEL) delete env.ABAYA_UPDATE_CHANNEL;

    const r = spawnSync(process.execPath, [childPath], { env, encoding: 'utf8', timeout: 60000 });
    const line = String(r.stdout || '')
      .split(/\r?\n/)
      .find((l) => l.startsWith('HARNESS_RESULT '));
    if (!line) {
      out = {
        label,
        fatal:
          'no HARNESS_RESULT (exit ' + String(r.status) + ')' +
          (r.stderr ? '\nstderr: ' + r.stderr.slice(0, 2000) : '') +
          (r.stdout ? '\nstdout: ' + r.stdout.slice(0, 2000) : ''),
        results: [],
      };
    } else {
      out = Object.assign({ label }, JSON.parse(line.slice('HARNESS_RESULT '.length)));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

let totalFail = 0;
for (const scenario of [
  { label: 'stable ring (default)', env: { EXPECT_UPDATER_CHANNEL: 'latest' } },
  { label: 'beta ring (ABAYA_UPDATE_CHANNEL=beta)', env: { ABAYA_UPDATE_CHANNEL: 'beta', EXPECT_UPDATER_CHANNEL: 'beta' } },
]) {
  const out = runScenario(scenario.label, scenario.env);
  console.log('\n=== Scenario: ' + out.label + ' ===');
  if (out.fatal) {
    totalFail += 1;
    console.log('FATAL: ' + out.fatal);
  }
  for (const r of out.results || []) {
    console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  -> ' + r.detail));
    if (!r.ok) totalFail += 1;
  }
}

console.log('\n' + (totalFail === 0 ? 'ALL UPDATE CHECKS PASSED' : String(totalFail) + ' CHECK(S) FAILED'));
process.exit(totalFail === 0 ? 0 : 1);
