<#
  Probes https://dashboard.farewellabaya.com/api/ceo/session with the password
  you type. Prints only status + body (never echoes the password).
  Safe to delete after use. No secrets are written to disk.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$endpoint = 'https://dashboard.farewellabaya.com/api/ceo/session'

$sec = Read-Host 'Paste the CEO password you remember (input is hidden)' -AsSecureString
if (-not $sec) { Write-Host 'No password entered.' -ForegroundColor Yellow; exit 1 }

$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)

try {
  $body = (@{ password = $plain } | ConvertTo-Json -Compress)
  $r = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -Method POST `
        -ContentType 'application/json' -Body $body -TimeoutSec 20
  Write-Host ("POST {0} -> {1}" -f $endpoint, $r.StatusCode) -ForegroundColor Green
  Write-Host ("  body: {0}" -f $r.Content)
  $setCookie = $r.Headers['Set-Cookie']
  if ($setCookie) {
    Write-Host '  Set-Cookie present (session minted).' -ForegroundColor Green
  } else {
    Write-Host '  No Set-Cookie returned.' -ForegroundColor Yellow
  }
} catch {
  $code = $null
  $msg  = $null
  try { $code = [int]$_.Exception.Response.StatusCode } catch {}
  try { $msg  = $_.Exception.Response.Content.ReadAsStringAsync().GetAwaiter().GetResult() } catch {}
  Write-Host ("POST {0} -> {1}" -f $endpoint, $code) -ForegroundColor Red
  Write-Host ("  body: {0}" -f $msg)
  if ($code -eq 401) {
    Write-Host ''
    Write-Host '401 = password did not match CEO_TOKEN in Cloudflare.' -ForegroundColor Yellow
    Write-Host 'Things to double-check:' -ForegroundColor Yellow
    Write-Host '  - Leading/trailing spaces' -ForegroundColor Yellow
    Write-Host '  - Caps Lock / Num Lock' -ForegroundColor Yellow
    Write-Host '  - Was CEO_TOKEN rotated? (old value would only work if CEO_TOKEN_PREVIOUS is also set)' -ForegroundColor Yellow
  } elseif ($code -eq 503) {
    Write-Host ''
    Write-Host '503 = Worker cannot mint a session. CEO_JWT_SECRET is missing in Cloudflare.' -ForegroundColor Yellow
    Write-Host 'Run from cloudflare\:  node ..\scripts\run-cloudflare-wrangler.cjs secret put CEO_JWT_SECRET' -ForegroundColor Yellow
  }
}
finally {
  # Best-effort scrub
  $plain = $null
  [System.GC]::Collect()
}
