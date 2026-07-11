'use strict';

const srvEl = document.getElementById('serverLog');
const watchEl = document.getElementById('watcherLog');
const badge = document.getElementById('statusBadge');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const serverPidEl = document.getElementById('serverPid');
const watcherPidEl = document.getElementById('watcherPid');
const portHealthEl = document.getElementById('portHealth');
const portPidsEl = document.getElementById('portPids');
const serverDot = document.getElementById('serverDot');
const watcherDot = document.getElementById('watcherDot');
const btnWinMin = document.getElementById('btnWinMin');
const btnWinMax = document.getElementById('btnWinMax');
const btnWinClose = document.getElementById('btnWinClose');
const updateBadge = document.getElementById('updateBadge');
const updateDetails = document.getElementById('updateDetails');
const updateProgress = document.getElementById('updateProgress');
const updateProgressFill = document.getElementById('updateProgressFill');
const btnUpdateCheck = document.getElementById('btnUpdateCheck');
const btnUpdateInstall = document.getElementById('btnUpdateInstall');
const btnReleaseNotes = document.getElementById('btnReleaseNotes');
const btnExportDiagnostics = document.getElementById('btnExportDiagnostics');
const updateSuccessBanner = document.getElementById('updateSuccessBanner');
const updateSuccessText = document.getElementById('updateSuccessText');
const btnDismissUpdateSuccess = document.getElementById('btnDismissUpdateSuccess');
const trustLastChecked = document.getElementById('trustLastChecked');
const trustNextCheck = document.getElementById('trustNextCheck');
const trustRetryIn = document.getElementById('trustRetryIn');
const trustLastError = document.getElementById('trustLastError');
const trustNotesHint = document.getElementById('trustNotesHint');
const syncModeEl = document.getElementById('syncMode');
const syncPendingEl = document.getElementById('syncPending');
const syncReconcileEl = document.getElementById('syncReconcile');
const syncSnapshotEl = document.getElementById('syncSnapshot');
const tileSyncMode = document.getElementById('tileSyncMode');
const tileQueue = document.getElementById('tileQueue');
const tileReconcile = document.getElementById('tileReconcile');
const tileSnapshot = document.getElementById('tileSnapshot');
const pm2Pill = document.getElementById('pm2Pill');
const pm2ServerPill = document.getElementById('pm2Server');
const pm2WatcherPill = document.getElementById('pm2Watcher');
const pm2TunnelPill = document.getElementById('pm2Tunnel');
const alertsPill = document.getElementById('alertsPill');
const btnReconcile = document.getElementById('btnReconcile');
const btnPm2Reload = document.getElementById('btnPm2Reload');
const btnPm2Restart = document.getElementById('btnPm2Restart');
const closeConfirm = document.getElementById('closeConfirm');
const closeConfirmDialog = document.querySelector('.close-confirm__dialog');
const btnCloseCancel = document.getElementById('btnCloseCancel');
const btnCloseConfirm = document.getElementById('btnCloseConfirm');

const MAX_CHARS = 120000;
const STATUS_INTERVAL_MS = 2500;
const SYNC_INTERVAL_MS = 5000;
let statusTimer = null;
let syncTimer = null;
let trustTickTimer = null;
/** @type {Record<string, unknown> | null} */
let lastUpdatePayload = null;
let closeConfirmOpen = false;
let closeConfirmEnableTimer = null;
let closeConfirmAudioCtx = null;

function append(which, text) {
  const el = which === 'watcher' ? watchEl : srvEl;
  el.textContent += text;
  if (el.textContent.length > MAX_CHARS) {
    el.textContent = el.textContent.slice(-MAX_CHARS);
  }
  el.scrollTop = el.scrollHeight;
}

function pidText(v) {
  return Number.isFinite(v) && v > 0 ? String(v) : '-';
}

