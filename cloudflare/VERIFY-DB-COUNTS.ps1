<#
  Verify D1 row counts before/after deploy and fail on suspicious drop.

  Usage examples:
    # Step 1 (before deploy): save baseline
    powershell -ExecutionPolicy Bypass -File cloudflare\VERIFY-DB-COUNTS.ps1 -Mode Baseline

    # Step 2 (after deploy): compare with baseline
    powershell -ExecutionPolicy Bypass -File cloudflare\VERIFY-DB-COUNTS.ps1 -Mode Compare
#>

param(
    [ValidateSet("Baseline", "Compare")]
    [string]$Mode = "Compare",
    [string]$DatabaseName = "abaya-db",
    [int]$MaxDropPercent = 40
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT_DIR = Split-Path -Parent $SCRIPT_DIR
$BASELINE_PATH = Join-Path $SCRIPT_DIR ".deploy-count-baseline.json"
$WRANGLER_RUNNER = Join-Path $ROOT_DIR "scripts\run-cloudflare-wrangler.cjs"

function Invoke-WranglerJson {
    param([string[]]$WranglerArgs)
    $raw = & node $WRANGLER_RUNNER @WranglerArgs --json 2>&1 | Out-String
    $json = $raw | ConvertFrom-Json
    return $json
}

function Get-D1Count {
    param([string]$TableName)
    $sql = "SELECT COUNT(*) AS c FROM $TableName"
    $j = Invoke-WranglerJson -WranglerArgs @("d1", "execute", $DatabaseName, "--remote", "--command", $sql)
    $resultSets = @($j.result)
    if (-not $resultSets.Count) { return 0 }
    $rows = @($resultSets[0].results)
    if (-not $rows.Count) { return 0 }
    return [int]$rows[0].c
}

function Get-Snapshot {
    $snapshot = [ordered]@{
        capturedAt = (Get-Date).ToString("o")
        database = $DatabaseName
        sessions = Get-D1Count -TableName "sessions"
        daily_stats = Get-D1Count -TableName "daily_stats"
        active_sessions = Get-D1Count -TableName "active_sessions"
        abaya_catalog = Get-D1Count -TableName "abaya_catalog"
    }
    return $snapshot
}

function Get-DropPercent {
    param([int]$Before, [int]$After)
    if ($Before -le 0) { return 0 }
    return [math]::Round((($Before - $After) * 100.0) / $Before, 2)
}

if ($Mode -eq "Baseline") {
    $base = Get-Snapshot
    $base | ConvertTo-Json -Depth 4 | Set-Content -Path $BASELINE_PATH -Encoding UTF8
    Write-Host "[OK] Baseline saved to $BASELINE_PATH"
    Write-Host ("     sessions={0}, daily_stats={1}, active_sessions={2}, abaya_catalog={3}" -f $base.sessions, $base.daily_stats, $base.active_sessions, $base.abaya_catalog)
    exit 0
}

if (-not (Test-Path $BASELINE_PATH)) {
    Write-Host "[X] Baseline not found: $BASELINE_PATH"
    Write-Host "    Run with -Mode Baseline before deploy."
    exit 1
}

$baseline = Get-Content $BASELINE_PATH -Raw | ConvertFrom-Json
$current = Get-Snapshot
$checks = @(
    @{ name = "sessions"; before = [int]$baseline.sessions; after = [int]$current.sessions },
    @{ name = "daily_stats"; before = [int]$baseline.daily_stats; after = [int]$current.daily_stats },
    @{ name = "abaya_catalog"; before = [int]$baseline.abaya_catalog; after = [int]$current.abaya_catalog }
)

$failed = $false
Write-Host "[>>] Comparing row counts (max allowed drop: $MaxDropPercent`%)"
foreach ($c in $checks) {
    $drop = Get-DropPercent -Before $c.before -After $c.after
    Write-Host ("    {0}: before={1}, after={2}, drop={3}%" -f $c.name, $c.before, $c.after, $drop)
    if ($drop -gt $MaxDropPercent) {
        Write-Host ("[X] Suspicious drop detected for {0}" -f $c.name)
        $failed = $true
    }
}

if ($failed) {
    Write-Host "[X] Verification failed. Investigate DB target and recent writes before continuing."
    exit 1
}

Write-Host "[OK] Count verification passed."
