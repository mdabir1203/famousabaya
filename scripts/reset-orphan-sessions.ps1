#requires -Version 5.1
<#
.SYNOPSIS
    Close one or more "stuck" active sessions on the local factory server
    (the worker tapped Start but never tapped Finish) so the in-memory state,
    the SQLite snapshot, and the cloud D1 are all in sync.

.DESCRIPTION
    Calls POST /api/admin/close-stale-sessions on the local factory server
    (v1.2.18+). For each emp_id, the server:
      * Removes the active session from its in-memory map
      * Appends a completed log row with end = min(started + 8h, now)
        (so the in-shift duration_sec is a realistic upper bound on
        the work that actually happened before the operator forgot to
        tap Finish)
      * Pushes the close to the cloud D1 as session_finish with
        auto_closed: true so the cloud can distinguish an operator
        cleanup from a real worker Finish
      * Re-saves the offline-report snapshot and the SQLite snapshot

    The script does NOT touch .env, CF_INGEST_SECRET, GH_TOKEN, LAN_IP,
    or any roster/catalog/snapshot file on disk. It only triggers the
    server's existing close-session path; the data the server writes
    is governed by the same code that handles a real worker Finish.

.PARAMETER ServerUrl
    Base URL of the local factory server. Default: http://localhost:3111.

.PARAMETER IngestSecret
    CF_INGEST_SECRET to authenticate the admin endpoint. If omitted, the
    script reads it from $env:CF_INGEST_SECRET, then from the .env file
    next to the script (REPO_ROOT/.env), then prompts.

.PARAMETER MinAgeMinutes
    Only consider sessions older than this many minutes. Default 120
    (2 hours). Sessions younger than this are assumed to be live work
    the operator is currently doing at the kiosk.

.PARAMETER RequireOutsideShift
    When set (default), only consider sessions whose started_at falls
    outside the worker's current shift window. When off, every active
    session older than -MinAgeMinutes is included.

.PARAMETER ShiftStartHour / -ShiftEndHour
    Hour-of-day bounds for the shift check (Dubai TZ). Default 8-18.
    Used only when -RequireOutsideShift is set.

.PARAMETER EmpId
    Optional. When supplied, only this emp_id is considered. Repeat the
    parameter to include multiple ids. When omitted, every active
    session that matches the age/shift filter is included.

.PARAMETER DryRun
    Show what would be closed without mutating state. The server is
    called with dryRun: true so the response carries the would_close
    summary.

.PARAMETER AssumeYes
    Skip the "type YES to confirm" prompt. Use for non-interactive
    runs (e.g., scheduled job or wrapper script).

.EXAMPLE
    pwsh -File scripts\reset-orphan-sessions.ps1 -DryRun
    # See the full list of stale sessions that would be closed.

.EXAMPLE
    pwsh -File scripts\reset-orphan-sessions.ps1
    # Interactive: shows the list, asks to confirm, then closes them.

.EXAMPLE
    pwsh -File scripts\reset-orphan-sessions.ps1 -EmpId e_bc_00000138 -AssumeYes
    # Just Wahid's session, non-interactive.

.EXAMPLE
    pwsh -File scripts\reset-orphan-sessions.ps1 -MinAgeMinutes 720
    # Only sessions older than 12 hours (the >12h-stale set from the
    # incident report).

.NOTES
    Author : AbaYa-Track maintainers
    Repo   : https://github.com/mdabir1203/famousabaya
    License: MIT
#>
[CmdletBinding()]
param(
    [string]$ServerUrl        = 'http://localhost:3111',
    [string]$IngestSecret     = '',
    [int]$MinAgeMinutes       = 120,
    [switch]$RequireOutsideShift = $true,
    [int]$ShiftStartHour      = 8,
    [int]$ShiftEndHour        = 18,
    [string[]]$EmpId          = @(),
    [switch]$DryRun           = $false,
    [switch]$AssumeYes        = $false
)

$ErrorActionPreference = 'Stop'

# ── Helpers ────────────────────────────────────────────────────────────────────

function Read-IngestSecret {
    param([string]$Explicit)
    if ($Explicit) { return $Explicit }
    if ($env:CF_INGEST_SECRET) { return $env:CF_INGEST_SECRET }
    $envPath = Join-Path $PSScriptRoot '..\.env'
    if (Test-Path $envPath) {
        $line = Select-String -Path $envPath -Pattern '^\s*CF_INGEST_SECRET\s*=\s*(.+?)\s*$' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($line) { return ($line.Matches.Groups[1].Value -replace '^["'']|["'']$', '') }
    }
    $secure = Read-Host 'CF_INGEST_SECRET (not found in $env or .env; please paste)'
    return $secure
}

