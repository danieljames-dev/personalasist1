/**
 * Round 29 fail-closed repairs. Each case is a proven R29 hostile finding.
 * Helpers are local. R25/R26/R27/R28 cases stay in their own files.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFileLogSink,
  createFixedClock,
  createMemoryLogSink,
} from "../src/bounded-log.js";
import {
  type GitRunner,
} from "../src/git-truth.js";
import { DIRECTOR_ROOT_ENV } from "../src/contracts.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
  releaseDeveloperAgentWorktreeLease,
} from "../src/lease-store.js";
import {
  acquireLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  descendantPidsOfPositiveIdentity,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowPlausibilityContext,
  rememberSampledDescendantPids,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import {
  createNodeRunFileSystem,
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
const SECRET = "eyJhbGciCONTROLTOKEN9911";

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

function exitingProcess(opts: { exitCode?: number; pid?: number; stdout?: Readable; stderr?: Readable } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: opts.stdout ?? Readable.from([""]),
    stderr: opts.stderr ?? Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: null }),
    get exited() { return true; },
  };
}

function liveThenExitProcess(opts: { pid?: number; stdout?: Readable } = {}): SpawnHandleV1 {
  let exited = false;
  queueMicrotask(() => { exited = true; });
  return {
    pid: opts.pid ?? 4812,
    stdout: opts.stdout ?? Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: 0, signal: null }),
    get exited() { return exited; },
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

const recycledOccupant = {
  pid: 99006,
  parentPid: 4812,
  parentPresent: true as const,
  parentCreationDate: "2026-08-13T12:00:20.000400Z",
  creationDate: "2026-08-13T12:00:20.000800Z",
  nonceReadable: false,
};

const recycledGrandchild = {
  pid: 99007,
  parentPid: 99006,
  parentPresent: true as const,
  parentCreationDate: "2026-08-13T12:00:20.000800Z",
  creationDate: "2026-08-13T12:00:20.000900Z",
  nonceReadable: false,
};

function leftoverScan(killed: number[], rows: readonly Record<string, unknown>[]) {
  return writerOrphanScanResult(rows.filter((row) => !killed.includes(row.pid as number)) as never);
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  omitLeases?: boolean;
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  scanOrphans?: RunManagerDepsV1["scanOrphans"];
  sampleAncestry?: RunManagerDepsV1["sampleAncestry"];
  writeHandoff?: boolean;
  killTree?: (pid: number) => void;
  clock?: { now: () => string };
  logSinks?: RunManagerDepsV1["logSinks"];
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
    return innerSpawn(executable, argv, options, permit);
  };
  const deps: RunManagerDepsV1 = {
    clock: over.clock ?? { now: () => HOLDER_EXIT },
    fs,
    spawn,
    git: matchingGit(headAfter),
    probe: over.probe ?? notFoundProbe(),
    capacity: memoryCapacity(),
    wait: async () => undefined,
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
    ...(over.sampleAncestry !== undefined ? { sampleAncestry: over.sampleAncestry } : {}),
    ...(over.omitLeases === true ? {} : { leases: over.leases ?? memoryLeases() }),
  };
  return executeRun(request({
    ...over.request,
    childEnv: { AION_HANDOFF_JSON: handoffText, ...(over.request?.childEnv ?? {}) },
  }), deps);
}

function writerLease(): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-pw-0",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: "run-0",
    pid: 4812,
    processIdentity: { pid: 4812, startedAt: T0, runToken: "nonce-run-0" },
    now: "2026-08-13T10:00:00.000Z",
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

// ---------------------------------------------------------------------------
// persist / identity
// ---------------------------------------------------------------------------

test("R29 live sample without a confirmable holder does not copy a recycled grandchild", () => {
  const seen = new Set<number>();
  rememberSampledDescendantPids(seen, 4812, [recycledOccupant, recycledGrandchild], {
    createdNotBefore: HOLDER_EXIT,
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(seen.has(99006), false);
  assert.equal(seen.has(99007), false);
  assert.equal(descendantPidsOfPositiveIdentity(4812, [recycledOccupant, recycledGrandchild], {
    createdNotBefore: HOLDER_EXIT,
    holderExitedAt: HOLDER_EXIT,
  }).has(99007), false);
});

test("R29 live handle plus recycled tree does not kill grandchild then PASS", async () => {
  const killed: number[] = [];
  const rows = [recycledOccupant, recycledGrandchild];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    spawn: trackingSpawn(() => liveThenExitProcess()),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
    sampleAncestry: () => rows,
  });
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok && killed.includes(99007), true, result.reason);
});

test("R29 previously walked descendant slot does not tie a recycled grandchild", () => {
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812, 99006]),
    observedPidIdentities: [[99006, "2026-08-13T12:00:02.000Z"]],
    rows: [recycledOccupant, recycledGrandchild],
  });
  assert.equal(parentlessRowTiedToThisRun(recycledGrandchild, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(recycledGrandchild, ctx), false);
});

test("R29 live genuine child then recycled grandchild is not killed then PASSed", async () => {
  const killed: number[] = [];
  const genuine = {
    pid: 99006,
    parentPid: 4812,
    parentPresent: true as const,
    creationDate: "2026-08-13T12:00:02.000Z",
  };
  const holder = { pid: 4812, creationDate: T0 };
  let samples = 0;
  const leftover = [recycledOccupant, recycledGrandchild];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    spawn: trackingSpawn(() => liveThenExitProcess()),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, leftover),
    sampleAncestry: () => {
      samples += 1;
      return samples === 1 ? [holder, genuine] : leftover;
    },
    probe: {
      observe: (pid) => pid === 4812
        ? asObservation({ outcome: "FOUND", reason: "alive", pid: 4812, creationDate: T0 })
        : asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }),
    },
  });
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok && killed.includes(99007), true, result.reason);
});

test("R29 missing creationDate is not a positive-identity descendant", () => {
  const missing = { pid: 99006, parentPid: 4812, parentPresent: true as const };
  const datedChild = recycledGrandchild;
  const bounds = { createdNotBefore: HOLDER_EXIT, holderExitedAt: HOLDER_EXIT };
  const rows = [missing, datedChild];
  assert.equal(descendantPidsOfPositiveIdentity(4812, rows, bounds).has(99006), false);
  assert.equal(descendantPidsOfPositiveIdentity(4812, rows, bounds).has(99007), false);
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: HOLDER_EXIT,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows,
  });
  assert.equal(processRowCouldBelongToThisRun(missing, ctx), true);
});

test("R29 missing-date recycled occupant is not killed then PASSed", async () => {
  const killed: number[] = [];
  const missing = { pid: 99006, parentPid: 4812, parentPresent: true as const };
  const rows = [missing, recycledGrandchild];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
  });
  assert.equal(killed.includes(99006), false, JSON.stringify(killed));
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok && (killed.includes(99006) || killed.includes(99007)), true, result.reason);
});

test("R29 PRODUCTION_WRITER does not SAFE_RELEASE after a live-sample recycled grandchild", async () => {
  const killed: number[] = [];
  const rows = [recycledOccupant, recycledGrandchild];
  const result = await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-r29" } },
    leases: memoryLeases([writerLease()]),
    clock: { now: () => HOLDER_EXIT },
    spawn: trackingSpawn(() => liveThenExitProcess()),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
    sampleAncestry: () => rows,
    probe: {
      observe: (pid) => pid === 4812
        ? asObservation({ outcome: "NOT_FOUND", reason: "gone", pid: 4812 })
        : asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }),
    },
  });
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  if (killed.includes(99007)) {
    assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
  }
});

// ---------------------------------------------------------------------------
// crash / recovery / logs
// ---------------------------------------------------------------------------

test("R29 flush of an unterminated Authorization obs-fold does not leak the token", () => {
  const sink = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: sink, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "Authorization: Bearer eyJpart1\n");
  log.write("stdout", `\t${SECRET}`);
  log.flush();
  log.seal();
  const image = sink.contents().toString("utf8");
  assert.equal(image.includes(SECRET), false, image);
});

test("R29 Basic first-value line plus unterminated fold does not leak on flush", () => {
  const sink = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: sink, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "Authorization:\n");
  log.write("stdout", "Basic\n");
  log.write("stdout", `\t${SECRET}`);
  log.flush();
  const image = sink.contents().toString("utf8");
  assert.equal(image.includes(SECRET), false, image);
});

test("R29 NEL/LS/PS Authorization folds do not leak on flush", () => {
  for (const sep of ["\u0085", "\u2028", "\u2029"]) {
    const sink = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout: sink, stderr: createMemoryLogSink() },
    });
    log.write("stdout", "Authorization: Bearer eyJpart1\n");
    log.write("stdout", `${sep}\t${SECRET}\n`);
    log.flush();
    log.seal();
    const image = sink.contents().toString("utf8");
    assert.equal(image.includes(SECRET), false, image);
  }
});

test("R29 executeRun durable stdout omits unterminated Authorization fold", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r29-fold-"));
  const stdoutPath = join(dir, "stdout.log");
  try {
    const executeSink = createFileLogSink(stdoutPath);
    await runWith({
      spawn: trackingSpawn(() => exitingProcess({
        stdout: Readable.from(["Authorization: Bearer eyJpart1\n", `\t${SECRET}`]),
      })),
      logSinks: { stdout: executeSink, stderr: createMemoryLogSink() },
    });
    const durable = readFileSync(stdoutPath, "utf8");
    assert.equal(durable.includes(SECRET), false, durable);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R29 executeRun durable stderr omits unterminated Authorization fold", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r29-err-"));
  const stderrPath = join(dir, "stderr.log");
  try {
    await runWith({
      spawn: trackingSpawn(() => exitingProcess({
        stderr: Readable.from(["Authorization: Bearer eyJpart1\n", `\t${SECRET}`]),
      })),
      logSinks: { stdout: createMemoryLogSink(), stderr: createFileLogSink(stderrPath) },
    });
    const durable = readFileSync(stderrPath, "utf8");
    assert.equal(durable.includes(SECRET), false, durable);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R29 two list/save wrappers around one backing cannot respawn a recovered runId", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r29-twoobj-"));
  const previousRoot = process.env[DIRECTOR_ROOT_ENV];
  process.env[DIRECTOR_ROOT_ENV] = join(dir, "store");
  try {
    mkdirSync(join(dir, "store"), { recursive: true });
    const rootA = join(dir, "A", "run");
    const rootB = join(dir, "B", "run");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const promptB = join(rootB, "PROMPT.md");
    writeFileSync(promptB, "prompt\n");
    const shared = memoryFs({
      dirs: [CWD, rootA, rootB],
      files: { [promptB]: "prompt\n" },
    });
    const backing = memoryLeases();
    const storeA: LeaseStoreV1 = { list: () => backing.list(), save: (next) => backing.save(next) };
    const storeB: LeaseStoreV1 = { list: () => backing.list(), save: (next) => backing.save(next) };
    shared.writeDurable(join(rootA, "intent.json"), recordedIntent({ runId: "run-twoobj" }));
    const first = await recoverAbandonedRun(rootA, {
      fs: shared,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
      leases: storeA,
    });
    assert.equal(first.spawned, true, first.reason);
    const spawn = trackingSpawn(() => exitingProcess());
    const relocated = await runWith({
      request: { runRoot: rootB, runId: "run-twoobj", promptPath: promptB },
      leases: storeB,
      fs: shared,
      spawn,
    });
    assert.equal(spawn.calls, 0, relocated.reason);
    assert.match(relocated.reason, /recorded completion already exists/i);
  } finally {
    if (previousRoot === undefined) delete process.env[DIRECTOR_ROOT_ENV];
    else process.env[DIRECTOR_ROOT_ENV] = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R29 missing no-root completion directory after recover is unreadable not none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r29-delidx-"));
  const previousRoot = process.env[DIRECTOR_ROOT_ENV];
  process.env[DIRECTOR_ROOT_ENV] = join(dir, "store");
  try {
    mkdirSync(join(dir, "store"), { recursive: true });
    const rootA = join(dir, "A", "run");
    const rootB = join(dir, "B", "run");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const promptB = join(rootB, "PROMPT.md");
    writeFileSync(promptB, "prompt\n");
    writeFileSync(join(rootA, "intent.json"), recordedIntent({ runId: "run-delidx" }));
    const realFs = createNodeRunFileSystem();
    const noRoot: LeaseStoreV1 = memoryLeases();
    const first = await recoverAbandonedRun(rootA, {
      fs: realFs,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
      leases: noRoot,
    });
    assert.equal(first.spawned, true, first.reason);
    rmSync(join(dir, "store", "run-completions"), { recursive: true, force: true });
    const spawn = trackingSpawn(() => exitingProcess());
    const relocated = await runWith({
      request: {
        runRoot: rootB,
        runId: "run-delidx",
        promptPath: promptB,
        cwd: rootB,
        worktree: rootB,
        lease: { kind: "WORKTREE", resource: rootB, leaseId: "lease-wt-delidx" },
      },
      leases: noRoot,
      fs: realFs,
      spawn,
    });
    assert.equal(spawn.calls, 0, relocated.reason);
    assert.match(relocated.reason, /unreadable|recorded completion/i);
  } finally {
    if (previousRoot === undefined) delete process.env[DIRECTOR_ROOT_ENV];
    else process.env[DIRECTOR_ROOT_ENV] = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// wiring / liveness
// ---------------------------------------------------------------------------

test("R29 array-like snapshot leftover cannot release a WORKTREE lease", () => {
  const leftover = {
    pid: 25100,
    parentPid: 18016,
    parentPresent: true,
    parentName: "explorer.exe",
    creationDate: T0,
    runNonce: "will-replace",
    nonceReadable: true,
  };
  const dir = mkdtempSync(join(tmpdir(), "d2-r29-arraylike-"));
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
    leftover.runNonce = acquired.lease.processIdentity?.runToken ?? leftover.runNonce;
    const released = releaseDeveloperAgentWorktreeLease(store, acquired.lease, {
      scanOrphans: () => ({
        snapshot: { 0: leftover, length: 1 },
        liveSightings: [],
        killable: [],
        undecidable: [],
      }) as never,
    });
    assert.equal(released.ok, false, released.reason);
    assert.equal(store.list().length > 0, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R29 Proxy killable with leftover at [0] and length 0 cannot release", () => {
  const leftover = {
    pid: 25100,
    parentPid: 18016,
    parentPresent: true,
    parentName: "explorer.exe",
    creationDate: T0,
  };
  const dir = mkdtempSync(join(tmpdir(), "d2-r29-proxy-"));
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
    const killable = new Proxy([leftover], {
      get(target, prop, receiver) {
        if (prop === "length") return 0;
        return Reflect.get(target, prop, receiver);
      },
    });
    const released = releaseDeveloperAgentWorktreeLease(store, acquired.lease, {
      scanOrphans: () => ({
        liveSightings: [],
        undecidable: [],
        killable,
      }) as never,
    });
    assert.equal(released.ok, false, released.reason);
    assert.equal(store.list().length > 0, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
