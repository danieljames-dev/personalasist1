<#
.SYNOPSIS
  Owner folder selection → direct AION registration + import (no chat paste).

.DESCRIPTION
  Opens repeated folder pickers (ADD ANOTHER / Cancel = DONE).
  Validates roots, then calls local AION production API:
    import.approveAndIngest
  which: pre-import backup → register roots → recursive import.

  Absolute exclusion: C:\Users\nearm\all-projects-API
  Never requires copying SELECTED_PATH into chat.
#>
[CmdletBinding()]
param(
  [string]$AionApi = "http://127.0.0.1:31415/api/action",
  [switch]$DryRun
)

Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'

$blockedExact = @(
  'C:\Users\nearm\all-projects-API'
)
$blockedSubstrings = @(
  '\.ssh\',
  '\credentials\',
  '\password',
  '\secrets\',
  '\Windows\System32',
  '\Program Files',
  '\Program Files (x86)',
  '\AppData\Local\Google\Chrome\User Data',
  '\AppData\Local\Microsoft\Edge\User Data'
)

function Test-ImportRoot([string]$Path) {
  $p = $Path.TrimEnd('\')
  if ($p -match '^[A-Za-z]:\\?$') { return @{ Ok = $false; Reason = 'Whole drive rejected' } }
  $norm = $p.ToLowerInvariant()
  foreach ($b in $blockedExact) {
    $bb = $b.ToLowerInvariant().TrimEnd('\')
    if ($norm -eq $bb -or $norm.StartsWith($bb + '\')) {
      return @{ Ok = $false; Reason = 'Protected exclusion (all-projects-API)' }
    }
  }
  foreach ($s in $blockedSubstrings) {
    if ($norm.Contains($s.ToLowerInvariant())) {
      return @{ Ok = $false; Reason = "Blocked pattern: $s" }
    }
  }
  if (-not (Test-Path -LiteralPath $p -PathType Container)) {
    return @{ Ok = $false; Reason = 'Not a folder' }
  }
  return @{ Ok = $true; Reason = 'ok'; Path = $p }
}

Write-Host ""
Write-Host "============================================================"
Write-Host " AION — Direct folder approval (no path paste into chat)"
Write-Host "============================================================"
Write-Host ""
Write-Host "Suggested categories (labels only — you pick real folders):"
Write-Host "  CAREER / RESUME"
Write-Host "  BUSINESS"
Write-Host "  BRANDS"
Write-Host "  PROJECTS"
Write-Host "  PRODUCTS / SERVICES"
Write-Host "  SALES / CUSTOMER NOTES"
Write-Host "  COLLABORATORS"
Write-Host "  PERSONAL WORKING DOCUMENTS"
Write-Host ""
Write-Host "Click folders. Cancel dialog when finished selecting."
Write-Host "Blocked: whole drives, all-projects-API, credential/system paths."
Write-Host ""

$selected = New-Object System.Collections.Generic.List[string]
while ($true) {
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $n = $selected.Count + 1
  $dlg.Description = "AION root #$n — Cancel when DONE adding folders"
  $dlg.ShowNewFolderButton = $false
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { break }
  $check = Test-ImportRoot $dlg.SelectedPath
  if (-not $check.Ok) {
    Write-Host "REJECTED: $($dlg.SelectedPath) — $($check.Reason)"
    [System.Windows.Forms.MessageBox]::Show("Rejected: $($check.Reason)", "AION import", "OK", "Warning") | Out-Null
    continue
  }
  $path = $check.Path
  if ($selected -contains $path) {
    Write-Host "DUPLICATE: $path"
    continue
  }
  $selected.Add($path) | Out-Null
  Write-Host "ADDED: $path"
}

if ($selected.Count -eq 0) {
  Write-Host "CANCELLED — no folders selected."
  exit 1
}

Write-Host ""
Write-Host "----- CONFIRM SELECTION -----"
$i = 1
foreach ($p in $selected) {
  Write-Host "  $i. $p"
  $i++
}
Write-Host "-----------------------------"
$confirm = [System.Windows.Forms.MessageBox]::Show(
  ("Import these $($selected.Count) folder(s) into AION?`n`n" + ($selected -join "`n") + "`n`nAION will backup private state then ingest automatically."),
  "AION — confirm import roots",
  "YesNo",
  "Question"
)
if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
  Write-Host "ABORTED by Owner at confirm."
  exit 2
}

if ($DryRun) {
  Write-Host "DRY_RUN — would POST import.approveAndIngest"
  $selected | ForEach-Object { Write-Host "PATH=$_" }
  exit 0
}

# Health check
try {
  $null = Invoke-WebRequest -Uri "http://127.0.0.1:31415/" -UseBasicParsing -TimeoutSec 5
} catch {
  Write-Host "ERROR: AION production not reachable on http://127.0.0.1:31415/"
  Write-Host "Start with: powershell -File C:\AION-HQ\scripts\aion-production.ps1 -Action ensure"
  exit 3
}

$body = @{
  type  = "import.approveAndIngest"
  paths = @($selected.ToArray())
} | ConvertTo-Json -Depth 5

Write-Host ""
Write-Host "Calling AION: backup → register → import..."
try {
  $resp = Invoke-RestMethod -Uri $AionApi -Method Post -ContentType "application/json" -Body $body -TimeoutSec 600
} catch {
  Write-Host "API_ERROR: $($_.Exception.Message)"
  exit 4
}

$result = $resp.result
if (-not $result) { $result = $resp }

Write-Host ""
Write-Host "===== AION IMPORT RESULT ====="
Write-Host ($result | ConvertTo-Json -Depth 8)
Write-Host "=============================="
Write-Host ""
if ($result.ok -eq $true -or $result.message -match 'Backup OK') {
  Write-Host "DIRECT_FOLDER_APPROVAL=PASS"
  Write-Host "MANUAL_PATH_COPY_REQUIRED=NO"
  Write-Host "Ingestion continues inside AION — no chat paste required."
  exit 0
} else {
  Write-Host "DIRECT_FOLDER_APPROVAL=FAIL"
  Write-Host "Message: $($result.message)"
  exit 5
}
