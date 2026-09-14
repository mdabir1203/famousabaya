#Requires -Version 5.1
<#
.SYNOPSIS
  Show recent tablet/LAN hits from debug-590497.log (non-localhost client IPs).
.EXAMPLE
  powershell -File install\CHECK-TABLET-LOG.ps1
#>
param(
  [int]$TailLines = 80
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$LogFile = Join-Path $RepoRoot 'debug-590497.log'
$LogPrefix = '[tablet-log]'

function Write-TabletLog {
  param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray)
  Write-Host ($LogPrefix + ' ' + $Message) -ForegroundColor $Color
}

if (-not (Test-Path -LiteralPath $LogFile)) {
  Write-TabletLog "No log yet: $LogFile" -Color Yellow
  Write-TabletLog 'Open kiosk on a tablet, then re-run. Server must be running (install\LAUNCH-ALL.bat).' -Color Yellow
  exit 1
}

$lines = Get-Content -LiteralPath $LogFile -Tail $TailLines -ErrorAction SilentlyContinue
if (-not $lines) {
  Write-TabletLog 'Log file is empty.' -Color Yellow
  exit 1
}

$tabletHits = @()
$localOnly = $true

foreach ($line in $lines) {
  try {
    $j = $line | ConvertFrom-Json
  } catch {
    continue
  }
  $ip = ''
  if ($j.data -and $j.data.clientIp) { $ip = [string]$j.data.clientIp }
  if (-not $ip) { continue }
  if ($ip -eq '127.0.0.1' -or $ip -eq '::1' -or $ip -eq '::ffff:127.0.0.1') { continue }
  $localOnly = $false
  $tabletHits += [pscustomobject]@{
    Time = if ($j.timestamp) { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$j.timestamp).LocalDateTime.ToString('HH:mm:ss') } else { '-' }
    Location = [string]$j.location
    Message = [string]$j.message
    ClientIp = $ip
    Android = if ($j.data.isAndroid) { $j.data.isAndroid } else { $null }
  }
}

if ($localOnly) {
  Write-TabletLog "Last $TailLines log lines have NO tablet LAN IPs (only localhost or empty)." -Color Red
  Write-TabletLog 'Tablets are not reaching this PC — fix IP, firewall (OPEN-LAN-FIREWALL-ADMIN.bat), or Wi-Fi isolation.' -Color Yellow
  exit 2
}

Write-TabletLog ('Found ' + $tabletHits.Count + ' recent tablet/LAN log entries:') -Color Green
$tabletHits | Select-Object -Last 15 | Format-Table -AutoSize
exit 0
