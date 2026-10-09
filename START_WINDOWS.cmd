@echo off
setlocal
cd /d "%~dp0"
title Commonroom - local development
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24.x, then reopen this launcher.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Please use Node.js 24.x. Current version: '+process.version);process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist "package-lock.json" (
  echo package-lock.json is missing. Extract the complete ZIP before running this launcher.
  pause
  exit /b 1
)
echo Installing the exact dependencies. Internet access is needed for this step.
call npm ci
if errorlevel 1 (
  echo Installation did not finish. Read the npm error above.
  pause
  exit /b 1
)
echo.
echo Open http://localhost:5173 after Vite says it is ready.
echo Keep this window open. Press Ctrl+C to stop Commonroom.
call npm run dev
pause
