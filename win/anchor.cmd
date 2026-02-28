@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0anchor.ps1" %*
endlocal
