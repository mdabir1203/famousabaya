# AbaYa Track — install & run (Windows)

## One click

**Double-click `START.bat`** (in the project root). That's the whole install.

It is safe to run again any time (idempotent). On the first run it:

1. Uses your system Node.js if version ≥ 18 is installed; otherwise downloads a
   **private, portable Node** into `.bin\` (~28 MB, no admin, nothing installed
   system-wide).
2. Installs app dependencies (`corepack` + `yarn`).
3. Creates `.env` from `.env.example` if missing.
4. Registers **auto-start on login** (per-user Startup shortcuts — no admin).
5. Starts the **factory server** (port 3000) hidden + auto-restart, and — if Bun is
   installed — the **dispatch server** (port 3111: leaderboard, invoice upload,
   WhatsApp). A dispatch server already running on 3111 is left untouched.
6. Checks the LAN firewall rule and tells you if tablets are still blocked.
7. Opens the **dashboard** and **kiosk** in your browser.

Both servers bind to all interfaces, so tablets reach them at
`http://<this-laptop-LAN-IP>:3000` and `:3111` — no IP configuration needed.

To **disable auto-start** for a run: set `ABAYA_SKIP_AUTOSTART=1` before launching,
or delete the `…\Startup\AbaYa Track Server.lnk` / `AbaYa Track Dispatch.lnk` shortcuts.

## Let tablets connect (firewall — one time, needs admin)

Windows Firewall can block inbound LAN connections on a fresh laptop. To allow
tablets on the same Wi-Fi to reach ports 3000 and 3111, right-click
**`install\OPEN-LAN-FIREWALL.ps1` → Run with PowerShell (as administrator)** once.
`START.bat` detects when this rule is missing and reminds you. (It can't add the rule
itself — changing the firewall requires admin.)

## Cloud data on a new laptop

- **Catalog** syncs down automatically every ~60 s once cloud credentials are set —
  no import needed. Set `CF_INGEST_SECRET` in `.env` (the `CF_WORKER_URL` is already
  filled in). New sessions push up automatically.
- **History** lives in the cloud and is viewed on the CEO dashboard
  (`dashboard.farewellabaya.com`); a fresh laptop does not need to download it to
  operate.
- **Optional** — pull full history into a local SQLite store for offline reporting:
  ```
  cd cloudflare
  npx wrangler d1 export abaya-db --remote --output ../data/abaya-cloud.sql
  cd ..
  node scripts/import-snapshot.cjs   # replay into the local store
  ```

## Desktop control panel (optional GUI)

The GUI (start/stop servers, sync, updates) is an Electron app. It has a
**Production / Development toggle** in the header (defaults to **Production**:
`NODE_ENV=production` on every spawned server + auto-updater on).

Three ways to run it, in order of preference:

1. **Packaged installer** (`AbaYa Track Launcher-1.0.0-*.exe`) — best for clients;
   bundles its own runtime, no Node/yarn needed, supports auto-update. See
   *Building the installer* below.
2. **Portable zip** — `dist/desktop-launcher/AbaYa-Track-Launcher-*-portable-x64.zip`.
   Unzip anywhere, run `AbaYa Track Launcher.exe`. Production mode, no install.
3. **From source** (dev): `cd tools/desktop-launcher && yarn install && yarn start`.

## Building the installer

```
cd tools/desktop-launcher
yarn install
yarn dist:win      # → dist/desktop-launcher/*.exe (NSIS one-click installer)
```

**Requirement:** electron-builder unpacks a signing-tools cache that contains macOS
symlinks. Creating symlinks on Windows needs either **Developer Mode ON**
(Settings → System → For developers → *Developer Mode*, a one-time no-admin toggle)
or an **Administrator** terminal. Without one of those the build stops with
`Cannot create symbolic link : A required privilege is not held by the client`.
The portable zip (option 2 above) needs neither and can be produced with
`install/package-portable.ps1` once `win-unpacked` exists.

## Auto-update (OTA)

The packaged app checks for updates on the configured feed. Updates only flow once a
real release is published to a reachable feed (public GitHub releases, or a Cloudflare
generic feed via `ABAYA_UPDATE_MIRROR_BASE_URL`) and `publish.releaseType` is
`release`. Until then the updater logs a harmless `404` (empty feed).

## Advanced / optional scripts (in this folder)

Only `START.bat` is needed for normal use. The rest are optional, situational tools:

- **PM2 service** (boot-before-login, service semantics): `SETUP-PM2-BOOT.ps1`,
  `CHECK-PM2-STATUS.ps1`, `pm2-start.bat` + root `ecosystem.config.cjs`.
- **Scheduled-task autostart**: `REGISTER-STARTUP-SCHEDULER.ps1` /
  `UNREGISTER-STARTUP-SCHEDULER.ps1`.
- **Networking**: `OPEN-LAN-FIREWALL.ps1` (tablets — see above),
  `SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1`, `SETUP-TAILSCALE.ps1`.
- **Runtime picker (Bun/Node)**: `PICK-RUNTIME.bat`, `RUNTIME-COMMON.bat`.
- **Tablet diagnostics**: `CHECK-TABLET-LOG.ps1`, `DIAGNOSE-TABLET-LAN.bat`,
  `PRINT-LAN-TABLET-URL.bat`.

`LAUNCH-ALL.bat` (the older portable-Node + autostart script) still works and is now
superseded by `START.bat`.
