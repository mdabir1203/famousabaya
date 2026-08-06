# Online Updates Runbook (GitHub Releases)

This runbook defines how to publish, roll out, and roll back Electron desktop launcher updates safely.

Architecture and long-term operating model: [WORLD_CLASS_UPDATE_SYSTEM.md](WORLD_CLASS_UPDATE_SYSTEM.md)

## Prerequisites

- GitHub repo with Releases enabled.
- Windows signing certificate configured as repo secrets:
  - `WINDOWS_CERT_BASE64` (base64-encoded `.pfx`)
  - `WINDOWS_CERT_PASSWORD`
- CI workflow file: `.github/workflows/release-desktop-launcher.yml`
- Desktop launcher updater integration in:
  - `tools/desktop-launcher/main.js`
  - `tools/desktop-launcher/preload.js`
  - `tools/desktop-launcher/renderer.js`

## LAN mirror (factory Wi‑Fi, optional)

When the factory **Node server** (`server.js`) is running on the LAN, it can serve Electron update artifacts so laptops pull updates over local HTTP first. If the mirror is missing or unreachable, packaged launchers **fall back to GitHub** (same as before).

### Layout on the server host

- Default directory: `data/lan-update-mirror/<channel>/` where `<channel>` is `stable` or `beta`.
- Override directory with env **`ABAYA_LAN_UPDATE_MIRROR_DIR`** (absolute path recommended for non-default disks).
- HTTP paths (same origin as the app, e.g. `http://192.168.1.10:3000`):
  - `GET /updates/stable/latest.yml` (+ `.exe`, `.exe.blockmap`, … in that folder)
  - `GET /updates/beta/beta.yml` and `GET /updates/beta/latest.yml` (+ artifacts)
- Metadata naming follows electron-updater (`<channel>.yml`): the **stable** ring fetches `latest.yml`, the **beta** ring fetches `beta.yml`. `scripts/publish-lan-update-mirror.mjs` always places both names in the mirror — the launcher probes and the health endpoint key on `latest.yml`.
- Health check: `GET /api/updates/mirror-health` (JSON: per-channel `latest.yml` presence and file list).

### Publish workflow (after `electron-builder` produced artifacts)

From repo root, copy a built folder (e.g. `dist/desktop-launcher` after CI or local `yarn workspace` build) into the mirror:

```bash
yarn publish:lan-mirror -- --channel stable --from dist/desktop-launcher
yarn publish:lan-mirror -- --channel beta --from dist/desktop-launcher
```

Or directly:

```bash
node scripts/publish-lan-update-mirror.mjs --channel stable --from dist/desktop-launcher
```

Requirements in the `--from` directory: `latest.yml` or `beta.yml` (whichever electron-builder produced), at least one `.exe`, and matching `.exe.blockmap` when present.

### Launcher configuration (client PCs)

Set **`ABAYA_UPDATE_MIRROR_BASE_URL`** to the factory server origin **only** (no `/updates` suffix required), for example:

- In each machine environment: `ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.1.10:3000`
- Or in repo root **`.env`** (read by the launcher the same way as `PORT`): `ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.1.10:3000`

Behavior (packaged app only):

1. On startup, launcher probes the exact metadata file the updater will fetch — `GET {base}/updates/{channel}/latest.yml` for the stable ring, `GET {base}/updates/{channel}/beta.yml` for the beta ring.
2. If the probe succeeds → `electron-updater` uses **generic** feed at `{base}/updates/{channel}/`.
3. If the probe fails or the variable is unset → feed is **GitHub** from `tools/desktop-launcher/package.json` `build.publish` (including `releaseType` when set, e.g. `draft`).
4. If the first update error happens while on **LAN** feed, launcher switches once to **GitHub** and retries check (`updater-fallback-github-after-lan-error` in audit log).

Operator UI shows **Feed** and **probe** in the update details line; **Export diagnostics** includes `update` with `updateFeedSource`, `updateMirrorBaseUrl`, `updateMirrorFeedUrl`, `updateMirrorProbeOk`, `updateMirrorProbeMessage`.

