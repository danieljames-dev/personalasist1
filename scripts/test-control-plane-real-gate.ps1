[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

$realRoot=Resolve-AionGitRoot -StartPath (Split-Path -Parent $PSScriptRoot)
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ("aion-real-gate-"+[guid]::NewGuid().ToString('N'))
$repo=Join-Path $testRoot 'repo'
$currentPath=Join-Path $realRoot '.aion-local\directives\CURRENT.md'
$authorizer=Join-Path $PSScriptRoot 'authorize-current-directive.ps1'
$passed=0
$failed=0
$complete=$false
$oldPath=$env:PATH
$oldReviewedDirectorSha=$script:AionReviewedDirectorSha
$oldDirectorKnownBrokenBaseline=$script:AionDirectorRecoveryKnownBrokenBaselineSha

function Pass([string]$Name){$script:passed++;Write-Host "PASS $Name"}
function Fail([string]$Name,[string]$Detail){$script:failed++;Write-Host "FAIL $Name - $Detail" -ForegroundColor Red}
function Expect-True([string]$Name,[bool]$Value){if($Value){Pass $Name}else{Fail $Name 'condition false'}}
function Expect-Throw([string]$Name,[scriptblock]$Action){try{& $Action;Fail $Name 'expected failure'}catch{Pass $Name}}

function New-Directive(
    [string]$Path,
    [string]$Status,
    [string]$Baseline,
    [string]$Phrase,
    [string]$AuthorizationClass='BROKEN_BASELINE_REPAIR',
    [string]$GateId='DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE',
    [string]$Allowed='apps/aion/developer-agent.mjs;packages/director/src/lease-store.ts'
){
    $classText=if([string]::IsNullOrWhiteSpace($AuthorizationClass)){''}else{"Authorization-Class: $AuthorizationClass`r`n"}
    $gateText=if([string]::IsNullOrWhiteSpace($GateId)){''}else{"Known-Failing-Gate: $GateId`r`n"}
    $allowedText=if([string]::IsNullOrWhiteSpace($Allowed)){''}else{"Allowed-Repair-Files: $Allowed`r`n"}
    $body=@"
# AION Current Directive
Directive-ID: SYNTHETIC-REAL-GATE
Status: $Status
Title: Synthetic Real Gate
Prepared-Date: 2026-08-17T00:00:00Z
Prepared-By: Codex test
Repository-Baseline: $Baseline
Required-Authorization-Phrase: $Phrase
$classText$gateText$allowedText
## Goal
Synthetic only.
## Authorized Scope
- synthetic control-plane validation
## Prohibited Scope
- product work
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
Stop on failure.
## Required Handoff
Synthetic.
## Next-Phase Prohibition
No next phase.
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
if "%2"=="aion:server:test" goto server
if "%2"=="test:architecture" goto architecture
if "%2"=="test" goto test
if "%2"=="typecheck" exit /b 0
if "%2"=="build" exit /b 0
if "%2"=="build:test" exit /b 0
if "%2"=="career:test" exit /b 0
exit /b 37

:verify
echo developer bridge is the single process boundary and is repository-scoped
echo packages/local-assistant/src/developer-bridge.ts contains process.env
echo unrelated monolithic verify failure
exit /b 9

:server
if "%MODE%"=="director-broken" goto directorbroken
if "%MODE%"=="director-mojibake-only" goto directormojibake
if "%MODE%"=="wrong-signature" goto wrongtext
exit /b 0

:test
if "%MODE%"=="component-fail" exit /b 4
exit /b 0

:architecture
if "%MODE%"=="wrong-signature" goto wrongtext
if "%MODE%"=="second-arch-failure" goto secondarch
goto localarch

:directorbroken
echo # Subtest: a resolved bridge refuses tasks aimed outside the one approved repository root
echo not ok 41 - a resolved bridge refuses tasks aimed outside the one approved repository root
echo developer-agent refused: another run holds this
echo # Subtest: no tracked text file contains double-encoded (mojibake) characters
echo not ok 93 - no tracked text file contains double-encoded (mojibake) characters
echo packages/director/src/git-truth.ts:12
exit /b 1

:directormojibake
echo # Subtest: no tracked text file contains double-encoded (mojibake) characters
echo not ok 93 - no tracked text file contains double-encoded (mojibake) characters
echo packages/director/src/git-truth.ts:12
exit /b 1

:localarch
echo developer bridge is the single process boundary and is repository-scoped
echo packages/local-assistant/src/developer-bridge.ts contains process.env
exit /b 1

:secondarch
echo developer bridge is the single process boundary and is repository-scoped
echo packages/local-assistant/src/developer-bridge.ts contains process.env
echo not ok 99 - unrelated local-assistant failure
exit /b 1

:wrongtext
echo unrelated failure
exit /b 1
"@
    [IO.File]::WriteAllText($scriptPath,$body,[Text.ASCIIEncoding]::new())
    return $scriptPath
}

function New-FakeNode([string]$Dir){
    [IO.Directory]::CreateDirectory($Dir)|Out-Null
    $scriptPath=Join-Path $Dir 'node.cmd'
    [IO.File]::WriteAllText($scriptPath,"@echo off`r`nexit /b 0`r`n",[Text.ASCIIEncoding]::new())
    return $scriptPath
}

function Invoke-AuthorizationFixture([string]$DirectivePath,[string]$Phrase,[switch]$SkipRepositoryChecks,[string]$Root=$repo){
    $out=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.out')
    $err=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.err')
    $arguments=@(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$authorizer+'"'),
        '-RepositoryRoot',('"'+$Root+'"'),'-DirectivePath',('"'+$DirectivePath+'"'),
        '-TestMode','-AuthorizationInput',('"'+$Phrase+'"')
    )
    if($SkipRepositoryChecks){$arguments+='-SkipRepositoryChecks'}
    $process=Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $out -RedirectStandardError $err
    return [pscustomobject]@{
        ExitCode=$process.ExitCode
        Output=((Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue)+(Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue))
    }
}