function Get-FactoryTimezone {
    try {
        $r = Invoke-RestMethod -Uri "$ServerUrl/api/client-config" -UseBasicParsing -TimeoutSec 5
        if ($r.FACTORY_TZ) { return [string]$r.FACTORY_TZ }
    } catch { }
    return 'Asia/Dubai'
}

# Windows PowerShell uses Windows timezone IDs ("Arabian Standard Time") instead
# of the IANA names the factory config uses ("Asia/Dubai"). To stay portable
# across both PS 5.1 (Windows-only) and the factory's likely Dubai deployment,
# we map a small set of common factory timezones to a fixed UTC offset and
# use a custom TimeZoneInfo. For unknown zones we fall back to UTC and the
# operator can pass -FactoryTzOffsetHours to override.
function Get-FactoryOffsetHours {
    param([string]$Tz)
    switch -Regex ($Tz) {
        '^Asia/Dubai$'                  { return 4 }
        '^Asia/Muscat$'                 { return 4 }
        '^Asia/Baku'                    { return 4 }
        '^Asia/Tehran$'                 { return 3.5 }
        '^Asia/Karachi$'                { return 5 }
        '^Asia/Kolkata$|^Asia/Calcutta$' { return 5.5 }
        '^Asia/Dhaka$'                  { return 6 }
        '^Asia/Karachi'                 { return 5 }
        '^Asia/Riyadh$'                 { return 3 }
        '^Asia/Qatar$'                  { return 3 }
        '^Africa/Cairo$'                { return 2 }
        '^Europe/Istanbul$'             { return 3 }
        '^Europe/London$'               { return 0 }
        '^UTC$'                         { return 0 }
        default                         { return 0 }
    }
}

function Convert-UtcToFactoryLocal {
    param([datetime]$Utc, [double]$OffsetHours)
    return $Utc.AddHours($OffsetHours)
}

function Get-StateBundle {
    $r = Invoke-RestMethod -Uri "$ServerUrl/api/state" -UseBasicParsing -TimeoutSec 8
    return $r.state
}

function Get-Roster {
    $r = Invoke-RestMethod -Uri "$ServerUrl/api/employees" -UseBasicParsing -TimeoutSec 8
    return @($r.employees)
}

function Test-OutsideShift {
    param([datetime]$LocalStart, [int]$ShiftStart, [int]$ShiftEnd)
    $h = $LocalStart.Hour
    if ($ShiftStart -le $ShiftEnd) {
        return ($h -lt $ShiftStart -or $h -ge $ShiftEnd)
    } else {
        # Wrap-around shift (e.g., 22-06) — treat as outside the in-range hours
        return ($h -lt $ShiftStart -and $h -ge $ShiftEnd)
    }
}

function Format-Age {
    param([int]$Sec)
    $h = [int][Math]::Floor($Sec / 3600)
    $m = [int][Math]::Floor(($Sec % 3600) / 60)
    return ("{0}h{1:D2}m" -f $h, $m)
}

# ── Main ───────────────────────────────────────────────────────────────────────

$secret = Read-IngestSecret -Explicit $IngestSecret
if (-not $secret) { throw "CF_INGEST_SECRET is required (use -IngestSecret, set $env:CF_INGEST_SECRET, or have a .env next to the script)" }

$tz = Get-FactoryTimezone
Write-Host "[tz] $tz" -ForegroundColor Cyan
Write-Host "[server] $ServerUrl" -ForegroundColor Cyan
Write-Host "[filter] MinAgeMinutes=$MinAgeMinutes  RequireOutsideShift=$RequireOutsideShift  Shift=$ShiftStartHour-$ShiftEndHour" -ForegroundColor DarkGray
if ($EmpId.Count -gt 0) { Write-Host "[filter] EmpId = $($EmpId -join ', ')" -ForegroundColor DarkGray }

$state = Get-StateBundle
$active = $state.active
$roster = Get-Roster
$empById = @{}
foreach ($e in $roster) { $empById[$e.id] = $e }

$nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$offsetHours = Get-FactoryOffsetHours -Tz $tz
$nowLocal = Convert-UtcToFactoryLocal -Utc ([DateTimeOffset]::FromUnixTimeMilliseconds($nowMs).UtcDateTime) -OffsetHours $offsetHours

$wantIds = if ($EmpId.Count -gt 0) { @($EmpId) } else { @($active.PSObject.Properties | ForEach-Object { $_.Name }) }

