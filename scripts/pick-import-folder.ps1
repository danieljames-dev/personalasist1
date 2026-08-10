<#
.SYNOPSIS
  Opens a folder picker and prints the selected absolute path for AION import.

.DESCRIPTION
  Browser security cannot expose arbitrary local folders to the web UI.
  Owner runs this on the desktop, pastes the printed path into Knowledge → Add Source.
  Does not scan drives. Does not start import — AION still requires the Owner to approve/import.
#>
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = "Choose ONE Owner folder for AION import (not a whole drive)"
$dlg.ShowNewFolderButton = $false
if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Host "CANCELLED"
  exit 1
}
$path = $dlg.SelectedPath
Write-Host "SELECTED_PATH=$path"
Write-Host ""
Write-Host "Next in AION Knowledge:"
Write-Host "  1) Approve import root (parent) if needed"
Write-Host "  2) Import folder now with this path"
Write-Host "  3) Or queue the path and Process next"
