@echo off
setlocal EnableExtensions
title AbaYa Track - Tablet LAN Diagnostics
cd /d "%~dp0.."
set "APP_DIR=%CD%"

echo.
echo =======================================================
echo  Tablet LAN diagnostics (factory PC)
echo =======================================================
echo.

call "%~dp0RUNTIME-COMMON.bat" :ReadPortFromEnv

echo [1/5] PM2 / server process...
call "%APP_DIR%\install\PM2-CMD.bat" status 2>nul
if %errorlevel% neq 0 echo [WARN] PM2 status unavailable

echo.
echo [2/5] Firewall + API verify...
call "%APP_DIR%\install\VERIFY-LAN-FIREWALL.bat" /nopause 2>nul
if not exist "%APP_DIR%\install\VERIFY-LAN-FIREWALL.bat" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\install\VERIFY-LAN-FIREWALL.ps1" -Port %ABA_PORT%
)

echo.
echo [3/5] Tablet URLs for this PC...
call "%APP_DIR%\install\PRINT-LAN-TABLET-URL.bat" /nopause

echo.
echo [4/5] Recent tablet hits in debug log...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\install\CHECK-TABLET-LOG.ps1"
set "LOG_EC=%ERRORLEVEL%"

echo.
echo [5/5] Automated connectivity soak (optional)...
where yarn >nul 2>&1
if %errorlevel% equ 0 (
  set "TEST_FACTORY_URL=http://127.0.0.1:%ABA_PORT%"
  yarn test:connectivity 2>nul
) else (
  echo [SKIP] yarn not on PATH
)

echo.
if "%LOG_EC%"=="2" (
  echo [RESULT] Tablets are NOT hitting this server yet.
  echo          1. Run install\OPEN-LAN-FIREWALL-ADMIN.bat as Administrator
  echo          2. On tablet open the LAN check URL from step 3
  echo          3. Then open kiosk with ?reset=server
) else if "%LOG_EC%"=="0" (
  echo [RESULT] Tablet traffic seen in server log — if kiosk still aborts, clear Chrome cache on tablet.
) else (
  echo [RESULT] Open kiosk on tablet, then re-run this script to refresh the log check.
)
echo =======================================================
pause
