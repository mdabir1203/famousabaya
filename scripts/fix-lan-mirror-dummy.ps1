# fix-lan-mirror-dummy.ps1
#
# What it does:
#   The factory mirror's latest.yml on the LAN server points at a file
#   (often "dummy.exe" from a smoke test) that no longer exists. The
#   electron-updater downloads the manifest, sees an "update", tries to
#   download the named EXE, and 404s. This script:
#     1. Backs up the broken latest.yml
#     2. Removes dummy.exe and other orphans
#     3. Copies the real installer + blockmap from install/
#     4. Writes the canonical latest.yml from install/latest.yml
#     5. Verifies the manifest's sha512 + size match the installer
#     6. Curls the running factory server to confirm it serves the fix
#
# Run on the client factory laptop (PowerShell 5.1 is fine):
#
#     powershell -ExecutionPolicy Bypass -File scripts\fix-lan-mirror-dummy.ps1
#
# Preview only (no changes):
#
#     powershell -ExecutionPolicy Bypass -File scripts\fix-lan-mirror-dummy.ps1 -DryRun
#
# For the beta channel:
#
#     powershell -ExecutionPolicy Bypass -File scripts\fix-lan-mirror-dummy.ps1 -Channel beta
#
# Requirements: nothing exotic. Uses built-in cmdlets only.
# Tested on: Windows PowerShell 5.1 + PowerShell 7.x.

[CmdletBinding()]
param(
    [switch] $DryRun,
    [ValidateSet('stable', 'beta')]
    [string] $Channel = 'stable'
)

$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "[fix-mirror] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[fix-mirror] OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[fix-mirror] WARN $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[fix-mirror] FAIL $msg" -ForegroundColor Red }

# --- 1. Resolve project root + key paths ------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$InstallDir = Join-Path $ProjectRoot 'install'
$MirrorDir = Join-Path $ProjectRoot ("data\lan-update-mirror\{0}" -f $Channel)
$SourceLatestYml = Join-Path $InstallDir 'latest.yml'

Step "project root  = $ProjectRoot"
Step "install dir   = $InstallDir"
Step "mirror dir    = $MirrorDir"
Step "channel       = $Channel"
if ($DryRun) { Warn "DRY-RUN: no destructive operations will run" }

# --- 2. Pre-flight: source manifest must exist -------------------------------
if (-not (Test-Path $SourceLatestYml)) {
    Fail "canonical manifest not found at $SourceLatestYml"
    Fail "build the installer first: cd tools\desktop-launcher && yarn release:gh"
    exit 2
}

# --- 3. Make sure the mirror dir exists ---------------------------------------
if (-not (Test-Path $MirrorDir)) {
    if ($DryRun) { Step "(dry-run) would create $MirrorDir" }
    else {
        New-Item -ItemType Directory -Path $MirrorDir -Force | Out-Null
        Ok "created $MirrorDir"
    }
}

# --- 4. Read the canonical manifest -----------------------------------------
$manifestText = Get-Content -Raw -Path $SourceLatestYml
$ver = if ($manifestText -match '(?m)^[ \t]*version:\s*(\S+)') { $Matches[1] } else { '' }
$installer = if ($manifestText -match '(?m)^[ \t]*path:\s*(\S+)') { $Matches[1] } else { '' }
$sha = if ($manifestText -match '(?m)^[ \t]*sha512:\s*(\S+)') { $Matches[1] } else { '' }
$size = if ($manifestText -match '(?m)^[ \t]*size:\s*(\d+)') { [int64]$Matches[1] } else { 0 }

if (-not $ver -or -not $installer -or -not $sha -or -not $size) {
    Fail "manifest is malformed: version=$ver installer=$installer sha=$sha size=$size"
    exit 2
}
Ok "manifest says: version=$ver, installer=$installer, size=$size"

# --- 5. Verify the canonical installer + blockmap exist + sha matches --------
$SourceExe = Join-Path $InstallDir $installer
$SourceBlockmap = "$SourceExe.blockmap"
if (-not (Test-Path $SourceExe)) {
    Fail "canonical installer missing: $SourceExe"
    exit 2
}
if (-not (Test-Path $SourceBlockmap)) {
    Warn "blockmap missing at $SourceBlockmap (differential updates will fall back to full download)"
}

$actualSize = (Get-Item $SourceExe).Length
$hex = (Get-FileHash -Path $SourceExe -Algorithm SHA512).Hash.ToLower()
$bytes = New-Object 'byte[]' ($hex.Length / 2)
for ($i = 0; $i -lt $hex.Length; $i += 2) {
    $bytes[$i / 2] = [Convert]::ToByte($hex.Substring($i, 2), 16)
}
$actualB64 = [Convert]::ToBase64String($bytes)
if ($actualSize -ne $size) {
    Fail "manifest size=$size but installer is $actualSize bytes -- re-run electron-builder to regenerate latest.yml"
    exit 2
}
if ($actualB64 -ne $sha) {
    Fail "manifest sha=$sha but installer's sha512 (base64) = $actualB64 -- re-run electron-builder to regenerate latest.yml"
    exit 2
}
Ok "sha512 + size match canonical installer"

# --- 6. Back up the broken mirror state --------------------------------------
$Timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$BadLatestYml = Join-Path $MirrorDir 'latest.yml'
if (Test-Path $BadLatestYml) {
    $curManifest = Get-Content -Raw -Path $BadLatestYml
    $curInstaller = if ($curManifest -match '(?m)^path:\s*(\S+)') { $Matches[1] } else { '' }
    if ($curManifest -ne $manifestText) {
        $backup = Join-Path $MirrorDir ("latest.yml.broken-{0}" -f $Timestamp)
        if ($DryRun) {
            Warn "(dry-run) would back up $BadLatestYml -> $backup"
        } else {
            Copy-Item -Path $BadLatestYml -Destination $backup -Force
            Ok "backed up $BadLatestYml -> $backup"
        }
    } else {
        Ok "existing latest.yml already matches canonical (no backup needed)"
    }
}

