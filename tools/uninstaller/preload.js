'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uninstaller', {
  getInventory: function () { return ipcRenderer.invoke('inventory:build'); },
  buildPlan: function (choices) { return ipcRenderer.invoke('plan:build', choices); },
  apply: function (plan) { return ipcRenderer.invoke('apply:run', plan); },
  pickEnvSavePath: function () { return ipcRenderer.invoke('dialog:saveEnv'); },
  copyEnvTo: function (dest) { return ipcRenderer.invoke('env:export', dest); },
  openAuditLog: function () { return ipcRenderer.invoke('ui:openAudit'); },
  formatBytes: function (n) {
    if (n == null || !Number.isFinite(n)) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },
});
