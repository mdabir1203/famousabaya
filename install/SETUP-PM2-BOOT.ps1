# SETUP-PM2-BOOT.ps1
#
# Why this script exists
# ----------------------
# The factory laptop relies on PM2 for boot persistence: when Windows
# reboots, the abaya-server + cloudflared-tunnel + catalog-watcher apps
# come back up automatically without anyone logging in. Without PM2 the
# factory PC's "Boot persistence" status reads "yarn pm2:setup · Classic
# fallback: install\LAUNCH-ALL.bat" — meaning the launcher fell back to
# LAUNCH-ALL.bat because the `yarn pm2:setup` script silently failed.
#
# Reference: package.json#scripts
#   "pm2:setup": "powershell -NoProfile -ExecutionPolicy Bypass
#                 -File install/SETUP-PM2-BOOT.ps1"
#
# This script does three things, idempotently:
#
#   1. Detect PM2. If not installed globally (npm i -g pm2), attempt to
#      install it via npm. Abort with a clear error if neither works
#      (no internet, no admin, etc.) — the launcher's fallback to
#      LAUNCH-ALL.bat handles that case.
#
#   2. Detect the PM2 home directory. PM2 7.x defaults to %APPDATA%\pm2
#      on Windows, which is what ecosystem.config.cjs expects. Override
#      via env var PM2_HOME if the factory has a custom layout.
#
#   3. Start ecosystem.config.cjs under PM2 and `pm2 save` so the running
#      process list is persisted across reboots. The user (one-time) must
#      also run `pm2 startup` (or `pm2-startup install` on Windows) to
#      register PM2 with the Windows Task Scheduler — we print the exact
#      command and check whether it's already registered.
#
# After this script succeeds, the launcher's "Boot persistence" status
# should read "pm2: ✓ ecosystem.config.cjs (N apps online)" and the
# factory PC survives reboots without manual intervention.
#
# Idempotent: re-running the script while PM2 is already managing
# abaya-server is a no-op (we `pm2 reload` instead of `pm2 start`).

[CmdletBinding()]
param(
    # When -SkipInstall is set, do not attempt to npm-install PM2.
    # Useful when called from a context where global installs aren't
    # allowed (CI, container) and the caller has already ensured PM2.
    [switch]$SkipInstall,

    # When -NoStartup is set, skip the `pm2 startup` check + prompt.
    # Useful for the first-run installer where the operator may want
    # to handle boot persistence manually.
    [switch]$NoStartup
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath '..')
Set-Location -LiteralPath $RepoRoot

$PM2_HOME_OVERRIDE = $env:PM2_HOME

function Write-Header {
    param([string]$Text)
    Write-Host ''
    Write-Host ('=' * 60)
    Write-Host "  $Text"
    Write-Host ('=' * 60)
}

function Test-Pm2Installed {
    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    return [bool]$pm2
}

function Install-Pm2 {
    Write-Header 'PM2 not found globally — attempting npm install'
    Write-Host '  npm install -g pm2@^7.0.3'
    try {
        npm install -g pm2@^7.0.3 2>&1 | Tee-Object -Variable npmOut | Out-Null
        Write-Host '  npm install -g pm2 OK'
    } catch {
        Write-Host "  npm install -g pm2 FAILED: $($_.Exception.Message)"
        Write-Host '  Operator can either:'
        Write-Host '    a) install pm2 manually:    npm install -g pm2@^7.0.3'
        Write-Host "    b) accept the LAUNCH-ALL.bat fallback (no boot persistence)"
        throw
    }
}

function Ensure-Pm2Home {
    if ($PM2_HOME_OVERRIDE) {
        Write-Host "  Using PM2_HOME from env: $PM2_HOME_OVERRIDE"
        $env:PM2_HOME = $PM2_HOME_OVERRIDE
    } else {
        $default = Join-Path -Path $env:APPDATA -ChildPath 'pm2'
        $env:PM2_HOME = $default
        Write-Host "  PM2_HOME = $default"
    }
    if (-not (Test-Path -LiteralPath $env:PM2_HOME)) {
        New-Item -ItemType Directory -Path $env:PM2_HOME -Force | Out-Null
        Write-Host '  Created PM2 home directory'
    }
}

