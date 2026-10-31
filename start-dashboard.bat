@echo off
setlocal

:: Lấy thư mục chứa script này làm root (hoạt động bất kể chạy từ đâu)
set "ROOT=%~dp0"

set "API=%ROOT%control-api"
set "DASHBOARD=%ROOT%dashboard"

echo [INFO] Project root: %ROOT%
echo [INFO] Control API : %API%
echo [INFO] Dashboard   : %DASHBOARD%
echo.

:: Kiểm tra Node.js và npm
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH. Please install Node.js first.
    pause
    exit /b 1
)
call npm --version
if errorlevel 1 goto :npm_error
goto :npm_ok

:npm_error
echo [ERROR] npm not found in PATH. Please install Node.js (includes npm).
pause
exit /b 1

:npm_ok

echo [OK] Node.js version:
node --version
echo [OK] npm version:
call npm --version
echo.

:: Kiểm tra thư mục dự án
if not exist "%API%\package.json" (
    echo [ERROR] Control API not found at %API%
    echo [HINT] Make sure you cloned the full repo and the folder structure is correct.
    pause
    exit /b 1
)
if not exist "%DASHBOARD%\package.json" (
    echo [ERROR] Dashboard not found at %DASHBOARD%
    pause
    exit /b 1
)
call :sync_api_key
if errorlevel 1 (
    pause
    exit /b 1
)
goto :main

:: Đồng bộ API_KEY giữa Control API và Dashboard
:sync_api_key
set "API_KEY="
if exist "%API%\.env" (
    for /f "tokens=1,* delims==" %%A in ('findstr /b "API_KEY=" "%API%\.env" 2^>nul') do set "API_KEY=%%B"
)
if not defined API_KEY (
    echo [INFO] API_KEY missing; generating local development key...
    for /f "delims=" %%K in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "API_KEY=%%K"
    >>"%API%\.env" echo API_KEY=%API_KEY%
)
if not defined API_KEY (
    echo [ERROR] Could not create API_KEY.
    exit /b 1
)
>"%DASHBOARD%\.env" echo VITE_API_KEY=%API_KEY%
echo [OK] Dashboard API key synchronized
exit /b 0

:: Hàm cài đặt dependency nếu thiếu node_modules
:install_deps
set "TARGET_DIR=%~1"
set "LABEL=%~2"
if not exist "%TARGET_DIR%\node_modules" (
    echo [INFO] %LABEL%: node_modules missing -> running npm install...
    cd /d "%TARGET_DIR%" && call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed for %LABEL%
        pause
        exit /b 1
    )
    cd /d "%ROOT%"
) else (
    echo [OK] %LABEL%: node_modules already present
)
exit /b 0

:main
call :install_deps "%API%" "Control API"
call :install_deps "%DASHBOARD%" "Dashboard"
echo.

:: Build Control API (npm start cần dist/, dev dùng ts-node)
echo [INFO] Building Control API...
cd /d "%API%" && call npm run build
if errorlevel 1 (
    echo [ERROR] Control API build failed
    pause
    exit /b 1
)
cd /d "%ROOT%"
echo [OK] Control API built
echo.

:: Khởi động Backend (dev mode với ts-node để hot-reload)
echo [INFO] Starting Control API (dev mode)...
start "TELE Control API" cmd /k "cd /d ""%API%"" && call npm run dev"

:: Khởi động Frontend
echo [INFO] Starting Dashboard (dev mode)...
start "TELE Dashboard" cmd /k "cd /d ""%DASHBOARD%"" && set VITE_API_KEY=%API_KEY% && call npm run dev"

echo.
echo ==========================================
echo  Control API : http://localhost:3001
echo  Dashboard   : http://localhost:5174
echo ==========================================
echo.
echo Two terminal windows launched.
echo Check the new windows for logs.
echo.
timeout /t 3 /nobreak >nul
endlocal
