# Build a portable ZIP for another PC (no node_modules). Run on Windows PowerShell from repo root:
#   npm run package:release
# Output: dist/AbaYa-Track-v<version>.zip

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$pkg = Get-Content (Join-Path $root "package.json") | ConvertFrom-Json
$ver = $pkg.version
$name = "AbaYa-Track-v$ver"
$staging = Join-Path $env:TEMP $name
$distDir = Join-Path $root "dist"
$zipPath = Join-Path $distDir "$name.zip"

if (Test-Path $staging) {
  Remove-Item $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# Exclude machine-local / build artefacts.
# Yarn PnP: .pnp.cjs, yarn.lock, and .yarn/cache ARE included so the client
# PC can run "yarn install --immutable" without internet access (zero-install).
# .yarn/install-state.gz is regenerated locally and excluded to keep zip lean.
$exclude = @(".git", "dist", ".cursor", "mcps", "node_modules")
$excludeFiles = @(".yarn\install-state.gz")
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

New-Item -ItemType Directory -Path $distDir -Force | Out-Null
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force

Write-Host ""
Write-Host "Created: $zipPath"
Write-Host "On the other laptop: unzip, then run install\INSTALL.bat"
