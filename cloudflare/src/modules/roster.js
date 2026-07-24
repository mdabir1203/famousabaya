/**
 * Employee roster + factory work types.
 *
 * Mirrors the abaya-catalog contract: GET is open (the factory server and a fresh
 * install read it to seed themselves), PUT requires X-Ingest-Secret and is rate
 * limited. Replacements are guarded against wiping the roster with an empty list,
 * and a failed batch is restored best-effort — same as the catalog.
 *
 * The local Excel/JSON on the factory laptop stays authoritative; this is the seed
 * for new machines plus an off-site backup.
 */

const EMP_COLUMNS = 'id, name, code, emp_no, ac_no, process, barcode, color, initials, photo';

async function readVersion(env, key) {
  const row = await env.DB.prepare('SELECT v FROM catalog_meta WHERE k = ?').bind(key).first();
  return row && row.v != null ? String(row.v) : '0';
}

export async function handleEmployeesGet(env, jsonRes) {
  const version = await readVersion(env, 'employees_version');
  const { results } = await env.DB.prepare(
    `SELECT ${EMP_COLUMNS} FROM employees ORDER BY name ASC`
  ).all();
  const employees = (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code || '',
    emp_no: r.emp_no || '',
    ac_no: r.ac_no || '',
    process: r.process || '',
    barcode: r.barcode || '',
    color: r.color || '#6a5fc1',
    initials: r.initials || String(r.name || '?').slice(0, 2).toUpperCase(),
    photo: r.photo || '',
  }));
  return jsonRes({ ok: true, version, employees }, 200, {
    'Cache-Control': 'public, max-age=10, stale-while-revalidate=120',
  });
}

export async function handleEmployeesPut(request, env, helpers) {
  const { errRes, jsonRes, rateLimitOr429 } = helpers;
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized ingest request', 401);
  }

  const rlBlock = await rateLimitOr429(
    env.CATALOG_PUT_RATE_LIMIT,
    'employees-put',
    'Too many roster uploads. Wait and retry.'
  );
  if (rlBlock) return rlBlock;

  let body;
  try {
    body = await request.json();
  } catch {
    return errRes('Invalid JSON body', 400);
  }

  const rows = Array.isArray(body) ? body : body && body.employees;
  const allowEmpty = !Array.isArray(body) && !!(body && body.allowEmpty === true);
  if (!Array.isArray(rows)) {
    return errRes('Body must be a JSON array or { employees: [...] }', 400);
  }

  const norm = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') return errRes(`Row ${i + 1}: must be an object`, 400);
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    const id = String(r.id ?? '').trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    norm.push({
      id,
      name,
      code: String(r.code ?? '').trim(),
      emp_no: String(r.emp_no ?? '').trim(),
      ac_no: String(r.ac_no ?? '').trim(),
      process: String(r.process ?? '').trim(),
      barcode: String(r.barcode ?? '').trim(),
      color: String(r.color ?? '').trim(),
      initials: String(r.initials ?? '').trim(),
      photo: String(r.photo ?? '').trim(),
    });
  }

  if (!norm.length && !allowEmpty) {
    return errRes(
      'Refusing to replace the roster with 0 employees. Pass { allowEmpty: true } to intentionally clear it.',
      400
    );
  }

  const prevResult = await env.DB.prepare(`SELECT ${EMP_COLUMNS} FROM employees`).all();
  const prevRows = Array.isArray(prevResult.results) ? prevResult.results : [];
  const prevVersion = await readVersion(env, 'employees_version');

  const insert = (r) =>
    env.DB.prepare(
      `INSERT INTO employees (${EMP_COLUMNS}, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
    ).bind(
      r.id, r.name, r.code || null, r.emp_no || null, r.ac_no || null,
      r.process || null, r.barcode || null, r.color || null, r.initials || null, r.photo || null
    );

  const newVersion = String(Date.now());
  const stmts = [env.DB.prepare('DELETE FROM employees')];
  for (const r of norm) stmts.push(insert(r));
  stmts.push(
    env.DB.prepare('INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)').bind('employees_version', newVersion)
  );

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    try {
      const restore = [env.DB.prepare('DELETE FROM employees')];
      for (const r of prevRows) restore.push(insert(r));
      restore.push(
        env.DB.prepare('INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)').bind('employees_version', prevVersion)
      );
      await env.DB.batch(restore);
    } catch (_) {}
    throw e;
  }
  return jsonRes({ ok: true, version: newVersion, count: norm.length });
}

export async function handleWorkTypesGet(env, jsonRes) {
  const version = await readVersion(env, 'work_types_version');
  const { results } = await env.DB.prepare(
    'SELECT name FROM work_types ORDER BY position ASC, name ASC'
  ).all();
  const workTypes = (results || []).map((r) => r.name).filter(Boolean);
  return jsonRes({ ok: true, version, workTypes }, 200, {
    'Cache-Control': 'public, max-age=10, stale-while-revalidate=120',
  });
}

export async function handleWorkTypesPut(request, env, helpers) {
  const { errRes, jsonRes, rateLimitOr429 } = helpers;
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized ingest request', 401);
  }

  const rlBlock = await rateLimitOr429(
    env.CATALOG_PUT_RATE_LIMIT,
    'work-types-put',
    'Too many work-type uploads. Wait and retry.'
  );
  if (rlBlock) return rlBlock;

  let body;
  try {
    body = await request.json();
  } catch {
    return errRes('Invalid JSON body', 400);
  }

  const rows = Array.isArray(body) ? body : body && body.workTypes;
  const allowEmpty = !Array.isArray(body) && !!(body && body.allowEmpty === true);
  if (!Array.isArray(rows)) {
    return errRes('Body must be a JSON array or { workTypes: [...] }', 400);
  }

  const norm = [];
  const seen = new Set();
  for (const raw of rows) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    norm.push(name);
  }

  if (!norm.length && !allowEmpty) {
    return errRes(
      'Refusing to replace work types with 0 entries. Pass { allowEmpty: true } to intentionally clear them.',
      400
    );
  }

  const prevResult = await env.DB.prepare('SELECT name, position FROM work_types').all();
  const prevRows = Array.isArray(prevResult.results) ? prevResult.results : [];
  const prevVersion = await readVersion(env, 'work_types_version');

  const newVersion = String(Date.now());
  const stmts = [env.DB.prepare('DELETE FROM work_types')];
  norm.forEach((name, i) => {
    stmts.push(
      env.DB.prepare('INSERT INTO work_types (name, position, updated_at) VALUES (?, ?, unixepoch())').bind(name, i)
    );
  });
  stmts.push(
    env.DB.prepare('INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)').bind('work_types_version', newVersion)
  );

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    try {
      const restore = [env.DB.prepare('DELETE FROM work_types')];
      for (const r of prevRows) {
        restore.push(
          env.DB.prepare('INSERT INTO work_types (name, position, updated_at) VALUES (?, ?, unixepoch())').bind(
            r.name,
            r.position || 0
          )
        );
      }
      restore.push(
        env.DB.prepare('INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)').bind('work_types_version', prevVersion)
      );
      await env.DB.batch(restore);
    } catch (_) {}
    throw e;
  }
  return jsonRes({ ok: true, version: newVersion, count: norm.length });
}
