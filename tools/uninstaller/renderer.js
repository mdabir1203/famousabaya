'use strict';

/**
 * Renderer: collects the user's choices, asks the main process to build
 * the action plan, then confirms before applying.
 *
 * Choices are stored on a per-row data attribute and re-read when the
 * user clicks Apply. All destruction is opt-in per item; the default
 * is keep.
 */

const $ = function (id) { return document.getElementById(id); };
const fmt = window.uninstaller.formatBytes;

let inventory = null;
let lastResults = null;

async function init() {
  try {
    inventory = await window.uninstaller.getInventory();
    render();
  } catch (e) {
    $('headerSub').textContent = 'Detection failed: ' + (e && e.message || e);
  }
}

function render() {
  const headerSub = $('headerSub');
  if (!inventory.install.found && !inventory.appData.factoryData.exists && !inventory.appData.envFile.exists && !inventory.appData.launcherCache.exists) {
    headerSub.textContent = 'No AbaYa Track installation or data found on this PC.';
    $('detectBanner').style.display = 'block';
    $('detectBanner').textContent = 'Nothing to do. Close this window when ready.';
    $('detectBanner').className = 'banner ok';
    $('applyBtn').disabled = true;
    return;
  }
  const bits = [];
  if (inventory.install.found) bits.push('App v' + (inventory.app.version || '?') + ' at ' + inventory.install.installDir);
  if (inventory.appData.factoryData.exists) bits.push('factory-data ' + fmt(inventory.appData.factoryData.bytes));
  if (inventory.appData.envFile.exists) bits.push('.env ' + fmt(inventory.appData.envFile.bytes));
  if (inventory.appData.launcherCache.exists) bits.push('launcher cache ' + fmt(inventory.appData.launcherCache.bytes));
  headerSub.textContent = bits.length ? ('Found: ' + bits.join(' \u2022 ')) : 'No AbaYa Track installation or data found.';
  if (inventory.running.factoryServer.length || inventory.running.catalogWatcher.length || inventory.running.dispatchServer.length || inventory.running.tunnel.length) {
    const n = inventory.running.factoryServer.length + inventory.running.catalogWatcher.length + inventory.running.dispatchServer.length + inventory.running.tunnel.length;
    $('detectBanner').style.display = 'block';
    $('detectBanner').className = 'banner warn';
    $('detectBanner').textContent = n + ' AbaYa Track process(es) are still running. Stop them before uninstall to avoid file locks.';
  }
  const groups = $('groups');
  groups.innerHTML = '';
  groups.appendChild(renderRunningGroup());
  groups.appendChild(renderDataGroup());
  groups.appendChild(renderInstallGroup());
  updateFooter();
}

function row(label, path, sizeBytes, meta) {
  const div = document.createElement('div');
  div.className = 'row';
  div.dataset.choice = 'keep';
  div.innerHTML =
    '<div class="label">' +
      '<div class="name">' + label + (meta ? ' <span class="pill-tag">' + meta + '</span>' : '') + '</div>' +
      '<div class="path">' + escape(path || '(not found)') + '</div>' +
    '</div>' +
    '<div class="size">' + fmt(sizeBytes || 0) + '</div>' +
    '<div class="actions">' +
      '<label class="choice"><input type="radio" name="c_' + div.dataset.id + '" value="keep" checked> Keep</label>' +
      '<label class="choice danger"><input type="radio" name="c_' + div.dataset.id + '" value="wipe"> Wipe</label>' +
    '</div>';
  return div;
}

function setRowId(rowEl, id) {
  rowEl.dataset.id = id;
  const radios = rowEl.querySelectorAll('input[type=radio]');
  radios.forEach((r) => { r.name = 'c_' + id; });
  rowEl.addEventListener('change', updateFooter);
}

