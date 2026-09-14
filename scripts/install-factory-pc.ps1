# install-factory-pc.ps1
#
# Install (or update) AbaYa Track Launcher on a fresh factory PC.
#
# Replaces the version-pinned scripts\install-v1.2.13-factory-pc.ps1. This one
# takes a -Version parameter (default: reads the current canonical version from
# tools/desktop-launcher\package.json) so the same script works for every
# release without renaming.
#
# What it does (matches Option A from docs/runbooks/install-on-fresh-laptop.md):
#   1. Downloads the named-version NSIS installer from the Cloudflare R2 OTA feed
#      (https://dashboard.farewellabaya.com/updates/stable/), which is the same
#      feed the launcher's auto-updater probes.
#   2. Stops any running "AbaYa Track Launcher" process so NSIS can replace files.
#   3. Runs the installer in /S (silent) mode. NSIS installs to
#      C:\Program Files\AbaYa Track Launcher\ by default (the productName from
#      tools/desktop-launcher\package.json#build.productName).
#   4. Prints post-install next-actions.
#
# Why this is "easy install on any laptop":
#   - No git checkout needed on the target machine.
#   - No npm/yarn install on the target machine.
#   - Just download + run + done. ~5 min on a fresh factory PC with LAN/WAN.
#
# Usage (PowerShell as admin):
#   powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1                       # uses default version
#   powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1 -Version 1.2.38      # explicit
#   powershell -ExecutionPolicy Bypass -File .\install-factory-pc.ps1 -MirrorBase http://192.168.0.101:3111/updates/stable  # LAN mirror
#
# After install:
#   - The launcher seeds %APPDATA%\AbaYa Track\.env from the bundled
#     install\.env.production (PORT=3111, CF_WORKER_URL, CF_INGEST_SECRET).
#     env-migrate.cjs HEAL_KEYS keeps these on every subsequent update.
#   - The launcher appears in the Start Menu (and as a desktop shortcut if the
#     installer wizard wasn't suppressed).
#   - First boot will check for updates against $MirrorBase and find the
#     just-installed version (or a newer one if the LAN mirror has moved on).

[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$MirrorBase = 'https://dashboard.farewellabaya.com/updates/stable',
  [int]$TimeoutSec = 180,
  [switch]$KeepInstaller   # if set, do not delete the downloaded .exe from $env:TEMP
)

$ErrorActionPreference = 'Stop'

# --- Resolve Version if not passed -------------------------------------------
if (-not $Version) {
  $pkgPath = Join-Path $PSScriptRoot '..\tools\desktop-launcher\package.json'
  if (-not (Test-Path $pkgPath)) {
    throw "Cannot auto-detect version: $pkgPath not found. Pass -Version explicitly (e.g. -Version 1.2.38)."
  }
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  $Version = [string]$pkg.version
  if (-not $Version) { throw "tools/desktop-launcher/package.json has no version field. Pass -Version explicitly." }
}

$installerName = "AbaYa-Track-Launcher-Setup-$Version.exe"
$installerUrl  = "$MirrorBase/$installerName"
$latestYmlUrl  = "$MirrorBase/latest.yml"
$tmp           = Join-Path $env:TEMP $installerName
$productName   = 'AbaYa Track Launcher'

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host "AbaYa Track v$Version - factory install"     -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host "Mirror : $MirrorBase"
Write-Host "Source : $installerUrl"
Write-Host "Target : $env:TEMP\$installerName"
Write-Host "Install: C:\Program Files\$productName\"
Write-Host ''

# --- 1. Download installer --------------------------------------------------- --
Write-Host "[1/4] Downloading $installerName ..." -ForegroundColor Green
try {
  Invoke-WebRequest -Uri $installerUrl -OutFile $tmp -UseBasicParsing -TimeoutSec $TimeoutSec
} catch {
  throw "Download failed: $($_.Exception.Message)`n  URL: $installerUrl`n  Is the version published? Check $latestYmlUrl first."
}
$exeSize = (Get-Item $tmp).Length
Write-Host "       OK: $tmp ($([math]::Round($exeSize/1MB, 1)) MB)" -ForegroundColor Green

# --- 2. Stop any running launcher ------------------------------------------- --
Write-Host "[2/4] Stopping running launcher (if any) ..." -ForegroundColor Green
$launcherProcs = Get-Process -Name $productName -ErrorAction SilentlyContinue
if ($launcherProcs) {
  foreach ($p in $launcherProcs) {
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2
  Write-Host "       stopped $($launcherProcs.Count) launcher process(es)"
} else {
  Write-Host "       (no launcher running)"
}

# --- 3. Run silent installer ------------------------------------------------ --
Write-Host "[3/4] Running installer in silent mode ..." -ForegroundColor Green
$proc = Start-Process -FilePath $tmp -ArgumentList '/S' -PassThru -Wait
Write-Host "       installer exit code: $($proc.ExitCode)"
if ($proc.ExitCode -ne 0) {
  Write-Warning "Installer exited with code $($proc.ExitCode). Try running interactively (double-click $tmp)."
}

# --- 4. Post-install verification + cleanup --------------------------------- --
Write-Host "[4/4] Verifying install + cleaning up ..." -ForegroundColor Green
$installDir = Join-Path $env:ProgramFiles $productName
$exeInPlace = Join-Path $installDir "$productName.exe"
if (Test-Path $exeInPlace) {
  Write-Host "       OK: installed to $exeInPlace" -ForegroundColor Green
} else {
  Write-Warning "       NOT FOUND: $exeInPlace"
  Write-Warning "       NSIS may have used a non-default install path. Look in Start Menu for '$productName'."
}

if (-not $KeepInstaller) {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Write-Host "       cleaned up $tmp"
}

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host "Done. AbaYa Track v$Version is installed."   -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Next steps:'
Write-Host "  - Launch from Start Menu: '$productName'."
Write-Host "  - On first run it seeds: %APPDATA%\AbaYa Track\.env"
Write-Host "  - The launcher's Control Center will show version $Version."
Write-Host "  - For the FACTORY SERVER (the one running on 192.168.0.x:3111) also run:"
Write-Host "      node scripts\publish-lan-update-mirror.mjs --channel stable --from install"
Write-Host "    so the LAN mirror at /updates/stable/ has v$Version for OTHER laptops."
Write-Host ''