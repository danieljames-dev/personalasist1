Set-StrictMode -Version Latest

$script:AionAllowedDirectiveStatuses = @(
    'PENDING_OWNER_AUTHORIZATION','AUTHORIZED','RUNNING','AWAITING_CTO_REVIEW',
    'BLOCKED','FAILED','SUPERSEDED','CLOSED'
)
$script:AionCanonicalOrigin = 'https://github.com/danieljames-dev/personalasist1.git'
$script:AionReviewedDirectorSha = '8fba7b6dadba35f479d4d335a35258b6149b70e1'
$script:AionDirectorRecoveryGateId = 'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
$script:AionDirectorPromotionGateId = 'DIRECTOR_D2_REVIEWED_PROMOTION_AND_PUSH'
$script:AionDirectorRecoveryKnownBrokenBaselineSha = '78425d3923ff06bbc6193165c35232844287efa9'
$script:AionDirectorPromotionExpectedCandidateSha = '6a4cb1d058fb6375798fa27e7629fd5a2d889ba1'
$script:AionDirectorPromotionExpectedCandidateBaselineSha = '3938e0b6b7b5452830b47b3ae3ba9d95ed6b4746'
$script:AionDirectorPromotionClosedDirectiveId = 'D2-DIRECTOR-RECOVERY-LEASE-HYGIENE-CARRYFORWARD-20260817T044618Z'
$script:AionDirectorPromotionAllowedGovernancePaths = @(
    'scripts/control-plane-common.ps1',
    'scripts/promote-reviewed-director.ps1',
    'scripts/test-control-plane.ps1'
)
$script:AionDirectorRecoverySourceIdentityPaths = @(
    'packages/director/src/lease-store.ts',
    'apps/aion/developer-agent.mjs',
    'packages/director/src/git-truth.ts'
)

function Resolve-AionGitRoot {
    param([string]$StartPath)
    if (-not $StartPath) { $StartPath = (Get-Location).Path }
    $root = (& git -C $StartPath rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $root) { throw "Not inside an AION Git repository: $StartPath" }
    return (Resolve-Path -LiteralPath $root.Trim()).Path
}

function Get-AionRepositoryRelativePath {
    param(
        [Parameter(Mandatory=$true)][string]$Root,
        [Parameter(Mandatory=$true)][string]$Path
    )
    if([string]::IsNullOrWhiteSpace($Root)){throw 'Repository root is empty'}
    if([string]::IsNullOrWhiteSpace($Path)){throw 'Repository path is empty'}
    try {
        $resolvedRoot=((Resolve-Path -LiteralPath $Root -ErrorAction Stop)|Select-Object -First 1).ProviderPath
        $resolvedPath=((Resolve-Path -LiteralPath $Path -ErrorAction Stop)|Select-Object -First 1).ProviderPath
        $rootFull=[IO.Path]::GetFullPath($resolvedRoot).TrimEnd('\','/')
        $pathFull=[IO.Path]::GetFullPath($resolvedPath).TrimEnd('\','/')
        if($pathFull -ceq $rootFull){return '.'}
        $rootWithSeparator=$rootFull + [IO.Path]::DirectorySeparatorChar
        if(-not $pathFull.StartsWith($rootWithSeparator,[StringComparison]::OrdinalIgnoreCase)){
            throw "Path is outside repository root: $Path"
        }
        $rootUri=[Uri]($rootWithSeparator)
        $pathUri=[Uri]$pathFull
        $relative=[Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString())
        if([string]::IsNullOrWhiteSpace($relative)){return '.'}
        return $relative.Replace('\','/')
    }
    catch {
        throw "Could not compute repository-relative path: $($_.Exception.Message)"
    }
}

function Get-AionDirective {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Current directive missing: $Path" }
    $text = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($text)) { throw "Current directive is empty: $Path" }
    $fields = [ordered]@{}
    foreach ($name in @('Directive-ID','Status','Title','Prepared-Date','Prepared-By','Repository-Baseline','Required-Authorization-Phrase')) {
        $matches = [regex]::Matches($text, "(?m)^$([regex]::Escape($name)):\s*(.+?)\s*$")
        if ($matches.Count -ne 1) { throw "Directive must contain exactly one $name field" }
        $fields[$name] = $matches[0].Groups[1].Value
    }
    if ($script:AionAllowedDirectiveStatuses -notcontains $fields.Status) {
        throw "Invalid directive status: $($fields.Status)"
    }
    [pscustomobject]@{ Path=$Path; Text=$text; Fields=[pscustomobject]$fields }
}

function Get-AionDirectiveSection {
    param([string]$Text,[string]$Heading)
    $match=[regex]::Match($Text,"(?ms)^## $([regex]::Escape($Heading))\s*\r?\n(.*?)(?=^## |\z)")
    if(-not $match.Success){throw "Directive section missing: $Heading"}
    return $match.Groups[1].Value.Trim()
}

function Test-AionAuthorizationPhrase {
    param([string]$Expected,[string]$Actual)
    return (-not [string]::IsNullOrEmpty($Actual)) -and ($Actual -ceq $Expected)
}

function Assert-AionRunnableDirective {
    param([object]$Directive)
    if ($Directive.Fields.Status -cne 'AUTHORIZED') {
        throw "Directive status must be AUTHORIZED; observed $($Directive.Fields.Status)"
    }
}

function Assert-AionBaselineValues {
    param(
        [string]$ExpectedHead,[string]$Branch,[string]$Head,[string]$Origin,
        [int]$Ahead,[int]$Behind,[string[]]$StatusLines
    )
    if($Branch -cne 'main'){throw "Expected branch main; observed $Branch"}
    if($Head -cne $ExpectedHead){throw "HEAD mismatch: expected $ExpectedHead, observed $Head"}
    if($Origin -cne $script:AionCanonicalOrigin){throw "Origin mismatch: $Origin"}
    if($Ahead -ne 0 -or $Behind -ne 0){throw "Repository is not synchronized: ahead $Ahead, behind $Behind"}
    if(@($StatusLines).Count -ne 0){throw 'Working tree is not clean'}
}

function Invoke-AionNpmVerification {
    param([Parameter(Mandatory=$true)][string]$Root)
    $commandName=if($env:OS -ceq 'Windows_NT'){'npm.cmd'}else{'npm'}
    $npmCommand=Get-Command $commandName -CommandType Application -ErrorAction Stop|Select-Object -First 1
    & $npmCommand.Source --prefix $Root run verify
    if($LASTEXITCODE -ne 0){throw "npm run verify failed with exit code $LASTEXITCODE"}
}

function Compare-AionCollections {
    param(
        [AllowNull()][object[]]$ReferenceObject,
        [AllowNull()][object[]]$DifferenceObject
    )
    $normalizedReference=[object[]]::new(0)
    $normalizedDifference=[object[]]::new(0)
    if($null-ne$ReferenceObject){$normalizedReference=[object[]]$ReferenceObject}
    if($null-ne$DifferenceObject){$normalizedDifference=[object[]]$DifferenceObject}
    Compare-Object -ReferenceObject $normalizedReference -DifferenceObject $normalizedDifference
}

function Assert-AionRepositoryGate {
    param([string]$Root,[string]$ExpectedHead,[switch]$RunVerification)
    $branch=(& git -C $Root branch --show-current).Trim()
    $head=(& git -C $Root rev-parse HEAD).Trim()
    $origin=(& git -C $Root remote get-url origin).Trim()
    $counts=((& git -C $Root rev-list --left-right --count HEAD...origin/main).Trim() -split '\s+')
    $status=@(& git -C $Root status --porcelain=v1 -uall)
    Assert-AionBaselineValues -ExpectedHead $ExpectedHead -Branch $branch -Head $head -Origin $origin `
        -Ahead ([int]$counts[0]) -Behind ([int]$counts[1]) -StatusLines $status
    if($RunVerification){
        try { Invoke-AionNpmVerification -Root $Root }
        catch {
            throw [InvalidOperationException]::new(
                "Repository gate verification stage failed: $($_.Exception.Message)", $_.Exception
            )
        }
    }
}

function Get-AionDirectiveFieldOrDefault {
    param([object]$Directive,[string]$Name,[string]$Default='')
    $matches=[regex]::Matches($Directive.Text,"(?m)^$([regex]::Escape($Name)):\s*(.+?)\s*$")
    if($matches.Count -eq 0){return $Default}
    if($matches.Count -ne 1){throw "Directive must contain at most one $Name field"}
    return $matches[0].Groups[1].Value
}

function Assert-AionRepositoryIdentityGate {
    param([string]$Root,[string]$ExpectedHead)
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $branch=(& git -C $root branch --show-current).Trim()
    $head=(& git -C $root rev-parse HEAD).Trim()
    $origin=(& git -C $root remote get-url origin).Trim()
    $counts=((& git -C $root rev-list --left-right --count HEAD...origin/main).Trim() -split '\s+')
    $status=@(& git -C $root status --porcelain=v1 -uall)
    Assert-AionBaselineValues -ExpectedHead $ExpectedHead -Branch $branch -Head $head -Origin $origin `
        -Ahead ([int]$counts[0]) -Behind ([int]$counts[1]) -StatusLines $status
}

function Invoke-AionTrustedVector {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][object[]]$Vector)
    if(@($Vector).Count -lt 1){throw 'Trusted command vector is empty'}
    $resolved=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $previous=(Get-Location).Path
    $previousErrorActionPreference=$ErrorActionPreference
    try {
        Set-Location -LiteralPath $resolved -ErrorAction Stop
        $exe=[string]$Vector[0]
        $args=@($Vector | Select-Object -Skip 1)
        $command=Get-Command $exe -CommandType Application -ErrorAction Stop|Select-Object -First 1
        $ErrorActionPreference='Continue'
        $output=& $command.Source @args 2>&1
        $code=$LASTEXITCODE
        if($null -eq $code){throw "Trusted command did not report a native exit code: $exe"}
        return [pscustomobject]@{ ExitCode=$code; Output=@($output); Cwd=$resolved }
    }
    finally {
        $ErrorActionPreference=$previousErrorActionPreference
        Set-Location -LiteralPath $previous
    }
}

