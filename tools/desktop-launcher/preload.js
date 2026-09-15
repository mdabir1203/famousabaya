'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('abayaLauncher', {
  startAll() {
    return ipcRenderer.invoke('start-all');
  },
  stopAll() {
    return ipcRenderer.invoke('stop-all');
  },
  status() {
    return ipcRenderer.invoke('status');
  },
  pm2Action(action) {
    return ipcRenderer.invoke('pm2-action', action);
  },
  syncStatus() {
    return ipcRenderer.invoke('sync-status');
  },
  reconcileNow() {
    return ipcRenderer.invoke('reconcile-now');
  },
  startDispatch() {
    return ipcRenderer.invoke('dispatch-start');
  },
  stopDispatch() {
    return ipcRenderer.invoke('dispatch-stop');
  },
  dispatchStatus() {
    return ipcRenderer.invoke('dispatch-status');
  },
  openUrl(url) {
    return ipcRenderer.invoke('open-url', url);
  },
  getDefaults() {
    return ipcRenderer.invoke('get-defaults');
  },
  getMode() {
    return ipcRenderer.invoke('get-mode');
  },
  setMode(mode) {
    return ipcRenderer.invoke('set-mode', mode);
  },
  getReleaseMoment() {
    return ipcRenderer.invoke('get-release-moment');
  },
  windowMinimize() {
    return ipcRenderer.invoke('window-minimize');
  },
  windowToggleMaximize() {
    return ipcRenderer.invoke('window-toggle-maximize');
  },
  windowClose() {
    return ipcRenderer.invoke('window-close');
  },
  confirmWindowClose(shouldClose) {
    return ipcRenderer.invoke('confirm-window-close', !!shouldClose);
  },
  windowIsMaximized() {
    return ipcRenderer.invoke('window-is-maximized');
  },
  updateStatus() {
    return ipcRenderer.invoke('update-status');
  },
  updateCheckNow() {
    return ipcRenderer.invoke('update-check-now');
  },
  updateInstallNow() {
    return ipcRenderer.invoke('update-install-now');
  },
  // v1.2.40 — bypass the electron-updater code-signature check by downloading
  // latest.yml + the EXE directly from the configured cloud R2 feed, verifying
  // SHA-512 against the manifest, then running NSIS silently. The bootstrap
  // script `install/REPAIR-UPDATER-BOOTSTRAP.ps1` ships in the artifacts;
  // this IPC just shells out to it. Exists so a stuck self-signed autoupdater
  // never strands a factory laptop permanently. See docs/releases/v1.2.40.md.
  updateForceInstallFromCloud() {
    return ipcRenderer.invoke('update-force-install-from-cloud');
  },
  // v1.2.42 — Rollback chooser. List every published version available on
  // the feed (sourced from versions-manifest.json with a latest.yml fallback)
  // and direct-bootstrap-install any picked version. Both modes are safe to
  // use even when available > current (then it acts as a regular "install
  // latest" button).
  updateListVersions() {
    return ipcRenderer.invoke('update-list-versions');
  },
  updateInstallVersion(versionEntry) {
    return ipcRenderer.invoke('update-install-version', versionEntry);
  },
  dismissUpdateSuccess() {
    return ipcRenderer.invoke('dismiss-update-success');
  },
  exportDiagnostics() {
    return ipcRenderer.invoke('export-diagnostics');
  },
  // Support-ticket API (v1.2.24+). The renderer's support.js uses these
  // to talk to the local server (which proxies /api/tickets/* to the cloud
  // Worker). Going through the main process keeps the renderer from having
  // to know the server's port or do CORS gymnastics.
  getApiBaseUrl() {
    return ipcRenderer.invoke('get-api-base-url');
  },
  apiFetch(path, opts) {
    return ipcRenderer.invoke('api-fetch', { path, opts: opts || {} });
  },
  // Convenience: open a URL in the user's default browser. Used by the
  // Support tab to launch wa.me after creating a ticket.
  openExternal(url) {
    return ipcRenderer.invoke('open-url', url);
  },
  onProcLog(fn) {
    ipcRenderer.removeAllListeners('proc-log');
    ipcRenderer.on('proc-log', (_e, payload) => fn(payload));
  },
  onProcLogBatch(fn) {
    ipcRenderer.removeAllListeners('proc-log-batch');
    ipcRenderer.on('proc-log-batch', (_e, payload) => fn(payload));
  },
  onUpdateStatus(fn) {
    ipcRenderer.removeAllListeners('update-status');
    ipcRenderer.on('update-status', (_e, payload) => fn(payload));
  },
  onRequestWindowCloseConfirmation(fn) {
    ipcRenderer.removeAllListeners('request-window-close-confirmation');
    ipcRenderer.on('request-window-close-confirmation', () => fn());
  },
});
