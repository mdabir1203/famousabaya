'use strict';

/**
 * Tamper-evident snapshot manifest.
 *
 * For every snapshot file we append one signed line to manifest.jsonl:
 *   {
 *     ts: <unix ms>, filename, size, sha256, prev: <sha256>,
 *     sig: <hmac-sha256(secret, ts|filename|size|sha256|prev)>
 *   }
 *
 * Properties:
 *   - prev = sha256 of previous record's `sig`. Changing/removing any earlier
 *     record breaks the chain on the next record.
 *   - sig = HMAC over the record fields. Without the secret an attacker
 *     cannot forge a record; without `prev` they can't silently delete one.
 *   - The manifest itself is set read-only (+R) after each append; on Windows
 *     hardened ACLs (install/HARDEN-SNAPSHOT-DIR.ps1) block non-admin delete.
 *
 * Caveats:
 *   - Anyone with the secret can forge new records. Keep SNAPSHOT_SIGNING_SECRET
 *     out of the repo and out of any account other than the service account.
 *   - An admin can always delete the whole manifest. Mirror the file off-host
 *     (Cloudflare R2 / git-crypt repo / etc.) for stronger guarantees.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_NAME = 'manifest.jsonl';
const MANIFEST_FORMAT = 1;
const GENESIS_PREV = '0'.repeat(64);

function getSecret(explicit) {
  if (explicit && String(explicit).length >= 16) return String(explicit);
  const env = String(process.env.SNAPSHOT_SIGNING_SECRET || '').trim();
  if (env.length >= 16) return env;
  const fallback = String(process.env.CF_INGEST_SECRET || '').trim();
  if (fallback.length >= 16) return 'snapshot:' + fallback;
  return null;
}

function sha256OfFile(filePath) {
  const h = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  h.update(buf);
  return h.digest('hex');
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hmacSha256(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function readLines(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function getLastRecord(dir) {
  const lines = readLines(path.join(dir, MANIFEST_NAME));
  if (!lines.length) return null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (_) { /* keep scanning back */ }
  }
  return null;
}

function recordPayload(rec) {
  return [
    rec.type || 'snapshot',
    rec.ts,
    rec.filename,
    rec.size != null ? rec.size : '',
    rec.sha256 || '',
    rec.prev,
    rec.format,
  ].join('|');
}

function setReadOnly(filePath) {
  try {
    fs.chmodSync(filePath, 0o444);
  } catch (_) { /* best-effort */ }
  if (process.platform === 'win32') {
    try {
      const { spawnSync } = require('child_process');
      spawnSync('attrib', ['+R', filePath], { stdio: 'ignore' });
    } catch (_) { /* best-effort */ }
  }
}

function clearReadOnly(filePath) {
  try {
    fs.chmodSync(filePath, 0o644);
  } catch (_) { /* best-effort */ }
  if (process.platform === 'win32') {
    try {
      const { spawnSync } = require('child_process');
      spawnSync('attrib', ['-R', filePath], { stdio: 'ignore' });
    } catch (_) { /* best-effort */ }
  }
}

/**
 * Append a signed record for the given snapshot file. Returns the record on
 * success, or null if signing is disabled (no secret configured).
 *
 * @param {{ filePath: string, dir?: string, source?: string, secret?: string }} opts
 */
function appendRecord(opts) {
  const filePath = opts.filePath;
  const dir = opts.dir || path.dirname(filePath);
  const secret = getSecret(opts.secret);
  if (!secret) return null;

  const stat = fs.statSync(filePath);
  const sha = sha256OfFile(filePath);
  const last = getLastRecord(dir);
  const prev = last && last.sig ? sha256Hex(last.sig) : GENESIS_PREV;

  const rec = {
    format: MANIFEST_FORMAT,
    type: 'snapshot',
    ts: Date.now(),
    filename: path.basename(filePath),
    size: stat.size,
    sha256: sha,
    prev,
    source: opts.source || 'snapshot',
  };
  rec.sig = hmacSha256(secret, recordPayload(rec));

  appendLine(dir, rec);
  return rec;
}

/**
 * Append a signed tombstone (for retention-pruned files). Keeps the chain
 * valid so verify() does not flag intentional deletions as tampering.
 *
 * @param {{ filename: string, dir: string, secret?: string, reason?: string }} opts
 */
