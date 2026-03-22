@echo off
:: hooks/session-start.cmd — Windows batch file for ClawPowers session injection
::
:: Delegates to hooks/session-start.js via Node.js for Windows-native hook invocation.
:: This wrapper exists because Windows CMD and PowerShell cannot directly execute
:: Unix bash scripts. The JS hook produces identical JSON output on all platforms.
::
:: Usage:
::   hooks\session-start.cmd
::
:: Output: JSON object suitable for platform context injection (same as session-start.js)
:: Exit 0: success — JSON on stdout
:: Exit 1: Node.js not found, or skill file not found

setlocal

:: ============================================================
:: Step 1: Verify Node.js is installed and on the PATH
:: ============================================================
:: 'where' exits non-zero if node.exe is not found.
:: Without Node.js the JS hook cannot run — surface a machine-readable error.
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo {"error":"Node.js not found. Install from https://nodejs.org","action":"install Node.js >= 16"} >&2
    exit /b 1
)

:: ============================================================
:: Step 2: Resolve the directory containing this script
:: ============================================================
:: %~dp0 expands to the drive+path of the current script including a trailing backslash.
:: We strip the trailing backslash so path concatenation below works correctly.
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: ============================================================
:: Step 3: Run the JS hook
:: ============================================================
:: session-start.js lives in the same directory as this CMD file.
:: Node.js inherits the current environment, including CLAWPOWERS_DIR if set.
:: The exit code from node is forwarded verbatim so callers can detect errors.
node "%SCRIPT_DIR%\session-start.js"
exit /b %ERRORLEVEL%
