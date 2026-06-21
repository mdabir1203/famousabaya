# AbaYa Track - World-Class Update System Blueprint

This design upgrades your current updater into a long-term, low-risk system that works over cloud, Wi-Fi, and mobile internet while preserving your existing architecture.

It intentionally keeps current building blocks:

- `electron-updater` + GitHub Releases
- `tools/desktop-launcher/main.js`
- your existing runbooks in `docs/ONLINE_UPDATES.md` and `docs/UPDATE_RUNBOOK.md`

## Context

### In scope

- Reliable launcher updates for client laptops from any network with internet access.
- Controlled rollout strategy (stable and beta rings).
- Safe defaults that do not break current deployments.
- Operational visibility for support teams.

### Out of scope (for this phase)

- Full server/runtime binary replacement of `server.js` and all local data in-place.
- Forced auto-restart without operator control.
- New infrastructure provider migration.

### Primary journey

1. Client laptop starts launcher.
2. Launcher determines channel (`stable`/`beta`) with deterministic policy.
3. Launcher checks updates with jittered schedule and backoff.
4. If update exists, it downloads in background.
5. Operator applies update (or update applies on quit if enabled).
6. Next launch confirms new version and runtime health.

### Constraints and assumptions

- Internet path can be broadband, office Wi-Fi, hotspot, or mobile tethering.
- Bandwidth and latency vary; scheduler must tolerate intermittent links.
- Existing clients must continue working unchanged if no policy file exists.

## Containers

### 1) Desktop Launcher (existing)

- **Purpose:** Update orchestrator on each laptop.
- **Responsibilities:** channel resolution, check/download/apply workflow, status UI.
- **Owned state:** update status in memory, local update audit log.
- **Scaling:** one launcher process per laptop.

### 2) Release Registry (existing GitHub Releases)

- **Purpose:** globally accessible update distribution endpoint.
- **Responsibilities:** host signed installer artifacts and `latest.yml`.
- **Owned state:** release metadata per version/channel.

### 3) LAN update mirror (optional, factory server)

- **Purpose:** serve the same `latest.yml` + NSIS artifacts over factory Wi‑Fi from `server.js` (`/updates/<channel>/`).
- **Responsibilities:** reduce internet bandwidth; keep GitHub as canonical build + fallback.
- **Owned state:** files under `data/lan-update-mirror/` (or `ABAYA_LAN_UPDATE_MIRROR_DIR`).

### 4) Operator Runbooks (existing docs)

- **Purpose:** repeatable release and rollback operations.
- **Responsibilities:** publish sequence, health gates, incident response.
- **Owned state:** operational process, not runtime data.

## Interfaces

### Sync interfaces

- Launcher -> release provider: update check + artifact download (HTTPS GitHub, or HTTP(S) **generic** feed when LAN mirror probe succeeds).
- Launcher -> optional LAN mirror: `GET {ABAYA_UPDATE_MIRROR_BASE_URL}/updates/{channel}/latest.yml` probe, then generic feed `{base}/updates/{channel}/`.
- Renderer -> launcher IPC:
  - `update-status`
  - `update-check-now`
  - `update-install-now`
  - `dismiss-update-success`
  - `export-diagnostics`

### Policy contract

- Optional file: `config/update-policy.json` (safe if missing).
- Template: `config/update-policy.example.json`.
- Fields:
  - `defaultChannel`: `stable|beta`
  - `betaPercent`: deterministic percentage of devices on beta
  - `checkIntervalMinutes`
  - `retryIntervalMinutes`
  - `maxBackoffMinutes`
  - `jitterPercent`
  - `rolloutSeed`
  - `auditLogMaxBytes` (rotate active JSONL when exceeded)
  - `auditLogMaxArchives` (keep newest N rotated `update-events.*.jsonl` files)

### Post-install marker

- `data/desktop-launcher/pending-update.json` written when an update is fully downloaded (and again right before install / before-quit-for-update).
- On next launch, if `app.getVersion()` equals `expectedVersion`, the launcher shows a one-time success banner and deletes the marker.
- If versions drift (manual reinstall), the marker is removed without showing a false positive.

