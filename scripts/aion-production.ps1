# AION production process control (R7 + mobile durability).
# Loopback + auto private LAN/Tailscale on port 31415.
# Usage: -Action start|stop|status|restart|ensure
#
# start/ensure launch outside the caller's process Job Object (WScript.Shell),
# so closing an agent shell or IDE task does not kill production.
[CmdletBinding()]
param(
  [ValidateSet('start','stop','status','restart','ensure','watch')]
  [string]$Action = 'status',
  [string]$RepositoryRoot = 'C:\AION-HQ',
  [int]$Port = 31415
)
$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $RepositoryRoot '.aion-local\production\aion.pid'
$logDir = Join-Path $RepositoryRoot '.aion-local\production'
$stdout = Join-Path $logDir 'aion.out.log'
$stderr = Join-Path $logDir 'aion.err.log'
$watchLog = Join-Path $logDir 'watchdog.log'
$lockFile = Join-Path $logDir 'ensure.lock'
$startedAtFile = Join-Path $logDir 'started-at.utc'
# Refuse kill/restart storms while a process is still booting or briefly busy.
$StartGraceSec = 90
$HealthRetries = 3
$HealthRetryDelayMs = 700
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Watch([string]$Message) {
  $line = "{0:u} {1}" -f (Get-Date).ToUniversalTime(), $Message
  Add-Content -LiteralPath $watchLog -Value $line -Encoding utf8 -ErrorAction SilentlyContinue
}

function Get-AionListeners {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
}

function Get-AionNodeProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match 'aion-command-center') }
}

function Get-AionProcess {
  if (Test-Path $pidFile) {
    $raw = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue)
    if ($raw -and $raw.Trim() -match '^\d+$') {
      $id = [int]$raw.Trim()
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p) { return $p }
    }
  }
  $cim = Get-AionNodeProcesses | Select-Object -First 1
  if ($cim) { return Get-Process -Id $cim.ProcessId -ErrorAction SilentlyContinue }
  return $null
}

function Test-AionHealthyOnce {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Test-AionHealthy {
  # Transient load / state lock must not trip CLEANUP_STALE.
  for ($i = 0; $i -lt $HealthRetries; $i++) {
    if (Test-AionHealthyOnce) { return $true }
    if ($i -lt ($HealthRetries - 1)) { Start-Sleep -Milliseconds $HealthRetryDelayMs }
  }
  return $false
}

function Get-ListenerAddresses {
  @(Get-AionListeners | Select-Object -ExpandProperty LocalAddress -Unique)
}

function Test-WithinStartGrace {
  if (-not (Test-Path $startedAtFile)) { return $false }
  try {
    $raw = (Get-Content $startedAtFile -Raw -ErrorAction SilentlyContinue).Trim()
    if (-not $raw) { return $false }
    $started = [datetime]::Parse($raw, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
    $age = ([datetime]::UtcNow - $started.ToUniversalTime()).TotalSeconds
    return ($age -ge 0 -and $age -lt $StartGraceSec)
  } catch { return $false }
}

function Write-StartedAt {
  Set-Content -LiteralPath $startedAtFile -Value ([datetime]::UtcNow.ToString('o')) -Encoding ascii
}

function Enter-EnsureLock {
  # Exclusive start/ensure lock so concurrent watchdog + agent ensure cannot thrash.
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    try {
      $fs = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $bytes = [System.Text.Encoding]::ASCII.GetBytes("$PID $(Get-Date -Format o)")
      $fs.SetLength(0)
      $fs.Write($bytes, 0, $bytes.Length)
      $fs.Flush()
      return $fs
    } catch {
      # Another ensure/start holds the lock — if already healthy, caller should exit OK.
      if ((Get-AionListeners) -and (Test-AionHealthyOnce)) { return $null }
      Start-Sleep -Milliseconds 400
    }
  }
  return $null
}

function Exit-EnsureLock($fs) {
  if ($null -eq $fs) { return }
  try { $fs.Close() } catch { }
  try { $fs.Dispose() } catch { }
  try { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue } catch { }
}

function Stop-AionAll {
  # Kill every production Command Center instance to prevent port races / duplicates.
  $ids = @()
  if (Test-Path $pidFile) {
    $raw = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue)
    if ($raw -and $raw.Trim() -match '^\d+$') { $ids += [int]$raw.Trim() }
  }
  foreach ($cim in Get-AionNodeProcesses) { $ids += [int]$cim.ProcessId }
  $ids = $ids | Select-Object -Unique
  foreach ($id in $ids) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Write-Host "STOPPED pid=$id"
  }
  if (-not $ids.Count) { Write-Host "NOT_RUNNING" }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  # Wait for port release
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-AionListeners)) { break }
    Start-Sleep -Milliseconds 250
  }
  return 0
}

