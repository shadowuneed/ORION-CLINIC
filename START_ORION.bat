@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "PROJECT_DIR=%~dp0"
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "VINEXT_CLI=%PROJECT_DIR%node_modules\vinext\dist\cli.js"
set "STT_SCRIPT=%PROJECT_DIR%local-ai\start.ps1"
set "STT_PYTHON=%LOCALAPPDATA%\ORION\python-env\Scripts\python.exe"
set "NODE_FROM_PATH="

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo [ERROR] Could not open the ORION project directory.
  goto :failed
)

title ORION launcher
echo.
echo ========================================
echo   ORION - local prototype launcher
echo ========================================
echo.

if not exist "%NODE_EXE%" (
  for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_FROM_PATH set "NODE_FROM_PATH=%%I"
  if defined NODE_FROM_PATH set "NODE_EXE=%NODE_FROM_PATH%"
)

if not exist "%NODE_EXE%" (
  echo [ERROR] Node.js was not found.
  echo Open the project through Codex or install Node.js 22+.
  goto :failed
)

if not exist "%VINEXT_CLI%" (
  echo [ERROR] Web dependencies are missing.
  echo Missing file: %VINEXT_CLI%
  goto :failed
)

if not exist "%STT_SCRIPT%" (
  echo [ERROR] Local STT start script was not found.
  goto :failed
)

if not exist "%STT_PYTHON%" (
  echo [ERROR] Local STT is not installed yet.
  echo Run this once from the project directory:
  echo powershell -NoProfile -ExecutionPolicy Bypass -File ".\local-ai\setup.ps1" -Device Cuda
  goto :failed
)

call :port_is_listening 3101
if errorlevel 1 (
  echo [START] Local STT on port 3101...
  start "ORION STT :3101" /min powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%STT_SCRIPT%" -Device Auto
) else (
  call :stt_is_orion
  if errorlevel 1 (
    echo [ERROR] Port 3101 is occupied by another service.
    goto :failed
  )
  echo [OK] Port 3101 is already running.
)

call :port_is_listening 3100
if errorlevel 1 (
  echo [START] ORION web interface on port 3100...
  start "ORION WEB :3100" /min "%ComSpec%" /k ""%NODE_EXE%" "%VINEXT_CLI%" dev --port 3100"
) else (
  call :web_is_orion
  if errorlevel 1 (
    echo [ERROR] Port 3100 is occupied by another web application.
    goto :failed
  )
  echo [OK] Port 3100 is already running.
)

echo [WAIT] Checking the interface and model readiness...
powershell.exe -NoProfile -Command "$deadline=(Get-Date).AddSeconds(150); $web=$false; $speech=$false; do { try { $response=Invoke-WebRequest -UseBasicParsing 'http://localhost:3100/' -TimeoutSec 3; $web=($response.StatusCode -eq 200 -and $response.Content -match 'ORION') } catch { $web=$false }; try { $health=Invoke-RestMethod 'http://127.0.0.1:3101/health' -TimeoutSec 5; $speech=($health.service -eq 'orion-local-speech' -and $health.status -eq 'ok' -and $health.stt.status -eq 'ready' -and $health.speaker.status -eq 'ready') } catch { $speech=$false }; if($web -and $speech){ exit 0 }; Write-Host -NoNewline '.'; Start-Sleep -Milliseconds 1500 } while((Get-Date)-lt $deadline); Write-Host ''; if(-not $web){ Write-Host '[ERROR] ORION web interface on 3100 did not respond.' }; if(-not $speech){ Write-Host '[ERROR] ORION STT on 3101 did not become ready.' }; exit 1"

if errorlevel 1 goto :failed

echo.
echo ========================================
echo   ORION is ready
echo ========================================
echo Local URL: http://localhost:3100
echo.
echo Next step for external access:
echo   ngrok 3100
echo.
goto :success

:port_is_listening
powershell.exe -NoProfile -Command "if(Get-NetTCPConnection -State Listen -LocalPort %~1 -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >nul 2>&1
exit /b %ERRORLEVEL%

:stt_is_orion
powershell.exe -NoProfile -Command "try{$health=Invoke-RestMethod 'http://127.0.0.1:3101/health' -TimeoutSec 5; if($health.service -eq 'orion-local-speech'){exit 0}}catch{}; exit 1" >nul 2>&1
exit /b %ERRORLEVEL%

:web_is_orion
powershell.exe -NoProfile -Command "try{$response=Invoke-WebRequest -UseBasicParsing 'http://localhost:3100/' -TimeoutSec 5; if($response.StatusCode -eq 200 -and $response.Content -match 'ORION'){exit 0}}catch{}; exit 1" >nul 2>&1
exit /b %ERRORLEVEL%

:failed
echo.
echo ORION could not be started. See the messages above.
if /I "%~1"=="--no-pause" exit /b 1
pause
exit /b 1

:success
if /I "%~1"=="--no-pause" exit /b 0
pause
exit /b 0
