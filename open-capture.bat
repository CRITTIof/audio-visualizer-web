@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>nul

rem Optional first argument: port number (default 8787)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8787"
set "URL=http://127.0.0.1:%PORT%/"
set "PROFILE=%~dp0.capture-browser"

set "BROWSER="
set "EDGE_X86=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE_X64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME_X64=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME_X86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "CHROME_LOCAL=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE_X86%" set "BROWSER=%EDGE_X86%"
if not defined BROWSER if exist "%EDGE_X64%" set "BROWSER=%EDGE_X64%"
if not defined BROWSER if exist "%CHROME_X64%" set "BROWSER=%CHROME_X64%"
if not defined BROWSER if exist "%CHROME_X86%" set "BROWSER=%CHROME_X86%"
if not defined BROWSER if exist "%CHROME_LOCAL%" set "BROWSER=%CHROME_LOCAL%"

if not defined BROWSER goto :no_browser

echo.
echo  Opening the dedicated capture window:
echo    %URL%
echo.
echo  Background timer throttling is disabled in this window.
echo  Make sure the server is already running (start.bat).
echo.

start "" "%BROWSER%" --app="%URL%" --user-data-dir="%PROFILE%" --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion --no-first-run --no-default-browser-check
exit /b 0

:no_browser
echo.
echo  [ERROR] Could not find Chrome or Microsoft Edge.
echo  Open this URL manually in Chrome or Edge instead:
echo    %URL%
echo.
pause
exit /b 1
