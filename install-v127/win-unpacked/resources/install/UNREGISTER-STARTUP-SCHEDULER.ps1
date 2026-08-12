<#
  Remove the AbaYa logon scheduled task.
    powershell -ExecutionPolicy Bypass -File .\UNREGISTER-STARTUP-SCHEDULER.ps1
    powershell -ExecutionPolicy Bypass -File .\UNREGISTER-STARTUP-SCHEDULER.ps1 -TaskName "CustomName"
#>

param(
  [string]$TaskName = "AbaYaTrack_AtLogon"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Run PowerShell as Administrator." -ForegroundColor Yellow
  exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
Write-Host "[OK] Removed scheduled task: $TaskName" -ForegroundColor Green
