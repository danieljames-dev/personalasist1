<#
.SYNOPSIS
  Non-admin launcher: elevates install-elevated-broker.ps1 via UAC (Owner clicks YES).
#>
[CmdletBinding()]
param(
    [string]$RepositoryRoot = 'C:\AION-HQ'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installScript = Join-Path $RepositoryRoot 'scripts\r65.1\install-elevated-broker.ps1'
if (-not (Test-Path -LiteralPath $installScript)) { throw "Missing $installScript" }

$argList = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-File', $installScript
    '-RepositoryRoot', $RepositoryRoot
)

Write-Host 'Launching elevated installer (UAC prompt — Owner may click YES)...'
$p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -Wait -PassThru
Write-Host "Elevated installer exit code: $($p.ExitCode)"
exit $p.ExitCode
