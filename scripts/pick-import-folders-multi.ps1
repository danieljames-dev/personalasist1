<#
.SYNOPSIS
  Multi-folder picker for Owner-authorized real data import roots.

.DESCRIPTION
  Opens repeated folder pickers so Owner can select highest-value roots in one session.
  Prints SELECTED_PATH lines. Does not scan whole drives.
  Absolute exclusion: never suggest C:\Users\nearm\all-projects-API.
#>
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'
$blocked = @('C:\Users\nearm\all-projects-API', 'C:\Users\nearm\all-projects-API\')
$selected = New-Object System.Collections.Generic.List[string]

Write-Host "AION multi-folder import picker"
Write-Host "Select highest-value roots (career, brand, business, sales, personal docs)."
Write-Host "Cancel when finished. Whole drives are rejected. all-projects-API is blocked."
Write-Host ""

while ($true) {
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "AION: choose ONE import root (Cancel to finish)"
  $dlg.ShowNewFolderButton = $false
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { break }
  $path = $dlg.SelectedPath.TrimEnd('\')
  if ($path -match '^[A-Za-z]:\\?$') {
    Write-Host "REJECTED_WHOLE_DRIVE=$path"
    continue
  }
  $norm = $path.ToLowerInvariant()
  $bad = $false
  foreach ($b in $blocked) {
    if ($norm -eq $b.ToLowerInvariant().TrimEnd('\') -or $norm.StartsWith($b.ToLowerInvariant().TrimEnd('\') + '\')) {
      Write-Host "REJECTED_EXCLUDED=$path"
      $bad = $true
      break
    }
  }
  if ($bad) { continue }
  if ($selected -contains $path) {
    Write-Host "DUPLICATE=$path"
    continue
  }
  $selected.Add($path) | Out-Null
  Write-Host "SELECTED_PATH=$path"
}

if ($selected.Count -eq 0) {
  Write-Host "CANCELLED"
  exit 1
}

Write-Host ""
Write-Host "COUNT=$($selected.Count)"
Write-Host "Next: approve roots in AION Settings / import.roots then process each folder."
exit 0
