/**
 * Building the argv that actually launches an executor.
 *
 * The prompt is a file. Its bytes never appear in a command line. That is the whole reason this
 * module exists rather than a template string: retrieved text, previous executor output, and
 * whatever was lifted off a photograph must not become part of argv, because argv is what a
 * process listing — and a shell, if one were ever reintroduced — would see.
 *
 * The flag lists below were measured on this host against Grok 1.0.3 and Claude 2.1.232. They are
 * not a guess at a common subset, and they are not negotiable against a later `--help` dump that
 * looks similar.
 *
 * Discovery (which binary) lives next door. Spawning lives in the run manager. This module answers
 * only: given a prompt path, a working directory and a run nonce, what exact argv and child
 * environment does this executor take?
 */
import { statSync } from "node:fs";
import { CONTROL_BYTES } from "./control-bytes.js";
import { isExecutorRole, NON_WRITING_ROLES, type ExecutorNameV1, type ExecutorRoleV1 } from "./executors.js";
import { isResolvedHostPath } from "./host-path.js";

/**
 * Grok 1.0.3 turn cap used by the Director. Measured as the `--max-turns` flag; the number is a
 * Director policy, not a vendor default.
 */
export const GROK_MAX_TURNS = 50;

/** Child-environment key for the run nonce. The nonce must not appear on the command line. */
export const RUN_NONCE_ENV = "AION_RUN_NONCE";

/** Claude 2.1.231, unauthenticated. Distinct from a crash and from a failed work item. */
const CLAUDE_NOT_LOGGED_IN = "Not logged in · Please run /login";

export interface AdapterInputV1 {
  readonly promptPath: string;
  readonly cwd: string;
  readonly runNonce: string;
  /** Enumerated role. Unknown values are a refusal, never the implementer default. */
  readonly role?: ExecutorRoleV1;
}

export type AdapterRefusalCodeV1 =
  | "MISSING_CWD"
  | "MISSING_PROMPT"
  | "EMPTY_NONCE"
  | "INVALID_ROLE"
  | "NOT_IMPLEMENTED";

export interface AdapterLaunchV1 {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly promptPath: string;
  /** Always false. Stated here so a test can assert it rather than trust a call site. */
  readonly shell: false;
}

export type AdapterResultV1 =
  | { readonly ok: true; readonly reason: string; readonly launch: AdapterLaunchV1 }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly code: AdapterRefusalCodeV1;
      readonly launch: AdapterLaunchV1 | null;
    };

export type ExecutorExitKindV1 = "COMPLETED" | "FAILED" | "EXECUTOR_UNAVAILABLE";

export type ExecutorExitInterpretationV1 =
  | { readonly kind: "COMPLETED"; readonly exitCode: number }
  | { readonly kind: "FAILED"; readonly exitCode: number }
  | {
      readonly kind: "EXECUTOR_UNAVAILABLE";
      readonly code: "NOT_LOGGED_IN" | "NOT_IMPLEMENTED";
      readonly reason: string;
    };

export interface ExecutorAdapterV1 {
  readonly name: ExecutorNameV1;
  build(input: AdapterInputV1): AdapterResultV1;
  classifyExit(exitCode: number, output: string): ExecutorExitInterpretationV1;
}

export function allExecutorAdapters(): readonly ExecutorAdapterV1[] {
  return Object.values(EXECUTOR_ADAPTERS);
}

export function adapterNamed(name: ExecutorNameV1): ExecutorAdapterV1 {
  return EXECUTOR_ADAPTERS[name];
}

export function buildExecutorLaunch(
  name: ExecutorNameV1,
  input: AdapterInputV1,
): AdapterResultV1 {
  return EXECUTOR_ADAPTERS[name].build(input);
}

/**
 * The one argv spelling. `buildExecutorLaunch` validates then returns this
 * list. `executeRun` re-checks the request against it so a file-URL import
 * cannot spawn an arbitrary command.
 */
/** Permission mode the Grok write-role adapter emits. One spelling. */
export const GROK_WRITE_PERMISSION_MODE = "bypassPermissions" as const;

/** Flag the Grok write-role adapter emits. One spelling. */
export const GROK_WRITE_ALWAYS_APPROVE_FLAG = "--always-approve" as const;

/**
 * Whether `argv` actually handed the child the write-permission tokens this
 * adapter emits for write roles. A caller-supplied role label is not this fact.
 */
