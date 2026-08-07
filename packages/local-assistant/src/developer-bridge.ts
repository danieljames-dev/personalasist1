import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import type { DeveloperAgentBridgeV1 } from "./contracts.js";

/**
 * Bounded adapter over a locally installed Codex CLI.
 *
 * The executable is supplied by the composition root as an explicit absolute path or bare
 * command name; this adapter never searches the computer and never uses a shell, so instruction
 * text is passed as an argument vector and can never be interpreted as a command. Every run is
 * confined to the one approved repository root.
 */
export class CodexCliDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  private cached: { at: number; status: { available: boolean; executable: string | null; detail: string } } | null = null;
  constructor(private readonly approvedRepositoryRoot: string, private readonly executable = process.platform === "win32" ? "codex.exe" : "codex") {
    if (!isAbsolute(approvedRepositoryRoot) || resolve(approvedRepositoryRoot) !== approvedRepositoryRoot) throw new Error("Developer-agent repository root must be explicit and normalized.");
    if (!this.executable.trim() || this.executable.includes("\0")) throw new Error("Developer-agent executable must be explicit.");
  }
  private invoke(args: string[], signal?: AbortSignal): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(this.executable, args, { cwd: this.approvedRepositoryRoot, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = ""; const limit = 1024 * 1024;
      const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-limit);
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); }); child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const abort = () => child.kill(); signal?.addEventListener("abort", abort, { once: true });
      child.once("error", reject); child.once("close", (code) => { signal?.removeEventListener("abort", abort); resolveResult({ exitCode: code ?? -1, stdout, stderr }); });
    });
  }
  /** A narrow local `--version` probe. It starts no task and makes no model call. Cached briefly. */
  async status(): Promise<{ available: boolean; executable: string | null; detail: string }> {
    if (this.cached && Date.now() - this.cached.at < 60_000) return this.cached.status;
    let status: { available: boolean; executable: string | null; detail: string };
    try {
      const result = await this.invoke(["--version"]);
      status = result.exitCode === 0
        ? { available: true, executable: this.executable, detail: `Codex CLI is available (${result.stdout.trim().slice(0, 120) || "version reported"}). Tasks are confined to the approved repository root and require approval.` }
        : { available: false, executable: null, detail: "The Codex CLI executable was found but its availability check failed." };
    } catch { status = { available: false, executable: null, detail: "No supported local developer-agent executable is available." }; }
    this.cached = { at: Date.now(), status };
    return status;
  }
  async run(task: { repositoryRoot: string; instruction: string }, signal: AbortSignal): Promise<{ exitCode: number; summary: string }> {
    if (resolve(task.repositoryRoot) !== this.approvedRepositoryRoot || !task.instruction.trim() || task.instruction.length > 8000) throw new Error("Developer-agent task is outside the approved boundary.");
    const result = await this.invoke(["exec", "--cd", this.approvedRepositoryRoot, "--sandbox", "workspace-write", "--json", task.instruction], signal);
    return { exitCode: result.exitCode, summary: (result.stdout || result.stderr || "Codex CLI returned no output.").slice(-20_000) };
  }
}
