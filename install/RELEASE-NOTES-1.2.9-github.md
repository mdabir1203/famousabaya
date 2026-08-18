# AbaYa Track v1.2.9

Hotfix release. **Two critical bugs** still present in v1.2.8 — both surfaced as "no data is loading" on the dashboards, but in completely different code paths.

| Surface | Symptom | Root cause |
|---|---|---|
| `https://dashboard.farewellabaya.com/ceo` (cloud) | `Uncaught SyntaxError: Invalid or unexpected token` at `ceo:998`; every panel blank | 4 template-literal escape mistakes in `ceo-pages.js` |
| `http://127.0.0.1:3111/dashboard.html` (LAN) | `Uncaught ReferenceError: agg is not defined` at `dashboard.js:801`; every panel blank | Stale `agg` → `itemAgg` rename from v1.2.5 refactor |

Both `/api/state` endpoints were returning correct data the whole time — the bug was purely in the frontend.

---

## Cloud dashboard parse error (the big one)

`getCEODashboard()` in `cloudflare/src/ui/ceo-pages.js` returns a single large template literal that contains BOTH the served HTML AND the JavaScript that runs in the browser. Four single-quoted JavaScript strings inside that template held escapes that the outer template evaluated to control characters or unescaped apostrophes, breaking the served JS at the source level so `renderAll()` never ran.

### Symptom

```
Uncaught SyntaxError: Invalid or unexpected token   at ceo:998
```

Visible in the red error banner added in this release (top of body, fixed position). KPIs stuck at "Loading…", sync status stuck at "Syncing…", every panel blank.

### The four escape mistakes

| Line | Source | Output (broken) | Why it broke |
|---|---|---|---|
| `ceo-pages.js:1092` | `'Stage: ' + ... + '\n' +` | real `\n` | Newline inside JS string |
| `ceo-pages.js:1638` | `title="See this employee\'s day"` | real `'` | Unescaped `'` breaks string |
| `ceo-pages.js:1812, 1838, 1947, 2378` | `lines.join('\n')` | real `\n` | Newline inside JS string |

### The fix

| Line | Fixed source | Output (correct) |
|---|---|---|
| 1092 | `'... + '<br>' +` | `<br>` (HTML output context) |
| 1638 | `title="See this employee\\'s day"` (title), `\\'\\'` (onclick) | served JS contains `\'`; rendered title still shows `employee's day` |
| 1812, 1838, 1947, 2378 | `lines.join('\\n')` | served JS contains `\n` (browser joins with newlines at runtime) |

### Verified live

`node --check` passes on every `<script>` block served from `/ceo`. Headless Edge CDP session signed in to `https://dashboard.farewellabaya.com/ceo`:

- ✅ Zero exceptions, zero `Uncaught`, zero error-banner renders
- ✅ KPIs populated: 35 completed today, 9 active workers, 1h 42m 28s avg cycle, 44% efficiency
- ✅ 12 LIVE ACTIVE SESSIONS panel with full employee + item + timing
- ✅ PROCESS SPLIT TODAY with all 8 work types
- ✅ EMPLOYEE PERFORMANCE — TODAY with 13 ranked rows (Alazar, Irfan, Amnul, Amaan, Arman Raza, Arif, Ridawan, Nasrulla, Anwer, Majeeb, Mouhirahman, Farhan, SM)
- ✅ TOTAL TIME BY ABAYA ITEM CODE table with multiple items
- ✅ HOURLY OUTPUT bar chart

Screenshot: `qa-eval-2026-08-17/cloud-ceo-postfix.png`.

---

## LAN dashboard `agg` → `itemAgg` rename

`public/dashboard.js:801` in `renderAbayaItemTotals()` was calling `agg[k]` but the local variable was renamed to `itemAgg` during the v1.2.5 refactor. Every render threw `Uncaught ReferenceError: agg is not defined` and aborted the rest of `renderAll()`. Because the LAN dashboard did not wrap each panel in a try/catch (unlike the cloud's `safeRender()`), the entire dashboard showed empty panels.

### The fix

- Renamed `agg[k]` → `itemAgg[k]` at `public/dashboard.js:801`.
- Defense in depth: rewrote `renderAll()` so every panel is now wrapped in its own `try/catch` (mirrors the cloud's `safeRender`). A single broken panel can no longer blank out the rest of the dashboard.

### Verified live

Headless Edge console capture on `http://127.0.0.1:3111/dashboard.html`:

- Before fix: `Uncaught ReferenceError: agg is not defined at dashboard.js:801` fires 3+ times.
- After fix: zero `ReferenceError`, zero `Uncaught`. The `PROCESS EFFICIENCY`, `ALL EMPLOYEES — TODAY'S PERFORMANCE`, and `TOTAL TIME BY ABAYA ITEM CODE` panels render correctly.

Screenshot: `qa-eval-2026-08-17/lan-dashboard-postfix.png`.

---

## What's in this release

| Change | File | Lines |
|---|---|---|
| `agg[k]` → `itemAgg[k]` | `public/dashboard.js` | 801 |
| `renderAll()` wrapped in per-step `try/catch` | `public/dashboard.js` | 732–757 |
| `'\n'` → `'<br>'` in error banner | `cloudflare/src/ui/ceo-pages.js` | 1092 |
| `title="See this employee\\'s day"` (was broken escape) | `cloudflare/src/ui/ceo-pages.js` | 1638 |
| `lines.join('\n')` → `lines.join('\\n')` in 4 spots | `cloudflare/src/ui/ceo-pages.js` | 1812, 1838, 1947, 2378 |
| Removed Web Vitals IIFE; added visible JS error banner | `cloudflare/src/ui/ceo-pages.js` | 113–143 |
| `[ceo-poll] status=…` console.log | `cloudflare/src/ui/ceo-pages.js` | 607, 696 |
| Allow `Cache-Control`, `Pragma` in CORS | `cloudflare/src/http-response.js` | CORS headers |
| Version bump `1.2.8` → `1.2.9` | `tools/desktop-launcher/package.json` | 3 |

---

## We rejected a "fix" that would have broken things

We were sent a patch that proposed:
- Replacing `'\uD83D\uDCCA'` (the chart-emoji escape) with `'\\uD83D\\uDCCA'`
- In `cloudflare/src/index.js`
- Inside `exportWA()`

This patch was **wrong** on every count:

1. `exportWA()` lives in `cloudflare/src/ui/ceo-pages.js:1776`, not `index.js`.
2. `cloudflare/src/index.js` does not contain a `let msg = '...'` line with `\uD83D\uDCCA` anywhere.
3. `'\uD83D\uDCCA *Report*\n'` in a single-quoted JavaScript string is already valid. Doubling the backslashes (the proposed "fix") would replace the emoji 📊 with the literal six-character text `\uD83D\uDCCA` — a regression.

The real bugs were (a) a stale identifier in `public/dashboard.js` and (b) four template-literal escape mistakes in `ceo-pages.js`. Different files, different functions, different root causes. We investigated before patching.

---

## No data migration needed

This is a pure frontend fix. No D1 migration, no schema change, no data backfill.

## Auto-update

Same path as v1.2.8: LAN mirror at `http://192.168.0.101:3111/updates/stable/`. Existing v1.2.7 and v1.2.8 installs will be offered v1.2.9 on next launch.