# --- 7. Remove orphaned files the manifest does not reference ----------------
# Only the installer + its blockmap + latest.yml are valid. Anything else
# (dummy.exe, stale smoke-test manifests, leaked Setup-1.2.X.exe from a prior
# version that the new manifest no longer references) is moved aside, not
# deleted, so the operator can audit later.
$Allowed = @(
    (Split-Path -Leaf $SourceExe),
    (Split-Path -Leaf $SourceBlockmap),
    'latest.yml',
    '.gitkeep'
)
Get-ChildItem -Path $MirrorDir -File -Force | ForEach-Object {
    if ($Allowed -notcontains $_.Name) {
        $stash = Join-Path $MirrorDir ("orphan-{0}-{1}" -f $Timestamp, $_.Name)
        if ($DryRun) {
            Warn "(dry-run) would stash orphan $($_.Name) -> $stash"
        } else {
            Move-Item -Path $_.FullName -Destination $stash -Force
            Ok "stashed orphan $($_.Name) -> $stash"
        }
    }
}

# --- 8. Write the new manifest ----------------------------------------------
$DestLatestYml = Join-Path $MirrorDir 'latest.yml'
if ($DryRun) {
    Step "(dry-run) would write manifest to $DestLatestYml"
} else {
    Copy-Item -Path $SourceLatestYml -Destination $DestLatestYml -Force
    Ok "wrote manifest to $DestLatestYml"
}

# --- 9. Copy the installer + blockmap ---------------------------------------
$DestExe = Join-Path $MirrorDir $installer
if ($DryRun) {
    Step "(dry-run) would copy $SourceExe -> $DestExe"
} else {
    Copy-Item -Path $SourceExe -Destination $DestExe -Force
    Ok "copied installer to $DestExe"
}
if (Test-Path $SourceBlockmap) {
    $DestBlockmap = Join-Path $MirrorDir (Split-Path -Leaf $SourceBlockmap)
    if ($DryRun) {
        Step "(dry-run) would copy $SourceBlockmap -> $DestBlockmap"
    } else {
        Copy-Item -Path $SourceBlockmap -Destination $DestBlockmap -Force
        Ok "copied blockmap to $DestBlockmap"
    }
}

# --- 10. Re-verify on disk ---------------------------------------------------
$OnDiskExe = Join-Path $MirrorDir $installer
$OnDiskSize = (Get-Item $OnDiskExe).Length
$OnDiskHex = (Get-FileHash -Path $OnDiskExe -Algorithm SHA512).Hash.ToLower()
$OnDiskBytes = New-Object 'byte[]' ($OnDiskHex.Length / 2)
for ($i = 0; $i -lt $OnDiskHex.Length; $i += 2) {
    $OnDiskBytes[$i / 2] = [Convert]::ToByte($OnDiskHex.Substring($i, 2), 16)
}
$OnDiskHashB64 = [Convert]::ToBase64String($OnDiskBytes)
if ($OnDiskSize -ne $size -or $OnDiskHashB64 -ne $sha) {
    Fail "post-copy verification FAILED for $OnDiskExe (size=$OnDiskSize sha=$OnDiskHashB64)"
    exit 2
}
Ok "post-copy verification OK"

# --- 11. Hit the running factory server's mirror URL -------------------------
$Port = 3111
$envMap = @{}
if (Test-Path (Join-Path $ProjectRoot '.env')) {
    Get-Content (Join-Path $ProjectRoot '.env') | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line -match '^([^=]+)=(.*)$') {
            $envMap[$Matches[1]] = $Matches[2]
        }
    }
}
if ($envMap.ContainsKey('PORT')) { $Port = [int]$envMap['PORT'] }
$Urls = @(
    "http://127.0.0.1:$Port/updates/$Channel/latest.yml",
    "http://localhost:$Port/updates/$Channel/latest.yml"
)
if ($envMap.ContainsKey('ABAYA_UPDATE_MIRROR_BASE_URL')) {
    $base = $envMap['ABAYA_UPDATE_MIRROR_BASE_URL'].TrimEnd('/')
    $Urls += "$base/latest.yml"
}
$Checked = $false
foreach ($u in $Urls) {
    try {
        $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 6 -ErrorAction Stop
        if ($r.StatusCode -eq 200 -and $r.Content -match "version: $ver") {
            Ok "factory server at $u serves the new manifest (version $ver)"
            $Checked = $true
            break
        } else {
            Warn "factory server at $u returned $($r.StatusCode); manifest body did not contain 'version: $ver'"
        }
    } catch {
        # try the next URL
    }
}
if (-not $Checked) {
    Warn "could not reach the factory server on any of: $($Urls -join ', ')"
    Warn "the mirror files are fixed on disk; the static /updates route picks them up without a server restart"
}

# --- 12. Done ---------------------------------------------------------------
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Mirror fix complete ($Channel, v$ver)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: in the launcher, click 'Check Updates' (or wait up to 6h for the scheduled check)."
Write-Host "It should now find v$ver and download the real installer."
Write-Host ""
Write-Host "Backups / orphans are in: $MirrorDir"
Get-ChildItem -Path $MirrorDir -Filter "*.broken-*" -ErrorAction SilentlyContinue | Select-Object Name | ForEach-Object { Write-Host "  backup: $($_.Name)" }
Get-ChildItem -Path $MirrorDir -Filter "orphan-*" -ErrorAction SilentlyContinue | Select-Object Name | ForEach-Object { Write-Host "  orphan: $($_.Name)" }
