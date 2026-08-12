#Requires -Version 5.1
<#
.SYNOPSIS
  Verify Windows Firewall allows inbound TCP on the factory server port.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File install\VERIFY-LAN-FIREWALL.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File install\VERIFY-LAN-FIREWALL.ps1 -Port 3111
#>
param(
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location -LiteralPath $RepoRoot

if ($Port -le 0) {
  $envFile = Join-Path $RepoRoot '.env'
  $Port = 3000
  if (Test-Path -LiteralPath $envFile) {
    $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $Port = [int]$m.Matches[0].Groups[1].Value }
  }
}

$ruleName = "AbaYa Track LAN TCP $Port"
$ok = $true
$LogPrefix = '[verify-lan]'

function Write-VerifyLan {
  param(
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Gray
  )
  Write-Host ($LogPrefix + ' ' + $Message) -ForegroundColor $Color
}

Write-VerifyLan "Port from .env: $Port" -Color Cyan

$ruleFound = $false
try {
  if (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) {
    $rules = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($rules) {
      $ruleFound = $true
      Write-VerifyLan "Firewall rule found: $ruleName" -Color Green
    }
  }
} catch { }

if (-not $ruleFound) {
  $netsh = netsh advfirewall firewall show rule name="$ruleName" 2>$null
  if ($LASTEXITCODE -eq 0 -and $netsh -match 'Rule Name') {
    $ruleFound = $true
    Write-VerifyLan "Firewall rule found (netsh): $ruleName" -Color Green
  }
}

if (-not $ruleFound) {
  Write-VerifyLan "FAIL: No firewall rule for TCP $Port" -Color Red
  Write-Host "         Run install\OPEN-LAN-FIREWALL-ADMIN.bat as Administrator." -ForegroundColor Yellow
  $ok = $false
}

try {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Write-VerifyLan "OK: Something is listening on TCP $Port" -Color Green
  } else {
    Write-VerifyLan "WARN: Nothing listening on TCP $Port (start install\LAUNCH-ALL.bat or PM2)" -Color Yellow
    $ok = $false
  }
} catch {
  Write-VerifyLan "WARN: Could not check listener ($($_.Exception.Message))" -Color Yellow
}

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 4 -UseBasicParsing
  if ($r.StatusCode -eq 200) {
    Write-VerifyLan "OK: GET /api/health -> $($r.StatusCode)" -Color Green
  } else {
    Write-VerifyLan "WARN: /api/health HTTP $($r.StatusCode)" -Color Yellow
  }
} catch {
  Write-VerifyLan "FAIL: /api/health - $($_.Exception.Message)" -Color Red
  $ok = $false
}

try {
  $r3 = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/state" -TimeoutSec 4 -UseBasicParsing
  Write-VerifyLan "OK: GET /api/state -> $($r3.StatusCode)" -Color Green
} catch {
  Write-VerifyLan "FAIL: /api/state - $($_.Exception.Message)" -Color Red
  $ok = $false
}

try {
  $r4 = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/state/" -TimeoutSec 4 -UseBasicParsing -MaximumRedirection 0 -ErrorAction SilentlyContinue
  if ($r4.StatusCode -eq 308 -or $r4.StatusCode -eq 301 -or $r4.StatusCode -eq 302) {
    Write-VerifyLan "OK: GET /api/state/ -> $($r4.StatusCode) (trailing slash redirect)" -Color Green
  } elseif ($r4.StatusCode -eq 200) {
    Write-VerifyLan "OK: GET /api/state/ -> 200" -Color Green
  } else {
    Write-VerifyLan "WARN: /api/state/ HTTP $($r4.StatusCode)" -Color Yellow
  }
} catch {
  $ex = $_.Exception
  if ($ex.Response -and [int]$ex.Response.StatusCode -in 301, 302, 308) {
    Write-VerifyLan "OK: GET /api/state/ -> $([int]$ex.Response.StatusCode) (trailing slash redirect)" -Color Green
  } else {
    Write-VerifyLan "WARN: /api/state/ - $($ex.Message)" -Color Yellow
  }
}

try {
  $r5 = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/tablet-ping" -TimeoutSec 4 -UseBasicParsing -Method GET
  if ($r5.StatusCode -eq 204) {
    Write-VerifyLan "OK: GET /api/tablet-ping -> 204" -Color Green
  } else {
    Write-VerifyLan "WARN: /api/tablet-ping HTTP $($r5.StatusCode)" -Color Yellow
  }
} catch {
  Write-VerifyLan "FAIL: /api/tablet-ping - $($_.Exception.Message)" -Color Red
  $ok = $false
}

try {
  $r6 = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/kiosk/state" -TimeoutSec 4 -UseBasicParsing
  if ($r6.StatusCode -eq 200) {
    Write-VerifyLan "OK: GET /api/kiosk/state -> 200" -Color Green
  } else {
    Write-VerifyLan "WARN: /api/kiosk/state HTTP $($r6.StatusCode)" -Color Yellow
  }
} catch {
  Write-VerifyLan "FAIL: /api/kiosk/state - $($_.Exception.Message)" -Color Red
  $ok = $false
}

if ($ok) {
  Write-VerifyLan 'All checks passed.' -Color Green
  exit 0
}
Write-VerifyLan 'One or more checks failed.' -Color Red
exit 1
