# AbaYa Track v1.2.9

Hotfix release. One critical bug still present in v1.2.8: **"No data is loading" on the LAN dashboard** (and the cloud CEO dashboard) — empty panels showing **"No sessions recorded yet"**, **"No active sessions right now"**, **"No garment sessions yet"** even though `/api/state?days=1` was returning real data.

---

## Root cause

`public/dashboard.js` had a stale identifier reference: `renderAbayaItemTotals()` called `agg[k]` (line 801) but the local variable was renamed to `itemAgg` during the v1.2.5 refactor. Every render of the **"Total Time by Abaya Item Code"** panel threw `Uncaught ReferenceError: agg is not defined` and aborted the rest of `renderAll()`.

The cloud dashboard's `ceo-pages.js` has a `safeRender()` wrapper around each panel — so a single panel error there just skips that one panel. The LAN dashboard did **not** have this safety net, so the first uncaught error in `renderAbayaItemTotals()` killed every panel that came after it, including `renderEmployeePerf()`, `renderHourlyChart()`, `renderPareto()`, `renderProcessEff()`, etc.

### Live evidence (before fix)

```
[INFO:CONSOLE] "Uncaught ReferenceError: agg is not defined
    at renderAbayaItemTotals (dashboard.js:801:21)
    at renderAll (dashboard.js:735:5)
    ..."
```

Captured from `http://127.0.0.1:3111/dashboard.html` on 2026-08-17.

### After fix

- Zero `ReferenceError`, zero `Uncaught` in the dashboard console.
- The **Process Efficiency** panel now shows all 12 work types with correct percentages.
- The **All Employees — Today's Performance** panel now renders the full roster.
- Screenshot: `qa-eval-2026-08-17/lan-dashboard-postfix.png`.

---

## What's in this release

| Change | File | Lines |
|---|---|---|
| `agg[k]` → `itemAgg[k]` | `public/dashboard.js` | 801 |
| `renderAll()` wrapped in per-step `try/catch` (mirrors cloud's `safeRender`) | `public/dashboard.js` | 732–757 |
| `lines.join('\\n')` → `lines.join('\n')` in three WhatsApp export call sites | `cloudflare/src/ui/ceo-pages.js` | 1824, 1850, 1959 |
| Version bump `1.2.8` → `1.2.9` | `tools/desktop-launcher/package.json` | 3 |

---

## Defense in depth

Beyond fixing the immediate bug, the LAN `renderAll()` was rewritten to wrap every panel in a `try/catch` and log failures to the console as `[dashboard] renderAll step failed: <stage>`. This matches the cloud dashboard's `safeRender()` pattern. Any future regression in a single panel will be visible in the console and will not blank out the rest of the dashboard.

---

## We rejected a "fix" that would have broken things

We were sent a patch that proposed:
- Replacing `'\\uD83D\\uDCCA'` (the chart-emoji escape) with `'\\\\uD83D\\\\uDCCA'`
- In `cloudflare/src/index.js`
- Inside `exportWA()`

This patch was **wrong** on every count:

1. `exportWA()` lives in `cloudflare/src/ui/ceo-pages.js:1776`, not `index.js`.
2. `cloudflare/src/index.js` does not contain a `let msg = '...'` line with `\\uD83D\\uDCCA` anywhere.
3. `let msg = '\\uD83D\\uDCCA *Report*\\n'` in a single-quoted JavaScript string is already valid. Doubling the backslashes (the proposed "fix") would replace the emoji 📊 with the literal six-character text `\\uD83D\\uDCCA` — a regression.

The real "no data loading" bug was a stale identifier in `public/dashboard.js`. Different file, different function, different root cause. We investigated before patching.

---

## No data migration needed

This is a pure frontend fix. No D1 migration, no schema change, no data backfill.

## Auto-update

Same path as v1.2.8: LAN mirror at `http://192.168.0.101:3111/updates/stable/`. Existing v1.2.7 and v1.2.8 installs will be offered v1.2.9 on next launch.
