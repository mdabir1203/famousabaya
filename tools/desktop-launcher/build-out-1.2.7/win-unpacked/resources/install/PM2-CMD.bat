@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
set "APP_DIR=%CD%"
set "PM2_HOME=%APP_DIR%\data\pm2-home"
if not exist "%PM2_HOME%" mkdir "%PM2_HOME%"
set "BIN_DIR=%APP_DIR%\.bin"
set "NODE_DIR=%BIN_DIR%\node-v20.12.2-win-x64"
set "NODE_EXE=%NODE_DIR%\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

if exist "%APP_DIR%\.pnp.cjs" (
  "%NODE_EXE%" -r "%APP_DIR%\.pnp.cjs" "%APP_DIR%\install\run-pm2.cjs" %*
) else (
  "%NODE_EXE%" "%APP_DIR%\install\run-pm2.cjs" %*
)
exit /b %ERRORLEVEL%
