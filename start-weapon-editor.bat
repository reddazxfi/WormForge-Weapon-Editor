@echo off
setlocal
title WormForge Weapon Editor - dev server
cd /d "%~dp0"

echo ============================================================
echo  WormForge Weapon Editor
echo ============================================================
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

echo Starting the dev server on http://localhost:3000
echo Keep this window open while testing. Press Ctrl+C to stop.
echo.

rem Wait for port 3000 to accept connections, then open the browser.
start "" powershell -NoProfile -WindowStyle Hidden -Command "$n=0; while ($n -lt 240) { try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1',3000); $c.Close(); Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Milliseconds 500; $n++ } }"

call npm run dev

echo.
echo Dev server stopped. Press any key to close.
pause >nul
endlocal
