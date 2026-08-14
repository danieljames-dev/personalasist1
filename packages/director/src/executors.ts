/**
 * Finding the executors, and describing how to run them safely.
 *
 * Two decisions live here and both are deliberately pure: *which* binary to use, and *what argv* to
 * hand it. Spawning belongs elsewhere, because a decision that needs a process to test is a decision
 * that mostly goes untested — and these are exactly the decisions that must not.
 *
 * ## Why discovery is a search rather than a path
 *
 * The Claude binary currently lives inside a VS Code extension folder whose name carries a version
 * (`anthropic.claude-code-2.1.231-win32-x64`). Hardcoding that path works until the extension
 * updates, at which point the Director stops being able to run anything and reports a missing
 * executable for a tool that is installed. So candidates are enumerated, versions compared, and the
 * newest one that actually answers `--version` wins. When two versions cannot be ordered, nothing is
 * chosen silently — an ambiguous install is reported rather than guessed at.
 *
 * ## Why argv is built, never formatted
 *
 * Every prompt the Director sends contains material it did not write: an executor's previous output,
 * a page it read, text lifted off a photograph. If any of that reached a shell, the quoting rules of
 * cmd.exe would become part of AION's security model. It never does. Prompts go to a file on disk
 * and the file *path* goes in argv; argv itself contains only tokens the Director created.
 */
import type { IsoTimestamp } from "./contracts.js";
import { buildExecutorLaunch } from "./executor-adapters.js";

export const EXECUTOR_SCHEMA_V1 = "aion.director.executor.v1" as const;

export type ExecutorNameV1 = "claude" | "grok" | "local";

/** What a discovered executable can actually do, established by probing rather than assumed. */
export interface ExecutorCapabilitiesV1 {
  print: boolean;
  outputFormat: boolean;
  promptFile: boolean;
  jsonSchema: boolean;
  cwd: boolean;
  permissionMode: boolean;
  sessionId: boolean;
}

export type DiscoverySourceV1 =
  | "CONFIGURED_OVERRIDE"
  | "VSCODE_EXTENSION"
  | "PATH"
  | "USER_LOCAL"
  | "NONE";

export interface ExecutorDiscoveryV1 {
  schema: typeof EXECUTOR_SCHEMA_V1;
  executor: ExecutorNameV1;
  available: boolean;
  path: string | null;
  version: string | null;
  source: DiscoverySourceV1;
  capabilities: ExecutorCapabilitiesV1;
  /** Why this outcome, in words a person can act on. */
  reason: string;
  /** Every candidate considered, so an ambiguous install can be shown rather than resolved. */
  candidatesConsidered: string[];
  probedAt: IsoTimestamp;
}

const NO_CAPABILITIES: ExecutorCapabilitiesV1 = {
  print: false, outputFormat: false, promptFile: false,
  jsonSchema: false, cwd: false, permissionMode: false, sessionId: false,
};

/**
 * Compare two version strings numerically, segment by segment.
 *
 * Returns null when they cannot be ordered — which is a real answer, not a failure. Two installs
 * whose versions are incomparable must not be silently resolved in favour of whichever the
 * filesystem happened to list first.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const match = String(v ?? "").match(/(\d+(?:\.\d+)*)/);
    if (!match) return null;
    return match[1]!.split(".").map(Number);
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

export interface CandidateV1 {
  path: string;
  source: DiscoverySourceV1;
  /** Version reported by the probe, or null when it did not answer. */
  version: string | null;
  /** Whether the file is a real executable rather than a shim. */
  isFile: boolean;
  capabilities?: Partial<ExecutorCapabilitiesV1>;
}

/**
 * Choose among probed candidates.
 *
 * A `.cmd` or `.ps1` shim is rejected outright: the Director spawns with `shell: false`, so a batch
 * wrapper is not executable at all, and selecting one would produce a confusing spawn failure much
 * later instead of a clear answer here.
 */