export function argvGrantsWritePermission(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--permission-mode" && argv[i + 1] === GROK_WRITE_PERMISSION_MODE) {
      return true;
    }
  }
  return argv.includes(GROK_WRITE_ALWAYS_APPROVE_FLAG);
}

export function executorArgvFor(
  name: ExecutorNameV1,
  input: Pick<AdapterInputV1, "promptPath" | "cwd" | "role">,
): readonly string[] | null {
  if (name === "local") return null;
  if (name === "claude") {
    // Claude 2.1.232 (Claude Code), measured 2026-08-15 against
    // C:\Users\User\.vscode\extensions\anthropic.claude-code-2.1.232-win32-x64\resources\native-binary\claude.exe
    // `--version` → `2.1.232 (Claude Code)`.
    // `--help` (verbatim facts):
    //   Usage: claude [options] [command] [prompt]
    //   -p, --print  Print response and exit (useful for pipes). Boolean; does
    //     not consume the following token.
    //   prompt  (Arguments) Your prompt. A positional, not a file path.
    //   --permission-mode <mode>  choices: acceptEdits|auto|bypassPermissions|manual|dontAsk|plan
    // There is no `--prompt-file`. `claude -p C:\wt\PROMPT.md` therefore
    // hands Claude the literal path string as its entire prompt.
    // The user prompt is delivered on stdin (stdio pipe). Write roles
    // carry an explicit `--permission-mode bypassPermissions`; review
    // roles carry `dontAsk`. The prompt path is not an argv element.
    const reviewOnly = input.role !== undefined && NON_WRITING_ROLES.has(input.role);
    const permissionMode = reviewOnly ? "dontAsk" : GROK_WRITE_PERMISSION_MODE;
    return ["-p", "--permission-mode", permissionMode];
  }
  const reviewOnly = input.role !== undefined && NON_WRITING_ROLES.has(input.role);
  const permissionMode = reviewOnly ? "dontAsk" : GROK_WRITE_PERMISSION_MODE;
  return [
    "--prompt-file", input.promptPath,
    "--cwd", input.cwd,
    "--permission-mode", permissionMode,
    ...(reviewOnly ? [] : [GROK_WRITE_ALWAYS_APPROVE_FLAG]),
    "--no-plan",
    "--max-turns", String(GROK_MAX_TURNS),
  ];
}

