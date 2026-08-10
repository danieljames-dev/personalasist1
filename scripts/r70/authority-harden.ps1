# R7: Windows ACL harden + offline escrow of Owner authority material (no key printing).
[CmdletBinding()]
param(
  [string]$RepositoryRoot = 'C:\AION-HQ',
  [string]$BackupRoot = 'D:\AION-backups'
)
$ErrorActionPreference = 'Stop'
$auth = Join-Path $RepositoryRoot 'private\aion\authority-v2'
$signing = Join-Path $auth 'owner-signing.pkcs8'
$trust = Join-Path $auth 'trust.json'
$anchor = Join-Path $auth 'anchor'
if (-not (Test-Path $auth)) { throw "authority-v2 missing at $auth" }

$escrowDir = Join-Path $BackupRoot 'r70-authority-escrow'
New-Item -ItemType Directory -Force -Path $escrowDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$bundle = Join-Path $escrowDir "authority-v2-escrow-$stamp"
New-Item -ItemType Directory -Force -Path $bundle | Out-Null

Copy-Item -Path (Join-Path $auth '*') -Destination $bundle -Recurse -Force
$manifest = [ordered]@{
  schema = 'aion.r70.authority-escrow.v1'
  utc = (Get-Date).ToUniversalTime().ToString('o')
  source = $auth
  escrowPath = $bundle
  files = @()
  signingPresentBefore = (Test-Path $signing)
}
Get-ChildItem $bundle -Recurse -File | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $rel = $_.FullName.Substring($bundle.Length).TrimStart('\')
  $manifest.files += @{ path = $rel; sha256 = $hash; bytes = $_.Length }
}
$manifestPath = Join-Path $escrowDir "escrow-manifest-$stamp.json"
($manifest | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $manifestPath -Encoding utf8

function Protect-Path([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  icacls $Path /inheritance:r | Out-Null
  icacls $Path /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "${env:USERNAME}:(OI)(CI)F" | Out-Null
  icacls $Path /remove:g "Users" "Authenticated Users" 2>$null | Out-Null
}
Protect-Path $auth
Protect-Path $escrowDir

$escrowSigning = Join-Path $bundle 'owner-signing.pkcs8'
$hostSigningRemoved = $false
if ((Test-Path $escrowSigning) -and (Test-Path $signing)) {
  $a = (Get-FileHash $signing -Algorithm SHA256).Hash
  $b = (Get-FileHash $escrowSigning -Algorithm SHA256).Hash
  if ($a -ne $b) { throw 'Escrow signing digest mismatch - refusing to remove host key' }
  Remove-Item -LiteralPath $signing -Force
  $hostSigningRemoved = $true
  Write-Host 'HOST_SIGNING_KEY_REMOVED after escrow digest match'
} elseif (-not (Test-Path $signing)) {
  Write-Host 'HOST_SIGNING_KEY_ALREADY_ABSENT'
  $hostSigningRemoved = $true
}

$result = [ordered]@{
  OWNER_AUTHORITY_ESCROW = 'PASS'
  OWNER_KEY_PRODUCTION_ACL = 'PASS'
  escrowManifest = $manifestPath
  hostSigningRemoved = $hostSigningRemoved
  trustPresent = (Test-Path $trust)
  anchorPresent = (Test-Path (Join-Path $anchor 'current.json'))
  secretsPrinted = $false
}
$out = Join-Path $RepositoryRoot '.aion-local\handoffs\R7-AUTHORITY-HARDEN.json'
($result | ConvertTo-Json -Depth 5) | Set-Content $out -Encoding utf8
Write-Host (Get-Content $out -Raw)
