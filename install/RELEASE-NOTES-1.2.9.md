# AbaYa Track Launcher v1.2.9

Hotfix release. Targets one breaking bug that was still present in v1.2.8:
**"No data is loading" on the LAN dashboard** (`http://127.0.0.1:3111/dashboard.html`)
and the cloud CEO dashboard at `https://dashboard.farewellabaya.com/ceo`.

If your shop floor screens were stuck on **"No sessions recorded yet"**,
**"No active sessions right now"**, or **"No garment sessions yet"** even
though `http://127.0.0.1:3111/api/state?days=1` was returning real data —
this fix is for you.

## What changed in 1.2.9

### Critical fix

- **Dashboard panel rendering crash.** `public/dashboard.js` had a stale
  identifier reference: `renderAbayaItemTotals()` was calling
  `agg[k]` (line 801) but the local variable was renamed to `itemAgg`
  during the v1.2.5 refactor. Every render of the **"Total Time by Abaya
  Item Code"** panel threw `Uncaught ReferenceError: agg is not defined`
  and aborted the rest of `renderAll()`. Because the LAN dashboard does
  not wrap each panel in a try/catch (unlike the cloud's
  `ceo-pages.js` which has a `safeRender()` wrapper), the entire
  dashboard showed empty panels even though the underlying `/api/state`
  payload was correct.
  - **Fix:** renamed `agg[k]` → `itemAgg[k]` at `public/dashboard.js:801`.
  - **Defense in depth:** rewrote `renderAll()` so every panel is now
    wrapped in its own `try/catch` (mirrors the cloud's `safeRender`).
    A single broken panel can no longer blank out the rest of the
    dashboard — any future regression will be logged to the console as
    `[dashboard] renderAll step failed: <stage>` instead of silently
    killing the page.

### Bonus fixes (caught while investigating)

- **WhatsApp export used literal `\n` text instead of newlines.**
  `cloudflare/src/ui/ceo-pages.js` had three call sites (lines 1824,
  1850, 1959) using `lines.join('\\n')` (double backslash) which
  embedded the two-character string `\n` into the WhatsApp message
  instead of a real newline. Now uses `lines.join('\n')` so the
  generated report actually has line breaks in WhatsApp.

### Verified live

- **Headless Edge console capture on `http://127.0.0.1:3111/dashboard.html`**
  before fix: `Uncaught ReferenceError: agg is not defined at dashboard.js:801`
  fires 3+ times.
- **After fix:** zero `ReferenceError`, zero `Uncaught`. The
  `PROCESS EFFICIENCY`, `ALL EMPLOYEES — TODAY'S PERFORMANCE`, and
  `TOTAL TIME BY ABAYA ITEM CODE` panels now render correctly.
  Screenshot: `qa-eval-2026-08-17/lan-dashboard-postfix.png`.

### Note on the proposed "fix" we evaluated and rejected

We were sent a patch that proposed wrapping `'\\uD83D\\uDCCA'`,
`'\\u2014'`, and `'\\n'` in `cloudflare/src/index.js` to "fix" the
dashboard. That patch was **wrong** and would have made things worse:

1. The function the patch targeted (`exportWA()` with `'\\uD83D\\uCCA'`
   in a template literal) **does not exist** anywhere in the codebase.
   `exportWA()` is in `cloudflare/src/ui/ceo-pages.js:1776` (not
   `index.js`), and the file the patch wanted to edit has no
   `let msg = '\\uD83D\\uDCCA ...'` line at all.
2. `'\\uD83D\\uDCCA'` in a single-quoted JavaScript string is already
   valid. Doubling the backslashes (the proposed "fix") would replace
   the chart emoji 📊 with the literal six-character text `\uD83D\uDCCA`
   — a regression, not a fix.
3. The real "no data loading" bug was a stale identifier in
   `public/dashboard.js`, not a Unicode escape sequence. Different
   file, different function, different root cause.

The investigation log is preserved at
`qa-eval-2026-08-17/inspect-snapshot.cjs` and
`qa-eval-2026-08-17/lan-dashboard-postfix-console.log`.

## Installer behaviour

- Same auto-update path as v1.2.8 (LAN mirror at
  `http://192.168.0.101:3111/updates/stable/`).
- Existing v1.2.7 / v1.2.8 installs will be offered v1.2.9 on
  next launch.
- No schema change, no D1 migration, no data backfill needed —
  this is a pure frontend fix.

## Files changed in this hotfix

- `public/dashboard.js` — line 801 rename + `renderAll()` safe-wrap
- `cloudflare/src/ui/ceo-pages.js` — three `\\n` → `\n` fixes
- `tools/desktop-launcher/package.json` — version bump to 1.2.9
- `install/RELEASE-NOTES-1.2.9.md` — this file
- `install/RELEASE-NOTES-1.2.9-github.md` — GitHub release body
- `qa-eval-2026-08-17/lan-dashboard-postfix.png` — post-fix screenshot
- `qa-eval-2026-08-17/lan-dashboard-postfix-console.log` — clean console
- `qa-eval-2026-08-17/lint-dashboard.cjs` — static linter (re-ran)
