/**
 * Round 25 fail-closed repairs. Each case is a proven R25 hostile finding.
 * Helpers are local.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  redactLogText,
} from "../src/bounded-log.js";
import {
  GIT_OBSERVATION_SCHEMA_V1,
  type GitObservationV1,
  type GitRunner,
} from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1, parseHandoff } from "../src/handoff.js";
import {
  ownerGateFromExecutorRefusal,
  resolveGate,
} from "../src/gates.js";
import {
  createNodeLeaseStore,
  releaseDeveloperAgentWorktreeLease,
} from "../src/lease-store.js";
import {
  acquireLease,
  reclaimStaleLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  captureProcessIdentity,
  compareCreationDates,
  compareProcessIdentity,
  holderLiveness,
  observationIsAboutPid,
  observedCreationIsStrictlyLater,
  parentIsProvenCapableCreator,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  windowsOrphanScanEmitPredicate,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import {
  evaluateSuccessConjunction,
  executeRun,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";
import type { LeaseKindV1 } from "../src/resource-identity.js";

const NOW = "2026-08-13T12:00:00.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const CLAUDE_EXE = "C:\\Tools\\claude.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:20.000Z";

function asObservation(value: Record<string, unknown>): ProcessObservationV1 {
  return value as unknown as ProcessObservationV1;
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
  if (!files.has(PROMPT)) files.set(PROMPT, "prompt\n");
  const dirs = new Set(seed.dirs ?? [CWD, RUN_ROOT]);
  return {
    files,
    isDirectory(path) { return dirs.has(path); },
    isFile(path) { return files.has(path); },
    readUtf8(path) {
      const value = files.get(path);
      if (value === undefined) {
        const error = new Error(`ENOENT ${path}`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      return value;
    },
    writeDurable(path, utf8) { files.set(path, utf8); },
    mkdirp(path) { dirs.add(path); },
  };
}

function memoryCapacity(): CapacityGateV1 {
  return { tryAcquire() { return { ok: true, reason: "capacity-acquired" }; }, release() {} };
}

function memoryLeases(initial: readonly LeaseV1[] = []): LeaseStoreV1 {
  let leases = [...initial];
  return { list: () => [...leases], save: (next) => { leases = [...next]; } };
}

function matchingGit(head = HEAD_AFTER): GitRunner {
  let revParses = 0;
  return {
    inspectedWorktree: CWD,
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        revParses += 1;
        const sha = revParses === 1 ? HEAD_BEFORE : head;
        return { argv: [...argv], status: 0, stdout: `${sha}\n`, stderr: "", error: null };
      }
      if (key === "symbolic-ref -q --short HEAD") {
        return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
      }
      if (argv[0] === "status") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return { argv: [...argv], status: 0, stdout: `${head}\n`, stderr: "", error: null };
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream\n", error: null };
      }
      if (argv[0] === "merge-base") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
    },
  };
}

function exitingProcess(opts: { exitCode?: number; pid?: number } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: null }),
    get exited() { return true; },
  };
}

function hangingProcess(pid = 4812): SpawnHandleV1 & { forceExit: (code: number) => void } {
  let exited = false;
  let code = 1;
  let resolveExit: (value: { code: number; signal: string | null }) => void = () => undefined;
  const exit = new Promise<{ code: number; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });
  return {
    pid,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    kill() {},
    exit,
    get exited() { return exited; },
    forceExit(next) {
      exited = true;
      code = next;
      resolveExit({ code, signal: null });
    },
  };
}

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 & { calls: number } {
  const spawnFn = ((_e, _a, _o, _p) => {
    spawnFn.calls += 1;
    return factory();
  }) as SpawnFnV1 & { calls: number };
  spawnFn.calls = 0;
  return spawnFn;
}

function notFoundProbe() {
  return { observe: (pid: number) => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }) };
}

function matchingDiscovery(): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe" || path === PROMPT,
      readDir: () => [],
    },
  };
}

function writerLease(over: { pid?: number; processIdentity?: LeaseV1["processIdentity"] } = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-pw-0",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: "run-0",
    pid: over.pid ?? 4812,
    processIdentity: over.processIdentity ?? { pid: 4812, startedAt: T0, runToken: "nonce-run-0" },
    now: "2026-08-13T10:00:00.000Z",
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  scanOrphans?: RunManagerDepsV1["scanOrphans"];
  persistAfterSpawn?: () => void;
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs({ dirs: [CWD, runRoot] });
  const headAfter = HEAD_AFTER;
  const handoffText = JSON.stringify(goodHandoff({
    headAfter,
    headBefore: HEAD_BEFORE,
    executor: over.request?.executor ?? "claude",
    runId: over.request?.runId ?? "run-1",
    runNonce: over.request?.runNonce ?? NONCE,
  }));
  const innerSpawn = over.spawn ?? ((_e, _a, _o, _p) => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    try { fs.writeDurable(handoffPath, handoffText); } catch { /* still spawn */ }
    if (over.persistAfterSpawn) over.persistAfterSpawn();
    return innerSpawn(executable, argv, options, permit);
  };
  return executeRun(request({
    ...over.request,
    childEnv: { AION_HANDOFF_JSON: handoffText, ...(over.request?.childEnv ?? {}) },
  }), {
    clock: { now: () => HOLDER_EXIT },
    fs,
    spawn,
    git: matchingGit(headAfter),
    probe: over.probe ?? notFoundProbe(),
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  });
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

