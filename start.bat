@echo off
setlocal
title lintasJB NMS
cd /d "%~dp0"

set "NODE_OK="
where node >nul 2>nul
if not errorlevel 1 set "NODE_OK=1"

if not defined NODE_OK (
  if exist "%TEMP%\node-portable\node-v22.14.0-win-x64\node.exe" (
    set "PATH=%TEMP%\node-portable\node-v22.14.0-win-x64;%PATH%"
    set "NODE_OK=1"
    echo [i] Memakai Node portable: %TEMP%\node-portable
  )
)

if not defined NODE_OK (
  echo.
  echo [!] Node.js tidak ditemukan.
  echo     Install Node.js 18.17+ dari https://nodejs.org lalu jalankan start.bat lagi.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [i] Memasang dependency pertama kali...
  call npm.cmd install
  if errorlevel 1 (
    echo [!] npm install gagal.
    pause
    exit /b 1
  )
)

echo.
echo [i] Menjalankan lintasJB NMS di http://localhost:8787
echo     Tekan Ctrl+C untuk berhenti.
echo.
node server/index.js

echo.
echo [i] Server berhenti.
pause
