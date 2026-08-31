#requires -Version 5.1
<#
.SYNOPSIS
    Populate the AbaYa-Track LAN update mirror with the v1.2.17 (or other) release
    assets pulled directly from GitHub Releases.

.DESCRIPTION
    Writes the NSIS installer, .blockmap, and latest.yml for a given version into
    data\lan-update-mirror\stable\ (and/or beta) so the Electron launcher's
    auto-updater finds it at /updates/<channel>/latest.yml.

    Intended for the factory laptop (Windows) when the cloud R2 feed is
    unreachable (HTTP 503) and the operator needs to push an update over LAN
    without waiting for the cloud to recover.

    The script:
      * does NOT touch .env, CF_INGEST_SECRET, GH_TOKEN, LAN_IP, or any
        roster/catalog/snapshot/offline-report
      * backs up the prior latest.yml to latest.yml.bak-pre1217 once
        (so rollback is a one-line `Move-Item`)
      * is idempotent — re-running on a mirror that's already at the target
        version is a no-op (~2 s)

.PARAMETER Version
    Release version to publish. Defaults to 1.2.17.

.PARAMETER Channel
    Channel subdirectory under data\lan-update-mirror\. One of: stable, beta.
    Defaults to stable.

.PARAMETER Root
    Override the auto-detected install root. Use this if the script can't
    find your install dir (it tries $PSScriptRoot, $PWD, %LOCALAPPDATA%\AbaYa Track\resources,
    %LOCALAPPDATA%\Programs\AbaYa Track\resources, %APPDATA%\AbaYa Track, and the two
    C:\Program Files*\AbaYa Track\resources paths in that order).

.EXAMPLE
    pwsh -File scripts\publish-lan-mirror-from-github.ps1
    # Publishes v1.2.17 to data\lan-update-mirror\stable\ in the auto-detected install.

.EXAMPLE
    pwsh -File scripts\publish-lan-mirror-from-github.ps1 -Version 1.2.18 -Channel beta
    # Future release on the beta ring.

.EXAMPLE
    # Inline paste (no .ps1 file) — same logic, copy from the README of this file.
    # See "INLINE PASTE BLOCK" section at the bottom.

.NOTES
    Author : AbaYa-Track maintainers
    Repo   : https://github.com/mdabir1203/famousabaya
    License: MIT
#>
[CmdletBinding()]
param(
    [string]$Version  = '1.2.17',
    [ValidateSet('stable','beta')]
    [string]$Channel  = 'stable',
    [string]$Root     = ''
)

$ErrorActionPreference = 'Stop'

# ── Helpers ────────────────────────────────────────────────────────────────────

function Find-InstallRoot {
    <#
    .SYNOPSIS  Locate the AbaYa-Track install dir by searching for the LAN mirror leaf.
    #>
    param([string]$Hint)
    if ($Hint) { if (Test-Path $Hint) { return (Resolve-Path $Hint).Path }; throw "Root '$Hint' not found." }
    $candidates = @(
        $PSScriptRoot
        $PWD.Path
        (Join-Path $env:LOCALAPPDATA 'AbaYa Track\resources')
        (Join-Path $env:LOCALAPPDATA 'Programs\AbaYa Track\resources')
        (Join-Path $env:APPDATA 'AbaYa Track')
        'C:\Program Files\AbaYa Track\resources'
        'C:\Program Files (x86)\AbaYa Track\resources'
    ) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($r in $candidates) {
        if (Test-Path (Join-Path $r 'data\lan-update-mirror\stable')) { return (Resolve-Path $r).Path }
    }
    throw "Couldn't locate factory install under: $($candidates -join [Environment]::NewLine + '  ')`nRun from inside the install dir, or pass -Root <path>."
}

