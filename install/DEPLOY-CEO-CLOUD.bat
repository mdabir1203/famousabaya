@echo off
setlocal EnableExtensions
title AbaYa Track — CEO Cloud Dashboard Deploy

echo.
echo  ====================================================
echo   AbaYa Track — CEO Cloud Dashboard Setup
echo  ====================================================
echo.
echo  This will deploy the CEO dashboard to Cloudflare so the CEO
echo  can open it from any phone or laptop, anywhere in the world.
echo.
echo  You need:
echo    - A free Cloudflare account (cloudflare.com)
echo    - Internet connection
echo    - About 5 minutes
echo.
echo  Press any key to start, or close this window to cancel.
pause >nul

:: ── Check Node.js ────────────────────────────────────────────────────────────
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo  [ERROR] Node.js is not installed.
  echo  Download and install from: https://nodejs.org  (choose LTS)
  echo  Then run this file again.
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

:: ── Run the PowerShell deployment script ─────────────────────────────────────
cd /d "%~dp0..\cloudflare"
echo.
echo  Starting deployment...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "DEPLOY.ps1"

if %errorlevel% neq 0 (
  echo.
  echo  [!] Deployment encountered an issue.
  echo  Check the output above for details.
  pause
  exit /b 1
)

pause