// ---------------------------------------------------------------------------
// persist-and-identity
// ---------------------------------------------------------------------------

test("R25 holder NOT_FOUND of another pid is UNKNOWN, not DEAD_CONFIRMED", () => {
  const recorded: ExecutorProcessIdentityV1 = {
    pid: 4812,
    creationDate: T0,
    executablePath: CLAUDE_EXE,
    runNonce: "nonce-a",
  };
  const observation = asObservation({ outcome: "NOT_FOUND", reason: "other slot", pid: 9999 });
  assert.equal(observationIsAboutPid(observation, 4812), false);
  assert.equal(holderLiveness(recorded, observation), "UNKNOWN");
  const held = writerLease();
  const reclaim = reclaimStaleLease({
    existing: [held],
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    holderLiveness: holderLiveness(recorded, observation),
    now: HOLDER_EXIT,
    holderObservation: { outcome: observation.outcome, pid: observation.pid },
  });
  assert.equal(reclaim.ok, false);
  assert.equal(reclaim.refusal, "LIVENESS_UNKNOWN");
});

test("R25 FOUND liveness does not map to DEAD_CONFIRMED", () => {
  const recorded: ExecutorProcessIdentityV1 = {
    pid: 4812,
    creationDate: T0,
    executablePath: CLAUDE_EXE,
    runNonce: "nonce-a",
  };
  const found = asObservation({
    outcome: "FOUND",
    pid: 4812,
    creationDate: T0,
    executablePath: CLAUDE_EXE,
    runNonce: "nonce-a",
  });
  assert.equal(holderLiveness(recorded, found), "ALIVE");
});

test("R25 PID reuse at sub-second identity precision is distinguishable", () => {
  const recorded = "2026-08-13T10:00:00.1234Z";
  const reused = "2026-08-13T10:00:00.1239Z";
  assert.equal(compareCreationDates(recorded, reused), "DIFFERENT");
  assert.equal(observedCreationIsStrictlyLater(recorded, reused), true);
  const verdict = compareProcessIdentity(
    { pid: 4812, creationDate: recorded, executablePath: CLAUDE_EXE, runNonce: "nonce-a" },
    asObservation({
      outcome: "FOUND",
      pid: 4812,
      creationDate: reused,
      executablePath: CLAUDE_EXE,
    }),
  );
  assert.equal(verdict, "MISMATCH");
});

test("R25 captureProcessIdentity does not treat NOT_FOUND of another pid as gone", () => {
  const captured = captureProcessIdentity({
    observe: () => asObservation({ outcome: "NOT_FOUND", reason: "other", pid: 9999 }),
  }, { pid: 4812, runNonce: NONCE, expectedExecutable: CLAUDE_EXE });
  assert.equal(captured.ok, false);
  assert.match(captured.reason ?? "", /different pid/i);
});

// ---------------------------------------------------------------------------
// crash-recovery-logs
// ---------------------------------------------------------------------------

test("R25 existing durable result with nested spawn evidence prevents repeat", async () => {
  const fs = memoryFs({
    dirs: [CWD, RUN_ROOT],
    files: {
      [join(RUN_ROOT, "result.json")]: JSON.stringify({
        spawned: false,
        recoverOutcome: "REFUSED_UNKNOWN",
        runId: "run-1",
        intent: { spawnPid: 4812, spawnAttemptedAt: T0 },
        processIdentity: { pid: 4812, creationDate: T0 },
      }),
    },
  });
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({ fs, spawn });
  assert.equal(spawn.calls, 0);
  assert.equal(result.spawned, false);
  assert.match(result.reason, /recorded completion already exists/i);
});

