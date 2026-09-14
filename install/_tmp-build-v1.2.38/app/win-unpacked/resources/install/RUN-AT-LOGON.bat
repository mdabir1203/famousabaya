@echo off
setlocal EnableExtensions
:: Used by Task Scheduler: skip if factory server already listening (avoid duplicate Node).
cd /d "%~dp0.."

call "%~dp0RUNTIME-COMMON.bat" :ReadPortFromEnv

for /f %%P in ('powershell -NoProfile -Command "$p=%ABA_PORT%; if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { 'up' } else { 'down' }"') do set "ABA_PORT_STATE=%%P"
if /i not "%ABA_PORT_STATE%"=="up" call "%~dp0LAUNCH-ALL.bat"
exit /b 0
