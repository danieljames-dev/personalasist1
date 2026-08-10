# AION production process control (R7). Loopback Command Center on port 31415.
# Usage: -Action start|stop|status|restart
[CmdletBinding()]
param(
  [ValidateSet('start','stop','status','restart')]
  [string]$Action = 'status',
  [string]$RepositoryRoot = 'C:\AION-HQ',
  [int]$Port = 31415
)
$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $RepositoryRoot '.aion-local\production\aion.pid'
$logDir = Join-Path $RepositoryRoot '.aion-local\production'
$stdout = Join-Path $logDir 'aion.out.log'
$stderr = Join-Path $logDir 'aion.err.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-AionListener {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}
function Get-AionProcess {
  if (Test-Path $pidFile) {
    $id = [int](Get-Content $pidFile -Raw).Trim()
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p) { return $p }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'aion-command-center' } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
    Select-Object -First 1
}

function Start-Aion {
  if (Get-AionListener) { Write-Host "ALREADY_RUNNING port=$Port"; return 0 }
  Push-Location $RepositoryRoot
  try {
    & npm run aion:build --silent | Out-Null
    $p = Start-Process -FilePath 'node' -ArgumentList @('apps\aion-command-center.mjs','--port',"$Port") `
      -WorkingDirectory $RepositoryRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
      -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pidFile -Value $p.Id -Encoding ascii
    Start-Sleep -Seconds 2
    if (Get-AionListener) {
      Write-Host "STARTED pid=$($p.Id) port=$Port"
      return 0
    }
    Write-Host "START_FAILED see $stderr"
    return 1
  } finally { Pop-Location }
}

function Stop-Aion {
  $p = Get-AionProcess
  if ($p) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Host "STOPPED pid=$($p.Id)"
  } else {
    Write-Host "NOT_RUNNING"
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  return 0
}

function Status-Aion {
  $listener = Get-AionListener
  $p = Get-AionProcess
  $health = 'unreachable'
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/state" -UseBasicParsing -TimeoutSec 3
    $health = "HTTP $($r.StatusCode)"
  } catch { $health = "unreachable" }
  Write-Host "listener=$([bool]$listener) pid=$(if($p){$p.Id}else{'none'}) health=$health port=$Port"
  if ($listener -and $health -like 'HTTP 200*') { return 0 }
  return 1
}

switch ($Action) {
  'start' { exit (Start-Aion) }
  'stop' { exit (Stop-Aion) }
  'restart' { [void](Stop-Aion); Start-Sleep -Seconds 1; exit (Start-Aion) }
  'status' { exit (Status-Aion) }
}
