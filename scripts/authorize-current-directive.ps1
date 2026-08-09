[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$DirectivePath,
    [string]$AuthorizationInput,
    [switch]$TestMode,
    [switch]$SkipRepositoryChecks,
    [switch]$ValidationOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

try {
    $root=Resolve-AionGitRoot -StartPath $RepositoryRoot
    if(-not $DirectivePath){$DirectivePath=Join-Path $root '.aion-local\directives\CURRENT.md'}
    $directive=Get-AionDirective -Path $DirectivePath
    if($directive.Fields.Status -cne 'PENDING_OWNER_AUTHORIZATION'){
        throw "Authorization requires PENDING_OWNER_AUTHORIZATION; observed $($directive.Fields.Status)"
    }

    Write-Host "Directive ID : $($directive.Fields.'Directive-ID')"
    Write-Host "Title        : $($directive.Fields.Title)"
    Write-Host "Baseline     : $($directive.Fields.'Repository-Baseline')"
    Write-Host "`nAuthorized Scope:`n$(Get-AionDirectiveSection $directive.Text 'Authorized Scope')"
    Write-Host "`nProhibited Scope:`n$(Get-AionDirectiveSection $directive.Text 'Prohibited Scope')"

    $requiredPhrase = [string]$directive.Fields.'Required-Authorization-Phrase'
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ' THIS IS NOT A PASSWORD YOU CREATE.' -ForegroundColor Yellow
    Write-Host ' Type the EXACT authorization phrase below (copy/paste OK).' -ForegroundColor Yellow
    Write-Host ' Matching is case-sensitive. Extra spaces are trimmed.' -ForegroundColor Yellow
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host $requiredPhrase -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ''

    if($ValidationOnly){throw 'Validation-only refusal: no authorization phrase accepted'}
    if(-not $PSBoundParameters.ContainsKey('AuthorizationInput')){
        if($TestMode){throw 'TestMode requires explicit AuthorizationInput'}
        $AuthorizationInput=Read-Host 'Paste/type the EXACT phrase shown above (not a personal password)'
    }
    # Trim only; do not change case. Empty after trim still fails closed.
    if($null -ne $AuthorizationInput){
        $AuthorizationInput = $AuthorizationInput.Trim()
    }
    if(-not(Test-AionAuthorizationPhrase -Expected $requiredPhrase -Actual $AuthorizationInput)){
        throw 'Authorization phrase did not match exactly. This is not a Windows/login password and not a password you invent. Copy the Required-Authorization-Phrase from CURRENT.md exactly.'
    }
    if($SkipRepositoryChecks -and -not $TestMode){throw 'SkipRepositoryChecks is permitted only in TestMode'}
    if(-not $SkipRepositoryChecks){
        Assert-AionRepositoryGate -Root $root -ExpectedHead $directive.Fields.'Repository-Baseline' -RunVerification
    }
    Set-AionDirectiveStatus -Path $DirectivePath -From 'PENDING_OWNER_AUTHORIZATION' -To 'AUTHORIZED' -RecordAuthorization
    Write-Host 'Directive authorized locally. It was not staged, committed, or executed.'
    Write-Host 'Run VS Code task: AION: Run Current Directive'
    exit 0
}
catch { Write-Error "Founder authorization failed: $($_.Exception.Message)"; exit 1 }
