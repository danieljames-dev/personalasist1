[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-ref-policy.ps1')

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aion-ref-policy-" + [guid]::NewGuid().ToString('N'))
$source = Join-Path $testRoot 'source'
$mirror = Join-Path $testRoot 'mirror.git'
$bundle = Join-Path $testRoot 'recovery.bundle'
$restore = Join-Path $testRoot 'restore'
$passed = $false

try {
    New-Item -ItemType Directory -Path $source -Force | Out-Null
    & git -C $source init -b main | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'synthetic repository initialization failed' }
    & git -C $source config user.name 'AION Backup Test'
    & git -C $source config user.email 'backup-test@invalid.example'
    Set-Content -LiteralPath (Join-Path $source 'README.md') -Value 'synthetic durable-ref test' -Encoding utf8
    & git -C $source add README.md
    & git -C $source commit -m 'synthetic main' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'synthetic commit failed' }
    $expected = (& git -C $source rev-parse HEAD).Trim()

    & git -C $source tag durable-test
    & git -C $source notes add -m 'synthetic durable note' HEAD
    # Test-only repository setting: permits construction of the hazardous input.
    # The backup and mirror implementation itself does not depend on long-path support.
    & git -C $source config core.longpaths true
    $longSegment = ('a' * 96)
    $longCodexRef = "refs/codex/turn-diffs/checkpoints/$longSegment/$longSegment/end"
    & git -C $source update-ref $longCodexRef 'HEAD^{tree}'
    if ($LASTEXITCODE -ne 0) { throw 'synthetic overlong Codex ref creation failed' }

    $inventory = Get-AionRefInventory -RepositoryPath $source
    if (-not ($inventory.includedRefs.name -contains 'refs/heads/main')) { throw 'main was not selected' }
    if (-not ($inventory.includedRefs.name -contains 'refs/tags/durable-test')) { throw 'tag was not selected' }
    if (-not ($inventory.includedRefs.name -contains 'refs/notes/commits')) { throw 'notes were not selected' }
    if ($inventory.includedRefs.name -contains $longCodexRef) { throw 'Codex ref was selected' }
    if ($inventory.excludedRefs.name -notcontains $longCodexRef) { throw 'Codex ref was not reported excluded' }

    Initialize-AionDurableMirror -Source $source -Destination $mirror
    $mirrorInventory = Get-AionRefInventory -GitDir $mirror
    if (@($mirrorInventory.includedRefs | Where-Object name -eq 'refs/heads/main').Count -ne 1) {
        throw 'mirror main missing'
    }
    if (@($mirrorInventory.excludedRefs | Where-Object name -like 'refs/codex/*').Count -ne 0) {
        throw 'mirror materialized a Codex ref'
    }
    if ((& git --git-dir=$mirror rev-parse refs/heads/main).Trim() -ne $expected) {
        throw 'mirror main target mismatch'
    }
    & git --git-dir=$mirror fsck --full
    if ($LASTEXITCODE -ne 0) { throw 'synthetic mirror fsck failed' }

    New-AionDurableBundle -RepositoryPath $source -BundlePath $bundle -IncludedRefs $inventory.includedRefs
    & git clone --no-checkout $bundle $restore | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'bundle restore clone failed' }
    & git -C $restore checkout main | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'bundle restore main checkout failed' }
    if ((& git -C $restore rev-parse HEAD).Trim() -ne $expected) { throw 'restored checkout mismatch' }
    if (Test-Path -LiteralPath (Join-Path $mirror ($longCodexRef -replace '/', '\'))) {
        throw 'overlong Codex path was materialized'
    }

    $passed = $true
    Write-Host 'backup-ref-policy regression: PASS'
    Write-Host "  durable refs included: $($inventory.includedRefs.Count)"
    Write-Host "  transient refs excluded: $($inventory.excludedRefCount)"
    Write-Host "  longest excluded ref: $($inventory.longestExcludedRefLength) characters"
}
catch {
    Write-Error "backup-ref-policy regression: FAIL: $($_.Exception.Message); evidence preserved at $testRoot"
    exit 1
}
finally {
    if ($passed -and (Test-Path -LiteralPath $testRoot)) {
        & git -C $source update-ref -d $longCodexRef
        if ($LASTEXITCODE -ne 0) { throw 'Unable to remove synthetic Codex ref during cleanup' }
        $resolved = [System.IO.Path]::GetFullPath($testRoot)
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove non-temporary test path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
