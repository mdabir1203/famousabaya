<#
  AbaYa Track — deploy CEO Cloudflare Worker + Kiosk PWA (Pages)
  ===============================================================
  Run from repo root or install folder. Requires Node, Wrangler login, and network.

  Usage:
      cd install
      powershell -ExecutionPolicy Bypass -File .\DEPLOY-ALL.ps1

  Steps:
    1. cloudflare\DEPLOY.ps1  — Worker + D1 (dashboard.farewellabaya.com)
    2. wrangler pages deploy   — kiosk-pwa → abaya-kiosk (kiosk.farewellabaya.com)
#>

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')

Write-Host ''
Write-Host '  AbaYa Track — DEPLOY ALL (Worker + Kiosk Pages)' -ForegroundColor Cyan
Write-Host '  Root: ' -NoNewline; Write-Host $Root -ForegroundColor Gray
Write-Host ''

# ── 1. Worker ────────────────────────────────────────────────────────────────
Write-Host '  [1/2] Cloudflare Worker (CEO dashboard + ingest)...' -ForegroundColor Yellow
Push-Location (Join-Path $Root 'cloudflare')
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File .\DEPLOY.ps1
  if ($LASTEXITCODE -ne 0) { throw "Worker deploy failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}

# ── 2. Pages ─────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  [2/2] Cloudflare Pages (kiosk PWA)...' -ForegroundColor Yellow
Push-Location $Root
try {
  $wVer = & yarn run wrangler --version 2>&1 | Select-Object -First 1
  Write-Host "  Wrangler: $wVer" -ForegroundColor Gray
  $kioskDir = Join-Path $Root 'kiosk-pwa'
  & yarn run wrangler pages deploy $kioskDir --project-name abaya-kiosk --branch main
  if ($LASTEXITCODE -ne 0) { throw "Pages deploy failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host '  Done. Kiosk: https://kiosk.farewellabaya.com  |  CEO: https://dashboard.farewellabaya.com' -ForegroundColor Green
Write-Host ''
Write-Host '  Factory PC (live floor): run install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1 if not done yet;' -ForegroundColor Gray
Write-Host '  then LAUNCH-ALL.bat so api.* tunnel + server.js run together. Tablet QRs: /setup + docs\REMOTE_ACCESS.md' -ForegroundColor Gray
Write-Host ''
