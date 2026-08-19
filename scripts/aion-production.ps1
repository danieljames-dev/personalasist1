# AION production process control (R7 + mobile durability).
# Loopback + auto private LAN/Tailscale on port 31415.
# Usage: -Action start|stop|status|restart|ensure
#
# start/ensure launch outside the caller's process Job Object via Task Scheduler
# (Register-ScheduledTask), with WScript.Run fallback — so agent shell exit
# does not kill production. Never RedirectStandardOutput on the primary process.
[CmdletBinding()]
param(
  [ValidateSet('start','stop','status','restart','ensure','watch')]
  [string]$Action = 'status',
  [string]$RepositoryRoot = 'C:\AION-HQ',
  [int]$Port = 31415
)
$ErrorActionPreference = 'Stop'

# Validate the root before anything else happens.
#
# This is the first executable statement on purpose. Every later line either derives a path from
# $RepositoryRoot, stops a running service, or writes a Scheduled Task — and a malformed root that
# gets past this point becomes durable Windows configuration that outlives the session. An invalid
# root must cost nothing: no service stopped, no task registered, no file written.
. (Join-Path $PSScriptRoot 'aion-repository-root.ps1')
try {
  $RepositoryRoot = Assert-AionRepositoryRoot -Path $RepositoryRoot
} catch {
  # Written straight to stderr rather than through Write-Error: with $ErrorActionPreference = 'Stop'
  # a Write-Error terminates the script immediately and powershell.exe returns 1, which is
  # indistinguishable from an ordinary failure. Exit 2 means specifically "the root was rejected and
  # nothing was touched", and callers can act on that.
  Write-Host "INVALID_REPOSITORY_ROOT $($_.Exception.Message)"
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}

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
    Write-Watch "ALREADY_RUNNING pid=$(if($p){$p.Id}else{'?'})"
    return 0
  }

  # CRITICAL: if aion-command-center is alive AND port is listening, never kill it
  # for a transient HTTP failure (dual-writer load / long request). Watchdog must
  # not become the normal kill path.
  $aliveNodes = @(Get-AionNodeProcesses)
  $listeners = @(Get-AionListeners)
  if ($aliveNodes.Count -gt 0 -and $listeners.Count -gt 0) {
    $p = Get-AionProcess
    if (Test-WithinStartGrace) {
      Write-Host "START_GRACE hold pid=$(if($p){$p.Id}else{'?'}) (within ${StartGraceSec}s of last start)"
      Write-Watch "START_GRACE hold"
      return 0
    }
    Write-Host "SOFT_WAIT health-retry (alive+listen - will NOT kill)"
    Write-Watch "SOFT_WAIT alive_listen"
    for ($i = 0; $i -lt 12; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-AionHealthy) {
        $addrs = (Get-ListenerAddresses) -join ', '
        Write-Host "ALREADY_RUNNING after soft-wait pid=$(if($p){$p.Id}else{'?'}) listeners=$addrs"
        Write-Watch "RECOVERED_SOFT_WAIT"
        return 0
      }
    }
    # Still unhealthy but process owns the port - hold, do not CLEANUP_STALE.
    Write-Host "HOLD_ALIVE_DEGRADED pid=$(if($p){$p.Id}else{'?'}) - process alive + port listen; refusing kill"
    Write-Watch "HOLD_ALIVE_DEGRADED pid=$(if($p){$p.Id}else{'?'})"
    return 0
  }

  # Only clean up when process is dead or port is free (true stale).
  if ((Get-AionListeners) -or (Get-AionNodeProcesses)) {
    Write-Host "CLEANUP_STALE (no healthy alive+listen pair)"
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

  # Durable detach OUTSIDE agent Job Objects.
  # Evidence (process.log): children started under agent shells die with NO EXIT/handler
  # (Job Object / short-lived redirected parent kill). Prefer Task Scheduler ownership.
  # NOTE: schtasks /TR breaks on "Program Files" quoting; use Register-ScheduledTask.
  $cc = Join-Path $RepositoryRoot 'apps\aion-command-center.mjs'
  $launchTask = 'AION-Production-Launch'
  $launched = $false
  try {
    Stop-ScheduledTask -TaskName $launchTask -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $launchTask -Confirm:$false -ErrorAction SilentlyContinue
    # ArgumentList-style: quoted script path + port (path may contain spaces)
    $taskArg = "`"$cc`" --port $Port"
    $action = New-ScheduledTaskAction -Execute $node -Argument $taskArg -WorkingDirectory $RepositoryRoot
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 0
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $launchTask -Action $action -Settings $settings -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName $launchTask
    $launched = $true
    Write-Watch "LAUNCH_TASK_START ok"
    Write-Host "START_SCHEDULED_TASK $launchTask"
  } catch {
    Write-Watch "LAUNCH_TASK_ERR $($_.Exception.Message)"
    Write-Host "LAUNCH_TASK_ERR $($_.Exception.Message)"
  }

  # Discover PID: wait for listener then match node process
  $found = $null
  if ($launched) {
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Milliseconds 250
      if (-not (Get-AionListeners)) { continue }
      if (-not (Test-AionHealthyOnce)) { continue }
      $found = Get-AionNodeProcesses | Select-Object -First 1
      if ($found) { break }
    }
  }

  if ($found -and (Test-AionHealthyOnce)) {
    Set-Content -LiteralPath $pidFile -Value $found.ProcessId -Encoding ascii
    Write-StartedAt
    $addrs = (Get-ListenerAddresses) -join ', '
    Write-Host "STARTED pid=$($found.ProcessId) port=$Port listeners=$addrs (scheduled-task)"
    Write-Watch "STARTED_TASK pid=$($found.ProcessId) listeners=$addrs"
    return 0
  }

  # Fallback: WScript.Run without redirect (outside many job objects; no stdio pipes)
  Write-Host "START_FALLBACK WScript.Run"
  Write-Watch "START_FALLBACK_WScript"
  try {
    $wsh = New-Object -ComObject WScript.Shell
    $wsh.CurrentDirectory = $RepositoryRoot
    [void]$wsh.Run("`"$node`" `"$cc`" --port $Port", 0, $false)
    for ($i = 0; $i -lt 50; $i++) {
      Start-Sleep -Milliseconds 250
      if ((Get-AionListeners) -and (Test-AionHealthyOnce)) {
        $found = Get-AionNodeProcesses | Select-Object -First 1
        if ($found) {
          Set-Content -LiteralPath $pidFile -Value $found.ProcessId -Encoding ascii
          Write-StartedAt
          $addrs = (Get-ListenerAddresses) -join ', '
          Write-Host "STARTED pid=$($found.ProcessId) port=$Port listeners=$addrs (wscript)"
          Write-Watch "STARTED_WSCRIPT pid=$($found.ProcessId)"
          return 0
        }
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
  # Live process + listener: never recover-kill; optional soft health retry only.
  $nodes = @(Get-AionNodeProcesses)
  $listeners = @(Get-AionListeners)
  if ($nodes.Count -gt 0 -and $listeners.Count -gt 0) {
    $p = Get-AionProcess
    if (Test-WithinStartGrace) {
      Write-Host "ENSURE_GRACE pid=$(if($p){$p.Id}else{'?'})"
      Write-Watch "ENSURE_GRACE"
      return 0
    }
    if (Test-AionHealthy) {
      Write-Host "ENSURE_OK pid=$(if($p){$p.Id}else{'?'})"
      return 0
    }
    Write-Host "ENSURE_HOLD_DEGRADED pid=$(if($p){$p.Id}else{'?'}) (alive+listen)"
    Write-Watch "ENSURE_HOLD_DEGRADED pid=$(if($p){$p.Id}else{'?'})"
    return 0
  }
  # True down: no listener or no process
  Write-Host "ENSURE_RECOVER"
  Write-Watch "ENSURE_RECOVER starting reason=down nodes=$($nodes.Count) listeners=$($listeners.Count)"
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
