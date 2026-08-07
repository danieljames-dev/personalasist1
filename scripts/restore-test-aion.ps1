<#
.SYNOPSIS
    Proves an AION backup is restorable by cloning it into an isolated directory and
    running the repository verification gate.

.DESCRIPTION
    This script is the evidence half of the backup contract. A backup run may be
    recorded SUCCESS only after this script passes. It:

      1. clones from the bare mirror into a NEW timestamped directory;
      2. checks out the exact expected commit;
      3. runs npm ci;
      4. runs npm run verify and requires exactly -ExpectedTests passed / 0 failed;
      5. writes a JSON result and a full log.

    It never restores over the active working repository. It never deletes anything.

    Exit code 0 means the restore test passed. Any other exit code means it failed;
    the caller must not record SUCCESS.

.PARAMETER MirrorPath
    Bare Git mirror to clone from. Default: <BackupRoot>\repository-mirror\AION.git

.PARAMETER ExpectedCommit
    Full 40-character commit SHA the restored clone must check out. Required.

.PARAMETER BackupRoot
    Approved external backup root. Default: D:\AION-backups

.PARAMETER RestoreTestsRoot
    Where isolated restores are created. Default: <BackupRoot>\restore-tests

.PARAMETER ActiveRepositoryPath
    The live working repository. The script refuses to restore into it or beneath it.

.PARAMETER Timestamp
    UTC stamp used to name the restore directory. Defaults to now.

.PARAMETER ExpectedTests
    Exact number of tests the restored clone must report as passing. Exact equality is
    required in both directions: a DECREASE means tests were lost, an INCREASE means the
    expectation is stale. Either is a failure that must be looked at, not tolerated.

.PARAMETER DryRun
    Report the planned actions and exit without cloning, installing, or verifying.

.EXAMPLE
    # Standalone dry run
    .\scripts\restore-test-aion.ps1 -ExpectedCommit 527ba4b5490b5c60233f77dd3ac5499312eb00fd -DryRun

.EXAMPLE
    # Standalone real restore test
    .\scripts\restore-test-aion.ps1 -ExpectedCommit 527ba4b5490b5c60233f77dd3ac5499312eb00fd

.NOTES
    Windows PowerShell 5.1 compatible. No external modules. No scheduling.
#>

[CmdletBinding()]
param(
    [string]   $MirrorPath,
    [Parameter(Mandatory = $true)]
    [string]   $ExpectedCommit,
    [string]   $BackupRoot           = 'D:\AION-backups',
    [string]   $RestoreTestsRoot,
    [string]   $ActiveRepositoryPath,
    [string]   $Timestamp,
    [int]      $ExpectedTests = 346,
    [switch]   $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Message) Write-Host "  [restore] $Message" }
function Write-Fail { param([string]$Message) Write-Host "  [restore] FAIL: $Message" -ForegroundColor Red }

# Runs git and throws on a non-zero exit code.
# stderr is deliberately NOT redirected: git writes progress there, and merging it in
# Windows PowerShell 5.1 turns ordinary progress lines into terminating ErrorRecords.
function Invoke-Git {
    param([string[]]$Arguments, [string]$WorkingDirectory)
    if ($WorkingDirectory) { Push-Location $WorkingDirectory }
    try {
        & git @Arguments
        if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
    } finally {
        if ($WorkingDirectory) { Pop-Location }
    }
}

