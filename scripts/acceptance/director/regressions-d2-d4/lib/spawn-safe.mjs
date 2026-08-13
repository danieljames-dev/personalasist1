/**
 * Director spawn contract: argv array, shell:false.
 * Prompt is a file path token, never interpolated into a shell string.
 */
import { spawn, spawnSync } from "node:child_process";

export function spawnSafe(executable, argv, opts = {}) {
  if (opts.shell === true) {
    throw new Error("shell:true is forbidden");
  }
  return spawn(executable, argv, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    windowsHide: true,
    shell: false,
    stdio: opts.stdio || ["ignore", "pipe", "pipe"],
  });
}

export function spawnSafeSync(executable, argv, opts = {}) {
  if (opts.shell === true) {
    throw new Error("shell:true is forbidden");
  }
  return spawnSync(executable, argv, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    timeout: opts.timeout ?? 20_000,
    maxBuffer: opts.maxBuffer ?? 2 * 1024 * 1024,
  });
}

/** Defective alternative: string-concatenated cmd.exe. Used only to prove the oracle bites. */
export function spawnDefectiveShell(commandLine, opts = {}) {
  return spawnSync(process.env.ComSpec || "cmd.exe", ["/c", commandLine], {
    cwd: opts.cwd,
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    timeout: opts.timeout ?? 15_000,
  });
}
