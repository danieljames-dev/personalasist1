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

    $standing=Resolve-AionStandingDirectiveAuthorization -Root $root -Directive $directive
    if((Get-AionDirectiveFieldOrDefault $directive 'Authority-Source' '') -ceq $script:AionOwnerStandingAuthoritySource){
        if($standing.outcome -ceq 'DENY'){throw "Standing authority denied: $($standing.reason)"}
        if($standing.outcome -ceq 'ALLOW_STANDING'){
            Write-Host "Directive ID : $($directive.Fields.'Directive-ID')"
            Write-Host "Title        : $($directive.Fields.Title)"
            Write-Host "Baseline     : $($directive.Fields.'Repository-Baseline')"
            Write-Host "Standing     : $($standing.reason)"
            if($ValidationOnly){throw 'Validation-only refusal: no authorization phrase accepted'}
            Set-AionDirectiveStatus -Path $DirectivePath -From 'PENDING_OWNER_AUTHORIZATION' -To 'AUTHORIZED'
            Write-Host 'Standing authority applied. No Owner phrase required.'
            exit 0
        }
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

    if(-not $PSBoundParameters.ContainsKey('AuthorizationInput')){
        if($TestMode){throw 'TestMode requires explicit AuthorizationInput'}
        if(-not $ValidationOnly){
            $AuthorizationInput=Read-Host 'Paste/type the EXACT phrase shown above (not a personal password)'
        }
    }
    # Trim only; do not change case. Empty after trim still fails closed.
    if($null -ne $AuthorizationInput){
        $AuthorizationInput = $AuthorizationInput.Trim()
    }
    if((-not $ValidationOnly) -and -not(Test-AionAuthorizationPhrase -Expected $requiredPhrase -Actual $AuthorizationInput)){
        throw 'Authorization phrase did not match exactly. This is not a Windows/login password and not a password you invent. Copy the Required-Authorization-Phrase from CURRENT.md exactly.'
    }
    if($SkipRepositoryChecks){
        if(-not $TestMode){throw 'SkipRepositoryChecks is permitted only in TestMode'}
        $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        $full=[IO.Path]::GetFullPath($root)
        if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){
            throw 'SkipRepositoryChecks is restricted to synthetic temp test repositories'
        }
    }
    if(-not $SkipRepositoryChecks){
        $class=Get-AionDirectiveFieldOrDefault $directive 'Authorization-Class' 'NORMAL'
        if($class -ceq 'NORMAL'){
            Assert-AionRepositoryGate -Root $root -ExpectedHead $directive.Fields.'Repository-Baseline' -RunVerification
            $certGate=Get-AionDirectiveFieldOrDefault $directive 'Trusted-Certification-Gate' ''
            if(-not[string]::IsNullOrWhiteSpace($certGate)){
                if($certGate -cne $script:AionD2FinalCertificationGateId){throw "Unsupported Trusted-Certification-Gate: $certGate"}
                [void](Assert-AionD2FinalCertificationPreflight -Root $root -Directive $directive)
            }
        } elseif($class -ceq 'BROKEN_BASELINE_REPAIR'){
            Assert-AionBrokenBaselineRepairGate -Root $root -Directive $directive
        } else {
            throw "Unsupported Authorization-Class: $class"
        }
    }
    if($ValidationOnly){throw 'Validation-only refusal: no authorization phrase accepted'}
    Set-AionDirectiveStatus -Path $DirectivePath -From 'PENDING_OWNER_AUTHORIZATION' -To 'AUTHORIZED' -RecordAuthorization
    [void](Write-AionOwnerMilestoneAuthorizationFromDirective -Root $root -Directive $directive -FounderPhraseVerified)
    Write-Host 'Directive authorized locally. It was not staged, committed, or executed.'
    Write-Host 'Run VS Code task: AION: Run Current Directive'
    exit 0
}
catch { Write-Error "Founder authorization failed: $($_.Exception.Message)"; exit 1 }
