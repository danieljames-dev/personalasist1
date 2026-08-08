<#
.SYNOPSIS
    Parse AION verify output for total pass/fail counts (TAP-owned format).

.DESCRIPTION
    Recovery owns the reporter: package scripts force `node --test --test-reporter=tap`.
    This parser only accepts TAP-style summary lines:

      # pass N
      # fail N

    It fails closed when no pass summary is found. Spec-style / decorative lines are
    intentionally ignored so a non-TAP capture cannot silently succeed against the wrong format.

    Dot-source this file to load functions. Do not rely on parameters for library use.
#>

Set-StrictMode -Version Latest

function Get-AionVerifySummary {
    param([string] $VerifyText)
    if ($null -eq $VerifyText) { $VerifyText = '' }

    # Owned format only: TAP reporter lines written by `node --test --test-reporter=tap`.
    $passMatches = [regex]::Matches($VerifyText, '(?m)^#\s*pass\s+(\d+)\s*$')
    $failMatches = [regex]::Matches($VerifyText, '(?m)^#\s*fail\s+(\d+)\s*$')

    $passed = 0
    $failed = 0
    foreach ($m in $passMatches) { $passed += [int]$m.Groups[1].Value }
    foreach ($m in $failMatches) { $failed += [int]$m.Groups[1].Value }

    return [ordered]@{
        testsPassed   = $passed
        testsFailed   = $failed
        passLineCount = $passMatches.Count
        failLineCount = $failMatches.Count
        parseable     = ($passMatches.Count -gt 0)
    }
}

function Assert-AionVerifySummary {
    param(
        [Parameter(Mandatory = $true)]
        $Summary,
        [Parameter(Mandatory = $true)]
        [int] $ExpectedPass,
        [int] $ExpectedFail = 0
    )
    if (-not $Summary.parseable) {
        throw "verify summary is not parseable as TAP (# pass N). Recovery requires --test-reporter=tap."
    }
    if ([int]$Summary.testsFailed -ne $ExpectedFail) {
        throw "expected $ExpectedFail failing tests, observed '$($Summary.testsFailed)'"
    }
    if ([int]$Summary.testsPassed -ne $ExpectedPass) {
        throw "expected $ExpectedPass passing tests, observed '$($Summary.testsPassed)'. A DECREASE means tests were lost; an INCREASE means expected-verify-pass-count.txt is stale. Neither is tolerated."
    }
}

function Get-AionExpectedVerifyPassCount {
    param([string] $RepositoryPath)
    if (-not $RepositoryPath) { $RepositoryPath = Split-Path -Parent $PSScriptRoot }
    $path = Join-Path $RepositoryPath 'scripts\expected-verify-pass-count.txt'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "authoritative expected-verify-pass-count.txt is missing at $path"
    }
    $raw = (Get-Content -LiteralPath $path -Raw).Trim()
    if ($raw -notmatch '^\d+$') {
        throw "expected-verify-pass-count.txt must contain a single integer, observed '$raw'"
    }
    return [int]$raw
}
