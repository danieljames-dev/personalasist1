/**
 * Round 15 (D2 repair mission r14 findings F1–F9). Each new test below must
 * fail against the unmodified predicates at e1e6755 and pass after the class
 * fix. Existing tests are not deleted.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
} from "../src/bounded-log.js";
import { executorArgvFor, GROK_MAX_TURNS } from "../src/executor-adapters.js";
import { NON_WRITING_ROLES, ROLE_KIND, ROUTING, WRITE_ROLES, type ExecutorRoleV1 } from "../src/executors.js";
import { GIT_OBSERVATION_SCHEMA_V1, type GitObservationV1, type GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import type { LeaseV1 } from "../src/leases.js";
import {
  BROKER_HOST_PROCESS_NAMES,
  createWindowsOrphanScanner,
  interpretWindowsOrphanScanOutput,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  type ProcessRowPlausibilityContextV1,
} from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import {
  evaluateSuccessConjunction,
  executeRun,
  launchRun,
  statErrorMeansAbsent,
  writerSightingNotProvenAbsent,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LaunchRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";

const NOW = "2026-08-13T12:00:00.000Z";
const LATER = "2026-08-13T12:00:30.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const EXE = "C:\\Tools\\grok.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const AFTER = "2026-08-13T12:00:05.000Z";
const FLOOR = "2026-08-13T12:00:00.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: "C:\\Tools\\claude.exe",
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited" };

const DETACHED_GRANDCHILD = {
  pid: 7777,
  name: "node.exe",
  creationDate: "2026-08-13T12:00:05.0000000Z",
  parentPid: 6666,
  nonceReadable: false,
  parentPresent: false,
};

function grokImplementerArgv(promptPath = PROMPT, cwd = CWD): string[] {
  return [
    "--prompt-file", promptPath,
    "--cwd", cwd,
    "--permission-mode", "bypassPermissions",
    "--always-approve",
    "--no-plan",
    "--max-turns", String(GROK_MAX_TURNS),
  ];
}

function matchingDiscovery(exe = EXE): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: exe, AION_CLAUDE_CODE_PATH: "C:\\Tools\\claude.exe" },
    discoveryFs: {
      isFile: (path) => path === exe || path === "C:\\Tools\\claude.exe",
      readDir: () => [],
    },
  };
}

function goodHandoff(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: HANDOFF_SCHEMA_V1,
    executor: "grok",
    missionId: "mission-1",
    runId: "run-1",
    workItemId: "work-1",
    branch: "executor/oracle",
    headBefore: HEAD_BEFORE,
    headAfter: HEAD_AFTER,
    status: "PASS",
    tests: [{ suite: "director", total: 1, passed: 1, failed: 0, skipped: 0 }],
    productionMutated: false,
    spendUsd: 0,
    requiresOwner: false,
    nextRecommendedGate: null,
    artifacts: ["notes.md"],
    startedAt: NOW,
    finishedAt: NOW,
    capacityStatus: "AVAILABLE",
    runNonce: NONCE,
    summary: "ok",
    ...over,
  };
}

function request(over: Partial<ExecuteRunRequestV1> = {}): ExecuteRunRequestV1 {
  return {
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    executor: "claude",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: "C:\\Tools\\claude.exe",
    argv: ["-p", "--permission-mode", "bypassPermissions"],
    cwd: CWD,
    runNonce: NONCE,
    runRoot: RUN_ROOT,
    promptPath: PROMPT,
    timeoutMs: 30_000,
    lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-1" },
    authorisedProductionMutated: false,
    role: "IMPLEMENT",
    ...over,
  };
}

function memoryFs(seed: { files?: Record<string, string>; dirs?: string[] } = {}): RunFileSystemV1 & {
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(seed.files ?? {}));
  const dirs = new Set(seed.dirs ?? [CWD, RUN_ROOT]);
  return {
    files,
    isDirectory(path) {
      return dirs.has(path);
    },
    isFile(path) {
      return files.has(path);
    },
    readUtf8(path) {
      const value = files.get(path);
      if (value === undefined) {
        const error = new Error(`ENOENT ${path}`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      return value;
    },
    writeDurable(path, utf8) {
      files.set(path, utf8);
    },
    mkdirp(path) {
      dirs.add(path);
    },
  };
}

function memoryCapacity(): CapacityGateV1 {
  return {
    tryAcquire() {
      return { ok: true, reason: "capacity-acquired" };
    },
    release() {
      // unused
    },
  };
}

function memoryLeases(initial: readonly LeaseV1[] = []): LeaseStoreV1 {
  let leases = [...initial];
  return {
    list: () => [...leases],
    save: (next) => {
      leases = [...next];
    },
  };
}

function gitResult(argv: readonly string[], over: { status?: number; stdout?: string; stderr?: string } = {}) {
  return {
    argv: [...argv],
    status: over.status ?? 0,
    stdout: over.stdout ?? "",
    stderr: over.stderr ?? "",
    error: null,
  };
}

function matchingGit(head = HEAD_AFTER, opts: { readonly advance?: boolean } = {}): GitRunner {
  let revParses = 0;
  return {
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        revParses += 1;
        const sha = opts.advance === true && revParses === 1 ? HEAD_BEFORE : head;
        return gitResult(argv, { stdout: `${sha}\n` });
      }
      if (key === "symbolic-ref -q --short HEAD") return gitResult(argv, { stdout: "executor/oracle\n" });
      if (key === "status --porcelain" || key === "status --porcelain --ignored") return gitResult(argv, { stdout: "" });
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return gitResult(argv, { status: 128, stderr: "fatal: no upstream configured\n" });
      }
      if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
        return gitResult(argv, { status: 0 });
      }
      throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
    },
  };
}

function foundObservation(identity: ExecutorProcessIdentityV1): ProcessObservationV1 {
  return {
    outcome: "FOUND",
    reason: "injected",
    pid: identity.pid,
    creationDate: identity.creationDate,
    executablePath: identity.executablePath,
    runNonce: identity.runNonce,
  };
}

function sequentialProbe(observations: readonly ProcessObservationV1[]) {
  let index = 0;
  return {
    observe() {
      const current = observations[Math.min(index, observations.length - 1)]!;
      index += 1;
      return current;
    },
  };
}

function exitingProcess(opts: { exitCode?: number; pid?: number; stdout?: string } = {}): SpawnHandleV1 {
  let exited = false;
  let resolveExit: ((value: { code: number | null; signal: string | null }) => void) | null = null;
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });
  queueMicrotask(() => {
    exited = true;
    resolveExit?.({ code: opts.exitCode ?? 0, signal: null });
  });
  return {
    pid: opts.pid ?? RECORDED.pid,
    stdout: Readable.from([opts.stdout ?? ""]),
    stderr: Readable.from([""]),
    kill() {
      if (!exited) {
        exited = true;
        resolveExit?.({ code: null, signal: "SIGTERM" });
      }
    },
    exit,
    get exited() {
      return exited;
    },
  };
}

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 & { calls: number } {
  const spawn = ((_exe, _argv, options, permit) => {
    requireSpawnPermit(permit);
    assert.equal(options.shell, false);
    spawn.calls += 1;
    return factory();
  }) as SpawnFnV1 & { calls: number };
  spawn.calls = 0;
  return spawn;
}

async function runWith(
  over: {
    request?: Partial<ExecuteRunRequestV1>;
    fs?: RunFileSystemV1;
    spawn?: SpawnFnV1;
    git?: GitRunner;
    probe?: RunManagerDepsV1["probe"];
    leases?: LeaseStoreV1;
    killTree?: (pid: number) => void;
    scanOrphans?: RunManagerDepsV1["scanOrphans"];
    handoff?: Record<string, unknown> | null;
    logSinks?: RunManagerDepsV1["logSinks"];
    clock?: RunManagerDepsV1["clock"];
  } = {},
) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs();
  let handoffText = null;
  if (over.handoff === null) {
    handoffText = null;
  } else if (over.handoff !== undefined) {
    handoffText = JSON.stringify(over.handoff);
  } else {
    try {
      if (fs.isFile(handoffPath)) {
        handoffText = fs.readUtf8(handoffPath);
        if ("files" in fs && fs.files instanceof Map) fs.files.delete(handoffPath);
      } else {
        handoffText = JSON.stringify(goodHandoff());
      }
    } catch {
      handoffText = JSON.stringify(goodHandoff());
    }
  }
  if ("files" in fs && fs.files instanceof Map) fs.files.delete(handoffPath);
  const deps: RunManagerDepsV1 = {
    clock: over.clock ?? createFixedClock(AFTER),
    fs,
    spawn: (executable, argv, options, permit) => {
      if (handoffText !== null) {
        try { fs.writeDurable(handoffPath, handoffText); } catch { /* conjunction records absence */ }
      }
      return (over.spawn ?? trackingSpawn(() => exitingProcess()))(executable, argv, options, permit);
    },
    git: over.git ?? matchingGit(HEAD_AFTER, { advance: true }),
    probe: over.probe ?? sequentialProbe([
      foundObservation({ ...RECORDED, executablePath: "C:\\Tools\\claude.exe" }),
      HOLDER_GONE,
    ]),
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: async () => undefined,
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => []),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
  };
  return executeRun(request(over.request), deps);
}

