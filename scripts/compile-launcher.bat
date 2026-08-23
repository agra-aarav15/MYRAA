@echo off
setlocal enabledelayedexpansion

echo Compiling MYRAA Launcher...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0compile-launcher.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Launcher compilation failed with code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)
echo [SUCCESS] Launcher compilation complete.
exit /b 0
