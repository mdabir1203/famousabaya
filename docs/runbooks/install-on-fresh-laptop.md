# Install AbaYa Track on a fresh factory PC

> **TL;DR — one-liner on any Windows laptop with internet:**
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1
> ```
> The script downloads from R2, runs NSIS silently, and lands in
> `C:\Program Files\AbaYa Track Launcher\`. ~5 min, no git, no npm.

---

## Why this doc: the four folders confusion

Abir has hit this several times: the folder the **build** lives in, the folder
the **factory server** runs from, the folder NSIS **installs the launcher** into,
and the folder that holds **per-user data** are four different paths with
similar shapes. Confusing them is the #1 cause of "publish seemed to work but
nothing changed" or "I edited the wrong copy of server.js".

### The four paths

| # | Path | Role | Who touches it |
|---|---|---|---|
| 1 | `C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2` (or any clone) | **Dev workspace** — source code, `install/` (build output), `scripts/`, `cloudflare/`, `server.js` | Abir, building releases |
| 2 | `C:\Abaya-Track-v1.0.2` (or wherever server.js is deployed) | **Factory server root** — `server.js` + `data/` + `install/` + `scripts/`. PM2 runs server.js from here. | the factory PC, serving 3111 |
| 3 | `C:\Program Files\AbaYa Track Launcher\` | **Installed launcher** — the Electron EXE NSIS put here. Has `productName` "AbaYa Track Launcher" from `tools/desktop-launcher/package.json`. | every factory laptop's launcher |
| 4 | `%APPDATA%\AbaYa Track\` | **Per-user data** — `.env`, `factory-data\lan-update-mirror\stable\`, sqlite snapshots | server.js + launcher write here |

**`C:\Program Files\AbazaTrack` does not exist.** When the operator types
"AbazaTrack" they mean folder #3 — the actual installed path is
`C:\Program Files\AbaYa Track Launcher\` (with capital Y, with "Launcher" at
the end).

### Which folder goes where

```
        build on dev box              deploy to factory server          install on each factory laptop
        ────────────────              ────────────────────────          ──────────────────────────────
   #1   dev workspace          ─►   #2  factory server root      ─►   #3   launcher install dir
        C:\Users\…\Desktop\             C:\Abaya-Track-v1.0.2\              C:\Program Files\
        AbaYa-Track-v1.0.2\                                                   AbaYa Track Launcher\
        │                              │                                    │
        │  yarn build                   │  node server.js                    │  AbaYa Track Launcher.exe
        │  electron-builder             │  (PM2 keeps it alive)              │  (NSIS-installed)
        │  → writes install/            │  serves /updates/stable/           │  (electron-updater client)
        │                              │  from data/lan-update-mirror/      │
        │                              ▼                                    ▼
        #4                            #4   per-user data (env, mirror, sqlite snapshots)
                                       %APPDATA%\AbaYa Track\
