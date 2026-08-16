/**
 * Round 26 fail-closed repairs. Each case is a proven R26 hostile finding.
 * Helpers are local. R25 cases stay in r25-repair.test.ts.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
  releaseDeveloperAgentWorktreeLease,
} from "../src/lease-store.js";
import {
  acquireLease,
  reclaimStaleLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  compareCreationDates,
  holderLiveness,
  interpretWindowsProbeOutput,
  normalisedCreationDate,
  observationIsAboutPid,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import {
  evaluateSuccessConjunction,
  executeRun,
  recoverAbandonedRun,
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

function recordedIdentity(): ExecutorProcessIdentityV1 {
  return { pid: 4812, creationDate: T0, executablePath: CLAUDE_EXE, runNonce: NONCE };
}

function recordedIntent(over: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    schema: "aion.director.run-intent.v1",
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: CLAUDE_EXE,
    argv: ["-p", "--permission-mode", "bypassPermissions"],
    cwd: CWD,
    runNonce: NONCE,
    intendedAt: NOW,
    spawnAttemptedAt: T0,
    spawnPid: 4812,
    spawnObservedAt: T0,
    processIdentity: recordedIdentity(),
    secretsPresent: false,
    role: "IMPLEMENT",
    ...over,
  }, null, 2)}\n`;
}

function expiredWorktreeLease(over: Partial<LeaseV1> = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-wt-0",
    kind: "WORKTREE",
    resource: CWD,
    missionId: "mission-1",
    runId: "run-0",
    pid: 4812,
    processIdentity: { pid: 4812, startedAt: T0, runToken: "nonce-run-0" },
    now: "2026-08-13T10:00:00.000Z",
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return { ...attempt.lease, ...over };
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  scanOrphans?: RunManagerDepsV1["scanOrphans"];
  persistAfterSpawn?: () => void;
  writeHandoff?: boolean;
  killTree?: (pid: number) => void;
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
    if (over.writeHandoff !== false) {
      try { fs.writeDurable(handoffPath, handoffText); } catch { /* still spawn */ }
    }
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
    killTree: over.killTree ?? (() => undefined),
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

function greenConjunction(over: Record<string, unknown> = {}) {
  const parsed = parseHandoff(JSON.stringify(goodHandoff()));
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
    ...over,
  });
}

// ---------------------------------------------------------------------------
// persist / identity
// ---------------------------------------------------------------------------

test("R26 unusable PID is not rewritten into holder identity", async () => {
  const recorded = recordedIdentity();
  for (const observation of [
    asObservation({ outcome: "NOT_FOUND", reason: "other", pid: "9999" }),
    asObservation({ outcome: "NOT_FOUND", reason: "zero", pid: 0 }),
    asObservation({ outcome: "NOT_FOUND", reason: "omitted" }),
  ]) {
    assert.equal(observationIsAboutPid(observation, 4812), false);
    assert.equal(holderLiveness(recorded, observation), "UNKNOWN");
    const held = expiredWorktreeLease();
    const reclaim = reclaimStaleLease({
      existing: [held],
      kind: "WORKTREE",
      resource: CWD,
      holderLiveness: holderLiveness(recorded, observation),
      now: HOLDER_EXIT,
      holderObservation: { outcome: observation.outcome, pid: observation.pid },
    });
    assert.equal(reclaim.ok, false, JSON.stringify(observation));
    assert.equal(reclaim.remaining.length, 1);
  }

  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    leases: memoryLeases([expiredWorktreeLease()]),
    probe: { observe: () => asObservation({ outcome: "NOT_FOUND", reason: "string pid", pid: "9999" }) },
    spawn,
  });
  assert.equal(spawn.calls, 0, result.reason);
  assert.equal(result.spawned, false);
});

test("R26 recovery outcome without matched identity cannot prove holder death", async () => {
  const fs = memoryFs({
    files: {
      [join(RUN_ROOT, "intent.json")]: recordedIntent({ processIdentity: null }),
    },
  });
  const death = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(HOLDER_EXIT),
    probe: { observe: () => asObservation({ outcome: "NOT_FOUND", reason: "other slot", pid: 9999 }) },
  });
  assert.equal(death.recoverOutcome, "REFUSED_UNKNOWN", death.reason);
  assert.match(death.reason, /UNKNOWN/i);
  assert.notEqual(death.recoverOutcome, "TERMINAL");

  const life = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(HOLDER_EXIT),
    probe: {
      observe: () => asObservation({
        outcome: "FOUND",
        reason: "other slot",
        pid: 9999,
        creationDate: T0,
        executablePath: CLAUDE_EXE,
      }),
    },
  });
  assert.equal(life.recoverOutcome, "REFUSED_UNKNOWN", life.reason);
  assert.notEqual(life.recoverOutcome, "REFUSED_ALIVE");
});

