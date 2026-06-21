# HARDEN-SNAPSHOT-DIR.ps1
#
# One-time NTFS hardening for the SQLite snapshot directory so that ordinary
# (non-administrator) employee accounts cannot delete or modify the .db files
# or manifest.jsonl. Combined with the HMAC chain written by the server this
# gives both prevention (ACLs) and detection (signed manifest).
#
# Realistic threat model:
#   - Standard / kiosk users:       BLOCKED from delete/modify (ACLs)
#   - Service / server account:     allowed to write/rename/delete archives
#   - Administrators:                can override ACLs but tampering is detected
#                                    by `yarn snapshot:verify`
#
# Usage (run from an elevated PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File install\HARDEN-SNAPSHOT-DIR.ps1 `
#       -Path "C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\data\sqlite-snapshots" `
#       -ServiceAccount "$env:USERDOMAIN\$env:USERNAME"
#
# Skip ServiceAccount to default to the current user (simplest single-user setup).

[CmdletBinding()]
param(
    [string]$Path = (Join-Path -Path $PSScriptRoot -ChildPath '..\data\sqlite-snapshots'),
    [string]$ServiceAccount = "$env:USERDOMAIN\$env:USERNAME",
    [switch]$AllowReaders = $false
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must be run from an elevated (Administrator) PowerShell.'
    }
}

function Resolve-FullPath([string]$P) {
    if (-not (Test-Path -LiteralPath $P)) {
        New-Item -ItemType Directory -Path $P -Force | Out-Null
    }
    return (Resolve-Path -LiteralPath $P).Path
}

Assert-Admin
$full = Resolve-FullPath -P $Path
Write-Host "[harden] Snapshot directory: $full" -ForegroundColor Cyan
Write-Host "[harden] Service / write account: $ServiceAccount" -ForegroundColor Cyan

# 1. Disable inheritance and remove inherited ACEs.
& icacls $full /inheritance:r | Out-Null

# 2. Grant the absolute minimum needed for the snapshot writer to run.
& icacls $full /grant:r 'NT AUTHORITY\SYSTEM:(OI)(CI)F' | Out-Null
& icacls $full /grant:r 'BUILTIN\Administrators:(OI)(CI)F' | Out-Null
& icacls $full /grant:r "${ServiceAccount}:(OI)(CI)M" | Out-Null

# 3. Optionally allow read-only browsing for ordinary users (dashboards/exports).
if ($AllowReaders) {
    & icacls $full /grant:r 'BUILTIN\Users:(OI)(CI)RX' | Out-Null
    Write-Host '[harden] Granted read-only access to BUILTIN\Users.' -ForegroundColor Yellow
}

# 4. Deny delete/modify to anyone outside the explicit grants.
& icacls $full /deny "BUILTIN\Users:(OI)(CI)(DE,WDAC,WO,WD,AD,DC)" 2>$null | Out-Null

# 5. Lock existing files as read-only so accidental deletes prompt elevation.
Get-ChildItem -LiteralPath $full -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Set-ItemProperty -LiteralPath $_.FullName -Name IsReadOnly -Value $true -ErrorAction Stop } catch {}
}

Write-Host '[harden] Effective ACLs:' -ForegroundColor Green
& icacls $full

Write-Host ''
Write-Host '[harden] Done. Reminders:' -ForegroundColor Green
Write-Host '  * Run the AbaYa server under the service account above (or admin).'
Write-Host '  * Set SNAPSHOT_SIGNING_SECRET in .env (>= 16 chars) so manifest is signed.'
Write-Host '  * Run `yarn snapshot:verify` periodically (or in a scheduled task).'
