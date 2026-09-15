var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/modules/catalog.js
async function handleCatalogAbayasGet(env, jsonRes2) {
  const verRow = await env.DB.prepare("SELECT v FROM catalog_meta WHERE k = ?").bind("version").first();
  const version = verRow && verRow.v != null ? String(verRow.v) : "0";
  const { results } = await env.DB.prepare(
    "SELECT id, code, barcode, design, process, icon, is_custom FROM abaya_catalog ORDER BY code ASC, barcode ASC"
  ).all();
  const abayas = (results || []).map((r) => ({
    id: r.id,
    code: r.code,
    barcode: r.barcode,
    design: r.design,
    process: r.process,
    icon: r.icon != null ? r.icon : "",
    // is_custom: 1 marks a custom-style abaya that legitimately stays on
    // the floor for weeks. The local + cloud dashboards surface a small
    // "Custom" pill in the "this build" cell so a 373h build age isn't
    // read as a bug. Mirrors cloudflare/migrations/0019.
    is_custom: Number(r.is_custom) === 1 ? 1 : 0
  }));
  return jsonRes2(
    { ok: true, version, abayas },
    200,
    { "Cache-Control": "public, max-age=10, stale-while-revalidate=120" }
  );
}
__name(handleCatalogAbayasGet, "handleCatalogAbayasGet");
async function handleCatalogAbayasPut(request, env, helpers) {
  const { errRes: errRes2, jsonRes: jsonRes2, rateLimitOr429: rateLimitOr4292 } = helpers;
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes2("Unauthorized ingest request", 401);
  }
  const rlBlock = await rateLimitOr4292(
    env.CATALOG_PUT_RATE_LIMIT,
    "catalog-put",
    "Too many catalog uploads. Wait and retry."
  );
  if (rlBlock) return rlBlock;
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes2("Invalid JSON body", 400);
  }
  const rows = Array.isArray(body) ? body : body && body.abayas;
  const allowEmpty = !Array.isArray(body) && !!(body && body.allowEmpty === true);
  if (!Array.isArray(rows)) {
    return errRes2("Body must be a JSON array or { abayas: [...] }", 400);
  }
  const norm = [];
  const seenId = /* @__PURE__ */ new Set();
  const seenBc = /* @__PURE__ */ new Set();
  const defaultCatalogProcess = String(env.DEFAULT_CATALOG_PROCESS ?? "Tailor (01)").trim() || "Tailor (01)";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== "object") {
      return errRes2(`Row ${i + 1}: must be an object`, 400);
    }
    const id = String(r.id ?? "").trim();
    const code = String(r.code ?? "").trim();
    const barcode = String(r.barcode ?? "").trim();
    const design = String(r.design ?? "").trim();
    let process = String(r.process ?? "").trim();
    const iconRaw = r.icon;
    const icon = iconRaw == null || iconRaw === "" ? "" : String(iconRaw);
    const isCustomProvided = r.is_custom != null;
    const isCustom = isCustomProvided ? r.is_custom ? 1 : 0 : null;
    if (!barcode) continue;
    if (!process) process = defaultCatalogProcess;
    const finalCode = code || barcode;
    const finalId = id || barcode.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (seenId.has(finalId) || seenBc.has(barcode)) continue;
    seenId.add(finalId);
    seenBc.add(barcode);
    norm.push({ id: finalId, code: finalCode, barcode, design, process, icon, isCustomProvided, isCustom });
  }
  if (!norm.length && !allowEmpty) {
    return errRes2(
      "Refusing to replace catalog with 0 rows. Pass { allowEmpty: true } only when you intentionally want an empty catalog.",
      400
    );
  }
  const prevRowsResult = await env.DB.prepare(
    "SELECT id, code, barcode, design, process, icon, is_custom FROM abaya_catalog"
  ).all();
  const prevRows = Array.isArray(prevRowsResult.results) ? prevRowsResult.results : [];
  const prevIsCustomById = /* @__PURE__ */ Object.create(null);
  for (const pr of prevRows) {
    if (pr && pr.id != null) prevIsCustomById[String(pr.id)] = Number(pr.is_custom) === 1 ? 1 : 0;
  }
  const prevVersionRow = await env.DB.prepare("SELECT v FROM catalog_meta WHERE k = ?").bind("version").first();
  const prevVersion = prevVersionRow && prevVersionRow.v != null ? String(prevVersionRow.v) : "0";
  const newVersion = String(Date.now());
  const stmts = [env.DB.prepare("DELETE FROM abaya_catalog")];
  for (const r of norm) {
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
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)").bind("version", newVersion)
  );
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || "");
    if (msg.includes("UNIQUE constraint failed: abaya_catalog.code")) {
      return errRes2(
        "Catalog DB schema still enforces unique code. Apply migration cloudflare/migrations/0005_allow_duplicate_abaya_code.sql and retry.",
        400
      );
    }
    try {
      const restore = [env.DB.prepare("DELETE FROM abaya_catalog")];
      for (const r of prevRows) {
        restore.push(
          env.DB.prepare(
            `INSERT INTO abaya_catalog (id, code, barcode, design, process, icon, is_custom, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`
          ).bind(r.id, r.code, r.barcode, r.design, r.process, r.icon || null, Number(r.is_custom) === 1 ? 1 : 0)
        );
      }
      restore.push(
        env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)").bind("version", prevVersion)
      );
      await env.DB.batch(restore);
    } catch (_) {
    }
    throw e;
  }
  return jsonRes2({ ok: true, version: newVersion, count: norm.length });
}
__name(handleCatalogAbayasPut, "handleCatalogAbayasPut");

// src/modules/roster.js
var EMP_COLUMNS = "id, name, code, emp_no, ac_no, process, barcode, color, initials, photo";
async function readVersion(env, key) {
  const row = await env.DB.prepare("SELECT v FROM catalog_meta WHERE k = ?").bind(key).first();
  return row && row.v != null ? String(row.v) : "0";
}
__name(readVersion, "readVersion");
async function handleEmployeesGet(env, jsonRes2) {
  const version = await readVersion(env, "employees_version");
  const { results } = await env.DB.prepare(
    `SELECT ${EMP_COLUMNS} FROM employees ORDER BY name ASC`
  ).all();
  const employees = (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code || "",
    emp_no: r.emp_no || "",
    ac_no: r.ac_no || "",
    process: r.process || "",
    barcode: r.barcode || "",
    color: r.color || "#6a5fc1",
    initials: r.initials || String(r.name || "?").slice(0, 2).toUpperCase(),
    photo: r.photo || ""
  }));
  return jsonRes2({ ok: true, version, employees }, 200, {
    "Cache-Control": "public, max-age=10, stale-while-revalidate=120"
  });
}
__name(handleEmployeesGet, "handleEmployeesGet");
async function handleEmployeesPut(request, env, helpers) {
  const { errRes: errRes2, jsonRes: jsonRes2, rateLimitOr429: rateLimitOr4292 } = helpers;
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes2("Unauthorized ingest request", 401);
  }
  const rlBlock = await rateLimitOr4292(
    env.CATALOG_PUT_RATE_LIMIT,
    "employees-put",
    "Too many roster uploads. Wait and retry."
  );
  if (rlBlock) return rlBlock;
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes2("Invalid JSON body", 400);
  }
  const rows = Array.isArray(body) ? body : body && body.employees;
  const allowEmpty = !Array.isArray(body) && !!(body && body.allowEmpty === true);
  if (!Array.isArray(rows)) {
    return errRes2("Body must be a JSON array or { employees: [...] }", 400);
  }
  const norm = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== "object") return errRes2(`Row ${i + 1}: must be an object`, 400);
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    const id = String(r.id ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    norm.push({
      id,
      name,
      code: String(r.code ?? "").trim(),
      emp_no: String(r.emp_no ?? "").trim(),
      ac_no: String(r.ac_no ?? "").trim(),
      process: String(r.process ?? "").trim(),
      barcode: String(r.barcode ?? "").trim(),
      color: String(r.color ?? "").trim(),
      initials: String(r.initials ?? "").trim(),
      photo: String(r.photo ?? "").trim()
    });
  }
  if (!norm.length && !allowEmpty) {
    return errRes2(
      "Refusing to replace the roster with 0 employees. Pass { allowEmpty: true } to intentionally clear it.",
      400
    );
  }
  const prevResult = await env.DB.prepare(`SELECT ${EMP_COLUMNS} FROM employees`).all();
  const prevRows = Array.isArray(prevResult.results) ? prevResult.results : [];
  const prevVersion = await readVersion(env, "employees_version");
  const insert = /* @__PURE__ */ __name((r) => env.DB.prepare(
    `INSERT INTO employees (${EMP_COLUMNS}, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
  ).bind(
    r.id,
    r.name,
    r.code || null,
    r.emp_no || null,
    r.ac_no || null,
    r.process || null,
    r.barcode || null,
    r.color || null,
    r.initials || null,
    r.photo || null
  ), "insert");
  const newVersion = String(Date.now());
  const stmts = [env.DB.prepare("DELETE FROM employees")];
  for (const r of norm) stmts.push(insert(r));
  stmts.push(
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)").bind("employees_version", newVersion)
  );
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    try {
      const restore = [env.DB.prepare("DELETE FROM employees")];
      for (const r of prevRows) restore.push(insert(r));
      restore.push(
        env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)").bind("employees_version", prevVersion)
      );
      await env.DB.batch(restore);
    } catch (_) {
    }
    throw e;
  }
  return jsonRes2({ ok: true, version: newVersion, count: norm.length });
}
__name(handleEmployeesPut, "handleEmployeesPut");
async function handleWorkTypesGet(env, jsonRes2) {
  const version = await readVersion(env, "work_types_version");
  const { results } = await env.DB.prepare(
    "SELECT name FROM work_types ORDER BY position ASC, name ASC"
  ).all();
  const workTypes = (results || []).map((r) => r.name).filter(Boolean);
  return jsonRes2({ ok: true, version, workTypes }, 200, {
    "Cache-Control": "public, max-age=10, stale-while-revalidate=120"
  });
}
__name(handleWorkTypesGet, "handleWorkTypesGet");
async function handleWorkTypesPut(request, env, helpers) {
  const { errRes: errRes2, jsonRes: jsonRes2, rateLimitOr429: rateLimitOr4292 } = helpers;
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes2("Unauthorized ingest request", 401);
  }
  const rlBlock = await rateLimitOr4292(
    env.CATALOG_PUT_RATE_LIMIT,
    "work-types-put",
    "Too many work-type uploads. Wait and retry."
  );
  if (rlBlock) return rlBlock;
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes2("Invalid JSON body", 400);
  }
  const rows = Array.isArray(body) ? body : body && body.workTypes;
  const allowEmpty = !Array.isArray(body) && !!(body && body.allowEmpty === true);
  if (!Array.isArray(rows)) {
    return errRes2("Body must be a JSON array or { workTypes: [...] }", 400);
  }
  const norm = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of rows) {
    const name = String(raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    norm.push(name);
  }
  if (!norm.length && !allowEmpty) {
    return errRes2(
      "Refusing to replace work types with 0 entries. Pass { allowEmpty: true } to intentionally clear them.",
      400
    );
  }
  const prevResult = await env.DB.prepare("SELECT name, position FROM work_types").all();
  const prevRows = Array.isArray(prevResult.results) ? prevResult.results : [];
  const prevVersion = await readVersion(env, "work_types_version");
  const newVersion = String(Date.now());
  const stmts = [env.DB.prepare("DELETE FROM work_types")];
  norm.forEach((name, i) => {
    stmts.push(
      env.DB.prepare("INSERT INTO work_types (name, position, updated_at) VALUES (?, ?, unixepoch())").bind(name, i)
    );
  });
  stmts.push(
    env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)").bind("work_types_version", newVersion)
  );
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    try {
      const restore = [env.DB.prepare("DELETE FROM work_types")];
      for (const r of prevRows) {
        restore.push(
          env.DB.prepare("INSERT INTO work_types (name, position, updated_at) VALUES (?, ?, unixepoch())").bind(
            r.name,
            r.position || 0
          )
        );
      }
      restore.push(
        env.DB.prepare("INSERT OR REPLACE INTO catalog_meta (k, v) VALUES (?, ?)").bind("work_types_version", prevVersion)
      );
      await env.DB.batch(restore);
    } catch (_) {
    }
    throw e;
  }
  return jsonRes2({ ok: true, version: newVersion, count: norm.length });
}
__name(handleWorkTypesPut, "handleWorkTypesPut");

// src/http-response.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  // Cache-Control + Pragma are non-safelisted request headers, so cross-origin
  // fetches (e.g. embeded dashboards on other domains) need a CORS preflight.
  // Whitelist them so the CEO JSON stays fresh.
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ingest-Secret, Cache-Control, Pragma",
  "Access-Control-Max-Age": "86400"
};
var CEO_JSON_NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  "CDN-Cache-Control": "no-store"
};
function jsonRes(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extraHeaders }
  });
}
__name(jsonRes, "jsonRes");
function errRes(msg, status = 400, extraHeaders = {}) {
  return jsonRes({ ok: false, error: msg }, status, extraHeaders);
}
__name(errRes, "errRes");
function isD1Error(err) {
  if (!err) return false;
  const msg = err && err.message ? String(err.message) : String(err);
  return msg.startsWith("D1_ERROR");
}
__name(isD1Error, "isD1Error");
function d1ErrorResponse(err, retryAfterSec = 30) {
  return errRes(
    "database temporarily unavailable, retry shortly",
    503,
    { "Retry-After": String(retryAfterSec) }
  );
}
__name(d1ErrorResponse, "d1ErrorResponse");

// src/ratelimit.js
async function rateLimitOr429(rl, key, message) {
  try {
    if (!rl || typeof rl.limit !== "function") return null;
    const out = await rl.limit({ key });
    if (out && out.success === false) {
      return errRes(message || "Too many requests. Try again shortly.", 429);
    }
    return null;
  } catch (e) {
    console.error("Rate limit binding error:", e && e.message ? e.message : e);
    return null;
  }
}
__name(rateLimitOr429, "rateLimitOr429");
function rateLimitClientKey(request, prefix) {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf && cf.trim()) return `${prefix}:${cf.trim()}`;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return `${prefix}:${first}`;
  }
  return `${prefix}:unknown`;
}
__name(rateLimitClientKey, "rateLimitClientKey");

// src/auth/ceo-token.js
var CEO_SESSION_COOKIE = "abaya_ceo_session";
var CEO_REFRESH_COOKIE = "abaya_ceo_refresh";
function parseCookieHeader(header) {
  const out = {};
  const raw = String(header || "");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    let v = part.slice(idx + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch (_) {
    }
    if (k) out[k] = v;
  }
  return out;
}
__name(parseCookieHeader, "parseCookieHeader");
function extractCeoToken(request, url) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (auth) return auth;
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const fromCookie = (cookies[CEO_SESSION_COOKIE] || "").trim();
  if (fromCookie) return fromCookie;
  return (url.searchParams.get("token") || "").trim();
}
__name(extractCeoToken, "extractCeoToken");
function extractRefreshToken(request) {
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  return (cookies[CEO_REFRESH_COOKIE] || "").trim();
}
__name(extractRefreshToken, "extractRefreshToken");
function buildSetCeoSessionCookie(token, opts) {
  const secure = !!(opts && opts.secure);
  const maxAge = opts && opts.maxAge != null ? Number(opts.maxAge) : 604800;
  const v = encodeURIComponent(String(token || "").trim());
  const parts = [`${CEO_SESSION_COOKIE}=${v}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  parts.push("Max-Age=" + (Number.isFinite(maxAge) && maxAge > 0 ? String(Math.floor(maxAge)) : "604800"));
  return parts.join("; ");
}
__name(buildSetCeoSessionCookie, "buildSetCeoSessionCookie");
function buildSetRefreshCookie(token, opts) {
  const secure = !!(opts && opts.secure);
  const maxAge = opts && opts.maxAge != null ? Number(opts.maxAge) : 604800;
  const v = encodeURIComponent(String(token || "").trim());
  const parts = [`${CEO_REFRESH_COOKIE}=${v}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  parts.push("Max-Age=" + (Number.isFinite(maxAge) && maxAge > 0 ? String(Math.floor(maxAge)) : "604800"));
  return parts.join("; ");
}
__name(buildSetRefreshCookie, "buildSetRefreshCookie");
function buildClearCeoSessionCookie(opts) {
  const secure = !!(opts && opts.secure);
  return [
    `${CEO_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...secure ? ["Secure"] : []
  ].join("; ");
}
__name(buildClearCeoSessionCookie, "buildClearCeoSessionCookie");
function buildClearCeoRefreshCookie(opts) {
  const secure = !!(opts && opts.secure);
  return [
    `${CEO_REFRESH_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...secure ? ["Secure"] : []
  ].join("; ");
}
__name(buildClearCeoRefreshCookie, "buildClearCeoRefreshCookie");
function appendCeoSessionCookies(headers, tokens, secure) {
  headers.append(
    "Set-Cookie",
    buildSetCeoSessionCookie(tokens.access, { secure, maxAge: tokens.accessTtl })
  );
  headers.append(
    "Set-Cookie",
    buildSetRefreshCookie(tokens.refresh, { secure, maxAge: tokens.refreshTtl })
  );
}
__name(appendCeoSessionCookies, "appendCeoSessionCookies");
function appendClearCeoSessionCookies(headers, secure) {
  headers.append("Set-Cookie", buildClearCeoSessionCookie({ secure }));
  headers.append("Set-Cookie", buildClearCeoRefreshCookie({ secure }));
}
__name(appendClearCeoSessionCookies, "appendClearCeoSessionCookies");

// src/auth/ceo-jwt.js
var encoder = new TextEncoder();
function b64urlEncodeBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(b64urlEncodeBytes, "b64urlEncodeBytes");
function b64urlDecode(str) {
  let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "====".slice(0, 4 - pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(b64urlDecode, "b64urlDecode");
async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return b64urlEncodeBytes(new Uint8Array(sig));
}
__name(hmacSign, "hmacSign");
async function hmacVerify(message, signatureB64url, secret) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sig = b64urlDecode(signatureB64url);
    return crypto.subtle.verify("HMAC", key, sig, encoder.encode(message));
  } catch (_) {
    return false;
  }
}
__name(hmacVerify, "hmacVerify");
function parsePositiveIntEnv(env, key, def, maxSec) {
  const n = parseInt(String(env[key] || ""), 10);
  if (!Number.isFinite(n) || n <= 0 || n > maxSec) return def;
  return n;
}
__name(parsePositiveIntEnv, "parsePositiveIntEnv");
function getCredentialVersion(env) {
  const n = parseInt(String(env.CEO_CREDENTIAL_VERSION ?? "1"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}
__name(getCredentialVersion, "getCredentialVersion");
function getAccessTtlSec(env) {
  return parsePositiveIntEnv(env, "CEO_ACCESS_TTL_SEC", 3600, 86400);
}
__name(getAccessTtlSec, "getAccessTtlSec");
function getRefreshTtlSec(env) {
  return parsePositiveIntEnv(env, "CEO_REFRESH_TTL_SEC", 604800, 60 * 86400);
}
__name(getRefreshTtlSec, "getRefreshTtlSec");
function collectJwtSecrets(env) {
  const primary = String(env.CEO_JWT_SECRET || "").trim();
  const prev = String(env.CEO_JWT_SECRET_PREVIOUS || "").trim();
  const out = [];
  if (primary) out.push(primary);
  if (prev && prev !== primary) out.push(prev);
  return out;
}
__name(collectJwtSecrets, "collectJwtSecrets");
async function signCeoJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64urlEncodeBytes(encoder.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncodeBytes(encoder.encode(JSON.stringify(payload)));
  const msg = headerB64 + "." + payloadB64;
  const sig = await hmacSign(msg, secret);
  return msg + "." + sig;
}
__name(signCeoJwt, "signCeoJwt");
var CLOCK_SKEW_SEC = 90;
async function verifyCeoJwt(token, secrets) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return { ok: false, error: "malformed" };
  const [h, p, s] = parts;
  const msg = h + "." + p;
  let okSig = false;
  for (let i = 0; i < secrets.length; i++) {
    if (!secrets[i]) continue;
    if (await hmacVerify(msg, s, secrets[i])) {
      okSig = true;
      break;
    }
  }
  if (!okSig) return { ok: false, error: "bad_sig" };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch (_) {
    return { ok: false, error: "bad_payload" };
  }
  const now = Math.floor(Date.now() / 1e3);
  if (typeof payload.exp !== "number" || payload.exp < now - CLOCK_SKEW_SEC) {
    return { ok: false, error: "expired", payload };
  }
  if (typeof payload.iat === "number" && payload.iat > now + CLOCK_SKEW_SEC) {
    return { ok: false, error: "future_iat" };
  }
  return { ok: true, payload };
}
__name(verifyCeoJwt, "verifyCeoJwt");
async function verifyAccessToken(token, env) {
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) return { ok: false, error: "no_jwt_secret" };
  const r = await verifyCeoJwt(token, secrets);
  if (!r.ok) return r;
  const pl = r.payload;
  if (pl.sub !== "ceo" || pl.typ !== "ceo_access") {
    return { ok: false, error: "wrong_typ", payload: pl };
  }
  if (Number(pl.cv) !== getCredentialVersion(env)) {
    return { ok: false, error: "cv_mismatch", payload: pl };
  }
  return { ok: true, payload: pl };
}
__name(verifyAccessToken, "verifyAccessToken");
async function verifyRefreshToken(token, env) {
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) return { ok: false, error: "no_jwt_secret" };
  const r = await verifyCeoJwt(token, secrets);
  if (!r.ok) return r;
  const pl = r.payload;
  if (pl.sub !== "ceo" || pl.typ !== "ceo_refresh") {
    return { ok: false, error: "wrong_typ" };
  }
  if (Number(pl.cv) !== getCredentialVersion(env)) {
    return { ok: false, error: "cv_mismatch" };
  }
  return { ok: true, payload: pl };
}
__name(verifyRefreshToken, "verifyRefreshToken");
async function mintCeoSessionPair(env) {
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) {
    return { ok: false, error: "missing_CEO_JWT_SECRET" };
  }
  const secret = secrets[0];
  const nowSec = Math.floor(Date.now() / 1e3);
  const cv = getCredentialVersion(env);
  const accessTtl = getAccessTtlSec(env);
  const refreshTtl = getRefreshTtlSec(env);
  const access = await signCeoJwt(
    { sub: "ceo", typ: "ceo_access", iat: nowSec, exp: nowSec + accessTtl, cv },
    secret
  );
  const refresh = await signCeoJwt(
    { sub: "ceo", typ: "ceo_refresh", iat: nowSec, exp: nowSec + refreshTtl, cv },
    secret
  );
  return { ok: true, access, refresh, accessTtl, refreshTtl, exp: nowSec + accessTtl };
}
__name(mintCeoSessionPair, "mintCeoSessionPair");

// src/auth/ceo-auth.js
async function isCeoAuthenticated(request, env, url) {
  const token = extractCeoToken(request, url);
  if (!token) return false;
  const primary = String(env.CEO_TOKEN || "").trim();
  const prevPw = String(env.CEO_TOKEN_PREVIOUS || "").trim();
  if (token === primary || prevPw && token === prevPw) {
    return true;
  }
  const secrets = collectJwtSecrets(env);
  if (!secrets.length) {
    return false;
  }
  const v = await verifyAccessToken(token, env);
  return v.ok === true;
}
__name(isCeoAuthenticated, "isCeoAuthenticated");

// src/auth/ceo-login.js
function ceoPasswordOk(env, p) {
  const t = String(p || "").trim();
  if (!t) return false;
  const primary = String(env.CEO_TOKEN || "").trim();
  const prev = String(env.CEO_TOKEN_PREVIOUS || "").trim();
  return t === primary || !!prev && t === prev;
}
__name(ceoPasswordOk, "ceoPasswordOk");

// src/working-hours.js
var FACTORY_HOURLY_START = 9;
var FACTORY_HOURLY_END = 23;
var WORKING_HOURS_KEY = "working_hours_v1";
function workingHoursConfigFromRow(row) {
  if (!row || row.v == null) return defaultWorkingHoursConfig();
  try {
    return normalizeWorkingHoursConfig(JSON.parse(String(row.v)));
  } catch (_) {
    return defaultWorkingHoursConfig();
  }
}
__name(workingHoursConfigFromRow, "workingHoursConfigFromRow");
var WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
var _ymdFmt = /* @__PURE__ */ new Map();
var _weekdayFmt = /* @__PURE__ */ new Map();
var _minutePartsFmt = /* @__PURE__ */ new Map();
function ymdFormatter(tz) {
  if (!_ymdFmt.has(tz))
    _ymdFmt.set(tz, new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }));
  return _ymdFmt.get(tz);
}
__name(ymdFormatter, "ymdFormatter");
function weekdayFormatter(tz) {
  if (!_weekdayFmt.has(tz))
    _weekdayFmt.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }));
  return _weekdayFmt.get(tz);
}
__name(weekdayFormatter, "weekdayFormatter");
function minutePartsFormatter(tz) {
  if (!_minutePartsFmt.has(tz))
    _minutePartsFmt.set(
      tz,
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    );
  return _minutePartsFmt.get(tz);
}
__name(minutePartsFormatter, "minutePartsFormatter");
function getFactoryTz(env) {
  const t = env.FACTORY_TZ;
  return typeof t === "string" && t.trim() ? t.trim() : "Asia/Dubai";
}
__name(getFactoryTz, "getFactoryTz");
function defaultWorkingHoursConfig() {
  return {
    profile: "normal",
    timezone: "Asia/Dubai",
    days: {
      sat: [["09:00", "13:30"], ["15:00", "20:00"], ["20:40", "23:30"]],
      sun: [["09:00", "13:30"], ["15:00", "20:00"], ["20:40", "23:30"]],
      mon: [["09:00", "13:30"], ["15:00", "20:00"], ["20:40", "23:30"]],
      tue: [["09:00", "13:30"], ["15:00", "20:00"], ["20:40", "23:30"]],
      wed: [["09:00", "13:30"], ["15:00", "20:00"], ["20:40", "23:30"]],
      thu: [["09:00", "13:30"], ["15:00", "20:00"], ["20:40", "23:30"]],
      fri: [["15:00", "20:00"], ["20:40", "23:30"]]
    }
  };
}
__name(defaultWorkingHoursConfig, "defaultWorkingHoursConfig");
function parseHHMMToMinute(text) {
  const s = String(text || "").trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
__name(parseHHMMToMinute, "parseHHMMToMinute");
function minuteToHHMM(minute) {
  const m = Math.max(0, Math.min(1439, Number(minute) || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
__name(minuteToHHMM, "minuteToHHMM");
function normalizeWorkingHoursConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = defaultWorkingHoursConfig();
  if (typeof src.profile === "string" && src.profile.trim()) out.profile = src.profile.trim();
  if (typeof src.timezone === "string" && src.timezone.trim()) out.timezone = src.timezone.trim();
  const days = src.days && typeof src.days === "object" ? src.days : {};
  for (const key of WEEKDAY_KEYS) {
    const arr = Array.isArray(days[key]) ? days[key] : out.days[key];
    const windows = [];
    for (const win of arr) {
      if (!Array.isArray(win) || win.length !== 2) continue;
      const st = parseHHMMToMinute(win[0]);
      const en = parseHHMMToMinute(win[1]);
      if (st == null || en == null || en <= st) continue;
      windows.push([st, en]);
    }
    windows.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < windows.length; i++) {
      if (windows[i][0] < windows[i - 1][1]) {
        throw new Error(`Overlapping windows for ${key}`);
      }
    }
    out.days[key] = windows.map((w) => [minuteToHHMM(w[0]), minuteToHHMM(w[1])]);
  }
  return out;
}
__name(normalizeWorkingHoursConfig, "normalizeWorkingHoursConfig");
var WORKING_HOURS_CACHE_TTL_MS = 6e4;
var _whCache = null;
var _whInflight = null;
async function getWorkingHoursConfig(env) {
  const now = Date.now();
  if (_whCache && now - _whCache.fetchedAt < WORKING_HOURS_CACHE_TTL_MS) {
    return _whCache.cfg;
  }
  if (_whInflight) {
    return _whInflight;
  }
  _whInflight = (async () => {
    try {
      const row = await env.DB.prepare("SELECT v FROM worker_settings WHERE k = ?").bind(WORKING_HOURS_KEY).first();
      const cfg = workingHoursConfigFromRow(row);
      _whCache = { cfg, fetchedAt: Date.now() };
      return cfg;
    } finally {
      _whInflight = null;
    }
  })();
  return _whInflight;
}
__name(getWorkingHoursConfig, "getWorkingHoursConfig");
async function saveWorkingHoursConfig(env, cfg) {
  const normalized = normalizeWorkingHoursConfig(cfg);
  await env.DB.prepare(
    "INSERT INTO worker_settings (k, v, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=unixepoch()"
  ).bind(WORKING_HOURS_KEY, JSON.stringify(normalized)).run();
  _whCache = null;
  return normalized;
}
__name(saveWorkingHoursConfig, "saveWorkingHoursConfig");
function ymdInTz(epochSec, tz) {
  return ymdFormatter(tz).format(new Date(epochSec * 1e3));
}
__name(ymdInTz, "ymdInTz");
function weekdayKeyInTz(epochSec, tz) {
  const wd = weekdayFormatter(tz).format(new Date(epochSec * 1e3)).toLowerCase().slice(0, 3);
  return WEEKDAY_KEYS.includes(wd) ? wd : "sun";
}
__name(weekdayKeyInTz, "weekdayKeyInTz");
function minuteOfDayInTz(epochSec, tz) {
  const parts = minutePartsFormatter(tz).formatToParts(new Date(epochSec * 1e3));
  const hh = Number((parts.find((p) => p.type === "hour") || {}).value || 0);
  const mm = Number((parts.find((p) => p.type === "minute") || {}).value || 0);
  return hh * 60 + mm;
}
__name(minuteOfDayInTz, "minuteOfDayInTz");
function windowsForDay(config, weekdayKey) {
  const arr = config && config.days && Array.isArray(config.days[weekdayKey]) ? config.days[weekdayKey] : [];
  const out = [];
  for (const [s, e] of arr) {
    const st = parseHHMMToMinute(s);
    const en = parseHHMMToMinute(e);
    if (st == null || en == null || en <= st) continue;
    out.push([st, en]);
  }
  return out;
}
__name(windowsForDay, "windowsForDay");
function isInWorkingWindow(epochSec, config) {
  const tz = config && config.timezone || "Asia/Dubai";
  const k = weekdayKeyInTz(epochSec, tz);
  const minute = minuteOfDayInTz(epochSec, tz);
  const windows = windowsForDay(config, k);
  return windows.some(([s, e]) => minute >= s && minute < e);
}
__name(isInWorkingWindow, "isInWorkingWindow");
function localMidnightSec(epochSec, tz) {
  const lo = epochSec - 48 * 3600;
  const hi = epochSec;
  const ymdTarget = ymdInTz(epochSec, tz);
  for (let t = lo; t <= hi; t += 60) {
    if (ymdInTz(t, tz) === ymdTarget) {
      return t;
    }
  }
  return null;
}
__name(localMidnightSec, "localMidnightSec");
function currentShiftStartSec(epochSec, config) {
  const tz = config && config.timezone || "Asia/Dubai";
  for (let t = epochSec; t >= epochSec - 48 * 3600; t -= 60) {
    const k = weekdayKeyInTz(t, tz);
    const m = minuteOfDayInTz(t, tz);
    const ws = windowsForDay(config, k);
    if (!ws.length) continue;
    for (let i = 0; i < ws.length; i++) {
      const [s, e] = ws[i];
      if (m >= s && m < e) {
        const midnight = localMidnightSec(t, tz);
        if (midnight == null) return null;
        return midnight + s * 60;
      }
    }
  }
  return null;
}
__name(currentShiftStartSec, "currentShiftStartSec");
function workingStatusNow(config) {
  const now = Math.floor(Date.now() / 1e3);
  const tz = config && config.timezone || "Asia/Dubai";
  const k = weekdayKeyInTz(now, tz);
  const minute = minuteOfDayInTz(now, tz);
  const windows = windowsForDay(config, k);
  if (!windows.length) return "closed";
  if (windows.some(([s, e]) => minute >= s && minute < e)) return "open";
  return "break";
}
__name(workingStatusNow, "workingStatusNow");
function overlapSecWithWindows(startSec, endSec, config) {
  const st0 = Math.floor(Number(startSec) || 0);
  const en0 = Math.floor(Number(endSec) || 0);
  if (en0 <= st0) return 0;
  const HARD_CAP_SEC = 48 * 3600;
  const st = en0 - st0 > HARD_CAP_SEC ? en0 - HARD_CAP_SEC : st0;
  const en = en0;
  const span = en - st;
  const stepSec = span <= 2 * 3600 ? 60 : span <= 24 * 3600 ? 600 : 3600;
  const inWinMemo = /* @__PURE__ */ new Map();
  const tz = config && config.timezone || "Asia/Dubai";
  let total = 0;
  function inWin(t) {
    if (inWinMemo.has(t)) return inWinMemo.get(t);
    const k = weekdayKeyInTz(t, tz);
    const minute = minuteOfDayInTz(t, tz);
    const windows = windowsForDay(config, k);
    const ok = windows.some(([s, e]) => minute >= s && minute < e);
    if (inWinMemo.size > 5e3) inWinMemo.clear();
    inWinMemo.set(t, ok);
    return ok;
  }
  __name(inWin, "inWin");
  for (let t = st; t < en; t += stepSec) {
    const t2 = Math.min(en, t + stepSec);
    if (inWin(t)) total += t2 - t;
  }
  if (span > stepSec && (en - stepSec) % stepSec !== 0) {
  }
  return total;
}
__name(overlapSecWithWindows, "overlapSecWithWindows");
function factoryDateStringForUnix(env, unixSec) {
  const tz = getFactoryTz(env);
  return ymdFormatter(tz).format(new Date(unixSec * 1e3));
}
__name(factoryDateStringForUnix, "factoryDateStringForUnix");
function factoryHourForUnix(env, unixSec) {
  const tz = getFactoryTz(env);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hourCycle: "h23"
  }).formatToParts(new Date(unixSec * 1e3));
  const h = parts.find((p) => p.type === "hour");
  return h ? parseInt(h.value, 10) : 0;
}
__name(factoryHourForUnix, "factoryHourForUnix");
function factoryTodayString(env) {
  return factoryDateStringForUnix(env, Math.floor(Date.now() / 1e3));
}
__name(factoryTodayString, "factoryTodayString");

// ../shared/invoice-parser.mjs
var MAX_INVOICE_NUMBERS = 500;
var MAX_INVOICE_DIGITS_PER = 20;
var MAX_INVOICE_RAW_CHARS = 12e3;
var INVOICE_TOKEN_RE = /^\d{1,20}$/;
function parseInvoiceNumberList(raw) {
  const str = String(raw ?? "");
  if (str.length > MAX_INVOICE_RAW_CHARS) {
    return {
      ok: false,
      error: `List is too long. Use at most ${MAX_INVOICE_RAW_CHARS} characters or split across sessions.`,
      nums: []
    };
  }
  const parts = str.trim().split(/[\r\n,;\s\u00a0]+/).map((s) => s.trim()).filter(Boolean);
  const nums = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of parts) {
    if (!INVOICE_TOKEN_RE.test(p)) {
      const show = p.length > 24 ? `${p.slice(0, 24)}\u2026` : p;
      return {
        ok: false,
        error: `Invalid value "${show}": each invoice number must be digits only, 1\u2013${MAX_INVOICE_DIGITS_PER} digits.`,
        nums: []
      };
    }
    if (seen.has(p)) {
      return { ok: false, error: `Duplicate invoice number: ${p}. Remove the duplicate.`, nums: [] };
    }
    seen.add(p);
    nums.push(p);
  }
  if (nums.length < 1) {
    return { ok: false, error: "Enter at least one invoice number.", nums: [] };
  }
  if (nums.length > MAX_INVOICE_NUMBERS) {
    return { ok: false, error: `Too many invoice numbers (max ${MAX_INVOICE_NUMBERS} per session).`, nums: [] };
  }
  return { ok: true, error: "", nums };
}
__name(parseInvoiceNumberList, "parseInvoiceNumberList");

// src/domain/process.js
var WORK_TYPES = [
  "Tailor (01)",
  "Cutting master",
  "Tailor (02)",
  "Hand Work",
  "Stone Work",
  "Button",
  "Embroidery",
  "Ari Work",
  "Hand Designing",
  "Invoice maker",
  "Packaging",
  "Checker"
];
var PROCESS_TO_DAILY_COL = {
  "Tailor (01)": "tailor_01_units",
  "Tailor (02)": "tailor_02_units",
  "Hand Work": "hand_work_units",
  "Stone Work": "stone_work_units",
  Button: "button_units",
  Embroidery: "embroidery_units",
  "Ari Work": "ari_work_units",
  "Hand Designing": "hand_designing_units",
  "Invoice maker": "invoice_maker_units",
  Packaging: "packaging_units",
  Checker: "checker_units",
  Cutting: "tailor_01_units",
  "Cutting master": "tailor_01_units",
  Stitching: "tailor_02_units",
  Finishing: "hand_work_units"
};
var SUMMARY_WT_CASES = `
  SUM(CASE WHEN emp_process IN ('Tailor (01)','Cutting','Cutting master') THEN 1 ELSE 0 END) as tailor_01,
  SUM(CASE WHEN emp_process IN ('Tailor (02)','Stitching') THEN 1 ELSE 0 END) as tailor_02,
  SUM(CASE WHEN emp_process IN ('Hand Work','Finishing') THEN 1 ELSE 0 END) as hand_work,
  SUM(CASE WHEN emp_process='Stone Work' THEN 1 ELSE 0 END) as stone_work,
  SUM(CASE WHEN emp_process='Button' THEN 1 ELSE 0 END) as button,
  SUM(CASE WHEN emp_process='Embroidery' THEN 1 ELSE 0 END) as embroidery,
  SUM(CASE WHEN emp_process='Ari Work' THEN 1 ELSE 0 END) as ari_work,
  SUM(CASE WHEN emp_process='Hand Designing' THEN 1 ELSE 0 END) as hand_designing,
  SUM(CASE WHEN emp_process='Invoice maker' THEN 1 ELSE 0 END) as invoice_maker,
  SUM(CASE WHEN emp_process='Packaging' THEN 1 ELSE 0 END) as packaging,
  SUM(CASE WHEN emp_process='Checker' THEN 1 ELSE 0 END) as checker
`;
function dailyStatsColumnForProcess(proc) {
  return PROCESS_TO_DAILY_COL[proc] || "tailor_01_units";
}
__name(dailyStatsColumnForProcess, "dailyStatsColumnForProcess");
function canonicalEmpProcess(raw) {
  if (raw == null) return "Tailor (01)";
  const t = String(raw).trim();
  if (!t) return "Tailor (01)";
  const lo = t.toLowerCase();
  if (lo === "cutting" || lo === "cutting master") return "Tailor (01)";
  if (lo === "stitching") return "Tailor (02)";
  if (lo === "finishing") return "Hand Work";
  if (lo === "khaka work") return "Hand Work";
  if (WORK_TYPES.includes(t)) return t;
  return t;
}
__name(canonicalEmpProcess, "canonicalEmpProcess");
function emptyProcessSplit() {
  const o = {};
  WORK_TYPES.forEach((t) => {
    o[t] = 0;
  });
  return o;
}
__name(emptyProcessSplit, "emptyProcessSplit");

// src/handlers/ingest.js
async function handleIngest(request, env) {
  const rlBlock = await rateLimitOr429(
    env.INGEST_RATE_LIMIT,
    rateLimitClientKey(request, "factory-ingest"),
    "Too many ingest requests. Wait and retry."
  );
  if (rlBlock) return rlBlock;
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes("Unauthorized ingest request", 401);
  }
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return errRes("Invalid JSON body", 400);
  }
  if (!body || typeof body !== "object") {
    return errRes("Body must be a JSON object", 400);
  }
  const { type, payload } = body;
  const now = Math.floor(Date.now() / 1e3);
  if (type !== "session_start" && type !== "session_finish") {
    return errRes("Unknown event type: " + String(type), 400);
  }
  if (!payload || typeof payload !== "object") {
    return errRes("Missing or invalid payload", 400);
  }
  const incomingEmpId = String(payload && payload.emp_id || "").trim();
  if (!incomingEmpId) {
    return errRes("Missing emp_id in payload", 400);
  }
  if (!/^e_bc_\d+$/.test(incomingEmpId)) {
    console.warn("[ingest] rejected non-roster emp_id:", incomingEmpId, "type=", type);
    return errRes("emp_id must be in the form e_bc_<barcode> (roster guard)", 422);
  }
  if (type === "session_start") {
    const startSec = Number(payload.started_at) || now;
    const startCfg = await getWorkingHoursConfig(env);
    if (!isInWorkingWindow(startSec, startCfg)) {
      return errRes("Outside shift hours. Sessions can only start within working windows.", 422);
    }
    try {
      const insertRes = await env.DB.prepare(`
        INSERT OR REPLACE INTO active_sessions
          (emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
           abaya_id, abaya_code, station, started_at,
           effective_started_at, windowed_elapsed_sec, outside_shift, is_cross_day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        payload.emp_id,
        payload.emp_name,
        payload.emp_code,
        canonicalEmpProcess(payload.emp_process),
        payload.emp_color,
        payload.emp_initials,
        payload.abaya_id,
        payload.abaya_code,
        payload.station || "S-02",
        payload.started_at || now,
        // Live-state columns (local server is canonical for these — see
        // shared/live-row-state.cjs). Fall back to the raw started_at
        // and "in shift" defaults for legacy push payloads that don't
        // ship the new fields.
        Number.isFinite(Number(payload.effective_started_at)) ? Number(payload.effective_started_at) : payload.started_at || now,
        Math.max(0, Math.floor(Number(payload.windowed_elapsed_sec) || 0)),
        payload.outside_shift ? 1 : 0,
        payload.is_cross_day ? 1 : 0
      ).run();
      console.log("[ingest] session_start wrote", payload.emp_id, "changes=", insertRes && insertRes.meta && insertRes.meta.changes);
    } catch (insertErr) {
      console.error("[ingest] session_start INSERT failed for", payload.emp_id, ":", insertErr && insertErr.message);
      return errRes("Failed to persist session_start: " + (insertErr && insertErr.message ? insertErr.message : String(insertErr)), 500);
    }
    return jsonRes({ ok: true, event: "session_start" });
  }
  const p = payload;
  if (!p.emp_id || p.ended_at == null) {
    return errRes("session_finish requires emp_id and ended_at", 400);
  }
  const sessionId = "WL-" + p.emp_id + "-" + p.ended_at;
  const dayDate = factoryDateStringForUnix(env, p.ended_at);
  const hourOfDay = factoryHourForUnix(env, p.ended_at);
  const workingCfg = await getWorkingHoursConfig(env);
  const inWindowDuration = overlapSecWithWindows(p.started_at, p.ended_at, workingCfg);
  const storedProcess = canonicalEmpProcess(p.emp_process);
  const procCol = dailyStatsColumnForProcess(p.emp_process);
  let invCount = null;
  let invSerial = null;
  if (storedProcess === "Invoice maker") {
    const invParsed = parseInvoiceNumberList(p.invoice_serial);
    if (!invParsed.ok) return errRes("Invoice maker: " + invParsed.error, 400);
    const clientIc = p.invoice_count != null && p.invoice_count !== "" ? parseInt(String(p.invoice_count), 10) : NaN;
    if (Number.isFinite(clientIc) && clientIc !== invParsed.nums.length) {
      return errRes(
        "Invoice maker: invoice count does not match the number of invoice numbers in the list.",
        400
      );
    }
    invCount = invParsed.nums.length;
    invSerial = invParsed.nums.join(",");
  }
  const insertStmt = env.DB.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
         abaya_id, abaya_code, station, started_at, ended_at, duration_sec,
         hour_of_day, day_date, invoice_count, invoice_serial)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
    sessionId,
    p.emp_id,
    p.emp_name,
    p.emp_code,
    storedProcess,
    p.emp_color,
    p.emp_initials,
    p.abaya_id,
    p.abaya_code,
    p.station || "S-02",
    p.started_at,
    p.ended_at,
    inWindowDuration,
    hourOfDay,
    dayDate,
    invCount,
    invSerial
  );
  const deleteStmt = env.DB.prepare(`DELETE FROM active_sessions WHERE emp_id = ?`).bind(p.emp_id);
  const upsertStmt = env.DB.prepare(`
      INSERT INTO daily_stats (stat_date, total_units, total_sec, ${procCol}, updated_at)
      VALUES (?, 1, ?, 1, unixepoch())
      ON CONFLICT(stat_date) DO UPDATE SET
        total_units = total_units + 1,
        total_sec   = total_sec + ?,
        ${procCol}  = ${procCol} + 1,
        updated_at  = unixepoch()
    `).bind(dayDate, inWindowDuration, inWindowDuration);
  const extra = [];
  if (p.abaya_id != null && String(p.abaya_id) !== "") {
    extra.push(
      env.DB.prepare(`
          INSERT INTO abaya_time_map
            (abaya_id, abaya_code, cumulative_in_window_sec, first_started_at, last_ended_at, updated_at)
          VALUES (?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT(abaya_id) DO UPDATE SET
            abaya_code = COALESCE(excluded.abaya_code, abaya_time_map.abaya_code),
            cumulative_in_window_sec = abaya_time_map.cumulative_in_window_sec + excluded.cumulative_in_window_sec,
            first_started_at = CASE
              WHEN abaya_time_map.first_started_at IS NULL THEN excluded.first_started_at
              WHEN excluded.first_started_at < abaya_time_map.first_started_at THEN excluded.first_started_at
              ELSE abaya_time_map.first_started_at
            END,
            last_ended_at = CASE
              WHEN abaya_time_map.last_ended_at IS NULL THEN excluded.last_ended_at
              WHEN excluded.last_ended_at > abaya_time_map.last_ended_at THEN excluded.last_ended_at
              ELSE abaya_time_map.last_ended_at
            END,
            updated_at = unixepoch()
        `).bind(p.abaya_id, p.abaya_code || "", inWindowDuration, p.started_at, p.ended_at)
    );
  }
  try {
    const batchRes = await env.DB.batch([insertStmt, deleteStmt, upsertStmt, ...extra]);
    const sessionsMeta = batchRes && batchRes[0] && batchRes[0].meta;
    const activeDeleteMeta = batchRes && batchRes[1] && batchRes[1].meta;
    console.log(
      "[ingest] session_finish",
      sessionId,
      "sessions_changes=",
      sessionsMeta && sessionsMeta.changes,
      "active_delete_changes=",
      activeDeleteMeta && activeDeleteMeta.changes
    );
  } catch (finishErr) {
    console.error("[ingest] session_finish BATCH failed for", sessionId, ":", finishErr && finishErr.message);
    return errRes(
      "Failed to persist session_finish: " + (finishErr && finishErr.message ? finishErr.message : String(finishErr)),
      500
    );
  }
  return jsonRes({ ok: true, event: "session_finish", session_id: sessionId });
}
__name(handleIngest, "handleIngest");

// src/handlers/report-shared.js
function parseYmdUtc(ymd) {
  const s = String(ymd || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return new Date(Date.now());
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
__name(parseYmdUtc, "parseYmdUtc");
function ymdFromUtcDate(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
__name(ymdFromUtcDate, "ymdFromUtcDate");
function addUtcDays(ymd, days) {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return ymdFromUtcDate(d);
}
__name(addUtcDays, "addUtcDays");
function dayDiffInclusive(startYmd, endYmd) {
  const a = parseYmdUtc(startYmd);
  const b = parseYmdUtc(endYmd);
  const diff = Math.floor((b.getTime() - a.getTime()) / 864e5);
  return Math.max(0, diff) + 1;
}
__name(dayDiffInclusive, "dayDiffInclusive");
function weekStartMondayYmd(ymd) {
  const d = parseYmdUtc(ymd);
  const wd = d.getUTCDay();
  const offset = wd === 0 ? -6 : 1 - wd;
  d.setUTCDate(d.getUTCDate() + offset);
  return ymdFromUtcDate(d);
}
__name(weekStartMondayYmd, "weekStartMondayYmd");
function monthStartYmd(ymd) {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(1);
  return ymdFromUtcDate(d);
}
__name(monthStartYmd, "monthStartYmd");
function yearStartYmd(ymd) {
  const d = parseYmdUtc(ymd);
  d.setUTCMonth(0, 1);
  return ymdFromUtcDate(d);
}
__name(yearStartYmd, "yearStartYmd");
function reportRangeForType(type, factoryToday) {
  const t = type === "daily" || type === "weekly" || type === "monthly" || type === "yearly" ? type : "daily";
  let startYmd = factoryToday;
  if (t === "weekly") startYmd = weekStartMondayYmd(factoryToday);
  if (t === "monthly") startYmd = monthStartYmd(factoryToday);
  if (t === "yearly") startYmd = yearStartYmd(factoryToday);
  const endYmd = factoryToday;
  const days = dayDiffInclusive(startYmd, endYmd);
  const prevEnd = addUtcDays(startYmd, -1);
  const prevStart = addUtcDays(prevEnd, -(days - 1));
  return { type: t, startYmd, endYmd, prevStart, prevEnd, days };
}
__name(reportRangeForType, "reportRangeForType");
function safeYmdOrFallback(value, fallbackYmd) {
  const s = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallbackYmd;
}
__name(safeYmdOrFallback, "safeYmdOrFallback");
function isValidYmd(value) {
  const s = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseYmdUtc(s);
  return ymdFromUtcDate(d) === s;
}
__name(isValidYmd, "isValidYmd");
function customRange(from, to, opts) {
  const maxDays = Math.max(1, Number(opts && opts.maxDays) || 92);
  if (!isValidYmd(from) || !isValidYmd(to)) {
    throw new Error("Invalid from/to date (use YYYY-MM-DD)");
  }
  if (from > to) {
    throw new Error("Invalid range: from is after to");
  }
  const days = dayDiffInclusive(from, to);
  if (days > maxDays) {
    throw new Error("Range too long (max " + maxDays + " days)");
  }
  const prevEnd = addUtcDays(from, -1);
  const prevStart = addUtcDays(prevEnd, -(days - 1));
  return { type: "custom", startYmd: from, endYmd: to, prevStart, prevEnd, days };
}
__name(customRange, "customRange");
function sessionsFilterForPeriod(period, anchorYmd) {
  const range = reportRangeForType(period, anchorYmd);
  return {
    where: "WHERE day_date >= ? AND day_date <= ?",
    binds: [range.startYmd, range.endYmd],
    range
  };
}
__name(sessionsFilterForPeriod, "sessionsFilterForPeriod");

// src/handlers/state.js
var STATE_CACHE_TTL_MS = 5e3;
var _stateCache = null;
function _stateCacheKey(url) {
  return url.pathname + (url.search || "");
}
__name(_stateCacheKey, "_stateCacheKey");
async function handleState(env, url) {
  const liveMode = (url && url.searchParams && url.searchParams.get("live")) === "1";
  const cacheKey = _stateCacheKey(url);
  const now = Date.now();
  if (!liveMode && _stateCache && _stateCache.key === cacheKey && now - _stateCache.fetchedAt < STATE_CACHE_TTL_MS) {
    const ageMs = now - _stateCache.fetchedAt;
    const cached = { ..._stateCache.payload, _cache: { hit: true, age_ms: ageMs, age_sec: Math.floor(ageMs / 1e3) } };
    return jsonRes(cached, 200, CEO_JSON_NO_STORE);
  }
  const factoryToday = factoryTodayString(env);
  const workingCfg = await getWorkingHoursConfig(env);
  const todayKey = weekdayKeyInTz(Math.floor(Date.now() / 1e3), workingCfg.timezone || "Asia/Dubai");
  const windowsToday = windowsForDay(workingCfg, todayKey);
  const hourStart = windowsToday.length ? Math.floor(windowsToday[0][0] / 60) : FACTORY_HOURLY_START;
  const hourEnd = windowsToday.length ? Math.floor((windowsToday[windowsToday.length - 1][1] - 1) / 60) : FACTORY_HOURLY_END;
  const fromParam = String(url && url.searchParams && url.searchParams.get("from") || "").trim();
  const toParam = String(url && url.searchParams && url.searchParams.get("to") || "").trim();
  const explicitRange = isValidYmd(fromParam) || isValidYmd(toParam);
  let anchorYmd = factoryToday;
  let toYmd = factoryToday;
  if (explicitRange) {
    const f = isValidYmd(fromParam) ? fromParam : isValidYmd(toParam) ? toParam : factoryToday;
    const t = isValidYmd(toParam) ? toParam : f;
    if (f > t) {
      return jsonRes(
        { ok: false, error: "Invalid range: from is after to" },
        400,
        CEO_JSON_NO_STORE
      );
    }
    anchorYmd = f;
    toYmd = t;
  }
  const rawDays = parseInt(url && url.searchParams && url.searchParams.get("days") || "1", 10);
  const days = Math.max(1, Math.min(400, Number.isFinite(rawDays) ? rawDays : 1));
  const rawLimit = parseInt(url && url.searchParams && url.searchParams.get("limit") || "", 10);
  const defaultLimit = days >= 7 ? 5e3 : 100;
  const limit = Math.max(
    1,
    Math.min(5e3, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit)
  );
  let fromYmd;
  if (explicitRange) {
    fromYmd = anchorYmd;
  } else {
    const [ty, tm, td] = factoryToday.split("-").map(Number);
    const startDate = new Date(Date.UTC(ty, tm - 1, td));
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    fromYmd = startDate.getUTCFullYear() + "-" + String(startDate.getUTCMonth() + 1).padStart(2, "0") + "-" + String(startDate.getUTCDate()).padStart(2, "0");
  }
  const logsToYmd = explicitRange ? toYmd : factoryToday;
  const stmtActive = env.DB.prepare(`
      SELECT emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
        abaya_id, abaya_code, station, started_at
      FROM active_sessions ORDER BY started_at ASC
    `);
  const stmtLogs = env.DB.prepare(`
      SELECT id, emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
        abaya_id, abaya_code, station, started_at, ended_at, duration_sec,
        hour_of_day, day_date, invoice_count, invoice_serial,
        NULL as quantity, NULL as checker_barcode
      FROM sessions WHERE day_date >= ? AND day_date <= ?
      ORDER BY ended_at DESC LIMIT ?
    `).bind(fromYmd, logsToYmd, limit);
  const stmtPerf = env.DB.prepare(`
      WITH agg AS (
        SELECT emp_id, COUNT(*) as units,
               ROUND(AVG(duration_sec)) as avg_sec,
               SUM(duration_sec) as total_sec
        FROM sessions
        WHERE day_date = ? AND emp_id LIKE 'e_bc_%'
        GROUP BY emp_id
      ),
      latest AS (
        SELECT s.emp_id, s.emp_name, s.emp_process, s.emp_color, s.emp_initials
        FROM sessions s
        JOIN (
          SELECT emp_id, MAX(ended_at) AS last_end
          FROM sessions
          WHERE day_date = ? AND emp_id LIKE 'e_bc_%'
          GROUP BY emp_id
        ) m ON m.emp_id = s.emp_id AND m.last_end = s.ended_at
      )
      SELECT agg.emp_id, latest.emp_name, latest.emp_process, latest.emp_color, latest.emp_initials,
        agg.units, agg.avg_sec, agg.total_sec
      FROM agg JOIN latest ON latest.emp_id = agg.emp_id
      ORDER BY agg.units DESC
    `).bind(anchorYmd, anchorYmd);
  const stmtDaily = env.DB.prepare(`
      SELECT stat_date, total_units, total_sec, cutting_units, stitch_units, finish_units,
        tailor_01_units, tailor_02_units, hand_work_units, stone_work_units,
        button_units, embroidery_units, ari_work_units, hand_designing_units,
        invoice_maker_units, packaging_units, checker_units, peak_hour, updated_at
      FROM daily_stats WHERE stat_date >= ? AND stat_date <= ?
      ORDER BY stat_date DESC LIMIT 30
    `).bind(fromYmd, toYmd);
  const stmtAgg = env.DB.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(duration_sec), 0) as total_sec
      FROM sessions WHERE day_date >= ? AND day_date <= ? AND emp_id LIKE 'e_bc_%'
    `).bind(anchorYmd, toYmd);
  const stmtAbayasDelivered = env.DB.prepare(`
      SELECT COUNT(DISTINCT abaya_id) as abayas_delivered
      FROM sessions
      WHERE day_date >= ? AND day_date <= ?
        AND abaya_id IS NOT NULL AND abaya_id != ''
        AND emp_id LIKE 'e_bc_%'
    `).bind(anchorYmd, toYmd);
  const stmtProcSplit = env.DB.prepare(`
      SELECT emp_process, COUNT(*) as cnt FROM sessions
      WHERE day_date >= ? AND day_date <= ? AND emp_id LIKE 'e_bc_%'
      GROUP BY emp_process
    `).bind(anchorYmd, toYmd);
  const stmtHourly = env.DB.prepare(`
      SELECT hour_of_day, COUNT(*) as cnt FROM sessions
      WHERE day_date = ? AND hour_of_day >= ? AND hour_of_day <= ?
        AND emp_id LIKE 'e_bc_%'
      GROUP BY hour_of_day
    `).bind(anchorYmd, hourStart, hourEnd);
  const stmtGarment = env.DB.prepare(`
      SELECT abaya_id, MAX(abaya_code) as abaya_code,
        COUNT(*) as segments,
        COALESCE(SUM(duration_sec), 0) as completed_sec
      FROM sessions
      WHERE day_date >= ? AND day_date <= ?
      GROUP BY abaya_id
      ORDER BY SUM(duration_sec) DESC
      LIMIT 800
    `).bind(anchorYmd, toYmd);
  const stmtAbayaLifetime = env.DB.prepare(`
      SELECT abaya_id, abaya_code, cumulative_in_window_sec,
        first_started_at, last_ended_at
      FROM abaya_time_map
    `);
  const [
    activeRes,
    logsRes,
    perfRes,
    dailyRes,
    todayAggRes,
    procSplitRes,
    hourlyRes,
    garmentTodayRes,
    abayaLifetimeRes,
    abayasDeliveredRes
  ] = await env.DB.batch([
    stmtActive,
    stmtLogs,
    stmtPerf,
    stmtDaily,
    stmtAgg,
    stmtProcSplit,
    stmtHourly,
    stmtGarment,
    stmtAbayaLifetime,
    stmtAbayasDelivered
  ]);
  const liveAbayaIds = Array.from(
    new Set(
      (activeRes.results || []).map((r) => r.abaya_id != null && String(r.abaya_id) !== "" ? String(r.abaya_id) : "").filter(Boolean)
    )
  );
  let abayaBuildRowsRes = { results: [] };
  let isCustomById = {};
  if (liveAbayaIds.length > 0) {
    const placeholders = liveAbayaIds.map(() => "?").join(",");
    abayaBuildRowsRes = await env.DB.prepare(
      `WITH ordered AS (
          SELECT abaya_id, abaya_code, started_at, ended_at, duration_sec,
            LAG(ended_at) OVER (PARTITION BY abaya_id ORDER BY started_at) AS prev_end
          FROM sessions
          WHERE abaya_id IN (${placeholders})
        ),
        with_boundary AS (
          SELECT *,
            CASE WHEN prev_end IS NULL OR (started_at - prev_end) >= 86400 THEN 1 ELSE 0 END AS is_new_build
          FROM ordered
        ),
        with_seq AS (
          SELECT *, SUM(is_new_build) OVER (PARTITION BY abaya_id ORDER BY started_at) AS build_seq
          FROM with_boundary
        ),
        latest AS (
          SELECT abaya_id, MAX(build_seq) AS last_seq FROM with_seq GROUP BY abaya_id
        )
        SELECT s.abaya_id, s.abaya_code,
          s.started_at, s.ended_at, s.duration_sec
        FROM with_seq s
        JOIN latest l ON l.abaya_id = s.abaya_id AND l.last_seq = s.build_seq
        ORDER BY s.abaya_id ASC, s.started_at ASC`
    ).bind(...liveAbayaIds).all();
    const customRes = await env.DB.prepare(
      `SELECT id, is_custom FROM abaya_catalog WHERE id IN (${placeholders})`
    ).bind(...liveAbayaIds).all();
    (customRes.results || []).forEach((r) => {
      isCustomById[String(r.id)] = Number(r.is_custom) === 1;
    });
  }
  const nowSecForActive = Math.floor(Date.now() / 1e3);
  const inWindowNow = isInWorkingWindow(nowSecForActive, workingCfg);
  const active = {};
  const tzActive = workingCfg && workingCfg.timezone || "Asia/Dubai";
  const todayYmdActive = ymdInTz(nowSecForActive, tzActive);
  const shiftStartSec = currentShiftStartSec(nowSecForActive, workingCfg);
  const lastFinishByEmp = /* @__PURE__ */ Object.create(null);
  const logsForLastFinish = logsRes.results || [];
  for (let li = 0; li < logsForLastFinish.length; li++) {
    const lg = logsForLastFinish[li];
    const eid = lg && lg.emp_id;
    const eend = Number(lg && lg.ended_at);
    if (!eid || !Number.isFinite(eend) || eend <= 0) continue;
    if (lastFinishByEmp[eid] == null) lastFinishByEmp[eid] = eend;
  }
  (activeRes.results || []).forEach((row) => {
    const rawStartedSec = Number(row.started_at) || 0;
    const hasLiveCols = Number.isFinite(Number(row.effective_started_at)) && Number(row.effective_started_at) > 0;
    let startedSec;
    let overlapSec;
    let outsideShift;
    let isCrossDay = !!row.is_cross_day;
    if (hasLiveCols) {
      startedSec = Number(row.effective_started_at);
      overlapSec = overlapSecWithWindows(startedSec, nowSecForActive, workingCfg);
      outsideShift = row.outside_shift ? true : !inWindowNow || overlapSec === 0;
    } else {
      const startYmd = ymdInTz(rawStartedSec, tzActive);
      isCrossDay = startYmd !== todayYmdActive;
      startedSec = isCrossDay && shiftStartSec != null ? Math.max(rawStartedSec, shiftStartSec) : rawStartedSec;
      overlapSec = overlapSecWithWindows(startedSec, nowSecForActive, workingCfg);
      outsideShift = !inWindowNow || overlapSec === 0;
    }
    const lastFinishSec = lastFinishByEmp[row.emp_id] || 0;
    active[row.emp_id] = {
      emp_name: row.emp_name,
      emp_code: row.emp_code,
      emp_process: row.emp_process,
      process: row.emp_process,
      emp_color: row.emp_color,
      emp_initials: row.emp_initials,
      abaya_id: row.abaya_id,
      abaya_code: row.abaya_code,
      station: row.station,
      started_at: row.started_at * 1e3,
      effective_started_at: startedSec * 1e3,
      windowed_elapsed_sec: overlapSec,
      outside_shift: outsideShift,
      is_cross_day: isCrossDay,
      last_finish_at_ms: lastFinishSec > 0 ? lastFinishSec * 1e3 : 0
    };
  });
  const perf = (perfRes.results || []).map((p) => {
    const targetSec = p.units * 2700;
    const eff = p.total_sec > 0 ? Math.min(100, Math.round(targetSec / p.total_sec * 100)) : 0;
    return {
      id: p.emp_id,
      name: p.emp_name,
      process: p.emp_process,
      color: p.emp_color,
      initials: p.emp_initials,
      units: p.units,
      avg_sec: p.avg_sec,
      eff
    };
  });
  const agg = todayAggRes && todayAggRes.results && todayAggRes.results[0] || {
    cnt: 0,
    total_sec: 0
  };
  const completedToday = Number(agg.cnt) || 0;
  const totalSecToday = Number(agg.total_sec) || 0;
  const avgCycleSecToday = completedToday > 0 ? Math.round(totalSecToday / completedToday) : 0;
  const dayDurations = (logsRes.results || []).map((r) => Math.floor(Number(r.duration_sec) || 0)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  let medianSecToday = 0;
  if (dayDurations.length > 0) {
    const mid = Math.floor(dayDurations.length / 2);
    medianSecToday = dayDurations.length % 2 === 1 ? dayDurations[mid] : Math.floor((dayDurations[mid - 1] + dayDurations[mid]) / 2);
  }
  const targetSecToday = completedToday * 2700;
  const efficiencyToday = totalSecToday > 0 ? Math.min(100, Math.round(targetSecToday / totalSecToday * 100)) : 0;
  const processSplitToday = emptyProcessSplit();
  (procSplitRes.results || []).forEach((row) => {
    const key = canonicalEmpProcess(row.emp_process);
    if (processSplitToday[key] !== void 0) {
      processSplitToday[key] += Number(row.cnt) || 0;
    }
  });
  const hourlyToday = {};
  const hoursInWindowToday = /* @__PURE__ */ new Set();
  windowsToday.forEach(([startMin, endMin]) => {
    const sH = Math.floor(startMin / 60);
    const eH = Math.floor((endMin - 1) / 60);
    for (let h = sH; h <= eH; h++) hoursInWindowToday.add(h);
  });
  if (hoursInWindowToday.size === 0) {
    for (let h = hourStart; h <= hourEnd; h++) hourlyToday[h] = 0;
  } else {
    Array.from(hoursInWindowToday).sort((a, b) => a - b).forEach((h) => {
      hourlyToday[h] = 0;
    });
  }
  (hourlyRes.results || []).forEach((row) => {
    const h = Number(row.hour_of_day);
    if (Object.prototype.hasOwnProperty.call(hourlyToday, h)) {
      hourlyToday[h] = Number(row.cnt) || 0;
    }
  });
  const garmentMap = /* @__PURE__ */ new Map();
  (garmentTodayRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || id === "") return;
    garmentMap.set(String(id), {
      abaya_id: row.abaya_id,
      abaya_code: row.abaya_code != null ? String(row.abaya_code) : "",
      segments: Number(row.segments) || 0,
      completed_sec: Math.floor(Number(row.completed_sec) || 0)
    });
  });
  (activeRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || id === "") return;
    const sid = String(id);
    if (!garmentMap.has(sid)) {
      garmentMap.set(sid, {
        abaya_id: row.abaya_id,
        abaya_code: row.abaya_code != null ? String(row.abaya_code) : "",
        segments: 0,
        completed_sec: 0
      });
    }
  });
  const garment_totals_today = Array.from(garmentMap.values()).sort((a, b) => {
    const ca = a.completed_sec || 0;
    const cb = b.completed_sec || 0;
    if (cb !== ca) return cb - ca;
    return String(a.abaya_code || a.abaya_id).localeCompare(String(b.abaya_code || b.abaya_id));
  });
  const abayaLifetimeMap = {};
  (abayaLifetimeRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || id === "") return;
    abayaLifetimeMap[String(id)] = {
      abaya_id: row.abaya_id,
      abaya_code: row.abaya_code != null ? String(row.abaya_code) : "",
      cumulative_in_window_sec: Math.floor(Number(row.cumulative_in_window_sec) || 0),
      first_started_at: row.first_started_at != null ? Number(row.first_started_at) : null,
      last_ended_at: row.last_ended_at != null ? Number(row.last_ended_at) : null
    };
  });
  const abayaBuildsMap = {};
  (abayaBuildRowsRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || String(id) === "") return;
    const sid = String(id);
    const startedAt = Number(row.started_at) || 0;
    const endedAt = Number(row.ended_at) || 0;
    if (!startedAt || !endedAt) return;
    const stamped = Math.max(0, Math.floor(Number(row.duration_sec) || 0));
    const overlapNow = Math.max(0, Math.floor(overlapSecWithWindows(startedAt, endedAt, workingCfg)));
    const clamped = Math.min(stamped, overlapNow);
    let bucket = abayaBuildsMap[sid];
    if (!bucket) {
      bucket = abayaBuildsMap[sid] = {
        abaya_id: row.abaya_id,
        abaya_code: row.abaya_code != null ? String(row.abaya_code) : "",
        is_custom: isCustomById[sid] === true,
        units: 0,
        total_in_window_sec: 0,
        build_start_unix: startedAt,
        last_session_unix: endedAt,
        wall_clock_span_sec: 0
      };
    }
    bucket.units += 1;
    bucket.total_in_window_sec += clamped;
    if (startedAt < bucket.build_start_unix) bucket.build_start_unix = startedAt;
    if (endedAt > bucket.last_session_unix) bucket.last_session_unix = endedAt;
  });
  for (const sid of Object.keys(abayaBuildsMap)) {
    const b = abayaBuildsMap[sid];
    b.wall_clock_span_sec = Math.max(0, b.last_session_unix - b.build_start_unix);
    b.total_in_window_sec = Math.floor(b.total_in_window_sec);
  }
  (activeRes.results || []).forEach((row) => {
    const id = row.abaya_id;
    if (id == null || String(id) === "") return;
    const sid = String(id);
    const startedSec = Number(row.started_at) || 0;
    if (!startedSec) return;
    const b = abayaBuildsMap[sid];
    if (!b) {
      abayaBuildsMap[sid] = {
        abaya_id: row.abaya_id,
        abaya_code: row.abaya_code != null ? String(row.abaya_code) : "",
        is_custom: isCustomById[sid] === true,
        units: 0,
        total_in_window_sec: 0,
        build_start_unix: startedSec,
        last_session_unix: startedSec,
        wall_clock_span_sec: 0
      };
      return;
    }
    if (Math.abs(startedSec - b.build_start_unix) >= 86400) {
      b.units = 0;
      b.total_in_window_sec = 0;
      b.build_start_unix = startedSec;
      b.last_session_unix = startedSec;
      b.wall_clock_span_sec = 0;
    } else if (startedSec < b.build_start_unix) {
      b.build_start_unix = startedSec;
    }
  });
  const serverNowTs = Date.now();
  const latestFinishedMs = (logsRes.results || []).length && Number((logsRes.results || [])[0].ended_at) * 1e3 || 0;
  const latestActiveStartedMs = (activeRes.results || []).reduce((mx, row) => {
    const v = Number(row && row.started_at) * 1e3;
    return Number.isFinite(v) ? Math.max(mx, v) : mx;
  }, 0);
  const sourceTs = Math.max(latestFinishedMs, latestActiveStartedMs, serverNowTs);
  const ingestLagMs = Math.max(0, serverNowTs - Math.max(latestFinishedMs, latestActiveStartedMs));
  let lagMode;
  if (ingestLagMs <= 5e3) lagMode = "hot";
  else if (ingestLagMs <= 5 * 60 * 1e3) lagMode = "warm";
  else if (ingestLagMs <= 30 * 60 * 1e3) lagMode = "idle";
  else if (ingestLagMs <= 4 * 60 * 60 * 1e3) lagMode = "stale";
  else lagMode = "no-data";
  const payload = {
    ok: true,
    ts: serverNowTs,
    source_ts: sourceTs,
    db_snapshot_ts: latestFinishedMs || serverNowTs,
    server_now_ts: serverNowTs,
    ingest_lag_ms: ingestLagMs,
    logs_window_days: days,
    logs_from_ymd: fromYmd,
    logs_to_ymd: logsToYmd,
    // The KPIs (Completed / Process Split / Employee Performance /
    // Garment Totals) and the Recent Invoice Logs feed are all anchored
    // to a single day, not "today" — when the CEO picks a date from
    // the date picker, the whole dashboard flips to that day.
    kpi_anchor_ymd: anchorYmd,
    kpi_to_ymd: toYmd,
    kpi_window_days: explicitRange ? toYmd >= anchorYmd ? Math.floor((Date.parse(toYmd) - Date.parse(anchorYmd)) / 864e5) + 1 : 1 : 1,
    state_meta: {
      source: "cloudflare-worker-d1",
      lag_mode: lagMode,
      logs_window_days: days,
      logs_from_ymd: fromYmd,
      logs_to_ymd: logsToYmd,
      kpi_anchor_ymd: anchorYmd,
      kpi_to_ymd: toYmd
    },
    factory_today: factoryToday,
    completed_today: completedToday,
    abayas_delivered_today: abayasDeliveredRes && abayasDeliveredRes.results && abayasDeliveredRes.results[0] ? Number(abayasDeliveredRes.results[0].abayas_delivered) || 0 : 0,
    avg_cycle_sec_today: avgCycleSecToday,
    median_session_sec_today: medianSecToday,
    efficiency_today: efficiencyToday,
    process_split_today: processSplitToday,
    hourly_today: hourlyToday,
    working_hours: workingCfg,
    working_status: workingStatusNow(workingCfg),
    active,
    garment_totals_today,
    abaya_lifetime: abayaLifetimeMap,
    abaya_builds: abayaBuildsMap,
    logs: (logsRes.results || []).map((r) => ({
      ...r,
      process: r.emp_process,
      end: r.ended_at * 1e3,
      started_at: r.started_at * 1e3,
      ended_at: r.ended_at * 1e3
    })),
    perf,
    daily: dailyRes.results || []
  };
  if (!liveMode) {
    _stateCache = { key: cacheKey, fetchedAt: Date.now(), payload };
  }
  return jsonRes(payload, 200, CEO_JSON_NO_STORE);
}
__name(handleState, "handleState");

// src/handlers/history.js
async function handleHistory(env, url) {
  const daysParam = parseInt(url.searchParams.get("days") || "90", 10);
  const days = Math.max(1, Math.min(365, Number.isFinite(daysParam) ? daysParam : 90));
  const MAX_ROWS = 5e4;
  const today = factoryTodayString(env);
  const [ty, tm, td] = today.split("-").map(Number);
  const startDate = new Date(Date.UTC(ty, tm - 1, td));
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const startYmd = startDate.getUTCFullYear() + "-" + String(startDate.getUTCMonth() + 1).padStart(2, "0") + "-" + String(startDate.getUTCDate()).padStart(2, "0");
  const stmt = env.DB.prepare(`
      SELECT id, emp_id, emp_name, emp_code, emp_process, emp_color, emp_initials,
        abaya_id, abaya_code, station, started_at, ended_at, duration_sec,
        hour_of_day, day_date, invoice_count, invoice_serial,
        NULL as quantity, NULL as checker_barcode
      FROM sessions
      WHERE day_date >= ? AND day_date <= ?
      ORDER BY ended_at DESC
      LIMIT ?
    `).bind(startYmd, today, MAX_ROWS);
  const res = await stmt.all();
  const rows = res.results || [];
  const truncated = rows.length === MAX_ROWS;
  const logs = rows.map((r) => ({
    ...r,
    process: r.emp_process,
    end: r.ended_at * 1e3,
    started_at: r.started_at * 1e3,
    ended_at: r.ended_at * 1e3
  }));
  return jsonRes(
    {
      ok: true,
      timezone: env.FACTORY_TZ || FACTORY_TZ,
      fromYmd: startYmd,
      toYmd: today,
      requestedDays: days,
      rowCount: logs.length,
      truncated,
      logs
    },
    200,
    CEO_JSON_NO_STORE
  );
}
__name(handleHistory, "handleHistory");

// src/handlers/report.js
function rowElapsedSec(row) {
  const start = Number(row && row.min_started_at);
  const end = Number(row && row.max_ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}
__name(rowElapsedSec, "rowElapsedSec");
function windowedActiveTimeSec(row, workingCfg) {
  if (!row) return 0;
  const stamped = Math.max(0, Math.floor(Number(row.active_time_sec) || 0));
  const start = Number(row.min_started_at);
  const end = Number(row.max_ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  if (stamped === 0) return 0;
  const windowed = Math.max(0, Math.floor(overlapSecWithWindows(start, end, workingCfg) || 0));
  return Math.min(stamped, windowed);
}
__name(windowedActiveTimeSec, "windowedActiveTimeSec");
function round1(n) {
  const x = Number(n) || 0;
  return Math.round(x * 10) / 10;
}
__name(round1, "round1");
var EMP_TOLERANCE_PER_SEGMENT_SEC = 90;
var EMP_TOLERANCE_DAILY_CAP_SEC = 12 * 60;
var ITEM_TOLERANCE_PER_SEGMENT_SEC = 60;
async function handleReport(env, url) {
  const t0 = Date.now();
  const type = url.searchParams.get("type") || "daily";
  const factoryToday = factoryTodayString(env);
  const localToday = safeYmdOrFallback(url.searchParams.get("local_today"), factoryToday);
  const fromParam = String(url.searchParams.get("from") || "").trim();
  const toParam = String(url.searchParams.get("to") || "").trim();
  const dateParam = String(url.searchParams.get("date") || "").trim();
  let range;
  let isCustomRange = false;
  if (fromParam || toParam) {
    try {
      range = customRange(fromParam, toParam);
    } catch (e) {
      return errRes(String(e && e.message || e), 400);
    }
    isCustomRange = true;
  } else {
    const anchorYmd = dateParam ? safeYmdOrFallback(dateParam, localToday) : localToday;
    range = reportRangeForType(type, anchorYmd);
  }
  const explicitAnchor = isCustomRange || !!dateParam;
  let dayBinds = [range.startYmd, range.endYmd];
  let prevDayBinds = [range.prevStart, range.prevEnd];
  let dailyFallbackApplied = false;
  const dayFilter = `WHERE day_date >= ? AND day_date <= ? AND emp_id LIKE 'e_bc_%'`;
  let dbMs = 0;
  const runReportBatch = /* @__PURE__ */ __name((activeDayBinds, activePrevDayBinds) => {
    const t = Date.now();
    return env.DB.batch([
      env.DB.prepare(`
      SELECT COUNT(*) as total_units, ROUND(AVG(duration_sec)) as avg_sec,
        COUNT(DISTINCT emp_id) as unique_workers,
        COUNT(DISTINCT CASE WHEN abaya_id IS NOT NULL AND abaya_id != '' THEN abaya_id END) as unique_items,
        COALESCE(SUM(duration_sec), 0) as active_time_sec,
        MIN(started_at) as period_start_sec,
        MAX(ended_at) as period_end_sec,
        ${SUMMARY_WT_CASES}
      FROM sessions ${dayFilter}
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      WITH agg AS (
        SELECT emp_id, COUNT(*) as units, ROUND(AVG(duration_sec)) as avg_sec,
               COALESCE(SUM(duration_sec), 0) as active_time_sec,
               MIN(started_at) as min_started_at, MAX(ended_at) as max_ended_at
        FROM sessions ${dayFilter}
        GROUP BY emp_id
      ),
      latest AS (
        SELECT s.emp_id, s.emp_name, s.emp_process, s.emp_code, s.emp_color, s.emp_initials
        FROM sessions s
        JOIN (
          SELECT emp_id, MAX(ended_at) AS last_end
          FROM sessions ${dayFilter}
          GROUP BY emp_id
        ) m ON m.emp_id = s.emp_id AND m.last_end = s.ended_at
      )
      SELECT agg.emp_id, latest.emp_name, latest.emp_process, latest.emp_code,
             latest.emp_color, latest.emp_initials,
             agg.units, agg.avg_sec, agg.active_time_sec,
             agg.min_started_at, agg.max_ended_at
      FROM agg JOIN latest ON latest.emp_id = agg.emp_id
      ORDER BY agg.units DESC
    `).bind(...activeDayBinds, ...activeDayBinds),
      env.DB.prepare(`
      SELECT emp_process, COUNT(*) as units, ROUND(AVG(duration_sec)) as avg_sec, COALESCE(SUM(duration_sec), 0) as active_time_sec,
        MIN(started_at) as min_started_at, MAX(ended_at) as max_ended_at
      FROM sessions ${dayFilter}
      GROUP BY emp_process ORDER BY units DESC
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT emp_name, emp_code, abaya_code, invoice_count, invoice_serial, duration_sec, ended_at
      FROM sessions
      ${dayFilter} AND emp_process = 'Invoice maker'
        AND invoice_serial IS NOT NULL AND invoice_serial != ''
      ORDER BY ended_at DESC
      LIMIT 200
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT abaya_id, MAX(abaya_code) as abaya_code,
        COUNT(*) as segments,
        COALESCE(SUM(duration_sec), 0) as completed_sec,
        MIN(started_at) as min_started_at, MAX(ended_at) as max_ended_at
      FROM sessions ${dayFilter}
      GROUP BY abaya_id
      ORDER BY completed_sec DESC
      LIMIT 200
    `).bind(...activeDayBinds),
      env.DB.prepare(`
      SELECT COUNT(*) as total_units, ROUND(AVG(duration_sec)) as avg_sec,
        COALESCE(SUM(duration_sec), 0) as active_time_sec
      FROM sessions WHERE day_date >= ? AND day_date <= ?
    `).bind(...activePrevDayBinds),
      // Working-hours config + live sessions ride the same batch: one D1 round
      // trip for the whole report instead of four separate ones.
      env.DB.prepare(`SELECT v FROM worker_settings WHERE k = ?`).bind(WORKING_HOURS_KEY),
      env.DB.prepare(`
      SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code, started_at
      FROM active_sessions
    `)
    ]).then((rows) => {
      dbMs += Date.now() - t;
      return rows;
    });
  }, "runReportBatch");
  let [summary, byEmployeeRes, byProcessRes, invMaker, itemTotalsRes, prevSummary, whRowRes, activeRes] = await runReportBatch(
    dayBinds,
    prevDayBinds
  );
  const firstSummaryRow = summary && summary.results && summary.results[0] || {};
  if (range.type === "daily" && !explicitAnchor && (Number(firstSummaryRow.total_units) || 0) === 0) {
    const fallbackDay = range.prevStart;
    range = reportRangeForType(type, fallbackDay);
    dayBinds = [range.startYmd, range.endYmd];
    prevDayBinds = [range.prevStart, range.prevEnd];
    dailyFallbackApplied = true;
    [summary, byEmployeeRes, byProcessRes, invMaker, itemTotalsRes, prevSummary, whRowRes, activeRes] = await runReportBatch(
      dayBinds,
      prevDayBinds
    );
  }
  const workingCfg = workingHoursConfigFromRow(whRowRes && whRowRes.results && whRowRes.results[0]);
  const summaryRow = summary && summary.results && summary.results[0] || {};
  const prevSummaryRow = prevSummary && prevSummary.results && prevSummary.results[0] || {};
  const activeRows = activeRes && activeRes.results || [];
  const nowUnix = Math.floor(Date.now() / 1e3);
  const inRangeActive = activeRows.filter((r) => {
    const d = factoryDateStringForUnix(env, Number(r.started_at) || 0);
    return d >= range.startYmd && d <= range.endYmd;
  });
  const employeeMap = /* @__PURE__ */ new Map();
  (byEmployeeRes.results || []).forEach((row) => {
    const activeTime = windowedActiveTimeSec(row, workingCfg);
    const elapsedTime = rowElapsedSec(row);
    employeeMap.set(String(row.emp_id), {
      emp_id: row.emp_id,
      emp_name: row.emp_name,
      emp_process: row.emp_process,
      emp_code: row.emp_code,
      units: Number(row.units) || 0,
      // Avg = windowed total / units, not the raw wall-clock avg. The
      // operator's "average time per step" should exclude outside-shift
      // time so it answers the right question.
      avg_sec: Number(row.units) > 0 ? Math.round(activeTime / Number(row.units)) : 0,
      active_time_sec: activeTime,
      elapsed_time_sec: elapsedTime,
      live_active_time_sec: 0,
      full_time_sec: activeTime,
      efficiency_ratio: elapsedTime > 0 ? round1(activeTime / elapsedTime * 100) : 0
    });
  });
  inRangeActive.forEach((r) => {
    const id = String(r.emp_id || "");
    const live = overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
    if (!employeeMap.has(id)) {
      employeeMap.set(id, {
        emp_id: r.emp_id,
        emp_name: r.emp_name,
        emp_process: r.emp_process,
        emp_code: r.emp_code,
        units: 0,
        avg_sec: 0,
        active_time_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0,
        efficiency_ratio: 0
      });
    }
    const x = employeeMap.get(id);
    x.live_active_time_sec += live;
    x.full_time_sec = x.active_time_sec + x.live_active_time_sec;
  });
  const byEmployee = Array.from(employeeMap.values()).sort((a, b) => {
    if (b.full_time_sec !== a.full_time_sec) return b.full_time_sec - a.full_time_sec;
    return String(a.emp_name || "").localeCompare(String(b.emp_name || ""));
  });
  byEmployee.forEach((e) => {
    const tol = Math.min(EMP_TOLERANCE_DAILY_CAP_SEC, (Number(e.units) || 0) * EMP_TOLERANCE_PER_SEGMENT_SEC);
    e.tolerance_sec = tol;
    e.adjusted_full_time_sec = Math.max(0, (Number(e.full_time_sec) || 0) - tol);
  });
  const processMap = /* @__PURE__ */ new Map();
  (byProcessRes.results || []).forEach((row) => {
    const key = canonicalEmpProcess(row.emp_process);
    const activeTime = windowedActiveTimeSec(row, workingCfg);
    const elapsedTime = rowElapsedSec(row);
    if (!processMap.has(key)) {
      processMap.set(key, {
        emp_process: key,
        units: 0,
        avg_sec: 0,
        active_time_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0,
        efficiency_ratio: 0
      });
    }
    const p = processMap.get(key);
    p.units += Number(row.units) || 0;
    p.active_time_sec += activeTime;
    p.elapsed_time_sec += elapsedTime;
  });
  inRangeActive.forEach((r) => {
    const key = canonicalEmpProcess(r.emp_process);
    const live = overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
    if (!processMap.has(key)) {
      processMap.set(key, {
        emp_process: key,
        units: 0,
        avg_sec: 0,
        active_time_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0,
        efficiency_ratio: 0
      });
    }
    processMap.get(key).live_active_time_sec += live;
  });
  const byProcess = Array.from(processMap.values()).map((p) => {
    p.full_time_sec = p.active_time_sec + p.live_active_time_sec;
    p.avg_sec = p.units > 0 ? Math.round(p.active_time_sec / p.units) : 0;
    p.efficiency_ratio = p.elapsed_time_sec > 0 ? round1(p.active_time_sec / p.elapsed_time_sec * 100) : 0;
    p.tolerance_sec = 0;
    p.adjusted_full_time_sec = p.full_time_sec;
    return p;
  }).sort((a, b) => {
    if (b.full_time_sec !== a.full_time_sec) return b.full_time_sec - a.full_time_sec;
    return String(a.emp_process || "").localeCompare(String(b.emp_process || ""));
  });
  const processTol = {};
  byEmployee.forEach((e) => {
    const key = canonicalEmpProcess(e.emp_process);
    processTol[key] = (processTol[key] || 0) + (Number(e.tolerance_sec) || 0);
  });
  byProcess.forEach((p) => {
    const t = Math.floor(Number(processTol[p.emp_process]) || 0);
    p.tolerance_sec = t;
    p.adjusted_full_time_sec = Math.max(0, (Number(p.full_time_sec) || 0) - t);
  });
  const itemMap = /* @__PURE__ */ new Map();
  (itemTotalsRes.results || []).forEach((it) => {
    const key = String(it.abaya_id || "");
    if (!key) return;
    const activeTime = windowedActiveTimeSec(
      { active_time_sec: it.completed_sec, min_started_at: it.min_started_at, max_ended_at: it.max_ended_at },
      workingCfg
    );
    itemMap.set(key, {
      abaya_id: it.abaya_id,
      abaya_code: it.abaya_code,
      segments: Number(it.segments) || 0,
      active_time_sec: activeTime,
      completed_sec: activeTime,
      elapsed_time_sec: rowElapsedSec(it),
      live_active_time_sec: 0,
      full_time_sec: activeTime
    });
  });
  inRangeActive.forEach((r) => {
    const key = String(r.abaya_id || "");
    if (!key) return;
    if (!itemMap.has(key)) {
      itemMap.set(key, {
        abaya_id: r.abaya_id,
        abaya_code: r.abaya_code,
        segments: 0,
        active_time_sec: 0,
        completed_sec: 0,
        elapsed_time_sec: 0,
        live_active_time_sec: 0,
        full_time_sec: 0
      });
    }
    const x = itemMap.get(key);
    x.live_active_time_sec += overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
    x.full_time_sec = x.active_time_sec + x.live_active_time_sec;
  });
  const itemTotals = Array.from(itemMap.values()).sort((a, b) => {
    if (b.full_time_sec !== a.full_time_sec) return b.full_time_sec - a.full_time_sec;
    return String(a.abaya_code || a.abaya_id || "").localeCompare(String(b.abaya_code || b.abaya_id || ""));
  });
  const itemIds = itemTotals.map((it) => String(it.abaya_id || "")).filter(Boolean);
  const lifecycleMap = {};
  if (itemIds.length) {
    const CHUNK = 80;
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      const chunk = itemIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const lifeRes = await env.DB.prepare(
        `SELECT abaya_id, cumulative_in_window_sec FROM abaya_time_map WHERE abaya_id IN (${placeholders})`
      ).bind(...chunk).all();
      (lifeRes.results || []).forEach((r) => {
        lifecycleMap[String(r.abaya_id)] = Math.floor(Number(r.cumulative_in_window_sec) || 0);
      });
    }
  }
  itemTotals.forEach((it) => {
    const seg = Number(it.segments) || 0;
    const tol = Math.max(0, seg * ITEM_TOLERANCE_PER_SEGMENT_SEC);
    it.tolerance_sec = tol;
    it.adjusted_full_time_sec = Math.max(0, (Number(it.full_time_sec) || 0) - tol);
    it.cumulative_lifecycle_sec = Math.max(
      Number(it.full_time_sec) || 0,
      Number(lifecycleMap[String(it.abaya_id || "")] || 0)
    );
  });
  const summaryActiveSec = windowedActiveTimeSec(
    { active_time_sec: summaryRow.active_time_sec, min_started_at: summaryRow.period_start_sec, max_ended_at: summaryRow.period_end_sec },
    workingCfg
  );
  const summaryElapsedSec = rowElapsedSec({
    min_started_at: summaryRow.period_start_sec,
    max_ended_at: summaryRow.period_end_sec
  });
  const summaryLiveSec = inRangeActive.reduce(
    (s, r) => s + overlapSecWithWindows(r.started_at, nowUnix, workingCfg),
    0
  );
  const summaryFullSec = summaryActiveSec + summaryLiveSec;
  const summaryToleranceSec = byEmployee.reduce((s, e) => s + (Number(e.tolerance_sec) || 0), 0);
  const summaryAdjustedFullSec = Math.max(0, summaryFullSec - summaryToleranceSec);
  const totalUnits = Number(summaryRow.total_units) || 0;
  const throughputUnitsPerHour = summaryActiveSec > 0 ? round1(totalUnits * 3600 / summaryActiveSec) : 0;
  const utilizationPct = summaryElapsedSec > 0 ? round1(summaryActiveSec / summaryElapsedSec * 100) : 0;
  const prevUnits = Number(prevSummaryRow.total_units) || 0;
  const prevActive = windowedActiveTimeSec(
    {
      active_time_sec: prevSummaryRow.active_time_sec,
      min_started_at: prevSummaryRow.period_start_sec,
      max_ended_at: prevSummaryRow.period_end_sec
    },
    workingCfg
  );
  const prevAvg = prevUnits > 0 ? Math.round(prevActive / prevUnits) : 0;
  let byMonth = [];
  if (range.type === "yearly") {
    const monthRes = await env.DB.prepare(`
      SELECT substr(day_date, 1, 7) AS ym,
        COUNT(*) AS units,
        COUNT(DISTINCT abaya_id) AS abayas,
        COALESCE(SUM(duration_sec), 0) AS active_time_sec,
        ROUND(AVG(duration_sec)) AS avg_sec
      FROM sessions ${dayFilter}
      GROUP BY ym
      ORDER BY ym ASC
    `).bind(...dayBinds).all();
    byMonth = (monthRes.results || []).map((r) => {
      const u = Number(r.units) || 0;
      const a = Math.floor(Number(r.active_time_sec) || 0);
      const ab = Number(r.abayas) || 0;
      return {
        ym: r.ym,
        units: u,
        // finished process steps (rename in UI: "Process completed")
        abayas: ab,
        // distinct abaya_ids touched this month
        active_time_sec: a,
        avg_sec: u > 0 ? Math.round(a / u) : 0,
        avg_per_abaya_sec: ab > 0 ? Math.round(a / ab) : 0
      };
    });
  }
  return jsonRes(
    {
      ok: true,
      type: range.type,
      factory_today: factoryToday,
      local_today: localToday,
      generated: (/* @__PURE__ */ new Date()).toISOString(),
      working_hours: workingCfg,
      period: {
        start_date: range.startYmd,
        end_date: range.endYmd,
        effective_date: range.type === "daily" ? range.startYmd : "",
        anchor_date: isCustomRange || !dateParam ? "" : range.startYmd,
        custom: isCustomRange,
        fallback_applied: dailyFallbackApplied,
        previous_start_date: range.prevStart,
        previous_end_date: range.prevEnd,
        days: range.days
      },
      summary: {
        ...summaryRow,
        total_units: totalUnits,
        avg_sec: Number(summaryRow.avg_sec) || 0,
        unique_workers: Number(summaryRow.unique_workers) || 0,
        unique_items: Number(summaryRow.unique_items) || 0,
        active_time_sec: summaryActiveSec,
        elapsed_time_sec: summaryElapsedSec,
        live_active_time_sec: summaryLiveSec,
        full_time_sec: summaryFullSec,
        tolerance_sec: summaryToleranceSec,
        adjusted_full_time_sec: summaryAdjustedFullSec,
        throughput_units_per_hour: throughputUnitsPerHour,
        utilization_pct: utilizationPct
      },
      tolerance_policy: {
        model: "dual",
        employee_per_segment_sec: EMP_TOLERANCE_PER_SEGMENT_SEC,
        employee_daily_cap_sec: EMP_TOLERANCE_DAILY_CAP_SEC,
        item_per_segment_sec: ITEM_TOLERANCE_PER_SEGMENT_SEC,
        note: "Active time excludes breaks by design; tolerance reduces mishap impact in adjusted full-time views."
      },
      insights: {
        top_employees: byEmployee.slice(0, 5),
        bottleneck_processes: byProcess.slice(0, 5),
        top_items: itemTotals.slice(0, 10),
        trend_vs_previous: {
          total_units_delta: totalUnits - prevUnits,
          active_time_sec_delta: summaryActiveSec - prevActive,
          avg_sec_delta: (Number(summaryRow.avg_sec) || 0) - prevAvg
        }
      },
      by_employee: byEmployee,
      by_process: byProcess,
      by_month: byMonth,
      invoice_maker_sessions: invMaker.results || [],
      item_totals: itemTotals
    },
    200,
    Object.assign({}, CEO_JSON_NO_STORE, {
      "Server-Timing": "db;dur=" + dbMs + ", total;dur=" + (Date.now() - t0)
    })
  );
}
__name(handleReport, "handleReport");

// src/handlers/employee-day.js
async function handleEmployeeDay(env, url) {
  const t0 = Date.now();
  const empIdRaw = String(url.searchParams.get("emp_id") || "").trim();
  const date = String(url.searchParams.get("date") || "").trim();
  if (!empIdRaw) return errRes("Missing emp_id", 400);
  if (!isValidYmd(date)) return errRes("Invalid date (use YYYY-MM-DD)", 400);
  const rosterRes = await env.DB.prepare(
    `SELECT id, name, code, process, barcode FROM employees WHERE id = ? OR code = ?`
  ).bind(empIdRaw, empIdRaw).first();
  const rosterByBarcode = empIdRaw.startsWith("e_bc_") ? await env.DB.prepare(
    `SELECT id, name, code, process, barcode FROM employees
         WHERE barcode = ? OR REPLACE(barcode, '0', '') = REPLACE(?, '0', '')`
  ).bind(empIdRaw.slice("e_bc_".length), empIdRaw.slice("e_bc_".length)).first() : null;
  const emp = rosterRes || rosterByBarcode || null;
  const candidateIds = /* @__PURE__ */ new Set([empIdRaw]);
  if (emp && emp.barcode) {
    candidateIds.add("e_bc_" + String(emp.barcode));
    const numeric = String(Number(emp.barcode));
    if (numeric && numeric !== "NaN") candidateIds.add("e_bc_" + numeric);
  }
  if (emp && emp.id) {
    candidateIds.add(String(emp.id));
  }
  if (emp && emp.code) {
    candidateIds.add(String(emp.code));
  }
  if (empIdRaw.startsWith("e_bc_")) {
    candidateIds.add(empIdRaw);
  }
  const empIdList = Array.from(candidateIds);
  const empIdPlaceholders = empIdList.map(() => "?").join(",");
  const factoryToday = factoryTodayString(env);
  const isToday = date === factoryToday;
  const stmts = [
    env.DB.prepare(
      `
      SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code,
        started_at, ended_at, duration_sec, invoice_count, invoice_serial, station
      FROM sessions
      WHERE day_date = ? AND emp_id IN (${empIdPlaceholders})
      ORDER BY started_at ASC
    `
    ).bind(date, ...empIdList)
  ];
  if (isToday) {
    stmts.push(env.DB.prepare(`SELECT v FROM worker_settings WHERE k = ?`).bind(WORKING_HOURS_KEY));
    stmts.push(
      env.DB.prepare(
        `
        SELECT emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code, started_at
        FROM active_sessions
        WHERE emp_id IN (${empIdPlaceholders})
      `
      ).bind(...empIdList)
    );
  }
  const tDb = Date.now();
  const [sessionsRes, whRes, activeRes] = await env.DB.batch(stmts);
  const dbMs = Date.now() - tDb;
  const rows = sessionsRes && sessionsRes.results || [];
  const sessions = rows.map((r) => ({
    emp_process: r.emp_process || "\u2014",
    abaya_id: r.abaya_id != null ? String(r.abaya_id) : "",
    abaya_code: r.abaya_code != null ? String(r.abaya_code) : "",
    started_at: Number(r.started_at) || 0,
    ended_at: Number(r.ended_at) || 0,
    duration_sec: Math.max(0, Math.floor(Number(r.duration_sec) || 0)),
    invoice_count: r.invoice_count != null && r.invoice_count !== "" ? Number(r.invoice_count) : null,
    invoice_serial: r.invoice_serial != null && r.invoice_serial !== "" ? String(r.invoice_serial) : null,
    station: r.station || "",
    live: false
  }));
  const workingCfg = workingHoursConfigFromRow(whRes && whRes.results && whRes.results[0]);
  let liveSec = 0;
  if (isToday) {
    const activeRows = activeRes && activeRes.results || [];
    if (activeRows.length) {
      const r = activeRows[0];
      const nowUnix = Math.floor(Date.now() / 1e3);
      liveSec = overlapSecWithWindows(r.started_at, nowUnix, workingCfg);
      sessions.push({
        emp_process: r.emp_process || "\u2014",
        abaya_id: r.abaya_id != null ? String(r.abaya_id) : "",
        abaya_code: r.abaya_code != null ? String(r.abaya_code) : "",
        started_at: Number(r.started_at) || 0,
        ended_at: null,
        duration_sec: liveSec,
        invoice_count: null,
        invoice_serial: null,
        station: "",
        live: true,
        emp_name: r.emp_name,
        emp_code: r.emp_code
      });
    }
  }
  const lastRaw = rows.length ? rows[rows.length - 1] : null;
  const liveRow = sessions.length && sessions[sessions.length - 1].live ? sessions[sessions.length - 1] : null;
  const finishedRows = sessions.filter((x) => !x.live).map((x) => ({ active_time_sec: x.duration_sec, min_started_at: x.started_at, max_ended_at: x.ended_at }));
  let activeSec = 0;
  for (const r of finishedRows) {
    activeSec += windowedActiveTimeSec(r, workingCfg);
  }
  const roster = emp;
  const empResp = {
    id: roster && roster.id || empIdRaw,
    name: roster && roster.name || liveRow && liveRow.emp_name || lastRaw && lastRaw.emp_name || "",
    code: roster && roster.code || liveRow && liveRow.emp_code || lastRaw && lastRaw.emp_code || "",
    process: roster && roster.process || liveRow && liveRow.emp_process || lastRaw && lastRaw.emp_process || "",
    barcode: roster && roster.barcode || "",
    matchedIds: empIdList
    // debug aid: shows the client which ids we tried
  };
  let nearbyDates = [];
  if (rows.length === 0 && empIdList.length) {
    try {
      const nearbyRes = await env.DB.prepare(
        `SELECT day_date, COUNT(*) AS n
         FROM sessions
         WHERE emp_id IN (${empIdPlaceholders})
         GROUP BY day_date
         ORDER BY ABS(julianday(day_date) - julianday(?)) ASC
         LIMIT 3`
      ).bind(...empIdList, date).all();
      nearbyDates = (nearbyRes.results || []).map((r) => ({
        day_date: r.day_date,
        units: Number(r.n) || 0
      }));
    } catch (e) {
      console.error("[employee-day] nearby-dates query failed:", e && (e.message || e));
    }
  }
  const RECENT_DAYS_N = 30;
  let recentDays = [];
  if (empIdList.length) {
    try {
      const start = date || factoryToday;
      const parts = start.split("-").map(Number);
      const fromYmd = (function() {
        if (!parts[0] || !parts[1] || !parts[2]) return factoryToday;
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        d.setUTCDate(d.getUTCDate() - (RECENT_DAYS_N - 1));
        return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
      })();
      const recentRes = await env.DB.prepare(
        `SELECT day_date, COUNT(*) AS n, COALESCE(SUM(duration_sec), 0) AS total_sec
         FROM sessions
         WHERE emp_id IN (${empIdPlaceholders}) AND day_date >= ? AND day_date <= ?
         GROUP BY day_date
         ORDER BY day_date DESC
         LIMIT ?`
      ).bind(...empIdList, fromYmd, start, RECENT_DAYS_N).all();
      recentDays = (recentRes.results || []).map((r) => ({
        day_date: r.day_date,
        units: Number(r.n) || 0,
        time_sec: Number(r.total_sec) || 0
      }));
    } catch (e) {
      console.error("[employee-day] recent-days query failed:", e && (e.message || e));
    }
  }
  return jsonRes(
    {
      ok: true,
      date,
      factory_today: factoryToday,
      emp: empResp,
      totals: {
        units: rows.length,
        active_time_sec: activeSec,
        live_active_time_sec: liveSec,
        full_time_sec: activeSec + liveSec,
        first_started_at: sessions.length ? sessions[0].started_at : null,
        last_ended_at: rows.length ? Number(rows[rows.length - 1].ended_at) || null : null
      },
      sessions,
      nearby_dates: nearbyDates,
      recent_days: recentDays
    },
    200,
    Object.assign({}, CEO_JSON_NO_STORE, {
      "Server-Timing": "db;dur=" + dbMs + ", total;dur=" + (Date.now() - t0)
    })
  );
}
__name(handleEmployeeDay, "handleEmployeeDay");

// src/handlers/analytics.js
async function handleAnalytics(env, url) {
  const period = url.searchParams.get("period") || "daily";
  const factoryToday = factoryTodayString(env);
  const localToday = safeYmdOrFallback(url.searchParams.get("local_today"), factoryToday);
  const fromParam = String(url && url.searchParams && url.searchParams.get("from") || "").trim();
  const toParam = String(url && url.searchParams && url.searchParams.get("to") || "").trim();
  const explicitRange = isValidYmd(fromParam) || isValidYmd(toParam);
  let where, binds, range;
  let dailyFallbackApplied = false;
  if (explicitRange) {
    try {
      range = customRange(
        isValidYmd(fromParam) ? fromParam : isValidYmd(toParam) ? toParam : factoryToday,
        isValidYmd(toParam) ? toParam : isValidYmd(fromParam) ? fromParam : factoryToday,
        { maxDays: 92 }
      );
    } catch (e) {
      return jsonRes({ ok: false, error: String(e && e.message || e) }, 400, CEO_JSON_NO_STORE);
    }
    where = "WHERE day_date >= ? AND day_date <= ?";
    binds = [range.startYmd, range.endYmd];
  } else {
    ({ where, binds, range } = sessionsFilterForPeriod(period, localToday));
    if (range.type === "daily") {
      const cntRes = await env.DB.prepare(`SELECT COUNT(*) as c FROM sessions ${where}`).bind(...binds).first();
      if ((Number(cntRes && cntRes.c) || 0) === 0) {
        const fallbackYmd = range.prevStart;
        const fallback = sessionsFilterForPeriod(period, fallbackYmd);
        where = fallback.where;
        binds = fallback.binds;
        range = fallback.range;
        dailyFallbackApplied = true;
      }
    }
  }
  const fromSessions = `FROM sessions ${where}`;
  const [byProcessRes, splitRes, leaderRes, byEmpRangeRes, whRes] = await env.DB.batch([
    env.DB.prepare(
      `
    SELECT emp_process, COUNT(*) as units,
      ROUND(AVG(duration_sec)) as avg_sec,
      MIN(duration_sec) as min_sec,
      MAX(duration_sec) as max_sec
    ${fromSessions}
    GROUP BY emp_process
    ORDER BY avg_sec DESC
  `
    ).bind(...binds),
    env.DB.prepare(
      `
    SELECT emp_id,
      MAX(emp_name) as emp_name,
      MAX(emp_code) as emp_code,
      emp_process,
      COUNT(*) as units,
      ROUND(AVG(duration_sec)) as avg_sec
    ${fromSessions}
    GROUP BY emp_id, emp_process
    HAVING COUNT(*) >= 1
  `
    ).bind(...binds),
    env.DB.prepare(
      `
    SELECT emp_id,
      MAX(emp_name) as emp_name,
      MAX(emp_code) as emp_code,
      MAX(emp_process) as emp_process,
      COUNT(*) as units,
      ROUND(AVG(duration_sec)) as avg_sec
    ${fromSessions}
    GROUP BY emp_id
    HAVING COUNT(*) >= 2
    ORDER BY avg_sec ASC
    LIMIT 40
  `
    ).bind(...binds),
    // Per-employee rolled-up (min_started_at, max_ended_at, SUM(duration_sec))
    // for windowed active time. The splits query only carries AVG, which
    // loses the time-of-day info needed to re-walk against the shift
    // windows. One cheap extra query, same D1 round trip.
    env.DB.prepare(
      `
    SELECT emp_id,
      MIN(started_at) as min_started_at,
      MAX(ended_at) as max_ended_at,
      COALESCE(SUM(duration_sec), 0) as active_time_sec
    ${fromSessions}
    GROUP BY emp_id
  `
    ).bind(...binds),
    // Working-hours config — needed for windowedActiveTimeSec below.
    env.DB.prepare(`SELECT v FROM worker_settings WHERE k = ?`).bind(WORKING_HOURS_KEY)
  ]);
  const splits = splitRes.results || [];
  const workingCfg = workingHoursConfigFromRow(whRes && whRes.results && whRes.results[0]);
  const windowedActiveByEmp = /* @__PURE__ */ Object.create(null);
  for (const r of byEmpRangeRes && byEmpRangeRes.results || []) {
    const id = String(r.emp_id || "");
    if (!id) continue;
    windowedActiveByEmp[id] = windowedActiveTimeSec(
      {
        active_time_sec: r.active_time_sec,
        min_started_at: r.min_started_at,
        max_ended_at: r.max_ended_at
      },
      workingCfg
    );
  }
  const MIN_UNITS_FASTEST = 2;
  const fastestPerProcess = {};
  for (const r of splits) {
    if (Number(r.units) < MIN_UNITS_FASTEST) continue;
    const p = r.emp_process;
    const avg = Number(r.avg_sec);
    if (!fastestPerProcess[p] || avg < Number(fastestPerProcess[p].avg_sec)) {
      fastestPerProcess[p] = { ...r, avg_sec: r.avg_sec };
    }
  }
  const byEmployeeMap = /* @__PURE__ */ new Map();
  for (const r of splits) {
    const eid = String(r.emp_id || "");
    if (!eid) continue;
    const prev = byEmployeeMap.get(eid) || {
      emp_id: eid,
      emp_name: r.emp_name || "",
      emp_code: r.emp_code || "",
      units: 0,
      _sumSec: 0,
      _sumActive: 0,
      _sumElapsed: 0,
      _sumLive: 0,
      _sumFull: 0,
      _processes: /* @__PURE__ */ new Set()
    };
    prev.units += Number(r.units) || 0;
    const active = windowedActiveByEmp[eid] || 0;
    prev._sumActive += active;
    prev._sumElapsed += active;
    prev._sumFull += active;
    if (r.emp_process) prev._processes.add(String(r.emp_process));
    if (!prev.emp_name && r.emp_name) prev.emp_name = r.emp_name;
    if (!prev.emp_code && r.emp_code) prev.emp_code = r.emp_code;
    byEmployeeMap.set(eid, prev);
  }
  let lastItemByEmp = {};
  if (byEmployeeMap.size) {
    try {
      const empIds = Array.from(byEmployeeMap.keys());
      const placeholders = empIds.map(() => "?").join(",");
      const lastRes = await env.DB.prepare(
        `SELECT emp_id, abaya_code, abaya_id, MAX(started_at) as last_at
         FROM sessions
         WHERE emp_id IN (${placeholders}) AND day_date >= ? AND day_date <= ?
           AND abaya_code IS NOT NULL AND abaya_code != ''
         GROUP BY emp_id`
      ).bind(...empIds, range.startYmd, range.endYmd).all();
      for (const r of lastRes.results || []) {
        lastItemByEmp[String(r.emp_id)] = {
          abaya_code: r.abaya_code,
          abaya_id: r.abaya_id != null ? String(r.abaya_id) : "",
          last_at: r.last_at
        };
      }
    } catch (e) {
      console.error("[analytics] last-item query failed:", e && (e.message || e));
    }
  }
  const byEmployee = Array.from(byEmployeeMap.values()).map((e) => {
    const processes = Array.from(e._processes);
    return {
      emp_id: e.emp_id,
      emp_name: e.emp_name,
      emp_code: e.emp_code,
      emp_process: processes[0] || "",
      // primary process for the row
      emp_processes: processes,
      // all processes for the popup
      units: e.units,
      active_time_sec: e._sumActive,
      elapsed_time_sec: e._sumElapsed,
      live_active_time_sec: 0,
      // splits don't surface live overlap; the work-time stat card handles that
      full_time_sec: e._sumFull,
      tolerance_sec: 0,
      adjusted_full_time_sec: e._sumFull,
      avg_sec: e.units > 0 ? Math.round(e._sumSec / e.units) : 0,
      last_item: lastItemByEmp[e.emp_id] || null
    };
  }).sort((a, b) => (b.units || 0) - (a.units || 0));
  return jsonRes(
    {
      ok: true,
      period,
      effective_period: range.type,
      factory_today: factoryToday,
      local_today: localToday,
      start_date: range.startYmd,
      end_date: range.endYmd,
      effective_date: range.type === "daily" ? range.startYmd : "",
      fallback_applied: dailyFallbackApplied,
      generated: (/* @__PURE__ */ new Date()).toISOString(),
      by_process: byProcessRes.results || [],
      employee_process_splits: splits,
      by_employee: byEmployee,
      fastest_per_process: Object.values(fastestPerProcess).sort(
        (a, b) => String(a.emp_process).localeCompare(String(b.emp_process))
      ),
      speed_leaders: leaderRes.results || []
    },
    200,
    CEO_JSON_NO_STORE
  );
}
__name(handleAnalytics, "handleAnalytics");

// src/handlers/trace.js
async function handleGarmentTrace(env, url) {
  const q = (url.searchParams.get("q") || url.searchParams.get("abaya_id") || "").trim();
  if (!q) {
    return errRes("Missing q (abaya id or item code)", 400);
  }
  const res = await env.DB.prepare(
    `
    SELECT id, emp_id, emp_name, emp_code, emp_process, abaya_id, abaya_code,
      duration_sec, started_at, ended_at, day_date
    FROM sessions
    WHERE abaya_id = ? OR abaya_code = ?
    ORDER BY ended_at ASC
    LIMIT 100
  `
  ).bind(q, q).all();
  const rows = res.results || [];
  let sumSec = 0;
  for (const r of rows) {
    sumSec += Math.floor(Number(r.duration_sec) || 0);
  }
  const actRes = await env.DB.prepare(
    `
    SELECT emp_id, emp_name, emp_process, abaya_id, abaya_code, started_at
    FROM active_sessions
    WHERE abaya_id = ? OR abaya_code = ?
  `
  ).bind(q, q).all();
  const nowUnix = Math.floor(Date.now() / 1e3);
  const workingCfg = await getWorkingHoursConfig(env);
  let activeSec = 0;
  (actRes.results || []).forEach((r) => {
    const st = Number(r.started_at);
    if (Number.isFinite(st)) activeSec += overlapSecWithWindows(st, nowUnix, workingCfg);
  });
  return jsonRes(
    {
      ok: true,
      q,
      rows,
      session_count: rows.length,
      sum_duration_sec: sumSec,
      active_sessions: actRes.results || [],
      active_seconds: activeSec,
      sum_with_active_sec: sumSec + activeSec,
      note: "Sum of finished segment times plus any in-progress work on the floor for this item. Wall-clock may differ if steps overlap."
    },
    200,
    CEO_JSON_NO_STORE
  );
}
__name(handleGarmentTrace, "handleGarmentTrace");

// src/handlers/dispatch.js
function isBridgeAuthed(request, env) {
  const secret = String(env.DISPATCH_BRIDGE_SECRET || "").trim();
  if (!secret) return false;
  return (request.headers.get("X-Bridge-Secret") || "").trim() === secret;
}
__name(isBridgeAuthed, "isBridgeAuthed");
function rowToInvoice(row) {
  let items = [];
  try {
    items = JSON.parse(row.items || "[]");
  } catch (_) {
  }
  return {
    id: row.id,
    supplier: row.supplier,
    targetQueue: row.target_queue,
    status: row.status,
    slaDeadline: Number(row.sla_deadline),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    source: row.source || null,
    items,
    audioId: row.audio_id || null,
    notes: row.notes || null,
    customerPhone: row.customer_phone || null
  };
}
__name(rowToInvoice, "rowToInvoice");
function extractCustomerPhone(notes) {
  if (!notes) return null;
  const text = String(notes);
  const patterns = [/\+\d[\d\s().-]{6,16}\d/, /\b0\d[\d\s().-]{6,12}\d\b/, /\b\d[\d\s().-]{6,14}\d\b/];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const digits = m[0].replace(/[^\d+]/g, "");
      const bare = digits.replace(/^\+/, "");
      if (bare.length >= 7 && bare.length <= 15) return digits;
    }
  }
  return null;
}
__name(extractCustomerPhone, "extractCustomerPhone");
async function getActiveInvoices(db) {
  const res = await db.prepare(`SELECT * FROM dispatch_invoices WHERE status != 'DELIVERED' ORDER BY sla_deadline ASC`).all();
  return (res.results || []).map(rowToInvoice);
}
__name(getActiveInvoices, "getActiveInvoices");
async function getInvoiceById(db, id) {
  const res = await db.prepare(`SELECT * FROM dispatch_invoices WHERE id = ?`).bind(id).first();
  return res ? rowToInvoice(res) : null;
}
__name(getInvoiceById, "getInvoiceById");
async function upsertInvoiceD1(db, inv) {
  const itemsJson = JSON.stringify(inv.items || []);
  const phone = inv.customerPhone != null ? inv.customerPhone : extractCustomerPhone(inv.notes);
  await db.prepare(`
      INSERT INTO dispatch_invoices (id, supplier, target_queue, status, sla_deadline, created_at, updated_at, source, items, audio_id, notes, customer_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        supplier      = excluded.supplier,
        target_queue  = excluded.target_queue,
        status        = excluded.status,
        sla_deadline  = excluded.sla_deadline,
        updated_at    = excluded.updated_at,
        source        = excluded.source,
        items         = excluded.items,
        audio_id      = COALESCE(excluded.audio_id, dispatch_invoices.audio_id),
        notes         = COALESCE(excluded.notes, dispatch_invoices.notes),
        customer_phone= COALESCE(excluded.customer_phone, dispatch_invoices.customer_phone)
    `).bind(
    inv.id,
    inv.supplier,
    inv.targetQueue || "",
    inv.status || "PENDING",
    inv.slaDeadline,
    inv.createdAt || Date.now(),
    inv.updatedAt || Date.now(),
    inv.source || null,
    itemsJson,
    inv.audioId || null,
    inv.notes || null,
    phone || null
  ).run();
}
__name(upsertInvoiceD1, "upsertInvoiceD1");
async function updateStatusD1(db, id, status, { items, customerPhone } = {}) {
  const sets = ["status = ?", "updated_at = ?"];
  const args = [status, Date.now()];
  if (Array.isArray(items)) {
    sets.push("items = ?");
    args.push(JSON.stringify(items));
  }
  if (customerPhone != null) {
    sets.push("customer_phone = COALESCE(customer_phone, ?)");
    args.push(customerPhone);
  }
  args.push(id);
  await db.prepare(`UPDATE dispatch_invoices SET ${sets.join(", ")} WHERE id = ?`).bind(...args).run();
}
__name(updateStatusD1, "updateStatusD1");
async function runTunnelProbe(env) {
  const tunnelUrl = String(env.FACTORY_TUNNEL_URL || "").trim();
  if (!tunnelUrl) return;
  const ts = Date.now();
  let status = "fail";
  let httpCode = null;
  let latencyMs = null;
  let error = null;
  try {
    const start = Date.now();
    const r = await fetch(`${tunnelUrl}/health`, { signal: AbortSignal.timeout(5e3) });
    latencyMs = Date.now() - start;
    httpCode = r.status;
    if (r.ok) {
      const data = await r.json().catch(() => null);
      if (data && data.ok === true) status = "ok";
      else error = "health body not ok";
    } else {
      error = `http ${r.status}`;
    }
  } catch (e) {
    error = String(e && e.message || e).slice(0, 200);
  }
  const cutoff = ts - 7 * 24 * 60 * 60 * 1e3;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tunnel_probes (ts, status, http_code, latency_ms, error) VALUES (?, ?, ?, ?, ?)`
      ).bind(ts, status, httpCode, latencyMs, error),
      env.DB.prepare(`DELETE FROM tunnel_probes WHERE ts < ?`).bind(cutoff)
    ]);
  } catch (_) {
  }
}
__name(runTunnelProbe, "runTunnelProbe");
async function notifyFactory(invoice, env) {
  const tunnelUrl = String(env.FACTORY_TUNNEL_URL || "").trim();
  const secret = String(env.DISPATCH_BRIDGE_SECRET || "").trim();
  if (!tunnelUrl || !secret) return;
  try {
    await fetch(`${tunnelUrl}/api/internal/sync-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bridge-Secret": secret },
      body: JSON.stringify(invoice)
    });
  } catch (_) {
  }
}
__name(notifyFactory, "notifyFactory");
function parseWhatsAppInvoice(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const idLine = lines[0];
  if (!idLine.startsWith("INV-") && !idLine.toUpperCase().startsWith("INV-")) return null;
  const id = idLine.split(/\s/)[0].toUpperCase();
  const supplier = lines[1];
  let targetQueue = "";
  let slaDeadline = Date.now() + 4 * 60 * 60 * 1e3;
  const items = [];
  for (const line of lines.slice(2)) {
    const itemMatch = line.match(/^([1-4])[.:]\s*(.+)/);
    if (itemMatch) {
      const pos = parseInt(itemMatch[1], 10);
      const parts = itemMatch[2].split(/\s*[|,]\s*/);
      items.push({
        pos,
        materialSpec: parts[0] || "",
        color: parts[1] || "",
        qty: parts[2] || ""
      });
      continue;
    }
    const qMatch = line.match(/^Queue:\s*(.+)/i);
    if (qMatch) {
      targetQueue = qMatch[1].trim();
      continue;
    }
    const slaMatch = line.match(/^SLA:\s*(.+)/i);
    if (slaMatch) {
      const parsed = Date.parse(slaMatch[1].trim());
      if (!isNaN(parsed)) slaDeadline = parsed;
    }
  }
  if (items.length === 0) return null;
  return { id, supplier, targetQueue, items, slaDeadline };
}
__name(parseWhatsAppInvoice, "parseWhatsAppInvoice");
function parseInboundWAMessages(body) {
  const results = [];
  try {
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const msg of change?.value?.messages ?? []) {
          const from = String(msg.from || "");
          if (msg.type === "text") {
            results.push({ type: "text", from, body: String(msg.text?.body || "") });
          } else if (msg.type === "audio") {
            results.push({ type: "audio", from, audioId: String(msg.audio?.id || "") });
          }
        }
      }
    }
  } catch (_) {
  }
  return results;
}
__name(parseInboundWAMessages, "parseInboundWAMessages");
async function getMessagingSettings(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT enabled, template_mode, template_name FROM messaging_settings WHERE id = 1`
    ).first();
    return {
      enabled: !!(row && row.enabled),
      templateMode: row && row.template_mode || "freeform",
      templateName: row && row.template_name || null
    };
  } catch (_) {
    return { enabled: false, templateMode: "freeform", templateName: null };
  }
}
__name(getMessagingSettings, "getMessagingSettings");
async function countMessagesSent(env, sinceMs) {
  try {
    const q = sinceMs ? env.DB.prepare(`SELECT COUNT(*) AS n FROM customer_messages WHERE status='sent' AND ts >= ?`).bind(sinceMs) : env.DB.prepare(`SELECT COUNT(*) AS n FROM customer_messages WHERE status='sent'`);
    const r = await q.first();
    return r ? Number(r.n) : 0;
  } catch (_) {
    return 0;
  }
}
__name(countMessagesSent, "countMessagesSent");
async function logMessage(env, invoiceId, toPhone, status, error) {
  try {
    await env.DB.prepare(
      `INSERT INTO customer_messages (invoice_id, to_phone, status, ts, error) VALUES (?, ?, ?, ?, ?)`
    ).bind(invoiceId, toPhone || null, status, Date.now(), error || null).run();
  } catch (_) {
  }
}
__name(logMessage, "logMessage");
async function sendCustomerWhatsApp(env, toPhone, invoice, settings) {
  const token = String(env.WHATSAPP_TOKEN || "").trim();
  const phoneId = String(env.WHATSAPP_PHONE_ID || "").trim();
  if (!token || !phoneId) throw new Error("worker WhatsApp creds not set");
  const body = settings.templateMode === "template" && settings.templateName ? {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "template",
    template: {
      name: settings.templateName,
      language: { code: "en" },
      components: [{ type: "body", parameters: [
        { type: "text", text: invoice.id },
        { type: "text", text: invoice.supplier || "" }
      ] }]
    }
  } : {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "text",
    text: { body: `\u2728 Your AbaYa order is ready!

Ref: ${invoice.id}
Thank you for choosing us. Your order has been completed and delivered.` }
  };
  const r = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(8e3),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("graph api " + r.status);
}
__name(sendCustomerWhatsApp, "sendCustomerWhatsApp");
async function maybeNotifyCustomer(env, invoice) {
  const settings = await getMessagingSettings(env);
  if (!settings.enabled) {
    await logMessage(env, invoice.id, invoice.customerPhone, "skipped", "disabled");
    return;
  }
  const phone = invoice.customerPhone || extractCustomerPhone(invoice.notes);
  if (!phone) {
    await logMessage(env, invoice.id, null, "skipped", "no phone");
    return;
  }
  try {
    const sent = await env.DB.prepare(
      `SELECT 1 FROM customer_messages WHERE invoice_id = ? AND status='sent' LIMIT 1`
    ).bind(invoice.id).first();
    if (sent) return;
  } catch (_) {
  }
  try {
    await sendCustomerWhatsApp(env, phone, invoice, settings);
    await logMessage(env, invoice.id, phone, "sent", null);
  } catch (e) {
    await logMessage(env, invoice.id, phone, "failed", String(e && e.message || e).slice(0, 200));
  }
}
__name(maybeNotifyCustomer, "maybeNotifyCustomer");
async function getMessagingStatus(env) {
  const settings = await getMessagingSettings(env);
  const sentCount = await countMessagesSent(env);
  const monthStart = (() => {
    const d = /* @__PURE__ */ new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  })();
  const periodCount = await countMessagesSent(env, monthStart);
  return { ok: true, enabled: settings.enabled, templateMode: settings.templateMode, sentCount, periodCount };
}
__name(getMessagingStatus, "getMessagingStatus");
async function setMessagingEnabled(env, enabled) {
  try {
    await env.DB.prepare(
      `INSERT INTO messaging_settings (id, enabled, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    ).bind(enabled ? 1 : 0, Date.now()).run();
    return { ok: true, enabled: !!enabled };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(setMessagingEnabled, "setMessagingEnabled");
async function handleDispatch(request, env, url) {
  const path = url.pathname;
  if (path === "/dispatch/invoices" && request.method === "GET") {
    if (!isBridgeAuthed(request, env)) return errRes("unauthorized", 401);
    const invoices = await getActiveInvoices(env.DB);
    return jsonRes({ ok: true, invoices });
  }
  if (path === "/dispatch/tunnel-health" && request.method === "GET") {
    if (!isBridgeAuthed(request, env)) return errRes("unauthorized", 401);
    const requested = parseInt(url.searchParams.get("limit") || "60", 10);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 60, 1), 500);
    let probes = [];
    try {
      const res = await env.DB.prepare(`SELECT ts, status, http_code AS httpCode, latency_ms AS latencyMs, error
                  FROM tunnel_probes ORDER BY ts DESC LIMIT ?`).bind(limit).all();
      probes = res.results || [];
    } catch (_) {
    }
    return jsonRes({ ok: true, last: probes[0] || null, probes });
  }
  const patchMatch = path.match(/^\/dispatch\/invoices\/([^/]+)\/status$/);
  if (patchMatch && request.method === "PATCH") {
    if (!isBridgeAuthed(request, env)) return errRes("unauthorized", 401);
    const id = decodeURIComponent(patchMatch[1]);
    const idemKey = (request.headers.get("X-Idempotency-Key") || "").trim();
    if (idemKey) {
      try {
        const dup = await env.DB.prepare(`SELECT 1 FROM idempotency_keys WHERE key = ? LIMIT 1`).bind(idemKey).first();
        if (dup) {
          const current = await getInvoiceById(env.DB, id);
          return jsonRes({ ok: true, invoice: current, idempotent: true });
        }
      } catch (_) {
      }
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return errRes("bad json", 400);
    }
    const status = String(body.status || "");
    if (!["ARRIVED", "READY", "DELIVERED"].includes(status)) return errRes("invalid status", 400);
    const inv = await getInvoiceById(env.DB, id);
    if (!inv) return errRes("not found", 404);
    const extraItems = Array.isArray(body.items) ? body.items : void 0;
    const extraPhone = body.customerPhone != null ? String(body.customerPhone) : void 0;
    await updateStatusD1(env.DB, id, status, { items: extraItems, customerPhone: extraPhone });
    if (idemKey) {
      try {
        const now = Date.now();
        const cutoff = now - 24 * 60 * 60 * 1e3;
        await env.DB.batch([
          env.DB.prepare(`INSERT OR IGNORE INTO idempotency_keys (key, created_at) VALUES (?, ?)`).bind(idemKey, now),
          env.DB.prepare(`DELETE FROM idempotency_keys WHERE created_at < ?`).bind(cutoff)
        ]);
      } catch (_) {
      }
    }
    const updated = {
      ...inv,
      status,
      updatedAt: Date.now(),
      items: extraItems ?? inv.items,
      customerPhone: extraPhone ?? inv.customerPhone
    };
    notifyFactory(updated, env);
    if (status === "DELIVERED") {
      await maybeNotifyCustomer(env, updated).catch(() => {
      });
    }
    return jsonRes({ ok: true, invoice: updated });
  }
  if (path === "/dispatch/webhook/whatsapp" && request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = String(env.WHATSAPP_VERIFY_TOKEN || "").trim();
    if (!verifyToken) return errRes("WHATSAPP_VERIFY_TOKEN not set", 503);
    if (mode === "subscribe" && token === verifyToken) {
      return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return errRes("Forbidden", 403);
  }
  if (path === "/dispatch/webhook/whatsapp" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return errRes("bad json", 400);
    }
    const messages = parseInboundWAMessages(body);
    const senderToInvoice = /* @__PURE__ */ new Map();
    let ingested = 0;
    for (const msg of messages) {
      if (msg.type !== "text") continue;
      const parsed = parseWhatsAppInvoice(msg.body);
      if (!parsed) continue;
      const now = Date.now();
      const invoice = { ...parsed, status: "PENDING", createdAt: now, updatedAt: now, source: "whatsapp" };
      await upsertInvoiceD1(env.DB, invoice);
      senderToInvoice.set(msg.from, invoice);
      notifyFactory(invoice, env);
      ingested++;
    }
    for (const msg of messages) {
      if (msg.type !== "audio" || !msg.audioId) continue;
      let target = senderToInvoice.get(msg.from) || null;
      if (!target) {
        const cutoff = Date.now() - 15 * 60 * 1e3;
        const res = await env.DB.prepare(
          `SELECT * FROM dispatch_invoices WHERE source = 'whatsapp' AND status IN ('PENDING','ARRIVED')
           AND created_at >= ? ORDER BY created_at DESC LIMIT 1`
        ).bind(cutoff).first();
        if (res) target = rowToInvoice(res);
      }
      if (target) {
        const updated = { ...target, audioId: msg.audioId, updatedAt: Date.now() };
        await upsertInvoiceD1(env.DB, updated);
        notifyFactory(updated, env);
      } else {
        const now = Date.now();
        const placeholder = {
          id: "AUDIO-" + now.toString(36).toUpperCase(),
          supplier: "Voice Note",
          items: [],
          targetQueue: "",
          status: "PENDING",
          slaDeadline: now + 4 * 60 * 60 * 1e3,
          createdAt: now,
          updatedAt: now,
          source: "whatsapp",
          audioId: msg.audioId
        };
        await upsertInvoiceD1(env.DB, placeholder);
        notifyFactory(placeholder, env);
        ingested++;
      }
    }
    return jsonRes({ ok: true, ingested });
  }
  return errRes("not found", 404);
}
__name(handleDispatch, "handleDispatch");

// src/handlers/check-report.js
var FACTORY_TZ2 = "Asia/Dubai";
var DEFAULT_FACTORY = "FAREWELL ABAYA LLC";
function leaderboardUrl(env) {
  return String(env.LEADERBOARD_URL || "").trim().replace(/\/+$/, "");
}
__name(leaderboardUrl, "leaderboardUrl");
function ymdToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TZ2,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(/* @__PURE__ */ new Date());
}
__name(ymdToday, "ymdToday");
function safeYmd(s, fallback) {
  const t = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return fallback;
  return t;
}
__name(safeYmd, "safeYmd");
function startOfDayIso(ymd) {
  return ymd + "T00:00:00+04:00";
}
__name(startOfDayIso, "startOfDayIso");
function endOfDayIso(ymd) {
  return ymd + "T23:59:59.999+04:00";
}
__name(endOfDayIso, "endOfDayIso");
function weekdayInTz(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: FACTORY_TZ2,
      weekday: "long"
    }).format(noon);
  } catch (_) {
    return "";
  }
}
__name(weekdayInTz, "weekdayInTz");
function longDateInTz(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: FACTORY_TZ2,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(noon);
  } catch (_) {
    return ymd;
  }
}
__name(longDateInTz, "longDateInTz");
async function fetchLeaderboardRows(env, fromYmd, toYmd) {
  const base = leaderboardUrl(env);
  if (!base) return { rows: [], source: "cloud-d1-fallback" };
  const url = base + "/api/check-report?from=" + encodeURIComponent(fromYmd) + "&to=" + encodeURIComponent(toYmd);
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15e3)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[check-delivery] leaderboard HTTP", res.status, txt.slice(0, 200));
      return { rows: [], source: "cloud-d1-fallback", error: "leaderboard HTTP " + res.status };
    }
    const j = await res.json();
    return { rows: Array.isArray(j && j.rows) ? j.rows : [], source: "leaderboard" };
  } catch (e) {
    console.error("[check-delivery] leaderboard fetch failed:", e && (e.message || e));
    return { rows: [], source: "cloud-d1-fallback", error: e && e.message || String(e) };
  }
}
__name(fetchLeaderboardRows, "fetchLeaderboardRows");
function statusForRow(r) {
  if (r.deletedAt) return "cancelled";
  if (r.status === "completed") return "completed";
  return "pending";
}
__name(statusForRow, "statusForRow");
function eventAtForRow(r, status) {
  if (status === "cancelled") return String(r.deletedAt);
  if (status === "completed") return r.completedAt || r.createdAt;
  return r.createdAt;
}
__name(eventAtForRow, "eventAtForRow");
function locationForRow(r) {
  return (r.showroom || "").trim() || "Unspecified";
}
__name(locationForRow, "locationForRow");
function rowsInWindow(rows, fromYmd, toYmd) {
  const fromIso = startOfDayIso(fromYmd);
  const toIso = endOfDayIso(toYmd);
  return rows.filter((r) => {
    const candidates = [r.deletedAt, r.completedAt, r.createdAt];
    for (const ts of candidates) {
      if (!ts) continue;
      if (String(ts) >= fromIso && String(ts) <= toIso) return true;
    }
    return false;
  });
}
__name(rowsInWindow, "rowsInWindow");
function aggregateRows(rows, fromYmd, toYmd) {
  const inWindow = rowsInWindow(rows, fromYmd, toYmd);
  const totals = { invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0 };
  const invoiceSet = /* @__PURE__ */ new Set();
  const groupMap = /* @__PURE__ */ new Map();
  const locMap = /* @__PURE__ */ new Map();
  for (const r of inWindow) {
    const status = statusForRow(r);
    totals.abayas += 1;
    invoiceSet.add(r.invoiceNo);
    if (status === "completed") totals.delivered += 1;
    else if (status === "cancelled") totals.cancelled += 1;
    else totals.pending += 1;
    const loc = locationForRow(r);
    const groupKey = loc + "::" + r.invoiceNo;
    let g = groupMap.get(groupKey);
    if (!g) {
      g = { location: loc, invoiceNo: r.invoiceNo, rows: [] };
      groupMap.set(groupKey, g);
    }
    g.rows.push({
      invoiceNo: r.invoiceNo,
      abayaCode: r.itemCode || "",
      status,
      eventAt: eventAtForRow(r, status),
      location: loc,
      cancelledBy: r.cancelledBy || void 0,
      cancellationReason: r.cancellationReason || void 0
    });
    let lt = locMap.get(loc);
    if (!lt) {
      lt = { location: loc, invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0, _invoiceSet: /* @__PURE__ */ new Set() };
      locMap.set(loc, lt);
    }
    lt.abayas += 1;
    if (status === "completed") lt.delivered += 1;
    else if (status === "cancelled") lt.cancelled += 1;
    else lt.pending += 1;
    lt._invoiceSet.add(r.invoiceNo);
  }
  totals.invoices = invoiceSet.size;
  const byLocation = Array.from(locMap.values()).map((lt) => ({
    location: lt.location,
    invoices: lt._invoiceSet.size,
    abayas: lt.abayas,
    delivered: lt.delivered,
    pending: lt.pending,
    cancelled: lt.cancelled
  })).sort((a, b) => b.abayas - a.abayas || a.location.localeCompare(b.location));
  const groups = Array.from(groupMap.values()).map((g) => {
    const rows2 = g.rows.slice().sort((a, b) => a.eventAt < b.eventAt ? 1 : -1);
    return Object.assign({}, g, { rows: rows2 });
  });
  groups.sort((a, b) => {
    if (a.location !== b.location) return a.location.localeCompare(b.location);
    return a.invoiceNo.localeCompare(b.invoiceNo);
  });
  return { totals, byLocation, groups, inWindowCount: inWindow.length };
}
__name(aggregateRows, "aggregateRows");
async function fetchCloudCancellations(env, fromMs, toMs) {
  try {
    const r = await env.DB.prepare(`
      SELECT id, factory, invoice_no, abaya_code, cancelled_at, cancelled_by, reason, source
      FROM cancellations
      WHERE cancelled_at >= ? AND cancelled_at < ?
      ORDER BY cancelled_at ASC
    `).bind(fromMs, toMs).all();
    return r && r.results || [];
  } catch (e) {
    console.error("[check-delivery] cloud cancellations query failed:", e && (e.message || e));
    return [];
  }
}
__name(fetchCloudCancellations, "fetchCloudCancellations");
async function handleCheckDeliveryConfig(env, url) {
  const today = ymdToday();
  const base = leaderboardUrl(env);
  let factories = [DEFAULT_FACTORY];
  if (base) {
    try {
      const from7 = /* @__PURE__ */ new Date();
      from7.setDate(from7.getDate() - 7);
      const from7Ymd = new Intl.DateTimeFormat("en-CA", { timeZone: FACTORY_TZ2, year: "numeric", month: "2-digit", day: "2-digit" }).format(from7);
      const probeRes = await fetch(base + "/api/check-report?from=" + from7Ymd + "&to=" + today, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(8e3)
      });
      if (probeRes.ok) {
        const j = await probeRes.json();
        const locs = /* @__PURE__ */ new Set();
        for (const r of j && j.rows || []) {
          const loc = (r.showroom || "").trim();
          if (loc) locs.add(loc);
        }
        if (locs.size === 0) {
          const from30 = /* @__PURE__ */ new Date();
          from30.setDate(from30.getDate() - 30);
          const from30Ymd = new Intl.DateTimeFormat("en-CA", { timeZone: FACTORY_TZ2, year: "numeric", month: "2-digit", day: "2-digit" }).format(from30);
          const r2 = await fetch(base + "/api/check-report?from=" + from30Ymd + "&to=" + today, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(8e3)
          });
          if (r2.ok) {
            const j2 = await r2.json();
            for (const r of j2 && j2.rows || []) {
              const loc = (r.showroom || "").trim();
              if (loc) locs.add(loc);
            }
          }
        }
        if (locs.size) factories = Array.from(locs).sort();
      }
    } catch (e) {
      console.warn("[check-delivery] config probe failed:", e && (e.message || e));
    }
  }
  return jsonRes({
    ok: true,
    factories,
    defaultFactory: DEFAULT_FACTORY,
    timezone: FACTORY_TZ2,
    todayYmd: today,
    leaderboardConfigured: !!base
  }, 200, CEO_JSON_NO_STORE);
}
__name(handleCheckDeliveryConfig, "handleCheckDeliveryConfig");
async function handleCheckDeliveryReport(env, url) {
  const t0 = Date.now();
  const fromParam = String(url.searchParams.get("from") || "").trim();
  const toParam = String(url.searchParams.get("to") || "").trim();
  const factoryParam = String(url.searchParams.get("factory") || "").trim();
  const today = ymdToday();
  const fromYmd = safeYmd(fromParam, today);
  const toYmd = safeYmd(toParam, fromYmd);
  const fromMs = new Date(startOfDayIso(fromYmd)).getTime();
  const toMs = new Date(endOfDayIso(toYmd)).getTime();
  try {
    const lb = await fetchLeaderboardRows(env, fromYmd, toYmd);
    const leaderboardRows = lb.rows;
    const agg = aggregateRows(leaderboardRows, fromYmd, toYmd);
    let { totals, byLocation, groups } = agg;
    const allFactories = factoryParam === "" || factoryParam.toLowerCase() === "all";
    const filteredByLocation = allFactories ? byLocation : byLocation.filter((lt) => lt.location === factoryParam);
    const filteredGroups = allFactories ? groups : groups.filter((g) => g.location === factoryParam);
    const filteredTotals = filteredGroups.reduce(
      (acc, g) => {
        for (const r of g.rows) {
          acc.abayas += 1;
          if (r.status === "completed") acc.delivered += 1;
          else if (r.status === "cancelled") acc.cancelled += 1;
          else acc.pending += 1;
        }
        return acc;
      },
      { invoices: 0, abayas: 0, delivered: 0, pending: 0, cancelled: 0 }
    );
    const inv = /* @__PURE__ */ new Set();
    for (const g of filteredGroups) inv.add(g.invoiceNo);
    filteredTotals.invoices = inv.size;
    const cloudCancels = await fetchCloudCancellations(env, fromMs, toMs);
    const cancellations = cloudCancels.map((c) => ({
      id: c.id,
      factory: c.factory || "",
      invoiceNo: c.invoice_no || "",
      abayaCode: c.abaya_code || "",
      cancelledAt: c.cancelled_at,
      cancelledBy: c.cancelled_by || "",
      reason: c.reason || "",
      source: c.source || "ceo"
    }));
    const sameDay = fromYmd === toYmd;
    const label = sameDay ? longDateInTz(fromYmd) : longDateInTz(fromYmd) + " \u2192 " + longDateInTz(toYmd);
    return jsonRes({
      ok: true,
      timezone: FACTORY_TZ2,
      factory: allFactories ? "All" : factoryParam,
      dateRange: {
        from: fromYmd,
        to: toYmd,
        sameDay,
        label,
        fromWeekday: weekdayInTz(fromYmd),
        toWeekday: weekdayInTz(toYmd)
      },
      totals: allFactories ? totals : filteredTotals,
      byLocation: filteredByLocation,
      groups: filteredGroups,
      factories: filteredByLocation.map((lt) => ({
        name: lt.location,
        totals: {
          invoices: lt.invoices,
          abayas: lt.abayas,
          delivered: lt.delivered,
          pending: lt.pending,
          cancelled: lt.cancelled
        }
      })),
      cancellations,
      meta: {
        generatedAt: Date.now(),
        durationMs: Date.now() - t0,
        dataSource: lb.source,
        leaderboardError: lb.error || null,
        leaderboardRowsScanned: leaderboardRows.length,
        rowsInWindow: agg.inWindowCount,
        cloudCancellationsScanned: cancellations.length
      }
    }, 200, CEO_JSON_NO_STORE);
  } catch (e) {
    console.error("[check-delivery] failed:", e && (e.stack || e.message || e));
    return errRes("Could not build delivery report: " + (e && e.message || String(e)), 500);
  }
}
__name(handleCheckDeliveryReport, "handleCheckDeliveryReport");
async function handleCancellationsPost(env, request) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return errRes("Invalid JSON body", 400);
  }
  const factory = String(body && body.factory || DEFAULT_FACTORY).trim();
  const invoiceNo = String(body && body.invoiceNo || "").trim();
  const abayaCode = String(body && body.abayaCode || "").trim();
  const reason = String(body && body.reason || "").trim();
  const cancelledBy = String(body && body.cancelledBy || "").trim();
  const cancelledAtMs = Number(body && body.cancelledAt) || Date.now();
  if (!invoiceNo && !abayaCode) {
    return errRes("At least one of invoiceNo or abayaCode is required so the cancellation is traceable.", 400);
  }
  const id = "cn_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  try {
    await env.DB.prepare(`
      INSERT INTO cancellations
        (id, factory, invoice_no, abaya_code, cancelled_at, cancelled_by, reason, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ceo', unixepoch())
    `).bind(
      id,
      factory || DEFAULT_FACTORY,
      invoiceNo,
      abayaCode,
      cancelledAtMs,
      cancelledBy,
      reason
    ).run();
  } catch (e) {
    console.error("[cancellations] insert failed:", e && (e.message || e));
    return errRes("Could not save cancellation: " + (e && e.message || String(e)), 500);
  }
  return jsonRes({
    ok: true,
    cancellation: {
      id,
      factory: factory || DEFAULT_FACTORY,
      invoiceNo,
      abayaCode,
      cancelledAt: cancelledAtMs,
      cancelledBy,
      reason,
      source: "ceo"
    }
  }, 201, CEO_JSON_NO_STORE);
}
__name(handleCancellationsPost, "handleCancellationsPost");
async function handleCancellationsList(env, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const today = ymdToday();
  const fromYmd = safeYmd(from || today, today);
  const toYmd = safeYmd(to || from || today, today);
  const fromMs = new Date(startOfDayIso(fromYmd)).getTime();
  const toMs = new Date(endOfDayIso(toYmd)).getTime();
  try {
    const res = await env.DB.prepare(`
      SELECT id, factory, invoice_no, abaya_code, cancelled_at, cancelled_by, reason, source
      FROM cancellations
      WHERE cancelled_at >= ? AND cancelled_at < ?
      ORDER BY cancelled_at ASC
    `).bind(fromMs, toMs).all();
    const cancellations = (res.results || []).map((c) => ({
      id: c.id,
      factory: c.factory || "",
      invoiceNo: c.invoice_no || "",
      abayaCode: c.abaya_code || "",
      cancelledAt: c.cancelled_at,
      cancelledBy: c.cancelled_by || "",
      reason: c.reason || "",
      source: c.source || "ceo"
    }));
    return jsonRes({ ok: true, cancellations, timezone: FACTORY_TZ2, from: fromYmd, to: toYmd }, 200, CEO_JSON_NO_STORE);
  } catch (e) {
    return errRes("Could not list cancellations: " + (e && e.message || String(e)), 500);
  }
}
__name(handleCancellationsList, "handleCancellationsList");
async function handleCheckReportConfig(env, url) {
  return handleCheckDeliveryConfig(env, url);
}
__name(handleCheckReportConfig, "handleCheckReportConfig");
async function handleCheckReport(env, url) {
  return handleCheckDeliveryReport(env, url);
}
__name(handleCheckReport, "handleCheckReport");

// src/domain/ticket.js
var CATEGORIES = /* @__PURE__ */ new Set(["login", "app", "network", "hardware", "catalog", "other"]);
var PRIORITIES = /* @__PURE__ */ new Set(["normal", "urgent"]);
var STATUSES = /* @__PURE__ */ new Set(["open", "pending", "resolved", "closed"]);
function isValidCategory(s) {
  return CATEGORIES.has(String(s || "").trim());
}
__name(isValidCategory, "isValidCategory");
function isValidPriority(s) {
  return PRIORITIES.has(String(s || "").trim());
}
__name(isValidPriority, "isValidPriority");
function isValidStatus(s) {
  return STATUSES.has(String(s || "").trim());
}
__name(isValidStatus, "isValidStatus");
function isRosterEmpId(s) {
  return /^e_bc_\d+$/.test(String(s || "").trim());
}
__name(isRosterEmpId, "isRosterEmpId");
function newTicketId(now = /* @__PURE__ */ new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `T-${y}-${m}-${d}-${s}`;
}
__name(newTicketId, "newTicketId");
function buildWaMeUrl(phoneE164, text) {
  if (!phoneE164) return null;
  const num = String(phoneE164).replace(/^\+/, "").replace(/[^\d]/g, "");
  if (!num) return null;
  const u = new URL("https://wa.me/" + num);
  if (text) u.searchParams.set("text", text);
  return u.toString();
}
__name(buildWaMeUrl, "buildWaMeUrl");
function buildTicketText(ticket) {
  if (!ticket) return "";
  const lines = [];
  lines.push(`[${ticket.id}] ${ticket.subject}`);
  lines.push(`Category: ${ticket.category} \xB7 Priority: ${ticket.priority}`);
  if (ticket.created_by_name) lines.push(`From: ${ticket.created_by_name} (${ticket.created_by})`);
  else lines.push(`From: ${ticket.created_by}`);
  if (ticket.station) lines.push(`Station: ${ticket.station}`);
  lines.push("");
  lines.push(ticket.description);
  return lines.join("\n");
}
__name(buildTicketText, "buildTicketText");

// src/handlers/tickets.js
var MAX_SUBJECT = 120;
var MAX_DESCRIPTION = 4e3;
function parseOfficeNumbers(env) {
  return (env.SUPPORT_OFFICE_NUMBERS || "").split(",").map((s) => s.trim()).filter(Boolean);
}
__name(parseOfficeNumbers, "parseOfficeNumbers");
var OFFICE_NUMBERS_CACHE_TTL_MS = 5 * 6e4;
var _officeCache = null;
async function getOfficeNumbers(env) {
  const now = Date.now();
  if (_officeCache && now - _officeCache.fetchedAt < OFFICE_NUMBERS_CACHE_TTL_MS) {
    return _officeCache.list;
  }
  const row = await env.DB.prepare(
    `SELECT v FROM worker_settings WHERE k = 'support_office_numbers'`
  ).first();
  let list;
  if (row && row.v) list = row.v.split(",").map((s) => s.trim()).filter(Boolean);
  else list = parseOfficeNumbers(env);
  _officeCache = { list, fetchedAt: now };
  return list;
}
__name(getOfficeNumbers, "getOfficeNumbers");
async function setOfficeNumbers(env, csv) {
  const v = String(csv || "").trim();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO worker_settings (k, v, updated_at) VALUES ('support_office_numbers', ?, unixepoch())`
  ).bind(v).run();
  _officeCache = null;
}
__name(setOfficeNumbers, "setOfficeNumbers");
async function handleCreateTicket(request, env) {
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes("Unauthorized", 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes("Invalid JSON", 400);
  }
  if (!body || typeof body !== "object") return errRes("Body must be a JSON object", 400);
  const createdBy = String(body.created_by || "").trim();
  if (!isRosterEmpId(createdBy)) {
    return errRes("created_by must be in the form e_bc_<digits> (roster guard)", 422);
  }
  const category = String(body.category || "").trim();
  if (!isValidCategory(category)) {
    return errRes("Invalid category. Must be one of: login, app, network, hardware, catalog, other", 422);
  }
  const priority = String(body.priority || "normal").trim();
  if (!isValidPriority(priority)) {
    return errRes("Invalid priority. Must be: normal, urgent", 422);
  }
  const subject = String(body.subject || "").trim();
  if (!subject) return errRes("subject is required", 422);
  if (subject.length > MAX_SUBJECT) return errRes(`subject must be <= ${MAX_SUBJECT} chars`, 422);
  const description = String(body.description || "").trim();
  if (!description) return errRes("description is required", 422);
  if (description.length > MAX_DESCRIPTION) return errRes(`description must be <= ${MAX_DESCRIPTION} chars`, 422);
  const createdByName = String(body.created_by_name || "").trim() || null;
  const station = String(body.station || "").trim() || null;
  let whatsappTo = String(body.whatsapp_to || "").trim() || null;
  if (!whatsappTo) {
    const list = await getOfficeNumbers(env);
    whatsappTo = list[0] || null;
  }
  if (!whatsappTo) {
    return errRes("No office WhatsApp number configured. Set SUPPORT_OFFICE_NUMBERS in the Worker env, or pass whatsapp_to in the body.", 422);
  }
  const id = newTicketId();
  const now = Math.floor(Date.now() / 1e3);
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO tickets (id, created_at, created_by, created_by_name, category, priority, subject, description, status, whatsapp_to, station, last_message_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).bind(id, now, createdBy, createdByName, category, priority, subject, description, whatsappTo, station, now, now),
    env.DB.prepare(`
      INSERT INTO ticket_events (ticket_id, event, actor, at, note)
      VALUES (?, 'created', ?, ?, 'Ticket created')
    `).bind(id, createdBy, now)
  ]);
  if (!results || !results[0] || !results[0].success) {
    return errRes("Failed to create ticket (DB rejected the row)", 500);
  }
  const ticket = await getTicketById(env, id);
  const waUrl = buildWaMeUrl(whatsappTo, buildTicketText(ticket));
  return jsonRes({ ok: true, ticket, wa_url: waUrl }, 201, CEO_JSON_NO_STORE);
}
__name(handleCreateTicket, "handleCreateTicket");
async function handleListTickets(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");
  const createdBy = url.searchParams.get("created_by");
  const priority = url.searchParams.get("priority");
  const since = parseIntOrNull(url.searchParams.get("since"));
  const until = parseIntOrNull(url.searchParams.get("until"));
  const limit = Math.min(parseIntOrNull(url.searchParams.get("limit")) || 100, 500);
  const wheres = [];
  const binds = [];
  if (status) {
    if (!isValidStatus(status)) return errRes("Invalid status", 422);
    wheres.push("status = ?");
    binds.push(status);
  }
  if (category) {
    if (!isValidCategory(category)) return errRes("Invalid category", 422);
    wheres.push("category = ?");
    binds.push(category);
  }
  if (createdBy) wheres.push("created_by = ?"), binds.push(createdBy);
  if (priority) {
    if (!isValidPriority(priority)) return errRes("Invalid priority", 422);
    wheres.push("priority = ?");
    binds.push(priority);
  }
  if (since) wheres.push("created_at >= ?"), binds.push(since);
  if (until) wheres.push("created_at <= ?"), binds.push(until);
  const sql = `SELECT * FROM tickets ${wheres.length ? "WHERE " + wheres.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);
  const res = await env.DB.prepare(sql).bind(...binds).all();
  return jsonRes({ ok: true, tickets: res.results || [] }, 200, CEO_JSON_NO_STORE);
}
__name(handleListTickets, "handleListTickets");
async function handleGetTicket(request, env, id) {
  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes("Ticket not found", 404);
  const events = await env.DB.prepare(`SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY at ASC`).bind(id).all();
  const messages = await env.DB.prepare(`SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY sent_at ASC`).bind(id).all();
  return jsonRes({ ok: true, ticket, events: events.results || [], messages: messages.results || [] }, 200, CEO_JSON_NO_STORE);
}
__name(handleGetTicket, "handleGetTicket");
async function handleResolveTicket(request, env, id) {
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes("Unauthorized", 401);
  }
  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes("Ticket not found", 404);
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return jsonRes({ ok: true, ticket, already_resolved: true }, 200, CEO_JSON_NO_STORE);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
  }
  const resolvedBy = String(body.resolved_by || "").trim() || (ticket.created_by || "office");
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.batch([
    env.DB.prepare(`UPDATE tickets SET status = 'resolved', resolved_at = ?, resolved_by = ?, last_message_at = ?, updated_at = ? WHERE id = ?`).bind(now, resolvedBy, now, now, id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'resolved', ?, ?, NULL)`).bind(id, resolvedBy, now)
  ]);
  const updated = await getTicketById(env, id);
  return jsonRes({ ok: true, ticket: updated }, 200, CEO_JSON_NO_STORE);
}
__name(handleResolveTicket, "handleResolveTicket");
async function handleReopenTicket(request, env, id) {
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes("Unauthorized", 401);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
  }
  const reopenedBy = String(body.reopened_by || "").trim();
  if (!isRosterEmpId(reopenedBy) && reopenedBy !== "office") {
    return errRes('reopened_by must be e_bc_<digits> or "office"', 422);
  }
  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes("Ticket not found", 404);
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    return jsonRes({ ok: true, ticket, already_open: true }, 200, CEO_JSON_NO_STORE);
  }
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.batch([
    env.DB.prepare(`UPDATE tickets SET status = 'open', resolved_at = NULL, resolved_by = NULL, last_message_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'reopened', ?, ?, ?)`).bind(id, reopenedBy, now, body.note ? String(body.note) : null)
  ]);
  const updated = await getTicketById(env, id);
  return jsonRes({ ok: true, ticket: updated }, 200, CEO_JSON_NO_STORE);
}
__name(handleReopenTicket, "handleReopenTicket");
async function handleOperatorReply(request, env, id) {
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes("Unauthorized", 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes("Invalid JSON", 400);
  }
  const sender = String(body.sender || "").trim();
  if (!isRosterEmpId(sender)) return errRes("sender must be e_bc_<digits>", 422);
  const text = String(body.text || "").trim();
  if (!text) return errRes("text is required", 422);
  if (text.length > 4e3) return errRes("text too long", 422);
  const ticket = await getTicketById(env, id);
  if (!ticket) return errRes("Ticket not found", 404);
  const botCfg = await env.DB.prepare(`SELECT v FROM worker_settings WHERE k = 'whatsapp_bot_url'`).first();
  if (!botCfg || !botCfg.v) {
    return errRes('Reply path is offline \u2014 the WhatsApp bot is not registered yet. Use "Mark resolved" in the launcher for now.', 503);
  }
  const now = Math.floor(Date.now() / 1e3);
  const ticketText = `[${id}] ${ticket.subject}

${text}`;
  let botRes;
  try {
    botRes = await fetch(botCfg.v.replace(/\/$/, "") + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Secret": (env.WHATSAPP_BOT_SECRET || "").trim() },
      body: JSON.stringify({ to: ticket.whatsapp_to, text: ticketText, ticket_id: id })
    });
  } catch (e) {
    return errRes("Failed to reach the WhatsApp bot: " + (e && e.message), 502);
  }
  if (!botRes.ok) {
    const t = await botRes.text().catch(() => "");
    return errRes(`Bot returned ${botRes.status}: ${t.slice(0, 200)}`, 502);
  }
  const botJson = await botRes.json().catch(() => ({}));
  const waId = botJson.wa_message_id || null;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, direction, sender, text, via, wa_message_id, sent_at) VALUES (?, 'out', ?, ?, 'whatsapp-web-bot', ?, ?)`).bind(id, sender, text, waId, now),
    env.DB.prepare(`UPDATE tickets SET last_message_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'replied', ?, ?, NULL)`).bind(id, sender, now)
  ]);
  return jsonRes({ ok: true, sent: true, wa_message_id: waId }, 200, CEO_JSON_NO_STORE);
}
__name(handleOperatorReply, "handleOperatorReply");
async function handleResolvePage(env, id) {
  const ticket = await getTicketById(env, id);
  const html = renderResolvePage(ticket);
  return new Response(html, {
    status: ticket ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(handleResolvePage, "handleResolvePage");
function renderResolvePage(ticket) {
  if (!ticket) {
    return `<!doctype html><html><body style="font-family:system-ui;padding:24px"><h2>Ticket not found</h2><p>This ticket may have been deleted. Check the ticket ID.</p></body></html>`;
  }
  const safe = /* @__PURE__ */ __name((s) => String(s || "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]), "safe");
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(ticket.id)}</title>
<style>body{font-family:system-ui;padding:24px;max-width:480px;margin:0 auto}h2{margin-top:0}
.card{border:1px solid #ddd;border-radius:8px;padding:16px;margin:12px 0;background:#fafafa}
.btn{display:inline-block;padding:14px 24px;border-radius:8px;background:#1a7f37;color:#fff;
     text-decoration:none;font-weight:600;font-size:16px;border:none;cursor:pointer;width:100%;text-align:center;box-sizing:border-box}
.btn:active{opacity:0.85}.meta{color:#666;font-size:13px;margin-top:8px}.resolved{background:#1a7f37;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block}</style>
</head><body>
<h2>Ticket ${safe(ticket.id)}</h2>
<div class="card">
  <div><b>${safe(ticket.subject)}</b></div>
  <div class="meta">${safe(ticket.category)} \xB7 ${safe(ticket.priority)} \xB7 ${safe(ticket.status)}</div>
  <div style="margin-top:12px;white-space:pre-wrap">${safe(ticket.description)}</div>
  <div class="meta" style="margin-top:12px">From: ${safe(ticket.created_by_name || ticket.created_by)} at ${new Date(ticket.created_at * 1e3).toLocaleString()}</div>
</div>
${ticket.status === "resolved" || ticket.status === "closed" ? `<div class="resolved">\u2713 Already resolved ${ticket.resolved_at ? new Date(ticket.resolved_at * 1e3).toLocaleString() : ""} by ${safe(ticket.resolved_by || "")}</div>` : `<form method="POST" action="/api/tickets/${encodeURIComponent(ticket.id)}/resolve">
       <input type="hidden" name="resolved_by" value="office">
       <button class="btn" type="submit">Mark resolved</button>
     </form>
     <p class="meta">One tap \u2014 no login needed. Operator will see the update in their launcher.</p>`}
</body></html>`;
}
__name(renderResolvePage, "renderResolvePage");
async function handleWhatsappIncoming(request, env) {
  const secret = (request.headers.get("X-Bot-Secret") || "").trim();
  if (!secret || !env.WHATSAPP_BOT_SECRET || secret !== (env.WHATSAPP_BOT_SECRET || "").trim()) {
    return errRes("Unauthorized", 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes("Invalid JSON", 400);
  }
  const from = String(body.from || "").trim();
  const text = String(body.text || "").trim();
  const waId = String(body.wa_message_id || "").trim() || null;
  const hint = String(body.ticket_id_hint || "").trim() || null;
  if (!from) return errRes("Missing from", 422);
  if (!text) return errRes("Missing text", 422);
  if (waId) {
    const existing = await env.DB.prepare(`SELECT id, ticket_id FROM ticket_messages WHERE wa_message_id = ?`).bind(waId).first();
    if (existing) {
      return jsonRes({ ok: true, deduped: true, ticket_id: existing.ticket_id, message_id: existing.id }, 200, CEO_JSON_NO_STORE);
    }
  }
  let ticket = null;
  if (hint) ticket = await getTicketById(env, hint);
  if (!ticket) {
    const idMatch = text.match(/\bT-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,12}\b/i);
    if (idMatch) ticket = await getTicketById(env, idMatch[0].toUpperCase());
  }
  if (!ticket) {
    const recent = await env.DB.prepare(
      `SELECT * FROM tickets WHERE whatsapp_to = ? AND status IN ('open','pending') ORDER BY last_message_at DESC LIMIT 1`
    ).bind(from).first();
    ticket = recent;
  }
  if (!ticket) {
    return jsonRes({ ok: true, ignored: true, reason: "no matching ticket" }, 200, CEO_JSON_NO_STORE);
  }
  const now = Math.floor(Date.now() / 1e3);
  const newStatus = ticket.status === "open" ? "pending" : ticket.status;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, direction, sender, text, via, wa_message_id, sent_at) VALUES (?, 'in', 'office', ?, 'whatsapp-web-bot', ?, ?)`).bind(ticket.id, text, waId, now),
    env.DB.prepare(`UPDATE tickets SET status = ?, last_message_at = ?, updated_at = ? WHERE id = ?`).bind(newStatus, now, now, ticket.id),
    env.DB.prepare(`INSERT INTO ticket_events (ticket_id, event, actor, at, note) VALUES (?, 'replied', 'office', ?, NULL)`).bind(ticket.id, now)
  ]);
  return jsonRes({ ok: true, ticket_id: ticket.id, status: newStatus }, 200, CEO_JSON_NO_STORE);
}
__name(handleWhatsappIncoming, "handleWhatsappIncoming");
async function handleSetBotUrl(request, env) {
  const secret = (request.headers.get("X-Bot-Secret") || "").trim();
  if (!secret || !env.WHATSAPP_BOT_SECRET || secret !== (env.WHATSAPP_BOT_SECRET || "").trim()) {
    return errRes("Unauthorized", 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes("Invalid JSON", 400);
  }
  const url = String(body.url || "").trim();
  if (!url || !/^https?:\/\//.test(url)) return errRes("Invalid url", 422);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO worker_settings (k, v, updated_at) VALUES ('whatsapp_bot_url', ?, unixepoch())`
  ).bind(url).run();
  return jsonRes({ ok: true, url }, 200, CEO_JSON_NO_STORE);
}
__name(handleSetBotUrl, "handleSetBotUrl");
async function handleGetSupportConfig(request, env) {
  const list = await getOfficeNumbers(env);
  return jsonRes({ ok: true, office_numbers: list, primary: list[0] || null, fallback: list.slice(1) }, 200, CEO_JSON_NO_STORE);
}
__name(handleGetSupportConfig, "handleGetSupportConfig");
async function handleSetSupportConfig(request, env) {
  const secret = (request.headers.get("X-Ingest-Secret") || "").trim();
  if (!secret || secret !== (env.INGEST_SECRET || "").trim()) {
    return errRes("Unauthorized", 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errRes("Invalid JSON", 400);
  }
  const csv = String(body.office_numbers || "").trim();
  const parts = csv.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!/^\+\d{7,15}$/.test(p)) return errRes(`Invalid phone number: ${p}. Use E.164 format (e.g. +971543618066).`, 422);
  }
  await setOfficeNumbers(env, parts.join(","));
  return jsonRes({ ok: true, office_numbers: parts, primary: parts[0] || null }, 200, CEO_JSON_NO_STORE);
}
__name(handleSetSupportConfig, "handleSetSupportConfig");
async function getTicketById(env, id) {
  return await env.DB.prepare(`SELECT * FROM tickets WHERE id = ?`).bind(String(id).trim()).first();
}
__name(getTicketById, "getTicketById");
function parseIntOrNull(v) {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
__name(parseIntOrNull, "parseIntOrNull");

// src/eod-summary.js
function fmtHmsForLog(sec) {
  if (!sec || sec < 1) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec % 3600 / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
__name(fmtHmsForLog, "fmtHmsForLog");
async function sendEODSummary(env) {
  const today = factoryTodayString(env);
  const stats = await env.DB.prepare(
    `SELECT stat_date, total_units, total_sec,
        tailor_01_units, tailor_02_units, hand_work_units, stone_work_units,
        button_units, embroidery_units, ari_work_units, hand_designing_units,
        invoice_maker_units, packaging_units, checker_units
     FROM daily_stats WHERE stat_date = ?`
  ).bind(today).first();
  const sessions = await env.DB.prepare(
    `SELECT MAX(emp_name) as emp_name, MAX(emp_process) as emp_process, COUNT(*) as units
     FROM sessions WHERE day_date = ? GROUP BY emp_id ORDER BY units DESC LIMIT 5`
  ).bind(today).all();
  const avgSec = stats && stats.total_units > 0 ? Math.round(stats.total_sec / stats.total_units) : 0;
  let msg = "\u{1F4CA} *AbaYa Track \u2014 End of Day Report*\n";
  msg += `_${today}_

`;
  msg += "\u{1F454} *Production Summary*\n";
  msg += `\u2022 Total Completed: *${stats ? stats.total_units : 0} units*
`;
  msg += `\u2022 Avg Cycle Time: *${fmtHmsForLog(avgSec)}*
`;
  const u = stats || {};
  msg += `\u2022 Tailor (01): ${u.tailor_01_units || 0} | Tailor (02): ${u.tailor_02_units || 0} | Hand Work: ${u.hand_work_units || 0}
`;
  msg += `\u2022 Stone Work: ${u.stone_work_units || 0} | Button: ${u.button_units || 0} | Embroidery: ${u.embroidery_units || 0}
`;
  msg += `\u2022 Ari Work: ${u.ari_work_units || 0} | Hand Designing: ${u.hand_designing_units || 0}
`;
  msg += `\u2022 Invoice maker: ${u.invoice_maker_units || 0} | Packaging: ${u.packaging_units || 0} | Checker: ${u.checker_units || 0}

`;
  msg += "\u{1F3C6} *Top Performers Today*\n";
  (sessions.results || []).forEach((r, i) => {
    msg += `${i + 1}. ${r.emp_name} \u2014 ${r.units} units (${r.emp_process})
`;
  });
  msg += "\n\u2705 _Auto-generated by AbaYa Track Server_";
  if (env.EXPORTS) {
    await env.EXPORTS.put(`eod/${today}.txt`, msg, {
      httpMetadata: { contentType: "text/plain" }
    });
  }
  console.log("EOD Summary generated for", today, ":", stats);
}
__name(sendEODSummary, "sendEODSummary");

// src/ui/ceo-static.js
var DASHBOARD_HTML_VERSION = "1.2.28";
var DASHBOARD_CSS_BODY = `:root{--bg:#1f1633;--s1:#150f23;--s2:#241a38;--s3:#362d59;--bd:rgba(54,45,89,.5);--bd2:rgba(106,95,193,.3);--tx:#ffffff;--tx2:#e5e7eb;--tx3:#9c98b0;--gr:#c2ef4e;--grb:rgba(194,239,78,.12);--rd:#ef4444;--rdb:rgba(239,68,68,.12);--bl:#6a5fc1;--blb:rgba(106,95,193,.15);--am:#ffb287;--amb:rgba(255,178,135,.12);--pu:#a78bfa;--fn:'Rubik',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;--fn-display:'Sora','Rubik',sans-serif;--fn-mono:Monaco,Menlo,'Ubuntu Mono',monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:var(--fn);min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:11px 18px;background:var(--s1);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:100}
.tb-brand{display:flex;align-items:center;gap:10px}
.tb-logo{width:32px;height:32px;background:linear-gradient(135deg,#6a5fc1,#422082);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px}
.tb-name{font-size:15px;font-weight:600}
.tb-sub{font-size:11px;color:var(--tx3)}
.live-badge{display:flex;align-items:center;gap:5px;background:var(--rdb);color:var(--rd);padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2px}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--rd);animation:blink 1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.dash{padding:16px;max-width:1100px;margin:0 auto}
.dh{font-family:var(--fn-display);font-size:20px;font-weight:700;margin-bottom:2px}
.ds{font-size:12px;color:var(--tx3);margin-bottom:18px}
.stat-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
@media(max-width:1180px){.stat-row{grid-template-columns:repeat(3,1fr)}}
.stat-row-2{grid-template-columns:1fr 1fr}
.stat-row-3{grid-template-columns:1fr 1fr 1fr}
.stat-card{background:rgba(255,255,255,.08);border:1px solid var(--bd);border-radius:16px;padding:18px;backdrop-filter:blur(18px) saturate(180%);box-shadow:rgba(22,15,36,.4) 0px 2px 8px;position:relative;overflow:hidden;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background .18s ease;will-change:transform}
.stat-card:hover{transform:translateY(-2px);box-shadow:rgba(22,15,36,.55) 0px 14px 30px,inset 0 0 0 1px rgba(124,111,224,.32);border-color:rgba(124,111,224,.45);background:rgba(255,255,255,.11)}
.stat-card::before{content:'';position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--bl),var(--pu),var(--gr));opacity:0;transform:scaleX(.6);transform-origin:left center;transition:opacity .25s ease,transform .35s ease;pointer-events:none}
.stat-card:hover::before{opacity:1;transform:scaleX(1)}
/* Staggered entry: cards fade in + lift 8px, with a 50ms per-card delay */
@keyframes statCardEnter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.stat-card.stat-card-enter{animation:statCardEnter .45s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--stagger-i,0) * 50ms)}
@media(prefers-reduced-motion:reduce){.stat-card.stat-card-enter{animation:none}}
/* Click ripple: pure CSS using transform scale on a positioned span */
.stat-card-ink{position:absolute;border-radius:50%;background:rgba(255,255,255,.18);transform:scale(0);opacity:1;pointer-events:none;animation:statCardInk .55s ease-out forwards}
@keyframes statCardInk{to{transform:scale(2.2);opacity:0}}
@media(prefers-reduced-motion:reduce){.stat-card-ink{display:none}}
.stat-lbl{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-weight:600}
.stat-val{font-size:28px;font-weight:800;margin:6px 0 2px}
.stat-sub{font-size:11px;color:var(--tx3)}
.dash-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.dash-card{background:rgba(255,255,255,.08);border:1px solid var(--bd);border-radius:16px;padding:18px;backdrop-filter:blur(18px) saturate(180%);box-shadow:rgba(22,15,36,.4) 0px 2px 8px}
.dash-card-title{font-size:11px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.emp-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;transition:background .15s}
.emp-row:hover{background:rgba(106,95,193,.08)}
.emp-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}
.bar-wrap{flex:1;height:5px;background:var(--s3);border-radius:3px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px}
.rep-panel{background:linear-gradient(135deg,rgba(106,95,193,.12),rgba(167,139,250,.08));border:1px solid rgba(106,95,193,.3);border-radius:14px;padding:16px 16px 14px;margin-bottom:16px}
.rep-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.rep-btn{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:88px;padding:12px 14px;border-radius:13px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #584674;background:#79628c;color:#fff;font-family:var(--fn);transition:all .2s;text-transform:uppercase;letter-spacing:0.3px;box-shadow:rgba(0,0,0,.1) 0px 1px 3px 0px inset}
.rep-btn:hover{box-shadow:rgba(0,0,0,.22) 0px .5rem 1.5rem;transform:translateY(-1px);filter:brightness(1.06)}
/* Trace combobox dropdown */
.trace-dd-h{font-size:9px;text-transform:uppercase;letter-spacing:1.1px;color:var(--tx3);padding:10px 12px 6px}
.trace-dd-row{display:flex;align-items:center;gap:0;padding:9px 12px;cursor:pointer;border-top:1px solid rgba(124,111,224,.10);transition:background .14s ease,transform .14s ease;color:var(--tx);font-size:13px;line-height:1.3}
.trace-dd-row:hover,.trace-dd-row.trace-dd-active{background:rgba(106,95,193,.16);transform:translateX(2px)}
.trace-dd-code{font-weight:700;font-family:var(--fn-mono);letter-spacing:.2px}
.trace-dd-sub{font-size:11px;color:var(--tx3);margin-left:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.exec-filters{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
@media(max-width:980px){.exec-filters{grid-template-columns:1fr 1fr}}
@media(max-width:680px){.exec-filters{grid-template-columns:1fr}}
.exec-filter{background:rgba(0,0,0,.18);border:1px solid rgba(106,95,193,.22);border-radius:11px;padding:10px 12px}
.exec-filter-lbl{font-size:10.5px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px;font-weight:600;margin-bottom:6px}
.exec-filter-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.exec-filter-hint{font-size:10.5px;color:var(--tx3);margin-top:6px;line-height:1.4}
.exec-input{padding:8px 10px;border-radius:9px;background:var(--s1);border:1px solid var(--bd2);color:var(--tx);font-family:var(--fn);font-size:13px;min-width:0;flex:1}
.exec-input:focus{outline:none;border-color:var(--bl);box-shadow:0 0 0 3px rgba(106,95,193,.18)}
.exec-chip{padding:8px 12px;border-radius:9px;background:var(--s3);color:var(--tx2);border:1px solid var(--bd2);font-family:var(--fn);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap}
.exec-chip:hover{background:var(--bl);color:#fff;border-color:rgba(167,139,250,.5)}
.exec-chip-primary{background:linear-gradient(135deg,#6a5fc1,#422082);color:#fff;border-color:rgba(167,139,250,.55);box-shadow:0 0 0 1px rgba(167,139,250,.18) inset}
.exec-chip-primary:hover{filter:brightness(1.08);border-color:rgba(167,139,250,.75)}
.exec-reports{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}
@media(max-width:680px){.exec-reports{grid-template-columns:repeat(2,1fr)}}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(21,15,35,.85);z-index:999;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(8px);overflow-y:auto}
.modal-overlay.open{display:flex}
.modal-box{background:var(--s1);border:1px solid var(--bd2);border-radius:20px;padding:24px;width:100%;max-width:600px;margin:auto;box-shadow:rgba(22,15,36,.9) 0px 24px 80px;animation:pop .25s ease}
.modal-title{font-family:var(--fn-display);font-size:20px;font-weight:700;color:var(--tx);margin-bottom:4px;line-height:1.2;letter-spacing:-.3px}
.modal-sub{font-size:12.5px;color:var(--tx3);margin-bottom:16px;line-height:1.45}
.modal-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;align-items:center}
@keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.btn-export{flex:1;padding:13px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-weight:700;border:none;border-radius:13px;font-size:14px;cursor:pointer;font-family:var(--fn);transition:all .2s;text-transform:uppercase;letter-spacing:0.2px}
.btn-export:hover{opacity:.9}
.btn-close{padding:13px 22px;background:var(--s2);color:var(--tx2);font-weight:600;border:1px solid var(--bd2);border-radius:13px;font-size:14px;cursor:pointer;font-family:var(--fn);text-transform:uppercase;letter-spacing:0.2px}
.btn-close:hover{background:var(--s3);color:var(--tx)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--s1);border:1px solid var(--bd2);border-radius:12px;padding:11px 18px;font-size:13px;font-weight:500;z-index:9999;transition:transform .35s cubic-bezier(.175,.885,.32,1.275);white-space:nowrap}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast.success{border-color:rgba(194,239,78,.4);background:rgba(194,239,78,.1);color:var(--gr)}
.toast.error{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:var(--rd)}
.release-moment-wrap{max-width:1100px;margin:0 auto;padding:0 16px 10px}
.abaya-release-moment{position:relative;border-radius:18px;border:1px solid rgba(167,139,250,.38);background:linear-gradient(125deg,rgba(106,95,193,.2),rgba(21,15,35,.92));box-shadow:0 18px 50px rgba(4,2,10,.35);overflow:hidden}
.abaya-release-moment__glow{position:absolute;inset:-40%;background:radial-gradient(closest-side,rgba(167,139,250,.22),transparent 70%);opacity:.88;pointer-events:none}
.abaya-release-moment--motion .abaya-release-moment__glow{animation:armGlowCEO 15s ease-in-out infinite alternate}
@keyframes armGlowCEO{from{transform:translate(-3%,-1%) scale(1)}to{transform:translate(4%,2%) scale(1.05)}}
.abaya-release-moment__inner{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px;flex-wrap:wrap}
.abaya-release-moment__eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--pu);margin-bottom:6px}
.abaya-release-moment__hook{font-family:var(--fn-display);font-size:clamp(19px,2.2vw,24px);font-weight:800;letter-spacing:-.03em;line-height:1.15;margin:0 0 6px}
.abaya-release-moment__outcome{font-size:13px;color:var(--tx2);line-height:1.45;max-width:52ch;margin:0}
.abaya-release-moment__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.abaya-release-moment__btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:13px;font-size:12px;font-weight:700;font-family:var(--fn);text-decoration:none;cursor:pointer;transition:transform .16s ease}
.abaya-release-moment__btn--primary{background:linear-gradient(135deg,#8e6cff,#6f58d9);color:#fff;border:1px solid rgba(181,159,255,.55);box-shadow:0 8px 22px rgba(88,64,169,.4)}
.abaya-release-moment__btn--primary:hover{transform:translateY(-1px)}
.abaya-release-moment__btn--ghost{background:rgba(255,255,255,.06);color:var(--tx2);border:1px solid var(--bd2)}
.abaya-release-moment__dismiss{background:transparent;border:none;color:var(--tx3);font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;padding:6px 2px;font-family:var(--fn)}
@media(prefers-reduced-motion:reduce){.abaya-release-moment--motion .abaya-release-moment__glow{animation:none!important}}
#proc-split{max-height:220px;overflow-y:auto;padding-right:4px}
@media(max-width:700px){.stat-row{grid-template-columns:1fr 1fr}.dash-row{grid-template-columns:1fr}}

/* \u2500\u2500\u2500 Check Delivery Report (calendar + per-factory delivery summary) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Reuses the existing dark-purple palette and rep-panel / modal-overlay
 * patterns so the new button looks like it has always belonged to the
 * Executive Reports panel. No new visual language.
 */
.cr-wrap{display:flex;flex-direction:column;gap:14px}
.cr-cal{background:var(--s2);border:1px solid var(--bd);border-radius:14px;padding:14px}
.cr-cal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.cr-cal-title{font-family:var(--fn-display);font-size:15px;font-weight:700;color:var(--tx)}
.cr-nav{display:flex;gap:6px}
.cr-nav-btn{background:var(--s3);color:var(--tx2);border:1px solid var(--bd2);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--fn)}
.cr-nav-btn:hover{background:var(--bl);color:#fff;border-color:rgba(167,139,250,.5)}
.cr-nav-btn:disabled{opacity:.4;cursor:not-allowed}
.cr-weekdays,.cr-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cr-weekdays{margin-bottom:6px}
.cr-wd{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px;text-align:center;padding:4px 0;font-weight:600}
.cr-cell{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;border-radius:10px;font-size:13px;font-weight:600;color:var(--tx2);background:var(--s1);border:1px solid var(--bd);cursor:pointer;transition:all .15s;position:relative;font-family:var(--fn)}
.cr-cell:hover{border-color:var(--bl);color:var(--tx)}
.cr-cell.muted{opacity:.3;cursor:default}
.cr-cell.today{outline:1px solid var(--am);outline-offset:-2px}
.cr-cell.selected{background:var(--bl);color:#fff;border-color:rgba(167,139,250,.7)}
.cr-cell.in-range{background:rgba(106,95,193,.25);color:var(--tx);border-color:var(--bd2)}
.cr-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--tx2);padding:8px 4px;border-top:1px solid var(--bd)}
.cr-summary b{color:var(--tx)}
.cr-factory-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cr-factory-pick select{padding:6px 10px;border-radius:8px;border:1px solid var(--bd);background:var(--s2);color:var(--tx2);font-family:var(--fn);font-size:12px}
.cr-totals{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.cr-tot{background:var(--s2);border:1px solid var(--bd);border-radius:10px;padding:10px;text-align:center}
.cr-tot-lbl{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-weight:600}
.cr-tot-val{font-size:20px;font-weight:800;color:var(--gr);font-family:var(--fn-display);letter-spacing:-.5px}
.cr-tot-val.delivered{color:var(--gr)}
.cr-tot-val.pending{color:var(--am)}
.cr-tot-val.cancelled{color:var(--rd)}
.cr-tot-val.abayas{color:var(--bl)}
.cr-tot-val.invoices{color:var(--pu)}
.cr-section{background:var(--s2);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
.cr-section-h{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--bd);font-size:12px;color:var(--tx2);font-weight:700;text-transform:uppercase;letter-spacing:.6px}
.cr-section-h .cr-mini{font-size:10px;color:var(--tx3);font-weight:600;text-transform:none;letter-spacing:0}
.cr-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px}
.cr-row:last-child{border-bottom:0}
.cr-factory-name{font-weight:700;color:var(--tx);font-size:13px}
.cr-inv-name{font-weight:600;color:var(--tx2);font-family:var(--fn-mono);font-size:11px}
.cr-abaya{font-family:var(--fn-mono);font-size:11px;color:var(--tx2);display:flex;justify-content:space-between;gap:8px;align-items:center}
.cr-status{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
.cr-status.delivered{color:var(--gr);background:rgba(194,239,78,.12);border:1px solid rgba(194,239,78,.3)}
.cr-status.pending{color:var(--am);background:rgba(255,178,135,.12);border:1px solid rgba(255,178,135,.3)}
.cr-status.cancelled{color:var(--rd);background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3)}
.cr-empty{padding:24px;text-align:center;color:var(--tx3);font-size:13px}
/* Smooth the data-swap on every poll. Without this, the innerHTML
   replacements in renderAll() visibly snap, making the live row +
   per-employee + abaya totals look like the previous data is going
   away and being replaced. The .is-syncing class is applied to .dash
   around the STATE = d; renderAll() pair so the user sees a brief
   pulse instead of a hard swap. */
.dash{transition:opacity .18s ease}
.dash.is-syncing{opacity:.55}
/* 30-day history strip in the per-employee day report. */
.ed-day-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;padding:10px 12px}
.ed-day-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:6px 4px;border-radius:8px;border:1px solid rgba(54,45,89,.35);font-family:var(--fn);color:var(--tx);cursor:pointer;transition:transform .12s ease,border-color .12s ease;min-height:54px}
.ed-day-cell:hover{transform:translateY(-1px);border-color:var(--am)}
.ed-day-cell.is-current{border-color:var(--am);box-shadow:0 0 0 1px rgba(245,158,11,.4)}
.ed-day-date{font-size:10px;color:var(--tx3);font-weight:600;letter-spacing:.4px}
.ed-day-units{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.ed-day-time{font-size:10px;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.1;margin-top:1px}
/* By-employee table in the Process & garment analytics modal.
   Responsive grid: 8-col wide \u2192 4-col medium \u2192 2-row card on mobile. */
.by-emp-table{background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:visible}
.by-emp-head,.by-emp-row{display:grid;grid-template-columns:minmax(0,1fr) 50px repeat(6,minmax(60px,1fr));gap:8px;padding:10px 12px;align-items:center;position:relative}
.by-emp-head{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--bd);border-radius:10px 10px 0 0;background:var(--s1)}
.by-emp-head>span,.by-emp-row>span[data-col]{text-align:right;font-variant-numeric:tabular-nums}
.by-emp-row{cursor:pointer;border-bottom:1px solid rgba(54,45,89,.2);font-size:13px;transition:background-color .14s ease,transform .14s ease}
.by-emp-body>*:last-child.by-emp-row{border-bottom:0}
.by-emp-row:hover{background:rgba(106,95,193,.10);transform:translateX(1px)}
.by-emp-row:hover .by-emp-name{color:var(--am)}
.by-emp-name{display:inline-block;text-decoration:none;background-image:linear-gradient(currentColor,currentColor);background-size:0 1px;background-repeat:no-repeat;background-position:0 100%;transition:background-size .25s ease,color .14s ease;min-width:0}
.by-emp-row:hover .by-emp-name{background-size:100% 1px}
.by-emp-units-pill{display:inline-block;min-width:34px;padding:2px 8px;border-radius:999px;background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.32);color:var(--gr);font-weight:700;font-variant-numeric:tabular-nums;font-size:12px;text-align:center}
.by-emp-col-hide-mid,.by-emp-col-hide-sm{display:none}
/* Mobile-only horizontal stat strip: hidden on desktop, shown via media query */
.by-emp-row-stats{display:none}

/* Medium: <=720px \u2014 drop tolerance + live, keep units + 4 time stats */
@media(max-width:720px){
  .by-emp-head,.by-emp-row{grid-template-columns:minmax(0,1fr) 56px repeat(4,minmax(54px,1fr));gap:6px;padding:10px;font-size:12px}
  .by-emp-col-hide-mid{display:none}
}

/* Small: <=520px \u2014 card layout: name+units on top row, time stats
   below in a horizontal flex strip. No grid. No overlap. */
@media(max-width:520px){
  /* Give the modal a little more room on phones */
  .modal-overlay{padding:8px}
  .modal-box{padding:16px;border-radius:14px}
  .by-emp-head{display:none}
  .by-emp-row{display:block;padding:10px 12px}
  .by-emp-row-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .by-emp-name{flex:1;min-width:0}
  .by-emp-units-pill{flex:0 0 auto}
  .by-emp-row-stats{display:flex;gap:6px;margin-top:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;scrollbar-width:thin}
  .by-emp-stat{flex:0 0 auto;background:var(--s1);border:1px solid var(--bd);border-radius:6px;padding:3px 7px;font-size:10.5px;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.3;white-space:nowrap}
  .by-emp-stat b{display:block;color:var(--tx);font-size:11.5px;font-weight:700;margin-top:1px}
  .by-emp-col-hide-sm{display:none}
  /* Popup drops below the row instead of off to the right */
  .by-emp-popup{position:static;width:auto;max-width:none;transform:none!important;margin-top:8px;right:auto;top:auto}
  .by-emp-row:hover .by-emp-popup,.by-emp-row:focus-within .by-emp-popup{transform:none!important}
}

/* Hover popup: focused on context the row can't show, NOT a duplicate
   of the row's time stats. Shows: avatar, name, all processes this
   person wore in the window, last finished abaya, avg per unit, and
   the one-tap action. */
.by-emp-popup{position:absolute;right:14px;top:50%;transform:translateY(-50%) translateX(6px);width:260px;max-width:calc(100% - 28px);background:linear-gradient(180deg,rgba(34,24,58,.97),rgba(22,15,36,.97));border:1px solid rgba(124,111,224,.45);border-radius:12px;padding:14px;font-size:12px;color:var(--tx);box-shadow:0 14px 40px rgba(0,0,0,.45),0 0 0 1px rgba(124,111,224,.18);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;z-index:5;backdrop-filter:blur(14px) saturate(180%)}
.by-emp-row:hover .by-emp-popup,.by-emp-row:focus-within .by-emp-popup{opacity:1;transform:translateY(-50%) translateX(0);pointer-events:auto}
.by-emp-popup-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.by-emp-popup-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#0f0a1f;flex-shrink:0}
.by-emp-popup-name{font-size:15px;font-weight:700;color:#fff;line-height:1.15}
.by-emp-popup-empcode{font-size:10px;color:var(--tx3);letter-spacing:.5px;margin-top:1px}
.by-emp-popup-processes{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.by-emp-popup-process{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:.2px}
.by-emp-popup-units-row{display:flex;align-items:baseline;justify-content:space-between;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.28);border-radius:8px;padding:8px 12px;margin-bottom:12px}
.by-emp-popup-units-lbl{font-size:10px;color:var(--gr);text-transform:uppercase;letter-spacing:.6px;font-weight:700}
.by-emp-popup-units-val{font-size:24px;font-weight:800;color:var(--gr);font-variant-numeric:tabular-nums;line-height:1}
.by-emp-popup-cta{display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;background:linear-gradient(135deg,#7c6fe0,#422082);color:#fff;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;letter-spacing:.3px;transition:filter .14s ease,transform .14s ease}
.by-emp-popup-cta:hover{filter:brightness(1.1);transform:translateY(-1px)}
.cr-cancel-list{display:flex;flex-direction:column;gap:6px;padding:10px 12px}
.cr-cancel-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--s1);border:1px solid var(--bd);border-radius:8px;font-size:12px;flex-wrap:wrap}
.cr-cancel-row b{font-family:var(--fn-mono);color:var(--rd);font-size:11px}
.cr-cancel-row .cr-when{color:var(--tx3);font-size:11px}
.cr-form{display:flex;flex-direction:column;gap:10px}
.cr-form label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--tx3);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.cr-form input,.cr-form select{padding:9px 11px;border-radius:9px;border:1px solid var(--bd2);background:var(--s1);color:var(--tx);font-family:var(--fn);font-size:13px}
.cr-form input:focus,.cr-form select:focus{outline:none;border-color:var(--bl)}
.cr-form-hint{font-size:11px;color:var(--tx3);line-height:1.5}
.cr-msg{padding:8px 12px;border-radius:9px;font-size:12px;line-height:1.45;background:var(--s1);border:1px solid var(--bd);color:var(--tx2)}
.cr-msg.warn{border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.08);color:#fde68a}
.cr-msg.error{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#fca5a5}
.cr-msg.ok{border-color:rgba(194,239,78,.35);background:rgba(194,239,78,.08);color:#d9f99d}
.cr-divider{height:1px;background:var(--bd);margin:8px 0}
.cr-tag{display:inline-block;padding:2px 8px;border-radius:6px;background:rgba(106,95,193,.15);color:var(--bl);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-left:6px}
.cr-scroll{max-height:300px;overflow-y:auto}
@media(max-width:600px){.cr-totals{grid-template-columns:repeat(2,1fr)}.cr-row{grid-template-columns:1fr}}`;
function _fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}
__name(_fnv1a, "_fnv1a");
var DASHBOARD_CSS_VERSION = _fnv1a(DASHBOARD_CSS_BODY);
function dashboardCssHref() {
  return "/static/ceo.css?v=" + DASHBOARD_CSS_VERSION;
}
__name(dashboardCssHref, "dashboardCssHref");
function getDashboardHtmlEtag(origin) {
  return 'W/"' + DASHBOARD_HTML_VERSION + "-" + DASHBOARD_CSS_VERSION + "-" + _fnv1a(String(origin || "")) + '"';
}
__name(getDashboardHtmlEtag, "getDashboardHtmlEtag");

// src/ui/ceo-pages.js
function getLoginPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>FarewellAbaya \u2014 Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet"></noscript>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#160f24;color:#fff;font-family:'Rubik',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;overflow:hidden;position:relative}
  /* soft drifting aurora behind the card */
  body::before,body::after{content:'';position:fixed;width:60vmax;height:60vmax;border-radius:50%;filter:blur(80px);opacity:.5;z-index:0;animation:drift 18s ease-in-out infinite alternate}
  body::before{background:radial-gradient(circle,#6a5fc1,transparent 60%);top:-15vmax;left:-10vmax}
  body::after{background:radial-gradient(circle,#a86fd6,transparent 60%);bottom:-18vmax;right:-12vmax;animation-delay:-9s}
  @keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(4vmax,3vmax) scale(1.15)}}
  @media (prefers-reduced-motion:reduce){body::before,body::after,.logo{animation:none}}
  .box{position:relative;z-index:1;background:rgba(255,255,255,.07);border:1px solid rgba(150,130,220,.28);border-radius:26px;padding:42px 38px;width:100%;max-width:372px;text-align:center;box-shadow:rgba(15,9,28,.85) 0 30px 90px;backdrop-filter:blur(22px) saturate(180%)}
  .logo{width:66px;height:66px;background:linear-gradient(135deg,#7c6fe0,#422082);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:33px;margin:0 auto 18px;box-shadow:0 10px 30px rgba(106,95,193,.45);animation:float 4.5s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
  .hi{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#a89fd0;margin-bottom:6px}
  h1{font-family:'Sora','Rubik',sans-serif;font-size:24px;font-weight:800;margin-bottom:8px;background:linear-gradient(90deg,#fff,#c9b8ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .sub{color:#9c98b0;font-size:13.5px;margin-bottom:26px;line-height:1.5}
  input{width:100%;padding:15px 18px;background:#221735;border:1px solid rgba(124,111,224,.3);border-radius:13px;color:#fff;font-size:16px;text-align:center;letter-spacing:3px;outline:none;transition:border-color .2s,box-shadow .2s;margin-bottom:12px;font-family:'Rubik',sans-serif}
  input::placeholder{letter-spacing:.5px;color:#6f688a}
  input:focus{border-color:#9d8bff;box-shadow:0 0 0 4px rgba(124,111,224,.18)}
  button{width:100%;padding:15px;background:linear-gradient(135deg,#7c6fe0,#5a3fb0);color:#fff;border:0;border-radius:13px;font-size:14px;font-weight:700;cursor:pointer;transition:transform .12s,box-shadow .2s,filter .2s;font-family:'Rubik',sans-serif;text-transform:uppercase;letter-spacing:.4px}
  button:hover{filter:brightness(1.08);box-shadow:0 .6rem 1.6rem rgba(106,95,193,.5)}
  button:active{transform:translateY(1px) scale(.99)}
  .err{color:#ff8a8a;font-size:13px;margin-top:10px;min-height:20px}
  .legal{margin-top:22px;font-size:11.5px;color:#6f688a;line-height:1.6}
  .legal a{color:#a89fd0;text-decoration:none}
  .legal a:hover{text-decoration:underline}
</style></head><body>
<div class="box">
  <div class="logo">&#129525;</div>
  <div class="hi">FarewellAbaya</div>
  <h1>Welcome back</h1>
  <p class="sub">Your atelier, at a glance.<br>Pop in your access code and let's go.</p>
  <input type="password" id="tok" placeholder="Access code" maxlength="64" autofocus onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Open my dashboard &#10142;</button>
  <div class="err" id="err"></div>
  <div class="legal">By continuing you agree to our<br>
    <a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy Policy</a></div>
</div>
<script>
async function login() {
  const t = document.getElementById('tok').value.trim();
  const err = document.getElementById('err');
  if (!t) { err.textContent = 'Enter access code'; return; }
  err.textContent = '';
  try {
    var r = await fetch('/api/ceo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: t })
    });
    var data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) {
      err.textContent = data && data.error ? String(data.error) : 'Login failed';
      return;
    }
    window.location.replace('/ceo');
  } catch (e) {
    err.textContent = (e && e.message) ? String(e.message).slice(0, 120) : 'Network error';
  }
}
<\/script></body></html>`;
}
__name(getLoginPage, "getLoginPage");
function getServiceWorkerCleanupScript() {
  return `self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((k) => caches.delete(k)));
    } catch (_) {}

    try {
      await self.registration.unregister();
    } catch (_) {}

    try {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(clientsList.map((client) => client.navigate(client.url)));
    } catch (_) {}
  })());
});

self.addEventListener('fetch', () => {});`;
}
__name(getServiceWorkerCleanupScript, "getServiceWorkerCleanupScript");
function getCEODashboard(origin) {
  const apiBase = origin;
  const baseJs = JSON.stringify(apiBase).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AbaYa Track \u2014 CEO Dashboard</title>
<script>
// Visible error banner \u2014 if ANY script on the page throws, show it
// inside the dashboard so the user doesn't have to open devtools.
(function () {
  function show(msg) {
    try {
      var b = document.getElementById('__js_err_banner');
      if (!b) {
        b = document.createElement('div');
        b.id = '__js_err_banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#ef4444;color:#fff;font:12px/1.4 monospace;padding:8px 12px;white-space:pre-wrap;max-height:40vh;overflow:auto;box-shadow:0 4px 12px rgba(0,0,0,.4)';
        if (document.body) document.body.appendChild(b); else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(b); });
      }
      var line = document.createElement('div');
      line.textContent = '[JS] ' + msg;
      b.appendChild(line);
    } catch (_) {}
  }
  window.addEventListener('error', function (ev) {
    show((ev.filename || 'inline') + ':' + (ev.lineno || '?') + ':' + (ev.colno || '?') + ' \u2014 ' + (ev.message || 'unknown'));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    show('unhandledrejection: ' + (r && r.message ? r.message : String(r)));
  });
})();
<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Sora:wght@600;700;800&display=optional" rel="stylesheet"></noscript>
<link rel="preload" as="style" href="${dashboardCssHref()}">
<link rel="stylesheet" href="${dashboardCssHref()}">
<noscript><link rel="stylesheet" href="${dashboardCssHref()}"></noscript>
</head>
<body>
<div class="topbar">
  <div class="tb-brand">
    <div class="tb-logo">&#129525;</div>
    <div><div class="tb-name">AbaYa Track</div><div class="tb-sub">CEO Dashboard &mdash; Global View</div></div>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <div style="font-size:11px;color:var(--tx3)" id="sync-status">Syncing...</div>
    <div class="live-badge"><div class="live-dot"></div>LIVE</div>
  </div>
</div>

<div id="releaseMomentMount" class="release-moment-wrap"></div>

<div class="dash">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:4px">
    <div class="dh">Production Overview</div>
    <div style="font-size:11px;color:var(--tx3)">&#128274; Secure CEO View &mdash; Cloudflare Global Network</div>
  </div>
  <div class="ds" id="dash-date">Loading...</div>
  <div class="ds" id="dubai-now" style="font-size:11px">Dubai time: --</div>
  <div class="ds" id="work-status" style="font-size:11px">Status: --</div>

  <div class="rep-panel" id="exec-reports">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6a5fc1,#422082);display:flex;align-items:center;justify-content:center;font-size:15px">&#128274;</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--tx);font-family:var(--fn-display);letter-spacing:-.2px">Executive Reports</div>
        <div style="font-size:11.5px;color:var(--tx3);margin-top:2px">Pick a date and (optionally) a person, then tap a report below. All reports export to WhatsApp in one tap.</div>
      </div>
    </div>
    <div class="exec-filters">
      <div class="exec-filter">
        <div class="exec-filter-lbl">&#128197; Pick a date</div>
        <div class="exec-filter-row">
          <input type="date" id="report-date" class="exec-input" aria-label="Report date" onchange="onReportDateChange()" oninput="onReportDateChange()">
          <button type="button" class="exec-chip" onclick="resetReportDate()">Today</button>
        </div>
        <div class="exec-filter-hint">Reports open for this date. Leave empty for today.</div>
      </div>
      <div class="exec-filter">
        <div class="exec-filter-lbl">&#128197; Pick a month</div>
        <div class="exec-filter-row">
          <input type="month" id="report-month" class="exec-input" aria-label="Report month" onchange="onReportMonthChange()" oninput="onReportMonthChange()">
          <button type="button" class="exec-chip" onclick="resetReportMonth()">This month</button>
        </div>
        <div class="exec-filter-hint">Scope every report (and the dashboard) to that month. Leave empty for today.</div>
      </div>
      <div class="exec-filter">
        <div class="exec-filter-lbl">&#128100; Pick a person</div>
        <div class="exec-filter-row">
          <select id="employee-day-select" class="exec-input" style="max-width:240px" aria-label="Employee">
            <option value="">Loading names\u2026</option>
          </select>
          <button type="button" class="exec-chip exec-chip-primary" onclick="openSelectedEmployeeDay()">&#128269; Show their day</button>
        </div>
        <div class="exec-filter-hint">See what that person did on the picked date (or today).</div>
      </div>
    </div>
    <div class="exec-reports">
      <button class="rep-btn" onclick="openReport('daily')"><span style="font-size:14px">&#128467;</span><span>Daily</span></button>
      <button class="rep-btn" onclick="openReport('weekly')"><span style="font-size:14px">&#128196;</span><span>Weekly</span></button>
      <button class="rep-btn" onclick="openReport('monthly')"><span style="font-size:14px">&#128202;</span><span>Monthly</span></button>
      <button class="rep-btn" onclick="openReport('yearly')"><span style="font-size:14px">&#128200;</span><span>Yearly</span></button>
      <button class="rep-btn" id="cr-open" onclick="openCheckReport()" style="background:linear-gradient(135deg,#6a5fc1,#422082);border-color:rgba(167,139,250,.55)" title="Check Delivery Report \u2014 overall delivery summary by factory"><span style="font-size:14px">&#128230;</span><span>Check Delivery</span></button>
    </div>
  </div>

  <div class="rep-panel" style="margin-top:12px">
    <div style="font-size:15px;font-weight:700;color:var(--am)">&#128200; Process &amp; garment analytics</div>
    <div style="font-size:11px;color:var(--tx2);margin-top:4px">Station bottlenecks (slowest avg times), fastest workers, trace one barcode through every logged step</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center">
      <label style="font-size:11px;color:var(--tx3)">Period</label>
      <select id="analytics-period" style="padding:8px 10px;border-radius:8px;background:var(--s2);border:1px solid var(--bd);color:var(--tx);font-size:12px">
        <option value="daily">Factory day</option>
        <option value="weekly">This week</option>
        <option value="monthly">This month</option>
        <option value="yearly">This year</option>
      </select>
      <button class="rep-btn" type="button" onclick="openAnalytics()">Open analytics</button>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bd)">
      <div style="font-size:12px;font-weight:600;color:var(--tx2);margin-bottom:4px">Garment trace</div>
      <div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Paste item code or internal abaya id (same as in catalog)</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;position:relative">
        <div style="flex:1;min-width:160px;position:relative">
          <input id="trace-q" type="text" placeholder="e.g. AB-0041 or paste an abaya id" autocomplete="off" spellcheck="false" style="width:100%;padding:10px 12px;border-radius:10px;background:var(--s2);border:1px solid var(--bd);color:var(--tx);font-size:13px" />
          <div id="trace-dd" role="listbox" aria-label="Garment trace suggestions" style="position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;background:var(--s1);border:1px solid var(--bd2);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);max-height:340px;overflow-y:auto;display:none"></div>
        </div>
        <button class="rep-btn" type="button" onclick="runGarmentTrace()">&#128269; Trace garment</button>
      </div>
    </div>
  </div>

  <div class="stat-row">
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="completed">Completed Today</div><div class="stat-val" id="kpi-completed" style="color:var(--gr)">\u2014</div><div class="stat-sub">steps completed</div></div>
    <div class="stat-card" title="Distinct abayas that touched the line in this window. Different from 'Completed Today' which counts every finished session: one abaya that went through Tailor (01) + Button + Hand Work + Tailor (02) = 1 abaya here, 4 in Completed Today."><div class="stat-lbl" data-kpi-label="abayas-delivered">Abayas Delivered</div><div class="stat-val" id="kpi-abayas-delivered" style="color:var(--pu)">\u2014</div><div class="stat-sub">distinct garments</div></div>
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="active">Active Workers</div><div class="stat-val" id="kpi-active" style="color:var(--bl)">\u2014</div><div class="stat-sub">on floor now</div></div>
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="avg" title="Median of all finished sessions today. Closer to a real per-step cycle time than the mean, which is inflated by forgotten-Finish sessions (workers who tap Start and walk away).">Avg Session Time</div><div class="stat-val" id="kpi-avg" style="color:var(--am)">\u2014</div><div class="stat-sub">median per finished step today</div></div>
    <div class="stat-card"><div class="stat-lbl" data-kpi-label="eff">Efficiency Score</div><div class="stat-val" id="kpi-eff">\u2014</div><div class="stat-sub">vs 45-min target</div></div>
  </div>

  <div class="dash-row">
    <div class="dash-card">
      <div class="dash-card-title">&#9201; Live Active Sessions</div>
      <div id="live-sessions"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No active sessions</div></div>
    </div>
    <div class="dash-card">
      <div class="dash-card-title" data-kpi-label="procsplit">Process Split Today</div>
      <div id="proc-split"><div style="color:var(--tx3);font-size:12px;padding:10px">No data</div></div>
    </div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="dash-card-title" style="margin:0" data-kpi-label="empperf">Employee Performance \u2014 Today</div>
      <div style="font-size:10px;color:var(--tx3)">&#11088; top 20%</div>
    </div>
    <div id="emp-perf"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No sessions yet today</div></div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div class="dash-card-title">Invoice maker \u2014 numbers logged</div>
    <div style="font-size:11px;color:var(--tx2);margin-bottom:10px">From last 100 completed sessions synced to D1</div>
    <div id="recent-invoice-logs"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">Loading...</div></div>
  </div>

  <div class="dash-card" style="margin-bottom:14px">
    <div class="dash-card-title">Total time by abaya item code</div>
    <div style="font-size:10px;color:var(--tx2);margin-bottom:8px;line-height:1.35">Factory day: every finished step in D1 for that item, plus live time on the floor (same item).</div>
    <div id="abaya-totals-table"><div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">Loading\u2026</div></div>
  </div>

  <div class="dash-card">
    <div class="dash-card-title">Hourly output (9\u201323, factory shift window)</div>
    <div style="font-size:10px;color:var(--tx2);line-height:1.35;margin-bottom:8px">Sat\u2013Thu: 9:00\u201313:30, 15:00\u201320:00, 20:40\u201323:30. Fri: 15:00\u201320:00, 20:40\u201323:30.</div>
    <div id="hourly" style="display:flex;align-items:flex-end;gap:2px;height:72px;margin-top:2px"></div>
    <div id="hlbl" style="display:flex;gap:3px;margin-top:4px"></div>
  </div>
</div>

<!-- REPORT MODAL -->
<div class="modal-overlay" id="modal">
  <div class="modal-box">
    <div id="month-nav-host" style="display:none"></div>
    <div style="font-size:19px;font-weight:700;margin-bottom:4px" id="modal-title">Report</div>
    <div style="font-size:12px;color:var(--tx2);margin-bottom:16px" id="modal-ts"></div>
    <div id="modal-body"></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn-export" onclick="exportWA()">&#128241; Send via WhatsApp</button>
      <button class="btn-close" onclick="closeModal()">Close</button>
    </div>
  </div>
</div>

<!-- SINGULAR EMPLOYEE DAY MODAL (coherent with Check Delivery Report design system) -->
<div class="modal-overlay" id="modal-ed" role="dialog" aria-modal="true" aria-labelledby="ed-title">
  <div class="modal-box" style="max-width:780px">
    <div class="modal-title" id="ed-title">Employee day</div>
    <div class="modal-sub" id="ed-sub">What this person did on the picked date, in order.</div>
    <div id="ed-body" class="cr-wrap"></div>
    <div class="modal-actions" id="ed-actions">
      <button class="btn-close" onclick="closeEmployeeDay()">Close</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return;
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (r) {
      r.unregister().catch(function () {});
    });
  }).catch(function () {});
})();
window.addEventListener('error', function (ev) {
  try {
    var syncEl = document.getElementById('sync-status');
    if (!syncEl || ev.message == null) return;
    var fn = ev.filename != null ? String(ev.filename) : '';
    if (
      fn &&
      fn.indexOf(location.origin) !== 0 &&
      fn.indexOf('blob:') !== 0
    )
      return;
    syncEl.textContent = 'Script error: ' + String(ev.message).slice(0, 160);
  } catch (_) {}
});
window.addEventListener('unhandledrejection', function (ev) {
  try {
    var syncEl = document.getElementById('sync-status');
    if (!syncEl) return;
    var r = ev.reason;
    var msg = r && r.message ? String(r.message) : String(r || 'rejected');
    syncEl.textContent = 'Async error: ' + msg.slice(0, 160);
  } catch (_) {}
});
const BASE = ${baseJs};
const WORK_TYPES_ORDER = ['Tailor (01)','Tailor (02)','Hand Work','Stone Work','Button','Embroidery','Ari Work','Hand Designing','Invoice maker','Packaging','Checker'];

// \u2500\u2500\u2500 v1.2.28 \u2014 Client-side perf helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// The dashboard's hot path is renderAll() running every 2-4.5s. Three
// well-known browser-perf traps dominated the per-render cost:
//
//   1. new Intl.DateTimeFormat() is ~50-100\xB5s PER CONSTRUCTION. The old
//      code constructed one per format call inside the active-session
//      loop, so 5 active sessions \xD7 2 calls = 10 constructions per
//      render = ~18,000 per hour. Cache by (tz, pattern-name) and
//      reuse the same instance. Drops to ~5\xB5s per call.
//
//   2. The "this build" cell used a minute-by-minute walk from
//      startedAtSec to serverNowSec to count in-shift seconds. A 24h
//      forgotten-Finish session = 1,440 iterations. The server already
//      has overlapSecWithWindows (sweep-line with 60s/600s/3600s step
//      adaptively); the port below reuses the same algorithm and the
//      same inWin memo to keep cross-day windows consistent.
//
//   3. abayaIsCustom() ran an O(n) catalog scan per active session per
//      render. Build a Set<id> once per STATE arrival and look up O(1).
//
// All three are gated behind a no-op fallback (the function still
// exists if the cache is empty), so a regression in any of them
// doesn't break the dashboard \u2014 it just goes back to the slow path.

(function installClientPerfHelpers() {
  // ---- Intl.DateTimeFormat cache, keyed by (tz, pattern-name) ----
  const _intlCache = new Map();
  function intlFmt(tz, name) {
    const key = tz + '||' + name;
    let fmt = _intlCache.get(key);
    if (fmt) return fmt;
    let opts;
    if (name === 'started-short') {
      opts = { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    } else if (name === 'started-full') {
      opts = { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    } else if (name === 'ui-now') {
      opts = { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    } else if (name === 'time-hm') {
      opts = { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false };
    } else if (name === 'time-hm-am') {
      opts = { timeZone: tz, hour: 'numeric', minute: '2-digit' };
    } else if (name === 'ymd-hms') {
      opts = { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    } else if (name === 'ymd') {
      opts = { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit' };
    } else if (name === 'weekday-long') {
      opts = { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    } else if (name === 'month-year') {
      opts = { timeZone: tz, year: 'numeric', month: 'long' };
    } else if (name === 'weekday-short') {
      opts = { timeZone: tz, weekday: 'short' };
    } else if (name === 'minute-of-day') {
      opts = { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    } else {
      // Unknown pattern name \u2014 fall back to a generic 'short' format
      // so we still return a working formatter instead of throwing.
      opts = { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit' };
    }
    fmt = new Intl.DateTimeFormat('en-US', opts);
    _intlCache.set(key, fmt);
    return fmt;
  }

  // ---- Cached minute-of-day + weekday-key (port of working-hours.js,
  //      but using the cached Intl instances so the lookup is ~10x
  //      cheaper than the old new-DateTimeFormat-per-call form). ----
  function minuteOfDayClientCached(epochSec, tz) {
    const parts = intlFmt(tz, 'minute-of-day').formatToParts(new Date(epochSec * 1000));
    const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
    const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
    return hh * 60 + mm;
  }
  function weekdayKeyClientCached(epochSec, tz) {
    const wd = intlFmt(tz, 'weekday-short').format(new Date(epochSec * 1000)).toLowerCase().slice(0, 3);
    return wd;
  }

  // ---- windowsForDay \u2014 port of working-hours.js#windowsForDay,
  //      client-side (returns [start_min, end_min][] for the day). ----
  function windowsForDayClient(cfg, weekdayKey) {
    const arr = cfg && cfg.days && Array.isArray(cfg.days[weekdayKey]) ? cfg.days[weekdayKey] : [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const w = arr[i] || [];
      const s = parseHHMMClient(w[0]);
      const e = parseHHMMClient(w[1]);
      if (s == null || e == null || e <= s) continue;
      out.push([s, e]);
    }
    return out;
  }

  // ---- Sweep-line overlap with the union of shift windows.
  //      Mirrors overlapSecWithWindows in working-hours.js with the
  //      same 60s/600s/3600s step heuristic and the same inWin memo
  //      so cross-day windows stay correct. The HARD_CAP at 48h is
  //      identical \u2014 a forgotten-Finish session that crossed midnight
  //      and is still on the floor never gets an infinite walk. ----
  function overlapSecWithWindowsClient(startSec, endSec, cfg) {
    const st0 = Math.floor(Number(startSec) || 0);
    const en0 = Math.floor(Number(endSec) || 0);
    if (en0 <= st0) return 0;
    const HARD_CAP_SEC = 48 * 3600;
    const st = en0 - st0 > HARD_CAP_SEC ? en0 - HARD_CAP_SEC : st0;
    const en = en0;
    const span = en - st;
    const stepSec = span <= 2 * 3600 ? 60 : (span <= 24 * 3600 ? 600 : 3600);
    const tz = (cfg && cfg.timezone) || 'Asia/Dubai';
    const inWinMemo = new Map();
    function inWin(t) {
      if (inWinMemo.has(t)) return inWinMemo.get(t);
      const k = weekdayKeyClientCached(t, tz);
      const minute = minuteOfDayClientCached(t, tz);
      const windows = windowsForDayClient(cfg, k);
      const ok = windows.some(function (w) { return minute >= w[0] && minute < w[1]; });
      if (inWinMemo.size > 5000) inWinMemo.clear();
      inWinMemo.set(t, ok);
      return ok;
    }
    let total = 0;
    for (let t = st; t < en; t += stepSec) {
      const t2 = Math.min(en, t + stepSec);
      if (inWin(t)) total += t2 - t;
    }
    return total;
  }

  // ---- Cheap stable hash of STATE. Used to skip renderAll() when the
  //      worker hasn't reported anything new since the last paint. The
  //      /api/state response has a 5s server cache, and the browser
  //      polls every 2-4.5s, so most polls in steady state return an
  //      identical payload \u2014 skipping the 6 innerHTML rebuilds on
  //      those polls is a ~80% reduction in renderAll() invocations. ----
  function stateHash(s) {
    if (!s) return '0';
    // Concatenate a few fields that change on user-visible events. The
    // hour buckets and per-process counts are server-cached too, so a
    // hash match means "nothing the operator can see has changed".
    const a = (s.active ? Object.keys(s.active).sort().join('|') : '') + '|';
    const c = String(s.completed_today || 0) + '|';
    const p = s.perf ? s.perf.length + ':' + s.perf.reduce(function (acc, r) { return acc + (r.units || 0); }, 0) : '0|';
    const g = s.garment_totals_today ? s.garment_totals_today.length : 0;
    return a + c + p + g + '|' + String(s.ts || 0);
  }
  function hashInnerHtml(s) {
    // Hash of just the proc-split + emp-perf relevant fields. Used
    // for innerHTML memoization of those two safeRender blocks.
    // v1.2.28: split into two independent hashes so a change in one
    // block doesn't invalidate the other. (Old code combined them,
    // which meant a Finish event in any process invalidated both
    // innerHTML writes even when only one needed re-rendering.)
    const split = s.process_split_today || {};
    let splitH = '';
    for (let i = 0; i < WORK_TYPES_ORDER.length; i++) {
      splitH += (split[WORK_TYPES_ORDER[i]] || 0) + ',';
    }
    const p = s.perf || [];
    let empH = '';
    for (let i = 0; i < p.length; i++) empH += (p[i].units || 0) + ':' + (p[i].eff || 0) + ',';
    return splitH + '|' + empH;
  }
  // v1.2.28: per-block hash memoization. Independent of each other so
  // a process-split change doesn't force a redundant emp-perf write
  // and vice versa. (The shared hashInnerHtml above is kept for
  // backward-compat with anything that calls it; the memoization
  // gates use the two functions below.)
  function procSplitHashInline(s) {
    const split = s.process_split_today || {};
    let h = '';
    for (let i = 0; i < WORK_TYPES_ORDER.length; i++) {
      h += (split[WORK_TYPES_ORDER[i]] || 0) + ',';
    }
    return h;
  }
  function empPerfHashInline(s) {
    const p = s.perf || [];
    let h = '';
    for (let i = 0; i < p.length; i++) h += (p[i].units || 0) + ':' + (p[i].eff || 0) + ',';
    return h;
  }
  function hourlyHash(s) {
    const h = s.hourly_today || {};
    let out = '';
    const keys = Object.keys(h);
    for (let i = 0; i < keys.length; i++) out += keys[i] + ':' + h[keys[i]] + ',';
    return out;
  }
  function invoiceLogsHash(s) {
    const logs = s.logs || [];
    let n = 0;
    for (let i = 0; i < logs.length; i++) {
      if ((logs[i].emp_process || '') === 'Invoice maker' && logs[i].invoice_serial) n++;
    }
    return n + '|' + (logs[0] ? logs[0].ended_at || '' : '');
  }
  function abayaTotalsHash(s) {
    const rows = s.garment_totals_today || [];
    let out = rows.length + '|';
    for (let i = 0; i < rows.length; i++) {
      out += (rows[i].abaya_id || '') + ':' + (rows[i].segments || 0) + ':' + (rows[i].completed_sec || 0) + ',';
    }
    return out;
  }

  // ---- State + memoization slots ----
  // _lastStateHash skips the whole renderAll() when /api/state returned
  // an identical body (the 5s server cache + 2s polling cadence means
  // ~80% of polls in steady state are no-ops).
  // _abayaIsCustomSet is rebuilt on every STATE arrival so lookups
  // for the is_custom flag are O(1) instead of O(catalog).
  let _lastStateHash = null;
  let _abayaIsCustomSet = new Set();
  // Per-block memoization. Set to a hash string after a render; if the
  // hash matches on the next render, the innerHTML write is skipped.
  // Saves 4 of the 6 innerHTML writes per render in steady state.
  let _lastProcSplitHash = null;
  let _lastEmpPerfHash = null;
  let _lastHourlyHash = null;
  let _lastInvoiceLogsHash = null;
  let _lastAbayaTotalsHash = null;

  // ---- Public API exposed to the rest of the inline script ----
  window.__ceoPerf = {
    intlFmt: intlFmt,
    overlapSecWithWindowsClient: overlapSecWithWindowsClient,
    minuteOfDayClientCached: minuteOfDayClientCached,
    weekdayKeyClientCached: weekdayKeyClientCached,
    stateHash: stateHash,
    hashInnerHtml: hashInnerHtml,
    hourlyHash: hourlyHash,
    invoiceLogsHash: invoiceLogsHash,
    abayaTotalsHash: abayaTotalsHash,
    isAbayaCustomFast: function (abayaId) {
      return _abayaIsCustomSet.has(String(abayaId == null ? '' : abayaId));
    },
    rebuildAbayaIsCustomSet: function (s) {
      _abayaIsCustomSet = new Set();
      const m = (s && s.abaya_builds) || {};
      const keys = Object.keys(m);
      for (let i = 0; i < keys.length; i++) {
        if (m[keys[i]] && m[keys[i]].is_custom) _abayaIsCustomSet.add(String(keys[i]));
      }
      return _abayaIsCustomSet.size;
    },
    shouldSkipRender: function (s) {
      const h = stateHash(s);
      if (h === _lastStateHash) return true;
      _lastStateHash = h;
      return false;
    },
    procSplitChanged: function (s) {
      // v1.2.28: independent hash. A split change no longer forces
      // a redundant emp-perf write (and vice versa).
      const h = procSplitHashInline(s);
      if (h === _lastProcSplitHash) return false;
      _lastProcSplitHash = h;
      return true;
    },
    empPerfChanged: function (s) {
      const h = empPerfHashInline(s);
      if (h === _lastEmpPerfHash) return false;
      _lastEmpPerfHash = h;
      return true;
    },
    hourlyChanged: function (s) {
      const h = hourlyHash(s);
      if (h === _lastHourlyHash) return false;
      _lastHourlyHash = h;
      return true;
    },
    invoiceLogsChanged: function (s) {
      const h = invoiceLogsHash(s);
      if (h === _lastInvoiceLogsHash) return false;
      _lastInvoiceLogsHash = h;
      return true;
    },
    abayaTotalsChanged: function (s) {
      const h = abayaTotalsHash(s);
      if (h === _lastAbayaTotalsHash) return false;
      _lastAbayaTotalsHash = h;
      return true;
    },
    resetMemoForTest: function () {
      _lastStateHash = null;
      _lastProcSplitHash = null;
      _lastEmpPerfHash = null;
      _lastHourlyHash = null;
      _lastInvoiceLogsHash = null;
      _lastAbayaTotalsHash = null;
    },
  };
})();

(function bootReleaseMomentCEO() {
  var NS = 'abaya_release_dismiss_';
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }
  function motionClass() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return '';
    } catch (_) {}
    return ' abaya-release-moment--motion';
  }
  fetch(BASE + '/api/release-moment', { credentials: 'same-origin' })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (!d || !d.enabled || !d.momentId) return;
      try {
        if (localStorage.getItem(NS + d.momentId)) return;
      } catch (_) {}
      var m = document.getElementById('releaseMomentMount');
      if (!m) return;
      var cta = d.ctaPath || '/ceo';
      var cta2 = d.secondaryCtaPath || '';
      var lab = d.ctaLabel || 'Explore';
      var lab2 = d.secondaryCtaLabel || '';
      var card = document.createElement('div');
      card.className = 'abaya-release-moment';
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', 'Product update');
      card.innerHTML =
        '<div class="abaya-release-moment__glow' +
        motionClass() +
        '"></div><div class="abaya-release-moment__inner"><div class="abaya-release-moment__copy">' +
        '<div class="abaya-release-moment__eyebrow">' +
        esc(d.eyebrow || 'Update') +
        '</div><h2 class="abaya-release-moment__hook">' +
        esc(d.hook || '') +
        '</h2><p class="abaya-release-moment__outcome">' +
        esc(d.outcome || '') +
        '</p></div><div class="abaya-release-moment__actions">' +
        '<a class="abaya-release-moment__btn abaya-release-moment__btn--primary" href="' +
        esc(cta) +
        '">' +
        esc(lab) +
        '</a>' +
        (cta2 && lab2
          ? '<a class="abaya-release-moment__btn abaya-release-moment__btn--ghost" href="' +
            esc(cta2) +
            '">' +
            esc(lab2) +
            '</a>'
          : '') +
        '<button type="button" class="abaya-release-moment__dismiss" aria-label="Dismiss update message">Not now</button></div></div>';
      m.appendChild(card);
      var btn = card.querySelector('.abaya-release-moment__dismiss');
      if (btn) {
        btn.addEventListener('click', function () {
          try {
            localStorage.setItem(NS + d.momentId, '1');
          } catch (_) {}
          card.remove();
        });
      }
    })
    .catch(function () {});
})();
function procColorUI(p) {
  const c = {
    'Tailor (01)':'var(--bl)','Tailor (02)':'#8b5cf6','Hand Work':'var(--gr)','Stone Work':'var(--am)',
    'Button':'#fa7faa','Embroidery':'var(--pu)','Ari Work':'#14b8a6','Hand Designing':'#ffb287',
    'Invoice maker':'#c2ef4e','Packaging':'#79628c','Checker':'#6a5fc1'
  };
  return c[p] || 'var(--tx2)';
}
function byId(primary, fallback) {
  return document.getElementById(primary) || (fallback ? document.getElementById(fallback) : null);
}
let STATE = {
  active:{}, logs:[], perf:[], daily:[],
  factory_today:'', completed_today:0, avg_cycle_sec_today:0, median_session_sec_today:0, efficiency_today:0,
  process_split_today:{},
  hourly_today:{},
  garment_totals_today:[],
  abaya_lifetime:{},
  abaya_builds:{},
  working_hours:null,
  working_status:''
};
let ABAYAS = [];
let activeReportType = 'daily';
let lastReportData = null;
let lastModalAnalytics = null;
let lastModalTrace = null;
let pollStartedAt = 0;
let pollFinishedAt = 0;
let pollInFlight = false;
let sessionExpired = false;
let lastSessionToastAt = 0;
let activeTimingCache = {
  cacheKey: '',
  byEmpId: {},
  byGarmentId: {},
};
// Per-session in-shift base seconds for the "this build" cell, snapshotted
// at STATE arrival. Recomputed only when STATE changes (a new session_start
// arrived or a session_finish removed a row) \u2014 never per second. The 1Hz
// tick reads this cache and adds \`elapsedSinceStateSec\` if currently in
// shift, so the displayed counter ticks every second instead of every
// minute. Mirrors the activeTimingCache.byEmpId pattern that drives the
// "active today" cell, but the base here is a per-session in-shift walk
// (startedAt \u2192 STATE.ts) instead of the cloud-pushed windowed_elapsed_sec
// \u2014 because the "this build" cell counts the worker's time on THIS abaya
// across the whole session, not just the snapshot's cap-aware in-shift
// seconds (which is per-employee and may have been clamped for cross-day).
let thisBuildBaseCache = {
  cacheKey: '',
  byEmpId: {},
};

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController === 'undefined') return undefined;
  const ctrl = new AbortController();
  setTimeout(function () {
    try {
      ctrl.abort();
    } catch (_) {}
  }, ms);
  return ctrl.signal;
}

async function fetchWithRetry(url, init, maxRetries) {
  // Cloudflare's Git integration briefly returns 503 to in-flight requests
  // during a Worker version swap (typical 5-10s, occasionally up to ~30s).
  // The previous default of 3 retries with 1+2s backoff only covered ~3s
  // of that window -- any deploy longer than that surfaced 503s in the
  // dashboard's network panel. Bump to 5 retries with 1+2+4+8s backoff
  // (15s total retry budget) so a typical Cloudflare deploy is invisible
  // to the polling client.
  maxRetries = maxRetries == null ? 5 : maxRetries;
  init = init || {};
  var lastErr;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var opts = { credentials: 'same-origin' };
      for (var k in init) {
        if (Object.prototype.hasOwnProperty.call(init, k) && k !== 'signal') opts[k] = init[k];
      }
      opts.signal = timeoutSignal(15000);
      var res = await fetch(url, opts);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxRetries - 1) return res;
        await new Promise(function (r) { setTimeout(r, 1000 * Math.pow(2, attempt)); });
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries - 1) throw err;
      await new Promise(function (r) { setTimeout(r, 1000 * Math.pow(2, attempt)); });
    }
  }
  throw lastErr || new Error('fetchWithRetry failed');
}

// \u2500\u2500\u2500 POLLING \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function poll(skipRefreshRetry) {
  if (pollInFlight) return;
  // v1.2.28: when the tab is hidden, skip the network round-trip
  // entirely. The browser's Page Visibility API guarantees we'll be
  // called again with document.visibilityState === 'visible' the
  // moment the user comes back. Saves bandwidth + Worker CPU on
  // background tabs without changing the foreground behavior.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    // Schedule the next attempt so we resume on visibilitychange. The
    // standard backoff still applies when the tab is foregrounded.
    setTimeout(schedulePollLoop, 2000);
    return;
  }
  const syncEl = document.getElementById('sync-status');
  pollStartedAt = Date.now();
  pollInFlight = true;
  try {
    // When the CEO picks a date or a month in the Executive Reports
    // filters, the entire dashboard flips to that range \u2014 Completed,
    // Active Workers, Process Split, Employee Performance, Garment
    // Totals, Recent Invoice Logs. Without this, those cards kept
    // showing today even when the user had clearly asked for a past
    // period. Day picker wins over month picker (more specific).
    const rangeQs = getPickedRangeQs();
    // v1.2.30: when STATE has at least one active session, append
    // live=1 so the Worker bypasses the 5s in-memory response cache
    // and serves fresh D1 data on every poll. Without this, the 1Hz
    // poll cadence (see nextPollDelayMs) would mostly hit the cached
    // 5s snapshot and a fresh Start/Finish would not appear on the
    // live board for up to 5s. When there are no active sessions the
    // dashboard falls back to the 4.5s cadence and does not send
    // live=1, so the cache is free to serve the same payload for the
    // entire idle window and the D1 row_read budget stays healthy.
    const liveActive = Object.keys((STATE && STATE.active) || {}).length > 0;
    const liveQs = liveActive ? '&live=1' : '';
    const url =
      BASE + '/api/state?ts=' + Date.now() + '&r=' + Math.random().toString(36).slice(2, 10) + liveQs + rangeQs;
    const r = await fetchWithRetry(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    try { console.log('[ceo-poll] status=' + r.status + ' url=' + url); } catch (_) {}
    if (r.status === 200) {
      let d = await r.json();
      if (d && d.ok === true && d.state && typeof d.state === 'object') {
        // Compatibility path with public/dashboard.js envelope.
        d = d.state;
      }
      if (!d || d.ok !== true) {
        if (syncEl) {
          syncEl.textContent = d && d.error ? String(d.error) : 'Bad state payload';
        }
        return;
      }
      sessionExpired = false;
      // Pulse the .dash opacity so the innerHTML swap in renderAll()
      // doesn't look like the previous data vanished. See the .is-syncing
      // CSS rule for the transition. Two rAFs: the first lets the browser
      // paint the dimmed state, the second lets it paint the new content
      // before restoring opacity.
      var dashEl = document.querySelector('.dash');
      if (dashEl) dashEl.classList.add('is-syncing');
      await new Promise(function (r) { requestAnimationFrame(r); });
      STATE = d;
      // v1.2.28: rebuild the O(1) is_custom Set from the new STATE.
      // Old code did an O(n) catalog scan per active session per
      // render in buildLiveSessionsHtml (n = catalog size, which is
      // ~5,000 items). Doing it once here instead saves ~25,000
      // array lookups per render.
      if (window.__ceoPerf) window.__ceoPerf.rebuildAbayaIsCustomSet(d);
      var renderOk = false;
      try {
        renderAll();
        renderOk = true;
      } catch (renderErr) {
        console.error('[ceo-dashboard] renderAll failed:', renderErr);
        if (syncEl) {
          var hint =
            renderErr && renderErr.message ? String(renderErr.message).slice(0, 100) : '';
          syncEl.textContent =
            'API OK \u2014 UI error ' +
            new Date().toLocaleTimeString([], { timeZone: uiTz() }) +
            (hint ? ' \u2014 ' + hint : '') +
            ' (console)';
        }
      }
      if (dashEl) {
        await new Promise(function (r) { requestAnimationFrame(r); });
        dashEl.classList.remove('is-syncing');
      }
      if (syncEl && renderOk) {
        const lagMs = Number(d.ingest_lag_ms || 0);
        // Format lag as a human phrase so "4h of no events" doesn't look like
        // a system failure \u2014 it usually means the factory is between shifts.
        const lagMode = (d.state_meta && d.state_meta.lag_mode) || 'unknown';
        const lagLabel = {
          hot: 'live',
          warm: 'paused',
          idle: 'idle',
          stale: 'stale',
          'no-data': 'no data',
        }[lagMode] || 'live';
        let lagText = ' \xB7 ' + lagLabel;
        if (lagMode === 'hot' && Number.isFinite(lagMs)) {
          lagText = ' \xB7 ' + Math.round(lagMs / 1000) + 's';
        } else if (Number.isFinite(lagMs)) {
          // Idle/stale: show only the friendly word, not a giant seconds number.
          lagText = ' \xB7 ' + lagLabel;
        }
        syncEl.textContent =
          'Updated ' +
          new Date().toLocaleTimeString([], { timeZone: uiTz() }) +
          (d.ts ? ' \xB7 seq ' + String(d.ts).slice(-8) : '') +
          lagText;
      }
    } else if (r.status === 429) {
      if (syncEl) syncEl.textContent = 'Rate limited \u2014 wait a moment';
    } else if (r.status === 401) {
      if (!skipRefreshRetry) {
        try {
          const ref = await fetch(BASE + '/api/ceo/session/refresh', {
            method: 'POST',
            credentials: 'same-origin',
          });
          if (ref.ok) {
            sessionExpired = false;
            pollInFlight = false;
            return poll(true);
          }
        } catch (_) {}
      }
      sessionExpired = true;
      let msg = 'Session drift detected. Re-enter CEO access to resume live feed.';
      try {
        const x = await r.json();
        if (x && x.error) msg = String(x.error) + ' Re-enter CEO access to resume live feed.';
      } catch (_) {}
      if (syncEl) syncEl.textContent = msg;
      if (Date.now() - lastSessionToastAt > 15000) {
        showToast('Session expired. Live sync paused until sign-in.', 'error');
        lastSessionToastAt = Date.now();
      }
    } else {
      if (syncEl)
        syncEl.textContent =
          'HTTP ' + r.status + (r.status === 401 ? ' (session/cookie?)' : '');
    }
  } catch (e) {
    try { console.error('[ceo-poll] threw:', e); } catch (_) {}
    if (syncEl) {
      var emsg = e && e.message ? String(e.message).slice(0, 80) : '';
      syncEl.textContent = 'Offline \u2014 retrying...' + (emsg ? ' (' + emsg + ')' : '');
    }
  } finally {
    pollFinishedAt = Date.now();
    pollInFlight = false;
  }
}

function nextPollDelayMs() {
  if (sessionExpired) return 8000;
  const activeCount = Object.keys((STATE && STATE.active) || {}).length;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 7000;
  // v1.2.30: 1s cadence when active > 0 so the live board reflects
  // Start/Finish events within ~1s end-to-end. The 2s the previous
  // version used meant an operator staring at the live board during a
  // busy shift could see a 2s lag between when a worker tapped Finish
  // and when the row disappeared. Idle cadence stays at 4.5s (was the
  // same) so the no-active baseline doesn't burn D1 row_reads.
  return activeCount > 0 ? 1000 : 4500;
}

function schedulePollLoop() {
  poll()
    .catch(function () {})
    .finally(function () {
      setTimeout(schedulePollLoop, nextPollDelayMs());
    });
}

function fmtHMS(sec) {
  const n = Math.floor(Number(sec) || 0);
  if (n < 1) return '0s';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

// Compact "12h 4m" / "1h 22m" / "45m" / "12s" for tight cells. Drops
// the seconds component when the hours or minutes are already shown.
function fmtShortHMS(sec) {
  const n = Math.floor(Number(sec) || 0);
  if (n < 1) return '0m';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h > 0 && m > 0) return h + 'h ' + m + 'm';
  if (h > 0) return h + 'h';
  if (m > 0) return m + 'm';
  return n + 's';
}

function uiTz() {
  const wh = STATE && STATE.working_hours;
  return wh && wh.timezone ? String(wh.timezone) : 'Asia/Dubai';
}

function uiNowString() {
  return new Date().toLocaleString([], {
    timeZone: uiTz(),
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function localYmdNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function windowLabelFromRange(startDate, endDate) {
  if (!startDate && !endDate) return '';
  if (startDate && endDate && startDate === endDate) return String(startDate);
  return String(startDate || '') + ' to ' + String(endDate || '');
}

function parseHHMMClient(s) {
  // No regex literal \u2014 wrangler's minifier strips backslashes from
  // /d/ \u2192 /d/ which throws SyntaxError on every page load. Do the
  // HH:MM check with raw string ops instead.
  const t = String(s == null ? '' : s).trim();
  if (t.length !== 5 || t.charAt(2) !== ':') return null;
  const h0 = t.charAt(0);
  const h1 = t.charAt(1);
  const m0 = t.charAt(3);
  const m1 = t.charAt(4);
  if (h0 < '0' || h0 > '9' || h1 < '0' || h1 > '9') return null;
  if (m0 < '0' || m0 > '5' || m1 < '0' || m1 > '9') return null;
  let h = (h0.charCodeAt(0) - 48) * 10 + (h1.charCodeAt(0) - 48);
  let mm = (m0.charCodeAt(0) - 48) * 10 + (m1.charCodeAt(0) - 48);
  // Hour must be 0\u201323. 0[0-9], 1[0-9], 2[0-3] are valid; 2[4-9] is not.
  if (h0 === '2' && h1 > '3') return null;
  if (h > 23) return null;
  if (mm > 59) return null;
  return h * 60 + mm;
}

function minuteOfDayClient(epochSec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: uiTz(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSec * 1000));
  const hh = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
  const mm = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
  return hh * 60 + mm;
}

function weekdayKeyClient(epochSec) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: uiTz(), weekday: 'short' })
    .format(new Date(epochSec * 1000))
    .toLowerCase()
    .slice(0, 3);
  return wd;
}

function inWindowClient(epochSec) {
  const wh = STATE && STATE.working_hours;
  if (!wh || !wh.days) return true;
  const day = weekdayKeyClient(epochSec);
  const windows = Array.isArray(wh.days[day]) ? wh.days[day] : [];
  const minute = minuteOfDayClient(epochSec);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] || [];
    const s = parseHHMMClient(w[0]);
    const e = parseHHMMClient(w[1]);
    if (s == null || e == null) continue;
    if (minute >= s && minute < e) return true;
  }
  return false;
}

function computeActiveTimingCache() {
  const nowMs = Date.now();
  const active = STATE && STATE.active ? STATE.active : {};
  const activeIds = Object.keys(active).sort();
  const stateTs = Number(STATE && STATE.ts) || 0;
  const elapsedSinceStateSec = stateTs > 0 ? Math.max(0, Math.min(30, Math.floor((nowMs - stateTs) / 1000))) : 0;
  const key = String(activeIds.join('|')) + '::' + String(stateTs) + '::' + String(Math.floor(nowMs / 1000));
  if (activeTimingCache.cacheKey === key) return activeTimingCache;

  const byEmpId = {};
  const byGarmentId = {};
  const inShiftNow = inWindowClient(Math.floor(nowMs / 1000));
  activeIds.forEach(function (id) {
    const s = active[id] || {};
    const base = Math.max(0, Math.floor(Number(s.windowed_elapsed_sec) || 0));
    const live = !s.outside_shift && inShiftNow ? elapsedSinceStateSec : 0;
    const total = base + live;
    byEmpId[id] = total;
    const gid = String(s.abaya_id == null ? '' : s.abaya_id);
    if (gid) byGarmentId[gid] = (byGarmentId[gid] || 0) + total;
  });

  activeTimingCache = { cacheKey: key, byEmpId, byGarmentId };
  return activeTimingCache;
}

// Per-session "this build" base = in-shift seconds from session start to
// STATE snapshot. Recomputed only when STATE arrives (a new session_start
// landed, a session_finish removed a row, or a Start was pushed late and
// the snapshot age changed). The 1Hz tick adds \`elapsedSinceStateSec\` if
// currently in shift, so the displayed counter ticks every second.
//
// Why a per-session walk instead of the existing abaya_builds
// .total_in_window_sec? The "this build" cell counts the worker's time
// on this abaya for THIS current session \u2014 not the sum across all
// finished sessions on this abaya_id. The build total still lives on the
// Daily/Weekly/Monthly/Yearly reports and the per-abaya totals panel.
function computeThisBuildBaseCache() {
  const active = STATE && STATE.active ? STATE.active : {};
  const activeIds = Object.keys(active).sort();
  const stateTs = Number(STATE && STATE.ts) || 0;
  const wh = STATE && STATE.working_hours;
  const key = String(activeIds.join('|')) + '::' + String(stateTs) + '::' + String(wh ? 'wh' : 'noh');
  if (thisBuildBaseCache.cacheKey === key) return thisBuildBaseCache;
  const byEmpId = {};
  activeIds.forEach(function (id) {
    const s = active[id] || {};
    const startedSec = Math.floor(Number(s.started_at) / 1000);
    if (!Number.isFinite(startedSec) || startedSec <= 0) {
      byEmpId[id] = 0;
      return;
    }
    if (!wh) {
      // No working_hours in STATE yet (very first paint, or the
      // worker hasn't pushed any sessions). Use raw wall-clock as a
      // safe lower bound \u2014 the operator can still see something
      // ticking while the live config hydrates.
      const serverNowSec = Math.floor((stateTs > 0 ? stateTs : Date.now()) / 1000);
      byEmpId[id] = Math.max(0, serverNowSec - startedSec);
      return;
    }
    const serverNowSec = Math.floor((stateTs > 0 ? stateTs : Date.now()) / 1000);
    const base = window.__ceoPerf && typeof window.__ceoPerf.overlapSecWithWindowsClient === 'function'
      ? window.__ceoPerf.overlapSecWithWindowsClient(startedSec, serverNowSec, wh)
      : 0;
    byEmpId[id] = Math.max(0, Math.floor(Number(base) || 0));
  });
  thisBuildBaseCache = { cacheKey: key, byEmpId: byEmpId };
  return thisBuildBaseCache;
}

// Resolved "this build" seconds for a given emp_id: the per-session
// base at snapshot + the live contribution if currently in shift.
// Capped at +30s so a stale tab (no poll in >30s) doesn't accumulate
// wild drift. Mirrors the "active today" formula so the two ticking
// cells share the same freshness rule.
function thisBuildSecondsFor(empId) {
  const id = String(empId == null ? '' : empId);
  if (!id) return 0;
  const cache = computeThisBuildBaseCache();
  const base = Math.floor(Number(cache.byEmpId[id]) || 0);
  const nowMs = Date.now();
  const stateTs = Number(STATE && STATE.ts) || 0;
  const elapsedSinceStateSec = stateTs > 0 ? Math.max(0, Math.min(30, Math.floor((nowMs - stateTs) / 1000))) : 0;
  const inShiftNow = inWindowClient(Math.floor(nowMs / 1000));
  const live = inShiftNow ? elapsedSinceStateSec : 0;
  return Math.max(0, base + live);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline-JS literal escaper for HTML attributes like
//   onclick="openEmployeeDayForDate('e16', '2026-07-18')"
// Wraps the value in single quotes and escapes the single quote.
// The values we pass (emp_id, day_date) never contain backslashes
// in practice, so we don't need to escape that one \u2014 which avoids
// the regex-literal-vs-template-literal escape fight (this is the
// same gotcha that bit the WhatsApp newline fix in v1.2.8).
function escJs(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "\\'") + "'";
}

function escWA(s) {
  return String(s == null ? '' : s)
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/([*_~\`])/g, '\\\\$1');
}

function logDurationSec(l) {
  const n = Number(l && l.duration_sec);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function garmentCompletedFromState(abayaId) {
  const arr = STATE.garment_totals_today || [];
  const sid = String(abayaId || '');
  for (let i = 0; i < arr.length; i++) {
    if (String(arr[i].abaya_id) === sid) {
      return Math.floor(Number(arr[i].completed_sec) || 0);
    }
  }
  return 0;
}

function activeSecondsOnGarment(abayaId) {
  const sid = String(abayaId || '');
  const cache = computeActiveTimingCache();
  return Math.floor(Number(cache.byGarmentId[sid]) || 0);
}

// Per-build (current contiguous run) total for an abaya, from
// STATE.abaya_builds. The build is the most recent run of sessions on
// the same abaya_id where a 24h+ gap between consecutive sessions
// defines a build boundary. This is what the operator means by "this
// build" -- e.g. CF111 STD-O build #2 -- and is computed server-side
// from the sessions table (source of truth, no double-count bug).
// Falls back to 0 if the build map has no row for this abaya_id.
function abayaBuildSec(abayaId) {
  const sid = String(abayaId || '');
  const map = (STATE && STATE.abaya_builds) || {};
  const row = map[sid];
  if (!row) return 0;
  return Math.floor(Number(row.total_in_window_sec) || 0);
}

// Build start for an abaya, as a Unix seconds timestamp, or 0 if the
// build map has no row. Used for the "build started YYYY-MM-DD" caption
// on the Live row.
function abayaBuildStartUnix(abayaId) {
  const sid = String(abayaId || '');
  const map = (STATE && STATE.abaya_builds) || {};
  const row = map[sid];
  if (!row) return 0;
  return Math.floor(Number(row.build_start_unix) || 0);
}

// True when the abaya's catalog row is marked is_custom=1. Custom
// abayas (e.g. CF111 STD-O) can legitimately stay on the floor for
// weeks, so the live row's "this build" cell shows a "Custom" pill
// so the operator doesn't read a 373h build age as a bug.
function abayaIsCustom(abayaId) {
  const sid = String(abayaId || '');
  const map = (STATE && STATE.abaya_builds) || {};
  const row = map[sid];
  return !!(row && row.is_custom);
}

function garmentTotalLiveForId(abayaId) {
  return garmentCompletedFromState(abayaId) + activeSecondsOnGarment(abayaId);
}

function abayaBarcodeForId(abayaId) {
  const sid = String(abayaId || '');
  for (let i = 0; i < ABAYAS.length; i++) {
    if (ABAYAS[i].id === sid) return ABAYAS[i].barcode || '';
  }
  return '';
}

async function loadAbayaCatalog() {
  try {
    // The catalog is ~558 KB and changes rarely. The Worker already sends
    // Cache-Control public, max-age=10, stale-while-revalidate=120, so let the
    // browser honour it -- no-store was forcing a full re-download on every load
    // (measured 2.5-4.0s). Freshness is unchanged: edits still appear within ~10s.
    const r = await fetchWithRetry(BASE + '/api/catalog/abayas');
    const d = await r.json();
    if (d && d.ok && Array.isArray(d.abayas)) {
      ABAYAS = d.abayas.map(function (a) {
        return {
          id: String(a.id),
          code: String(a.code != null ? a.code : ''),
          barcode: String(a.barcode != null ? a.barcode : ''),
        };
      });
    }
  } catch (e) {}
}

function renderAbayaTotalsTable() {
  const el = document.getElementById('abaya-totals-table');
  if (!el) return;
  const rows = STATE.garment_totals_today || [];
  const timingCache = computeActiveTimingCache();
  if (!rows.length) {
    el.innerHTML =
      '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">No garment timing for factory day yet</div>';
    return;
  }
  const sorted = rows.slice().sort(function (a, b) {
    const ta = garmentTotalLiveForId(a.abaya_id);
    const tb = garmentTotalLiveForId(b.abaya_id);
    if (tb !== ta) return tb - ta;
    return String(a.abaya_code || a.abaya_id).localeCompare(String(b.abaya_code || b.abaya_id));
  });
  const head =
    '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.85fr) 44px 68px 68px 72px;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;text-transform:uppercase;letter-spacing:0.4px;color:var(--tx3);align-items:center">' +
    '<span>Item code</span><span>Item no.</span><span style="text-align:right">Steps</span>' +
    '<span style="text-align:right">Done</span><span style="text-align:right">Active</span><span style="text-align:right">Total</span></div>';
  let body = '';
  sorted.forEach(function (r) {
    const code = r.abaya_code || r.abaya_id || '\u2014';
    const bc = abayaBarcodeForId(r.abaya_id) || '';
    const done = Math.floor(Number(r.completed_sec) || 0);
    const act = Math.floor(Number(timingCache.byGarmentId[String(r.abaya_id || '')]) || 0);
    const tot = garmentTotalLiveForId(r.abaya_id);
    body +=
      '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.85fr) 44px 68px 68px 72px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.25);font-size:11px;align-items:center">' +
      '<span style="font-weight:600;color:var(--tx2)">' +
      esc(String(code)) +
      '</span>' +
      '<span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--am)">' +
      (bc ? esc(bc) : '<span style="color:var(--tx3)">\u2014</span>') +
      '</span>' +
      '<span style="text-align:right;color:var(--tx3)">' +
      esc(String(r.segments != null ? r.segments : 0)) +
      '</span>' +
      '<span style="text-align:right;color:var(--tx2)">' +
      fmtHMS(done) +
      '</span>' +
      '<span style="text-align:right;color:var(--tx3)">' +
      (act > 0 ? fmtHMS(act) : '\u2014') +
      '</span>' +
      '<span style="text-align:right;color:var(--gr);font-weight:700">' +
      fmtHMS(tot) +
      '</span></div>';
  });
  el.innerHTML =
    '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--bd);border-radius:10px;background:var(--s2)">' +
    head +
    body +
    '</div>';
}

function buildLiveSessionsHtml() {
  const active = STATE.active || {};
  const activeIds = Object.keys(active);
  const timingCache = computeActiveTimingCache();
  if (activeIds.length === 0) {
    return '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No active sessions right now</div>';
  }
  const tz = uiTz();
  return activeIds
    .map(function (id) {
      const s = active[id];
      const startedMs = Number(s.started_at) || Date.now();
      const elapsed = Math.floor(Number(timingCache.byEmpId[id]) || 0);
      // The aggregate per-build totals (24h-gap rule) used to be computed
      // here from abayaBuildSec() / abayaBuildStartUnix() and surfaced as
      // the "this build" cell. v1.2.19 replaced that with a per-session
      // counter (serverNowMs - startedAtSec) so the operator sees how
      // long the worker has been on this abaya RIGHT NOW, not the wall-
      // clock age of the most-recent build. The aggregate total still
      // lives on the Daily/Weekly/Monthly/Yearly reports and the per-
      // abaya totals panel \u2014 see report.js#windowedActiveTimeSec.
      // v1.2.28: O(1) Set lookup instead of an O(n) catalog scan.
      const isCustom = window.__ceoPerf.isAbayaCustomFast(s.abaya_id);

      // v1.2.28: cached Intl.DateTimeFormat (was ~50-100\xB5s per call,
      // now ~5\xB5s). Same output as the old toLocaleString form.
      const startedLabel = window.__ceoPerf.intlFmt(tz, 'started-short').format(new Date(startedMs));
      const startedFull = window.__ceoPerf.intlFmt(tz, 'started-full').format(new Date(startedMs));
      const nowSecLive = Math.floor(Date.now() / 1000);
      const inShiftNowLive = inWindowClient(nowSecLive);
      const startedAtSec = Math.floor(startedMs / 1000);
      const ageSec = Math.max(0, nowSecLive - startedAtSec);
      // is_stale requires the row to be cross-day, >2h wall-clock, AND
      // currently outside a shift window. Same-day sessions in a short
      // break (lunch, evening gap) are NOT stuck \u2014 the worker is just on
      // a break. Only forgotten-Finish rows that crossed midnight get the
      // badge. Mirrors the local rule in shared/live-row-state.cjs.
      // Prefer the s.is_stale field the cloud re-walked, fall back to
      // recompute for legacy rows.
      const isCrossDay = s.is_cross_day === true || s.is_cross_day === 1;
      const stale = (s.is_stale === true || s.is_stale === 1)
        ? true
        : (isCrossDay && ageSec > 2 * 3600 && !inShiftNowLive);
      // Only show "Outside shift" when the session is not also stuck.
      // Stuck already tells the operator the worker is outside shift AND
      // has been for >2h, so adding "Outside shift" on top is just
      // visual noise (the row used to read "Outside shift | Stuck" on
      // every forgotten-Finish session). For a fresh session that
      // happens to straddle the shift boundary, "Outside shift" alone
      // still makes sense and is shown.
      const outOfShift = !inShiftNowLive || !inWindowClient(startedAtSec);
      const outsideBadge = (outOfShift && !stale)
        ? ' <span title="Time outside shift windows is not counted in the per-shift or per-build totals." style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#fcd34d;background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);border-radius:8px;padding:1px 6px">Outside shift</span>'
        : '';
      // Stuck = session has been open >2h AND we are currently outside
      // the working window. A worker who finished their shift and
      // walked away without tapping Finish leaves the session open
      // through the entire factory-closed period. The badge is the
      // operator's cue to ping the worker (or close the session from
      // the manager UI). Kept as a label, not a number, because the
      // operator doesn't need to see the raw '47h since Start' -- they
      // just need to know it was forgotten. (ageSec and stale computed
      // above so we can suppress the redundant "Outside shift" badge.)
      const staleBadge = stale
        ? ' <span title="Session has been open more than 2 hours and the factory is currently outside the working window. Likely a forgotten-Finish -- check the station and either Finish the session or have the worker re-tap Start." style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#fca5a5;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);border-radius:8px;padding:1px 6px">Stuck</span>'
        : '';

      return (
        '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)">' +
        '<div class="emp-av" style="background:' +
        s.emp_color +
        '">' +
        esc(s.emp_initials) +
        '</div>' +
        '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:600">' +
        esc(s.emp_name) +
        outsideBadge +
        staleBadge +
        '</div>' +
        '<div style="font-size:11px;color:var(--tx3)">' +
        esc(s.emp_code) +
        ' &middot; ' +
        esc(s.emp_process) +
        ' &middot; ' +
        esc(s.abaya_code || '\u2014') +
        '</div>' +
        '<div style="margin-top:8px">' +
        '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:700">Started</div>' +
        '<div title="' +
        esc(startedFull) +
        '" style="font-size:15px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums;line-height:1.25">' +
        esc(startedLabel) +
        '</div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--tx3);margin-top:6px;line-height:1.45">' +
        'Item: <span style="color:var(--am);font-family:monospace;font-weight:600">' +
        esc(s.abaya_code || '\u2014') +
        '</span> <span style="opacity:.55">&middot;</span> Active in: <span style="color:var(--gr);font-weight:600">' +
        esc(s.emp_process || '\u2014') +
        '</span></div>' +
        '</div>' +
        '<div style="text-align:right">' +
        // "Active today" \u2014 in-shift elapsed time for THIS active session,
        // recomputed from s.windowed_elapsed_sec (the local server's
        // cap-aware in-shift seconds) + the elapsed time since the state
        // snapshot (capped at +30s by computeActiveTimingCache). The
        // s.last_finish_at_ms plumbing is still on the row, but we no
        // longer render the "last finished" cell in the live card \u2014
        // operators wanted the live ticking counter (this one) and not a
        // static timestamp. The last_finish data is still available for
        // the per-emp/per-abaya report code.
        // v1.2.32: data-tick="active-today" lets tickLiveSessions()
        // update ONLY this cell at 1Hz via targeted textContent writes,
        // mirroring public/dashboard.js#tickLiveSessions. The render
        // still emits the same value at paint time so the first frame
        // after a STATE arrival is correct.
        (function () {
          const activeTodaySec = Math.max(0, Math.floor(Number(elapsed) || 0));
          const titleText = 'In-shift elapsed time for this active session, counted only inside the configured shift windows. For cross-day sessions, this resets at factory-TZ midnight. Computed from the local server\u2019s windowed_elapsed_sec + the seconds elapsed since the state snapshot (capped at +30s by computeActiveTimingCache).';
          return '<div data-tick="active-today" data-emp-id="' + esc(id) + '" title="' + esc(titleText) + '" style="font-size:18px;font-weight:700;color:var(--gr);font-variant-numeric:tabular-nums;line-height:1.25;cursor:help">' +
            esc(fmtHMS(activeTodaySec)) +
            '</div>' +
            '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px">' +
            'active today &middot; ' + esc(s.emp_process || '\u2014') +
            '</div>';
        })() +
        // "This build" \u2014 in-shift elapsed time for THIS active session on
        // this abaya (NOT wall-clock, so nights / weekends / lunch
        // breaks don't inflate the number). Same base+live formula as
        // the "active today" cell so both counters tick every second:
        // the base is computed once per STATE arrival from the per-
        // session in-shift walk (startedAt \u2192 STATE.ts), and the live
        // contribution is min(30, elapsedSinceStateSec) if currently in
        // shift. Replaces the v1.2.19 minute-by-minute walk which only
        // updated the displayed text when crossing a minute boundary,
        // making the counter look frozen between minutes (v1.2.32).
        (function () {
          const buildTitle = isCustom
            ? 'In-shift elapsed time for this active session on this custom abaya. Multi-week build is expected for this style.'
            : 'In-shift elapsed time for this active session on this abaya. Resets at factory-TZ midnight (cross-day sessions accumulate from the original Start, but the daily/weekly/monthly/yearly reports show the per-day breakdown). Per-session counter that ticks every second; not the aggregate across sessions.';
          const customPill = isCustom
            ? ' <span title="Marked is_custom=1 in abaya_catalog. Multi-week style that legitimately spans many sessions." style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#c4b5fd;background:rgba(124,58,237,.18);border:1px solid rgba(167,139,250,.4);border-radius:8px;padding:1px 6px;vertical-align:middle">Custom</span>'
            : '';
          const inShiftSec = thisBuildSecondsFor(id);
          return '<div data-tick="build" data-emp-id="' + esc(id) + '" title="' + esc(buildTitle) + '" style="font-size:14px;font-weight:700;color:var(--am);margin-top:6px;cursor:help;font-variant-numeric:tabular-nums;line-height:1.25">' + esc(fmtHMS(inShiftSec)) + customPill + '</div>' +
            '<div style="font-size:9px;color:var(--tx3)">this build</div>';
        })() +
        '</div></div>'
      );
    })
    .join('');
}

function renderLiveSessionsBlock() {
  const el = document.getElementById('live-sessions');
  if (!el) return;
  el.innerHTML = buildLiveSessionsHtml();
}

function renderRecentInvoiceLogs() {
  const el = document.getElementById('recent-invoice-logs');
  if (!el) return;
  const logs = STATE.logs || [];
  const rows = logs.filter(function (l) {
    return (l.emp_process || '') === 'Invoice maker' && l.invoice_serial;
  }).slice(0, 25);
  if (!rows.length) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:16px">No invoice-maker rows in the last 100 ledger entries.</div>';
    return;
  }
  let html = '<div style="max-height:260px;overflow-y:auto">';
  rows.forEach(function (l) {
    const endMs = l.ended_at != null ? Number(l.ended_at) : 0;
    const t = new Date(endMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: uiTz() });
    const nums = esc(String(l.invoice_serial || '')).replace(/,/g, ', ');
    html +=
      '<div style="display:grid;grid-template-columns:48px 1fr 36px;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd);font-size:11px;align-items:start">' +
      '<span style="color:var(--tx3)">' +
      t +
      '</span>' +
      '<span style="word-break:break-word;font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;color:var(--tx2)">' +
      nums +
      '</span>' +
      '<span style="text-align:right;font-weight:700;color:var(--am)">' +
      (l.invoice_count != null ? esc(String(l.invoice_count)) : '') +
      '</span></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

// \u2500\u2500\u2500 1Hz LIVE TICK (v1.2.32) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Mirrors public/dashboard.js#tickLiveSessions. Walks every active row and
// updates ONLY the elapsed-time cells via targeted textContent writes \u2014
// no innerHTML rebuild, no DOM re-parse. This is what makes the "active
// today" and "this build" counters visibly advance every second even
// when the underlying minute-by-minute walks only change once per minute.
//
// Both cells use the base+live formula:
//   total = baseAtSnapshot + min(30, (browserMs - STATE.ts) / 1000) [if in shift]
// The 30s cap protects against wild drift on a stale tab; the live poll
// cadence (1s when active > 0, 4.5s when idle) refreshes STATE.ts long
// before the cap is reached in normal use.
function tickLiveSessions() {
  const el = document.getElementById('live-sessions');
  if (!el) return;
  const active = STATE && STATE.active ? STATE.active : {};
  const ids = Object.keys(active);
  if (ids.length === 0) return;
  // Force a per-second recompute of computeActiveTimingCache() \u2014 its
  // memo key already includes Math.floor(nowMs/1000), so it busts on
  // its own each second; we just call it here so the tick can read
  // the freshest byEmpId map without a full renderAll().
  const timingCache = computeActiveTimingCache();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const activeTodaySec = Math.floor(Number(timingCache.byEmpId[id]) || 0);
    const buildSec = thisBuildSecondsFor(id);
    const activeTodayCell = el.querySelector('[data-tick="active-today"][data-emp-id="' + cssEscapeAttr(id) + '"]');
    if (activeTodayCell) {
      const txt = fmtHMS(activeTodaySec);
      if (activeTodayCell.textContent !== txt) activeTodayCell.textContent = txt;
    }
    const buildCell = el.querySelector('[data-tick="build"][data-emp-id="' + cssEscapeAttr(id) + '"]');
    if (buildCell) {
      const txt = fmtHMS(buildSec);
      // Preserve any "Custom" pill that was appended inside the cell
      // by the initial render. The pill is a sibling span after the
      // bare text, so textContent collapses to e.g. "1h 5m 22s Custom"
      // (space-separated). We rewrite textContent with \`txt + suffix\`
      // so the pill stays put. Cheap because the tick fires at most
      // once per second and only writes when the value actually
      // changed.
      const current = buildCell.textContent || '';
      const suffix = current.length > txt.length ? current.slice(txt.length) : '';
      const desired = txt + suffix;
      if (current !== desired) buildCell.textContent = desired;
    }
  }
}

// CSS attribute-selector escape: the emp_id is already constrained to
// the e_bc_<digits> form by the AGENTS.md contract, but attribute
// selectors still need quotes-and-double-quote escape for the value.
function cssEscapeAttr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Show a non-blocking error banner at the top of the body so render failures
 *  are visible without forcing the user to open devtools. Keeps the rest of
 *  the page renderable. */
function showRenderError(stage, err) {
  try {
    var msg = (err && (err.message || err.stack)) ? String(err.message || err.stack) : String(err || 'unknown');
    if (msg.length > 240) msg = msg.slice(0, 240) + '\u2026';
    var existing = document.getElementById('render-error-banner');
    var body = '<div style="font-family:var(--fn-mono);font-size:11.5px;line-height:1.5;white-space:pre-wrap;margin-top:6px">' +
      'Stage: ' + String(stage || '?') + '<br>' +
      msg + '</div>' +
      '<div style="margin-top:8px;font-size:10.5px;opacity:.7">Hard-refresh (Ctrl+Shift+R) if this keeps appearing. The dashboard above is still live; only this section failed to render.</div>';
    if (existing) {
      existing.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
        '<div style="flex:1"><b>\u26A0 Render hiccup</b>' + body + '</div>' +
        '<button type="button" onclick="this.parentNode.parentNode.remove()" style="background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;line-height:1;padding:0 4px">\xD7</button></div>';
      return;
    }
    var banner = document.createElement('div');
    banner.id = 'render-error-banner';
    banner.style.cssText = 'position:relative;margin:0 16px 14px;padding:14px 16px;border-radius:14px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.45);color:#ffd6d6;font-size:12.5px';
    banner.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
      '<div style="flex:1"><b>\u26A0 Render hiccup</b>' + body + '</div>' +
      '<button type="button" onclick="this.parentNode.parentNode.remove()" style="background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;line-height:1;padding:0 4px">\xD7</button></div>';
    var dash = document.querySelector('.dash');
    if (dash && dash.parentNode) dash.parentNode.insertBefore(banner, dash.nextSibling);
    else document.body.appendChild(banner);
  } catch (_) { /* never let the banner itself break the page */ }
}

/** Run a render step; if it throws, surface the error and keep going so
 *  the rest of the page still updates. */
function safeRender(stage, fn) {
  try { fn(); }
  catch (e) {
    console.error('[ceo-dashboard] renderAll step failed:', stage, e);
    showRenderError(stage, e);
  }
}

function renderAll() {
  const active = STATE.active || {};
  const perf = STATE.perf || [];
  const activeIds = Object.keys(active);

  safeRender('kpi', function () {
    const completed = Number(STATE.completed_today) || 0;
    const kpiCompleted = byId('kpi-completed', 'kpi-done');
    const kpiAbayasDelivered = byId('kpi-abayas-delivered');
    const kpiActive = byId('kpi-active');
    const kpiAvg = byId('kpi-avg');
    const kpiEff = byId('kpi-eff');
    if (kpiCompleted) kpiCompleted.textContent = completed;
    // Distinct abayas delivered in this window. Same anchor as Completed
    // Today (kpi_anchor_ymd -> kpi_to_ymd) so the two KPIs are
    // always comparable. Hides on a picked day/month where STATE has
    // not yet been re-polled (worker-stale 0 fallback would confuse
    // the operator -- "why 0?"). Once STATE arrives, render normally.
    const abayasDelivered = Number(STATE.abayas_delivered_today) || 0;
    if (kpiAbayasDelivered) kpiAbayasDelivered.textContent = abayasDelivered;
    // Active Workers stays the live count regardless of picked date or
    // month \u2014 a past period has nobody currently on the floor. Hide it
    // when the user is looking at a historical period so the dashboard
    // doesn't show 0 and confuse the operator.
    const picked = getPickedReportDate() || getPickedReportMonth();
    const isLive = !picked;
    if (kpiActive) {
      kpiActive.textContent = isLive ? activeIds.length : '\u2014';
      kpiActive.parentNode.style.opacity = isLive ? '1' : '0.45';
    }
    if (completed > 0) {
      // Prefer the median session time when available \u2014 it is not skewed
      // by forgotten-Finish sessions. Fall back to the mean for the first
      // paint before the worker pushes any sessions.
      const median = Number(STATE.median_session_sec_today) || 0;
      const mean = Number(STATE.avg_cycle_sec_today) || 0;
      const display = median > 0 ? median : mean;
      if (kpiAvg) kpiAvg.textContent = fmtHMS(display);
      const eff = Number(STATE.efficiency_today) || 0;
      if (kpiEff) {
        kpiEff.textContent = eff + '%';
        kpiEff.style.color = eff >= 80 ? 'var(--gr)' : eff >= 60 ? 'var(--am)' : 'var(--rd)';
      }
    } else {
      if (kpiAvg) kpiAvg.textContent = '\u2014';
      if (kpiEff) {
        kpiEff.textContent = '\u2014';
        kpiEff.style.color = '';
      }
    }
  });

  safeRender('header', function () {
    const ft = STATE.factory_today || '';
    const picked = getPickedReportDate();
    const pickedMo = getPickedReportMonth();
    const anchor = (STATE.kpi_anchor_ymd) || ft;
    const dd = document.getElementById('dash-date');
    if (dd) {
      let head = '';
      if (picked) {
        head = 'Showing picked date ' + picked + ' (factory today is ' + ft + ') \u2014 ';
      } else if (pickedMo) {
        head = 'Showing month ' + pickedMo + ' (factory today is ' + ft + ') \u2014 ';
      } else if (ft) {
        head = 'Factory day ' + ft + ' \u2014 ';
      }
      dd.textContent = head + new Date().toLocaleTimeString([], { timeZone: uiTz() });
    }
    // When a date is picked, the "Today" KPIs are no longer "Today" \u2014
    // re-label them so the operator doesn't think they're still looking
    // at live data.
    const cardLabels = document.querySelectorAll('[data-kpi-label]');
    cardLabels.forEach(function (el) {
      const key = el.getAttribute('data-kpi-label');
      const baseText = el.getAttribute('data-kpi-base') || el.textContent;
      if (!el.getAttribute('data-kpi-base')) el.setAttribute('data-kpi-base', baseText);
      el.textContent = picked ? baseText.replace(/today/i, 'on ' + picked) : baseText;
    });
    const dn = document.getElementById('dubai-now');
    if (dn) dn.textContent = 'Dubai time: ' + uiNowString();
    const ws = document.getElementById('work-status');
    if (ws) ws.textContent = 'Status: ' + String(STATE.working_status || '--');
  });

  safeRender('live', renderLiveSessionsBlock);
  safeRender('abaya-totals', renderAbayaTotalsTable);

  safeRender('emp-perf', function () {
    // v1.2.28: skip the innerHTML rebuild + the O(n log n) sort when
    // STATE.perf hasn't changed since the last paint.
    if (!window.__ceoPerf.empPerfChanged(STATE)) return;
    const sorted = perf.slice().sort((a,b)=>b.units-a.units);
    const maxU = sorted.length ? sorted[0].units : 1;
    const topN = Math.max(1, Math.ceil(sorted.length*0.2));
    const ep = document.getElementById('emp-perf');
    if (!ep) return;
    ep.innerHTML = sorted.length === 0
      ? '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:20px">No sessions yet</div>'
      : sorted.map((p,i)=>{
        const w = Math.max(2,Math.round((p.units/maxU)*100));
        return '<div class="emp-row">' +
          '<div class="emp-av" style="background:'+(p.color||'#666')+'">'+p.initials+'</div>' +
          '<div style="width:120px;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(i<topN?'\u2B50 ':'')+p.name+'<div style="font-size:10px;color:var(--tx3)">'+p.process+'</div></div>' +
          '<div class="bar-wrap"><div class="bar-fill" style="width:'+w+'%;background:'+(p.color||'#3b82f6')+'88"></div></div>' +
          '<div style="width:32px;text-align:right;font-size:13px;font-weight:700">'+p.units+'</div>' +
          '<div style="width:38px;text-align:right;font-size:11px;color:var(--tx2)">'+p.eff+'%</div></div>';
      }).join('');
  });

  safeRender('proc-split', function () {
    // v1.2.28: skip the innerHTML rebuild when the underlying split
    // totals haven't changed since the last paint. Most polls in
    // steady state have identical STATE.process_split_today (the
    // server caches for 5s and the browser polls every 2-4.5s).
    if (!window.__ceoPerf.procSplitChanged(STATE)) return;
    const split = STATE.process_split_today || {};
    const total = WORK_TYPES_ORDER.reduce(function(s,t){ return s + (Number(split[t])||0); }, 0) || 1;
    const ps = document.getElementById('proc-split');
    if (!ps) return;
    ps.innerHTML = WORK_TYPES_ORDER.map(function(p){
      var v = Number(split[p])||0;
      var pct = Math.round((v/total)*100);
      var col = procColorUI(p);
      return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="font-weight:600">'+p+'</span><span style="color:'+col+';font-weight:700">'+v+' units ('+pct+'%)</span></div>' +
        '<div style="height:5px;background:var(--s3);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:3px;transition:width .5s"></div></div></div>';
    }).join('');
  });

  safeRender('hourly', function () {
    // v1.2.28: skip when hourly buckets haven't changed.
    if (!window.__ceoPerf.hourlyChanged(STATE)) return;
    const hours = {};
    const hourKeys = Object.keys(STATE.hourly_today || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!hourKeys.length) {
      for (let h = ${FACTORY_HOURLY_START}; h <= ${FACTORY_HOURLY_END}; h++) {
        hours[h] = (STATE.hourly_today && STATE.hourly_today[h] != null) ? STATE.hourly_today[h] : 0;
      }
    } else {
      hourKeys.forEach((h) => {
        hours[h] = (STATE.hourly_today && STATE.hourly_today[h] != null) ? STATE.hourly_today[h] : 0;
      });
    }
    const hVals = Object.values(hours);
    const hMax = Math.max.apply(null, hVals.concat([1]));
    const ho = document.getElementById('hourly');
    if (ho) ho.innerHTML = Object.entries(hours).map(function (kv) {
      var h = kv[0], v = kv[1];
      const ht = Math.max(4, Math.round((v/hMax)*68));
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">' +
        '<div style="font-size:9px;color:var(--tx3)">'+(v||'')+'</div>' +
        '<div style="width:100%;height:'+ht+'px;background:linear-gradient(180deg,var(--bl),var(--pu));border-radius:3px 3px 0 0;opacity:'+(v?1:0.12)+'"></div></div>';
    }).join('');
    const hl = document.getElementById('hlbl');
    if (hl) hl.innerHTML = Object.keys(hours).map(h=>'<div style="flex:1;font-size:8px;color:var(--tx3);text-align:center">'+h+'</div>').join('');
  });

  safeRender('recent-invoice-logs', function () {
    // v1.2.28: skip the innerHTML rebuild when the log tail hasn't
    // changed (the last-100-logs view is mostly stable between polls
    // that don't see a Finish event).
    if (!window.__ceoPerf.invoiceLogsChanged(STATE)) return;
    renderRecentInvoiceLogs();
  });
}

async function openAnalytics() {
  lastModalTrace = null;
  lastReportData = null;
  const sel = document.getElementById('analytics-period');
  const period = sel && sel.value ? sel.value : 'daily';
  document.getElementById('modal-title').textContent = 'Process analytics';
  document.getElementById('modal-ts').textContent = 'Loading\u2026';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');
  try {
    // When the CEO picked a date or a month, the analytics modal scopes
    // to that range instead of the period-anchored-at-today default.
    // This way picking Aug 17 from the date picker shows the Aug 17
    // process breakdown, and picking "2026-08" from the month picker
    // shows the whole month's process breakdown.
    const rangeQs = getPickedRangeQs();
    const r = await fetchWithRetry(
      BASE + '/api/analytics?period=' + encodeURIComponent(period) + '&local_today=' + encodeURIComponent(localYmdNow()) + rangeQs + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Request failed');
    lastModalAnalytics = d;
    const analyticsWindow = windowLabelFromRange(d.start_date, d.end_date);
    const analyticsFallback = d.fallback_applied ? ' (auto-fallback to previous day)' : '';
    document.getElementById('modal-ts').textContent =
      'Period: ' + period + ' \u2014 Window: ' + analyticsWindow + analyticsFallback + ' \u2014 ' +
      new Date().toLocaleString([], { timeZone: uiTz() }) + ' \u2014 D1';

    let html =
      '<p style="font-size:11px;color:var(--tx3);line-height:1.45;margin-bottom:12px">Higher avg time = slower station (bottleneck). <strong>Fastest in process</strong> needs at least 2 completed sessions in that role.</p>';

    const bp = d.by_process || [];
    html +=
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Avg time by station (slowest first)</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:16px">' +
      '<div style="display:grid;grid-template-columns:1fr 52px 52px 52px;gap:6px;padding:8px 10px;font-size:9px;color:var(--tx3);border-bottom:1px solid var(--bd)">' +
      '<span>Process</span><span style="text-align:right">Avg</span><span style="text-align:right">N</span><span style="text-align:right">Range</span></div>' +
      '<div style="max-height:200px;overflow-y:auto">';
    if (!bp.length) {
      html += '<div style="padding:16px;text-align:center;color:var(--tx3);font-size:12px">No sessions in this period</div>';
    } else {
      bp.forEach(function (row) {
        const col = procColorUI(row.emp_process);
        html +=
          '<div style="display:grid;grid-template-columns:1fr 52px 52px 52px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
          '<span style="font-weight:600;color:' +
          col +
          '">' +
          esc(row.emp_process) +
          '</span>' +
          '<span style="text-align:right;color:var(--am);font-weight:700">' +
          fmtHMS(row.avg_sec) +
          '</span>' +
          '<span style="text-align:right">' +
          esc(String(row.units)) +
          '</span>' +
          '<span style="text-align:right;font-size:10px;color:var(--tx3)">' +
          fmtHMS(row.min_sec) +
          '\u2013' +
          fmtHMS(row.max_sec) +
          '</span></div>';
      });
    }
    html += '</div></div>';

    html +=
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px">Fastest worker in each process (2+ samples)</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:16px;font-size:12px">';
    const fp = d.fastest_per_process || [];
    if (!fp.length) {
      html +=
        '<div style="padding:14px;color:var(--tx3)">Not enough data yet (need 2+ finishes per person per process).</div>';
    } else {
      fp.forEach(function (row) {
        html +=
          '<div style="padding:10px 12px;border-bottom:1px solid rgba(54,45,89,.2)">' +
          '<span style="color:var(--bl);font-weight:700">' +
          esc(row.emp_name) +
          '</span> ' +
          '<span style="color:var(--tx3)">' +
          esc(row.emp_process) +
          '</span> \u2014 avg ' +
          fmtHMS(row.avg_sec) +
          ' (' +
          esc(String(row.units)) +
          ' units)</div>';
      });
    }
    html += '</div>';

    html +=
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px">Speed leaders (overall avg, 2+ units)</div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;max-height:180px;overflow-y:auto;font-size:12px">';
    const sl = d.speed_leaders || [];
    if (!sl.length) {
      html += '<div style="padding:14px;color:var(--tx3)">No data</div>';
    } else {
      sl.forEach(function (row, i) {
        html +=
          '<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(54,45,89,.15)">' +
          '<span>' +
          (i + 1) +
          '. <strong>' +
          esc(row.emp_name) +
          '</strong> <span style="color:var(--tx3)">' +
          esc(row.emp_process) +
          '</span></span>' +
          '<span style="color:var(--gr);font-weight:700;white-space:nowrap">' +
          fmtHMS(row.avg_sec) +
          '</span></div>';
      });
    }
    html += '</div>';

    document.getElementById('modal-body').innerHTML = html;
  } catch (e) {
    lastModalAnalytics = null;
    document.getElementById('modal-body').innerHTML =
      '<div style="color:var(--rd);text-align:center;padding:20px">Failed: ' + esc(e.message) + '</div>';
  }
}

async function runGarmentTrace() {
  const inp = document.getElementById('trace-q');
  const q = inp && inp.value ? inp.value.trim() : '';
  if (!q) {
    showToast('Enter item code or abaya id', 'error');
    if (inp) inp.focus();
    return;
  }
  lastModalAnalytics = null;
  lastReportData = null;
  document.getElementById('modal-title').textContent = 'Garment trace';
  document.getElementById('modal-ts').textContent = 'Loading\u2026';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');
  hideTraceDropdown();
  try {
    const r = await fetchWithRetry(
      BASE + '/api/trace?q=' + encodeURIComponent(q) + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Not found');
    lastModalTrace = d;
    // Remember the pick for the next time the dropdown opens.
    recordRecentTrace(String(d.abaya_code || d.abaya_id || q), d);
    const sumDone = Math.floor(Number(d.sum_duration_sec) || 0);
    const actSec = Math.floor(Number(d.active_seconds) || 0);
    const sumAll = Math.floor(Number(d.sum_with_active_sec) != null ? d.sum_with_active_sec : sumDone + actSec);
    document.getElementById('modal-ts').textContent =
      (d.session_count || 0) +
      ' finished step(s) \u2014 ' +
      fmtHMS(sumDone) +
      ' logged' +
      (actSec > 0 ? ' + ' + fmtHMS(actSec) + ' in progress' : '') +
      ' = ' +
      fmtHMS(sumAll) +
      ' total';

    let html =
      '<p style="font-size:11px;color:var(--tx3);margin-bottom:10px">' + esc(d.note || '') + '</p>';
    const rows = d.rows || [];
    if (!rows.length) {
      html +=
        '<div style="padding:20px;text-align:center;color:var(--tx3)">No sessions in D1 for <strong>' +
        esc(q) +
        '</strong>. Check code or sync from factory.</div>';
    } else {
      html +=
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden">' +
        '<div style="display:grid;grid-template-columns:52px 1fr minmax(100px,1.1fr) 58px;gap:6px;padding:8px 10px;font-size:9px;color:var(--tx3);border-bottom:1px solid var(--bd)">' +
        '<span>End</span><span>Who</span><span>Process</span><span style="text-align:right">Time</span></div>';
      rows.forEach(function (row) {
        const t = new Date((Number(row.ended_at) || 0) * 1000).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: uiTz(),
        });
        html +=
          '<div style="display:grid;grid-template-columns:52px 1fr minmax(100px,1.1fr) 58px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:11px;align-items:start">' +
          '<span style="color:var(--tx3);font-size:10px">' +
          esc(t) +
          '</span>' +
          '<span><strong>' +
          esc(row.emp_name) +
          '</strong></span>' +
          '<span style="color:var(--bl);font-weight:600">' +
          esc(row.emp_process) +
          '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700">' +
          fmtHMS(logDurationSec(row)) +
          '</span></div>';
      });
      html += '</div>';
    }
    document.getElementById('modal-body').innerHTML = html;
  } catch (e) {
    lastModalTrace = null;
    document.getElementById('modal-body').innerHTML =
      '<div style="color:var(--rd);text-align:center;padding:20px">' + esc(e.message) + '</div>';
  }
}

// \u2500\u2500\u2500 TRACE COMBOBOX (autocomplete + bloom + recents) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Catalog is loaded once, kept warm in memory, and indexed with a tiny
// bloom filter so even a 5k-item catalog filters in O(n) with no false
// negatives and a low false-positive rate.
let traceCatalog = [];           // [{code, barcode, design, process, icon, id}]
let traceCatalogLoadedAt = 0;
let traceBloom = null;            // {bits: Uint8Array, k: number, m: number}
const TRACE_BLOOM_M = 8192;      // 8 KB, plenty for 5k items
const TRACE_BLOOM_K = 3;
const TRACE_RECENTS_KEY = 'abaya.trace.recents.v1';
const TRACE_RECENTS_MAX = 5;

function traceBloomHas(token) {
  if (!traceBloom) return true; // pre-load fallback: assume yes
  const { bits, m, k } = traceBloom;
  const h = traceHash32(token);
  for (let i = 0; i < k; i++) {
    const bit = ((h >>> i) ^ (h * (i + 1))) & (m - 1);
    if (!bits[bit >>> 3] || !((bits[bit >>> 3] >> (bit & 7)) & 1)) return false;
  }
  return true;
}
function traceBloomAdd(token) {
  if (!token) return;
  if (!traceBloom) {
    traceBloom = { bits: new Uint8Array(TRACE_BLOOM_M >>> 3), m: TRACE_BLOOM_M, k: TRACE_BLOOM_K };
  }
  const { bits, m, k } = traceBloom;
  const h = traceHash32(token);
  for (let i = 0; i < k; i++) {
    const bit = ((h >>> i) ^ (h * (i + 1))) & (m - 1);
    bits[bit >>> 3] |= 1 << (bit & 7);
  }
}
// Tiny FNV-1a-style 32-bit hash \u2014 fast and good enough for bloom.
function traceHash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

async function loadTraceCatalog(force) {
  const now = Date.now();
  if (!force && traceCatalog.length && now - traceCatalogLoadedAt < 60_000) {
    return traceCatalog;
  }
  try {
    const r = await fetchWithRetry(BASE + '/api/catalog/abayas?ts=' + Date.now(), { cache: 'no-store' });
    const d = await r.json();
    const list = (d && d.abayas) || [];
    traceCatalog = list.map(function (a) {
      return {
        code: String(a.code || ''),
        barcode: String(a.barcode || ''),
        design: String(a.design || ''),
        process: String(a.process || ''),
        icon: String(a.icon || ''),
        id: a.id != null ? String(a.id) : '',
      };
    });
    traceCatalogLoadedAt = now;
    traceBloom = null;
    for (let i = 0; i < traceCatalog.length; i++) {
      const a = traceCatalog[i];
      traceBloomAdd(a.code);
      traceBloomAdd(a.barcode);
      traceBloomAdd(a.id);
    }
  } catch (_) {
    // keep what we had
  }
  return traceCatalog;
}

function getTraceRecents() {
  try {
    const raw = localStorage.getItem(TRACE_RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, TRACE_RECENTS_MAX) : [];
  } catch (_) {
    return [];
  }
}
function saveTraceRecents(list) {
  try {
    localStorage.setItem(TRACE_RECENTS_KEY, JSON.stringify(list.slice(0, TRACE_RECENTS_MAX)));
  } catch (_) {}
}
function recordRecentTrace(label, data) {
  if (!label) return;
  const entry = {
    label: String(label),
    abaya_id: data && data.abaya_id != null ? String(data.abaya_id) : '',
    at: Date.now(),
  };
  const cur = getTraceRecents().filter(function (r) { return r.label !== entry.label; });
  cur.unshift(entry);
  saveTraceRecents(cur);
}

// Score a catalog row against the query. Lower = better. -1 = no match.
function traceScore(item, q) {
  if (!q) return 999; // empty query: only recents
  const code = item.code.toLowerCase();
  const barcode = item.barcode.toLowerCase();
  const design = item.design.toLowerCase();
  const id = item.id.toLowerCase();
  if (code === q) return 0;
  if (barcode === q) return 1;
  if (id === q) return 2;
  if (code.startsWith(q)) return 10;
  if (barcode.startsWith(q)) return 11;
  if (id.startsWith(q)) return 12;
  if (code.indexOf(q) >= 0) return 30;
  if (barcode.indexOf(q) >= 0) return 31;
  if (design.indexOf(q) >= 0) return 50;
  return -1;
}

function traceMatchCatalog(q) {
  if (!q) return [];
  const ql = q.toLowerCase();
  // Bloom fast-path: only walk the catalog if the bloom says "maybe".
  if (traceBloom && !traceBloomHas(ql) && !traceBloomHas(q)) {
    return [];
  }
  const hits = [];
  for (let i = 0; i < traceCatalog.length; i++) {
    const s = traceScore(traceCatalog[i], ql);
    if (s >= 0) hits.push({ item: traceCatalog[i], score: s });
  }
  hits.sort(function (a, b) {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.code.localeCompare(b.item.code);
  });
  return hits.slice(0, 8).map(function (h) { return h.item; });
}

let traceActiveIndex = -1; // currently highlighted option in dropdown
let traceOptions = [];     // current items shown (mix of recents + catalog hits)

function hideTraceDropdown() {
  const dd = document.getElementById('trace-dd');
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
  traceActiveIndex = -1;
  traceOptions = [];
}

function renderTraceDropdown() {
  const dd = document.getElementById('trace-dd');
  if (!dd) return;
  if (!traceOptions.length) { hideTraceDropdown(); return; }
  const ql = String(document.getElementById('trace-q').value || '').trim().toLowerCase();
  const headerHtml = (ql ? '<div class="trace-dd-h">Catalog matches</div>' : '<div class="trace-dd-h">Recent traces</div>');
  const rows = traceOptions.map(function (it, i) {
    const isActive = i === traceActiveIndex;
    const swatch = it.icon
      ? '<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:' + esc(it.icon) + ';margin-right:8px;vertical-align:middle;border:1px solid rgba(255,255,255,.12)"></span>'
      : '<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:rgba(124,111,224,.18);margin-right:8px;vertical-align:middle"></span>';
    return '<div class="trace-dd-row' + (isActive ? ' trace-dd-active' : '') + '" role="option" data-i="' + i + '" data-label="' + esc(it.label) + '">' +
      swatch +
      '<span class="trace-dd-code">' + esc(it.label) + '</span>' +
      (it.sub ? '<span class="trace-dd-sub">' + esc(it.sub) + '</span>' : '') +
      '</div>';
  }).join('');
  dd.innerHTML = headerHtml + rows;
  dd.style.display = 'block';
  // Delegated click
  dd.onclick = function (ev) {
    const row = ev.target.closest && ev.target.closest('.trace-dd-row');
    if (!row) return;
    const idx = Number(row.getAttribute('data-i'));
    if (traceOptions[idx]) pickTraceOption(traceOptions[idx]);
  };
}

function pickTraceOption(opt) {
  const inp = document.getElementById('trace-q');
  if (inp) {
    inp.value = opt.label;
    inp.focus();
  }
  hideTraceDropdown();
  runGarmentTrace();
}

function openTraceDropdown() {
  const inp = document.getElementById('trace-q');
  if (!inp) return;
  const q = inp.value.trim();
  if (!q) {
    // Empty: show recents
    const recents = getTraceRecents();
    traceOptions = recents.map(function (r) {
      return { label: r.label, sub: r.abaya_id && r.abaya_id !== r.label ? ('id ' + r.abaya_id) : '' };
    });
  } else {
    const hits = traceMatchCatalog(q);
    traceOptions = hits.map(function (a) {
      return {
        label: a.code || a.barcode || a.id,
        sub: (a.design ? a.design + ' \xB7 ' : '') + (a.process || ''),
      };
    });
  }
  traceActiveIndex = traceOptions.length ? 0 : -1;
  renderTraceDropdown();
}

function moveTraceActive(delta) {
  if (!traceOptions.length) return;
  traceActiveIndex = (traceActiveIndex + delta + traceOptions.length) % traceOptions.length;
  renderTraceDropdown();
}

function wireTraceCombobox() {
  const inp = document.getElementById('trace-q');
  if (!inp || inp.__traceWired) return;
  inp.__traceWired = true;
  // Plain paste of digits = abaya_id; auto-trigger after a short debounce.
  let pasteTimer = null;
  inp.addEventListener('input', function () {
    if (pasteTimer) clearTimeout(pasteTimer);
    const v = inp.value.trim();
    // Open dropdown on any input (recents if empty, matches if not).
    openTraceDropdown();
    // Pure digits (3+ chars) on a fresh field = abaya_id, auto-search.
    // No /d{3,}/ regex literal: wrangler's minifier strips the backslash
    // and ships /d{3,}/ which throws on every page load. Use a char loop.
    let _isPureDigits = v.length >= 3;
    if (_isPureDigits) {
      for (let _i = 0; _i < v.length; _i++) {
        const _c = v.charCodeAt(_i);
        if (_c < 48 || _c > 57) { _isPureDigits = false; break; }
      }
    }
    if (_isPureDigits) {
      pasteTimer = setTimeout(function () {
        if (inp.value.trim() === v) runGarmentTrace();
      }, 250);
    }
  });
  inp.addEventListener('focus', function () {
    loadTraceCatalog(false).then(openTraceDropdown);
  });
  inp.addEventListener('blur', function () {
    // Delay so a click on a dropdown row still fires.
    setTimeout(function () {
      if (!document.activeElement || !(document.activeElement.closest && document.activeElement.closest('#trace-dd'))) {
        hideTraceDropdown();
      }
    }, 120);
  });
  inp.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      if (traceOptions.length && traceActiveIndex >= 0) {
        ev.preventDefault();
        pickTraceOption(traceOptions[traceActiveIndex]);
        return;
      }
      ev.preventDefault();
      runGarmentTrace();
      return;
    }
    if (ev.key === 'Escape') { hideTraceDropdown(); inp.blur(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (!traceOptions.length) openTraceDropdown(); else moveTraceActive(1); return; }
    if (ev.key === 'ArrowUp')   { ev.preventDefault(); if (!traceOptions.length) openTraceDropdown(); else moveTraceActive(-1); return; }
  });
  // Eager load so the catalog is warm by the time the user clicks the field.
  loadTraceCatalog(false);
}
// Wire once on first module init (called from poll setup below).

// \u2500\u2500\u2500 REPORT MODAL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function getPickedReportDate() {
  const el = document.getElementById('report-date');
  const v = el ? String(el.value || '').trim() : '';
  // No regex literal \u2014 wrangler's minifier strips backslashes from
  // /d/ \u2192 /d/ which throws SyntaxError on every page load. <input
  // type="date">.value is always "YYYY-MM-DD" or "" so a 10-char
  // length + dash positions are sufficient.
  if (v.length !== 10) return '';
  if (v.charAt(4) !== '-' || v.charAt(7) !== '-') return '';
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = v.charAt(i);
    if (c < '0' || c > '9') return '';
  }
  return v;
}

function resetReportDate() {
  const el = document.getElementById('report-date');
  if (el) el.value = '';
  onReportDateChange();
}

/** YYYY-MM string the CEO picked in the "Pick a month" filter, or ''.
 *  Same "no regex literal" caveat as getPickedReportDate \u2014 wrangler's
 *  minifier strips backslashes from /d/ -> /d/ and breaks every page load.
 *  Instead, hand-check the four-digit / two-digit shape with charCodeAt. */
function getPickedReportMonth() {
  const el = document.getElementById('report-month');
  const v = el ? String(el.value || '').trim() : '';
  if (v.length !== 7 || v.charCodeAt(4) !== 45) return '';
  // YYYY-MM with the dash at index 4 and 6 numeric digits elsewhere.
  for (let i = 0; i < 7; i++) {
    if (i === 4) continue;
    const c = v.charCodeAt(i);
    if (c < 48 || c > 57) return '';
  }
  const yy = Number(v.slice(0, 4));
  const mm = Number(v.slice(5, 7));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return '';
  return v;
}

/** Last day (YYYY-MM-DD) of the picked month, in UTC. The sessions table
 *  stores day_date as a UTC YYYY-MM-DD so month boundaries are stable. */
function pickedMonthEndYmd(monthYmd) {
  const y = Number(monthYmd.slice(0, 4));
  const m = Number(monthYmd.slice(5, 7));
  // day 0 of month (m+1) = last day of month m. JS month is 0-indexed.
  const last = new Date(Date.UTC(y, m, 0));
  const ly = last.getUTCFullYear();
  const lm = String(last.getUTCMonth() + 1).padStart(2, '0');
  const ld = String(last.getUTCDate()).padStart(2, '0');
  return ly + '-' + lm + '-' + ld;
}

/** First day (YYYY-MM-DD) of the picked month, UTC. */
function pickedMonthStartYmd(monthYmd) {
  return monthYmd.slice(0, 4) + '-' + monthYmd.slice(5, 7) + '-01';
}

// \u2500\u2500\u2500 MONTH NAVIGATOR (monthly report) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Lets the CEO step through the last 12 months from inside the monthly
// report modal. The current dashboard "Pick a month" filter is the source
// of truth: the navigator just rewrites that input and re-runs the same
// report. The 12-month floor is a soft cap (user can still type a
// different month into the picker; arrows are only a quick nav).

/** YYYY-MM string of today, in local factory time. */
function currentMonthYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** YYYY-MM for delta months away from monthYmd (negative = back).
 *  Handles year wrap. No regex, no Date parsing \u2014 just integer math. */
function shiftMonthYmd(monthYmd, delta) {
  const y = Number(monthYmd.slice(0, 4));
  const m = Number(monthYmd.slice(5, 7));
  // JS Date trick: day-of-month-1 of (m-1 + delta) in year y, then read back.
  // Day-of-month-0 of next month is the last of the previous month, so day 0
  // of month 0 of next year is the last of December. We want the YYYY-MM
  // label, so just normalize (m-1)+delta then split back.
  const total = (y * 12) + (m - 1) + (Number(delta) || 0);
  const ny = Math.floor(total / 12);
  const nm = (total - (ny * 12)) + 1;
  return ny + '-' + String(nm).padStart(2, '0');
}

/** 12 months back from today, as YYYY-MM. Lower bound for the prev arrow. */
function monthNavFloor() {
  return shiftMonthYmd(currentMonthYmd(), -12);
}

function isAtFloor(monthYmd) {
  return monthYmd <= monthNavFloor();
}

function isAtCurrentMonth(monthYmd) {
  return monthYmd >= currentMonthYmd();
}

/** Human label for a YYYY-MM month, e.g. "Aug 2026". Uses the dashboard's
 *  UI timezone so the CEO sees the month as their factory sees it. */
function monthLabel(monthYmd) {
  const y = Number(monthYmd.slice(0, 4));
  const m = Number(monthYmd.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthYmd;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', year: 'numeric',
  });
}

/** Build the from/to range the dashboard / reports should be scoped to.
 *  Day picker wins when set (more specific). Otherwise month picker.
 *  Empty strings when neither is set (server uses today as anchor). */
function getPickedRangeQs() {
  const day = getPickedReportDate();
  if (day) return '&from=' + encodeURIComponent(day) + '&to=' + encodeURIComponent(day);
  const mo = getPickedReportMonth();
  if (mo) {
    return '&from=' + encodeURIComponent(pickedMonthStartYmd(mo)) +
      '&to=' + encodeURIComponent(pickedMonthEndYmd(mo));
  }
  return '';
}

function resetReportMonth() {
  const el = document.getElementById('report-month');
  if (el) el.value = '';
  onReportMonthChange();
}

/** The CEO picked (or cleared) a month in the Executive Reports month picker.
 *  Re-poll /api/state right away so the dashboard flips to that month. */
function onReportMonthChange() {
  try {
    if (typeof poll === 'function') {
      void poll(true);
    }
  } catch (_) {}
}

/** Step the dashboard month picker by delta months and reopen the
 *  currently-active monthly report. Clamped to [floor, current]. */
function stepMonth(delta) {
  // No day picker allowed \u2014 the navigator is only meaningful for the
  // month-scoped monthly report. If a day is set, jump to this month
  // (i.e. delta=0) and clear the day so the user actually gets a month
  // view of the report.
  if (getPickedReportDate()) {
    const dayEl = document.getElementById('report-date');
    if (dayEl) dayEl.value = '';
  }
  // Resolve the current target month: the picker value, or "this month".
  const cur = getPickedReportMonth() || currentMonthYmd();
  let next = shiftMonthYmd(cur, delta);
  if (next < monthNavFloor()) next = monthNavFloor();
  if (next > currentMonthYmd()) next = currentMonthYmd();
  const moEl = document.getElementById('report-month');
  if (moEl) moEl.value = next;
  onReportMonthChange();
  if (activeReportType === 'monthly') openReport('monthly');
}

window.stepMonth = stepMonth;

/** Render the month navigator into #month-nav-host.
 *  Cleared when the active report is not monthly, or when a day is picked. */
function renderMonthNav() {
  const host = document.getElementById('month-nav-host');
  if (!host) return;
  if (activeReportType !== 'monthly' || getPickedReportDate()) {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }
  const cur = getPickedReportMonth() || currentMonthYmd();
  const atFloor = isAtFloor(cur);
  const atTop = isAtCurrentMonth(cur);
  const lbl = monthLabel(cur);
  // Reuses the existing .cr-nav-btn style from the Check Delivery report \u2014
  // same dark-purple palette so the new chrome looks native to the modal.
  // Disabled buttons get the existing :disabled { opacity: .4 } treatment.
  host.style.display = 'block';
  host.style.marginBottom = '8px';
  host.innerHTML =
    '<div class="cr-nav" style="flex-wrap:wrap">' +
      '<button type="button" class="cr-nav-btn"' + (atFloor ? ' disabled' : '') +
        ' onclick="stepMonth(-1)" title="Previous month" aria-label="Previous month">&larr; Prev</button>' +
      '<span class="cr-nav-btn" style="background:transparent;border-color:transparent;color:var(--tx);font-weight:700;cursor:default;min-width:120px;text-align:center">' +
        esc(lbl) +
      '</span>' +
      '<button type="button" class="cr-nav-btn"' + (atTop ? ' disabled' : '') +
        ' onclick="stepMonth(1)" title="Next month" aria-label="Next month">Next &rarr;</button>' +
      '<button type="button" class="cr-nav-btn" onclick="jumpToCurrentMonth()" title="Jump to current month">This month</button>' +
    '</div>';
}

/** One-tap reset to the current month. Same effect as clearing the picker
 *  + reopening, but the button is a discoverable shortcut inside the modal. */
function jumpToCurrentMonth() {
  const el = document.getElementById('report-month');
  if (el) el.value = currentMonthYmd();
  onReportMonthChange();
  if (activeReportType === 'monthly') openReport('monthly');
}
window.jumpToCurrentMonth = jumpToCurrentMonth;

/** The CEO picked (or cleared) a date in the Executive Reports date picker.
 *  Re-poll /api/state right away so the dashboard flips to that day. */
function onReportDateChange() {
  try {
    if (typeof poll === 'function') {
      void poll(true);
    }
  } catch (_) {}
}
window.onReportDateChange = onReportDateChange;
window.resetReportDate = resetReportDate;
window.onReportMonthChange = onReportMonthChange;
window.resetReportMonth = resetReportMonth;

/** Roster for the "Pick a person" dropdown \u2014 fetched once per page load. */
async function loadEmployeeDayOptions() {
  const sel = document.getElementById('employee-day-select');
  try {
    const r = await fetchWithRetry(BASE + '/api/employees?ts=' + Date.now(), { cache: 'no-store' });
    const data = await r.json();
    const list = (data && data.employees) || [];
    if (!sel) return;
    if (!list.length) {
      sel.innerHTML = '<option value="">No people found</option>';
      return;
    }
    sel.innerHTML =
      '<option value="">Choose a person...</option>' +
      list
        .map(function (e) {
          const label = String(e.name || e.id || '') + (e.process ? ' \u2014 ' + String(e.process) : '');
          return '<option value="' + encodeURIComponent(String(e.id || '')) + '">' + esc(label) + '</option>';
        })
        .join('');
  } catch (_) {
    if (sel) sel.innerHTML = '<option value="">Could not load names</option>';
  }
}

function openSelectedEmployeeDay() {
  const sel = document.getElementById('employee-day-select');
  const raw = sel ? String(sel.value || '') : '';
  if (!raw) {
    document.getElementById('ed-title').textContent = 'Pick a person first';
    document.getElementById('ed-sub').textContent = '';
    document.getElementById('ed-body').innerHTML =
      '<div class="cr-empty">Choose a name from "Pick a person", then tap Show their day.</div>';
    document.getElementById('ed-actions').innerHTML =
      '<button class="btn-close" onclick="closeEmployeeDay()">Close</button>';
    document.getElementById('modal-ed').classList.add('open');
    return;
  }
  openEmployeeDay(decodeURIComponent(raw));
}

/** Date the per-employee day view applies to: picked date, else the report's end date. */
function employeeDayAnchorYmd() {
  const picked = getPickedReportDate();
  if (picked) return picked;
  const p = lastReportData && lastReportData.period;
  return (p && p.end_date) || localYmdNow();
}

function closeEmployeeDay() {
  const m = document.getElementById('modal-ed');
  if (m) m.classList.remove('open');
}
window.closeEmployeeDay = closeEmployeeDay;

async function openEmployeeDay(empId, explicitDate) {
  const anchor = explicitDate || employeeDayAnchorYmd();
  const m = document.getElementById('modal-ed');
  if (m) m.classList.add('open');
  document.getElementById('ed-title').textContent = 'Employee day';
  document.getElementById('ed-sub').textContent = 'Loading ' + anchor + '...';
  document.getElementById('ed-body').innerHTML =
    '<div class="cr-empty">\u23F3 Loading\u2026</div>';
  document.getElementById('ed-actions').innerHTML =
    '<button class="btn-close" onclick="closeEmployeeDay()">Close</button>';
  try {
    const r = await fetchWithRetry(
      BASE + '/api/report/employee-day?emp_id=' + encodeURIComponent(empId) +
        '&date=' + encodeURIComponent(anchor) + '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const data = await r.json();
    if (!data || data.ok === false) throw new Error((data && data.error) || 'load failed');
    renderEmployeeDay(data);
  } catch (e) {
    document.getElementById('ed-body').innerHTML =
      '<div class="cr-empty" style="color:var(--rd)">Could not load employee day: ' +
      esc(String((e && e.message) || e)) + '</div>';
  }
}

// Convenience: re-open the modal for a specific date. Wired into the
// "nearby dates" chips that appear when the picked date is empty so the
// CEO can jump straight to a real workday with one click.
function openEmployeeDayForDate(empId, dateYmd) {
  if (!empId || !dateYmd) return;
  return openEmployeeDay(String(empId), String(dateYmd));
}
window.openEmployeeDayForDate = openEmployeeDayForDate;

function edFmtRange(s) {
  // Always 12-hour with explicit AM/PM regardless of the browser's
  // locale. The previous { hour: '2-digit', minute: '2-digit' } call
  // inherited the locale's default and rendered as '19:34' on
  // en-GB and as '07:34 PM' on en-US, so the CEO saw mixed formats
  // depending on their OS. Pin it.
  const start = s.started_at
    ? new Date(Number(s.started_at) * 1000).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: uiTz(),
      })
    : '\u2014';
  const end = s.live
    ? 'now'
    : s.ended_at
      ? new Date(Number(s.ended_at) * 1000).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: uiTz(),
        })
      : '\u2014';
  return start + ' \u2013 ' + end;
}

function renderEmployeeDay(data) {
  const emp = data.emp || {};
  const t = data.totals || {};
  const name = emp.name || emp.id || 'Employee';
  const date = String(data.date || '');
  document.getElementById('ed-title').textContent = name + (date ? ' \u2014 ' + date : '');
  document.getElementById('ed-sub').textContent =
    (emp.process ? emp.process + ' \xB7 ' : '') +
    'What ' + name + ' did on this date, in order. Generated: ' +
    new Date().toLocaleString([], { timeZone: uiTz() });

  // Stat cards (same cr-totals / cr-tot pattern as Check Delivery Report)
  // Work time = completed-only by default; if the live session has accrued
  // time and there are 0 completed units today, the live overlap is rolled
  // in so the card doesn't read 0s when the employee is clearly working.
  const workTimeSec = (t.units || 0) > 0
    ? Number(t.active_time_sec || 0)
    : Number(t.full_time_sec || t.active_time_sec || 0);
  const totalsHtml =
    '<div class="cr-totals" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="cr-tot"><div class="cr-tot-lbl" title="Finished process steps (Tailor, Hand Work, Button, etc.) \u2014 replaces the old &quot;Units&quot; label which was misleading in a garment factory">Process completed</div>' +
        '<div class="cr-tot-val" style="color:var(--gr)">' + (t.units || 0) + '</div></div>' +
      '<div class="cr-tot"><div class="cr-tot-lbl">Work time</div>' +
        '<div class="cr-tot-val" style="color:var(--am)">' + esc(fmtHMS(workTimeSec)) + '</div></div>' +
      '<div class="cr-tot"><div class="cr-tot-lbl">Live now</div>' +
        '<div class="cr-tot-val" style="color:var(--bl)">' + esc(fmtHMS(t.live_active_time_sec || 0)) + '</div></div>' +
    '</div>';

  // 30-day history strip (always rendered when the backend returns data).
  // Click any cell to jump to that date. Lets the CEO spot the real
  // workdays at a glance instead of guessing from the picker.
  let historyHtml = '';
  if (Array.isArray(data.recent_days) && data.recent_days.length) {
    const cells = data.recent_days.map(function (n) {
      const isCurrent = n.day_date === data.date;
      const intensity = n.units >= 8 ? '1' : n.units >= 4 ? '0.7' : n.units >= 1 ? '0.45' : '0.15';
      // Time rendered compact: "12h 4m" / "1h 22m" / "<1m" / "" when zero
      // (today's live session is not in the sessions table, so today often
      // shows 0m \u2014 that's correct, the live time is on the stat card above).
      const ts = Number(n.time_sec) || 0;
      const timeLabel = ts > 0 ? fmtShortHMS(ts) : '';
      return '<button type="button" class="ed-day-cell' + (isCurrent ? ' is-current' : '') +
        '" style="background:rgba(34,197,94,' + intensity + ');' +
        (isCurrent ? 'outline:2px solid var(--am);' : '') +
        '" title="' + esc(n.day_date) + ' \xB7 ' + n.units + ' unit' + (n.units === 1 ? '' : 's') +
        (ts > 0 ? ' \xB7 ' + esc(fmtHMS(ts)) : '') + '"' +
        ' onclick="openEmployeeDayForDate(' + escJs(emp.id) + ', ' + escJs(n.day_date) + ')">' +
        '<span class="ed-day-date">' + esc(String(n.day_date).slice(5)) + '</span>' +
        '<span class="ed-day-units">' + n.units + 'u</span>' +
        '<span class="ed-day-time">' + esc(timeLabel) + '</span>' +
        '</button>';
    }).join('');
    historyHtml =
      '<div class="cr-section" style="margin-top:8px">' +
        '<div class="cr-section-h">Last 30 days <span class="cr-mini">units + time, click a day to jump</span></div>' +
        '<div class="ed-day-strip">' + cells + '</div>' +
      '</div>';
  }

  // Sessions section
  const rows = data.sessions || [];
  let sessionsHtml;
  if (!rows.length) {
    // Empty date \u2014 show the 3 nearest dates the employee DID work, so the
    // CEO can see whether the picker is wrong or the employee just didn't
    // log anything on the picked day. Clickable: re-opens the modal for
    // that date. (Backend populates data.nearby_dates when rows=0.)
    let nearbyHint = '';
    if (data.nearby_dates && data.nearby_dates.length) {
      const chips = data.nearby_dates.map(function (n) {
        return '<button class="exec-chip" style="margin:0 4px 4px 0" onclick="openEmployeeDayForDate(' + escJs(emp.id) + ', ' + escJs(n.day_date) + ')">' +
          esc(n.day_date) + ' &middot; ' + n.units + ' unit' + (n.units === 1 ? '' : 's') + '</button>';
      }).join('');
      nearbyHint = '<div style="margin-top:10px;font-size:11px;color:var(--tx3)">No sessions for <b>' + esc(data.date) + '</b>, but this employee has logged time on:</div>' +
        '<div style="margin-top:6px;display:flex;flex-wrap:wrap">' + chips + '</div>';
    }
    sessionsHtml =
      '<div class="cr-section"><div class="cr-section-h">Sessions <span class="cr-mini">chronological, with abaya + duration</span></div>' +
      '<div class="cr-empty">No sessions on this date.</div>' + nearbyHint + '</div>';
  } else {
    sessionsHtml =
      '<div class="cr-section">' +
        '<div class="cr-section-h">Sessions <span class="cr-mini">' + rows.length + ' step' + (rows.length === 1 ? '' : 's') + ' \xB7 chronological</span></div>' +
        '<div class="cr-scroll">' +
          '<div style="display:grid;grid-template-columns:120px minmax(0,1fr) minmax(0,1.1fr) 76px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-weight:600">' +
            '<span>Time</span><span>Process</span><span>Item</span><span style="text-align:right">Duration</span></div>';
    rows.forEach(function (s) {
      const procColor = procColorUI(s.emp_process);
      const liveBadge = s.live
        ? ' <span class="cr-status" style="color:var(--bl);background:var(--blb);border-color:rgba(106,95,193,.3)">live</span>'
        : '';
      sessionsHtml +=
        '<div style="display:grid;grid-template-columns:120px minmax(0,1fr) minmax(0,1.1fr) 76px;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center;' +
        (s.live ? 'background:rgba(106,95,193,.10);' : '') +
        '">' +
          '<span style="color:var(--tx3);font-variant-numeric:tabular-nums">' + esc(edFmtRange(s)) + '</span>' +
          '<span style="font-weight:600;color:' + procColor + '">' + esc(String(s.emp_process || '\u2014')) + liveBadge + '</span>' +
          '<span style="color:var(--tx2);font-family:var(--fn-mono);font-size:11px">' + esc(String(s.abaya_code || s.abaya_id || '\u2014')) + '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700;font-variant-numeric:tabular-nums">' + esc(fmtHMS(s.duration_sec)) + '</span>' +
        '</div>';
    });
    sessionsHtml += '</div></div>';
  }

  document.getElementById('ed-body').innerHTML = totalsHtml + historyHtml + sessionsHtml;
  // Action bar: WhatsApp export, Change Date, Close
  document.getElementById('ed-actions').innerHTML =
    '<button class="btn-export" style="background:linear-gradient(135deg,#6a5fc1,#422082)" onclick="edWhatsApp()">&#128241; Send via WhatsApp</button>' +
    '<button class="btn-close" onclick="edChangeDate()">&#9664; Change Date</button>' +
    '<button class="btn-close" onclick="closeEmployeeDay()">Close</button>';
}

/** Step back to the Executive Reports panel so the user can pick a new date / person. */
function edChangeDate() {
  closeEmployeeDay();
  // The Executive Reports panel is at the top of the dashboard; scroll to it.
  try {
    const panel = document.getElementById('exec-reports');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {}
}
window.edChangeDate = edChangeDate;

/** Build a WhatsApp-shareable summary of the employee day. */
window.edWhatsApp = function () {
  // Re-render the most recent /api/report/employee-day call's data. The handler
  // stored it on the closure, but we don't keep that across invocations \u2014 so
  // we re-fetch.
  const sel = document.getElementById('employee-day-select');
  const empId = sel ? String(sel.value || '') : '';
  if (!empId) { showToast('Pick a person first', 'error'); return; }
  const date = employeeDayAnchorYmd();
  showToast('Building WhatsApp text\u2026');
  fetchWithRetry(
    BASE + '/api/report/employee-day?emp_id=' + encodeURIComponent(decodeURIComponent(empId)) +
      '&date=' + encodeURIComponent(date) + '&ts=' + Date.now(),
    { cache: 'no-store' }
  ).then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'load failed');
      const emp = data.emp || {};
      const t = data.totals || {};
      const name = emp.name || emp.id || 'Employee';
      const lines = [];
      lines.push('*AbaYa Track \u2014 ' + name + '*');
      lines.push('_' + String(data.date || '') + '_');
      lines.push('_' + (emp.process || '') + '_');
      lines.push('_Generated in ' + uiTz() + '_');
      lines.push('');
      lines.push('*Totals*');
      lines.push('\u2022 Process completed: *' + (t.units || 0) + '*');
      lines.push('\u2022 Work time: *' + fmtHMS(t.active_time_sec || 0) + '*');
      lines.push('\u2022 Live now: *' + fmtHMS(t.live_active_time_sec || 0) + '*');
      lines.push('');
      if ((data.sessions || []).length) {
        lines.push('*Sessions*');
        data.sessions.forEach(function (s) {
          lines.push('\u2022 ' + edFmtRange(s) + ' \xB7 ' + (s.emp_process || '\u2014') +
            ' \xB7 ' + (s.abaya_code || s.abaya_id || '\u2014') +
            ' \xB7 ' + fmtHMS(s.duration_sec) + (s.live ? ' (active)' : ''));
        });
        lines.push('');
      }
      lines.push('_Sent from AbaYa Track CEO Dashboard_');
      const text = lines.join('\\n');
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      showToast('WhatsApp opened');
    })
    .catch(function (e) { showToast('Could not build text: ' + (e.message || e), 'error'); });
};

function backToReportBtnHtml() {
  return '<div style="margin-bottom:10px"><button type="button" class="rep-btn" style="padding:8px 12px;text-transform:none" onclick="backToReport()">&larr; Back to report</button></div>';
}

function backToReport() {
  if (activeReportType) openReport(activeReportType);
}

async function openReport(type) {
  activeReportType = type;
  lastModalAnalytics = null;
  lastModalTrace = null;
  document.getElementById('modal-title').textContent = type.charAt(0).toUpperCase()+type.slice(1)+' Report';
  document.getElementById('modal-ts').textContent = 'Fetching data from Cloudflare D1...';
  document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">&#128257; Loading...</div>';
  document.getElementById('modal').classList.add('open');
  // Month navigator lives only in the monthly report, and only when no
  // day is picked. renderMonthNav() handles both decisions internally so
  // we just call it unconditionally on every report open.
  try { renderMonthNav(); } catch (_) {}

  try {
    // Day picker still anchors the report at a single date (back-compat
    // with the existing &date= behaviour). When a month is picked, the
    // report becomes a custom range covering that month, so e.g. tapping
    // "Weekly" while month=2026-08 returns the last full week of August,
    // not the current real-world week.
    const pickedDate = getPickedReportDate();
    const pickedMonth = getPickedReportMonth();
    let rangeQs = '';
    if (pickedDate) {
      rangeQs = '&date=' + encodeURIComponent(pickedDate);
    } else if (pickedMonth) {
      rangeQs =
        '&from=' + encodeURIComponent(pickedMonthStartYmd(pickedMonth)) +
        '&to=' + encodeURIComponent(pickedMonthEndYmd(pickedMonth));
    }
    const r = await fetchWithRetry(
      BASE + '/api/report?type=' + encodeURIComponent(type) +
        '&local_today=' + encodeURIComponent(localYmdNow()) +
        rangeQs +
        '&ts=' + Date.now(),
      { cache: 'no-store' }
    );
    const data = await r.json();
    lastReportData = data;
    const periodWindow = windowLabelFromRange(data.period && data.period.start_date, data.period && data.period.end_date);
    const periodFallback = data.period && data.period.fallback_applied ? ' (auto-fallback to previous day)' : '';
    document.getElementById('modal-title').textContent =
      type.charAt(0).toUpperCase() + type.slice(1) + ' Report \u2014 ' + periodWindow;
    document.getElementById('modal-ts').textContent =
      'Generated: ' + new Date().toLocaleString([], { timeZone: uiTz() }) + ' \u2014 Window: ' + periodWindow + periodFallback + ' \u2014 via Cloudflare D1';

    const s = data.summary || {};
    const period = data.period || {};
    const insights = data.insights || {};
    let html = '<div style="font-size:11px;color:var(--tx3);margin-bottom:10px">Window: <strong>' +
      esc(String(period.start_date || '')) +
      '</strong> \u2192 <strong>' +
      esc(String(period.end_date || '')) +
      '</strong></div>' +
      '<div class="stat-row stat-row-3" style="margin-bottom:14px">' +
      card('&#129532; Process completed', s.total_units||0, 'var(--gr)') +
      card('&#9202; Avg Cycle', fmtHMS(s.avg_sec), 'var(--am)') +
      card('&#128101; Workers', s.unique_workers||0, 'var(--bl)') +
      '</div>' +
      '<div class="stat-row stat-row-2" style="margin-bottom:14px">' +
      card('Active Time', fmtHMS(s.active_time_sec||0), 'var(--gr)') +
      card('Elapsed Time', fmtHMS(s.elapsed_time_sec||0), 'var(--am)') +
      card('Live In-Progress', fmtHMS(s.live_active_time_sec||0), 'var(--bl)') +
      card('Full Time', fmtHMS(s.full_time_sec||0), 'var(--pu)') +
      '</div>' +
      '<div class="stat-row stat-row-2" style="margin-bottom:14px">' +
      card('Tolerance credited', fmtHMS(s.tolerance_sec||0), 'var(--bl)') +
      card('Adjusted Full Time', fmtHMS(s.adjusted_full_time_sec||0), 'var(--gr)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);margin:-6px 0 10px">Adjusted full time applies empathy tolerance (mishaps + short interruptions).</div>' +
      '<div class="stat-row stat-row-3" style="margin-bottom:14px">' +
      card('Throughput/hr', (s.throughput_units_per_hour||0), 'var(--gr)') +
      card('Utilization', (s.utilization_pct||0) + '%', 'var(--am)') +
      card('Unique items', s.unique_items||0, 'var(--bl)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">By work type</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;font-size:11px">' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">T01: <b>'+(s.tailor_01||0)+'</b> &middot; T02: <b>'+(s.tailor_02||0)+'</b><br>Hand: <b>'+(s.hand_work||0)+'</b> &middot; Stone: <b>'+(s.stone_work||0)+'</b></div>' +
      '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">Btn: <b>'+(s.button||0)+'</b> &middot; Emb: <b>'+(s.embroidery||0)+'</b><br>Ari: <b>'+(s.ari_work||0)+'</b> &middot; H.Des: <b>'+(s.hand_designing||0)+'</b></div>' +
      '<div style="grid-column:1/-1;background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px">Inv: <b>'+(s.invoice_maker||0)+'</b> &middot; Pack: <b>'+(s.packaging||0)+'</b> &middot; Chk: <b>'+(s.checker||0)+'</b></div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
      card('Process vs prev', (insights.trend_vs_previous && insights.trend_vs_previous.total_units_delta) || 0, 'var(--gr)') +
      card('Active vs prev', fmtHMS((insights.trend_vs_previous && insights.trend_vs_previous.active_time_sec_delta) || 0), 'var(--am)') +
      card('Avg vs prev', fmtHMS((insights.trend_vs_previous && insights.trend_vs_previous.avg_sec_delta) || 0), 'var(--bl)') +
      '</div>' +
      '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">By employee \u2014 tap a name to see their day</div>' +
      '<div class="by-emp-table">' +
      '<div class="by-emp-head">' +
        '<span>Employee</span>' +
        '<span title="Finished process steps">Process</span>' +
        '<span>Active</span>' +
        '<span class="by-emp-col-hide-mid">Elapsed</span>' +
        '<span class="by-emp-col-hide-sm">Live</span>' +
        '<span>Full</span>' +
        '<span class="by-emp-col-hide-sm">Tol</span>' +
        '<span>Adj</span>' +
      '</div>' +
      '<div class="by-emp-body" style="max-height:340px;overflow-y:auto;border-radius:0 0 10px 10px">';

    (data.by_employee||[]).forEach(e => {
      const empId = String(e.emp_id || '');
      const empNameRaw = String(e.emp_name || e.emp_id || '');
      const empName = esc(empNameRaw);
      const empCode = esc(String(e.emp_code || ''));
      const empProcess = esc(String(e.emp_process || ''));
      // The popup deliberately does NOT repeat the time stats the row
      // already shows. It surfaces what the row can't fit compactly:
      // the employee's identity (avatar + name + processes), the
      // headline number (units, big), and the one-tap action.
      // Split name into whitespace-separated tokens without /s+/ \u2014 the
      // wrangler minifier strips backslashes from regex literals and would
      // ship /s+/ which throws on every page load. Take the first 2
      // non-empty tokens after collapsing runs of whitespace.
      const _nameParts = [];
      {
        const _raw = String(empNameRaw || '');
        let _cur = '';
        for (let _i = 0; _i < _raw.length; _i++) {
          const _cc = _raw.charCodeAt(_i);
          const _isSpace = _cc === 32 || _cc === 9 || _cc === 10 || _cc === 13;
          if (_isSpace) {
            if (_cur) { _nameParts.push(_cur); _cur = ''; if (_nameParts.length >= 2) break; }
          } else {
            _cur += _raw.charAt(_i);
          }
        }
        if (_cur && _nameParts.length < 2) _nameParts.push(_cur);
      }
      const initials = _nameParts
        .map(function (s) { return s.charAt(0).toUpperCase(); })
        .join('') || (empId ? empId.slice(-2).toUpperCase() : '?');
      const avatarColor = procColorUI(String(e.emp_process || ''));
      const processesAll = Array.isArray(e.emp_processes) && e.emp_processes.length
        ? e.emp_processes : (e.emp_process ? [e.emp_process] : []);
      const processesHtml = processesAll.map(function (p) {
        const c = procColorUI(p);
        return '<span class="by-emp-popup-process" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55">' +
          esc(String(p)) + '</span>';
      }).join('');
      // Desktop/tablet cells (7). Each gets a class for hide rules.
      // 'by-emp-col-hide-mid' hides at <=720px (tolerance + live)
      // 'by-emp-col-hide-sm'  hides at <=520px (elapsed + live + tolerance)
      html += '<div class="by-emp-row" tabindex="0" data-emp-id="' + esc(empId) + '"' +
        ' data-emp-name="' + empName + '" data-emp-process="' + empProcess + '"' +
        ' data-emp-code="' + empCode + '">' +
        '<span class="by-emp-name">' +
          '<span style="color:var(--tx);display:block;font-weight:600;line-height:1.25">' + empName + '</span>' +
          '<span style="color:var(--tx3);font-weight:400;font-size:11px;display:block;margin-top:2px">' + (empProcess||'') + (empCode?' &middot; '+empCode:'') + '</span>' +
        '</span>' +
        // Top row: name + units pill (mobile uses this)
        // Wide layout: each cell is its own grid cell
        '<span data-col="units"><span class="by-emp-units-pill">' + (e.units || 0) + '</span></span>' +
        '<span data-col="active" style="color:var(--gr);font-weight:700">' + fmtHMS(e.active_time_sec) + '</span>' +
        '<span data-col="elapsed" class="by-emp-col-hide-mid" style="color:var(--tx2)">' + fmtHMS(e.elapsed_time_sec) + '</span>' +
        '<span data-col="live" class="by-emp-col-hide-sm" style="color:var(--bl)">' + fmtHMS(e.live_active_time_sec) + '</span>' +
        '<span data-col="full" style="color:var(--pu);font-weight:700">' + fmtHMS(e.full_time_sec) + '</span>' +
        '<span data-col="tol" class="by-emp-col-hide-sm" style="color:var(--am)">' + fmtHMS(e.tolerance_sec) + '</span>' +
        '<span data-col="adj" style="color:var(--gr);font-weight:700">' + fmtHMS(e.adjusted_full_time_sec) + '</span>' +
        // Mobile-only horizontal stat strip (CSS turns off on wide)
        '<div class="by-emp-row-stats">' +
          '<div class="by-emp-stat">Active<b>' + fmtHMS(e.active_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Full<b>' + fmtHMS(e.full_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Adj<b>' + fmtHMS(e.adjusted_full_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Live<b>' + fmtHMS(e.live_active_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Elpsd<b>' + fmtHMS(e.elapsed_time_sec) + '</b></div>' +
          '<div class="by-emp-stat">Tol<b>' + fmtHMS(e.tolerance_sec) + '</b></div>' +
        '</div>' +
        '<div class="by-emp-popup" role="tooltip">' +
          '<div class="by-emp-popup-head">' +
            '<div class="by-emp-popup-avatar" style="background:' + avatarColor + '">' + esc(initials) + '</div>' +
            '<div style="min-width:0">' +
              '<div class="by-emp-popup-name">' + empName + '</div>' +
              (empCode ? '<div class="by-emp-popup-empcode">' + empCode + '</div>' : '') +
            '</div>' +
          '</div>' +
          (processesHtml ? '<div class="by-emp-popup-processes">' + processesHtml + '</div>' : '') +
          '<div class="by-emp-popup-units-row">' +
            '<div class="by-emp-popup-units-lbl" title="Finished process steps the employee completed this period">Process completed</div>' +
            '<div class="by-emp-popup-units-val">' + (e.units || 0) + '</div>' +
          '</div>' +
          '<a class="by-emp-popup-cta" href="javascript:void(0)" data-emp-id="' + esc(empId) + '">View their day &rarr;</a>' +
        '</div>' +
      '</div>';
    });
    if (!data.by_employee||!data.by_employee.length) {
      html += '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:12px">No data for this period</div>';
    }
    html += '</div></div>';

    const byProcess = data.by_process || [];
    if (byProcess.length) {
      html +=
        '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">By process (decision bottlenecks)</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;margin-bottom:14px;max-height:220px;overflow:auto">' +
        '<div style="min-width:560px">' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;color:var(--tx3)">' +
        '<span>Process</span><span style="text-align:right" title="Finished process steps at this station">Process completed</span><span style="text-align:right">Active</span><span style="text-align:right">Elapsed</span><span style="text-align:right">Live</span><span style="text-align:right">Full</span><span style="text-align:right">Tol</span><span style="text-align:right">Adj</span></div>';
      byProcess.forEach(function (p) {
        html +=
          '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
          '<span style="font-weight:600;color:'+procColorUI(p.emp_process)+'">' + esc(String(p.emp_process || '\u2014')) + '</span>' +
          '<span style="text-align:right">' + esc(String(p.units || 0)) + '</span>' +
          '<span style="text-align:right;color:var(--gr)">' + fmtHMS(p.active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--tx2)">' + fmtHMS(p.elapsed_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--bl)">' + fmtHMS(p.live_active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--pu);font-weight:700">' + fmtHMS(p.full_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--am)">' + fmtHMS(p.tolerance_sec) + '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(p.adjusted_full_time_sec) + '</span></div>';
      });
      html += '</div></div>';
    }

    // Month-by-month breakdown (yearly report only \u2014 server sends by_month for type=yearly).
    // Six columns aligned to the real meaning of the data:
    //   Month | Trend(Abayas) | Abayas | Process completed | Active time | Avg/abaya
    // The trend bar visualises ABYAS (the factory's real output), not raw
    // process steps. "Process completed" replaces the old "Units" label
    // because COUNT(*) is the number of finished process steps, not
    // finished garments \u2014 labelling it "Units" was misleading for a
    // garment factory.
    const byMonth = data.by_month || [];
    if (byMonth.length) {
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const maxAby = byMonth.reduce(function (m, r) { return Math.max(m, Number(r.abayas) || 0); }, 0) || 1;
      html +=
        '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">Month by month</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px">' +
        '<div style="display:grid;grid-template-columns:42px 1fr 60px 64px 80px 64px;gap:8px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px">' +
          '<span>Month</span><span>Trend (abayas)</span><span style="text-align:right" title="Distinct abaya ids with a finished session in this month">Abayas</span>' +
          '<span style="text-align:right" title="Total finished process steps the floor completed (Tailor, Hand Work, Button, etc.)">Process</span>' +
          '<span style="text-align:right" title="In-shift working minutes summed across every session that month">Active time</span>' +
          '<span style="text-align:right" title="Active time \xF7 distinct abayas = average minutes invested per garment that month">Avg / abaya</span>' +
        '</div>';
      byMonth.forEach(function (m) {
        const mi = parseInt(String(m.ym).slice(5, 7), 10) - 1;
        const aby = Number(m.abayas) || 0;
        const pct = Math.round((aby / maxAby) * 100);
        html +=
          '<div style="display:grid;grid-template-columns:42px 1fr 60px 64px 80px 64px;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
            '<span style="font-weight:600">' + esc(MONTHS[mi] || String(m.ym)) + '</span>' +
            '<span title="' + aby + ' abayas in ' + esc(MONTHS[mi] || String(m.ym)) + '" style="background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden"><span style="display:block;height:8px;width:' + pct + '%;background:var(--gr)"></span></span>' +
            '<span style="text-align:right;font-weight:700;color:var(--bl)" title="distinct abaya ids">' + aby + '</span>' +
            '<span style="text-align:right;font-weight:700" title="finished process steps">' + esc(String(m.units || 0)) + '</span>' +
            '<span style="text-align:right;color:var(--am)">' + fmtHMS(m.active_time_sec) + '</span>' +
            '<span style="text-align:right;color:var(--pu);font-weight:600" title="active_time \xF7 abayas">' + fmtHMS(m.avg_per_abaya_sec) + '</span>' +
          '</div>';
      });
      html += '</div>';
    }

    const itemTotals = data.item_totals || [];
    if (itemTotals.length) {
      html +=
        '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">Total time by item code (report period)</div>' +
        '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px;max-height:200px;overflow-y:auto">' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:9px;color:var(--tx3)">' +
        '<span>Item</span><span style="text-align:right">Steps</span><span style="text-align:right">Active</span><span style="text-align:right">Elapsed</span><span style="text-align:right">Live</span><span style="text-align:right">Full</span><span style="text-align:right">Tol</span><span style="text-align:right">Adj</span></div>';
      itemTotals.forEach(function (it) {
        const lab = it.abaya_code || it.abaya_id || '\u2014';
        const segs = it.segments != null ? it.segments : 0;
        html +=
          '<div style="display:grid;grid-template-columns:minmax(0,1fr) 40px 58px 58px 58px 58px 58px 58px;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:12px;align-items:center">' +
          '<span style="font-weight:600">' +
          esc(String(lab)) +
          '</span>' +
          '<span style="text-align:right;color:var(--tx3)">' +
          esc(String(segs)) +
          '</span>' +
          '<span style="text-align:right;color:var(--gr)">' + fmtHMS(it.active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--tx2)">' + fmtHMS(it.elapsed_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--bl)">' + fmtHMS(it.live_active_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--pu);font-weight:700">' + fmtHMS(it.full_time_sec) + '</span>' +
          '<span style="text-align:right;color:var(--am)">' + fmtHMS(it.tolerance_sec) + '</span>' +
          '<span style="text-align:right;color:var(--gr);font-weight:700">' + fmtHMS(it.adjusted_full_time_sec) + '</span></div>';
      });
      html += '</div>';
    }

    const invRows = data.invoice_maker_sessions || [];
    html += '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin:18px 0 8px">Invoice maker \u2014 numbers logged</div>';
    if (!invRows.length) {
      html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;padding:14px;font-size:12px;color:var(--tx3)">No invoice-maker sessions with saved invoice numbers in this period.</div>';
    } else {
      html += '<div style="background:var(--s2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;max-height:320px;overflow-y:auto">' +
        '<div style="display:grid;grid-template-columns:48px minmax(0,1fr) 36px minmax(0,1.2fr);gap:6px;padding:8px 10px;font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--bd);align-items:center">' +
        '<span>Time</span><span>Employee</span><span style="text-align:right">#</span><span>Invoice numbers</span></div>';
      invRows.forEach(function (row) {
        const t = new Date((Number(row.ended_at) || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: uiTz() });
        const nums = esc(String(row.invoice_serial || '')).replace(/,/g, ', ');
        html += '<div style="display:grid;grid-template-columns:48px minmax(0,1fr) 36px minmax(0,1.2fr);gap:6px;padding:8px 10px;border-bottom:1px solid rgba(54,45,89,.2);font-size:11px;align-items:start">' +
          '<span style="color:var(--tx3);white-space:nowrap">' + t + '</span>' +
          '<span style="font-weight:600;min-width:0">' + esc(row.emp_name || '') + '<span style="color:var(--tx3);font-weight:400"> \xB7 ' + esc(row.abaya_code || '\u2014') + '</span></span>' +
          '<span style="text-align:right;font-weight:700;color:var(--am)">' + (row.invoice_count != null ? esc(String(row.invoice_count)) : '\u2014') + '</span>' +
          '<span style="word-break:break-word;font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;color:var(--tx2);min-width:0">' + nums + '</span></div>';
      });
      html += '</div>';
    }

    document.getElementById('modal-body').innerHTML = html;
  } catch(e) {
    document.getElementById('modal-body').innerHTML = '<div style="color:var(--rd);text-align:center;padding:20px">Failed to load report: '+e.message+'</div>';
  }
}

function card(label, val, color) {
  // Use the same .stat-card class as the dashboard KPI bar so the
  // tick-up + lift + click-ripple animations apply uniformly.
  const safeVal = (val == null) ? '\u2014' : String(val);
  return '<div class="stat-card" style="text-align:center">' +
    '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">'+label+'</div>' +
    '<div class="stat-val" data-stat-tick="' + esc(safeVal) + '" style="font-size:20px;font-weight:800;color:'+color+'">'+safeVal+'</div></div>';
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  lastModalAnalytics = null;
  lastModalTrace = null;
}

function exportWA() {
  if (lastModalAnalytics) {
    const d = lastModalAnalytics;
    const lines = [
      '[Analytics] *AbaYa Track - Process analytics*',
      'Period: *' + escWA(d.period || '') + '*',
      'Window: *' + escWA(windowLabelFromRange(d.start_date, d.end_date)) + '*' + (d.fallback_applied ? ' (previous-day fallback)' : ''),
      '_' + new Date().toLocaleString([], { timeZone: uiTz() }) + '_',
      '',
      '[Bottlenecks] *slowest avg first*',
    ];
    (d.by_process || []).forEach(function (r) {
      lines.push('- ' + escWA(r.emp_process) + ': avg *' + fmtHMS(r.avg_sec) + '* (' + r.units + ' units)');
    });
    lines.push('');
    lines.push('[Fastest] *per process (2+ samples)*');
    (d.fastest_per_process || []).forEach(function (r) {
      lines.push(
        '- ' +
          escWA(r.emp_process) +
          ': *' +
          escWA(r.emp_name) +
          '* avg ' +
          fmtHMS(r.avg_sec) +
          ' (' +
          r.units +
          ' u)'
      );
    });
    lines.push('');
    lines.push('[Leaders] *Speed leaders (overall)*');
    (d.speed_leaders || []).slice(0, 15).forEach(function (r, i) {
      lines.push(
        i +
          1 +
          '. ' +
          escWA(r.emp_name) +
          ' \u2014 ' +
          fmtHMS(r.avg_sec) +
          ' (' +
          r.units +
          ' units, ' +
          escWA(r.emp_process) +
          ')'
      );
    });
    lines.push('');
    lines.push('_AbaYa Track - Cloudflare D1_');
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\\n')), '_blank');
    closeModal();
    return;
  }
  if (lastModalTrace) {
    const d = lastModalTrace;
    const sumDone = Math.floor(Number(d.sum_duration_sec) || 0);
    const actSec = Math.floor(Number(d.active_seconds) || 0);
    const sumAll = Math.floor(Number(d.sum_with_active_sec) != null ? d.sum_with_active_sec : sumDone + actSec);
    const lines = [
      '[Trace] *Garment trace: ' + escWA(d.q || '') + '*',
      '_Finished: ' +
        fmtHMS(sumDone) +
        (actSec ? ' + in progress ' + fmtHMS(actSec) : '') +
        ' = ' +
        fmtHMS(sumAll) +
        ' (' +
        (d.session_count || 0) +
        ' steps)_',
      '',
    ];
    (d.rows || []).forEach(function (r) {
      lines.push('- ' + escWA(r.emp_name) + ' | ' + escWA(r.emp_process) + ' | ' + fmtHMS(logDurationSec(r)));
    });
    lines.push('');
    lines.push('_AbaYa Track_');
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\\n')), '_blank');
    closeModal();
    return;
  }
  if (!lastReportData) return;
  const s = lastReportData.summary || {};
  const insights = lastReportData.insights || {};
  const trend = insights.trend_vs_previous || {};
  const period = lastReportData.period || {};
  const lines = [
    '[Report] *AbaYa Track - ' +
      activeReportType.charAt(0).toUpperCase() +
      activeReportType.slice(1) +
      ' Report*',
    '_' + new Date().toLocaleString([], { timeZone: uiTz() }) + '_',
    '',
    'Window: *' + escWA(windowLabelFromRange(period.start_date, period.end_date)) + '*' + (period.fallback_applied ? ' (previous-day fallback)' : ''),
    '',
    '*Summary*',
    '- Total Output: *' + (s.total_units || 0) + ' units*',
    '- Avg Cycle: *' + fmtHMS(s.avg_sec) + '*',
    '- Active: *' + fmtHMS(s.active_time_sec || 0) + '* | Elapsed: *' + fmtHMS(s.elapsed_time_sec || 0) + '*',
    '- Live: *' + fmtHMS(s.live_active_time_sec || 0) + '* | Full: *' + fmtHMS(s.full_time_sec || 0) + '*',
    '- Tolerance: *' + fmtHMS(s.tolerance_sec || 0) + '* | Adjusted Full: *' + fmtHMS(s.adjusted_full_time_sec || 0) + '*',
    '- Throughput: *' + (s.throughput_units_per_hour || 0) + ' units/hr* | Utilization: *' + (s.utilization_pct || 0) + '%*',
    '- T01: ' +
      (s.tailor_01 || 0) +
      ' | T02: ' +
      (s.tailor_02 || 0) +
      ' | Hand: ' +
      (s.hand_work || 0) +
      ' | Stone: ' +
      (s.stone_work || 0),
    '- Btn: ' +
      (s.button || 0) +
      ' | Emb: ' +
      (s.embroidery || 0) +
      ' | Ari: ' +
      (s.ari_work || 0) +
      ' | H.Des: ' +
      (s.hand_designing || 0),
    '- Inv: ' +
      (s.invoice_maker || 0) +
      ' | Pack: ' +
      (s.packaging || 0) +
      ' | Chk: ' +
      (s.checker || 0),
    '- Vs previous: Process completed ' + (trend.total_units_delta || 0) + ', Active ' + fmtHMS(trend.active_time_sec_delta || 0) + ', Avg ' + fmtHMS(trend.avg_sec_delta || 0),
    '',
    '*Top Performers*',
  ];
  (lastReportData.by_employee || []).slice(0, 5).forEach(function (e, i) {
    lines.push(
      i +
        1 +
        '. ' +
        escWA(e.emp_name) +
        ' \u2014 ' +
        e.units +
        ' process completed (' +
        escWA(e.emp_process) +
        '), full ' +
        fmtHMS(e.full_time_sec) +
        ', tol ' +
        fmtHMS(e.tolerance_sec) +
        ', adj ' +
        fmtHMS(e.adjusted_full_time_sec)
    );
  });
  lines.push('');
  lines.push('*Top Bottleneck Processes (by full time)*');
  (lastReportData.by_process || []).slice(0, 5).forEach(function (p) {
    lines.push(
      '\u2022 ' +
        escWA(p.emp_process) +
        ': full ' +
        fmtHMS(p.full_time_sec) +
        ' (active ' +
        fmtHMS(p.active_time_sec) +
        ', elapsed ' +
        fmtHMS(p.elapsed_time_sec) +
        ')'
    );
  });
  const invs = lastReportData.invoice_maker_sessions || [];
  lines.push('');
  lines.push('*Invoice maker - numbers*');
  if (!invs.length) {
    lines.push('_No rows with saved lists in this period._');
  } else {
    invs.slice(0, 12).forEach(function (row, i) {
      const line = String(row.invoice_serial || '').replace(/,/g, ', ');
      const short = line.length > 100 ? line.slice(0, 100) + '\u2026' : line;
      lines.push(
        i + 1 +
          '. ' +
          escWA(row.emp_name) +
          ' \u2014 count ' +
          escWA(row.invoice_count != null ? row.invoice_count : '?') +
          ': ' +
          escWA(short)
      );
    });
    if (invs.length > 12) {
      lines.push('_+' + (invs.length - 12) + ' more in dashboard report._');
    }
  }
  lines.push('');
  lines.push('_AbaYa Track - Powered by Cloudflare_');
  window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\\n')), '_blank');
  closeModal();
}

function showToast(msg,type) {
  const t=document.getElementById('toast');
  t.className='toast '+(type||'info')+' show';
  t.textContent=msg;
  clearTimeout(t._t);
  t._t=setTimeout(()=>t.classList.remove('show'),3500);
}

// \u2500\u2500\u2500 MICRO-INTERACTIONS ON STAT CARDS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Three layers: (1) tick-up from 0 on first render, (2) stagger reveal,
// (3) hover lift + click ripple. Re-runs are safe; values that don't
// change won't re-tick, and DOM elements are tagged with a data-attr
// so we don't re-attach listeners twice.

function parseStatNumber(s) {
  // Accept "1,039", "2h 12m 38s", "55.9%", "\u2014", etc.
  // No regex literals here: wrangler's minifier strips backslashes from
  // /d/ /s/ patterns and ships /d/ /s/ which throw on every page load.
  // All parsing is done with explicit char-by-char checks instead.
  if (s == null) return null;
  const str = String(s).trim();
  if (!str || str === '\u2014' || str === '-') return null;

  function _isDigit(c) {
    const cc = c.charCodeAt(0);
    return cc >= 48 && cc <= 57;
  }
  function _allDigits(s2) {
    if (!s2.length) return false;
    for (let i = 0; i < s2.length; i++) if (!_isDigit(s2.charAt(i))) return false;
    return true;
  }

  // Plain integer or decimal with thousands separators: "-1,039", "12.5".
  if (str.charAt(0) === '-' || _isDigit(str.charAt(0))) {
    let _ok = true;
    let _sawDigit = false;
    let _sawDot = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      if (_isDigit(ch)) { _sawDigit = true; continue; }
      if (ch === ',') continue;
      if (ch === '.' && !_sawDot) { _sawDot = true; continue; }
      _ok = false; break;
    }
    if (_ok && _sawDigit) {
      return { value: Number(str.replace(/,/g, '')), kind: 'num', suffix: '' };
    }
  }

  // Percentage: "-12.5%" or "55.9%".
  if (str.charAt(str.length - 1) === '%') {
    const _body = str.slice(0, -1).trim();
    if (_body.length && (_body.charAt(0) === '-' || _isDigit(_body.charAt(0)))) {
      let _ok2 = true; let _sawDigit2 = false; let _sawDot2 = false;
      for (let i = 0; i < _body.length; i++) {
        const ch = _body.charAt(i);
        if (_isDigit(ch)) { _sawDigit2 = true; continue; }
        if (ch === '.' && !_sawDot2) { _sawDot2 = true; continue; }
        _ok2 = false; break;
      }
      if (_ok2 && _sawDigit2) return { value: Number(_body), kind: 'num', suffix: '%' };
    }
  }

  // HMS: "2h 12m 38s", "12m 5s", "45s", "3h". Tokens are split on
  // whitespace, each unit is "<digits><h|m|s>".
  {
    const _toks = str.split(' ');
    let _h = 0, _mi = 0, _se = 0;
    let _matched = false;
    for (let i = 0; i < _toks.length; i++) {
      const t = _toks[i];
      if (!t) continue;
      const last = t.charAt(t.length - 1);
      const num = t.slice(0, -1);
      if (last === 'h' && num.length && _allDigits(num)) { _h = Number(num); _matched = true; continue; }
      if (last === 'm' && num.length && _allDigits(num)) { _mi = Number(num); _matched = true; continue; }
      if (last === 's' && num.length && _allDigits(num)) { _se = Number(num); _matched = true; continue; }
      _matched = false; break;
    }
    if (_matched) {
      return { value: _h * 3600 + _mi * 60 + _se, kind: 'hms', suffix: '' };
    }
  }

  return null;
}

function fmtTickValue(target, kind, suffix) {
  if (kind === 'hms') {
    return fmtHMS(Math.round(target));
  }
  // Numbers: thousands separator if large, decimals only if present.
  const n = Math.round(target);
  return (n === 0 ? '0' : n.toLocaleString('en-US')) + suffix;
}

function tickStatValue(el, targetStr, opts) {
  if (!el) return;
  opts = opts || {};
  const dur = opts.duration || 700;
  if (el.__statWired) {
    // Already animated once; just update the text without re-ticking.
    const parsed = parseStatNumber(targetStr);
    if (parsed) el.textContent = fmtTickValue(parsed.value, parsed.kind, parsed.suffix);
    else el.textContent = String(targetStr);
    return;
  }
  el.__statWired = true;
  const parsed = parseStatNumber(targetStr);
  if (!parsed) { el.textContent = String(targetStr); return; }
  // Respect reduced motion: skip the tick, just set the value.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmtTickValue(parsed.value, parsed.kind, parsed.suffix);
    return;
  }
  const from = 0;
  const to = parsed.value;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    // ease-out cubic
    const e = 1 - Math.pow(1 - t, 3);
    const v = from + (to - from) * e;
    el.textContent = fmtTickValue(v, parsed.kind, parsed.suffix);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmtTickValue(to, parsed.kind, parsed.suffix);
  }
  el.textContent = fmtTickValue(0, parsed.kind, parsed.suffix);
  requestAnimationFrame(step);
}

// Walk a stat-card grid and animate every numeric value inside.
function animateStatGrid(root, opts) {
  if (!root) return;
  const cards = root.querySelectorAll('.stat-card');
  cards.forEach(function (card, i) {
    // Stagger reveal
    card.style.setProperty('--stagger-i', i);
    card.classList.add('stat-card-enter');
    // Tick any value or sub that's a parseable number
    card.querySelectorAll('[data-stat-tick]').forEach(function (el) {
      tickStatValue(el, el.getAttribute('data-stat-tick'), opts);
    });
  });
  // Hover lift + click ripple (delegated on the grid, attached once)
  if (!root.__statWired) {
    root.__statWired = true;
    root.addEventListener('click', function (ev) {
      const card = ev.target.closest && ev.target.closest('.stat-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const span = Math.max(r.width, r.height);
      const ink = document.createElement('span');
      ink.className = 'stat-card-ink';
      ink.style.width = ink.style.height = span + 'px';
      ink.style.left = (x - span / 2) + 'px';
      ink.style.top = (y - span / 2) + 'px';
      card.appendChild(ink);
      setTimeout(function () { ink.remove(); }, 600);
    });
  }
}

// \u2500\u2500\u2500 BOOT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Delegated click handler for the by-employee rows in the analytics modal.
// The row carries data-emp-id (no inline onclick = no escape-trap syntax
// errors). Clicks on the row OR on the popup's "View their day" CTA both
// open the singular day report. Keyboard Enter / Space on a focused row
// also works because the row is tabindex=0.
function wireByEmpRowDelegation() {
  const body = document.getElementById('modal-body');
  if (!body || body.__byEmpWired) return;
  body.__byEmpWired = true;
  body.addEventListener('click', function (ev) {
    const cta = ev.target.closest && ev.target.closest('.by-emp-popup-cta');
    if (cta) {
      ev.preventDefault();
      const id = String(cta.getAttribute('data-emp-id') || '');
      if (id) openEmployeeDay(id);
      return;
    }
    const row = ev.target.closest && ev.target.closest('.by-emp-row');
    if (row) {
      const id = String(row.getAttribute('data-emp-id') || '');
      if (id) openEmployeeDay(id);
    }
  });
  body.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest && ev.target.closest('.by-emp-row');
    if (!row) return;
    ev.preventDefault();
    const id = String(row.getAttribute('data-emp-id') || '');
    if (id) openEmployeeDay(id);
  });
}

loadAbayaCatalog().then(function () {
  renderAbayaTotalsTable();
});
loadEmployeeDayOptions();
wireTraceCombobox();
schedulePollLoop();
wireByEmpRowDelegation();
// v1.2.32: 1Hz tick on the live cells so the "active today" and "this
// build" counters advance every second even between poll-driven renders.
// The poll cadence is 1s when active sessions exist, but the underlying
// in-shift walk uses 60s/600s/3600s steps so the displayed text would
// otherwise jump once a minute. The tick keeps the text fresh without
// rebuilding the DOM \u2014 same pattern as public/dashboard.js's offline
// tick. Pauses while the tab is hidden (visibilitychange resumes) and
// while the session has expired (no point ticking a stale page).
setInterval(function () {
  if (typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible') return;
  if (sessionExpired) return;
  try { tickLiveSessions(); } catch (_) { /* never let a tick break the page */ }
}, 1000);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') poll();
});
setInterval(function () {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible' || sessionExpired) return;
  fetch(BASE + '/api/ceo/session/refresh', { method: 'POST', credentials: 'same-origin' }).catch(
    function () {}
  );
}, 25 * 60 * 1000);
setInterval(function () {
  var syncEl = document.getElementById('sync-status');
  if (syncEl && pollInFlight && Date.now() - pollStartedAt > 12000) {
    syncEl.textContent = 'Polling timeout \u2014 check network / session / service worker';
  }
  const d = document.getElementById('dash-date');
  const ft = STATE.factory_today || '';
  const pickedD = getPickedReportDate();
  const pickedM = getPickedReportMonth();
  if (d) {
    let head = '';
    if (pickedD) head = 'Showing picked date ' + pickedD + ' (factory today is ' + ft + ') \u2014 ';
    else if (pickedM) head = 'Showing month ' + pickedM + ' (factory today is ' + ft + ') \u2014 ';
    else if (ft) head = 'Factory day ' + ft + ' \u2014 ';
    d.textContent = head + new Date().toLocaleTimeString([], { timeZone: uiTz() });
  }
  const dn = document.getElementById('dubai-now');
  if (dn) dn.textContent = 'Dubai time: ' + uiNowString();
  const ws = document.getElementById('work-status');
  if (ws) ws.textContent = 'Status: ' + String(STATE.working_status || '--');
}, 2000);

// \u2500\u2500 Customer notifications add-on (CEO toggle + usage meter) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
(function () {
  var card = document.createElement('div');
  card.id = 'msg-addon';
  card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:14px 16px;font-family:system-ui,sans-serif;max-width:300px';
  card.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">' +
      '<div><div style="font-weight:700;font-size:13px;color:#0f172a">Customer notifications</div>' +
      '<div id="msg-sub" style="font-size:11px;color:#64748b;margin-top:2px">Loading\u2026</div></div>' +
      '<button id="msg-toggle" role="switch" aria-checked="false" aria-label="Toggle customer notifications" ' +
        'style="position:relative;width:46px;height:26px;border-radius:999px;border:none;background:#cbd5e1;cursor:pointer;flex-shrink:0;transition:background .2s">' +
        '<span id="msg-knob" style="position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.25)"></span>' +
      '</button>' +
    '</div>';
  document.body.appendChild(card);
  var sub = card.querySelector('#msg-sub');
  var btn = card.querySelector('#msg-toggle');
  var knob = card.querySelector('#msg-knob');
  var enabled = false, busy = false;

  function paint() {
    btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
    btn.style.background = enabled ? '#14b8a6' : '#cbd5e1';
    knob.style.left = enabled ? '23px' : '3px';
  }
  function load() {
    fetch(BASE + '/api/messaging/status', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { sub.textContent = 'Sign in to manage'; return; }
        enabled = !!d.enabled;
        sub.textContent = (enabled ? 'On' : 'Off') + ' \xB7 ' + (d.periodCount || 0) + ' sent this month (' + (d.sentCount || 0) + ' total)';
        paint();
      })
      .catch(function () { sub.textContent = 'Unavailable'; });
  }
  btn.addEventListener('click', function () {
    if (busy) return; busy = true;
    var next = !enabled;
    fetch(BASE + '/api/messaging/toggle', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) { enabled = !!d.enabled; paint(); } busy = false; load(); })
      .catch(function () { busy = false; });
  });
  load();
  setInterval(load, 60000);
})();

/* \u2500\u2500\u2500 Check Delivery Report (calendar + per-factory delivery summary) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Reuses the same dark-purple palette. Server is on the same origin so the
 * BASE constant from the surrounding dashboard script is reused directly.
 * The user picks a date or range + a factory (or "All factories" for the
 * overall headline), and the report shows:
 *   1. Overall delivery summary (Invoices / Abayas / Delivered / Pending /
 *      Cancelled) as five big stat cards under a "Delivery summary" header.
 *   2. Per-factory drill-down \u2014 each factory as its own card with a sub-grid
 *      of invoices and abayas, plus mini status pills.
 *   3. Cancellations section (cloud-side) appended at the bottom. */
(function initCheckReport() {
  // fetchJsonSafe is not inlined in the dashboard helper bundle. Define a
  // tiny local equivalent so the IIFE stays self-contained.
  //
  // The old version (r => r.json()) blindly parsed the body as JSON and
  // caught errors as null. That swallowed the server's actual error message
  // on a 4xx/5xx (e.g. "Session expired. Please sign in again.") and
  // turned every failure into a generic "Network error" toast, which
  // makes the operator's "Check Delivery" modal look broken when in fact
  // it's a stale CEO session. This version:
  //   - reads the body as text first
  //   - tries to parse as JSON and surface server's error field on non-2xx
  //   - falls back to "HTTP <status> <first 200 bytes>" for HTML / empty
  //     bodies, and logs the full URL+status+body to console for diagnosis
  //   - throws a real Error on non-2xx so the caller can branch (e.g. 401
  //     -> refresh session and retry)
  function crFetchJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      var looksJson = ct.indexOf('application/json') !== -1;
      // Read the body as text first so we can both parse it and surface
      // a useful slice of non-JSON bodies in the toast / console.
      return r.text().then(function (txt) {
        var parsed = null;
        if (txt && (looksJson || txt.charCodeAt(0) === 123 || txt.charCodeAt(0) === 91)) {
          try { parsed = JSON.parse(txt); } catch (_) { parsed = null; }
        }
        if (r.ok) {
          // If the body is non-empty but unparseable, the server is
          // misbehaving. Throw so the caller shows a real error rather
          // than silently treating the malformed body as a report.
          if (parsed == null && txt) {
            console.error('[check-delivery] 2xx but unparseable body', { url: url, status: r.status, body: txt.slice(0, 200) });
            throw new Error('Bad response (HTTP ' + r.status + ', non-JSON body)');
          }
          return parsed;
        }
        // Non-2xx: surface the server's error message when we can.
        var msg = (parsed && (parsed.error || parsed.message)) || ('HTTP ' + r.status);
        if (!parsed && txt) msg = msg + ' \u2014 ' + txt.slice(0, 200);
        console.error('[check-delivery] non-2xx', { url: url, status: r.status, body: txt.slice(0, 200) });
        var err = new Error(msg);
        err.status = r.status;
        err.url = url;
        throw err;
      });
    });
  }
  const tz = 'Asia/Dubai';
  const state = {
    step: 'calendar',
    config: null,
    factory: '',
    viewYear: 0,
    viewMonth: 0,
    todayYmd: '',
    fromYmd: '',
    toYmd: '',
    report: null,
  };

  function ymdInTz(epochSec) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epochSec * 1000));
    } catch (_) { return ''; }
  }
  function ymdInTzMs(epochMs) { return ymdInTz(Math.floor(epochMs / 1000)); }
  function longInTz(ymd) {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
    const noon = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(noon));
  }
  function rangeLabel() {
    if (!state.fromYmd) return 'No date selected';
    if (state.fromYmd === state.toYmd) return longInTz(state.fromYmd);
    return longInTz(state.fromYmd) + ' \u2192 ' + longInTz(state.toYmd);
  }

  function openCheckReport() {
    const m = document.getElementById('modal-check');
    if (!m) return;
    m.classList.add('open');
    state.step = 'calendar';
    crFetchJson(BASE + '/api/check-delivery-report/config').then(function (j) {
      if (j && j.ok) {
        state.config = j;
        // Default to "All factories" so the user lands on the overall
        // summary first; can pick a specific factory from the dropdown.
        state.factory = '';
        state.todayYmd = j.todayYmd || ymdInTzMs(Date.now());
      } else {
        state.todayYmd = ymdInTzMs(Date.now());
      }
      const p = state.todayYmd.split('-');
      state.viewYear = parseInt(p[0], 10);
      state.viewMonth = parseInt(p[1], 10) - 1;
      state.fromYmd = state.todayYmd;
      state.toYmd = state.todayYmd;
      renderCalendar();
    }).catch(function () {
      state.todayYmd = ymdInTzMs(Date.now());
      const p = state.todayYmd.split('-');
      state.viewYear = parseInt(p[0], 10);
      state.viewMonth = parseInt(p[1], 10) - 1;
      state.fromYmd = state.todayYmd;
      state.toYmd = state.todayYmd;
      renderCalendar();
    });
  }
  function closeCheckReport() {
    const m = document.getElementById('modal-check');
    if (m) m.classList.remove('open');
  }
  window.closeCheckReport = closeCheckReport;
  window.openCheckReport = openCheckReport;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function renderCalendar() {
    const body = document.getElementById('cr-body');
    const sub  = document.getElementById('cr-sub');
    const acts = document.getElementById('cr-actions');
    if (!body) return;
    if (sub) sub.textContent = 'Pick a single date or a range. Production timezone: ' + tz + '.';
    const year = state.viewYear;
    const month = state.viewMonth;
    const firstWd = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let cells = '';
    for (let i = firstWd - 1; i >= 0; i--) {
      cells += '<div class="cr-cell muted">' + (prevMonthDays - i) + '</div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = year + '-' + pad2(month + 1) + '-' + pad2(d);
      const cls = ['cr-cell'];
      if (ymd === state.todayYmd) cls.push('today');
      if (ymd === state.fromYmd || ymd === state.toYmd) cls.push('selected');
      else if (state.fromYmd && state.toYmd && ymd >= state.fromYmd && ymd <= state.toYmd) cls.push('in-range');
      cells += '<div class="' + cls.join(' ') + '" data-ymd="' + ymd + '" onclick="crSel(this.dataset.ymd)">' + d + '</div>';
    }
    const totalCells = firstWd + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) cells += '<div class="cr-cell muted">' + i + '</div>';

    const monthName = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(year, month, 15)));
    const factories = (state.config && state.config.factories) || ['Main Factory'];
    // "All factories" sentinel = empty string. The dashboard defaults to this
    // so the headline numbers are the first thing the user sees.
    const factoryOpts = '<option value=""' + (state.factory === '' ? ' selected' : '') + '>All factories</option>' +
      factories.map(function (f) {
        return '<option value="' + escapeAttr(f) + '"' + (f === state.factory ? ' selected' : '') + '>' + escapeHtml(f) + '</option>';
      }).join('');

    body.innerHTML =
      '<div class="cr-cal">' +
        '<div class="cr-cal-head">' +
          '<div class="cr-nav"><button class="cr-nav-btn" onclick="crNav(-1)">&#9664; Prev</button></div>' +
          '<div class="cr-cal-title">' + escapeHtml(monthName) + '</div>' +
          '<div class="cr-nav">' +
            '<button class="cr-nav-btn" onclick="crToday()">Today</button>' +
            '<button class="cr-nav-btn" onclick="crNav(1)">Next &#9654;</button>' +
          '</div>' +
        '</div>' +
        '<div class="cr-weekdays">' +
          ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function (w) { return '<div class="cr-wd">' + w + '</div>'; }).join('') +
        '</div>' +
        '<div class="cr-grid">' + cells + '</div>' +
      '</div>' +
      '<div class="cr-summary">' +
        '<div class="cr-factory-pick">' +
          '<span>Factory</span>' +
          '<select id="cr-factory" onchange="CR_STATE_FACTORY=this.value">' + factoryOpts + '</select>' +
        '</div>' +
        '<div><b id="cr-range-label">' + escapeHtml(rangeLabel()) + '</b>' +
          ' &middot; <span style="color:var(--tx3)">pick a date or range, then Check Delivery Report</span></div>' +
      '</div>';
    if (acts) {
      acts.innerHTML =
        '<button class="btn-close" onclick="closeCheckReport()">Close</button>' +
        '<button class="btn-export" style="background:linear-gradient(135deg,#6a5fc1,#422082)" onclick="crSubmit()">&#128230; Check Delivery Report</button>';
    }
  }
  // Expose a small bridge for the inline onchange so the factory select can
  // update the state without a closure-routed setter.
  window.CR_STATE_FACTORY = '';
  Object.defineProperty(window, 'CR_STATE_FACTORY', {
    get: function () { return state.factory; },
    set: function (v) { state.factory = v; },
  });

  window.crNav = function (delta) {
    let m = state.viewMonth + delta;
    let y = state.viewYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    state.viewYear = y; state.viewMonth = m;
    renderCalendar();
  };
  window.crToday = function () {
    const p = state.todayYmd.split('-');
    state.viewYear = parseInt(p[0], 10);
    state.viewMonth = parseInt(p[1], 10) - 1;
    state.fromYmd = state.todayYmd;
    state.toYmd = state.todayYmd;
    renderCalendar();
  };
  window.crSel = function (ymd) {
    if (!ymd) return;
    if (!state.fromYmd) { state.fromYmd = ymd; state.toYmd = ymd; }
    else if (state.fromYmd === state.toYmd) {
      if (ymd !== state.fromYmd) {
        if (ymd > state.fromYmd) state.toYmd = ymd;
        else { state.toYmd = state.fromYmd; state.fromYmd = ymd; }
      }
    } else { state.fromYmd = ymd; state.toYmd = ymd; }
    renderCalendar();
  };
  window.crSubmit = function () {
    if (!state.fromYmd) { showToast('Pick a date first'); return; }
    // Reshape the server's compact aggregation into the nested
    // factories[].invoices[] shape the renderers and crWhatsApp expect.
    // Inputs:  j.byLocation[] (per-showroom totals), j.groups[]
    //          (per-(location, invoice) detail with rows[]), j.cancellations[]
    // Outputs: j.factories[] with name, totals, invoices[] (each with
    //          no, abayas[{code, timestamp, status}], totals), and
    //          j.cancellations[] with reason (renamed from
    //          cancellationReason) for the cancel row renderer.
    function transformReport(j) {
      if (!j) return j;
      // Group per-location invoices from the server's flat groups[].
      const invoiceByLoc = new Map();
      const groups = Array.isArray(j.groups) ? j.groups : [];
      for (const g of groups) {
        const loc = String(g.location || 'Unspecified');
        let bucket = invoiceByLoc.get(loc);
        if (!bucket) { bucket = []; invoiceByLoc.set(loc, bucket); }
        const rows = Array.isArray(g.rows) ? g.rows : [];
        const totals = { abayas: rows.length, delivered: 0, pending: 0, cancelled: 0 };
        for (const r of rows) {
          if (r.status === 'completed') totals.delivered += 1;
          else if (r.status === 'cancelled') totals.cancelled += 1;
          else totals.pending += 1;
        }
        bucket.push({
          no: g.invoiceNo,
          // Mark a synthetic "(no invoice)" entry when the group has no
          // invoiceNo -- matches what the old server path used to emit
          // so the renderers' inv.synthetic ? '(no invoice)' : inv.no
          // ternary keeps working.
          synthetic: !g.invoiceNo,
          totals,
          abayas: rows.map(function (r) {
            return {
              code: r.abayaCode || '',
              status: r.status || 'pending',
              // Renderers expect a millisecond timestamp.
              timestamp: r.eventAt ? Date.parse(r.eventAt) : null,
            };
          }),
        });
      }
      // Build the factories[] array. Use the server's factories[] as the
      // source of truth for name + totals (it already has the
      // per-showroom rollups) and stitch in the per-invoice drill-down
      // we just computed.
      const serverFactories = Array.isArray(j.factories) ? j.factories : [];
      const byLocName = new Map((Array.isArray(j.byLocation) ? j.byLocation : []).map(function (lt) {
        return [String(lt.location || ''), lt];
      }));
      const factories = (serverFactories.length ? serverFactories : Array.from(byLocName.values()).map(function (lt) {
        return { name: lt.location, totals: {
          invoices: lt.invoices, abayas: lt.abayas, delivered: lt.delivered,
          pending: lt.pending, cancelled: lt.cancelled,
        } };
      })).map(function (f) {
        const loc = String(f.name || '');
        return Object.assign({}, f, { invoices: invoiceByLoc.get(loc) || [] });
      });
      // Cancellations: rename cancellationReason -> reason so the
      // cancel-row renderer (which reads c.reason) doesn't render
      // "undefined" inline.
      const cancellations = (Array.isArray(j.cancellations) ? j.cancellations : []).map(function (c) {
        const out = Object.assign({}, c);
        if (typeof out.reason === 'undefined' && typeof out.cancellationReason !== 'undefined') {
          out.reason = out.cancellationReason;
        }
        return out;
      });
      // Return a shallow-copied object so we never mutate the response
      // and risk a future caller seeing the wrong shape.
      return Object.assign({}, j, { factories: factories, cancellations: cancellations });
    }
    function buildUrl() {
      const params = new URLSearchParams();
      params.set('from', state.fromYmd);
      params.set('to', state.toYmd);
      if (state.factory) params.set('factory', state.factory);
      params.set('ts', String(Date.now()));
      return BASE + '/api/check-delivery-report?' + params.toString();
    }
    // One auto-retry on a 401 'Session expired' response: reissue the
    // session via the existing /api/ceo/session/refresh endpoint, then
    // retry the report fetch. Mirrors the pattern in the main poll()
    // loop. Transparent to the operator -- if the refresh also fails
    // (e.g. the refresh JWT itself expired) we fall through to the
    // generic toast.
    function fetchReport(attemptedRefresh) {
      crFetchJson(buildUrl()).then(function (j) {
        if (!j || !j.ok) { showToast((j && j.error) || 'Could not load report'); return; }
        // The server returns a compact aggregation (byLocation + groups).
        // The renderers + crWhatsApp expect a nested shape (factories with
        // invoices[] inside). The server's factories field only carries
        // name + totals -- no per-invoice drill-down -- which made
        // factorySection blow up on f.invoices.map(...) with
        // "Cannot read properties of undefined (reading 'map')". Map
        // groups[] into the nested shape here, on the client, so we
        // don't have to change the worker or the leaderboard proxy.
        try { j = transformReport(j); } catch (e) {
          console.error('[check-delivery] transform failed', e);
          showToast('Could not load report: ' + ((e && e.message) || 'bad shape'));
          return;
        }
        state.report = j;
        state.step = 'report';
        renderReport();
      }).catch(function (e) {
        var status = e && e.status;
        if (status === 401 && !attemptedRefresh) {
          fetch(BASE + '/api/ceo/session/refresh', {
            method: 'POST',
            credentials: 'same-origin',
          }).then(function (ref) {
            if (ref && ref.ok) return fetchReport(true);
            // Refresh failed -- surface the original 401 message verbatim.
            showToast('Session expired. Please sign in again.');
          }).catch(function () {
            showToast('Session expired. Please sign in again.');
          });
          return;
        }
        // Non-401 errors: surface the real message from the server (or
        // the network / parse error). e.message is the human-readable
        // text the new crFetchJson builds.
        showToast('Could not load report: ' + ((e && e.message) || 'Network error'));
      });
    }
    fetchReport(false);
  };

  function statCard(label, val, kind) {
    return '<div class="cr-tot"><div class="cr-tot-lbl">' + escapeHtml(label) +
      '</div><div class="cr-tot-val ' + kind + '">' + Number(val || 0) + '</div></div>';
  }
  function miniStat(label, val, kind) {
    return ' <span class="cr-status ' + kind + '">' + Number(val || 0) + ' ' + escapeHtml(label) + '</span>';
  }
  function abayaRowHtml(a) {
    const when = a.timestamp ? new Date(a.timestamp).toLocaleString([], {
      timeZone: tz, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '';
    return '<div class="cr-abaya"><span>' + escapeHtml(a.code) +
      (when ? ' <span style="color:var(--tx3);font-size:10px">&middot; ' + escapeHtml(when) + '</span>' : '') +
      '</span><span class="cr-status ' + (a.status || '').toLowerCase() + '">' + escapeHtml(a.status || '\u2014') + '</span></div>';
  }
  function invoiceSection(inv) {
    if (inv.synthetic) {
      const rows = inv.abayas.map(abayaRowHtml).join('');
      return '<div class="cr-row"><div><span class="cr-inv-name">(no invoice)</span>' +
        '<span class="cr-tag">unassigned</span></div><div class="cr-mini">' +
        miniStat('Abayas', inv.totals.abayas, 'abayas') +
        miniStat('Delivered', inv.totals.delivered, 'delivered') +
        miniStat('Pending', inv.totals.pending, 'pending') +
        miniStat('Cancelled', inv.totals.cancelled, 'cancelled') +
        '</div></div><div style="background:var(--s1);border-top:1px solid var(--bd);padding:6px 12px">' + rows + '</div>';
    }
    const rows = inv.abayas.map(abayaRowHtml).join('');
    return '<div class="cr-row"><div><span class="cr-inv-name">' + escapeHtml(inv.no || '(no invoice)') + '</span>' +
      '<span class="cr-mini"> &middot; ' + inv.totals.abayas + ' abaya(s)</span></div><div class="cr-mini">' +
      miniStat('Delivered', inv.totals.delivered, 'delivered') +
      miniStat('Pending', inv.totals.pending, 'pending') +
      miniStat('Cancelled', inv.totals.cancelled, 'cancelled') +
      '</div></div><div style="background:var(--s1);border-top:1px solid var(--bd);padding:6px 12px">' + rows + '</div>';
  }
  function factorySection(f) {
    const head = '<div class="cr-section-h"><span>' + escapeHtml(f.name) +
      '<span class="cr-mini"> &middot; ' + f.totals.invoices + ' invoice(s) &middot; ' + f.totals.abayas + ' abaya(s)</span></span>' +
      '<span class="cr-mini">' +
      miniStat('Delivered', f.totals.delivered, 'delivered') +
      miniStat('Pending', f.totals.pending, 'pending') +
      miniStat('Cancelled', f.totals.cancelled, 'cancelled') +
      '</span></div>';
    const rows = f.invoices.map(invoiceSection).join('');
    return '<div class="cr-section">' + head + '<div class="cr-scroll">' + (rows || '<div class="cr-empty">No invoices</div>') + '</div></div>';
  }
  function cancelRowHtml(c) {
    const when = c.cancelledAt ? new Date(c.cancelledAt).toLocaleString([], {
      timeZone: tz, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '';
    const pieces = [];
    if (c.invoiceNo) pieces.push('Invoice <b>' + escapeHtml(c.invoiceNo) + '</b>');
    if (c.abayaCode) pieces.push('Abaya <b>' + escapeHtml(c.abayaCode) + '</b>');
    if (c.factory)   pieces.push('Factory <b>' + escapeHtml(c.factory) + '</b>');
    if (c.cancelledBy) pieces.push('By <b>' + escapeHtml(c.cancelledBy) + '</b>');
    if (c.reason)    pieces.push('<span style="color:var(--tx3)">' + escapeHtml(c.reason) + '</span>');
    return '<div class="cr-cancel-row"><div style="display:flex;flex-wrap:wrap;gap:8px">' +
      pieces.join(' &middot; ') + '</div><span class="cr-when">' + escapeHtml(when) + '</span></div>';
  }
  function renderReport() {
    const r = state.report; if (!r) return;
    const body = document.getElementById('cr-body');
    const sub  = document.getElementById('cr-sub');
    const acts = document.getElementById('cr-actions');
    const title = document.getElementById('cr-title');
    title.textContent = r.dateRange.sameDay ? 'Check Delivery Report' : 'Check Delivery Report (range)';
    sub.innerHTML = '<b>' + escapeHtml(r.dateRange.label) + '</b>' +
      ' &middot; <span style="color:var(--tx3)">Generated in ' + escapeHtml(r.timezone) + '</span>';

    // ---- Overall delivery summary (first thing the eye lands on) -----------
    // Five big cards: Invoices / Abayas / Delivered / Pending / Cancelled.
    // When a specific factory is picked, the headline is that factory's
    // slice; the per-factory cards below stay as a comparison.
    const t = r.totals;
    const isAll = !r.factory || r.factory === 'All' || r.factory === '' ||
      (r.factories && r.factories.length > 1);
    const summaryHeading = isAll
      ? 'Delivery summary &mdash; overall (all factories)'
      : 'Delivery summary &mdash; ' + escapeHtml(r.factory);
    const totalFactories = (r.factories || []).length;
    const overallHtml =
      '<div class="cr-section">' +
        '<div class="cr-section-h">' +
          '<span>' + summaryHeading +
            '<span class="cr-mini"> &middot; ' + totalFactories +
            (totalFactories === 1 ? ' factory' : ' factories') + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="cr-totals">' +
          statCard('Invoices', t.invoices, 'invoices') +
          statCard('Abayas', t.abayas, 'abayas') +
          statCard('Delivered', t.delivered, 'delivered') +
          statCard('Pending', t.pending, 'pending') +
          statCard('Cancelled', t.cancelled, 'cancelled') +
        '</div>' +
      '</div>';

    // ---- Per-factory drill-down (only when viewing "All") -------------------
    // When a single factory is picked, the headline IS that factory \u2014 no
    // need to repeat the per-factory card. When viewing All, the per-factory
    // cards give the CEO a one-line comparison.
    const factoriesHtml = (isAll && r.factories && r.factories.length)
      ? '<div class="cr-section">' +
          '<div class="cr-section-h"><span>By factory<span class="cr-mini"> &middot; pick one above to drill in</span></span></div>' +
          r.factories.map(factorySection).join('') +
        '</div>'
      : (r.factories && r.factories.length
          ? r.factories.map(factorySection).join('')
          : '<div class="cr-empty">No factory activity in this range.</div>');

    const cancelHtml = r.cancellations.length
      ? '<div class="cr-section"><div class="cr-section-h">Cancellations <span class="cr-mini">traceable to invoice / abaya code</span></div>' +
        '<div class="cr-cancel-list">' + r.cancellations.map(cancelRowHtml).join('') + '</div></div>'
      : '';
    body.innerHTML = overallHtml + factoriesHtml + cancelHtml;
    acts.innerHTML =
      '<button class="btn-close" onclick="crBack()">&#9664; Change Date</button>' +
      '<button class="btn-close" onclick="openCancelModal()">+ Record Cancellation</button>' +
      '<button class="btn-export" onclick="crWhatsApp()">&#128241; Send via WhatsApp</button>';
  }
  window.crBack = function () { state.step = 'calendar'; renderCalendar(); };

  window.crWhatsApp = function () {
    const r = state.report; if (!r) return;
    const t = r.totals;
    const lines = [];
    lines.push('*AbaYa Track \u2014 Check Delivery Report*');
    lines.push('_' + r.dateRange.label + '_');
    lines.push('_Generated in ' + r.timezone + '_');
    lines.push('');
    lines.push('*Totals*');
    lines.push('\u2022 Invoices: *' + t.invoices + '*');
    lines.push('\u2022 Abayas: *' + t.abayas + '*');
    lines.push('\u2022 Delivered: *' + t.delivered + '*');
    lines.push('\u2022 Pending: *' + t.pending + '*');
    lines.push('\u2022 Cancelled: *' + t.cancelled + '*');
    lines.push('');
    for (const f of r.factories) {
      lines.push('*' + f.name + '*');
      lines.push('  Invoices: ' + f.totals.invoices + ' \u2022 Abayas: ' + f.totals.abayas);
      lines.push('  Delivered: ' + f.totals.delivered + ' \u2022 Pending: ' + f.totals.pending + ' \u2022 Cancelled: ' + f.totals.cancelled);
      for (const inv of f.invoices) {
        const label = inv.synthetic ? '(no invoice)' : (inv.no || '(no invoice)');
        lines.push('   \u2022 ' + label + ' \u2014 ' + inv.totals.abayas + ' abaya(s)');
        for (const a of inv.abayas) {
          const when = a.timestamp ? new Date(a.timestamp).toLocaleString([], {
            timeZone: r.timezone, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
          }) : '';
          lines.push('       - ' + a.code + ' \u2014 ' + a.status + (when ? ' (' + when + ')' : ''));
        }
      }
      lines.push('');
    }
    if (r.cancellations.length) {
      lines.push('*Cancellations*');
      for (const c of r.cancellations) {
        const when = c.cancelledAt ? new Date(c.cancelledAt).toLocaleString([], {
          timeZone: r.timezone, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        }) : '';
        const parts = [];
        if (c.invoiceNo) parts.push('Invoice ' + c.invoiceNo);
        if (c.abayaCode) parts.push('Abaya ' + c.abayaCode);
        if (c.factory)   parts.push('Factory ' + c.factory);
        if (c.cancelledBy) parts.push('by ' + c.cancelledBy);
        if (c.reason)    parts.push('\u2014 ' + c.reason);
        lines.push('\u2022 ' + parts.join(' \u2022 ') + (when ? ' [' + when + ']' : ''));
      }
      lines.push('');
    }
    lines.push('_Sent from AbaYa Track CEO Dashboard_');
    const text = lines.join('\\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    showToast('WhatsApp opened with the report');
  };

  function openCancelModal() {
    const m = document.getElementById('modal-cancel');
    if (!m) return;
    const fac = document.getElementById('cn-factory');
    if (fac) fac.value = state.factory || (state.config && state.config.defaultFactory) || '';
    const msg = document.getElementById('cn-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    m.classList.add('open');
    setTimeout(function () {
      const inv = document.getElementById('cn-invoice');
      if (inv) inv.focus();
    }, 50);
  }
  window.openCancelModal = openCancelModal;
  function closeCancelModal() {
    const m = document.getElementById('modal-cancel');
    if (m) m.classList.remove('open');
  }
  window.closeCancelModal = closeCancelModal;
  window.submitCancellation = function () {
    const factory = String(document.getElementById('cn-factory').value || '').trim();
    const invoiceNo = String(document.getElementById('cn-invoice').value || '').trim();
    const abayaCode = String(document.getElementById('cn-abaya').value || '').trim();
    const reason = String(document.getElementById('cn-reason').value || '').trim();
    const cancelledBy = String(document.getElementById('cn-by').value || '').trim();
    const msg = document.getElementById('cn-msg');
    function showMsg(kind, text) {
      if (!msg) return;
      msg.className = 'cr-msg ' + kind;
      msg.textContent = text;
      msg.style.display = 'block';
    }
    if (!invoiceNo && !abayaCode) {
      showMsg('warn', 'Provide at least one of Invoice No or Abaya Code so the cancellation is traceable.');
      return;
    }
    fetch(BASE + '/api/cancellations', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        factory: factory || undefined,
        invoiceNo: invoiceNo || undefined,
        abayaCode: abayaCode || undefined,
        reason: reason || undefined,
        cancelledBy: cancelledBy || undefined,
      }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || !x.j || !x.j.ok) {
          showMsg('error', (x.j && x.j.error) || 'Could not save the cancellation');
          return;
        }
        showMsg('ok', 'Saved. Reloading the report\u2026');
        window.crSubmit();
        setTimeout(closeCancelModal, 800);
      }).catch(function () { showMsg('error', 'Network error while saving'); });
  };
})();
<\/script>

<!-- Check Delivery Report modal: calendar + per-factory delivery summary + record cancellation -->
<div class="modal-overlay" id="modal-check" role="dialog" aria-modal="true" aria-labelledby="cr-title">
  <div class="modal-box" style="max-width:780px">
    <div class="modal-title" id="cr-title">Check Delivery Report</div>
    <div class="modal-sub" id="cr-sub">Pick a single date or a range in the production timezone. Pick a factory to drill in, or leave on "All factories" for the overall summary.</div>
    <div id="cr-body" class="cr-wrap"></div>
    <div class="modal-actions" id="cr-actions">
      <button class="btn-close" onclick="closeCheckReport()">Close</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="modal-cancel" role="dialog" aria-modal="true" aria-labelledby="cn-title">
  <div class="modal-box" style="max-width:520px">
    <div class="modal-title" id="cn-title">Record Cancellation</div>
    <div class="modal-sub">Cancellation is a first-class operational state \u2014 a real record is required.</div>
    <form class="cr-form" onsubmit="event.preventDefault(); submitCancellation();">
      <label>Factory
        <input id="cn-factory" placeholder="Main Factory" autocomplete="off">
      </label>
      <div class="cr-form-hint">At least one of <b>Invoice</b> or <b>Abaya Code</b> is required so the cancellation stays traceable.</div>
      <label>Invoice No
        <input id="cn-invoice" placeholder="e.g. INV-2026-00128" autocomplete="off">
      </label>
      <label>Abaya Code
        <input id="cn-abaya" placeholder="e.g. ABY-00483" autocomplete="off">
      </label>
      <label>Reason
        <input id="cn-reason" placeholder="material defect, customer change, ..." autocomplete="off">
      </label>
      <label>Cancelled by
        <input id="cn-by" placeholder="e.g. Misbah" autocomplete="off">
      </label>
      <div id="cn-msg" class="cr-msg" style="display:none"></div>
      <div class="modal-actions" style="margin-top:4px">
        <button type="button" class="btn-close" onclick="closeCancelModal()">Cancel</button>
        <button type="submit" class="btn-export" style="background:linear-gradient(135deg,#6a5fc1,#422082)">Save Cancellation</button>
      </div>
    </form>
  </div>
</div>
</body>
</html>`;
}
__name(getCEODashboard, "getCEODashboard");
var LEGAL_BUSINESS = "FarewellAbaya";
var LEGAL_EMAIL = "info@farewellabaya.com";
var LEGAL_UPDATED = "June 3, 2026";
function legalShell(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} &mdash; ${LEGAL_BUSINESS}</title>
<meta name="robots" content="index,follow">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#1f1633;color:#ece9f5;font-family:-apple-system,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.65;padding:0}
  .wrap{max-width:780px;margin:0 auto;padding:48px 22px 96px}
  header{border-bottom:1px solid rgba(106,95,193,.3);padding-bottom:22px;margin-bottom:30px}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}
  .logo{width:42px;height:42px;background:linear-gradient(135deg,#6a5fc1,#422082);border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:22px}
  .brand b{font-size:17px;font-weight:700}
  h1{font-size:27px;font-weight:800;letter-spacing:-.01em}
  .updated{color:#9c98b0;font-size:13px;margin-top:8px}
  h2{font-size:18px;font-weight:700;margin:30px 0 10px;color:#fff}
  p,li{color:#c9c4dc;font-size:15px;margin:10px 0}
  ul{padding-left:22px}
  a{color:#9d8bff;text-decoration:none}
  a:hover{text-decoration:underline}
  .box{background:rgba(255,255,255,.05);border:1px solid rgba(106,95,193,.25);border-radius:14px;padding:16px 18px;margin:18px 0}
  footer{margin-top:40px;border-top:1px solid rgba(106,95,193,.3);padding-top:18px;color:#807c95;font-size:13px}
  footer a{color:#9c98b0}
</style></head><body>
<div class="wrap">
  <header>
    <div class="brand"><div class="logo">&#129525;</div><b>${LEGAL_BUSINESS}</b></div>
    <h1>${title}</h1>
    <div class="updated">Last updated: ${LEGAL_UPDATED}</div>
  </header>
  ${bodyHtml}
  <footer>
    &copy; ${LEGAL_BUSINESS}. Contact: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>
    &middot; <a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms of Service</a>
  </footer>
</div>
</body></html>`;
}
__name(legalShell, "legalShell");
function getPrivacyPolicyPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Privacy, in plain words &mdash; ${LEGAL_BUSINESS}</title>
<meta name="robots" content="index,follow">
<meta name="description" content="The honest, no-jargon version of how FarewellAbaya handles your data.">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#160f24;color:#ece9f5;font-family:-apple-system,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}
  .wrap{max-width:680px;margin:0 auto;padding:54px 22px 90px}
  .brand{display:flex;align-items:center;gap:11px;margin-bottom:34px}
  .brand .logo{width:40px;height:40px;background:linear-gradient(135deg,#7c6fe0,#422082);border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:21px}
  .brand b{font-size:16px;font-weight:700}
  .eyebrow{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:#a89fd0;margin-bottom:10px}
  h1{font-size:34px;line-height:1.15;font-weight:800;letter-spacing:-.02em;margin-bottom:12px;background:linear-gradient(95deg,#fff,#c9b8ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .lede{color:#b9b3d2;font-size:16.5px;margin-bottom:6px}
  .updated{color:#7d779a;font-size:13px;margin-bottom:30px}
  /* TL;DR */
  .tldr{background:linear-gradient(160deg,rgba(124,111,224,.16),rgba(124,111,224,.04));border:1px solid rgba(150,130,220,.3);border-radius:18px;padding:24px 24px 8px;margin:8px 0 40px}
  .tldr h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#c9b8ff;margin-bottom:14px}
  .tldr .row{display:flex;gap:13px;align-items:flex-start;margin-bottom:16px}
  .tldr .ico{font-size:21px;line-height:1.3;flex:0 0 auto}
  .tldr .row p{margin:0;font-size:15.5px;color:#e7e3f5}
  .tldr .row b{color:#fff}
  section{margin:0 0 30px}
  h3{font-size:20px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;align-items:center;gap:9px}
  h3 .e{font-size:20px}
  p,li{color:#c5c0db;font-size:15.5px;margin:9px 0}
  ul{padding-left:6px;list-style:none}
  ul li{position:relative;padding-left:22px}
  ul li::before{content:'\\2014';position:absolute;left:0;color:#8a7fd0}
  b{color:#efecfb}
  a{color:#a89fd0;text-decoration:none;border-bottom:1px solid rgba(168,159,208,.4)}
  a:hover{color:#fff}
  .delete{background:rgba(124,111,224,.1);border:1px dashed rgba(150,130,220,.45);border-radius:16px;padding:20px 22px;margin:6px 0}
  .delete p{margin-top:0}
  .big-btn{display:inline-block;margin-top:6px;background:linear-gradient(135deg,#7c6fe0,#5a3fb0);color:#fff;border-bottom:0;padding:11px 18px;border-radius:11px;font-weight:700;font-size:14.5px}
  .big-btn:hover{filter:brightness(1.08);color:#fff}
  footer{margin-top:44px;border-top:1px solid rgba(106,95,193,.25);padding-top:20px;color:#7d779a;font-size:13px}
  footer a{color:#a89fd0;border-bottom:0}
  hr{border:0;border-top:1px solid rgba(106,95,193,.18);margin:34px 0}
</style></head><body>
<div class="wrap">
  <div class="brand"><div class="logo">&#129525;</div><b>${LEGAL_BUSINESS}</b></div>

  <div class="eyebrow">Privacy Policy</div>
  <h1>Your data, in plain words.</h1>
  <p class="lede">No 40-page maze, no hidden clauses. Here's exactly what we see, what we do with it, and how to make it disappear &mdash; in about 60 seconds.</p>
  <div class="updated">Last updated: ${LEGAL_UPDATED}</div>

  <div class="tldr">
    <h2>The 10-second version</h2>
    <div class="row"><div class="ico">&#128075;</div><p><b>We see your name and email</b> &mdash; just enough to know it's you when you log in.</p></div>
    <div class="row"><div class="ico">&#128683;</div><p><b>We never sell it.</b> No ads, no data brokers, no funny business.</p></div>
    <div class="row"><div class="ico">&#128274;</div><p><b>It's encrypted</b> on the way to us and locked behind your access code.</p></div>
    <div class="row"><div class="ico">&#128465;&#65039;</div><p><b>Want out?</b> One email and everything about you is gone within 30 days.</p></div>
  </div>

  <section>
    <h3><span class="e">&#128064;</span> What we actually collect</h3>
    <ul>
      <li><b>Who you are:</b> when you sign in &mdash; including with <b>Facebook Login (Meta)</b> &mdash; we get the basics you approve: your name, email, and an ID that lets us recognize you next time.</li>
      <li><b>What you do in the app:</b> the orders, garments, and production updates you or your team enter. That's the whole point of the dashboard.</li>
      <li><b>The technical stuff:</b> things like your IP address and timestamps, kept briefly to keep the app secure and running.</li>
    </ul>
  </section>

  <section>
    <h3><span class="e">&#9881;&#65039;</span> What we do with it</h3>
    <p>Honestly, not much beyond running the app: we use it to <b>log you in</b>, <b>show you your dashboard</b>, and <b>keep things secure</b>. That's it.</p>
    <p>What we'll <b>never</b> do: sell it, rent it, or use it to follow you around the internet with ads.</p>
  </section>

  <section>
    <h3><span class="e">&#128241;</span> About signing in with Facebook</h3>
    <p>If you use Facebook to log in, we ask for the bare minimum &mdash; usually your <b>public profile and email</b> &mdash; and we use it only to confirm it's really you. We don't post anything, and we can't see anything you didn't tick "yes" to in the Facebook dialog. (Meta's own rules apply there too.)</p>
  </section>

  <section>
    <h3><span class="e">&#129309;</span> Who else sees it</h3>
    <p>Only the trusted services that help us run the app (like our host, <b>Cloudflare</b>) &mdash; and only as much as they need. The one exception: if the law genuinely requires it. No marketing partners, ever.</p>
  </section>

  <section>
    <h3><span class="e">&#9203;</span> How long we keep it</h3>
    <p>Only as long as you're using the Service (plus a little extra if the law says so). After that, it's deleted or anonymized.</p>
  </section>

  <section>
    <h3><span class="e">&#128465;&#65039;</span> Delete everything &mdash; anytime</h3>
    <div class="delete">
      <p><b>It's your data. Here's the off switch:</b> email us from the address on your account (or tell us the name you used with Facebook Login) with the subject <b>"Delete my data"</b>. We'll wipe your personal data within <b>30 days</b> and email you to confirm.</p>
      <a class="big-btn" href="mailto:${LEGAL_EMAIL}?subject=Delete%20my%20data">&#9993;&#65039; Request deletion</a>
    </div>
    <p>You can also just ask to <b>see</b> or <b>fix</b> what we hold &mdash; same address, we're happy to help.</p>
  </section>

  <hr>

  <section>
    <h3><span class="e">&#128272;</span> Keeping it safe</h3>
    <p>We use solid, industry-standard protection: encrypted connections (HTTPS) and access controls. No system on earth is 100% bulletproof, but we treat your data like it's our own.</p>
  </section>

  <section>
    <h3><span class="e">&#129516;</span> A few honest footnotes</h3>
    <ul>
      <li><b>Not for kids:</b> this is a business tool, not meant for anyone under 13, and we don't knowingly collect their info.</li>
      <li><b>If this changes:</b> we'll update the date at the top. Big changes, we'll make obvious.</li>
      <li><b>Got a question?</b> A real person reads <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</li>
    </ul>
  </section>

  <footer>
    &copy; ${LEGAL_BUSINESS} &middot; <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>
    &middot; <a href="/terms">Terms of Service</a> &middot; <a href="/">Home</a>
  </footer>
</div>
</body></html>`;
}
__name(getPrivacyPolicyPage, "getPrivacyPolicyPage");
function getTermsOfServicePage() {
  return legalShell("Terms of Service", `
  <p>These Terms of Service ("Terms") govern your access to and use of the ${LEGAL_BUSINESS}
  production tracking and dashboard service (the "Service"). By accessing or using the Service,
  including by signing in, you agree to these Terms.</p>

  <h2>1. Use of the Service</h2>
  <p>The Service is provided for authorized business users to track and manage abaya production,
  orders, and dispatch. You agree to use it only for lawful purposes and in accordance with these
  Terms.</p>

  <h2>2. Accounts &amp; login</h2>
  <p>You may sign in using credentials we issue or via a third-party provider such as Facebook
  Login. You are responsible for activity under your account and for keeping your access
  credentials confidential. Notify us promptly of any unauthorized use.</p>

  <h2>3. Acceptable use</h2>
  <ul>
    <li>Do not attempt to gain unauthorized access to the Service or its data.</li>
    <li>Do not interfere with, disrupt, or overload the Service.</li>
    <li>Do not use the Service to store or transmit unlawful or infringing content.</li>
  </ul>

  <h2>4. Intellectual property</h2>
  <p>The Service, including its software, design, and content, is owned by ${LEGAL_BUSINESS} and
  its licensors and is protected by applicable laws. These Terms do not grant you any rights to
  our trademarks or branding.</p>

  <h2>5. Data</h2>
  <p>Our handling of personal data is described in our
  <a href="/privacy">Privacy Policy</a>, which forms part of these Terms.</p>

  <h2>6. Disclaimers</h2>
  <p>The Service is provided "as is" and "as available" without warranties of any kind, whether
  express or implied, including merchantability, fitness for a particular purpose, and
  non-infringement, to the maximum extent permitted by law.</p>

  <h2>7. Limitation of liability</h2>
  <p>To the maximum extent permitted by law, ${LEGAL_BUSINESS} will not be liable for any
  indirect, incidental, special, consequential, or punitive damages, or any loss of data,
  revenue, or profits arising from your use of the Service.</p>

  <h2>8. Termination</h2>
  <p>We may suspend or terminate access to the Service at any time if you violate these Terms or
  to protect the Service. You may stop using the Service at any time.</p>

  <h2>9. Changes to these Terms</h2>
  <p>We may update these Terms from time to time. Continued use of the Service after changes take
  effect constitutes acceptance of the updated Terms.</p>

  <h2>10. Contact us</h2>
  <p>Questions about these Terms: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>
  `);
}
__name(getTermsOfServicePage, "getTermsOfServicePage");

// src/index.js
var releaseMomentData = {
  enabled: true,
  momentId: "2026-05-evolution-1",
  eyebrow: "Just evolved",
  hook: "The executive lens widened.",
  outcome: "Spot drift sooner\u2014same Cloud pulse, calmer read.",
  ctaLabel: "Jump to reports",
  ctaPath: "#exec-reports",
  secondaryCtaLabel: "",
  secondaryCtaPath: ""
};
function cookieHttps(request) {
  return new URL(request.url).protocol === "https:";
}
__name(cookieHttps, "cookieHttps");
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (path === "/api/health" && request.method === "GET") {
      return jsonRes({ ok: true, service: "abaya-track-worker" });
    }
    if (path === "/static/ceo.css" && (request.method === "GET" || request.method === "HEAD")) {
      const headers = new Headers();
      headers.set("Content-Type", "text/css; charset=utf-8");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("CDN-Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(request.method === "HEAD" ? null : DASHBOARD_CSS_BODY, { headers });
    }
    if (path.startsWith("/updates/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return errRes("Method not allowed", 405);
      }
      if (!env.UPDATES) return errRes("Update feed not configured", 503);
      const seg = path.slice("/updates/".length).split("/").filter(Boolean);
      if (seg.length !== 2) return errRes("Not found", 404);
      const [channel, file] = seg;
      if (channel !== "stable" && channel !== "beta") return errRes("Not found", 404);
      if (!/^[A-Za-z0-9._-]+$/.test(file)) return errRes("Not found", 404);
      const obj = await env.UPDATES.get(channel + "/" + file);
      if (!obj) return errRes("Not found", 404);
      const headers = new Headers(CORS);
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set(
        "Cache-Control",
        file.endsWith(".yml") ? "public, max-age=60" : "public, max-age=31536000, immutable"
      );
      return new Response(request.method === "HEAD" ? null : obj.body, { headers });
    }
    if (path === "/api/ceo/session" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const p = String(body && body.password || "").trim();
        if (!ceoPasswordOk(env, p)) {
          return errRes("Invalid access code", 401);
        }
        const pair = await mintCeoSessionPair(env);
        if (!pair.ok) {
          return errRes(
            "Login unavailable: set Wrangler secret CEO_JWT_SECRET (see cloudflare/wrangler.toml).",
            503
          );
        }
        const headers = new Headers();
        headers.set("Content-Type", "application/json");
        Object.assign(headers, CORS);
        const sec = cookieHttps(request);
        appendCeoSessionCookies(headers, pair, sec);
        return new Response(
          JSON.stringify({ ok: true, expires_at: pair.exp }),
          { status: 200, headers }
        );
      } catch (_) {
        return errRes("Session error", 500);
      }
    }
    if (path === "/api/ceo/session/refresh" && request.method === "POST") {
      const ceoRl0 = await rateLimitOr429(
        env.CEO_READ_RATE_LIMIT,
        rateLimitClientKey(request, "ceo-read"),
        "Too many dashboard requests. Slow down polling."
      );
      if (ceoRl0) return ceoRl0;
      const rt = extractRefreshToken(request);
      if (!rt) {
        return errRes("Session expired. Please sign in again.", 401);
      }
      const v = await verifyRefreshToken(rt, env);
      if (!v.ok) {
        return errRes("Session expired. Please sign in again.", 401);
      }
      const pair = await mintCeoSessionPair(env);
      if (!pair.ok) {
        return errRes("Session refresh unavailable (CEO_JWT_SECRET).", 503);
      }
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      Object.assign(headers, CORS);
      appendCeoSessionCookies(headers, pair, cookieHttps(request));
      return new Response(JSON.stringify({ ok: true, expires_at: pair.exp }), { status: 200, headers });
    }
    if (path === "/api/ceo/logout" && request.method === "POST") {
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      Object.assign(headers, CORS);
      appendClearCeoSessionCookies(headers, cookieHttps(request));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }
    if (path === "/api/catalog/abayas") {
      try {
        if (request.method === "GET") {
          return await handleCatalogAbayasGet(env, jsonRes);
        }
        if (request.method === "PUT") {
          return await handleCatalogAbayasPut(request, env, { errRes, jsonRes, rateLimitOr429 });
        }
        return errRes("Method not allowed", 405);
      } catch (e) {
        console.error("Catalog error:", e);
        return errRes("Catalog error: " + e.message, 500);
      }
    }
    if (path === "/api/employees" || path === "/api/work-types") {
      const isEmployees = path === "/api/employees";
      try {
        if (request.method === "GET") {
          return isEmployees ? await handleEmployeesGet(env, jsonRes) : await handleWorkTypesGet(env, jsonRes);
        }
        if (request.method === "PUT") {
          const helpers = { errRes, jsonRes, rateLimitOr429 };
          return isEmployees ? await handleEmployeesPut(request, env, helpers) : await handleWorkTypesPut(request, env, helpers);
        }
        return errRes("Method not allowed", 405);
      } catch (e) {
        console.error("Roster error:", e);
        return errRes("Roster error: " + e.message, 500);
      }
    }
    if ((path === "/sw.js" || path === "/service-worker.js") && request.method === "GET") {
      return new Response(getServiceWorkerCleanupScript(), {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
          "CDN-Cache-Control": "no-store"
        }
      });
    }
    if ((path === "/privacy" || path === "/privacy.html") && request.method === "GET") {
      return new Response(getPrivacyPolicyPage(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }
    if ((path === "/terms" || path === "/terms.html") && request.method === "GET") {
      return new Response(getTermsOfServicePage(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }
    const isWorkingHoursReadable = path === "/api/settings/working-hours" && request.method === "GET";
    if (isWorkingHoursReadable) {
      const ceoToken = extractCeoToken(request, url);
      const ingestSecret = (request.headers.get("X-Ingest-Secret") || "").trim();
      const ceoOk = ceoToken && await isCeoAuthenticated(request, env, url);
      const ingestOk = ingestSecret && ingestSecret === (env.INGEST_SECRET || "").trim();
      if (!ceoOk && !ingestOk) {
        return errRes("Unauthorized (use CEO token/cookie or X-Ingest-Secret)", 401);
      }
      const cfg = await getWorkingHoursConfig(env);
      return jsonRes({ ok: true, working_hours: cfg }, 200, CEO_JSON_NO_STORE);
    }
    if (path.startsWith("/dispatch/")) {
      return handleDispatch(request, env, url);
    }
    const isCEORoute = path === "/" || path === "/ceo" || path === "/dashboard.html" || path.startsWith("/api/") && path !== "/api/event" && path !== "/api/catalog/abayas" && // Roster endpoints authenticate with X-Ingest-Secret (factory server),
    // not the CEO cookie — same exemption the catalog already has.
    path !== "/api/employees" && path !== "/api/work-types" && // History hydration: factory server pulls last N days of sessions at
    // boot. Uses X-Ingest-Secret like the other factory-callable routes.
    path !== "/api/state/history" && // Support tickets (v1.2.24+): factory launcher creates/reads tickets
    // via X-Ingest-Secret. GETs are also reachable from the office's
    // whatsapp-web.js bot (no auth) so it can poll the latest ticket
    // id when an incoming message arrives.
    !(path === "/api/tickets" || path.startsWith("/api/tickets/")) && // /api/worker-settings/support — operator edits office numbers from
    // the launcher's settings panel; X-Ingest-Secret.
    path !== "/api/worker-settings/support" && // v1.2.27 — D1 health probe. Open by design: the factory server
    // and the CEO dashboard's "data is stale" banner both want to
    // poll this without a CEO cookie. The endpoint only does a tiny
    // `SELECT 1` so it can't leak any sensitive data.
    path !== "/api/d1-health";
    if (isCEORoute) {
      const token = extractCeoToken(request, url);
      const authed = token && await isCeoAuthenticated(request, env, url);
      const ingestSecret = (request.headers.get("X-Ingest-Secret") || "").trim();
      const ingestOk = request.method === "GET" && ingestSecret && ingestSecret === (env.INGEST_SECRET || "").trim() && (path === "/api/state" || path === "/api/state/history");
      if (!authed && !ingestOk) {
        if (path.startsWith("/api/")) {
          return errRes("Session expired. Please sign in again.", 401);
        }
        return new Response(getLoginPage(), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "CDN-Cache-Control": "no-store"
          }
        });
      }
      const ceoRl = await rateLimitOr429(
        env.CEO_READ_RATE_LIMIT,
        rateLimitClientKey(request, "ceo-read"),
        "Too many dashboard requests. Slow down polling."
      );
      if (ceoRl) return ceoRl;
    }
    try {
      if (path === "/api/release-moment" && request.method === "GET") {
        const payload = Object.assign({}, releaseMomentData);
        delete payload._comment;
        return jsonRes(payload, 200, CEO_JSON_NO_STORE);
      }
      if (path === "/api/event" && request.method === "POST") {
        return handleIngest(request, env);
      }
      if (path === "/api/d1-health" && request.method === "GET") {
        try {
          const r = await env.DB.prepare("SELECT 1 as ok").first();
          if (r && r.ok === 1) {
            return jsonRes({ ok: true, d1: "healthy" }, 200, CEO_JSON_NO_STORE);
          }
          return jsonRes({ ok: false, d1: "unexpected response" }, 503, { "Retry-After": "10" });
        } catch (e) {
          if (isD1Error(e)) {
            return d1ErrorResponse(e, 10);
          }
          return errRes("D1 health probe failed: " + e.message, 500);
        }
      }
      if (path === "/api/state" && request.method === "GET") {
        return handleState(env, url);
      }
      if (path === "/api/state/history" && request.method === "GET") {
        return await handleHistory(env, url);
      }
      if (path === "/api/report" && request.method === "GET") {
        return await handleReport(env, url);
      }
      if (path === "/api/report/employee-day" && request.method === "GET") {
        return await handleEmployeeDay(env, url);
      }
      if (path === "/api/settings/working-hours" && request.method === "PUT") {
        const body = await request.json();
        const cfg = await saveWorkingHoursConfig(env, body && body.working_hours ? body.working_hours : body);
        return jsonRes({ ok: true, working_hours: cfg }, 200, CEO_JSON_NO_STORE);
      }
      if (path === "/api/tickets" && request.method === "POST") {
        return handleCreateTicket(request, env);
      }
      if (path === "/api/tickets" && request.method === "GET") {
        return handleListTickets(request, env);
      }
      const ticketMatch = path.match(/^\/api\/tickets\/([A-Za-z0-9._-]+)(?:\/(resolve|reopen|reply))?$/);
      if (ticketMatch) {
        const id = ticketMatch[1];
        const action = ticketMatch[2];
        if (!action && request.method === "GET") return handleGetTicket(request, env, id);
        if (action === "resolve" && request.method === "POST") return handleResolveTicket(request, env, id);
        if (action === "reopen" && request.method === "POST") return handleReopenTicket(request, env, id);
        if (action === "reply" && request.method === "POST") return handleOperatorReply(request, env, id);
      }
      const resolvePageMatch = path.match(/^\/r\/([A-Za-z0-9._-]+)$/);
      if (resolvePageMatch && request.method === "GET") {
        return handleResolvePage(env, resolvePageMatch[1]);
      }
      if (path === "/api/worker-settings/support" && request.method === "GET") {
        return handleGetSupportConfig(request, env);
      }
      if (path === "/api/worker-settings/support" && request.method === "PUT") {
        return handleSetSupportConfig(request, env);
      }
      if (path === "/api/worker-settings/bot-url" && request.method === "POST") {
        return handleSetBotUrl(request, env);
      }
      if (path === "/webhook/whatsapp-incoming" && request.method === "POST") {
        return handleWhatsappIncoming(request, env);
      }
      if (path === "/api/analytics" && request.method === "GET") {
        return handleAnalytics(env, url);
      }
      if (path === "/api/check-delivery-report/config" && request.method === "GET") {
        return handleCheckDeliveryConfig(env, url);
      }
      if (path === "/api/check-delivery-report" && request.method === "GET") {
        return handleCheckDeliveryReport(env, url);
      }
      if (path === "/api/check-report/config" && request.method === "GET") {
        return handleCheckReportConfig(env, url);
      }
      if (path === "/api/check-report" && request.method === "GET") {
        return handleCheckReport(env, url);
      }
      if (path === "/api/cancellations" && request.method === "POST") {
        return handleCancellationsPost(env, request);
      }
      if (path === "/api/cancellations" && request.method === "GET") {
        return handleCancellationsList(env, url);
      }
      if (path === "/api/trace" && request.method === "GET") {
        return handleGarmentTrace(env, url);
      }
      if (path === "/api/messaging/status" && request.method === "GET") {
        return jsonRes(await getMessagingStatus(env), 200, CEO_JSON_NO_STORE);
      }
      if (path === "/api/messaging/toggle" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const res = await setMessagingEnabled(env, !!(b && b.enabled));
        return jsonRes(res, res.ok ? 200 : 500, CEO_JSON_NO_STORE);
      }
      if ((path === "/" || path === "/dashboard.html" || path === "/ceo") && request.method === "GET") {
        const qp = url.searchParams.get("token");
        const qpTrim = qp && qp.trim();
        const okTok = qpTrim && ceoPasswordOk(env, qpTrim);
        if (okTok) {
          const pair = await mintCeoSessionPair(env);
          if (!pair.ok) {
            return errRes(
              "Bootstrap unavailable: set Wrangler secret CEO_JWT_SECRET, then use the login page.",
              503
            );
          }
          const redirectUrl = `${url.origin}${path}`;
          const headers = new Headers();
          headers.set("Location", redirectUrl);
          appendCeoSessionCookies(headers, pair, cookieHttps(request));
          return new Response(null, { status: 302, headers });
        }
        const htmlEtag = getDashboardHtmlEtag(url.origin);
        const ifNoneMatch = (request.headers.get("If-None-Match") || "").trim();
        if (ifNoneMatch && ifNoneMatch === htmlEtag) {
          const notModifiedHeaders = new Headers();
          notModifiedHeaders.set("ETag", htmlEtag);
          notModifiedHeaders.set("Cache-Control", "private, no-cache");
          return new Response(null, { status: 304, headers: notModifiedHeaders });
        }
        return new Response(getCEODashboard(url.origin), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-cache",
            "CDN-Cache-Control": "no-store",
            ETag: htmlEtag
          }
        });
      }
      return errRes("Not found", 404);
    } catch (e) {
      if (isD1Error(e)) {
        console.error("Worker D1 error (returning 503):", e && e.message ? e.message : e);
        return d1ErrorResponse(e, 30);
      }
      console.error("Worker error:", e);
      return errRes("Internal server error: " + e.message, 500);
    }
  },
  async scheduled(event, env, ctx) {
    switch (event.cron) {
      case "* * * * *":
      case "*/5 * * * *":
        ctx.waitUntil(runTunnelProbe(env));
        break;
      case "0 14 * * *":
      default:
        ctx.waitUntil(sendEODSummary(env));
        break;
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
