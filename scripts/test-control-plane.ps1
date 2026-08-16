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
    [string]$Extra=''
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
Known-Failing-Gate: LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY
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
if "%2"=="typecheck" goto typecheck
exit /b 37

:verify
if "%MODE%"=="verify-fail" exit /b 9
exit /b 0

:test
if "%MODE%"=="broken" goto broken
if "%MODE%"=="wrong-text" goto wrongtext
if "%MODE%"=="other-exit" exit /b 2
exit /b 0

:broken
echo developer bridge is the single process boundary and is repository-scoped
echo packages/local-assistant/src/developer-bridge.ts contains process.env
exit /b 1

:wrongtext
echo unrelated failure
exit /b 1

:typecheck
if "%MODE%"=="typecheck-fail" exit /b 8
exit /b 0
"@
    [IO.File]::WriteAllText($scriptPath,$body,[Text.ASCIIEncoding]::new())
    return $scriptPath
}

function Add-RepairBaselineFiles([string]$Root){
    $src=Join-Path $Root 'packages\local-assistant\src'
    $test=Join-Path $Root 'packages\local-assistant\test'
    $director=Join-Path $Root 'packages\director'
    [IO.Directory]::CreateDirectory($src)|Out-Null
    [IO.Directory]::CreateDirectory($test)|Out-Null
    [IO.Directory]::CreateDirectory($director)|Out-Null
    [IO.File]::WriteAllText((Join-Path $src 'developer-bridge.ts'),'export const broken = process.env.AION_TEST;',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $test 'architecture-boundary.test.mjs'),'assert boundary policy',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $director 'sentinel.txt'),'director evidence tree',[Text.UTF8Encoding]::new($false))
    & git -C $Root add packages
    & git -C $Root commit -m 'add repair baseline files'|Out-Null
    return (& git -C $Root rev-parse HEAD).Trim()
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
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline
        $repairDirective=Get-AionDirective $current
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive $repairDirective;Pass '24 repair authorization accepts known failing gate'}catch{Fail '24 repair authorization accepts known failing gate' $_.Exception.Message}
        $repairExit=Invoke-AuthorizationFixture 'AUTHORIZE SYNTHETIC REPAIR' -NoSkip
        Expect-True '25 repair authorization records AUTHORIZED' (($repairExit -eq 0)-and((Get-AionDirective $current).Fields.Status -ceq 'AUTHORIZED'))

        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline
        $badPhraseExit=Invoke-AuthorizationFixture 'wrong repair phrase' -NoSkip
        Expect-True '26 repair authorization rejects wrong phrase' (($badPhraseExit -ne 0)-and((Get-AionDirective $current).Fields.Status -ceq 'PENDING_OWNER_AUTHORIZATION'))
        $realRepo=(Split-Path -Parent $PSScriptRoot)
        $skipOut=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.out')
        $skipErr=Join-Path $testRoot ([guid]::NewGuid().ToString('N')+'.err')
        $skipProcess=Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'authorize-current-directive.ps1')+'"'),
            '-RepositoryRoot',('"'+$realRepo+'"'),'-DirectivePath',('"'+$current+'"'),
            '-TestMode','-SkipRepositoryChecks','-AuthorizationInput','"AUTHORIZE SYNTHETIC REPAIR"'
        ) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $skipOut -RedirectStandardError $skipErr
        Expect-True '27 skip repository checks forbidden outside temp' ($skipProcess.ExitCode -ne 0)

        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Authorization-Class: OTHER'
        Expect-Throw '28 duplicate repair class rejected' {Get-AionDirectiveFieldOrDefault (Get-AionDirective $current) 'Authorization-Class'|Out-Null}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Known-Failing-Gate: UNKNOWN_GATE'
        Expect-Throw '29 unknown repair gate rejected' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: package.json'
        Expect-Throw '30 repair allowlist cannot broaden scope' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: ../outside'
        Expect-Throw '31 repair allowlist rejects traversal' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: packages/*'
        Expect-Throw '32 repair allowlist rejects globs' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' 'Allowed-Repair-Files: packages\local-assistant\src\developer-bridge.ts'
        Expect-Throw '33 repair allowlist rejects backslashes' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}

        New-FakeNpm $fakeBin 'wrong-text'|Out-Null
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline
        Expect-Throw '34 known gate requires expected failure text' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'other-exit'|Out-Null
        Expect-Throw '35 known gate requires expected failure exit code' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'fixed'|Out-Null
        Expect-Throw '36 already-green gate cannot authorize repair' {Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current)}
        New-FakeNpm $fakeBin 'broken'|Out-Null
        $sentinel=Join-Path $testRoot 'directive-command-ran.txt'
        New-RepairDirective $current 'PENDING_OWNER_AUTHORIZATION' $repairBaseline 'AUTHORIZE SYNTHETIC REPAIR' "Known-Failing-Command: cmd /c echo BAD > $sentinel"
        try{Assert-AionBrokenBaselineRepairGate -Root $repo -Directive (Get-AionDirective $current);Pass '37 directive command fields are ignored'}catch{Fail '37 directive command fields are ignored' $_.Exception.Message}
        Expect-True '38 directive command text is not executed' (-not(Test-Path $sentinel))
        Expect-Throw '39 repair gate enforces main branch' {Assert-AionBaselineValues $repairBaseline 'feature/test' $repairBaseline $script:AionCanonicalOrigin 0 0 @()}
        Expect-Throw '40 repair gate enforces origin parity' {Assert-AionBaselineValues $repairBaseline main $repairBaseline $script:AionCanonicalOrigin 1 0 @()}

        New-RepairDirective $current 'AUTHORIZED' $repairBaseline
        Expect-Throw '41 closure requires committed result' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        [IO.File]::WriteAllText((Join-Path $repo 'packages\local-assistant\test\architecture-boundary.test.mjs'),'weakened policy',[Text.UTF8Encoding]::new($false))
        & git -C $repo add packages/local-assistant/test/architecture-boundary.test.mjs
        & git -C $repo commit -m 'bad protected change'|Out-Null
        New-FakeNpm $fakeBin 'fixed'|Out-Null
        Expect-Throw '42 closure rejects protected policy change' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        & git -C $repo checkout -q -B main $repairBaseline
        & git -C $repo update-ref refs/remotes/origin/main $repairBaseline

        New-RepairDirective $current 'AUTHORIZED' $repairBaseline
        [IO.File]::WriteAllText((Join-Path $repo 'package.json'),'{"scripts":{"verify":"exit 0"}}',[Text.UTF8Encoding]::new($false))
        & git -C $repo add package.json
        & git -C $repo commit -m 'bad broad change'|Out-Null
        Expect-Throw '43 closure rejects unauthorized changed path' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        & git -C $repo checkout -q -B main $repairBaseline
        & git -C $repo update-ref refs/remotes/origin/main $repairBaseline

        New-RepairDirective $current 'AUTHORIZED' $repairBaseline
        [IO.File]::WriteAllText((Join-Path $repo 'packages\local-assistant\src\developer-bridge.ts'),'export const fixed = true;',[Text.UTF8Encoding]::new($false))
        & git -C $repo add packages/local-assistant/src/developer-bridge.ts
        & git -C $repo commit -m 'repair allowed file'|Out-Null
        $resultSha=(& git -C $repo rev-parse HEAD).Trim()
        New-FakeNpm $fakeBin 'fixed'|Out-Null
        $receiptPath=Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline
        Expect-True '44 closure writes PASS receipt and closes directive' ((Test-Path $receiptPath)-and((Get-AionDirective $current).Fields.Status -ceq 'CLOSED'))
        Expect-Throw '45 CLOSED repair directive cannot close twice' {Assert-AionBrokenBaselineRepairClosure -Root $repo -Directive (Get-AionDirective $current) -ReviewedDirectorSha $repairBaseline}
        Expect-Throw '46 push receipt validator rejects missing result receipt' {Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha '0000000000000000000000000000000000000000' -BaselineSha $repairBaseline -ReviewedDirectorSha $repairBaseline}
        Expect-Throw '47 push receipt validator rejects wrong baseline' {Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $resultSha -BaselineSha 'wrong' -ReviewedDirectorSha $repairBaseline}
        try{Assert-AionRepairClosureReceiptForPush -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $resultSha -BaselineSha $repairBaseline -ReviewedDirectorSha $repairBaseline;Pass '48 push receipt validator accepts exact closed repair'}catch{Fail '48 push receipt validator accepts exact closed repair' $_.Exception.Message}
        $receipt=Get-AionRepairClosureReceipt -Root $repo -DirectiveId 'TEST-REPAIR' -ResultSha $resultSha
        Expect-True '49 closure records Director tree equivalence' ($receipt.directorTreeEquivalence -ceq 'PASS')
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
