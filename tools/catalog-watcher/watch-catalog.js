'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { parseItemsXlsx, alignAbayasToEmployeeProcess } = require('./catalog-parse');

const configPath = process.argv[2] || path.join(__dirname, 'config.json');

const DEFAULT_DEBOUNCE_MS = 2000;
/** Full-tree resync interval (override with `dailySyncMs` in config.json). */
const DEFAULT_PERIODIC_SYNC_MS = 30 * 60 * 1000;

function loadConfig() {
  let raw = fs.readFileSync(configPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const msg = String(e.message);
      console.error('Invalid JSON in', configPath + ':', msg);
      if (/Bad escaped|position/i.test(msg)) {
        console.error(
          'Tip: C:\\\\Users\\\\... is INVALID in JSON (\\\\U in \\\\Users looks like a broken \\\\uXXXX escape). Use: "C:/Users/YourName/..." with forward slashes, or double every backslash.'
        );
      }
    }
    throw e;
  }
}

async function walkXlsxFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile() && full.toLowerCase().endsWith('.xlsx')) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out.sort();
}

function isFileAtWatchRoot(watchDirResolved, filePath) {
  const d = path.resolve(path.dirname(filePath));
  return d === watchDirResolved;
}

function normKey(s) {
  return String(s != null ? s : '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ');
}

function resolveEmployeeFromFolderName(folderName, employees) {
  const fk = normKey(folderName);
  if (!fk || !employees || !employees.length) return null;
  for (const e of employees) {
    if (normKey(e.name) === fk) return e;
    if (normKey(e.code) === fk) return e;
    if (normKey(e.id) === fk) return e;
    if (String(e.emp_no) === String(folderName).trim()) return e;
    if (String(e.ac_no) === String(folderName).trim()) return e;
  }
  return null;
}

async function fetchEmployees(cfg) {
  const url = String(cfg.employeesUrl || 'http://127.0.0.1:3000/api/employees').replace(/\/$/, '');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const j = await res.json();
    if (!j.ok || !Array.isArray(j.employees)) {
      console.warn('[catalog-watcher] employees API unexpected shape; folder alignment disabled');
      return [];
    }
    return j.employees;
  } catch (e) {
    console.warn('[catalog-watcher] Could not load employees from', url + ':', e.message);
    return [];
  }
}

async function loadEmployees(cfg) {
  if (Array.isArray(cfg.employees) && cfg.employees.length) {
    console.log('[catalog-watcher] Using employees array from config.json (' + cfg.employees.length + ' rows)');
    return cfg.employees;
  }
  return fetchEmployees(cfg);
}

async function moveToDir(src, destDir, subPrefix) {
  await fs.promises.mkdir(destDir, { recursive: true });
  const base = path.basename(src);
  let dest = path.join(destDir, base);
  if (fs.existsSync(dest)) {
    dest = path.join(destDir, `${subPrefix || Date.now()}_${base}`);
  }
  try {
    await fs.promises.rename(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src);
    } else {
      throw e;
    }
  }
  return dest;
}

async function copyToDir(src, destDir, subPrefix) {
  await fs.promises.mkdir(destDir, { recursive: true });
  const base = path.basename(src);
  let dest = path.join(destDir, base);
  if (fs.existsSync(dest)) {
    dest = path.join(destDir, `${subPrefix || Date.now()}_${base}`);
  }
  await fs.promises.copyFile(src, dest);
  return dest;
}

async function uploadCatalog(cfg, abayas) {
  const url = String(cfg.workerUrl || '').replace(/\/$/, '') + '/api/catalog/abayas';
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Secret': String(cfg.ingestSecret || ''),
    },
    body: JSON.stringify(abayas),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!body.ok) {
    throw new Error(body.error || JSON.stringify(body));
  }
  return body;
}

/**
 * Build one merged catalog from every .xlsx under watchDir (items_export format).
 */
async function mergeCatalogFromWatchTree(cfg, employees) {
  const watchResolved = path.resolve(cfg.watchDir);
  const files = await walkXlsxFiles(cfg.watchDir);
  if (!files.length) {
    return { abayas: [], sourceFiles: [] };
  }

  const alignRaw = String(cfg.alignProcess || 'strict').toLowerCase();
  const alignMode = ['strict', 'folder', 'off'].includes(alignRaw) ? alignRaw : 'strict';
  const unknownFolder = String(cfg.unknownEmployeeFolder || 'error').toLowerCase();
  const defaultCatalogProcess = String(cfg.defaultCatalogProcess || 'Tailor (01)').trim() || 'Tailor (01)';

  const byId = new Map();
  const byBc = new Map();
  const sourceFiles = [];
  const invalidFiles = [];

  for (const filePath of files) {
    try {
      const { abayas: parsed, sheetUsed } = parseItemsXlsx(filePath);
      const atRoot = isFileAtWatchRoot(watchResolved, filePath);
      let employee = null;
      if (!atRoot) {
        const folderName = path.basename(path.dirname(filePath));
        employee = resolveEmployeeFromFolderName(folderName, employees);
        if (!employee) {
          const msg = `No employee matches folder name ${JSON.stringify(folderName)} for file ${filePath}`;
          if (unknownFolder === 'warn') {
            console.warn('[catalog-watcher]', msg, '— skipping folder alignment');
          } else {
            throw new Error(msg + '. Use employee name, code, id, emp_no, or ac_no as the folder name.');
          }
        }
      }

      const aligned = alignAbayasToEmployeeProcess(parsed, employee, atRoot ? 'off' : alignMode);

      for (const row of aligned) {
        const process = String(row.process != null ? row.process : '').trim() || defaultCatalogProcess;
        const rowNorm = { ...row, process };
        if (byId.has(rowNorm.id) || byBc.has(rowNorm.barcode)) {
          console.warn(
            `[catalog-watcher] Skipping duplicate barcode ${JSON.stringify(rowNorm.barcode)} from ${filePath}`
          );
          continue;
        }
        const tagged = { ...rowNorm, filePath };
        byId.set(rowNorm.id, tagged);
        byBc.set(rowNorm.barcode, tagged);
      }
      sourceFiles.push(filePath);
      if (String(cfg.verboseParse || '').toLowerCase() === 'true') {
        console.log('[catalog-watcher] Parsed', filePath, 'sheet:', sheetUsed, 'rows:', aligned.length);
      }
    } catch (e) {
      invalidFiles.push({ filePath, error: e.message });
      console.error('[catalog-watcher] Invalid workbook skipped:', filePath);
      console.error('  reason:', e.message);
      console.error('  tip: keep data in sheet "Items" (or make first sheet non-empty with required headers).');
      continue;
    }
  }

  const abayas = [...byId.values()].map((r) => {
    const { filePath: _f, ...rest } = r;
    return rest;
  });
  return { abayas, sourceFiles, invalidFiles };
}

