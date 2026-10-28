@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

set "ROOT=%~dp0"
set "NAME=%~1"
set "TOKEN=%~2"
set "GROUP=%~3"

if "%NAME%"=="" goto usage
if "%TOKEN%"=="" goto usage
if "%GROUP%"=="" goto usage

set "DIR=%ROOT%instances\%NAME%"
if exist "%DIR%\.env" (
  echo [new-account] Instance "%NAME%" already exists: "%DIR%\.env"
  exit /b 1
)

mkdir "%DIR%" 2>nul

> "%DIR%\.env" (
  echo # Instance: %NAME%
  echo # Created by new-account.bat - the manager picks it up automatically.
  echo # Paths below MUST be absolute.
  echo TG_TOKEN=%TOKEN%
  echo TG_GROUP_ID=%GROUP%
  echo ZALO_CREDENTIALS_PATH=%DIR%\credentials.json
  echo DATA_DIR=%DIR%\data
  echo LOCAL_BOT_API=0
)

echo [new-account] Created "%DIR%\.env"
echo [new-account] The running manager will start it within a few seconds.
echo [new-account] Next: send /login in that instance's Telegram group to authenticate Zalo.
exit /b 0

:usage
echo Usage: new-account.bat ^<name^> ^<bot-token^> ^<group-id^>
echo Example: new-account.bat account3 123456789:AAExampleToken -1001234567890
echo.
echo Notes:
echo   - The group must be a supergroup with Topics enabled, and the bot an admin.
echo   - Instance folder + .env are created under instances\^<name^>.
exit /b 2
