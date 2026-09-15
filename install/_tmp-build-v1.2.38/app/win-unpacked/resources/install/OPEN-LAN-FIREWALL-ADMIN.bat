@echo off
setlocal EnableExtensions EnableDelayedExpansion
title AbaYa Track - Open LAN Firewall Port
cd /d "%~dp0.."

if /i not "%~1"=="__elevated__" (
  echo Opening Windows Firewall for factory tablets...
  echo UAC prompt - click Yes
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','\"\"%~f0\"\" __elevated__' -Verb RunAs -Wait -WorkingDirectory '%CD%'"
  set "EC=!ERRORLEVEL!"
  if not "!EC!"=="0" (
    echo [ERROR] UAC declined or elevation failed.
    pause
    exit /b 1
  )
  call "%~dp0RUNTIME-COMMON.bat" :ReadPortFromEnv
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VERIFY-LAN-FIREWALL.ps1" -Port %ABA_PORT%
  echo.
  pause
  exit /b 0
)

call "%~dp0RUNTIME-COMMON.bat" :ReadPortFromEnv
echo [INFO] Adding inbound TCP allow rule on port %ABA_PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ENSURE-LAN-FIREWALL.ps1" -Port %ABA_PORT%
set "EC=%ERRORLEVEL%"
if "%EC%"=="2" (
  echo [ERROR] Not running as Administrator.
  exit /b 2
)
if not "%EC%"=="0" (
  echo [ERROR] ENSURE-LAN-FIREWALL.ps1 failed with exit code %EC%.
  exit /b %EC%
)
echo [OK] Firewall rule is in place.
exit /b 0
