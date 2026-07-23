@echo off
setlocal EnableExtensions EnableDelayedExpansion
title AbaYa Track
cd /d "%~dp0"

echo =======================================================
echo   AbaYa Track - one-click install and run
echo =======================================================
echo.

if not exist "server.js" (
  echo ERROR: server.js not found. Run START.bat from the AbaYa Track folder.
  pause
  exit /b 1
)

REM ---- 1) Ensure Node.js 18+ (use system Node if present, else private portable) ----
set "NODE_OK="
where node >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%v in ('node -v 2^>nul') do set "NRAW=%%v"
  set "NRAW=!NRAW:v=!"
  for /f "tokens=1 delims=." %%m in ("!NRAW!") do set "NMAJ=%%m"
  if !NMAJ! GEQ 18 set "NODE_OK=1"
)

if not defined NODE_OK (
  set "NODE_DIR=%CD%\.bin\node-v20.12.2-win-x64"
  if not exist "!NODE_DIR!\node.exe" (
    echo [setup] Installing a private Node.js runtime ^(~30 MB, one time^)...
    if not exist "%CD%\.bin" mkdir "%CD%\.bin"
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-x64.zip' -OutFile '%CD%\.bin\node.zip'"
    if errorlevel 1 (
      echo [ERROR] Could not download Node.js. Check the internet connection and retry.
      pause
      exit /b 1
    )
    powershell -NoProfile -Command "Expand-Archive -Path '%CD%\.bin\node.zip' -DestinationPath '%CD%\.bin' -Force"
    del /q "%CD%\.bin\node.zip"
  )
  set "PATH=!NODE_DIR!;%PATH%"
)

REM ---- 2) Install deps, register auto-start, launch server, open dashboard ----
node install\lib\bootstrap.cjs run
if errorlevel 1 (
  echo.
  echo Setup did not finish cleanly - see the messages above.
  pause
  exit /b 1
)

echo.
echo -------------------------------------------------------
echo   AbaYa Track is running and will auto-start on login.
echo   Desktop control panel (optional): AbaYa Track Launcher installer.
echo   This window can be closed.
echo -------------------------------------------------------
timeout /t 6 >nul
endlocal
