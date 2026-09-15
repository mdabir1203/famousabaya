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

REM Use plain `yarn` (not `corepack yarn`). Corepack crashes on this repo's
REM PnP loader (Cannot find module 'corepack/package.json'), and the
REM packageManager: yarn@4.13.0 field already pins the right Yarn version.
set "CMD_YARN=yarn"

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

REM Self-test: try to require electron from the launcher's own node_modules.
REM The launcher is a node-modules project (see tools\desktop-launcher\.yarnrc.yml),
REM so we don't need a PnP loader here. If electron is missing, repair by running
REM `yarn install` inside the launcher directory.
if not exist "node_modules\electron\dist\electron.exe" (
  echo === First-time launcher deps (Electron binary missing) ===
  call %CMD_YARN% install
  if errorlevel 1 (
    popd
    echo Install failed for desktop launcher.
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
