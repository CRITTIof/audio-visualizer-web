@echo off
setlocal EnableExtensions
title 音频可视化网页推流-Audio Visualizer Web
cd /d "%~dp0"
chcp 65001 >nul 2>nul

if not exist "server.js" goto :missing_server

where node >nul 2>nul
if errorlevel 1 goto :no_node
node --version >nul 2>nul
if errorlevel 1 goto :no_node

echo.
echo  ==========================================================
echo   音频可视化网页推流-Audio Visualizer Web
echo  ==========================================================
echo.
echo   Starting the local server...
echo   Keep this window open while streaming. Press Ctrl+C to stop.
echo   The exact control and overlay URLs will be printed below.
echo.

node server.js %*
set "EXITCODE=%ERRORLEVEL%"

echo.
echo  ----------------------------------------------------------
echo   The server has stopped. Exit code: %EXITCODE%
echo  ----------------------------------------------------------
echo   Common causes:
echo    - the port is already in use
echo    - config.json is not valid JSON
echo    - Node.js was blocked by antivirus or security software
echo.
echo   Try another port:  start.bat --port 9000
echo.

pause
exit /b %EXITCODE%

:no_node
echo.
echo  [ERROR] Node.js 18 or newer was not found or cannot run.
echo  Install it from https://nodejs.org/ and run this file again.
echo.
pause
exit /b 1

:missing_server
echo.
echo  [ERROR] server.js was not found in this folder.
echo  Please place start.bat in the desktop-audio-visualizer folder.
echo.
pause
exit /b 1
