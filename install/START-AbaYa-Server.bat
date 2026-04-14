@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
if not exist "server.js" (
  echo ERROR: server.js not found. Unzip the full package and run from install\ folder.
  pause
  exit /b 1
)
if not exist ".pnp.cjs" (
  echo Dependencies not installed. Run install\INSTALL.bat first.
  pause
  exit /b 1
)

:: Read PORT from .env (default 3000)
set ABA_PORT=3000
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set "ABA_PORT=%%B"
  )
)

echo Starting AbaYa server on http://localhost:%ABA_PORT%/
start "" "http://localhost:%ABA_PORT%/kiosk.html"
start "" "http://localhost:%ABA_PORT%/dashboard.html"
yarn node server.js
pause
