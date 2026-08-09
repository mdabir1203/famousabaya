@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

:: Optional: set ABAYA_RUNTIME=node or bun to skip the menu.

if not exist "server.js" (
  echo ERROR: server.js not found. Unzip the full package and run from install\ folder.
  pause
  exit /b 1
)

if not exist ".pnp.cjs" if not exist "node_modules\" (
  echo Dependencies not installed. Run install\INSTALL.bat first.
  pause
  exit /b 1
)

call "%~dp0PICK-RUNTIME.bat"
call "%~dp0RUNTIME-COMMON.bat" :ResolveServerCommand
call "%~dp0RUNTIME-COMMON.bat" :ReadPortFromEnv

echo Starting AbaYa server (%ABAYA_RUNTIME%) on http://127.0.0.1:%ABA_PORT%/
start "" "http://127.0.0.1:%ABA_PORT%/kiosk.html"
start "" "http://127.0.0.1:%ABA_PORT%/dashboard.html"
%RUN_SRV%
pause
