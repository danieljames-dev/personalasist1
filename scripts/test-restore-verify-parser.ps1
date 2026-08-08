<#
.SYNOPSIS
    Regression tests for TAP-owned verify summary parsing and expected-count contract.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'parse-verify-summary.ps1')

$failures = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        Write-Host "FAIL: $Message" -ForegroundColor Red
        $script:failures++
    } else {
        Write-Host "PASS: $Message"
    }
}

# 1. TAP pass/fail lines are summed
$tap = @"
# tests 10
# pass 7
# fail 0
# tests 5
# pass 5
# fail 1
"@
$s = Get-AionVerifySummary -VerifyText $tap
Assert-True ($s.parseable -eq $true) 'TAP text is parseable'
Assert-True ($s.testsPassed -eq 12) 'TAP pass lines sum to 12'
Assert-True ($s.testsFailed -eq 1) 'TAP fail lines sum to 1'
Assert-AionVerifySummary -Summary $s -ExpectedPass 12 -ExpectedFail 1
Write-Host 'PASS: correct expected count accepts'

# 2. Spec-style / non-TAP summary lines must NOT parse as TAP (owned format only).
#    Node's default "spec" reporter can emit decorative prefixes before "pass N" when stdout
#    is a TTY. Recovery refuses anything that is not an exact TAP `# pass N` line.
$spec = "info pass 586`ninfo fail 0`n  pass 586`n"
$s2 = Get-AionVerifySummary -VerifyText $spec
Assert-True ($s2.parseable -eq $false) 'non-TAP pass lines are not parseable as TAP'
Assert-True ($s2.testsPassed -eq 0) 'non-TAP lines do not inflate pass count'
try {
    Assert-AionVerifySummary -Summary $s2 -ExpectedPass 586
    Write-Host 'FAIL: missing summary should fail closed' -ForegroundColor Red
    $failures++
} catch {
    Write-Host 'PASS: malformed/missing TAP summary fails closed'
}

# 3. Incorrect expected count fails closed
$s3 = Get-AionVerifySummary -VerifyText "# pass 10`n# fail 0`n"
try {
    Assert-AionVerifySummary -Summary $s3 -ExpectedPass 999
    Write-Host 'FAIL: wrong expected count should fail closed' -ForegroundColor Red
    $failures++
} catch {
    Write-Host 'PASS: incorrect expected count fails closed'
}

# 4. Failures fail closed
try {
    Assert-AionVerifySummary -Summary $s3 -ExpectedPass 10 -ExpectedFail 0
    # s3 has 0 fails — ok
    $bad = Get-AionVerifySummary -VerifyText "# pass 10`n# fail 2`n"
    Assert-AionVerifySummary -Summary $bad -ExpectedPass 10 -ExpectedFail 0
    Write-Host 'FAIL: non-zero fails should fail closed' -ForegroundColor Red
    $failures++
} catch {
    Write-Host 'PASS: non-zero fail count fails closed'
}

# 5. Authoritative count file is readable integer
$repo = Split-Path -Parent $PSScriptRoot
$count = Get-AionExpectedVerifyPassCount -RepositoryPath $repo
Assert-True ($count -gt 0) "authoritative expected count is positive ($count)"

if ($failures -gt 0) {
    Write-Host "Parser regression: $failures failure(s)" -ForegroundColor Red
    exit 1
}
Write-Host 'Parser regression: all checks PASS'
exit 0
