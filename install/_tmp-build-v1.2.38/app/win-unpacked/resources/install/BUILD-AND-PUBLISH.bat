@echo off
REM Build and publish AbaYa Track installer with LAN mirror update
REM Usage: BUILD-AND-PUBLISH.bat [stable|beta] [--skip-gh-publish]

set CHANNEL=%1
if "%CHANNEL%"=="" set CHANNEL=stable

set SKIP_GH=
if "%2"=="--skip-gh-publish" set SKIP_GH=--skip-gh-publish

echo.
echo ========================================
echo   AbaYa Track - Build ^& Publish
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0BUILD-AND-PUBLISH.ps1" -Channel %CHANNEL% %SKIP_GH%

pause