function plausibility(over: Partial<ProcessRowPlausibilityContextV1> = {}): ProcessRowPlausibilityContextV1 {
  return {
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }],
    ...over,
  };
}

function gitObs(sha: string): GitObservationV1 {
  return {
    schema: GIT_OBSERVATION_SCHEMA_V1,
    worktreePath: CWD,
    collectedAt: NOW,
    head: { outcome: "FOUND", sha },
    branch: { outcome: "ATTACHED", name: "executor/oracle" },
    upstream: { outcome: "NO_UPSTREAM" },
    status: { outcome: "CLEAN", porcelain: "" },
  };
}

function emptyParsed() {
  return { ok: false as const, handoff: null, problems: ["no handoff text"] };
}

function conjunctionInput(over: Parameters<typeof evaluateSuccessConjunction>[0] extends infer T ? Partial<T> : never) {
  return {
    exitCode: 0,
    stillRunning: false,
    executor: "grok" as const,
    output: "",
    parsed: emptyParsed(),
    reportedWorkItemId: null,
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: gitObs(HEAD_AFTER),
    gitBefore: gitObs(HEAD_BEFORE),
    gitVerdict: null,
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: false,
    declaredArtifactsInsideRunRootReason: "no parsed handoff",
    executorTreeGone: true,
    executorTreeReason: "injected",
    timedOut: false,
    logStayedWithinBudget: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// F1 — name is last; drive off BROKER_HOST_PROCESS_NAMES
// ---------------------------------------------------------------------------

test("F1 every broker-host name carrying this run's nonce is ours on both predicates", () => {
  for (const name of BROKER_HOST_PROCESS_NAMES) {
    const row = {
      pid: 901,
      name,
      parentPid: 1,
      parentPresent: true,
      runNonce: NONCE,
      nonceReadable: true,
      creationDate: AFTER,
    };
    const ctx = plausibility({ rows: [{ pid: 4812 }, { pid: 901, parentPid: 1 }] });
    assert.equal(processRowCouldBelongToThisRun(row, ctx), true, name);
    assert.equal(writerSightingNotProvenAbsent(row, NONCE, {
      holderPid: 4812,
      rows: ctx.rows,
    }), true, name);
  }
});

test("F1 every broker-host name that is a direct child of the holder is ours on both predicates", () => {
  for (const name of BROKER_HOST_PROCESS_NAMES) {
    const row = {
      pid: 902,
      name,
      parentPid: 4812,
      parentPresent: false,
      nonceReadable: false,
      creationDate: AFTER,
    };
    const ctx = plausibility({ rows: [{ pid: 4812 }, { pid: 902, parentPid: 4812 }] });
    assert.equal(processRowCouldBelongToThisRun(row, ctx), true, name);
    assert.equal(writerSightingNotProvenAbsent(row, NONCE, {
      holderPid: 4812,
      rows: ctx.rows,
    }), true, name);
  }
});

test("F1 every broker-host name with a foreign nonce, off-chain, before the floor stays excluded", () => {
  for (const name of BROKER_HOST_PROCESS_NAMES) {
    const row = {
      pid: 903,
      name,
      parentPid: 1612,
      parentPresent: true,
      parentName: "svchost.exe",
      runNonce: "nonce-foreign",
      nonceReadable: true,
      creationDate: "2026-01-01T00:00:00.000Z",
    };
    const ctx = plausibility({
      observedPids: new Set([4812]),
      rows: [{ pid: 4812 }, { pid: 903, parentPid: 1612 }],
    });
    assert.equal(processRowCouldBelongToThisRun(row, ctx), false, name);
    assert.equal(writerSightingNotProvenAbsent(row, NONCE, {
      holderPid: 4812,
      rows: ctx.rows,
      createdNotBefore: FLOOR,
      holderExitedAt: HOLDER_EXIT,
      observedPids: ctx.observedPids,
    }), false, name);
  }
});

test("F1 the emitted scanner script uses the guarded self-broker continue, not the bare one", () => {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "" };
    },
  });
  scanner({ runNonce: NONCE, createdNotBefore: FLOOR, holderPid: 4812 });
  assert.equal(/\$isSelfBroker[\s\S]{0,80}continue/.test(script), false);
  assert.equal(script.includes("if ($isSelfBroker) { continue }"), false);
});

