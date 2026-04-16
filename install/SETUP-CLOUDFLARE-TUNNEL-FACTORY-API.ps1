<#
  AbaYa Track — Cloudflare Tunnel for factory HTTPS / WSS (run on FACTORY PC)
  =============================================================================
  Run on the Windows PC that hosts server.js (port 3000), not your dev laptop.

  Why: https://kiosk.farewellabaya.com (Pages) cannot open ws:// to a LAN IP (mixed content).
  This tunnel serves https://<ApiHostname> -> http://127.0.0.1:3000 so Socket.IO uses wss://.

  Prerequisites: farewellabaya.com DNS on Cloudflare (same account as Workers/Pages).

  Usage:
      cd install
      powershell -ExecutionPolicy Bypass -File .\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1
      powershell -ExecutionPolicy Bypass -File .\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1 -ApiHostname "api.farewellabaya.com"

  CEO Worker deploy (any PC): ..\cloudflare\DEPLOY.ps1 or install\DEPLOY-CEO-CLOUD.bat
#>

param(
  [string]$ApiHostname = "api.farewellabaya.com",
  [string]$TunnelName = "abaya-factory-api",
  [int]$LocalPort = 3000,
  [switch]$SkipWinget,
  [switch]$SkipDnsRoute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Ok  ($m) { Write-Host "  [OK] $m"  -ForegroundColor Green }
function Write-Info($m) { Write-Host "  [>>] $m"  -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host "  [!]  $m"  -ForegroundColor Yellow }
function Write-Err ($m) { Write-Host "  [X]  $m"  -ForegroundColor Red }
function Write-Step($n, $m) { Write-Host "`n  -- Step $n : $m --" -ForegroundColor Magenta }

function Ensure-Cloudflared {
  if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    Write-Ok ("cloudflared " + (cloudflared --version 2>&1 | Select-Object -First 1))
    return
  }
  if ($SkipWinget) {
    throw "cloudflared not in PATH. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
  }
  Write-Info "Installing cloudflared (winget)..."
  winget install --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements -e
  $candidates = @(
    "$env:ProgramFiles\Cloudflare\cloudflared",
    "${env:ProgramFiles(x86)}\Cloudflare\cloudflared"
  )
  foreach ($d in $candidates) {
    if (Test-Path (Join-Path $d "cloudflared.exe")) {
      $env:PATH = "$d;$env:PATH"
      break
    }
  }
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Warn "Restart PowerShell, then re-run this script."
    throw "cloudflared not found after install"
  }
}

function Get-TunnelIdFromList([string]$Name) {
  $lines = @(cloudflared tunnel list 2>&1)
  foreach ($line in $lines) {
    if ($line -match '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+(\S+)') {
      if ($Matches[2] -eq $Name) { return $Matches[1] }
    }
  }
  return $null
}

function Ensure-Tunnel([string]$Name) {
  $id = Get-TunnelIdFromList $Name
  if ($id) {
    Write-Ok "Tunnel exists: $Name ($id)"
    return $id
  }
  Write-Info "Creating tunnel '$Name'..."
  $out = (& cloudflared tunnel create $Name 2>&1 | Out-String)
  if ($out -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
    Write-Ok "Created tunnel (id in output)"
    return $Matches[1]
  }
  Write-Host $out
  throw "Could not create or parse tunnel. Create it in Zero Trust dashboard and re-run."
}

Write-Host ""
Write-Host "  AbaYa Track -- Factory API tunnel (HTTPS / WSS)" -ForegroundColor Cyan
Write-Host "  https://$ApiHostname  ->  http://127.0.0.1:$LocalPort" -ForegroundColor Gray
Write-Host ""

Write-Step 1 "cloudflared"
Ensure-Cloudflared

$cfDir = Join-Path $env:USERPROFILE ".cloudflared"
if (-not (Test-Path $cfDir)) {
  New-Item -ItemType Directory -Path $cfDir -Force | Out-Null
}

if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) {
  Write-Step 2 "Cloudflare login (browser -- account that owns DNS zone)"
  & cloudflared tunnel login
  if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) {
    throw "Login failed: cert.pem missing under $cfDir"
  }
  Write-Ok "Login OK"
} else {
  Write-Ok "cert.pem present (login skipped)"
}

Write-Step 3 "Tunnel + DNS"
$tunnelId = Ensure-Tunnel $TunnelName
$credFile = Join-Path $cfDir "$tunnelId.json"
if (-not (Test-Path $credFile)) {
  throw "Missing credentials file: $credFile"
}

if (-not $SkipDnsRoute) {
  $routeOut = & cloudflared tunnel route dns $TunnelName $ApiHostname 2>&1 | Out-String
  Write-Host $routeOut
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "DNS route failed (wrong zone?). Add manually: Zero Trust -> Tunnels -> $TunnelName -> Public hostname $ApiHostname -> http://127.0.0.1:$LocalPort"
  } else {
    Write-Ok "DNS route: $ApiHostname"
  }
} else {
  Write-Warn "-SkipDnsRoute: add public hostname in Cloudflare dashboard yourself."
}

Write-Step 4 "config.yml"
$configPath = Join-Path $cfDir "config.yml"
if (Test-Path $configPath) {
  $bak = "$configPath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $configPath $bak -Force
  Write-Info "Backed up to $bak"
}

$yaml = @"
# AbaYa factory API (do not use kiosk.farewellabaya.com here -- that is Pages).
tunnel: $tunnelId
credentials-file: $credFile

ingress:
  - hostname: $ApiHostname
    service: http://127.0.0.1:$LocalPort
    originRequest:
      noHappyEyeballs: true
      connectTimeout: 30s
      tlsTimeout: 10s
      tcpKeepAlive: 30s
      keepAliveTimeout: 90s
  - service: http_status:404
"@
Set-Content -Path $configPath -Value $yaml.TrimEnd() -Encoding UTF8
Write-Ok "Wrote $configPath"

Write-Step 5 "Run connector"
Write-Info "Test:  cloudflared tunnel --config `"$configPath`" run"
Write-Info "Service (Admin PowerShell):  cloudflared service install"
Write-Host ""
Write-Ok "Done."
Write-Host ""
Write-Host "  Verify (server on port $LocalPort):" -ForegroundColor White
Write-Host "    https://$ApiHostname/api/server-info" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Kiosk PWA tablets -- setup URL:" -ForegroundColor White
Write-Host "    https://$ApiHostname" -ForegroundColor Yellow
Write-Host ""
