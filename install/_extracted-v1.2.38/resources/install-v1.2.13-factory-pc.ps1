# install-v1.2.13-factory-pc.ps1
#
# Run on the FACTORY PC (the one DESKTOP-QTOA5... you have open in AnyViewer).
# Open PowerShell on the factory PC via AnyViewer and paste this whole block.
#
# What it does:
#   1. Downloads the v1.2.13 NSIS installer from the Cloudflare R2 OTA feed
#      (which is the same feed the auto-updater checks).
#   2. Runs the installer in /S (silent) mode. The installer replaces the
#      current launcher files in the same install directory and creates a
#      desktop / start-menu shortcut if missing.
#   3. Updates the LAN update-mirror directory to v1.2.13, so the next
#      auto-update on any other factory PC picks up the new version
#      immediately.
#
# If /S doesn't work for the NSIS wizard on your machine, just delete the
# -ArgumentList "/S" line — the installer will pop up a normal wizard and
# you can click Next twice.
#
# After this finishes, start the launcher (or restart the existing one).
# The launcher will be v1.2.13.

$ErrorActionPreference = "Stop"

$base   = "https://dashboard.farewellabaya.com/updates/stable"
$tmp    = Join-Path $env:TEMP "AbaYa-Track-Launcher-Setup-1.2.13.exe"
$appDir = Join-Path $env:APPDATA "AbaYa Track"
$mirror = Join-Path $appDir "factory-data\lan-update-mirror\stable"

Write-Host "=========================================="
Write-Host "AbaYa Track v1.2.13 - factory install"
Write-Host "=========================================="
Write-Host ""

# --- Step 1: download the v1.2.13 installer from the Cloudflare OTA feed ---
Write-Host "[1/4] Downloading v1.2.13 installer from $base ..."
Invoke-WebRequest -Uri "$base/AbaYa-Track-Launcher-Setup-1.2.13.exe" `
                  -OutFile $tmp -UseBasicParsing -TimeoutSec 120
$exeSize = (Get-Item $tmp).Length
Write-Host "       OK: $tmp ($([math]::Round($exeSize/1MB,1)) MB)"

# --- Step 2: stop any running launcher so the installer can replace files ---
Write-Host "[2/4] Stopping the running launcher (if any) ..."
$launcherProcs = Get-Process -Name "AbaYa Track Launcher" -ErrorAction SilentlyContinue
if ($launcherProcs) {
  foreach ($p in $launcherProcs) {
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2
  Write-Host "       stopped $($launcherProcs.Count) launcher process(es)"
} else {
  Write-Host "       (no launcher running)"
}

# --- Step 3: run the silent installer ---
Write-Host "[3/4] Running installer in silent mode ..."
$proc = Start-Process -FilePath $tmp -ArgumentList "/S" -PassThru -Wait
Write-Host "       installer exit code: $($proc.ExitCode)"
if ($proc.ExitCode -ne 0) {
  Write-Warning "Installer exited with code $($proc.ExitCode). Try running it interactively (double-click the .exe). Continuing with mirror update."
}

# --- Step 4: refresh the LAN mirror so the next check sees v1.2.13 ---
Write-Host "[4/4] Refreshing LAN update-mirror at $mirror ..."
New-Item -ItemType Directory -Path $mirror -Force | Out-Null
# All three files: latest.yml (manifest), .exe (installer), .blockmap (delta).
# Without the .exe in the mirror, the auto-updater can't actually download
# v1.2.13 on a fresh check from another factory PC.
$mirrorFiles = @(
  "latest.yml",
  "AbaYa-Track-Launcher-Setup-1.2.13.exe",
  "AbaYa-Track-Launcher-Setup-1.2.13.exe.blockmap"
)
foreach ($name in $mirrorFiles) {
  $dest = Join-Path $mirror $name
  Write-Host "       fetching $name ..."
  Invoke-WebRequest -Uri "$base/$name" -OutFile $dest -UseBasicParsing -TimeoutSec 120
}
$ymlSize = (Get-Item (Join-Path $mirror "latest.yml")).Length
$exeSize = (Get-Item (Join-Path $mirror "AbaYa-Track-Launcher-Setup-1.2.13.exe")).Length
Write-Host "       OK: latest.yml is $ymlSize bytes, installer is $([math]::Round($exeSize/1MB,1)) MB"

Write-Host ""
Write-Host "=========================================="
Write-Host "Done. v1.2.13 is on the factory PC."
Write-Host ""
Write-Host "Next steps:"
Write-Host "  - Start the launcher (desktop shortcut or Start Menu)."
Write-Host "  - It will open at v1.2.13 and the live row will show"
Write-Host "    wall-clock build AGE + last-finished time, not 22h 0m 0s."
Write-Host "  - In the Control Center, click 'Check Updates' to confirm"
Write-Host "    the auto-updater sees v1.2.13 (it should say 'App is up to date')."
Write-Host "=========================================="
