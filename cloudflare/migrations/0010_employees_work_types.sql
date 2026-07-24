-- Employee roster + factory work types in D1.
--
-- Why: these were local-only (employees.xlsx / data/work-types.json), so a freshly
-- installed laptop fell back to built-in DEMO employees and DEFAULT work types with
-- only a console warning. The catalog already syncs through the Worker; this gives
-- the roster and work types the same treatment so a new machine can be seeded.
--
-- Precedence is deliberate: the local Excel/JSON stays authoritative when present.
-- The cloud copy is a seed for fresh installs and an off-site backup.
--
-- Apply:  npx wrangler d1 execute abaya-db --remote --file cloudflare/migrations/0010_employees_work_types.sql

CREATE TABLE IF NOT EXISTS employees (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT,
  emp_no     TEXT,
  ac_no      TEXT,
  process    TEXT,
  barcode    TEXT,
  color      TEXT,
  initials   TEXT,
  photo      TEXT,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_employees_code    ON employees(code);
CREATE INDEX IF NOT EXISTS idx_employees_barcode ON employees(barcode);

-- Work types are an ordered list of names; `position` preserves floor order.
CREATE TABLE IF NOT EXISTS work_types (
  name       TEXT PRIMARY KEY,
  position   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_work_types_position ON work_types(position);

-- Versions live in the existing catalog_meta key/value table (no new meta table):
--   employees_version, work_types_version
