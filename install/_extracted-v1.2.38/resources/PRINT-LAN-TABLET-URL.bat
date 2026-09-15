@echo off
title AbaYa Track - Tablet LAN URLs
cd /d "%~dp0.."
call "%~dp0RUNTIME-COMMON.bat" :ReadPortFromEnv
echo.
echo =======================================================
echo  Tablet URLs (same Wi-Fi as this PC)
echo =======================================================
echo  Port from .env: %ABA_PORT%
echo.
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "IP=%%A"
  setlocal EnableDelayedExpansion
  set "IP=!IP:~1!"
  echo !IP! | findstr /r "^192\.168\. ^10\. ^172\.1[6-9]\. ^172\.2[0-9]\. ^172\.3[0-1]\." >nul
  if !errorlevel!==0 (
    echo   LAN check:  http://!IP!:%ABA_PORT%/lan-check.html
    echo   Kiosk:      http://!IP!:%ABA_PORT%/kiosk.html?reset=server
    echo   QR setup:   http://!IP!:%ABA_PORT%/setup
    echo.
  )
  endlocal
)
echo If tablets show "connection refused":
echo   1. Confirm server is running under PM2 (install\LAUNCH-ALL.bat, then pm2 status)
echo   2. Run install\OPEN-LAN-FIREWALL-ADMIN.bat as Administrator once
echo   3. Disable guest Wi-Fi / AP isolation on the router
echo   4. Reserve DHCP for this PC MAC so IP stays stable for tablets
echo   5. Open LAN diagnostics on tablet: http://PC-IP:%ABA_PORT%/lan-check.html
echo =======================================================
if /i not "%~1"=="/nopause" pause
