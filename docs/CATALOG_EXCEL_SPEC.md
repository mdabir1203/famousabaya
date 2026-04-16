# Abaya catalog Excel format (`items_export.xlsx`)

This is the **standard layout** for files dropped into the office watcher folder. A committed sample is at [samples/items_export.xlsx](samples/items_export.xlsx).

## Workbook

| Rule | Detail |
|------|--------|
| File type | `.xlsx` |
| Data sheet | Prefer a sheet named **`Items`**. If that sheet is missing, the **first** sheet in the workbook is used. |
| Header row | **Row 1** must be column titles (no title rows above). |
| Data rows | Start at **row 2**. |

## Factory export — required columns (row 1)

Only **one** column is required. Everything else is optional or auto-derived:

| Column in Excel | Maps to | Notes |
|-----------------|---------|-------|
| **Barcode Display Name** | `barcode` | **Required.** The unique barcode string shown on the kiosk and scanned. |
| **Item Category** | `tier` | Optional. Abaya grade/category (for example `Standard`, `Premium`, `Luxury`, `Plain Abaya`). |
| Item Name | `design` | Optional. Human-readable description shown on kiosk card. |
| *(none)* | `id` | Auto-derived from `Barcode Display Name` (slug). No column needed. |
| *(none)* | `code` | Auto-derived from `Barcode Display Name`. No column needed. |
| Process | `process` | Optional. Used for employee-folder validation when watcher `alignProcess` is `strict`. |
| Icon | `icon` | Optional. HTML entity, e.g. `&#128142;`. |

Other columns (e.g. `Description`) are **ignored** if they would conflict with a column already providing the same field. For optional fields, the first non-empty value found is used.

## Field rules

| Logical field | Rules |
|---------------|--------|
| `barcode` | **Required.** Unique per row. This is the value displayed on the kiosk and matched when an employee scans a tag. |
| `process` | Optional. If present and watcher `alignProcess` is `strict`, it must exactly match the employee role for that folder. Allowed values: see `WORK_TYPES` in [public/data.js](../public/data.js). |
| `design` | Optional. Free text shown as the item description on the kiosk card (e.g. "FWAS 3593"). |
| `id` | Auto-derived from barcode slug when absent. Stable per barcode value. |
| `code` | Auto-derived from barcode when absent. May repeat across rows (not unique). |
| `tier` | Optional. Grade/category displayed in UI badges. |
| `icon` | Optional HTML entity shown on kiosk card. |

## Accepted aliases (row 1 headers)

After trimming and normalising (case-insensitive, spaces/hyphens → underscores):

| Canonical field | Accepted header names |
|-----------------|----------------------|
| `barcode` | **`Barcode Display Name`**, `barcode`, `bar_code`, `bc`, `display_name`, `barcode_name` |
| `process` | `process`, `work_type`, `department`, `role` |
| `tier` | **`Item Category`**, `category`, `tier`, `grade`, `abaya_tier`, `abaya_grade`, `item_grade`, `abaya_category` |
| `design` | **`Item Name`**, `design`, `description`, `name`, `title` |
| `id` | `id`, `abaya_id`, `item_id` *(omit — auto-derived)* |
| `code` | `code`, `item_code`, `sku`, `abaya_code`, `product_code` *(omit — auto-derived)* |
| `icon` | `icon`, `emoji` |

**Bold** = exact column names used in the factory Excel export.  
Columns not matching any alias are silently ignored.

## Process alignment behavior (watcher)

When using `tools/catalog-watcher/watch-catalog.js`:

- File at watch root: process alignment is **off** (`alignMode=off` for root files).
- File inside employee folder:
  - `alignProcess: strict` (default): row `process` must match that employee role exactly.
  - `alignProcess: folder`: watcher overwrites row process with the employee folder role.
  - `alignProcess: off`: no process check/override.

## Factory server (local file)

If the factory PC loads catalog from disk (not only from the cloud), set **`EXCEL_DATA_DIR`** in `.env` to a folder and save **`items_export.xlsx`** there, or set **`CATALOG_XLSX_PATH`** to the full file path. See `.env.example`.

## Process column (optional for some exports)

Many factory exports only have **Barcode Display Name** (and design/tier), with **no Process column**. The office **catalog-watcher** and the **Cloudflare Worker** then assign **`DEFAULT_CATALOG_PROCESS`** (default `Tailor (01)`). Override in watcher `config.json` (`defaultCatalogProcess`), Worker `[vars]` / `DEFAULT_CATALOG_PROCESS`, or factory `.env` (`DEFAULT_CATALOG_PROCESS`). The value must be one of the allowed work types used on the floor.

## Excel typing (barcodes and codes)

The watcher reads cells using **displayed** values (`raw: false`) where possible. For values with **leading zeros** or long numeric strings, format the column as **Text** in Excel (or export from a system that writes real text cells). Otherwise Excel may store a number and lose leading zeros.

## Verification

From `tools/catalog-watcher`:

```bash
yarn run validate-sample
```

This checks [samples/items_export.xlsx](samples/items_export.xlsx) with the same parser as the live watcher (no upload).

To regenerate the sample file from the repo template:

```bash
yarn run generate-sample
```