let rebuildTimer = null;
let rebuildRunning = false;
let pendingRebuild = false;

async function rebuildAndUpload(cfg, employees, reason) {
  if (rebuildRunning) {
    pendingRebuild = true;
    return;
  }
  rebuildRunning = true;
  try {
    console.log('[catalog-watcher] Rebuilding catalog (' + reason + ')…');
    const { abayas, sourceFiles, invalidFiles } = await mergeCatalogFromWatchTree(cfg, employees);
    if (invalidFiles.length) {
      console.warn('[catalog-watcher] Skipped', invalidFiles.length, 'invalid workbook(s) in this run');
    }
    if (!abayas.length) {
      if (invalidFiles.length) {
        console.log('[catalog-watcher] No valid rows found. Fix invalid workbook(s); watcher will retry on change/periodic sync.');
      } else {
        console.log('[catalog-watcher] No .xlsx files under watchDir; nothing to upload.');
      }
      return;
    }
    await uploadCatalog(cfg, abayas);
    console.log('[catalog-watcher] Uploaded', abayas.length, 'items from', sourceFiles.length, 'file(s)');
    const archiveMode = String(cfg.archiveMode || 'move').toLowerCase();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const fp of sourceFiles) {
      if (archiveMode === 'copy') {
        await copyToDir(fp, cfg.processedDir, stamp);
      } else if (archiveMode === 'move') {
        await moveToDir(fp, cfg.processedDir, stamp);
      }
    }
    if (archiveMode === 'copy') {
      console.log('[catalog-watcher] Copied source file(s) to Processed (source retained for daily alignment)');
    } else if (archiveMode === 'move') {
      console.log('[catalog-watcher] Moved source file(s) to Processed');
    } else {
      console.log('[catalog-watcher] archiveMode=none; source file(s) kept in place');
    }
  } catch (e) {
    console.error('[catalog-watcher] FAILED:', e.message);
    console.error('[catalog-watcher] Files left in place for correction; next periodic sync or file change will retry.');
  } finally {
    rebuildRunning = false;
    if (pendingRebuild) {
      pendingRebuild = false;
      scheduleRebuild(cfg, employees, 'queued');
    }
  }
}

function scheduleRebuild(cfg, employees, reason) {
  const ms = Number(cfg.debounceMs) > 0 ? Number(cfg.debounceMs) : DEFAULT_DEBOUNCE_MS;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildAndUpload(cfg, employees, reason);
  }, ms);
}

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    console.error('Cannot read config:', configPath, e.message);
    process.exit(1);
  }

  const required = ['watchDir', 'processedDir', 'workerUrl', 'ingestSecret'];
  for (const k of required) {
    if (!cfg[k]) {
      console.error('Missing config key:', k);
      process.exit(1);
    }
  }

  fs.mkdirSync(cfg.watchDir, { recursive: true });
  fs.mkdirSync(cfg.processedDir, { recursive: true });

  const employees = await loadEmployees(cfg);
  if (employees.length) {
    console.log('[catalog-watcher] Loaded', employees.length, 'employees for folder alignment');
  }

  const watchPattern = path.join(cfg.watchDir, '**', '*.xlsx');
  console.log('[catalog-watcher] Watching', watchPattern);
  console.log(
    '[catalog-watcher] Drop items_export-style .xlsx at watch root or in subfolders named after an employee (name, code, id, emp_no, or ac_no). alignProcess:',
    String(cfg.alignProcess || 'strict')
  );

  const debounced = () => scheduleRebuild(cfg, employees, 'file change');

  const watcher = chokidar.watch(watchPattern, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 100 },
  });
  watcher.on('add', debounced);
  watcher.on('change', debounced);
  watcher.on('unlink', debounced);

  const periodicMs =
    Number(cfg.dailySyncMs) > 0 ? Number(cfg.dailySyncMs) : DEFAULT_PERIODIC_SYNC_MS;
  setInterval(() => {
    rebuildAndUpload(cfg, employees, 'periodic sync').catch((e) => console.error(e));
  }, periodicMs);
  const syncLabel =
    periodicMs >= 3600000
      ? Math.round(periodicMs / 3600000) + ' hours'
      : Math.round(periodicMs / 60000) + ' minutes';
  console.log('[catalog-watcher] Full tree resync every', syncLabel, '(dailySyncMs in config)');

  if (cfg.scanOnStart === true) {
    setTimeout(() => {
      rebuildAndUpload(cfg, employees, 'startup scan').catch((e) => console.error(e));
    }, 3000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
