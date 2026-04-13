config.json — Windows paths
=============================
WRONG (breaks JSON — error near line 2, "Bad escaped character"):
  "watchDir": "C:\Users\you\AbayaCatalog\Drop"

RIGHT (forward slashes — easiest):
  "watchDir": "C:/Users/you/AbayaCatalog/Drop"

RIGHT (every backslash doubled):
  "watchDir": "C:\\Users\\you\\AbayaCatalog\\Drop"

Why: In JSON, \U starts an invalid unicode escape inside \Users.

Copy config.example.json to config.json, edit paths and secrets, then: node watch-catalog.js

Layout (items_export.xlsx format — see docs/CATALOG_EXCEL_SPEC.md):
  Option A — single file at the watch root (replaces full catalog when uploaded).
  Option B — one subfolder per employee (folder name = employee name, code, id, emp_no, or ac_no),
    each folder may contain .xlsx exports; all files are merged into one catalog upload.
    Process column must match that employee's role (alignProcess: strict), or set alignProcess
    to "folder" to force Process from the server employee list.

Either list employees in config.json ("employees": [ { "id", "name", "code", "emp_no", "ac_no", "process" }, ... ])
  or keep the main Node server running so the watcher can GET /api/employees for folder matching.
For local-only installs, set workerUrl to http://127.0.0.1:3050 and set CATALOG_INGEST_SECRET
or CF_INGEST_SECRET in the server's .env (same value as ingestSecret in config.json).

A full-tree resync runs every 24 hours (dailySyncMs) and on file add/change (debounced).
Set scanOnStart to true in config.json to process any .xlsx already in the tree shortly after start.
