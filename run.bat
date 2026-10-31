@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

set "ROOT=%~dp0"

if /i "%~1"=="list" (
  echo Instances:
  for /d %%D in ("%ROOT%instances\*") do echo   %%~nxD
  exit /b 0
)

if not exist "%ROOT%node_modules" (
  echo [Launcher] node_modules missing - running npm install...
  call npm install --production=false
  if errorlevel 1 (
    echo [Launcher] npm install failed.
    pause
    exit /b 1
  )
)

if not exist "%ROOT%dist\index.js" (
  echo [Launcher] dist missing - running npm run build...
  call npm run build
  if errorlevel 1 (
    echo [Launcher] build failed.
    pause
    exit /b 1
  )
)

echo [Launcher] Starting in THIS window (all instances). Logs: logs\^<name^>.log
echo [Launcher] Ctrl+C stops everything.
node "%ROOT%manager.mjs"

echo.
echo [Launcher] Manager exited.
pause
