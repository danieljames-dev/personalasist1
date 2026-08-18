Set-StrictMode -Version Latest

$script:AionOwnerStandingAuthoritySchema = 'aion.ownerStandingAuthority.v1'
$script:AionOwnerAuthorityStates = @('ACTIVE','SUSPENDED','REVOKED','EXPIRED')
$script:AionOwnerAuthorityDecisions = @('ALLOW_STANDING','REQUIRE_FRESH_OWNER_APPROVAL','DENY')
$script:AionOwnerStandingAuthoritySource = 'OWNER_STANDING_AUTHORITY_V1'
$script:AionDefaultAllowedProviders = @('codex','grok','claude','local')
$script:AionRoutineActionKinds = @(
    'READ','PLAN','TEST','BUILD','TYPECHECK','LINT','DIAGNOSE','WORKTREE','DEPENDENCY_PREP',
    'RETRY','REPAIR','SOURCE_EDIT','GOVERNANCE_FIX','COMMIT','INTERNAL_DIRECTIVE','HANDOFF',
    'RECEIPT','REVIEW','PROVIDER_FAILOVER','CONTROLLED_PUSH'
)
$script:AionHighConsequenceActionKinds = @(
    'SPEND','PRODUCTION_WRITER','DESTRUCTIVE','OAUTH_CONSENT','SECURITY_CHANGE',
    'SENSITIVE_DATA','OBJECTIVE_CHANGE'
)

function Get-AionOwnerAuthorityStorePath {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$OwnerAuthorizationId)
    if($OwnerAuthorizationId -notmatch '^[A-Za-z0-9._-]{1,128}$'){throw 'Owner authorization id is not a safe path segment'}
    return (Join-Path $Root ".aion-local\owner-authority\$OwnerAuthorizationId.json")
}

function New-AionOwnerAuthorityDecision {
    param([Parameter(Mandatory=$true)][string]$Outcome,[Parameter(Mandatory=$true)][string]$Reason,[string]$AuthorityId='')
    if($script:AionOwnerAuthorityDecisions -notcontains $Outcome){throw "Invalid authority outcome: $Outcome"}
    return [pscustomobject]@{
        schemaVersion='aion.ownerStandingAuthorityDecision.v1'
        outcome=$Outcome
        reason=$Reason
        ownerAuthorizationId=$AuthorityId
        authoritySource=$script:AionOwnerStandingAuthoritySource
    }
}

function Test-AionStringSetSubset {
    param([AllowNull()][object[]]$Requested,[AllowNull()][object[]]$Allowed)
    $wanted=@()
    if($null -ne $Requested){$wanted=@($Requested | ForEach-Object { [string]$_ } | Where-Object { $_ -ne '' })}
    $have=@()
    if($null -ne $Allowed){$have=@($Allowed | ForEach-Object { [string]$_ } | Where-Object { $_ -ne '' })}
    foreach($item in $wanted){
        if($have -cnotcontains $item){return $false}
    }
    return $true
}

function Assert-AionOwnerMilestoneAuthorizationShape {
    param([Parameter(Mandatory=$true)][object]$Authority)
    if($null -eq $Authority){throw 'Owner milestone authorization is missing'}
    foreach($name in @(
        'schemaVersion','ownerAuthorizationId','milestoneId','authorizedObjective','repositoryWorkspace',
        'allowedScopes','allowedWriteDomains','allowedExternalEffects','allowedProviders','spendingCeilingUsd',
        'productionWriterPermission','sensitiveDataPermission','destructiveActionPermission',
        'securityChangePermission','oauthConsentPermission','state'
    )){
        if(-not($Authority.PSObject.Properties.Name -contains $name)){throw "Owner milestone authorization missing field: $name"}
    }
    if($Authority.schemaVersion -cne $script:AionOwnerStandingAuthoritySchema){throw 'Owner milestone authorization schema mismatch'}
    if([string]::IsNullOrWhiteSpace([string]$Authority.ownerAuthorizationId)){throw 'Owner authorization id is empty'}
    if([string]::IsNullOrWhiteSpace([string]$Authority.milestoneId)){throw 'Milestone id is empty'}
    if([string]::IsNullOrWhiteSpace([string]$Authority.authorizedObjective)){throw 'Authorized objective is empty'}
    if([string]::IsNullOrWhiteSpace([string]$Authority.repositoryWorkspace)){throw 'Repository workspace is empty'}
    if($script:AionOwnerAuthorityStates -notcontains [string]$Authority.state){throw "Invalid owner authority state: $($Authority.state)"}
    try { $null=[int]$Authority.spendingCeilingUsd } catch { throw 'Spending ceiling is not an integer' }
    if([int]$Authority.spendingCeilingUsd -lt 0){throw 'Spending ceiling cannot be negative'}
    foreach($flag in @('productionWriterPermission','sensitiveDataPermission','destructiveActionPermission','securityChangePermission','oauthConsentPermission')){
        $value=[string]$Authority.$flag
        if($value -cnotin @('YES','NO')){throw "$flag must be YES or NO"}
    }
}

