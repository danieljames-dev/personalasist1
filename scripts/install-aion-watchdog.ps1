# Install AION production logon start + lightweight recovery watchdog (R7 mobile durability).
# - ONLOGON: start production when Owner logs in
# - MINUTE/2: ensure (start only if down) so unexpected exit does not leave phone unreachable
# Does not require a Windows service. Uses existing aion-production.ps1 -Action ensure.
[CmdletBinding()]
param(
  [string]$RepositoryRoot = 'C:\AION-HQ',
  [string]$StartTaskName = 'AION-Production-CommandCenter',
  [string]$WatchTaskName = 'AION-Production-Watchdog',
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'

# Validate before registering anything: both task actions embed $RepositoryRoot, and this script also
# runs `ensure` immediately, so a malformed root would arm a watchdog that permanently fails to start
# production. -Remove is exempt — deletion is by task name and does not depend on the root.
if (-not $Remove) {
  . (Join-Path $PSScriptRoot 'aion-repository-root.ps1')
  try { $RepositoryRoot = Assert-AionRepositoryRoot -Path $RepositoryRoot }
  catch { Write-Host "INVALID_REPOSITORY_ROOT $($_.Exception.Message)"; [Console]::Error.WriteLine($_.Exception.Message); exit 2 }
}

if ($Remove) {
  schtasks /Delete /TN $StartTaskName /F 2>$null | Out-Null
  schtasks /Delete /TN $WatchTaskName /F 2>$null | Out-Null
  Write-Host "REMOVED $StartTaskName $WatchTaskName"
  exit 0
}

$prod = Join-Path $RepositoryRoot 'scripts\aion-production.ps1'
$startTr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$prod`" -Action start -RepositoryRoot `"$RepositoryRoot`""
$watchTr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$prod`" -Action ensure -RepositoryRoot `"$RepositoryRoot`""

# Logon start (interactive, current user)
schtasks /Create /TN $StartTaskName /TR $startTr /SC ONLOGON /RL LIMITED /F /IT | Out-Host

# Watchdog every 5 minutes — starts only when ensure finds AION down.
# Wider interval + production ensure lock/grace reduces thrash under load.
schtasks /Create /TN $WatchTaskName /TR $watchTr /SC MINUTE /MO 5 /RL LIMITED /F /IT | Out-Host

# Run ensure once now so recovery is armed immediately
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $prod -Action ensure -RepositoryRoot $RepositoryRoot

Write-Host "INSTALLED $StartTaskName (ONLOGON) + $WatchTaskName (every 5 min ensure)"
Write-Host "Verify: schtasks /Query /TN $StartTaskName & schtasks /Query /TN $WatchTaskName"
Write-Host "Manual: powershell -File $prod -Action status"
