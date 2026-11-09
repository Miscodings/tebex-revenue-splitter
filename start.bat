@echo off
cd /d "%~dp0"
start "" http://localhost:3377
node server.js
pause
