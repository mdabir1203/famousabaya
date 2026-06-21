# Sample catalog export

Place a copy of your office export here as **`items_export.xlsx`** if you want a tracked reference in the repo (optional; do not commit real customer data unless policy allows).

The floor kiosk builds the **prefix dropdown** (FWAS, FWAP, AB, etc.) automatically from the **loaded catalog** on the factory server (`GET /api/catalog/abayas`). It scans **barcode**, **design**, and **code** fields for:

- A letter token followed by a space (e.g. `FWAS 1105 STD`)
- A letter token directly before digits (e.g. `AB00000041`, `FWAP1225`)

Default choices always include **FWAS**, **FWAP**, and **AB**; any other prefixes found in the catalog are appended in alphabetical order.

See also `docs/CATALOG_EXCEL_SPEC.md` for column names and ingest flow.
