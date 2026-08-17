[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$DirectivePath,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

try {
    $root=Resolve-AionGitRoot -StartPath $RepositoryRoot
    if(-not $DirectivePath){$DirectivePath=Join-Path $root '.aion-local\directives\CURRENT.md'}
    $directive=Get-AionDirective -Path $DirectivePath
    $result=Invoke-AionReviewedDirectorPromotion -Root $root -Directive $directive -DryRun:$DryRun
    Write-Host "Director reviewed promotion PASS: SHA_A_PRIME=$($result.Receipt.shaAPrime)"
    Write-Host "Receipt: $($result.ReceiptPath)"
    if($DryRun){Write-Host 'Controlled push: DRY_RUN'}
    else{Write-Host "Controlled push PASS: $($result.Receipt.g7Sha)"}
    exit 0
}
catch {
    Write-Error "Director reviewed promotion failed: $($_.Exception.Message)"
    exit 1
}
