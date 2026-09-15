# hotfix-v1.2.31.ps1
# Manual hot-patch for the "live active session stays after Finish" bug.
# Removes the `if (emp)` gate that was silently skipping the cloud
# pushToCloudflare('session_finish', ...) call whenever the local
# EMPLOYEES roster no longer contained the active session's emp_id
# (e.g. mid-session xlsx roster reload that reissued the barcode).
#
# Source: C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\server.js
# Bug:    server.js:2355 (req_finishWork socket handler)
#         server.js:2481 (/api/admin/close-stale-sessions admin handler)
# Fix:    server.js around those lines — make the cloud push unconditional
#         and log a warning when the local emp lookup misses.
#
# Pre-conditions:
#   - Run from an elevated PowerShell on the factory laptop
#   - PM2 is stopped (pm2 stop all)
#   - The "Pending" updater dir is cleared (see hotfix README)
#
# Post-conditions:
#   - server.js is patched in place
#   - server.js.bak is the pre-patch backup
#   - No other files touched (no env, no schema, no version bump —
#     those are bundled in the proper v1.2.31 release)

$ErrorActionPreference = 'Stop'

# 1. Locate server.js. Try the two common install locations.
$candidateRoots = @(
  "C:\Users\DELL\AppData\Local\Programs\AbaYa-Track",
  "C:\Users\DELL\Desktop\AbaYa-Track-v1.0.2",
  "C:\Program Files\AbaYa-Track",
  (Join-Path $env:LOCALAPPDATA "AbaYa-Track")
)
$serverJs = $null
foreach ($root in $candidateRoots) {
  $p = Join-Path $root "server.js"
  if (Test-Path -LiteralPath $p) { $serverJs = $p; break }
}
if (-not $serverJs) {
  Write-Error "server.js not found in any of: $($candidateRoots -join ', ')"
  exit 1
}
Write-Host "Patching: $serverJs"

# 2. Back up the pre-patch copy.
$bak = "$serverJs.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $serverJs -Destination $bak -Force
Write-Host "Backup:   $bak"

# 3. Load file as one big string.
$content = [System.IO.File]::ReadAllText($serverJs)

# 4. Patch #1: req_finishWork handler (server.js:2355-2374).
#    Replace the `if (emp) { ... pushToCloudflare('session_finish', cfPayload); }`
#    with an unconditional push. The cfPayload uses `emp ? emp.x : null` for
#    the optional enrichment fields so the Worker still accepts the payload
#    even when the local roster doesn't have the employee anymore.
$oldBlock1 = @'
    if (emp) {
      var cfPayload = {
        emp_id, emp_name: emp.name, emp_code: emp.code,
        emp_process: record.process, emp_color: emp.color, emp_initials: emp.initials,
        abaya_id: record.abaya_id, abaya_code,
        station: 'S-02',
        started_at: Math.floor(record.start / 1000),
        ended_at: Math.floor(record.end / 1000),
        duration_sec: duration_seconds,
      };
      if (record.process === 'Invoice maker') {
        cfPayload.invoice_count = record.invoice_count;
        cfPayload.invoice_serial = record.invoice_serial;
      }
      if (record.process === 'Checker') {
        cfPayload.quantity = record.quantity;
        cfPayload.checker_barcode = checker_barcode;
      }
      pushToCloudflare('session_finish', cfPayload);
    }
'@

$newBlock1 = @'
    // v1.2.31 hotfix: do NOT gate the cloud push on `if (emp)`. The local
    // ACTIVE_SESSIONS row was just deleted and the COMPLETED_LOGS entry
    // was already written. If we skip this push, refreshCloudToday
    // (every 30 s) re-merges the row from the cloud D1 and the LAN
    // dashboard shows the employee as active again — indefinitely.
    if (!emp) {
      console.warn('[req_finishWork] emp lookup missed for', emp_id,
        '- pushing session_finish without local enrichment.');
    }
    var cfPayload = {
      emp_id,
      emp_name: emp ? emp.name : null,
      emp_code: emp ? emp.code : null,
      emp_process: record.process,
      emp_color: emp ? emp.color : null,
      emp_initials: emp ? emp.initials : null,
      abaya_id: record.abaya_id,
      abaya_code,
      station: 'S-02',
      started_at: Math.floor(record.start / 1000),
      ended_at: Math.floor(record.end / 1000),
      duration_sec: duration_seconds,
    };
    if (record.process === 'Invoice maker') {
      cfPayload.invoice_count = record.invoice_count;
      cfPayload.invoice_serial = record.invoice_serial;
    }
    if (record.process === 'Checker') {
      cfPayload.quantity = record.quantity;
      cfPayload.checker_barcode = checker_barcode;
    }
    pushToCloudflare('session_finish', cfPayload);
