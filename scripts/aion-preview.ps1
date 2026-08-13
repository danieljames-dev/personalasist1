# AION Daily-Intelligence preview — an isolated test runtime, deliberately not a second production.
#
# Why this exists: production runs `main` on port 31415 and must keep running untouched, while the
# Owner needs somewhere to physically test the feature branch from his phone. This starts the branch
# on its own port against its own copy of state, behind the existing tailnet-only HTTPS route.
#
# The isolation that matters is the state file. AION keeps one monolithic JSON document, and two
# processes writing it is how seventeen megabytes of the Owner's history gets truncated. The preview
# therefore writes to a copy under this worktree, and nothing it does can reach production.
#
# What this deliberately is NOT:
#   - not a scheduled task or service; it does not survive reboot by design
#   - not a replacement for the production launcher
#   - not public: Funnel stays off, the route is tailnet-only
#
# Usage:
#   scripts/aion-preview.ps1 -Start [-RefreshState]
#   scripts/aion-preview.ps1 -Status
#   scripts/aion-preview.ps1 -Stop

[CmdletBinding()]
param(
  [switch]$Start,
  [switch]$Stop,
  [switch]$Status,
  # Re-copies production state. Off by default: an Owner mid-test would lose what he just entered.
  [switch]$RefreshState,
  [int]$Port = 31416
)

$ErrorActionPreference = "Stop"
$worktree = Split-Path -Parent $PSScriptRoot
$previewRoot = Join-Path $worktree "private\aion"
$productionState = "C:\AION-HQ\private\aion\state-v1.json"

function Get-PreviewProcess {
  # Matched on the port it was started with rather than on a stored PID, which goes stale.
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match "aion-command-center" -and $_.CommandLine -match "--port\s+$Port" }
}

if ($Status) {
  $proc = Get-PreviewProcess
  if ($proc) {
    Write-Output "PREVIEW_RUNNING = YES"
    Write-Output "PREVIEW_PID = $($proc.ProcessId -join ', ')"
  } else {
    Write-Output "PREVIEW_RUNNING = NO"
  }
  Write-Output "PREVIEW_PORT = $Port"
  Write-Output "PREVIEW_STATE = $previewRoot"
  exit 0
}

if ($Stop) {
  $proc = Get-PreviewProcess
  if (-not $proc) { Write-Output "PREVIEW_RUNNING = NO"; exit 0 }
  foreach ($p in $proc) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Output "PREVIEW_STOPPED = YES"
  exit 0
}

if (-not $Start) {
  Write-Output "Pass -Start, -Stop or -Status."
  exit 1
}

if (Get-PreviewProcess) {
  Write-Output "PREVIEW_ALREADY_RUNNING = YES on port $Port"
  exit 0
}

New-Item -ItemType Directory -Force -Path $previewRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $previewRoot "exports") | Out-Null

$statePath = Join-Path $previewRoot "state-v1.json"
if ($RefreshState -or -not (Test-Path $statePath)) {
  if (Test-Path $productionState) {
    # Read-only on production's side: this copies out, never in.
    Copy-Item $productionState $statePath -Force
    Write-Output "PREVIEW_STATE_SOURCE = copy of production"
  } else {
    Write-Output "PREVIEW_STATE_SOURCE = fresh (no production state found)"
  }
} else {
  Write-Output "PREVIEW_STATE_SOURCE = existing preview copy (kept; pass -RefreshState to replace)"
}

# A stale lock from a killed preview would refuse a legitimate start. Production's lock lives under
# its own repository root and is never touched here.
$lock = Join-Path $worktree ".aion-local\production\instance.lock"
if (Test-Path $lock) { Remove-Item $lock -Force -ErrorAction SilentlyContinue }

$logDir = Join-Path $worktree ".aion-local\preview"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "preview.log"

Push-Location $worktree
try {
  Start-Process -FilePath "node" `
    -ArgumentList @("apps/aion-command-center.mjs", "--port", "$Port", "--data-root", "$previewRoot") `
    -WorkingDirectory $worktree `
    -RedirectStandardOutput $log `
    -RedirectStandardError "$log.err" `
    -WindowStyle Hidden | Out-Null
} finally {
  Pop-Location
}

Start-Sleep -Seconds 10
$proc = Get-PreviewProcess
if ($proc) {
  Write-Output "PREVIEW_RUNNING = YES"
  Write-Output "PREVIEW_PORT = $Port"
  Write-Output "PREVIEW_STATE_ISOLATION = ISOLATED_COPY"
  Write-Output "PREVIEW_LOG = $log"
} else {
  Write-Output "PREVIEW_RUNNING = NO"
  Write-Output "Check $log and $log.err"
  exit 1
}
