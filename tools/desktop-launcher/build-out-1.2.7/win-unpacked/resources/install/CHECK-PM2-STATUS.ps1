# CHECK-PM2-STATUS.ps1
#
# Quick health check for the PM2-managed AbaYa Track stack.
#   * Lists pm2 processes
#   * Verifies the factory server is responding on the configured PORT
#   * Verifies cloudflared (if managed by PM2)
#   * Reports last 50 lines of the abaya-server log
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install\CHECK-PM2-STATUS.ps1

[CmdletBinding()]
param(
    [int]$LogLines = 50,
    [int]$TimeoutSec = 4
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath '..')
Set-Location -LiteralPath $RepoRoot

function Get-EnvPort {
    $envFile = Join-Path -Path $RepoRoot -ChildPath '.env'
    if (-not (Test-Path -LiteralPath $envFile)) { return 3000 }
    $line = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line) {
        return [int]$line.Matches[0].Groups[1].Value
    }
    return 3000
}

function Test-Cmd($name) {
    return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-Cmd 'pm2')) {
    Write-Host '[check] pm2 is not installed. Run install\SETUP-PM2-BOOT.ps1 first.' -ForegroundColor Red
    exit 1
}

Write-Host '[check] pm2 status:' -ForegroundColor Cyan
& pm2 jlist | ConvertFrom-Json | ForEach-Object {
    $online = $_.pm2_env.status
    $name = $_.name
    $uptime = if ($_.pm2_env.pm_uptime) { [DateTimeOffset]::FromUnixTimeMilliseconds($_.pm2_env.pm_uptime).UtcDateTime } else { $null }
    $color = if ($online -eq 'online') { 'Green' } else { 'Yellow' }
    Write-Host ("  {0,-22} {1,-8} restarts={2,-3} uptime={3}" -f $name, $online, $_.pm2_env.restart_time, $uptime) -ForegroundColor $color
}

$port = Get-EnvPort
Write-Host "[check] HTTP probe http://localhost:$port/api/state (timeout ${TimeoutSec}s)" -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$port/api/state" -TimeoutSec $TimeoutSec -UseBasicParsing
    Write-Host ("  HTTP {0}  body bytes={1}" -f $resp.StatusCode, $resp.RawContentLength) -ForegroundColor Green
} catch {
    Write-Host "  HTTP probe FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

if (Test-Cmd 'cloudflared') {
    Write-Host '[check] cloudflared on PATH; PM2 controls only the wrapper, tunnel reachability depends on Cloudflare account.' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host "[check] Last $LogLines lines of abaya-server.out.log:" -ForegroundColor Cyan
$logOut = Join-Path -Path $RepoRoot -ChildPath 'data\pm2-logs\abaya-server.out.log'
if (Test-Path -LiteralPath $logOut) {
    Get-Content -LiteralPath $logOut -Tail $LogLines
} else {
    Write-Host '  (no log file yet)' -ForegroundColor DarkGray
}

$logErr = Join-Path -Path $RepoRoot -ChildPath 'data\pm2-logs\abaya-server.err.log'
if (Test-Path -LiteralPath $logErr) {
    $errSize = (Get-Item $logErr).Length
    if ($errSize -gt 0) {
        Write-Host ''
        Write-Host '[check] Recent stderr (server):' -ForegroundColor Yellow
        Get-Content -LiteralPath $logErr -Tail $LogLines
    }
}
