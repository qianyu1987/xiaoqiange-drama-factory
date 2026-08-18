@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22 LTS，再运行本程序。
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%V
if not "%NODE_MAJOR%"=="22" (
  echo 当前 Node.js 主版本为 %NODE_MAJOR%，需要 Node.js 22 LTS。
  pause
  exit /b 1
)
set "XQG_APP_DATA=%APPDATA%\小钱哥短剧工厂"
set "XQG_MEDIA_DIR=%USERPROFILE%\Videos\小钱哥短剧工厂"
set "PATH=%~dp0tools\ffmpeg;%PATH%"
start "小钱哥短剧工厂" /min node "%~dp0launcher.js"
echo 小钱哥短剧工厂正在启动，浏览器会自动打开工作台。
endlocal
