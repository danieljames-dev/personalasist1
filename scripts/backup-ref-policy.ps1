Set-StrictMode -Version Latest

$script:AionDurableRefNamespaces = @('refs/heads/', 'refs/tags/', 'refs/notes/')
$script:AionDurableFetchRefspecs = @(
    '+refs/heads/*:refs/heads/*',
    '+refs/tags/*:refs/tags/*',
    '+refs/notes/*:refs/notes/*'
)

function Get-AionGitArguments {
    param([string]$RepositoryPath, [string]$GitDir)
    if ($GitDir) { return @("--git-dir=$GitDir") }
    if ($RepositoryPath) { return @('-C', $RepositoryPath) }
    return @()
}

function Get-AionRefInventory {
    param([string]$RepositoryPath, [string]$GitDir)

    $gitArgs = @(Get-AionGitArguments -RepositoryPath $RepositoryPath -GitDir $GitDir)
    $lines = @(& git @gitArgs for-each-ref '--format=%(refname)|%(objectname)|%(objecttype)')
    if ($LASTEXITCODE -ne 0) { throw 'Unable to enumerate Git refs' }

    $refs = @($lines | ForEach-Object {
        $parts = $_ -split '\|', 3
        $name = $parts[0]
        $durable = $false
        $namespace = 'other'
        foreach ($prefix in $script:AionDurableRefNamespaces) {
            if ($name.StartsWith($prefix, [StringComparison]::Ordinal)) {
                $durable = $true
                $namespace = $prefix.TrimEnd('/')
                break
            }
        }
        if (-not $durable -and $name -match '^refs/([^/]+)/') {
            $namespace = "refs/$($Matches[1])"
        }
        [pscustomobject]@{
            name       = $name
            objectId   = $parts[1]
            objectType = $parts[2]
            nameLength = $name.Length
            namespace  = $namespace
            durable    = $durable
        }
    })

    $included = @($refs | Where-Object durable)
    $excluded = @($refs | Where-Object { -not $_.durable })
    $excludedNamespaces = @($excluded | Group-Object namespace | Sort-Object Name | ForEach-Object {
        [pscustomobject]@{
            namespace       = $_.Name
            count           = $_.Count
            longestRefLength= [int](($_.Group | Measure-Object nameLength -Maximum).Maximum)
        }
    })

    [pscustomobject]@{
        durableNamespaces   = @($script:AionDurableRefNamespaces)
        durableFetchRefspecs= @($script:AionDurableFetchRefspecs)
        includedRefs        = $included
        excludedRefs        = $excluded
        excludedNamespaces  = $excludedNamespaces
        excludedRefCount    = $excluded.Count
        longestExcludedRefLength = [int]$(if ($excluded.Count) {
            ($excluded | Measure-Object nameLength -Maximum).Maximum
        } else { 0 })
    }
}

function Initialize-AionDurableMirror {
    param(
        [Parameter(Mandatory=$true)][string]$Source,
        [Parameter(Mandatory=$true)][string]$Destination
    )

    & git init --bare $Destination | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to initialize staged mirror: $Destination" }
    & git --git-dir=$Destination remote add origin $Source
    if ($LASTEXITCODE -ne 0) { throw 'Unable to configure staged mirror origin' }
    foreach ($refspec in $script:AionDurableFetchRefspecs) {
        & git --git-dir=$Destination config --add remote.origin.fetch $refspec
        if ($LASTEXITCODE -ne 0) { throw "Unable to add durable refspec: $refspec" }
    }
    & git --git-dir=$Destination fetch --prune origin
    if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch durable refs into staged mirror' }
    & git --git-dir=$Destination symbolic-ref HEAD refs/heads/main
    if ($LASTEXITCODE -ne 0) { throw 'Unable to set staged mirror HEAD' }
}

function New-AionDurableBundle {
    param(
        [Parameter(Mandatory=$true)][string]$RepositoryPath,
        [Parameter(Mandatory=$true)][string]$BundlePath,
        [Parameter(Mandatory=$true)][object[]]$IncludedRefs
    )

    $refNames = @($IncludedRefs | ForEach-Object name)
    if ($refNames.Count -eq 0) { throw 'No durable refs selected for bundle' }
    & git -C $RepositoryPath bundle create $BundlePath @refNames
    if ($LASTEXITCODE -ne 0) { throw 'Durable-ref bundle creation failed' }
    & git -C $RepositoryPath bundle verify $BundlePath
    if ($LASTEXITCODE -ne 0) { throw 'Durable-ref bundle verification failed' }
}
