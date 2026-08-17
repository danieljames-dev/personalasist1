[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

$testRoot=Join-Path ([IO.Path]::GetTempPath()) ("aion-control-plane-"+[guid]::NewGuid().ToString('N'))
$repo=Join-Path $testRoot 'repo'
$passed=0
$failed=0
$complete=$false
$current=$null

function Pass([string]$Name){$script:passed++;Write-Host "PASS $Name"}
function Fail([string]$Name,[string]$Detail){$script:failed++;Write-Host "FAIL $Name - $Detail" -ForegroundColor Red}
function Expect-Throw([string]$Name,[scriptblock]$Action){try{& $Action;Fail $Name 'expected failure'}catch{Pass $Name}}
function Expect-True([string]$Name,[bool]$Value){if($Value){Pass $Name}else{Fail $Name 'condition false'}}

function Invoke-AuthorizationFixture([string]$InputText,[switch]$NoSkip){
    $out=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.out')
    $err=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.err')
    $arguments=@(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'authorize-current-directive.ps1')+'"'),
        '-RepositoryRoot',('"'+$repo+'"'),'-DirectivePath',('"'+$current+'"'),
        '-TestMode','-AuthorizationInput',('"'+$InputText+'"')
    )
    if(-not $NoSkip){$arguments+='-SkipRepositoryChecks'}
    $process=Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $out -RedirectStandardError $err
    return $process.ExitCode
}

function Invoke-RunValidationFixture([string]$FakeCodex){
    $out=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.out')
    $err=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.err')
    $arguments=@(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'run-current-directive.ps1')+'"'),
        '-RepositoryRoot',('"'+$repo+'"'),'-DirectivePath',('"'+$current+'"'),
        '-AgentsPath',('"'+(Join-Path $repo 'AGENTS.md')+'"'),'-CodexCommand',('"'+$FakeCodex+'"'),
        '-ValidationOnly','-TestMode'
    )
    $process=Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $out -RedirectStandardError $err
    return $process.ExitCode
}

function New-Directive([string]$Path,[string]$Status='PENDING_OWNER_AUTHORIZATION',[string]$Baseline='abc',[string]$Phrase='AUTHORIZE SYNTHETIC TEST'){
    $body=@"
# AION Current Directive
Directive-ID: TEST-DIRECTIVE
Status: $Status
Title: Synthetic Test
Prepared-Date: 2026-08-06T00:00:00Z
Prepared-By: CTO
Repository-Baseline: $Baseline
Required-Authorization-Phrase: $Phrase

## Goal
Test only.
## Authorized Scope
- synthetic test
## Prohibited Scope
- real work
## Required Inputs
- none
## Baseline Checks
- synthetic
## Required Work
- none
## Verification
- local only
## Commit and Push Authorization
None.
## Backup Authorization
None.
## Stop Conditions
Stop on failure.
## Required Handoff
Synthetic.
## Next-Phase Prohibition
No next phase.
"@
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path))|Out-Null
    [IO.File]::WriteAllText($Path,$body,[Text.UTF8Encoding]::new($false))
}

