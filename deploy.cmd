@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
set "deploy_exit=%ERRORLEVEL%"
pause
exit /b %deploy_exit%
