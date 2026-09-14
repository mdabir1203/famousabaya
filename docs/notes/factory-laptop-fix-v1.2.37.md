# Factory Laptop Manual Fix — v1.2.37 (cert + PM2 right now)

> **Use this on the factory laptop when:**
> - LAST ERROR pane shows "version X is not signed by the application
>   owner: publisherNames: AbaYa Track Self Signed"
> - WATCHER LOG shows `Cannot find module ... tools/catalog-watcher/.pnp.cjs`
> - Launcher says "PM2 not running" or PM2 pane is red
>
> **Why manual:** GitHub Actions is rebuilding v1.2.37 right now (~4 min),
> but the factory laptop needs to keep working in the meantime. These
> steps land the same fixes locally without waiting for the auto-update.

---

## What v1.2.37 ships (already pushed to main as commit `2a7dc45`)

1. `verifyUpdateCodeSignature: false` — skip the cert chain check
   inside electron-updater. Self-signed EXEs install cleanly now.
2. `.pnp.cjs` fallback in **both** PM2 wrappers — factory-server
   (`install/pm2-abaya-wrapper.js`) and catalog-watcher
   (`install/pm2-catalog-watcher-wrapper.js`). When `.pnp.cjs` is
   missing (fresh install before LAUNCH-ALL.bat), the wrapper
   spawns plain `node server.js` / `node watch-catalog.js` instead
   of crashing with the cjs/loader error.

Once CI finishes (~4 min), the factory laptop's auto-updater will
pick up v1.2.37 and install it silently in the background — no
manual steps required.

**To skip the manual steps entirely:** just close + relaunch the
launcher on the factory laptop, wait ~5 min for the auto-update
cycle, and let v1.2.37 install itself. The two fixes ship via the
normal update path.

**To fix it RIGHT NOW** (because the floor needs PM2 working before
the next 5-min window): run the manual steps below.

---

## Manual fix (run as Administrator in PowerShell on the factory laptop)

### Step 1 — Patch the cert check in the launcher's main.js

`%LOCALAPPDATA%\Programs\AbaYa Track Launcher\resources\main.js` is
inside an ASAR — not directly editable. Instead, use the launcher's
**override** path (if your launcher supports it) or apply the fix
indirectly:

```powershell
# Backup current launcher
$launcherDir = "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher"
$backupDir = "$env:APPDATA\AbaYa Track\launcher-backups"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item "$launcherDir\AbaYa Track Launcher.exe" "$backupDir\AbaYa-Track-Launcher-pre-1.2.37.exe" -Force
Copy-Item "$launcherDir\resources" "$backupDir\resources-pre-1.2.37" -Recurse -Force
"Backup saved to $backupDir"
```

The cert fix needs `package.json` to change — which IS inside
`resources/app.asar`. To apply this fix manually **without waiting
for CI**, the cleanest path is **download v1.2.37 NSIS installer
directly** once it's on GitHub Releases. CI publishes to GitHub in
~4 min. Watch:

```powershell
# After CI completes (~4 min), download v1.2.37 directly
$installerPath = "$env:USERPROFILE\Downloads\AbaYa-Track-Launcher-Setup-1.2.37.exe"
Invoke-WebRequest -Uri 'https://github.com/mdabir1203/famousabaya/releases/download/v1.2.37/AbaYa-Track-Launcher-Setup-1.2.37.exe' -OutFile $installerPath -UseBasicParsing -TimeoutSec 120

# Run it. NSIS will:
# - Stop the existing launcher
# - Install v1.2.37 alongside (different folder or same folder, NSIS picks)
# - Preserve %APPDATA%\AbaYa Track\ (data, .env, launcher state)
# - Replace the EXE + main.js + package.json in the install dir
& $installerPath
```

When SmartScreen pops "Unknown publisher", click **More info** →
**Run anyway**. The .pfx is self-signed so SmartScreen warns even
with `verifyUpdateCodeSignature: false` — that's a Windows-level
check we can't bypass, but it's a one-time click per laptop.

### Step 2 — Force the watcher to start (RIGHT NOW)

While waiting for v1.2.37 to land, force the catalog-watcher to
work by spawning it directly without PM2 (just for the next ~5 min):

```powershell
# Stop the failing PM2 watcher (it keeps crashing every restart_delay)
$watcherWrapper = "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher\resources\install\pm2-catalog-watcher-wrapper.js"
$watcherDir = "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher\resources\tools\catalog-watcher"

# Stop PM2's failing watcher
& "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher\resources\install\PM2-CMD.bat" stop catalog-watcher

# Launch the watcher directly in the background using plain node
# (the .pnp.cjs file is missing; plain node works because node_modules/ exists)
$watcherProc = Start-Process -FilePath 'node' `
  -ArgumentList 'watch-catalog.js' `
  -WorkingDirectory $watcherDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$env:APPDATA\AbaYa Track\watcher.out.log" `
  -RedirectStandardError  "$env:APPDATA\AbaYa Track\watcher.err.log" `
  -PassThru
"Watcher started as PID $($watcherProc.Id). Logs at $env:APPDATA\AbaYa Track\watcher.out.log"
```