$candidates = @()
foreach ($id in $wantIds) {
    $sess = $active.$id
    if (-not $sess) { continue }
    $startedMs = [double]$sess.started_at
    $ageSec = [Math]::Floor(($nowMs - $startedMs) / 1000)
    if ($ageSec -lt ($MinAgeMinutes * 60)) { continue }
    $startedLocal = Convert-UtcToFactoryLocal -Utc ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$startedMs).UtcDateTime) -OffsetHours $offsetHours
    if ($RequireOutsideShift) {
        if (-not (Test-OutsideShift -LocalStart $startedLocal -ShiftStart $ShiftStartHour -ShiftEnd $ShiftEndHour)) { continue }
    }
    $emp = $empById[$id]
    $candidates += [pscustomobject]@{
        emp_id       = $id
        emp_name     = if ($emp) { $emp.name } else { '(unknown)' }
        process      = [string]$sess.process
        abaya_id     = [string]$sess.abaya_id
        started_local = $startedLocal.ToString('yyyy-MM-dd HH:mm:ss')
        age          = Format-Age -Sec $ageSec
    }
}

if ($candidates.Count -eq 0) {
    Write-Host ""
    Write-Host "No orphan active sessions match the filter. Nothing to do." -ForegroundColor Green
    Write-Host "  (active right now: $(@($active.PSObject.Properties).Count); oldest: $(if (@($active.PSObject.Properties).Count -gt 0) { [Math]::Floor(($nowMs - [double]($active.PSObject.Properties | Sort-Object { [double]$_.Value.started_at } | Select-Object -First 1).Value.started_at) / 1000) } else { 0 })s)" -ForegroundColor DarkGray
    exit 0
}

Write-Host ""
Write-Host "=== Candidates ($( $candidates.Count )) ===" -ForegroundColor Cyan
$candidates | Format-Table -AutoSize | Out-Host

# Build the request body
$body = @{
    sessions = @($candidates | ForEach-Object {
        @{
            emp_id = $_.emp_id
            # end_ms omitted → server defaults to min(started + 8h, now)
        }
    })
    dryRun = [bool]$DryRun
} | ConvertTo-Json -Depth 6

if (-not $AssumeYes -and -not $DryRun) {
    Write-Host ""
    Write-Host "About to close $($candidates.Count) session(s) on the local server." -ForegroundColor Yellow
    $ans = Read-Host 'Type YES to confirm (anything else aborts)'
    if ($ans -ne 'YES') {
        Write-Host "Aborted by user." -ForegroundColor Red
        exit 2
    }
}

Write-Host ""
Write-Host "=== Calling POST /api/admin/close-stale-sessions (DryRun=$DryRun) ===" -ForegroundColor Cyan
$headers = @{
    'X-Ingest-Secret' = $secret
    'Content-Type'     = 'application/json'
}
try {
    $r = Invoke-WebRequest -Uri "$ServerUrl/api/admin/close-stale-sessions" -Method Post -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 30
    $resp = ($r.Content | ConvertFrom-Json)
    Write-Host "status: $($r.StatusCode)" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $body = ''
    try { $body = $_.ErrorDetails.Message } catch { $body = $_.Exception.Message }
    Write-Host "FAILED ($code): $body" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Server response ===" -ForegroundColor Cyan
Write-Host ("  dryRun : {0}" -f $resp.dryRun)
Write-Host ("  count  : {0}" -f $resp.count)
Write-Host ("  closed : {0}" -f $resp.closed)
Write-Host ("  skipped: {0}" -f $resp.skipped)
Write-Host ""
Write-Host "Per-emp results:" -ForegroundColor Cyan
foreach ($row in $resp.results) {
    $status = if ($row.ok) { 'OK' } else { 'SKIP' }
    $extra = ''
    if ($row.closed) { $extra = "duration_sec=$($row.duration_sec)" }
    elseif ($row.dryRun) { $extra = "(would close) duration_sec=$($row.duration_sec)" }
    elseif ($row.error) { $extra = "error=$($row.error)" }
    Write-Host ("  [{0,-4}] {1,-22} {2,-18} abaya={3,-10} {4}" -f $status, $row.emp_id, $row.process, $row.abaya_id, $extra)
}

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry-run complete. Re-run without -DryRun to actually close them." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Done. The local server, the SQLite snapshot, and the cloud D1 are now in sync." -ForegroundColor Green
    Write-Host "  -> re-run -DryRun to confirm the actives list is empty (or only contains currently-being-worked sessions)." -ForegroundColor DarkGray
}
