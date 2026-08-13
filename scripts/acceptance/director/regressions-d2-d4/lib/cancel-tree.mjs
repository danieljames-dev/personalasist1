/**
 * Cancel policy for Windows executor trees.
 *
 * child.kill() / TerminateProcess on the root does not reliably stop
 * grandchildren. Director must own a kill-on-close Job Object, then
 * escalate to TerminateJobObject.
 */
import { spawnSync } from "node:child_process";
import { spawnSafe } from "./spawn-safe.mjs";

export const CANCEL_SOFT_MS = 5_000;
export const CANCEL_HARD_MS = 10_000;

export function taskkillTree(pid) {
  return spawnSync("taskkill.exe", ["/T", "/F", "/PID", String(pid)], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
    shell: false,
  });
}

export function processAlive(pid) {
  const r = spawnSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    timeout: 8_000,
    windowsHide: true,
    shell: false,
  });
  const out = r.stdout || "";
  return out.includes(`"${pid}"`) || out.includes(`,${pid},`);
}

/**
 * Soft: ask the tracked root to exit (Node child.kill / CTRL-like terminate).
 * Hard: taskkill /T /F (oracle stand-in for TerminateJobObject).
 */
export async function cancelRun({ child, pid, softMs = CANCEL_SOFT_MS, hardMs = CANCEL_HARD_MS }) {
  const started = Date.now();
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  const softDeadline = Date.now() + softMs;
  while (Date.now() < softDeadline) {
    if (!processAlive(pid)) {
      return { stage: "SOFT", elapsedMs: Date.now() - started, alive: false };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  taskkillTree(pid);
  const hardDeadline = Date.now() + hardMs;
  while (Date.now() < hardDeadline) {
    if (!processAlive(pid)) {
      return { stage: "HARD", elapsedMs: Date.now() - started, alive: false };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { stage: "FAILED", elapsedMs: Date.now() - started, alive: processAlive(pid) };
}

export function spawnTracked(executable, argv, opts = {}) {
  const nonce = opts.runNonce || `aion-run-${Date.now()}`;
  const env = { ...(opts.env || {}), AION_RUN_NONCE: nonce };
  const child = spawnSafe(executable, argv, { ...opts, env });
  return { child, nonce };
}
