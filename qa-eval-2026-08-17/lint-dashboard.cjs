// Smarter linter: actually parse the file with a JS parser (acorn is built into
// @remotion packages but we don't have it; use Node's built-in vm.Script to check
// for syntax errors, then do a hand-rolled scope check).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'public', 'dashboard.js');
const src = fs.readFileSync(file, 'utf8');

// Step 1: syntax check
try {
  new vm.Script(src, { filename: 'dashboard.js' });
  console.log('[OK] dashboard.js parses cleanly with no syntax errors.');
} catch (e) {
  console.log('[SYNTAX ERROR]', e.message);
  process.exit(1);
}

// Step 2: hand-rolled scope check via a sliding-window approach.
// Find every top-level / nested function, then for each function body, find
// identifiers used that aren't defined locally and aren't a known global.
// We use a coarse but useful pattern: identifiers that are obviously
// project-specific (camelCase, multi-letter) and appear in expressions but
// not in any local declaration.

// First, build a list of "all declared names" (module-level)
const declRe = /^\s*(?:const|let|var|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
const moduleDecls = new Set();
let m;
while ((m = declRe.exec(src)) !== null) moduleDecls.add(m[1]);

// Also catch function params in declarations like `function foo(a, b, c)`
// and arrow funcs. We approximate: the regex `^\s*function NAME\(` skips this.
// Add a quick pass for the function signatures
const fnSigRe = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/g;
while ((m = fnSigRe.exec(src)) !== null) {
  const params = m[2].split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
  for (const p of params) moduleDecls.add(p);
}

// Known browser/DOM globals + common vars
const knownGlobals = new Set([
  'document', 'window', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'fetch', 'URL', 'URLSearchParams', 'Math', 'Date', 'JSON', 'Number', 'String', 'Array',
  'Object', 'Boolean', 'RegExp', 'Error', 'Promise', 'Intl', 'Map', 'Set',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'localStorage', 'sessionStorage',
  'WebSocket', 'EventSource', 'AbortController', 'AbortSignal', 'FormData',
  'crypto', 'navigator', 'location', 'history', 'alert', 'confirm', 'prompt',
  'STATE', 'loadAbayaCatalog', 'loadEmployeeDayOptions', 'schedulePollLoop',
  'poll', 'renderAll', 'renderKPIs', 'renderLiveSessions', 'renderAbayaItemTotals',
  'renderEmployeePerf', 'renderHourlyChart', 'renderPareto', 'renderProcessEff',
  'renderRecentInvoiceLogsNode', 'renderRecentCheckerLogsNode', 'syncDashboardFloorTabUi',
  'updateClock', 'applyFallbackState', 'fetchStateExtendedHistory', 'fetchStateFallback',
  'startFallbackPolling', 'stopFallbackPolling', 'socket', 'customReportRange',
  'aggregateRealtime', 'activeSecondsWindowedFromMs', 'whTimezone', 'ymdInTimezone',
  'fmtHMS', 'abbreviateName', 'LOG_LEVEL', 'reportCacheClear', 'dashboardAggregateCacheClear',
  'logsFingerprint', 'cacheGet', 'cachePut', 'getLogsForType', 'reportPeriodForType',
  'setReportEmployeeFilter', 'employeeFilterOptions', 'openReport', 'closeReport',
  'lastReportData', 'lastModalAnalytics', 'lastModalTrace', 'escWA', 'windowLabelFromRange',
  'escAttr', 'escHtml', 'reportCacheGet', 'reportCachePut', 'reportCacheBytes', 'REPORT_CACHE_LIMIT',
  'REPORT_CACHE_MAX_BYTES', 'openEveryEmployeeEveryTask', 'localAnalytics',
  'localTrace', 'openLocalAnalytics', 'openLocalTrace', 'localTraceExport', 'localAnalyticsExport',
  'sum_duration_sec', 'sum_completed_sec', 'logDurationSec', 'pollInFlight', 'pollStartedAt',
  'sessionExpired', 'BASE', 'fetchJsonSafe',
  'showToast', 'showConfirmModal', 'hideConfirmModal', 'fillConfirmModal',
  'openMediaPicker', 'closeMediaPicker', 'pickMedia', 'isMediaPickingInFlight',
  'sortEmployees', 'mostRecentActiveEmployeeIds', 'renderAbayaTotalsTable', 'pollClientConfig',
  'CLIENT_CONFIG_DEFAULTS', 'dismissReleaseMoment', 'installVirtualRefreshLink',
  'tabify', 'renderAllRaf', 'scheduleRenderAll', 'renderLiveSessionsBlock',
  'modalEl', 'activeReportType', 'reportEmployeeFilterId', 'lastReportPeriod',
  'PENDING_REFRESH_KEY', 'tryRefreshToken', 'isInFlight', 'cf', 'closeEveryReportView',
  'openEveryReportView', 'openCheckReport', 'closeCheckReport', 'renderReport',
  'sortInvoiceGroups', 'renderCalendar', 'lastReportData', 'lastReportType', 'lastReportTitle',
  'modalSaveBtn', 'modalSaveSpinner', 'renderRecentInvoiceLogs', 'parseAbaYaCellId',
  'normalizeProcess', 'modalSaveAndStay', 'lastReportIsCheck', 'lastReportDataType',
  'lastReportMeta', 'lastReportError', 'current', 'initCheckReport',
  'loadAbayaTotalsForReport', 'renderReportBody', 'renderReportSummary', 'renderReportByEmployee',
  'renderReportByProcess', 'renderReportByItem', 'renderReportTop', 'renderReportBottom',
  'renderReportBodyFor', 'renderInvoiceMakerBatches', 'renderItemTimeByAbaya',
  'sortTopByActive', 'topPerformers', 'lastReportPeriod', 'windowLabel',
  'getPickedReportDate', 'resetReportDate', 'backToReportBtnHtml', 'backToReport',
  'closeModal', 'fillModal', 'openModal', 'requestRenderAll', 'applyStateDelta',
  'fillReportModal', 'fillReportModalForDate', 'fillReportModalForRange', 'fillReportModalForType',
  'renderLiveSessionsNode', 'tabifyTop', 'lastReportPerEmployee', 'lastReportByProcess',
  'lastReportByItem', 'lastReportInvoice', 'lastReportDays', 'lastReportFallbackApplied',
  'lastReportGenerated', 'lastReportTotalUnits', 'lastReportAvgCycle',
  'lastReportActiveTime', 'lastReportElapsedTime', 'lastReportAdjusted', 'lastReportT01',
  'lastReportT02', 'lastReportHandWork', 'lastReportStoneWork', 'lastReportButton',
  'lastReportEmbroidery', 'lastReportAriWork', 'lastReportHandDesigning', 'lastReportInvoiceMaker',
  'lastReportPackaging', 'lastReportChecker', 'lastReportTopPerformers', 'lastReportBottlenecks',
  'lastReportInvoiceBatches', 'lastReportItemTime', 'lastReportTolerance',
  'lastReportTolerancePolicy', 'lastReportActiveWorkers', 'lastReportAvgSec',
  'lastReportTotalTime', 'lastReportTrend', 'lastReportEfficiencyToday',
  'lastReportActiveTimeSec', 'lastReportLiveActiveTimeSec', 'lastReportFullTimeSec',
  'lastReportAdjFullTimeSec', 'lastReportTputPerHour', 'lastReportUtilizationPct',
  'lastReportInsights', 'lastReportHours', 'lastReportGarmentTotals',
  'lastReportItemIdList', 'lastReportLifecycleMap', 'lastReportIdMap',
  'lastReportWorkingHours', 'lastReportWorkingStatus', 'lastReportFactoryToday',
  'lastReportLocalToday', 'lastReportPeriodObj', 'lastReportType', 'lastReportRange',
  'lastReportStartYmd', 'lastReportEndYmd', 'lastReportPrevStart', 'lastReportPrevEnd',
  'lastReportPeriodDays', 'lastReportPeriodLabel', 'lastReportItemTimeSorted',
  'renderEveryReport', 'renderEveryReportFor',
  'fetchWithRetry', 'uiTz', 'uiNowString',
  'STATE_LOG_WINDOW_MS', 'STATE_LOG_MAX_ROWS',
  'parseStateLimit', 'parseStateDaysMs', 'parseStateSinceMs', 'STATE_LOG_KEY',
  'OFFLINE_LOG_WINDOW_MS', 'OFFLINE_RESTORE_MAX_AGE_MS', 'RESTORE_MAX_AGE_MS', 'restoredAt',
  'restoredFromCache', 'offlineReportRestored', 'fallbackMode', 'fallbackPollTimer',
  'reportCache', 'dashboardAggregateCache', 'clearDashboardAggregateCache',
  'emptyProcessSplit', 'canonicalEmpProcess', 'processForCloud',
  'toast', 'toastTimer', 'toastText', 'toastClass', 'toastT', 'messageBus',
  'renderInvoiceMakerBatches', 'renderItemTimeByAbaya',
  'sortInvoiceGroups', 'processAbaYaTotalsForReport', 'renderItemTimeByAbaya',
  'renderReportByItem', 'lastReportItemByCode', 'lastReportHours', 'lastReportByProcess',
  'lastReportPerEmployee', 'renderReportByEmployee', 'renderReportByProcess',
  'renderReportTop', 'renderReportBottom', 'renderReportSummary',
  'renderReportByItem', 'renderInvoiceMakerBatches', 'renderItemTimeByAbaya',
  'lastReportActiveTimeSec', 'lastReportAvgSec', 'lastReportElapsedTimeSec',
  'lastReportLiveActiveTimeSec', 'lastReportFullTimeSec', 'lastReportToleranceSec',
  'lastReportAdjFullTimeSec', 'lastReportThroughputPerHour', 'lastReportUtilizationPct',
  'lastReportTailor01', 'lastReportTailor02', 'lastReportHandWork', 'lastReportStoneWork',
  'lastReportButton', 'lastReportEmbroidery', 'lastReportAriWork',
  'lastReportHandDesigning', 'lastReportInvoiceMaker', 'lastReportPackaging',
  'lastReportChecker', 'lastReportInvoiceMakerCount', 'lastReportInvMakerBatches',
  'lastReportInvMakerTotal', 'lastReportItemTime', 'lastReportInsights',
  'lastReportTopPerformers', 'lastReportBottlenecks', 'lastReportItemTotals',
  'lastReportItemTime', 'lastReportInvBatches', 'lastReportHours',
  'renderReportTop', 'renderReportBottom',
  'empById',
  'fmtHMS', 'escWA', 'escAttr', 'escHtml', 'windowLabelFromRange', 'uiTz', 'uiNowString',
  'renderAll', 'whTimezone', 'ymdInTimezone',
  'abayaCatalog', 'abaYaCatalog', 'EMPLOYEES',
  'fingerprintLogs', 'logFingerprint', 'fingerprint',
  'renderLiveSessionsNode', 'renderInvoiceMakerBatches',
  'renderEveryReportNode', 'renderEveryReport',
  'processForCloud',
  'lastReportAvgSec', 'lastReportInsights', 'lastReportTopPerformers',
  'lastReportBottlenecks', 'lastReportItemTime', 'lastReportItemTotals',
  'lastReportInvBatches', 'lastReportHours', 'lastReportPeriod',
  'lastReportPeriodObj', 'lastReportType', 'lastReportRange', 'lastReportDays',
  'lastReportStartYmd', 'lastReportEndYmd', 'lastReportPrevStart', 'lastReportPrevEnd',
  'lastReportFallbackApplied', 'lastReportGenerated', 'lastReportTotalUnits',
  'lastReportEmployeeCount', 'lastReportUniqueItemCount', 'lastReportInvoiceMaker',
  'lastReportTopPerformers', 'lastReportBottlenecks', 'lastReportItemTime',
  'lastReportItemTotals', 'lastReportInvBatches', 'lastReportHours',
  'lastReportActiveSessions', 'lastReportItemIdList', 'lastReportLifecycleMap',
  'lastReportIdMap', 'lastReportItemByCode', 'lastReportItemTimeSorted',
  'renderEveryReportFor', 'renderEveryReport',
]);

// We need a simple JS tokenizer to find identifiers in expressions.
function tokenize(code) {
  // Strip comments
  code = code
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, '""');
  const tokens = [];
  const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m;
  while ((m = idRe.exec(code)) !== null) {
    tokens.push({ id: m[0], pos: m.index });
  }
  return tokens;
}

