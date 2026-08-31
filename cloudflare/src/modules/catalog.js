export async function handleCatalogAbayasGet(env, jsonRes) {
  const verRow = await env.DB.prepare('SELECT v FROM catalog_meta WHERE k = ?').bind('version').first();
  const version = verRow && verRow.v != null ? String(verRow.v) : '0';
  const { results } = await env.DB.prepare(
    'SELECT id, code, barcode, design, process, icon, is_custom FROM abaya_catalog ORDER BY code ASC, barcode ASC'
  ).all();
  const abayas = (results || []).map((r) => ({
    id: r.id,
    code: r.code,
    barcode: r.barcode,
    design: r.design,
    process: r.process,
    icon: r.icon != null ? r.icon : '',
    // is_custom: 1 marks a custom-style abaya that legitimately stays on
    // the floor for weeks. The local + cloud dashboards surface a small
    // "Custom" pill in the "this build" cell so a 373h build age isn't
    // read as a bug. Mirrors cloudflare/migrations/0019.
    is_custom: Number(r.is_custom) === 1 ? 1 : 0,
  }));
  return jsonRes(
    { ok: true, version, abayas },
    200,
    { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=120' }
  );
}

export async function handleCatalogAbayasPut(request, env, helpers) {
  const { errRes, jsonRes, rateLimitOr429 } = helpers;
  const secret = (request.headers.get('X-Ingest-Secret') || '').trim();
  if (!secret || secret !== (env.INGEST_SECRET || '').trim()) {
    return errRes('Unauthorized ingest request', 401);
  }

  const rlBlock = await rateLimitOr429(
    env.CATALOG_PUT_RATE_LIMIT,
    'catalog-put',
    'Too many catalog uploads. Wait and retry.'
  );
  if (rlBlock) return rlBlock;

  let body;
  try {
    body = await request.json();
  } catch {
    return errRes('Invalid JSON body', 400);
  }

  const rows = Array.isArray(body) ? body : body && body.abayas;
  const allowEmpty = !Array.isArray(body) && !!(body && body.allowEmpty === true);
  if (!Array.isArray(rows)) {
    return errRes('Body must be a JSON array or { abayas: [...] }', 400);
  }

  const norm = [];
  const seenId = new Set();
  const seenBc = new Set();
  const defaultCatalogProcess = String(env.DEFAULT_CATALOG_PROCESS ?? 'Tailor (01)').trim() || 'Tailor (01)';

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') {
      return errRes(`Row ${i + 1}: must be an object`, 400);
    }
    const id = String(r.id ?? '').trim();
    const code = String(r.code ?? '').trim();
    const barcode = String(r.barcode ?? '').trim();
    const design = String(r.design ?? '').trim();
    let process = String(r.process ?? '').trim();
    const iconRaw = r.icon;
    const icon = iconRaw == null || iconRaw === '' ? '' : String(iconRaw);
    // is_custom: 1 if the row is marked custom. Optional in the payload;
    // if not provided we preserve the previous D1 value (so an office
    // Excel that doesn't track this column doesn't accidentally unset
    // a custom flag set via a direct UPDATE on the catalog).
    const isCustomProvided = r.is_custom != null;
    const isCustom = isCustomProvided ? (r.is_custom ? 1 : 0) : null;

    if (!barcode) continue;
    if (!process) process = defaultCatalogProcess;
    const finalCode = code || barcode;
    const finalId = id || barcode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (seenId.has(finalId) || seenBc.has(barcode)) continue;
    seenId.add(finalId);
    seenBc.add(barcode);
    norm.push({ id: finalId, code: finalCode, barcode, design, process, icon, isCustomProvided, isCustom });
  }

  if (!norm.length && !allowEmpty) {
    return errRes(
      'Refusing to replace catalog with 0 rows. Pass { allowEmpty: true } only when you intentionally want an empty catalog.',
      400
    );
  }

  const prevRowsResult = await env.DB.prepare(
    'SELECT id, code, barcode, design, process, icon, is_custom FROM abaya_catalog'
  ).all();
  const prevRows = Array.isArray(prevRowsResult.results) ? prevRowsResult.results : [];
  // Build a quick lookup so we can preserve is_custom when the new row
  // doesn't carry the flag (office Excel often doesn't track this
  // column). The lookup is keyed by abaya id since the PUT path
  // preserves the row's id across re-uploads.
  const prevIsCustomById = Object.create(null);
  for (const pr of prevRows) {
    if (pr && pr.id != null) prevIsCustomById[String(pr.id)] = Number(pr.is_custom) === 1 ? 1 : 0;
  }
  const prevVersionRow = await env.DB.prepare('SELECT v FROM catalog_meta WHERE k = ?').bind('version').first();
  const prevVersion = prevVersionRow && prevVersionRow.v != null ? String(prevVersionRow.v) : '0';

  const newVersion = String(Date.now());
  const stmts = [env.DB.prepare('DELETE FROM abaya_catalog')];
  for (const r of norm) {
    // Resolve is_custom: prefer the new value, fall back to the previous
    // D1 value if the new payload didn't include it, default to 0.
    let isCustomVal = 0;
    if (r.isCustomProvided) {
      isCustomVal = r.isCustom ? 1 : 0;
    } else if (prevIsCustomById[r.id] != null) {
      isCustomVal = prevIsCustomById[r.id];
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO abaya_catalog (id, code, barcode, design, process, icon, is_custom, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`
      ).bind(r.id, r.code, r.barcode, r.design, r.process, r.icon || null, isCustomVal)
    );
  }
  stmts.push(
    env.DB.prepare('INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)').bind('version', newVersion)
  );

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || '');
    if (msg.includes('UNIQUE constraint failed: abaya_catalog.code')) {
      return errRes(
        'Catalog DB schema still enforces unique code. Apply migration cloudflare/migrations/0005_allow_duplicate_abaya_code.sql and retry.',
        400
      );
    }
    // Best-effort restore so a failed replace cannot leave catalog empty.
    try {
      const restore = [env.DB.prepare('DELETE FROM abaya_catalog')];
      for (const r of prevRows) {
        restore.push(
          env.DB.prepare(
            `INSERT INTO abaya_catalog (id, code, barcode, design, process, icon, is_custom, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`
          ).bind(r.id, r.code, r.barcode, r.design, r.process, r.icon || null, Number(r.is_custom) === 1 ? 1 : 0)
        );
      }
      restore.push(
        env.DB.prepare('INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)').bind('version', prevVersion)
      );
      await env.DB.batch(restore);
    } catch (_) {}
    throw e;
  }
  return jsonRes({ ok: true, version: newVersion, count: norm.length });
}
