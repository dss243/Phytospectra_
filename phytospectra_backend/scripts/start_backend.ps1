# Works on ANY PC - auto-detects field vs home
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$mapir = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "192.168.1.*" }

if ($mapir) {
  $task = Get-ScheduledTask -TaskName "PhytospectraCameraBridge" -ErrorAction SilentlyContinue
  if ($task) {
    Write-Host "User PC: camera bridge installed (auto-starts at login)."
    Write-Host "Starting background bridge now..."
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($PSScriptRoot\user_pc_bridge.ps1)`""
    Write-Host "Farmer: MAPIR Wi-Fi + USB internet -> open app -> Detect camera"
  } else {
    Write-Host "User PC (MAPIR detected): run ONE-TIME install first:"
    Write-Host "  Double-click Install-Phytospectra-Camera.bat"
    Write-Host "  OR: .\scripts\install_user_pc_bridge.ps1"
    $go = Read-Host "Run install now? [Y/n]"
    if ($go -ne "n" -and $go -ne "N") {
      & "$PSScriptRoot\install_user_pc_bridge.ps1"
    }
  }
} else {
  Write-Host "Role: HOME server (PC1)"
  & "$PSScriptRoot\start_home_server.ps1"
}
