@echo off
setlocal EnableExtensions
title AbaYa Track - Install
cd /d "%~dp0.."
if not exist "server.js" (
  echo ERROR: Run this from the unzipped AbaYa Track folder. Expected server.js in parent of install\
  pause
  exit /b 1
)

echo.
echo === AbaYa Track - first-time install ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 18 or newer from https://nodejs.org
  echo Then run install\INSTALL.bat again.
  pause
  exit /b 1
)

node -e "var m=parseInt(process.versions.node,10); if(m<18){console.error('Node 18+ required. You have: '+process.version); process.exit(1);}"
if errorlevel 1 (
  pause
  exit /b 1
)

echo [1/5] Enabling Corepack (Yarn package manager)...
corepack enable
if errorlevel 1 (
  echo Corepack enable failed. Make sure Node.js 18+ is installed.
  pause
  exit /b 1
)

echo [2/5] Installing factory server dependencies (Yarn PnP)...
yarn install
if errorlevel 1 (
  echo yarn install failed. Check your internet connection.
  pause
  exit /b 1
)

echo [3/5] Installing catalog watcher dependencies...
pushd tools\catalog-watcher
yarn install
if errorlevel 1 (
  popd
  echo catalog-watcher yarn install failed.
  pause
  exit /b 1
)
popd

echo [4/5] Environment file...
if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo Created .env from .env.example - edit it with your CF_WORKER_URL and CF_INGEST_SECRET.
  ) else (
    echo WARNING: No .env.example found. Set CF_WORKER_URL and CF_INGEST_SECRET manually or in System Environment Variables.
  )
) else (
  echo .env already exists - left unchanged.
)

echo [5/5] Creating Desktop shortcut...
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut([System.IO.Path]::Combine($env:USERPROFILE,'Desktop','AbaYa Track.lnk')); $s.TargetPath='%~dp0LAUNCH-ALL.bat'; $s.WorkingDirectory='%~dp0..'; $s.Description='Start AbaYa Track kiosk, dashboard, and catalog sync'; $s.Save()"
if errorlevel 1 (
  echo   Desktop shortcut could not be created ^(non-fatal^). Use install\LAUNCH-ALL.bat directly.
) else (
  echo   Shortcut created: Desktop\AbaYa Track
)

echo.
echo === Install finished ===
echo.
echo NEXT STEPS:
echo   1. Open .env in Notepad and set:
echo        CATALOG_XLSX_PATH=C:\path\to\your\items_export.xlsx
echo      ^(e.g.  C:\Users\DELL\Desktop\barcode\items_export.xlsx^)
echo      The server loads this file at startup and refreshes it every 24 hours.
echo.
echo   2. Optional — Cloudflare cloud sync:
echo        CF_WORKER_URL=https://abaya-track.YOURNAME.workers.dev
echo        CF_INGEST_SECRET=your_secret
echo      Skip if running local-only.
echo.
echo   3. Double-click "AbaYa Track" on your Desktop to launch everything.
echo      ^(Or: install\LAUNCH-ALL.bat^)
echo.
echo   Kiosk:     http://localhost:3050/kiosk.html
echo   Dashboard: http://localhost:3050/dashboard.html
echo   Tablet QR: http://localhost:3050/setup
echo   Full IT guide: docs\INSTALL_WINDOWS.md
echo   Catalog format: docs\CATALOG_EXCEL_SPEC.md
echo.
pause
