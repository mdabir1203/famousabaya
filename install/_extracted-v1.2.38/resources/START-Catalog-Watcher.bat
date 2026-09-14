@echo off
setlocal EnableExtensions

:: Optional: set ABAYA_RUNTIME=node or bun to skip the menu.

cd /d "%~dp0.."

if not exist "tools\catalog-watcher\watch-catalog.js" (
  echo ERROR: catalog-watcher not found. Use the full AbaYa Track package.
  pause
  exit /b 1
)

if not exist "tools\catalog-watcher\.pnp.cjs" if not exist "tools\catalog-watcher\node_modules\" (
  echo Dependencies not installed. Run install\INSTALL.bat first.
  pause
  exit /b 1
)

call "%~dp0PICK-RUNTIME.bat"

cd /d "%~dp0..\tools\catalog-watcher"

if not exist "config.json" (
  echo Copy config.example.json to config.json and edit paths and workerUrl / ingestSecret.
  echo See docs\OFFICE_LAPTOP.md
  pause
  exit /b 1
)

call "%~dp0RUNTIME-COMMON.bat" :ResolveWatcherCommand

echo Watching for .xlsx per config.json (%ABAYA_RUNTIME%) — Ctrl+C to stop.
%RUN_WATCH%
pause
