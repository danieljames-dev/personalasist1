[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

$passed=0
$failed=0
function Test-Case([string]$Name,[object[]]$Reference,[object[]]$Difference,[int]$ExpectedCount) {
    $actual=@(Compare-AionCollections -ReferenceObject $Reference -DifferenceObject $Difference)
    if($actual.Count-ne$ExpectedCount){
        $script:failed++
        Write-Host "FAIL $Name - expected $ExpectedCount differences, observed $($actual.Count)" -ForegroundColor Red
    } else {
        $script:passed++
        Write-Host "PASS $Name"
    }
}

Test-Case '1 zero versus zero is explicitly equal' ([object[]]::new(0)) ([object[]]::new(0)) 0
Test-Case '2 zero versus one differs' ([object[]]::new(0)) @('one') 1
Test-Case '3 one versus zero differs' @('one') ([object[]]::new(0)) 1
Test-Case '4 one matching item is equal' @('one') @('one') 0
Test-Case '5 multiple matching items are equal' @('one','two') @('one','two') 0
Test-Case '6 multiple differing items are detected' @('one','two') @('three','four') 4
Test-Case '7 null pipeline results normalize to explicit empty arrays' $null $null 0

$nativeName=if($env:OS-ceq'Windows_NT'){'npm.cmd'}else{'npm'}
$native=Get-Command $nativeName -CommandType Application -ErrorAction Stop|Select-Object -First 1
if($env:OS-ceq'Windows_NT' -and $native.Name-cne'npm.cmd'){throw "Windows npm selection is not native npm.cmd: $($native.Name)"}
$passed++;Write-Host 'PASS 8 strict mode and native npm command selection remain active'

if($failed-ne 0){Write-Error "collection regression: FAIL ($passed passed, $failed failed)";exit 1}
Write-Host "collection regression: PASS ($passed passed, 0 failed)"
