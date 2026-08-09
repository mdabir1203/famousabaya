@echo off
setlocal
title AbaYa Dispatch (Bun)
cd /d "%~dp0"

rem ── Simplified Bun launcher for the dispatch server ────────────────────────
rem  - No Yarn PnP, no PM2. Bun runs server.js directly and auto-loads .env.
rem  - Double-click this file on the factory PC. Tablets on the SAME WiFi open
rem    the URL that prints below.
rem  - To auto-start on boot: put a shortcut to this file in
rem    shell:startup  (Win+R -> shell:startup).

rem Prefer the per-user Bun install; fall back to Bun on PATH.
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN%" set "BUN=bun"

rem Default port (override by setting DISPATCH_PORT before running).
if "%DISPATCH_PORT%"=="" set "DISPATCH_PORT=3111"

rem Show this PC's LAN IPv4 so staff know what to type on tablets.
set "LANIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do if not defined LANIP set "LANIP=%%a"
set "LANIP=%LANIP: =%"

echo ============================================================
echo   AbaYa Dispatch Server  (Bun)   port %DISPATCH_PORT%
echo.
echo   On tablets / laptops on the SAME WiFi, open:
echo      Leaderboard :  http://%LANIP%:%DISPATCH_PORT%/leaderboard
echo      Upload      :  http://%LANIP%:%DISPATCH_PORT%/upload
echo ============================================================
echo.

"%BUN%" server.js

echo.
echo Dispatch server stopped. Press any key to close.
pause >nul