function applyStatus(st) {
  const serverUp = !!st.serverRunning;
  const watcherUp = !!st.watcherRunning;
  const anyUp = serverUp || watcherUp;
  const pm2 = (st && st.pm2) || { available: false };
  const pm2Server = pm2.apps ? pm2.apps.find(function (a) { return a.name === 'abaya-server'; }) : null;
  const pm2Watcher = pm2.apps ? pm2.apps.find(function (a) { return a.name === 'catalog-watcher'; }) : null;
  const pm2Tunnel = pm2.apps ? pm2.apps.find(function (a) { return a.name === 'cloudflared-tunnel'; }) : null;

  badge.classList.remove('running', 'partial');
  if (serverUp && (watcherUp || !st.watcherPid)) {
    badge.textContent = pm2.managedServer ? 'Running (PM2)' : 'Running';
    badge.classList.add('running');
  } else if (anyUp) {
    badge.textContent = 'Partial';
    badge.classList.add('partial');
  } else {
    badge.textContent = 'Stopped';
  }

  serverDot.classList.toggle('ok', serverUp);
  watcherDot.classList.toggle('ok', watcherUp);

  serverPidEl.textContent = pidText(st.serverPid);
  watcherPidEl.textContent = pidText(st.watcherPid);

  const port = Number(st.port) || 0;
  const busy = !!st.portBusy;
  portHealthEl.textContent = port > 0 ? (busy ? ':' + port + ' busy' : ':' + port + ' free') : '-';

  const pids = Array.isArray(st.portPids) ? st.portPids.filter(Number.isFinite) : [];
  portPidsEl.textContent = pids.length ? pids.join(', ') : '-';

  // PM2 pills
  if (pm2Pill) {
    pm2Pill.classList.remove('ok', 'bad');
    if (!pm2.available) {
      pm2Pill.textContent = 'PM2: not installed';
      pm2Pill.classList.add('bad');
    } else if (pm2.managedServer) {
      pm2Pill.textContent = 'PM2: managing';
      pm2Pill.classList.add('ok');
    } else {
      pm2Pill.textContent = 'PM2: idle';
    }
  }
  function setAppPill(el, label, app) {
    if (!el) return;
    el.classList.remove('ok', 'bad');
    if (!app) { el.textContent = label + ': -'; return; }
    el.textContent = label + ': ' + (app.status || 'unknown');
    if (app.status === 'online') el.classList.add('ok');
    else if (app.status === 'errored' || app.status === 'stopped') el.classList.add('bad');
  }
  setAppPill(pm2ServerPill, 'server', pm2Server);
  setAppPill(pm2WatcherPill, 'watcher', pm2Watcher);
  setAppPill(pm2TunnelPill, 'tunnel', pm2Tunnel);

  // The "Start Runtime" button text reflects the boot model.
  if (btnStart) {
    if (pm2.available && pm2.managedServer) {
      btnStart.textContent = 'PM2 already running';
    } else if (pm2.available) {
      btnStart.textContent = 'Start (via PM2)';
    } else {
      btnStart.textContent = 'Start Runtime';
    }
  }
}

function fmtAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const sec = Math.floor(ms / 1000);
  if (sec < 90) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 90) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 36) return hr + 'h ago';
  return Math.floor(hr / 24) + 'd ago';
}

