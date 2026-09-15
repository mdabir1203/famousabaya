$ErrorActionPreference = 'Stop'
$pass = 0
$fail = 0
for ($i = 1; $i -le 3; $i++) {
    $out = & npm test --silent 2>&1
    $lines = $out -split "`n"
    $last = ($lines | Select-Object -Last 12) -join "`n"
    if ($last -match 'fail 0') {
        $pass++
        Write-Host "Run $i : PASS"
    } else {
        $fail++
        Write-Host "Run $i : FAIL"
    }
}
Write-Host "Pass=$pass Fail=$fail"
