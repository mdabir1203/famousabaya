# Catalog and Process Contract

This document defines the safe contract used by server, worker, and kiosk/dashboard clients.

## Catalog row shape

Catalog items should preserve this minimum shape:

- `id` (string)
- `code` (string)
- `barcode` (string, unique in worker DB)
- `design` (string)
- `process` (string)
- `icon` (string, optional)

## Process source consistency

The canonical process labels used by the system:

- `Tailor (01)`
- `Cutting master`
- `Tailor (02)`
- `Hand Work`
- `Stone Work`
- `Button`
- `Embroidery`
- `Ari Work`
- `Hand Designing`
- `Invoice maker`
- `Packaging`
- `Checker`

These names must remain stable because they are used in:

- worker analytics rollups (`cloudflare/src/index.js`)
- catalog parser validation (`tools/catalog-watcher/catalog-parse.js`)
- frontend role routing (`public/data.js`, kiosk clients)

`Cutting master` is supported as a process label but is intentionally rolled up with
`Tailor (01)` in analytics and daily totals for backward compatibility.

## Compatibility notes

- Keep `/api/catalog/abayas` response keys unchanged for backward compatibility.
- Default missing catalog process to `Tailor (01)` unless overridden by `DEFAULT_CATALOG_PROCESS`.
- Maintain current barcode uniqueness behavior in Cloudflare D1.