function applySyncStatus(payload) {
  if (!payload || !payload.ok) {
    if (syncModeEl) syncModeEl.textContent = 'offline';
    if (syncPendingEl) syncPendingEl.textContent = '-';
    if (syncReconcileEl) syncReconcileEl.textContent = '-';
    if (syncSnapshotEl) syncSnapshotEl.textContent = '-';
    if (alertsPill) {
      alertsPill.textContent = 'alerts: -';
      alertsPill.classList.remove('ok', 'bad');
    }
    if (tileSyncMode) tileSyncMode.classList.remove('warn', 'bad');
    if (tileQueue) tileQueue.classList.remove('warn', 'bad');
    if (tileReconcile) tileReconcile.classList.remove('warn', 'bad');
    if (tileSnapshot) tileSnapshot.classList.remove('warn', 'bad');
    return;
  }
  const data = payload.data || {};
  const mode = String(data.mode || '-');
  const pending = Number(data.pending) || 0;
  const reconcile = data.reconcile || {};
  const reconcileLast = reconcile.status && reconcile.status.lastResult ? reconcile.status.lastResult : null;
  const snap = data.sqliteSnapshot || {};
  const alerts = data.alerts || {};

  if (syncModeEl) syncModeEl.textContent = mode;
  if (tileSyncMode) {
    tileSyncMode.classList.remove('warn', 'bad');
    if (mode === 're-syncing') tileSyncMode.classList.add('warn');
    if (mode === 'local-cache-fallback') tileSyncMode.classList.add('bad');
  }
  if (syncPendingEl) syncPendingEl.textContent = String(pending);
  if (tileQueue) {
    tileQueue.classList.remove('warn', 'bad');
    if (pending > 0 && pending < 25) tileQueue.classList.add('warn');
    if (pending >= 25) tileQueue.classList.add('bad');
  }
  if (syncReconcileEl) {
    if (!reconcile.enabled) {
      syncReconcileEl.textContent = 'disabled';
    } else if (!reconcileLast) {
      syncReconcileEl.textContent = 'pending first run';
    } else {
      const r = reconcileLast;
      const ok = !!r.ok;
      const tag = ok ? 'ok' : (r.error || 'fail');
      syncReconcileEl.textContent = tag + ' · push:' + (r.replayed_finishes + r.replayed_starts) +
        ' · cf:' + r.conflicts_resolved_local;
    }
  }
  if (tileReconcile) {
    tileReconcile.classList.remove('warn', 'bad');
    if (reconcileLast && !reconcileLast.ok) tileReconcile.classList.add('bad');
    else if (reconcileLast && reconcileLast.hard_failures > 0) tileReconcile.classList.add('warn');
  }
  if (syncSnapshotEl) {
    if (!snap.enabled) {
      syncSnapshotEl.textContent = 'disabled';
    } else if (snap.lastErr) {
      syncSnapshotEl.textContent = 'error: ' + (snap.lastErr.message || 'unknown');
    } else if (snap.lastOk && snap.lastOk.at) {
      syncSnapshotEl.textContent = 'ok · ' + fmtAge(Date.now() - snap.lastOk.at);
    } else {
      syncSnapshotEl.textContent = 'pending';
    }
  }
  if (tileSnapshot) {
    tileSnapshot.classList.remove('warn', 'bad');
    if (snap.lastErr) tileSnapshot.classList.add('bad');
    else if (snap.enabled && snap.lastOk && Date.now() - snap.lastOk.at > 6 * 60 * 60 * 1000) {
      tileSnapshot.classList.add('warn');
    }
  }
  if (alertsPill) {
    alertsPill.classList.remove('ok', 'bad');
    if (!alerts.enabled) {
      alertsPill.textContent = 'alerts: off';
    } else if (!alerts.initialized) {
      alertsPill.textContent = 'alerts: pending';
      alertsPill.classList.add('warn');
    } else {
      const sent = Number(alerts.sent) || 0;
      const dry = alerts.dryRun ? ' (dry)' : '';
      alertsPill.textContent = 'alerts: ' + sent + ' sent' + dry;
      alertsPill.classList.add('ok');
    }
  }
}

async function refreshStatus() {
  try {
    const st = await window.abayaLauncher.status();
    applyStatus(st || {});
  } catch (e) {
    append('server', '\n[status] failed: ' + String(e && e.message ? e.message : e) + '\n');
  }
}

async function refreshSyncStatus() {
  if (!window.abayaLauncher.syncStatus) return;
  try {
    const r = await window.abayaLauncher.syncStatus();
    applySyncStatus(r || { ok: false });
  } catch (_) {
    applySyncStatus({ ok: false });
  }
}

function bindLinks(port) {
  document.querySelectorAll('[data-url]').forEach(function (b) {
    const tmpl = b.getAttribute('data-url');
    const u = tmpl.replace('PORT_PLACEHOLDER', String(port));
    b.onclick = function () {
      window.abayaLauncher.openUrl(u);
    };
  });
}

var RM_NS = 'abaya_release_dismiss_';

function releaseSpotlightMotionOn(wrap) {
  if (!wrap) return;
  wrap.classList.remove('release-spotlight--motion');
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (_) {}
  wrap.classList.add('release-spotlight--motion');
}

