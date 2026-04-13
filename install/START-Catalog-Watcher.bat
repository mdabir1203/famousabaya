@echo off
setlocal EnableExtensions
cd /d "%~dp0..\tools\catalog-watcher"
if not exist "watch-catalog.js" (
  echo ERROR: catalog-watcher not found. Use the full AbaYa Track package.
  pause
  exit /b 1
)
if not exist ".pnp.cjs" (
  echo Dependencies not installed. Run install\INSTALL.bat first.
  pause
  exit /b 1
)
if not exist "config.json" (
  echo Copy config.example.json to config.json and edit paths and workerUrl / ingestSecret.
  echo See docs\OFFICE_LAPTOP.md
  pause
  exit /b 1
)
echo Watching for .xlsx per config.json — Ctrl+C to stop.
yarn node watch-catalog.js
pause
