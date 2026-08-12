@echo off
:: ========================================================================
:: AbaYa Track - Windows 11 PM2 Safe Start & State Sanitizer
:: Run this via Windows Task Scheduler on System Startup (with highest privileges)
:: ========================================================================

cd /d "%~dp0"

echo [%date% %time%] Sanitizing PM2 state...

:: 1. Kill any zombie PM2 daemon that survived a dirty reboot
call pm2 kill >nul 2>&1

:: 2. Delete the corrupted dump file so pm2 resurrect doesn't fail silently
if exist "%USERPROFILE%\.pm2\dump.pm2" (
    del "%USERPROFILE%\.pm2\dump.pm2" /f /q >nul 2>&1
)

echo [%date% %time%] Starting PM2 ecosystem...
:: 3. Start fresh
call pm2 start ecosystem.config.cjs

:: 4. Save the fresh state immediately
call pm2 save

echo [%date% %time%] PM2 Startup complete.