'@

if ($content -notmatch "req_finishWork\] emp lookup missed for") {
  if ($content -match [regex]::Escape($oldBlock1)) {
    $content = $content.Replace($oldBlock1, $newBlock1)
    Write-Host "Patch #1 applied (req_finishWork)."
  } else {
    Write-Warning "Patch #1: pre-fix block not found verbatim. Already patched?"
  }
} else {
  Write-Host "Patch #1: already applied (skipping)."
}

# 5. Patch #2: /api/admin/close-stale-sessions handler (server.js:2481).
$oldBlock2 = @'
      if (emp) {
        pushToCloudflare('session_finish', {
          emp_id: emp_id,
          emp_name: emp.name,
          emp_code: emp.code,
          emp_process: sess.process,
          emp_color: emp.color,
          emp_initials: emp.initials,
          abaya_id: sess.abaya_id,
          abaya_code: abaya ? abaya.code : null,
          station: 'S-02',
          started_at: Math.floor(sess.started_at / 1000),
          ended_at: Math.floor(endMs / 1000),
          duration_sec: duration_sec,
          auto_closed: true,
        });
      }
'@

$newBlock2 = @'
      // v1.2.31 hotfix: same as req_finishWork — never gate on `if (emp)`.
      pushToCloudflare('session_finish', {
        emp_id: emp_id,
        emp_name: emp ? emp.name : null,
        emp_code: emp ? emp.code : null,
        emp_process: sess.process,
        emp_color: emp ? emp.color : null,
        emp_initials: emp ? emp.initials : null,
        abaya_id: sess.abaya_id,
        abaya_code: abaya ? abaya.code : null,
        station: 'S-02',
        started_at: Math.floor(sess.started_at / 1000),
        ended_at: Math.floor(endMs / 1000),
        duration_sec: duration_sec,
        auto_closed: true,
      });
'@

if ($content -notmatch "v1.2.31 hotfix: same as req_finishWork") {
  if ($content -match [regex]::Escape($oldBlock2)) {
    $content = $content.Replace($oldBlock2, $newBlock2)
    Write-Host "Patch #2 applied (/api/admin/close-stale-sessions)."
  } else {
    Write-Warning "Patch #2: pre-fix block not found verbatim. Already patched?"
  }
} else {
  Write-Host "Patch #2: already applied (skipping)."
}

# 6. Write back atomically (write to .tmp then move) so a crash mid-write
#    doesn't leave a half-patched server.js.
$tmp = "$serverJs.tmp"
[System.IO.File]::WriteAllText($tmp, $content)
Move-Item -LiteralPath $tmp -Destination $serverJs -Force
Write-Host "Wrote: $serverJs"

# 7. Quick sanity check — the bug marker should be gone.
$verify = [System.IO.File]::ReadAllText($serverJs)
$stillBuggy = ($verify -match "emp\) \{\s*pushToCloudflare\('session_finish'")
if ($stillBuggy) {
  Write-Error "Verification failed: server.js still contains the `if (emp) { pushToCloudflare('session_finish', ...)` gate."
  exit 1
}
Write-Host "Verified: no `if (emp)` gate around session_finish push."

# 8. Show the diff for the operator's review.
Write-Host ""
Write-Host "----- Diff vs $bak -----"
if (Get-Command diff -ErrorAction SilentlyContinue) {
  diff $bak $serverJs | Select-Object -First 60
} else {
  Write-Host "(diff command not available; open both files in a text editor to compare)"
}
Write-Host "----- end diff -----"

Write-Host ""
Write-Host "Next step: run \`pm2 reload all\` (or \`pm2 restart all\`) to pick up the new server.js."
