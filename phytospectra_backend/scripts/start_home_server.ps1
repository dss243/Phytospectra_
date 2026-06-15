# PC1 (home server) - run from phytospectra_backend folder
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "PC1 home server - stop old uvicorn on port 8000 if needed..."
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host "Starting uvicorn (Ctrl+C to stop). In another terminal: ngrok http 8000"
Write-Host 'Vercel VITE_BACKEND_URL = your PC1 ngrok https URL'
.\venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000