```

**Folder #2 is the bridge.** server.js (folder #2) and publish-lan-update-mirror.mjs
(folder #2) both reference `<REPO_ROOT>/data/lan-update-mirror/stable/`. If
they are not co-located, set `ABAYA_LAN_UPDATE_MIRROR_DIR` in server.js's
.env to the actual destination.

---

## Three recipes — pick based on the laptop's state

### Recipe A — Fresh factory PC (no git, no node, internet)

This is the "easy install on any laptop" recipe. Use `install-factory-pc.ps1`.

**On your dev box** (folder #1), confirm the version you want to ship is on
R2 and the build pipeline is green:
```powershell
(Invoke-WebRequest -Uri 'https://dashboard.farewellabaya.com/updates/stable/latest.yml' -UseBasicParsing).Content
```

**On the target factory PC** (PowerShell as admin):
```powershell
# Copy install-factory-pc.ps1 to the target (USB stick, shared drive, or download it)
powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1
# defaults: Version = tools/desktop-launcher/package.json#version
#           MirrorBase = https://dashboard.farewellabaya.com/updates/stable
```

To install a specific version:
```powershell
powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1 -Version 1.2.38
```

To use the LAN mirror (faster, no WAN dependency):
```powershell
powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1 -MirrorBase http://192.168.0.101:3111/updates/stable
```

**What the script does:**
1. Downloads `<MirrorBase>/AbaYa-Track-Launcher-Setup-<Version>.exe` to `%TEMP%`.
2. Stops any running `AbaYa Track Launcher.exe`.
3. Runs the installer with `/S` (silent NSIS).
4. Verifies `C:\Program Files\AbaYa Track Launcher\AbaYa Track Launcher.exe` exists.
5. Cleans up `%TEMP%` (unless `-KeepInstaller` is set).

**What the script does NOT do** (and that's intentional):
- It does not start a factory server — that's a separate role. If this laptop
  is supposed to be the one running `192.168.0.x:3111`, deploy folder #2 to it
  (git clone + yarn install + `pm2 start ecosystem.config.cjs`). The launcher
  only needs folder #3 + folder #4 to function.

### Recipe B — Other factory PC already on LAN, faster than R2

Same script, point it at the factory server's mirror:
```powershell
powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1 -MirrorBase http://192.168.0.101:3111/updates/stable
```

The factory server's `/updates/stable/` (folder #4, served by server.js) returns
the latest `latest.yml + installer + blockmap`. The script doesn't care which
mirror — it just downloads from whatever URL.

To pre-populate that LAN mirror from your dev box:
```powershell
# On the factory server (folder #2):
node scripts\publish-lan-update-mirror.mjs --channel stable --from install
```
This is the command Abir originally typed. It writes
`latest.yml + .exe + .blockmap` into `<REPO_ROOT>/data/lan-update-mirror/stable/`,
which server.js then serves.

### Recipe C — Already-installed laptop just needs to bump version

Easiest of all. The launcher's auto-updater polls every 6h. Force an immediate
check:
1. Start the launcher.
2. Open **Control Center** → **Check Updates**.
3. It will see whatever is on the mirror and update in the background.

Or just wait — next 6h probe picks it up. No operator action needed.

---

## Post-install verification checklist

After Recipe A or B:

- [ ] `C:\Program Files\AbaYa Track Launcher\AbaYa Track Launcher.exe` exists
- [ ] Start Menu has an "AbaYa Track Launcher" shortcut
- [ ] First launch opens the launcher window (no NSIS SmartScreen prompt if
      the user's already accepted the publisher name on this account)
- [ ] `%APPDATA%\AbaYa Track\.env` is seeded with `PORT=3111` and the CF values
      (look for `env-migrate.cjs` "PORT-3111 OK" log)
- [ ] Control Center → About shows the version you installed

For laptops that are the factory server (folder #2), additional checks:

- [ ] `pm2 list` shows `abaya-server` online
- [ ] `pm2 list` shows `catalog-watcher` online (no `.pnp.cjs` errors)
- [ ] `curl http://127.0.0.1:3111/api/state` returns JSON with at least one session
- [ ] `curl http://192.168.0.101:3111/updates/stable/latest.yml` returns the version you shipped

---

## Troubleshooting

### "The script ran but the launcher didn't appear"
Check `C:\Program Files\AbaYa Track Launcher\` exists. NSIS sometimes prompts
the user for an install path on first run if `oneClick` isn't set. Add
`"oneClick": true` to `tools/desktop-launcher/package.json#build.win` to force
silent install to the default path.

### "Installer hit SmartScreen / 'Unknown publisher'"
`CSC_LINK_BASE64` contains a self-signed cert (v1.2.36 release notes). The
launcher has `verifyUpdateCodeSignature: false` (v1.2.37) so updates work, but
NSIS SmartScreen is a separate Windows-level prompt. Operator clicks "More info"
→ "Run anyway" once per laptop.

### "I edited server.js but the change didn't show up on the factory"
You're probably looking at folder #1 (dev workspace) but the factory server
runs folder #2. Either:
- Commit + redeploy (`git pull && pm2 restart abaya-server` on folder #2), OR
- Edit folder #2 directly (but then your repo is dirty).

### "publish-lan-update-mirror.mjs says published, but launchers still see old version"
Run the script on the factory server (folder #2), not on your dev box (folder
#1). The script writes into `<REPO_ROOT>/data/lan-update-mirror/stable/` of
whichever folder you ran it from. If you ran it on folder #1, it wrote to
folder #1's `data/` directory — which folder #2 doesn't read.

The new sanity header in `publish-lan-update-mirror.mjs` (v1.2.38+) prints
REPO_ROOT at the top, so this trap is visible immediately.