### Operator UI (Control Center)

- Trust row: last successful check time, next scheduled check, live retry countdown, last error, release-notes availability.
- Release notes URL: GitHub tag link from packaged `package.json` publish config when updater does not supply a URL.
- Export diagnostics: single JSON file via save dialog (update snapshot, policy, PM2/port summary, runtime versions, audit tail).

### Telemetry contract

- Local audit log: `data/desktop-launcher/update-events.jsonl`
- Event examples:
  - `updater-ready`
  - `check-scheduled`
  - `check-ok`
  - `check-failed`
  - `update-available`
  - `update-downloaded`
  - `install-requested`
  - `before-quit-for-update` (when auto-install-on-quit path runs)
  - `update-applied-success`
  - `diagnostics-exported`

## Devil's advocate verification matrix

Peer-style checks before trusting a rollout:

| Attack / failure | Expected behavior |
|------------------|---------------------|
| GitHub / DNS unreachable | Phase `error`, `lastErrorAt` populated, backoff increases `nextCheckAt`, trust row shows retry countdown |
| Policy file missing | Defaults apply; updater still runs |
| Policy file invalid JSON | Treated as empty object; defaults apply |
| Audit log grows without bound | Rotation at `auditLogMaxBytes`; old files pruned to `auditLogMaxArchives` |
| User downloads but never installs | `pending-update.json` kept; no false success banner while `current === previous` |
| User installs then support asks for logs | **Export diagnostics** includes tail of audit log and PM2 snapshot |
| Release tag not `vX.Y.Z` | Release notes link may 404; operator still uses GitHub Releases page manually |
| `before-quit-for-update` never fires on a build | `pending-update.json` still written on `update-downloaded` and manual **Install & Restart** |

## Risks and Mitigations

- **Risk:** simultaneous check storms after large restart waves.
  - **Mitigation:** randomized check jitter per device.
- **Risk:** unstable internet causes repeated failures and noisy incidents.
  - **Mitigation:** exponential backoff retry with cap.
- **Risk:** uncontrolled beta exposure.
  - **Mitigation:** deterministic bucket assignment via `betaPercent` + seed.
- **Risk:** weak observability during field incidents.
  - **Mitigation:** append-only local update event log for forensic debugging.
- **Risk:** operator confusion across runbooks.
  - **Mitigation:** keep current runbooks and add this design as source-of-truth architecture.

## Decisions (ADR style)

### Decision 1 - Keep electron-updater and GitHub Releases

- **Context:** current system already uses these successfully.
- **Decision:** extend reliability and governance around existing mechanism.
- **Options considered:** switch providers now; build custom updater service.
- **Trade-off:** fastest time-to-value, lowest migration risk, less custom control.
- **Consequence:** immediate improvement without disturbing installed base.

### Decision 2 - Policy-driven ring rollout in launcher

- **Context:** need controlled rollout similar to Chrome-like ringing.
- **Decision:** optional local JSON policy; default remains stable.
- **Options considered:** hardcoded env-only channel, external control-plane API first.
- **Trade-off:** local policy is simple and robust offline, but less centrally dynamic.
- **Consequence:** support teams can gradually promote safely across fleet.

### Decision 3 - Add local audit log first, central analytics second

- **Context:** field support needs root cause visibility now.
- **Decision:** write JSONL events locally in launcher data dir.
- **Options considered:** build centralized telemetry pipeline before shipping.
- **Trade-off:** local logs are simple and private but require collection step.
- **Consequence:** immediate diagnostics with minimal complexity.

## Rollout Plan

1. **Phase 1 (now):** deploy new launcher with policy + backoff + audit.
2. **Phase 2:** set `betaPercent` to 5 and validate 24h.
3. **Phase 3:** increase `betaPercent` to 15/25 as gates pass.
4. **Phase 4:** promote release to stable for all devices.

## Maintenance Rules

- Keep `stable` as default.
- Promote by percentage, not all-at-once.
- Never remove rollback release path.
- Keep `update-events.jsonl` for incident windows and support audits.
