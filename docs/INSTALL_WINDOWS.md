# Install AbaYa Track on another Windows laptop

## Package manager: Yarn Berry v4 (PnP — no node_modules)

AbaYa Track uses **Yarn 4** with Plug'n'Play. There is no `node_modules` folder.
Packages are stored in `.yarn/cache` and resolved by `.pnp.cjs` at runtime.
The ZIP ships with the cache included (**zero-install**): the client PC only needs `corepack enable` + `yarn install --immutable` — no internet required after unzip.

---

## What you ship

On a PC that has Node.js 18+ and the repo, build a clean ZIP:

```powershell
yarn run package:release
```

This creates **`dist/AbaYa-Track-v1.0.0.zip`** (version from `package.json`).
Copy the zip to the other laptop via USB, network share, etc.

The ZIP includes `.yarn/cache` and `yarn.lock` for both the root project and
`tools/catalog-watcher`, so `yarn install --immutable` works offline.

---

## What they do on the new laptop

1. Install **[Node.js 18+](https://nodejs.org/)** (LTS) — ships with `corepack`.
2. **Unzip** the archive to a folder, for example `C:\AbaYa-Track`.
3. Run **`install\INSTALL.bat`** once.
   - Runs `corepack enable` to activate Yarn.
   - Runs `yarn install` for the factory server and catalog watcher (uses bundled cache — no internet needed).
   - Creates `.env` from `.env.example`.
   - Creates an **AbaYa Track** shortcut on the Desktop.
4. Edit **`.env`** in the unzip root with **`CF_WORKER_URL`** and **`CF_INGEST_SECRET`** if you use Cloudflare. Leave unchanged for local-only.
5. Double-click **AbaYa Track** on the Desktop (or `install\LAUNCH-ALL.bat`) to start everything.

---

## Office catalog watcher (optional)

Same unzip; on the office PC also:

1. **`tools\catalog-watcher`**: copy **`config.example.json`** → **`config.json`**, edit paths and secrets.
2. From then on, **`LAUNCH-ALL.bat`** starts the watcher automatically.

Details: [OFFICE_LAPTOP.md](OFFICE_LAPTOP.md).

---

## Files added for packaging

| Path | Purpose |
|------|--------|
| [install/INSTALL.bat](../install/INSTALL.bat) | First-time setup: `corepack enable`, `yarn install` (root + catalog-watcher), create `.env`, Desktop shortcut |
| [install/LAUNCH-ALL.bat](../install/LAUNCH-ALL.bat) | **Daily launcher**: starts server, opens kiosk + dashboard, starts watcher if `config.json` present |
| [install/START-AbaYa-Server.bat](../install/START-AbaYa-Server.bat) | Legacy single-server start (also opens both browser tabs) |
| [install/START-Catalog-Watcher.bat](../install/START-Catalog-Watcher.bat) | Start Excel folder watcher standalone |
| [install/README.txt](../install/README.txt) | Short copy-paste instructions inside the zip |
| [scripts/build-release.ps1](../scripts/build-release.ps1) | Builds `dist/*.zip` via robocopy + Compress-Archive; includes `.yarn/cache` for zero-install |
| [START HERE.txt](../START%20HERE.txt) | Root-level plain-text quick start for non-technical users |

The server loads **`.env`** from the app root automatically (`dotenv`).

---

## Remote HTTPS for clients (production-first)

To give stakeholders a **stable `https://` link** from any network, use **Cloudflare Tunnel + Access**: [REMOTE_ACCESS.md](REMOTE_ACCESS.md).

If Windows shows **tunnel credential not found**, the connector was not registered or `config.yml` paths are wrong: [TUNNEL_CREDENTIALS_WINDOWS.md](TUNNEL_CREDENTIALS_WINDOWS.md).

---

## Daily launch

Double-click the **AbaYa Track** shortcut on the Desktop (created by `INSTALL.bat`), or run `install\LAUNCH-ALL.bat` directly. This starts the factory server, opens the kiosk and dashboard in the browser, and starts the catalog watcher if `tools\catalog-watcher\config.json` exists.

| URL | Purpose |
|-----|---------|
| `http://localhost:3050/kiosk.html` | Floor kiosk (scan barcodes, track sessions) |
| `http://localhost:3050/dashboard.html` | Manager / CEO live dashboard |
| `http://localhost:3050/setup` | **Tablet QR Setup** — generate per-tablet QR codes for all factories |

---

## Maintenance cheat-sheet

| Task | What to do |
|------|-----------|
| Update abaya catalog | Drop `.xlsx` into your `watchDir` (employee subfolder or root). The watcher uploads it and moves it to **Processed**. |
| Add or remove an employee | Edit the `EMPLOYEES` array in `server.js` (and the matching array in `public/data.js`). Restart the server. |
| Change the server port | Set `PORT=XXXX` in `.env`. Restart the server. |
| Add a package dependency | Run `yarn add <pkg>` in the relevant folder, then re-run `yarn run package:release` to rebuild the ZIP. |
| Re-run install (e.g. after Node upgrade) | Delete `.pnp.cjs` and `.yarn/install-state.gz`, then run `install\INSTALL.bat` again. |
| Build a new ZIP for another PC | From the repo root in PowerShell: `yarn run package:release`. Output: `dist\AbaYa-Track-vX.zip`. |
| Upgrade Node.js | Install the new LTS from nodejs.org, then re-run `install\INSTALL.bat`. |
| Change Cloudflare Worker URL or secret | Edit `.env` (`CF_WORKER_URL`, `CF_INGEST_SECRET`) and restart the server. Update `tools\catalog-watcher\config.json` (`workerUrl`, `ingestSecret`) too. |
| Force a full catalog resync now | Drop any valid `.xlsx` in the watch folder, or restart the catalog watcher (`scanOnStart: true` in `config.json` to auto-trigger on start). |
| Check what catalog is loaded | Open `http://localhost:3050/api/catalog/abayas` in a browser while the server is running. |
| Logs | Each component runs in its own titled cmd window — check the **AbaYa Server** and **AbaYa Catalog Watcher** windows for errors. |