### LAN mirror validation (expected outcomes)

| Scenario | Expected |
|----------|----------|
| Mirror populated + `ABAYA_UPDATE_MIRROR_BASE_URL` set | Launcher shows `Feed: lan`, `probe:ok`; `GET /api/updates/mirror-health` shows `latest.yml` for that channel |
| Mirror empty / server down / wrong IP | `Feed: github`, probe message contains `lan-unavailable` or `no-mirror-config` |
| LAN works then mirror removed mid-session | First updater error may trigger one-time fallback: audit `updater-fallback-github-after-lan-error`, then `Feed: github` |
| Internet blocked, mirror OK | Updates still check and download from LAN generic feed |

## Release Channels

- `stable` channel: production rollout to all clients.
- `beta` channel: pilot ring for early validation.

Channel routing:
- Tags with `beta` in the name -> `beta` channel behavior.
- All other semver tags -> `stable`.

Recommended tags:
- Stable: `v1.2.3`
- Beta: `v1.2.4-beta.1`

Optional rollout control:
- Copy `config/update-policy.example.json` to `config/update-policy.json`
- Set `betaPercent` for deterministic staged rollout by device
- Optional: `auditLogMaxBytes` (default 2 MiB) and `auditLogMaxArchives` (default 5) cap `data/desktop-launcher/update-events*.jsonl` growth

## Launcher operator UX (field)

- **Trust row:** Last checked, next check, retry countdown, last error, and release-notes hint (see Control Center UI).
- **Release notes:** Opens GitHub release tag URL derived from `tools/desktop-launcher/package.json` `build.publish` when not provided by the updater metadata.
- **Post-update banner:** After a successful install and restart, a short confirmation shows previous vs current version until dismissed.
- **Install & Restart** applies the update immediately (the window close-confirmation is bypassed for the install quit) — no extra dialogs.
- **Diagnostics:** Button **Export diagnostics** saves a JSON file (save dialog) with update state, policy snapshot, PM2/port summary, runtime versions, and tail of the update audit log. Use for support tickets.

## Operator Checklist: Publish

1. Confirm launcher version bump in `tools/desktop-launcher/package.json`.
2. Push tag (`vX.Y.Z` or `vX.Y.Z-beta.N`).
3. Wait for `Release Desktop Launcher` workflow to finish.
4. Verify GitHub Release assets exist:
   - installer (`.exe`)
   - blockmap
   - `latest.yml` (stable tags) or `beta.yml` (beta tags)
5. Install current previous version on test laptop and verify update prompt/download/install path.

## Staged Rollout Strategy (Pareto)

1. Phase 1 (pilot): 1-2 laptops on `beta`.
2. Phase 2 (controlled): 5-25% on `stable` for 24 hours.
3. Phase 3 (full): 100% once no critical regressions.

## Health Gates

Do not progress rollout unless all are true:
- Update check success >= 99%.
- Download success >= 98%.
- Apply/restart success >= 98%.
- No critical runtime break (launcher start, server start, watcher start).

## Rollback Procedure

If failure threshold is breached:

1. Stop further rollout immediately.
2. Publish rollback release from previous known-good tag.
3. Mark problematic release as not promoted and document issue in release notes.
4. Verify pilot devices recover on next check cycle.

## Incident Triage Notes

- If updater fails in development mode: expected (`app.isPackaged` false).
- If update downloads but does not apply: use `Install & Restart` button in launcher UI.
- If resolver issues appear, verify launcher process isolation in `scripts/run-launcher.cjs`.

## Support Script (Client)

For client support teams:
1. Ask user to open launcher.
2. Click **Export diagnostics** and attach the saved JSON to the ticket (or use **Export diagnostics** after reproducing the issue).
3. Click `Check Updates`.
4. If update is downloaded, click `Install & Restart`.
5. Confirm launcher version and runtime health after restart.
