@echo off
:: AbaYa Track - Stop SkyWalking Observability Stack
:: Data is preserved. Run start.bat to bring it back up.
docker compose --project-name=skywalking-quickstart stop
echo SkyWalking stopped. Data preserved.
pause
