[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [Parameter(Mandatory=$true)][string]$DirectiveId,
    [Parameter(Mandatory=$true)][string]$BaselineSha,
    [Parameter(Mandatory=$true)][string]$ResultSha,
    [Parameter(Mandatory=$true)][string]$ReviewedDirectorSha
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

try {
    $root=Resolve-AionGitRoot -StartPath $RepositoryRoot
    Assert-AionRepairClosureReceiptForPush -Root $root -DirectiveId $DirectiveId -ResultSha $ResultSha -BaselineSha $BaselineSha -ReviewedDirectorSha $ReviewedDirectorSha
    $branch=(& git -C $root branch --show-current).Trim()
    if($branch -cne 'main'){throw "Expected branch main; observed $branch"}
    $head=(& git -C $root rev-parse HEAD).Trim()
    if($head -cne $ResultSha){throw "HEAD/result mismatch: $head"}
    & git -C $root push origin main
    if($LASTEXITCODE -ne 0){throw "git push origin main failed with exit code $LASTEXITCODE"}
    Write-Host "Controlled repair push PASS: $ResultSha"
    exit 0
}
catch {
    Write-Error "Controlled repair push failed: $($_.Exception.Message)"
    exit 1
}
