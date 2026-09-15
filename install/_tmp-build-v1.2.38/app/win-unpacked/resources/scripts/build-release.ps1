# Build a portable ZIP for another PC (no node_modules). Run on Windows PowerShell from repo root:
#   npm run package:release
# Output: dist/AbaYa-Track-v<version>.zip
# -Version overrides the version from the root package.json (CI passes the release version).

param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$pkg = Get-Content (Join-Path $root "package.json") | ConvertFrom-Json
$ver = if ($Version) { $Version } else { $pkg.version }
$name = "AbaYa-Track-v$ver"
$staging = Join-Path $env:TEMP $name
$distDir = Join-Path $root "dist"
$zipPath = Join-Path $distDir "$name.zip"

# Debug trace: log the resolved paths so a build failure shows what the
# script actually saw. This catches CWD-inheritance / $PSScriptRoot
# surprises on systems where a previous Move-Item has changed the shell's
# remembered location.
Write-Host "[build-release] root    = $root"
Write-Host "[build-release] staging = $staging"
Write-Host "[build-release] distDir = $distDir"
Write-Host "[build-release] zipPath = $zipPath"
Write-Host "[build-release] CWD     = $(Get-Location)"

if (Test-Path $staging) {
  Remove-Item $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# Exclude machine-local / build artifacts.
# Yarn PnP: .pnp.cjs, yarn.lock, and .yarn/cache ARE included so the client
# PC can run "yarn install --immutable" without internet access (zero-install).
# install/build state is regenerated locally and excluded to keep zip lean.
# The prebuilt Electron app and its NSIS installer are dropped too — they
# carry stale baked-in public/uploads resources and are not part of the source
# bundle. The target PC builds the installer locally with `yarn dist:win`.
#
# robocopy's /XD matches **directory names** (not relative paths with
# separators). `install-v*` therefore covers both `install-v127/` at the
# repo root AND `tools/desktop-launcher/install-v1213-build/` deeper in
# the tree. The recursive defense-in-depth sweep below catches anything
# the name-based filter misses.
#
# data/ holds per-machine runtime state and is regenerated on first
# launch on the target PC, so it never belongs in a release. The 2.7 GB
# of historical `data/sqlite-snapshots/*.db` archives was being shipped
# before this exclude was added (2026-08-31 v1.2.17 fix).
$exclude = @(
  ".git",
  "dist",
  ".cursor",
  "mcps",
  "node_modules",
  ".wrangler",
  "cloudflare\.wrangler",
  "cloudflare\.yarn",
  ".yarn\unplugged",
  "public\uploads",
  "data\desktop-launcher",
  "data\offline-dashboard-reports",
  "data\sqlite-snapshots",
  "data\lan-update-mirror",
  "data\pm2-logs",
  "install\win-unpacked",
  "install-v*"
)
$excludeFiles = @(
  ".env",
  ".env.*",
  "cloudflare\.dev.vars",
  ".yarn\install-state.gz",
  ".yarn\build-state.yml",
  "cloudflare\.yarn\install-state.gz",
  "*.log",
  "desktop.ini",
  "Thumbs.db",
  ".DS_Store"
)
$args = @($root, $staging, "/E", "/NFL", "/NDL", "/NJH", "/NJS")
foreach ($x in $exclude) {
  $args += "/XD"
  $args += $x
}
foreach ($f in $excludeFiles) {
  $args += "/XF"
  $args += $f
}
& robocopy @args | Out-Host
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

# Robocopy's /XD and /XF matching can miss nested generated folders when paths
# vary by workspace/tool package. Purge from staging before zipping as a
# fail-safe so the release archive is safe even when local caches exist.
$purgeDirs = @(
  ".wrangler",
  "cloudflare\.wrangler",
  "cloudflare\.yarn",
  ".yarn\unplugged",
  "public\uploads",
  "data\desktop-launcher",
  "data\offline-dashboard-reports",
  "data\sqlite-snapshots",
  "data\lan-update-mirror",
  "data\pm2-logs",
  "install\win-unpacked",
  "docs\design-flow-video\.yarn",
  "tools\catalog-watcher\.yarn\unplugged",
  "tools\desktop-launcher\.yarn\unplugged"
)
foreach ($dir in $purgeDirs) {
  $target = Join-Path $staging $dir
  if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
  }
}

# Defense-in-depth: even if a future robocopy /XD match slips (e.g. a build
# artifact's nested public\uploads dir that the name-only filter didn't
# catch), sweep the staging tree recursively for any directory named
# public\uploads or install-v* and drop it. The privacy + size invariant
# depends on this — see AGENTS.md "release pipeline" rule.
Get-ChildItem $staging -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'uploads' -and $_.Parent.Name -eq 'public' } |
  Remove-Item -Recurse -Force
Get-ChildItem $staging -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'install-v*' } |
  Remove-Item -Recurse -Force

Get-ChildItem $staging -Recurse -Force -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq "unplugged" -and $_.Parent.Name -eq ".yarn" } |
  Remove-Item -Recurse -Force

Get-ChildItem $staging -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -like ".env*" -or
    $_.Name -eq ".dev.vars" -or
    $_.Name -eq "install-state.gz" -or
    $_.Name -eq "build-state.yml" -or
    $_.Name -like "*.log" -or
    $_.Name -eq "desktop.ini" -or
    $_.Name -eq "Thumbs.db" -or
    $_.Name -eq ".DS_Store" -or
    $_.Name -like "AbaYa-Track-Launcher-Setup-*.exe" -or
    $_.Name -like "*.exe.blockmap" -or
    $_.Name -eq "latest.yml" -or
    # Orphan atomic-write temp files left behind by interrupted snapshot
    # updates. The active snapshot is `abaya-snapshot-latest.db`; anything
    # matching `*.db.tmp.*` is a half-written predecessor and must not
    # ship in the release ZIP.
    $_.Name -like "*.db.tmp.*"
  } |
  Remove-Item -Force

New-Item -ItemType Directory -Path $distDir -Force | Out-Null
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal

# Fail closed if a secret or generated local-state file made it into the archive.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$blockedEntryPatterns = @(
  '(^|/)\.env($|[./])',
  '(^|/)cloudflare/\.dev\.vars$',
  '(^|/)\.wrangler/',
  '(^|/)cloudflare/\.wrangler/',
  '(^|/)\.yarn/install-state\.gz$',
  '(^|/)cloudflare/\.yarn/',
  '(^|/)\.yarn/build-state\.yml$',
  '(^|/)\.yarn/unplugged/',
  '(^|/)node_modules/',
  '(^|/)public/uploads/',
  '(^|/)data/desktop-launcher/',
  '(^|/)data/offline-dashboard-reports/',
  '\.log$'
)
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $badEntries = @()
  foreach ($entry in $zip.Entries) {
    $entryName = $entry.FullName -replace '\\', '/'
    foreach ($pattern in $blockedEntryPatterns) {
      if ($entryName -match $pattern) {
        $badEntries += $entryName
        break
      }
    }
  }
  if ($badEntries.Count -gt 0) {
    throw "Release ZIP contains blocked files:`n$($badEntries -join "`n")"
  }
}
finally {
  $zip.Dispose()
}
Remove-Item $staging -Recurse -Force

Write-Host ""
Write-Host "Created: $zipPath"
Write-Host "On the other laptop: unzip, run install\INSTALL.bat, then use Desktop shortcut or install\LAUNCH-ALL.bat"
