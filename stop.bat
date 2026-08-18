@echo off
setlocal
set "PID_FILE=%APPDATA%\小钱哥短剧工厂\server.pid"
if not exist "%PID_FILE%" (
  echo 小钱哥短剧工厂当前没有运行。
  exit /b 0
)
set /p PID=<"%PID_FILE%"
taskkill /PID %PID% /T /F >nul 2>nul
del /q "%PID_FILE%" >nul 2>nul
echo 小钱哥短剧工厂已停止。
endlocal
