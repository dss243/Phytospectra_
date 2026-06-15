@echo off
title Phytospectra Camera Bridge - One-time install
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install_user_pc_bridge.ps1"
pause
