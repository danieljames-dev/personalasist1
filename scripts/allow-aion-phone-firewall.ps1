<#
.SYNOPSIS
  Opens Windows Firewall for AION port 31415 so a Tailscale/LAN phone can connect.

.DESCRIPTION
  Required when the phone shows "can't connect" / infinite load while the desktop
  can open http://100.x.x.x:31415/ itself. Does NOT open the router to the public
  internet — only allows inbound TCP 31415 on this PC (used by Tailscale + LAN).

  Requires UAC elevation. Safe to re-run.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Write-Host "Requesting Administrator approval (UAC)..."
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit 0
}

$ruleName = 'AION-Command-Center-31415'
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

# Port rule — covers node.exe regardless of path; Tailscale adapter often uses Public profile
New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 31415 `
  -Profile Any `
  -Description 'AION Command Center private phone access (LAN + Tailscale). Not a router port forward.' | Out-Null

Write-Host "OK: Firewall allows inbound TCP 31415 (AION)."
Write-Host "On phone (Tailscale connected): http://$((& 'C:\Program Files\Tailscale\tailscale.exe' ip -4 2>$null | Select-Object -First 1).Trim()):31415/"
Write-Host "Press Enter to close."
[void][Console]::ReadLine()
