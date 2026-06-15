import { getBackendBaseUrl } from "@/lib/backend";

/** One-file Windows installer — install once, auto-starts at login. */
export function buildCameraSetupInstallerPs1(serverUrl: string): string {
  const url = serverUrl.trim().replace(/\/$/, "");
  const rawAgent =
    "https://raw.githubusercontent.com/dss243/Phytospectra_/main/phytospectra_backend/scripts/field_agent.py";

  return `# Phytospectra — one-time camera bridge setup
$ErrorActionPreference = "Stop"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Phytospectra\\bridge"
$TaskName = "PhytospectraCameraBridge"
$ServerUrl = "${url}"
$AgentUrl = "${rawAgent}"

Write-Host ""
Write-Host "Phytospectra camera setup (one time only)" -ForegroundColor Cyan
Write-Host "Install folder: $InstallRoot"
Write-Host ""

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "scripts") | Out-Null

@(
  "HOME_SERVER_PUBLIC_URL=$ServerUrl",
  "CAMERA_BRIDGE_KEY=phytospectra-field-bridge-2026",
  "CAMERA_IP=http://192.168.1.254"
) | Set-Content -Path (Join-Path $InstallRoot ".env") -Encoding utf8

Write-Host "Downloading camera bridge..."
Invoke-WebRequest -Uri $AgentUrl -OutFile (Join-Path $InstallRoot "scripts\\field_agent.py") -UseBasicParsing

$runnerPath = Join-Path $InstallRoot "run_bridge.ps1"
@'
$ErrorActionPreference = "Continue"
$Root = "INSTALL_ROOT_PLACEHOLDER"
Set-Location $Root
$logDir = Join-Path $env:LOCALAPPDATA "Phytospectra"
$logFile = Join-Path $logDir "camera-bridge.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
function Write-Log($msg) {
  Add-Content -Path $logFile -Value ("$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') " + $msg) -Encoding utf8
}
Write-Log "Phytospectra camera bridge starting"
$py = Join-Path $Root "venv-bridge\\Scripts\\python.exe"
$agent = Join-Path $Root "scripts\\field_agent.py"
while ($true) {
  if (-not (Test-Path $py)) { Write-Log "ERROR: venv missing"; Start-Sleep 60; continue }
  Write-Log "Starting field_agent"
  & $py $agent 2>&1 | ForEach-Object { Write-Log $_ }
  Write-Log "field_agent exited — retry in 10s"
  Start-Sleep 10
}
'@.Replace("INSTALL_ROOT_PLACEHOLDER", $InstallRoot) | Set-Content -Path $runnerPath -Encoding utf8

$pyExe = Join-Path $InstallRoot "venv-bridge\\Scripts\\python.exe"
if (-not (Test-Path $pyExe)) {
  Write-Host "Installing Python packages (first time only)..."
  python -m venv (Join-Path $InstallRoot "venv-bridge")
  & (Join-Path $InstallRoot "venv-bridge\\Scripts\\pip.exe") install --upgrade pip httpx websockets
}

Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$runnerPath\`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Phytospectra MAPIR camera bridge" | Out-Null

Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$runnerPath\`""

Write-Host ""
Write-Host "Done! Installed once — runs automatically from now on." -ForegroundColor Green
Write-Host "Next: MAPIR Wi-Fi + USB internet -> open app -> Detect camera"
Write-Host "Log: $env:LOCALAPPDATA\\Phytospectra\\camera-bridge.log"
Write-Host ""
Read-Host "Press Enter to close"
`;
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Download installer + tiny launcher .bat (same folder in Downloads). */
export function downloadCameraSetupInstaller() {
  const ps1 = buildCameraSetupInstallerPs1(getBackendBaseUrl());
  downloadBlob("Setup-Phytospectra-Camera.ps1", ps1);
  window.setTimeout(() => {
    const bat = `@echo off\r\ntitle Phytospectra setup\r\ncd /d "%~dp0"\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Phytospectra-Camera.ps1"\r\n`;
    downloadBlob("Setup-Phytospectra-Camera.bat", bat);
  }, 400);
}
