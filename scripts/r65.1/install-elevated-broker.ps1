#Requires -RunAsAdministrator
<#
.SYNOPSIS
  R6.5.2 elevated install/redeploy of AION Elevated Operator Broker.
  - Dedicated NT SERVICE\AionElevatedBroker (never LocalSystem)
  - Private/public state split; ordinary User cannot read secrets or write trust state
  - Retires compromised R6.5.1 keys; provisions fresh private material
  - Does not disable UAC; does not store Owner password
#>
[CmdletBinding()]
param(
    [string]$RepositoryRoot = 'C:\AION-HQ',
    [string]$StagingRoot = 'C:\AION-HQ\dist-install\ElevatedOperatorBroker',
    [string]$InstallRoot = 'C:\Program Files\AION\ElevatedOperatorBroker',
    [string]$StateRoot = 'C:\ProgramData\AION\ElevatedOperatorBroker',
    [string]$ServiceName = 'AionElevatedBroker'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-AionLog([string]$Message) {
    $logDir = Join-Path $StateRoot 'public\audit'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $line = '{0} {1}' -f (Get-Date).ToUniversalTime().ToString('o'), $Message
    Add-Content -LiteralPath (Join-Path $logDir 'install.log') -Value $line -Encoding UTF8
    Write-Host $line
}

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'install-elevated-broker.ps1 must run elevated (UAC).'
}

if (-not (Test-Path -LiteralPath $StagingRoot)) {
    throw "Staging package missing: $StagingRoot - run build-install-package.mjs first"
}
$stagingManifestPath = Join-Path $StagingRoot 'STAGING-MANIFEST.v1.json'
if (-not (Test-Path -LiteralPath $stagingManifestPath)) {
    throw "Staging manifest missing: $stagingManifestPath"
}
$staging = Get-Content -LiteralPath $stagingManifestPath -Raw | ConvertFrom-Json
Write-AionLog "Install start sourceHead=$($staging.sourceHead) artifact=$($staging.artifactVersion)"

