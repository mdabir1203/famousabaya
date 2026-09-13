@echo off
:: ============================================================================
:: AbaYa Track - PM2 entry point for the optional catalog-watcher process.
::
:: Same shape as pm2-abaya-launcher.cmd: bypasses PM2's ProcessContainerFork
:: wrapper (which would crash on its own `require('pm2-io-bpm')` under Yarn
:: PnP) by running the user script directly through cmd.exe. cd into the
:: watcher's own dir so its relative paths resolve correctly.
:: ============================================================================
setlocal
cd /d "%~dp0\..\tools\catalog-watcher"
if not exist ".pnp.cjs" if exist "..\..\.pnp.cjs" (
  set "NODE_OPTIONS=--require %CD%\..\..\.pnp.cjs"
)
node -r "./.pnp.cjs" watch-catalog.js
exit /b %ERRORLEVEL%