export function classifyExecutorExit(
  name: ExecutorNameV1,
  exitCode: number,
  output: string,
): ExecutorExitInterpretationV1 {
  return EXECUTOR_ADAPTERS[name].classifyExit(exitCode, output);
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

const grokAdapter: ExecutorAdapterV1 = {
  name: "grok",
  build(input) {
    const checked = validateInput(input);
    if (!checked.ok) return checked;
    return ready(buildGrokLaunch(checked));
  },
  classifyExit(exitCode) {
    return exitCode === 0 ? { kind: "COMPLETED", exitCode } : { kind: "FAILED", exitCode };
  },
};

const claudeAdapter: ExecutorAdapterV1 = {
  name: "claude",
  build(input) {
    const checked = validateInput(input);
    if (!checked.ok) return checked;
    return ready(buildClaudeLaunch(checked));
  },
  classifyExit(exitCode, output) {
    if (isClaudeNotLoggedIn(exitCode, output)) {
      return {
        kind: "EXECUTOR_UNAVAILABLE",
        code: "NOT_LOGGED_IN",
        reason:
          "Claude is not logged in; this is an executor-availability problem, not a failed work item",
      };
    }
    return exitCode === 0 ? { kind: "COMPLETED", exitCode } : { kind: "FAILED", exitCode };
  },
};

const localAdapter: ExecutorAdapterV1 = {
  name: "local",
  build(input) {
    const checked = validateInput(input);
    if (!checked.ok) return checked;
    // The local adapter exists so the shape is uniform. It refuses to pretend it can run
    // anything yet — there is no in-process executor, and returning a successful launch would
    // invent one.
    return {
      ok: false,
      code: "NOT_IMPLEMENTED",
      reason: "the local in-process executor is not implemented and will not pretend to run",
      launch: buildLocalLaunch(checked),
    };
  },
  classifyExit() {
    return {
      kind: "EXECUTOR_UNAVAILABLE",
      code: "NOT_IMPLEMENTED",
      reason: "the local in-process executor is not implemented",
    };
  },
};

/**
 * The registry the all-adapters tests walk. Typed against {@link ExecutorNameV1} so a name added
 * there cannot ship without an adapter, and {@link allExecutorAdapters} cannot miss one.
 */
export const EXECUTOR_ADAPTERS: Readonly<Record<ExecutorNameV1, ExecutorAdapterV1>> = {
  claude: claudeAdapter,
  grok: grokAdapter,
  local: localAdapter,
};

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------

function buildGrokLaunch(input: ValidatedInput): AdapterLaunchV1 {
  // Grok 1.0.3, measured. -p is --single <PROMPT> and takes the prompt inline. Combining it with
  // --prompt-file starves --single of its argument: `-p --prompt-file` is a prompt of the literal
  // string "--prompt-file" and the path becomes an unknown option. The run is garbage. Never emit
  // both.
  //
  // --no-plan is required. Without it Grok 1.0.3 emits a plan, ends its turn and exits 0 having
  // written nothing. Four D2 launches were lost to this before it was found, and every one of
  // them reported success by exit code. Do not remove it as noise.
  //
  // A reviewer that can write is not a review. The measured implementer list stays
  // `bypassPermissions` + `--always-approve`. Every NON_WRITING_ROLES member is
  // dontAsk and must not carry --always-approve.
  const argv = executorArgvFor("grok", input);
  if (argv === null) return launchOf(input, []);
  return launchOf(input, argv);
}

function buildClaudeLaunch(input: ValidatedInput): AdapterLaunchV1 {
  // See executorArgvFor("claude"): measured 2.1.232. -p is boolean; the
  // prompt file is not an argv element. cwd is the spawn cwd, not a flag.
  const argv = executorArgvFor("claude", input);
  if (argv === null) return launchOf(input, []);
  return launchOf(input, argv);
}

function buildLocalLaunch(input: ValidatedInput): AdapterLaunchV1 {
  return launchOf(input, []);
}

function launchOf(input: ValidatedInput, argv: readonly string[]): AdapterLaunchV1 {
  return {
    argv,
    cwd: input.cwd,
    env: { [RUN_NONCE_ENV]: input.runNonce },
    promptPath: input.promptPath,
    shell: false,
  };
}

function ready(launch: AdapterLaunchV1): AdapterResultV1 {
  return { ok: true, reason: "ready", launch };
}

// ---------------------------------------------------------------------------
// Validation — before spawn, not after
// ---------------------------------------------------------------------------

interface ValidatedInput {
  readonly promptPath: string;
  readonly cwd: string;
  readonly runNonce: string;
  readonly role?: ExecutorRoleV1;
}

function validateInput(input: AdapterInputV1): AdapterResultV1 & { ok: false } | ValidatedInput & { ok: true } {
  const runNonce = asUsableToken(input.runNonce);
  if (runNonce === null) {
    return refused("EMPTY_NONCE", "run nonce is empty or contains control bytes");
  }
  if (input.role !== undefined && !isExecutorRole(input.role)) {
    return refused("INVALID_ROLE", "role is not an enumerated executor role");
  }

  const promptPath = asUsablePath(input.promptPath);
  if (promptPath === null) {
    return refused(
      "MISSING_PROMPT",
      "prompt path is not an identifiable absolute file path",
    );
  }
  if (!isExistingFile(promptPath)) {
    return refused("MISSING_PROMPT", "prompt path does not name an existing file");
  }

  const cwd = asUsablePath(input.cwd);
  if (cwd === null) {
    return refused(
      "MISSING_CWD",
      "cwd is not an identifiable absolute directory; validating before spawn so a missing cwd is not reported as an executable ENOENT",
    );
  }
  if (!isExistingDirectory(cwd)) {
    return refused(
      "MISSING_CWD",
      "cwd does not name an existing directory; validating before spawn so a missing cwd is not reported as an executable ENOENT",
    );
  }

  return {
    ok: true,
    promptPath,
    cwd,
    runNonce,
    ...(input.role !== undefined ? { role: input.role } : {}),
  };
}

function refused(code: AdapterRefusalCodeV1, reason: string): AdapterResultV1 & { ok: false } {
  return { ok: false, code, reason, launch: null };
}

function asUsableToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || CONTROL_BYTES.test(trimmed)) return null;
  return trimmed;
}

function asUsablePath(value: unknown): string | null {
  const token = asUsableToken(value);
  if (token === null) return null;
  if (!isResolvedHostPath(token)) return null;
  return token;
}

function isExistingFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

function isClaudeNotLoggedIn(exitCode: number, output: string): boolean {
  if (exitCode === 0) return false;
  return String(output ?? "").includes(CLAUDE_NOT_LOGGED_IN);
}
