<#
.SYNOPSIS
    Regression tests for portable BackupRoot handling in restore-test-aion.ps1.

.DESCRIPTION
    Proves DryRun is safe when the default (or any) backup drive is absent, that
    explicit BackupRoot is accepted, that real restores fail closed when material
    is missing, and that the accepted laptop D:\AION-backups layout remains valid
    when that drive is present. Does not hard-code another machine path.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$failures = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        Write-Host "FAIL: $Message" -ForegroundColor Red
        $script:failures++
    } else {
        Write-Host "PASS: $Message"
    }
}

function Find-MissingDriveLetter {
    foreach ($letter in @('Q','R','S','T','U','V','W','X','Y','Z')) {
        if (-not [System.IO.Directory]::Exists("${letter}:\")) {
            return $letter
        }
    }
    return $null
}

function Invoke-RestoreScript {
    param(
        [string[]]$Arguments,
        [string]$OutFile,
        [string]$ErrFile
    )
    $scriptPath = Join-Path $PSScriptRoot 'restore-test-aion.ps1'
    $argList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $scriptPath
    ) + $Arguments
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile
    return [int]$p.ExitCode
}

$repo = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$head = (& git -C $repo rev-parse HEAD).Trim()
$missingLetter = Find-MissingDriveLetter
if (-not $missingLetter) {
    Write-Host 'FAIL: could not find an unmounted drive letter for no-D simulation' -ForegroundColor Red
    exit 1
}
$missingRoot = "${missingLetter}:\AION-backups"
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aion-portable-root-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null