// For each function body, find identifiers used but not defined locally
const fnRe = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*\{/g;
const issues = [];
let totalFns = 0;
while ((m = fnRe.exec(src)) !== null) {
  totalFns++;
  const name = m[1];
  // Find the body by brace matching
  const openIdx = m.index + m[0].length - 1;
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  const body = src.slice(openIdx + 1, i - 1);

  // Local declarations in the body
  const localDecls = new Set();
  const paramList = m[2].split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
  paramList.forEach((p) => localDecls.add(p));
  const localDeclRe = /\b(?:const|let|var|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = localDeclRe.exec(body)) !== null) localDecls.add(m[1]);
  // Function expressions inside
  const feRe = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = feRe.exec(body)) !== null) localDecls.add(m[1]);
  // Catch params of nested functions
  const nestedFnRe = /function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(([^)]*)\)/g;
  while ((m = nestedFnRe.exec(body)) !== null) {
    const params = m[1].split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
    params.forEach((p) => localDecls.add(p));
  }
  // Arrow functions
  const arrowRe = /\(([^)]*)\)\s*=>/g;
  while ((m = arrowRe.exec(body)) !== null) {
    const params = m[1].split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
    params.forEach((p) => localDecls.add(p));
  }
  // Single-arg arrow: `x => ...`
  const singleArrowRe = /([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
  while ((m = singleArrowRe.exec(body)) !== null) localDecls.add(m[1]);
  // for-in: `for (const k in obj)`
  const forInRe = /for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+in\s+/g;
  while ((m = forInRe.exec(body)) !== null) localDecls.add(m[1]);
  // for-of: `for (const k of arr)`
  const forOfRe = /for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+of\s+/g;
  while ((m = forOfRe.exec(body)) !== null) localDecls.add(m[1]);
  // Catch params
  const catchRe = /catch\s*\(([^)]*)\)/g;
  while ((m = catchRe.exec(body)) !== null) {
    const params = m[1].split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
    params.forEach((p) => localDecls.add(p));
  }

  // Find identifiers used in the body
  const idRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  const used = new Set();
  while ((m = idRe.exec(body)) !== null) {
    const id = m[0];
    // Skip JS keywords/reserved words
    if (/^(if|else|for|while|do|switch|case|default|break|continue|return|throw|try|catch|finally|new|delete|in|of|typeof|instanceof|void|var|let|const|function|class|extends|super|this|null|true|false|undefined|async|await|yield|return|new|export|import|from|as|of|in|void)$/.test(id)) continue;
    // Skip very common built-ins
    if (knownGlobals.has(id)) continue;
    // Skip names that match the module's declarations (catch false positives from
    // names used as both field name and variable)
    if (moduleDecls.has(id)) continue;
    used.add(id);
  }

  // Used but not locally defined = suspect
  for (const id of used) {
    if (!localDecls.has(id)) {
      // Filter out property-name-like (followed by . or :)
      // and string-key-like
      issues.push({ fn: name, id });
    }
  }
}

// Dedupe by fn+id
const dedup = {};
for (const i of issues) {
  const k = i.fn + '::' + i.id;
  dedup[k] = (dedup[k] || 0) + 1;
}

console.log(`\nScanned ${totalFns} top-level function bodies.`);
const sorted = Object.entries(dedup).sort((a, b) => b[1] - a[1]);
console.log(`\n${sorted.length} unique (fn, identifier) pairs flagged.`);
console.log('Top 30 by frequency:');
for (const [k, n] of sorted.slice(0, 30)) {
  const [fn, id] = k.split('::');
  console.log(`  ${String(n).padStart(3)}x  ${fn}: identifier "${id}"`);
}
