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

Only **two** columns are required. Everything else is optional or auto-derived:

| Column in Excel | Maps to | Notes |
|-----------------|---------|-------|
| **Barcode Display Name** | `barcode` | **Required.** The unique barcode string shown on the kiosk and scanned. |
| **Item Category** | `process` | **Required.** Must match a kiosk work-type exactly (see below). |
| Item Name | `design` | Optional. Human-readable description shown on kiosk card. |
| *(none)* | `id` | Auto-derived from `Barcode Display Name` (slug). No column needed. |
| *(none)* | `code` | Auto-derived from `Barcode Display Name`. No column needed. |
| Icon | `icon` | Optional. HTML entity, e.g. `&#128142;`. |

Other columns (e.g. `Description`) are **ignored** if they would conflict with a column already providing the same field. For optional fields, the first non-empty value found is used.

## Field rules

| Logical field | Rules |
|---------------|--------|
| `barcode` | **Required.** Unique per row. This is the value displayed on the kiosk and matched when an employee scans a tag. |
| `process` | **Required.** Must match a kiosk role **exactly** (spacing and spelling). Allowed values: see `WORK_TYPES` in [public/data.js](../public/data.js). |
| `design` | Optional. Free text shown as the item description on the kiosk card (e.g. "FWAS 3593"). |
| `id` | Auto-derived from barcode slug when absent. Stable per barcode value. |
| `code` | Auto-derived from barcode when absent. |
| `icon` | Optional HTML entity shown on kiosk card. |

## Accepted aliases (row 1 headers)

After trimming and normalising (case-insensitive, spaces/hyphens → underscores):

| Canonical field | Accepted header names |
|-----------------|----------------------|
| `barcode` | **`Barcode Display Name`**, `barcode`, `bar_code`, `bc`, `display_name`, `barcode_name` |
| `process` | **`Item Category`**, `category`, `process`, `work_type`, `department`, `role` |
| `design` | **`Item Name`**, `design`, `description`, `name`, `title` |
| `id` | `id`, `abaya_id`, `item_id` *(omit — auto-derived)* |
| `code` | `code`, `item_code`, `sku`, `abaya_code`, `product_code` *(omit — auto-derived)* |
| `icon` | `icon`, `emoji` |

**Bold** = exact column names used in the factory Excel export.  
Columns not matching any alias are silently ignored.

## Excel typing (barcodes and codes)

The watcher reads cells using **displayed** values (`raw: false`) where possible. For values with **leading zeros** or long numeric strings, format the column as **Text** in Excel (or export from a system that writes real text cells). Otherwise Excel may store a number and lose leading zeros.

## Verification

From `tools/catalog-watcher`:

```bash
npm run validate-sample
```

This checks [samples/items_export.xlsx](samples/items_export.xlsx) with the same parser as the live watcher (no upload).

To regenerate the sample file from the repo template:

```bash
npm run generate-sample
```
