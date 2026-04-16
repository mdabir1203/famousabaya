# Install AbaYa Track on a Windows PC

## Package manager: Yarn 4 (PnP — no node_modules)

Packages live in `.yarn/cache`, resolved by `.pnp.cjs`. The ZIP ships with the cache (**zero-install**: no internet needed after unzip).

---

## Build a release ZIP (from the dev machine)

```powershell
yarn run package:release
```

Creates `dist/AbaYa-Track-v1.0.0.zip`. Copy to the target PC via USB or network share.

---

## Install on the target PC

1. Install **[Node.js 18+](https://nodejs.org/)** (LTS).
2. Unzip to a folder (e.g. `C:\AbaYa-Track`).
3. Run `install\INSTALL.bat` once.
4. Edit `.env` — see [START HERE.txt](../START%20HERE.txt). For one shared folder on the factory PC, set `EXCEL_DATA_DIR` to that path (e.g. `C:/Users/DELL/Desktop/barcode`) and place `items_export.xlsx` and `employees.xlsx` there; or set `CATALOG_XLSX_PATH` / `EMPLOYEES_XLSX_PATH` explicitly.
5. For **HTTPS** kiosk PWA (`https://kiosk.farewellabaya.com`), run **`install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1`** once on the factory PC. Print tablet QRs from **`http://localhost:3000/setup`**: set **Custom URL** to the kiosk Pages host and **Factory API for QR** to your tunnel API (default `https://api.farewellabaya.com`). Full sequence: [REMOTE_ACCESS.md](REMOTE_ACCESS.md) (tablet rollout checklist).
6. Double-click **AbaYa Track** on Desktop, or run **`install\LAUNCH-ALL.bat`** — installs dependencies if needed, starts the Cloudflare tunnel when `~\.cloudflared\config.yml` exists, then starts the server, browsers, and optional catalog watcher.
7. **Optional — auto-start at Windows logon (factory + CEO on one PC):** open **PowerShell as Administrator**, `cd` to `install`, run `.\REGISTER-STARTUP-SCHEDULER.ps1`. After each logon, AbaYa starts after a short delay unless something is already listening on `PORT` (default 3000). Cloud updates: **`yarn run deploy:all`** deploys Worker + kiosk Pages; Worker-only: **`install\DEPLOY-CEO-CLOUD.bat`**.

---

## Remote access

| Method | When to use | Guide |
|--------|-------------|-------|
| **Tailscale** (recommended) | Admin/office needs to reach factory server | [TAILSCALE_HYBRID.md](TAILSCALE_HYBRID.md) |
| **Cloudflare Tunnel** (legacy) | Corporate policy blocks mesh VPNs | [REMOTE_ACCESS.md](REMOTE_ACCESS.md) Part D |
| **CEO dashboard** | Client views analytics from phone | `dashboard.farewellabaya.com` |

---

## Files for packaging

| Path | Purpose |
|------|---------|
| `install/INSTALL.bat` | First-time: corepack, yarn install, .env, Desktop shortcut → `LAUNCH-ALL.bat` |
| `install/SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1` | Factory PC: HTTPS/WSS hostname → port 3000 (for `https://kiosk…` tablets) |
| `install/LAUNCH-ALL.bat` | Main launcher: optional first-time `yarn`, optional tunnel, server, browsers, watcher |
| `install/SETUP-TAILSCALE.ps1` | One-click Tailscale install + mesh expose |
| `install/START-AbaYa-Server.bat` | Server-only start |
| `install/START-Catalog-Watcher.bat` | Watcher-only start |
| `install/OPEN-CEO-DASHBOARD.bat` | Windows Firewall helper |
| `install/DEPLOY-CEO-CLOUD.bat` | Cloud Worker deploy only |
| `install/DEPLOY-ALL.ps1` | **Worker + Kiosk Pages** one after another (or `yarn run deploy:all` from repo root) |
| `public/asset-upload.html` | Employee + catalog item **image upload** by barcode (factory browser) |
| `install/REGISTER-STARTUP-SCHEDULER.ps1` | **Admin:** register Task Scheduler — runs `RUN-AT-LOGON.bat` after each logon. Same PC as CEO is fine; this only starts the **local** factory stack. |
| `install/UNREGISTER-STARTUP-SCHEDULER.ps1` | **Admin:** remove that task |
| `install/RUN-AT-LOGON.bat` | Invoked by the task; do not double-click for normal use |
| `scripts/build-release.ps1` | Builds `dist/*.zip` with `.yarn/cache` |

---

## Maintenance cheat-sheet

| Task | What to do |
|------|-----------|
| **HTTPS kiosk still uses `ws://192.168…` (mixed content)** | Redeploy **`kiosk-pwa`**. On the tablet: **gear → change server**, or setup screen **Clear saved address** / **Clear all kiosk data**, or open once **`https://kiosk.farewellabaya.com/?reset=server`** (or **`?reset=all`** to also clear the Excel queue). Default tunnel hint: meta **`abaya-factory-api-base`** in **`kiosk-pwa/index.html`**. |
| **`[catalog-xlsx]` / `[employees-xlsx]` File not found** | `.env` points at a path that does not exist (often a leftover `C:\Users\DELL\...` example). Either create that folder and add **`items_export.xlsx`** + **`employees.xlsx`**, or edit `.env`: set **`EXCEL_DATA_DIR=`** to your real folder (forward slashes OK), or set **`CATALOG_XLSX_PATH`** / **`EMPLOYEES_XLSX_PATH`** to full paths. For a quick demo, use paths under the repo: `./docs/samples/items_export.xlsx` and `./docs/samples/employees.xlsx`. Leave all three unset to use only built-in demo data (warnings stop). |
| Update catalog (file) | Save updated `.xlsx` to `CATALOG_XLSX_PATH` in `.env`. Auto-refreshes every 24h. Restart server for instant reload. |
| Update catalog (watcher) | Drop `.xlsx` into watch folder. Uploads immediately. |
| Add/remove employee | Update `employees.xlsx` at `EMPLOYEES_XLSX_PATH` in `.env`. Auto-refreshes every 24h, or restart server. See [EMPLOYEES_EXCEL_SPEC.md](EMPLOYEES_EXCEL_SPEC.md). |
| Change port | Set `PORT=XXXX` in `.env`. Restart. |
| Add dependency | `yarn add <pkg>`, then `yarn run package:release` to rebuild ZIP. |
| Rebuild after Node upgrade | Delete `.pnp.cjs` + `.yarn/install-state.gz`, run `install\INSTALL.bat`. |
| Force catalog resync | Restart server, or drop valid `.xlsx` in watch folder. |
| Check loaded catalog | Open `http://localhost:3000/api/catalog/abayas` in browser. |
| Excel column format (catalog) | [CATALOG_EXCEL_SPEC.md](CATALOG_EXCEL_SPEC.md) — required: `Barcode Display Name`. |
|| Excel column format (employees) | [EMPLOYEES_EXCEL_SPEC.md](EMPLOYEES_EXCEL_SPEC.md) — required: `emp_no`, `ac_no`, `Name`, `Barcode`, `Process`. |
| Logs | Check the **AbaYa Server** and **AbaYa Catalog Watcher** cmd windows. |