function Invoke-AionTrustedVectorPass {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][object[]]$Vector,[Parameter(Mandatory=$true)][string]$Name)
    $result=Invoke-AionTrustedVector -Root $Root -Vector $Vector
    if($result.ExitCode -ne 0){throw "$Name failed with exit code $($result.ExitCode)"}
    return [pscustomobject]@{ Name=$Name; ExitCode=$result.ExitCode; Result='PASS' }
}

function Get-AionGitObjectId {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Revision,[Parameter(Mandatory=$true)][string]$Path)
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $object=(& git -C $root rev-parse "$Revision`:$Path" 2>$null)
    if($LASTEXITCODE -ne 0 -or -not $object){throw "Git object not found: $Revision`:$Path"}
    return $object.Trim()
}

function Get-AionFileSha256 {
    param([Parameter(Mandatory=$true)][string]$Path)
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "File missing for SHA-256: $Path"}
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-AionGitCommitExists {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Revision)
    & git -C $Root cat-file -e "$Revision`^{commit}" 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Get-AionGitSingleParent {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Revision)
    $parents=((& git -C $Root rev-list --parents -n 1 $Revision).Trim() -split '\s+')
    if(@($parents).Count -ne 2){throw "Expected exactly one parent for $Revision"}
    return $parents[1]
}

function Assert-AionExactPathSet {
    param(
        [Parameter(Mandatory=$true)][string[]]$Actual,
        [Parameter(Mandatory=$true)][string[]]$Expected,
        [Parameter(Mandatory=$true)][string]$Description
    )
    $diff=@(Compare-AionCollections -ReferenceObject @($Expected | Sort-Object) -DifferenceObject @($Actual | Sort-Object))
    if(@($diff).Count -ne 0){throw "$Description path set mismatch"}
}

function Assert-AionDirectorRecoveryBaselineIdentity {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$CurrentBaseline)
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $known=$script:AionDirectorRecoveryKnownBrokenBaselineSha
    if([string]::IsNullOrWhiteSpace($known)){throw 'Trusted Director known-broken baseline SHA is empty'}
    & git -C $root cat-file -e "$known`^{commit}" 2>$null
    if($LASTEXITCODE -ne 0){throw "Trusted Director known-broken baseline missing: $known"}
    foreach($path in $script:AionDirectorRecoverySourceIdentityPaths){
        $knownBlob=Get-AionGitObjectId -Root $root -Revision $known -Path $path
        $currentBlob=Get-AionGitObjectId -Root $root -Revision $CurrentBaseline -Path $path
        if($knownBlob -cne $currentBlob){throw "Director known-broken source identity mismatch: $path"}
    }
    $knownDirectorTree=Get-AionGitObjectId -Root $root -Revision $known -Path 'packages/director'
    $currentDirectorTree=Get-AionGitObjectId -Root $root -Revision $CurrentBaseline -Path 'packages/director'
    if($knownDirectorTree -cne $currentDirectorTree){throw 'Director tree differs from trusted known-broken baseline'}
    $reviewedDirectorTree=Get-AionGitObjectId -Root $root -Revision $script:AionReviewedDirectorSha -Path 'packages/director'
    if($currentDirectorTree -cne $reviewedDirectorTree){throw 'Director baseline tree differs from trusted prior reviewed Director tree'}
}

