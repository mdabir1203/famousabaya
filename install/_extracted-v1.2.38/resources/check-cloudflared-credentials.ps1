# Quick check: %USERPROFILE%\.cloudflared for tunnel JSON + optional config.yml
# Does not fix anything — see docs/REMOTE_ACCESS.md "Tunnel credential not found" section.

$ErrorActionPreference = 'Continue'
$cf = Join-Path $env:USERPROFILE '.cloudflared'

Write-Host "=== cloudflared folder: $cf ===" -ForegroundColor Cyan
if (-not (Test-Path $cf)) {
  Write-Host "MISSING: Folder does not exist. Run Cloudflare Zero Trust > Tunnels > Install connector (Windows)." -ForegroundColor Red
  exit 1
}

Get-ChildItem $cf -Force | ForEach-Object { Write-Host "  $($_.Name)" }

$jsonFiles = Get-ChildItem (Join-Path $cf '*.json') -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$' }
if (-not $jsonFiles) {
  Write-Host ""
  Write-Host "No tunnel UUID .json found in .cloudflared — 'tunnel credential not found' is expected until you run the dashboard connector install." -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "Found tunnel credential file(s):" -ForegroundColor Green
  $jsonFiles | ForEach-Object { Write-Host "  $($_.FullName)" }
}

$config = Join-Path $cf 'config.yml'
if (Test-Path $config) {
  Write-Host ""
  Write-Host "config.yml present: $config" -ForegroundColor Green
  Write-Host "(Ensure tunnel: and credentials-file: inside match the files above.)"
} else {
  Write-Host ""
  Write-Host "No config.yml — you may be using 'tunnel run' with CLI only; that is OK if the dashboard install created credentials." -ForegroundColor DarkGray
}

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (Test-Path $envFile) {
  $port = '3000'
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*PORT\s*=\s*(.+)\s*$') { $port = $matches[1].Trim() }
  }
  Write-Host ""
  Write-Host "AbaYa PORT from .env: $port — tunnel Public hostname service should be http://127.0.0.1:$port" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Next: docs/REMOTE_ACCESS.md (Part D) and https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
