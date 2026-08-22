@echo off
title MYRAA - AI Desktop Companion by Aarav
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "NODE_ENV=production"
set "PORT=3000"
set "MYRAA_AGENT_EXE=%ROOT%..\agent\myraa-agent.exe"

echo ===================================================================
echo   🌸 Starting MYRAA — Autonomous 3D AI Companion by Aarav
echo ===================================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed on this system.
    echo Please download and install Node.js from: https://nodejs.org
    echo (Takes less than 2 minutes).
    echo.
    pause
    exit /b 1
)

:: 2. Auto-Install Dependencies if missing
if not exist "%ROOT%node_modules" (
    echo [1/3] First-time setup detected. Installing required libraries...
    call npm install --no-audit --no-fund
)

:: 3. Initialize secrets.json from example if missing
if not exist "%ROOT%secrets.json" (
    if exist "%ROOT%secrets.example.json" (
        copy "%ROOT%secrets.example.json" "%ROOT%secrets.json" >nul
        echo [INFO] Created secrets.json template. You can add your Gemini API key in Settings.
    )
)

:: 4. Start Local Browser Sync Agent (Port 3001) in background if present
if exist "%ROOT%local-agent.js" (
    powershell -Command "if (-not (Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue)) { Start-Process -FilePath 'node' -ArgumentList 'local-agent.js' -WorkingDirectory '%ROOT%' -WindowStyle Hidden; Write-Host '[1/2] Browser Sync Agent started on port 3001.' } else { Write-Host '[1/2] Browser Sync Agent already active.' }"
)

:: 5. Launch Web Server on port 3000
echo [2/2] Starting MYRAA Core Server on http://localhost:3000 ...
echo ===================================================================
echo   🌸 Opening MYRAA in your browser...
echo   URL: http://localhost:3000
echo ===================================================================
echo.

start "" "http://localhost:3000"

cd /d "%ROOT%"
node dist\server.cjs
pause
