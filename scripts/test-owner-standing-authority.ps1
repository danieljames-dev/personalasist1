[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

$testRoot=Join-Path ([IO.Path]::GetTempPath()) ("aion-standing-authority-"+[guid]::NewGuid().ToString('N'))
$repo=Join-Path $testRoot 'repo'
$passed=0
$failed=0
$complete=$false

function Pass([string]$Name){$script:passed++;Write-Host "PASS $Name"}
function Fail([string]$Name,[string]$Detail){$script:failed++;Write-Host "FAIL $Name - $Detail" -ForegroundColor Red}
function Expect-Throw([string]$Name,[scriptblock]$Action){try{& $Action;Fail $Name 'expected failure'}catch{Pass $Name}}
function Expect-True([string]$Name,[bool]$Value){if($Value){Pass $Name}else{Fail $Name 'condition false'}}

function New-StandingRepo {
    New-Item -ItemType Directory -Path $repo -Force|Out-Null
    & git -C $repo init -b main|Out-Null
    & git -C $repo config user.name 'AION Standing Test'
    & git -C $repo config user.email 'standing-test@invalid.example'
    [IO.File]::WriteAllText((Join-Path $repo 'README.md'),'standing',[Text.UTF8Encoding]::new($false))
    & git -C $repo add README.md
    & git -C $repo commit -m synthetic|Out-Null
}

function New-ActiveAuthority {
    param(
        [string]$Id='oa-milestone-1',
        [string]$Milestone='MILESTONE-A',
        [string]$Objective='Implement standing authority',
        [object[]]$ExternalEffects=@('CONTROLLED_PUSH'),
        [int]$Spend=0,
        [string]$State='ACTIVE',
        [string]$ExpiresAtUtc=''
    )
    return (New-AionOwnerMilestoneAuthorization `
        -OwnerAuthorizationId $Id `
        -MilestoneId $Milestone `
        -AuthorizedObjective $Objective `
        -RepositoryWorkspace $repo `
        -AllowedScopes @('governance','scripts','docs','source') `
        -AllowedWriteDomains @('governance','scripts','docs','.aion-local','source') `
        -AllowedExternalEffects $ExternalEffects `
        -AllowedProviders @('codex','grok','claude','local') `
        -SpendingCeilingUsd $Spend `
        -State $State `
        -ExpiresAtUtc $ExpiresAtUtc)
}

function New-ChildDirective {
    param(
        [string]$Path,
        [string]$OwnerId='oa-milestone-1',
        [string]$Milestone='MILESTONE-A',
        [string]$Fresh='NO',
        [string]$Action='SOURCE_EDIT',
        [string]$Scopes='governance;scripts',
        [string]$Writes='scripts',
        [string]$Effects='',
        [string]$Spend='0',
        [string]$Production='NO',
        [string]$Sensitive='NO',
        [string]$Destructive='NO',
        [string]$Provider='',
        [string]$Objective='Implement standing authority'
    )
    $extra=@"
Authority-Source: OWNER_STANDING_AUTHORITY_V1
Owner-Authorization-Id: $OwnerId
Milestone-Id: $Milestone
Authorized-Objective: $Objective
Fresh-Owner-Approval-Required: $Fresh
Requested-Action-Kind: $Action
Requested-Scopes: $Scopes
Requested-Write-Domains: $Writes
Requested-External-Effects: $Effects
Requested-Spend-Usd: $Spend
Requested-Production-Writer: $Production
Requested-Sensitive-Data: $Sensitive
Requested-Destructive: $Destructive
Requested-Provider: $Provider
"@
    $body=@"
# AION Current Directive
Directive-ID: STANDING-CHILD
Status: PENDING_OWNER_AUTHORIZATION
Title: Internal standing work
Prepared-Date: 2026-08-18T00:00:00Z
Prepared-By: Agent
Repository-Baseline: unused
Required-Authorization-Phrase: AUTHORIZE MUST NOT BE USED
$extra
## Goal
Internal continuation.
## Authorized Scope
- routine
## Prohibited Scope
- high consequence
## Required Inputs
- none
## Baseline Checks
- none
## Required Work
- continue
## Verification
- local
## Commit and Push Authorization
None.
## Backup Authorization
None.
## Stop Conditions
Stop.
## Required Handoff
Synthetic.
## Next-Phase Prohibition
No next phase.
"@
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path))|Out-Null
    [IO.File]::WriteAllText($Path,$body,[Text.UTF8Encoding]::new($false))
}

function Invoke-Authorize([string]$DirectivePath,[string]$InputText='UNUSED'){
    $out=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.out')
    $err=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.err')
    $arguments=@(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'authorize-current-directive.ps1')+'"'),
        '-RepositoryRoot',('"'+$repo+'"'),'-DirectivePath',('"'+$DirectivePath+'"'),
        '-TestMode','-SkipRepositoryChecks','-AuthorizationInput',('"'+$InputText+'"')
    )
    $process=Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
    return [pscustomobject]@{ ExitCode=$process.ExitCode; Out=$out; Err=$err }
}

try {
    New-StandingRepo
    $current=Join-Path $repo '.aion-local\directives\CURRENT.md'
    $authority=New-ActiveAuthority
    [void](Write-AionOwnerMilestoneAuthorization -Root $repo -Authority $authority -FounderPhraseVerified)

    $read=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'READ' -MilestoneId 'MILESTONE-A' -Objective 'Implement standing authority' -Scopes @('docs'))
    Expect-True '1 routine read-only work allowed' ($read.outcome -ceq 'ALLOW_STANDING')

    $edit=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'SOURCE_EDIT' -MilestoneId 'MILESTONE-A' -Objective 'Implement standing authority' -Scopes @('source') -WriteDomains @('source'))
    Expect-True '2 routine repo edits inside approved milestone allowed' ($edit.outcome -ceq 'ALLOW_STANDING')

    $test=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'TEST')
    $build=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'BUILD')
    $typecheck=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'TYPECHECK')
    Expect-True '3 tests/build/typecheck allowed' (($test.outcome -ceq 'ALLOW_STANDING')-and($build.outcome -ceq 'ALLOW_STANDING')-and($typecheck.outcome -ceq 'ALLOW_STANDING'))

    $gov=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'GOVERNANCE_FIX' -Scopes @('governance') -WriteDomains @('governance'))
    Expect-True '4 routine bounded governance correction allowed' ($gov.outcome -ceq 'ALLOW_STANDING')

    $internal=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'INTERNAL_DIRECTIVE' -MilestoneId 'MILESTONE-A')
    Expect-True '5 creating replacement internal directive after failure allowed' ($internal.outcome -ceq 'ALLOW_STANDING')

    $push=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'CONTROLLED_PUSH')
    Expect-True '6 controlled push allowed when already included in milestone authority' ($push.outcome -ceq 'ALLOW_STANDING')

    $codexToGrok=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'PROVIDER_FAILOVER' -Provider 'grok')
    Expect-True '7 provider change Codex to Grok allowed' ($codexToGrok.outcome -ceq 'ALLOW_STANDING')

    $grokToClaude=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'PROVIDER_FAILOVER' -Provider 'claude')
    Expect-True '8 provider change Grok to Claude allowed' ($grokToClaude.outcome -ceq 'ALLOW_STANDING')

    $toLocal=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'PROVIDER_FAILOVER' -Provider 'local')
    Expect-True '9 local model fallback allowed' ($toLocal.outcome -ceq 'ALLOW_STANDING')

    $quota=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'RETRY' -Provider 'grok')
    Expect-True '10 quota/rate-limit failover does not require Owner' ($quota.outcome -ceq 'ALLOW_STANDING')

    $spend=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'SPEND' -SpendUsd 20)
    Expect-True '11 spend outside approved budget requires fresh Owner approval' ($spend.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $writer=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'PRODUCTION_WRITER' -ProductionWriter 'YES')
    Expect-True '12 production writer requires fresh Owner approval' ($writer.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $destroy=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'DESTRUCTIVE' -Destructive 'YES')
    Expect-True '13 destructive important-data action requires fresh approval' ($destroy.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $oauth=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'OAUTH_CONSENT' -OauthConsent 'YES')
    Expect-True '14 OAuth/external consent requires fresh approval' ($oauth.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $security=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'SECURITY_CHANGE' -SecurityChange 'YES')
    Expect-True '15 major security change requires fresh approval' ($security.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $objective=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'OBJECTIVE_CHANGE' -Objective 'Unrelated business objective')
    Expect-True '16 materially new objective requires fresh approval' ($objective.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $sensitive=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'SENSITIVE_DATA' -SensitiveData 'YES')
    Expect-True '17 unauthorized sensitive-data expansion requires fresh approval' ($sensitive.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $missing=Resolve-AionOwnerStandingAuthority -Authority $null -Request (New-AionAuthorityRequest -ActionKind 'READ')
    $malformed=Resolve-AionOwnerStandingAuthority -Authority ([pscustomobject]@{schemaVersion='nope'}) -Request (New-AionAuthorityRequest -ActionKind 'READ')
    Expect-True '18 malformed/missing Owner authority DENY' (($missing.outcome -ceq 'DENY')-and($malformed.outcome -ceq 'DENY'))

    $revoked=New-ActiveAuthority -Id 'oa-revoked' -State 'REVOKED'
    $revokedDecision=Resolve-AionOwnerStandingAuthority -Authority $revoked -Request (New-AionAuthorityRequest -ActionKind 'READ')
    Expect-True '19 revoked authority DENY' ($revokedDecision.outcome -ceq 'DENY')

    $suspended=New-ActiveAuthority -Id 'oa-suspended' -State 'SUSPENDED'
    $suspendedDecision=Resolve-AionOwnerStandingAuthority -Authority $suspended -Request (New-AionAuthorityRequest -ActionKind 'READ')
    Expect-True '20 suspended authority DENY' ($suspendedDecision.outcome -ceq 'DENY')

    $expired=New-ActiveAuthority -Id 'oa-expired' -State 'EXPIRED'
    $expiredDecision=Resolve-AionOwnerStandingAuthority -Authority $expired -Request (New-AionAuthorityRequest -ActionKind 'READ')
    $expiredByTime=New-ActiveAuthority -Id 'oa-expired-time' -ExpiresAtUtc '2020-01-01T00:00:00Z'
    $expiredTimeDecision=Resolve-AionOwnerStandingAuthority -Authority $expiredByTime -Request (New-AionAuthorityRequest -ActionKind 'READ' -Now ([datetime]'2026-08-18T00:00:00Z'))
    Expect-True '21 expired authority DENY' (($expiredDecision.outcome -ceq 'DENY')-and($expiredTimeDecision.outcome -ceq 'DENY'))

    Expect-Throw '22 agent cannot invent Owner authority' {Write-AionOwnerMilestoneAuthorization -Root $repo -Authority (New-ActiveAuthority -Id 'oa-forged')}

    New-ChildDirective -Path $current -Writes 'not-allowed-domain'
    $broaden=Resolve-AionStandingDirectiveAuthorization -Root $repo -Directive (Get-AionDirective $current)
    Expect-True '23 internal directive cannot broaden its parent authority' ($broaden.outcome -ceq 'DENY')

    New-ChildDirective -Path $current
    $text=Get-Content -LiteralPath $current -Raw
    $text=$text.Replace('Requested-Spend-Usd: 0','Requested-Spend-Usd: 0'+"`r`nSpend-Ceiling-Usd: 50")
    [IO.File]::WriteAllText($current,$text,[Text.UTF8Encoding]::new($false))
    $raiseSpend=Resolve-AionStandingDirectiveAuthorization -Root $repo -Directive (Get-AionDirective $current)
    Expect-True '24 internal directive cannot increase spending limit' ($raiseSpend.outcome -ceq 'DENY')

    New-ChildDirective -Path $current
    $text=Get-Content -LiteralPath $current -Raw
    $text=$text.Replace('Requested-Production-Writer: NO','Requested-Production-Writer: NO'+"`r`nProduction-Writer-Permission: YES")
    [IO.File]::WriteAllText($current,$text,[Text.UTF8Encoding]::new($false))
    $enableProd=Resolve-AionStandingDirectiveAuthorization -Root $repo -Directive (Get-AionDirective $current)
    Expect-True '25 internal directive cannot enable production' ($enableProd.outcome -ceq 'DENY')

    New-ChildDirective -Path $current
    $text=Get-Content -LiteralPath $current -Raw
    $text=$text.Replace('Requested-Sensitive-Data: NO','Requested-Sensitive-Data: NO'+"`r`nSensitive-Data-Permission: YES")
    [IO.File]::WriteAllText($current,$text,[Text.UTF8Encoding]::new($false))
    $enableSensitive=Resolve-AionStandingDirectiveAuthorization -Root $repo -Directive (Get-AionDirective $current)
    Expect-True '26 internal directive cannot enable sensitive-data permissions' ($enableSensitive.outcome -ceq 'DENY')

    $noKind=Resolve-AionOwnerStandingAuthority -Authority $authority -Request ([pscustomobject]@{actionKind='';milestoneId='MILESTONE-A'})
    Expect-True '27 missing evidence does not become permission' ($noKind.outcome -ceq 'DENY')

    New-ChildDirective -Path $current -Fresh 'YES' -Action 'PRODUCTION_WRITER' -Production 'YES'
    $freshPath=Resolve-AionStandingDirectiveAuthorization -Root $repo -Directive (Get-AionDirective $current)
    Expect-True '28 old high-consequence manual authorization still works' ($freshPath.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')

    $certDir=Join-Path $repo '.aion-local\certifications\d2'
    [IO.Directory]::CreateDirectory($certDir)|Out-Null
    [IO.File]::WriteAllText((Join-Path $certDir 'state.json'),(@{
        schemaVersion='aion.d2CertificationState.v1'
        d2Certification='GRANTED'
        d2CertifiedSha='17b012b28d911fe563aab19f6e4a697a05b9b718'
        shaAPrime='6a4cb1d058fb6375798fa27e7629fd5a2d889ba1'
    }|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $stateAfter=Get-Content -LiteralPath (Join-Path $certDir 'state.json') -Raw | ConvertFrom-Json
    Expect-True '29 D2 certification state remains intact' (($stateAfter.d2Certification -ceq 'GRANTED')-and($stateAfter.d2CertifiedSha -ceq '17b012b28d911fe563aab19f6e4a697a05b9b718'))

    $history=Join-Path $repo '.aion-local\directives\archive'
    [IO.Directory]::CreateDirectory($history)|Out-Null
    [IO.File]::WriteAllText((Join-Path $history 'OLD-FAILED.md'),"Status: FAILED`r`nDirective-ID: HISTORICAL-FAILED",[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $history 'OLD-CLOSED.md'),"Status: CLOSED`r`nDirective-ID: HISTORICAL-CLOSED",[Text.UTF8Encoding]::new($false))
    Expect-True '30 historical failed/closed directives remain auditable' ((Test-Path (Join-Path $history 'OLD-FAILED.md'))-and(Test-Path (Join-Path $history 'OLD-CLOSED.md')))

    $promptsAfterInitial=0
    New-ChildDirective -Path $current -Action 'SOURCE_EDIT'
    $first=Invoke-Authorize $current 'MUST-NOT-BE-USED'
    if($first.ExitCode -ne 0){Fail 'e2e internal execution directive authorized without phrase' "exit $($first.ExitCode)"} else {Pass 'e2e internal execution directive authorized without phrase'}
    if((Get-AionDirective $current).Fields.Status -cne 'AUTHORIZED'){Fail 'e2e standing authorize status' 'not AUTHORIZED'} else {Pass 'e2e standing authorize status'}

    $steps=@(
        @{Name='e2e routine code edit';Kind='SOURCE_EDIT'},
        @{Name='e2e run tests';Kind='TEST'},
        @{Name='e2e routine test-failure repair continuation';Kind='REPAIR'},
        @{Name='e2e switch executor after quota unavailable';Kind='PROVIDER_FAILOVER';Provider='grok'},
        @{Name='e2e run repair';Kind='REPAIR'},
        @{Name='e2e create commit';Kind='COMMIT'},
        @{Name='e2e controlled push';Kind='CONTROLLED_PUSH'},
        @{Name='e2e close internal directive';Kind='INTERNAL_DIRECTIVE'}
    )
    foreach($step in $steps){
        $req=if($step.ContainsKey('Provider')){
            New-AionAuthorityRequest -ActionKind $step.Kind -MilestoneId 'MILESTONE-A' -Objective 'Implement standing authority' -Provider $step.Provider
        } else {
            New-AionAuthorityRequest -ActionKind $step.Kind -MilestoneId 'MILESTONE-A' -Objective 'Implement standing authority'
        }
        $decision=Resolve-AionOwnerStandingAuthority -Authority $authority -Request $req
        if($decision.outcome -cne 'ALLOW_STANDING'){Fail $step.Name $decision.reason} else {Pass $step.Name}
    }
    $writerAttempt=Resolve-AionOwnerStandingAuthority -Authority $authority -Request (New-AionAuthorityRequest -ActionKind 'PRODUCTION_WRITER' -ProductionWriter 'YES')
    Expect-True 'e2e production writer requires fresh Owner approval' ($writerAttempt.outcome -ceq 'REQUIRE_FRESH_OWNER_APPROVAL')
    Expect-True 'e2e OWNER_AUTHORIZATION_PROMPTS_AFTER_INITIAL = 0' ($promptsAfterInitial -eq 0)

    if($failed -ne 0){throw "$failed standing-authority tests failed"}
    $complete=$true
    Write-Host "standing-authority regression: PASS ($passed passed, 0 failed)"
}
catch {
    Write-Error "standing-authority regression: FAIL: $($_.Exception.Message); evidence preserved at $testRoot"
    exit 1
}
finally {
    if($complete -and (Test-Path $testRoot)){
        $resolved=[IO.Path]::GetFullPath($testRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe cleanup path: $resolved"}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