function Invoke-FetchWithRetry {
    <#
    .SYNOPSIS  Download a URL to a file with 3 retries and exponential-ish backoff.
    #>
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$OutFile,
        [int]$TimeoutSec = 180,
        [int]$Retries    = 3
    )
    for ($i = 1; $i -le $Retries; $i++) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec $TimeoutSec
            return
        } catch {
            if ($i -eq $Retries) { throw "Failed after $Retries attempts: $Url`n  $($_.Exception.Message)" }
            $sleep = [Math]::Min(30, 2 * $i)
            Write-Host ("    [retry {0}/{1}] {2}" -f $i, $Retries, $_.Exception.Message) -ForegroundColor DarkYellow
            Start-Sleep -Seconds $sleep
        }
    }
}

function Read-YmlField {
    <#
    .SYNOPSIS  Extract a top-level (or indented) field from latest.yml via -match (?m).
    .NOTES     Returns '' if absent. Tolerates nested yaml structures.
    #>
    param([string]$Text, [string]$Field, [switch]$AsInt)
    $re = '(?m)^\s*' + [regex]::Escape($Field) + ':\s*(\S+)'
    if ($Text -match $re) {
        if ($AsInt) { return [int]$Matches[1] }
        return $Matches[1]
    }
    return ''
}

# ── Main ───────────────────────────────────────────────────────────────────────

$exeName   = "AbaYa-Track-Launcher-Setup-$Version.exe"
$blockName = "$exeName.blockmap"
$base      = "https://github.com/mdabir1203/famousabaya/releases/download/v$Version"

$root   = Find-InstallRoot -Hint $Root
$mirror = Join-Path $root "data\lan-update-mirror\$Channel"
Write-Host "[mirror] $mirror" -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $mirror | Out-Null

# Back up the prior latest.yml ONCE (so a future `Move-Item` rollback works).
# Never clobber a v1.2.17 latest.yml that the script itself just wrote.
$ymlPath = Join-Path $mirror 'latest.yml'
$ymlBak  = Join-Path $mirror 'latest.yml.bak-pre1217'
if ((Test-Path $ymlPath) -and -not (Test-Path $ymlBak)) {
    $priorVer = Read-YmlField (Get-Content $ymlPath -Raw) 'version'
    if ($priorVer -ne $Version) {
        Move-Item $ymlPath $ymlBak -Force
        Write-Host "[backup] prior latest.yml ($priorVer) -> $ymlBak" -ForegroundColor DarkGray
    } else {
        Write-Host "[note ] latest.yml is already v$Version; refreshing anyway" -ForegroundColor DarkGray
    }
}

# Always re-pull latest.yml (small + authoritative).
Write-Host "[fetch] latest.yml"
Invoke-FetchWithRetry -Url "$base/latest.yml" -OutFile $ymlPath -TimeoutSec 60

# Parse latest.yml.
$yml           = Get-Content $ymlPath -Raw
$verInYml      = Read-YmlField       $yml 'version'
$expectedSha   = Read-YmlField       $yml 'sha512'
$expectedSize  = Read-YmlField       $yml 'size'   -AsInt
if ($verInYml -ne $Version) { throw "latest.yml says version=$verInYml, expected $Version" }
if (-not $expectedSha)      { throw "Could not parse sha512 from latest.yml" }
Write-Host ("[yml  ] v{0}  size={1}  sha512={2}" -f $verInYml, $expectedSize, $expectedSha) -ForegroundColor Green

# Pull .exe + .blockmap; skip if already present + (for .exe) size matches.
foreach ($a in @($exeName, $blockName)) {
    $out = Join-Path $mirror $a
    $present = Test-Path $out
    $sizeOk  = $true
    # Only the .exe has a known-good size from latest.yml.
    if ($present -and $a -eq $exeName -and $expectedSize -gt 0) {
        $sizeOk = ((Get-Item $out).Length -eq $expectedSize)
    }
    if ($present -and $sizeOk) {
        Write-Host ("[skip ] {0}  ({1} bytes, present)" -f $a, (Get-Item $out).Length) -ForegroundColor DarkGray
        continue
    }
    Write-Host "[fetch] $a"
    Invoke-FetchWithRetry -Url "$base/$a" -OutFile $out -TimeoutSec 300
    Write-Host ("  [ok  ] {0} bytes" -f (Get-Item $out).Length) -ForegroundColor Green
}

