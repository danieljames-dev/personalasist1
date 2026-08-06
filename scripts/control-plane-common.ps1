Set-StrictMode -Version Latest

$script:AionAllowedDirectiveStatuses = @(
    'PENDING_OWNER_AUTHORIZATION','AUTHORIZED','RUNNING','AWAITING_CTO_REVIEW',
    'BLOCKED','FAILED','SUPERSEDED'
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
