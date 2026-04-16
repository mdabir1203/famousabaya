@echo off
setlocal EnableExtensions
title AbaYa Track - Launch
cd /d "%~dp0.."

if not exist "server.js" (
  echo ERROR: server.js not found. Run from the full AbaYa Track folder.
  pause
  exit /b 1
)

if not exist ".pnp.cjs" (
  echo === First-time setup (dependencies) ===
  call "%~dp0INSTALL.bat" NOPAUSE
  if errorlevel 1 (
    echo Install failed. Fix errors above, then run this file again.
    pause
    exit /b 1
  )
)

set "CF_CFG=%USERPROFILE%\.cloudflared\config.yml"
if exist "%CF_CFG%" (
  where cloudflared >nul 2>&1
  if not errorlevel 1 (
    echo [Tunnel] Cloudflare connector (minimized^)...
    start "AbaYa Tunnel" /min cloudflared tunnel --config "%CF_CFG%" run
    timeout /t 2 /nobreak >nul
    echo   [i] HTTPS tablets: kiosk app https://kiosk.farewellabaya.com — factory API must be https:// (e.g. tunnel api host^). See docs\REMOTE_ACCESS.md
  )
)

:: ── Read PORT from .env (default 3000) ────────────────────────────────────────
set ABA_PORT=3000
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set "ABA_PORT=%%B"
  )
)

echo.
echo === AbaYa Track - Starting all components ===
echo.

:: ── 1. Factory server ──────────────────────────────────────────────────────
echo [1/3] Starting factory server on port %ABA_PORT%...
start "AbaYa Server — port %ABA_PORT%" cmd /k "cd /d "%~dp0.." && yarn node server.js"

:: Give the server a moment to bind before opening browser tabs
timeout /t 2 /nobreak >nul

:: ── 2. Browser tabs ────────────────────────────────────────────────────────
echo [2/3] Opening kiosk, dashboard, and setup page in browser...
start "" "http://localhost:%ABA_PORT%/kiosk.html"
start "" "http://localhost:%ABA_PORT%/dashboard.html"
start "" "http://localhost:%ABA_PORT%/setup"

:: ── 3. Catalog watcher (only if config.json is present) ───────────────────
echo [3/3] Checking catalog watcher...
if not exist "tools\catalog-watcher\config.json" (
  echo   Skipped - no tools\catalog-watcher\config.json found.
  echo   To enable catalog sync, copy config.example.json to config.json and edit it.
  echo   See docs\OFFICE_LAPTOP.md for instructions.
  goto done
)

if not exist "tools\catalog-watcher\.pnp.cjs" (
  echo   Skipped - catalog-watcher PnP not ready. Run install\INSTALL.bat first.
  goto done
)

echo   Starting catalog watcher...
start "AbaYa Catalog Watcher" cmd /k "cd /d "%~dp0..\tools\catalog-watcher" && yarn node watch-catalog.js"

:done

:: ── Detect LAN IP for CEO / phone access ──────────────────────────────────────
set LAN_IP=
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
  set RAW_IP=%%A
  goto :got_lan_ip
)
:got_lan_ip
for /f "tokens=* delims= " %%A in ("%RAW_IP%") do set LAN_IP=%%A
if "%LAN_IP%"=="" set LAN_IP=localhost

:: ── Detect Tailscale IP (if installed) ───────────────────────────────────────
set TS_IP=
tailscale ip -4 >nul 2>&1 && for /f %%A in ('tailscale ip -4') do set TS_IP=%%A

echo.
echo === All components launched ===
echo   Kiosk:     http://localhost:%ABA_PORT%/kiosk.html
echo   Dashboard: http://localhost:%ABA_PORT%/dashboard.html
echo   QR Setup:  http://localhost:%ABA_PORT%/setup
echo.
echo === LAN access (same Wi-Fi) ===
echo   Dashboard: http://%LAN_IP%:%ABA_PORT%/dashboard.html
echo   Kiosk:     http://%LAN_IP%:%ABA_PORT%/kiosk.html
if not "%TS_IP%"=="" (
echo.
echo === Tailscale access (any network) ===
echo   Dashboard: http://%TS_IP%:%ABA_PORT%/dashboard.html
echo   Kiosk:     http://%TS_IP%:%ABA_PORT%/kiosk.html
)
echo.
echo === CEO cloud dashboard ===
echo   https://dashboard.farewellabaya.com  (Cloudflare Worker, any network)
echo.
if "%TS_IP%"=="" (
echo   [i] Tailscale not detected. For remote admin access: install\SETUP-TAILSCALE.ps1
)
echo   [!] LAN firewall issue? Run:  install\OPEN-CEO-DASHBOARD.bat  (as Admin)
echo.
echo   Close this window at any time.
echo.
timeout /t 4 /nobreak >nul
