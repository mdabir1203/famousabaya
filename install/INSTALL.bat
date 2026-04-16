@echo off
setlocal EnableExtensions
title AbaYa Track - Install
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 18+ LTS from https://nodejs.org
  echo Then run install\INSTALL.bat again.
  pause
  exit /b 1
)
node "%~dp0setup.cjs"
if errorlevel 1 (
  pause
  exit /b 1
)
if /i not "%~1"=="NOPAUSE" pause