async function applyReleaseMomentSpotlight(port) {
  var wrap = document.getElementById('releaseMomentSpotlight');
  var eyebrow = document.getElementById('rmEyebrow');
  var hook = document.getElementById('rmHook');
  var outcome = document.getElementById('rmOutcome');
  var btnPri = document.getElementById('rmPrimary');
  var btnSec = document.getElementById('rmSecondary');
  var btnDismiss = document.getElementById('rmDismiss');
  if (!wrap || !window.abayaLauncher.getReleaseMoment) return;
  var p = Number(port) || 3000;
  var base = 'http://127.0.0.1:' + p;
  try {
    var d = await window.abayaLauncher.getReleaseMoment();
    if (!d || !d.enabled || !d.momentId) {
      wrap.style.display = 'none';
      return;
    }
    try {
      if (localStorage.getItem(RM_NS + d.momentId)) {
        wrap.style.display = 'none';
        return;
      }
    } catch (_) {}
    releaseSpotlightMotionOn(wrap);
    if (eyebrow) eyebrow.textContent = d.eyebrow || 'Update';
    if (hook) hook.textContent = d.hook || '';
    if (outcome) outcome.textContent = d.outcome || '';
    if (btnPri) {
      btnPri.textContent = d.ctaLabel || 'Explore';
      var priPath = String(d.ctaPath || '/dashboard.html');
      if (!priPath.startsWith('/')) priPath = '/' + priPath;
      btnPri.onclick = function () {
        window.abayaLauncher.openUrl(base + priPath);
      };
    }
    if (btnSec) {
      var p2 = String(d.secondaryCtaPath || '').trim();
      var l2 = String(d.secondaryCtaLabel || '').trim();
      if (p2 && l2) {
        btnSec.style.display = 'inline-flex';
        btnSec.textContent = l2;
        if (!p2.startsWith('/')) p2 = '/' + p2;
        btnSec.onclick = function () {
          window.abayaLauncher.openUrl(base + p2);
        };
      } else {
        btnSec.style.display = 'none';
        btnSec.onclick = null;
      }
    }
    if (btnDismiss) {
      btnDismiss.onclick = function () {
        try {
          localStorage.setItem(RM_NS + d.momentId, '1');
        } catch (_) {}
        wrap.style.display = 'none';
      };
    }
    wrap.style.display = 'block';
  } catch (_) {
    wrap.style.display = 'none';
  }
}

function beginStatusLoop() {
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(refreshStatus, STATUS_INTERVAL_MS);
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(refreshSyncStatus, SYNC_INTERVAL_MS);
  if (trustTickTimer) clearInterval(trustTickTimer);
  trustTickTimer = setInterval(function () {
    if (lastUpdatePayload) applyTrustCells(lastUpdatePayload);
  }, 1000);
}

function fmtTs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  try {
    return new Date(ms).toLocaleString();
  } catch (_) {
    return '-';
  }
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const sec = Math.ceil(ms / 1000);
  if (sec < 120) return sec + 's';
  const min = Math.ceil(sec / 60);
  if (min < 120) return min + 'm';
  const hr = Math.ceil(min / 60);
  return hr + 'h';
}

function applyTrustCells(st) {
  if (!trustLastChecked || !trustNextCheck || !trustRetryIn || !trustLastError || !trustNotesHint) return;
  const status = st || {};
  trustLastChecked.textContent = fmtTs(Number(status.lastCheckedAt) || 0);
  trustNextCheck.textContent = fmtTs(Number(status.nextCheckAt) || 0);
  const next = Number(status.nextCheckAt) || 0;
  const now = Date.now();
  const retryMs = next > now ? next - now : Number(status.retryInMs) || 0;
  trustRetryIn.textContent = retryMs > 0 ? fmtDuration(retryMs) : '-';
  const errAt = Number(status.lastErrorAt) || 0;
  const errMsg = String(status.lastErrorMessage || status.error || '').trim();
  if (errMsg) {
    trustLastError.textContent = (errAt ? fmtTs(errAt) + ' · ' : '') + errMsg.slice(0, 220);
  } else {
    trustLastError.textContent = '-';
  }
  const url = String(status.releaseNotesUrl || '').trim();
  trustNotesHint.textContent = url ? 'Use Release notes' : '-';
}

