# AbaYa-Track -- REPAIR-UPDATER-BOOTSTRAP.ps1
#
# ONE-SHOT bypass for the electron-updater code-signature chicken-and-egg.
#
# Symptom: factory laptop is stuck on an older release (e.g. v1.2.33) where
# verifyUpdateCodeSignature was still true. electron-updater reads the
# publisherName of the new EXE and rejects any update that isn't signed by
# the original application owner. The user sees:
#
#   LAST ERROR: New version <X> is not signed by the application owner:
#   publisherName: AbaYa Track Self Signed ...
#
# and the launcher never advances past the stuck version, leaving the laptop
# permanently on v1.2.33 (or whatever release predates the v1.2.37 fix).
#
# Permanent fix path:
#   1. Run THIS script ONCE on the factory PC as Administrator.
#      It downloads the latest latest.yml directly from the cloud R2 feed,
#      parses out the EXE URL, downloads it, sanity-checks size, runs the
#      NSIS installer in silent mode, and verifies the new version post-install.
#   2. From v1.2.37 onward the bundled package.json sets
#      build.win.verifyUpdateCodeSignature: false, so electron-updater
#      accepts future updates from the self-signed cert. After the one-shot
#      bootstrap, the in-app autoupdater takes over again -- no more manual
#      steps needed.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File REPAIR-UPDATER-BOOTSTRAP.ps1
#
# Optional env knobs:
#   $env:ABAYA_CLOUD_UPDATE_BASE_URL -- defaults to https://dashboard.farewellabaya.com
#   $env:ABAYA_TARGET_VERSION        -- defaults to whatever latest.yml advertises.
#                                       Use this if you want to pin to a known-good
#                                       release (e.g. '1.2.41').
#   $env:ABAYA_DRY_RUN               -- '1' to print steps without downloading.
#
# Exit codes:
#   0  success -- new version installed and the launcher's reported version
#                changed from before to >= target.
#   2  no LAN/cloud connectivity to the configured base URL.
#   3  latest.yml missing or malformed.
#   4  EXE download failed.
#   5  EXE sanity check failed (size < 1 MB or zero bytes).
#   6  NSIS installer failed (exit code non-zero).
#   7  Post-install version check didn't move.

