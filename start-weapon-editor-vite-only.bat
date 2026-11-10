@echo off
setlocal
title WormForge Weapon Editor - Vite only (port 5175)
cd /d "%~dp0"

echo ============================================================
echo  WormForge Weapon Editor - Vite-only mode
echo ============================================================
echo.
echo This starts the UI without the Express/Gemini API.
echo Use it if the normal server (start-weapon-editor.bat) fails.
echo.

if not exist "node_modules\" (
  echo node_modules not found - running npm install first...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Press any key to close.
    pause >nul
    exit /b 1
  )
)

echo Starting Vite on http://localhost:5175
echo Keep this window open while testing. Press Ctrl+C to stop.
echo.

rem Wait for port 5175 to accept connections, then open the browser.
start "" powershell -NoProfile -WindowStyle Hidden -Command "$n=0; while ($n -lt 240) { try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1',5175); $c.Close(); Start-Process 'http://localhost:5175'; break } catch { Start-Sleep -Milliseconds 500; $n++ } }"

call ".\node_modules\.bin\vite" --port 5175 --strictPort

echo.
echo Vite stopped. Press any key to close.
pause >nul
endlocal
