@echo off
setlocal

set "ROOT=D:\OneDrive - raigeki241\Tgzl"
set "API=%ROOT%\control-api"
set "DASHBOARD=%ROOT%\dashboard"

if not exist "%API%\package.json" (
    echo Control API not found: %API%
    pause
    exit /b 1
)

if not exist "%DASHBOARD%\package.json" (
    echo Dashboard not found: %DASHBOARD%
    pause
    exit /b 1
)

start "TELE Control API" cmd /k "cd /d ""%API%"" && npm start"
start "TELE Dashboard" cmd /k "cd /d ""%DASHBOARD%"" && npm run dev"

echo Control API: http://localhost:3001
echo Dashboard:   http://localhost:5174
echo.
echo Two terminal windows started.
timeout /t 3 /nobreak >nul
endlocal
