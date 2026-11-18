@echo off
setlocal
title O2 Support Hub
cd /d "%~dp0backend"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Trying to install Node.js LTS with winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js was installed. Close this window and double-click START-WINDOWS.bat again.
  echo If winget is not available, install Node.js 22 LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 (
  echo Your Node.js version is too old. Install Node.js 22 LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\.meridian-installed" (
  echo Installing components - first run only, takes a few minutes...
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Installing failed. Check your internet connection or proxy settings, then run this again.
    pause
    exit /b 1
  )
  echo ok> "node_modules\.meridian-installed"
)

node scripts\run-local.js
echo.
pause