function Start-AionDetached {
  $lock = Enter-EnsureLock
  if ($null -eq $lock) {
    if ((Get-AionListeners) -and (Test-AionHealthy)) {
      $p = Get-AionProcess
      Write-Host "ALREADY_RUNNING (lock-busy) pid=$(if($p){$p.Id}else{'?'})"
      Write-Watch "ALREADY_RUNNING_LOCK_BUSY"
      return 0
    }
    Write-Host "START_SKIPPED lock-busy"
    Write-Watch "START_SKIPPED lock-busy"
    return 1
  }
  try {
  # Already healthy: do not start a second process.
  if ((Get-AionListeners) -and (Test-AionHealthy)) {
    $p = Get-AionProcess
    $addrs = (Get-ListenerAddresses) -join ', '
    Write-Host "ALREADY_RUNNING pid=$(if($p){$p.Id}else{'?'}) port=$Port listeners=$addrs"
    return 0
  }

  # Listener/process exists but health failed: within start grace, do not kill (boot / load spike).
  $aliveNodes = @(Get-AionNodeProcesses)
  $listeners = @(Get-AionListeners)
  if (($aliveNodes.Count -gt 0 -or $listeners.Count -gt 0) -and (Test-WithinStartGrace)) {
    $p = Get-AionProcess
    Write-Host "START_GRACE hold pid=$(if($p){$p.Id}else{'?'}) (within ${StartGraceSec}s of last start)"
    Write-Watch "START_GRACE hold"
    return 0
  }

  # Process alive + listening but HTTP briefly unhealthy: soft wait before kill.
  if ($aliveNodes.Count -gt 0 -and $listeners.Count -gt 0) {
    Write-Host "SOFT_WAIT health-retry"
    Write-Watch "SOFT_WAIT"
    for ($i = 0; $i -lt 8; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-AionHealthy) {
        $p = Get-AionProcess
        $addrs = (Get-ListenerAddresses) -join ', '
        Write-Host "ALREADY_RUNNING after soft-wait pid=$(if($p){$p.Id}else{'?'}) listeners=$addrs"
        Write-Watch "RECOVERED_SOFT_WAIT"
        return 0
      }
    }
  }

  # Listener without health, or orphaned nodes: clear and start clean.
  if ((Get-AionListeners) -or (Get-AionNodeProcesses)) {
    Write-Host "CLEANUP_STALE"
    Write-Watch "CLEANUP_STALE"
    [void](Stop-AionAll)
    Start-Sleep -Seconds 1
  }

  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $node = if ($nodeCmd) { $nodeCmd.Source } else { 'C:\Program Files\nodejs\node.exe' }
  if (-not (Test-Path -LiteralPath $node)) {
    Write-Host "START_FAILED node not found"
    Write-Watch "START_FAILED node not found"
    return 1
  }

  # Optional fast build only if package dist is missing (avoid long start hangs).
  $distMarker = Join-Path $RepositoryRoot 'packages\local-assistant\dist\index.js'
  if (-not (Test-Path -LiteralPath $distMarker)) {
    Push-Location $RepositoryRoot
    try { & npm.cmd run aion:build --silent 2>$null | Out-Null } catch { }
    finally { Pop-Location }
  }

  # Rotate oversized logs (keep last ~1MB tail)
  foreach ($log in @($stdout, $stderr)) {
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
      $keep = Get-Content $log -Tail 2000 -ErrorAction SilentlyContinue
      Set-Content -LiteralPath $log -Value $keep -Encoding utf8
    }
  }

  Add-Content -LiteralPath $stdout -Value "`n---- start $(Get-Date -Format o) ----`n" -Encoding utf8
  Add-Content -LiteralPath $stderr -Value "`n---- start $(Get-Date -Format o) ----`n" -Encoding utf8

  # Detach via WScript.Shell so the process is NOT in the caller's Job Object
  # (agent shells / IDE tasks kill job children on exit — that was killing production).
  $arg = "/c start `"AION-Production`" /b `"$node`" `"$RepositoryRoot\apps\aion-command-center.mjs`" --port $Port >> `"$stdout`" 2>> `"$stderr`""
  $wsh = New-Object -ComObject WScript.Shell
  $wsh.CurrentDirectory = $RepositoryRoot
  [void]$wsh.Run("cmd.exe $arg", 0, $false)

  # Discover PID: wait for listener then match node process
  # Use single-shot health during boot wait (retries already slow enough).
  $found = $null
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 250
    if (-not (Get-AionListeners)) { continue }
    if (-not (Test-AionHealthyOnce)) { continue }
    $found = Get-AionNodeProcesses | Select-Object -First 1
    if ($found) { break }
  }

  if ($found -and (Test-AionHealthyOnce)) {
    Set-Content -LiteralPath $pidFile -Value $found.ProcessId -Encoding ascii
    Write-StartedAt
    $addrs = (Get-ListenerAddresses) -join ', '
    Write-Host "STARTED pid=$($found.ProcessId) port=$Port listeners=$addrs"
    Write-Watch "STARTED pid=$($found.ProcessId) listeners=$addrs"
    return 0
  }

  # Fallback: Start-Process when WScript path did not yield a healthy listener
  Write-Host "START_FALLBACK Start-Process"
  Write-Watch "START_FALLBACK"
  try {
    $psi = Start-Process -FilePath $node -ArgumentList @("`"$RepositoryRoot\apps\aion-command-center.mjs`"", "--port", "$Port") `
      -WorkingDirectory $RepositoryRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    for ($i = 0; $i -lt 50; $i++) {
      Start-Sleep -Milliseconds 250
      if ((Get-AionListeners) -and (Test-AionHealthyOnce)) {
        Set-Content -LiteralPath $pidFile -Value $psi.Id -Encoding ascii
        Write-StartedAt
        $addrs = (Get-ListenerAddresses) -join ', '
        Write-Host "STARTED pid=$($psi.Id) port=$Port listeners=$addrs (fallback)"
        Write-Watch "STARTED_FALLBACK pid=$($psi.Id)"
        return 0
      }
    }
  } catch {
    Write-Watch "START_FALLBACK_ERR $($_.Exception.Message)"
  }

  Write-Host "START_FAILED see $stderr"
  Write-Watch "START_FAILED"
  if (Test-Path $stderr) { Get-Content $stderr -Tail 20 | ForEach-Object { Write-Host $_ } }
  return 1
  } finally {
    Exit-EnsureLock $lock
  }
}

