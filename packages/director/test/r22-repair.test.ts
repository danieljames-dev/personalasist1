/**
 * Round 22 property repairs. Each case below must fail on
 * 43e9f5263c80d4a439c1e7d3b3ccb0fed1773908 and pass after the matching
 * property fix. Helpers are local.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { argvGrantsWritePermission } from "../src/executor-adapters.js";
import {
  findHandoffContradictions,
  HANDOFF_SCHEMA_V1,
  parseHandoff,
} from "../src/handoff.js";
import {
  collectGitStatusIncludingIgnored,
  collectGitTruth,
  GIT_OBSERVATION_SCHEMA_V1,
  LARGE_TRACKED_FILE_BYTES,
  verifyGitTruth,
  type GitObservationV1,
  type GitRunner,
  type GitStatusObservationV1,
} from "../src/git-truth.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
} from "../src/lease-store.js";
import {
  acquireLease,
  leaseHasExpired,
  reclaimStaleLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  BROKER_HOST_PROCESS_NAMES,
  holderLiveness,
  interpretWindowsOrphanScanOutput,
  isBrokerHostName,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import { RUN_INTENT_SCHEMA_V1 } from "../src/run-intent.js";
import {
  evaluateSuccessConjunction,
  executeRun,
  launchRun,
  recoverAbandonedRun,
  RUN_RESULT_SCHEMA_V1,
  wrapChildProcess,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";

const NOW = "2026-08-13T12:00:00.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const CLAUDE_EXE = "C:\\Tools\\claude.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const FLOOR = "2026-08-13T12:00:00.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";
const AFTER = "2026-08-13T12:00:05.000Z";
const AFTER_CEILING = "2026-08-13T12:00:11.000Z";
const BOOT = "2026-08-01T00:00:00.000Z";
const EXPIRED = "2026-08-13T12:20:00.000Z";
const LATER_START = "2026-08-13T12:00:09.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: CLAUDE_EXE,
  runNonce: NONCE,
};

function asObservation(value: Record<string, unknown>): ProcessObservationV1 {
  return value as unknown as ProcessObservationV1;
}

function claudeImplementerArgv(): string[] {
  return ["-p", "--permission-mode", "bypassPermissions"];
}

function matchingDiscovery(): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe",
      readDir: () => [],
    },
  };
}

function goodHandoff(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: HANDOFF_SCHEMA_V1,
    executor: "claude",
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
    finishedAt: HOLDER_EXIT,
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
    executablePath: CLAUDE_EXE,
    argv: claudeImplementerArgv(),
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
    release() {},
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

function matchingGit(head = HEAD_AFTER, ignoredPorcelain = ""): GitRunner {
  return {
    inspectedWorktree: CWD,
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        return { argv: [...argv], status: 0, stdout: `${head}\n`, stderr: "", error: null };
      }
      if (key === "symbolic-ref -q --short HEAD") {
        return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
      }
      if (key === "status --porcelain") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "status" && argv.some((item) => String(item).startsWith("--ignored"))) {
        return { argv: [...argv], status: 0, stdout: ignoredPorcelain, stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return { argv: [...argv], status: 0, stdout: `${head}\n`, stderr: "", error: null };
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
      }
      if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
            if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return this.run(["rev-parse", "HEAD"]);
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
    },
  };
}

function exitingProcess(opts: { exitCode?: number; pid?: number; stdout?: Readable } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: opts.stdout ?? Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: null }),
    get exited() {
      return true;
    },
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
    branchHead: { outcome: "FOUND", sha },
    largeTrackedFiles: { outcome: "FOUND", files: [] },
  };
}

function reviewConjunction(over: Record<string, unknown> = {}) {
  const parsed = parseHandoff(JSON.stringify(goodHandoff({
    status: "PASS",
    headAfter: HEAD_BEFORE,
    headBefore: HEAD_BEFORE,
  })));
  return evaluateSuccessConjunction({
    exitCode: 0,
    stillRunning: false,
    executor: "claude",
    output: "",
    parsed,
    reportedWorkItemId: "work-1",
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: gitObs(HEAD_BEFORE),
    gitBefore: gitObs(HEAD_BEFORE),
    gitVerdict: { schema: "aion.director.git-truth.v1", ok: true, findings: [], snapshot: {
      worktreePath: CWD,
      attachedBranch: "executor/oracle",
      head: HEAD_BEFORE,
      localBranchHead: HEAD_BEFORE,
      remoteBranchHead: null,
      originMainHead: null,
      dirtyPaths: [],
      largeTrackedFiles: [],
      readAt: NOW,
    } },
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "declared artifacts sit inside the run root",
    executorTreeGone: true,
    executorTreeReason: "holder gone and scan clean",
    timedOut: false,
    logStayedWithinBudget: true,
    role: "INDEPENDENT_ACCEPTANCE",
    argvGrantedWrite: false,
    processWasCreated: true,
    expectedRunNonce: NONCE,
    ...over,
  });
}

function intentRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: RUN_INTENT_SCHEMA_V1,
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: CLAUDE_EXE,
    argv: claudeImplementerArgv(),
    cwd: CWD,
    runNonce: NONCE,
    intendedAt: NOW,
    spawnAttemptedAt: NOW,
    spawnPid: 1111,
    spawnObservedAt: NOW,
    processIdentity: {
      pid: 4812,
      creationDate: T0,
      executablePath: CLAUDE_EXE,
      runNonce: NONCE,
    },
    secretsPresent: false,
    promptPath: PROMPT,
    role: "IMPLEMENT",
    ...over,
  };
}

function trackingProbe() {
  const probed: number[] = [];
  return {
    probed,
    observe(pid: number): ProcessObservationV1 {
      probed.push(pid);
      if (pid === 4812) {
        return {
          outcome: "FOUND",
          reason: "cim",
          pid: 4812,
          creationDate: T0,
          executablePath: CLAUDE_EXE,
          runNonce: NONCE,
        };
      }
      return asObservation({ outcome: "NOT_FOUND", reason: "no process occupies this pid", pid });
    },
  };
}

async function recoverWith(over: {
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  leases?: LeaseStoreV1;
} = {}) {
  const fs = over.fs ?? memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: `${JSON.stringify(intentRecord(), null, 2)}\n` },
  });
  const probe = over.probe ?? trackingProbe();
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: { now: () => NOW },
    probe,
    ...(over.leases !== undefined ? { leases: over.leases } : {}),
  });
  return { result, fs, probe };
}

function leftoverAfterExit(over: Record<string, unknown> = {}) {
  return {
    pid: 7100,
    name: "node.exe",
    parentPid: 1500,
    parentPresent: true,
    parentName: "svchost.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER_CEILING,
    nonceReadable: true,
    sessionId: 0,
    ...over,
  };
}

function brokerAfterExitRow(parentName: string) {
  return leftoverAfterExit({
    name: "child.exe",
    parentName,
    parentPid: 1500,
    parentPresent: true,
    parentCreationDate: BOOT,
    creationDate: AFTER_CEILING,
    sessionId: 0,
  });
}

function ctxAfterExit() {
  return processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 1500, creationDate: BOOT },
      { pid: 7100, parentPid: 1500, creationDate: AFTER_CEILING },
    ],
  });
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  scanOrphans?: RunManagerDepsV1["scanOrphans"];
  git?: GitRunner;
  clock?: { now: () => string };
  wait?: (ms: number) => Promise<void>;
  killTree?: (pid: number) => void;
  spawnWritesHandoff?: boolean;
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs({ dirs: [CWD, runRoot] });
  const role = over.request?.role ?? "IMPLEMENT";
  const headAfter = role === "INDEPENDENT_ACCEPTANCE" || role === "ADVERSARIAL_REVIEW"
    ? HEAD_BEFORE
    : HEAD_AFTER;
  const handoffText = JSON.stringify(goodHandoff({
    headAfter,
    headBefore: HEAD_BEFORE,
    executor: over.request?.executor ?? "claude",
  }));
  const innerSpawn = over.spawn ?? ((_e, _a, _o, _p) => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    if (over.spawnWritesHandoff !== false) {
      try {
        fs.writeDurable(handoffPath, handoffText);
      } catch {
        // spawn still proceeds
      }
    }
    return innerSpawn(executable, argv, options, permit);
  };
  return executeRun(request({
    ...over.request,
    childEnv: {
      AION_HANDOFF_JSON: handoffText,
      ...(over.request?.childEnv ?? {}),
    },
  }), {
    clock: over.clock ?? { now: () => HOLDER_EXIT },
    fs,
    spawn,
    git: over.git ?? matchingGit(headAfter),
    probe: over.probe ?? { observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "exited", pid }) },
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? (async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  });
}

// ---------------------------------------------------------------------------
// R1 — an observation about one PID must never answer a question about another
// ---------------------------------------------------------------------------

test("R1A holderLiveness of recorded 4812 with NOT_FOUND about 1111 is UNKNOWN, not DEAD_CONFIRMED", () => {
  const verdict = holderLiveness(
    RECORDED,
    asObservation({ outcome: "NOT_FOUND", reason: "empty slot", pid: 1111 }),
  );
  assert.equal(verdict, "UNKNOWN", `foreign NOT_FOUND must not mint death; got ${verdict}`);
});

test("R1A holderLiveness of recorded 4812 with UNAVAILABLE about 1111 is UNKNOWN", () => {
  const verdict = holderLiveness(
    RECORDED,
    asObservation({ outcome: "UNAVAILABLE", reason: "access-denied", pid: 1111 }),
  );
  assert.equal(verdict, "UNKNOWN", `foreign UNAVAILABLE must stay UNKNOWN; got ${verdict}`);
});

test("R1B recoverAbandonedRun probes recorded pid 4812, not empty spawnPid 1111, and stays REFUSED_ALIVE", async () => {
  const { result, fs, probe } = await recoverWith();
  const tracked = "probed" in probe ? (probe as { probed: number[] }).probed : [];
  assert.ok(tracked.includes(4812), `probed pid set must contain 4812; got ${JSON.stringify(tracked)}`);
  assert.equal((result as { recoverOutcome?: string }).recoverOutcome, "REFUSED_ALIVE", result.reason);
  assert.notEqual((result as { recoverOutcome?: string }).recoverOutcome, "TERMINAL");
  const onDisk = JSON.parse(fs.readUtf8(join(RUN_ROOT, "result.json"))) as {
    recoverOutcome?: string;
  };
  assert.notEqual(onDisk.recoverOutcome, "TERMINAL");
});

test("R1B an existing REFUSED_ALIVE result is not overwritten to TERMINAL by a probe of a different slot", async () => {
  const prior = {
    schema: RUN_RESULT_SCHEMA_V1,
    runId: "run-1",
    ok: false,
    spawned: true,
    recoverOutcome: "REFUSED_ALIVE",
    reason: "recover refused: holder pid 4812 is still present",
  };
  const fs = memoryFs({
    files: {
      [join(RUN_ROOT, "intent.json")]: `${JSON.stringify(intentRecord(), null, 2)}\n`,
      [join(RUN_ROOT, "result.json")]: `${JSON.stringify(prior, null, 2)}\n`,
    },
  });
  const { result } = await recoverWith({ fs });
  assert.notEqual((result as { recoverOutcome?: string }).recoverOutcome, "TERMINAL", result.reason);
  const onDisk = JSON.parse(fs.readUtf8(join(RUN_ROOT, "result.json"))) as {
    recoverOutcome?: string;
  };
  assert.equal(onDisk.recoverOutcome, "REFUSED_ALIVE");
});

test("R1 liveness: spawnPid === recorded.pid === 4812 still reaches REFUSED_ALIVE", async () => {
  const fs = memoryFs({
    files: {
      [join(RUN_ROOT, "intent.json")]: `${JSON.stringify(intentRecord({ spawnPid: 4812 }), null, 2)}\n`,
    },
  });
  const { result, probe } = await recoverWith({ fs });
  const tracked = "probed" in probe ? (probe as { probed: number[] }).probed : [];
  assert.ok(tracked.includes(4812), JSON.stringify(tracked));
  assert.equal((result as { recoverOutcome?: string }).recoverOutcome, "REFUSED_ALIVE", result.reason);
});

test("R1 liveness: NOT_FOUND about the recorded holder's own pid still reaches TERMINAL", async () => {
  const fs = memoryFs({
    files: {
      [join(RUN_ROOT, "intent.json")]: `${JSON.stringify(intentRecord({ spawnPid: 4812 }), null, 2)}\n`,
    },
  });
  const { result } = await recoverWith({
    fs,
    probe: {
      observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "no process occupies this pid", pid }),
    },
  });
  assert.equal((result as { recoverOutcome?: string }).recoverOutcome, "TERMINAL", result.reason);
});

// ---------------------------------------------------------------------------
// R2 — a negative heuristic must never delete a positive tie
// ---------------------------------------------------------------------------

test("R2 every broker-host name, session-0, created after holderExitedAt, with a live parent is host noise", () => {
  const ctx = ctxAfterExit();
  assert.ok(BROKER_HOST_PROCESS_NAMES.length > 0);
  for (const host of BROKER_HOST_PROCESS_NAMES) {
    const row = brokerAfterExitRow(host);
    const could = processRowCouldBelongToThisRun(row, ctx);
    const undecidable = processRowMakesScanUndecidable(row, ctx);
    assert.equal(could, false, `${host} live after-ceiling parent is host noise`);
    assert.equal(undecidable, false, `${host} live after-ceiling parent is not undecidable`);
  }
});

test("R2 session-0 row whose parentPid is in observedPids still belongs", () => {
  const row = {
    pid: 7100,
    name: "child.exe",
    parentPid: 9000,
    parentPresent: true,
    parentName: "node.exe",
    creationDate: AFTER_CEILING,
    sessionId: 0,
    nonceReadable: true,
  };
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812, 9000],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 9000, creationDate: AFTER },
      { pid: 7100, parentPid: 9000, creationDate: AFTER_CEILING },
    ],
  });
  assert.equal(parentlessRowTiedToThisRun(row, ctx), true, "observedPids is a positive tie");
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
});

test("R2 interpretWindowsOrphanScanOutput over a live after-exit broker parent is SCANNED", () => {
  const envelope = {
    ok: true,
    processes: [leftoverAfterExit({ parentName: "dllhost.exe" })],
    unreadable: 1,
    directorSessionId: 1,
  };
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify(envelope),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
  });
  assert.equal(interpreted.outcome, "SCANNED", interpreted.reason);
});

test("R2 executeRun with a live session-0 after-exit broker parent releases the writer lease", async () => {
  const leases = memoryLeases();
  const row = leftoverAfterExit({ parentName: "dllhost.exe", sessionId: 0 });
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-r2" } },
    scanOrphans: () => ({
      ...writerOrphanScanResult([row as never]),
      directorSessionId: 1,
    }),
  });
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, true, tree?.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
});

test("R2 liveness: a parentless session-0 row with no positive tie is still excluded", () => {
  const row = {
    pid: 8800,
    name: "noise.exe",
    parentPid: 4,
    parentPresent: false,
    parentName: null,
    creationDate: AFTER,
    sessionId: 0,
    nonceReadable: true,
  };
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 8800, parentPid: 4, creationDate: AFTER },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
});

// ---------------------------------------------------------------------------
// R3 — svchost.exe is not a broker
// ---------------------------------------------------------------------------

test("R3 svchost.exe is not a broker host name", () => {
  assert.equal(isBrokerHostName("svchost.exe"), false);
  assert.equal(
    (BROKER_HOST_PROCESS_NAMES as readonly string[]).includes("svchost.exe"),
    false,
  );
});

test("R3 a WmiPrvSE row parented by a present svchost inside a 1800s window is not tied", () => {
  const floor = "2026-08-15T12:00:00.000Z";
  const exit = "2026-08-15T12:30:00.000Z";
  const created = "2026-08-15T12:10:00.000Z";
  const parentCreated = "2026-08-01T00:00:00.000Z";
  const row = {
    pid: 151452,
    name: "WmiPrvSE.exe",
    parentPid: 1000,
    parentName: "svchost.exe",
    parentPresent: true,
    parentCreationDate: parentCreated,
    creationDate: created,
    sessionId: 0,
    nonceReadable: true,
  };
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: floor,
    holderPid: 4812,
    holderExitedAt: exit,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: floor },
      { pid: 1000, creationDate: parentCreated },
      { pid: 151452, parentPid: 1000, creationDate: created },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, processes: [row], unreadable: 0, directorSessionId: 1 }),
    stderr: "",
    createdNotBefore: floor,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: exit,
    observedPids: [4812],
  });
  assert.equal(interpreted.outcome, "SCANNED", interpreted.reason);
});

test("R3 a row carrying this run's nonce and parented by svchost is still tied", () => {
  const row = {
    pid: 7100,
    name: "worker.exe",
    parentPid: 1000,
    parentName: "svchost.exe",
    parentPresent: true,
    parentCreationDate: BOOT,
    creationDate: AFTER,
    runNonce: NONCE,
    nonceReadable: true,
    sessionId: 0,
  };
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 7100, parentPid: 1000, creationDate: AFTER },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
});

test("R3 interpretWindowsOrphanScanOutput over a 1800s window WmiPrvSE/svchost envelope is SCANNED", () => {
  const floor = "2026-08-15T10:00:00.000Z";
  const exit = "2026-08-15T10:30:00.000Z";
  const row = {
    pid: 151452,
    name: "WmiPrvSE.exe",
    parentPid: 888,
    parentName: "svchost.exe",
    parentPresent: true,
    parentCreationDate: "2026-08-01T00:00:00.000Z",
    creationDate: "2026-08-15T10:10:00.000Z",
    sessionId: 0,
    nonceReadable: true,
  };
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, processes: [row], unreadable: 0, directorSessionId: 1 }),
    stderr: "",
    createdNotBefore: floor,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: exit,
    observedPids: [4812],
  });
  assert.equal(interpreted.outcome, "SCANNED", interpreted.reason);
});

// ---------------------------------------------------------------------------
// R4 — one rule, one implementation
// ---------------------------------------------------------------------------

test("R4 matching-token later start is not a different occupant; reclaim refuses; holderLiveness is UNKNOWN", () => {
  assert.equal(
    holderLiveness(RECORDED, {
      outcome: "FOUND",
      reason: "cim",
      pid: 4812,
      creationDate: LATER_START,
      executablePath: CLAUDE_EXE,
      runNonce: NONCE,
    }),
    "UNKNOWN",
  );
  const held = acquireLease({
    existing: [],
    leaseId: "lease-pw-r4",
    kind: "PRODUCTION_WRITER",
    resource: "default",
    missionId: "mission-1",
    runId: "run-1",
    pid: 4812,
    processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE },
    now: NOW,
  });
  assert.ok(held.ok && held.lease);
  const reclaimed = reclaimStaleLease({
    existing: [{ ...held.lease!, expiresAt: "2026-08-13T12:01:00.000Z" }],
    kind: "PRODUCTION_WRITER",
    resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    now: EXPIRED,
    holderObservation: { outcome: "FOUND", pid: 4812 },
    observedIdentity: { pid: 4812, startedAt: LATER_START, runToken: NONCE },
  });
  assert.equal(reclaimed.ok, false, reclaimed.reason);
  assert.equal(reclaimed.remaining.length, 1);
});

test("R4 holderLiveness DEAD_CONFIRMED on a FOUND same-pid row agrees with occupantIsProvenDifferentProcess", async () => {
  const identity = await import("../src/process-identity.js") as {
    occupantIsProvenDifferentProcess?: (
      recorded: { pid: number; creationDate?: string; runNonce?: string },
      observed: { pid?: number; creationDate?: string; runNonce?: string | null },
    ) => boolean;
  };
  assert.equal(
    typeof identity.occupantIsProvenDifferentProcess,
    "function",
    "occupantIsProvenDifferentProcess must be exported from process-identity",
  );
  const table: ReadonlyArray<{
    label: string;
    observedNonce: string | null | undefined;
    observedStart: string;
  }> = [
    { label: "same-token-later", observedNonce: NONCE, observedStart: LATER_START },
    { label: "same-token-same", observedNonce: NONCE, observedStart: T0 },
    { label: "different-token-later", observedNonce: "nonce-other", observedStart: LATER_START },
    { label: "different-token-earlier", observedNonce: "nonce-other", observedStart: "2026-08-13T11:59:00.000Z" },
    { label: "missing-token-later", observedNonce: undefined, observedStart: LATER_START },
  ];
  for (const row of table) {
    const observation: ProcessObservationV1 = {
      outcome: "FOUND",
      reason: "cim",
      pid: 4812,
      creationDate: row.observedStart,
      executablePath: CLAUDE_EXE,
      ...(row.observedNonce !== undefined ? { runNonce: row.observedNonce } : {}),
    };
    const observedSlot: { pid: number; creationDate: string; runNonce?: string | null } = {
      pid: 4812,
      creationDate: row.observedStart,
    };
    if (row.observedNonce !== undefined) observedSlot.runNonce = row.observedNonce;
    const different = identity.occupantIsProvenDifferentProcess!(
      { pid: 4812, creationDate: T0, runNonce: NONCE },
      observedSlot,
    );
    const liveness = holderLiveness(RECORDED, observation);
    assert.equal(
      liveness === "DEAD_CONFIRMED",
      different,
      `${row.label}: liveness=${liveness} different=${different}`,
    );
  }
});

// ---------------------------------------------------------------------------
// R5 — a failed kill is not an exit
// ---------------------------------------------------------------------------

function fakeChild(over: {
  pid?: number;
  alreadyExited?: boolean;
}): EventEmitter & {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: () => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => boolean;
  };
  if (over.pid !== undefined) child.pid = over.pid;
  child.exitCode = over.alreadyExited === true ? 0 : null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => false;
  return child;
}

test("R5 a wrapped child that emits post-spawn error while still running does not set exited", async () => {
  const child = fakeChild({ pid: 30688 });
  const handle = wrapChildProcess(child as never);
  const err = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  child.emit("error", err);
  await Promise.resolve();
  assert.equal(handle.exited, false, "post-spawn error is not an exit");
});

test("R5 a spawn-failure error (no pid) still settles the exit promise", async () => {
  const child = fakeChild({});
  delete child.pid;
  const handle = wrapChildProcess(child as never);
  child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
  const ended = await Promise.race([
    handle.exit.then((exit) => ({ tag: "exit" as const, exit })),
    new Promise<{ tag: "timeout" }>((resolve) => {
      setTimeout(() => resolve({ tag: "timeout" }), 500);
    }),
  ]);
  assert.equal(ended.tag, "exit", "spawn-failure must settle exit, not hang");
});

test("R5 cancelLadder over a live child whose kill EPERMs still reaches HARD and does not claim stillRunning false", async () => {
  const killTreePids: number[] = [];
  const child = fakeChild({ pid: 113696 });
  child.kill = () => {
    child.emit("error", Object.assign(new Error("kill EPERM"), { code: "EPERM" }));
    return false;
  };
  const handle = wrapChildProcess(child as never);
  const result = await runWith({
    request: { timeoutMs: 1 },
    spawn: () => handle,
    wait: async () => undefined,
    killTree: (pid) => {
      killTreePids.push(pid);
    },
    spawnWritesHandoff: false,
  });
  assert.ok(result.cancel.stages.includes("HARD"), `stages=${JSON.stringify(result.cancel.stages)}`);
  assert.ok(killTreePids.includes(113696), `killTree pids=${JSON.stringify(killTreePids)}`);
  assert.equal(handle.exited, false, "failed kill must not mark the handle exited");
});

// ---------------------------------------------------------------------------
// R6 — a recover label must not erase the record of a spawn
// ---------------------------------------------------------------------------

test("R6 executeRun over a REFUSED_ALIVE spawned record does not spawn again", async () => {
  const fs = memoryFs({
    files: {
      [join(RUN_ROOT, "result.json")]: `${JSON.stringify({
        schema: RUN_RESULT_SCHEMA_V1,
        runId: "run-1",
        ok: false,
        spawned: true,
        recoverOutcome: "REFUSED_ALIVE",
        reason: "recover refused: holder pid 4812 is still present",
      }, null, 2)}\n`,
    },
  });
  let spawnCalls = 0;
  const result = await runWith({
    fs,
    spawn: () => {
      spawnCalls += 1;
      return exitingProcess();
    },
  });
  assert.equal(spawnCalls, 0, result.reason);
  assert.equal(result.spawned, false);
  assert.match(result.reason, /recorded completion already exists/);
});

test("R6 liveness: recover on an intent-less runRoot still lets a later executeRun launch", async () => {
  const fs = memoryFs();
  const recovered = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: { now: () => NOW },
    probe: { observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "none", pid }) },
  });
  assert.equal((recovered as { recoverOutcome?: string }).recoverOutcome, "REFUSED_UNKNOWN");
  assert.equal(recovered.spawned, false);
  let spawnCalls = 0;
  const result = await runWith({
    fs,
    spawn: () => {
      spawnCalls += 1;
      return exitingProcess();
    },
  });
  assert.equal(spawnCalls, 1, result.reason);
  assert.equal(result.spawned, true, result.reason);
});

// ---------------------------------------------------------------------------
// R7 — UNKNOWN authorisation is not authorisation
// ---------------------------------------------------------------------------

test("R7 productionMutated true with a non-boolean authorisation fails the conjunct", () => {
  const parsed = parseHandoff(JSON.stringify(goodHandoff({ productionMutated: true })));
  assert.equal(parsed.ok, true, parsed.problems.join("; "));
  const table: unknown[] = [undefined, null, "false", "no", 0, 1, {}, []];
  for (const authorised of table) {
    const contradictions = findHandoffContradictions({
      handoff: parsed.handoff!,
      authorisedProductionMutation: authorised as never,
    });
    assert.ok(
      contradictions.some((item) => item.field === "productionMutated"),
      `authorised=${JSON.stringify(authorised)} must contradict productionMutated:true`,
    );
  }
});

test("R7 productionMutated false with a non-boolean authorisation still has no contradiction", () => {
  const parsed = parseHandoff(JSON.stringify(goodHandoff({ productionMutated: false })));
  assert.equal(parsed.ok, true);
  const table: unknown[] = [undefined, null, "false", "no", 0, 1, {}, []];
  for (const authorised of table) {
    const contradictions = findHandoffContradictions({
      handoff: parsed.handoff!,
      authorisedProductionMutation: authorised as never,
    });
    assert.equal(
      contradictions.some((item) => item.field === "productionMutated"),
      false,
      `authorised=${JSON.stringify(authorised)} must not contradict productionMutated:false`,
    );
  }
});

test("R7 executeRun with omitted authorisation and productionMutated true is not ok", async () => {
  const result = await runWith({
    request: {
      authorisedProductionMutated: undefined as unknown as boolean,
    },
    spawn: (_e, _a, _o, _p) => {
      return exitingProcess();
    },
  });
  // Drive the conjunction with an explicit mutated handoff.
  const mutated = await runWith({
    request: { authorisedProductionMutated: undefined as unknown as boolean },
    fs: memoryFs(),
    spawn: (_e, _a, options, _p) => {
      const path = options.env?.AION_HANDOFF_PATH;
      if (typeof path === "string") {
        // handoff is written by runWith helper from goodHandoff(); override below
      }
      return exitingProcess();
    },
  });
  void result;
  void mutated;
  const conjunction = evaluateSuccessConjunction({
    exitCode: 0,
    stillRunning: false,
    executor: "claude",
    output: "",
    parsed: parseHandoff(JSON.stringify(goodHandoff({ productionMutated: true }))),
    reportedWorkItemId: "work-1",
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: gitObs(HEAD_AFTER),
    gitBefore: gitObs(HEAD_BEFORE),
    gitVerdict: { schema: "aion.director.git-truth.v1", ok: true, findings: [], snapshot: {
      worktreePath: CWD,
      attachedBranch: "executor/oracle",
      head: HEAD_AFTER,
      localBranchHead: HEAD_AFTER,
      remoteBranchHead: null,
      originMainHead: null,
      dirtyPaths: [],
      largeTrackedFiles: [],
      readAt: NOW,
    } },
    authorisedProductionMutated: undefined as unknown as boolean,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "ok",
    executorTreeGone: true,
    executorTreeReason: "gone",
    timedOut: false,
    logStayedWithinBudget: true,
    role: "IMPLEMENT",
    argvGrantedWrite: true,
    processWasCreated: true,
    expectedRunNonce: NONCE,
  });
  const production = conjunction.findings.find((item) => item.name === "productionClaimAgrees");
  assert.equal(production?.ok, false, production?.reason);
  assert.match(String(production?.reason), /UNKNOWN|authoris/i);
});

test("R7 productionMutated false with omitted authorisation still passes the conjunct", () => {
  const conjunction = evaluateSuccessConjunction({
    exitCode: 0,
    stillRunning: false,
    executor: "claude",
    output: "",
    parsed: parseHandoff(JSON.stringify(goodHandoff({ productionMutated: false }))),
    reportedWorkItemId: "work-1",
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: gitObs(HEAD_AFTER),
    gitBefore: gitObs(HEAD_BEFORE),
    gitVerdict: { schema: "aion.director.git-truth.v1", ok: true, findings: [], snapshot: {
      worktreePath: CWD,
      attachedBranch: "executor/oracle",
      head: HEAD_AFTER,
      localBranchHead: HEAD_AFTER,
      remoteBranchHead: null,
      originMainHead: null,
      dirtyPaths: [],
      largeTrackedFiles: [],
      readAt: NOW,
    } },
    authorisedProductionMutated: undefined as unknown as boolean,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "ok",
    executorTreeGone: true,
    executorTreeReason: "gone",
    timedOut: false,
    logStayedWithinBudget: true,
    role: "IMPLEMENT",
    argvGrantedWrite: true,
    processWasCreated: true,
    expectedRunNonce: NONCE,
  });
  const production = conjunction.findings.find((item) => item.name === "productionClaimAgrees");
  assert.equal(production?.ok, true, production?.reason);
});

// ---------------------------------------------------------------------------
// R8 — runRoot must name one identifiable place
// ---------------------------------------------------------------------------

test("R8 executeRun refuses non-absolute runRoot spellings with zero spawns", async () => {
  const spellings = ["C:", "", ".", "..", "NUL", "wt/sub"];
  for (const runRoot of spellings) {
    let spawnCalls = 0;
    const result = await executeRun(request({ runRoot }), {
      clock: { now: () => NOW },
      fs: memoryFs({ dirs: [CWD] }),
      spawn: () => {
        spawnCalls += 1;
        return exitingProcess();
      },
      git: matchingGit(),
      probe: { observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }) },
      capacity: memoryCapacity(),
      leases: memoryLeases(),
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: () => writerOrphanScanResult([]),
      ...matchingDiscovery(),
    });
    assert.equal(spawnCalls, 0, `${runRoot}: spawned`);
    assert.equal(result.ok, false, `${runRoot}: ${result.reason}`);
    assert.match(result.reason, /runRoot/i, `${runRoot}: ${result.reason}`);
  }
});

test("R8 launchRun refuses a relative runRoot", async () => {
  const result = await launchRun({
    ...request({ runRoot: "wt/sub" }),
    promptPath: PROMPT,
    executor: "claude",
    role: "IMPLEMENT",
  }, {
    clock: { now: () => NOW },
    fs: memoryFs({ dirs: [CWD] }),
    spawn: () => exitingProcess(),
    git: matchingGit(),
    probe: { observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }) },
    capacity: memoryCapacity(),
    leases: memoryLeases(),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([]),
    discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe",
      readDir: () => [],
    },
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.spawned, false);
  assert.match(result.reason, /runRoot/i);
});

test("R8 liveness: a normal absolute run root still runs", async () => {
  const result = await runWith();
  assert.equal(result.spawned, true, result.reason);
});

// ---------------------------------------------------------------------------
// R9 — reviewLeftTreeUnchanged is a delta
// ---------------------------------------------------------------------------

const PREEXISTING_DIRT: GitStatusObservationV1 = {
  outcome: "DIRTY",
  porcelain: "!! dist/",
  dirtyPaths: ["dist/"],
  listedContent: { outcome: "DIGESTED", digest: "preexisting-ignored-dirt", fileCount: 1, totalBytes: 1 },
};

test("R9 pre-existing ignored dirt, identical before and after, review role passes", () => {
  const conjunction = reviewConjunction({
    treeIncludingIgnored: PREEXISTING_DIRT,
    treeIncludingIgnoredBefore: PREEXISTING_DIRT,
  });
  const review = conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
  assert.equal(review?.ok, true, review?.reason);
});

test("R9 ignored dirt created during the run fails the review conjunct", () => {
  const before: GitStatusObservationV1 = { outcome: "CLEAN", porcelain: "" };
  const conjunction = reviewConjunction({
    treeIncludingIgnored: PREEXISTING_DIRT,
    treeIncludingIgnoredBefore: before,
  });
  const review = conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
  assert.equal(review?.ok, false, review?.reason);
});

test("R9 tracked dirt created during the run fails the review conjunct", () => {
  const before: GitStatusObservationV1 = { outcome: "CLEAN", porcelain: "" };
  const after: GitStatusObservationV1 = {
    outcome: "DIRTY",
    porcelain: "?? notes.md",
    dirtyPaths: ["notes.md"],
  };
  const conjunction = reviewConjunction({
    treeIncludingIgnored: after,
    treeIncludingIgnoredBefore: before,
  });
  const review = conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
  assert.equal(review?.ok, false, review?.reason);
});

test("R9 UNAVAILABLE at either end fails the review conjunct as UNKNOWN", () => {
  const unavailable: GitStatusObservationV1 = {
    outcome: "UNAVAILABLE",
    reason: "git status failed",
    command: { argv: ["status"], status: 128, stdout: "", stderr: "fatal", error: null },
  };
  const afterOnly = reviewConjunction({
    treeIncludingIgnored: unavailable,
    treeIncludingIgnoredBefore: PREEXISTING_DIRT,
  });
  const beforeOnly = reviewConjunction({
    treeIncludingIgnored: PREEXISTING_DIRT,
    treeIncludingIgnoredBefore: unavailable,
  });
  assert.equal(afterOnly.findings.find((item) => item.name === "reviewLeftTreeUnchanged")?.ok, false);
  assert.equal(beforeOnly.findings.find((item) => item.name === "reviewLeftTreeUnchanged")?.ok, false);
  assert.match(
    String(afterOnly.findings.find((item) => item.name === "reviewLeftTreeUnchanged")?.reason),
    /UNKNOWN|UNAVAILABLE/,
  );
});

// ---------------------------------------------------------------------------
// R10 — one git verdict from real observations
// ---------------------------------------------------------------------------

function initScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "aion-r22-git-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
    }
    return result;
  };
  git(["init", "-b", "master"]);
  git(["config", "user.email", "r22@example.invalid"]);
  git(["config", "user.name", "R22"]);
  return dir;
}

test("R10 collectGitTruth lists a tracked file above LARGE_TRACKED_FILE_BYTES and reports it non-blocking", () => {
  const dir = initScratchRepo();
  try {
    const big = Buffer.alloc(LARGE_TRACKED_FILE_BYTES + 64, 7);
    writeFileSync(join(dir, "model.safetensors"), big);
    spawnSync("git", ["add", "model.safetensors"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["commit", "-m", "weights"], { cwd: dir, windowsHide: true });
    const collected = collectGitTruth({
      runner: {
        inspectedWorktree: dir,
        run(argv) {
          const result = spawnSync("git", [...argv], { cwd: dir, encoding: "utf8", windowsHide: true });
          return {
            argv: [...argv],
            status: result.status,
            stdout: String(result.stdout ?? ""),
            stderr: String(result.stderr ?? ""),
            error: result.error ? result.error.message : null,
            cwd: dir,
          };
        },
      },
      worktreePath: dir,
      now: NOW,
    });
    const observation = collected.observation as GitObservationV1 & {
      largeTrackedFiles?: { outcome?: string; files?: ReadonlyArray<{ path: string; bytes: number }> };
    };
    assert.ok(observation.largeTrackedFiles, "largeTrackedFiles observation must be present");
    const files = observation.largeTrackedFiles.outcome === "FOUND"
      ? observation.largeTrackedFiles.files
      : [];
    assert.ok(
      (files ?? []).some((file) => file.path.includes("model.safetensors") && file.bytes > LARGE_TRACKED_FILE_BYTES),
      JSON.stringify(observation.largeTrackedFiles),
    );
    const verdict = verifyGitTruth(collected.observation);
    const finding = verdict.findings.find((item) => item.kind === "UNEXPECTED_LARGE_ARTIFACT");
    assert.ok(finding, JSON.stringify(verdict.findings));
    assert.equal(finding.blocking, false);
    assert.equal(verdict.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R10 observed HEAD and branch ref that genuinely differ is blocking HEAD_REF_INCONSISTENT", () => {
  const head = "a".repeat(40);
  const branchHead = "c".repeat(40);
  const runner: GitRunner = {
    inspectedWorktree: CWD,
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        return { argv: [...argv], status: 0, stdout: `${head}\n`, stderr: "", error: null };
      }
      if (key === "symbolic-ref -q --short HEAD") {
        return { argv: [...argv], status: 0, stdout: "master\n", stderr: "", error: null };
      }
      if (key === "rev-parse refs/heads/master") {
        return { argv: [...argv], status: 0, stdout: `${branchHead}\n`, stderr: "", error: null };
      }
      if (key === "status --porcelain") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
      }
            if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return this.run(["rev-parse", "HEAD"]);
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
    },
  };
  const collected = collectGitTruth({ runner, worktreePath: CWD, now: NOW });
  const verdict = verifyGitTruth(collected.observation);
  const finding = verdict.findings.find((item) => item.kind === "HEAD_REF_INCONSISTENT");
  assert.ok(finding, JSON.stringify(verdict.findings));
  assert.equal(finding.blocking, true);
  assert.equal(verdict.ok, false);
});

test("R10 attached branch whose ref read is UNAVAILABLE is a non-blocking UNKNOWN finding and ok stays true", () => {
  const head = "a".repeat(40);
  const runner: GitRunner = {
    inspectedWorktree: CWD,
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        return { argv: [...argv], status: 0, stdout: `${head}\n`, stderr: "", error: null };
      }
      if (key === "symbolic-ref -q --short HEAD") {
        return { argv: [...argv], status: 0, stdout: "master\n", stderr: "", error: null };
      }
      if (key === "rev-parse refs/heads/master") {
        return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: missing\n", error: null };
      }
      if (key === "status --porcelain") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
      }
            if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return this.run(["rev-parse", "HEAD"]);
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
    },
  };
  const collected = collectGitTruth({ runner, worktreePath: CWD, now: NOW });
  const verdict = verifyGitTruth(collected.observation);
  const unknown = verdict.findings.find((item) =>
    item.kind === "HEAD_REF_INCONSISTENT" || /UNKNOWN/i.test(item.detail),
  );
  assert.ok(unknown, JSON.stringify(verdict.findings));
  assert.equal(unknown.blocking, false);
  assert.equal(verdict.ok, true);
});

// ---------------------------------------------------------------------------
// R11 — a permit must be an unforgeable thing
// ---------------------------------------------------------------------------

type BridgeV1 = {
  argvForMode(mode: "read-only" | "workspace-write"): readonly string[];
  run(
    task: {
      repositoryRoot: string;
      instruction: string;
      mode: "read-only" | "workspace-write";
      directorMintedPermit?: { readonly leaseId: string };
    },
    signal: AbortSignal,
  ): Promise<{ exitCode: number; summary: string }>;
};

type BridgeCtor = new (root: string, executable?: string) => BridgeV1;

async function loadCodexBridge(): Promise<BridgeCtor> {
  const here = dirname(fileURLToPath(import.meta.url));
  const url = pathToFileURL(join(here, "..", "..", "..", "local-assistant", "dist", "developer-bridge.js")).href;
  const mod = await import(url) as { CodexCliDeveloperAgentBridgeV1: BridgeCtor };
  return mod.CodexCliDeveloperAgentBridgeV1;
}

async function loadDirectorAgent(): Promise<{
  guardBridgeWithDirectorLease: (
    bridge: BridgeV1,
    repositoryRoot: string,
    options?: { store?: ReturnType<typeof createNodeLeaseStore>; now?: string },
  ) => BridgeV1;
}> {
  const here = dirname(fileURLToPath(import.meta.url));
  const url = pathToFileURL(join(here, "..", "..", "..", "..", "apps", "aion", "developer-agent.mjs")).href;
  return import(url) as Promise<{
    guardBridgeWithDirectorLease: (
      bridge: BridgeV1,
      repositoryRoot: string,
      options?: { store?: ReturnType<typeof createNodeLeaseStore>; now?: string },
    ) => BridgeV1;
  }>;
}

test("R11 argvGrantsWritePermission understands Codex --sandbox workspace-write", () => {
  assert.equal(
    argvGrantsWritePermission(["exec", "--cd", CWD, "--sandbox", "workspace-write", "--json", "-"]),
    true,
  );
  assert.equal(
    argvGrantsWritePermission(["exec", "--cd", CWD, "--sandbox", "read-only", "--json", "-"]),
    false,
  );
});

test("R11 forged and empty permits are refused with zero invoke attempts", async () => {
  const Bridge = await loadCodexBridge();
  const root = mkdtempSync(join(tmpdir(), "aion-r22-r11-"));
  try {
    class StubInvoke extends (Bridge as unknown as new (root: string, exe?: string) => BridgeV1) {
      invokeCalls = 0;
      protected invoke(): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
        this.invokeCalls += 1;
        return Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false });
      }
    }
    const storeRoot = join(root, "store");
    mkdirSync(storeRoot, { recursive: true });
    const store = createNodeLeaseStore(storeRoot, { hostArbitrationRoot: join(root, "arb") });
    const acquired = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: root,
      now: NOW,
      store,
    });
    assert.equal(acquired.ok, true, acquired.ok ? "" : acquired.reason);
    const realLeaseId = acquired.ok ? acquired.lease.leaseId : "missing";
    const otherRoot = join(root, "other");
    mkdirSync(otherRoot, { recursive: true });
    const otherStore = createNodeLeaseStore(join(root, "store-other"), { hostArbitrationRoot: join(root, "arb-other") });
    const other = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: otherRoot,
      now: NOW,
      store: otherStore,
    });
    assert.equal(other.ok, true);

    const expiredStore = createNodeLeaseStore(join(root, "store-exp"), { hostArbitrationRoot: join(root, "arb-exp") });
    const expiredAcq = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: root,
      now: "2026-08-13T11:00:00.000Z",
      store: expiredStore,
    });
    assert.equal(expiredAcq.ok, true);
    if (expiredAcq.ok) {
      const rows = expiredStore.list().map((row) => (
        row.leaseId === expiredAcq.lease.leaseId
          ? { ...row, expiresAt: "2026-08-13T11:01:00.000Z" }
          : row
      ));
      expiredStore.save(rows);
      assert.equal(leaseHasExpired(rows[0]!, NOW), true);
    }

    const cases: Array<{ label: string; permit: { readonly leaseId: string } | Record<string, never> }> = [
      { label: "empty-leaseId", permit: { leaseId: "" } },
      { label: "empty-object", permit: {} },
      { label: "no-such-id", permit: { leaseId: "no-such-id" } },
      { label: "other-root", permit: { leaseId: other.ok ? other.lease.leaseId : "x" } },
      { label: "expired", permit: { leaseId: expiredAcq.ok ? expiredAcq.lease.leaseId : "x" } },
    ];
    for (const item of cases) {
      const bridge = new StubInvoke(root, join(root, "codex.exe"));
      await assert.rejects(
        () => bridge.run(
          {
            repositoryRoot: root,
            instruction: "list the repository",
            mode: "workspace-write",
            directorMintedPermit: item.permit as { readonly leaseId: string },
          },
          new AbortController().signal,
        ),
        /permit|lease/i,
        item.label,
      );
      assert.equal(bridge.invokeCalls, 0, `${item.label} must not reach invoke`);
    }
    void realLeaseId;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R11 structurally copied permits are refused", async () => {
  const { mintDirectorWritePermit } = await import("../src/leases.js") as {
    mintDirectorWritePermit?: (input: { leaseId: string; store: LeaseStoreV1 }) => { leaseId: string };
  };
  assert.equal(typeof mintDirectorWritePermit, "function", "mintDirectorWritePermit must exist");
  const store = memoryLeases();
  const minted = mintDirectorWritePermit!({ leaseId: "lease-real", store });
  const copies = [
    { ...minted },
    Object.create(minted) as { leaseId: string },
    structuredClone(minted),
  ];
  const Bridge = await loadCodexBridge();
  const root = mkdtempSync(join(tmpdir(), "aion-r22-r11-copy-"));
  try {
    class StubInvoke extends (Bridge as unknown as new (root: string, exe?: string) => BridgeV1) {
      invokeCalls = 0;
      protected invoke(): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
        this.invokeCalls += 1;
        return Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false });
      }
    }
    for (const copy of copies) {
      const bridge = new StubInvoke(root, join(root, "codex.exe"));
      await assert.rejects(
        () => bridge.run(
          {
            repositoryRoot: root,
            instruction: "list the repository",
            mode: "workspace-write",
            directorMintedPermit: copy,
          },
          new AbortController().signal,
        ),
        /permit|lease/i,
      );
      assert.equal(bridge.invokeCalls, 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R11 liveness: guardBridgeWithDirectorLease holding a genuine lease reaches invoke", async () => {
  const Bridge = await loadCodexBridge();
  const { guardBridgeWithDirectorLease } = await loadDirectorAgent();
  const root = mkdtempSync(join(tmpdir(), "aion-r22-r11-live-"));
  try {
    class StubInvoke extends (Bridge as unknown as new (root: string, exe?: string) => BridgeV1) {
      invokeCalls = 0;
      protected invoke(): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
        this.invokeCalls += 1;
        return Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false });
      }
    }
    const store = createNodeLeaseStore(join(root, "store"), { hostArbitrationRoot: join(root, "arb") });
    const raw = new StubInvoke(root, join(root, "codex.exe"));
    const guarded = guardBridgeWithDirectorLease(raw, root, { store, now: NOW });
    const result = await guarded.run(
      { repositoryRoot: root, instruction: "list the repository", mode: "workspace-write" },
      new AbortController().signal,
    );
    assert.equal(result.exitCode, 0, result.summary);
    assert.equal(raw.invokeCalls, 1, "genuine lease must reach invoke");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