function renderRunningGroup() {
  const g = document.createElement('div');
  g.className = 'group';
  g.innerHTML = '<h2>Running processes <span class="pill">stop before uninstall</span></h2>';
  const procs = []
    .concat(inventory.running.factoryServer)
    .concat(inventory.running.catalogWatcher)
    .concat(inventory.running.dispatchServer)
    .concat(inventory.running.tunnel);
  if (!procs.length) {
    g.innerHTML += '<div class="empty">None detected.</div>';
    return g;
  }
  // Dedupe by pid
  const seen = new Set();
  procs.forEach((p) => {
    if (seen.has(p.pid)) return;
    seen.add(p.pid);
    const r = row(p.name + ' (pid ' + p.pid + ')', '', 0, 'process');
    setRowId(r, 'pid_' + p.pid);
    r.dataset.pid = String(p.pid);
    r.dataset.pname = p.name;
    g.appendChild(r);
  });
  return g;
}

function renderDataGroup() {
  const g = document.createElement('div');
  g.className = 'group';
  g.innerHTML = '<h2>User data <span class="pill">AppData / Roaming</span></h2>';
  const d = inventory.appData;
  if (d.factoryData.exists) {
    const r = row(
      'factory-data/',
      d.factoryData.path,
      d.factoryData.bytes,
      d.factoryData.dbCount + ' sqlite + ' + d.factoryData.jsonCount + ' json'
    );
    setRowId(r, 'data_dir');
    g.appendChild(r);
  }
  if (d.envFile.exists) {
    const r = row('.env (cloud credentials)', d.envFile.path, d.envFile.bytes, d.envFile.keys.length + ' keys');
    setRowId(r, 'env_file');
    g.appendChild(r);
    // Export button
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn ghost';
    exportBtn.type = 'button';
    exportBtn.style.marginTop = '4px';
    exportBtn.textContent = 'Export .env to a safe location first';
    exportBtn.id = 'exportEnvBtn';
    exportBtn.addEventListener('click', onExportEnv);
    g.appendChild(exportBtn);
  }
  if (d.launcherCache.exists) {
    const r = row('launcher cache (Electron cache, audit log)', d.launcherCache.path, d.launcherCache.bytes, d.launcherCache.files + ' files');
    setRowId(r, 'launcher_cache');
    g.appendChild(r);
  }
  if (!d.factoryData.exists && !d.envFile.exists && !d.launcherCache.exists) {
    g.innerHTML += '<div class="empty">No AppData found at ' + d.root + '.</div>';
  }
  return g;
}

function renderInstallGroup() {
  const g = document.createElement('div');
  g.className = 'group';
  g.innerHTML = '<h2>Install dir <span class="pill">app + bundled photos</span></h2>';
  if (!inventory.install.found) {
    g.innerHTML += '<div class="empty">No install dir found (registry + common paths). NSIS uninstaller not applicable.</div>';
    return g;
  }
  const install = inventory.install;
  const r = row('Install dir', install.installDir, null, 'detected via ' + install.detectedVia);
  setRowId(r, 'install_dir');
  g.appendChild(r);
  // Bundled photos row
  const p = inventory.bundledPhotos;
  const totalBytes = (p.employees.exists ? p.employees.bytes : 0) + (p.items.exists ? p.items.bytes : 0);
  const totalFiles = (p.employees.exists ? p.employees.files : 0) + (p.items.exists ? p.items.files : 0);
  if (totalFiles > 0) {
    const r2 = row('Bundled photos (resources/public/uploads)', null, totalBytes, totalFiles + ' files');
    r2.querySelector('.path').textContent = (p.employees.exists ? p.employees.path : '(none)') + ' + ' + (p.items.exists ? p.items.path : '(none)');
    setRowId(r2, 'bundled_photos');
    g.appendChild(r2);
  }
  return g;
}

function getChoice(rowId) {
  const checked = document.querySelector('input[name="c_' + rowId + '"]:checked');
  return checked ? checked.value : 'keep';
}