# Stop/remove old service
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-AionLog "Stopping existing service $ServiceName"
    if ($existing.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue }
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# Deploy install root from staged package only
if (Test-Path -LiteralPath $InstallRoot) {
    Write-AionLog 'Replacing install root'
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -Path (Join-Path $StagingRoot '*') -Destination $InstallRoot -Recurse -Force
Remove-Item -LiteralPath (Join-Path $InstallRoot 'STAGING-MANIFEST.v1.json') -Force -ErrorAction SilentlyContinue

# Pin a Node runtime under install root so NT SERVICE can execute it (no user-profile path)
$runtimeDir = Join-Path $InstallRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$nodeCandidates = @(
    $env:AION_NODE_EXE,
    'C:\Program Files\nodejs\node.exe',
    'C:\Users\User\dev\tools\nodejs\node.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $nodeCandidates -or $nodeCandidates.Count -eq 0) {
    throw 'No node.exe found to pin under install root runtime\'
}
Copy-Item -LiteralPath $nodeCandidates[0] -Destination (Join-Path $runtimeDir 'node.exe') -Force
Write-AionLog "Pinned node runtime from $($nodeCandidates[0])"

# Private / public state layout
$privateRoot = Join-Path $StateRoot 'private'
$publicRoot = Join-Path $StateRoot 'public'
foreach ($d in @(
    $StateRoot, $privateRoot, $publicRoot,
    (Join-Path $privateRoot 'approval'),
    (Join-Path $privateRoot 'ipc'),
    (Join-Path $privateRoot 'host-store'),
    (Join-Path $privateRoot 'replay'),
    (Join-Path $privateRoot 'owner-approval-inbox'),
    (Join-Path $publicRoot 'audit')
)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# Retire compromised R6.5.1 flat keys (existence only logged)
$legacyKey = Join-Path $StateRoot 'approval\owner-hmac.key'
$legacySession = Join-Path $StateRoot 'ipc\session.key'
foreach ($legacy in @($legacyKey, $legacySession)) {
    if (Test-Path -LiteralPath $legacy) {
        Write-AionLog "Retiring compromised legacy path (contents not logged): $legacy"
        Remove-Item -LiteralPath $legacy -Force -ErrorAction SilentlyContinue
    }
}
# Also wipe any previous private keys to force rotation on repair
$privateKey = Join-Path $privateRoot 'approval\owner-hmac.key'
$privateSession = Join-Path $privateRoot 'ipc\session.key'
foreach ($pk in @($privateKey, $privateSession)) {
    if (Test-Path -LiteralPath $pk) {
        Write-AionLog 'Rotating prior private material (contents not logged)'
        Remove-Item -LiteralPath $pk -Force
    }
}

function New-HexKey32 {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
}

# Provision FRESH keys only after private dirs exist (ACLs applied next)
[IO.File]::WriteAllText($privateKey, (New-HexKey32), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($privateSession, (New-HexKey32), [Text.UTF8Encoding]::new($false))
Write-AionLog 'Provisioned fresh private approval and session material (not logged)'

# Manifest digests measured on installed files
$digests = @{}
foreach ($prop in $staging.digests.PSObject.Properties) {
    $rel = $prop.Name
    $full = Join-Path $InstallRoot ($rel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $full)) { throw "Installed artifact missing: $rel" }
    $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -cne $prop.Value.ToLowerInvariant()) {
        throw "Digest mismatch for $rel"
    }
    $digests[$rel] = $hash
}
$repoHead = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
if ($repoHead -cne $staging.sourceHead) {
    throw "Staging sourceHead $($staging.sourceHead) != repository HEAD $repoHead"
}
$manifest = [ordered]@{
    schemaVersion           = 'aion.elevated-broker.install.v1'
    artifactVersion         = $staging.artifactVersion
    sourceHead              = $repoHead
    operationCatalogVersion = $staging.operationCatalogVersion
    policyDigest            = $staging.policyDigest
    digests                 = $digests
    machineName             = $env:COMPUTERNAME
    installedAtUtc          = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    pipeName                = '\\.\pipe\AION-ElevatedOperatorBroker-v1'
    serviceName             = $ServiceName
    serviceAccount          = "NT SERVICE\$ServiceName"
    trustBoundary           = 'r652-private-owner-helper'
    installRoot             = $InstallRoot
    stateRoot               = $StateRoot
    repositoryRoot          = $RepositoryRoot
    loadFromRepoAfterInstall= $false
}
$manifestPath = Join-Path $publicRoot 'manifest.v1.json'
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-AionLog "Wrote manifest sourceHead=$repoHead"

# ACLs
function Clear-And-SetAcl([string]$Path, [System.Security.AccessControl.FileSystemAccessRule[]]$Rules) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($a in @($acl.Access)) { [void]$acl.RemoveAccessRule($a) }
    foreach ($r in $Rules) { $acl.AddAccessRule($r) }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$prop = [System.Security.AccessControl.PropagationFlags]::None

# Install root: SYSTEM/Admins full; Users RX; no User write
$installRules = @(
    (New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl',$inherit,$prop,'Allow')),
    (New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl',$inherit,$prop,'Allow')),
    (New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Users','ReadAndExecute',$inherit,$prop,'Allow'))
)
Clear-And-SetAcl -Path $InstallRoot -Rules $installRules
Write-AionLog 'Applied install-root ACLs'

# Private root: SYSTEM + Admins full; NO ordinary User; service SID added after service create
$privateRules = @(
    (New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl',$inherit,$prop,'Allow')),
    (New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl',$inherit,$prop,'Allow'))
)
Clear-And-SetAcl -Path $privateRoot -Rules $privateRules
Write-AionLog 'Applied private-root ACLs (pre-service SID)'

# Public root: SYSTEM/Admins full; Users RX only (service SID granted after create for audit write)
$publicRules = @(
    (New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl',$inherit,$prop,'Allow')),
    (New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl',$inherit,$prop,'Allow')),
    (New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Users','ReadAndExecute',$inherit,$prop,'Allow'))
)
Clear-And-SetAcl -Path $publicRoot -Rules $publicRules

# Sensitive private files: SYSTEM + Admins only until service SID granted on directory
foreach ($sensitive in @($privateKey, $privateSession)) {
    $acl = Get-Acl -LiteralPath $sensitive
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($a in @($acl.Access)) { [void]$acl.RemoveAccessRule($a) }
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl','Allow')))
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
    Set-Acl -LiteralPath $sensitive -AclObject $acl
}

# Create service under virtual service account (no password)
$binPath = '"{0}"' -f (Join-Path $InstallRoot 'bin\aion-elevated-broker.exe')
Write-AionLog "Creating service $ServiceName as NT SERVICE\$ServiceName"
$create = & sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= 'AION Elevated Operator Broker' obj= "NT SERVICE\$ServiceName"
Write-AionLog "sc create: $create"
if ("$create" -notmatch 'SUCCESS') {
    # Some Windows builds need create then config
    & sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= 'AION Elevated Operator Broker' | Out-Null
    $cfg = & sc.exe config $ServiceName obj= "NT SERVICE\$ServiceName" password= ""
    Write-AionLog "sc config: $cfg"
    if ("$cfg" -notmatch 'SUCCESS') {
        throw "Failed to set service account to NT SERVICE\$ServiceName - refusing LocalSystem fallback"
    }
}
& sc.exe description $ServiceName 'AION constrained elevated operator broker R6.5.2 - private trust state; no public listener' | Out-Null

# Grant service SID modify on private root
$svcSidAccount = "NT SERVICE\$ServiceName"
try {
    $acl = Get-Acl -LiteralPath $privateRoot
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $svcSidAccount, 'Modify', $inherit, $prop, 'Allow')))
    Set-Acl -LiteralPath $privateRoot -AclObject $acl
    foreach ($sensitive in @($privateKey, $privateSession)) {
        $acl = Get-Acl -LiteralPath $sensitive
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
            $svcSidAccount, 'Read', 'Allow')))
        Set-Acl -LiteralPath $sensitive -AclObject $acl
    }
    # Inbox: Admins write (elevated helper), service modify
    $inbox = Join-Path $privateRoot 'owner-approval-inbox'
    $iacl = Get-Acl -LiteralPath $inbox
    $iacl.SetAccessRuleProtection($true, $false)
    foreach ($a in @($iacl.Access)) { [void]$iacl.RemoveAccessRule($a) }
    $iacl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl',$inherit,$prop,'Allow')))
    $iacl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl',$inherit,$prop,'Allow')))
    $iacl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($svcSidAccount,'Modify',$inherit,$prop,'Allow')))
    Set-Acl -LiteralPath $inbox -AclObject $iacl
    # Public audit write for service logs (not secrets)
    $pacl = Get-Acl -LiteralPath $publicRoot
    $pacl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $svcSidAccount, 'Modify', $inherit, $prop, 'Allow')))
    Set-Acl -LiteralPath $publicRoot -AclObject $pacl
    Write-AionLog "Granted $svcSidAccount access to private root and public audit"
} catch {
    throw "Failed to grant service SID private ACLs: $($_.Exception.Message)"
}

