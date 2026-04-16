@echo off
setlocal EnableExtensions
:: Used by Task Scheduler: skip if factory server already listening (avoid duplicate Node).
cd /d "%~dp0.."

set ABA_PORT=3000
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set "ABA_PORT=%%B"
  )
)

powershell -NoProfile -Command "$p=3000; try{$p=[int]([string]$env:ABA_PORT).Trim()}catch{}; if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  call "%~dp0LAUNCH-ALL.bat"
)
exit /b 0
