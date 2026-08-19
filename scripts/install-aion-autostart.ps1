# Install logon-triggered scheduled task to start AION production (R7).
# Does not require a Windows service. Owner must be logged on.
[CmdletBinding()]
param(
  [string]$RepositoryRoot = 'C:\AION-HQ',
  [string]$TaskName = 'AION-Production-CommandCenter',
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'

# Validate before registering anything: this script bakes $RepositoryRoot into a Scheduled Task, so a
# malformed root here becomes durable Windows configuration. -Remove is exempt — deleting a task by
# name does not depend on the root, and refusing to clean up because a path is wrong would be worse.
if (-not $Remove) {
  . (Join-Path $PSScriptRoot 'aion-repository-root.ps1')
  try { $RepositoryRoot = Assert-AionRepositoryRoot -Path $RepositoryRoot }
  catch { Write-Host "INVALID_REPOSITORY_ROOT $($_.Exception.Message)"; [Console]::Error.WriteLine($_.Exception.Message); exit 2 }
}

if ($Remove) {
  schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
  Write-Host "REMOVED $TaskName"
  exit 0
}
$tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RepositoryRoot\scripts\aion-production.ps1`" -Action start -RepositoryRoot `"$RepositoryRoot`""
schtasks /Create /TN $TaskName /TR $tr /SC ONLOGON /RL LIMITED /F /IT | Out-Host
Write-Host "INSTALLED $TaskName (ONLOGON interactive)"
Write-Host "Verify: schtasks /Query /TN $TaskName"
Write-Host "Manual: powershell -File $RepositoryRoot\scripts\aion-production.ps1 -Action status"
