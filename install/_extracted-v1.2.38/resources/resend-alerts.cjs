'use strict';

/**
 * Resend-backed operational alerts.
 *
 * Hooks into the `ingestEvents` EventEmitter exposed by server.js plus the
 * snapshot module's last-error state. Includes:
 *   - per-kind cooldown to avoid storms
 *   - global hourly cap
 *   - actionable payload (host, mode, queue depth, last error, reconcile lag)
 *
 * Configuration (.env):
 *   RESEND_API_KEY       required to enable
 *   ALERTS_TO            comma-separated recipients
 *   ALERTS_FROM          From: header (e.g. "AbaYa Track <alerts@example.com>")
 *   ALERTS_ENABLED       0/1 master switch (default 1 when API key + recipient set)
 *   ALERTS_DEDUP_MS      per-kind cooldown ms (default 30 minutes)
 *   ALERTS_MAX_PER_HOUR  global cap (default 8)
 *   ALERTS_DRY_RUN       1 to log only, no HTTP
 */

const os = require('os');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function parseList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePositiveIntOrNull(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const DEFAULT_DEDUP_MS = parsePositiveIntOrNull('ALERTS_DEDUP_MS', 30 * 60 * 1000);
const DEFAULT_HOURLY_CAP = parsePositiveIntOrNull('ALERTS_MAX_PER_HOUR', 8);

function isEnabled(opts) {
  const flag = String(process.env.ALERTS_ENABLED || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false;
  const apiKey = (opts && opts.apiKey) || process.env.RESEND_API_KEY || '';
  const to = parseList((opts && opts.to) || process.env.ALERTS_TO);
  return Boolean(apiKey && to.length);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nowIso() {
  return new Date().toISOString();
}

function renderHtml(kind, body, ctx) {
  const rows = Object.keys(body).map((k) => {
    const v = body[k];
    const rendered = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return `<tr><td style="padding:4px 8px;color:#888;vertical-align:top">${escapeHtml(k)}</td>` +
      `<td style="padding:4px 8px;font-family:Consolas,Menlo,monospace"><pre style="margin:0;white-space:pre-wrap">${escapeHtml(rendered)}</pre></td></tr>`;
  }).join('');
  const ctxRows = ctx ? Object.keys(ctx).map((k) => {
    return `<tr><td style="padding:2px 8px;color:#888">${escapeHtml(k)}</td>` +
      `<td style="padding:2px 8px;font-family:Consolas,Menlo,monospace">${escapeHtml(typeof ctx[k] === 'object' ? JSON.stringify(ctx[k]) : ctx[k])}</td></tr>`;
  }).join('') : '';
  return [
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial">',
    `<h2 style="color:#b91c1c;margin:0 0 8px 0">[AbaYa Track] ${escapeHtml(kind)}</h2>`,
    `<div style="color:#555;margin-bottom:12px">${escapeHtml(nowIso())} • host ${escapeHtml(os.hostname())}</div>`,
    '<table style="border-collapse:collapse;font-size:13px">', rows, '</table>',
    ctxRows ? '<h3 style="margin:16px 0 4px 0;font-size:13px;color:#555">Snapshot</h3><table style="border-collapse:collapse;font-size:12px">' + ctxRows + '</table>' : '',
    '</div>',
  ].join('');
}

class AlertManager {
  constructor(opts) {
    this.apiKey = (opts && opts.apiKey) || process.env.RESEND_API_KEY || '';
    this.to = parseList((opts && opts.to) || process.env.ALERTS_TO);
    this.from = (opts && opts.from) || process.env.ALERTS_FROM || 'AbaYa Track <alerts@example.com>';
    this.dedupMs = (opts && opts.dedupMs) || DEFAULT_DEDUP_MS;
    this.hourlyCap = (opts && opts.hourlyCap) || DEFAULT_HOURLY_CAP;
    this.dryRun = String(process.env.ALERTS_DRY_RUN || '').trim() === '1' || (opts && opts.dryRun === true);
    this.getContext = (opts && opts.getContext) || (() => ({}));
    this.log = (opts && opts.log) || ((...args) => console.log('[alerts]', ...args));
    this.lastSentAt = new Map(); /** kind -> ms */
    this.recentSends = []; /** array of ms timestamps */
    this.disabled = !isEnabled({ apiKey: this.apiKey, to: this.to });
    this.stats = { sent: 0, suppressedCooldown: 0, suppressedCap: 0, failed: 0, lastSentAt: null, lastError: null };
  }

  isEnabled() {
    return !this.disabled;
  }

  shouldSend(kind) {
    if (this.disabled) return { ok: false, reason: 'disabled' };
    const now = Date.now();
    /** Hourly cap. */
    this.recentSends = this.recentSends.filter((ts) => now - ts < 60 * 60 * 1000);
    if (this.recentSends.length >= this.hourlyCap) {
      this.stats.suppressedCap += 1;
      return { ok: false, reason: 'hourly-cap' };
    }
    /** Per-kind cooldown. */
    const last = this.lastSentAt.get(kind);
    if (last != null && now - last < this.dedupMs) {
      this.stats.suppressedCooldown += 1;
      return { ok: false, reason: 'cooldown' };
    }
    return { ok: true };
  }

  async notify(kind, body) {
    const decision = this.shouldSend(kind);
    if (!decision.ok) {
      this.log('suppress', kind, decision.reason);
      return decision;
    }
    const subject = `[AbaYa Track] ${kind} on ${os.hostname()}`;
    let ctx = {};
    try { ctx = this.getContext() || {}; } catch (_) { /* best-effort */ }
    const html = renderHtml(kind, body || {}, ctx);
    const text = JSON.stringify({ kind, body, ctx, at: nowIso(), host: os.hostname() }, null, 2);

    if (this.dryRun) {
      this.log('dry-run', kind, '->', this.to.join(','), subject);
      this.lastSentAt.set(kind, Date.now());
      this.recentSends.push(Date.now());
      this.stats.sent += 1;
      this.stats.lastSentAt = Date.now();
      return { ok: true, dryRun: true };
    }

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.apiKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: this.to,
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const snippet = await res.text().catch(() => '');
        const err = `HTTP ${res.status}: ${String(snippet).slice(0, 240)}`;
        this.stats.failed += 1;
        this.stats.lastError = { ts: Date.now(), error: err };
        this.log('send-failed', kind, err);
        return { ok: false, error: err };
      }
      this.lastSentAt.set(kind, Date.now());
      this.recentSends.push(Date.now());
      this.stats.sent += 1;
      this.stats.lastSentAt = Date.now();
      return { ok: true };
    } catch (e) {
      const err = e && e.message ? e.message : String(e);
      this.stats.failed += 1;
      this.stats.lastError = { ts: Date.now(), error: err };
      this.log('send-failed', kind, err);
      return { ok: false, error: err };
    }
  }

  getStats() {
    return Object.assign({ enabled: !this.disabled, dryRun: this.dryRun, recipients: this.to.length }, this.stats);
  }
}

/**
 * Wire the alert manager to ingest events + reconcile + snapshot health hooks.
 *
 * @param {AlertManager} manager
 * @param {{
 *   ingestEvents: import('events').EventEmitter,
 *   getReconcileStatus?: () => any,
 *   getSnapshotStatus?: () => any,
 *   pollIntervalMs?: number,
 * }} hooks
 * @returns {{ stop: () => void }}
 */
function wireServerEvents(manager, hooks) {
  if (!manager || !manager.isEnabled || !manager.isEnabled()) {
    return { stop() {} };
  }
  const onAuth = (info) => {
    void manager.notify('cloud-auth-error', {
      message: 'Cloudflare ingest is rejecting our credentials. Sessions are queued locally until fixed.',
      details: info,
      remediation: 'Verify CF_INGEST_SECRET in .env matches the Worker INGEST_SECRET. Then run: pm2 restart abaya-server.',
    });
  };
  const onPermanent = (info) => {
    void manager.notify('cloud-permanent-error', {
      message: 'Cloudflare ingest returned a non-retriable client error. Event recorded in ceo-ingest-rejected.jsonl.',
      details: info,
      remediation: 'Inspect data/ceo-ingest-rejected.jsonl and verify payload shape vs Worker handlers/ingest.js.',
    });
  };
  const onBacklog = (info) => {
    void manager.notify('cloud-queue-backlog', {
      message: 'CEO ingest queue has been above threshold for the configured duration.',
      details: info,
      remediation: 'Check connectivity to CF_WORKER_URL, then `yarn pm2:logs` and `curl /api/ceo-ingest-status` for current stats.',
    });
  };

  hooks.ingestEvents.on('auth-error', onAuth);
  hooks.ingestEvents.on('permanent-error', onPermanent);
  hooks.ingestEvents.on('queue-backlog', onBacklog);

  let lastSnapshotErr = null;
  let lastReconcileFailureSig = null;
  let timer = null;
  const pollMs = Math.max(60 * 1000, Number(hooks.pollIntervalMs) || 5 * 60 * 1000);

  function poll() {
    try {
      if (typeof hooks.getSnapshotStatus === 'function') {
        const s = hooks.getSnapshotStatus();
        const e = s && s.lastErr;
        if (e && e.message && (!lastSnapshotErr || lastSnapshotErr.message !== e.message)) {
          lastSnapshotErr = e;
          void manager.notify('snapshot-failure', {
            message: 'SQLite snapshot writer reported a failure.',
            details: e,
            remediation: 'Inspect data/sqlite-snapshots/ permissions and disk space; run `yarn snapshot:db` manually.',
          });
        }
      }
      if (typeof hooks.getReconcileStatus === 'function') {
        const r = hooks.getReconcileStatus();
        const last = r && r.lastResult;
        if (last && (last.error || last.hard_failures > 0)) {
          const sig = (last.error || '') + ':' + last.hard_failures;
          if (sig !== lastReconcileFailureSig) {
            lastReconcileFailureSig = sig;
            void manager.notify('reconcile-failure', {
              message: 'Reconciliation tick reported failures.',
              details: last,
              remediation: 'Check `/api/ceo-ingest-status` for queue depth and last errors. Trigger a manual run via POST /api/reconcile-now.',
            });
          }
        } else if (last && last.ok) {
          /** Reset signature so next failure re-alerts. */
          lastReconcileFailureSig = null;
        }
      }
    } catch (e) {
      manager.log('poll error', e && e.message);
    } finally {
      timer = setTimeout(poll, pollMs);
    }
  }
  timer = setTimeout(poll, Math.min(15000, pollMs));

  return {
    stop() {
      hooks.ingestEvents.off('auth-error', onAuth);
      hooks.ingestEvents.off('permanent-error', onPermanent);
      hooks.ingestEvents.off('queue-backlog', onBacklog);
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = {
  AlertManager,
  wireServerEvents,
  isEnabled,
};
