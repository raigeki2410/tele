@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

set "ROOT=%~dp0"
set "NAME=%~1"
if "%NAME%"=="" set "NAME=account1"
set "INST=%ROOT%instances\%NAME%"

if not exist "%INST%\.env" (
  echo [Log] Unknown instance "%NAME%".
  echo       Usage: run-log.bat ^<instance^>   [default: account1]
  pause
  exit /b 2
)

if not exist "%ROOT%logs" mkdir "%ROOT%logs"

echo [Log] Instance: %NAME%
echo [Log] Log file: %ROOT%logs\%NAME%.log
echo [Log] Send test media now, then press Ctrl+C.
echo.

cd /d "%INST%"
set "ZALO_TG_RUNNER=1"
node --disable-warning=DEP0205 "%ROOT%dist\index.js" > "%ROOT%logs\%NAME%.log" 2>&1

echo.
echo [Log] Bridge exited (%ERRORLEVEL%). Log: %ROOT%logs\%NAME%.log
pause