function appendRetire(opts) {
  const secret = getSecret(opts.secret);
  if (!secret) return null;
  const dir = opts.dir;
  const last = getLastRecord(dir);
  const prev = last && last.sig ? sha256Hex(last.sig) : GENESIS_PREV;
  const rec = {
    format: MANIFEST_FORMAT,
    type: 'retire',
    ts: Date.now(),
    filename: String(opts.filename),
    size: null,
    sha256: '',
    prev,
    reason: opts.reason || 'retention',
  };
  rec.sig = hmacSha256(secret, recordPayload(rec));
  appendLine(dir, rec);
  return rec;
}

function appendLine(dir, rec) {
  const manifestPath = path.join(dir, MANIFEST_NAME);
  clearReadOnly(manifestPath);
  fs.appendFileSync(manifestPath, JSON.stringify(rec) + '\n', { mode: 0o644 });
  setReadOnly(manifestPath);
}

/**
 * Walk every record, recompute hashes/signatures, and verify the chain.
 *
 * @param {{ dir: string, secret?: string, requireFiles?: boolean }} opts
 * @returns {{ ok: boolean, total: number, errors: Array<{ index: number, kind: string, detail: string }>, recordsMissingFile: string[], lastRecord: any }}
 */
function verifyManifest(opts) {
  const dir = opts.dir;
  const secret = getSecret(opts.secret);
  const requireFiles = opts.requireFiles !== false;
  const out = { ok: true, total: 0, errors: [], recordsMissingFile: [], lastRecord: null };
  if (!secret) {
    out.ok = false;
    out.errors.push({ index: -1, kind: 'no_secret', detail: 'SNAPSHOT_SIGNING_SECRET not configured' });
    return out;
  }

  const lines = readLines(path.join(dir, MANIFEST_NAME));
  out.total = lines.length;

  /** Track filenames that received a `retire` tombstone so subsequent file_missing checks pass. */
  const retired = new Set();
  let prev = GENESIS_PREV;
  let snapshots = 0;
  let retires = 0;

  for (let i = 0; i < lines.length; i += 1) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch (e) {
      out.ok = false;
      out.errors.push({ index: i, kind: 'parse_error', detail: e.message });
      continue;
    }

    if (rec.prev !== prev) {
      out.ok = false;
      out.errors.push({ index: i, kind: 'broken_chain', detail: `expected prev=${prev} got prev=${rec.prev}` });
    }

    const expectSig = hmacSha256(secret, recordPayload(rec));
    if (expectSig !== rec.sig) {
      out.ok = false;
      out.errors.push({ index: i, kind: 'bad_signature', detail: `record ${rec.filename}` });
    }

    const recType = rec.type || 'snapshot';
    if (recType === 'retire') {
      retired.add(rec.filename);
      retires += 1;
    } else {
      snapshots += 1;
      const filePath = path.join(dir, rec.filename);
      if (fs.existsSync(filePath)) {
        const st = fs.statSync(filePath);
        if (st.size !== rec.size) {
          if (!isOverwrittenLatest(rec, lines, i, secret)) {
            out.ok = false;
            out.errors.push({
              index: i,
              kind: 'size_mismatch',
              detail: `${rec.filename}: expected ${rec.size}, got ${st.size}`,
            });
          }
        } else {
          const sha = sha256OfFile(filePath);
          if (sha !== rec.sha256 && !isOverwrittenLatest(rec, lines, i, secret)) {
            out.ok = false;
            out.errors.push({ index: i, kind: 'hash_mismatch', detail: `${rec.filename}` });
          }
        }
      } else if (requireFiles && !retired.has(rec.filename)) {
        if (!hasLaterRecordForFilename(lines, i, rec.filename)) {
          out.ok = false;
          out.errors.push({ index: i, kind: 'file_missing', detail: rec.filename });
          out.recordsMissingFile.push(rec.filename);
        }
      }
    }

    prev = sha256Hex(rec.sig);
    out.lastRecord = rec;
  }

  out.snapshots = snapshots;
  out.retires = retires;
  return out;
}

/**
 * The "latest" file is overwritten on every snapshot, so older records that
 * point at it are expected to be stale. Treat a stale record as OK when a
 * later valid record (snapshot or retire) covers the same filename.
 */
function isOverwrittenLatest(rec, lines, index, secret) {
  return hasLaterRecordForFilename(lines, index, rec.filename);
}

function hasLaterRecordForFilename(lines, index, filename) {
  for (let j = index + 1; j < lines.length; j += 1) {
    let r;
    try { r = JSON.parse(lines[j]); } catch (_) { continue; }
    if (r && r.filename === filename) return true;
  }
  return false;
}

module.exports = {
  MANIFEST_NAME,
  MANIFEST_FORMAT,
  appendRecord,
  appendRetire,
  verifyManifest,
  setReadOnly,
  clearReadOnly,
  sha256OfFile,
  getSecret,
};
