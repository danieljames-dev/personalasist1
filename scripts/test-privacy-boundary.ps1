[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$privateRoot = Join-Path $root 'private'
$synthetic = Join-Path $privateRoot 'career\input\synthetic-boundary-test.txt'
$backupScript = Join-Path $root 'scripts\backup-aion.ps1'
$originalPrivateExists = Test-Path -LiteralPath $privateRoot

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $synthetic) -Force | Out-Null
    Set-Content -LiteralPath $synthetic -Value 'synthetic boundary test only' -Encoding utf8

    $ignored = @(@(
        'private/',
        'private/career/input/synthetic-boundary-test.txt',
        '.aion-local/directives/CURRENT.md'
    ) | & git -C $root check-ignore --no-index --stdin)
    if ($LASTEXITCODE -ne 0 -or $ignored.Count -ne 3) { throw 'Git ignore boundary regression failed' }

    $status = @(& git -C $root status --porcelain=v1 -uall)
    if (@($status | Where-Object { $_ -match 'private[/\\]' }).Count -ne 0) {
        throw 'A private path appeared in Git status'
    }

    $backupText = Get-Content -LiteralPath $backupScript -Raw
    if ($backupText -notmatch "'private/'") { throw 'Backup forbidden patterns omit private/' }

    & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript `
        -RepositoryPath $root -IncludeUntracked 'private/career/input/synthetic-boundary-test.txt' -DryRun
    if ($LASTEXITCODE -eq 0) { throw 'Backup dry run accepted a private file explicitly' }

    Write-Host 'privacy boundary regression: PASS (Git ignore 3, staging 1, backup exclusion 1)'
}
finally {
    if (Test-Path -LiteralPath $synthetic) { Remove-Item -LiteralPath $synthetic -Force }
    if (-not $originalPrivateExists -and (Test-Path -LiteralPath $privateRoot)) {
        Remove-Item -LiteralPath $privateRoot -Recurse -Force
    }
}
