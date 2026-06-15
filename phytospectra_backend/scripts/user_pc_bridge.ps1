# Runs in background (no window). Started automatically after one-time install.
$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$logDir = Join-Path $env:LOCALAPPDATA "Phytospectra"
$logFile = Join-Path $logDir "camera-bridge.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

Write-Log "Phytospectra camera bridge starting"

$py = Join-Path $Root "venv-bridge\Scripts\python.exe"
if (-not (Test-Path $py)) {
  $py = Join-Path $Root "venv\Scripts\python.exe"
}
if (-not (Test-Path $py)) {
  Write-Log "ERROR: Python venv not found — run install_user_pc_bridge.ps1 once"
  exit 1
}

$agent = Join-Path $Root "scripts\field_agent.py"
if (-not (Test-Path $agent)) {
  Write-Log "ERROR: field_agent.py missing"
  exit 1
}

while ($true) {
  Write-Log "Starting field_agent"
  & $py $agent 2>&1 | ForEach-Object { Write-Log $_ }
  Write-Log "field_agent exited — retry in 10s"
  Start-Sleep -Seconds 10
}
