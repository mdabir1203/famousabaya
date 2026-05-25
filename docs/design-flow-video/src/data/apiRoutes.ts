export type Route = {
  method: string;
  path: string;
  purpose: string;
};

export const FACTORY_HTTP: readonly Route[] = [
  { method: "GET", path: "/api/catalog/abayas", purpose: "Catalog cache + version" },
  { method: "GET", path: "/api/state", purpose: "Realtime snapshot" },
  { method: "GET", path: "/api/employees", purpose: "Employee directory" },
  { method: "PUT", path: "/api/catalog/abayas", purpose: "Replace catalog (X-Ingest-Secret)" },
  { method: "GET", path: "/api/server-info", purpose: "LAN IP + port" },
  { method: "GET", path: "/api/qr?url=&size=", purpose: "QR SVG" },
  { method: "GET", path: "/setup", purpose: "Redirect to setup.html" },
] as const;

export const FACTORY_SOCKET = {
  serverEmits: ["state_update", "catalog_update"],
  clientRequests: ["req_lookup(ac_no)", "req_startWork(...)", "req_finishWork(...)"],
} as const;

export const WORKER_ROUTES: readonly Route[] = [
  { method: "POST", path: "/api/event", purpose: "Factory ingest" },
  { method: "GET", path: "/api/state", purpose: "CEO snapshot" },
  { method: "GET", path: "/api/report?type=", purpose: "Daily/weekly/monthly" },
  { method: "GET/PUT", path: "/api/catalog/abayas", purpose: "Catalog CRUD" },
  { method: "GET", path: "/", purpose: "CEO HTML dashboard + login" },
] as const;
