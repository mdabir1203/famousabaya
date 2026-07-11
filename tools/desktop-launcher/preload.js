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
  dismissUpdateSuccess() {
    return ipcRenderer.invoke('dismiss-update-success');
  },
  exportDiagnostics() {
    return ipcRenderer.invoke('export-diagnostics');
  },
  onProcLog(fn) {
    ipcRenderer.removeAllListeners('proc-log');
    ipcRenderer.on('proc-log', (_e, payload) => fn(payload));
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
