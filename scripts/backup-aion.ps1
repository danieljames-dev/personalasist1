<#
.SYNOPSIS
    Creates a verified durable-ref backup of AION code and documentation.

.DESCRIPTION
    The canonical mirror is rebuilt from the approved origin using only branches,
    tags, and intentionally used notes. The local recovery bundle is built from the
    same durable namespace allowlist in the active repository. Editor and agent refs,
    including refs/codex/*, are inventoried but never copied into either artifact.

    SUCCESS is recorded only after mirror validation, bundle verification, isolated
    restore, npm ci, npm run verify, and the backup-ref regression test all pass.
#>

[CmdletBinding()]
param(
    [string]   $BackupRoot       = 'D:\AION-backups',
    [string]   $RepositoryPath,
    [string]   $ExpectedRemote   = 'https://github.com/danieljames-dev/personalasist1.git',
    [string[]] $IncludeUntracked = @(),
    [int]      $ExpectedTests     = 163,
    [switch]   $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-ref-policy.ps1')

$ForbiddenPatterns = @(
    'private/', '.aion-local/', 'node_modules', 'dist/', 'dist-test/', '*.tsbuildinfo', '*.tgz',
    '.env', '.env.*', '*.pem', '*.key', '*.pfx', 'id_rsa*',
    '.vscode/', '.idea/', '*.log', '*.sqlite', '*.db', 'Thumbs.db', '.DS_Store'
)

function Write-Step { param([string]$Message) Write-Host "  [backup] $Message" }
function Write-Fail { param([string]$Message) Write-Host "  [backup] FAIL: $Message" -ForegroundColor Red }
function Invoke-Git {
    param([string[]]$Arguments, [string]$WorkingDirectory)
    if ($WorkingDirectory) { Push-Location $WorkingDirectory }
    try {
        & git @Arguments
        if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
    } finally { if ($WorkingDirectory) { Pop-Location } }
}
function Get-Sha256 { param([string]$Path) (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'")
if (-not $RepositoryPath) { $RepositoryPath = Split-Path -Parent $PSScriptRoot }
$RepositoryPath = (Resolve-Path -LiteralPath $RepositoryPath).Path

$mirrorRoot    = Join-Path $BackupRoot 'repository-mirror'
$mirrorPath    = Join-Path $mirrorRoot 'AION.git'
$stagingRoot   = Join-Path $mirrorRoot 'staging'
$quarantineRoot= Join-Path $mirrorRoot 'quarantine'
$stagedMirror  = Join-Path $stagingRoot "AION-$timestamp.git"
$cloneCheck    = Join-Path $stagingRoot "clone-check-$timestamp"
$quarantinePath= Join-Path $quarantineRoot "AION-before-ref-policy-$timestamp.git"
$snapshotDir   = Join-Path $BackupRoot 'working-snapshots'
$manifestDir   = Join-Path $BackupRoot 'manifests'
$logDir        = Join-Path $BackupRoot 'logs'
$bundlePath    = Join-Path $snapshotDir "AION-$timestamp.bundle"
$untrackedZip  = Join-Path $snapshotDir "AION-$timestamp-untracked.zip"
$manifestPath  = Join-Path $manifestDir "backup-$timestamp.json"
$logPath       = Join-Path $logDir "backup-$timestamp.log"

$manifest = [ordered]@{
    schema='aion.backup-manifest.v2'; timestampUtc=$timestamp
    repositorySourcePath=$RepositoryPath; canonicalRemote=$ExpectedRemote
    branch=$null; commitHash=$null; localHead=$null; originMain=$null
    expectedBackedUpCommit=$null; mirrorSource=$ExpectedRemote; bundleSource=$RepositoryPath
    mirrorPath=$mirrorPath; stagedMirrorPath=$stagedMirror; quarantinedMirrorPath=$null
    bundlePath=$bundlePath; untrackedArchivePath=$null; includedUntracked=@()
    refPolicy=[ordered]@{
        durableNamespaces=@('refs/heads/*','refs/tags/*','refs/notes/*')
        includedRefs=@(); transientNamespacesExcluded=@(); excludedRefCount=0
        longestExcludedRefLength=0
    }
    exclusions=$ForbiddenPatterns; checksums=[ordered]@{}
    verificationCommand='npm run verify'; regressionCommand='npm run test:backup-refs'
    controlPlaneCommand='npm run control-plane:test'
    collectionCommand='npm run control-plane:test-collections'; realGateCommand='npm run control-plane:test-real-gate'
    privacyBoundaryCommand='npm run privacy-boundary:test'
    identityCommand='npm run identity:test'
    objectCommand='npm run object:test'
    careerInputCommand='npm run career-input:test'
    careerEvidenceCommand='npm run career-evidence:test'
    expectedTests=$ExpectedTests; restoreResult=$null; outcome='FAILURE'; failureReason=$null
    dryRun=[bool]$DryRun
}

try {
    Write-Host ''; Write-Host "AION durable-ref backup  ($timestamp)"; Write-Host ('=' * 62)
    Write-Step "repository : $RepositoryPath"; Write-Step "backup root: $BackupRoot"
    if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { throw "Not a Git repository root: $RepositoryPath" }

    $topLevel = (& git -C $RepositoryPath rev-parse --show-toplevel).Trim()
    if ((Resolve-Path $topLevel).Path.TrimEnd('\') -ne $RepositoryPath.TrimEnd('\')) { throw 'Repository root mismatch' }
    $actualRemote = (& git -C $RepositoryPath remote get-url origin).Trim()
    if ($actualRemote -ne $ExpectedRemote) { throw "Remote mismatch: '$actualRemote'" }

    $branch = (& git -C $RepositoryPath branch --show-current).Trim()
    $head = (& git -C $RepositoryPath rev-parse HEAD).Trim()
    $main = (& git -C $RepositoryPath rev-parse refs/heads/main).Trim()
    $originMain = (& git -C $RepositoryPath rev-parse refs/remotes/origin/main).Trim()
    if ($branch -ne 'main') { throw "Backup requires active branch main; observed '$branch'" }
    if ($head -ne $main -or $main -ne $originMain) { throw "Local main, HEAD, and origin/main are not synchronized" }
    $manifest.branch=$branch; $manifest.commitHash=$head; $manifest.localHead=$head
    $manifest.originMain=$originMain; $manifest.expectedBackedUpCommit=$head
    Write-Step "commit     : $head (local main = origin/main)"

    $statusLines = @(& git -C $RepositoryPath status --porcelain=v1 -uall)
    $declared = @($IncludeUntracked | ForEach-Object { $_.Replace('\','/').Trim() })
    $dirty=@(); $undeclared=@()
    foreach ($line in $statusLines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $code=$line.Substring(0,2); $path=$line.Substring(3).Trim().Replace('\','/')
        if ($code -eq '??') { if ($declared -notcontains $path) { $undeclared += $path } }
        else { $dirty += "$code $path" }
    }
    if ($dirty.Count -and -not $DryRun) { throw "Refusing dirty working tree: $($dirty -join ', ')" }
    if ($undeclared.Count -and -not $DryRun) { throw "Undeclared untracked files: $($undeclared -join ', ')" }
    if ($DryRun -and ($dirty.Count -or $undeclared.Count)) {
        Write-Step 'dry-run note: working changes are inspected but a real run would require a clean tree'
    }
    foreach ($rel in $declared) {
        if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath ($rel -replace '/','\')))) { throw "Missing declared file: $rel" }
        foreach ($pattern in $ForbiddenPatterns) {
            if ($rel -like $pattern -or $rel -like "*/$pattern" -or $rel -like "$pattern*") {
                throw "Declared file '$rel' matches forbidden pattern '$pattern'"
            }
        }
        $manifest.includedUntracked += $rel
    }

    $inventory = Get-AionRefInventory -RepositoryPath $RepositoryPath
    $manifest.refPolicy.includedRefs = @($inventory.includedRefs | ForEach-Object name)
    $manifest.refPolicy.transientNamespacesExcluded = @($inventory.excludedNamespaces)
    $manifest.refPolicy.excludedRefCount = $inventory.excludedRefCount
    $manifest.refPolicy.longestExcludedRefLength = $inventory.longestExcludedRefLength
    if ($manifest.refPolicy.includedRefs -notcontains 'refs/heads/main') { throw 'Durable ref selection omitted main' }
    $headReachable=$false
    foreach ($ref in @($inventory.includedRefs | Where-Object { $_.namespace -eq 'refs/heads' })) {
        & git -C $RepositoryPath merge-base --is-ancestor $head $ref.name
        if ($LASTEXITCODE -eq 0) { $headReachable=$true; break }
    }
    if (-not $headReachable) { throw 'Expected HEAD is not reachable from an included branch' }
    Write-Step "durable refs: $($inventory.includedRefs.Count) included; $($inventory.excludedRefCount) transient excluded"

    if ($DryRun) {
        Write-Step 'DRY RUN - no files or refs will be written'
        Write-Step "would stage canonical mirror: $stagedMirror"
        Write-Step "would write durable bundle : $bundlePath"
        Write-Step "would quarantine old mirror: $quarantinePath"
        Write-Step "would restore and require $ExpectedTests tests plus backup-ref regression"
        $manifest.outcome='DRY-RUN'
        return
    }

    foreach ($dir in @($BackupRoot,$mirrorRoot,$stagingRoot,$quarantineRoot,$snapshotDir,$manifestDir,$logDir,
        (Join-Path $BackupRoot 'releases'),(Join-Path $BackupRoot 'databases'),(Join-Path $BackupRoot 'restore-tests'))) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    Write-Step "building staged canonical mirror from approved origin"
    Initialize-AionDurableMirror -Source $ExpectedRemote -Destination $stagedMirror
    $stagedInventory = Get-AionRefInventory -GitDir $stagedMirror
    if (@($stagedInventory.excludedRefs | Where-Object name -like 'refs/codex/*').Count) { throw 'Staged mirror contains refs/codex' }
    $stagedMain = (& git --git-dir=$stagedMirror rev-parse refs/heads/main).Trim()
    if ($stagedMain -ne $head) { throw "Staged mirror main '$stagedMain' does not equal expected '$head'" }
    Invoke-Git @("--git-dir=$stagedMirror",'fsck','--full')
    Invoke-Git @('clone','--no-checkout',$stagedMirror,$cloneCheck)
    if ((& git -C $cloneCheck rev-parse refs/remotes/origin/main).Trim() -ne $head) { throw 'Staged mirror clone check mismatch' }
    Remove-Item -LiteralPath $cloneCheck -Recurse -Force

    if (Test-Path -LiteralPath $mirrorPath) {
        Write-Step "quarantining prior mirror: $quarantinePath"
        Move-Item -LiteralPath $mirrorPath -Destination $quarantinePath
        $manifest.quarantinedMirrorPath=$quarantinePath
    }
    Move-Item -LiteralPath $stagedMirror -Destination $mirrorPath
    $manifest.stagedMirrorPath=$null
    if ((& git --git-dir=$mirrorPath rev-parse refs/heads/main).Trim() -ne $head) { throw 'Installed mirror main mismatch' }
    if (@((Get-AionRefInventory -GitDir $mirrorPath).excludedRefs | Where-Object name -like 'refs/codex/*').Count) {
        throw 'Installed mirror contains refs/codex'
    }

    Write-Step "writing durable local recovery bundle: $bundlePath"
    New-AionDurableBundle -RepositoryPath $RepositoryPath -BundlePath $bundlePath -IncludedRefs $inventory.includedRefs
    $manifest.checksums[$bundlePath]=Get-Sha256 $bundlePath

    if ($manifest.includedUntracked.Count) {
        $paths=@($manifest.includedUntracked | ForEach-Object { Join-Path $RepositoryPath ($_ -replace '/','\') })
        Compress-Archive -Path $paths -DestinationPath $untrackedZip -CompressionLevel Optimal
        $manifest.untrackedArchivePath=$untrackedZip
        $manifest.checksums[$untrackedZip]=Get-Sha256 $untrackedZip
    }

    Write-Step 'invoking isolated restore test'
    & (Join-Path $PSScriptRoot 'restore-test-aion.ps1') -ExpectedCommit $head -BackupRoot $BackupRoot `
        -ActiveRepositoryPath $RepositoryPath -Timestamp $timestamp -ExpectedTests $ExpectedTests
    if ($LASTEXITCODE -ne 0) { throw 'Restore test failed; backup is not a recovery point' }
    $resultFile=Join-Path $logDir "restore-$timestamp.result.json"
    if (Test-Path -LiteralPath $resultFile) { $manifest.restoreResult=Get-Content $resultFile -Raw | ConvertFrom-Json }
    if (-not $manifest.restoreResult -or $manifest.restoreResult.outcome -ne 'SUCCESS') { throw 'Restore SUCCESS evidence missing' }
    if ($manifest.restoreResult.collectionResult -ne 'PASS' -or $manifest.restoreResult.realGateResult -ne 'PASS' -or
        $manifest.restoreResult.privacyBoundaryResult -ne 'PASS' -or $manifest.restoreResult.identityResult -ne 'PASS' -or
        $manifest.restoreResult.objectResult -ne 'PASS' -or $manifest.restoreResult.careerInputResult -ne 'PASS' -or
        $manifest.restoreResult.careerEvidenceResult -ne 'PASS' -or
        $manifest.restoreResult.exclusionResult -ne 'PASS') {
        throw 'Mandatory collection, real-gate, privacy, Identity, Object, career-input, career-evidence, or exclusion restore evidence missing'
    }
    $manifest.outcome='SUCCESS'
    Write-Step 'BACKUP SUCCESS - durable refs restored and verified'
}
catch {
    $manifest.failureReason=$_.Exception.Message; $manifest.outcome='FAILURE'; Write-Fail $manifest.failureReason
}
finally {
    if (-not $DryRun) {
        foreach ($dir in @($manifestDir,$logDir)) { if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null } }
        $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
        @("AION backup $timestamp","commit: $($manifest.expectedBackedUpCommit)","mirror: $mirrorPath",
          "bundle: $bundlePath","outcome: $($manifest.outcome)","reason: $($manifest.failureReason)") |
            Set-Content -LiteralPath $logPath -Encoding utf8
        Write-Step "manifest: $manifestPath"; Write-Step "log: $logPath"
    }
    Write-Host ''
}

if ($manifest.outcome -in @('SUCCESS','DRY-RUN')) { exit 0 } else { exit 1 }