function New-AionOwnerMilestoneAuthorization {
    param(
        [Parameter(Mandatory=$true)][string]$OwnerAuthorizationId,
        [Parameter(Mandatory=$true)][string]$MilestoneId,
        [Parameter(Mandatory=$true)][string]$AuthorizedObjective,
        [Parameter(Mandatory=$true)][string]$RepositoryWorkspace,
        [object[]]$AllowedScopes=@('governance','scripts','docs'),
        [object[]]$AllowedWriteDomains=@('governance','scripts','docs','.aion-local'),
        [object[]]$AllowedExternalEffects=@('NONE'),
        [object[]]$AllowedProviders=@('codex','grok','claude','local'),
        [int]$SpendingCeilingUsd=0,
        [string]$ProductionWriterPermission='NO',
        [string]$SensitiveDataPermission='NO',
        [string]$DestructiveActionPermission='NO',
        [string]$SecurityChangePermission='NO',
        [string]$OauthConsentPermission='NO',
        [string]$State='ACTIVE',
        [string]$ExpiresAtUtc='',
        [string]$SupersededBy='',
        [string]$CreatedFromDirectiveId=''
    )
    $authority=[pscustomobject]@{
        schemaVersion=$script:AionOwnerStandingAuthoritySchema
        ownerAuthorizationId=$OwnerAuthorizationId
        milestoneId=$MilestoneId
        authorizedObjective=$AuthorizedObjective
        repositoryWorkspace=$RepositoryWorkspace
        allowedScopes=@($AllowedScopes)
        allowedWriteDomains=@($AllowedWriteDomains)
        allowedExternalEffects=@($AllowedExternalEffects)
        allowedProviders=@($AllowedProviders)
        spendingCeilingUsd=$SpendingCeilingUsd
        productionWriterPermission=$ProductionWriterPermission
        sensitiveDataPermission=$SensitiveDataPermission
        destructiveActionPermission=$DestructiveActionPermission
        securityChangePermission=$SecurityChangePermission
        oauthConsentPermission=$OauthConsentPermission
        state=$State
        expiresAtUtc=$ExpiresAtUtc
        supersededBy=$SupersededBy
        createdFromDirectiveId=$CreatedFromDirectiveId
        createdAtUtc=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    Assert-AionOwnerMilestoneAuthorizationShape -Authority $authority
    return $authority
}

function Write-AionOwnerMilestoneAuthorization {
    param(
        [Parameter(Mandatory=$true)][string]$Root,
        [Parameter(Mandatory=$true)][object]$Authority,
        [switch]$FounderPhraseVerified
    )
    if(-not $FounderPhraseVerified){throw 'Agents cannot create Owner milestone authority'}
    Assert-AionOwnerMilestoneAuthorizationShape -Authority $Authority
    $path=Get-AionOwnerAuthorityStorePath -Root $Root -OwnerAuthorizationId $Authority.ownerAuthorizationId
    [IO.Directory]::CreateDirectory((Split-Path -Parent $path))|Out-Null
    [IO.File]::WriteAllText($path,($Authority|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    return $path
}

function Get-AionOwnerMilestoneAuthorization {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$OwnerAuthorizationId)
    $path=Get-AionOwnerAuthorityStorePath -Root $Root -OwnerAuthorizationId $OwnerAuthorizationId
    $authority=Read-AionJsonFile -Path $path
    Assert-AionOwnerMilestoneAuthorizationShape -Authority $authority
    return $authority
}

function Set-AionOwnerAuthorityState {
    param(
        [Parameter(Mandatory=$true)][string]$Root,
        [Parameter(Mandatory=$true)][string]$OwnerAuthorizationId,
        [Parameter(Mandatory=$true)][string]$State,
        [switch]$OwnerOperation
    )
    if(-not $OwnerOperation){throw 'Only an Owner operation may change owner authority state'}
    if($script:AionOwnerAuthorityStates -notcontains $State){throw "Invalid owner authority state: $State"}
    $authority=Get-AionOwnerMilestoneAuthorization -Root $Root -OwnerAuthorizationId $OwnerAuthorizationId
    $authority.state=$State
    $path=Get-AionOwnerAuthorityStorePath -Root $Root -OwnerAuthorizationId $OwnerAuthorizationId
    [IO.File]::WriteAllText($path,($authority|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    return $authority
}

function New-AionAuthorityRequest {
    param(
        [Parameter(Mandatory=$true)][string]$ActionKind,
        [string]$MilestoneId='',
        [string]$Objective='',
        [object[]]$Scopes=@(),
        [object[]]$WriteDomains=@(),
        [object[]]$ExternalEffects=@(),
        [string]$Provider='',
        [int]$SpendUsd=0,
        [string]$ProductionWriter='NO',
        [string]$Destructive='NO',
        [string]$SecurityChange='NO',
        [string]$OauthConsent='NO',
        [string]$SensitiveData='NO',
        [datetime]$Now=(Get-Date).ToUniversalTime()
    )
    return [pscustomobject]@{
        actionKind=$ActionKind
        milestoneId=$MilestoneId
        objective=$Objective
        scopes=@($Scopes)
        writeDomains=@($WriteDomains)
        externalEffects=@($ExternalEffects)
        provider=$Provider
        spendUsd=$SpendUsd
        productionWriter=$ProductionWriter
        destructive=$Destructive
        securityChange=$SecurityChange
        oauthConsent=$OauthConsent
        sensitiveData=$SensitiveData
        nowUtc=$Now
    }
}

function Resolve-AionOwnerStandingAuthority {
    param(
        [AllowNull()][object]$Authority,
        [Parameter(Mandatory=$true)][object]$Request
    )
    if($null -eq $Authority){return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Owner milestone authorization is missing')}
    try { Assert-AionOwnerMilestoneAuthorizationShape -Authority $Authority }
    catch { return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason "Owner milestone authorization is malformed: $($_.Exception.Message)") }

    $id=[string]$Authority.ownerAuthorizationId
    if([string]::IsNullOrWhiteSpace([string]$Request.actionKind)){
        return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Requested action kind is missing' -AuthorityId $id)
    }

    $state=[string]$Authority.state
    if($state -ceq 'REVOKED'){return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Owner authority is revoked' -AuthorityId $id)}
    if($state -ceq 'SUSPENDED'){return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Owner authority is suspended' -AuthorityId $id)}
    if($state -ceq 'EXPIRED'){return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Owner authority is expired' -AuthorityId $id)}
    if($state -cne 'ACTIVE'){return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason "Owner authority state is not ACTIVE: $state" -AuthorityId $id)}

    $expires=[string]$Authority.expiresAtUtc
    if(-not [string]::IsNullOrWhiteSpace($expires)){
        try { $expiresAt=[datetime]::Parse($expires, $null, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal) }
        catch { return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Owner authority expiration is unreadable' -AuthorityId $id) }
        $now=$Request.nowUtc
        if($null -eq $now){$now=(Get-Date).ToUniversalTime()}
        if($now -ge $expiresAt){return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Owner authority is expired' -AuthorityId $id)}
    }

    if(-not [string]::IsNullOrWhiteSpace([string]$Request.milestoneId) -and [string]$Request.milestoneId -cne [string]$Authority.milestoneId){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Requested milestone differs from the Owner-authorized milestone' -AuthorityId $id)
    }
    if(-not [string]::IsNullOrWhiteSpace([string]$Request.objective) -and [string]$Request.objective -cne [string]$Authority.authorizedObjective){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Requested objective differs from the Owner-authorized objective' -AuthorityId $id)
    }

    if(-not (Test-AionStringSetSubset -Requested $Request.scopes -Allowed $Authority.allowedScopes)){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Requested scope is outside the Owner-authorized envelope' -AuthorityId $id)
    }
    if(-not (Test-AionStringSetSubset -Requested $Request.writeDomains -Allowed $Authority.allowedWriteDomains)){
        return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Internal request cannot broaden write domains' -AuthorityId $id)
    }

    if([int]$Request.spendUsd -gt [int]$Authority.spendingCeilingUsd){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Requested spend exceeds the Owner-approved ceiling' -AuthorityId $id)
    }
    if([string]$Request.productionWriter -ceq 'YES' -or [string]$Request.actionKind -ceq 'PRODUCTION_WRITER'){
        if([string]$Authority.productionWriterPermission -cne 'YES'){
            return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Production writer activation requires fresh Owner approval' -AuthorityId $id)
        }
    }
    if([string]$Request.destructive -ceq 'YES' -or [string]$Request.actionKind -ceq 'DESTRUCTIVE'){
        if([string]$Authority.destructiveActionPermission -cne 'YES'){
            return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Destructive important-data action requires fresh Owner approval' -AuthorityId $id)
        }
    }
    if([string]$Request.oauthConsent -ceq 'YES' -or [string]$Request.actionKind -ceq 'OAUTH_CONSENT'){
        if([string]$Authority.oauthConsentPermission -cne 'YES'){
            return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'External account consent requires fresh Owner approval' -AuthorityId $id)
        }
    }
    if([string]$Request.securityChange -ceq 'YES' -or [string]$Request.actionKind -ceq 'SECURITY_CHANGE'){
        if([string]$Authority.securityChangePermission -cne 'YES'){
            return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Major security change requires fresh Owner approval' -AuthorityId $id)
        }
    }
    if([string]$Request.sensitiveData -ceq 'YES' -or [string]$Request.actionKind -ceq 'SENSITIVE_DATA'){
        if([string]$Authority.sensitiveDataPermission -cne 'YES'){
            return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Sensitive-data expansion requires fresh Owner approval' -AuthorityId $id)
        }
    }
    if([string]$Request.actionKind -ceq 'OBJECTIVE_CHANGE'){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Material objective change requires fresh Owner approval' -AuthorityId $id)
    }
    if([string]$Request.actionKind -ceq 'SPEND' -and [int]$Request.spendUsd -gt [int]$Authority.spendingCeilingUsd){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Spend outside approved budget requires fresh Owner approval' -AuthorityId $id)
    }

    if([string]$Request.actionKind -ceq 'PROVIDER_FAILOVER'){
        $provider=[string]$Request.provider
        if([string]::IsNullOrWhiteSpace($provider)){return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Provider failover request is missing a provider' -AuthorityId $id)}
        $allowed=@($Authority.allowedProviders)
        if($allowed.Count -eq 0){$allowed=$script:AionDefaultAllowedProviders}
        if($allowed -cnotcontains $provider){
            return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason "Provider $provider is not in the Owner-authorized provider set" -AuthorityId $id)
        }
        return (New-AionOwnerAuthorityDecision -Outcome 'ALLOW_STANDING' -Reason "Provider failover to $provider is inside the approved envelope" -AuthorityId $id)
    }

    if([string]$Request.actionKind -ceq 'CONTROLLED_PUSH'){
        $effects=@($Authority.allowedExternalEffects)
        if($effects -cnotcontains 'CONTROLLED_PUSH'){
            return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Controlled push is not in the Owner-authorized external effects' -AuthorityId $id)
        }
        return (New-AionOwnerAuthorityDecision -Outcome 'ALLOW_STANDING' -Reason 'Controlled push is already included in the Owner-authorized milestone' -AuthorityId $id)
    }

    if($script:AionHighConsequenceActionKinds -contains [string]$Request.actionKind){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason "Action $($Request.actionKind) requires fresh Owner approval" -AuthorityId $id)
    }
    if($script:AionRoutineActionKinds -notcontains [string]$Request.actionKind){
        return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason "Unknown action kind is not standing-authorizable: $($Request.actionKind)" -AuthorityId $id)
    }

    return (New-AionOwnerAuthorityDecision -Outcome 'ALLOW_STANDING' -Reason "Routine action $($Request.actionKind) is covered by active Owner standing authority" -AuthorityId $id)
}

function New-AionAuthorityRequestFromDirective {
    param([Parameter(Mandatory=$true)][object]$Directive)
    $action=Get-AionDirectiveFieldOrDefault $Directive 'Requested-Action-Kind' 'INTERNAL_DIRECTIVE'
    $scopesRaw=Get-AionDirectiveFieldOrDefault $Directive 'Requested-Scopes' ''
    $writesRaw=Get-AionDirectiveFieldOrDefault $Directive 'Requested-Write-Domains' ''
    $effectsRaw=Get-AionDirectiveFieldOrDefault $Directive 'Requested-External-Effects' ''
    $spendRaw=Get-AionDirectiveFieldOrDefault $Directive 'Requested-Spend-Usd' '0'
    $split={ param($text) if([string]::IsNullOrWhiteSpace($text)){@()}else{@($text.Split(';')|ForEach-Object Trim|Where-Object {$_})} }
    try { $spend=[int]$spendRaw } catch { throw 'Requested-Spend-Usd is not an integer' }
    return (New-AionAuthorityRequest `
        -ActionKind $action `
        -MilestoneId (Get-AionDirectiveFieldOrDefault $Directive 'Milestone-Id' '') `
        -Objective (Get-AionDirectiveFieldOrDefault $Directive 'Authorized-Objective' '') `
        -Scopes (& $split $scopesRaw) `
        -WriteDomains (& $split $writesRaw) `
        -ExternalEffects (& $split $effectsRaw) `
        -Provider (Get-AionDirectiveFieldOrDefault $Directive 'Requested-Provider' '') `
        -SpendUsd $spend `
        -ProductionWriter (Get-AionDirectiveFieldOrDefault $Directive 'Requested-Production-Writer' 'NO') `
        -Destructive (Get-AionDirectiveFieldOrDefault $Directive 'Requested-Destructive' 'NO') `
        -SecurityChange (Get-AionDirectiveFieldOrDefault $Directive 'Requested-Security-Change' 'NO') `
        -OauthConsent (Get-AionDirectiveFieldOrDefault $Directive 'Requested-Oauth-Consent' 'NO') `
        -SensitiveData (Get-AionDirectiveFieldOrDefault $Directive 'Requested-Sensitive-Data' 'NO'))
}

function Test-AionDirectiveDoesNotBroadenOwnerAuthority {
    param([Parameter(Mandatory=$true)][object]$Directive,[Parameter(Mandatory=$true)][object]$Authority)
    $childSpendRaw=Get-AionDirectiveFieldOrDefault $Directive 'Spend-Ceiling-Usd' ''
    if(-not [string]::IsNullOrWhiteSpace($childSpendRaw)){
        try { $childSpend=[int]$childSpendRaw } catch { throw 'Child Spend-Ceiling-Usd is not an integer' }
        if($childSpend -gt [int]$Authority.spendingCeilingUsd){throw 'Internal directive cannot increase spending limit'}
    }
    if((Get-AionDirectiveFieldOrDefault $Directive 'Production-Writer-Permission' 'NO') -ceq 'YES' -and [string]$Authority.productionWriterPermission -cne 'YES'){
        throw 'Internal directive cannot enable production writer permission'
    }
    if((Get-AionDirectiveFieldOrDefault $Directive 'Sensitive-Data-Permission' 'NO') -ceq 'YES' -and [string]$Authority.sensitiveDataPermission -cne 'YES'){
        throw 'Internal directive cannot enable sensitive-data permissions'
    }
    if((Get-AionDirectiveFieldOrDefault $Directive 'Destructive-Action-Permission' 'NO') -ceq 'YES' -and [string]$Authority.destructiveActionPermission -cne 'YES'){
        throw 'Internal directive cannot enable destructive-action permission'
    }
}

function Resolve-AionStandingDirectiveAuthorization {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][object]$Directive)
    $source=Get-AionDirectiveFieldOrDefault $Directive 'Authority-Source' ''
    $fresh=Get-AionDirectiveFieldOrDefault $Directive 'Fresh-Owner-Approval-Required' ''
    $ownerId=Get-AionDirectiveFieldOrDefault $Directive 'Owner-Authorization-Id' ''
    if($source -cne $script:AionOwnerStandingAuthoritySource){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Directive is not covered by OWNER_STANDING_AUTHORITY_V1')
    }
    if($fresh -ceq 'YES'){
        return (New-AionOwnerAuthorityDecision -Outcome 'REQUIRE_FRESH_OWNER_APPROVAL' -Reason 'Directive marks fresh Owner approval required' -AuthorityId $ownerId)
    }
    if($fresh -cne 'NO'){
        return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Standing directive must set Fresh-Owner-Approval-Required to NO or YES')
    }
    if([string]::IsNullOrWhiteSpace($ownerId)){
        return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason 'Standing directive is missing Owner-Authorization-Id')
    }
    try {
        $authority=Get-AionOwnerMilestoneAuthorization -Root $Root -OwnerAuthorizationId $ownerId
        Test-AionDirectiveDoesNotBroadenOwnerAuthority -Directive $Directive -Authority $authority
        $request=New-AionAuthorityRequestFromDirective -Directive $Directive
        return (Resolve-AionOwnerStandingAuthority -Authority $authority -Request $request)
    }
    catch {
        return (New-AionOwnerAuthorityDecision -Outcome 'DENY' -Reason $_.Exception.Message -AuthorityId $ownerId)
    }
}

function Write-AionOwnerMilestoneAuthorizationFromDirective {
    param(
        [Parameter(Mandatory=$true)][string]$Root,
        [Parameter(Mandatory=$true)][object]$Directive,
        [switch]$FounderPhraseVerified
    )
    if(-not $FounderPhraseVerified){throw 'Agents cannot create Owner milestone authority'}
    $milestoneId=Get-AionDirectiveFieldOrDefault $Directive 'Milestone-Id' ''
    if([string]::IsNullOrWhiteSpace($milestoneId)){return $null}
    $ownerId=Get-AionDirectiveFieldOrDefault $Directive 'Owner-Authorization-Id' $milestoneId
    $split={ param($text,$fallback) if([string]::IsNullOrWhiteSpace($text)){@($fallback)}else{@($text.Split(';')|ForEach-Object Trim|Where-Object {$_})} }
    $spendRaw=Get-AionDirectiveFieldOrDefault $Directive 'Spend-Ceiling-Usd' '0'
    try { $spend=[int]$spendRaw } catch { throw 'Spend-Ceiling-Usd is not an integer' }
    $authority=New-AionOwnerMilestoneAuthorization `
        -OwnerAuthorizationId $ownerId `
        -MilestoneId $milestoneId `
        -AuthorizedObjective (Get-AionDirectiveFieldOrDefault $Directive 'Authorized-Objective' $Directive.Fields.Title) `
        -RepositoryWorkspace (Get-AionDirectiveFieldOrDefault $Directive 'Repository-Workspace' $Root) `
        -AllowedScopes (& $split (Get-AionDirectiveFieldOrDefault $Directive 'Allowed-Scopes' '') @('governance','scripts','docs')) `
        -AllowedWriteDomains (& $split (Get-AionDirectiveFieldOrDefault $Directive 'Allowed-Write-Domains' '') @('governance','scripts','docs','.aion-local')) `
        -AllowedExternalEffects (& $split (Get-AionDirectiveFieldOrDefault $Directive 'Allowed-External-Effects' '') @('NONE')) `
        -AllowedProviders (& $split (Get-AionDirectiveFieldOrDefault $Directive 'Allowed-Providers' '') $script:AionDefaultAllowedProviders) `
        -SpendingCeilingUsd $spend `
        -ProductionWriterPermission (Get-AionDirectiveFieldOrDefault $Directive 'Production-Writer-Permission' 'NO') `
        -SensitiveDataPermission (Get-AionDirectiveFieldOrDefault $Directive 'Sensitive-Data-Permission' 'NO') `
        -DestructiveActionPermission (Get-AionDirectiveFieldOrDefault $Directive 'Destructive-Action-Permission' 'NO') `
        -SecurityChangePermission (Get-AionDirectiveFieldOrDefault $Directive 'Security-Change-Permission' 'NO') `
        -OauthConsentPermission (Get-AionDirectiveFieldOrDefault $Directive 'Oauth-Consent-Permission' 'NO') `
        -CreatedFromDirectiveId $Directive.Fields.'Directive-ID'
    return (Write-AionOwnerMilestoneAuthorization -Root $Root -Authority $authority -FounderPhraseVerified)
}
