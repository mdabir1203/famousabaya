# AbaYa Track Launcher v1.2.9

Hotfix release. Fixes **two** breaking bugs that survived v1.2.8:

1. **Cloud CEO dashboard showed no data** —
   `https://dashboard.farewellabaya.com/ceo` threw
   `Uncaught SyntaxError: Invalid or unexpected token` at the top of
   the served script, so `renderAll()` never ran and every panel
   stayed at placeholder.
2. **LAN dashboard showed no data** —
   `http://127.0.0.1:3111/dashboard.html` threw
   `Uncaught ReferenceError: agg is not defined` inside
   `renderAbayaItemTotals()`, aborting the rest of `renderAll()`.

If your shop floor screens were stuck on **"No sessions recorded yet"**,
**"No active sessions right now"**, or **"No garment sessions yet"** even
though `http://127.0.0.1:3111/api/state?days=1` (LAN) or
`https://dashboard.farewellabaya.com/api/state` (cloud) was returning
real data — this fix is for you.

## What changed in 1.2.9

### Critical fixes

#### 1. Cloud dashboard parse error — `ceo-pages.js`

The `getCEODashboard()` function in `cloudflare/src/ui/ceo-pages.js`
returns a large template literal that contains BOTH the HTML markup
AND the JavaScript that runs in the browser. Inside that template,
three single-quoted JavaScript strings held a real newline (from a
`'\n'` escape that the outer template evaluated to a control char) and
a fourth held an unescaped apostrophe inside an HTML `title` attribute.
When the template was evaluated at request time, the served JS
contained real newlines and a stray `'` — which the browser's JS
parser sees as a syntax error.

- **Symptom:** `Uncaught SyntaxError: Invalid or unexpected token`
  at `ceo:998` (visible in the visible red error banner added in the
  same release). KPI placeholders stayed at "Loading…", "Syncing…"
  never updated, every panel was blank.
- **Root cause:** four template-literal escape mistakes in
  `cloudflare/src/ui/ceo-pages.js`:
  - line 1092 — `'Stage: ' + ... + '\n' +` (in the visible error
    banner; the output context is HTML, so a real newline broke the
    page). Fixed to use `'<br>'`.
  - line 1638 — `title="See this employee\'s day"` — inside the
    template literal, `\'` evaluates to `'` (no escape), so the
    output `employee's` had an unescaped `'` that broke the served
    JS string. Fixed to use `\\'` in the source so the served JS
    contains the JS escape `\'` (the rendered title attribute still
    shows "employee's day" to the user).
  - lines 1812, 1838, 1947, 2378 — `lines.join('\n')` — same
    pattern: `'\n'` evaluates to a real newline. Fixed to
    `lines.join('\\n')` so the served JS contains the literal
    escape `\n` (which the browser then converts to a newline at
    runtime, joining with real newlines as intended).
- **Verified:** `node --check` now passes on every `<script>` block
  served from `/ceo`. Headless Edge CDP session signed in to
  `https://dashboard.farewellabaya.com/ceo`, captured zero
  exceptions, zero `Uncaught`, zero error-banner renders; full
  dashboard rendered: 35 completed today, 9 active workers,
  13 employees in performance, all 8 process rows, full abaya
  item table, hourly output chart. Screenshot:
  `qa-eval-2026-08-17/cloud-ceo-postfix.png`.

#### 2. LAN dashboard `agg` → `itemAgg` rename mismatch