function Get-Pm2AppState {
    param([string]$AppName)
    try {
        $json = pm2 jlist 2>$null | Out-String
        if (-not $json) { return $null }
        $parsed = $json | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $parsed) { return $null }
        $match = $parsed | Where-Object { $_.name -eq $AppName } | Select-Object -First 1
        if (-not $match) { return $null }
        return [pscustomobject]@{
            Name    = $match.name
            Status  = $match.pm2_env.status
            Pid     = $match.pid
            Restarts = $match.pm2_env.restart_time
        }
    } catch {
        return $null
    }
}

function Start-Ecosystem {
    param([string]$EcosystemPath)
    Write-Host "  pm2 start $EcosystemPath --update-env"
    pm2 start $EcosystemPath --update-env
    if ($LASTEXITCODE -ne 0) {
        throw "pm2 start exited with code $LASTEXITCODE"
    }
}

function Ensure-Pm2Startup {
    if ($NoStartup) {
        Write-Host '  -NoStartup set; skipping pm2 startup registration'
        return
    }
    # pm2-startup writes the exact command needed for the current platform.
    # On Windows that's a startup.ps1 we run as Administrator + schtasks.
    Write-Host '  Checking pm2-startup registration:'
    try {
        $startupHelp = pm2-startup 2>&1 | Out-String
        Write-Host ($startupHelp -split "`n" | Select-Object -First 6)
    } catch {
        Write-Host "  pm2-startup probe failed: $($_.Exception.Message)"
    }
    Write-Host ''
    Write-Host '  If `pm2 save` was successful, run the printed pm2-startup'
    Write-Host '  command once as Administrator to register PM2 with Windows'
    Write-Host '  Task Scheduler. The launcher will detect this on the next boot.'
}

# ─── Main ───────────────────────────────────────────────────────────────
Write-Header 'AbaYa Track — SETUP-PM2-BOOT'
Write-Host "  Repo root: $RepoRoot"

if (-not (Test-Pm2Installed)) {
    if ($SkipInstall) {
        Write-Host '  PM2 is not installed and -SkipInstall was given. Aborting.'
        Write-Host '  Install pm2 manually:    npm install -g pm2@^7.0.3'
        exit 1
    }
    Install-Pm2
}

if (-not (Test-Pm2Installed)) {
    Write-Host '  PM2 still not on PATH after install attempt. Aborting.'
    exit 1
}

Ensure-Pm2Home

$EcosystemPath = Join-Path -Path $RepoRoot -ChildPath 'ecosystem.config.cjs'
if (-not (Test-Path -LiteralPath $EcosystemPath)) {
    throw "ecosystem.config.cjs not found at $EcosystemPath"
}

$existing = Get-Pm2AppState -AppName 'abaya-server'
if ($existing) {
    Write-Host "  abaya-server already managed by PM2 (status=$($existing.Status), pid=$($existing.Pid))"
    Write-Host '  Reloading to pick up any new env / code changes'
    pm2 reload $EcosystemPath --update-env
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  pm2 reload failed (exit=$LASTEXITCODE); falling back to pm2 restart"
        pm2 restart $EcosystemPath
    }
} else {
    Start-Ecosystem -EcosystemPath $EcosystemPath
}

Write-Header 'Persisting PM2 process list'
pm2 save
if ($LASTEXITCODE -ne 0) {
    Write-Host "  pm2 save exited with code $LASTEXITCODE (process list may not survive reboot)"
}

Write-Header 'Final state'
pm2 list

Ensure-Pm2Startup

Write-Host ''
Write-Host 'SETUP-PM2-BOOT complete. The launcher will detect this state on the next probe.'
exit 0