@echo off
cd /d "C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2"
:loop
"C:\nvm4w\nodejs\node.exe" -r ./.pnp.cjs server.js
echo [server] exited — restarting in 5s…
timeout /t 5 /nobreak >nul
goto loop
