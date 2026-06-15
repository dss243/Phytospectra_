# Remove auto-start bridge from user PC
$TaskName = "PhytospectraCameraBridge"
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
  Unregister-ScheduledTask -Confirm:$false
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -like "*user_pc_bridge.ps1*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Removed $TaskName scheduled task."
