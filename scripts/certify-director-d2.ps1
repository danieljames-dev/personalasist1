[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$DirectivePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

try {
    $root=Resolve-AionGitRoot -StartPath $RepositoryRoot
    if(-not $DirectivePath){$DirectivePath=Join-Path $root '.aion-local\directives\CURRENT.md'}
    $directive=Get-AionDirective -Path $DirectivePath
    $result=Invoke-AionD2FinalCertification -Root $root -Directive $directive
    Write-Host "D2 final certification GRANTED: $($result.Receipt.d2CertifiedSha)"
    Write-Host "SHA_A_PRIME: $($result.Receipt.shaAPrime)"
    Write-Host "Receipt: $($result.ReceiptPath)"
    Write-Host "State: $($result.StatePath)"
    exit 0
}
catch {
    Write-Error "D2 final certification failed: $($_.Exception.Message)"
    exit 1
}