[CmdletBinding()]
param(
    [string]$BaseUrl = $env:ABAYA_CLOUD_UPDATE_BASE_URL,
    [string]$TargetVersion = $env:ABAYA_TARGET_VERSION,
    [switch]$DryRun = ($env:ABAYA_DRY_RUN -eq '1')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'Continue'

# ---- Config ---------------------------------------------------------
if (-not $BaseUrl) { $BaseUrl = 'https://dashboard.farewellabaya.com' }
$BaseUrl = $BaseUrl.Trim().TrimEnd('/')

$LogDir = Join-Path $env:ProgramData 'AbaYaTrack\repair-logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("repair-updater-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))

function Log($msg) {
    $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $msg
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Log "Bootstrap started (PID=$pid)."
Log "Base URL: $BaseUrl"
Log "Target version: $(if ($TargetVersion) { $TargetVersion } else { 'latest' })"
Log "Dry run: $DryRun"

# ---- Pre-flight: Admin -----------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Log "ERROR: This script must be run as Administrator (NSIS installer needs elevation)."
    Log "Right-click -> Run as Administrator, or invoke from an elevated PowerShell."
    exit 7
}

# ---- Discover currently-installed version (best effort) ------------
$launcherDir = Join-Path ${env:ProgramFiles} 'AbaYa Track Launcher'
$installedPkg = Join-Path $launcherDir 'resources\app\package.json'
$installedVersion = $null
if (Test-Path $installedPkg) {
    try {
        $j = Get-Content -Raw -Path $installedPkg | ConvertFrom-Json
        $installedVersion = $j.version
    } catch {
        Log "WARN: Could not parse installed package.json: $($_.Exception.Message)"
    }
}
Log "Installed launcher version: $(if ($installedVersion) { $installedVersion } else { 'not found' })"

# ---- Fetch latest.yml -----------------------------------------------
$latestYmlUrl = "$BaseUrl/updates/stable/latest.yml"
Log "Fetching $latestYmlUrl"
try {
    $yml = Invoke-WebRequest -Uri $latestYmlUrl -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
} catch {
    Log "ERROR: Could not reach $latestYmlUrl - $($_.Exception.Message)"
    exit 2
}
if ($yml.StatusCode -ne 200) {
    Log "ERROR: latest.yml returned HTTP $($yml.StatusCode)."
    exit 3
}
$ymlText = $yml.Content
Log "Got latest.yml: $($ymlText.Length) bytes"

# Parse latest.yml (electron-builder's GenericProvider format):
#   version: 1.2.40
#   files:
#     - url: AbaYa-Track-Launcher-Setup-1.2.40.exe
#       sha512: <base64>
#       size: 92500000
$ymlVersion = ($ymlText -split "`n" | Select-String -Pattern '^version:\s*' | Select-Object -First 1).ToString()
$ymlVersion = ($ymlVersion -replace '^version:\s*', '').Trim()
$ymlExeLine = ($ymlText -split "`n" | Select-String -Pattern '^\s+-\s+url:\s+AbaYa-Track-Launcher-Setup-' | Select-Object -First 1).ToString()
if (-not $ymlVersion -or -not $ymlExeLine) {
    Log "ERROR: latest.yml is missing version or files[].url entries. Got:"
    Log $ymlText
    exit 3
}
$exeFile = ($ymlExeLine -replace '.*url:\s*', '').Trim()
$remoteUrl = "$BaseUrl/updates/stable/$exeFile"
$remoteSize = 0
$ymlSizeLine = ($ymlText -split "`n" | Select-String -Pattern '^\s+size:\s+' | Select-Object -First 1).ToString()
if ($ymlSizeLine) {
    $remoteSize = [int64](($ymlSizeLine -replace '.*size:\s*', '').Trim())
}
$ymlShaLine = ($ymlText -split "`n" | Select-String -Pattern '^\s+sha512:\s+' | Select-Object -First 1).ToString()
$remoteSha = if ($ymlShaLine) { ($ymlShaLine -replace '.*sha512:\s*', '').Trim() } else { $null }

Log "Remote version: $ymlVersion"
Log "Remote EXE: $exeFile"
Log "Remote size: $(if ($remoteSize) { $remoteSize } else { 'unknown' }) bytes"
Log "Remote SHA-512: $(if ($remoteSha) { ($remoteSha.Substring(0, [Math]::Min(16, $remoteSha.Length)) + '...') } else { 'none' })"

if ($TargetVersion -and $ymlVersion -ne $TargetVersion) {
    Log "WARN: latest.yml advertises $ymlVersion but TargetVersion=$TargetVersion. Continuing with $ymlVersion."
    $TargetVersion = $ymlVersion
}
if (-not $TargetVersion) { $TargetVersion = $ymlVersion }

# Skip if already at or beyond target
if ($installedVersion -and $installedVersion -eq $TargetVersion) {
    Log "Already on target version $TargetVersion. Nothing to do."
    exit 0
}

# ---- Download EXE ---------------------------------------------------
$exePath = Join-Path $env:TEMP $exeFile
Log "Downloading to: $exePath"
if ($DryRun) {
    Log "DRY RUN - would download $remoteUrl here."
    exit 0
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $remoteUrl -OutFile $exePath -UseBasicParsing -TimeoutSec 600 -ErrorAction Stop
} catch {
    Log "ERROR: EXE download failed - $($_.Exception.Message)"
    exit 4
}
$localSize = (Get-Item $exePath).Length
Log "Downloaded: $localSize bytes"
if ($localSize -lt 1048576) {
    Log "ERROR: EXE is suspiciously small ($localSize bytes) - aborting."
    Remove-Item -Force $exePath -ErrorAction SilentlyContinue
    exit 5
}
if ($remoteSize -gt 0 -and $localSize -ne $remoteSize) {
    Log "ERROR: size mismatch - remote=$remoteSize local=$localSize. Aborting."
    Remove-Item -Force $exePath -ErrorAction SilentlyContinue
    exit 5
}
if ($remoteSha) {
    $localSha = (Get-FileHash -Path $exePath -Algorithm SHA512).Hash.ToLower()
    if ($localSha -ne $remoteSha.ToLower()) {
        Log "ERROR: SHA-512 mismatch - aborting install."
        Remove-Item -Force $exePath -ErrorAction SilentlyContinue
        exit 5
    }
    Log "SHA-512 verified."
}

# ---- Run the NSIS installer silently -------------------------------
# Try to gracefully close the existing launcher so NSIS can replace files.
$launcherProc = Get-Process -Name 'AbaYa Track Launcher' -ErrorAction SilentlyContinue
if ($launcherProc) {
    Log "Closing existing launcher (PID=$($launcherProc.Id))."
    try { $launcherProc | Stop-Process -Force } catch {}
    Start-Sleep -Seconds 2
}

Log "Running NSIS installer. This can take 30-60s..."
$nsis = Start-Process -FilePath $exePath -ArgumentList '/S' -PassThru -Wait
$nsisExit = $nsis.ExitCode
Log "NSIS exit code: $nsisExit"
if ($nsisExit -ne 0) {
    Log "ERROR: NSIS installer failed (exit=$nsisExit). Check Windows Event Log - Application."
    exit 6
}

# ---- Verify the new version landed ---------------------------------
$verified = $false
for ($i = 0; $i -lt 6; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $installedPkg) {
        try {
            $j = Get-Content -Raw -Path $installedPkg | ConvertFrom-Json
            Log "Post-install version ($i/5): $($j.version)"
            if ($j.version -eq $TargetVersion) { $verified = $true; break }
        } catch {
            Log "WARN: Post-install parse failed: $($_.Exception.Message)"
        }
    }
}
if (-not $verified) {
    Log "ERROR: After installation, the installed version did not advance to $TargetVersion."
    Log "Run the launcher once - it will refresh package.json on its own."
    exit 7
}

# Cleanup the downloaded EXE (NSIS copies it under %APPDATA% on its own).
try { Remove-Item -Force $exePath -ErrorAction SilentlyContinue } catch {}

Log "SUCCESS: bootstrap complete. Launcher now on v$TargetVersion."
Log "From this point onwards, the in-app autoupdater handles future updates."
exit 0