try {
    $realCurrentBefore=Get-FileHash -LiteralPath $currentPath -Algorithm SHA256
    $baseline=$script:AionDirectorRecoveryKnownBrokenBaselineSha
    & git clone --no-checkout $realRoot $repo|Out-Null
    & git -C $repo checkout -q -B main $baseline
    & git -C $repo config user.name 'AION Real Gate Test'
    & git -C $repo config user.email 'real-gate-test@invalid.example'
    & git -C $repo config core.autocrlf false
    & git -C $repo remote set-url origin $script:AionCanonicalOrigin
    & git -C $repo update-ref refs/remotes/origin/main $baseline
    $fakeBin=Join-Path $testRoot 'fake-bin'
    New-FakeNode $fakeBin|Out-Null
    $env:PATH="$fakeBin;$env:PATH"
    $directivePath=Join-Path $repo '.aion-local\directives\CURRENT.md'
    $phrase='AUTHORIZE SYNTHETIC REAL GATE'

    New-FakeNpm $fakeBin 'director-broken'|Out-Null
    New-Directive $directivePath 'PENDING_OWNER_AUTHORIZATION' $baseline $phrase
    $repairAuth=Invoke-AuthorizationFixture $directivePath $phrase
    Expect-True '1 BROKEN_BASELINE_REPAIR Director gate authorizes through production script' (($repairAuth.ExitCode -eq 0)-and((Get-AionDirective $directivePath).Fields.Status -ceq 'AUTHORIZED'))
    Expect-True '2 real-gate regression does not invoke root verify on repair preflight' ($repairAuth.Output -notmatch 'run verify|unrelated monolithic verify failure')
    New-FakeNpm $fakeBin 'director-mojibake-only'|Out-Null
    New-Directive $directivePath 'PENDING_OWNER_AUTHORIZATION' $baseline $phrase
    $identityAuth=Invoke-AuthorizationFixture $directivePath $phrase
    Expect-True '2a Director preflight accepts source identity without historical runtime lease text' (($identityAuth.ExitCode -eq 0)-and((Get-AionDirective $directivePath).Fields.Status -ceq 'AUTHORIZED'))
    & git -C $repo checkout -q -B main $baseline
    [IO.File]::WriteAllText((Join-Path $repo 'packages\director\src\lease-store.ts'),'export const lease = 2;',[Text.UTF8Encoding]::new($false))
    & git -C $repo add packages/director/src/lease-store.ts
    & git -C $repo commit -m 'synthetic lease drift'|Out-Null
    $driftHead=(& git -C $repo rev-parse HEAD).Trim()
    & git -C $repo update-ref refs/remotes/origin/main $driftHead
    New-Directive $directivePath 'PENDING_OWNER_AUTHORIZATION' $driftHead $phrase
    $driftAuth=Invoke-AuthorizationFixture $directivePath $phrase
    Expect-True '2b Director preflight rejects source drift from trusted known-broken baseline' (($driftAuth.ExitCode -ne 0)-and((Get-AionDirective $directivePath).Fields.Status -ceq 'PENDING_OWNER_AUTHORIZATION'))
    & git -C $repo checkout -q -B main $baseline
    & git -C $repo update-ref refs/remotes/origin/main $baseline

    New-FakeNpm $fakeBin 'fixed'|Out-Null
    try{Invoke-AionDirectorStructuredVerification -Root $repo|Out-Null;Pass '3 structured verification accepts exact isolated known local-assistant failure'}catch{Fail '3 structured verification accepts exact isolated known local-assistant failure' $_.Exception.Message}
    New-FakeNpm $fakeBin 'component-fail'|Out-Null
    Expect-Throw '4 structured verification rejects unrelated component failure' {Invoke-AionDirectorStructuredVerification -Root $repo|Out-Null}
    New-FakeNpm $fakeBin 'wrong-signature'|Out-Null
    Expect-Throw '5 structured verification rejects wrong architecture signature' {Invoke-AionDirectorStructuredVerification -Root $repo|Out-Null}
    New-FakeNpm $fakeBin 'second-arch-failure'|Out-Null
    Expect-Throw '6 structured verification rejects second architecture failure' {Invoke-AionDirectorStructuredVerification -Root $repo|Out-Null}

    New-FakeNpm $fakeBin 'director-broken'|Out-Null
    New-Directive $directivePath 'PENDING_OWNER_AUTHORIZATION' $baseline $phrase 'BROKEN_BASELINE_REPAIR' 'UNKNOWN_GATE'
    $wrongGate=Invoke-AuthorizationFixture $directivePath $phrase
    Expect-True '7 wrong gate ID rejects' (($wrongGate.ExitCode -ne 0)-and((Get-AionDirective $directivePath).Fields.Status -ceq 'PENDING_OWNER_AUTHORIZATION'))

    New-FakeNpm $fakeBin 'director-broken'|Out-Null
    New-Directive $directivePath 'PENDING_OWNER_AUTHORIZATION' $baseline $phrase '' '' ''
    $normal=Invoke-AuthorizationFixture $directivePath $phrase
    Expect-True '8 NORMAL authorization on known-red baseline rejects' (($normal.ExitCode -ne 0)-and((Get-AionDirective $directivePath).Fields.Status -ceq 'PENDING_OWNER_AUTHORIZATION'))

    $realTempDirective=Join-Path $realRoot ".aion-local\directives\real-gate-skip-$([guid]::NewGuid().ToString('N')).md"
    New-Directive $realTempDirective 'PENDING_OWNER_AUTHORIZATION' ((& git -C $realRoot rev-parse HEAD).Trim()) $phrase
    try {
        $skip=Invoke-AuthorizationFixture $realTempDirective $phrase -SkipRepositoryChecks -Root $realRoot
        Expect-True '9 SkipRepositoryChecks remains closed outside temp' ($skip.ExitCode -ne 0)
    }
    finally {
        if(Test-Path -LiteralPath $realTempDirective){Remove-Item -LiteralPath $realTempDirective -Force}
    }

    $realCurrentAfter=Get-FileHash -LiteralPath $currentPath -Algorithm SHA256
    Expect-True '10 pending real Director directive remains untouched' ($realCurrentBefore.Hash -ceq $realCurrentAfter.Hash)
    if($failed-ne 0){throw "$failed real-gate tests failed"}
    $complete=$true
    Write-Host "real repository gate regression: PASS ($passed passed, 0 failed)"
}
catch {
    Write-Error "real repository gate regression: FAIL: $($_.Exception.Message); evidence preserved at $testRoot"
    exit 1
}
finally {
    $env:PATH=$oldPath
    $script:AionReviewedDirectorSha=$oldReviewedDirectorSha
    $script:AionDirectorRecoveryKnownBrokenBaselineSha=$oldDirectorKnownBrokenBaseline
    if($complete-and(Test-Path $testRoot)){
        $resolved=[IO.Path]::GetFullPath($testRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe cleanup path: $resolved"}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