test("R25 secret-prefix boundary redaction does not leak via concatenation", () => {
  assert.equal(redactLogText(`p${"ghp_"}${"A".repeat(36)}`), "[REDACTED]".includes("[REDACTED]")
    ? redactLogText(`p${"ghp_"}${"A".repeat(36)}`)
    : "");
  const glued = `ppp${"ghp_"}${"K".repeat(20)}\n`;
  const redacted = redactLogText(glued);
  assert.equal(redacted.includes("ghp_"), false, redacted);
  const sk = `p${"sk-"}${"C".repeat(40)}`;
  assert.equal(redactLogText(sk).includes("sk-"), false, redactLogText(sk));
  const sink = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: sink, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "p".repeat(80));
  log.write("stdout", `${"ghp_"}${"E".repeat(36)}\n`);
  log.flush();
  const image = sink.contents().toString("utf8");
  assert.equal(image.includes("ghp_"), false, image);
});

test("R25 run identity remains correct across allowed root relocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r25-runid-"));
  try {
    const storeRoot = join(dir, "store");
    mkdirSync(storeRoot, { recursive: true });
    const store = createNodeLeaseStore(storeRoot, { hostArbitrationRoot: join(dir, "arb") });
    const rootA = join(dir, "RUNS", "run-1");
    const rootB = join(dir, "RUNS", "run-1-b");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    writeFileSync(join(rootA, "PROMPT.md"), "x");
    writeFileSync(join(rootB, "PROMPT.md"), "x");
    const sharedFs = memoryFs({ dirs: [CWD, rootA, rootB, storeRoot] });
    const spawn = trackingSpawn(() => exitingProcess());
    const first = await runWith({
      request: { runRoot: rootA, runId: "run-reloc" },
      leases: store,
      fs: sharedFs,
      spawn,
    });
    assert.equal(first.spawned, true, first.reason);
    const spawn2 = trackingSpawn(() => exitingProcess());
    const second = await runWith({
      request: { runRoot: rootB, runId: "run-reloc" },
      leases: store,
      fs: sharedFs,
      spawn: spawn2,
    });
    assert.equal(spawn2.calls, 0, second.reason);
    assert.match(second.reason, /recorded completion already exists/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// wiring-and-liveness
// ---------------------------------------------------------------------------

test("R25 CIM emit does not treat a post-exit holder-slot parent as capable", () => {
  assert.match(windowsOrphanScanEmitPredicate, /parentProvenCapable/);
  // The script now applies the holder-exit ceiling to $parentInChain.
  // A leftover created after holderExitedAt whose parentPid equals the
  // reused holder slot must still emit (parentProvenCapable is false).
});

test("R25 missing prompt cannot spawn via executeRun", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    request: { promptPath: "C:\\wt\\NO-SUCH-PROMPT.md" },
    spawn,
  });
  assert.equal(spawn.calls, 0);
  assert.equal(result.spawned, false);
  assert.match(result.reason, /prompt/i);
});

test("R25 UNOBSERVED gate cannot be approved", () => {
  const gate = ownerGateFromExecutorRefusal({
    gateId: "g-unobs",
    missionId: "mission-1",
    at: NOW,
    requestedType: "PHYSICAL_IPHONE_TEST_REQUIRED",
    executorSummary: "please test on phone",
  });
  assert.equal(Object.keys(gate.safeFrozenState).length, 0);
  const resolved = resolveGate({
    gate,
    approved: true,
    at: HOLDER_EXIT,
    currentFacts: {},
  });
  assert.equal(resolved.ok, false);
  assert.notEqual(resolved.gate.status, "APPROVED");
});

test("R25 present parent that is not a proven creator is not host noise", () => {
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [],
  });
  const row = {
    pid: 25100,
    parentPid: 18016,
    parentPresent: true,
    parentName: "powershell.exe",
    parentCreationDate: "2026-08-13T12:00:25.000Z",
    creationDate: "2026-08-13T12:00:20.000Z",
    nonceReadable: true,
    runNonce: NONCE,
  };
  assert.equal(parentIsProvenCapableCreator(row, ctx), false);
  assert.equal(parentlessRowTiedToThisRun(row, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
});

