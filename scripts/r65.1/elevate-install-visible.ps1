# Visible UAC path for R6.5.1 install. Owner clicks YES once.
[CmdletBinding()]
param([string]$RepositoryRoot = 'C:\AION-HQ')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms | Out-Null
[System.Windows.Forms.MessageBox]::Show(
    "AION R6.5.1 will request Administrator permission (UAC).`n`nClick YES on the next Windows security prompt to install the Elevated Operator Broker.`n`nUAC will NOT be disabled. Your password is NOT stored.",
    'AION R6.5.1 Elevated Install',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null

$install = Join-Path $RepositoryRoot 'scripts\r65.1\install-elevated-broker.ps1'
$p = Start-Process -FilePath 'powershell.exe' -WorkingDirectory $RepositoryRoot -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $install, '-RepositoryRoot', $RepositoryRoot
) -Verb RunAs -Wait -PassThru
exit $p.ExitCode
