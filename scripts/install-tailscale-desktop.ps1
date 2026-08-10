<#
.SYNOPSIS
  Installs Tailscale on the DESKTOP (private overlay for away-from-home AION phone access).

.DESCRIPTION
  AION never opens a public port. Away-from-home phone use needs a private overlay on both
  DESKTOP and PHONE. This script only installs/configures the desktop side via winget/MSI.
  Signing into Tailscale and installing the phone app remain Owner physical steps.

  Requires elevation (UAC). Safe to re-run.
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
  Write-Host "Elevation required. Re-launching with UAC..."
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $args | Out-Null
  exit 0
}

Write-Host "Installing Tailscale (desktop) for AION private remote access..."
$ts = @(
  "${env:ProgramFiles}\Tailscale\tailscale.exe",
  "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $ts) {
  winget install -e --id Tailscale.Tailscale --accept-package-agreements --accept-source-agreements --disable-interactivity
  $ts = @(
    "${env:ProgramFiles}\Tailscale\tailscale.exe",
    "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $ts) {
  Write-Error "Tailscale executable not found after install. Complete install from https://tailscale.com/download then re-run."
}

Write-Host "Tailscale CLI: $ts"
& $ts version
Write-Host ""
Write-Host "Next (Owner):"
Write-Host "  1. Open Tailscale on this desktop and sign in (same account as phone)."
Write-Host "  2. Install Tailscale on the phone, sign in, allow VPN."
Write-Host "  3. In AION Settings → Mobile: enable private access, bind=auto, restart AION."
Write-Host "  4. Pair the phone once with a code from Settings."
Write-Host "Done when: AION Mobile status shows private remote READY and an overlay URL."
