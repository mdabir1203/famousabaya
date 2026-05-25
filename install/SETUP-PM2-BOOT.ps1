# SETUP-PM2-BOOT.ps1
#
# One-time installer for PM2-based persistent boot startup of AbaYa Track.
#   1. Ensures pm2 + pm2-windows-startup are installed globally.
#   2. Registers PM2 to start at logon via pm2-windows-startup.
#   3. Loads ecosystem.config.cjs and persists the process list (`pm2 save`).
#
# Re-run is safe: it picks up changes to ecosystem.config.cjs.
#
# Usage (elevated PowerShell recommended for the one-time `pm2-startup install`):
#   powershell -NoProfile -ExecutionPolicy Bypass -File install\SETUP-PM2-BOOT.ps1
#
# Optional: pass -Update to skip startup registration (CI / headless redeploy).

[CmdletBinding()]
param(
    [switch]$Update = $false,
    [switch]$NoStartup = $false
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath '..')
Set-Location -LiteralPath $RepoRoot

function Test-Cmd($name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    return $null -ne $cmd
}

function Invoke-Tool([string]$Cmd, [string[]]$ArgList) {
    Write-Host "  > $Cmd $($ArgList -join ' ')" -ForegroundColor DarkGray
    & $Cmd @ArgList
    if ($LASTEXITCODE -ne 0) {
        throw "$Cmd exited with code $LASTEXITCODE"
    }
}

if (-not (Test-Cmd 'node')) {
    throw 'node is not on PATH. Install Node 18+ before running this script.'
}

Write-Host '[pm2-boot] node version:'
& node --version

if (-not (Test-Cmd 'pm2')) {
    Write-Host '[pm2-boot] Installing pm2 globally...' -ForegroundColor Cyan
    Invoke-Tool 'npm' @('install', '-g', 'pm2')
} else {
    Write-Host '[pm2-boot] pm2 already installed.' -ForegroundColor Green
}

if (-not $NoStartup -and -not (Test-Cmd 'pm2-startup')) {
    Write-Host '[pm2-boot] Installing pm2-windows-startup helper...' -ForegroundColor Cyan
    Invoke-Tool 'npm' @('install', '-g', 'pm2-windows-startup')
}

if (-not $NoStartup) {
    Write-Host '[pm2-boot] Registering PM2 with Windows startup (pm2-startup install)...' -ForegroundColor Cyan
    try {
        Invoke-Tool 'pm2-startup' @('install')
    } catch {
        Write-Warning "pm2-startup install failed: $($_.Exception.Message)"
        Write-Warning 'You may need to run this script from an elevated PowerShell.'
    }
}

Write-Host '[pm2-boot] Bootstrapping ecosystem.config.cjs...' -ForegroundColor Cyan
Invoke-Tool 'pm2' @('start', 'ecosystem.config.cjs', '--update-env')

Write-Host '[pm2-boot] Saving PM2 process list...' -ForegroundColor Cyan
Invoke-Tool 'pm2' @('save')

Write-Host ''
Write-Host '[pm2-boot] Done.' -ForegroundColor Green
Write-Host '  pm2 status      # show running processes'
Write-Host '  pm2 logs        # tail combined logs'
Write-Host '  pm2 logs abaya-server'
Write-Host '  pm2 restart abaya-server'
Write-Host '  pm2 reload all  # zero-downtime reload after code changes'
Write-Host ''
Write-Host 'Reboot the machine to confirm the stack auto-starts after login.'
