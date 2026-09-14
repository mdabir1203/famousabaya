# Allow tablets on the same Wi-Fi to reach AbaYa Track.
#
# Opens inbound TCP 3000 (factory server / kiosk / dashboard) and 3111 (dispatch
# server / leaderboard / invoice upload) on the PRIVATE network profile only.
#
# Requires Administrator (changing the firewall is a system/security setting).
# Right-click this file  ->  Run with PowerShell (as administrator), or:
#   powershell -ExecutionPolicy Bypass -File install\OPEN-LAN-FIREWALL.ps1

$ErrorActionPreference = 'Stop'
$ruleName = 'AbaYa Track LAN'
$ports = @(3000, 3111)

# Elevation check
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'This must run as Administrator.' -ForegroundColor Yellow
  Write-Host 'Right-click the file and choose "Run with PowerShell (as administrator)".'
  exit 1
}

# Idempotent: remove any prior rule of the same name, then recreate.
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $ports `
  -Profile Private `
  -Description 'AbaYa Track factory (3000) + dispatch (3111) — LAN tablets on the same Wi-Fi' | Out-Null

Write-Host ("Firewall rule '{0}' created: inbound TCP {1} on the Private profile." -f $ruleName, ($ports -join ', ')) -ForegroundColor Green
Write-Host 'Tablets can now reach http://<this-laptop-LAN-IP>:3000 and :3111.'