function New-RepairDirective(
    [string]$Path,
    [string]$Status,
    [string]$Baseline,
    [string]$Phrase='AUTHORIZE SYNTHETIC REPAIR',
    [string]$Extra='',
    [string]$GateId='LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY'
){
    $extraText=if([string]::IsNullOrWhiteSpace($Extra)){''}else{"$Extra`r`n"}
    $body=@"
# AION Current Directive
Directive-ID: TEST-REPAIR
Status: $Status
Title: Synthetic Broken Baseline Repair
Prepared-Date: 2026-08-06T00:00:00Z
Prepared-By: CTO
Repository-Baseline: $Baseline
Required-Authorization-Phrase: $Phrase
Authorization-Class: BROKEN_BASELINE_REPAIR
Known-Failing-Gate: $GateId
$extraText
## Goal
Repair a known failing gate only.
## Authorized Scope
- packages/local-assistant/src/developer-bridge.ts
## Prohibited Scope
- packages/director/**
- packages/local-assistant/test/architecture-boundary.test.mjs
## Required Inputs
- none
## Baseline Checks
- known gate red
## Required Work
- repair only
## Verification
- targeted gate, targeted typecheck, full verify
## Commit and Push Authorization
Controlled repair push only after closure receipt.
## Backup Authorization
None.
## Stop Conditions
Stop on failure.
## Required Handoff
Synthetic.
## Next-Phase Prohibition
No next phase.
"@
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path))|Out-Null
    [IO.File]::WriteAllText($Path,$body,[Text.UTF8Encoding]::new($false))
}

function New-PromotionDirective(
    [string]$Path,
    [string]$Status,
    [string]$Baseline,
    [string]$ReviewHash,
    [string]$Phrase='AUTHORIZE SYNTHETIC PROMOTION'
){
    $body=@"
# AION Current Directive
Directive-ID: TEST-PROMOTION
Status: $Status
Title: Synthetic Director Promotion
Prepared-Date: 2026-08-17T00:00:00Z
Prepared-By: CTO
Repository-Baseline: $Baseline
Required-Authorization-Phrase: $Phrase
Authorization-Class: BROKEN_BASELINE_REPAIR
Known-Failing-Gate: DIRECTOR_D2_REVIEWED_PROMOTION_AND_PUSH
Review-Artifact-Path: .aion-local/reviews/director-candidate-$($script:AionDirectorPromotionExpectedCandidateSha).json
Review-Artifact-Sha256: $ReviewHash

## Goal
Promote an exact reviewed Director candidate.
## Authorized Scope
- exact parent candidate promotion only
## Prohibited Scope
- certification
## Required Inputs
- synthetic
## Baseline Checks
- synthetic
## Required Work
- none
## Verification
- promotion preflight
## Commit and Push Authorization
Controlled promotion push only.
## Backup Authorization
None.
## Stop Conditions
Stop on failure.
## Required Handoff
Synthetic.
## Next-Phase Prohibition
No certification.
"@
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path))|Out-Null
    [IO.File]::WriteAllText($Path,$body,[Text.UTF8Encoding]::new($false))
}

function New-FakeNpm([string]$Dir,[string]$Mode){
    [IO.Directory]::CreateDirectory($Dir)|Out-Null
    $scriptPath=Join-Path $Dir 'npm.cmd'
    $body=@"
@echo off
set MODE=$Mode
if "%1"=="--prefix" shift
if not "%1"=="run" shift
if not "%1"=="run" exit /b 37
if "%2"=="verify" goto verify
if "%2"=="test" goto test
if "%2"=="test:architecture" goto architecture
if "%2"=="typecheck" goto typecheck
if "%2"=="aion:server:test" goto server
if "%2"=="career:test" exit /b 0
if "%2"=="build" exit /b 0
if "%2"=="build:test" exit /b 0
exit /b 37

:verify
if "%MODE%"=="verify-fail" exit /b 9
if "%MODE%"=="cert-full-verify-fail" exit /b 9
if "%MODE%"=="director-verify-misleading" goto directorverifyfail
if "%MODE%"=="director-structured-other-fail" goto directorverifyfail
exit /b 0

:test
if "%MODE%"=="cert-pass" if "%4"=="@aion/director" goto certdirector
if "%MODE%"=="cert-pass" if "%4"=="@aion/local-assistant" goto certlocal
if "%MODE%"=="cert-director-suite-fail" if "%4"=="@aion/director" goto certdirectorbad
if "%MODE%"=="cert-local-suite-fail" if "%4"=="@aion/local-assistant" goto certlocalbad
if "%MODE%"=="director-structured-other-fail" exit /b 4
if "%MODE%"=="broken" goto broken
if "%MODE%"=="wrong-text" goto wrongtext
if "%MODE%"=="other-exit" exit /b 2
exit /b 0

:server
if "%MODE%"=="director-broken" goto directorbroken
if "%MODE%"=="director-mojibake-only" goto directormojibake
if "%MODE%"=="director-wrong-text" goto wrongtext
if "%MODE%"=="director-other-exit" exit /b 2
exit /b 0

:broken
echo developer bridge is the single process boundary and is repository-scoped
echo packages/local-assistant/src/developer-bridge.ts contains process.env
echo npm error Lifecycle script `test` failed with error: 1>&2
exit /b 1

:wrongtext
echo unrelated failure
exit /b 1

:directorbroken
echo # Subtest: a resolved bridge refuses tasks aimed outside the one approved repository root
echo not ok 41 - a resolved bridge refuses tasks aimed outside the one approved repository root
echo developer-agent refused: another run holds this
echo # Subtest: no tracked text file contains double-encoded (mojibake) characters
echo not ok 93 - no tracked text file contains double-encoded (mojibake) characters
echo packages/director/src/git-truth.ts:12
echo npm error Lifecycle script `aion:server:test` failed with error: 1>&2
exit /b 1

:directormojibake
echo # Subtest: no tracked text file contains double-encoded (mojibake) characters
echo not ok 93 - no tracked text file contains double-encoded (mojibake) characters
echo packages/director/src/git-truth.ts:12
exit /b 1

:architecture
if "%MODE%"=="director-structured-known-wrong" goto wrongtext
if "%MODE%"=="director-structured-known-second" goto archsecond
goto broken

:typecheck
if "%MODE%"=="typecheck-fail" exit /b 8
exit /b 0

:directorverifyfail
echo developer bridge is the single process boundary and is repository-scoped
echo packages/local-assistant/src/developer-bridge.ts contains process.env
echo unrelated verification failure
exit /b 9

:archsecond
echo developer bridge is the single process boundary and is repository-scoped
echo packages/local-assistant/src/developer-bridge.ts contains process.env
echo not ok 99 - unrelated local assistant failure
exit /b 1

:certdirector
echo 1..1066
echo # tests 1066
echo # pass 1066
echo # fail 0
echo # skipped 0
echo # todo 0
exit /b 0

:certlocal
echo 1..1051
echo # tests 1051
echo # pass 1051
echo # fail 0
echo # skipped 0
echo # todo 0
exit /b 0

:certdirectorbad
echo 1..1066
echo # tests 1066
echo # pass 1065
echo # fail 1
echo # skipped 0
echo # todo 0
exit /b 1

:certlocalbad
echo 1..1051
echo # tests 1051
echo # pass 1050
echo # fail 1
echo # skipped 0
echo # todo 0
exit /b 1

"@
    [IO.File]::WriteAllText($scriptPath,$body,[Text.ASCIIEncoding]::new())
    return $scriptPath
}

function Add-RepairBaselineFiles([string]$Root){
    $src=Join-Path $Root 'packages\local-assistant\src'
    $test=Join-Path $Root 'packages\local-assistant\test'
    $distTest=Join-Path $Root 'packages\local-assistant\dist-test\test'
    $director=Join-Path $Root 'packages\director'
    $app=Join-Path $Root 'apps\aion'
    $aionTest=Join-Path $Root 'test\aion'
    [IO.Directory]::CreateDirectory($src)|Out-Null
    [IO.Directory]::CreateDirectory($test)|Out-Null
    [IO.Directory]::CreateDirectory($distTest)|Out-Null
    [IO.Directory]::CreateDirectory($director)|Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $director 'src'))|Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $director 'test'))|Out-Null
    [IO.Directory]::CreateDirectory($app)|Out-Null
    [IO.Directory]::CreateDirectory($aionTest)|Out-Null
    [IO.File]::WriteAllText((Join-Path $src 'developer-bridge.ts'),'export const broken = process.env.AION_TEST;',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $test 'architecture-boundary.test.mjs'),'assert boundary policy',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $test 'non-architecture.test.mjs'),'import test from "node:test"; test("synthetic non-architecture", () => {});',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $test 'compiled-only.test.ts'),'import test from "node:test"; test("compiled source", () => {});',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $distTest 'compiled-only.test.js'),'import test from "node:test"; test("compiled artifact", () => {});',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $director 'src\lease-store.ts'),'export const lease = "broken";',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $director 'src\git-truth.ts'),'export const truth = "mojibake";',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $director 'test\lease-store.test.ts'),'test',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $director 'test\wiring.test.ts'),'test',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $app 'developer-agent.mjs'),'export const agent = "broken";',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $aionTest 'developer-agent.test.mjs'),'test',[Text.UTF8Encoding]::new($false))
    & git -C $Root add apps packages test
    & git -C $Root commit -m 'add repair baseline files'|Out-Null
    return (& git -C $Root rev-parse HEAD).Trim()
}

function Write-ClosedRepairDirectiveFixture([string]$Root,[string]$DirectiveId,[string]$Baseline){
    $archive=Join-Path $Root '.aion-local\directives\archive'
    [IO.Directory]::CreateDirectory($archive)|Out-Null
    $path=Join-Path $archive "$DirectiveId-CLOSED.md"
    $body=@"
# AION Current Directive
Directive-ID: $DirectiveId
Status: CLOSED
Title: Synthetic Closed Director Repair
Prepared-Date: 2026-08-17T00:00:00Z
Prepared-By: CTO
Repository-Baseline: $Baseline
Required-Authorization-Phrase: AUTHORIZE CLOSED

## Goal
Closed synthetic repair.
## Authorized Scope
- synthetic
## Prohibited Scope
- synthetic
## Required Inputs
- synthetic
## Baseline Checks
- synthetic
## Required Work
- synthetic
## Verification
- synthetic
## Commit and Push Authorization
None.
## Backup Authorization
None.
## Stop Conditions
Stop.
## Required Handoff
Synthetic.
## Next-Phase Prohibition
No certification.
"@
    [IO.File]::WriteAllText($path,$body,[Text.UTF8Encoding]::new($false))
}

function Write-DirectorClosureReceiptFixture(
    [string]$Root,
    [string]$DirectiveId,
    [string]$Baseline,
    [string]$Candidate,
    [string]$ClosureResult='PASS'
){
    $dir=Join-Path $Root ".aion-local\repair-closures\$DirectiveId"
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $baselineDirectorTree=(& git -C $Root rev-parse "${Baseline}:packages/director").Trim()
    $candidateDirectorTree=(& git -C $Root rev-parse "${Candidate}:packages/director").Trim()
    $baselineLocalAssistantTree=(& git -C $Root rev-parse "${Baseline}:packages/local-assistant").Trim()
    $candidateLocalAssistantTree=(& git -C $Root rev-parse "${Candidate}:packages/local-assistant").Trim()
    $changed=@(& git -C $Root diff --name-only "$Baseline..$Candidate")
    $receipt=[pscustomobject]@{
        schemaVersion='aion.directorRecoveryCandidateClosure.v1'
        directiveId=$DirectiveId
        authorizationClass='BROKEN_BASELINE_REPAIR'
        gateId='DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        baselineSha=$Baseline
        candidateSha=$Candidate
        resultSha=$Candidate
        priorReviewedDirectorSha=$Baseline
        baselineDirectorTree=$baselineDirectorTree
        candidateDirectorTree=$candidateDirectorTree
        directorAnchorPolicy='CANDIDATE_REPLACEMENT'
        authorizedRepairPaths=@((Get-AionRepairGate 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE').TrustedAllowedPaths)
        actualChangedPaths=@($changed)
        localAssistantBaselineTree=$baselineLocalAssistantTree
        localAssistantCandidateTree=$candidateLocalAssistantTree
        localAssistantTreeIntegrity='PASS'
        structuredVerificationResult='PASS'
        structuredVerificationResults=@([pscustomobject]@{Name='test:@aion/director';ExitCode=0;Result='PASS'})
        knownRemainingFailureIds=@('LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY')
        rawFullVerifyResult=[pscustomobject]@{Name='raw:verify';ExitCode=1;Result='NONZERO_AUDIT_ONLY'}
        targetedRepairGateResult='PASS'
        targetedTypecheckResult='PASS'
        changedPathScopeResult='PASS'
        directorTreeDisposition='REPLACED_BY_AUTHORIZED_CANDIDATE'
        timestampUtc='2026-08-17T00:00:00Z'
        closureResult=$ClosureResult
    }
    [IO.File]::WriteAllText((Join-Path $dir "$Candidate.json"),($receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
}

function Write-ReviewArtifactFixture(
    [string]$Root,
    [string]$Candidate,
    [string]$Verdict='PASS',
    [int]$Blocking=0,
    [string]$Focused='PASS'
){
    $dir=Join-Path $Root '.aion-local\reviews'
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $path=Join-Path $dir "director-candidate-$Candidate.json"
    $review=[pscustomobject]@{
        candidateSha=$Candidate
        reviewFamily='Grok'
        verdict=$Verdict
        concreteBlockingDefects=$Blocking
        focusedTests=$Focused
        falseReleaseCounterexample='NO'
        falseRetentionCounterexample='NO'
        cleanupErrorHandlingSafe='YES'
        oneWriterSafety='PASS'
        foreignHolderSafety='PASS'
        filesChanged='NONE'
        timestampUtc='2026-08-17T00:00:00Z'
    }
    [IO.File]::WriteAllText($path,($review|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    return (Get-AionFileSha256 -Path $path)
}

function New-CertificationDirective([string]$Path,[string]$Status,[string]$G8,[string]$Target,[string]$Anchor,[string]$Phrase='AUTHORIZE SYNTHETIC D2 CERTIFICATION'){
    $body=@"
# AION Current Directive
Directive-ID: TEST-D2-CERTIFICATION
Status: $Status
Title: Synthetic D2 Final Certification Execution
Prepared-Date: 2026-08-17T00:00:00Z
Prepared-By: CTO
Repository-Baseline: $G8
Required-Authorization-Phrase: $Phrase
Authorization-Class: NORMAL
Trusted-Certification-Gate: DIRECTOR_D2_FINAL_CERTIFICATION
Certification-Target: $Target
Reviewed-Director-Anchor: $Anchor
D2-Certification: NOT_GRANTED
D2-Certified-Sha: NONE
R31: NONE
Production: UNTOUCHED
Writer-Launched: NO
Funnel: OFF
Spend-USD: 0

## Goal
Certify exact D2 target only.
## Authorized Scope
- run trusted certification only
## Prohibited Scope
- no source changes
## Required Inputs
- synthetic
## Baseline Checks
- synthetic
## Required Work
- synthetic
## Verification
- synthetic
## Commit and Push Authorization
None.
## Backup Authorization
None.
## Stop Conditions
Stop.
## Required Handoff
Synthetic.
## Next-Phase Prohibition
No R31.
"@
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path))|Out-Null
    [IO.File]::WriteAllText($Path,$body,[Text.UTF8Encoding]::new($false))
}

function Write-LocalAssistantClosureReceiptFixture(
    [string]$Root,
    [string]$DirectiveId,
    [string]$Baseline,
    [string]$Target,
    [string]$Anchor,
    [string]$ClosureResult='PASS'
){
    $dir=Join-Path $Root ".aion-local\repair-closures\$DirectiveId"
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $anchorDirectorTree=(& git -C $Root rev-parse "${Anchor}:packages/director").Trim()
    $targetDirectorTree=(& git -C $Root rev-parse "${Target}:packages/director").Trim()
    $receipt=[pscustomobject]@{
        schemaVersion='aion.brokenBaselineRepairClosure.v1'
        directiveId=$DirectiveId
        authorizationClass='BROKEN_BASELINE_REPAIR'
        knownFailingGateId='LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY'
        baselineSha=$Baseline
        resultSha=$Target
        authorizedRepairPaths=@('packages/local-assistant/src/developer-bridge.ts')
        actualChangedPaths=@('packages/local-assistant/src/developer-bridge.ts')
        protectedFileIntegrityResult='PASS'
        targetedRepairGateResult='PASS'
        targetedTypecheckResult='PASS'
        fullVerifyResult='PASS'
        changedPathScopeResult='PASS'
        reviewedDirectorSha=$Anchor
        reviewedDirectorTree=$anchorDirectorTree
        resultDirectorTree=$targetDirectorTree
        directorTreeEquivalence='PASS'
        timestampUtc='2026-08-17T00:00:00Z'
        closureResult=$ClosureResult
    }
    [IO.File]::WriteAllText((Join-Path $dir "$Target.json"),($receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
}

function Write-PromotionReceiptFixture([string]$Root,[string]$G7,[string]$Candidate,[string]$CandidateBaseline,[string]$DirectiveId='TEST-REPAIR',[string]$Result='PASS',[int]$Blocking=0){
    $dir=Join-Path $Root ".aion-local\promotions\D2-DIRECTOR-REVIEWED-PROMOTION-PUSH-20260817T060000Z"
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $receipt=[pscustomobject]@{
        schemaVersion='aion.directorReviewedPromotion.v1'
        directiveId='D2-DIRECTOR-REVIEWED-PROMOTION-PUSH-20260817T060000Z'
        g7Sha=$G7
        candidateSha=$Candidate
        candidateBaselineSha=$CandidateBaseline
        closedRepairDirectiveId=$DirectiveId
        closureResult='PASS'
        reviewShaBinding='EXACT'
        reviewVerdict=$Result
        concreteBlockingDefects=$Blocking
        candidateChangedPaths=@((Get-AionRepairGate 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE').TrustedAllowedPaths)
        governanceChangedPaths=@('scripts/control-plane-common.ps1','scripts/promote-reviewed-director.ps1','scripts/test-control-plane.ps1')
        localAssistantTreeIntegrity='PASS'
        promotionResult='PASS'
        shaAPrime=$Candidate
        remoteBeforePush=$CandidateBaseline
        remoteAfterPush=$G7
        pushResult='PASS'
        d2Certification='NOT_GRANTED'
        timestampUtc='2026-08-17T00:00:00Z'
    }
    [IO.File]::WriteAllText((Join-Path $dir "$G7.json"),($receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
}

try {
    New-Item -ItemType Directory -Path $repo -Force|Out-Null
    & git -C $repo init -b main|Out-Null
    & git -C $repo config user.name 'AION Control Test'
    & git -C $repo config user.email 'control-test@invalid.example'
    & git -C $repo config core.autocrlf false
    & git -C $repo remote add origin $script:AionCanonicalOrigin
    [IO.File]::WriteAllText((Join-Path $repo '.gitignore'),".aion-local/`n",[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $repo 'README.md'),'synthetic',[Text.UTF8Encoding]::new($false))
    & git -C $repo add README.md .gitignore
    & git -C $repo commit -m synthetic|Out-Null
    $head=(& git -C $repo rev-parse HEAD).Trim()
    $local=Join-Path $repo '.aion-local'
    $current=Join-Path $local 'directives\CURRENT.md'

    Expect-Throw '1 missing CURRENT fails' {Get-AionDirective -Path $current|Out-Null}
    [IO.Directory]::CreateDirectory((Split-Path $current))|Out-Null;[IO.File]::WriteAllText($current,'',[Text.UTF8Encoding]::new($false))
    Expect-Throw '2 empty CURRENT fails' {Get-AionDirective -Path $current|Out-Null}
    New-Directive $current 'INVALID'
    Expect-Throw '3 invalid status fails' {Get-AionDirective -Path $current|Out-Null}
    New-Directive $current 'PENDING_OWNER_AUTHORIZATION'
    Expect-Throw '4 pending cannot run' {Assert-AionRunnableDirective (Get-AionDirective $current)}
    New-Directive $current 'AUTHORIZED'
    try{Assert-AionRunnableDirective (Get-AionDirective $current);Pass '5 authorized passes status gate'}catch{Fail '5 authorized passes status gate' $_.Exception.Message}

    New-Directive $current 'PENDING_OWNER_AUTHORIZATION' $head
    $wrongExit=Invoke-AuthorizationFixture 'wrong'
    Expect-True '6 incorrect phrase fails' ($wrongExit -ne 0)
    $exactExit=Invoke-AuthorizationFixture 'AUTHORIZE SYNTHETIC TEST'
    Expect-True '7 exact fixture phrase succeeds' (($exactExit -eq 0)-and((Get-AionDirective $current).Fields.Status -ceq 'AUTHORIZED'))

    Expect-Throw '8 dirty baseline fails' {Assert-AionBaselineValues $head main $head $script:AionCanonicalOrigin 0 0 @(' M README.md')}
    Expect-Throw '9 wrong HEAD fails' {Assert-AionBaselineValues 'expected' main 'wrong' $script:AionCanonicalOrigin 0 0 @()}
    Expect-Throw '10 wrong origin fails' {Assert-AionBaselineValues $head main $head 'https://invalid.example/repo.git' 0 0 @()}
    Expect-Throw '11 missing AGENTS fails' {Assert-AionRunDependencies (Join-Path $repo 'AGENTS.md') 'powershell'}
    [IO.File]::WriteAllText((Join-Path $repo 'AGENTS.md'),'synthetic',[Text.UTF8Encoding]::new($false))
    Expect-Throw '12 missing Codex executable fails' {Assert-AionRunDependencies (Join-Path $repo 'AGENTS.md') 'definitely-missing-aion-codex'}

    $handoff=Join-Path $local 'handoffs\LATEST.md';[IO.Directory]::CreateDirectory((Split-Path $handoff))|Out-Null
    New-Directive $current 'AWAITING_CTO_REVIEW';[IO.File]::WriteAllText($handoff,'',[Text.UTF8Encoding]::new($false))
    Expect-Throw '13 empty handoff cannot succeed' {Assert-AionPostRun $current $handoff}
    New-Directive $current 'AUTHORIZED';[IO.File]::WriteAllText($handoff,'complete',[Text.UTF8Encoding]::new($false))
    Expect-Throw '14 unchanged AUTHORIZED cannot succeed' {Assert-AionPostRun $current $handoff}
    New-Directive $current 'AWAITING_CTO_REVIEW'
    try{Assert-AionPostRun $current $handoff;Pass '15 review status and handoff pass'}catch{Fail '15 review status and handoff pass' $_.Exception.Message}

    $allLocal=@(Get-ChildItem $local -Recurse -File|?{-not $_.FullName.StartsWith($local,[StringComparison]::OrdinalIgnoreCase)})
    Expect-True '16 local files stay under .aion-local' ($allLocal.Count -eq 0)
    & git -C $repo check-ignore -q .aion-local/directives/CURRENT.md
    Expect-True '17 .aion-local ignored' ($LASTEXITCODE -eq 0)
    $staged=@(& git -C $repo diff --cached --name-only)
    Expect-True '18 local state is not staged' (@($staged|?{$_-like '.aion-local/*'}).Count -eq 0)
    $relativeDir=Join-Path $repo 'nested\path'
    [IO.Directory]::CreateDirectory($relativeDir)|Out-Null
    $relativeFile=Join-Path $relativeDir 'child.test.mjs'
    [IO.File]::WriteAllText($relativeFile,'test file',[Text.UTF8Encoding]::new($false))
    Expect-True '18a PS5 relative helper maps child file' ((Get-AionRepositoryRelativePath -Root $repo -Path $relativeFile) -ceq 'nested/path/child.test.mjs')
    Expect-True '18b PS5 relative helper maps nested directory' ((Get-AionRepositoryRelativePath -Root $repo -Path $relativeDir) -ceq 'nested/path')
    Expect-True '18c PS5 relative helper maps repository root deterministically' ((Get-AionRepositoryRelativePath -Root $repo -Path $repo) -ceq '.')
    Expect-True '18d PS5 relative helper normalizes separators' (-not((Get-AionRepositoryRelativePath -Root $repo -Path $relativeFile).Contains('\')))
    $evilRoot="$repo-evil"
    [IO.Directory]::CreateDirectory($evilRoot)|Out-Null
    $evilFile=Join-Path $evilRoot 'owned.txt'
    [IO.File]::WriteAllText($evilFile,'evil',[Text.UTF8Encoding]::new($false))
    Expect-Throw '18e PS5 relative helper rejects sibling prefix attack' {Get-AionRepositoryRelativePath -Root $repo -Path $evilFile|Out-Null}
    $outsideFile=Join-Path $testRoot 'outside.txt'
    [IO.File]::WriteAllText($outsideFile,'outside',[Text.UTF8Encoding]::new($false))
    Expect-Throw '18f PS5 relative helper rejects parent traversal outside root' {Get-AionRepositoryRelativePath -Root $repo -Path (Join-Path $repo '..\outside.txt')|Out-Null}
    Remove-Item -LiteralPath (Join-Path $repo 'nested') -Recurse -Force
    & git -C $repo add AGENTS.md
    & git -C $repo commit -m 'add synthetic agents'|Out-Null
    $runHead=(& git -C $repo rev-parse HEAD).Trim()
    & git -C $repo update-ref refs/remotes/origin/main $runHead
    New-Directive $current 'AUTHORIZED' $runHead
    $marker=Join-Path $testRoot 'codex-launched.marker'
    $fakeCodex=Join-Path $testRoot 'fake-codex.cmd'
    [IO.File]::WriteAllText($fakeCodex,"@echo launched>`"$marker`"`r`nexit /b 0`r`n",[Text.ASCIIEncoding]::new())
    $originBefore=(& git -C $repo rev-parse refs/remotes/origin/main).Trim()
    $validationExit=Invoke-RunValidationFixture $fakeCodex
    Expect-True '19 test mode never launches Codex' (($validationExit-eq 0)-and(-not(Test-Path $marker))-and(-not(Test-Path (Join-Path $local 'prompts'))))
    $runnerSource=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'run-current-directive.ps1') -Raw
    $originAfter=(& git -C $repo rev-parse refs/remotes/origin/main).Trim()
    $networkTokens=@('Invoke-WebRequest','Invoke-RestMethod','Start-BitsTransfer','curl ','--search')
    Expect-True '20 test mode performs no network access' (($originBefore-ceq$originAfter)-and(@($networkTokens|?{$runnerSource.Contains($_)}).Count-eq 0))

    New-Directive $current 'PENDING_OWNER_AUTHORIZATION' $head
    Add-Content -LiteralPath $current -Value "`r`nStatus: AWAITING_CTO_REVIEW"
    Expect-Throw '21 duplicate Status fields fail parsing' {Get-AionDirective -Path $current|Out-Null}
    $templatePath=Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\directives\CURRENT.template.md'
    $templateText=Get-Content -LiteralPath $templatePath -Raw
    Expect-True '22 tracked directive template has exactly one Status field' (([regex]::Matches($templateText,'(?m)^Status:\s*')).Count-eq 1)

    $repairBaseline=Add-RepairBaselineFiles $repo
    & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
    $fakeBin=Join-Path $testRoot 'fake-bin'
    $oldPath=$env:PATH
    $env:PATH="$fakeBin;$env:PATH"
    try {
        New-FakeNpm $fakeBin 'verify-fail'|Out-Null
        New-Directive $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE NORMAL'
        $normalExit=Invoke-AuthorizationFixture 'AUTHORIZE NORMAL' -NoSkip
        Expect-True '23 normal authorization still requires full verify' (($normalExit -ne 0)-and((Get-AionDirective $current).Fields.Status -ceq 'PENDING_OWNER_AUTHORIZATION'))

        New-FakeNpm $fakeBin 'broken'|Out-Null
        $cwdBefore=(Get-Location).Path
        $eapBefore=$ErrorActionPreference
        $ErrorActionPreference='Stop'
        try {
            $nativeResult=Invoke-AionTrustedVector -Root $repo -Vector @('npm.cmd','run','test','--workspace','@aion/local-assistant')
            $nativeText=$nativeResult.Output -join "`n"
            Expect-True '24 trusted native stderr exit 1 returns result' ($nativeResult.ExitCode -eq 1)
            Expect-True '25 trusted native stdout is captured' ($nativeText -match 'developer bridge is the single process boundary and is repository-scoped')
            Expect-True '26 trusted native stderr is captured' ($nativeText -match 'npm error Lifecycle script')
            Expect-True '27 caller CWD is restored after trusted native command' ((Get-Location).Path -ceq $cwdBefore)
            Expect-True '28 caller ErrorActionPreference is restored after trusted native command' ($ErrorActionPreference -ceq 'Stop')
        }
        catch { Fail '24 trusted native stderr exit 1 returns result' $_.Exception.Message }
        finally {
            $ErrorActionPreference=$eapBefore
        }
        Expect-Throw '29 trusted native launch failure fails closed' {Invoke-AionTrustedVector -Root $repo -Vector @('definitely-missing-aion-native-command.exe')|Out-Null}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline
        $repairDirective=Get-AionDirective $current
        $gateEapBefore=$ErrorActionPreference
        $ErrorActionPreference='Stop'
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive $repairDirective;Pass '30 repair authorization accepts known failing gate under Stop'}catch{Fail '30 repair authorization accepts known failing gate under Stop' $_.Exception.Message}
        finally {$ErrorActionPreference=$gateEapBefore}
        $repairExit=Invoke-AuthorizationFixture 'AUTHORIZE SYNTHETIC REPAIR' -NoSkip
        Expect-True '31 repair authorization records AUTHORIZED through Founder path' (($repairExit -eq 0)-and((Get-AionDirective $current).Fields.Status -ceq 'AUTHORIZED'))

        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline
        $badPhraseExit=Invoke-AuthorizationFixture 'wrong repair phrase' -NoSkip
        Expect-True '32 repair authorization rejects wrong phrase' (($badPhraseExit -ne 0)-and((Get-AionDirective $current).Fields.Status -ceq 'PENDING_OWNER_AUTHORIZATION'))
        $realRepo=(Split-Path -Parent $PSScriptRoot)
        $skipOut=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.out')
        $skipErr=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.err')
        $skipProcess=Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'authorize-current-directive.ps1')+'"'),
            '-RepositoryRoot',('"'+$realRepo+'"'),'-DirectivePath',('"'+$current+'"'),
            '-TestMode','-SkipRepositoryChecks','-AuthorizationInput','"AUTHORIZE SYNTHETIC REPAIR"'
        ) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $skipOut -RedirectStandardError $skipErr
        Expect-True '33 skip repository checks forbidden outside temp' ($skipProcess.ExitCode -ne 0)

        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Authorization-Class: OTHER'
        Expect-Throw '34 duplicate repair class rejected' {Get-AionDirectiveFieldOrDefault (Get-AionDirective $current) 'Authorization-Class'|Out-Null}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Known-Failing-Gate: UNKNOWN_GATE'
        Expect-Throw '35 unknown repair gate rejected' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: package.json'
        Expect-Throw '36 repair allowlist cannot broaden scope' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: ../outside'
        Expect-Throw '37 repair allowlist rejects traversal' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: packages/*'
        Expect-Throw '38 repair allowlist rejects globs' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: packages\local-assistant\src\developer-bridge.ts'
        Expect-Throw '39 repair allowlist rejects backslashes' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}

        New-FakeNpm $fakeBin 'wrong-text'|Out-Null
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline
        Expect-Throw '40 known gate requires expected failure text' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'other-exit'|Out-Null
        Expect-Throw '41 known gate requires expected failure exit code' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'fixed'|Out-Null
        Expect-Throw '42 already-green gate cannot authorize repair' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'broken'|Out-Null
        $sentinel=Join-Path $testRoot 'directive-command-ran.txt'
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' "Known-Failing-Command: cmd /c echo BAD > $sentinel"
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current);Pass '43 directive command fields are ignored'}catch{Fail '43 directive command fields are ignored' $_.Exception.Message}
        Expect-True '44 directive command text is not executed' (-not(Test-Path $sentinel))
        Expect-Throw '45 repair gate enforces main branch' {Assert-AionBaselineValues $repairBaseline 'feature/test' $repairBaseline $script:AionCanonicalOrigin 0 0 @()}
        Expect-Throw '46 repair gate enforces origin parity' {Assert-AionBaselineValues $repairBaseline main $repairBaseline $script:AionCanonicalOrigin 1 0 @()}

        New-FakeNpm $fakeBin 'director-broken'|Out-Null
        $oldDirectorKnownBrokenBaseline=$script:AionDirectorRecoveryKnownBrokenBaselineSha
        $oldReviewedDirectorSha=$script:AionReviewedDirectorSha
        $script:AionDirectorRecoveryKnownBrokenBaselineSha=$repairBaseline
        $script:AionReviewedDirectorSha=$repairBaseline
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current);Pass '47 director repair gate accepts deterministic known-broken identity'}catch{Fail '47 director repair gate accepts deterministic known-broken identity' $_.Exception.Message}
        New-FakeNpm $fakeBin 'director-wrong-text'|Out-Null
        Expect-Throw '48 director repair gate requires source-hygiene failure signature' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'director-other-exit'|Out-Null
        Expect-Throw '49 director repair gate requires expected failure exit' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'director-broken'|Out-Null
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' 'Allowed-Repair-Files: packages/local-assistant/src/developer-bridge.ts' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        Expect-Throw '50 director repair gate rejects local-assistant repair path' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' 'Allowed-Repair-Files: package.json' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        Expect-Throw '51 director repair gate rejects unauthorized broad path' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' 'Allowed-Repair-Files: apps/aion/developer-agent.mjs;packages/director/src/lease-store.ts' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current);Pass '52 director repair gate accepts strict subset of trusted paths'}catch{Fail '52 director repair gate accepts strict subset of trusted paths' $_.Exception.Message}
        $directorGate=Get-AionRepairGate 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        Expect-True '53 director repair gate protects source hygiene policy test' ($directorGate.ProtectedPaths -contains 'test/aion/source-hygiene.test.mjs')
        Expect-True '54 director repair gate protects local-assistant source and policy test' (($directorGate.ProtectedPaths -contains 'packages/local-assistant/src/developer-bridge.ts')-and($directorGate.ProtectedPaths -contains 'packages/local-assistant/test/architecture-boundary.test.mjs'))
        Expect-True '55 director repair gate protects control-plane registration files' (($directorGate.ProtectedPaths -contains 'scripts/control-plane-common.ps1')-and($directorGate.ProtectedPaths -contains 'scripts/test-control-plane.ps1'))
        New-FakeNpm $fakeBin 'director-mojibake-only'|Out-Null
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current);Pass '55a director preflight does not require historical developer-agent console text'}catch{Fail '55a director preflight does not require historical developer-agent console text' $_.Exception.Message}
        foreach($case in @(
            [pscustomobject]@{Name='55b director preflight rejects lease-store source drift';Path='packages\director\src\lease-store.ts';Text='export const lease = "changed";'},
            [pscustomobject]@{Name='55c director preflight rejects developer-agent source drift';Path='apps\aion\developer-agent.mjs';Text='export const agent = "changed";'},
            [pscustomobject]@{Name='55d director preflight rejects git-truth source drift';Path='packages\director\src\git-truth.ts';Text='export const truth = "changed";'}
        )){
            & git -C $repo checkout -q -B main $repairBaseline
            & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
            [IO.File]::WriteAllText((Join-Path $repo $case.Path),$case.Text,[Text.UTF8Encoding]::new($false))
            & git -C $repo add $case.Path
            & git -C $repo commit -m 'synthetic source drift'|Out-Null
            $driftHead=(& git -C $repo rev-parse HEAD).Trim()
            & git -C $repo update-ref refs/remotes/origin/main $driftHead
            New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $driftHead 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
            Expect-Throw $case.Name {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        }
        & git -C $repo checkout -q -B main $repairBaseline
        & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
        $script:AionDirectorRecoveryKnownBrokenBaselineSha='0000000000000000000000000000000000000000'
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        Expect-Throw '55e director preflight rejects wrong trusted known-broken SHA' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        $script:AionDirectorRecoveryKnownBrokenBaselineSha=$repairBaseline
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' 'Trusted-Source-Sha: 0000000000000000000000000000000000000000' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current);Pass '55f directive-controlled trusted SHA fields are ignored'}catch{Fail '55f directive-controlled trusted SHA fields are ignored' $_.Exception.Message}
        Expect-True '55g directive-controlled trusted SHA text is not trusted' ((Get-AionDirectiveFieldOrDefault (Get-AionDirective $current) 'Trusted-Source-Sha') -cne $script:AionDirectorRecoveryKnownBrokenBaselineSha)
        $script:AionDirectorRecoveryKnownBrokenBaselineSha=$oldDirectorKnownBrokenBaseline
        $script:AionReviewedDirectorSha=$oldReviewedDirectorSha

        New-RepairDirective $current 'AUTHORIZED' $repairBaseline
        Expect-Throw '56 closure requires committed result' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        [IO.File]::WriteAllText((Join-Path $repo 'packages\local-assistant\test\architecture-boundary.test.mjs'),'weakened policy',[Text.UTF8Encoding]::new($false))
        & git -C $repo add packages/local-assistant/test/architecture-boundary.test.mjs
        & git -C $repo commit -m 'bad protected change'|Out-Null
        New-FakeNpm $fakeBin 'fixed'|Out-Null
        Expect-Throw '57 closure rejects protected policy change' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        & git -C $repo checkout -q -B main $repairBaseline
        & git -C $repo update-ref refs/remotes/origin/main $repairBaseline

        New-RepairDirective $current 'AUTHORIZED' $repairBaseline
        [IO.File]::WriteAllText((Join-Path $repo 'package.json'),'{"scripts":{"verify":"exit 0"}}',[Text.UTF8Encoding]::new($false))
        & git -C $repo add package.json
        & git -C $repo commit -m 'bad broad change'|Out-Null
        Expect-Throw '58 closure rejects unauthorized changed path' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        & git -C $repo checkout -q -B main $repairBaseline
        & git -C $repo update-ref refs/remotes/origin/main $repairBaseline

        New-RepairDirective $current 'AUTHORIZED' $repairBaseline
        [IO.File]::WriteAllText((Join-Path $repo 'packages\local-assistant\src\developer-bridge.ts'),'export const fixed = true;',[Text.UTF8Encoding]::new($false))
        & git -C $repo add packages/local-assistant/src/developer-bridge.ts
        & git -C $repo commit -m 'repair allowed file'|Out-Null
        $resultSha=(& git -C $repo rev-parse HEAD).Trim()
        New-FakeNpm $fakeBin 'fixed'|Out-Null
        $receiptPath=Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline
        Expect-True '59 closure writes PASS receipt and closes directive' ((Test-Path $receiptPath)-and((Get-AionDirective $current).Fields.Status -ceq 'CLOSED'))
        Expect-Throw '60 CLOSED repair directive cannot close twice' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        Expect-Throw '61 push receipt validator rejects missing result receipt' {Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha '0000000000000000000000000000000000000000' -BaselineSha $repairBaseline -ReviewedDirectorSha $repairBaseline}
        Expect-Throw '62 push receipt validator rejects wrong baseline' {Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $resultSha -BaselineSha 'wrong' -ReviewedDirectorSha $repairBaseline}
        try{Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $resultSha -BaselineSha $repairBaseline -ReviewedDirectorSha $repairBaseline;Pass '63 push receipt validator accepts exact closed repair'}catch{Fail '63 push receipt validator accepts exact closed repair' $_.Exception.Message}
        $receipt=Get-AionRepairClosureReceipt -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $resultSha
        Expect-True '64 closure records Director tree equivalence' ($receipt.directorTreeEquivalence -ceq 'PASS')
        & git -C $repo checkout -q -B main $repairBaseline
        & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
        New-FakeNpm $fakeBin 'fixed'|Out-Null
        try {
            $laResults=Invoke-AionLocalAssistantNonArchitectureVerification -Root $repo
            $nonArch=@($laResults | Where-Object { $_.Name -ceq 'local-assistant:non-architecture-tests' } | Select-Object -First 1)
            Pass '64a local-assistant non-architecture verifier uses compiled/canonical artifacts'
            Expect-True '64b local-assistant non-architecture verifier records test component' ($null -ne $nonArch)
        } catch { Fail '64a local-assistant non-architecture verifier uses compiled/canonical artifacts' $_.Exception.Message }
        $compiledArtifact=Join-Path $repo 'packages\local-assistant\dist-test\test\compiled-only.test.js'
        Remove-Item -LiteralPath $compiledArtifact -Force
        Expect-Throw '64c local-assistant verifier rejects missing compiled artifact' {Invoke-AionLocalAssistantNonArchitectureVerification -Root $repo|Out-Null}
        [IO.File]::WriteAllText($compiledArtifact,'import test from "node:test"; test("compiled artifact", () => {});',[Text.UTF8Encoding]::new($false))
        $failingArtifact=Join-Path $repo 'packages\local-assistant\dist-test\test\failing-extra.test.js'
        [IO.File]::WriteAllText($failingArtifact,'import test from "node:test"; test("extra failure", () => { throw new Error("second failure"); });',[Text.UTF8Encoding]::new($false))
        Expect-Throw '64d local-assistant verifier rejects extra failing non-architecture test' {Invoke-AionLocalAssistantNonArchitectureVerification -Root $repo|Out-Null}
        Remove-Item -LiteralPath $failingArtifact -Force
        $rawTsLeak=Join-Path $repo 'packages\local-assistant\dist-test\test\raw-leak.test.ts'
        [IO.File]::WriteAllText($rawTsLeak,'import test from "node:test"; test("raw leak", () => {});',[Text.UTF8Encoding]::new($false))
        try {
            Invoke-AionLocalAssistantNonArchitectureVerification -Root $repo|Out-Null
            Pass '64e raw TypeScript test artifact is not selected for node execution'
        } catch { Fail '64e raw TypeScript test artifact is not selected for node execution' $_.Exception.Message }
        Remove-Item -LiteralPath $rawTsLeak -Force

        $oldReviewedDirectorSha=$script:AionReviewedDirectorSha
        try {
            $script:AionReviewedDirectorSha=$repairBaseline
            & git -C $repo checkout -q -B main $repairBaseline
            & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
            New-RepairDirective $current 'AUTHORIZED' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
            [IO.Directory]::CreateDirectory((Join-Path $repo 'packages\director\src'))|Out-Null
            [IO.File]::WriteAllText((Join-Path $repo 'packages\director\src\lease-store.ts'),'export const repaired = true;',[Text.UTF8Encoding]::new($false))
            & git -C $repo add packages/director/src/lease-store.ts
            & git -C $repo commit -m 'director candidate allowed path'|Out-Null
            $directorCandidate=(& git -C $repo rev-parse HEAD).Trim()
            New-FakeNpm $fakeBin 'director-verify-misleading'|Out-Null
            $directorReceiptPath=Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha '0000000000000000000000000000000000000000'
            $directorReceipt=Get-AionRepairClosureReceipt -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $directorCandidate
            Expect-True '65 director closure records candidate replacement policy' ($directorReceipt.directorAnchorPolicy -ceq 'CANDIDATE_REPLACEMENT')
            Expect-True '66 director closure does not self-certify reviewed anchor' (-not($directorReceipt.PSObject.Properties.Name -contains 'reviewed') -and -not($directorReceipt.PSObject.Properties.Name -contains 'certified'))
            Expect-True '67 director closure treats raw verify failure as audit only' ($directorReceipt.rawFullVerifyResult.Result -ceq 'NONZERO_AUDIT_ONLY')
            try{Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $directorCandidate -BaselineSha $repairBaseline -ReviewedDirectorSha 'caller-cannot-redefine-anchor';Pass '68 director push validator recomputes and accepts valid candidate facts'}catch{Fail '68 director push validator recomputes and accepts valid candidate facts' $_.Exception.Message}
            $receiptPath=Join-Path $repo ".aion-local\repair-closures\TEST-REPAIR\$directorCandidate.json"
            $forged=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
            $forged.candidateDirectorTree='forged'
            [IO.File]::WriteAllText($receiptPath,($forged|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
            Expect-Throw '69 forged director receipt is rejected by recomputation' {Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $directorCandidate -BaselineSha $repairBaseline -ReviewedDirectorSha 'ignored'}

            & git -C $repo checkout -q -B main $repairBaseline
            & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
            New-RepairDirective $current 'AUTHORIZED' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
            [IO.File]::WriteAllText((Join-Path $repo 'packages\director\unauthorized.txt'),'bad',[Text.UTF8Encoding]::new($false))
            & git -C $repo add packages/director/unauthorized.txt
            & git -C $repo commit -m 'director unauthorized path'|Out-Null
            New-FakeNpm $fakeBin 'fixed'|Out-Null
            Expect-Throw '70 director closure rejects unauthorized Director path' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}

            & git -C $repo checkout -q -B main $repairBaseline
            & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
            New-RepairDirective $current 'AUTHORIZED' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
            [IO.File]::WriteAllText((Join-Path $repo 'packages\local-assistant\src\developer-bridge.ts'),'changed local assistant',[Text.UTF8Encoding]::new($false))
            & git -C $repo add packages/local-assistant/src/developer-bridge.ts
            & git -C $repo commit -m 'bad local assistant mutation'|Out-Null
            Expect-Throw '71 director closure rejects local-assistant mutation' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}

            & git -C $repo checkout -q -B main $repairBaseline
            [IO.File]::WriteAllText((Join-Path $repo 'packages\director\sentinel.txt'),'changed baseline director',[Text.UTF8Encoding]::new($false))
            & git -C $repo add packages/director/sentinel.txt
            & git -C $repo commit -m 'governance baseline accidentally changed director'|Out-Null
            $badDirectorBaseline=(& git -C $repo rev-parse HEAD).Trim()
            & git -C $repo update-ref refs/remotes/origin/main $badDirectorBaseline
            New-RepairDirective $current 'AUTHORIZED' $badDirectorBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
            [IO.Directory]::CreateDirectory((Join-Path $repo 'packages\director\src'))|Out-Null
            [IO.File]::WriteAllText((Join-Path $repo 'packages\director\src\lease-store.ts'),'export const repaired = true;',[Text.UTF8Encoding]::new($false))
            & git -C $repo add packages/director/src/lease-store.ts
            & git -C $repo commit -m 'candidate after bad baseline'|Out-Null
            Expect-Throw '72 director closure rejects baseline Director tree mismatch' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $badDirectorBaseline}

            & git -C $repo checkout -q -B main $repairBaseline
            & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
            New-RepairDirective $current 'AUTHORIZED' $repairBaseline 'AUTHORIZE DIRECTOR REPAIR' '' 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
            [IO.Directory]::CreateDirectory((Join-Path $repo 'packages\director\src'))|Out-Null
            [IO.File]::WriteAllText((Join-Path $repo 'packages\director\src\lease-store.ts'),'export const repaired = true;',[Text.UTF8Encoding]::new($false))
            & git -C $repo add packages/director/src/lease-store.ts
            & git -C $repo commit -m 'candidate structured failure'|Out-Null
            New-FakeNpm $fakeBin 'director-structured-other-fail'|Out-Null
            Expect-Throw '73 structured component failure rejects despite raw known text' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
            New-FakeNpm $fakeBin 'director-structured-known-wrong'|Out-Null
            Expect-Throw '74 wrong known local-assistant signature rejects' {Assert-AionDirectorStructuredVerification -Root $repo}
            New-FakeNpm $fakeBin 'director-structured-known-second'|Out-Null
            Expect-Throw '75 second local-assistant architecture failure rejects' {Assert-AionDirectorStructuredVerification -Root $repo}

            function Reset-PromotionFixture([string]$Mode='valid'){
                New-FakeNpm $fakeBin 'director-verify-misleading'|Out-Null
                if(Test-Path -LiteralPath $local){Remove-Item -LiteralPath $local -Recurse -Force}
                & git -C $repo checkout -q -B main $repairBaseline
                & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
                $promotionBaseline=$repairBaseline
                if($Mode -ceq 'candidate-rebased'){
                    [IO.File]::WriteAllText((Join-Path $repo 'README.md'),'intermediate',[Text.UTF8Encoding]::new($false))
                    & git -C $repo add README.md
                    & git -C $repo commit -m 'synthetic intermediate'|Out-Null
                    $promotionBaseline=(& git -C $repo rev-parse HEAD).Trim()
                }
                $candidatePaths=@((Get-AionRepairGate 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE').TrustedAllowedPaths)
                foreach($path in $candidatePaths){
                    [IO.File]::WriteAllText((Join-Path $repo ($path.Replace('/','\'))),"candidate $path",[Text.UTF8Encoding]::new($false))
                    & git -C $repo add $path
                }
                if($Mode -ceq 'candidate-unauthorized-path'){
                    [IO.File]::WriteAllText((Join-Path $repo 'package.json'),'{"bad":true}',[Text.UTF8Encoding]::new($false))
                    & git -C $repo add package.json
                }
                if($Mode -ceq 'candidate-local-assistant-change'){
                    [IO.File]::WriteAllText((Join-Path $repo 'packages\local-assistant\src\developer-bridge.ts'),'changed local assistant',[Text.UTF8Encoding]::new($false))
                    & git -C $repo add packages/local-assistant/src/developer-bridge.ts
                }
                & git -C $repo commit -m 'synthetic director candidate'|Out-Null
                $candidate=(& git -C $repo rev-parse HEAD).Trim()
                $script:AionDirectorPromotionExpectedCandidateSha=$candidate
                $script:AionDirectorPromotionExpectedCandidateBaselineSha=$repairBaseline
                $script:AionDirectorPromotionClosedDirectiveId='TEST-REPAIR'
                if($Mode -ne 'closure-missing'){
                    $closureResult=if($Mode -ceq 'closure-failing'){'FAIL'}else{'PASS'}
                    Write-DirectorClosureReceiptFixture $repo 'TEST-REPAIR' $repairBaseline $candidate $closureResult
                }
                if($Mode -ne 'directive-not-closed'){
                    Write-ClosedRepairDirectiveFixture $repo 'TEST-REPAIR' $repairBaseline
                }
                $reviewVerdict=if($Mode -ceq 'review-fail'){'FAIL'}else{'PASS'}
                $reviewBlocking=if($Mode -ceq 'review-blocking') {1} else {0}
                $reviewHash=Write-ReviewArtifactFixture $repo $candidate $reviewVerdict $reviewBlocking
                if($Mode -ceq 'g7-parent-not-candidate'){
                    & git -C $repo checkout -q -B main $repairBaseline
                    $candidate=$script:AionDirectorPromotionExpectedCandidateSha
                }
                [IO.Directory]::CreateDirectory((Join-Path $repo 'scripts'))|Out-Null
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\control-plane-common.ps1'),'governance common',[Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\promote-reviewed-director.ps1'),'governance promote',[Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\test-control-plane.ps1'),'governance tests',[Text.UTF8Encoding]::new($false))
                & git -C $repo add scripts
                if($Mode -ceq 'g7-non-governance-change'){
                    [IO.Directory]::CreateDirectory((Join-Path $repo 'docs'))|Out-Null
                    [IO.File]::WriteAllText((Join-Path $repo 'docs\bad.md'),'bad',[Text.UTF8Encoding]::new($false))
                    & git -C $repo add docs/bad.md
                }
                & git -C $repo commit -m 'synthetic g7 governance'|Out-Null
                $g7=(& git -C $repo rev-parse HEAD).Trim()
                if($Mode -ceq 'origin-moved'){
                    & git -C $repo update-ref refs/remotes/origin/main $candidate
                }
                $hashForDirective=if($Mode -ceq 'review-sha-mismatch'){'0000000000000000000000000000000000000000000000000000000000000000'}else{$reviewHash}
                $status=if($Mode -ceq 'directive-not-authorized'){'PENDING_OWNER_AUTHORIZATION'}else{'AUTHORIZED'}
                New-PromotionDirective $current $status $g7 $hashForDirective
                return [pscustomobject]@{Candidate=$candidate;G7=$g7;Baseline=$repairBaseline}
            }

            $validPromotion=Reset-PromotionFixture
            try{Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null;Pass '76 promotion preflight accepts exact topology'}catch{Fail '76 promotion preflight accepts exact topology' $_.Exception.Message}
            try{Invoke-AionReviewedDirectorPromotion -Root $repo -Directive (Get-AionDirective $current) -DryRun|Out-Null;Pass '77 promotion dry-run writes receipt without push'}catch{Fail '77 promotion dry-run writes receipt without push' $_.Exception.Message}
            Expect-True '78 promotion script does not accept caller candidate SHA' (-not((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'promote-reviewed-director.ps1') -Raw) -match 'CandidateSha'))

            $case=Reset-PromotionFixture 'candidate-rebased'
            Expect-Throw '79 promotion rejects candidate amended or rebased' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'g7-parent-not-candidate'
            Expect-Throw '80 promotion rejects G7 parent not exact candidate' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'origin-moved'
            Expect-Throw '81 promotion rejects moved origin main' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'candidate-unauthorized-path'
            Expect-Throw '82 promotion rejects candidate seventh path' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'g7-non-governance-change'
            Expect-Throw '83 promotion rejects non-governance G7 change' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'directive-not-closed'
            Expect-Throw '84 promotion rejects missing CLOSED repair directive' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'closure-missing'
            Expect-Throw '85 promotion rejects missing closure receipt' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'closure-failing'
            Expect-Throw '86 promotion rejects failing closure receipt' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture
            $oldExpectedPromotionCandidate=$script:AionDirectorPromotionExpectedCandidateSha
            $script:AionDirectorPromotionExpectedCandidateSha='0000000000000000000000000000000000000000'
            Expect-Throw '87 promotion rejects candidate SHA mismatch' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $script:AionDirectorPromotionExpectedCandidateSha=$oldExpectedPromotionCandidate
            $case=Reset-PromotionFixture 'review-sha-mismatch'
            Expect-Throw '88 promotion rejects review SHA mismatch' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'review-fail'
            Expect-Throw '89 promotion rejects review FAIL verdict' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'review-blocking'
            Expect-Throw '90 promotion rejects blocking defects' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'candidate-local-assistant-change'
            Expect-Throw '91 promotion rejects local-assistant candidate tree change' {Assert-AionReviewedDirectorPromotionPreflight -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            $case=Reset-PromotionFixture 'directive-not-authorized'
            Expect-Throw '92 promotion action rejects non-AUTHORIZED directive' {Invoke-AionReviewedDirectorPromotion -Root $repo -Directive (Get-AionDirective $current) -DryRun|Out-Null}
            Expect-Throw '93 promotion script rejects arbitrary SkipRepositoryChecks parameter' {& (Join-Path $PSScriptRoot 'promote-reviewed-director.ps1') -RepositoryRoot $repo -DirectivePath $current -SkipRepositoryChecks}
            $case=Reset-PromotionFixture
            $promotionResult=Invoke-AionReviewedDirectorPromotion -Root $repo -Directive (Get-AionDirective $current) -DryRun
            Expect-True '94 promotion receipt does not certify D2' ($promotionResult.Receipt.d2Certification -ceq 'NOT_GRANTED')

            function Reset-CertificationFixture([string]$Mode='valid'){
                $npmMode=switch($Mode){
                    'director-suite-fail' {'cert-director-suite-fail'}
                    'local-suite-fail' {'cert-local-suite-fail'}
                    'full-verify-fail' {'cert-full-verify-fail'}
                    default {'cert-pass'}
                }
                New-FakeNpm $fakeBin $npmMode|Out-Null
                if(Test-Path -LiteralPath $local){Remove-Item -LiteralPath $local -Recurse -Force}
                & git -C $repo checkout -q -B main $repairBaseline
                & git -C $repo update-ref refs/remotes/origin/main $repairBaseline
                foreach($path in @((Get-AionRepairGate 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE').TrustedAllowedPaths)){
                    [IO.File]::WriteAllText((Join-Path $repo ($path.Replace('/','\'))),"candidate $path",[Text.UTF8Encoding]::new($false))
                    & git -C $repo add $path
                }
                & git -C $repo commit -m 'synthetic D2 Director candidate'|Out-Null
                $candidate=(& git -C $repo rev-parse HEAD).Trim()
                $script:AionDirectorPromotionExpectedCandidateSha=$candidate
                $script:AionDirectorPromotionExpectedCandidateBaselineSha=$repairBaseline
                $script:AionDirectorPromotionClosedDirectiveId='TEST-DIRECTOR-REPAIR'
                if($Mode -ne 'director-closure-missing'){
                    $closureResult=if($Mode -ceq 'director-closure-fail'){'FAIL'}else{'PASS'}
                    Write-DirectorClosureReceiptFixture $repo 'TEST-DIRECTOR-REPAIR' $repairBaseline $candidate $closureResult
                }
                if($Mode -ne 'hostile-review-missing'){
                    $reviewVerdict=if($Mode -ceq 'hostile-review-fail'){'FAIL'}else{'PASS'}
                    $reviewBlocking=if($Mode -ceq 'hostile-blocking') {1} else {0}
                    [void](Write-ReviewArtifactFixture $repo $candidate $reviewVerdict $reviewBlocking)
                    if($Mode -ceq 'review-sha-mismatch'){
                        $reviewPath=Join-Path $repo ".aion-local\reviews\director-candidate-$candidate.json"
                        $review=Get-Content -LiteralPath $reviewPath -Raw|ConvertFrom-Json
                        $review.candidateSha='0000000000000000000000000000000000000000'
                        [IO.File]::WriteAllText($reviewPath,($review|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
                    }
                    if($Mode -ceq 'missing-review-verdict'){
                        $reviewPath=Join-Path $repo ".aion-local\reviews\director-candidate-$candidate.json"
                        $review=Get-Content -LiteralPath $reviewPath -Raw|ConvertFrom-Json
                        $review.PSObject.Properties.Remove('verdict')
                        [IO.File]::WriteAllText($reviewPath,($review|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
                    }
                    if($Mode -ceq 'malformed-review'){
                        $reviewPath=Join-Path $repo ".aion-local\reviews\director-candidate-$candidate.json"
                        [IO.File]::WriteAllText($reviewPath,'{bad json',[Text.UTF8Encoding]::new($false))
                    }
                }
                [IO.Directory]::CreateDirectory((Join-Path $repo 'scripts'))|Out-Null
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\control-plane-common.ps1'),'g7 common',[Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\promote-reviewed-director.ps1'),'g7 promote',[Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\test-control-plane.ps1'),'g7 tests',[Text.UTF8Encoding]::new($false))
                & git -C $repo add scripts
                & git -C $repo commit -m 'synthetic G7 governance'|Out-Null
                $g7=(& git -C $repo rev-parse HEAD).Trim()
                $script:AionD2FinalLocalAssistantBaselineSha=$g7
                Write-PromotionReceiptFixture $repo $g7 $candidate $repairBaseline 'TEST-DIRECTOR-REPAIR'
                [IO.File]::WriteAllText((Join-Path $repo 'packages\local-assistant\src\developer-bridge.ts'),'export const fixed = true;',[Text.UTF8Encoding]::new($false))
                & git -C $repo add packages/local-assistant/src/developer-bridge.ts
                & git -C $repo commit -m 'synthetic final local assistant repair'|Out-Null
                $target=(& git -C $repo rev-parse HEAD).Trim()
                $script:AionD2TechnicalCertificationTargetSha=$target
                $script:AionD2FinalLocalAssistantRepairDirectiveId='TEST-LA-REPAIR'
                if($Mode -ne 'local-closure-missing'){
                    $laClosure=if($Mode -ceq 'local-closure-fail'){'FAIL'}else{'PASS'}
                    Write-LocalAssistantClosureReceiptFixture $repo 'TEST-LA-REPAIR' $g7 $target $candidate $laClosure
                }
                if($Mode -ceq 'target-differs-from-parent'){
                    [IO.File]::WriteAllText((Join-Path $repo 'README.md'),'between target and G8',[Text.UTF8Encoding]::new($false))
                    & git -C $repo add README.md
                    & git -C $repo commit -m 'wrong parent between target and G8'|Out-Null
                }
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\control-plane-common.ps1'),'g8 common',[Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\certify-director-d2.ps1'),'g8 certify',[Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText((Join-Path $repo 'scripts\test-control-plane.ps1'),'g8 tests',[Text.UTF8Encoding]::new($false))
                & git -C $repo add scripts
                if($Mode -ceq 'g8-source-modification'){
                    [IO.File]::WriteAllText((Join-Path $repo 'apps\aion\developer-agent.mjs'),'bad source mutation',[Text.UTF8Encoding]::new($false))
                    & git -C $repo add apps/aion/developer-agent.mjs
                }
                & git -C $repo commit -m 'synthetic G8 certification governance'|Out-Null
                $g8=(& git -C $repo rev-parse HEAD).Trim()
                & git -C $repo update-ref refs/remotes/origin/main $g8
                $anchorForDirective=if($Mode -ceq 'sha-a-prime-mismatch'){'0000000000000000000000000000000000000000'}else{$candidate}
                New-CertificationDirective $current 'AUTHORIZED' $g8 $target $anchorForDirective
                if($Mode -ceq 'r31-present'){(Get-Content $current -Raw).Replace('R31: NONE','R31: R31-CANDIDATE')|Set-Content -LiteralPath $current -NoNewline}
                if($Mode -ceq 'production-touched'){(Get-Content $current -Raw).Replace('Production: UNTOUCHED','Production: TOUCHED')|Set-Content -LiteralPath $current -NoNewline}
                if($Mode -ceq 'writer-launched'){(Get-Content $current -Raw).Replace('Writer-Launched: NO','Writer-Launched: YES')|Set-Content -LiteralPath $current -NoNewline}
                if($Mode -ceq 'funnel-active'){(Get-Content $current -Raw).Replace('Funnel: OFF','Funnel: ON')|Set-Content -LiteralPath $current -NoNewline}
                if($Mode -ceq 'spend-positive'){(Get-Content $current -Raw).Replace('Spend-USD: 0','Spend-USD: 1')|Set-Content -LiteralPath $current -NoNewline}
                return [pscustomobject]@{ Candidate=$candidate; G7=$g7; Target=$target; G8=$g8 }
            }

            $validCertification=Reset-CertificationFixture
            try{
                $preflight=Assert-AionD2FinalCertificationPreflight -Root $repo -Directive (Get-AionDirective $current)
                Pass '95 D2 certification preflight accepts exact G8 topology'
                Expect-True '96 certification target is derived from HEAD parent' ($preflight.Target -ceq $validCertification.Target)
            }catch{Fail '95 D2 certification preflight accepts exact G8 topology' $_.Exception.Message}
            $certResult=Invoke-AionD2FinalCertification -Root $repo -Directive (Get-AionDirective $current)
            Expect-True '97 D2 certification all-PASS path writes GRANTED state' ((Test-Path $certResult.StatePath)-and($certResult.Receipt.d2CertifiedSha -ceq $validCertification.Target)-and($certResult.Receipt.shaAPrime -ceq $validCertification.Candidate))
            $idempotent=Invoke-AionD2FinalCertification -Root $repo -Directive (Get-AionDirective $current)
            Expect-True '98 D2 certification same-target rerun is idempotent' ($idempotent.Receipt.mode -ceq 'IDEMPOTENT')
            [IO.File]::WriteAllText((Get-AionD2CertificationStatePath -Root $repo),([pscustomobject]@{schemaVersion='aion.d2CertificationState.v1';d2Certification='GRANTED';d2CertifiedSha=$repairBaseline;shaAPrime=$validCertification.Candidate}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
            Expect-Throw '99 D2 certification rejects existing different target' {Invoke-AionD2FinalCertification -Root $repo -Directive (Get-AionDirective $current)|Out-Null}

            foreach($case in @(
                [pscustomobject]@{Name='100 missing hostile review rejects';Mode='hostile-review-missing'},
                [pscustomobject]@{Name='101 hostile review FAIL rejects';Mode='hostile-review-fail'},
                [pscustomobject]@{Name='102 hostile blocking defects reject';Mode='hostile-blocking'},
                [pscustomobject]@{Name='103 review SHA mismatch rejects';Mode='review-sha-mismatch'},
                [pscustomobject]@{Name='104 Director closure missing rejects';Mode='director-closure-missing'},
                [pscustomobject]@{Name='105 Director suite failure rejects';Mode='director-suite-fail'},
                [pscustomobject]@{Name='106 local-assistant closure missing rejects';Mode='local-closure-missing'},
                [pscustomobject]@{Name='107 full verify FAIL rejects';Mode='full-verify-fail'},
                [pscustomobject]@{Name='108 missing expected review verdict fails closed';Mode='missing-review-verdict'},
                [pscustomobject]@{Name='109 malformed evidence fails closed';Mode='malformed-review'},
                [pscustomobject]@{Name='110 SHA_A_PRIME mismatch rejects';Mode='sha-a-prime-mismatch'},
                [pscustomobject]@{Name='111 target different from HEAD parent rejects';Mode='target-differs-from-parent'},
                [pscustomobject]@{Name='112 G8 application-source modification rejects';Mode='g8-source-modification'},
                [pscustomobject]@{Name='113 R31 present rejects';Mode='r31-present'},
                [pscustomobject]@{Name='114 production touched rejects';Mode='production-touched'},
                [pscustomobject]@{Name='115 writer launched rejects';Mode='writer-launched'},
                [pscustomobject]@{Name='116 Funnel active rejects';Mode='funnel-active'},
                [pscustomobject]@{Name='117 spend positive rejects';Mode='spend-positive'},
                [pscustomobject]@{Name='118 local-assistant suite failure rejects';Mode='local-suite-fail'},
                [pscustomobject]@{Name='119 local-assistant closure FAIL rejects';Mode='local-closure-fail'},
                [pscustomobject]@{Name='120 Director closure FAIL rejects';Mode='director-closure-fail'}
            )){
                [void](Reset-CertificationFixture $case.Mode)
                Expect-Throw $case.Name {Invoke-AionD2FinalCertification -Root $repo -Directive (Get-AionDirective $current)|Out-Null}
            }

            $case=Reset-CertificationFixture
            Add-Content -LiteralPath $current -Value "`r`nCertification-Target: caller-controlled"
            Expect-Throw '121 arbitrary caller target fields are rejected' {Get-AionDirectiveFieldOrDefault (Get-AionDirective $current) 'Certification-Target'|Out-Null}
            $case=Reset-CertificationFixture
            Expect-Throw '122 certification script rejects arbitrary target parameter' {& (Join-Path $PSScriptRoot 'certify-director-d2.ps1') -RepositoryRoot $repo -DirectivePath $current -TargetSha $case.Target}
        }
        finally {
            $script:AionReviewedDirectorSha=$oldReviewedDirectorSha
            $script:AionDirectorPromotionExpectedCandidateSha='6a4cb1d058fb6375798fa27e7629fd5a2d889ba1'
            $script:AionDirectorPromotionExpectedCandidateBaselineSha='3938e0b6b7b5452830b47b3ae3ba9d95ed6b4746'
            $script:AionDirectorPromotionClosedDirectiveId='D2-DIRECTOR-RECOVERY-LEASE-HYGIENE-CARRYFORWARD-20260817T044618Z'
            $script:AionD2TechnicalCertificationTargetSha='17b012b28d911fe563aab19f6e4a697a05b9b718'
            $script:AionD2FinalLocalAssistantBaselineSha='9b1d68bc774be7952da109d0d971d47cc85b234f'
            $script:AionD2FinalLocalAssistantRepairDirectiveId='D2-FINAL-LOCAL-ASSISTANT-ARCH-REPAIR-20260817T153000Z'
        }
    }
    finally {
        $env:PATH=$oldPath
    }

    if($failed-ne 0){throw "$failed control-plane tests failed"}
    $complete=$true
    Write-Host "control-plane regression: PASS ($passed passed, 0 failed)"
}
catch {Write-Error "control-plane regression: FAIL: $($_.Exception.Message); evidence preserved at $testRoot";exit 1}
finally {
    if($complete-and(Test-Path $testRoot)){
        $resolved=[IO.Path]::GetFullPath($testRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe cleanup path: $resolved"}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
