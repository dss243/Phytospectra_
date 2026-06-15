# Field laptop — minimal agent (no uvicorn, no ngrok on this PC)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "Field laptop agent"
Write-Host "  1. Join MAPIR camera Wi-Fi (192.168.1.x)"
Write-Host "  2. Keep USB internet (or Wi-Fi with access to ngrok)"
Write-Host "  3. Home server must be running (uvicorn + ngrok on PC1)"
Write-Host ""

Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "192.168.1.*" } |
  Format-Table InterfaceAlias, IPAddress -AutoSize

if (-not (Test-Path ".\venv\Scripts\python.exe")) {
  Write-Host "Creating venv and installing httpx + websockets..."
  python -m venv venv
  .\venv\Scripts\pip.exe install httpx websockets
}

Write-Host "Starting field_agent.py (Ctrl+C to stop)..."
.\venv\Scripts\python.exe .\scripts\field_agent.py
