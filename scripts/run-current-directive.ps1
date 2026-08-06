[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$DirectivePath,
    [string]$AgentsPath,
    [string]$HandoffPath,
    [string]$CodexCommand='codex',
    [switch]$ValidationOnly,
    [switch]$TestMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-plane-common.ps1')

try {
    $root=Resolve-AionGitRoot -StartPath $RepositoryRoot
    if(-not $DirectivePath){$DirectivePath=Join-Path $root '.aion-local\directives\CURRENT.md'}
    if(-not $AgentsPath){$AgentsPath=Join-Path $root 'AGENTS.md'}
    if(-not $HandoffPath){$HandoffPath=Join-Path $root '.aion-local\handoffs\LATEST.md'}
    Assert-AionRunDependencies -AgentsPath $AgentsPath -CodexCommand $CodexCommand
    $directive=Get-AionDirective -Path $DirectivePath
    Assert-AionRunnableDirective $directive
    Assert-AionRepositoryGate -Root $root -ExpectedHead $directive.Fields.'Repository-Baseline'

    if($ValidationOnly){
        Write-Host "Directive $($directive.Fields.'Directive-ID') is authorized and passes launch validation."
        Write-Host 'Validation only: Codex was not launched and no prompt was written.'
        exit 0
    }
    if($TestMode){throw 'TestMode never launches Codex; use ValidationOnly'}

    & $CodexCommand login status *> $null
    if($LASTEXITCODE -ne 0){throw 'Codex authentication is not valid'}
    $promptDir=Join-Path $root '.aion-local\prompts'
    New-Item -ItemType Directory -Path $promptDir -Force|Out-Null
    $stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'")
    $promptPath=Join-Path $promptDir "run-$stamp.md"
    $prompt=@'
Read AGENTS.md and .aion-local/directives/CURRENT.md in full.

Confirm which instruction sources are active.
Execute only the authorized local directive.
Follow every stop condition.
Do not begin any later phase.
Write the final report to .aion-local/handoffs/LATEST.md and a timestamped history file.
Update the directive status when finished.
'@
    [IO.File]::WriteAllText($promptPath,$prompt,[Text.UTF8Encoding]::new($false))
    Push-Location $root
    try { & $CodexCommand -C $root $prompt } finally { Pop-Location }
    $codexExit=$LASTEXITCODE
    if($codexExit -ne 0){throw "Codex exited with code $codexExit"}
    Assert-AionPostRun -DirectivePath $DirectivePath -HandoffPath $HandoffPath
    Write-Host 'SUCCESS: directive ended in a reviewable state with a non-empty handoff.'
    Write-Host "Git status:`n$(& git -C $root status --short --branch)"
    exit 0
}
catch { Write-Error $_.Exception.Message; exit 1 }
