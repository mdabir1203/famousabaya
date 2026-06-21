# Office laptop: abaya catalog sync

Two audiences: **office staff** (simple) and **IT** (one-time setup).

## For office staff

1. Wait until IT tells you the folder path (for example `C:\AbayaCatalog\DropHere`).
2. When you have an updated Excel file, **save or copy** it into that folder as a **`.xlsx`** file.
3. The file should disappear from the folder shortly after (it is moved to **Processed** if upload succeeded, or **Failed** if something went wrong).
4. You do **not** need to open a browser or run any commands.

**Excel format (same standard as `items_export.xlsx`):**

- Follow **[CATALOG_EXCEL_SPEC.md](CATALOG_EXCEL_SPEC.md)**. A sample workbook is in **[samples/items_export.xlsx](samples/items_export.xlsx)** (sheet **`Items`**, or the first sheet if `Items` is missing).
- Minimum required header is **Barcode Display Name** (`barcode`).
- Common optional headers: **Item Name** (`design`), **Item Category** (`tier`), **Process**, **Icon**.
- `id` and `code` are optional and auto-derived from barcode if omitted.
- `process` is optional. If file is in an employee folder and watcher uses `alignProcess: strict` (default), process must match the employee role exactly.

---

## For IT (one-time setup on the office PC)

### Prerequisites

- **Node.js 18+** installed.
- The **same `INGEST_SECRET`** value that the Cloudflare Worker uses (`wrangler secret put INGEST_SECRET`) and that the factory server uses as **`CF_INGEST_SECRET`** in its environment.
- Worker URL, for example `https://abaya-track.<your-subdomain>.workers.dev`.

### Cloudflare D1 (once per project)

On a machine with Wrangler, from the repo `cloudflare` folder:

```bash
wrangler d1 execute abaya-db --remote --file=migrations/0004_abaya_catalog.sql
wrangler d1 execute abaya-db --remote --file=migrations/0005_allow_duplicate_abaya_code.sql
```

(Use your real D1 database name if it is not `abaya-db`.)

Then deploy the Worker so `GET/PUT /api/catalog/abayas` is live.

### Office PC: install the watcher

1. Copy the folder `tools/catalog-watcher` from this repo onto the office laptop (any path).
2. In that folder, run:

   ```bash
   yarn install
   ```

3. Copy `config.example.json` to **`config.json`** in the same folder.
4. Edit `config.json`:
   - **Windows paths in JSON:** always prefer **forward slashes**: `C:/Users/YourName/AbayaCatalog/DropHere`. Do **not** use raw `C:\Users\...` — JSON treats `\U` as a bad escape and you get **Bad escaped character** around column 19–20 on line 2. Alternatively use **doubled** backslashes: `C:\\Users\\YourName\\...`.
   - **`watchDir`**: folder staff will drop files into (create it if needed).
   - **`processedDir`**: where successful uploads go.
   - **`failedDir`**: where bad files go.
   - **`workerUrl`**: Worker origin, **no trailing slash** (example: `https://abaya-track.example.workers.dev`).
   - **`ingestSecret`**: exact same string as **`INGEST_SECRET`** on the Worker / **`CF_INGEST_SECRET`** on the factory server.

5. Start the watcher (leave it running, or use Task Scheduler below):

   ```bash
   node watch-catalog.js
   ```

   Optional: `node watch-catalog.js "D:\path\to\config.json"` if config is not beside the script.

6. Optional QA: from `tools/catalog-watcher`, run `yarn run validate-sample` to confirm the repo sample `docs/samples/items_export.xlsx` parses correctly (no upload).

### Always-on with PM2 (recommended)

The repository ships an `ecosystem.config.cjs` that auto-detects
`tools/catalog-watcher/config.json`. Setting it up on the office PC:

```powershell
# from the AbaYa Track repo root, elevated PowerShell once:
powershell -NoProfile -ExecutionPolicy Bypass -File install\SETUP-PM2-BOOT.ps1
pm2 status
pm2 logs catalog-watcher
```

The watcher restarts on crash, survives PC reboot via `pm2-windows-startup`,
and writes logs to `data\pm2-logs\catalog-watcher.{out,err}.log`. Update with:

```powershell
git pull
yarn install
pm2 reload ecosystem.config.cjs --update-env
```

### Legacy fallback — Windows Task Scheduler (run at logon)

Use only if PM2 cannot be installed on the office PC.

1. Open **Task Scheduler** → **Create Task** (not “Create Basic Task”).
2. **General**: name e.g. `AbayaCatalogWatcher`; choose “Run whether user is logged on or not” only if you need it headless (then store password).
3. **Triggers**: **At log on** (specific user who uses the PC).
4. **Actions** → **Start a program**:
   - **Program**: full path to `node.exe` (e.g. `C:\Program Files\nodejs\node.exe`).
   - **Arguments**: `"D:\path\to\catalog-watcher\watch-catalog.js"` (quote paths with spaces).
   - **Start in**: `D:\path\to\catalog-watcher`.
5. **Conditions**: uncheck “Start only if on AC power” if laptops sleep on battery.
6. Save and test: **Run** the task once; drop a test `.xlsx` into `watchDir`.

### Factory server (already in this repo)

- Set **`CF_WORKER_URL`** to the Worker URL.
- Restart **`server.js`**. It polls **`GET /api/catalog/abayas`** on the Worker every 60 seconds and serves **`GET /api/catalog/abayas`** to browsers; when the cloud version changes it emits Socket.IO **`catalog_update`**.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| File goes to **Failed** | See [CATALOG_EXCEL_SPEC.md](CATALOG_EXCEL_SPEC.md): required `Barcode Display Name`, no conflicting duplicates, and for employee folders with `alignProcess: strict`, row `Process` must match the folder employee role. Check console output from `watch-catalog.js`. |
| `401 Unauthorized` | `ingestSecret` in `config.json` does not match Worker `INGEST_SECRET`. |
| Kiosks still show old list | Factory must have `CF_WORKER_URL` set; wait up to 60s or refresh the kiosk page. |
| Empty catalog on kiosks | Worker D1 has no rows yet; run migration; upload a valid `.xlsx`. Factory keeps its built-in default until the cloud catalog is non-empty or version is not `0`. |

---

## Security note

`PUT /api/catalog/abayas` is protected by **`X-Ingest-Secret`** only. Treat **`ingestSecret`** like a password: restrict who can read `config.json`, and use HTTPS (Worker URL is HTTPS by default).