# Runs a command through cmd.exe with stdout and stderr captured to separate files.
# Start-Process is used rather than a PowerShell redirect so native stderr cannot be
# reinterpreted as a PowerShell error.
function Invoke-Logged {
    param([string]$CommandLine, [string]$WorkingDirectory, [string]$OutFile, [string]$ErrFile)
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $CommandLine `
        -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile
    return $p.ExitCode
}

# ---------------------------------------------------------------------------
# Resolve defaults
# ---------------------------------------------------------------------------

if (-not $Timestamp)        { $Timestamp        = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'") }
if (-not $MirrorPath)       { $MirrorPath       = Join-Path $BackupRoot 'repository-mirror\AION.git' }
if (-not $RestoreTestsRoot) { $RestoreTestsRoot = Join-Path $BackupRoot 'restore-tests' }

$restoreDir = Join-Path $RestoreTestsRoot "restore-$Timestamp"
$logDir     = Join-Path $BackupRoot 'logs'
$logFile    = Join-Path $logDir "restore-$Timestamp.log"
$resultFile = Join-Path $logDir "restore-$Timestamp.result.json"

$result = [ordered]@{
    schema             = 'aion.restore-test.v1'
    timestampUtc       = $Timestamp
    mirrorPath         = $MirrorPath
    expectedCommit     = $ExpectedCommit
    expectedTests      = $ExpectedTests
    restoreDirectory   = $restoreDir
    dryRun             = [bool]$DryRun
    steps              = @()
    verificationCommand= 'npm run verify'
    regressionCommand  = 'npm run test:backup-refs'
    regressionResult   = $null
    controlPlaneCommand= 'npm run control-plane:test'
    controlPlaneResult = $null
    collectionCommand  = 'npm run control-plane:test-collections'
    collectionResult   = $null
    realGateCommand    = 'npm run control-plane:test-real-gate'
    realGateResult     = $null
    privacyBoundaryCommand = 'npm run privacy-boundary:test'
    privacyBoundaryResult  = $null
    identityCommand    = 'npm run identity:test'
    identityResult     = $null
    objectCommand      = 'npm run object:test'
    objectResult       = $null
    careerInputCommand = 'npm run career-input:test'
    careerEvidenceCommand = 'npm run career-evidence:test'
    jobPostingCommand = 'npm run job-posting:test'
    jobMatchingCommand = 'npm run job-matching:test'
    applicationPreparationCommand = 'npm run application-preparation:test'
    careerCliCommand = 'npm run career:test'
    careerDemoCommand = 'npm run career:demo'
    aionCommand      = 'npm run aion:test'
    aionDemoCommand  = 'npm run aion:demo'
    salesDemoCommand = 'npm run aion:sales:demo'
    careerInputResult  = $null
    careerEvidenceResult = $null
    jobPostingResult = $null
    jobMatchingResult = $null
    applicationPreparationResult = $null
    careerCliResult = $null
    careerDemoResult = $null
    aionResult = $null
    aionDemoResult = $null
    salesDemoResult = $null
    exclusionResult    = $null
    testsPassed        = $null
    testsFailed        = $null
    outcome            = 'FAILURE'
    failureReason      = $null
}

function Add-Step { param([string]$Name, [string]$Status, [string]$Detail = '')
    $script:result.steps += [ordered]@{ step = $Name; status = $Status; detail = $Detail }
}

# ---------------------------------------------------------------------------
# Safety gates
# ---------------------------------------------------------------------------

try {
    Write-Host ''
    Write-Host "AION restore test  ($Timestamp)"
    Write-Host "--------------------------------------------------------------"

    # Gate: never restore into or beneath the active working repository.
    if ($ActiveRepositoryPath) {
        $activeFull  = [System.IO.Path]::GetFullPath($ActiveRepositoryPath).TrimEnd('\')
        $restoreFull = [System.IO.Path]::GetFullPath($restoreDir).TrimEnd('\')
        if ($restoreFull -eq $activeFull -or $restoreFull.StartsWith($activeFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to restore into the active working repository: $restoreFull"
        }
        Add-Step 'isolation-check' 'PASS' "restore target is outside $activeFull"
    }

    # Gate: the restore directory must be new. Never reuse or overwrite.
    if (Test-Path $restoreDir) { throw "Restore directory already exists: $restoreDir" }

    # Gate: the mirror must exist.
    if (-not $DryRun -and -not (Test-Path $MirrorPath)) { throw "Mirror not found: $MirrorPath" }

    if ($DryRun) {
        Write-Step "DRY RUN - no clone, no install, no verification"
        Write-Step "would clone : $MirrorPath"
        Write-Step "would create: $restoreDir"
        Write-Step "would check out commit: $ExpectedCommit"
        Write-Step "would run   : npm ci"
        Write-Step "would run   : npm run verify  (require $ExpectedTests passed / 0 failed)"
        Write-Step "would run   : npm run test:backup-refs"
        Write-Step "would run   : npm run control-plane:test"
        Write-Step "would run   : npm run control-plane:test-collections"
        Write-Step "would run   : npm run control-plane:test-real-gate"
        Write-Step "would run   : npm run privacy-boundary:test"
        Write-Step "would run   : npm run identity:test (synthetic state only)"
        Write-Step "would run   : npm run object:test (synthetic process-local state only)"
        Write-Step "would run   : npm run career-input:test (synthetic temporary inputs only)"
        Write-Step "would run   : npm run career-evidence:test (synthetic temporary inputs and Object stores only)"
        Write-Step "would run   : npm run job-posting:test (synthetic temporary Job Posting inputs and Object stores only)"
        Write-Step "would run   : npm run job-matching:test (synthetic deterministic matching only)"
        Write-Step "would run   : npm run application-preparation:test (synthetic review-gated drafts only)"
        Write-Step "would run   : npm run career:test (synthetic temporary roots only)"
        Write-Step "would run   : npm run career:demo (complete temporary vertical slice)"
        Write-Step "would run   : npm run aion:test (local assistant, architecture, and Command Center suites)"
        Write-Step "would run   : npm run aion:demo (complete synthetic V1 product proof, reload, and rerun)"
        $result.outcome = 'DRY-RUN'
        Add-Step 'dry-run' 'PASS' 'planned actions reported; nothing executed'
        Write-Host ''
        return
    }

    New-Item -ItemType Directory -Path $logDir          -Force | Out-Null
    New-Item -ItemType Directory -Path $RestoreTestsRoot -Force | Out-Null

    $mirrorMain = (& git --git-dir=$MirrorPath rev-parse refs/heads/main).Trim()
    if ($mirrorMain -ne $ExpectedCommit) {
        throw "Mirror main $mirrorMain does not match expected $ExpectedCommit"
    }
    $mirrorCodexRefs = @(& git --git-dir=$MirrorPath for-each-ref --format='%(refname)' refs/codex)
    if ($mirrorCodexRefs.Count -gt 0) { throw 'Mirror contains excluded refs/codex refs' }
    Add-Step 'mirror-ref-policy' 'PASS' 'main matches expected commit; refs/codex absent'

    # ---------------------------------------------------------------------
    # 1. Clone from the mirror
    # ---------------------------------------------------------------------
    Write-Step "cloning mirror into $restoreDir"
    Invoke-Git @('clone', $MirrorPath, $restoreDir)
    Add-Step 'clone' 'PASS' $restoreDir

    # ---------------------------------------------------------------------
    # 2. Check out the exact expected commit
    # ---------------------------------------------------------------------
    Write-Step "checking out $ExpectedCommit"
    Invoke-Git @('checkout', '--detach', $ExpectedCommit) -WorkingDirectory $restoreDir

    Push-Location $restoreDir
    try { $actual = (& git rev-parse HEAD).Trim() } finally { Pop-Location }

    if ($actual -ne $ExpectedCommit) { throw "Restored HEAD $actual does not match expected $ExpectedCommit" }
    Add-Step 'checkout' 'PASS' $actual

    $treePaths = @(& git -C $restoreDir ls-tree -r --name-only HEAD)
    if (@($treePaths | Where-Object { $_ -like 'private/*' -or $_ -like '.aion-local/*' }).Count -ne 0) {
        throw 'Restored Git tree contains private/ or .aion-local/'
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\identity\identity-state-v1.json')) {
        throw 'Restored repository contains actual private Identity state'
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\object')) {
        throw 'Restored repository contains private Object state'
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\career')) {
        throw 'Restored repository contains private career input or state'
    }
    $result.exclusionResult = 'PASS'
    Add-Step 'private-state-exclusion' 'PASS' 'Git tree excludes private/ and .aion-local/; Identity, Object, and career private state absent'

    # ---------------------------------------------------------------------
    # 3. npm ci
    # ---------------------------------------------------------------------
    Write-Step "running npm ci (this downloads dependencies)"
    $ciOut = Join-Path $logDir "restore-$Timestamp.npm-ci.out.log"
    $ciErr = Join-Path $logDir "restore-$Timestamp.npm-ci.err.log"
    $ciCode = Invoke-Logged -CommandLine 'npm ci' -WorkingDirectory $restoreDir -OutFile $ciOut -ErrFile $ciErr
    if ($ciCode -ne 0) { throw "npm ci failed with exit code $ciCode (see $ciErr)" }
    Add-Step 'npm-ci' 'PASS' "exit 0"

    # ---------------------------------------------------------------------
    # 4. npm run verify - require the declared count / 0 failed
    # ---------------------------------------------------------------------
    Write-Step "running npm run verify"
    $vOut = Join-Path $logDir "restore-$Timestamp.verify.out.log"
    $vErr = Join-Path $logDir "restore-$Timestamp.verify.err.log"
    $vCode = Invoke-Logged -CommandLine 'npm run verify' -WorkingDirectory $restoreDir -OutFile $vOut -ErrFile $vErr

    $verifyText = ''
    if (Test-Path $vOut) { $verifyText += (Get-Content $vOut -Raw) }
    if (Test-Path $vErr) { $verifyText += (Get-Content $vErr -Raw) }

    $passMatches = [regex]::Matches($verifyText, '(?m)^#\s*pass\s+(\d+)\s*$')
    $failMatches = [regex]::Matches($verifyText, '(?m)^#\s*fail\s+(\d+)\s*$')
    $result.testsPassed = [int](($passMatches | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Sum).Sum)
    $result.testsFailed = [int](($failMatches | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Sum).Sum)

    if ($vCode -ne 0) { throw "npm run verify failed with exit code $vCode (see $vErr)" }
    if ($result.testsPassed -ne $ExpectedTests) {
        throw "expected $ExpectedTests passing tests, observed '$($result.testsPassed)'. A DECREASE means tests were lost; an INCREASE means -ExpectedTests is stale. Neither is tolerated."
    }
    if ($result.testsFailed -ne 0)  { throw "expected 0 failing tests, observed '$($result.testsFailed)'" }

    Add-Step 'npm-run-verify' 'PASS' "$ExpectedTests passed / 0 failed"

    # ---------------------------------------------------------------------
    # 5. Backup-ref regression test
    # ---------------------------------------------------------------------
    Write-Step "running npm run test:backup-refs"
    $rOut = Join-Path $logDir "restore-$Timestamp.backup-refs.out.log"
    $rErr = Join-Path $logDir "restore-$Timestamp.backup-refs.err.log"
    $rCode = Invoke-Logged -CommandLine 'npm run test:backup-refs' -WorkingDirectory $restoreDir -OutFile $rOut -ErrFile $rErr
    if ($rCode -ne 0) { throw "backup-ref regression failed with exit code $rCode (see $rErr)" }
    $result.regressionResult = 'PASS'
    Add-Step 'backup-ref-regression' 'PASS' 'overlong synthetic refs/codex excluded'

    Write-Step "running npm run control-plane:test"
    $cOut = Join-Path $logDir "restore-$Timestamp.control-plane.out.log"
    $cErr = Join-Path $logDir "restore-$Timestamp.control-plane.err.log"
    $cCode = Invoke-Logged -CommandLine 'npm run control-plane:test' -WorkingDirectory $restoreDir -OutFile $cOut -ErrFile $cErr
    if ($cCode -ne 0) { throw "control-plane regression failed with exit code $cCode (see $cErr)" }
    $result.controlPlaneResult = 'PASS'
    Add-Step 'control-plane-regression' 'PASS' 'control-plane suite passed; no model or network'

    Write-Step "running npm run control-plane:test-collections"
    $aOut = Join-Path $logDir "restore-$Timestamp.collections.out.log"
    $aErr = Join-Path $logDir "restore-$Timestamp.collections.err.log"
    $aCode = Invoke-Logged -CommandLine 'npm run control-plane:test-collections' -WorkingDirectory $restoreDir -OutFile $aOut -ErrFile $aErr
    if ($aCode -ne 0) { throw "collection regression failed with exit code $aCode (see $aErr)" }
    $result.collectionResult = 'PASS'
    Add-Step 'collection-regression' 'PASS' 'zero, one, and multiple collection cases passed'

    Write-Step "preparing isolated clone for the real repository gate"
    Invoke-Git @('checkout', 'main') -WorkingDirectory $restoreDir
    Invoke-Git @('remote', 'set-url', 'origin', 'https://github.com/danieljames-dev/personalasist1.git') -WorkingDirectory $restoreDir
    Write-Step "running npm run control-plane:test-real-gate"
    $gOut = Join-Path $logDir "restore-$Timestamp.real-gate.out.log"
    $gErr = Join-Path $logDir "restore-$Timestamp.real-gate.err.log"
    $gCode = Invoke-Logged -CommandLine 'npm run control-plane:test-real-gate' -WorkingDirectory $restoreDir -OutFile $gOut -ErrFile $gErr
    if ($gCode -ne 0) { throw "real-gate regression failed with exit code $gCode (see $gErr)" }
    $gateText=(Get-Content -LiteralPath $gOut -Raw)+(Get-Content -LiteralPath $gErr -Raw)
    if($gateText-match "property 'Statement'" -or $gateText-match 'Compare-Object.*null'){throw 'Prior PowerShell compatibility failure returned'}
    $result.realGateResult = 'PASS'
    Add-Step 'real-gate-regression' 'PASS' 'temporary authorization passed and wrong HEAD failed closed'

    Write-Step "running npm run privacy-boundary:test"
    $pOut = Join-Path $logDir "restore-$Timestamp.privacy-boundary.out.log"
    $pErr = Join-Path $logDir "restore-$Timestamp.privacy-boundary.err.log"
    $pCode = Invoke-Logged -CommandLine 'npm run privacy-boundary:test' -WorkingDirectory $restoreDir -OutFile $pOut -ErrFile $pErr
    if ($pCode -ne 0) { throw "privacy-boundary regression failed with exit code $pCode (see $pErr)" }
    $result.privacyBoundaryResult = 'PASS'
    Add-Step 'privacy-boundary-regression' 'PASS' 'path, link, input, network, Git, and backup boundaries passed'

    Write-Step "running npm run identity:test with synthetic temporary state"
    $iOut = Join-Path $logDir "restore-$Timestamp.identity.out.log"
    $iErr = Join-Path $logDir "restore-$Timestamp.identity.err.log"
    $iCode = Invoke-Logged -CommandLine 'npm run identity:test' -WorkingDirectory $restoreDir -OutFile $iOut -ErrFile $iErr
    if ($iCode -ne 0) { throw "Identity regression failed with exit code $iCode (see $iErr)" }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\identity\identity-state-v1.json')) {
        throw 'Identity regression initialized real state in the restored repository'
    }
    $result.identityResult = 'PASS'
    Add-Step 'identity-regression' 'PASS' 'all Identity tests passed using synthetic temporary state only'

    Write-Step "running npm run object:test with synthetic process-local state"
    $oOut = Join-Path $logDir "restore-$Timestamp.object.out.log"
    $oErr = Join-Path $logDir "restore-$Timestamp.object.err.log"
    $oCode = Invoke-Logged -CommandLine 'npm run object:test' -WorkingDirectory $restoreDir -OutFile $oOut -ErrFile $oErr
    if ($oCode -ne 0) { throw "Object regression failed with exit code $oCode (see $oErr)" }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\object')) {
        throw 'Object regression created private Object state in the restored repository'
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\object-store')) {
        throw 'Object regression created a permanent private Object store in the restored repository'
    }
    $result.objectResult = 'PASS'
    Add-Step 'object-regression' 'PASS' 'all Object tests passed using synthetic process-local and temporary filesystem state only'

    Write-Step "running npm run career-input:test with synthetic temporary inputs"
    $kOut = Join-Path $logDir "restore-$Timestamp.career-input.out.log"
    $kErr = Join-Path $logDir "restore-$Timestamp.career-input.err.log"
    $kCode = Invoke-Logged -CommandLine 'npm run career-input:test' -WorkingDirectory $restoreDir -OutFile $kOut -ErrFile $kErr
    if ($kCode -ne 0) { throw "career-input regression failed with exit code $kCode (see $kErr)" }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\career')) {
        throw 'career-input regression created private career input or state in the restored repository'
    }
    $result.careerInputResult = 'PASS'
    Add-Step 'career-input-regression' 'PASS' 'all career-input tests passed using neutral synthetic temporary files only'

    Write-Step "running npm run career-evidence:test with synthetic temporary inputs and Object stores"
    $eOut = Join-Path $logDir "restore-$Timestamp.career-evidence.out.log"
    $eErr = Join-Path $logDir "restore-$Timestamp.career-evidence.err.log"
    $eCode = Invoke-Logged -CommandLine 'npm run career-evidence:test' -WorkingDirectory $restoreDir -OutFile $eOut -ErrFile $eErr
    if ($eCode -ne 0) { throw "career-evidence regression failed with exit code $eCode (see $eErr)" }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\career')) {
        throw 'career-evidence regression created permanent private career input in the restored repository'
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\object-store')) {
        throw 'career-evidence regression created a permanent private Object store in the restored repository'
    }
    $result.careerEvidenceResult = 'PASS'
    Add-Step 'career-evidence-regression' 'PASS' 'all career-evidence tests passed using neutral synthetic temporary state only'

    Write-Step "running npm run job-posting:test with synthetic temporary inputs and Object stores"
    $jOut = Join-Path $logDir "restore-$Timestamp.job-posting.out.log"
    $jErr = Join-Path $logDir "restore-$Timestamp.job-posting.err.log"
    $jCode = Invoke-Logged -CommandLine 'npm run job-posting:test' -WorkingDirectory $restoreDir -OutFile $jOut -ErrFile $jErr
    if ($jCode -ne 0) { throw "job-posting regression failed with exit code $jCode (see $jErr)" }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\career')) {
        throw 'job-posting regression created permanent private career input in the restored repository'
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\object-store')) {
        throw 'job-posting regression created a permanent private Object store in the restored repository'
    }
    $result.jobPostingResult = 'PASS'
    Add-Step 'job-posting-regression' 'PASS' 'all Job Posting tests passed using neutral synthetic temporary state only'

    Write-Step "running npm run job-matching:test"
    $mOut = Join-Path $logDir "restore-$Timestamp.job-matching.out.log"
    $mErr = Join-Path $logDir "restore-$Timestamp.job-matching.err.log"
    $mCode = Invoke-Logged -CommandLine 'npm run job-matching:test' -WorkingDirectory $restoreDir -OutFile $mOut -ErrFile $mErr
    if ($mCode -ne 0) { throw "Job Matching regression failed with exit code $mCode (see $mErr)" }
    $result.jobMatchingResult = 'PASS'
    Add-Step 'job-matching-regression' 'PASS' 'transparent deterministic matching passed on neutral synthetic state'

    Write-Step "running npm run application-preparation:test"
    $dOut = Join-Path $logDir "restore-$Timestamp.application-preparation.out.log"
    $dErr = Join-Path $logDir "restore-$Timestamp.application-preparation.err.log"
    $dCode = Invoke-Logged -CommandLine 'npm run application-preparation:test' -WorkingDirectory $restoreDir -OutFile $dOut -ErrFile $dErr
    if ($dCode -ne 0) { throw "Application Preparation regression failed with exit code $dCode (see $dErr)" }
    $result.applicationPreparationResult = 'PASS'
    Add-Step 'application-preparation-regression' 'PASS' 'evidence-backed owner-review drafts passed on neutral synthetic state'

    Write-Step "running npm run career:test"
    $qOut = Join-Path $logDir "restore-$Timestamp.career-cli.out.log"
    $qErr = Join-Path $logDir "restore-$Timestamp.career-cli.err.log"
    $qCode = Invoke-Logged -CommandLine 'npm run career:test' -WorkingDirectory $restoreDir -OutFile $qOut -ErrFile $qErr
    if ($qCode -ne 0) { throw "Career CLI regression failed with exit code $qCode (see $qErr)" }
    $result.careerCliResult = 'PASS'
    Add-Step 'career-cli-regression' 'PASS' 'CLI help, dry-run, temporary end-to-end, export/reload, and boundaries passed'

    Write-Step "running npm run career:demo"
    $zOut = Join-Path $logDir "restore-$Timestamp.career-demo.out.log"
    $zErr = Join-Path $logDir "restore-$Timestamp.career-demo.err.log"
    $zCode = Invoke-Logged -CommandLine 'npm run career:demo' -WorkingDirectory $restoreDir -OutFile $zOut -ErrFile $zErr
    if ($zCode -ne 0) { throw "Career demo failed with exit code $zCode (see $zErr)" }
    $demoText = (Get-Content -LiteralPath $zOut -Raw) + (Get-Content -LiteralPath $zErr -Raw)
    if ($demoText -notmatch 'Synthetic Career demo complete' -or $demoText -notmatch 'already-completed') {
        throw 'Career demo completion or deterministic-rerun evidence missing'
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private')) { throw 'Career demo left permanent private runtime state in the restored repository' }
    $result.careerDemoResult = 'PASS'
    Add-Step 'career-demo-regression' 'PASS' 'complete synthetic demo, reload, rerun, and temporary cleanup passed'

    Write-Step "running npm run aion:test"
    $tOut = Join-Path $logDir "restore-$Timestamp.aion.out.log"
    $tErr = Join-Path $logDir "restore-$Timestamp.aion.err.log"
    $tCode = Invoke-Logged -CommandLine 'npm run aion:test' -WorkingDirectory $restoreDir -OutFile $tOut -ErrFile $tErr
    if ($tCode -ne 0) { throw "AION V1 regression failed with exit code $tCode (see $tErr)" }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private\aion')) {
        throw 'AION V1 regression created permanent assistant state in the restored repository'
    }
    $result.aionResult = 'PASS'
    Add-Step 'aion-regression' 'PASS' 'local assistant, architecture boundary, and Command Center suites passed on synthetic temporary state only'

    Write-Step "running npm run aion:demo"
    $yOut = Join-Path $logDir "restore-$Timestamp.aion-demo.out.log"
    $yErr = Join-Path $logDir "restore-$Timestamp.aion-demo.err.log"
    $yCode = Invoke-Logged -CommandLine 'npm run aion:demo' -WorkingDirectory $restoreDir -OutFile $yOut -ErrFile $yErr
    if ($yCode -ne 0) { throw "AION V1 demo failed with exit code $yCode (see $yErr)" }
    $aionText = (Get-Content -LiteralPath $yOut -Raw) + (Get-Content -LiteralPath $yErr -Raw)
    foreach ($required in @(
        'AION V1 synthetic demo PASS',
        'reloads the identical local state',
        'byte-identical state',
        'one-shot approval is required',
        'encrypted private backup',
        'Career screen runs the accepted Career engine')) {
        if ($aionText -notmatch [regex]::Escape($required)) { throw "AION V1 demo evidence missing: $required" }
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private')) { throw 'AION V1 demo left permanent private runtime state in the restored repository' }
    $result.aionDemoResult = 'PASS'
    Add-Step 'aion-demo-regression' 'PASS' 'complete synthetic V1 product proof, restart reload, deterministic rerun, and cleanup passed'

    Write-Step "running npm run aion:sales:demo"
    $salesOut = Join-Path $logDir "restore-$Timestamp.sales-demo.out.log"
    $salesErr = Join-Path $logDir "restore-$Timestamp.sales-demo.err.log"
    $salesExit = Invoke-Logged -CommandLine 'npm run aion:sales:demo' -WorkingDirectory $restoreDir -OutFile $salesOut -ErrFile $salesErr
    if ($salesExit -ne 0) { throw "npm run aion:sales:demo failed with exit code $salesExit" }
    $salesText = Get-Content -LiteralPath $salesOut -Raw
    foreach ($required in @(
        'Mobile Sales demo PASS',
        'durable Work relationship records',
        'Work and Personal stay separated',
        'pairs with the one-time code',
        'cannot mint a code',
        'reloads the identical Work state')) {
        if ($salesText -notmatch [regex]::Escape($required)) { throw "Mobile Sales demo evidence missing: $required" }
    }
    if (Test-Path -LiteralPath (Join-Path $restoreDir 'private')) { throw 'Mobile Sales demo left permanent private runtime state in the restored repository' }
    $result.salesDemoResult = 'PASS'
    Add-Step 'aion-sales-demo-regression' 'PASS' 'complete synthetic Mobile Sales proof, phone pairing, workspace isolation, and cleanup passed'

    $result.outcome = 'SUCCESS'
    Write-Step "RESTORE TEST PASSED"
}
catch {
    $result.failureReason = $_.Exception.Message
    $result.outcome       = 'FAILURE'
    Add-Step 'error' 'FAIL' $result.failureReason
    Write-Fail $result.failureReason
}
finally {
    # Evidence is always written for real runs, for failures as well as successes.
    # A dry run writes nothing at all, including no evidence file.
    if ($DryRun) {
        Write-Host "  [restore] dry run complete - no files written"
        Write-Host ''
    }
    else {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $json = $result | ConvertTo-Json -Depth 8
    Set-Content -Path $resultFile -Value $json -Encoding utf8
    Set-Content -Path $logFile -Value @(
        "AION restore test $Timestamp",
        "mirror   : $MirrorPath",
        "expected : $ExpectedCommit",
        "restored : $restoreDir",
        "outcome  : $($result.outcome)",
        "reason   : $($result.failureReason)"
    ) -Encoding utf8
    Write-Host "  [restore] result : $resultFile"
    Write-Host ''
    }
}

if ($result.outcome -eq 'SUCCESS' -or $result.outcome -eq 'DRY-RUN') { exit 0 } else { exit 1 }
