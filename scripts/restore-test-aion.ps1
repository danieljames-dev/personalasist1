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
      4. runs npm run verify and requires 11 passed / 0 failed;
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
    restoreDirectory   = $restoreDir
    dryRun             = [bool]$DryRun
    steps              = @()
    verificationCommand= 'npm run verify'
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
        Write-Step "would run   : npm run verify  (require 11 passed / 0 failed)"
        $result.outcome = 'DRY-RUN'
        Add-Step 'dry-run' 'PASS' 'planned actions reported; nothing executed'
        Write-Host ''
        return
    }

    New-Item -ItemType Directory -Path $logDir          -Force | Out-Null
    New-Item -ItemType Directory -Path $RestoreTestsRoot -Force | Out-Null

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
    # 4. npm run verify - require 11 passed / 0 failed
    # ---------------------------------------------------------------------
    Write-Step "running npm run verify"
    $vOut = Join-Path $logDir "restore-$Timestamp.verify.out.log"
    $vErr = Join-Path $logDir "restore-$Timestamp.verify.err.log"
    $vCode = Invoke-Logged -CommandLine 'npm run verify' -WorkingDirectory $restoreDir -OutFile $vOut -ErrFile $vErr

    $verifyText = ''
    if (Test-Path $vOut) { $verifyText += (Get-Content $vOut -Raw) }
    if (Test-Path $vErr) { $verifyText += (Get-Content $vErr -Raw) }

    $passMatch = [regex]::Match($verifyText, '(?m)^#\s*pass\s+(\d+)\s*$')
    $failMatch = [regex]::Match($verifyText, '(?m)^#\s*fail\s+(\d+)\s*$')
    if ($passMatch.Success) { $result.testsPassed = [int]$passMatch.Groups[1].Value }
    if ($failMatch.Success) { $result.testsFailed = [int]$failMatch.Groups[1].Value }

    if ($vCode -ne 0)             { throw "npm run verify failed with exit code $vCode (see $vErr)" }
    if ($result.testsPassed -ne 11) { throw "expected 11 passing tests, observed '$($result.testsPassed)'" }
    if ($result.testsFailed -ne 0)  { throw "expected 0 failing tests, observed '$($result.testsFailed)'" }

    Add-Step 'npm-run-verify' 'PASS' "11 passed / 0 failed"

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
