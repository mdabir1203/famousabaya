'use strict';

const fs = require('fs');
const path = require('path');
const {
  normalizeImportedFloorSessions,
} = require('../shared/floor-session-transfer.cjs');

/** Parse backup folder basename like 2026-05-01_2221 → local-minute bounds (ms). */
function parseBackupFolderMinuteMs(folderTs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(String(folderTs || '').trim());
  if (!m) return { ok: false, error: `bad_folder_ts=${folderTs}` };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const min = Number(m[5]);
  const start = new Date(y, mo - 1, d, hh, min, 0, 0).getTime();
  const endInclusive = start + 60 * 1000 - 1;
  if (!Number.isFinite(start)) return { ok: false, error: 'invalid_local_date' };
  return {
    ok: true,
    minuteStartMs: start,
    minuteEndMsInclusive: endInclusive,
    labelLocal: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} (Node process local TZ)`,
  };
}

function rowStructurallyExportValid(row) {
  return (
    row &&
    String(row.emp_id || '').trim() !== '' &&
    String(row.abaya_id || '').trim() !== '' &&
    String(row.process || '').trim() !== '' &&
    Number.isFinite(Number(row.start)) &&
    Number.isFinite(Number(row.end)) &&
    Number(row.end) > Number(row.start)
  );
}

/** argv: destPath exportOk copiedExcel — exportOk 1|0 */
function main() {
  const destPathArg = path.resolve(process.argv[2] || '');
  const folderTs = path.basename(destPathArg.replace(/\\/g, '/'));
  const exportOk = process.argv[3] === '1';
  const copiedExcel = Number(process.argv[4]) || 0;

  /** @type {string[]} */
  const lines = [];
  lines.push(`backup_folder=${destPathArg}`);
  lines.push(`folder_ts=${folderTs}`);
  lines.push(`created_at=${new Date().toISOString()}`);
  lines.push(`copied_excel_sources=${copiedExcel}`);
  lines.push(`export_attempted=${exportOk ? 'yes' : 'no_or_failed'}`);

  const minute = parseBackupFolderMinuteMs(folderTs);
  if (!minute.ok) {
    lines.push(`minute_parse=${minute.error}`);
    lines.push('overall_verify=FAIL');
    finalize(destPathArg, lines);
    process.exitCode = 1;
    return;
  }
  lines.push(`backup_minute_label=${minute.labelLocal}`);
  lines.push(`backup_minute_start_ms=${minute.minuteStartMs}`);
  lines.push(`backup_minute_end_ms_inclusive=${minute.minuteEndMsInclusive}`);

  const fp = path.join(destPathArg, 'floor-sessions.json');

  if (!exportOk) {
    lines.push(
      'verify_note=Export skipped or failed — start factory server before backup so curl can fetch /api/export/floor-sessions.json (yarn node server.js).'
    );
    lines.push('overall_verify=SKIP_NO_EXPORT');
    finalize(destPathArg, lines);
    return;
  }

  if (!fs.existsSync(fp)) {
    lines.push('floor_sessions_json_present=no_file');
    lines.push('overall_verify=FAIL');
    finalize(destPathArg, lines);
    process.exitCode = 1;
    return;
  }

  lines.push('floor_sessions_json_present=yes');

  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    lines.push(`json_parse_error=${String(e.message || e)}`);
    lines.push('overall_verify=FAIL');
    finalize(destPathArg, lines);
    process.exitCode = 1;
    return;
  }

  const sessions = Array.isArray(json.sessions) ? json.sessions : [];
  lines.push(`export_row_count=${sessions.length}`);
  lines.push(
    `export_meta_generated_at=${json.meta && json.meta.generatedAtIso ? json.meta.generatedAtIso : json.meta && json.meta.generatedAt != null ? String(json.meta.generatedAt) : ''}`
  );

  let invalidStructural = 0;
  let endInBackupMinute = 0;
  let startInBackupMinute = 0;
  let spanBackupMinute = 0;

  const ms0 = minute.minuteStartMs;
  const ms1 = minute.minuteEndMsInclusive;

  for (const row of sessions) {
    if (!rowStructurallyExportValid(row)) {
      invalidStructural += 1;
      continue;
    }
    const st = Number(row.start);
    const en = Number(row.end);
    if (en >= ms0 && en <= ms1) endInBackupMinute += 1;
    if (st >= ms0 && st <= ms1) startInBackupMinute += 1;
    if (st < ms0 && en > ms1) spanBackupMinute += 1;
  }

  lines.push(`export_invalid_structural_rows=${invalidStructural}`);
  lines.push(`rows_end_inside_backup_named_minute=${endInBackupMinute}`);
  lines.push(`rows_start_inside_backup_named_minute=${startInBackupMinute}`);
  lines.push(`rows_span_backup_named_minute=${spanBackupMinute}`);

  /** Same normalization as POST /api/import/floor-sessions.json */
  const normalized = normalizeImportedFloorSessions(sessions);
  lines.push(`normalize_import_ok=${normalized.ok ? 'yes' : 'no'}`);
  if (!normalized.ok) {
    lines.push(`normalize_import_error=${normalized.error}`);
  } else {
    lines.push(`normalize_import_rows=${normalized.rows.length}`);
    lines.push(
      `normalize_dropped_vs_export=${Math.max(0, sessions.length - normalized.rows.length)}`
    );
  }

  const structuralPass = invalidStructural === 0;
  const normalizePass = normalized.ok;
  /** Canonical export expects 1:1 through importer; drops mean dupes or bad rows. */
  const countPass =
    !normalizePass ||
    sessions.length === 0 ||
    normalized.rows.length === sessions.length;

  lines.push(`import_roundtrip_shape_check=${countPass ? 'PASS' : 'FAIL'}`);
  lines.push(
    structuralPass && normalizePass && countPass ? 'overall_verify=PASS' : 'overall_verify=FAIL'
  );

  finalize(destPathArg, lines);
  if (!(structuralPass && normalizePass && countPass)) process.exitCode = 1;
}

function finalize(destPath, lines) {
  const reportPath = path.join(destPath, 'backup-report.txt');
  try {
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
  } catch (_) {
    console.error(lines.join('\n'));
    process.exitCode = process.exitCode || 1;
    return;
  }
  console.log(lines.join('\n'));
}

main();
