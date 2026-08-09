param(
  [string]$Channel = "stable",
  [string]$Version = "",
  [switch]$SkipGitHubPublish
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Load .env file to get GH_TOKEN
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)\s*=\s*(.+)\s*$') {
      $key = $matches[1].Trim()
      $value = $matches[2].Trim().Trim('"').Trim("'")
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
  Write-Host "[INFO] Loaded .env file" -ForegroundColor Gray
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  AbaYa Track - Build & Publish" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Check for GitHub token
$ghToken = [Environment]::GetEnvironmentVariable("GH_TOKEN", "Process")
if (-not $ghToken) {
  $ghToken = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "Process")
}

if (-not $ghToken -and -not $SkipGitHubPublish) {
  Write-Host "`n⚠️  WARNING: GH_TOKEN not found!" -ForegroundColor Yellow
  Write-Host "GitHub releases will NOT be created." -ForegroundColor Yellow
  Write-Host "To enable GitHub publishing:" -ForegroundColor Yellow
  Write-Host "  1. Go to: https://github.com/settings/tokens" -ForegroundColor Gray
  Write-Host "  2. Create a token with 'repo' scope" -ForegroundColor Gray
  Write-Host "  3. Add to .env: GH_TOKEN=your_token_here" -ForegroundColor Gray
  Write-Host "`nContinuing with local build only...`n" -ForegroundColor Yellow
  $SkipGitHubPublish = $true
} else {
  Write-Host "[INFO] GitHub token found: $($ghToken.Substring(0, [Math]::Min(4, $ghToken.Length)))..." -ForegroundColor Green
}

# Read version from package.json if not provided
if (-not $Version) {
  $pkg = Get-Content (Join-Path $root "package.json") | ConvertFrom-Json
  $Version = $pkg.version
}

Write-Host "[1/6] Version: $Version" -ForegroundColor Yellow
Write-Host "[2/6] Channel: $Channel" -ForegroundColor Yellow

# Step 1: Install dependencies
Write-Host "`n[3/6] Installing dependencies..." -ForegroundColor Green
try {
  corepack yarn install --immutable
  Write-Host "✓ Dependencies installed" -ForegroundColor Green
} catch {
  Write-Warning "Yarn install failed, trying regular install..."
  corepack yarn install
}

# Step 2: Build Electron launcher installer
Write-Host "`n[4/6] Building Electron launcher installer..." -ForegroundColor Green
$launcherDir = Join-Path $root 'tools/desktop-launcher'
Push-Location $launcherDir
try {
  corepack yarn install
  if ($SkipGitHubPublish) {
    # Build without publishing to GitHub
    corepack yarn dist:win
    Write-Host "✓ Installer built (no GitHub publish)" -ForegroundColor Green
  } else {
    # Try to publish to GitHub
    try {
      corepack yarn release:gh
      Write-Host "✓ Installer built and published to GitHub" -ForegroundColor Green
    } catch {
      Write-Warning "GitHub publish failed (likely missing token). Building without publish..."
      corepack yarn dist:win
      Write-Host "✓ Installer built locally (publish to GitHub manually)" -ForegroundColor Yellow
    }
  }
} finally {
  Pop-Location
}

# Step 3: Copy to release directory
$distDir = Join-Path $root 'dist/desktop-launcher'
$releaseDir = Join-Path $root 'dist/release-client'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

if (Test-Path (Join-Path $distDir 'win-unpacked')) {
  Copy-Item (Join-Path $distDir 'win-unpacked') (Join-Path $releaseDir 'portable') -Recurse -Force
}

$installerArtifacts = Get-ChildItem $distDir -File | Where-Object { $_.Extension -in '.exe','.zip' }
foreach ($artifact in $installerArtifacts) {
  Copy-Item $artifact.FullName (Join-Path $releaseDir $artifact.Name) -Force
}

# Step 4: Publish to LAN mirror
Write-Host "`n[5/6] Publishing to LAN update mirror..." -ForegroundColor Green
try {
  node scripts/publish-lan-update-mirror.mjs --channel $Channel --from dist/desktop-launcher
  Write-Host "✓ LAN mirror updated" -ForegroundColor Green
} catch {
  Write-Warning "LAN mirror publish failed - ensure dist/desktop-launcher contains .exe and .yml files"
}

# Step 5: Verify LAN mirror contents
Write-Host "`n[6/6] Verifying LAN mirror..." -ForegroundColor Green
$mirrorDir = Join-Path $root "data/lan-update-mirror/$Channel"
if (Test-Path $mirrorDir) {
  $files = Get-ChildItem $mirrorDir -File
  if ($files.Count -gt 0) {
    Write-Host "✓ LAN mirror contains $($files.Count) files:" -ForegroundColor Green
    foreach ($f in $files) {
      Write-Host "  - $($f.Name)" -ForegroundColor Gray
    }
  } else {
    Write-Warning "LAN mirror directory is empty!"
  }
} else {
  Write-Warning "LAN mirror directory not found: $mirrorDir"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan
Write-Host "Installer location: $distDir" -ForegroundColor White
Write-Host "Release package: $releaseDir" -ForegroundColor White
Write-Host "LAN mirror: $mirrorDir" -ForegroundColor White
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Start server: node server.js (or use install/LAUNCH-ALL.bat)"
Write-Host "  2. Tablets connect to: http://192.168.0.101:3111"
Write-Host "  3. Desktop launcher will auto-update from LAN mirror"
Write-Host "  4. For GitHub fallback: add GH_TOKEN to .env`n"
