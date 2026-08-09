@echo off
cd /d "C:\Users\mabba\Desktop\AbaYa-Track-v1.0.2\services\dispatch-server"
:loop
"C:\Users\mabba\.bun\bin\bun.exe" server.js
echo [dispatch] exited — restarting in 5s…
timeout /t 5 /nobreak >nul
goto loop