try {
    Write-Host ''
    Write-Host "AION portable recovery-root regression  (missing drive letter: ${missingLetter}:)"
    Write-Host '--------------------------------------------------------------'

    # ------------------------------------------------------------------
    # A. no mounted drive + DryRun must not throw DriveNotFoundException
    # ------------------------------------------------------------------
    $aOut = Join-Path $workRoot 'a-nod.out'
    $aErr = Join-Path $workRoot 'a-nod.err'
    $aCode = Invoke-RestoreScript -Arguments @(
        '-ExpectedCommit', $head,
        '-BackupRoot', $missingRoot,
        '-DryRun'
    ) -OutFile $aOut -ErrFile $aErr
    $aText = ((Get-Content -LiteralPath $aOut -Raw -ErrorAction SilentlyContinue) +
              (Get-Content -LiteralPath $aErr -Raw -ErrorAction SilentlyContinue))
    Assert-True ($aCode -eq 0) "A: no-drive DryRun exits 0 (code=$aCode)"
    Assert-True ($aText -match 'DRY RUN') 'A: no-drive DryRun reports DRY RUN'
    Assert-True ($aText -notmatch 'DriveNotFoundException') 'A: no DriveNotFoundException on DryRun'
    Assert-True ($aText -match [regex]::Escape($missingRoot)) 'A: DryRun reports the requested BackupRoot'

    # ------------------------------------------------------------------
    # B. explicit alternate BackupRoot + DryRun
    # ------------------------------------------------------------------
    $altRoot = Join-Path $workRoot 'alt-backups'
    New-Item -ItemType Directory -Path $altRoot -Force | Out-Null
    $bOut = Join-Path $workRoot 'b-alt-dry.out'
    $bErr = Join-Path $workRoot 'b-alt-dry.err'
    $bCode = Invoke-RestoreScript -Arguments @(
        '-ExpectedCommit', $head,
        '-BackupRoot', $altRoot,
        '-DryRun'
    ) -OutFile $bOut -ErrFile $bErr
    $bText = ((Get-Content -LiteralPath $bOut -Raw -ErrorAction SilentlyContinue) +
              (Get-Content -LiteralPath $bErr -Raw -ErrorAction SilentlyContinue))
    Assert-True ($bCode -eq 0) "B: alternate BackupRoot DryRun exits 0 (code=$bCode)"
    Assert-True ($bText -match 'DRY RUN') 'B: alternate BackupRoot DryRun reports DRY RUN'
    Assert-True ($bText -match [regex]::Escape($altRoot)) 'B: DryRun reports alternate BackupRoot'

    # ------------------------------------------------------------------
    # C. explicit alternate real BackupRoot with required mirror artifact
    #     Proves the script locates the mirror under the alternate root and
    #     fails closed on commit mismatch (not on path/drive resolution).
    # ------------------------------------------------------------------
    $cRoot = Join-Path $workRoot 'real-alt-backups'
    $mirrorDir = Join-Path $cRoot 'repository-mirror\AION.git'
    New-Item -ItemType Directory -Path (Split-Path -Parent $mirrorDir) -Force | Out-Null
    & git clone --bare --quiet $repo $mirrorDir
    if ($LASTEXITCODE -ne 0) { throw "bare clone for case C failed with $LASTEXITCODE" }
    $cOut = Join-Path $workRoot 'c-alt-real.out'
    $cErr = Join-Path $workRoot 'c-alt-real.err'
    $bogusCommit = '0000000000000000000000000000000000000001'
    $cCode = Invoke-RestoreScript -Arguments @(
        '-ExpectedCommit', $bogusCommit,
        '-BackupRoot', $cRoot
    ) -OutFile $cOut -ErrFile $cErr
    $cText = ((Get-Content -LiteralPath $cOut -Raw -ErrorAction SilentlyContinue) +
              (Get-Content -LiteralPath $cErr -Raw -ErrorAction SilentlyContinue))
    Assert-True ($cCode -ne 0) "C: alternate real root with wrong commit fails closed (code=$cCode)"
    Assert-True ($cText -match 'does not match expected') 'C: fails on commit mismatch after finding mirror'
    Assert-True ($cText -notmatch 'Backup root not found') 'C: does not claim BackupRoot missing'
    Assert-True ($cText -notmatch 'Mirror not found') 'C: does not claim mirror missing'
    Assert-True ($cText -notmatch 'DriveNotFoundException') 'C: no DriveNotFoundException'

    # ------------------------------------------------------------------
    # D. missing real backup root fails closed (no silent create/substitute)
    # ------------------------------------------------------------------
    $dOut = Join-Path $workRoot 'd-missing.out'
    $dErr = Join-Path $workRoot 'd-missing.err'
    $dCode = Invoke-RestoreScript -Arguments @(
        '-ExpectedCommit', $head,
        '-BackupRoot', $missingRoot
    ) -OutFile $dOut -ErrFile $dErr
    $dText = ((Get-Content -LiteralPath $dOut -Raw -ErrorAction SilentlyContinue) +
              (Get-Content -LiteralPath $dErr -Raw -ErrorAction SilentlyContinue))
    Assert-True ($dCode -ne 0) "D: missing real BackupRoot fails closed (code=$dCode)"
    Assert-True ($dText -match 'Backup root not found') 'D: reports Backup root not found'
    Assert-True ($dText -match 'refusing to create or substitute') 'D: refuses create/substitute'
    Assert-True ($dText -notmatch 'DriveNotFoundException') 'D: no DriveNotFoundException'
    Assert-True (-not [System.IO.Directory]::Exists($missingRoot)) 'D: did not create missing BackupRoot'

    # Empty but present BackupRoot without mirror also fails closed
    $emptyRoot = Join-Path $workRoot 'empty-backups'
    New-Item -ItemType Directory -Path $emptyRoot -Force | Out-Null
    $d2Out = Join-Path $workRoot 'd2-empty.out'
    $d2Err = Join-Path $workRoot 'd2-empty.err'
    $d2Code = Invoke-RestoreScript -Arguments @(
        '-ExpectedCommit', $head,
        '-BackupRoot', $emptyRoot
    ) -OutFile $d2Out -ErrFile $d2Err
    $d2Text = ((Get-Content -LiteralPath $d2Out -Raw -ErrorAction SilentlyContinue) +
               (Get-Content -LiteralPath $d2Err -Raw -ErrorAction SilentlyContinue))
    Assert-True ($d2Code -ne 0) "D2: present root without mirror fails closed (code=$d2Code)"
    Assert-True ($d2Text -match 'Mirror not found') 'D2: reports Mirror not found'

    # ------------------------------------------------------------------
    # E. laptop accepted D:\AION-backups flow remains green when D: exists
    # ------------------------------------------------------------------
    $defaultRoot = 'D:\AION-backups'
    if ([System.IO.Directory]::Exists('D:\')) {
        $eOut = Join-Path $workRoot 'e-d-root.out'
        $eErr = Join-Path $workRoot 'e-d-root.err'
        $eCode = Invoke-RestoreScript -Arguments @(
            '-ExpectedCommit', $head,
            '-DryRun'
        ) -OutFile $eOut -ErrFile $eErr
        $eText = ((Get-Content -LiteralPath $eOut -Raw -ErrorAction SilentlyContinue) +
                  (Get-Content -LiteralPath $eErr -Raw -ErrorAction SilentlyContinue))
        Assert-True ($eCode -eq 0) "E: default D: BackupRoot DryRun exits 0 (code=$eCode)"
        Assert-True ($eText -match 'DRY RUN') 'E: default D: DryRun reports DRY RUN'
        Assert-True ($eText -match [regex]::Escape($defaultRoot)) 'E: default BackupRoot remains D:\AION-backups'

        # Confirm param default in source is still the accepted laptop path
        $src = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'restore-test-aion.ps1') -Raw
        Assert-True ($src -match "BackupRoot\s*=\s*'D:\\AION-backups'") 'E: script default BackupRoot is D:\AION-backups'
    } else {
        Write-Host 'SKIP: E laptop D: flow (D: not mounted on this host)' -ForegroundColor Yellow
        # Still assert source default without requiring the drive
        $src = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'restore-test-aion.ps1') -Raw
        Assert-True ($src -match "BackupRoot\s*=\s*'D:\\AION-backups'") 'E: script default BackupRoot is D:\AION-backups (source contract)'
    }
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($failures -gt 0) {
    Write-Host "Portable recovery-root regression: $failures failure(s)" -ForegroundColor Red
    exit 1
}
Write-Host 'Portable recovery-root regression: all checks PASS'
exit 0
