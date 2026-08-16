/**
 * Round 23 property repairs. Each case below must fail on
 * b2b92827417e7a037fd1612596a4b968ef8b3b33 and pass after the matching
 * property fix. Helpers are local.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFileLogSink,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
  redactLogText,
} from "../src/bounded-log.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import type { GitRunner } from "../src/git-truth.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
  type NodeLeaseStoreOptionsV1,
} from "../src/lease-store.js";
import {
  acquireLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  createdBeforeFloor,
  createWindowsOrphanScanner,
  holderLiveness,
  hostWideTreeEvidenceFromScan,
  interpretWindowsOrphanScanOutput,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  rememberMeasurementApparatusPid,
  rowIsMeasurementApparatus,
  undecidableRowsOf,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import { DIRECTOR_STORE_LAYOUT_V1 } from "../src/store-contract.js";
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

const NOW = "2026-08-13T12:00:00.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const OTHER = "C:\\other";
const ELSEWHERE = "C:\\somewhere-else";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const CLAUDE_EXE = "C:\\Tools\\claude.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const NONCE_0 = "nonce-run-0";
const T0 = "2026-08-13T12:00:01.000Z";
const FLOOR = "2026-08-13T12:00:00.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";
const AFTER = "2026-08-13T12:00:05.000Z";
const AFTER_CEILING = "2026-08-13T12:00:11.000Z";
const BOOT = "2026-08-01T00:00:00.000Z";
const LONG_AGO = "2026-08-13T10:00:00.000Z";
const EXPIRED = "2026-08-13T12:20:00.000Z";

function asObservation(value: Record<string, unknown>): ProcessObservationV1 {
  return value as unknown as ProcessObservationV1;
}

function claudeImplementerArgv(): string[] {
  return ["-p", "--permission-mode", "bypassPermissions"];
}

function claudeReviewArgv(): string[] {
  return ["-p", "--permission-mode", "plan"];
}

function matchingDiscovery(): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => (path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe") || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
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
  if (!files.has(PROMPT)) files.set(PROMPT, "prompt\n");
  const dirs = new Set(seed.dirs ?? [CWD, OTHER, ELSEWHERE, RUN_ROOT]);
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

function matchingGit(
  head = HEAD_AFTER,
  opts: { readonly advance?: boolean; readonly inspectedWorktree?: string } = {},
): GitRunner {
  let revParses = 0;
  return {
    ...(opts.inspectedWorktree !== undefined ? { inspectedWorktree: opts.inspectedWorktree } : { inspectedWorktree: CWD }),
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        revParses += 1;
        const sha = opts.advance === true && revParses === 1 ? HEAD_BEFORE : head;
        return { argv: [...argv], status: 0, stdout: `${sha}\n`, stderr: "", error: null };
      }
      if (key === "symbolic-ref -q --short HEAD") {
        return { argv: [...argv], status: 0, stdout: "executor/oracle\n", stderr: "", error: null };
      }
      if (key === "status --porcelain") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "status" && argv.some((item) => String(item).startsWith("--ignored"))) {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
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
      throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
    },
  };
}

function exitingProcess(opts: { exitCode?: number; pid?: number; stdout?: Readable; signal?: string | null } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: opts.stdout ?? Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: opts.signal ?? null }),
    get exited() {
      return true;
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

function notFoundProbe(): { observe: (pid: number) => ProcessObservationV1 } {
  return { observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "no process occupies this pid", pid }) };
}

function writerLease(over: {
  pid?: number | null;
  processIdentity?: LeaseV1["processIdentity"];
  leaseId?: string;
  runId?: string;
  now?: string;
  resource?: string;
} = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: over.leaseId ?? "lease-pw-0",
    kind: "PRODUCTION_WRITER",
    resource: over.resource ?? "aion-production",
    missionId: "mission-1",
    runId: over.runId ?? "run-0",
    pid: over.pid === undefined ? 4812 : over.pid,
    ...(over.processIdentity !== undefined ? { processIdentity: over.processIdentity } : {
      processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE_0 },
    }),
    now: over.now ?? LONG_AGO,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

function leftoverNonce0(over: Record<string, unknown> = {}) {
  return {
    pid: 7055,
    name: "node.exe",
    parentPid: 4812,
    parentPresent: false,
    creationDate: T0,
    runNonce: NONCE_0,
    nonceReadable: true,
    sessionId: 1,
    ...over,
  };
}

function svchostSpoofRow(over: Record<string, unknown> = {}) {
  return {
    pid: 7100,
    name: "node.exe",
    parentPid: 1500,
    parentPresent: true,
    parentName: "svchost.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER_CEILING,
    nonceReadable: true,
    sessionId: 1,
    ...over,
  };
}

function datelessParentlessRow(over: Record<string, unknown> = {}) {
  return {
    pid: 55001,
    name: "node.exe",
    parentPid: 4900,
    parentPresent: false,
    nonceReadable: false,
    sessionId: 1,
    ...over,
  };
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
  logSinks?: RunManagerDepsV1["logSinks"];
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs({ dirs: [CWD, OTHER, ELSEWHERE, runRoot] });
  const role = over.request?.role ?? "IMPLEMENT";
  const headAfter = role === "INDEPENDENT_ACCEPTANCE" || role === "ADVERSARIAL_REVIEW"
    ? HEAD_BEFORE
    : HEAD_AFTER;
  const handoffText = JSON.stringify(goodHandoff({
    headAfter,
    headBefore: HEAD_BEFORE,
    executor: over.request?.executor ?? "claude",
    runId: over.request?.runId ?? "run-1",
    runNonce: over.request?.runNonce ?? NONCE,
  }));
  const innerSpawn = over.spawn ?? ((_e, _a, _o, _p) => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    try {
      fs.writeDurable(handoffPath, handoffText);
    } catch {
      // spawn still proceeds
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
    git: over.git ?? matchingGit(headAfter, { advance: role === "IMPLEMENT" }),
    probe: over.probe ?? notFoundProbe(),
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? (async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
    ...matchingDiscovery(),
  });
}

function treeFinding(result: { conjunction: { findings: readonly { name: string; ok: boolean; reason: string }[] } }) {
  return result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
}

function lockFiles(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".lock"));
  } catch {
    return [];
  }
}

function storeOptions(over: Record<string, unknown>): NodeLeaseStoreOptionsV1 {
  return over as NodeLeaseStoreOptionsV1;
}

function longestRun(haystack: string, needleChar: string): number {
  const re = new RegExp(`${needleChar}+`, "g");
  let best = 0;
  for (const match of haystack.match(re) ?? []) {
    if (match.length > best) best = match.length;
  }
  return best;
}

function makeTempRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `aion-r23-${label}-`));
}

// ---------------------------------------------------------------------------
// R1 — expired host-wide reclaim must prove the prior run's tree
// ---------------------------------------------------------------------------

test("R1 executeRun does not spawn a second writer when the prior holder slot is NOT_FOUND and a nonce leftover is live", async () => {
  const held = writerLease();
  const spawn = trackingSpawn(() => exitingProcess({ pid: 5555 }));
  const leftover = leftoverNonce0();
  const result = await runWith({
    spawn,
    leases: memoryLeases([held]),
    clock: createFixedClock(EXPIRED),
    probe: notFoundProbe(),
    scanOrphans: (query) => query.runNonce === NONCE_0
      ? writerOrphanScanResult([leftover])
      : writerOrphanScanResult([]),
    request: {
      runId: "run-1",
      runNonce: NONCE,
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" },
    },
  });
  assert.equal(result.spawned, false, result.reason);
  assert.equal(spawn.calls, 0, `second writer must not spawn; reason=${result.reason}`);
  assert.match(
    result.reason,
    /process tree could not be shown clear|empty pid slot is not a dead run|lease refused/,
  );
});

test("R1 liveness: an empty scan of the prior run still reclaims the expired host-wide lease", async () => {
  const held = writerLease();
  const spawn = trackingSpawn(() => exitingProcess({ pid: 5555 }));
  const result = await runWith({
    spawn,
    leases: memoryLeases([held]),
    clock: createFixedClock(EXPIRED),
    probe: notFoundProbe(),
    scanOrphans: () => writerOrphanScanResult([]),
    request: {
      runId: "run-1",
      runNonce: NONCE,
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" },
    },
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(spawn.calls, 1, result.reason);
});

test("R1 a held host-wide lease with no runToken is not reclaimed on NOT_FOUND", async () => {
  const held = writerLease({
    processIdentity: { pid: 4812, startedAt: T0 },
  });
  const spawn = trackingSpawn(() => exitingProcess({ pid: 5555 }));
  const result = await runWith({
    spawn,
    leases: memoryLeases([held]),
    clock: createFixedClock(EXPIRED),
    probe: notFoundProbe(),
    scanOrphans: () => writerOrphanScanResult([]),
    request: {
      runId: "run-1",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" },
    },
  });
  assert.equal(result.spawned, false, result.reason);
  assert.equal(spawn.calls, 0, result.reason);
});

test("R1 scanOrphans throw refuses reclaim and does not spawn", async () => {
  const held = writerLease();
  const spawn = trackingSpawn(() => exitingProcess({ pid: 5555 }));
  const result = await runWith({
    spawn,
    leases: memoryLeases([held]),
    clock: createFixedClock(EXPIRED),
    probe: notFoundProbe(),
    scanOrphans: () => {
      throw new Error("CIM down");
    },
    request: {
      runId: "run-1",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" },
    },
  });
  assert.equal(result.spawned, false, result.reason);
  assert.equal(spawn.calls, 0, result.reason);
  assert.match(result.reason, /lease refused|process tree|confirm the process is gone/);
});

test("FINAL PROOF two-writer: leftover withholds run-0; TTL + NOT_FOUND does not spawn run-1; empty scan reclaims", async () => {
  const leases = memoryLeases();
  let leftoverPresent = true;
  const leftover = leftoverNonce0();
  const clockNow = { value: NOW };
  const spawn0 = trackingSpawn(() => exitingProcess({ pid: 4812 }));
  const run0 = await runWith({
    spawn: spawn0,
    leases,
    clock: { now: () => clockNow.value },
    probe: notFoundProbe(),
    scanOrphans: (query) => leftoverPresent && query.runNonce === NONCE_0
      ? writerOrphanScanResult([leftover])
      : writerOrphanScanResult([]),
    request: {
      runId: "run-0",
      runNonce: NONCE_0,
      runRoot: "C:\\AION\\director\\RUNS\\run-0",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-0" },
    },
  });
  assert.equal(run0.spawned, true, run0.reason);
  assert.equal(run0.productionWriterLeaseReleasedByThisRun, false, run0.reason);
  assert.equal(leases.list().some((row) => row.kind === "PRODUCTION_WRITER"), true);

  clockNow.value = EXPIRED;
  const spawn1 = trackingSpawn(() => exitingProcess({ pid: 5555 }));
  const run1 = await runWith({
    spawn: spawn1,
    leases,
    clock: { now: () => clockNow.value },
    probe: notFoundProbe(),
    scanOrphans: (query) => leftoverPresent && query.runNonce === NONCE_0
      ? writerOrphanScanResult([leftover])
      : writerOrphanScanResult([]),
    request: {
      runId: "run-1",
      runNonce: NONCE,
      runRoot: "C:\\AION\\director\\RUNS\\run-1",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" },
    },
  });
  assert.equal(run1.spawned, false, `safety half: ${run1.reason}`);
  assert.equal(spawn1.calls, 0, run1.reason);

  leftoverPresent = false;
  const spawnLive = trackingSpawn(() => exitingProcess({ pid: 5556 }));
  const live = await runWith({
    spawn: spawnLive,
    leases,
    clock: { now: () => clockNow.value },
    probe: notFoundProbe(),
    scanOrphans: () => writerOrphanScanResult([]),
    request: {
      runId: "run-2",
      runNonce: "nonce-run-2",
      runRoot: "C:\\AION\\director\\RUNS\\run-2",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-2" },
    },
  });
  assert.equal(live.spawned, true, `liveness half: ${live.reason}`);
  assert.equal(spawnLive.calls, 1, live.reason);
});

// ---------------------------------------------------------------------------
// R2 — host lock file uses the same tree evidence
// ---------------------------------------------------------------------------

test("R2 host-wide lock with holder pid NOT_FOUND and tree LIVE is not unlinked", () => {
  const rootA = makeTempRoot("r2a");
  const rootB = makeTempRoot("r2b");
  const arbitration = makeTempRoot("r2arb");
  try {
    const probe = notFoundProbe();
    const storeA = createNodeLeaseStore(rootA, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: () => "LIVE",
    }));
    const first = acquireLease({
      existing: [],
      leaseId: "lease-a",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m1",
      runId: "run-a",
      pid: 4812,
      processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE_0 },
      now: LONG_AGO,
    });
    assert.equal(first.ok, true, first.reason);
    storeA.save([first.lease!]);
    const locksDir = join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir);
    const before = lockFiles(locksDir, "production-writer-");
    assert.equal(before.length, 1, `expected one lock, got ${before.join(",")}`);

    const storeB = createNodeLeaseStore(rootB, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: () => "LIVE",
    }));
    const second = acquireLease({
      existing: storeB.list(),
      leaseId: "lease-b",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m2",
      runId: "run-b",
      pid: 5555,
      processIdentity: { pid: 5555, startedAt: EXPIRED, runToken: NONCE },
      now: EXPIRED,
    });
    assert.equal(second.ok, true, second.reason);
    assert.throws(() => storeB.save([second.lease!]), /process tree is not proven clear|already held|host-wide/);
    const after = lockFiles(locksDir, "production-writer-");
    assert.equal(after.length, 1, `lock must remain; got ${after.join(",")}`);
    assert.ok(existsSync(join(locksDir, before[0]!)));
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(arbitration, { recursive: true, force: true });
  }
});

test("R2 liveness: tree CLEAR reclaims the host-wide lock", () => {
  const rootA = makeTempRoot("r2la");
  const rootB = makeTempRoot("r2lb");
  const arbitration = makeTempRoot("r2larb");
  try {
    const probe = notFoundProbe();
    const storeA = createNodeLeaseStore(rootA, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: () => "CLEAR",
    }));
    const first = acquireLease({
      existing: [],
      leaseId: "lease-a",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m1",
      runId: "run-a",
      pid: 4812,
      processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE_0 },
      now: LONG_AGO,
    });
    storeA.save([first.lease!]);

    const storeB = createNodeLeaseStore(rootB, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: () => "CLEAR",
    }));
    const second = acquireLease({
      existing: storeB.list(),
      leaseId: "lease-b",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m2",
      runId: "run-b",
      pid: 5555,
      now: EXPIRED,
    });
    storeB.save([second.lease!]);
    assert.equal(storeB.list().length, 1);
    assert.equal(lockFiles(join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir), "production-writer-").length, 1);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(arbitration, { recursive: true, force: true });
  }
});

test("R2 tree UNKNOWN or a throwing supplier refuses and leaves the lock; holderState is UNKNOWN", () => {
  for (const evidence of [
    () => "UNKNOWN" as const,
    () => {
      throw new Error("scanner exploded");
    },
  ]) {
    const rootA = makeTempRoot("r2u");
    const rootB = makeTempRoot("r2u2");
    const arbitration = makeTempRoot("r2uarb");
    try {
      const probe = notFoundProbe();
      const storeA = createNodeLeaseStore(rootA, storeOptions({
        hostArbitrationRoot: arbitration,
        probe,
        hostLockTreeEvidence: evidence,
      }));
      const first = acquireLease({
        existing: [],
        leaseId: "lease-a",
        kind: "PRODUCTION_WRITER",
        resource: "writer-shared",
        missionId: "m1",
        runId: "run-a",
        pid: 4812,
        processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE_0 },
        now: LONG_AGO,
      });
      storeA.save([first.lease!]);
      const locksDir = join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir);
      const before = lockFiles(locksDir, "production-writer-");
      const storeB = createNodeLeaseStore(rootB, storeOptions({
        hostArbitrationRoot: arbitration,
        probe,
        hostLockTreeEvidence: evidence,
      }));
      const second = acquireLease({
        existing: [],
        leaseId: "lease-b",
        kind: "PRODUCTION_WRITER",
        resource: "writer-shared",
        missionId: "m2",
        runId: "run-b",
        pid: 5555,
        now: EXPIRED,
      });
      let thrown: unknown;
      try {
        storeB.save([second.lease!]);
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof Error, "save must refuse");
      assert.match(thrown.message, /process tree is not proven clear|UNKNOWN|already held|host-wide/);
      assert.doesNotMatch(thrown.message, /holder liveness ALIVE|holderState.: .HELD/);
      assert.equal(lockFiles(locksDir, "production-writer-").length, 1);
      assert.ok(existsSync(join(locksDir, before[0]!)));
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
      rmSync(arbitration, { recursive: true, force: true });
    }
  }
});

test("R2 a host-wide lock holder record with no runToken is UNKNOWN, not reclaimed", () => {
  const rootA = makeTempRoot("r2tok");
  const rootB = makeTempRoot("r2tok2");
  const arbitration = makeTempRoot("r2tokarb");
  try {
    const probe = notFoundProbe();
    const storeA = createNodeLeaseStore(rootA, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: () => "CLEAR",
    }));
    const first = acquireLease({
      existing: [],
      leaseId: "lease-a",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m1",
      runId: "run-a",
      pid: 4812,
      processIdentity: { pid: 4812, startedAt: T0 },
      now: LONG_AGO,
    });
    storeA.save([first.lease!]);
    const locksDir = join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir);
    const storeB = createNodeLeaseStore(rootB, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: () => "CLEAR",
    }));
    const second = acquireLease({
      existing: [],
      leaseId: "lease-b",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m2",
      runId: "run-b",
      pid: 5555,
      now: EXPIRED,
    });
    assert.throws(() => storeB.save([second.lease!]), /process tree is not proven clear|UNKNOWN|already held|host-wide/);
    assert.equal(lockFiles(locksDir, "production-writer-").length, 1);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(arbitration, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R3 — host singleton lock key is the kind, matching conflicts()
// ---------------------------------------------------------------------------

test("FINAL PROOF one-writer-per-host: two different PRODUCTION_WRITER tokens share one lock", () => {
  const rootA = makeTempRoot("r3a");
  const rootB = makeTempRoot("r3b");
  const arbitration = makeTempRoot("r3arb");
  try {
    const storeA = createNodeLeaseStore(rootA, storeOptions({
      hostArbitrationRoot: arbitration,
      probe: { observe: () => asObservation({ outcome: "FOUND", reason: "live", pid: process.pid, creationDate: T0 }) },
    }));
    const first = acquireLease({
      existing: [],
      leaseId: "lease-a",
      kind: "PRODUCTION_WRITER",
      resource: "writer-a",
      missionId: "m1",
      runId: "run-a",
      pid: process.pid,
      processIdentity: { pid: process.pid, startedAt: T0, runToken: NONCE_0 },
      now: NOW,
    });
    assert.equal(first.ok, true, first.reason);
    storeA.save([first.lease!]);

    const storeB = createNodeLeaseStore(rootB, storeOptions({
      hostArbitrationRoot: arbitration,
      probe: { observe: () => asObservation({ outcome: "FOUND", reason: "live", pid: process.pid, creationDate: T0 }) },
    }));
    const second = acquireLease({
      existing: storeB.list(),
      leaseId: "lease-b",
      kind: "PRODUCTION_WRITER",
      resource: "writer-b",
      missionId: "m2",
      runId: "run-b",
      pid: process.pid + 1,
      now: NOW,
    });
    assert.equal(second.ok, true, "in-memory acquire on an empty store B must succeed; the lock is the guard");
    assert.throws(() => storeB.save([second.lease!]), /already held|host-wide|EEXIST|process tree/);
    const locks = lockFiles(join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir), "production-writer-");
    assert.equal(locks.length, 1, `exactly one production-writer lock; got ${locks.join(",")}`);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(arbitration, { recursive: true, force: true });
  }
});

test("R3 two different INTEGRATION tokens share one lock", () => {
  const rootA = makeTempRoot("r3ia");
  const rootB = makeTempRoot("r3ib");
  const arbitration = makeTempRoot("r3iarb");
  try {
    const live = { observe: () => asObservation({ outcome: "FOUND", reason: "live", pid: process.pid, creationDate: T0 }) };
    const storeA = createNodeLeaseStore(rootA, storeOptions({ hostArbitrationRoot: arbitration, probe: live }));
    const first = acquireLease({
      existing: [],
      leaseId: "lease-ia",
      kind: "INTEGRATION",
      resource: "int-a",
      missionId: "m1",
      runId: "run-a",
      pid: process.pid,
      now: NOW,
    });
    storeA.save([first.lease!]);
    const storeB = createNodeLeaseStore(rootB, storeOptions({ hostArbitrationRoot: arbitration, probe: live }));
    const second = acquireLease({
      existing: [],
      leaseId: "lease-ib",
      kind: "INTEGRATION",
      resource: "int-b",
      missionId: "m2",
      runId: "run-b",
      pid: process.pid + 1,
      now: NOW,
    });
    assert.throws(() => storeB.save([second.lease!]), /already held|host-wide|EEXIST|process tree/);
    assert.equal(lockFiles(join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir), "integration-").length, 1);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(arbitration, { recursive: true, force: true });
  }
});

test("R3 liveness: PREVIEW with two different tokens keeps two lock files", () => {
  const root = makeTempRoot("r3prev");
  try {
    const store = createNodeLeaseStore(root);
    const a = acquireLease({
      existing: [],
      leaseId: "lease-pa",
      kind: "PREVIEW",
      resource: "preview-a",
      missionId: "m1",
      runId: "run-a",
      pid: 1,
      now: NOW,
    });
    store.save([a.lease!]);
    const b = acquireLease({
      existing: store.list(),
      leaseId: "lease-pb",
      kind: "PREVIEW",
      resource: "preview-b",
      missionId: "m2",
      runId: "run-b",
      pid: 2,
      now: NOW,
    });
    store.save([...store.list(), b.lease!]);
    assert.equal(lockFiles(store.locksDir, "preview-").length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4 — dev-agent WORKTREE reclaim uses the same stale-holder leaf
// ---------------------------------------------------------------------------

function seedExpiredWorktree(store: ReturnType<typeof createNodeLeaseStore>, over: {
  pid?: number;
  now?: string;
  startedAt?: string;
} = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "dev-agent-old",
    kind: "WORKTREE",
    resource: store.root,
    missionId: "dev-agent",
    runId: "dev-agent-old",
    pid: over.pid ?? 82672,
    processIdentity: { pid: over.pid ?? 82672, startedAt: over.startedAt ?? LONG_AGO },
    now: over.now ?? LONG_AGO,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  store.save([attempt.lease]);
  return attempt.lease;
}

test("FINAL PROOF dev-agent recovery: crashed WORKTREE NOT_FOUND is reclaimed; FOUND is refused", () => {
  const root = makeTempRoot("r4");
  const arb = makeTempRoot("r4arb");
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
    seedExpiredWorktree(store, { pid: 82672 });
    const recovered = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: root,
      now: EXPIRED,
      store,
      probe: notFoundProbe(),
    });
    assert.equal(recovered.ok, true, recovered.ok ? "" : recovered.reason);
    if (recovered.ok) {
      assert.equal(store.list().some((row) => row.runId === "dev-agent-old"), false);
      assert.equal(store.list().some((row) => row.kind === "WORKTREE"), true);
    }

    const liveRoot = makeTempRoot("r4live");
    const liveArb = makeTempRoot("r4livearb");
    try {
      const liveStore = createNodeLeaseStore(liveRoot, { hostArbitrationRoot: liveArb });
      seedExpiredWorktree(liveStore, { pid: 82672 });
      const refused = acquireDeveloperAgentWorktreeLease({
        repositoryRoot: liveRoot,
        now: EXPIRED,
        store: liveStore,
        probe: {
          observe: (pid) => asObservation({
            outcome: "FOUND",
            reason: "live",
            pid,
            creationDate: LONG_AGO,
          }),
        },
      });
      assert.equal(refused.ok, false, "live holder must refuse");
      assert.equal(liveStore.list().some((row) => row.runId === "dev-agent-old"), true);
    } finally {
      rmSync(liveRoot, { recursive: true, force: true });
      rmSync(liveArb, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(arb, { recursive: true, force: true });
  }
});

test("R4 safety: UNAVAILABLE, throwing probe, and unexpired NOT_FOUND all refuse", () => {
  const cases: Array<{
    name: string;
    now: string;
    probe: { observe: (pid: number) => ProcessObservationV1 };
  }> = [
    {
      name: "UNAVAILABLE",
      now: EXPIRED,
      probe: { observe: (pid) => asObservation({ outcome: "UNAVAILABLE", reason: "denied", pid }) },
    },
    {
      name: "throw",
      now: EXPIRED,
      probe: {
        observe: () => {
          throw new Error("probe exploded");
        },
      },
    },
    {
      name: "NOT_EXPIRED",
      now: NOW,
      probe: notFoundProbe(),
    },
  ];
  for (const item of cases) {
    const root = makeTempRoot("r4s");
    const arb = makeTempRoot("r4sarb");
    try {
      const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
      seedExpiredWorktree(store, { pid: 82672, now: item.name === "NOT_EXPIRED" ? NOW : LONG_AGO });
      const result = acquireDeveloperAgentWorktreeLease({
        repositoryRoot: root,
        now: item.now,
        store,
        probe: item.probe,
      });
      assert.equal(result.ok, false, `${item.name} must refuse`);
      assert.equal(store.list().some((row) => row.runId === "dev-agent-old"), true, `${item.name} must leave the row`);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(arb, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// R5 — startedAt is the OS creation instant, or absent
// ---------------------------------------------------------------------------

test("R5 dev-agent startedAt is the probe creationDate, not now", () => {
  const root = makeTempRoot("r5");
  const arb = makeTempRoot("r5arb");
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
    const creationDate = "2026-08-15T20:44:12.357Z";
    const now = "2026-08-15T20:44:13.931Z";
    const result = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: root,
      now,
      store,
      probe: {
        observe: (pid) => asObservation({
          outcome: "FOUND",
          reason: "cim",
          pid,
          creationDate,
          executablePath: CLAUDE_EXE,
        }),
      },
    });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    if (result.ok) {
      assert.equal(result.lease.processIdentity?.startedAt, creationDate);
      assert.notEqual(result.lease.processIdentity?.startedAt, now);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(arb, { recursive: true, force: true });
  }
});

test("R5 liveness: UNAVAILABLE, missing creationDate, or throw omit startedAt and still acquire", () => {
  const probes: Array<{ name: string; observe: (pid: number) => ProcessObservationV1 }> = [
    { name: "UNAVAILABLE", observe: (pid) => asObservation({ outcome: "UNAVAILABLE", reason: "denied", pid }) },
    { name: "no-date", observe: (pid) => asObservation({ outcome: "FOUND", reason: "cim", pid }) },
    {
      name: "throw",
      observe: () => {
        throw new Error("probe exploded");
      },
    },
  ];
  for (const item of probes) {
    const root = makeTempRoot("r5l");
    const arb = makeTempRoot("r5larb");
    try {
      const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
      const result = acquireDeveloperAgentWorktreeLease({
        repositoryRoot: root,
        now: NOW,
        store,
        probe: item,
      });
      assert.equal(result.ok, true, `${item.name}: ${result.ok ? "" : result.reason}`);
      if (result.ok) {
        assert.equal(
          result.lease.processIdentity?.startedAt,
          undefined,
          `${item.name} must omit startedAt`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(arb, { recursive: true, force: true });
    }
  }
});

test("R5 a live holder recorded from the probe reads holderLiveness ALIVE on re-probe", () => {
  const root = makeTempRoot("r5alive");
  const arb = makeTempRoot("r5alivearb");
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
    const creationDate = "2026-08-15T20:44:12.357Z";
    const observation = asObservation({
      outcome: "FOUND",
      reason: "cim",
      pid: process.pid,
      creationDate,
      executablePath: CLAUDE_EXE,
      runNonce: "dev-token",
    });
    const result = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: root,
      now: NOW,
      store,
      probe: { observe: () => observation },
    });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    if (!result.ok) return;
    const recorded: ExecutorProcessIdentityV1 = {
      pid: result.lease.processIdentity?.pid ?? process.pid,
      creationDate: result.lease.processIdentity?.startedAt ?? "",
      executablePath: CLAUDE_EXE,
      runNonce: "dev-token",
    };
    assert.equal(holderLiveness(recorded, observation), "ALIVE");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(arb, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R6 — a missing CreationDate is UNKNOWN, not proven absent
// ---------------------------------------------------------------------------

test("R6 a dateless parentless leftover is undecidable and withholds the writer lease", async () => {
  const row = datelessParentlessRow();
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 55001, parentPid: 4900 },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);

  const leases = memoryLeases();
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-r6" } },
    scanOrphans: () => writerOrphanScanResult([row]),
  });
  const tree = treeFinding(result);
  assert.equal(tree?.ok, false, tree?.reason);
  assert.match(tree?.reason ?? "", /55001|undecidable/);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
});

test("R6 date-present parentless leftover stays undecidable (regression)", () => {
  const row = datelessParentlessRow({ creationDate: AFTER });
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 55001, parentPid: 4900, creationDate: AFTER },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
});

test("R6 liveness: a row with a real creationDate before the floor is still excluded", () => {
  const row = datelessParentlessRow({ creationDate: BOOT, pid: 8800 });
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 8800, parentPid: 4900, creationDate: BOOT },
    ],
  });
  assert.equal(createdBeforeFloor(BOOT, FLOOR), true);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
});

test("R6 the production emit predicate emits a dateless non-descendant row", async () => {
  const { windowsOrphanScanEmitPredicate } = await import("../src/process-identity.js") as {
    windowsOrphanScanEmitPredicate?: string;
  };
  assert.equal(typeof windowsOrphanScanEmitPredicate, "string");
  assert.match(windowsOrphanScanEmitPredicate ?? "", /provenBeforeFloor/);
  assert.match(windowsOrphanScanEmitPredicate ?? "", /\$isDesc -or \(\(-not \$provenBeforeFloor\) -and -not \$parentProvenCapable\)/);
});

// ---------------------------------------------------------------------------
// R7 — a parent's image basename is not a negative fact
// ---------------------------------------------------------------------------

test("R7 a live svchost-parented row is host noise; the Job Object is the declared R7 closure", async () => {
  const row = svchostSpoofRow();
  const ctx = processRowPlausibilityContext({
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
  // R24 CLASS 1B: a live unrelated parent is a live explanation, not a
  // tie. The forged-parent spoof is a named KNOWN LIMIT, not closed by
  // treating the whole host as ours.
  assert.equal(parentlessRowTiedToThisRun(row, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  assert.equal(processRowMakesScanUndecidable(row, ctx), false);
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-r7" } },
    scanOrphans: () => writerOrphanScanResult([row]),
  });
  const tree = treeFinding(result);
  assert.equal(tree?.ok, true, tree?.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
});

test("R7 the same row parented by Code.exe is also host noise", async () => {
  const row = svchostSpoofRow({ parentName: "Code.exe" });
  const ctx = processRowPlausibilityContext({
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
  assert.equal(parentlessRowTiedToThisRun(row, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-r7c" } },
    scanOrphans: () => writerOrphanScanResult([row]),
  });
  assert.equal(treeFinding(result)?.ok, true, treeFinding(result)?.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
});

test("R7 liveness: genuine holder descendants stay tied; pre-floor noise stays excluded; session-0 stays excluded", () => {
  const descendant = {
    pid: 7101,
    name: "child.exe",
    parentPid: 4812,
    parentPresent: true,
    parentName: "claude.exe",
    parentCreationDate: T0,
    creationDate: AFTER,
    runNonce: NONCE,
    nonceReadable: true,
    sessionId: 1,
  };
  const preFloor = {
    pid: 8800,
    name: "noise.exe",
    parentPid: 4,
    parentPresent: false,
    creationDate: BOOT,
    sessionId: 1,
  };
  const session0 = svchostSpoofRow({ sessionId: 0, pid: 151452, parentPid: 1000, parentName: "svchost.exe" });
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 7101, parentPid: 4812, creationDate: AFTER },
      { pid: 8800, parentPid: 4, creationDate: BOOT },
      { pid: 151452, parentPid: 1000, creationDate: AFTER_CEILING },
      { pid: 1000, creationDate: BOOT },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(descendant, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(preFloor, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(session0, ctx), false);
});

test("R7 liveness: R22 WmiPrvSE/svchost 1800s window is still not tied", () => {
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

// ---------------------------------------------------------------------------
// R23b — apparatus exclusion restores liveness; parent basename still not a skip
// ---------------------------------------------------------------------------

function apparatusScannerRow(over: Record<string, unknown> = {}) {
  return {
    pid: 36996,
    name: "powershell.exe",
    parentPid: 1234,
    parentPresent: true,
    parentName: "node.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER_CEILING,
    nonceReadable: true,
    sessionId: 1,
    ...over,
  };
}

function apparatusConhostRow(over: Record<string, unknown> = {}) {
  return {
    pid: 109544,
    name: "conhost.exe",
    parentPid: 36996,
    parentPresent: true,
    parentName: "powershell.exe",
    parentCreationDate: AFTER_CEILING,
    creationDate: AFTER_CEILING,
    nonceReadable: true,
    sessionId: 1,
    ...over,
  };
}

function apparatusId(pid: number, at = AFTER_CEILING) {
  return { pid, creationNotBefore: at, creationNotAfter: at, creationDate: at };
}

function apparatusCtx(over: Parameters<typeof processRowPlausibilityContext>[0] extends infer T ? Partial<T> : never = {}) {
  return processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    directorPid: 1234,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 1234, creationDate: BOOT },
      { pid: 36996, parentPid: 1234, creationDate: AFTER_CEILING },
      { pid: 109544, parentPid: 36996, creationDate: AFTER_CEILING },
      { pid: 1500, creationDate: BOOT },
      { pid: 7100, parentPid: 1500, creationDate: AFTER_CEILING },
    ],
    ...over,
  });
}

test("R23b a live parented host row is not apparatus and is not tied (R24 1B; R7 is a named limit)", () => {
  const row = svchostSpoofRow();
  const ctx = apparatusCtx({ apparatusPids: [apparatusId(36996)] });
  assert.equal(rowIsMeasurementApparatus(row, ctx), false);
  assert.equal(parentlessRowTiedToThisRun(row, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  assert.equal(processRowMakesScanUndecidable(row, ctx), false);
  const codeRow = svchostSpoofRow({ parentName: "Code.exe" });
  assert.equal(processRowCouldBelongToThisRun(codeRow, ctx), false);
  assert.equal(processRowMakesScanUndecidable(codeRow, ctx), false);
});

test("R23b scanner powershell and its conhost are excluded by creation identity, not by parentName", () => {
  const scanner = apparatusScannerRow();
  const conhost = apparatusConhostRow();
  const orphanedConhost = apparatusConhostRow({ parentPresent: false });
  const without = apparatusCtx();
  // Live-parent scanner/conhost are host noise after R24 1B.
  assert.equal(processRowCouldBelongToThisRun(scanner, without), false);
  assert.equal(processRowCouldBelongToThisRun(conhost, without), false);
  // A conhost whose parent (the scanner) has left the snapshot is tied
  // until the creation identity excludes it — that is the R23b liveness win.
  assert.equal(processRowCouldBelongToThisRun(orphanedConhost, without), true);
  assert.equal(undecidableRowsOf([orphanedConhost], without).map((row) => row.pid).join(","), "109544");

  const withApparatus = apparatusCtx({ apparatusPids: [apparatusId(36996)] });
  assert.equal(rowIsMeasurementApparatus(scanner, withApparatus), true);
  assert.equal(rowIsMeasurementApparatus(conhost, withApparatus), true);
  assert.equal(rowIsMeasurementApparatus(orphanedConhost, withApparatus), true);
  assert.equal(processRowCouldBelongToThisRun(scanner, withApparatus), false);
  assert.equal(processRowCouldBelongToThisRun(conhost, withApparatus), false);
  assert.equal(processRowCouldBelongToThisRun(orphanedConhost, withApparatus), false);
  assert.equal(undecidableRowsOf([scanner, conhost, orphanedConhost, svchostSpoofRow()], withApparatus).map((row) => row.pid).join(","), "");
});

test("R23b a leftover parented by the Director pid is not apparatus (R7 spoof is a named limit)", () => {
  const spoof = {
    pid: 7100,
    name: "node.exe",
    parentPid: 1234,
    parentPresent: true,
    parentName: "node.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER_CEILING,
    nonceReadable: true,
    sessionId: 1,
  };
  const ctx = apparatusCtx({ apparatusPids: [apparatusId(36996)], directorPid: 1234 });
  assert.equal(rowIsMeasurementApparatus(spoof, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(spoof, ctx), false);
  assert.equal(processRowMakesScanUndecidable(spoof, ctx), false);
});

test("R23b interpret drops apparatus rows so the scan is SCANNED", () => {
  const scanner = apparatusScannerRow();
  const conhost = apparatusConhostRow({ parentPresent: false });
  const without = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, processes: [scanner, conhost], unreadable: 0, directorSessionId: 1 }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorPid: 1234,
  });
  assert.equal(without.outcome, "UNAVAILABLE", without.reason);
  assert.match(without.reason, /undecidable process-tree membership/);

  const withApparatus = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, processes: [scanner, conhost], unreadable: 0, directorSessionId: 1 }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorPid: 1234,
    apparatusPids: [apparatusId(36996)],
  });
  assert.equal(withApparatus.outcome, "SCANNED", withApparatus.reason);
});

test("R23b the envelope scannerPid is excluded even when spawnSync.pid is a wrapper", () => {
  const scannerRow = apparatusScannerRow({ pid: 144916, parentPid: 1234 });
  const conhostRow = apparatusConhostRow({ pid: 65700, parentPid: 144916 });
  const leftover = svchostSpoofRow();
  const scanner = createWindowsOrphanScanner({
    spawnSync: () => ({
      status: 0,
      pid: 91512,
      stdout: JSON.stringify({
        ok: true,
        processes: [scannerRow, conhostRow],
        unreadable: 0,
        directorSessionId: 1,
        scannerPid: 144916,
        scannerCreationDate: AFTER_CEILING,
      }),
      stderr: "",
    }),
    waitSync: () => undefined,
  });
  const result = scanner({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
  });
  assert.equal(result.snapshot.length, 2);
  const ctx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorPid: 1234,
    apparatusPids: [apparatusId(144916)],
    rows: [...result.snapshot, leftover],
  });
  assert.equal(processRowCouldBelongToThisRun(scannerRow, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(conhostRow, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), false);
});

test("R23b the scan script seeds creation identities and skips only after the PEB read", () => {
  rememberMeasurementApparatusPid(36996, { creationNotBefore: AFTER_CEILING, creationNotAfter: AFTER_CEILING, creationDate: AFTER_CEILING });
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "", pid: 42424 };
    },
    waitSync: () => undefined,
  });
  scanner({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    apparatusPids: [apparatusId(36996)],
  });
  assert.match(script, /\$scannerIdent/);
  assert.match(script, /36996/);
  assert.match(script, /scannerPid = \[int\]\$PID/);
  assert.match(script, /scannerCreationDate/);
  assert.match(script, /\$isApparatus/);
  const pebAt = script.indexOf("[AionPebEnv]::GetNonce");
  const skipAt = script.indexOf("$isApparatus");
  assert.ok(pebAt >= 0 && skipAt >= 0 && pebAt < skipAt, "apparatus skip must follow the PEB read");
  assert.match(script, /-not \[bool\]\$c\.isDesc -and -not \$n/);
  assert.doesNotMatch(script, /parentName.*continue/);
});

test("R23b a leftover-sweep throw does not un-mint a later SCANNED empty tree", async () => {
  let calls = 0;
  const result = await runWith({
    scanOrphans: () => {
      calls += 1;
      if (calls === 1) throw new Error("sweep re-scan failed");
      return writerOrphanScanResult([]);
    },
  });
  const tree = treeFinding(result);
  assert.equal(result.spawned, true, result.reason);
  assert.equal(tree?.ok, true, tree?.reason ?? result.reason);
  assert.ok(calls >= 2, `expected leftover sweep then collectWriterOrphans, calls=${calls}`);
});

test("R23b a leftover host-wide lock with holder NOT_FOUND and tree CLEAR is reclaimed", () => {
  const rootA = makeTempRoot("r23b-lock-a");
  const rootB = makeTempRoot("r23b-lock-b");
  const arbitration = makeTempRoot("r23b-lock-arb");
  try {
    const probe = notFoundProbe();
    const storeA = createNodeLeaseStore(rootA, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: (holder: { readonly pid: number }) => {
        assert.equal(holder.pid, 4812);
        return hostWideTreeEvidenceFromScan({ performed: true, liveSightings: [] });
      },
    }));
    const first = acquireLease({
      existing: [],
      leaseId: "lease-a",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m1",
      runId: "run-a",
      pid: 4812,
      processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE_0 },
      now: LONG_AGO,
    });
    assert.equal(first.ok, true, first.reason);
    storeA.save([first.lease!]);
    assert.equal(lockFiles(join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir), "production-writer-").length, 1);

    const storeB = createNodeLeaseStore(rootB, storeOptions({
      hostArbitrationRoot: arbitration,
      probe,
      hostLockTreeEvidence: () => hostWideTreeEvidenceFromScan({ performed: true, liveSightings: [] }),
    }));
    const second = acquireLease({
      existing: storeB.list(),
      leaseId: "lease-b",
      kind: "PRODUCTION_WRITER",
      resource: "writer-shared",
      missionId: "m2",
      runId: "run-b",
      pid: 5555,
      now: EXPIRED,
    });
    storeB.save([second.lease!]);
    assert.equal(storeB.list().length, 1);
    assert.equal(lockFiles(join(arbitration, DIRECTOR_STORE_LAYOUT_V1.locksDir), "production-writer-").length, 1);
    assert.equal(storeB.list()[0]?.leaseId, "lease-b");
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(arbitration, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R8 — Git conjuncts observe the directory the child ran in
// ---------------------------------------------------------------------------

const PLACE_KINDS = [
  { kind: "BRANCH" as const, resource: "executor/oracle" },
  { kind: "INTEGRATION" as const, resource: "int-a" },
  { kind: "PREVIEW" as const, resource: "preview-a" },
  { kind: "PRODUCTION_WRITER" as const, resource: "writer-a" },
];

for (const item of PLACE_KINDS) {
  test(`R8 ${item.kind} refuses when cwd and worktree name different directories`, async () => {
    const spawn = trackingSpawn(() => exitingProcess());
    const result = await runWith({
      spawn,
      request: {
        cwd: CWD,
        worktree: OTHER,
        lease: { kind: item.kind, resource: item.resource, leaseId: `lease-place-${item.kind}` },
      },
    });
    assert.equal(result.spawned, false, result.reason);
    assert.equal(result.ok, false, result.reason);
    assert.match(result.reason, /not the directory the child will run in|worktree is not/);
    assert.equal(spawn.calls, 0, result.reason);
  });
}

test("R8 WORKTREE split keeps its current refusal (regression)", async () => {
  const result = await runWith({
    request: {
      cwd: CWD,
      worktree: OTHER,
      lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-split" },
    },
  });
  assert.equal(result.spawned, false, result.reason);
  assert.match(result.reason, /WORKTREE worktree is not the directory the child will run in/);
});

test("R8 a runner that inspected somewhere else fails the place check", async () => {
  const result = await runWith({
    git: matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: ELSEWHERE }),
    request: {
      cwd: CWD,
      worktree: CWD,
      lease: { kind: "BRANCH", resource: "executor/oracle", leaseId: "lease-place-else" },
    },
  });
  assert.equal(result.ok, false, result.reason);
  assert.match(result.reason, /somewhere-else|inspected|worktreePath|not the directory|does not name|names nowhere|place/);
});

test("R8 an empty inspectedWorktree is UNKNOWN and denies", async () => {
  const git = matchingGit(HEAD_AFTER, { advance: true });
  const blank: GitRunner = {
    run: git.run,
    inspectedWorktree: "",
  };
  const result = await runWith({
    git: blank,
    request: {
      cwd: CWD,
      worktree: CWD,
      lease: { kind: "BRANCH", resource: "executor/oracle", leaseId: "lease-place-blank" },
    },
  });
  assert.equal(result.ok, false, result.reason);
  assert.match(result.reason, /inspected|worktreePath|not the directory|place|UNKNOWN|nowhere|empty/);
});

test("FINAL PROOF place: BRANCH cwd/worktree split refuses; matching place is ok for write and review", async () => {
  const split = await runWith({
    request: {
      cwd: CWD,
      worktree: OTHER,
      lease: { kind: "BRANCH", resource: "executor/oracle", leaseId: "lease-place-proof" },
    },
  });
  assert.equal(split.spawned, false, split.reason);

  const write = await runWith({
    git: matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: CWD }),
    request: {
      cwd: CWD,
      worktree: CWD,
      role: "IMPLEMENT",
      argv: claudeImplementerArgv(),
      lease: { kind: "BRANCH", resource: "executor/oracle", leaseId: "lease-place-write" },
    },
  });
  assert.equal(write.ok, true, write.reason);

  const review = await runWith({
    git: matchingGit(HEAD_BEFORE, { inspectedWorktree: CWD }),
    request: {
      cwd: CWD,
      worktree: CWD,
      executor: "grok",
      executablePath: "C:\\Tools\\grok.exe",
      role: "ADVERSARIAL_REVIEW",
      argv: [
        "--prompt-file", PROMPT,
        "--cwd", CWD,
        "--permission-mode", "plan",
        "--max-turns", "50",
      ],
      lease: { kind: "BRANCH", resource: "executor/oracle", leaseId: "lease-place-review" },
    },
  });
  assert.equal(review.ok, true, review.reason);
});

// ---------------------------------------------------------------------------
// R9 — holdback anchor retains the bytes the redactor needs
// ---------------------------------------------------------------------------

function writeLongSecret(opts: {
  prefix: string;
  token: string;
  pad?: number;
}): { disk: string; redacted: string } {
  const dir = makeTempRoot("r9");
  const path = join(dir, "stdout.log");
  try {
    const sink = createFileLogSink(path);
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout: sink, stderr: createMemoryLogSink() },
    });
    const pad = opts.pad ?? 70_000;
    log.write("stdout", `${opts.prefix}${"j".repeat(pad)}${opts.token}`);
    log.flush();
    log.seal();
    const disk = readFileSync(path, "utf8");
    return { disk, redacted: redactLogText(disk) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("FINAL PROOF log: a single write of Authorization Bearer + 5000-byte token leaves zero token bytes on disk", () => {
  const token = "K".repeat(5000);
  const line = `> GET /v1 HTTP/1.1 ${"j".repeat(70_000)} Authorization: Bearer ${token}`;
  const dir = makeTempRoot("r9proof");
  const path = join(dir, "stdout.log");
  try {
    const sink = createFileLogSink(path);
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout: sink, stderr: createMemoryLogSink() },
    });
    log.write("stdout", line);
    log.flush();
    log.seal();
    const disk = readFileSync(path, "utf8");
    assert.equal(longestRun(disk, "K"), 0, `verbatim token run on disk=${longestRun(disk, "K")}`);
    assert.match(disk, /\[REDACTED\]/);
    assert.equal(disk.includes(token), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R9 Bearer with tab and newline separators still redacts a 5000-byte token", () => {
  for (const sep of [" ", "\t", "\n"]) {
    const token = "K".repeat(5000);
    const { disk } = writeLongSecret({
      prefix: "> GET /v1 HTTP/1.1 ",
      token: `Authorization: Bearer${sep}${token}`,
    });
    assert.equal(longestRun(disk, "K"), 0, `sep=${JSON.stringify(sep)} leaked ${longestRun(disk, "K")}`);
    assert.match(disk, /\[REDACTED\]/);
  }
});

test("R9 compound Authorization: Bearer + 5000-byte token leaves zero token bytes", () => {
  const token = "K".repeat(5000);
  const { disk } = writeLongSecret({
    prefix: "",
    token: `Authorization: Bearer ${token}`,
    pad: 70_000,
  });
  assert.equal(longestRun(disk, "K"), 0);
  assert.match(disk, /\[REDACTED\]/);
});

test("R9 a >=4096-byte token is redacted for ghp_, github_pat_, sk-, AKIA, and Authorization:", () => {
  const cases: Array<{ starter: string; token: string; needle: string }> = [
    { starter: "ghp_", token: `ghp_${"A".repeat(4096)}`, needle: "A" },
    { starter: "github_pat_", token: `github_pat_${"B".repeat(4096)}`, needle: "B" },
    { starter: "sk-", token: `sk-${"C".repeat(4096)}`, needle: "C" },
    { starter: "AKIA", token: `AKIA${"D".repeat(16)}`, needle: "D" },
    { starter: "Authorization:", token: `Authorization: ${"E".repeat(4096)}`, needle: "E" },
  ];
  for (const item of cases) {
    const { disk } = writeLongSecret({
      prefix: "trace ",
      token: item.token,
      pad: MAX_TOKEN_HOLD,
    });
    assert.equal(
      disk.includes(item.token),
      false,
      `${item.starter} leaked the full token`,
    );
    assert.match(disk, /\[REDACTED\]/, item.starter);
  }
});

// ---------------------------------------------------------------------------
// R10 — hardening (tests that fail at HEAD for the throw / unread field)
// ---------------------------------------------------------------------------

test("R10 holderLiveness with creationDate null is UNKNOWN, not a throw", () => {
  const recorded: ExecutorProcessIdentityV1 = {
    pid: 4812,
    creationDate: T0,
    executablePath: CLAUDE_EXE,
    runNonce: NONCE,
  };
  const observation = asObservation({
    outcome: "FOUND",
    reason: "cim",
    pid: 4812,
    creationDate: null,
    executablePath: CLAUDE_EXE,
    runNonce: NONCE,
  });
  assert.equal(holderLiveness(recorded, observation), "UNKNOWN");
});

test("R10 a signalled exit is not a clean completion", () => {
  const conjunction = evaluateSuccessConjunction({
    exitCode: 0,
    stillRunning: false,
    executor: "claude",
    output: "",
    parsed: { ok: false, handoff: null, problems: ["none"] },
    reportedWorkItemId: null,
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: null,
    gitVerdict: null,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "n/a",
    executorTreeGone: true,
    executorTreeReason: "n/a",
    timedOut: false,
    logStayedWithinBudget: true,
    exitSignal: "SIGTERM",
  });
  const exitFinding = conjunction.findings.find((item) => item.name === "processExitedWithKnownSuccessCode");
  assert.ok(exitFinding, `expected an exit conjunct, got ${conjunction.findings.map((item) => item.name).join(",")}`);
  assert.equal(exitFinding.ok, false, exitFinding.reason);
});
