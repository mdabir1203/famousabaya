@echo off
goto :eof

:ReadPortFromEnv
set "ABA_PORT=3111"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set "ABA_PORT=%%B"
  )
)
goto :eof

:ResolveServerCommand
set "RUN_SRV=node -r ./.pnp.cjs server.js"
if exist "node_modules\" (
  if /i "%ABAYA_RUNTIME%"=="bun" set "RUN_SRV=bun server.js"
  if /i "%ABAYA_RUNTIME%"=="node" set "RUN_SRV=node server.js"
)
goto :eof

:ResolveWatcherCommand
set "RUN_WATCH=node -r ./.pnp.cjs watch-catalog.js"
if exist "node_modules\" (
  if /i "%ABAYA_RUNTIME%"=="bun" set "RUN_WATCH=bun watch-catalog.js"
  if /i "%ABAYA_RUNTIME%"=="node" set "RUN_WATCH=node watch-catalog.js"
)
goto :eof
