@echo off
setlocal EnableExtensions
title AbaYa Track - Setup ^& Auto-Start

cd /d "%~dp0.."
set "APP_DIR=%CD%"
set "BIN_DIR=%APP_DIR%\.bin"
set "NODE_DIR=%BIN_DIR%\node-v20.12.2-win-x64"
set "NODE_EXE=%NODE_DIR%\node.exe"

echo =======================================================
echo AbaYa Track - Portable Auto-Start Setup
echo =======================================================
echo.

:: 1. Download Portable Node.js if missing
if not exist "%NODE_EXE%" (
    echo [INFO] Downloading Portable Node.js engine (this only happens once, ~30MB)...
    if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-x64.zip' -OutFile '%BIN_DIR%\node.zip'"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to download Node.js. Please check your internet connection.
        pause
        exit /b 1
    )
    echo [INFO] Extracting engine...
    powershell -NoProfile -Command "Expand-Archive -Path '%BIN_DIR%\node.zip' -DestinationPath '%BIN_DIR%' -Force"
    del /q "%BIN_DIR%\node.zip"
)

:: Add portable node to current path so npm/corepack/setup.cjs work correctly
set "PATH=%NODE_DIR%;%PATH%"

:: 2. Setup Dependencies (using existing setup.cjs)
if not exist ".pnp.cjs" if not exist "node_modules\" (
    echo [INFO] Installing required app packages...
    "%NODE_EXE%" install\setup.cjs NOPAUSE
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: 3. Setup .env file
if not exist ".env" (
  if exist ".env.example" (
    copy .env.example .env >nul
  ) else (
    echo PORT=3000 > .env
  )
)

:: Read port from .env if available, default to 3000
set PORT=3000
if exist ".env" (
  for /f "tokens=1,2 delims==" %%A in (.env) do (
    if /I "%%A"=="PORT" set PORT=%%B
  )
)

:: 4. Create the Silent Runner Script
set "VBS_FILE=%APP_DIR%\install\silent-runner.vbs"
set "BAT_RUNNER=%APP_DIR%\install\run-server.bat"

echo @echo off > "%BAT_RUNNER%"
echo cd /d "%APP_DIR%" >> "%BAT_RUNNER%"
echo set "PATH=%NODE_DIR%;%%PATH%%" >> "%BAT_RUNNER%"
echo :loop >> "%BAT_RUNNER%"
echo if exist ".pnp.cjs" ( >> "%BAT_RUNNER%"
echo   "%NODE_EXE%" -r ./.pnp.cjs server.js >> "%BAT_RUNNER%"
echo ) else ( >> "%BAT_RUNNER%"
echo   "%NODE_EXE%" server.js >> "%BAT_RUNNER%"
echo ) >> "%BAT_RUNNER%"
echo echo [INFO] Server crashed or exited. Restarting automatically in 5 seconds... >> "%BAT_RUNNER%"
echo timeout /t 5 /nobreak ^>nul >> "%BAT_RUNNER%"
echo goto loop >> "%BAT_RUNNER%"

echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_FILE%"
echo WshShell.Run chr(34) ^& "%BAT_RUNNER%" ^& Chr(34), 0 >> "%VBS_FILE%"
echo Set WshShell = Nothing >> "%VBS_FILE%"

:: 5. Create Startup Shortcut
echo [INFO] Configuring Windows Auto-Start...
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_DIR%\AbaYa-Track-Server.lnk"

powershell -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $shortcut = $wshell.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = 'wscript.exe'; $shortcut.Arguments = '""%VBS_FILE%""'; $shortcut.WorkingDirectory = '%APP_DIR%'; $shortcut.WindowStyle = 1; $shortcut.Description = 'AbaYa Track Background Server'; $shortcut.Save()"

:: 6. Launch Server Silently (kill existing node.exe running server.js first to avoid port conflict)
echo [INFO] Starting the server in the background...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'server\.js' } | Invoke-CimMethod -MethodName Terminate" >nul 2>&1
wscript.exe "%VBS_FILE%"

:: 7. Wait and Open Browser
echo [INFO] Waiting for server to initialize...
timeout /t 5 /nobreak >nul

echo [INFO] Opening Application...
start "" "http://127.0.0.1:%PORT%/dashboard.html"
start "" "http://127.0.0.1:%PORT%/kiosk.html"
start "" "http://127.0.0.1:%PORT%/setup"

echo.
echo =======================================================
echo AbaYa Track is now running silently in the background!
echo - It will automatically start every time you turn on your PC.
echo - No terminals will be kept open.
echo - To restart the server manually, just run this script again.
echo =======================================================
timeout /t 6 >nul