function Status-Aion {
  $listeners = @(Get-AionListeners)
  $p = Get-AionProcess
  $health = 'unreachable'
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
    $health = "HTTP $($r.StatusCode)"
  } catch { $health = 'unreachable' }
  $addrs = ($listeners | Select-Object -ExpandProperty LocalAddress -Unique) -join ', '
  Write-Host "listener=$($listeners.Count -gt 0) pid=$(if($p){$p.Id}else{'none'}) health=$health port=$Port addresses=$addrs"
  if (($listeners.Count -gt 0) -and ($health -eq 'HTTP 200')) { return 0 }
  return 1
}

function Ensure-Aion {
  if ((Get-AionListeners) -and (Test-AionHealthy)) {
    $p = Get-AionProcess
    Write-Host "ENSURE_OK pid=$(if($p){$p.Id}else{'?'})"
    return 0
  }
  # Live process in start grace: do not thrash (watchdog / concurrent ensure).
  $nodes = @(Get-AionNodeProcesses)
  if ($nodes.Count -gt 0 -and (Test-WithinStartGrace)) {
    $p = Get-AionProcess
    Write-Host "ENSURE_GRACE pid=$(if($p){$p.Id}else{'?'})"
    Write-Watch "ENSURE_GRACE"
    return 0
  }
  Write-Host "ENSURE_RECOVER"
  Write-Watch "ENSURE_RECOVER starting"
  return (Start-AionDetached)
}

function Watch-Aion([int]$IntervalSec = 45, [int]$MaxHours = 12) {
  # Lightweight durability loop: re-ensure production if health drops.
  # Does not redesign networking. Safe for overnight soak alongside heavy import.
  $deadline = (Get-Date).AddHours($MaxHours)
  Write-Host "WATCH_START interval=${IntervalSec}s until=$($deadline.ToString('u'))"
  Write-Watch "WATCH_START interval=$IntervalSec"
  while ((Get-Date) -lt $deadline) {
    try {
      if (-not ((Get-AionListeners) -and (Test-AionHealthy))) {
        Write-Host "WATCH_RECOVER $(Get-Date -Format o)"
        Write-Watch "WATCH_RECOVER"
        [void](Ensure-Aion)
      } else {
        $p = Get-AionProcess
        Write-Watch "WATCH_OK pid=$(if($p){$p.Id}else{'?'})"
      }
    } catch {
      Write-Watch "WATCH_ERR $($_.Exception.Message)"
    }
    Start-Sleep -Seconds ([Math]::Max(15, $IntervalSec))
  }
  Write-Host "WATCH_END"
  Write-Watch "WATCH_END"
  return 0
}

switch ($Action) {
  'start'   { exit (Start-AionDetached) }
  'stop'    { exit (Stop-AionAll) }
  'restart' { [void](Stop-AionAll); Start-Sleep -Seconds 1; exit (Start-AionDetached) }
  'status'  { exit (Status-Aion) }
  'ensure'  { exit (Ensure-Aion) }
  'watch'   { exit (Watch-Aion 30 12) }
}
