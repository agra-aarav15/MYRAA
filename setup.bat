@echo off
title MYRAA - 5-Minute One-Click Setup by Aarav
setlocal enabledelayedexpansion

set "ROOT=%~dp0"

echo ===================================================================
echo   🌸 MYRAA — 5-Minute Fresh PC Automatic Setup by Aarav
echo ===================================================================
echo.

echo [1/4] Checking Node.js runtime...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Opening download page...
    start "" "https://nodejs.org/en/download"
    echo Please install Node.js (LTS recommended) and run setup.bat again.
    pause
    exit /b 1
)
echo [OK] Node.js is ready.

echo.
echo [2/4] Installing core dependencies (Playwright, Express, WebSocket)...
cd /d "%ROOT%"
call npm install --no-audit --no-fund

echo.
echo [3/4] Downloading Chromium engine for desktop browser automation...
call npx playwright install chromium

echo.
echo [4/4] Setting up configuration files...
if not exist "%ROOT%secrets.json" (
    copy "%ROOT%secrets.example.json" "%ROOT%secrets.json" >nul
)

echo.
echo ===================================================================
echo   ✨ Setup complete! Launching MYRAA now...
echo ===================================================================
echo.

call START_SERVER.bat
