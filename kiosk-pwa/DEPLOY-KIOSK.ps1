<#
  AbaYa Track — Kiosk PWA Deploy to Cloudflare Pages
  ====================================================
  Deploys the kiosk-pwa/ folder to Cloudflare Pages at kiosk.farewellabaya.com.

  Usage:
    cd kiosk-pwa
    powershell -ExecutionPolicy Bypass -File DEPLOY-KIOSK.ps1
#>

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT_DIR   = Split-Path -Parent $SCRIPT_DIR

Write-Host ""
Write-Host "  AbaYa Track — Kiosk PWA Deploy" -ForegroundColor Cyan
Write-Host "  ===============================" -ForegroundColor Cyan
Write-Host ""

Write-Host "  [1/3] Checking Wrangler (yarn exec from repo root — avoids npx + Yarn PnP errors)..."
Push-Location $ROOT_DIR
try {
    if (-not (Get-Command yarn -ErrorAction SilentlyContinue)) {
        throw "yarn not on PATH. Run: corepack enable"
    }
    $wVer = & yarn run wrangler --version 2>&1 | Select-Object -First 1
    Write-Host "  [OK] Wrangler: $wVer" -ForegroundColor Green

    Write-Host ""
    Write-Host "  [2/3] Deploying kiosk-pwa to Cloudflare Pages..."
    Write-Host ""

    & yarn run wrangler pages deploy $SCRIPT_DIR --project-name abaya-kiosk --branch main
} catch {
    Write-Host "  [X] From repo root run: yarn install  (adds wrangler devDependency)" -ForegroundColor Red
    throw
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "  [3/3] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Cloudflare Dashboard -> Pages -> abaya-kiosk -> Custom domains" -ForegroundColor Gray
Write-Host "    2. Add: kiosk.farewellabaya.com (DNS is created automatically in the same zone)" -ForegroundColor Yellow
Write-Host "    3. On the FACTORY PC (where server.js runs):" -ForegroundColor Gray
Write-Host "         install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1" -ForegroundColor Cyan
Write-Host "       Routes https://api.farewellabaya.com -> http://127.0.0.1:3000 (edit hostname in script if needed)." -ForegroundColor Gray
Write-Host "    4. Use install\LAUNCH-ALL.bat daily so cloudflared + Node start together." -ForegroundColor Gray
Write-Host "    5. Print tablet QRs from http://<factory-pc>:3000/setup : Custom URL = https://kiosk.farewellabaya.com" -ForegroundColor Gray
Write-Host "       Field 'Factory API for QR' presets server= on each QR (must be https://)." -ForegroundColor Gray
Write-Host ""
Write-Host "  Full stack (Worker + Pages) in one go from repo root:" -ForegroundColor White
Write-Host "    yarn run deploy:all" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Tablets: open https://kiosk.farewellabaya.com — clear stale http:// via ?reset=server" -ForegroundColor Yellow
Write-Host ""