`public/dashboard.js` line 801 in `renderAbayaItemTotals()` was
calling `agg[k]` but the local variable was renamed to `itemAgg`
during the v1.2.5 refactor. Every render of the
**"Total Time by Abaya Item Code"** panel threw
`Uncaught ReferenceError: agg is not defined` and aborted the rest
of `renderAll()`. Because the LAN dashboard does not wrap each
panel in a try/catch (unlike the cloud's `safeRender()`), the
entire dashboard showed empty panels even though the underlying
`/api/state` payload was correct.

- **Fix:** renamed `agg[k]` → `itemAgg[k]` at `public/dashboard.js:801`.
- **Defense in depth:** rewrote `renderAll()` so every panel is
  now wrapped in its own `try/catch` (mirrors the cloud's
  `safeRender`). A single broken panel can no longer blank out the
  rest of the dashboard — any future regression will be logged to
  the console as `[dashboard] renderAll step failed: <stage>`
  instead of silently killing the page.

### Bonus fixes (caught while investigating)

- **Cloud CORS regression:** `cloudflare/src/http-response.js` did
  not list `Cache-Control` and `Pragma` in
  `Access-Control-Allow-Headers`, so any browser that preflighted
  a request carrying those headers (e.g. the new `poll()` with
  `Cache-Control: no-cache`) would have been rejected. Now allows
  both.
- **Visible JS error banner:** the `<script>` block at the top of
  `ceo-pages.js` now installs a global `error` and
  `unhandledrejection` listener that renders any thrown error into
  a fixed red banner at the top of the body. This means a future
  regression surfaces in the UI immediately — no devtools required.
- **Removed unused Web Vitals IIFE:** the previous version of
  `ceo-pages.js` shipped a ~40-line Web Vitals block (TTFB, FCP,
  LCP, CLS, INP) that wasn't wired into anything user-facing and
  added parse-error surface area. Removed in favour of the error
  banner above.

### Note on the proposed "fix" we evaluated and rejected

We were sent a patch that proposed wrapping `'\\uD83D\\uDCCA'`,
`'\\u2014'`, and `'\\n'` in `cloudflare/src/index.js` to "fix" the
dashboard. That patch was **wrong** and would have made things worse:

1. The function the patch targeted (`exportWA()` with
   `'\\uD83D\\uDCCA'` in a template literal) **does not exist**
   anywhere in the codebase. `exportWA()` is in
   `cloudflare/src/ui/ceo-pages.js:1776` (not `index.js`), and the
   file the patch wanted to edit has no
   `let msg = '\\uD83D\\uDCCA ...'` line at all.
2. `'\\uD83D\\uDCCA'` in a single-quoted JavaScript string is
   already valid. Doubling the backslashes (the proposed "fix")
   would replace the chart emoji 📊 with the literal six-character
   text `\uD83D\uDCCA` — a regression, not a fix.
3. The real "no data loading" bugs were (a) a stale identifier
   rename in `public/dashboard.js` and (b) four template-literal
   escape mistakes in `cloudflare/src/ui/ceo-pages.js`. Different
   files, different functions, different root causes.

The investigation log is preserved in `qa-eval-2026-08-17/`.

## Installer behaviour

- Same auto-update path as v1.2.8 (LAN mirror at
  `http://192.168.0.101:3111/updates/stable/`).
- Existing v1.2.7 / v1.2.8 installs will be offered v1.2.9 on
  next launch.
- No schema change, no D1 migration, no data backfill needed —
  this is a pure frontend fix.
- The cloud dashboard fix is server-side only — users just need
  to hard-refresh (Ctrl+Shift+R) to clear any cached bad JS.

## Files changed in this hotfix

- `public/dashboard.js` — line 801 rename + `renderAll()`
  safe-wrap (defense in depth)
- `cloudflare/src/ui/ceo-pages.js` — four template-literal escape
  fixes + visible error banner + removed Web Vitals IIFE
- `cloudflare/src/http-response.js` — allow `Cache-Control` and
  `Pragma` in CORS
- `tools/desktop-launcher/package.json` — version bump to 1.2.9
- `install/RELEASE-NOTES-1.2.9.md` — this file
- `install/RELEASE-NOTES-1.2.9-github.md` — GitHub release body
- `qa-eval-2026-08-17/lan-dashboard-postfix.png` — LAN post-fix
- `qa-eval-2026-08-17/cloud-ceo-postfix.png` — cloud post-fix