function Get-AionDirectorStructuredVerifyPlan {
    $workspaceTests=@(
        '@aion/application-preparation',
        '@aion/career-evidence',
        '@aion/career-input',
        '@aion/delegated-operator',
        '@aion/director',
        '@aion/identity',
        '@aion/job-matching',
        '@aion/job-posting',
        '@aion/kernel',
        '@aion/object',
        '@aion/privacy-boundary'
    )
    $components=@([pscustomobject]@{
        Name='typecheck:workspaces'
        Vector=@('npm.cmd','run','typecheck','--workspaces','--if-present')
    })
    foreach($workspace in $workspaceTests){
        $components+=[pscustomobject]@{
            Name="test:$workspace"
            Vector=@('npm.cmd','run','test','--workspace',$workspace)
        }
    }
    $components+=@(
        [pscustomobject]@{ Name='career:test'; Vector=@('npm.cmd','run','career:test') },
        [pscustomobject]@{ Name='aion:server:test'; Vector=@('npm.cmd','run','aion:server:test') }
    )
    return [pscustomobject]@{
        Components=@($components)
        KnownFailure=[pscustomobject]@{
            Id='LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY'
            Name='local-assistant:test:architecture'
            Vector=@('npm.cmd','run','test:architecture','--workspace','@aion/local-assistant')
            ExpectedExitCode=1
            ExpectedText=@(
                'developer bridge is the single process boundary and is repository-scoped',
                'process\.env'
            )
            ForbiddenText=@(
                'not ok .* - (?!.*developer bridge is the single process boundary and is repository-scoped)'
            )
        }
        RawFullVerify=[pscustomobject]@{
            Name='raw:verify'
            Vector=@('npm.cmd','run','verify')
        }
    }
}

