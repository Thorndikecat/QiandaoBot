@echo off
cd /d "%~dp0"
node "%~dp0keep-monitor.js" --prompt-login %*
