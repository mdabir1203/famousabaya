@echo off
setlocal EnableExtensions
title AbaYa Track - Desktop launcher
cd /d "%~dp0.."

if not exist "server.js" (
  echo ERROR: server.js not found. Run from the full AbaYa Track folder.
  pause
  exit /b 1
)

if not exist ".pnp.cjs" if not exist "node_modules\" (
  echo ERROR: Dependencies missing. Run install\INSTALL.bat first.
  pause
  exit /b 1
)

if not exist "tools\desktop-launcher\package.json" (
  echo ERROR: tools\desktop-launcher not found.
  pause
  exit /b 1
)

set "CMD_YARN=yarn"
where corepack >nul 2>&1
if not errorlevel 1 set "CMD_YARN=corepack yarn"

pushd tools\desktop-launcher
if not exist ".pnp.cjs" (
  echo === First-time launcher deps tools\desktop-launcher ===
  call %CMD_YARN% install
  if errorlevel 1 (
    popd
    echo Install failed for desktop launcher.
    pause
    exit /b 1
  )
)

node -r ./.pnp.cjs -e "require('electron');require('electron/main');require('electron-updater')" >nul 2>&1
if errorlevel 1 (
  echo === Repairing launcher deps (Electron check failed) ===
  call %CMD_YARN% install
  if errorlevel 1 (
    popd
    echo Repair failed for desktop launcher dependencies.
    pause
    exit /b 1
  )
)
popd

echo.
echo === AbaYa Track - GUI launcher ===
echo   Classic terminals: install\LAUNCH-ALL.bat
echo.
%CMD_YARN% launcher
exit /b %ERRORLEVEL%
