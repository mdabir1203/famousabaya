@echo off
:: AbaYa Track - Start SkyWalking Observability Stack
:: Double-click this file to start SkyWalking.
:: Dashboard: http://localhost:8080  |  OAP takes ~2 min to become healthy.

set BANYANDB_IMAGE=apache/skywalking-banyandb:0.10.2
set OAP_IMAGE=apache/skywalking-oap-server:10.4.0
set UI_IMAGE=apache/skywalking-ui:10.4.0

echo Starting SkyWalking (BanyanDB + OAP + UI)...
docker compose -f "%~dp0docker-compose.yml" --project-name=skywalking-quickstart --profile=banyandb up --detach

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Failed to start. Is Docker Desktop running?
    pause
    exit /b 1
)

echo.
echo SkyWalking starting. OAP takes up to 2 minutes to become healthy.
echo   Dashboard  >>  http://localhost:8080
echo   BanyanDB   >>  http://localhost:17913
echo.
pause
