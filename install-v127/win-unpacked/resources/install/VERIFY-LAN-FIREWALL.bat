@echo off
title AbaYa Track - Verify LAN Firewall
cd /d "%~dp0.."
call "%~dp0RUNTIME-COMMON.bat" :ReadPortFromEnv
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VERIFY-LAN-FIREWALL.ps1" -Port %ABA_PORT%
if /i "%~1"=="/nopause" exit /b %ERRORLEVEL%
pause
