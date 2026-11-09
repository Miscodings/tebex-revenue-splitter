# Revenue Split launcher (Windows).
#   launcher.ps1                 start the server if needed, open the app window
#   launcher.ps1 -ServerOnly     start the server silently, no window (used at login)
#   launcher.ps1 -MonthlyOnly    start the server, open the window only on the 1st (once per day)
param([switch]$ServerOnly, [switch]$MonthlyOnly)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 3377
$url = "http://localhost:$port/#calc"
$dataDir = Join-Path $env:APPDATA 'RevenueSplit'
$marker = Join-Path $dataDir 'last-monthly-open.txt'

function Test-Server {
  try { Invoke-WebRequest -Uri "http://localhost:$port/api/report" -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Server)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Node.js 18+ is required. Install it from https://nodejs.org', 'Revenue Split') | Out-Null; exit 1 }
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 20 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
}

if ($ServerOnly) { exit 0 }

if ($MonthlyOnly) {
  $today = (Get-Date).ToString('yyyy-MM-dd')
  if ((Get-Date).Day -ne 1) { exit 0 }
  if ((Test-Path $marker) -and ((Get-Content $marker -ErrorAction SilentlyContinue) -eq $today)) { exit 0 }
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  Set-Content -Path $marker -Value $today
}

# App-style window (no tabs or address bar) using Edge or Chrome, whichever is installed.
$candidates = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$url", '--window-size=1280,860' }
else { Start-Process $url }