function Invoke-AionLocalAssistantNonArchitectureVerification {
    param([Parameter(Mandatory=$true)][string]$Root)
    $results=@()
    $results+=Invoke-AionTrustedVectorPass -Root $Root -Vector @('npm.cmd','run','build','--workspace','@aion/local-assistant') -Name 'local-assistant:build'
    $results+=Invoke-AionTrustedVectorPass -Root $Root -Vector @('npm.cmd','run','build:test','--workspace','@aion/local-assistant') -Name 'local-assistant:build:test'
    $results+=Invoke-AionTrustedVectorPass -Root $Root -Vector @('npm.cmd','run','typecheck','--workspace','@aion/local-assistant') -Name 'local-assistant:typecheck'
    $sourceTestRoot=Join-Path $Root 'packages\local-assistant\test'
    $compiledTestRoot=Join-Path $Root 'packages\local-assistant\dist-test\test'
    $architectureSource=Join-Path $sourceTestRoot 'architecture-boundary.test.mjs'
    if(-not(Test-Path -LiteralPath $architectureSource -PathType Leaf)){throw 'Local-assistant architecture-boundary test missing'}
    $architectureMatches=@(Get-ChildItem -LiteralPath $sourceTestRoot -Recurse -File |
        Where-Object { $_.Name -ceq 'architecture-boundary.test.mjs' })
    if(@($architectureMatches).Count -ne 1){throw 'Local-assistant architecture-boundary test identity is ambiguous'}
    if(-not(Test-Path -LiteralPath $compiledTestRoot -PathType Container)){throw 'Local-assistant compiled test directory missing'}
    $sourceTsTests=@(Get-ChildItem -LiteralPath $sourceTestRoot -Recurse -File |
        Where-Object { $_.Name.EndsWith('.test.ts',[StringComparison]::Ordinal) })
    foreach($source in $sourceTsTests){
        $relative=Get-AionRepositoryRelativePath -Root $sourceTestRoot -Path $source.FullName
        $expectedRelative=$relative.Substring(0,$relative.Length-3)+'.js'
        $expected=Join-Path $compiledTestRoot ($expectedRelative.Replace('/','\'))
        if(-not(Test-Path -LiteralPath $expected -PathType Leaf)){
            throw "Local-assistant compiled test artifact missing: $expectedRelative"
        }
    }
    $files=@()
    $files+=@(Get-ChildItem -LiteralPath $compiledTestRoot -Recurse -File |
        Where-Object { $_.Name.EndsWith('.test.js',[StringComparison]::Ordinal) } |
        ForEach-Object { Get-AionRepositoryRelativePath -Root $Root -Path $_.FullName })
    $files+=@(Get-ChildItem -LiteralPath $sourceTestRoot -Recurse -File |
        Where-Object {
            $_.Name.EndsWith('.test.mjs',[StringComparison]::Ordinal) -and
            $_.Name -cne 'architecture-boundary.test.mjs'
        } |
        ForEach-Object { Get-AionRepositoryRelativePath -Root $Root -Path $_.FullName })
    foreach($file in $files){
        if($file.EndsWith('.test.ts',[StringComparison]::Ordinal)){throw "Raw TypeScript test selected for node execution: $file"}
        if($file -match '(^|/)architecture-boundary\.test\.mjs$'){throw 'Architecture-boundary test selected in non-architecture set'}
    }
    if(@($files).Count -gt 0){
        $results+=Invoke-AionTrustedVectorPass -Root $Root -Vector (@('node','--test','--test-reporter=tap') + @($files)) -Name 'local-assistant:non-architecture-tests'
    } else {
        $results+=[pscustomobject]@{ Name='local-assistant:non-architecture-tests'; ExitCode=0; Result='PASS'; TestFileCount=0 }
    }
    return @($results)
}

function Invoke-AionDirectorStructuredVerification {
    param([Parameter(Mandatory=$true)][string]$Root)
    $plan=Get-AionDirectorStructuredVerifyPlan
    $componentResults=@()
    foreach($component in $plan.Components){
        $componentResults+=Invoke-AionTrustedVectorPass -Root $Root -Vector $component.Vector -Name $component.Name
    }
    $componentResults+=Invoke-AionLocalAssistantNonArchitectureVerification -Root $Root
    $known=Invoke-AionTrustedVector -Root $Root -Vector $plan.KnownFailure.Vector
    if($known.ExitCode -ne $plan.KnownFailure.ExpectedExitCode){
        throw "Known remaining failure exit mismatch: $($known.ExitCode)"
    }
    $knownText=$known.Output -join "`n"
    foreach($pattern in $plan.KnownFailure.ExpectedText){
        if($knownText -notmatch $pattern){throw 'Known remaining failure signature mismatch'}
    }
    foreach($pattern in $plan.KnownFailure.ForbiddenText){
        if($knownText -match $pattern){throw 'Unexpected local-assistant architecture failure output'}
    }
    $raw=Invoke-AionTrustedVector -Root $Root -Vector $plan.RawFullVerify.Vector
    return [pscustomobject]@{
        Result='PASS'
        Components=@($componentResults)
        KnownRemainingFailures=@([pscustomobject]@{
            Id=$plan.KnownFailure.Id
            Name=$plan.KnownFailure.Name
            ExitCode=$known.ExitCode
            Result='EXPECTED_FAILURE'
        })
        RawFullVerify=[pscustomobject]@{
            Name=$plan.RawFullVerify.Name
            ExitCode=$raw.ExitCode
            Result=if($raw.ExitCode -eq 0){'PASS'}else{'NONZERO_AUDIT_ONLY'}
        }
    }
}

function Get-AionRepairGate {
    param([string]$GateId)
    switch($GateId){
        'LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY' {
            return [pscustomobject]@{
                Id='LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY'
                Command=@('npm.cmd','run','test','--workspace','@aion/local-assistant')
                Typecheck=@('npm.cmd','run','typecheck','--workspace','@aion/local-assistant')
                ExpectedExitCode=1
                ExpectedText=@(
                    'developer bridge is the single process boundary and is repository-scoped',
                    'process\.env'
                )
                TrustedAllowedPaths=@('packages/local-assistant/src/developer-bridge.ts')
                ProtectedPaths=@('packages/local-assistant/test/architecture-boundary.test.mjs')
            }
        }
        'DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE' {
            return [pscustomobject]@{
                Id='DIRECTOR_D2_RECOVERY_LEASE_AND_HYGIENE'
                Command=@('npm.cmd','run','aion:server:test')
                Typecheck=@('npm.cmd','run','typecheck','--workspace','@aion/director')
                ExpectedExitCode=1
                ExpectedText=@(
                    'no tracked text file contains double-encoded \(mojibake\) characters',
                    'packages/director/src/git-truth\.ts:12'
                )
                TrustedAllowedPaths=@(
                    'apps/aion/developer-agent.mjs',
                    'packages/director/src/lease-store.ts',
                    'packages/director/src/git-truth.ts',
                    'packages/director/test/lease-store.test.ts',
                    'packages/director/test/wiring.test.ts',
                    'test/aion/developer-agent.test.mjs'
                )
                ProtectedPaths=@(
                    'test/aion/source-hygiene.test.mjs',
                    'packages/local-assistant/src/developer-bridge.ts',
                    'packages/local-assistant/test/architecture-boundary.test.mjs',
                    'scripts/control-plane-common.ps1',
                    'scripts/test-control-plane.ps1'
                )
            }
        }
        'DIRECTOR_D2_REVIEWED_PROMOTION_AND_PUSH' {
            return [pscustomobject]@{
                Id='DIRECTOR_D2_REVIEWED_PROMOTION_AND_PUSH'
                Command=@('npm.cmd','run','test:architecture','--workspace','@aion/local-assistant')
                Typecheck=@('npm.cmd','run','typecheck','--workspace','@aion/local-assistant')
                ExpectedExitCode=1
                ExpectedText=@(
                    'developer bridge is the single process boundary and is repository-scoped',
                    'process\.env'
                )
                TrustedAllowedPaths=@()
                ProtectedPaths=@()
            }
        }
        default { throw "Unknown broken-baseline repair gate: $GateId" }
    }
}

function Get-AionRepairAllowedPaths {
    param([object]$Directive,[object]$Gate)
    $raw=Get-AionDirectiveFieldOrDefault $Directive 'Allowed-Repair-Files' ''
    $paths=if([string]::IsNullOrWhiteSpace($raw)){$Gate.TrustedAllowedPaths}else{$raw.Split(';')|ForEach-Object Trim|Where-Object {$_}}
    foreach($path in $paths){
        if($path -match '[\\]|\.\.|[*?[\]]|^\s*$'){throw "Invalid exact repair path: $path"}
        if($Gate.TrustedAllowedPaths -notcontains $path){throw "Repair path outside trusted gate allowlist: $path"}
    }
    return @($paths)
}

function Assert-AionBrokenBaselineRepairGate {
    param([string]$Root,[object]$Directive)
    if((Get-AionDirectiveFieldOrDefault $Directive 'Authorization-Class') -cne 'BROKEN_BASELINE_REPAIR'){
        throw 'Not a broken-baseline repair directive'
    }
    $gate=Get-AionRepairGate (Get-AionDirectiveFieldOrDefault $Directive 'Known-Failing-Gate')
    [void](Get-AionRepairAllowedPaths $Directive $gate)
    if($gate.Id -ceq $script:AionDirectorPromotionGateId){
        [void](Assert-AionReviewedDirectorPromotionPreflight -Root $Root -Directive $Directive)
        return
    }
    Assert-AionRepositoryIdentityGate -Root $Root -ExpectedHead $Directive.Fields.'Repository-Baseline'
    if($gate.Id -ceq $script:AionDirectorRecoveryGateId){
        Assert-AionDirectorRecoveryBaselineIdentity -Root $Root -CurrentBaseline $Directive.Fields.'Repository-Baseline'
    }
    $result=Invoke-AionTrustedVector -Root $Root -Vector $gate.Command
    if($result.ExitCode -ne $gate.ExpectedExitCode){throw "Known failing gate exit mismatch: $($result.ExitCode)"}
    $text=$result.Output -join "`n"
    foreach($pattern in $gate.ExpectedText){
        if($text -notmatch $pattern){throw 'Known failure signature mismatch'}
    }
}

function Write-AionRepairClosureReceipt {
    param([string]$Root,[object]$Receipt)
    $dir=Join-Path $Root ".aion-local\repair-closures\$($Receipt.directiveId)"
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $path=Join-Path $dir "$($Receipt.resultSha).json"
    [IO.File]::WriteAllText($path,($Receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    return $path
}

function Get-AionRepairClosureReceipt {
    param([string]$Root,[string]$DirectiveId,[string]$ResultSha)
    $path=Join-Path $Root ".aion-local\repair-closures\$DirectiveId\$ResultSha.json"
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Repair closure receipt missing: $path"}
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Assert-AionRepairClosureReceiptForPush {
    param([string]$Root,[string]$DirectiveId,[string]$ResultSha,[string]$BaselineSha,[string]$ReviewedDirectorSha)
    $receipt=Get-AionRepairClosureReceipt -Root $Root -DirectiveId $DirectiveId -ResultSha $ResultSha
    $anchorPolicy=if($receipt.PSObject.Properties.Name -contains 'directorAnchorPolicy'){$receipt.directorAnchorPolicy}else{'TREE_EQUIVALENCE'}
    if($anchorPolicy -cne 'CANDIDATE_REPLACEMENT'){
        if($receipt.closureResult -cne 'PASS'){throw 'Repair closure receipt is not PASS'}
        if($receipt.resultSha -cne $ResultSha){throw 'Repair closure receipt result SHA mismatch'}
        if($receipt.baselineSha -cne $BaselineSha){throw 'Repair closure receipt baseline mismatch'}
        if($receipt.reviewedDirectorSha -cne $ReviewedDirectorSha){throw 'Repair closure receipt reviewed Director SHA mismatch'}
        if($receipt.fullVerifyResult -cne 'PASS'){throw 'Repair closure receipt lacks full verify PASS'}
        if($receipt.changedPathScopeResult -cne 'PASS'){throw 'Repair closure receipt lacks changed-path PASS'}
        if($receipt.directorTreeEquivalence -cne 'PASS'){throw 'Repair closure receipt lacks Director tree equivalence PASS'}
        return
    }
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    if($receipt.closureResult -cne 'PASS'){throw 'Repair closure receipt is not PASS'}
    if($receipt.candidateSha -cne $ResultSha){throw 'Repair candidate receipt result SHA mismatch'}
    if($receipt.baselineSha -cne $BaselineSha){throw 'Repair closure receipt baseline mismatch'}
    if($receipt.priorReviewedDirectorSha -cne $script:AionReviewedDirectorSha){throw 'Repair candidate receipt prior Director SHA mismatch'}
    $gate=Get-AionRepairGate $script:AionDirectorRecoveryGateId
    $changed=@(& git -C $root diff --name-only "$BaselineSha..$ResultSha")
    foreach($path in $changed){
        if($gate.TrustedAllowedPaths -notcontains $path){throw "Unauthorized changed path at push: $path"}
    }
    $priorDirectorTree=(& git -C $root rev-parse "$($script:AionReviewedDirectorSha):packages/director").Trim()
    $baselineDirectorTree=(& git -C $root rev-parse "${BaselineSha}:packages/director").Trim()
    $candidateDirectorTree=(& git -C $root rev-parse "${ResultSha}:packages/director").Trim()
    if($baselineDirectorTree -cne $priorDirectorTree){throw 'Baseline Director tree does not match trusted prior reviewed tree'}
    if($receipt.baselineDirectorTree -cne $baselineDirectorTree){throw 'Receipt baseline Director tree mismatch'}
    if($receipt.candidateDirectorTree -cne $candidateDirectorTree){throw 'Receipt candidate Director tree mismatch'}
    $baselineLocalAssistantTree=(& git -C $root rev-parse "${BaselineSha}:packages/local-assistant").Trim()
    $candidateLocalAssistantTree=(& git -C $root rev-parse "${ResultSha}:packages/local-assistant").Trim()
    if($baselineLocalAssistantTree -cne $candidateLocalAssistantTree){throw 'Local-assistant tree changed at push'}
    if($receipt.localAssistantBaselineTree -cne $baselineLocalAssistantTree){throw 'Receipt local-assistant baseline tree mismatch'}
    if($receipt.localAssistantCandidateTree -cne $candidateLocalAssistantTree){throw 'Receipt local-assistant candidate tree mismatch'}
    if($receipt.localAssistantTreeIntegrity -cne 'PASS'){throw 'Receipt lacks local-assistant tree integrity PASS'}
    if($receipt.structuredVerificationResult -cne 'PASS'){throw 'Receipt lacks structured verification PASS'}
    if($receipt.directorTreeDisposition -cne 'REPLACED_BY_AUTHORIZED_CANDIDATE'){throw 'Receipt lacks truthful Director candidate disposition'}
    if($receipt.PSObject.Properties.Name -contains 'reviewed'){ if($receipt.reviewed){throw 'Candidate receipt must not mark reviewed'} }
    if($receipt.PSObject.Properties.Name -contains 'certified'){ if($receipt.certified){throw 'Candidate receipt must not mark certified'} }
}

function Find-AionClosedDirectiveById {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$DirectiveId)
    $paths=@()
    $current=Join-Path $Root '.aion-local\directives\CURRENT.md'
    if(Test-Path -LiteralPath $current -PathType Leaf){$paths+=$current}
    $archive=Join-Path $Root '.aion-local\directives\archive'
    if(Test-Path -LiteralPath $archive -PathType Container){
        $paths+=@(Get-ChildItem -LiteralPath $archive -Filter '*.md' -File | ForEach-Object { $_.FullName })
    }
    foreach($path in $paths){
        try {
            $directive=Get-AionDirective -Path $path
            if($directive.Fields.'Directive-ID' -ceq $DirectiveId -and $directive.Fields.Status -ceq 'CLOSED'){
                return $directive
            }
        } catch {}
    }
    throw "Closed repair directive not found: $DirectiveId"
}

function Get-AionDirectorPromotionReview {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$CandidateSha,[object]$Directive)
    $relative=Get-AionDirectiveFieldOrDefault $Directive 'Review-Artifact-Path' ".aion-local/reviews/director-candidate-$CandidateSha.json"
    if($relative -match '[\\]|\.\.'){throw "Invalid review artifact path: $relative"}
    $path=Join-Path $Root ($relative.Replace('/','\'))
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Review artifact missing: $path"}
    $expectedHash=Get-AionDirectiveFieldOrDefault $Directive 'Review-Artifact-Sha256' ''
    if(-not[string]::IsNullOrWhiteSpace($expectedHash)){
        $actualHash=Get-AionFileSha256 -Path $path
        if($actualHash -cne $expectedHash.ToLowerInvariant()){throw 'Review artifact SHA-256 mismatch'}
    }
    $review=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if($review.candidateSha -cne $CandidateSha){throw 'Review artifact candidate SHA mismatch'}
    if($review.reviewFamily -cne 'Grok'){throw 'Review artifact family mismatch'}
    if($review.verdict -cne 'PASS'){throw 'Review artifact verdict is not PASS'}
    if([int]$review.concreteBlockingDefects -ne 0){throw 'Review artifact reports blocking defects'}
    if($review.focusedTests -cne 'PASS'){throw 'Review artifact focused tests are not PASS'}
    if($review.falseReleaseCounterexample -cne 'NO'){throw 'Review artifact false-release result mismatch'}
    if($review.falseRetentionCounterexample -cne 'NO'){throw 'Review artifact false-retention result mismatch'}
    if($review.oneWriterSafety -cne 'PASS'){throw 'Review artifact one-writer safety mismatch'}
    if($review.foreignHolderSafety -cne 'PASS'){throw 'Review artifact foreign-holder safety mismatch'}
    if($review.filesChanged -cne 'NONE'){throw 'Review artifact must report no file changes'}
    return [pscustomobject]@{ Path=$path; Review=$review }
}

function Assert-AionReviewedDirectorPromotionPreflight {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][object]$Directive)
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $head=(& git -C $root rev-parse HEAD).Trim()
    if($head -cne $Directive.Fields.'Repository-Baseline'){throw 'Promotion directive baseline must equal current G7 HEAD'}
    $candidate=Get-AionGitSingleParent -Root $root -Revision $head
    if($candidate -cne $script:AionDirectorPromotionExpectedCandidateSha){throw 'Promotion candidate is not the exact reviewed candidate'}
    $candidateBaseline=Get-AionGitSingleParent -Root $root -Revision $candidate
    if($candidateBaseline -cne $script:AionDirectorPromotionExpectedCandidateBaselineSha){throw 'Promotion candidate parent is not the expected origin baseline'}
    $originMain=(& git -C $root rev-parse origin/main).Trim()
    if($originMain -cne $candidateBaseline){throw 'origin/main moved before promotion'}
    $branch=(& git -C $root branch --show-current).Trim()
    if($branch -cne 'main'){throw "Expected branch main; observed $branch"}
    $status=@(& git -C $root status --porcelain=v1 -uall)
    if(@($status).Count -ne 0){throw 'Working tree must be clean for promotion'}
    $candidateChanged=@(& git -C $root diff --name-only "$candidateBaseline..$candidate")
    $candidateAllowed=(Get-AionRepairGate $script:AionDirectorRecoveryGateId).TrustedAllowedPaths
    Assert-AionExactPathSet -Actual @($candidateChanged) -Expected @($candidateAllowed) -Description 'Candidate'
    $g7Changed=@(& git -C $root diff --name-only "$candidate..$head")
    foreach($path in $g7Changed){
        if($script:AionDirectorPromotionAllowedGovernancePaths -notcontains $path){throw "G7 contains non-governance change: $path"}
    }
    if(@($g7Changed).Count -eq 0){throw 'G7 governance diff is empty'}
    [void](Find-AionClosedDirectiveById -Root $root -DirectiveId $script:AionDirectorPromotionClosedDirectiveId)
    $receipt=Get-AionRepairClosureReceipt -Root $root -DirectiveId $script:AionDirectorPromotionClosedDirectiveId -ResultSha $candidate
    if($receipt.closureResult -cne 'PASS'){throw 'Director candidate closure is not PASS'}
    if($receipt.candidateSha -cne $candidate){throw 'Director closure receipt candidate mismatch'}
    if($receipt.baselineSha -cne $candidateBaseline){throw 'Director closure receipt baseline mismatch'}
    if($receipt.directorAnchorPolicy -cne 'CANDIDATE_REPLACEMENT'){throw 'Director closure receipt is not candidate replacement'}
    $baselineDirectorTree=Get-AionGitObjectId -Root $root -Revision $candidateBaseline -Path 'packages/director'
    $candidateDirectorTree=Get-AionGitObjectId -Root $root -Revision $candidate -Path 'packages/director'
    if($receipt.baselineDirectorTree -cne $baselineDirectorTree){throw 'Recomputed baseline Director tree mismatches receipt'}
    if($receipt.candidateDirectorTree -cne $candidateDirectorTree){throw 'Recomputed candidate Director tree mismatches receipt'}
    $baselineLocalAssistantTree=Get-AionGitObjectId -Root $root -Revision $candidateBaseline -Path 'packages/local-assistant'
    $candidateLocalAssistantTree=Get-AionGitObjectId -Root $root -Revision $candidate -Path 'packages/local-assistant'
    if($baselineLocalAssistantTree -cne $candidateLocalAssistantTree){throw 'Local-assistant tree changed in candidate'}
    if($receipt.localAssistantBaselineTree -cne $baselineLocalAssistantTree){throw 'Receipt baseline local-assistant tree mismatch'}
    if($receipt.localAssistantCandidateTree -cne $candidateLocalAssistantTree){throw 'Receipt candidate local-assistant tree mismatch'}
    if($receipt.structuredVerificationResult -cne 'PASS'){throw 'Closure receipt lacks structured verification PASS'}
    $knownIds=@($receipt.knownRemainingFailureIds)
    if(@($knownIds).Count -ne 1 -or $knownIds[0] -cne 'LOCAL_ASSISTANT_ARCHITECTURE_BOUNDARY'){
        throw 'Closure receipt known remaining failure mismatch'
    }
    [void](Get-AionDirectorPromotionReview -Root $root -CandidateSha $candidate -Directive $Directive)
    $structured=Invoke-AionDirectorStructuredVerification -Root $root
    if($structured.Result -cne 'PASS'){throw 'Structured promotion preflight failed'}
    return [pscustomobject]@{
        Result='PASS'
        Head=$head
        CandidateSha=$candidate
        CandidateBaselineSha=$candidateBaseline
        OriginMain=$originMain
        CandidateChangedPaths=@($candidateChanged)
        GovernanceChangedPaths=@($g7Changed)
        StructuredVerification=$structured
    }
}

function Invoke-AionReviewedDirectorPromotion {
    param(
        [Parameter(Mandatory=$true)][string]$Root,
        [Parameter(Mandatory=$true)][object]$Directive,
        [switch]$DryRun
    )
    if($Directive.Fields.Status -cne 'AUTHORIZED'){throw 'Promotion requires AUTHORIZED directive'}
    if((Get-AionDirectiveFieldOrDefault $Directive 'Authorization-Class') -cne 'BROKEN_BASELINE_REPAIR'){throw 'Promotion directive must use BROKEN_BASELINE_REPAIR'}
    if((Get-AionDirectiveFieldOrDefault $Directive 'Known-Failing-Gate') -cne $script:AionDirectorPromotionGateId){throw 'Promotion directive gate mismatch'}
    if($PSBoundParameters.ContainsKey('SkipRepositoryChecks')){throw 'SkipRepositoryChecks is not supported for promotion'}
    $preflight=Assert-AionReviewedDirectorPromotionPreflight -Root $Root -Directive $Directive
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $remoteBefore=(& git -C $root rev-parse origin/main).Trim()
    if($remoteBefore -cne $preflight.CandidateBaselineSha){throw 'origin/main moved before controlled push'}
    $pushResult='DRY_RUN'
    if(-not $DryRun){
        & git -C $root push origin main
        if($LASTEXITCODE -ne 0){throw "controlled promotion push failed with exit code $LASTEXITCODE"}
        & git -C $root fetch origin main
        if($LASTEXITCODE -ne 0){throw "post-push fetch failed with exit code $LASTEXITCODE"}
        $remoteAfter=(& git -C $root rev-parse origin/main).Trim()
        if($remoteAfter -cne $preflight.Head){throw 'origin/main did not advance to G7'}
        $pushResult='PASS'
    } else {
        $remoteAfter=$remoteBefore
    }
    $receipt=[pscustomobject]@{
        schemaVersion='aion.directorReviewedPromotion.v1'
        directiveId=$Directive.Fields.'Directive-ID'
        g7Sha=$preflight.Head
        candidateSha=$preflight.CandidateSha
        candidateBaselineSha=$preflight.CandidateBaselineSha
        closedRepairDirectiveId=$script:AionDirectorPromotionClosedDirectiveId
        closureResult='PASS'
        reviewShaBinding='EXACT'
        reviewVerdict='PASS'
        concreteBlockingDefects=0
        candidateChangedPaths=@($preflight.CandidateChangedPaths)
        governanceChangedPaths=@($preflight.GovernanceChangedPaths)
        localAssistantTreeIntegrity='PASS'
        promotionResult='PASS'
        shaAPrime=$preflight.CandidateSha
        remoteBeforePush=$remoteBefore
        remoteAfterPush=$remoteAfter
        pushResult=$pushResult
        d2Certification='NOT_GRANTED'
        timestampUtc=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    $dir=Join-Path $root ".aion-local\promotions\$($Directive.Fields.'Directive-ID')"
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $path=Join-Path $dir "$($preflight.Head).json"
    [IO.File]::WriteAllText($path,($receipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ ReceiptPath=$path; Receipt=$receipt }
}

function Assert-AionBrokenBaselineRepairClosure {
    param([string]$Root,[object]$Directive,[string]$ReviewedDirectorSha)
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    if($Directive.Fields.Status -cne 'AUTHORIZED'){throw 'Closure requires AUTHORIZED repair directive'}
    if((Get-AionDirectiveFieldOrDefault $Directive 'Authorization-Class') -cne 'BROKEN_BASELINE_REPAIR'){throw 'Not broken-baseline repair'}
    $baseline=$Directive.Fields.'Repository-Baseline'
    $head=(& git -C $root rev-parse HEAD).Trim()
    if($head -ceq $baseline){throw 'Repair closure requires committed result SHA'}
    $gate=Get-AionRepairGate (Get-AionDirectiveFieldOrDefault $Directive 'Known-Failing-Gate')
    if($gate.Id -ceq $script:AionDirectorRecoveryGateId){
        return Assert-AionDirectorRecoveryRepairClosure -Root $root -Directive $Directive -Gate $gate
    }
    $allowed=Get-AionRepairAllowedPaths $Directive $gate
    $status=@(& git -C $root status --porcelain=v1 -uall)
    if(@($status).Count -ne 0){throw 'Working tree must be clean at repair closure'}
    $changed=@(& git -C $root diff --name-only "$baseline..$head")
    foreach($path in $changed){
        if($allowed -notcontains $path){throw "Unauthorized changed path: $path"}
    }
    foreach($path in $gate.ProtectedPaths){
        if(@(& git -C $root diff --name-only "$baseline..$head" -- $path).Count -ne 0){
            throw "Protected policy test changed: $path"
        }
    }
    $gateResult=Invoke-AionTrustedVector -Root $root -Vector $gate.Command
    if($gateResult.ExitCode -ne 0){throw 'Targeted repair gate failed'}
    $typecheckResult=Invoke-AionTrustedVector -Root $root -Vector $gate.Typecheck
    if($typecheckResult.ExitCode -ne 0){throw 'Targeted typecheck failed'}
    Invoke-AionNpmVerification -Root $root
    $treeA=(& git -C $root rev-parse "${ReviewedDirectorSha}:packages/director").Trim()
    $treeC=(& git -C $root rev-parse "${head}:packages/director").Trim()
    if($treeA -cne $treeC){throw 'Director tree changed'}
    if(@(& git -C $root diff --name-only "$ReviewedDirectorSha..$head" -- packages/director).Count -ne 0){
        throw 'Director path diff not empty'
    }
    $receipt=[pscustomobject]@{
        schemaVersion='aion.brokenBaselineRepairClosure.v1'
        directiveId=$Directive.Fields.'Directive-ID'
        authorizationClass='BROKEN_BASELINE_REPAIR'
        knownFailingGateId=$gate.Id
        baselineSha=$baseline
        resultSha=$head
        authorizedRepairPaths=@($allowed)
        actualChangedPaths=@($changed)
        protectedFileIntegrityResult='PASS'
        targetedRepairGateResult='PASS'
        targetedTypecheckResult='PASS'
        fullVerifyResult='PASS'
        changedPathScopeResult='PASS'
        reviewedDirectorSha=$ReviewedDirectorSha
        reviewedDirectorTree=$treeA
        resultDirectorTree=$treeC
        directorTreeEquivalence='PASS'
        timestampUtc=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        closureResult='PASS'
    }
    $path=Write-AionRepairClosureReceipt -Root $root -Receipt $receipt
    Set-AionDirectiveStatus -Path $Directive.Path -From 'AUTHORIZED' -To 'CLOSED'
    Write-Host "Broken-baseline repair closure PASS: $baseline -> $head"
    Write-Host "Receipt: $path"
    return $path
}

function Assert-AionDirectorRecoveryRepairClosure {
    param([string]$Root,[object]$Directive,[object]$Gate)
    $root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $baseline=$Directive.Fields.'Repository-Baseline'
    $head=(& git -C $root rev-parse HEAD).Trim()
    if($head -ceq $baseline){throw 'Repair closure requires committed result SHA'}
    $allowed=Get-AionRepairAllowedPaths $Directive $Gate
    $status=@(& git -C $root status --porcelain=v1 -uall)
    if(@($status).Count -ne 0){throw 'Working tree must be clean at repair closure'}
    $changed=@(& git -C $root diff --name-only "$baseline..$head")
    foreach($path in $changed){
        if($allowed -notcontains $path){throw "Unauthorized changed path: $path"}
    }
    foreach($path in $Gate.ProtectedPaths){
        if(@(& git -C $root diff --name-only "$baseline..$head" -- $path).Count -ne 0){
            throw "Protected policy test changed: $path"
        }
    }
    $priorDirectorTree=(& git -C $root rev-parse "$($script:AionReviewedDirectorSha):packages/director").Trim()
    $baselineDirectorTree=(& git -C $root rev-parse "${baseline}:packages/director").Trim()
    if($baselineDirectorTree -cne $priorDirectorTree){throw 'Baseline Director tree does not match trusted prior reviewed tree'}
    $candidateDirectorTree=(& git -C $root rev-parse "${head}:packages/director").Trim()
    $baselineLocalAssistantTree=(& git -C $root rev-parse "${baseline}:packages/local-assistant").Trim()
    $candidateLocalAssistantTree=(& git -C $root rev-parse "${head}:packages/local-assistant").Trim()
    if($baselineLocalAssistantTree -cne $candidateLocalAssistantTree){throw 'Local-assistant tree changed'}
    $gateResult=Invoke-AionTrustedVector -Root $root -Vector $Gate.Command
    if($gateResult.ExitCode -ne 0){throw 'Targeted Director repair gate failed'}
    $typecheckResult=Invoke-AionTrustedVector -Root $root -Vector $Gate.Typecheck
    if($typecheckResult.ExitCode -ne 0){throw 'Targeted Director typecheck failed'}
    $structured=Invoke-AionDirectorStructuredVerification -Root $root
    $receipt=[pscustomobject]@{
        schemaVersion='aion.directorRecoveryCandidateClosure.v1'
        directiveId=$Directive.Fields.'Directive-ID'
        authorizationClass='BROKEN_BASELINE_REPAIR'
        gateId=$Gate.Id
        baselineSha=$baseline
        candidateSha=$head
        resultSha=$head
        priorReviewedDirectorSha=$script:AionReviewedDirectorSha
        baselineDirectorTree=$baselineDirectorTree
        candidateDirectorTree=$candidateDirectorTree
        directorAnchorPolicy='CANDIDATE_REPLACEMENT'
        authorizedRepairPaths=@($allowed)
        actualChangedPaths=@($changed)
        localAssistantBaselineTree=$baselineLocalAssistantTree
        localAssistantCandidateTree=$candidateLocalAssistantTree
        localAssistantTreeIntegrity='PASS'
        structuredVerificationResult=$structured.Result
        structuredVerificationResults=$structured.Components
        knownRemainingFailureIds=@($structured.KnownRemainingFailures | ForEach-Object { $_.Id })
        rawFullVerifyResult=$structured.RawFullVerify
        targetedRepairGateResult='PASS'
        targetedTypecheckResult='PASS'
        changedPathScopeResult='PASS'
        directorTreeDisposition='REPLACED_BY_AUTHORIZED_CANDIDATE'
        timestampUtc=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        closureResult='PASS'
    }
    $path=Write-AionRepairClosureReceipt -Root $root -Receipt $receipt
    Set-AionDirectiveStatus -Path $Directive.Path -From 'AUTHORIZED' -To 'CLOSED'
    Write-Host "Director recovery candidate closure PASS: $baseline -> $head"
    Write-Host "DIRECTOR_REPAIR_CANDIDATE_SHA: $head"
    Write-Host "Receipt: $path"
    return $path
}

function Set-AionDirectiveStatus {
    param([string]$Path,[string]$From,[string]$To,[switch]$RecordAuthorization)
    if($script:AionAllowedDirectiveStatuses -notcontains $To){throw "Invalid target status: $To"}
    $text=Get-Content -LiteralPath $Path -Raw
    $pattern="(?m)^Status:\s*$([regex]::Escape($From))\s*$"
    if(([regex]::Matches($text,$pattern)).Count -ne 1){throw "Directive status transition source is not exactly $From"}
    $text=[regex]::Replace($text,$pattern,"Status: $To",1)
    if($RecordAuthorization){
        $stamp=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        $text=[regex]::Replace($text,'(?m)^(Prepared-Date:.*)$',"`$1`r`nAuthorized-Date: $stamp",1)
    }
    [IO.File]::WriteAllText($Path,$text,[Text.UTF8Encoding]::new($false))
}

function Assert-AionRunDependencies {
    param([string]$AgentsPath,[string]$CodexCommand='codex')
    if(-not(Test-Path -LiteralPath $AgentsPath -PathType Leaf)){throw "AGENTS.md missing: $AgentsPath"}
    if(-not(Get-Command $CodexCommand -ErrorAction SilentlyContinue)){throw "Codex executable missing: $CodexCommand"}
}

function Assert-AionPostRun {
    param([string]$DirectivePath,[string]$HandoffPath)
    $directive=Get-AionDirective -Path $DirectivePath
    if($directive.Fields.Status -in @('AUTHORIZED','RUNNING')){throw "Run incomplete: directive remains $($directive.Fields.Status)"}
    if(-not(Test-Path -LiteralPath $HandoffPath -PathType Leaf)){throw 'LATEST handoff missing'}
    if((Get-Item -LiteralPath $HandoffPath).Length -eq 0){throw 'LATEST handoff is empty'}
}
