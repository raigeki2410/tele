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
call :setup_env
if errorlevel 1 (
    pause
    exit /b 1
)
call :sync_api_key
if errorlevel 1 (
    pause
    exit /b 1
)
goto :main

:: Thiết lập file .env gốc từ .env.example nếu chưa có
:setup_env
if not exist "%ROOT%\.env" (
    if exist "%ROOT%\.env.example" (
        echo [INFO] Root .env not found. Copying from .env.example...
        copy "%ROOT%\.env.example" "%ROOT%\.env" >nul
        echo [OK] Created root .env from template
    ) else (
        echo [ERROR] .env.example not found at %ROOT%
        exit /b 1
    )
)
:: Kiểm tra và nhắc nhập TG_TOKEN, TG_GROUP_ID nếu còn placeholder
set "TG_TOKEN="
set "TG_GROUP_ID="
for /f "tokens=1,* delims==" %%A in ('findstr /b "TG_TOKEN= TG_GROUP_ID=" "%ROOT%\.env" 2^>nul') do (
    if "%%A"=="TG_TOKEN" set "TG_TOKEN=%%B"
    if "%%A"=="TG_GROUP_ID" set "TG_GROUP_ID=%%B"
)
if "%TG_TOKEN%"=="1234567890:ABCDEFabcdef1234567890abcdefABCDEF123" set "TG_TOKEN="
if "%TG_GROUP_ID%"=="-1001234567890" set "TG_GROUP_ID="
if "%TG_TOKEN%"=="YOUR_TELEGRAM_BOT_TOKEN_HERE" set "TG_TOKEN="
if "%TG_GROUP_ID%"=="" set "TG_GROUP_ID="
if not defined TG_TOKEN (
    echo [WARN] TG_TOKEN not set in .env
    set /p "TG_TOKEN=Enter Telegram Bot Token (from @BotFather): "
    if defined TG_TOKEN (
        powershell -Command "(Get-Content '%ROOT%\.env') -replace '^TG_TOKEN=.*', 'TG_TOKEN=%TG_TOKEN%' | Set-Content '%ROOT%\.env' -Encoding UTF8"
        echo [OK] TG_TOKEN updated
    ) else (
        echo [ERROR] TG_TOKEN is required for Telegram bridge to work
        exit /b 1
    )
)
if not defined TG_GROUP_ID (
    echo [WARN] TG_GROUP_ID not set in .env
    set /p "TG_GROUP_ID=Enter Telegram Group ID (negative number, e.g., -1001234567890): "
    if defined TG_GROUP_ID (
        powershell -Command "(Get-Content '%ROOT%\.env') -replace '^TG_GROUP_ID=.*', 'TG_GROUP_ID=%TG_GROUP_ID%' | Set-Content '%ROOT%\.env' -Encoding UTF8"
        echo [OK] TG_GROUP_ID updated
    ) else (
        echo [ERROR] TG_GROUP_ID is required for Telegram bridge to work
        exit /b 1
    )
)
:: Đồng bộ TG_TOKEN, TG_GROUP_ID sang control-api/.env
if exist "%API%\.env" (
    powershell -Command "$root=Get-Content '%ROOT%\.env'; $api=Get-Content '%API%\.env'; $new=@(); foreach($line in $api){ if($line -match '^TG_TOKEN='){ $new+='TG_TOKEN=%TG_TOKEN%' } elseif($line -match '^TG_GROUP_ID='){ $new+='TG_GROUP_ID=%TG_GROUP_ID%' } else{ $new+=$line } }; $new | Set-Content '%API%\.env' -Encoding UTF8"
    echo [OK] Synced TG config to control-api/.env
)
exit /b 0

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
