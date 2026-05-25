# AbaYa Track — Client PC update runbook (no data loss)

Use this whenever you roll out a new version on a factory PC **by copying files** or **replacing folders**. Electron launcher auto-update from GitHub Releases is documented separately in [ONLINE_UPDATES.md](ONLINE_UPDATES.md); this guide still applies to preserving **factory data folders** beside the app.

**Related:** [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md) (first-time install paths and `.env`). **Field one-pager:** [UPDATE_RUNBOOK_CHECKLIST.md](UPDATE_RUNBOOK_CHECKLIST.md).

---

## 1. What counts as production data?

These paths are **outside “just code”** — losing them loses local history, images, retry queues, or site-specific config:

| Scope | Default path under app root | Notes |
|-------|------------------------------|-------|
| Offline dashboard snapshots | `data/offline-dashboard-reports/` (`dashboard-offline-latest.json`) | Helps restore dashboard state after restart; optional retention via env |
| CEO ingest retry queue | `data/ceo-ingest-queue.jsonl` | Pending events when cloud is down (see `CEO_INGEST_QUEUE_FILE`) |
| Uploaded images | `public/uploads/` (employees + catalog items) | Not in git; created at runtime |
| Desktop launcher Electron profile | `data/desktop-launcher/` | Cache / Chromium `userData` when using `tools/desktop-launcher` |
| Environment / secrets | `.env` at repo root | Paths, secrets, ports — never blindly overwrite with a generic template |

**Excel sources** (employees + catalog load) live wherever `.env` points:

- `EXCEL_DATA_DIR` (folder with `employees.xlsx` + `items_export.xlsx`), or
- `CATALOG_XLSX_PATH` / `EMPLOYEES_XLSX_PATH`.

Those files are production data — back them up and keep paths stable across updates.

**Optional hardened layout (recommended for IT):**

- Put durable data outside versioned folders, e.g. `C:/AbayaData/offline-report`, `C:/AbayaData/ceo-queue`.
- Set in `.env` (exact names vary; see INSTALL_WINDOWS cheat-sheet):

  - `OFFLINE_REPORT_DIR`
  - `CEO_INGEST_QUEUE_FILE` or `CEO_INGEST_QUEUE_DIR`
  - Keep uploads under a stable folder if you rework deploy layout; today default is still `public/uploads/` next to server.

---

## 2. Roles

| Role | Responsibility |
|------|----------------|
| Operator | Executes backup → deploy steps, records backup path |
| Verifier | Runs post-deploy checks; rejects sign-off until all pass |
| Approver | Business sign-off for go-live |

Minimum two people preferred: Operator + Verifier.

---

## 3. Pre-update checklist (before touching files)

1. Announce maintenance window if kiosks are in use (or schedule after shifts).
2. **Stop services:** close AbaYa launcher/Desktop shortcut, exit any `LAUNCH-ALL.bat`-spawned consoles, confirm nothing listens on `.env` `PORT` (default `3000`) if policy requires a clean restart.
3. Record **current version** (e.g. `package.json` `version`, or ZIP folder name).
4. Confirm enough free disk for a full copy of `data/` + `public/uploads/`.

---

## 4. Mandatory backup

Create a dated backup folder outside the deploy tree, example:

```text
D:\AbaYaBackups\2026-05-01_2150_FACTORY-PCNAME\
```

Copy at minimum:

- `.env`
- Entire **`data`** directory
- **`public\uploads`** (entire subtree)
- The **Excel folder** or files referenced in `.env`

Optional but strongly recommended:

- Export floor sessions: HTTP `GET` `/api/export/floor-sessions.json` with `X-Export-Secret` (secret from `FLOOR_EXPORT_SECRET` or ingest secret — see INSTALL_WINDOWS).

Log in your ticket:

- Backup path
- Operator name
- From version → To version
- PC hostname

**Rule:** No live replace without backup that has been visually confirmed (folder exists and size isn’t zero).

---

## 5. Safe deployment patterns

### Pattern A — Side-by-side (recommended)

1. Unzip or copy the **new** version into a sibling folder e.g. `C:\AbaYa-Track-v1.0.3` — do **not** delete old folder yet.
2. Copy **`.env`** from backup (or reuse same machine `.env`; never use another site’s `.env`).
3. If not using external paths yet: copy **`data`** and **`public\uploads`** into the **new** app root **before first start**.
4. Start the new launcher once; validate (section 7).
5. Rename or archive old folder after sign-off.

### Pattern B — In-place replace (allowed only with discipline)

1. From backup, restore **`.`env`**, **`data`**, **`public\uploads`** immediately after overwriting app files.
2. Never run “delete folder, paste new zip” unless `data/` and uploads were preserved or restored in the **same transaction**.

---

## 6. Anti-patterns — do **not**

- Replace the whole disk tree **without** backing up `data/`, `.env`, and `public/uploads/`.
- Ship a generic `.env` from dev and overwrite factory secrets (`CF_INGEST_SECRET`, tunnel keys, Excel paths).
- Update during peak production **without** a rollback plan.

---

## 7. Post-update verification (must all pass before sign-off)

| # | Check | How |
|---|--------|-----|
| 1 | Server starts | Launcher or `START-AbaYa-Server.bat` / equivalent; console shows listener on expected port |
| 2 | Config loaded | Correct catalog/employees count vs expectation; kiosk shows real staff/designs |
| 3 | Images | Spot-check employee and item thumbnails (under `public/uploads` or resolved URLs) |
| 4 | Dashboard memory | Recent completed sessions still visible OR restored from offline snapshot |
| 5 | Cloud queue | Browser or script: `/api/ceo-ingest-status` — `offlineReportDirWritable` / `ceoQueueDirWritable` true where applicable |
| 6 | Smoke session | Start and finish **one test** kiosk session |

If any fails: **rollback** — restore backed-up `data/`, uploads, `.env`, restart prior version until root cause fixed.

---

## 8. Rollback

1. Stop app.
2. Restore backup copy of **`data/`**, **`public/uploads/`**, **`.env`** over the failing install **or** switch shortcut back to previous version folder whose data was never migrated away.
3. Start services; rerun verification checklist (section 7).
4. File incident ticket with logs (server console errors, path typos).

---

## 9. Long-term hygiene for teams

1. Prefer **pinned data paths** in `.env` so each version only swaps code beside stable `AbayaData` directories.
2. Document each PC’s **actual** `.env` path and Excel directory in secure internal wiki (no secrets paste).
3. Keep backups **≥ 14 days** or per company policy.

---

## 10. Where to route questions

| Topic | Doc |
|--------|-----|
| Windows install / `.env` | [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md) |
| Desktop launcher Releases | [ONLINE_UPDATES.md](ONLINE_UPDATES.md) |
| Tablets / tunnels | [REMOTE_ACCESS.md](REMOTE_ACCESS.md) |
| Catalog Excel | [OFFICE_LAPTOP.md](OFFICE_LAPTOP.md), [CATALOG_EXCEL_SPEC.md](CATALOG_EXCEL_SPEC.md) |

---

## Printable appendix: paths quick reference

```text
<APP_ROOT>\
  .env
  server.js
  data\
    offline-dashboard-reports\
    ceo-ingest-queue.jsonl       (unless overridden)
    desktop-launcher\           (launcher profile)
  public\
    uploads\
      employees\
      items\
```

When in doubt — **backup first, overwrite second.**
