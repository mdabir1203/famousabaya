$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$launcherDir = Join-Path $root 'tools/desktop-launcher'
$distDir = Join-Path $root 'dist/desktop-launcher'
$releaseDir = Join-Path $root 'dist/release-client'
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

Push-Location $launcherDir
try {
  Write-Host '[installer] Installing launcher dependencies...'
  corepack yarn install
  Write-Host '[installer] Building Windows NSIS installer...'
  try {
    corepack yarn dist:win
  } catch {
    Write-Warning '[installer] NSIS packaging failed on this host; falling back to the portable zip build.'
    Push-Location $root
    try {
      & powershell -NoProfile -ExecutionPolicy Bypass -File install/package-portable.ps1
    } finally {
      Pop-Location
    }
  }
} finally {
  Pop-Location
}

if (Test-Path (Join-Path $distDir 'win-unpacked')) {
  Copy-Item (Join-Path $distDir 'win-unpacked') (Join-Path $releaseDir 'portable') -Recurse -Force
}
$installerArtifacts = Get-ChildItem $distDir -File | Where-Object { $_.Extension -in '.exe','.zip' }
foreach ($artifact in $installerArtifacts) {
  Copy-Item $artifact.FullName (Join-Path $releaseDir $artifact.Name) -Force
}
Write-Host '[installer] Done. Output is under dist/desktop-launcher/ and dist/release-client/'
