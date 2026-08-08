import { spawn } from "node:child_process";
import { basename, isAbsolute, resolve } from "node:path";
import type { DeveloperAgentBridgeV1, DeveloperAgentModeV1, DeveloperAgentStatusV1 } from "./contracts.js";

const OUTPUT_LIMIT = 1024 * 1024;
const SUMMARY_LIMIT = 20_000;
const PROBE_TIMEOUT_MS = 30_000;
const TASK_TIMEOUT_MS = 600_000;
const STATUS_CACHE_MS = 60_000;
const MAX_INSTRUCTION = 4000;
/** Everything below space except tab, newline, and carriage return, plus delete. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

interface ProcessResultV1 { exitCode: number; stdout: string; stderr: string; timedOut: boolean }

/**
 * Shared, bounded adapter over a locally installed developer-agent CLI.
 *
 * The executable is supplied by the composition root as an explicit absolute path or bare command
 * name; this module never searches the computer and never uses a shell. Instruction text is
 * written to the child's standard input and never appears in the argument vector, so no part of a
 * task can be read as a flag, a path, or shell syntax. Every run is confined to one approved
 * repository root, has a timeout, and honours cancellation.
 */
abstract class LocalCliDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly modes: readonly DeveloperAgentModeV1[];
  private cached: { at: number; withAccount: boolean; status: DeveloperAgentStatusV1 } | null = null;

  protected constructor(protected readonly approvedRepositoryRoot: string, protected readonly executable: string) {
    if (!isAbsolute(approvedRepositoryRoot) || resolve(approvedRepositoryRoot) !== approvedRepositoryRoot) throw new Error("Developer-agent repository root must be explicit and normalized.");
    if (!executable.trim() || executable.includes("\0") || CONTROL_CHARACTERS.test(executable) || /[\r\n]/u.test(executable)) throw new Error("Developer-agent executable must be explicit.");
  }

  /** Only the executable's file name is ever reported; a full local path identifies the owner. */
  protected get executableName(): string { return basename(this.executable); }

  protected invoke(args: readonly string[], options: { input?: string; signal?: AbortSignal; timeoutMs: number }): Promise<ProcessResultV1> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(this.executable, [...args], { cwd: this.approvedRepositoryRoot, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = ""; let stderr = ""; let timedOut = false; let settled = false;
      const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-OUTPUT_LIMIT);
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.stdin.on("error", () => { /* the child may exit before it reads its instruction */ });
      child.stdin.end(options.input ?? "", "utf8");
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
      const abort = () => child.kill();
      options.signal?.addEventListener("abort", abort, { once: true });
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
      child.once("error", (error) => { if (settled) return; settled = true; finish(); reject(error); });
      child.once("close", (code) => { if (settled) return; settled = true; finish(); resolveResult({ exitCode: code ?? -1, stdout, stderr, timedOut }); });
    });
  }

  /** Arguments that ask the CLI for its own version. This starts no task and makes no model call. */
  protected abstract versionArgs(): readonly string[];
  /** Arguments that report local sign-in state. No paid model call, and no account value is kept. */
  protected abstract accountArgs(): readonly string[];
  protected abstract readAccount(result: ProcessResultV1): DeveloperAgentStatusV1["account"];
  /** The complete argument vector for one bounded task. The instruction is never one of them. */
  protected abstract taskArgs(mode: DeveloperAgentModeV1): readonly string[];

  async status(options: { includeAccount?: boolean } = {}): Promise<DeveloperAgentStatusV1> {
    const includeAccount = options.includeAccount === true;
    const cached = this.cached;
    if (cached && Date.now() - cached.at < STATUS_CACHE_MS && (cached.withAccount || !includeAccount)) return cached.status;
    const base: DeveloperAgentStatusV1 = {
      bridgeId: this.id, displayName: this.displayName, available: false, executable: null, version: null,
      account: "not-checked", accountDetail: ACCOUNT_DETAIL["not-checked"], detail: "", modes: this.modes,
    };
    let status: DeveloperAgentStatusV1;
    try {
      const result = await this.invoke(this.versionArgs(), { timeoutMs: PROBE_TIMEOUT_MS });
      status = result.exitCode === 0 && !result.timedOut
        ? { ...base, available: true, executable: this.executableName, version: version(result.stdout || result.stderr), detail: `${this.displayName} is installed. Tasks are confined to the approved repository root, require an approval, and default to read-only.` }
        : { ...base, detail: `The ${this.displayName} executable was found but did not answer its local version check.` };
    } catch {
      status = { ...base, detail: `No ${this.displayName} executable is available on this computer.` };
    }
    if (includeAccount && status.available) {
      try {
        const result = await this.invoke(this.accountArgs(), { timeoutMs: PROBE_TIMEOUT_MS });
        const account = result.timedOut ? "unknown" : this.readAccount(result);
        status = { ...status, account, accountDetail: ACCOUNT_DETAIL[account] };
      } catch { status = { ...status, account: "unknown", accountDetail: ACCOUNT_DETAIL.unknown }; }
    } else if (includeAccount) {
      // Executable never answered — account was not inspected, so do not imply a probe result.
      status = {
        ...status,
        account: "not-checked",
        accountDetail: "Account health was not checked because the developer-agent executable is unavailable.",
      };
    }
    this.cached = { at: Date.now(), withAccount: includeAccount, status };
    return status;
  }

  describe(mode: DeveloperAgentModeV1): { executable: string; args: readonly string[] } {
    if (!this.modes.includes(mode)) return { executable: this.executableName, args: [] };
    return { executable: this.executableName, args: this.taskArgs(mode).map((arg) => arg === this.approvedRepositoryRoot ? "[approved repository root]" : arg) };
  }

  async run(task: { repositoryRoot: string; instruction: string; mode: DeveloperAgentModeV1 }, signal: AbortSignal): Promise<{ exitCode: number; summary: string }> {
    if (resolve(task.repositoryRoot) !== this.approvedRepositoryRoot) throw new Error("Developer-agent task is outside the approved repository root.");
    if (!this.modes.includes(task.mode)) throw new Error("Developer-agent task mode is not supported by this bridge.");
    const instruction = task.instruction;
    if (!instruction.trim() || instruction.length > MAX_INSTRUCTION) throw new Error("Developer-agent instruction is invalid.");
    if (CONTROL_CHARACTERS.test(instruction)) throw new Error("Developer-agent instruction contains control characters.");
    const result = await this.invoke(this.taskArgs(task.mode), { input: `${instruction}\n`, signal, timeoutMs: TASK_TIMEOUT_MS });
    if (result.timedOut) throw new Error("Developer-agent task exceeded its timeout and was stopped.");
    return { exitCode: result.exitCode, summary: (result.stdout || result.stderr || `${this.displayName} returned no output.`).slice(-SUMMARY_LIMIT) };
  }
}