function buildChoices() {
  const choices = {
    wipeFactoryData: getChoice('data_dir') === 'wipe',
    wipeEnv: getChoice('env_file') === 'wipe',
    wipeLauncherCache: getChoice('launcher_cache') === 'wipe',
    removeInstall: getChoice('install_dir') === 'wipe',
    wipeBundledPhotos: getChoice('bundled_photos') === 'wipe',
    killPids: [],
  };
  // Pids
  document.querySelectorAll('[data-pid]').forEach((el) => {
    if (getChoice('pid_' + el.dataset.pid) === 'wipe') {
      choices.killPids.push({ pid: Number(el.dataset.pid), name: el.dataset.pname });
    }
  });
  return choices;
}

function updateFooter() {
  const choices = buildChoices();
  const plan = (choices.wipeFactoryData ? 1 : 0)
    + (choices.wipeEnv ? 1 : 0)
    + (choices.wipeLauncherCache ? 1 : 0)
    + (choices.removeInstall ? 1 : 0)
    + (choices.wipeBundledPhotos ? 1 : 0)
    + choices.killPids.length;
  const summary = $('footerSummary');
  if (plan === 0) {
    summary.textContent = 'No destructive actions selected. Click Close if you only wanted to inspect.';
    $('applyBtn').disabled = true;
  } else {
    summary.textContent = plan + ' destructive action(s) queued. Review and click Apply.';
    $('applyBtn').disabled = false;
  }
}

async function onExportEnv() {
  try {
    const r = await window.uninstaller.pickEnvSavePath();
    if (!r || r.canceled || !r.filePath) return;
    const res = await window.uninstaller.copyEnvTo(r.filePath);
    if (res.ok) {
      $('exportEnvBtn').textContent = 'Exported to ' + r.filePath;
      $('exportEnvBtn').disabled = true;
    } else {
      $('exportEnvBtn').textContent = 'Export failed: ' + (res.error || 'unknown');
    }
  } catch (e) {
    $('exportEnvBtn').textContent = 'Export failed: ' + (e && e.message || e);
  }
}

async function onApply() {
  const choices = buildChoices();
  const plan = await window.uninstaller.buildPlan(choices);
  if (!plan.length) {
    $('footerSummary').textContent = 'No actions to perform.';
    return;
  }
  // Show confirmation
  const body = $('confirmBody');
  body.innerHTML = '<p>You are about to perform these actions. This cannot be undone.</p><ul>'
    + plan.map((p) => '<li><strong>' + escape(p.label) + '</strong> &mdash; ' + escape(p.path || ('pid ' + p.pid)) + '</li>').join('')
    + '</ul><p style="margin-top:10px">If you want to back up <code>.env</code> first, close this dialog and use the Export button above.</p>';
  $('confirmOverlay').style.display = 'flex';
  $('confirmOk').onclick = async function () {
    $('confirmOverlay').style.display = 'none';
    $('applyBtn').disabled = true;
    $('footerSummary').textContent = 'Applying...';
    const res = await window.uninstaller.apply(plan);
    lastResults = res;
    showResults(res);
    $('applyBtn').textContent = 'Done';
    $('applyBtn').disabled = true;
  };
  $('confirmCancel').onclick = function () { $('confirmOverlay').style.display = 'none'; };
}

function showResults(res) {
  const main = $('main');
  const div = document.createElement('div');
  div.className = 'results';
  const ok = res.results.filter((r) => r.ok).length;
  const err = res.results.length - ok;
  div.innerHTML = '<div><strong>' + ok + '</strong> succeeded, <strong>' + err + '</strong> failed.</div>'
    + res.results.map((r) => '<div class="' + (r.ok ? 'ok' : 'err') + '">' + (r.ok ? '\u2713' : '\u2717') + ' ' + escape(r.type) + ' ' + escape(r.path || ('pid ' + r.pid)) + (r.error ? ' &mdash; ' + escape(r.error) : '') + '</div>').join('');
  main.appendChild(div);
  $('footerSummary').textContent = err === 0 ? 'All actions completed.' : (err + ' action(s) failed — see results above.');
}

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

$('applyBtn').addEventListener('click', onApply);
$('openAuditBtn').addEventListener('click', function () { window.uninstaller.openAuditLog(); });
init();
