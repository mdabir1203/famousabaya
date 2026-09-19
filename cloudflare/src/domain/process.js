// ─── WORK TYPES (job card "Type of Work" + Hand Designing) ───────────────────
export const WORK_TYPES = [
  'Tailor (01)',
  'Cutting master',
  'Tailor (02)',
  'Hand Work',
  'Stone Work',
  'Button',
  'Embroidery',
  'Ari Work',
  'Hand Designing',
  'Invoice maker',
  'Packaging',
  'Checker',
  // v1.2.43 — Add the work-type names from data/work-types.json that
  // were silently passing through unchanged before this release. Each
  // maps to a daily_stats column below.
  'Show Button',   // sub-station of Button; counts as button_units
  'Alter',         // alteration work; counts as tailor_01_units (closest
                   //   station with hand-stitching overlap)
  'Complete',      // completion marker (last station on the line)
  'Incomplete',    // backflow marker (worker tapped Start but station
                   //   wasn't ready — counts as hand_work_units because
                   //   that's where it most often lands)
  'Cutting',       // legacy alias for Tailor (01) / Cutting master
];

export const PROCESS_TO_DAILY_COL = {
  'Tailor (01)': 'tailor_01_units',
  'Tailor (02)': 'tailor_02_units',
  'Hand Work': 'hand_work_units',
  'Stone Work': 'stone_work_units',
  Button: 'button_units',
  Embroidery: 'embroidery_units',
  'Ari Work': 'ari_work_units',
  'Hand Designing': 'hand_designing_units',
  'Invoice maker': 'invoice_maker_units',
  Packaging: 'packaging_units',
  Checker: 'checker_units',
  // v1.2.43 — coverage for the previously-orphaned work-type names.
  'Show Button': 'button_units',
  'Alter': 'tailor_01_units',
  'Complete': 'tailor_01_units',
  'Incomplete': 'hand_work_units',
  // Legacy / alias mappings (kept from earlier releases).
  Cutting: 'tailor_01_units',
  'Cutting master': 'tailor_01_units',
  Stitching: 'tailor_02_units',
  Finishing: 'hand_work_units',
};

export const SUMMARY_WT_CASES = `
  SUM(CASE WHEN emp_process IN ('Tailor (01)','Cutting','Cutting master','Alter','Complete') THEN 1 ELSE 0 END) as tailor_01,
  SUM(CASE WHEN emp_process IN ('Tailor (02)','Stitching') THEN 1 ELSE 0 END) as tailor_02,
  SUM(CASE WHEN emp_process IN ('Hand Work','Finishing','Incomplete') THEN 1 ELSE 0 END) as hand_work,
  SUM(CASE WHEN emp_process='Stone Work' THEN 1 ELSE 0 END) as stone_work,
  SUM(CASE WHEN emp_process IN ('Button','Show Button') THEN 1 ELSE 0 END) as button,
  SUM(CASE WHEN emp_process='Embroidery' THEN 1 ELSE 0 END) as embroidery,
  SUM(CASE WHEN emp_process='Ari Work' THEN 1 ELSE 0 END) as ari_work,
  SUM(CASE WHEN emp_process='Hand Designing' THEN 1 ELSE 0 END) as hand_designing,
  SUM(CASE WHEN emp_process='Invoice maker' THEN 1 ELSE 0 END) as invoice_maker,
  SUM(CASE WHEN emp_process='Packaging' THEN 1 ELSE 0 END) as packaging,
  SUM(CASE WHEN emp_process='Checker' THEN 1 ELSE 0 END) as checker
`;

export function dailyStatsColumnForProcess(proc) {
  return PROCESS_TO_DAILY_COL[proc] || 'tailor_01_units';
}

export function canonicalEmpProcess(raw) {
  if (raw == null) return 'Tailor (01)';
  const t = String(raw).trim();
  if (!t) return 'Tailor (01)';
  // Case-insensitive aliases — the floor terminals don't always send Title
  // case, and we used to silently drop "cutting" / "KHAKA WORK" / etc. from
  // the report rollups. Normalize on read so old D1 rows and new push values
  // land in the same bucket.
  const lo = t.toLowerCase();
  if (lo === 'cutting' || lo === 'cutting master') return 'Tailor (01)';
  if (lo === 'stitching') return 'Tailor (02)';
  if (lo === 'finishing') return 'Hand Work';
  if (lo === 'khaka work') return 'Hand Work';
  if (lo === 'show button') return 'Show Button';
  if (lo === 'alter') return 'Alter';
  if (lo === 'complete') return 'Complete';
  if (lo === 'incomplete') return 'Incomplete';
  if (WORK_TYPES.includes(t)) return t; // keep Title case for display
  return t; // unknown process — pass through unchanged
}

export function emptyProcessSplit() {
  const o = {};
  WORK_TYPES.forEach((t) => {
    o[t] = 0;
  });
  return o;
}