test("R26 high-precision creation identity does not collapse into a false PID-reuse match", () => {
  const raw = "2026-08-13T10:00:00.1234567Z";
  const reused = "2026-08-13T10:00:00.1239999Z";
  const captured = normalisedCreationDate(raw);
  assert.ok(captured !== null);
  assert.notEqual(captured, "2026-08-13T10:00:00.123Z");
  assert.equal(compareCreationDates(captured!, raw), "SAME");
  assert.equal(compareCreationDates(captured!, reused), "DIFFERENT");

  const recorded: ExecutorProcessIdentityV1 = {
    pid: 4812,
    creationDate: captured!,
    executablePath: CLAUDE_EXE,
    runNonce: "",
  };
  const sameProcess = holderLiveness(recorded, asObservation({
    outcome: "FOUND",
    pid: 4812,
    creationDate: raw,
    executablePath: CLAUDE_EXE,
  }));
  assert.equal(sameProcess, "ALIVE");

  const first = interpretWindowsProbeOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      pid: 4812,
      creationDate: raw,
      executablePath: CLAUDE_EXE,
    }),
    stderr: "",
    askedPid: 4812,
  });
  const second = interpretWindowsProbeOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      pid: 4812,
      creationDate: reused,
      executablePath: CLAUDE_EXE,
    }),
    stderr: "",
    askedPid: 4812,
  });
  assert.equal(first.outcome, "FOUND");
  assert.equal(second.outcome, "FOUND");
  assert.notEqual(first.creationDate, second.creationDate);
  const reuse = holderLiveness(
    { pid: 4812, creationDate: first.creationDate ?? "", executablePath: CLAUDE_EXE, runNonce: "" },
    second,
  );
  assert.notEqual(reuse, "ALIVE");
});

test("R26 missing parentCreationDate remains UNKNOWN / fail-closed", async () => {
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [],
  });
  const leftover = {
    pid: 99004,
    parentPid: 18016,
    parentPresent: true as const,
    parentName: "powershell.exe",
    creationDate: HOLDER_EXIT,
    nonceReadable: false,
  };
  assert.equal(parentlessRowTiedToThisRun(leftover, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), true);
  assert.equal(processRowMakesScanUndecidable(leftover, ctx), true);

  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    spawn,
    scanOrphans: () => writerOrphanScanResult([leftover]),
  });
  assert.equal(result.ok, false, result.reason);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false, tree?.reason);
});

test("R26 post-exit PID reuse cannot overclaim the original holder", () => {
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [],
  });
  const leftover = {
    pid: 99005,
    parentPid: 4812,
    parentPresent: true as const,
    parentCreationDate: "2026-08-13T12:00:25.000Z",
    creationDate: "2026-08-13T12:00:21.000Z",
    nonceReadable: false,
  };
  assert.equal(parentlessRowTiedToThisRun(leftover, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), false);
});

// ---------------------------------------------------------------------------
// crash / recovery / logs
// ---------------------------------------------------------------------------

