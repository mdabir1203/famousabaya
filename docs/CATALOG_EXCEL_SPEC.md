# Abaya catalog Excel format (`items_export.xlsx`)

This is the **standard layout** for files dropped into the office watcher folder. A committed sample is at [samples/items_export.xlsx](samples/items_export.xlsx).

## Workbook

| Rule | Detail |
|------|--------|
| File type | `.xlsx` |
| Data sheet | Prefer a sheet named **`Items`**. If that sheet is missing, the **first** sheet in the workbook is used. |
| Header row | **Row 1** must be column titles (no title rows above). |
| Data rows | Start at **row 2**. |

## Reference column order (row 1)

Use these **exact** headers for exports that should match the sample:

| Abaya ID | Item Code | Barcode | Design | Process | Icon |

- **Required:** Abaya ID, Item Code, Barcode, Process  
- **Optional:** Design (may be empty), Icon (may be empty)

Other header spellings are accepted if they map unambiguously to the same fields; see **Accepted aliases** below. You cannot have two columns that both mean the same field (for example **Name** and **Design** together), or the upload will fail with an error.

## Field rules

| Logical field | Rules |
|---------------|--------|
| Abaya ID (`id`) | Stable string, unique in the file. |
| Item Code (`code`) | Unique in the file. |
| Barcode (`barcode`) | Unique in the file. Match kiosk scanning (often uppercase like `AB00000041`). |
| Design (`design`) | Free text; may be blank. |
| Process (`process`) | Must match a kiosk role **exactly** (spacing and spelling). Allowed values are the same as `WORK_TYPES` in [public/data.js](../public/data.js). |
| Icon (`icon`) | Optional HTML entity or text shown on the kiosk card (e.g. `&#128142;`). |

## Accepted aliases (row 1 headers)

After trimming and normalizing (case-insensitive, spaces/hyphens to underscores), these headers map to the logical fields:

| Canonical field | Accepted header names (normalized examples) |
|-----------------|-----------------------------------------------|
| `id` | `id`, `abaya_id`, `item_id` |
| `code` | `code`, `item_code`, `sku`, `abaya_code`, `product_code` |
| `barcode` | `barcode`, `bar_code`, `bc` |
| `design` | `design`, `description`, `item_name`, `name`, `title` |
| `process` | `process`, `work_type`, `department`, `role` |
| `icon` | `icon`, `emoji` |

Columns whose headers do not match any of the above are **ignored**.

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
