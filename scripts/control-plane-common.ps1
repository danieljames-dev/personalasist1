Set-StrictMode -Version Latest

$script:AionAllowedDirectiveStatuses = @(
    'PENDING_OWNER_AUTHORIZATION','AUTHORIZED','RUNNING','AWAITING_CTO_REVIEW',
    'BLOCKED','FAILED','SUPERSEDED','CLOSED'
)
$script:AionCanonicalOrigin = 'https://github.com/danieljames-dev/personalasist1.git'

function Resolve-AionGitRoot {
    param([string]$StartPath)
    if (-not $StartPath) { $StartPath = (Get-Location).Path }
    $root = (& git -C $StartPath rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $root) { throw "Not inside an AION Git repository: $StartPath" }
    return (Resolve-Path -LiteralPath $root.Trim()).Path
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
    try {
        Set-Location -LiteralPath $resolved -ErrorAction Stop
        $exe=[string]$Vector[0]
        $args=@($Vector | Select-Object -Skip 1)
        $output=& $exe @args 2>&1
        $code=$LASTEXITCODE
        return [pscustomobject]@{ ExitCode=$code; Output=@($output); Cwd=$resolved }
    }
    finally {
        Set-Location -LiteralPath $previous
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
    Assert-AionRepositoryIdentityGate -Root $Root -ExpectedHead $Directive.Fields.'Repository-Baseline'
    if((Get-AionDirectiveFieldOrDefault $Directive 'Authorization-Class') -cne 'BROKEN_BASELINE_REPAIR'){
        throw 'Not a broken-baseline repair directive'
    }
    $gate=Get-AionRepairGate (Get-AionDirectiveFieldOrDefault $Directive 'Known-Failing-Gate')
    [void](Get-AionRepairAllowedPaths $Directive $gate)
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
    if($receipt.closureResult -cne 'PASS'){throw 'Repair closure receipt is not PASS'}
    if($receipt.resultSha -cne $ResultSha){throw 'Repair closure receipt result SHA mismatch'}
    if($receipt.baselineSha -cne $BaselineSha){throw 'Repair closure receipt baseline mismatch'}
    if($receipt.reviewedDirectorSha -cne $ReviewedDirectorSha){throw 'Repair closure receipt reviewed Director SHA mismatch'}
    if($receipt.fullVerifyResult -cne 'PASS'){throw 'Repair closure receipt lacks full verify PASS'}
    if($receipt.changedPathScopeResult -cne 'PASS'){throw 'Repair closure receipt lacks changed-path PASS'}
    if($receipt.directorTreeEquivalence -cne 'PASS'){throw 'Repair closure receipt lacks Director tree equivalence PASS'}
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
