# Install logon-triggered scheduled task to start AION production (R7).
# Does not require a Windows service. Owner must be logged on.
[CmdletBinding()]
param(
  [string]$RepositoryRoot = 'C:\AION-HQ',
  [string]$TaskName = 'AION-Production-CommandCenter',
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
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
