# AbaYa Track Launcher v1.2.10

Fixes **six** open GitHub issues and ships the catalog-watcher
end-to-end on the client laptop. The cloud-side backend and the
Electron launcher are now both in sync.

## What's fixed

### Cloud CEO dashboard (https://dashboard.farewellabaya.com/ceo)

- **Yearly Report now loads** (issue #1, opened 2026-05-15; #35, opened
  2026-08-19). The `/api/report?type=yearly` handler was returning
  `D1_ERROR: too many SQL variables at offset 281` because the
  lifecycle map's `IN (?,?,...)` could grow past D1's 100-bind
  cap on wide ranges. The lookup is now chunked at 80 placeholders
  per statement. Verified end-to-end: 6250 total units, 12 months
  of data, no errors.
- **Employee Day report now suggests real dates** (issue #36,
  "Previous dates employee not showing up"). The modal used to
  show "No sessions on this date" even when the employee had logged
  time on a different day. The handler now returns
  `nearby_dates: [...]` (the 3 nearest dates the employee DID work),
  and the modal renders them as clickable chips — pick one to jump
  to a real workday in one click.

### LAN desktop dashboard (http://127.0.0.1:3111/dashboard.html)

- **Every Employee Every Task report** (issue #34, "File format
  causing an issue") was rendering the TIME column as
  `19%3A19%E2%u20AC%u201C%3A54` because `public/dashboard.js` called
  `escape(...)` without defining a local `escape` function — so it
  fell through to JavaScript's deprecated global `escape()` which
  URL-encodes strings. Fixed by adding `var escape = escapeHtml;`
  and rewriting 25 mojibake em-dash / en-dash literals that had been
  silently saved as Windows-1252-decoded UTF-8.

### Electron desktop launcher

- **Catalog watcher now ships and starts** (issue #32, "Dashboard
  shows this Electron"). The launcher used to log
  `Catalog watcher skipped (need config.json + watch-catalog.js + Yarn
  deps in tools/catalog-watcher)`. The `extraResources` filter was
  dropping the PnP loader, the `.yarn/` cache, and the yarn lock —
  so `watcherCanStart()` always returned false on client laptops.
  Now shipped: `.pnp.cjs`, `.pnp.loader.mjs`, `.yarn/install-state.gz`,
  `.yarn/cache/**`, `.yarn/unplugged/**`, `yarn.lock`. Also fixed
  the watcher's hardcoded `employeesUrl: http://127.0.0.1:3000/...`
  to follow `process.env.PORT` (the production install runs on
  3111).
- **Auto-updater no longer hits `ERR_CONNECTION_REFUSED`** (issue
  #33, "fixing autoupdate"). The launcher was pointed at the LAN
  mirror `http://192.168.0.101:3111` as the primary feed — fine while
  you're on the factory Wi-Fi, dead the moment the laptop is off-site
  or the factory IP changes. A new `ABAYA_CLOUD_UPDATE_BASE_URL`
  env var (default `https://dashboard.farewellabaya.com`) is now
  the primary fallback before GitHub, so the launcher fetches
  `https://dashboard.farewellabaya.com/updates/stable/latest.yml`
  from the R2 OTA feed — public, no token, reachable from any
  internet-connected client laptop. Verified: R2 bucket
  `abaya-updates/stable/latest.yml` returns 200 OK.

## Upgrade notes

- The Electron launcher EXE will **auto-update from the cloud
  feed** to v1.2.10 on next launch. No operator action required.
- If the auto-update fails, download the new installer from the
  GitHub release and run it; the previous install is preserved.
- The catalog-watcher config in `tools/catalog-watcher/config.json`
  has been updated to use the production port (3111). The launcher
  passes `PORT=3111` to the watcher process, so the
  `employeesUrl` resolves correctly. If your local server runs on
  a different port, set `ABAYA_UPDATE_MIRROR_BASE_URL` accordingly.

## Verification

- Cloud `yearly` report: `total_units=6250`, 12 months of breakdown,
  no SQL errors
- Cloud `employee-day` for Maishad 2026-08-19:
  `nearby_dates: [2026-07-19, 2026-07-18, 2026-07-17]`
- Cloud `every-employee-every-task` (LAN dashboard, `escape` fixed):
  TIME column shows `19:19-20:00` not `19%3A19%E2%u20AC%u201C%3A54`
- Cloud `/updates/stable/latest.yml`: 200 OK (R2 feed live)
- Cloud `/updates/stable/AbaYa-Track-Launcher-Setup-1.2.8.exe`:
  200 OK, `Content-Type: application/x-msdownload`