function applyUpdateStatus(st) {
  const status = st || {};
  lastUpdatePayload = status;
  const phase = String(status.phase || 'idle');
  const currentVersion = String(status.version || '-');
  const availableVersion = String(status.availableVersion || '-');
  const channel = String(status.channel || 'stable');
  const msg = String(status.message || '');
  const pctRaw = Number(status.progress);
  const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, pctRaw)) : 0;

  if (updateBadge) {
    updateBadge.textContent = status.enabled ? phase : 'disabled';
  }
  if (updateDetails) {
    const feed = String(status.updateFeedSource || '-').trim() || '-';
    const probe = status.updateMirrorProbeOk ? 'probe:ok' : 'probe:' + String(status.updateMirrorProbeMessage || '-').slice(0, 80);
    updateDetails.textContent =
      'Feed: ' +
      feed +
      ' | ' +
      probe +
      ' | Channel: ' +
      channel +
      ' | Current: ' +
      currentVersion +
      ' | Available: ' +
      availableVersion +
      (msg ? ' | ' + msg : '');
  }
  if (updateProgress && updateProgressFill) {
    updateProgressFill.style.width = pct.toFixed(1) + '%';
    updateProgress.title = pct.toFixed(1) + '%';
  }
  if (btnUpdateInstall) {
    btnUpdateInstall.disabled = !status.downloaded;
  }
  if (btnReleaseNotes) {
    const url = String(status.releaseNotesUrl || '').trim();
    btnReleaseNotes.disabled = !url;
  }
  applyTrustCells(status);

  if (updateSuccessBanner && updateSuccessText) {
    if (status.updateJustApplied) {
      updateSuccessBanner.classList.add('show');
      updateSuccessText.textContent =
        'Update applied successfully. Previous: ' +
        String(status.updateAppliedFromVersion || '?') +
        ' · Current: ' +
        currentVersion;
    } else {
      updateSuccessBanner.classList.remove('show');
    }
  }
}

async function syncWindowButtons() {
  if (!btnWinMax || !window.abayaLauncher.windowIsMaximized) return;
  const isMax = await window.abayaLauncher.windowIsMaximized();
  btnWinMax.textContent = isMax ? '❐' : '□';
  btnWinMax.title = isMax ? 'Restore' : 'Maximize';
}

function stopStatusLoop() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (trustTickTimer) {
    clearInterval(trustTickTimer);
    trustTickTimer = null;
  }
}

function resetCloseConfirmButtonState() {
  if (!btnCloseConfirm) return;
  btnCloseConfirm.disabled = false;
  btnCloseConfirm.textContent = 'Yes, Close Now';
}

function clearCloseConfirmEnableTimer() {
  if (!closeConfirmEnableTimer) return;
  clearTimeout(closeConfirmEnableTimer);
  closeConfirmEnableTimer = null;
}

function playCloseConfirmBeep() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
  } catch (_) {}
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!closeConfirmAudioCtx) closeConfirmAudioCtx = new Ctx();
    const ctx = closeConfirmAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.connect(ctx.destination);
    function chirp(startAt, freq, dur) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, startAt);
      osc.connect(gain);
      osc.start(startAt);
      osc.stop(startAt + dur);
    }
    gain.gain.exponentialRampToValueAtTime(0.065, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.19);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    chirp(now, 890, 0.15);
    chirp(now + 0.17, 720, 0.15);
  } catch (_) {}
}

function armCloseConfirmDelay() {
  if (!btnCloseConfirm) return;
  clearCloseConfirmEnableTimer();
  btnCloseConfirm.disabled = true;
  btnCloseConfirm.textContent = 'Stand by...';
  playCloseConfirmBeep();
  closeConfirmEnableTimer = setTimeout(function () {
    btnCloseConfirm.disabled = false;
    btnCloseConfirm.textContent = 'Yes, Close Now';
    if (closeConfirmOpen) btnCloseConfirm.focus();
    closeConfirmEnableTimer = null;
  }, 1000);
}

function hideCloseConfirm() {
  if (!closeConfirm) return;
  closeConfirm.classList.remove('show');
  if (closeConfirmDialog) closeConfirmDialog.classList.remove('shake-on-open');
  closeConfirmOpen = false;
  clearCloseConfirmEnableTimer();
  resetCloseConfirmButtonState();
}

