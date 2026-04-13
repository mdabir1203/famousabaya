-- Abaya/barcode catalog (synced from office PC Excel via Worker PUT)
-- wrangler d1 execute <DB_NAME> --remote --file=migrations/0004_abaya_catalog.sql

CREATE TABLE IF NOT EXISTS abaya_catalog (
  id            TEXT    PRIMARY KEY,
  code          TEXT    NOT NULL UNIQUE,
  barcode       TEXT    NOT NULL UNIQUE,
  design        TEXT    NOT NULL DEFAULT '',
  process       TEXT    NOT NULL,
  icon          TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS catalog_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
