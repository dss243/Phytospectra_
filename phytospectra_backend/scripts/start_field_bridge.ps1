# PC2 (field laptop) — DEV/TEST only. For real users run install_user_pc_bridge.ps1 once.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "PC2 field bridge (full backend)"
Write-Host "  1. Copy .env from PC1 OR use .env.field.example -> .env on this PC"
Write-Host "  2. MAPIR Wi-Fi (192.168.1.x) + USB ethernet (internet to ngrok)"
Write-Host "  3. PC1 must run: start_home_server.ps1 + ngrok http 8000"
Write-Host ""

Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "192.168.1.*" } |
  Format-Table InterfaceAlias, IPAddress -AutoSize

if (-not (Test-Path ".\venv\Scripts\uvicorn.exe")) {
  Write-Host "ERROR: venv missing. On PC2 run once:"
  Write-Host "  python -m venv venv"
  Write-Host "  .\venv\Scripts\pip install -r requirements.txt"
  exit 1
}

Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host "Starting uvicorn (field mode — WebSocket to PC1). Ctrl+C to stop."
.\venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000
