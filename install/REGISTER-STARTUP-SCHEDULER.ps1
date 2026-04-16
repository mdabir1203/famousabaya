<#
  Register Windows Task Scheduler: after user logon, run install\RUN-AT-LOGON.bat
  (starts LAUNCH-ALL only if PORT is not already listening — tunnel if configured, server, browsers).
  Safe when factory PC and CEO PC are the same: this only starts the local stack; CEO UI is the Worker.

  Run once in PowerShell (same user that will log on to Windows):
    cd install
    powershell -ExecutionPolicy Bypass -File .\REGISTER-STARTUP-SCHEDULER.ps1

  Optional:
    -DelaySeconds 90
    -TaskName "AbaYaTrack_AtLogon"
    -RepoRoot "D:\AbaYa-Track"

  Remove: .\UNREGISTER-STARTUP-SCHEDULER.ps1
#>

param(
  [int]$DelaySeconds = 60,
  [string]$TaskName = "AbaYaTrack_AtLogon",
  [string]$RepoRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Run PowerShell as Administrator once so the scheduled task can be created." -ForegroundColor Yellow
  exit 1
}

$installDir = $PSScriptRoot
if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $installDir "..")).Path
} else {
  $RepoRoot = (Resolve-Path $RepoRoot).Path
}

$runner = Join-Path $installDir "RUN-AT-LOGON.bat"
if (-not (Test-Path $runner)) {
  throw "Missing $runner"
}

# Delay lets Explorer / network settle before opening browsers and Yarn.
$arg = "/c timeout /t $DelaySeconds /nobreak >nul && call `"$runner`""
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $arg -WorkingDirectory $RepoRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$desc = "AbaYa Track: factory server + optional Cloudflare tunnel + kiosk/dashboard (logon; skips if port in use). CEO Worker is cloud — not started here."

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $desc -Force | Out-Null

Write-Host ""
Write-Host "[OK] Scheduled task registered: $TaskName" -ForegroundColor Green
Write-Host "     Runs $DelaySeconds s after logon as $env:USERNAME" -ForegroundColor Gray
Write-Host "     Working directory: $RepoRoot" -ForegroundColor Gray
Write-Host ""
Write-Host "Remove later: install\UNREGISTER-STARTUP-SCHEDULER.ps1 -TaskName $TaskName" -ForegroundColor Cyan
Write-Host ""
