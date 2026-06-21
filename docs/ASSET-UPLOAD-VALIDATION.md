# Asset upload + employee roster — validation checklist

Use after upgrading the factory PC. No server restart is required for normal roster or photo changes.

## Preconditions

- `CATALOG_INGEST_SECRET` (or `CF_INGEST_SECRET`) set in `.env` if you use roster add/remove **or saving the factory work-types list** from the web page.
- `ASSET_UPLOAD_SECRET` in `.env` only if photo uploads must be restricted.
- `EMPLOYEES_XLSX_PATH` or `EXCEL_DATA_DIR` pointing at the real `employees.xlsx` when Excel is the source of truth.

## Checks

1. **Open** `/asset-upload.html` — page loads, secrets fields visible.
2. **Add employee** — fill step 1, save — success message; row appears in `employees.xlsx` (or `data/employees-manual.json` if no Excel path).
3. **Duplicate guard** — try same barcode again — clear `409` style error (not a silent failure).
4. **AC / employee number guard** — try duplicate AC or emp number — error explains conflict.
5. **Employee photo** — drag a JPEG onto step 2 or click zone — upload succeeds; `emp_<barcode>.jpg` (or similar) under `public/uploads/employees/`.
6. **Excel persistence** — with `employees.xlsx` configured, confirm the `photo` column updates after upload (or re-open file and see path if written).
7. **Remove** — load roster, remove a person without an active kiosk session — success; they disappear from list and from the master file.
8. **Active session** — start a session on kiosk for someone, try remove — blocked with message about active session.
9. **Kiosk / dashboard** — new person appears after save; removed person no longer in picker (may require refresh; socket `employees_update` should refresh open dashboards).

## Factory work types (`data/work-types.json`)

1. **Open** “Factory work types” on asset-upload — list loads from `GET /api/work-types`; names show in a simple list with **Add** (text box) and **Remove** per row.
2. **Add or remove** — with the roster secret set, each change sends `PUT /api/work-types`; on success, `data/work-types.json` updates on the server. **Connected kiosks update role buttons immediately** via Socket.IO event `work_types_update` — no kiosk tab refresh and no extra server restart **per** add/remove (restart Node only once after deploying new server code).
3. **Blocked delete** — remove a process name that an employee still has as default `process` — server returns `400` with a clear message; fix employees in Excel or roster first.
4. **Blocked while session open** — remove a process name that matches an **active** session’s role — server returns `400`; finish the session on the kiosk first.

### If kiosk roles do not update after a successful save

1. On asset-upload, confirm **PUT** `/api/work-types` returns **200** and JSON `ok: true` (Network tab). A **401** or **400** means no broadcast was sent.
2. On the kiosk, confirm it is on the **same factory host** as asset-upload and the connection is **Live** (Socket.IO connected). Offline or wrong URL means no `work_types_update` until reconnect; on reconnect the kiosk refetches `/api/work-types`.
3. If the route or emit never existed (old Node binary still running), **restart the factory Node process once** after deploy, then try again.

## Quick Excel roundtrip (dev)

From repo root:

```bash
yarn node scripts/verify-employee-xlsx-roundtrip.mjs
```

Should print `OK` if `xlsx` read/write matches the roster column layout.
