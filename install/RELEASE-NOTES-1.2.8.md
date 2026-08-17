# AbaYa Track Launcher v1.2.8

Factory-installed desktop launcher (Electron + electron-updater). Auto-updates
from the LAN mirror at `http://192.168.0.101:3111/updates/stable/`.

## What changed in 1.2.8

### Fixes

- **Cloud ingest 401 on fresh installs.** The first-run `%APPDATA%\.env` was
  seeded from `.env.example`, which contains the literal placeholder
  `CF_INGEST_SECRET=REPLACE_WITH_A_STRONG_RANDOM_SECRET_LIKE_uuid4`. Every
  push to the Cloudflare worker 401'd. The installer now ships
  `install/.env.production` with the real `CF_INGEST_SECRET`, and the
  launcher seeds `%APPDATA%\.env` from it on first run.
- **Auto-updater falling through to GitHub (401).** `ABAYA_UPDATE_MIRROR_BASE_URL`
  was commented out in the shipped `.env`, so the launcher fell through to
  the GitHub provider. GitHub deprecated anonymous access to
  `releases.atom` in 2024, so every check 401'd. Mirror URL is now uncommented
  in the shipped env, and the `dev-app-update.yml` port is fixed
  (`3000` → `3111` to match the real `PORT`).
- **Employee / item photos lost on every .exe update.** The packaged app
  was writing uploads under the install dir, which gets wiped on
  reinstall/update. Photos now land in
  `<ABAYA_DATA_DIR>/public/uploads/{employees,items}/` — same URL paths,
  survives updates. The new `/uploads` static handler serves from the stable
  root; `attachEmployeeImagesFromDisk` checks both locations on startup.
- **`app-update.yml` not in the build output.** The launcher's
  `electron-builder` `files` list now explicitly includes
  `app-update.yml` + `dev-app-update.yml` so packaged builds ship the yml.
- **`install/.env.production` not shipped.** The build's
  `extraResources` now bundles it, and `BUILD-AND-PUBLISH.ps1` pre-fills it
  from `.env` if missing.

### Internal

- `BUILD-AND-PUBLISH.ps1` re-saved as UTF-8 **with BOM** so Windows
  PowerShell 5.1 parses it (the previous save left it without a BOM and
  the script failed to parse because of `&` in the title).
- New test suite `tests/upload-stable-dir.test.mjs` locks in the
  `ABAYA_DATA_DIR` redirect.
- `publish-lan-update-mirror.mjs` already handled the multi-channel
  `latest.yml` + `beta.yml` case correctly; no changes.

## Asset layout (unchanged contract)

- `AbaYa-Track-Launcher-Setup-1.2.8.exe` — NSIS installer (per-user,
  ~96 MB).
- `AbaYa-Track-Launcher-Setup-1.2.8.exe.blockmap` — differential update
  metadata used by `electron-updater` for partial downloads.
- `latest.yml` — feed manifest pointing at the above.

## Upgrade impact

Factory laptops already on 1.2.7 will see "Update available" on the next
`checkForUpdates()` cycle (default ~6h, or sooner on resume) and
self-install 1.2.8. The first launch after the upgrade:

- Reads the now-correct `%APPDATA%\.env` (already shipped in 1.2.7+
  builds; this version just guarantees a clean seed for new installs).
- Cloud pushes (`session_start`, `session_finish`, employees, catalog)
  succeed with the real `CF_INGEST_SECRET`.
- Auto-updater stays on the LAN mirror — no GitHub fallback 401.
- Existing employee/item photos persist (1.2.8 reads the install-relative
  `public/uploads/` as a fallback before settling on the stable dir).

## Verified

- `node --check` clean on every changed `.js` / `.cjs`.
- 37/37 tests pass (`ceo-report`, `launcher-update`, `qa-qc`,
  `safe-json-response`, `upload-stable-dir`).
- End-to-end photo upload + retrieval tested with both dev path
  (`public/uploads/`) and packaged path (`<ABAYA_DATA_DIR>/public/uploads/`).
- LAN mirror probe `http://127.0.0.1:3111/updates/stable/latest.yml` returns
  `200` with version `1.2.8` and a fresh sha512.
- `GET /api/updates/mirror-health` → `ok: true` with all 4 files in the
  stable channel.
