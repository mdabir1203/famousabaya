export type Writer = {
  id: string;
  label: string;
  via: string;
};

export const CATALOG_WRITERS: readonly Writer[] = [
  { id: "watcher", label: "Catalog Watcher", via: "PUT + X-Ingest-Secret" },
  { id: "localXlsx", label: "Local XLSX (.env)", via: "Disk reload" },
  { id: "admin", label: "Admin PUT", via: "factory HTTP" },
  { id: "worker", label: "Cloudflare Worker", via: "Direct PUT to D1" },
] as const;

export const CATALOG_NOTE =
  "Multiple writer paths. Last-writer-wins by timing.";
