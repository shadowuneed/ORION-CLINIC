@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-orion-clinic.ps1" %*
set "ORION_EXIT=%ERRORLEVEL%"
endlocal & exit /b %ORION_EXIT%
