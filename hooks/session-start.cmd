@echo off
:: hooks/session-start.cmd — Windows batch file for ClawPowers session injection
::
:: Calls hooks/session-start.js via Node.js for Windows-native hook invocation.
:: For use in Windows CMD or PowerShell environments that cannot execute bash scripts.
::
:: Usage:
::   hooks\session-start.cmd
::
:: Output: JSON object suitable for platform context injection (same as session-start.js)
:: Exit 0: success
:: Exit 1: Node.js not found or skill file not found

setlocal

:: Locate node.exe
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo {"error":"Node.js not found. Install from https://nodejs.org","action":"install Node.js >= 16"} >&2
    exit /b 1
)

:: Resolve the directory of this script
set "SCRIPT_DIR=%~dp0"
:: Remove trailing backslash
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Run the JS hook
node "%SCRIPT_DIR%\session-start.js"
exit /b %ERRORLEVEL%
