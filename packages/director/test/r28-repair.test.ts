/**
 * Round 28 fail-closed repairs. Each case is a proven R28 hostile finding.
 * Helpers are local. R25/R26/R27 cases stay in their own files.
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
  redactLogText,
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
  descendantPidsOf,
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

function exitingProcess(opts: { exitCode?: number; pid?: number; stdout?: Readable } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: opts.stdout ?? Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: null }),
    get exited() { return true; },
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

const laterRecycledOccupant = {
  pid: 99006,
  parentPid: 4812,
  parentPresent: true as const,
  parentCreationDate: "2026-08-13T12:00:21.000Z",
  creationDate: "2026-08-13T12:00:21.100Z",
  nonceReadable: false,
};

const laterRecycledGrandchild = {
  pid: 99007,
  parentPid: 99006,
  parentPresent: true as const,
  parentCreationDate: "2026-08-13T12:00:21.100Z",
  creationDate: "2026-08-13T12:00:21.200Z",
  nonceReadable: false,
};

function leftoverScan(killed: number[], rows: readonly typeof recycledOccupant[]) {
  return writerOrphanScanResult(rows.filter((row) => !killed.includes(row.pid)));
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

function incrementingClock(startIso = HOLDER_EXIT, maxSteps = 40): { now: () => string } {
  let ticks = 0;
  const start = Date.parse(startIso);
  return {
    now() {
      const n = Math.min(ticks, maxSteps);
      ticks += 1;
      return new Date(start + n).toISOString();
    },
  };
}

// ---------------------------------------------------------------------------
// persist / identity
// ---------------------------------------------------------------------------

test("R28 sampled descendants apply the recycle ceiling", () => {
  const rows = [recycledOccupant, recycledGrandchild];
  const unbounded = new Set<number>();
  rememberSampledDescendantPids(unbounded, 4812, rows);
  assert.equal(unbounded.has(99006), true);
  assert.equal(unbounded.has(99007), true);

  const bounded = new Set<number>();
  rememberSampledDescendantPids(bounded, 4812, rows, {
    createdNotBefore: HOLDER_EXIT,
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(bounded.has(99006), false);
  assert.equal(bounded.has(99007), false);
  assert.equal(descendantPidsOf(4812, rows, {
    createdNotBefore: HOLDER_EXIT,
    holderExitedAt: HOLDER_EXIT,
  }).has(99006), false);
});

test("R28 grandchild of a post-exit holder-slot occupant is not killed then PASSed", async () => {
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: HOLDER_EXIT,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [recycledOccupant, recycledGrandchild],
  });
  assert.equal(processRowCouldBelongToThisRun(recycledOccupant, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(recycledGrandchild, ctx), false);

  const killed: number[] = [];
  const rows = [recycledOccupant, recycledGrandchild];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
  });
  assert.equal(killed.includes(99006), false, JSON.stringify(killed));
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok && killed.includes(99007), true, result.reason);
});

test("R28 post-exit ancestry sample cannot smuggle a recycled grandchild into observedPids", async () => {
  const killed: number[] = [];
  const rows = [recycledOccupant, recycledGrandchild];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
    sampleAncestry: () => rows,
  });
  assert.equal(killed.includes(99006), false, JSON.stringify(killed));
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok && killed.includes(99007), true, result.reason);
});

test("R28 incrementing clock plus post-exit ancestry sample does not kill a recycled grandchild", async () => {
  const killed: number[] = [];
  const rows = [laterRecycledOccupant, laterRecycledGrandchild];
  const result = await runWith({
    clock: incrementingClock(HOLDER_EXIT),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
    sampleAncestry: () => rows,
  });
  assert.equal(killed.includes(99006), false, JSON.stringify(killed));
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok && killed.includes(99007), true, result.reason);
});

test("R28 PRODUCTION_WRITER does not SAFE_RELEASE after a recycled grandchild", async () => {
  const killed: number[] = [];
  const rows = [recycledOccupant, recycledGrandchild];
  const result = await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-r28" } },
    leases: memoryLeases([writerLease()]),
    clock: { now: () => HOLDER_EXIT },
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

test("R28 same-line Authorization plus obs-fold redacts every continuation", () => {
  for (const text of [
    `Authorization: Bearer eyJpart1\n\t${SECRET}`,
    `Authorization: Basic abc\n\t${SECRET}`,
    `Proxy-Authorization: Bearer eyJ\n\t${SECRET}`,
    `Authorization: token\n\ta\n\t${SECRET}`,
  ]) {
    const out = redactLogText(text);
    assert.equal(out.includes(SECRET), false, `${text} => ${out}`);
  }
});

test("R28 Authorization hold stays closed after a completed first value line", () => {
  const sink = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: sink, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "Authorization:\n");
  log.write("stdout", "Basic\n");
  log.write("stdout", `\t${SECRET}\n`);
  log.seal();
  const image = sink.contents().toString("utf8");
  assert.equal(image.includes(SECRET), false, image);
});

test("R28 executeRun durable stdout omits obs-fold after Authorization Basic", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r28-basic-"));
  const stdoutPath = join(dir, "stdout.log");
  try {
    const executeSink = createFileLogSink(stdoutPath);
    await runWith({
      spawn: trackingSpawn(() => exitingProcess({
        stdout: Readable.from(["Authorization:\nBasic\n", `\t${SECRET}\n`]),
      })),
      logSinks: { stdout: executeSink, stderr: createMemoryLogSink() },
    });
    const durable = readFileSync(stdoutPath, "utf8");
    assert.equal(durable.includes(SECRET), false, durable);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R28 executeRun durable stdout omits obs-fold after same-line Bearer value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r28-bearer-"));
  const stdoutPath = join(dir, "stdout.log");
  try {
    const executeSink = createFileLogSink(stdoutPath);
    await runWith({
      spawn: trackingSpawn(() => exitingProcess({
        stdout: Readable.from(["Authorization: Bearer eyJpart1\n", `\t${SECRET}\n`]),
      })),
      logSinks: { stdout: executeSink, stderr: createMemoryLogSink() },
    });
    const durable = readFileSync(stdoutPath, "utf8");
    assert.equal(durable.includes(SECRET), false, durable);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R28 list/save-only store still blocks relocated executeRun after recover", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r28-noroot-"));
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
    const noRoot: LeaseStoreV1 = memoryLeases();
    shared.writeDurable(join(rootA, "intent.json"), recordedIntent({ runId: "run-noroot" }));
    const first = await recoverAbandonedRun(rootA, {
      fs: shared,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
      leases: noRoot,
    });
    assert.equal(first.spawned, true, first.reason);
    assert.notEqual(first.resultPersisted, "failed", first.reason);
    const spawn = trackingSpawn(() => exitingProcess());
    const relocated = await runWith({
      request: { runRoot: rootB, runId: "run-noroot", promptPath: promptB },
      leases: noRoot,
      fs: shared,
      spawn,
    });
    assert.equal(spawn.calls, 0, relocated.reason);
    assert.match(relocated.reason, /recorded completion already exists/i);
    const indexWritten = [...shared.files.keys()].some((path) => path.replaceAll("\\", "/").endsWith("/run-noroot.json"));
    assert.equal(indexWritten, true, [...shared.files.keys()].join("\n"));
    assert.equal(
      [...shared.files.keys()].some((path) => path.replaceAll("\\", "/").includes("/A/.run-completions/")
        || path.replaceAll("\\", "/").includes("/B/.run-completions/")),
      false,
    );
  } finally {
    if (previousRoot === undefined) delete process.env[DIRECTOR_ROOT_ENV];
    else process.env[DIRECTOR_ROOT_ENV] = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R28 blank store root does not fall back to dirname(runRoot)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r28-blankroot-"));
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
    const realFs = createNodeRunFileSystem();
    writeFileSync(join(rootA, "intent.json"), recordedIntent({ runId: "run-blankroot" }));
    const blankRoot: LeaseStoreV1 = { ...memoryLeases(), root: "" };
    const first = await recoverAbandonedRun(rootA, {
      fs: realFs,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
      leases: blankRoot,
    });
    assert.equal(first.spawned, true, first.reason);
    const spawn = trackingSpawn(() => exitingProcess());
    const relocated = await runWith({
      request: {
        runRoot: rootB,
        runId: "run-blankroot",
        promptPath: promptB,
        cwd: rootB,
        worktree: rootB,
        lease: { kind: "WORKTREE", resource: rootB, leaseId: "lease-wt-blank" },
      },
      leases: blankRoot,
      fs: realFs,
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

// ---------------------------------------------------------------------------
// wiring / liveness
// ---------------------------------------------------------------------------

test("R28 dual-shape release cannot ignore killable leftovers", () => {
  const leftover = {
    pid: 25100,
    parentPid: 18016,
    parentPresent: true,
    parentName: "explorer.exe",
    creationDate: T0,
  };
  const shapes: readonly Record<string, unknown>[] = [
    { liveSightings: [], killable: [leftover] },
    { undecidable: [], killable: [leftover] },
    { liveSightings: [], undecidable: [], killable: [leftover] },
    { snapshot: "not-array", liveSightings: [], killable: [leftover] },
    { snapshot: [], killable: { 0: leftover, length: 1 } },
    { snapshot: [], killable: [leftover], liveSightings: [{ pid: 25100 }], undecidable: [] },
  ];
  for (const [index, shape] of shapes.entries()) {
    const dir = mkdtempSync(join(tmpdir(), `d2-r28-killable-${index}-`));
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
      assert.equal(acquired.ok, true, JSON.stringify(shape));
      if (!acquired.ok) return;
      const released = releaseDeveloperAgentWorktreeLease(store, acquired.lease, {
        scanOrphans: () => shape as never,
      });
      assert.equal(released.ok, false, `${JSON.stringify(shape)} => ${released.reason}`);
      assert.equal(store.list().length > 0, true, JSON.stringify(shape));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
