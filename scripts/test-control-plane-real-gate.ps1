[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

$root=Resolve-AionGitRoot -StartPath (Split-Path -Parent $PSScriptRoot)
$stamp=[guid]::NewGuid().ToString('N')
$directivePath=Join-Path $root ".aion-local\directives\real-gate-$stamp.md"
$outputPath=Join-Path ([IO.Path]::GetTempPath()) "aion-real-gate-$stamp.out"
$errorPath=Join-Path ([IO.Path]::GetTempPath()) "aion-real-gate-$stamp.err"
$authorizer=Join-Path $PSScriptRoot 'authorize-current-directive.ps1'
$archivePath=Join-Path $root '.aion-local\directives\archive\AION-S3-P3-PRIVACY-BOUNDARY-20260806T172327Z.md'
$currentPath=Join-Path $root '.aion-local\directives\CURRENT.md'
$localRoot=Join-Path $root '.aion-local'
$directiveRoot=Join-Path $localRoot 'directives'
$archiveRoot=Join-Path $directiveRoot 'archive'
$localRootExisted=Test-Path -LiteralPath $localRoot -PathType Container
$directiveRootExisted=Test-Path -LiteralPath $directiveRoot -PathType Container
$archiveRootExisted=Test-Path -LiteralPath $archiveRoot -PathType Container
$phrase='AUTHORIZE SYNTHETIC REAL GATE TEST'
$complete=$false
$createdArchive=$false
$createdCurrent=$false

function New-TemporaryDirective([string]$Baseline) {
    $body=@"
# AION Current Directive
Directive-ID: SYNTHETIC-REAL-GATE-$stamp
Status: PENDING_OWNER_AUTHORIZATION
Title: Synthetic Real-Gate Regression
Prepared-Date: 2026-08-06T00:00:00Z
Prepared-By: CTO
Repository-Baseline: $Baseline
Required-Authorization-Phrase: $phrase

## Goal
Exercise only the real authorization gate.
## Authorized Scope
- synthetic control-plane validation
## Prohibited Scope
- all product work
## Required Inputs
- current repository
## Baseline Checks
- real repository gate
## Required Work
- authorize this temporary directive only
## Verification
- local only
## Commit and Push Authorization
None.
## Backup Authorization
None.
## Stop Conditions
Stop on failure.
## Required Handoff
Synthetic only.
## Next-Phase Prohibition
No next phase.
"@
    [IO.Directory]::CreateDirectory((Split-Path -Parent $directivePath))|Out-Null
    [IO.File]::WriteAllText($directivePath,$body,[Text.UTF8Encoding]::new($false))
}

function Invoke-TemporaryAuthorization {
    $arguments=@(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$authorizer+'"'),
        '-RepositoryRoot',('"'+$root+'"'),'-DirectivePath',('"'+$directivePath+'"'),
        '-TestMode','-AuthorizationInput',('"'+$phrase+'"')
    )
    $process=Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath
    return $process.ExitCode
}

function Get-PrivateBoundarySnapshot {
    $privateRoot=Join-Path $root 'private'
    $items=[Collections.Generic.List[string]]::new()
    if(Test-Path -LiteralPath $privateRoot -PathType Container){
        foreach($item in Get-ChildItem -LiteralPath $privateRoot -Force -Recurse){
            $relative=$item.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
            $ignored=@(& git -C $root check-ignore --no-index $relative)
            if($LASTEXITCODE-ne 0-or$ignored.Count-ne 1){throw 'private boundary item is not ignored'}
            if($item.PSIsContainer){$items.Add("directory|$relative")}
            else{
                $hash=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
                $items.Add("file|$relative|$($item.Length)|$hash")
            }
        }
    }
    $items.Sort([StringComparer]::Ordinal)
    return $items
}