test("R26 recovered completed run writes the runId index and is idempotent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r26-idx-"));
  try {
    const storeRoot = join(dir, "store");
    mkdirSync(storeRoot, { recursive: true });
    const store = createNodeLeaseStore(storeRoot, { hostArbitrationRoot: join(dir, "arb") });
    const rootA = join(dir, "RUNS", "run-a");
    const rootB = join(dir, "RUNS", "run-b");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    writeFileSync(join(rootA, "PROMPT.md"), "x");
    writeFileSync(join(rootB, "PROMPT.md"), "x");
    const promptB = join(rootB, "PROMPT.md");
    const shared = memoryFs({
      dirs: [CWD, rootA, rootB, storeRoot],
      files: { [promptB]: "prompt\n" },
    });
    shared.writeDurable(join(rootA, "intent.json"), recordedIntent({ runId: "run-reloc" }));
    const first = await recoverAbandonedRun(rootA, {
      fs: shared,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
      leases: store,
    });
    assert.equal(first.spawned, true, first.reason);
    const indexPath = join(storeRoot, "run-completions", "run-reloc.json");
    assert.equal(shared.isFile(indexPath), true, "recover must write the runId index");
    const again = await recoverAbandonedRun(rootA, {
      fs: shared,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
      leases: store,
    });
    assert.equal(again.spawned, true);
    assert.equal(shared.isFile(indexPath), true);
    const spawn = trackingSpawn(() => exitingProcess());
    const relocated = await runWith({
      request: { runRoot: rootB, runId: "run-reloc", promptPath: promptB },
      leases: store,
      fs: shared,
      spawn,
    });
    assert.equal(spawn.calls, 0, relocated.reason);
    assert.match(relocated.reason, /recorded completion already exists/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R26 durable completion is not gated on two recoverOutcome strings", async () => {
  for (const recoverOutcome of [undefined, "TERMINAL", null, "refused_unknown"]) {
    const fs = memoryFs({
      files: {
        [join(RUN_ROOT, "result.json")]: JSON.stringify({
          spawned: false,
          ...(recoverOutcome !== undefined ? { recoverOutcome } : {}),
          runId: "run-1",
          intent: { spawnPid: 4812, spawnAttemptedAt: T0 },
          processIdentity: { pid: 4812, creationDate: T0 },
        }),
      },
    });
    const spawn = trackingSpawn(() => exitingProcess());
    const result = await runWith({ fs, spawn });
    assert.equal(spawn.calls, 0, `outcome=${String(recoverOutcome)} ${result.reason}`);
    assert.match(result.reason, /recorded completion already exists/i);
  }

  const observedOnly = memoryFs({
    files: {
      [join(RUN_ROOT, "result.json")]: JSON.stringify({
        spawned: false,
        recoverOutcome: "REFUSED_ALIVE",
        runId: "run-1",
        intent: { spawnObservedAt: T0 },
      }),
    },
  });
  const spawn2 = trackingSpawn(() => exitingProcess());
  const observed = await runWith({ fs: observedOnly, spawn: spawn2 });
  assert.equal(spawn2.calls, 0, observed.reason);
});

test("R26 Authorization Bearer and hostile token boundaries are redacted", () => {
  const secret = "eyJhbGciCONTROLTOKEN9911";
  assert.equal(redactLogText(`Authorization: Bearer ${secret}`).includes(secret), false);
  assert.equal(redactLogText(`Bearer ${secret}`).includes(secret), false);
  assert.equal(redactLogText(`xBearer ${secret}`).includes(secret), false);
  assert.equal(redactLogText(`autBearer ${secret}`).includes(secret), false);
  assert.equal(redactLogText(`-Bearer ${secret}`).includes(secret), false);
  assert.equal(redactLogText(`Authorization:\n${secret}`).includes(secret), false);
  assert.equal(redactLogText(`Authorization:\r\n\t${secret}`).includes(secret), false);
  assert.equal(redactLogText(`Proxy-Authorization:\n${secret}`).includes(secret), false);
  assert.equal(redactLogText(`Bearer\u0085${secret}`).includes(secret), false);

  const sink = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: sink, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "aut");
  log.write("stdout", `Bearer ${secret}\n`);
  log.flush();
  const image = sink.contents().toString("utf8");
  assert.equal(image.includes(secret), false, image);
});

// ---------------------------------------------------------------------------
// wiring / liveness
// ---------------------------------------------------------------------------

test("R26 production developer-agent path invokes the leftover gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r26-dev-"));
  try {
    const store = createNodeLeaseStore(join(dir, "store"), { hostArbitrationRoot: join(dir, "arb") });
    const acquired = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
      probe: {
        observe: (pid) => asObservation({
          outcome: "FOUND",
          pid,
          creationDate: T0,
          executablePath: CLAUDE_EXE,
        }),
      },
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const mintedNonce = acquired.lease.processIdentity?.runToken;
    assert.ok(mintedNonce, "acquire must mint a run nonce");

    let scanned = false;
    const leftover = releaseDeveloperAgentWorktreeLease(store, acquired.lease, {
      scanOrphans: () => {
        scanned = true;
        return writerOrphanScanResult([{
          pid: 25100,
          runNonce: mintedNonce,
          nonceReadable: true,
          parentPresent: false,
          creationDate: "2026-08-16T00:05:00.000Z",
        }]);
      },
    });
    assert.equal(scanned, true);
    assert.equal(leftover.ok, false);
    assert.equal(store.list().length, 1);

    const missingScan = releaseDeveloperAgentWorktreeLease(store, acquired.lease);
    assert.equal(missingScan.ok, false);
    assert.equal(store.list().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R26 discovery isFile is not prompt existence", async () => {
  const missing = "C:\\wt\\NO-SUCH-PROMPT.md";
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    request: { promptPath: missing },
    spawn,
    fs: memoryFs(),
  });
  assert.equal(spawn.calls, 0, result.reason);
  assert.equal(result.spawned, false);
  assert.match(result.reason, /prompt/i);

  const emptyPath = "C:\\wt\\EMPTY-PROMPT.md";
  const emptyFs = memoryFs({ files: { [emptyPath]: "   " } });
  const spawn2 = trackingSpawn(() => exitingProcess());
  const empty = await runWith({
    request: { promptPath: emptyPath },
    spawn: spawn2,
    fs: emptyFs,
  });
  assert.equal(spawn2.calls, 0, empty.reason);
  assert.equal(empty.spawned, false);
});

