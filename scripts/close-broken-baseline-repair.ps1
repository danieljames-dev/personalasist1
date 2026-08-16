[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$DirectivePath,
    [Parameter(Mandatory=$true)][string]$ReviewedDirectorSha
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

try {
    $root=Resolve-AionGitRoot -StartPath $RepositoryRoot
    if(-not $DirectivePath){$DirectivePath=Join-Path $root '.aion-local\directives\CURRENT.md'}
    $directive=Get-AionDirective -Path $DirectivePath
    Assert-AionBrokenBaselineRepairClosure -Root $root -Directive $directive -ReviewedDirectorSha $ReviewedDirectorSha
    exit 0
}
catch {
    Write-Error "Broken-baseline repair closure failed: $($_.Exception.Message)"
    exit 1
}
