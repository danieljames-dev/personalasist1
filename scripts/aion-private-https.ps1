# AION private HTTPS over Tailscale Serve.
#
# Why this exists: Safari only exposes navigator.mediaDevices in a secure context. Reached over
# plain http on the tailnet IP, the object is absent, so the microphone button cannot work at all —
# no permission prompt, no error, nothing. Serving the same local AION over tailnet HTTPS is the
# fix, and it costs nothing.
#
# What this does NOT do, by design:
#   - no Funnel (that would publish AION to the internet)
#   - no router port forward
#   - no change to the Ollama localhost-only binding
#   - no change to the trusted-device auth boundary
#
# Serve is tailnet-only: reachable from the Owner's devices, invisible to the internet.
#
# PREREQUISITE, and it is the one thing a script cannot do:
#   HTTPS certificates must be enabled for the tailnet in the admin console. Until then
#   `tailscale cert` returns "your Tailscale account does not support getting TLS certs".
#
# Idempotent: re-running reports the existing configuration instead of stacking another.

[CmdletBinding()]
param(
  [int]$Port = 31415,
  [switch]$Status,
  [switch]$Off
)

$ErrorActionPreference = "Stop"
$tailscale = "C:\Program Files\Tailscale\tailscale.exe"

if (-not (Test-Path $tailscale)) {
  Write-Output "TAILSCALE_CLI = NOT_FOUND"
  exit 1
}

function Get-TailnetName {
  $json = & $tailscale status --json 2>$null | ConvertFrom-Json
  if (-not $json.Self.DNSName) { return $null }
  return $json.Self.DNSName.TrimEnd('.')
}

if ($Status) {
  $name = Get-TailnetName
  Write-Output "TAILNET_HOST = $name"
  & $tailscale serve status 2>&1 | ForEach-Object { Write-Output "SERVE: $_" }
  # Funnel state is reported every time. It must stay off, and silence is not evidence.
  & $tailscale funnel status 2>&1 | ForEach-Object { Write-Output "FUNNEL: $_" }
  exit 0
}

if ($Off) {
  & $tailscale serve --https=443 off 2>&1 | ForEach-Object { Write-Output $_ }
  Write-Output "SERVE_DISABLED = YES"
  exit 0
}

$host_name = Get-TailnetName
if (-not $host_name) {
  Write-Output "TAILSCALE_STATUS = NOT_CONNECTED"
  exit 1
}

# Certificates first: without them Serve cannot terminate TLS, and the failure is clearer here
# than three steps later.
Write-Output "Checking HTTPS certificate availability for $host_name ..."
# The CLI writes its refusal to stderr, which PowerShell would otherwise surface as a wall of red
# above the one line that matters. Capture it quietly and let the message below do the talking.
$ErrorActionPreference = "Continue"
$certText = (& $tailscale cert $host_name 2>&1 | Out-String)
$certExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"

if ($certText -match "does not support getting TLS certs") {
  Write-Output "HTTPS_CERTS = NOT_ENABLED"
  Write-Output "OWNER_ACTION_REQUIRED = Open the Tailscale admin console, go to DNS, and enable HTTPS Certificates for this tailnet."
  Write-Output "Then run this script again. Nothing else is needed."
  exit 2
}

if ($certExit -ne 0 -and $certText -notmatch "already") {
  Write-Output "HTTPS_CERTS = FAILED"
  Write-Output $certText
  exit 1
}

Write-Output "HTTPS_CERTS = OK"

# Tailnet-only HTTPS in front of the existing local service. Explicitly not Funnel.
& $tailscale serve --bg --https=443 "http://127.0.0.1:$Port" 2>&1 | ForEach-Object { Write-Output $_ }

Write-Output "SERVE_TARGET = http://127.0.0.1:$Port"
Write-Output "HTTPS_URL = https://$host_name/"
Write-Output "TAILSCALE_FUNNEL = OFF"
Write-Output "Open that URL on the iPhone. Safari will treat it as a secure context and the microphone will work."