export function selectExecutor(input: {
  executor: ExecutorNameV1;
  candidates: readonly CandidateV1[];
  probedAt: IsoTimestamp;
}): ExecutorDiscoveryV1 {
  const considered = input.candidates.map((c) => c.path);
  // Same spawnable-exe rule as discoverGrokExecutor / discoverClaudeExecutor:
  // Win32 strips trailing dots and spaces, so `grok.cmd.` opens `grok.cmd`.
  // A closed suffix list with an open boundary is how those disagreed.
  const usable = input.candidates.filter(
    (c) => c.isFile && c.version !== null && isDirectlySpawnableWindowsExe(c.path),
  );

  if (usable.length === 0) {
    return {
      schema: EXECUTOR_SCHEMA_V1,
      executor: input.executor,
      available: false,
      path: null,
      version: null,
      source: "NONE",
      capabilities: NO_CAPABILITIES,
      reason: input.candidates.length === 0
        ? "no candidate executable was found"
        : "candidates were found but none answered a version probe as a real executable",
      candidatesConsidered: considered,
      probedAt: input.probedAt,
    };
  }

  // An explicit override wins outright: the Owner naming a path is an instruction, not a hint.
  const configured = usable.find((c) => c.source === "CONFIGURED_OVERRIDE");
  const pool = configured ? [configured] : usable;

  let best = pool[0]!;
  for (const candidate of pool.slice(1)) {
    const order = compareVersions(candidate.version!, best.version!);
    if (order === null) {
      return {
        schema: EXECUTOR_SCHEMA_V1,
        executor: input.executor,
        available: false,
        path: null,
        version: null,
        source: "NONE",
        capabilities: NO_CAPABILITIES,
        reason: `two installs could not be ordered (${candidate.version} vs ${best.version}); refusing to pick one silently`,
        candidatesConsidered: considered,
        probedAt: input.probedAt,
      };
    }
    if (order > 0) best = candidate;
  }

  return {
    schema: EXECUTOR_SCHEMA_V1,
    executor: input.executor,
    available: true,
    path: best.path,
    version: best.version,
    source: best.source,
    capabilities: { ...NO_CAPABILITIES, ...(best.capabilities ?? {}) },
    reason: `selected ${best.version} from ${best.source.toLowerCase().replace(/_/g, " ")}`,
    candidatesConsidered: considered,
    probedAt: input.probedAt,
  };
}

/** Read a `--help` dump into a capability set. Presence of a flag, nothing more. */
export function capabilitiesFromHelp(helpText: string): ExecutorCapabilitiesV1 {
  const text = String(helpText ?? "");
  const has = (flag: string): boolean => text.includes(flag);
  return {
    print: has("--print") || /(^|\s)-p(\s|,)/.test(text),
    outputFormat: has("--output-format"),
    promptFile: has("--prompt-file"),
    jsonSchema: has("--json-schema"),
    cwd: has("--cwd"),
    permissionMode: has("--permission-mode"),
    sessionId: has("--session-id"),
  };
}

// ---------------------------------------------------------------------------
// Building a launch
// ---------------------------------------------------------------------------

export type ExecutorRoleV1 =
  | "IMPLEMENT"
  | "REPAIR"
  | "INTEGRATE"
  | "DEPLOY"
  | "INDEPENDENT_ACCEPTANCE"
  | "ADVERSARIAL_REVIEW"
  | "RESEARCH"
  | "PRE_INTEGRATION_REHEARSAL"
  | "POST_CLEANUP_RECHECK"
  | "GIT_VERIFY"
  | "BUILD"
  | "TEST"
  | "HEALTH"
  | "SAFE_PROJECT_SCRIPT";

/**
 * Which executor does what, decided in a table.
 *
 * No model is consulted to make this choice. Asking one to route every ordinary run would add
 * latency, cost and a failure mode, to answer a question whose answer is fixed.
 */
const ROUTING: Readonly<Record<ExecutorRoleV1, ExecutorNameV1>> = {
  IMPLEMENT: "claude",
  REPAIR: "claude",
  INTEGRATE: "claude",
  DEPLOY: "claude",
  INDEPENDENT_ACCEPTANCE: "grok",
  ADVERSARIAL_REVIEW: "grok",
  RESEARCH: "grok",
  PRE_INTEGRATION_REHEARSAL: "grok",
  POST_CLEANUP_RECHECK: "grok",
  GIT_VERIFY: "local",
  BUILD: "local",
  TEST: "local",
  HEALTH: "local",
  SAFE_PROJECT_SCRIPT: "local",
};

export function routeRole(role: ExecutorRoleV1): ExecutorNameV1 {
  return ROUTING[role];
}

export interface LaunchPlanV1 {
  executable: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  /** Always false. Stated in the plan so a test can assert it rather than trust a call site. */
  shell: false;
  /** Where the prompt was written. Its path goes in argv; its contents never do. */
  promptPath: string;
}

/**
 * Build the exact command line.
 *
 * Argv is decided in one place: the measured adapters. This wrapper keeps the existing
 * `{ discovery, role, cwd, promptPath, timeoutMs }` callers compiling and maps their result
 * onto {@link LaunchPlanV1}. It does not invent a second flag list.
 *
 * The old body chose flags from a capability bitset (reviewer permission mode, long-form
 * print, optional prompt-file). That list is what launched four Grok runs that exited 0
 * having written nothing. The adapter list is the one that was measured. Role is forwarded
 * so the adapter can refuse write permission for ADVERSARIAL_REVIEW; it does not rebuild argv.
 *
 * `runNonce` is required by the adapter (it must not appear on argv). Callers that have not
 * minted one yet must pass the nonce they will persist on the intent.
 */
