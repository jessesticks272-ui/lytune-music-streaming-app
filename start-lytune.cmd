@echo off
setlocal
cd /d "%~dp0"

start "Lytune Server" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" http://lytune.localhost:3000/signup.html
