# Verify PC1 ngrok + uvicorn setup (run on home PC)
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot\..

$ngrokUrl = "https://unseeing-purity-reluctant.ngrok-free.dev"
if ($env:HOME_SERVER_PUBLIC_URL) { $ngrokUrl = $env:HOME_SERVER_PUBLIC_URL.TrimEnd("/") }

$hdr = @{ "ngrok-skip-browser-warning" = "true" }
$wsUrl = $ngrokUrl -replace "^https://", "wss://" -replace "^http://", "ws://"
$bridgeKey = if ($env:CAMERA_BRIDGE_KEY) { $env:CAMERA_BRIDGE_KEY } else { "phytospectra-field-bridge-2026" }

Write-Host "=== Phytospectra ngrok verify ===" -ForegroundColor Cyan
Write-Host "URL: $ngrokUrl"
Write-Host ""

# 1. Local uvicorn
Write-Host "[1] Local uvicorn :8000"
$listen = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($listen) { Write-Host "  OK - listening" -ForegroundColor Green }
else { Write-Host "  FAIL - run: .\scripts\start_home_server.ps1" -ForegroundColor Red }

# 2. ngrok HTTP health
Write-Host "[2] ngrok /api/health"
try {
  $r = Invoke-RestMethod -Uri "$ngrokUrl/api/health" -Headers $hdr -TimeoutSec 15
  Write-Host "  OK - $($r.status)" -ForegroundColor Green
} catch {
  Write-Host "  FAIL - $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  Is ngrok running? ngrok http 8000"
}

# 3. Bridge status
Write-Host "[3] ngrok /api/health/bridge"
try {
  $b = Invoke-RestMethod -Uri "$ngrokUrl/api/health/bridge" -Headers $hdr -TimeoutSec 15
  if ($b.field_laptop_ready) {
    Write-Host "  OK - field laptop connected ($($b.field_hostname))" -ForegroundColor Green
  } else {
    Write-Host "  WAITING - no user PC yet (status: $($b.status))" -ForegroundColor Yellow
    Write-Host "  User PC one-time: Install-Phytospectra-Camera.bat"
  }
} catch {
  Write-Host "  SKIP/FAIL - restart uvicorn to get /api/health/bridge" -ForegroundColor Yellow
}

# 4. WebSocket (Python)
Write-Host "[4] ngrok WebSocket /api/camera/bridge/ws"
$py = Join-Path $PSScriptRoot "..\venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
& $py -c @"
import asyncio
from websockets.asyncio.client import connect
async def t():
    uri = '$wsUrl/api/camera/bridge/ws?key=$bridgeKey&hostname=verify-script'
    h = {'ngrok-skip-browser-warning': 'true'} if 'ngrok' in uri else None
    try:
        async with connect(uri, additional_headers=h, open_timeout=15):
            print('  OK - WebSocket accepts connections')
    except Exception as e:
        print('  FAIL -', e)
asyncio.run(t())
"@

Write-Host ""
Write-Host "=== Vercel (phytospectra.vercel.app) must have ===" -ForegroundColor Cyan
Write-Host "  VITE_BACKEND_URL=$ngrokUrl"
Write-Host "  VITE_BACKEND_WS_URL=$($ngrokUrl -replace '^https','wss' -replace '^http','ws')"
Write-Host ""
Write-Host "=== User PC (one-time install — farmer never runs scripts) ===" -ForegroundColor Cyan
Write-Host "  Run once: .\scripts\install_user_pc_bridge.ps1"
Write-Host "  Then farmer: MAPIR Wi-Fi + USB internet → open app → Detect camera"
Write-Host ""