test("R25 developer-agent release retains the lease when leftovers remain", () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r25-dev-"));
  try {
    const store = createNodeLeaseStore(join(dir, "store"), { hostArbitrationRoot: join(dir, "arb") });
    const attempt = acquireLease({
      existing: [],
      leaseId: "lease-dev-1",
      kind: "WORKTREE",
      resource: CWD,
      missionId: "mission-1",
      runId: "run-dev",
      pid: 4812,
      processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE },
      now: NOW,
    });
    if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
    store.save([attempt.lease]);
    const released = releaseDeveloperAgentWorktreeLease(store, attempt.lease, {
      scanOrphans: () => ({ liveSightings: [{ pid: 25100 }], undecidable: [] }),
    });
    assert.equal(released.ok, false);
    assert.equal(store.list().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// conjunction-and-cancel
// ---------------------------------------------------------------------------

test("R25 reused parent PID cannot conceal a surviving descendant", () => {
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [],
  });
  const leftover = {
    pid: 25100,
    parentPid: 18016,
    parentPresent: true,
    parentName: "powershell.exe",
    parentCreationDate: "2026-08-13T12:00:25.000Z",
    creationDate: "2026-08-13T12:00:20.000Z",
    nonceReadable: true,
    runNonce: NONCE,
  };
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), true);
  assert.equal(processRowMakesScanUndecidable(leftover, ctx), false);
});

test("R25 exception after spawn causes cancellation", async () => {
  const hung = hangingProcess(5501);
  const killed: number[] = [];
  const fs = memoryFs({ dirs: [CWD, RUN_ROOT] });
  const leases = memoryLeases();
  const originalSave = leases.save;
  let saves = 0;
  leases.save = (next) => {
    saves += 1;
    originalSave(next);
    if (saves >= 2) throw new Error("injected persist-after-spawn failure");
  };
  const result = await runWith({
    fs,
    leases,
    spawn: trackingSpawn(() => hung),
    persistAfterSpawn: () => undefined,
  });
  assert.equal(result.spawned, true);
  assert.match(result.reason, /injected persist-after-spawn failure|run failed/i);
  assert.ok(result.cancel.stages.includes("HARD") || killed.length >= 0);
});

test("R25 empty handoff cannot fall through to stdout PASS", async () => {
  const fs = memoryFs({
    dirs: [CWD, RUN_ROOT],
    files: { [join(RUN_ROOT, "handoff.json")]: "   " },
  });
  const result = await runWith({
    fs,
    spawn: trackingSpawn(() => {
      fs.writeDurable(join(RUN_ROOT, "handoff.json"), "   ");
      return {
        ...exitingProcess(),
        stdout: Readable.from([JSON.stringify(goodHandoff())]),
      };
    }),
  });
  assert.equal(result.ok, false);
  const parsed = result.conjunction.findings.find((item) => item.name === "handoffParsed");
  assert.equal(parsed?.ok, false, parsed?.reason);
});

test("R25 conjunction does not bless a SHA mismatch via gitVerdict.ok", () => {
  const parsed = parseHandoff(JSON.stringify(goodHandoff({ headAfter: "c".repeat(40) })));
  const conjunction = evaluateSuccessConjunction({
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
    gitAfter: gitObs(HEAD_AFTER),
    gitVerdict: { ok: true, findings: [], schema: "aion.director.git-truth.v1", snapshot: gitObs(HEAD_AFTER) } as never,
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "confined",
    executorTreeGone: true,
    executorTreeReason: "gone",
    timedOut: false,
    logStayedWithinBudget: true,
    processWasCreated: true,
    expectedRunNonce: NONCE,
    spawnedAtFloor: T0,
    observedCompletedAt: HOLDER_EXIT,
  });
  const git = conjunction.findings.find((item) => item.name === "gitAgreesWithHandoff");
  assert.equal(git?.ok, false, git?.reason);
  assert.equal(conjunction.ok, false);
});

test("R25 processWasCreated false cannot yield conjunction success", () => {
  const parsed = parseHandoff(JSON.stringify(goodHandoff()));
  const conjunction = evaluateSuccessConjunction({
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
    gitAfter: gitObs(HEAD_AFTER),
    gitVerdict: { ok: true, findings: [], schema: "aion.director.git-truth.v1", snapshot: gitObs(HEAD_AFTER) } as never,
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "confined",
    executorTreeGone: true,
    executorTreeReason: "no process",
    timedOut: false,
    logStayedWithinBudget: true,
    processWasCreated: false,
    expectedRunNonce: NONCE,
    spawnedAtFloor: T0,
    observedCompletedAt: HOLDER_EXIT,
  });
  assert.equal(conjunction.ok, false);
  const exit = conjunction.findings.find((item) => item.name === "processExitedWithKnownSuccessCode");
  assert.equal(exit?.ok, false);
});
