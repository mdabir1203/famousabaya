@echo off
:: ============================================================================
:: AbaYa Track - PM2 entry point for the factory server.
::
:: Used by ecosystem.config.cjs with `interpreter: 'cmd.exe'` + /c. PM2's
:: normal fork mode wraps the user script in its own ProcessContainerFork.js,
:: which does `require('pm2-io-bpm')` and friends BEFORE our server.js loads.
:: With Yarn PnP preloaded (`-r ./.pnp.cjs`), those internal requires fail with
:: "isn't declared in your dependencies" because PnP only knows about packages
:: declared in the project's package.json — NOT PM2's own deps that live in
:: the global nvm dir.
::
:: By shelling out to cmd.exe, PM2's wrapper is bypassed entirely. cmd.exe
:: stays alive while node runs; when node exits (crash or clean stop), cmd.exe
:: exits with the same code and PM2 restarts via autorestart.
::
:: Output: `> log 2>&1` redirects the node process's stdout/stderr to
:: data\pm2-logs\abaya-server.out.log so we keep a persistent log even when
:: PM2's own stdout pipe doesn't capture cleanly (Windows + windowsHide).
:: PM2's `pm2 logs` still works because it tails the same file.
:: ============================================================================
setlocal
cd /d "%~dp0\.."
node -r ./.pnp.cjs server.js >> "data\pm2-logs\abaya-server.out.log" 2>&1
exit /b %ERRORLEVEL%

