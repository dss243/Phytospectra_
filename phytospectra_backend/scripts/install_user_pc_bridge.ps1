# ONE-TIME setup on the user's PC (near MAPIR camera). Farmer never runs scripts after this.
# Run as the farmer once (or you pre-install before giving them the laptop).
#
# After install: bridge starts automatically at Windows login (hidden).
# Farmer only: MAPIR Wi-Fi + USB internet → open app → Detect camera.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$TaskName = "PhytospectraCameraBridge"
$BridgeScript = (Resolve-Path ".\scripts\user_pc_bridge.ps1").Path
$NgrokUrl = "https://unseeing-purity-reluctant.ngrok-free.dev"

Write-Host ""
Write-Host "=== Phytospectra — install once only (farmers) ===" -ForegroundColor Cyan
Write-Host "After this, the farmer never runs scripts — bridge auto-starts at login."
Write-Host ""

# Minimal Python env (no PyTorch — camera relay only)
if (-not (Test-Path ".\venv-bridge\Scripts\python.exe")) {
  Write-Host "Creating lightweight Python env (httpx + websockets)..."
  python -m venv venv-bridge
  .\venv-bridge\Scripts\pip.exe install --upgrade pip
  .\venv-bridge\Scripts\pip.exe install httpx websockets
}

# .env for field_agent (server URL — farmer never edits this if you set it now)
if (-not (Test-Path ".\.env")) {
  $custom = Read-Host "Home server URL [$NgrokUrl]"
  if ($custom.Trim()) { $NgrokUrl = $custom.Trim().TrimEnd("/") }
  @"
# User PC — auto camera bridge (do not share publicly)
HOME_SERVER_PUBLIC_URL=$NgrokUrl
CAMERA_BRIDGE_KEY=phytospectra-field-bridge-2026
CAMERA_IP=http://192.168.1.254
"@ | Set-Content -Path ".\.env" -Encoding utf8
  Write-Host "Created .env"
} else {
  Write-Host "Using existing .env"
}

# Windows scheduled task — start at login, hidden
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BridgeScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Phytospectra MAPIR camera bridge — connects to home server automatically" `
  | Out-Null

Write-Host ""
Write-Host "Installed." -ForegroundColor Green
Write-Host "  - Auto-starts at Windows login (background)"
Write-Host "  - Log: $env:LOCALAPPDATA\Phytospectra\camera-bridge.log"
Write-Host ""
Write-Host "Start bridge now? [Y/n]"
$now = Read-Host
if ($now -ne "n" -and $now -ne "N") {
  Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BridgeScript`""
  Write-Host "Bridge started in background."
}

Write-Host "Farmer workflow (install once only — never again):"
Write-Host "  1. MAPIR Wi-Fi + USB internet"
Write-Host "  2. Open phytospectra.vercel.app -> Detect camera"
Write-Host ""
