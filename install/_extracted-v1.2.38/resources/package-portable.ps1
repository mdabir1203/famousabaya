# Package the desktop launcher as a portable production .zip (no code signing).
#
# electron-builder's installer/zip targets require the winCodeSign symlink
# privilege (Developer Mode or admin). This produces a usable portable app
# WITHOUT that step: it builds the unpacked app, then zips it with PowerShell.
#
# Building win-unpacked still runs electron-builder --dir, which currently also
# needs Developer Mode on this OS. If that step fails with a symlink-privilege
# error, enable Developer Mode (Settings > System > For developers) or run this
# from an Administrator PowerShell, then re-run.
#
# Usage:  powershell -ExecutionPolicy Bypass -File install\package-portable.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'tools\desktop-launcher'
$distDir = Join-Path $root 'dist\desktop-launcher'
$unpacked = Join-Path $distDir 'win-unpacked'

Push-Location $launcher
try {
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  if (-not (Test-Path (Join-Path $launcher 'node_modules'))) {
    Write-Host '[portable] installing launcher deps...'
    corepack yarn install
  }
  Write-Host '[portable] building unpacked app (electron-builder --dir)...'
  corepack yarn electron-builder --win --dir --x64
} finally {
  Pop-Location
}

if (-not (Test-Path $unpacked)) { throw "win-unpacked not found at $unpacked" }

$version = (Get-Content (Join-Path $launcher 'package.json') | ConvertFrom-Json).version
$zip = Join-Path $distDir "AbaYa-Track-Launcher-$version-portable-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host "[portable] zipping -> $zip"
Compress-Archive -Path (Join-Path $unpacked '*') -DestinationPath $zip -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "[portable] done: $zip ($mb MB). Unzip and run 'AbaYa Track Launcher.exe'."
