# catalog-watcher diagnostic — run this in PowerShell on the client laptop
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\catalog-watcher\diag.ps1
$ErrorActionPreference = 'Continue'

$root = $PSScriptRoot
Write-Host '=== catalog-watcher diagnostic ===' -ForegroundColor Cyan
Write-Host "Root: $root"
Write-Host ''

# 1. Node version
try {
  $node = (& node --version) 2>$null
  if ($node) { Write-Host "[OK] Node: $node" -ForegroundColor Green } else { Write-Host '[FAIL] node not on PATH' -ForegroundColor Red }
} catch { Write-Host '[FAIL] node not installed' -ForegroundColor Red }

# 2. Dependencies present
$pnp = Join-Path $root '.pnp.cjs'
$nm = Join-Path $root 'node_modules'
if (Test-Path $pnp) { Write-Host "[OK] .pnp.cjs present (PnP)" -ForegroundColor Green }
elseif (Test-Path $nm) { Write-Host "[OK] node_modules present" -ForegroundColor Green }
else { Write-Host '[FAIL] neither .pnp.cjs nor node_modules found — run "yarn install" inside this folder' -ForegroundColor Red }

# 3. config.json validity
$cfgPath = Join-Path $root 'config.json'
if (-not (Test-Path $cfgPath)) {
  Write-Host "[FAIL] config.json not found at $cfgPath" -ForegroundColor Red
  Write-Host "  Copy config.example.json to config.json and edit" -ForegroundColor Yellow
} else {
  Write-Host "[OK] config.json found" -ForegroundColor Green
  try {
    $raw = Get-Content $cfgPath -Raw
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    $cfg = $raw | ConvertFrom-Json -ErrorAction Stop
    $required = @('watchDir','processedDir','workerUrl','ingestSecret')
    $missing = @($required | Where-Object { -not $cfg.$_ })
    if ($missing.Count -gt 0) {
      Write-Host ("[FAIL] config.json missing keys: " + ($missing -join ', ')) -ForegroundColor Red
    } else {
      Write-Host "[OK] config.json has all required keys" -ForegroundColor Green
    }
    Write-Host "  watchDir     = $($cfg.watchDir)"
    Write-Host "  processedDir = $($cfg.processedDir)"
    Write-Host "  workerUrl    = $($cfg.workerUrl)"
    Write-Host "  ingestSecret = $($cfg.ingestSecret.Substring(0, [Math]::Min(8,$cfg.ingestSecret.Length)))*** (len=$($cfg.ingestSecret.Length))"
  } catch {
    Write-Host "[FAIL] config.json is not valid JSON: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  Tip: C:\Users\... is INVALID in JSON (\U looks like a broken \uXXXX escape). Use forward slashes: "C:/Users/..." or double every backslash: "C:\\Users\\..."' -ForegroundColor Yellow
  }
}

# 4. watchDir / processedDir writability
foreach ($d in @('watchDir','processedDir')) {
  if ($cfg -and $cfg.$d) {
    $path = $cfg.$d
    if (Test-Path $path) {
      Write-Host "[OK] $d exists: $path" -ForegroundColor Green
      try {
        $testFile = Join-Path $path ".diag-write-test-$([Guid]::NewGuid().ToString('N').Substring(0,6))"
        'test' | Out-File -FilePath $testFile -Encoding utf8 -ErrorAction Stop
        Remove-Item $testFile -ErrorAction SilentlyContinue
        Write-Host "  [OK] $d is writable" -ForegroundColor Green
      } catch {
        Write-Host "  [FAIL] $d is NOT writable: $($_.Exception.Message)" -ForegroundColor Red
      }
    } else {
      Write-Host "[WARN] $d does not exist: $path" -ForegroundColor Yellow
      try {
        New-Item -ItemType Directory -Path $path -Force -ErrorAction Stop | Out-Null
        Write-Host "  [OK] created $d" -ForegroundColor Green
      } catch {
        Write-Host "  [FAIL] cannot create $d: $($_.Exception.Message)" -ForegroundColor Red
      }
    }
  }
}

# 5. Can we reach the worker (ingest secret validation)?
if ($cfg -and $cfg.workerUrl -and $cfg.ingestSecret) {
  Write-Host ''
  Write-Host '--- Worker reachability ---' -ForegroundColor Cyan
  try {
    $url = "$($cfg.workerUrl.TrimEnd('/'))/api/health"
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    Write-Host "[OK] $url -> $($r.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] Cannot reach $($cfg.workerUrl): $($_.Exception.Message)" -ForegroundColor Red
  }
  try {
    $putUrl = "$($cfg.workerUrl.TrimEnd('/'))/api/catalog/abayas"
    $body = '[]'
    $r = Invoke-WebRequest -Uri $putUrl -Method Put -Headers @{ 'X-Ingest-Secret' = $cfg.ingestSecret } -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    Write-Host "[OK] $putUrl (PUT, empty array) -> $($r.StatusCode)" -ForegroundColor Green
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) {
      Write-Host "[FAIL] 401 — ingestSecret does not match Worker INGEST_SECRET" -ForegroundColor Red
    } elseif ($code -eq 403) {
      Write-Host "[FAIL] 403 — Worker rejected the request (rate limit or origin)" -ForegroundColor Red
    } else {
      Write-Host "[FAIL] $putUrl (PUT) -> $code : $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}

# 6. Can we reach the employees URL?
if ($cfg -and $cfg.employeesUrl) {
  Write-Host ''
  Write-Host '--- Employees URL ---' -ForegroundColor Cyan
  try {
    $r = Invoke-WebRequest -Uri $cfg.employeesUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    Write-Host "[OK] $($cfg.employeesUrl) -> $($r.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "[WARN] Cannot reach $($cfg.employeesUrl) — folder alignment will be disabled, but watcher will still run: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

# 7. PM2 status (if available)
Write-Host ''
Write-Host '--- PM2 ---' -ForegroundColor Cyan
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2) {
  try {
    & pm2 status 2>&1 | Select-String -Pattern 'catalog-watcher|error|errored|stopped' | ForEach-Object { Write-Host "  $_" }
  } catch {
    Write-Host "  [FAIL] pm2 status failed: $($_.Exception.Message)" -ForegroundColor Red
  }
  try {
    & pm2 logs catalog-watcher --lines 30 --nostream --raw 2>&1 | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
  } catch {}
} else {
  Write-Host "  pm2 not on PATH (run install\SETUP-PM2-BOOT.ps1 once if you want PM2)" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== diagnostic complete ===' -ForegroundColor Cyan
