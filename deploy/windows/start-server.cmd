@echo off
rem Starts O2 Support Hub. Run by hand to try it, or let the scheduled task (install-service.ps1) run it with "service",
rem which restarts the app automatically if it ever stops.
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%config\o2.env" (
  echo config\o2.env not found. Run scripts\install.ps1 first.
  exit /b 1
)
if not exist "%ROOT%logs" mkdir "%ROOT%logs"
cd /d "%ROOT%app\backend"
:run
echo [%date% %time%] starting O2 Support Hub >> "%ROOT%logs\server.log"
node --env-file="%ROOT%config\o2.env" scripts\db-migrate.js >> "%ROOT%logs\server.log" 2>&1
node --env-file="%ROOT%config\o2.env" src\server.js >> "%ROOT%logs\server.log" 2>&1
echo [%date% %time%] O2 Support Hub stopped with exit code %ERRORLEVEL% >> "%ROOT%logs\server.log"
if /i "%~1"=="service" (
  timeout /t 10 /nobreak > nul
  goto run
)
exit /b %ERRORLEVEL%
