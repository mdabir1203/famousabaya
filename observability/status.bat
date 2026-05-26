@echo off
:: AbaYa Track - Show SkyWalking container status
docker compose --project-name=skywalking-quickstart ps
docker ps --filter "name=oap" --filter "name=banyandb" --filter "name=ui" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
pause
