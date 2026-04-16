# Employee Excel format (`employees.xlsx`)

A committed sample is at [samples/employees.xlsx](samples/employees.xlsx).

## Workbook

| Rule | Detail |
|------|--------|
| File type | `.xlsx` |
| Data sheet | Prefer a sheet named **`Employees`**. If missing, the first sheet is used. |
| Header row | **Row 1** must be column titles. |
| Data rows | Start at **row 2**. |

## Required columns (row 1)

| Column | Maps to | Notes |
|--------|---------|-------|
| **emp_no** | `emp_no` | Unique employee number (integer). |
| **ac_no** | `ac_no` | Access control number used by the kiosk fingerprint scanner. |
| **Name** | `name` | Display name shown on kiosk and dashboard. |
| **Barcode** | `barcode` | Employee badge barcode (unique). Format as **Text** to keep leading zeros. |
| **Process** | `process` | Work role. Must match one of the allowed values below. |

## Optional columns

| Column | Maps to | Notes |
|--------|---------|-------|
| Code | `code` | Employee code. Auto-derived as `EMP{emp_no}` if absent. |
| Color | `color` | Hex color for avatar, e.g. `#6a5fc1`. Auto-assigned from palette if absent. |
| Photo | `photo` | Relative path to photo file, e.g. `uploads/Misbah.jpeg`. Auto-detected from `public/uploads/{Name}.jpeg` if absent. |

## Allowed Process values

`Tailor (01)`, `Tailor (02)`, `Hand Work`, `Stone Work`, `Button`, `Embroidery`, `Ari Work`, `Hand Designing`, `Invoice maker`, `Packaging`, `Checker`.

## Accepted header aliases

After trimming and normalising (case-insensitive, spaces/hyphens to underscores):

| Canonical | Accepted headers |
|-----------|-----------------|
| `emp_no` | `emp_no`, `employee_no`, `employee_number`, `empno` |
| `ac_no` | `ac_no`, `access_no`, `ac`, `access_control` |
| `name` | `Name`, `employee_name`, `emp_name`, `full_name` |
| `barcode` | `Barcode`, `badge`, `badge_barcode`, `employee_barcode` |
| `process` | `Process`, `work_type`, `department`, `role` |
| `code` | `Code`, `emp_code`, `employee_code` |
| `color` | `Color`, `colour`, `hex_color` |
| `photo` | `Photo`, `image`, `picture`, `avatar` |

## Photo auto-detection

If the `Photo` column is empty or absent, the server checks for `public/uploads/{Name}.jpeg` (also `.jpg`, `.png`) and uses it automatically. Place employee photos in `public/uploads/` using the employee name as the filename.

## Update workflow

1. Edit `employees.xlsx` on the client laptop.
2. Save the file to the path in `EMPLOYEES_XLSX_PATH`, or — if you use **`EXCEL_DATA_DIR`** in `.env` — save as `employees.xlsx` inside that folder (same folder as `items_export.xlsx`).
3. The server auto-reloads every 24 hours. Restart the server for immediate effect.
4. All connected kiosk tablets refresh automatically via Socket.IO.
