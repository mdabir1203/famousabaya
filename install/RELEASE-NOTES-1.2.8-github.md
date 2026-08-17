# AbaYa Track v1.2.8

Bug-fix release. Five production bugs found by the [report data-flow audit](https://github.com/mdabir1203/famousabaya/blob/main/qa-eval-2026-08-17/report-data-flow-audit.md) (Aug 17, 2026) — all fixed, deployed, and verified live.

---

## What's broken → what's fixed

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Custom Range report for 2026-08-15 shows 0 units (screenshot from the field) | Cloudflare Worker's `/api/state` silently truncated every response to 100 rows, even when the dashboard asked for `?days=400` | Default cap is now **5000** when `?days>=7`. Caller can still override with `?limit=N`. Dashboard's `fetchStateExtendedHistory()` also now passes `&limit=5000` and accepts the flat response shape (it was silently bailing on a non-existent `.state` wrapper) |
| 2 | Yearly `tailor_01` total was 817, missing 92 rows; `KHAKA WORK` 17 sessions never showed up in any rollup | `canonicalEmpProcess()` was case-sensitive. Lowercase `cutting` and all-caps `KHAKA WORK` from the floor terminals were stored as-is in D1 and never matched the `IN ('Cutting','Cutting master')` clauses in `SUMMARY_WT_CASES` | Function is now case-insensitive. **Migrations 0011** (109 rows) and **0012** (rebuild `daily_stats`) are already applied to production D1 |
| 3 | Top-employee leaderboard showed "Arman Raza" with units that "Wasim" actually did | `MAX(emp_name)` in SQLite is **alphabetical max**, not "most recent". When a badge was reassigned to a new joiner, the report showed the alphabetically-later name | Replaced with a `latest by MAX(ended_at)` subquery in both `report.js` (by_employee) and `state.js` (per-employee slice) |
| 4 | Reconcile loop was slow to backfill missing sessions to D1 | Loop called `/api/state` with no params, so only saw the same 100 rows | Now passes `?days=400&limit=5000` |
| 5 | Working-hours overrides saved from the LAN never propagated to the Worker | `worker_settings` table was empty in D1 | **Migration 0013** seeds the default Dubai config so overrides have a row to update |

---

## Verified live, post-deploy

**Worker version:** `6180da49-d1d1-458d-a942-46bad5ac9b8e`

### Cloud `/api/state`

```
[/api/state?days=400&limit=5000]
  logs=5,000          (was 100)
  distinct day_dates=80   (was 2)
  first=2026-05-21  last=2026-08-17

[/api/state?days=1]   (realtime path, still caps at 100 as designed)
  logs=50
```

### The screenshot from the field — 2026-08-15 Custom Range report

```
Aug 15 sessions from cloud: 61   (was 0)
  Alazar          Button          units= 22  total_sec= 40598
  Arman Raza      Tailor (01)     units=  6  total_sec= 65439
  Arif            Tailor (02)     units=  4  total_sec= 33923
  Anwar           Stone Work      units=  4  total_sec= 35529
  Mojeeb          Tailor (02)     units=  4  total_sec= 41246
  Anasari         Embroidery      units=  4  total_sec= 32731
  Ridowan         Tailor (02)     units=  3  total_sec= 34378
  Irfan           Tailor (02)     units=  3  total_sec= 42522
  Amirull         Tailor (02)     units=  3  total_sec= 37558
  Naserulla       Hand Work       units=  2  total_sec= 22784
  ...
```

The "0 units" symptom is gone. The same Aug 15 day on the LAN dashboard had this data all along — the cloud was just slicing it down to 100 rows.

### D1 yearly aggregate

```
total_units    = 6039
unique_workers = 56
unique_items   = 401
tailor_01      = 909   (was 817, +92)
hand_work      = 902   (was 885, +17)
```

`SUM(daily_stats.total_units) = COUNT(sessions) = 6039` — D1 is in sync.

---

## Files

| Path | Change |
|---|---|
| `cloudflare/src/handlers/state.js` | limit cap (Bug 1) + per-employee latest (Bug 3b) |
| `cloudflare/src/handlers/report.js` | by_employee latest (Bug 3) |
| `cloudflare/src/domain/process.js` | case-insensitive canonical (Bug 2) |
| `cloudflare/migrations/0011_normalize_emp_process.sql` | 109-row data fix (Bug 2) — **applied to D1** |
| `cloudflare/migrations/0012_rebuild_daily_stats.sql` | daily_stats rebuild (Bug 2) — **applied to D1** |
| `cloudflare/migrations/0013_seed_default_working_hours.sql` | worker_settings seed (Bug 5) — **applied to D1** |
| `public/dashboard.js` | `?limit=5000` + accept flat response (Bug 1b) |
| `shared/reconcile-cloudflare.cjs` | `?days=400&limit=5000` (Bug 4) |
| `install/RELEASE-NOTES-1.2.8.md` | detailed changelog |
| `qa-eval-2026-08-17/` | audit + verification artifacts (committed alongside) |

## LAN mirror (auto-update feed)

The desktop launcher's auto-updater feed is served from the LAN mirror at `http://192.168.0.101:3111/updates/stable/`:

```
GET /updates/stable/latest.yml
  version: 1.2.8
  path:    AbaYa-Track-Launcher-Setup-1.2.8.exe
  size:    96,060,746 bytes
  sha512:  ZmuE7p44nCuA5gLeFUNyA9mPTQ9DLnNmNmd319DBS2TD0TspdPu1llg+dzrRe5SWEU1C0sG1jHvIOT+m7F1l/A==
```

Assets attached to this release:
- `AbaYa-Track-Launcher-Setup-1.2.8.exe` — NSIS installer (96 MB)
- `AbaYa-Track-Launcher-Setup-1.2.8.exe.blockmap` — differential update metadata

Factory laptops already on 1.2.7 will see "Update available" on the next `checkForUpdates()` cycle (default ~6h, or sooner on resume) and self-install 1.2.8.

---

## Upgrade impact

- **Existing 1.2.7 installs**: self-updates to 1.2.8 on the next check. Photos persist across the update (already in 1.2.7 via `ABAYA_DATA_DIR` redirect; 1.2.8 also keeps the install-relative `public/uploads/` fallback on read).
- **Cloud CEO dashboard**: report modals (Daily / Weekly / Monthly / Yearly / Custom) now have full 5,000-row history. No client-side action needed.
- **LAN factory server**: server was restarted 2026-08-17 20:26 GST. `dashboard.js` is served fresh on every request (Express static).
- **Cloudflare Worker**: deployed 2026-08-17 20:25 GST, version `6180da49-d1d1-458d-a942-46bad5ac9b8e`.
- **D1 migrations**: 0011, 0012, 0013 all applied (idempotent if re-run).
