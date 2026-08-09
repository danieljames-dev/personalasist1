[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$privateRoot = Join-Path $root 'private'
$synthetic = Join-Path $privateRoot 'career\input\synthetic-boundary-test.txt'
$backupScript = Join-Path $root 'scripts\backup-aion.ps1'
$originalPrivateExists = Test-Path -LiteralPath $privateRoot
# Disposable BackupRoot so this regression never depends on D: and never treats DriveNotFound as PASS.
$tempBackupRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aion-privacy-boundary-" + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $synthetic) -Force | Out-Null
    Set-Content -LiteralPath $synthetic -Value 'synthetic boundary test only' -Encoding utf8
    New-Item -ItemType Directory -Path $tempBackupRoot -Force | Out-Null

    # Paths are passed as arguments, not on stdin: stdin encoding varies by host and can prepend a
    # BOM to the first path, which silently turned this assertion into a weaker one.
    $mustBeIgnored = @(
        'private/',
        'private/career/input/synthetic-boundary-test.txt',
        '.aion-local/directives/CURRENT.md',
        'private/aion/state-v1.json',
        'private/aion/exports/private-backup.aionbak'
    )
    $ignored = @(& git -C $root check-ignore --no-index -- @mustBeIgnored)
    if ($LASTEXITCODE -ne 0 -or $ignored.Count -ne $mustBeIgnored.Count) {
        throw "Git ignore boundary regression failed: $($ignored.Count)/$($mustBeIgnored.Count) required paths are ignored"
    }

    $status = @(& git -C $root status --porcelain=v1 -uall)
    if (@($status | Where-Object { $_ -match 'private[/\\]' }).Count -ne 0) {
        throw 'A private path appeared in Git status'
    }

    $backupText = Get-Content -LiteralPath $backupScript -Raw
    if ($backupText -notmatch "'private/'") { throw 'Backup forbidden patterns omit private/' }

    # Control case: valid DryRun with explicit temp BackupRoot must progress past BackupRoot setup.
    $controlOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript `
        -RepositoryPath $root -BackupRoot $tempBackupRoot -DryRun 2>&1 | Out-String
    $controlCode = $LASTEXITCODE
    if ($controlOut -match 'DriveNotFound') {
        throw "Control DryRun hit DriveNotFound (must not count as success): $controlOut"
    }
    if ($controlCode -ne 0) {
        throw "Control DryRun with temp BackupRoot failed (exit $controlCode). Output: $controlOut"
    }
    if ($controlOut -notmatch 'DRY RUN') {
        throw "Control DryRun did not report DRY RUN past BackupRoot construction. Output: $controlOut"
    }
    if ($controlOut -notmatch [regex]::Escape($tempBackupRoot)) {
        throw "Control DryRun did not report the disposable temp BackupRoot."
    }

    # Forbidden case: private path with the same valid temp BackupRoot must fail for privacy reason.
    $forbiddenOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript `
        -RepositoryPath $root -BackupRoot $tempBackupRoot `
        -IncludeUntracked 'private/career/input/synthetic-boundary-test.txt' -DryRun 2>&1 | Out-String
    $forbiddenCode = $LASTEXITCODE
    if ($forbiddenOut -match 'DriveNotFound') {
        throw "Forbidden-case DryRun hit DriveNotFound (TEST FAILURE, not privacy proof): $forbiddenOut"
    }
    if ($forbiddenCode -eq 0) {
        throw 'Backup dry run accepted a private file explicitly'
    }
    if ($forbiddenOut -notmatch 'forbidden pattern|matches forbidden|private/') {
        throw "Forbidden private input did not fail for the intended privacy reason. Output: $forbiddenOut"
    }

    Write-Host "privacy boundary regression: PASS (Git ignore $($mustBeIgnored.Count), control DryRun 1, forbidden privacy reason 1, temp BackupRoot)"
}
finally {
    if (Test-Path -LiteralPath $synthetic) { Remove-Item -LiteralPath $synthetic -Force }
    if (-not $originalPrivateExists -and (Test-Path -LiteralPath $privateRoot)) {
        Remove-Item -LiteralPath $privateRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $tempBackupRoot) {
        Remove-Item -LiteralPath $tempBackupRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
