@echo off
:: Sets ABAYA_RUNTIME to "node" or "bun" for LAUNCH-ALL / START-* scripts.
:: Parent working directory must be the repo root (install\..).
::
:: Skip menu (Task Scheduler / automation):
::   set ABAYA_RUNTIME=node
::   set ABAYA_RUNTIME=bun
::
:: Bun is offered only when repo root has node_modules\ AND bun.exe is on PATH.

if /i "%ABAYA_RUNTIME%"=="bun" goto :eof
if /i "%ABAYA_RUNTIME%"=="node" goto :eof

set "ROOT=%~dp0.."

if not exist "%ROOT%\node_modules\" (
  set ABAYA_RUNTIME=node
  goto :eof
)

where bun >nul 2>&1
if errorlevel 1 (
  set ABAYA_RUNTIME=node
  goto :eof
)

echo.
echo Factory runtime ^(server + catalog watcher when applicable^):
echo   [N] Node.js
echo   [B] Bun    ^(needs Bun from https://bun.com/^)
choice /c NB /n /m "Press N or B: "
if errorlevel 2 (
  set ABAYA_RUNTIME=bun
  goto :eof
)
set ABAYA_RUNTIME=node
goto :eof
