<#
.SYNOPSIS
    Creates a verified external backup of the AION repository on the approved drive.

.DESCRIPTION
    Produces four artifact classes under the approved backup root, then proves the
    backup is restorable before recording success:

      repository-mirror\AION.git        bare mirror, updated in place
      working-snapshots\*.bundle        immutable point-in-time Git bundle
      working-snapshots\*-untracked.zip explicitly declared untracked files only
      manifests\*.json                  machine-readable record of the run
      logs\*.log                        run logs, retained on failure too

    SUCCESS is recorded ONLY when the restore test passes: the mirror clones, the
    expected commit checks out, npm ci completes, and npm run verify reports exactly
    -ExpectedTests passed / 0 failed. A run that produces artifacts but fails verification is
    recorded FAILURE and the previous known-good backup remains the recovery point.

    The script never deletes source files and never deletes prior backups.

.PARAMETER BackupRoot
    Approved external backup root. Default: D:\AION-backups

.PARAMETER RepositoryPath
    Repository to back up. Defaults to the parent of the scripts directory.

.PARAMETER ExpectedRemote
    Canonical remote the repository must be configured with. The run aborts on
    mismatch, so a misconfigured clone cannot be silently backed up as canonical.

.PARAMETER IncludeUntracked
    Repository-relative untracked files to archive. Untracked files are excluded by
    default; each one must be named here explicitly. Any untracked file present but
    not declared aborts the run.

.PARAMETER DryRun
    Report every planned action and abort before writing to the backup root.

.EXAMPLE
    # Dry run - shows what would happen, writes nothing
    .\scripts\backup-aion.ps1 -DryRun

.EXAMPLE
    # Real backup with a declared untracked file
    .\scripts\backup-aion.ps1 -IncludeUntracked 'docs/operations/backup-strategy.md'

.EXAMPLE
    # Real backup to a different approved root
    .\scripts\backup-aion.ps1 -BackupRoot 'E:\AION-backups'

.NOTES
    Windows PowerShell 5.1 compatible. No external modules. Not scheduled - run on
    demand only. Scheduling requires separate approval.
#>