test("F1 executeRun with a broker-named nonce-bearing in-chain leftover withholds the writer lease and kills it", async () => {
  const killed: number[] = [];
  const leases = memoryLeases();
  const leftover = {
    pid: 12080,
    name: "taskeng.exe",
    parentPid: 4812,
    parentPresent: true,
    nonceReadable: true,
    runNonce: NONCE,
    creationDate: AFTER,
  };
  const result = await runWith({
    leases,
    killTree: (pid) => {
      killed.push(pid);
    },
    scanOrphans: () => [leftover],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-f1" } },
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.conjunction.findings.find((item) => item.name === "executorTreeIsGone")?.ok, false);
  assert.equal(killed.includes(12080), true, `killTree saw ${killed.join(",")}`);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-f1"), true);
});

// ---------------------------------------------------------------------------
// F2 — parentless in-window row is this run's, not host noise
// ---------------------------------------------------------------------------

test("F2 detached grandchild in the closed window is couldBelong, undecidable, UNAVAILABLE", () => {
  const ctx = plausibility({
    observedPids: new Set([4812]),
    holderExitedAt: HOLDER_EXIT,
    rows: [{ pid: 4812 }, { pid: 7777, parentPid: 6666 }],
  });
  assert.equal(processRowCouldBelongToThisRun(DETACHED_GRANDCHILD, ctx), true);
  assert.equal(processRowMakesScanUndecidable(DETACHED_GRANDCHILD, ctx), true);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0, processes: [DETACHED_GRANDCHILD] }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [4812],
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

test("F2 the same row created after holderExitedAt is UNKNOWN, not proven absent", () => {
  const row = { ...DETACHED_GRANDCHILD, creationDate: "2026-08-13T12:00:20.000Z" };
  const ctx = plausibility({
    observedPids: new Set([4812]),
    holderExitedAt: HOLDER_EXIT,
    rows: [{ pid: 4812 }, { pid: 7777, parentPid: 6666 }],
  });
  // A descendant can outlive the holder and keep spawning. The exit
  // ceiling does not bound this child's birth once the parent is gone.
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0, processes: [row] }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [4812],
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

test("F2 the same row with a live parent stays SCANNED", () => {
  const row = { ...DETACHED_GRANDCHILD, parentPresent: true };
  const ctx = plausibility({
    observedPids: new Set([4812]),
    holderExitedAt: HOLDER_EXIT,
    rows: [{ pid: 4812 }, { pid: 7777, parentPid: 6666 }],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0, processes: [row] }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [4812],
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

test("F2 the same row created before the floor stays SCANNED", () => {
  const row = { ...DETACHED_GRANDCHILD, creationDate: "2026-01-01T00:00:00.000Z" };
  const ctx = plausibility({
    observedPids: new Set([4812]),
    holderExitedAt: HOLDER_EXIT,
    rows: [{ pid: 4812 }, { pid: 7777, parentPid: 6666 }],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0, processes: [row] }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [4812],
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(interpreted.outcome, "SCANNED");
});

test("F2 executeRun with the detached grandchild retains the writer lease and mints no exit proof", async () => {
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    clock: createFixedClock(AFTER),
    scanOrphans: () => [DETACHED_GRANDCHILD],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-f2" } },
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-f2"), true);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.ok(tree);
  assert.match(
    tree.reason,
    /not performed|undecidable|unavailable/i,
    `tree reason must be the UNAVAILABLE scan, not leftover-remaining: ${tree.reason}`,
  );
});

test("F2 both membership predicates never disagree as ours vs absent", () => {
  const rows: ReadonlyArray<{
    label: string;
    row: {
      pid: number;
      name?: string;
      parentPid?: number;
      parentPresent?: boolean;
      parentName?: string | null;
      runNonce?: string | null;
      nonceReadable?: boolean;
      creationDate?: string;
    };
    extraRows?: ReadonlyArray<{ readonly pid: number; readonly parentPid?: number }>;
  }> = [
    {
      label: "broker+nonce",
      row: { pid: 901, name: "taskeng.exe", parentPid: 1, runNonce: NONCE, nonceReadable: true, creationDate: AFTER },
    },
    {
      label: "broker+child",
      row: { pid: 902, name: "svchost.exe", parentPid: 4812, parentPresent: false, nonceReadable: false, creationDate: AFTER },
      extraRows: [{ pid: 902, parentPid: 4812 }],
    },
    {
      label: "broker+foreign+old",
      row: {
        pid: 903,
        name: "dllhost.exe",
        parentPid: 1612,
        parentPresent: true,
        runNonce: "other",
        nonceReadable: true,
        creationDate: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      label: "detached-grandchild",
      row: { ...DETACHED_GRANDCHILD },
    },
    {
      label: "wmi-self-noise",
      row: {
        pid: 19576,
        name: "WmiPrvSE.exe",
        parentPid: 1612,
        parentPresent: true,
        parentName: "svchost.exe",
        nonceReadable: false,
        creationDate: AFTER,
      },
    },
    {
      label: "worker+nonce",
      row: { pid: 5555, name: "worker.exe", parentPid: 4812, runNonce: NONCE, nonceReadable: true, creationDate: AFTER },
      extraRows: [{ pid: 5555, parentPid: 4812 }],
    },
    {
      label: "foreign-nonce-parentless",
      row: {
        pid: 460,
        name: "node.exe",
        parentPresent: false,
        nonceReadable: true,
        runNonce: "other",
        creationDate: AFTER,
      },
    },
  ];

  for (const item of rows) {
    const extra = item.extraRows ?? (
      item.row.parentPid === undefined
        ? [{ pid: item.row.pid }]
        : [{ pid: item.row.pid, parentPid: item.row.parentPid }]
    );
    const ctx = plausibility({
      rows: [{ pid: 4812 }, ...extra],
    });
    const could = processRowCouldBelongToThisRun(item.row, ctx);
    const sighting = {
      pid: item.row.pid,
      ...(item.row.name !== undefined ? { name: item.row.name } : {}),
      ...(item.row.parentPid !== undefined ? { parentPid: item.row.parentPid } : {}),
      ...(item.row.parentPresent !== undefined ? { parentPresent: item.row.parentPresent } : {}),
      ...(item.row.parentName !== undefined && item.row.parentName !== null ? { parentName: item.row.parentName } : {}),
      ...(item.row.runNonce !== undefined && item.row.runNonce !== null ? { runNonce: item.row.runNonce } : {}),
      ...(item.row.nonceReadable !== undefined ? { nonceReadable: item.row.nonceReadable } : {}),
      ...(item.row.creationDate !== undefined ? { creationDate: item.row.creationDate } : {}),
    };
    const notAbsent = writerSightingNotProvenAbsent(sighting, NONCE, {
      holderPid: ctx.holderPid ?? null,
      rows: ctx.rows,
      createdNotBefore: ctx.createdNotBefore,
      ...(ctx.holderExitedAt !== undefined ? { holderExitedAt: ctx.holderExitedAt } : {}),
      observedPids: ctx.observedPids,
    });
    assert.equal(
      could && !notAbsent,
      false,
      `${item.label}: couldBelong=${could} notProvenAbsent=${notAbsent}`,
    );
  }
});

// ---------------------------------------------------------------------------
// F3 — PEM holdback accounts drops; END branch is overflow-gated
// ---------------------------------------------------------------------------

function logger() {
  const stdout = createMemoryLogSink();
  const stderr = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr },
  });
  return { log, stdout, stderr };
}

test("F3a unterminated BEGIN followed by ordinary output is accounted as truncated", () => {
  const { log } = logger();
  const evidence = Array.from({ length: 50 }, (_, i) => `AION-EVIDENCE step ${i}: mutated production, spendUsd=9.99\n`).join("");
  const input = `starting work\n-----BEGIN PRIVATE KEY-----\n${evidence}`;
  log.write("stdout", input);
  log.flush();
  const report = log.report().stdout;
  const n = Buffer.byteLength(evidence, "utf8");
  assert.equal(report.liveTruncated, true);
  assert.ok(report.droppedLiveBytes >= n, `dropped=${report.droppedLiveBytes} n=${n}`);
  const tail = log.liveTail("stdout").toString("utf8");
  assert.match(tail, /\[AION_LOG_TRUNCATED dropped=/);
  assert.equal(tail.includes("AION-EVIDENCE"), false);
  assert.equal(tail.includes("spendUsd=9.99"), false);
});

test("F3b a bare END line with no prior overflow keeps the preceding output", () => {
  const { log } = logger();
  const input = "AION-EVIDENCE: executor mutated production without authorisation\nAION-EVIDENCE: spendUsd=42.00\n-----END RSA PRIVATE KEY-----\nall good\n";
  log.write("stdout", input);
  log.flush();
  const text = log.liveTail("stdout").toString("utf8");
  assert.match(text, /AION-EVIDENCE: executor mutated production/);
  assert.match(text, /spendUsd=42\.00/);
  assert.match(text, /all good/);
  assert.equal(log.report().stdout.droppedLiveBytes, 0);
});

test("F3c >64 KiB PEM overflow still hides the key body and accounts the drop", () => {
  const { log } = logger();
  const body = `MIIEowIBAAKCAQEAsecretkeymaterial${"K".repeat(MAX_TOKEN_HOLD)}`;
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  log.write("stdout", "-----END RSA PRIVATE KEY-----\n");
  log.flush();
  const text = `${log.liveTail("stdout").toString("utf8")}\n`;
  assert.equal(text.includes("secretkeymaterial"), false);
  assert.match(text, /-----END RSA PRIVATE KEY-----/);
  assert.match(text, /\[REDACTED\]/);
  assert.ok(log.report().stdout.droppedLiveBytes > 0);
});

test("F3c overflowing PEM terminated by END with no trailing newline drops the body", () => {
  const { log, stdout } = logger();
  const body = `MIIEowIBAAKCAQEAsecretkeymaterial${"K".repeat(MAX_TOKEN_HOLD)}`;
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  log.write("stdout", "-----END RSA PRIVATE KEY-----");
  log.flush();
  const tail = log.liveTail("stdout").toString("utf8");
  const file = stdout.contents().toString("utf8");
  assert.equal(tail.includes("secretkeymaterial"), false);
  assert.equal(file.includes("secretkeymaterial"), false);
  assert.ok(log.report().stdout.droppedLiveBytes > 0);
  assert.match(tail, /\[AION_LOG_TRUNCATED dropped=/);
});

test("F3c overflowing PEM followed by a second BEGIN drops the first key body", () => {
  const { log, stdout } = logger();
  const body = `MIIEowIBAAKCAQEAsecretkeymaterial${"K".repeat(MAX_TOKEN_HOLD)}`;
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  log.write("stdout", "-----BEGIN EC PRIVATE KEY-----\nmore-secret-body\n-----END EC PRIVATE KEY-----\n");
  log.flush();
  const tail = log.liveTail("stdout").toString("utf8");
  const file = stdout.contents().toString("utf8");
  assert.equal(tail.includes("secretkeymaterial"), false);
  assert.equal(file.includes("secretkeymaterial"), false);
  assert.ok(log.report().stdout.droppedLiveBytes > 0);
});

test("F3d benign grep of an END line keeps the preceding line", () => {
  const { log } = logger();
  log.write("stdout", "checking for leaked keys...\ngrep pattern: -----END PRIVATE KEY-----\n");
  log.flush();
  const text = log.liveTail("stdout").toString("utf8");
  assert.match(text, /checking for leaked keys/);
  assert.match(text, /grep pattern:/);
  assert.equal(log.report().stdout.droppedLiveBytes, 0);
});

test("F3e markDrainIncomplete after an unterminated BEGIN still records the drain marker", () => {
  const { log, stdout } = logger();
  log.write("stdout", "work done\n-----BEGIN RSA PRIVATE KEY-----\n");
  log.markDrainIncomplete();
  log.flush();
  const image = stdout.contents().toString("utf8");
  assert.match(image, /reason=stream-drain-timeout/);
  assert.equal(image.includes("MIIE"), false);
});

test("F3f executeRun reports droppedLiveBytes when the durable stdout is shorter than ingested bytes", async () => {
  const stdout = createMemoryLogSink();
  const evidence = Array.from({ length: 20 }, (_, i) => `AION-EVIDENCE step ${i}\n`).join("");
  const payload = `starting work\n-----BEGIN PRIVATE KEY-----\n${evidence}`;
  const fs = memoryFs();
  const result = await executeRun(request(), {
    clock: createFixedClock(AFTER),
    fs,
    spawn: (exe, argv, options, permit) => {
      fs.writeDurable(join(RUN_ROOT, "handoff.json"), JSON.stringify(goodHandoff()));
      return trackingSpawn(() => exitingProcess({ stdout: payload }))(exe, argv, options, permit);
    },
    git: matchingGit(),
    probe: sequentialProbe([foundObservation(RECORDED), HOLDER_GONE]),
    capacity: memoryCapacity(),
    leases: memoryLeases(),
    wait: (ms) => new Promise((resolve) => {
      setTimeout(resolve, Math.min(ms, 30));
    }),
    killTree: () => undefined,
    scanOrphans: () => [],
    resolveArtifactPath: (absolutePath) => absolutePath,
    logSinks: { stdout, stderr: createMemoryLogSink() },
    ...matchingDiscovery(),
  });
  assert.ok(result.log, "run must produce a log report");
  const durable = stdout.contents();
  const runBytesIn = result.log.runBytesIn;
  assert.ok(runBytesIn > 0, "executor bytes must have been ingested");
  assert.ok(durable.length < runBytesIn, `durable=${durable.length} runBytesIn=${runBytesIn}`);
  assert.ok(
    result.log.stdout.droppedLiveBytes > 0 || result.log.stdout.droppedFileBytes > 0,
    `durable=${durable.length} runBytesIn=${runBytesIn} droppedLive=${result.log.stdout.droppedLiveBytes}`,
  );
});

// ---------------------------------------------------------------------------
// F4 — isFile unreadability is not absence
// ---------------------------------------------------------------------------

test("F4 executeRun treats EBUSY on result.json as unreadable and does not spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const base = memoryFs();
  const busy = new Error("EBUSY");
  (busy as NodeJS.ErrnoException).code = "EBUSY";
  const fs: RunFileSystemV1 = {
    ...base,
    isFile(path) {
      if (path.endsWith("result.json")) throw busy;
      return base.isFile(path);
    },
  };
  const result = await runWith({ fs, spawn });
  assert.equal(result.spawned, false, result.reason);
  assert.match(result.reason, /unreadable/i);
  assert.equal(spawn.calls, 0);
});

test("F4 ENOENT on result.json is still absence and a first run may spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({ spawn });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(spawn.calls, 1);
});

test("F4 statErrorMeansAbsent is true only for ENOENT and ENOTDIR", () => {
  const enoent = Object.assign(new Error("gone"), { code: "ENOENT" });
  const enotdir = Object.assign(new Error("notdir"), { code: "ENOTDIR" });
  const ebusy = Object.assign(new Error("busy"), { code: "EBUSY" });
  const eacces = Object.assign(new Error("denied"), { code: "EACCES" });
  const bare = new Error("no code");
  assert.equal(statErrorMeansAbsent(enoent), true);
  assert.equal(statErrorMeansAbsent(enotdir), true);
  assert.equal(statErrorMeansAbsent(ebusy), false);
  assert.equal(statErrorMeansAbsent(eacces), false);
  assert.equal(statErrorMeansAbsent(bare), false);
});

// ---------------------------------------------------------------------------
// F5 — NON_WRITING_ROLES partition
// ---------------------------------------------------------------------------

test("F5 ROLE_KIND partitions ROUTING exactly into WRITE, NON_WRITING, and LOCAL", () => {
  const routed = Object.keys(ROUTING).sort();
  const classified = Object.keys(ROLE_KIND).sort();
  assert.deepEqual(classified, routed);
  const write = [...WRITE_ROLES].sort();
  const nonWriting = [...NON_WRITING_ROLES].sort();
  const overlap = write.filter((role) => NON_WRITING_ROLES.has(role as ExecutorRoleV1));
  assert.deepEqual(overlap, []);
  for (const role of nonWriting) {
    assert.equal(ROLE_KIND[role as ExecutorRoleV1], "NON_WRITING");
  }
});

test("F5 every non-writing role gets plan and no --always-approve, and HEAD movement fails the review conjunct", () => {
  for (const role of NON_WRITING_ROLES) {
    const argv = executorArgvFor("grok", { promptPath: PROMPT, cwd: CWD, role });
    assert.ok(argv, role);
    const mode = argv!.indexOf("--permission-mode");
    assert.ok(mode >= 0, role);
    assert.equal(argv![mode + 1], "plan", role);
    assert.equal(argv!.includes("--always-approve"), false, role);
    const conjunction = evaluateSuccessConjunction(conjunctionInput({ role }));
    const review = conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
    assert.equal(review?.ok, false, role);
    assert.match(review?.reason ?? "", new RegExp(role));
  }
});

test("F5 an unenumerated role reaching executeRun is refused, not defaulted", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    spawn,
    request: { role: "NOT_A_ROLE" as unknown as ExecutorRoleV1 },
  });
  assert.equal(result.spawned, false, result.reason);
  assert.match(result.reason, /enumerated executor role/);
  assert.equal(spawn.calls, 0);
});

// ---------------------------------------------------------------------------
// F6 — pre-spawn refusal records the real role and does not invent a HEAD evaluation
// ---------------------------------------------------------------------------

function launchBase(): LaunchRunRequestV1 {
  return {
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    executor: "grok",
    worktree: CWD,
    branch: "executor/oracle",
    cwd: CWD,
    runNonce: NONCE,
    runRoot: RUN_ROOT,
    promptPath: PROMPT,
    timeoutMs: 30_000,
    lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-1" },
    authorisedProductionMutated: false,
  };
}

async function refusedLaunch(role: ExecutorRoleV1) {
  const fs = memoryFs();
  const result = await launchRun(
    { ...launchBase(), role },
    {
      clock: createFixedClock(NOW),
      fs,
      spawn: trackingSpawn(() => exitingProcess()),
      git: matchingGit(),
      probe: sequentialProbe([HOLDER_GONE]),
      capacity: memoryCapacity(),
      leases: memoryLeases(),
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: () => [],
      discoveryEnv: {},
      discoveryFs: { isFile: () => false, readDir: () => [] },
    },
  );
  const raw = fs.files.get(join(RUN_ROOT, "result.json"));
  assert.ok(raw, "result.json must be persisted");
  return JSON.parse(raw) as {
    spawned: boolean;
    conjunction: { findings: ReadonlyArray<{ name: string; ok: boolean; reason: string }> };
  };
}

test("F6 pre-spawn refusal for ADVERSARIAL_REVIEW names the role and does not claim it is not a review", async () => {
  const persisted = await refusedLaunch("ADVERSARIAL_REVIEW");
  assert.equal(persisted.spawned, false);
  const review = persisted.conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
  assert.ok(review);
  assert.match(review.reason, /ADVERSARIAL_REVIEW/);
  assert.match(review.reason, /no process was created/);
  assert.doesNotMatch(review.reason, /role is not a review/);
});

test("F6 pre-spawn refusal for IMPLEMENT names the role and does not claim it is not a write role", async () => {
  const persisted = await refusedLaunch("IMPLEMENT");
  assert.equal(persisted.spawned, false);
  const write = persisted.conjunction.findings.find((item) => item.name === "writeMovedHead");
  assert.ok(write);
  assert.match(write.reason, /IMPLEMENT/);
  assert.match(write.reason, /no process was created/);
  assert.doesNotMatch(write.reason, /role is not a write role/);
});

// ---------------------------------------------------------------------------
// F8 — hanging stdio cannot keep the Director alive
// ---------------------------------------------------------------------------

test("F8 executeRun destroys hanging stdout/stderr and keeps the bytes already written", async () => {
  const stdout = new Readable({ read() { /* never ends */ } });
  const stderr = new Readable({ read() { /* never ends */ } });
  const handle: SpawnHandleV1 = {
    pid: RECORDED.pid,
    stdout,
    stderr,
    kill() {
      // unused
    },
    exit: Promise.resolve({ code: 0, signal: null }),
    get exited() {
      return true;
    },
  };
  const fs = memoryFs();
  const result = await executeRun(request(), {
    clock: createFixedClock(AFTER),
    fs,
    spawn: trackingSpawn(() => {
      fs.writeDurable(join(RUN_ROOT, "handoff.json"), JSON.stringify(goodHandoff()));
      queueMicrotask(() => {
        stdout.push("bytes before hang\n");
      });
      return handle;
    }),
    git: matchingGit(),
    probe: sequentialProbe([foundObservation(RECORDED), HOLDER_GONE]),
    capacity: memoryCapacity(),
    leases: memoryLeases(),
    wait: (ms) => new Promise((resolve) => {
      setTimeout(resolve, Math.min(ms, 30));
    }),
    killTree: () => undefined,
    scanOrphans: () => [],
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  });
  assert.equal(typeof result.ok, "boolean");
  assert.equal(stdout.destroyed, true);
  assert.equal(stderr.destroyed, true);
  assert.ok(result.log, "bounded log must exist");
  assert.ok(result.log.runBytesIn >= Buffer.byteLength("bytes before hang\n", "utf8"));
});
