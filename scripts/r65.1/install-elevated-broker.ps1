#Requires -RunAsAdministrator
<#
.SYNOPSIS
  R6.5.1 elevated install of AION Elevated Operator Broker.
  Owner may approve UAC once. Does not disable UAC. Does not store Owner password.
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
    $logDir = Join-Path $StateRoot 'audit'
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

Write-AionLog "Install start sourceHead=$($staging.sourceHead)"

# Stop existing service if present
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-AionLog "Stopping existing service $ServiceName"
    if ($existing.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue }
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# Deploy install root (code) from staged package only
if (Test-Path -LiteralPath $InstallRoot) {
    Write-AionLog "Removing previous install root"
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -Path (Join-Path $StagingRoot '*') -Destination $InstallRoot -Recurse -Force
# Do not leave staging secrets in install root
Remove-Item -LiteralPath (Join-Path $InstallRoot 'STAGING-MANIFEST.v1.json') -Force -ErrorAction SilentlyContinue

# State root
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot 'approval') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot 'ipc') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot 'host-store') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot 'replay') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot 'audit') | Out-Null

# Provision approval HMAC key (64 hex chars) if absent — ACL restricted later
$keyPath = Join-Path $StateRoot 'approval\owner-hmac.key'
if (-not (Test-Path -LiteralPath $keyPath)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    [IO.File]::WriteAllText($keyPath, $hex, [Text.UTF8Encoding]::new($false))
    Write-AionLog 'Provisioned owner-hmac.key (contents not logged)'
} else {
    Write-AionLog 'Reusing existing owner-hmac.key'
}

$sessionKeyPath = Join-Path $StateRoot 'ipc\session.key'
if (-not (Test-Path -LiteralPath $sessionKeyPath)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    [IO.File]::WriteAllText($sessionKeyPath, $hex, [Text.UTF8Encoding]::new($false))
    Write-AionLog 'Provisioned ipc session.key (contents not logged)'
}

# Write install manifest with digests measured on installed files
$digests = @{}
foreach ($prop in $staging.digests.PSObject.Properties) {
    $rel = $prop.Name
    $full = Join-Path $InstallRoot ($rel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $full)) { throw "Installed artifact missing: $rel" }
    $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -cne $prop.Value.ToLowerInvariant()) {
        throw "Digest mismatch for $rel expected=$($prop.Value) actual=$hash"
    }
    $digests[$rel] = $hash
}

$manifest = [ordered]@{
    schemaVersion           = 'aion.elevated-broker.install.v1'
    artifactVersion         = $staging.artifactVersion
    sourceHead              = $staging.sourceHead
    operationCatalogVersion = $staging.operationCatalogVersion
    policyDigest            = $staging.policyDigest
    digests                 = $digests
    machineName             = $env:COMPUTERNAME
    installedAtUtc          = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    pipeName                = '\\.\pipe\AION-ElevatedOperatorBroker-v1'
    serviceName             = $ServiceName
    installRoot             = $InstallRoot
    stateRoot               = $StateRoot
    repositoryRoot          = $RepositoryRoot
    loadFromRepoAfterInstall= $false
}
$manifestPath = Join-Path $StateRoot 'manifest.v1.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 8
# UTF-8 without BOM — Node JSON.parse rejects BOM
[IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))
Write-AionLog "Wrote manifest $manifestPath"

# ACLs: install root — Administrators + SYSTEM full; Users read/execute only (no write)
function Set-ProtectedAcls([string]$Path, [switch]$State) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $rules = @()
    $rules += New-Object System.Security.AccessControl.FileSystemAccessRule(
        'NT AUTHORITY\SYSTEM', 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $rules += New-Object System.Security.AccessControl.FileSystemAccessRule(
        'BUILTIN\Administrators', 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    if ($State) {
        # Service account needs write on state
        $rules += New-Object System.Security.AccessControl.FileSystemAccessRule(
            'NT AUTHORITY\LOCAL SERVICE', 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $rules += New-Object System.Security.AccessControl.FileSystemAccessRule(
            'NT AUTHORITY\NETWORK SERVICE', 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    } else {
        $rules += New-Object System.Security.AccessControl.FileSystemAccessRule(
            'BUILTIN\Users', 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    }
    # Owner interactive user read on approval root (for Owner UI process)
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ($State) {
        $rules += New-Object System.Security.AccessControl.FileSystemAccessRule(
            $owner, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    }
    $acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
    foreach ($r in $rules) { $acl.AddAccessRule($r) }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

Write-AionLog 'Applying install root ACLs'
Set-ProtectedAcls -Path $InstallRoot
Write-AionLog 'Applying state root ACLs'
Set-ProtectedAcls -Path $StateRoot -State

# Tighten key files: remove Users if any
foreach ($sensitive in @($keyPath, $sessionKeyPath, $manifestPath)) {
    $acl = Get-Acl -LiteralPath $sensitive
    $acl.SetAccessRuleProtection($true, $false)
    $acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
    foreach ($id in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
            $id, 'FullControl', 'Allow')))
    }
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $owner, 'Read', 'Allow')))
    # LocalSystem service host needs key read
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        'NT AUTHORITY\SYSTEM', 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $sensitive -AclObject $acl
}

# Register service (LocalSystem for constrained elevated templates; no password stored)
$binPath = '"{0}"' -f (Join-Path $InstallRoot 'bin\aion-elevated-broker.exe')
Write-AionLog "Creating service $ServiceName binPath=$binPath"
$create = sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= 'AION Elevated Operator Broker'
Write-AionLog "sc create: $create"
sc.exe description $ServiceName 'AION constrained elevated operator broker — local named pipe only; no public listener' | Out-Null
# Prefer virtual service account when supported; fall back stays LocalSystem
$cfg = sc.exe config $ServiceName obj= 'LocalSystem'
Write-AionLog "sc config account: $cfg"

Write-AionLog 'Starting service'
Start-Service -Name $ServiceName
Start-Sleep -Seconds 3
$svc = Get-Service -Name $ServiceName
Write-AionLog "Service status=$($svc.Status)"

# Controlled restart proof
Write-AionLog 'Controlled service restart'
Restart-Service -Name $ServiceName -Force
Start-Sleep -Seconds 4
$svc2 = Get-Service -Name $ServiceName
Write-AionLog "Service status after restart=$($svc2.Status)"

if ($svc2.Status -ne 'Running') {
    throw "Service failed to run after install/restart: $($svc2.Status)"
}

# Result marker
$result = [ordered]@{
    ok              = $true
    serviceName     = $ServiceName
    serviceStatus   = "$($svc2.Status)"
    installRoot     = $InstallRoot
    stateRoot       = $StateRoot
    sourceHead      = $staging.sourceHead
    artifactVersion = $staging.artifactVersion
    installedAtUtc  = $manifest.installedAtUtc
    uacDisabled     = $false
    ownerPasswordStored = $false
}
$resultPath = Join-Path $StateRoot 'install-result.v1.json'
[IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-AionLog 'INSTALL_OK'
Write-Output ($result | ConvertTo-Json)
exit 0