The watcher is now running. Its only job is watching
`%APPDATA%\AbaYa Track\.env`'s `ABAYA_LAN_ASSETS_DIR` folder for
.xlsx changes. If that path is empty or unset in `.env`, the
watcher is idle anyway — no functional impact.

### Step 3 — Verify PM2 is happy after the manual patch

```powershell
& "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher\resources\install\CHECK-PM2-STATUS.ps1"
```

Expected after the manual fix:
```
┌────┬────────────────────┬──────────┬──────┬───────────┬──────────┐
│ id │ name               │ mode     │ ↺    │ status    │ cpu      │
├────┼────────────────────┼──────────┼──────┼───────────┼──────────┤
│ 0  │ abaya-server       │ fork     │ 0    │ online    │ 0%       │
│ 1  │ catalog-watcher    │ fork     │ 0    │ online    │ 0%       │  (after Step 2)
└────┴────────────────────┴──────────┴──────┴───────────┴──────────┘
```

### Step 4 — Clean up the manual watcher before v1.2.37 lands

If you ran Step 2 (direct `node watch-catalog.js`), kill it before
the auto-update installs v1.2.37 (which will spawn its own
catalog-watcher via PM2):

```powershell
Get-Process -Name 'node' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq '' -and $_.StartTime -gt (Get-Date).AddMinutes(-15) } |
    Stop-Process -Force

# Let PM2 take over with the new (fixed) wrapper
& "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher\resources\install\PM2-CMD.bat" start ecosystem.config.cjs --update-env
& "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher\resources\install\PM2-CMD.bat" save
```

### Step 5 — Confirm v1.2.37 auto-update worked

Once the launcher's auto-updater has installed v1.2.37:

```powershell
$launcherDir = "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher"
(Get-Item "$launcherDir\package.json").Version
# Should print: 1.2.37
```

Or visually: in the launcher UI, the version row should say **v1.2.37**.

---

## What NOT to do

- **Don't disable Windows SmartScreen permanently** (gpedit.msc).
  SmartScreen is per-binary; clicking "Run anyway" once is fine.
- **Don't delete `%APPDATA%\AbaYa Track\`** — that's where `.env`,
  `data/`, and the SQLite snapshot live. NSIS never touches it.
- **Don't run `yarn install` in `tools/catalog-watcher/` on the
  factory laptop** unless you also run it in the REPO ROOT. PnP
  state needs to be consistent across both.
- **Don't replace `CSC_LINK_BASE64` with another self-signed cert**
  thinking it'll fix the LAST ERROR. The check is about the
  cert chain, not the cert content. Until you buy a real cert from
  a trusted CA, the v1.2.37 `verifyUpdateCodeSignature: false` flag
  is the only fix.

---

## Rollback

If v1.2.37 breaks something on the factory laptop:

```powershell
# Restore the .exe and resources/ from the backup taken in Step 1
$launcherDir = "$env:LOCALAPPDATA\Programs\AbaYa Track Launcher"
$backupDir = "$env:APPDATA\AbaYa Track\launcher-backups"
Copy-Item "$backupDir\resources-pre-1.2.37" "$launcherDir\resources" -Recurse -Force
Copy-Item "$backupDir\AbaYa-Track-Launcher-pre-1.2.37.exe" "$launcherDir\AbaYa Track Launcher.exe" -Force

# Stop + restart PM2 (re-reads the .env + ecosystem.config.cjs unchanged)
& "$launcherDir\resources\install\PM2-CMD.bat" restart ecosystem.config.cjs --update-env
```

The data/, .env, SQLite snapshot, and PM2 state are untouched by
NSIS — they're in `%APPDATA%\AbaYa Track\` and survive the rollback.

---

## Background — why this happens at all

The auto-update pipeline was broken between v1.2.17 and v1.2.31:
CI was publishing to GitHub Releases but **not** to the R2 mirror or
LAN mirror, so the launcher kept polling stale `latest.yml` files
and never saw a newer version. v1.2.35 fixed that. v1.2.36 fixed the
catalog-watcher `.pnp.cjs` issue. v1.2.37 fixes the same issue in
the factory-server wrapper and disables the cert chain check so
self-signed builds install cleanly.

Future hardening (not in v1.2.37): buying a real code-signing cert
and uploading to `CSC_LINK_BASE64`, then removing the
`verifyUpdateCodeSignature: false` flag.