# Defense-in-depth SHA + size check on the .exe.
$exePath     = Join-Path $mirror $exeName
$got         = [Convert]::ToBase64String(
    [System.Security.Cryptography.SHA512]::Create().ComputeHash(
        [System.IO.File]::ReadAllBytes($exePath)
    )
)
if ($got -ne $expectedSha) { throw "sha512 mismatch on $exeName`n  expected: $expectedSha`n  got:      $got" }
$actualSize = (Get-Item $exePath).Length
if ($expectedSize -gt 0 -and $actualSize -ne $expectedSize) {
    throw "size mismatch on $exeName`n  expected: $expectedSize  got: $actualSize"
}
Write-Host ("[verify] sha512 OK, size OK ({0} bytes)" -f $actualSize) -ForegroundColor Green

# Probe the local factory server to confirm the launcher can see the new feed.
$probed = $false
foreach ($port in @(3111, 3112, 3113)) {
    foreach ($h in @('localhost','127.0.0.1')) {
        try {
            $r = Invoke-WebRequest -Uri "http://${h}:${port}/updates/$Channel/latest.yml" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200 -and $r.Content -match "version: $Version") {
                Write-Host ("[probe ] http://{0}:{1}/updates/{2}/latest.yml  -> 200, v{3}" -f $h,$port,$Channel,$Version) -ForegroundColor Green
                $probed = $true; break
            }
        } catch { }
    }
    if ($probed) { break }
}
if (-not $probed) {
    Write-Host "[probe ] factory server NOT reachable on :3111-3113. Start it (or restart the launcher) before clicking 'Check Updates'." -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("Done. Mirror is now advertising v{0} on channel '{1}'. Open the launcher and click 'Check Updates'." -f $Version, $Channel) -ForegroundColor Green


<#
═══════════════════════════════════════════════════════════════════════════════
INLINE PASTE BLOCK — copy the block below into PowerShell on the factory
laptop if you don't want to copy a .ps1 file across.
═══════════════════════════════════════════════════════════════════════════════
#>

# $ErrorActionPreference = 'Stop'
# $ver = '1.2.17'
# $base = "https://github.com/mdabir1203/famousabaya/releases/download/v$ver"
# $exeName = "AbaYa-Track-Launcher-Setup-$ver.exe"
# $blockName = "$exeName.blockmap"
# $probeRoots = @($PSScriptRoot, $PWD.Path, (Join-Path $env:LOCALAPPDATA 'AbaYa Track\resources'), (Join-Path $env:LOCALAPPDATA 'Programs\AbaYa Track\resources'), (Join-Path $env:APPDATA 'AbaYa Track'), 'C:\Program Files\AbaYa Track\resources', 'C:\Program Files (x86)\AbaYa Track\resources') | Where-Object { $_ -and (Test-Path $_) }
# $root = $null
# foreach ($r in $probeRoots) { if (Test-Path (Join-Path $r 'data\lan-update-mirror\stable')) { $root = $r; break } }
# if (-not $root) { throw "Couldn't locate factory install under: $($probeRoots -join ', '). Run from inside the install dir, or set `$root manually." }
# $mirror = Join-Path $root 'data\lan-update-mirror\stable'
# Write-Host "[mirror] $mirror" -ForegroundColor Cyan
# $ymlPath = Join-Path $mirror 'latest.yml'
# $ymlBak  = Join-Path $mirror 'latest.yml.bak-pre1217'
# New-Item -ItemType Directory -Force -Path $mirror | Out-Null
# if ((Test-Path $ymlPath) -and -not (Test-Path $ymlBak)) {
#   $prior = ''
#   $ymlRaw = Get-Content $ymlPath -Raw
#   if ($ymlRaw -match '(?m)^version:\s*(\S+)') { $prior = $Matches[1] }
#   if ($prior -ne $ver) { Move-Item $ymlPath $ymlBak -Force; Write-Host "[backup] prior latest.yml ($prior) -> $ymlBak" }
#   else { Write-Host "[note ] latest.yml is already v$ver; refreshing anyway" -ForegroundColor DarkGray }
# }
# for ($i = 1; $i -le 3; $i++) { try { Invoke-WebRequest -Uri "$base/latest.yml" -OutFile $ymlPath -UseBasicParsing -TimeoutSec 60; break } catch { Write-Host "[retry $i/3] latest.yml: $($_.Exception.Message)"; if ($i -eq 3) { throw }; Start-Sleep 2 } }
# $yml = Get-Content $ymlPath -Raw
# $verInYml     = if ($yml -match '(?m)^version:\s*(\S+)')   { $Matches[1] } else { '' }
# $expectedSha  = if ($yml -match '(?m)^\s*sha512:\s*(\S+)')  { $Matches[1] } else { '' }
# $expectedSize = if ($yml -match '(?m)^\s*size:\s*(\d+)')    { [int]$Matches[1] } else { 0 }
# if ($verInYml -ne $ver) { throw "latest.yml says version=$verInYml, expected $ver" }
# if (-not $expectedSha)  { throw "Could not parse sha512 from latest.yml" }
# Write-Host "[yml ] v$verInYml  size=$expectedSize  sha512=$expectedSha" -ForegroundColor Green
# foreach ($a in @($exeName, $blockName)) {
#   $out = Join-Path $mirror $a
#   $present = Test-Path $out
#   $sizeOk = $true
#   if ($present -and $a -eq $exeName -and $expectedSize -gt 0) { $sizeOk = ((Get-Item $out).Length -eq $expectedSize) }
#   if ($present -and $sizeOk) { Write-Host "[skip] $a  ($((Get-Item $out).Length) bytes, present)" -ForegroundColor DarkGray; continue }
#   Write-Host "[fetch] $a ..."
#   for ($i = 1; $i -le 3; $i++) { try { Invoke-WebRequest -Uri "$base/$a" -OutFile $out -UseBasicParsing -TimeoutSec 300; break } catch { Write-Host "  [retry $i/3] $a : $($_.Exception.Message)"; if ($i -eq 3) { throw }; Start-Sleep 5 } }
#   Write-Host "  [ok ] $((Get-Item $out).Length) bytes" -ForegroundColor Green
# }
# $exePath = Join-Path $mirror $exeName
# $got = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash([System.IO.File]::ReadAllBytes($exePath)))
# if ($got -ne $expectedSha) { throw "sha512 mismatch on $exeName`n  expected: $expectedSha`n  got:      $got" }
# $actualSize = (Get-Item $exePath).Length
# if ($expectedSize -gt 0 -and $actualSize -ne $expectedSize) { throw "size mismatch on $exeName`n  expected: $expectedSize  got: $actualSize" }
# Write-Host "[verify] sha512 OK, size OK ($actualSize bytes)" -ForegroundColor Green
# $probed = $false
# foreach ($port in @(3111, 3112, 3113)) {
#   foreach ($h in @('localhost','127.0.0.1')) {
#     try { $r = Invoke-WebRequest -Uri "http://${h}:${port}/updates/stable/latest.yml" -UseBasicParsing -TimeoutSec 3
#       if ($r.StatusCode -eq 200 -and $r.Content -match "version: $ver") { Write-Host "[probe] http://${h}:${port}/updates/stable/latest.yml  -> 200, v$ver" -ForegroundColor Green; $probed = $true; break } } catch { }
#   }
#   if ($probed) { break }
# }
# if (-not $probed) { Write-Host "[probe] factory server NOT reachable on :3111-3113. Start the factory server (or restart the launcher) before clicking 'Check Updates'." -ForegroundColor Yellow }
# Write-Host ""
# Write-Host "Done. Mirror is now advertising v$ver. Open the launcher and click 'Check Updates'." -ForegroundColor Green
