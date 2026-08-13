/**
 * Windows process ownership: PID is not enough.
 * Identity = pid + creation time + executable path + run nonce.
 */
import { spawnSync } from "node:child_process";

export function queryProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, reason: "bad-pid" };
  const ps = [
    "$p = Get-CimInstance Win32_Process -Filter \"ProcessId=" + pid + "\" -ErrorAction SilentlyContinue;",
    "if (-not $p) { Write-Output '{\"ok\":false,\"reason\":\"not-found\"}'; exit 0 }",
    "$o = [ordered]@{ ok = $true; pid = [int]$p.ProcessId; name = $p.Name; executablePath = $p.ExecutablePath; commandLine = $p.CommandLine; creationDate = $p.CreationDate.ToString('o'); parentPid = [int]$p.ParentProcessId };",
    "$o | ConvertTo-Json -Compress",
  ].join(" ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    shell: false,
  });
  try {
    return JSON.parse((r.stdout || "").trim() || "{\"ok\":false}");
  } catch {
    return { ok: false, reason: "parse", raw: (r.stdout || r.stderr || "").slice(0, 400) };
  }
}

export function identitiesMatch(expected, observed) {
  if (!expected || !observed?.ok) return { ok: false, reason: "missing-observation" };
  if (expected.pid !== observed.pid) return { ok: false, reason: "pid-mismatch" };
  if (expected.creationDate && observed.creationDate && expected.creationDate !== observed.creationDate) {
    return { ok: false, reason: "pid-reuse-creation-mismatch" };
  }
  if (expected.executablePath && observed.executablePath) {
    const a = String(expected.executablePath).toLowerCase();
    const b = String(observed.executablePath).toLowerCase();
    if (a !== b) return { ok: false, reason: "exe-mismatch" };
  }
  return { ok: true };
}

export function commandLineHasNonce(commandLine, runNonce) {
  return Boolean(runNonce) && String(commandLine || "").includes(runNonce);
}

export function recordFromObservation(obs, runNonce) {
  return {
    pid: obs.pid,
    creationDate: obs.creationDate,
    executablePath: obs.executablePath,
    runNonce,
    parentPid: obs.parentPid,
  };
}
