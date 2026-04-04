@echo off
title NetGuard Monitor v2.0 - Setup
color 0A

echo.
echo  ================================================
echo       NetGuard v2.0 - Setup (Real Diagnostics)
echo  ================================================
echo.

echo  [1/3] Checking Node.js ...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Download: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo         OK - Node.js %NODE_VER%

echo.
echo  [2/3] Installing dependencies ...
call npm install
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Installation failed
    pause
    exit /b 1
)
echo         OK

echo.
echo  [3/3] Launching NetGuard ...
echo.
echo  ================================================
echo   Dashboard: http://localhost:3847
echo   System Tray: click icon to open
echo   Right-click tray: options menu
echo  ================================================
echo.

start "NetGuard" npx electron .
timeout /t 3 >nul
exit