try {
    if(-not(Test-Path -LiteralPath $archivePath -PathType Leaf)){
        [IO.Directory]::CreateDirectory((Split-Path -Parent $archivePath))|Out-Null
        [IO.File]::WriteAllText($archivePath,"# Synthetic archive sentinel`r`nFinal state: PENDING_OWNER_AUTHORIZATION`r`n",[Text.UTF8Encoding]::new($false))
        $createdArchive=$true
    }
    if(-not(Test-Path -LiteralPath $currentPath -PathType Leaf)){
        [IO.Directory]::CreateDirectory((Split-Path -Parent $currentPath))|Out-Null
        [IO.File]::WriteAllText($currentPath,"# Synthetic restore-test control state`r`n",[Text.UTF8Encoding]::new($false))
        $createdCurrent=$true
    }
    $privateBefore=Get-PrivateBoundarySnapshot
    $head=(& git -C $root rev-parse HEAD).Trim()
    $branch=(& git -C $root branch --show-current).Trim()
    $origin=(& git -C $root remote get-url origin).Trim()
    $counts=((& git -C $root rev-list --left-right --count HEAD...origin/main).Trim()-split '\s+')
    $status=@(& git -C $root status --porcelain=v1 -uall)
    Assert-AionBaselineValues -ExpectedHead $head -Branch $branch -Head $head -Origin $origin `
        -Ahead ([int]$counts[0]) -Behind ([int]$counts[1]) -StatusLines $status

    $archiveHash=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    $currentHash=(Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash
    $refsBefore=[Collections.Generic.List[string]]::new()
    foreach($ref in @(& git -C $root for-each-ref --format='%(refname) %(objectname)')){$refsBefore.Add($ref)}
    $promptRoot=Join-Path $root '.aion-local\prompts'
    $promptsBefore=[Collections.Generic.List[string]]::new()
    if(Test-Path -LiteralPath $promptRoot -PathType Container){
        foreach($prompt in Get-ChildItem -LiteralPath $promptRoot -File){$promptsBefore.Add($prompt.Name)}
    }
    $source=Get-Content -LiteralPath $authorizer -Raw
    foreach($forbidden in @('git commit','git push','git fetch','Invoke-WebRequest','Invoke-RestMethod','backup-aion','codex ')) {
        if($source.IndexOf($forbidden,[StringComparison]::OrdinalIgnoreCase)-ge 0){
            throw "Authorization script contains forbidden integration token: $forbidden"
        }
    }

    New-TemporaryDirective -Baseline $head
    $successExit=Invoke-TemporaryAuthorization
    $successOutput=(Get-Content -LiteralPath $outputPath -Raw)+(Get-Content -LiteralPath $errorPath -Raw)
    if($successExit-ne 0){throw "Real-gate authorization failed: $successOutput"}
    if($successOutput -match "property 'Statement'"){throw 'Statement compatibility failure returned'}
    if((Get-AionDirective -Path $directivePath).Fields.Status-cne'AUTHORIZED'){throw 'Temporary directive was not authorized'}

    New-TemporaryDirective -Baseline ('0'*40)
    $wrongHeadExit=Invoke-TemporaryAuthorization
    if($wrongHeadExit-eq 0){throw 'Wrong HEAD did not fail closed'}
    if((Get-AionDirective -Path $directivePath).Fields.Status-cne'PENDING_OWNER_AUTHORIZATION'){throw 'Wrong HEAD changed directive status'}

    if((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash-cne$archiveHash){throw 'Archived Phase 3 directive changed'}
    if((Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash-cne$currentHash){throw 'Real current directive changed'}
    $privateAfter=Get-PrivateBoundarySnapshot
    if(@(Compare-AionCollections -ReferenceObject $privateBefore -DifferenceObject $privateAfter).Count-ne 0){throw 'private boundary content changed'}
    $refsAfter=[Collections.Generic.List[string]]::new()
    foreach($ref in @(& git -C $root for-each-ref --format='%(refname) %(objectname)')){$refsAfter.Add($ref)}
    if(@(Compare-AionCollections -ReferenceObject $refsBefore -DifferenceObject $refsAfter).Count-ne 0){throw 'Git refs changed during authorization regression'}
    if((& git -C $root rev-parse HEAD).Trim()-cne$head){throw 'HEAD changed during authorization regression'}
    $promptsAfter=[Collections.Generic.List[string]]::new()
    if(Test-Path -LiteralPath $promptRoot -PathType Container){
        foreach($prompt in Get-ChildItem -LiteralPath $promptRoot -File){$promptsAfter.Add($prompt.Name)}
    }
    if(@(Compare-AionCollections -ReferenceObject $promptsBefore -DifferenceObject $promptsAfter).Count-ne 0){throw 'Codex prompt appeared during authorization regression'}
    if(@(& git -C $root status --porcelain=v1 -uall).Count-ne 0){throw 'Tracked or untracked repository state changed during authorization regression'}
    $complete=$true
    Write-Host 'real repository gate regression: PASS (authorization 1, wrong-HEAD refusal 1)'
}
catch {
    Write-Error "real repository gate regression: FAIL: $($_.Exception.Message)"
    exit 1
}
finally {
    if(Test-Path -LiteralPath $directivePath){Remove-Item -LiteralPath $directivePath -Force}
    if(Test-Path -LiteralPath $outputPath){Remove-Item -LiteralPath $outputPath -Force}
    if(Test-Path -LiteralPath $errorPath){Remove-Item -LiteralPath $errorPath -Force}
    if($createdCurrent-and(Test-Path -LiteralPath $currentPath)){Remove-Item -LiteralPath $currentPath -Force}
    if($createdArchive-and(Test-Path -LiteralPath $archivePath)){Remove-Item -LiteralPath $archivePath -Force}
    foreach($directory in @(
        @{ Path=$archiveRoot; Existed=$archiveRootExisted },
        @{ Path=$directiveRoot; Existed=$directiveRootExisted },
        @{ Path=$localRoot; Existed=$localRootExisted }
    )) {
        if(-not $directory.Existed-and(Test-Path -LiteralPath $directory.Path -PathType Container)-and
            @(Get-ChildItem -LiteralPath $directory.Path -Force).Count-eq 0) {
            Remove-Item -LiteralPath $directory.Path -Force
        }
    }
}

if(-not $complete){exit 1}