export function buildLaunchPlan(input: {
  discovery: ExecutorDiscoveryV1;
  role: ExecutorRoleV1;
  cwd: string;
  promptPath: string;
  sessionId?: string | null;
  timeoutMs: number;
  runNonce: string;
}): { ok: boolean; plan: LaunchPlanV1 | null; reason: string } {
  if (!input.discovery.available || !input.discovery.path) {
    return { ok: false, plan: null, reason: `${input.discovery.executor} is not available: ${input.discovery.reason}` };
  }

  const built = buildExecutorLaunch(input.discovery.executor, {
    promptPath: input.promptPath,
    cwd: input.cwd,
    runNonce: input.runNonce,
    role: input.role,
  });
  if (!built.ok || built.launch === null) {
    return { ok: false, plan: null, reason: built.reason };
  }

  return {
    ok: true,
    reason: built.reason,
    plan: {
      executable: input.discovery.path,
      argv: [...built.launch.argv],
      cwd: built.launch.cwd,
      timeoutMs: input.timeoutMs,
      shell: false,
      promptPath: built.launch.promptPath,
    },
  };
}

/**
 * Refuse argv that carries shell syntax.
 *
 * Belt and braces: the Director spawns with `shell: false`, so metacharacters are inert. This exists
 * so that a future call site which reintroduces a shell cannot also quietly reintroduce injection —
 * the argv would already have been rejected here.
 */
// `>` is a redirect unless it is the arrow in `=>`, which node -e scripts use.
const SHELL_METACHARACTERS = /[;&|`$<\n\r]|\$\(|&&|\|\||(?<![=])>/;

/**
 * The live discovery ladder only returns a `.exe`. Trailing dots/spaces on the
 * last segment are stripped by Win32 before open, so they are refused here
 * rather than treated as a distinct suffix.
 */
export function isDirectlySpawnableWindowsExe(filePath: string): boolean {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  if (base === "" || /[. ]$/.test(base)) return false;
  return /\.exe$/i.test(base);
}

export function argvIsSafe(argv: readonly string[]): { safe: boolean; offending: string | null } {
  for (const token of argv) {
    if (SHELL_METACHARACTERS.test(String(token))) return { safe: false, offending: String(token) };
  }
  return { safe: true, offending: null };
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export type CapacityStateV1 =
  | "AVAILABLE"
  | "CAPACITY_LOW"
  | "CAPACITY_EXHAUSTED"
  | "RESET_AT_KNOWN_TIME"
  | "UNAVAILABLE";

export interface CapacityReadingV1 {
  state: CapacityStateV1;
  /** Only ever set when the vendor's own output named a time. Never inferred. */
  resetAt: IsoTimestamp | null;
  detail: string;
}

const EXHAUSTED = /\b(?:quota|rate limit|usage limit|limit reached|out of credits|too many requests)\b/i;
const LOW = /\b(?:approaching|running low|nearly out|remaining: ?\d{1,2}%)\b/i;
const RESET_AT = /\bresets?\s+at\s+([0-9TZ:\-\.]{10,})/i;

/**
 * Read capacity from what an executor actually said.
 *
 * A reset time is recorded only when the output names one. Inventing "probably an hour" would create
 * a mission that wakes up and fails again, which is worse than one that waits to be told.
 */
export function readCapacity(output: string): CapacityReadingV1 {
  const text = String(output ?? "");
  const reset = text.match(RESET_AT)?.[1] ?? null;

  if (EXHAUSTED.test(text)) {
    return reset
      ? { state: "RESET_AT_KNOWN_TIME", resetAt: reset, detail: "the executor named a reset time" }
      : { state: "CAPACITY_EXHAUSTED", resetAt: null, detail: "quota reached; no reset time was given, so none is recorded" };
  }
  if (LOW.test(text)) return { state: "CAPACITY_LOW", resetAt: null, detail: "capacity is running low" };
  return { state: "AVAILABLE", resetAt: null, detail: "no capacity signal" };
}

/**
 * What to do when an executor runs out.
 *
 * Never a paid path. The envelope is zero spend, so the only moves are another already-authorized
 * executor, or waiting — and waiting has to survive a reboot, which is why it is a mission state
 * rather than a sleeping process.
 */
export function capacityFallback(input: {
  role: ExecutorRoleV1;
  exhausted: ExecutorNameV1;
  otherAvailable: readonly ExecutorNameV1[];
}): { action: "REROUTE" | "WAIT"; executor: ExecutorNameV1 | null; reason: string } {
  const preferred = routeRole(input.role);
  if (preferred !== input.exhausted && input.otherAvailable.includes(preferred)) {
    return { action: "REROUTE", executor: preferred, reason: "the role's own executor is still available" };
  }
  // Roles are not interchangeable: a reviewer standing in for an implementer is not independent
  // review, it is the same party twice.
  return {
    action: "WAIT",
    executor: null,
    reason: "no other authorized executor holds this role, and no paid path exists",
  };
}
