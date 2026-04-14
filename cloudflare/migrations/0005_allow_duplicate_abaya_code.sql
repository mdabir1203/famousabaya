-- Allow repeated product codes in catalog rows.
-- We keep id + barcode unique; code is now non-unique.
-- Run: wrangler d1 execute <DB_NAME> --remote --file=migrations/0005_allow_duplicate_abaya_code.sql

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS abaya_catalog_new (
  id            TEXT    PRIMARY KEY,
  code          TEXT    NOT NULL,
  barcode       TEXT    NOT NULL UNIQUE,
  design        TEXT    NOT NULL DEFAULT '',
  process       TEXT    NOT NULL,
  icon          TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO abaya_catalog_new (id, code, barcode, design, process, icon, updated_at)
SELECT id, code, barcode, design, process, icon, updated_at
FROM abaya_catalog;

DROP TABLE abaya_catalog;
ALTER TABLE abaya_catalog_new RENAME TO abaya_catalog;

CREATE INDEX IF NOT EXISTS idx_abaya_catalog_code ON abaya_catalog(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_abaya_catalog_barcode ON abaya_catalog(barcode);

COMMIT;
