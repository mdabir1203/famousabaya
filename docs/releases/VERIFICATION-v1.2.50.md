---
skill: verification-rigorous
date: 2026-09-26
status: complete
verdict: fail
unit: v1.2.50
application_type: web
browser: chromium (Playwright dev)
scenarios_total: 7
scenarios_passed: 3
scenarios_failed: 4
scenarios_blocked: 0
scenarios_soft_failed: 0
evidence_items_captured: 7
a11y_violations: 0
perf_threshold_breaches: 0
teardown_failures: 0
open_questions: 0
preflight_failures: 1
---

# VERIFICATION: v1.2.50

## Summary
| Result | Pre-deploy | Post-deploy |
|--------|-----------|-------------|
| PASS | 3 | 0 |
| FAIL | 4 | 0 |
| **Total** | **7** | **0** |

**Verdict:** FAIL. Deploy skipped.

## Environment
- **Application:** AbaYa-Track cloud dashboard (Famous Abaya)
- **Type:** web (cloudflare worker + static UI)
- **Start command:** npx wrangler deploy --config wrangler.toml (in cloudflare/)
- **Base URL:** https://dashboard.farewellabaya.com
- **Browser:** chromium (Playwright)
- **Date:** 2026-09-26T16:50:12.569Z

## Preflight
- OK: Node.js >= 18
- OK: Playwright installed
- OK: Evidence dir writable
- OK: CEO_TOKEN present
- OK: Package version matches worker
- OK: Base URL reachable — status 200
- FAIL: Chromium installed

## Scenarios
### Pre-deploy
#### S-001. CEO login via ?token=... bootstrap lands on the dashboard
- Result: PASS
- Screenshot: `predeploy/S-001-final.png`
- Evidence:
  - Assertion log: console + network captures under the scenario dir
  - Captured evidence: `{"title":"AbaYa Track — CEO Dashboard","hasSessionCookie":true,"bannerVisible":false,"dashRoot":4,"url":"https://dashboard.farewellabaya.com/"}`

#### S-002. KPI tiles row renders with freshness pills
- Result: PASS
- Screenshot: `predeploy/S-002-final.png`
- Evidence:
  - Assertion log: console + network captures under the scenario dir
  - Captured evidence: `{"tiles":5,"completed":"6","avg":"4h 57m 28s"}`

#### S-003. Mouthirrahman day modal opens for 2026-09-20 — Smoke
- Result: PASS
- Screenshot: `predeploy/S-003-final.png`
- Evidence:
  - Assertion log: console + network captures under the scenario dir
  - Captured evidence: `{"title":"Mouthirrahman — 2026-09-20","processCompleted":"3","sessionRows":4,"url":"https://dashboard.farewellabaya.com/"}`

#### S-004. Last-30-days cell for 09-20 reads "3u" (NOT "2u" or "4u") — v1.2.46/8 dedup fix
- Result: FAIL
- Screenshot: `predeploy/S-004-final.png`
- Evidence:
  - Assertion log: console + network captures under the scenario dir
  - Captured evidence: `{"cellText":"09-204u9h 55m","totalCells":24}`

#### S-005. Sessions list carries audit data attributes (v1.2.47)
- Result: FAIL
- Screenshot: `predeploy/S-005-final.png`
- Evidence:
  - Assertion log: console + network captures under the scenario dir
  - Captured evidence: `{"rowCount":0,"attrs":{}}`

#### S-006. CF111 rows share the same per-abaya left-border tint + swatch dot
- Result: FAIL
- Screenshot: `predeploy/S-006-final.png`
- Evidence:
  - Assertion log: console + network captures under the scenario dir
  - Captured evidence: `{"rowCount":0,"perCodeCounts":{},"perCodeFirstColor":{},"cf111Colors":[],"cf111SharedColor":false,"distinctAcrossCodes":false}`

#### S-007. CF111 STD-O row carries the "Custom" pill (is_custom=1 in catalog)
- Result: FAIL
- Screenshot: `predeploy/S-007-final.png`
- Evidence:
  - Assertion log: console + network captures under the scenario dir
  - Captured evidence: `{"cf111Rows":0,"customPillFound":false}`

## Teardown
- Browser contexts closed: OK
- App process: no deploy performed
- Orphans: 0

## Notes
- CEO_TOKEN is read from the env var and never logged. The token grants
  the same access as the dashboard login; treat it like a password.
- Each scenario captures a full-page screenshot at the assertion point.
- The wrapper fails fast on any FAIL before running wrangler deploy.