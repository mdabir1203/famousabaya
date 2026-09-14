param([int]$Port = 3111)

$ErrorActionPreference = 'Stop'
$ruleName = "AbaYa Track LAN ($Port)"

# Elevation check
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Run as Administrator' -ForegroundColor Yellow
  exit 1
}

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $Port `
  -Profile Private `
  -Description "AbaYa Track factory server - port $Port" | Out-Null

Write-Host "Firewall rule created for port $Port" -ForegroundColor Green
