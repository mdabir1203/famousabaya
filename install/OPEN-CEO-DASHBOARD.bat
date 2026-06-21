@echo off
setlocal EnableExtensions

:: ── Read PORT from .env (default 3111) ───────────────────────────────────────
set ABA_PORT=3111
if exist "%~dp0..\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0..\.env") do (
    if /i "%%A"=="PORT" set "ABA_PORT=%%B"
  )
)

:: ── Get the primary LAN IP ────────────────────────────────────────────────────
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
  set RAW_IP=%%A
  goto :got_ip
)
:got_ip
:: Trim leading space
for /f "tokens=* delims= " %%A in ("%RAW_IP%") do set LAN_IP=%%A

if "%LAN_IP%"=="" set LAN_IP=localhost

set DASHBOARD_URL=http://%LAN_IP%:%ABA_PORT%/dashboard.html

echo.
echo === AbaYa Track — CEO Dashboard Access ===
echo.
echo  Dashboard URL (for CEO phone / tablet on the same Wi-Fi):
echo.
echo    %DASHBOARD_URL%
echo.
echo  Make sure the CEO's phone is connected to the SAME Wi-Fi network as this PC.
echo.

:: ── Open Windows Firewall for the server port (requires admin) ────────────────
echo  Opening Windows Firewall for port %ABA_PORT% ...
netsh advfirewall firewall show rule name="AbaYa Track Server" >nul 2>&1
if %errorlevel% equ 0 (
  echo  [OK] Firewall rule already exists for port %ABA_PORT%.
) else (
  netsh advfirewall firewall add rule name="AbaYa Track Server" protocol=TCP dir=in localport=%ABA_PORT% action=allow >nul 2>&1
  if %errorlevel% equ 0 (
    echo  [OK] Firewall rule added for port %ABA_PORT%.
  ) else (
    echo  [!] Could not add firewall rule - try right-clicking this file and
    echo      choosing "Run as administrator", then try again.
  )
)

echo.
echo  Opening dashboard in browser on this PC...
start "" "%DASHBOARD_URL%"

echo.
echo  Share this URL with the CEO:  %DASHBOARD_URL%
echo.
echo  QR code for phone: open http://localhost:%ABA_PORT%/setup in your browser
echo     and paste the URL above into the "Custom base URL" box, then generate.
echo.
pause