[CmdletBinding()]
param(
    [string]   $BackupRoot       = 'D:\AION-backups',
    [string]   $RepositoryPath,
    [string]   $ExpectedRemote   = 'https://github.com/danieljames-dev/personalasist1.git',
    [string[]] $IncludeUntracked = @(),
    [int]      $ExpectedTests     = 12,
    [switch]   $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Content that must never reach a backup archive, regardless of declaration.
$ForbiddenPatterns = @(
    'node_modules', 'dist/', 'dist-test/', '*.tsbuildinfo', '*.tgz',
    '.env', '.env.*', '*.pem', '*.key', '*.pfx', 'id_rsa*',
    '.vscode/', '.idea/', '*.log', '*.sqlite', '*.db', 'Thumbs.db', '.DS_Store'
)

function Write-Step { param([string]$Message) Write-Host "  [backup] $Message" }
function Write-Fail { param([string]$Message) Write-Host "  [backup] FAIL: $Message" -ForegroundColor Red }

# Runs git and throws on non-zero exit. stderr is intentionally not redirected:
# git writes progress there and merging it in PS 5.1 creates spurious errors.
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

function Get-Sha256 {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'")

if (-not $RepositoryPath) {
    $RepositoryPath = Split-Path -Parent $PSScriptRoot
}
$RepositoryPath = (Resolve-Path $RepositoryPath).Path

$mirrorDir    = Join-Path $BackupRoot 'repository-mirror'
$mirrorPath   = Join-Path $mirrorDir  'AION.git'
$snapshotDir  = Join-Path $BackupRoot 'working-snapshots'
$manifestDir  = Join-Path $BackupRoot 'manifests'
$logDir       = Join-Path $BackupRoot 'logs'
$bundlePath   = Join-Path $snapshotDir "AION-$timestamp.bundle"
$untrackedZip = Join-Path $snapshotDir "AION-$timestamp-untracked.zip"
$manifestPath = Join-Path $manifestDir "backup-$timestamp.json"
$logPath      = Join-Path $logDir      "backup-$timestamp.log"

$manifest = [ordered]@{
    schema              = 'aion.backup-manifest.v1'
    timestampUtc        = $timestamp
    repositorySourcePath= $RepositoryPath
    canonicalRemote     = $ExpectedRemote
    branch              = $null
    commitHash          = $null
    mirrorPath          = $mirrorPath
    bundlePath          = $bundlePath
    untrackedArchivePath= $null
    includedUntracked   = @()
    exclusions          = $ForbiddenPatterns
    checksums           = [ordered]@{}
    verificationCommand = 'npm run verify'
    expectedTests       = $ExpectedTests
    restoreResult       = $null
    outcome             = 'FAILURE'
    failureReason       = $null
    dryRun              = [bool]$DryRun
}

try {
    Write-Host ''
    Write-Host "AION backup  ($timestamp)"
    Write-Host "=============================================================="
    Write-Step "repository : $RepositoryPath"
    Write-Step "backup root: $BackupRoot"

    # -----------------------------------------------------------------------
    # Gate 1 - the source must be a Git repository root
    # -----------------------------------------------------------------------
    if (-not (Test-Path (Join-Path $RepositoryPath '.git'))) {
        throw "Not a Git repository root: $RepositoryPath"
    }
    Push-Location $RepositoryPath
    try {
        $topLevel = (& git rev-parse --show-toplevel).Trim()
        $topLevel = (Resolve-Path $topLevel).Path
        if ($topLevel.TrimEnd('\') -ne $RepositoryPath.TrimEnd('\')) {
            throw "Repository root mismatch: git reports '$topLevel', expected '$RepositoryPath'"
        }

        # -------------------------------------------------------------------
        # Gate 2 - the configured remote must be the approved canonical remote
        # -------------------------------------------------------------------
        $actualRemote = (& git remote get-url origin).Trim()
        if ($actualRemote -ne $ExpectedRemote) {
            throw "Remote mismatch. Configured '$actualRemote', approved '$ExpectedRemote'"
        }
        Write-Step "remote     : $actualRemote  (approved)"

        $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
        $commit = (& git rev-parse HEAD).Trim()
        $manifest.branch     = $branch
        $manifest.commitHash = $commit
        Write-Step "branch     : $branch"
        Write-Step "commit     : $commit"

        # -------------------------------------------------------------------
        # Gate 3 - refuse unexpected staged or modified tracked files
        # Gate 4 - permit untracked files only when explicitly declared
        # -------------------------------------------------------------------
        $statusLines = @(& git status --porcelain=v1 -uall)
        $declared    = @($IncludeUntracked | ForEach-Object { $_.Replace('\','/').Trim() })
        $dirty       = @()
        $undeclared  = @()

        foreach ($line in $statusLines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $code = $line.Substring(0, 2)
            $path = $line.Substring(3).Trim().Replace('\','/')
            if ($code -eq '??') {
                if ($declared -notcontains $path) { $undeclared += $path }
            } else {
                $dirty += "$code $path"
            }
        }

        if ($dirty.Count -gt 0) {
            throw "Refusing to back up a dirty working tree. Commit or revert first:`n    $($dirty -join "`n    ")"
        }
        if ($undeclared.Count -gt 0) {
            throw "Undeclared untracked files present. Re-run with -IncludeUntracked, or remove them:`n    $($undeclared -join "`n    ")"
        }
        Write-Step "worktree   : clean (no staged or modified tracked files)"

        # -------------------------------------------------------------------
        # Gate 5 - declared files must exist and must not match an exclusion
        # -------------------------------------------------------------------
        foreach ($rel in $declared) {
            if ([string]::IsNullOrWhiteSpace($rel)) { continue }
            $full = Join-Path $RepositoryPath ($rel -replace '/', '\')
            if (-not (Test-Path $full)) { throw "Declared untracked file not found: $rel" }
            foreach ($pattern in $ForbiddenPatterns) {
                if ($rel -like $pattern -or $rel -like "*/$pattern" -or $rel -like "$pattern*") {
                    throw "Declared file '$rel' matches forbidden pattern '$pattern' and will not be archived"
                }
            }
            $manifest.includedUntracked += $rel
        }
        if ($declared.Count -gt 0) { Write-Step "untracked  : $($declared.Count) declared file(s) approved for archive" }
        else                       { Write-Step "untracked  : none declared" }

        # -------------------------------------------------------------------
        # Dry run stops here, before anything is written to the backup root
        # -------------------------------------------------------------------
        if ($DryRun) {
            Write-Host ''
            Write-Step "DRY RUN - nothing will be written"
            Write-Step "would create/update mirror : $mirrorPath"
            Write-Step "would write bundle         : $bundlePath"
            if ($declared.Count -gt 0) { Write-Step "would write untracked zip  : $untrackedZip" }
            Write-Step "would write manifest       : $manifestPath"
            Write-Step "would run restore test into: $(Join-Path $BackupRoot "restore-tests\restore-$timestamp")"
            Write-Step "would require              : npm ci + npm run verify ($ExpectedTests passed / 0 failed)"
            $manifest.outcome = 'DRY-RUN'
            & (Join-Path $PSScriptRoot 'restore-test-aion.ps1') `
                -ExpectedCommit $commit -BackupRoot $BackupRoot `
                -ActiveRepositoryPath $RepositoryPath -Timestamp $timestamp -ExpectedTests $ExpectedTests -DryRun
            Write-Host ''
            return
        }

        # -------------------------------------------------------------------
        # 1. Backup root layout - created, never cleared
        # -------------------------------------------------------------------
        foreach ($d in @($BackupRoot, $mirrorDir, $snapshotDir, $manifestDir, $logDir,
                         (Join-Path $BackupRoot 'releases'),
                         (Join-Path $BackupRoot 'databases'),
                         (Join-Path $BackupRoot 'restore-tests'))) {
            New-Item -ItemType Directory -Path $d -Force | Out-Null
        }

        # -------------------------------------------------------------------
        # 2. Bare mirror - created once, updated in place thereafter
        # -------------------------------------------------------------------
        if (Test-Path $mirrorPath) {
            Write-Step "updating mirror : $mirrorPath"
            Invoke-Git @('remote', 'update', '--prune') -WorkingDirectory $mirrorPath
        } else {
            Write-Step "creating mirror : $mirrorPath"
            Invoke-Git @('clone', '--mirror', $RepositoryPath, $mirrorPath)
        }
        Write-Step "checking mirror integrity (git fsck)"
        Invoke-Git @('fsck', '--full') -WorkingDirectory $mirrorPath

        # -------------------------------------------------------------------
        # 3. Immutable point-in-time bundle
        # -------------------------------------------------------------------
        Write-Step "writing bundle  : $bundlePath"
        Invoke-Git @('bundle', 'create', $bundlePath, '--all') -WorkingDirectory $RepositoryPath
        Invoke-Git @('bundle', 'verify', $bundlePath) -WorkingDirectory $RepositoryPath

        # -------------------------------------------------------------------
        # 4. Declared untracked files only
        # -------------------------------------------------------------------
        if ($manifest.includedUntracked.Count -gt 0) {
            Write-Step "writing archive : $untrackedZip"
            $full = @($manifest.includedUntracked | ForEach-Object { Join-Path $RepositoryPath ($_ -replace '/', '\') })
            Compress-Archive -Path $full -DestinationPath $untrackedZip -CompressionLevel Optimal
            $manifest.untrackedArchivePath = $untrackedZip
        }

        # -------------------------------------------------------------------
        # 5. SHA-256 checksums
        # -------------------------------------------------------------------
        Write-Step "computing SHA-256 checksums"
        $manifest.checksums[$bundlePath] = Get-Sha256 $bundlePath
        if ($manifest.untrackedArchivePath) {
            $manifest.checksums[$untrackedZip] = Get-Sha256 $untrackedZip
        }

        # -------------------------------------------------------------------
        # 6. Restore test - the gate that decides SUCCESS or FAILURE
        # -------------------------------------------------------------------
        Write-Host ''
        Write-Step "invoking restore test"
        & (Join-Path $PSScriptRoot 'restore-test-aion.ps1') `
            -ExpectedCommit $commit -BackupRoot $BackupRoot `
            -ActiveRepositoryPath $RepositoryPath -Timestamp $timestamp -ExpectedTests $ExpectedTests
        $restoreExit = $LASTEXITCODE

        $restoreResultFile = Join-Path $logDir "restore-$timestamp.result.json"
        if (Test-Path $restoreResultFile) {
            $manifest.restoreResult = (Get-Content $restoreResultFile -Raw | ConvertFrom-Json)
        }

        if ($restoreExit -ne 0) {
            throw "Restore test failed. Backup artifacts are retained but this run is NOT a valid recovery point."
        }

        $manifest.outcome = 'SUCCESS'
        Write-Host ''
        Write-Step "BACKUP SUCCESS - restore test passed"
    }
    finally { Pop-Location }
}
catch {
    $manifest.failureReason = $_.Exception.Message
    $manifest.outcome       = 'FAILURE'
    Write-Fail $manifest.failureReason
}
finally {
    # Evidence is always written. A failed run is recorded as failed, never hidden.
    if (-not $DryRun) {
        foreach ($d in @($manifestDir, $logDir)) {
            if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        }
        ($manifest | ConvertTo-Json -Depth 10) | Set-Content -Path $manifestPath -Encoding utf8
        Set-Content -Path $logPath -Encoding utf8 -Value @(
            "AION backup $timestamp",
            "repository : $RepositoryPath",
            "remote     : $ExpectedRemote",
            "branch     : $($manifest.branch)",
            "commit     : $($manifest.commitHash)",
            "mirror     : $mirrorPath",
            "bundle     : $bundlePath",
            "untracked  : $($manifest.untrackedArchivePath)",
            "outcome    : $($manifest.outcome)",
            "reason     : $($manifest.failureReason)"
        )
        Write-Host "  [backup] manifest: $manifestPath"
        Write-Host "  [backup] log     : $logPath"
    }
    Write-Host ''
}

if ($manifest.outcome -eq 'SUCCESS' -or $manifest.outcome -eq 'DRY-RUN') { exit 0 } else { exit 1 }