const ACCOUNT_DETAIL: Record<DeveloperAgentStatusV1["account"], string> = {
  "not-checked": "Account health has not been checked. AION checks it only when you ask, and never by making a paid call.",
  "signed-in": "Signed in on this computer. Remaining credit or quota is not shown, because determining it would require a paid call.",
  "signed-out": "The executable is installed but no account is signed in, so a task would fail. Sign in with the vendor's own CLI first.",
  unknown: "The account check did not return a usable answer, so sign-in state is unknown. Treat the bridge as unproven.",
};

/** A short, non-identifying first line: a version banner, never an account value or a local path. */
function version(output: string): string | null {
  const line = output.split(/\r?\n/u).map((entry) => entry.trim()).find(Boolean);
  return line ? line.replace(/[A-Za-z]:[\\/][^\s"'<>|]*/gu, "[local path]").slice(0, 120) : null;
}

/**
 * Codex CLI. `codex exec` reads its instructions from standard input when the prompt argument is
 * `-`, so the owner's task text never enters the argument vector.
 */
export class CodexCliDeveloperAgentBridgeV1 extends LocalCliDeveloperAgentBridgeV1 {
  readonly id = "codex";
  readonly displayName = "Codex CLI";
  readonly modes: readonly DeveloperAgentModeV1[] = ["read-only", "workspace-write"];
  constructor(approvedRepositoryRoot: string, executable = process.platform === "win32" ? "codex.exe" : "codex") {
    super(approvedRepositoryRoot, executable);
  }
  protected versionArgs(): readonly string[] { return ["--version"]; }
  protected accountArgs(): readonly string[] { return ["login", "status"]; }
  protected readAccount(result: ProcessResultV1): DeveloperAgentStatusV1["account"] {
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (/not logged in|no credentials|run .{0,20}login/u.test(text)) return "signed-out";
    if (result.exitCode === 0 && text.includes("logged in")) return "signed-in";
    return result.exitCode === 0 ? "unknown" : "signed-out";
  }
  protected taskArgs(mode: DeveloperAgentModeV1): readonly string[] {
    return ["exec", "--cd", this.approvedRepositoryRoot, "--sandbox", mode, "--json", "-"];
  }
}

/**
 * Claude Code CLI. `-p` runs one non-interactive turn and reads the prompt from standard input, so
 * the owner's task text never enters the argument vector either. A read-only task is restricted
 * three ways at once — planning permission mode, an explicit read-only built-in tool set, and an
 * explicit denial of the writing tools — and configured MCP servers are excluded from every task.
 */
export class ClaudeCodeCliDeveloperAgentBridgeV1 extends LocalCliDeveloperAgentBridgeV1 {
  readonly id = "claude-code";
  readonly displayName = "Claude Code CLI";
  readonly modes: readonly DeveloperAgentModeV1[] = ["read-only", "workspace-write"];
  constructor(approvedRepositoryRoot: string, executable = process.platform === "win32" ? "claude.exe" : "claude") {
    super(approvedRepositoryRoot, executable);
  }
  protected versionArgs(): readonly string[] { return ["--version"]; }
  protected accountArgs(): readonly string[] { return ["auth", "status", "--json"]; }
  /**
   * Only the sign-in flag is read. The account payload also carries an address and an organisation
   * identifier; neither is parsed, stored, logged, displayed, or placed in a backup.
   */
  protected readAccount(result: ProcessResultV1): DeveloperAgentStatusV1["account"] {
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      const loggedIn = (parsed as { loggedIn?: unknown } | null)?.loggedIn;
      if (typeof loggedIn === "boolean") return loggedIn ? "signed-in" : "signed-out";
    } catch { /* fall through to the exit-status reading below */ }
    return result.exitCode === 0 ? "unknown" : "signed-out";
  }
  protected taskArgs(mode: DeveloperAgentModeV1): readonly string[] {
    const shared = ["-p", "--output-format", "text", "--strict-mcp-config", "--no-session-persistence"];
    return mode === "read-only"
      ? [...shared, "--permission-mode", "plan", "--tools", "Read,Glob,Grep", "--disallowed-tools", "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch"]
      : [...shared, "--permission-mode", "acceptEdits", "--tools", "Read,Glob,Grep,Edit,Write,Bash", "--disallowed-tools", "WebFetch,WebSearch"];
  }
}