test("R26 missing handoff.json cannot fall back to stdout PASS", async () => {
  const result = await runWith({
    writeHandoff: false,
    spawn: trackingSpawn(() => ({
      ...exitingProcess(),
      stdout: Readable.from([JSON.stringify(goodHandoff())]),
    })),
  });
  assert.equal(result.ok, false, result.reason);
  const parsed = result.conjunction.findings.find((item) => item.name === "handoffParsed");
  assert.equal(parsed?.ok, false, parsed?.reason);
});

test("R26 omitted timedOut cannot become success", () => {
  const base = {
    exitCode: 0 as const,
    stillRunning: false as const,
    executor: "claude" as const,
    output: "",
    parsed: parseHandoff(JSON.stringify(goodHandoff())),
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
    logStayedWithinBudget: true,
    processWasCreated: true,
    expectedRunNonce: NONCE,
    spawnedAtFloor: T0,
    observedCompletedAt: HOLDER_EXIT,
  };
  const omitted = evaluateSuccessConjunction(base as never);
  assert.equal(omitted.ok, false);
  const budget = omitted.findings.find((item) => item.name === "runCompletedWithinBudget");
  assert.equal(budget?.ok, false, budget?.reason);

  const nulled = evaluateSuccessConjunction({ ...base, timedOut: null } as never);
  assert.equal(nulled.ok, false);
});

// ---------------------------------------------------------------------------
// conjunction / cancel
// ---------------------------------------------------------------------------

test("R26 parent exit does not skip cancellation while descendants may survive", async () => {
  const killed: number[] = [];
  const leftoverPid = 99002;
  const leases = memoryLeases();
  const originalSave = leases.save;
  let saves = 0;
  leases.save = (next) => {
    saves += 1;
    originalSave(next);
    if (saves >= 2) throw new Error("injected persist-after-spawn failure");
  };
  const result = await runWith({
    leases,
    spawn: trackingSpawn(() => exitingProcess({ pid: 5505 })),
    persistAfterSpawn: () => undefined,
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => writerOrphanScanResult([{
      pid: leftoverPid,
      runNonce: NONCE,
      nonceReadable: true,
      parentPresent: false,
      creationDate: T0,
    }]),
  });
  assert.equal(result.spawned, true);
  assert.match(result.reason, /injected persist-after-spawn failure|run failed/i);
  assert.ok(result.cancel.stages.includes("HARD"), JSON.stringify(result.cancel.stages));
  assert.ok(killed.includes(leftoverPid) || killed.includes(5505), JSON.stringify(killed));
});

test("R26 recordSpawnAttempt cleanup is HARD then leftover, not SOFT-first", async () => {
  const events: string[] = [];
  const hung = hangingProcess(5506);
  const fs = memoryFs();
  const originalWrite = fs.writeDurable.bind(fs);
  let intentWrites = 0;
  fs.writeDurable = (path, utf8) => {
    if (path.endsWith("intent.json")) {
      intentWrites += 1;
      if (intentWrites >= 2) throw new Error("intent stamp failed");
    }
    originalWrite(path, utf8);
  };
  const result = await runWith({
    fs,
    spawn: trackingSpawn(() => hung),
    killTree: (pid) => { events.push(`HARD:${pid}`); },
  });
  assert.equal(result.spawned, true, result.reason);
  assert.ok(result.cancel.stages.includes("HARD"), JSON.stringify(result.cancel.stages));
  assert.ok(events[0]?.startsWith("HARD:"), JSON.stringify(events));
});

test("R26 missing process-tree evidence blocks terminated truth", () => {
  const conjunction = greenConjunction({
    executorTreeGone: false,
    executorTreeReason: "membership undecidable for pid 99004",
  });
  assert.equal(conjunction.ok, false);
  const tree = conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false);
});