function showCloseConfirm() {
  if (!closeConfirm) return;
  if (closeConfirmDialog) {
    closeConfirmDialog.classList.remove('shake-on-open');
    void closeConfirmDialog.offsetWidth;
    closeConfirmDialog.classList.add('shake-on-open');
  }
  closeConfirm.classList.add('show');
  closeConfirmOpen = true;
  armCloseConfirmDelay();
}

(async function init() {
  const defs = await window.abayaLauncher.getDefaults();
  bindLinks(defs.port);
  await applyReleaseMomentSpotlight(defs.port);
  applyUpdateStatus(await window.abayaLauncher.updateStatus());

  btnStart.onclick = async function () {
    btnStart.disabled = true;
    append('server', '\n[start] boot sequence initiated...\n');
    const r = await window.abayaLauncher.startAll();
    if (!r.ok) append('server', '[start] ' + (r.error || 'failed') + '\n');
    await refreshStatus();
    btnStart.disabled = false;
  };

  btnStop.onclick = async function () {
    btnStop.disabled = true;
    append('server', '\n[stop] stopping processes and freeing port...\n');
    await window.abayaLauncher.stopAll();
    await refreshStatus();
    btnStop.disabled = false;
  };

  // ── Dispatch (Bun) server controls ──────────────────────────────────────────
  var btnDispatchStart = document.getElementById('btnDispatchStart');
  var btnDispatchStop = document.getElementById('btnDispatchStop');
  var dispatchPill = document.getElementById('dispatchPill');

  async function refreshDispatchStatus() {
    if (!dispatchPill || !window.abayaLauncher.dispatchStatus) return;
    try {
      var s = await window.abayaLauncher.dispatchStatus();
      var label = s.running ? (s.external ? 'running (external) :' + s.port : 'running :' + s.port) : 'stopped';
      dispatchPill.textContent = 'Dispatch (Bun): ' + label;
      if (btnDispatchStart) btnDispatchStart.disabled = !!s.running;
      if (btnDispatchStop) btnDispatchStop.disabled = !s.launcherOwned;
    } catch (_) {}
  }

  if (btnDispatchStart) btnDispatchStart.onclick = async function () {
    btnDispatchStart.disabled = true;
    append('server', '\n[dispatch] starting Bun dispatch server...\n');
    var r = await window.abayaLauncher.startDispatch();
    if (r && !r.ok) append('server', '[dispatch] ' + (r.error || 'failed') + '\n');
    else if (r && r.already) append('server', '[dispatch] already running' + (r.external ? ' (external)' : '') + '\n');
    await refreshDispatchStatus();
  };

  if (btnDispatchStop) btnDispatchStop.onclick = async function () {
    btnDispatchStop.disabled = true;
    await window.abayaLauncher.stopDispatch();
    await refreshDispatchStatus();
  };

  refreshDispatchStatus();
  setInterval(refreshDispatchStatus, 5000);

  if (btnWinMin) {
    btnWinMin.onclick = function () {
      window.abayaLauncher.windowMinimize();
    };
  }
  if (btnWinMax) {
    btnWinMax.onclick = async function () {
      await window.abayaLauncher.windowToggleMaximize();
      await syncWindowButtons();
    };
  }
  if (btnWinClose) {
    btnWinClose.onclick = function () {
      showCloseConfirm();
    };
  }
  if (btnCloseCancel) {
    btnCloseCancel.onclick = async function () {
      hideCloseConfirm();
      if (window.abayaLauncher.confirmWindowClose) {
        await window.abayaLauncher.confirmWindowClose(false);
      }
    };
  }
  if (btnCloseConfirm) {
    btnCloseConfirm.onclick = async function () {
      hideCloseConfirm();
      if (window.abayaLauncher.confirmWindowClose) {
        await window.abayaLauncher.confirmWindowClose(true);
      } else {
        window.abayaLauncher.windowClose();
      }
    };
  }
  if (closeConfirm) {
    closeConfirm.addEventListener('click', function (ev) {
      if (ev.target === closeConfirm && btnCloseCancel) {
        btnCloseCancel.click();
      }
    });
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && closeConfirmOpen && btnCloseCancel) {
      ev.preventDefault();
      btnCloseCancel.click();
    }
  });

  if (btnUpdateCheck) {
    btnUpdateCheck.onclick = async function () {
      btnUpdateCheck.disabled = true;
      const st = await window.abayaLauncher.updateCheckNow();
      if (st) applyUpdateStatus(st);
      btnUpdateCheck.disabled = false;
    };
  }
  if (btnUpdateInstall) {
    btnUpdateInstall.onclick = async function () {
      btnUpdateInstall.disabled = true;
      const r = await window.abayaLauncher.updateInstallNow();
      if (!r || !r.ok) append('server', '\n[update] ' + (r && r.error ? r.error : 'install failed') + '\n');
      btnUpdateInstall.disabled = false;
    };
  }
  if (btnReleaseNotes && window.abayaLauncher.openUrl) {
    btnReleaseNotes.onclick = async function () {
      const st = lastUpdatePayload || (await window.abayaLauncher.updateStatus());
      const url = String((st && st.releaseNotesUrl) || '').trim();
      if (url) window.abayaLauncher.openUrl(url);
    };
  }
  if (btnExportDiagnostics && window.abayaLauncher.exportDiagnostics) {
    btnExportDiagnostics.onclick = async function () {
      btnExportDiagnostics.disabled = true;
      append('server', '\n[diagnostics] export requested...\n');
      const r = await window.abayaLauncher.exportDiagnostics();
      if (r && r.ok) append('server', '[diagnostics] saved: ' + r.path + '\n');
      else append('server', '[diagnostics] ' + (r && r.error ? r.error : 'failed') + '\n');
      btnExportDiagnostics.disabled = false;
    };
  }
  if (btnDismissUpdateSuccess && window.abayaLauncher.dismissUpdateSuccess) {
    btnDismissUpdateSuccess.onclick = async function () {
      await window.abayaLauncher.dismissUpdateSuccess();
      if (lastUpdatePayload) {
        lastUpdatePayload = Object.assign({}, lastUpdatePayload, { updateJustApplied: false });
      }
      applyUpdateStatus(lastUpdatePayload || {});
    };
  }

  if (btnReconcile) {
    btnReconcile.onclick = async function () {
      btnReconcile.disabled = true;
      append('server', '\n[reconcile] manual run requested...\n');
      const r = await window.abayaLauncher.reconcileNow();
      if (r && !r.ok) append('server', '[reconcile] ' + (r.error || 'failed') + '\n');
      await refreshSyncStatus();
      btnReconcile.disabled = false;
    };
  }
  if (btnPm2Reload) {
    btnPm2Reload.onclick = async function () {
      btnPm2Reload.disabled = true;
      append('server', '\n[pm2] reload ecosystem.config.cjs...\n');
      const r = await window.abayaLauncher.pm2Action('reload');
      if (r && !r.ok) append('server', '[pm2] reload failed: ' + (r.error || '') + '\n');
      await refreshStatus();
      btnPm2Reload.disabled = false;
    };
  }
  if (btnPm2Restart) {
    btnPm2Restart.onclick = async function () {
      btnPm2Restart.disabled = true;
      append('server', '\n[pm2] restart ecosystem.config.cjs...\n');
      const r = await window.abayaLauncher.pm2Action('restart');
      if (r && !r.ok) append('server', '[pm2] restart failed: ' + (r.error || '') + '\n');
      await refreshStatus();
      btnPm2Restart.disabled = false;
    };
  }

  window.abayaLauncher.onProcLog(function (p) {
    append(p.which === 'watcher' ? 'watcher' : 'server', p.text);
  });
  window.abayaLauncher.onUpdateStatus(function (st) {
    applyUpdateStatus(st);
  });
  if (window.abayaLauncher.onRequestWindowCloseConfirmation) {
    window.abayaLauncher.onRequestWindowCloseConfirmation(function () {
      showCloseConfirm();
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      beginStatusLoop();
      refreshStatus();
    } else {
      stopStatusLoop();
    }
  });

  beginStatusLoop();
  await refreshStatus();
  await refreshSyncStatus();
  await syncWindowButtons();
})();