# Verify not LocalSystem
$acct = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartName
Write-AionLog "Service StartName=$acct"
if ($acct -match 'LocalSystem|LocalSystem') {
    if ($acct -eq 'LocalSystem') { throw 'Service is LocalSystem - refusing to start' }
}
if ($acct -eq 'LocalSystem') { throw 'Service is LocalSystem - refusing to start' }

Write-AionLog 'Starting service'
Start-Service -Name $ServiceName
Start-Sleep -Seconds 4
$svc = Get-Service -Name $ServiceName
Write-AionLog "Service status=$($svc.Status)"
if ($svc.Status -ne 'Running') {
    # capture log tail non-secret
    $slog = Join-Path $publicRoot 'audit\service.log'
    if (Test-Path $slog) { Get-Content $slog -Tail 20 | ForEach-Object { Write-AionLog "svc: $_" } }
    throw "Service failed to run: $($svc.Status)"
}

# Controlled restart
Restart-Service -Name $ServiceName -Force
Start-Sleep -Seconds 4
$svc2 = Get-Service -Name $ServiceName
Write-AionLog "Service status after restart=$($svc2.Status)"
if ($svc2.Status -ne 'Running') { throw "Service failed after restart" }

$finalAcct = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartName
if ($finalAcct -eq 'LocalSystem') { throw 'Post-start LocalSystem detected' }

$result = [ordered]@{
    ok = $true
    serviceName = $ServiceName
    serviceStatus = "$($svc2.Status)"
    serviceAccount = $finalAcct
    installRoot = $InstallRoot
    stateRoot = $StateRoot
    privateRoot = $privateRoot
    publicRoot = $publicRoot
    sourceHead = $repoHead
    artifactVersion = $staging.artifactVersion
    installedAtUtc = $manifest.installedAtUtc
    uacDisabled = $false
    ownerPasswordStored = $false
    trustBoundary = 'r652-private-owner-helper'
    compromisedKeysReused = $false
}
[IO.File]::WriteAllText((Join-Path $publicRoot 'install-result.v1.json'), ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-AionLog 'INSTALL_OK'
Write-Output ($result | ConvertTo-Json)
exit 0
