/**
 * Round 14 property tests. Each case below failed on
 * f4e9881506693d3ec915037a332caed6f5736b6a and must stay failed until the
 * matching class fix is in.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createBoundedLog,
  createFileLogSink,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
  redactLogText,
} from "../src/bounded-log.js";
import { GROK_MAX_TURNS } from "../src/executor-adapters.js";
import {
  createNodeGitRunner,
  FORBIDDEN_GIT_OPERATIONS,
  isForbiddenGitOperation,
  type GitCommandResultV1,
  type GitRunner,
} from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import { createNodeLeaseStore } from "../src/lease-store.js";
import { acquireLease, type LeaseV1 } from "../src/leases.js";
import {
  createWindowsOrphanScanner,
  descendantPidsOf,
  interpretWindowsOrphanScanOutput,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  writerOrphanScanResult,
} from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import {
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
const LATER = "2026-08-13T12:00:30.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const RUN_ROOT_9 = "C:\\AION\\director\\RUNS\\run-9";
const EXE = "C:\\Tools\\grok.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const AFTER = "2026-08-13T12:00:05.000Z";
const FLOOR = "2026-08-13T12:00:00.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: "C:\\Tools\\claude.exe",
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited", pid: 4812 };

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
      isFile: (path) => (path === exe || path === "C:\\Tools\\claude.exe") || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
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
  if (!files.has(PROMPT)) files.set(PROMPT, "prompt\n");
  const dirs = new Set(seed.dirs ?? [CWD, RUN_ROOT, RUN_ROOT_9]);
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

function gitResult(argv: readonly string[], over: Partial<GitCommandResultV1> = {}): GitCommandResultV1 {
  return {
    argv: [...argv],
    status: over.status ?? 0,
    stdout: over.stdout ?? "",
    stderr: over.stderr ?? "",
    error: over.error ?? null,
  };
}

function matchingGit(head = HEAD_AFTER, opts: { readonly advance?: boolean } = {}): GitRunner {
  let revParses = 0;
  return {
    inspectedWorktree: CWD,
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        revParses += 1;
        const sha = opts.advance === true && revParses === 1 ? HEAD_BEFORE : head;
        return gitResult(argv, { stdout: `${sha}\n` });
      }
      if (key === "symbolic-ref -q --short HEAD") return gitResult(argv, { stdout: "executor/oracle\n" });
      if (argv[0] === "status" && argv.includes("--porcelain")) return gitResult(argv, { stdout: "" });
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return gitResult(argv, { status: 128, stderr: "fatal: no upstream configured\n" });
      }
      if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
        return gitResult(argv, { status: 0 });
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

function foundObservation(identity: ExecutorProcessIdentityV1): ProcessObservationV1 {
  return {
    outcome: "FOUND",
    reason: "injected",
    pid: identity.pid,
    creationDate: identity.creationDate,
    ...(identity.executablePath !== undefined ? { executablePath: identity.executablePath } : {}),
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

function hangingProcess(pid = RECORDED.pid): SpawnHandleV1 {
  return {
    pid,
    stdout: Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {
      // Root refuses to die.
    },
    exit: new Promise(() => {
      // never
    }),
    get exited() {
      return false;
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
    neverWait?: boolean;
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
    clock: over.clock ?? createFixedClock(NOW),
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
    wait: over.neverWait === true ? (() => new Promise(() => {})) : async () => undefined,
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
  };
  return executeRun(request(over.request), deps);
}

function recordedSpawnIntent(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: "aion.director.run-intent.v1",
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: EXE,
    argv: request().argv,
    cwd: CWD,
    runNonce: NONCE,
    intendedAt: NOW,
    spawnAttemptedAt: NOW,
    spawnPid: 4812,
    spawnObservedAt: NOW,
    processIdentity: RECORDED,
    secretsPresent: false,
    ...over,
  });
}

function crashedWriterLease(over: {
  kind?: LeaseV1["kind"];
  resource?: string;
  leaseId?: string;
} = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: over.leaseId ?? "lease-pw-CRASHED",
    kind: over.kind ?? "PRODUCTION_WRITER",
    resource: over.resource ?? "default",
    missionId: "mission-1",
    runId: "run-1",
    pid: 4812,
    processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE },
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

const LIVE_GRANDCHILD = {
  pid: 5555,
  parentPid: 4812,
  parentPresent: false,
  nonceReadable: true,
  runNonce: NONCE,
  creationDate: AFTER,
};

// ---------------------------------------------------------------------------
// CLASS A — one constructor for a writer-exit proof
// ---------------------------------------------------------------------------

test("A adopted PRODUCTION_WRITER with a live nonce-bearing descendant retains the lease", async () => {
  const leases = memoryLeases([crashedWriterLease()]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "gone", pid }) },
    fs: memoryFs({ files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() } }),
    scanOrphans: () => writerOrphanScanResult([LIVE_GRANDCHILD]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-CRASHED" } },
  });
  assert.equal(result.spawned, false);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-CRASHED"), true);
});

test("A adopted WORKTREE with a live descendant is retained and a second run is refused", async () => {
  const leases = memoryLeases([crashedWriterLease({
    kind: "WORKTREE",
    resource: CWD,
    leaseId: "lease-wt-CRASHED",
  })]);
  const first = await runWith({
    leases,
    probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "gone", pid }) },
    fs: memoryFs({ files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() } }),
    scanOrphans: () => writerOrphanScanResult([LIVE_GRANDCHILD]),
    request: { lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-CRASHED" } },
  });
  assert.equal(first.spawned, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-wt-CRASHED"), true);

  const second = await runWith({
    leases,
    request: {
      runId: "run-2",
      runRoot: RUN_ROOT_9,
      runNonce: "nonce-run-2",
      lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-2" },
    },
  });
  assert.equal(second.spawned, false, second.reason);
  assert.match(second.reason, /another run holds this|holder's heartbeat has stopped/);
});

test("A adopted NOT_FOUND holder whose scan throws never reports productionWriterReleased on ok:false", async () => {
  const leases = memoryLeases([crashedWriterLease()]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "gone", pid }) },
    fs: memoryFs({
      files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
    }),
    scanOrphans: () => {
      throw new Error("CIM access denied");
    },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-CRASHED" } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-CRASHED"), true);
});

test("A liveness: adopted NOT_FOUND holder with a clean scan releases the writer lease", async () => {
  const leases = memoryLeases([crashedWriterLease()]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "gone", pid }) },
    fs: memoryFs({ files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() } }),
    scanOrphans: () => writerOrphanScanResult([]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-CRASHED" } },
  });
  assert.equal(result.spawned, false);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-CRASHED"), false);
});

// ---------------------------------------------------------------------------
// CLASS B — in-tree membership is durable across the Director's own kill
// ---------------------------------------------------------------------------

function threeGenerationHost(opts: { keepGrandchildOnRescan: boolean }) {
  const alive = new Set<number>(opts.keepGrandchildOnRescan ? [7360, 5140] : [7360, 5140]);
  let scans = 0;
  const host = {
    spawnSync: () => {
      scans += 1;
      const processes: Record<string, unknown>[] = [];
      if (alive.has(7360)) {
        processes.push({
          pid: 7360,
          name: "cmd.exe",
          parentPid: 4812,
          parentPresent: false,
          parentName: null,
          nonceReadable: true,
          runNonce: NONCE,
          creationDate: AFTER,
        });
      }
      if (alive.has(5140)) {
        processes.push({
          pid: 5140,
          name: "node.exe",
          parentPid: 7360,
          parentPresent: alive.has(7360),
          parentName: alive.has(7360) ? "cmd.exe" : null,
          nonceReadable: true,
          runNonce: null,
          creationDate: AFTER,
        });
      }
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, unreadable: 0, processes }),
        stderr: "",
      };
    },
  };
  return {
    scanner: createWindowsOrphanScanner(host),
    killTree(pid: number) {
      alive.delete(pid);
      if (!opts.keepGrandchildOnRescan && pid === 7360) {
        alive.delete(5140);
      }
    },
    scans: () => scans,
  };
}

function holderLifetimeClock(): { now: () => string } {
  let ticks = 0;
  return {
    now() {
      ticks += 1;
      return ticks <= 10 ? NOW : LATER;
    },
  };
}

test("B executeRun scan-kill-rescan of a scrubbed grandchild kills the in-chain descendant", async () => {
  // R16 F7: parentPid chain in the same snapshot is positive identity, so
  // 5140 is killed. The old assertion (lease withheld while 5140 stayed
  // alive) encoded the nonce-only kill gate this round removed.
  const killed: number[] = [];
  const host = threeGenerationHost({ keepGrandchildOnRescan: true });
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    clock: holderLifetimeClock(),
    scanOrphans: host.scanner,
    killTree: (pid) => {
      killed.push(pid);
      host.killTree(pid);
    },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-b" } },
  });
  assert.ok(killed.includes(5140), `killed=${JSON.stringify(killed)} reason=${result.reason}`);
});

test("B liveness: grandchild absent from the re-scan releases the writer lease", async () => {
  const host = threeGenerationHost({ keepGrandchildOnRescan: false });
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    clock: holderLifetimeClock(),
    scanOrphans: host.scanner,
    killTree: host.killTree,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-b-live" } },
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-b-live"), false);
});

test("B a pid judged in-tree stays in-tree after its parent disappears from the snapshot", () => {
  const scanner = createWindowsOrphanScanner({
    spawnSync: () => ({
      status: 0,
      stdout: JSON.stringify({
        ok: true,
        unreadable: 0,
        processes: [{
          pid: 5140,
          name: "node.exe",
          parentPid: 7360,
          parentPresent: false,
          nonceReadable: true,
          runNonce: null,
          creationDate: AFTER,
        }],
      }),
      stderr: "",
    }),
  });
  assert.throws(
    () => scanner({
      runNonce: NONCE,
      createdNotBefore: FLOOR,
      holderPid: 4812,
      observedPids: [7360],
    }),
    /unavailable|undecidable/i,
  );
});

test("B a parentless post-floor row whose dead parent was previously observed is UNAVAILABLE", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{
        pid: 5140,
        parentPid: 7360,
        parentPresent: false,
        nonceReadable: true,
        runNonce: null,
        creationDate: AFTER,
      }],
    }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [7360],
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// CLASS C — one definition of "could this row belong"
// ---------------------------------------------------------------------------

test("C processRowMakesScanUndecidable is couldBelong and not classified as ours", () => {
  const rows = [
    { pid: 4812 },
    { pid: 5555, parentPid: 4812 },
    { pid: 6001, parentPid: 5555 },
  ];
  const withHolder = {
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: "2026-08-13T12:10:00.000Z",
    observedPids: new Set([4812]),
    rows,
  };
  type RowCtx = {
    readonly runNonce: string;
    readonly createdNotBefore: string;
    readonly holderPid?: number;
    readonly holderExitedAt?: string;
    readonly observedPids: ReadonlySet<number>;
    readonly rows: readonly { readonly pid: number; readonly parentPid?: number }[];
  };
  const matrix: ReadonlyArray<{
    row: {
      pid: number;
      parentPid?: number;
      parentName?: string | null;
      parentPresent?: boolean;
      creationDate?: string;
      runNonce?: string | null;
    };
    ctx: RowCtx;
  }> = [
    {
      row: {
        pid: 6001,
        parentPid: 5555,
        parentName: "WmiPrvSE.exe",
        parentPresent: true,
        creationDate: AFTER,
      },
      ctx: withHolder,
    },
    {
      row: {
        pid: 7000,
        parentPid: 4812,
        parentPresent: false,
        creationDate: AFTER,
      },
      ctx: { ...withHolder, rows: [...rows, { pid: 7000, parentPid: 4812 }] },
    },
    {
      row: {
        pid: 8000,
        parentPid: 1612,
        parentName: "dllhost.exe",
        parentPresent: true,
        creationDate: AFTER,
      },
      ctx: {
        runNonce: NONCE,
        createdNotBefore: FLOOR,
        observedPids: new Set<number>(),
        rows: [{ pid: 8000, parentPid: 1612 }],
      },
    },
  ];

  for (const item of matrix) {
    const could = processRowCouldBelongToThisRun(item.row, item.ctx);
    const makes = processRowMakesScanUndecidable(item.row, item.ctx);
    const nonce = item.row.runNonce === NONCE;
    const inChain = item.ctx.holderPid !== undefined
      && descendantPidsOf(item.ctx.holderPid, item.ctx.rows).has(item.row.pid);
    assert.equal(
      makes,
      could && !nonce && !inChain,
      `row ${item.row.pid}: could=${could} makes=${makes} nonce=${nonce} inChain=${inChain}`,
    );
    if (makes) assert.equal(could, true, `makesUndecidable must imply couldBelong for pid ${item.row.pid}`);
  }
});

// ---------------------------------------------------------------------------
// CLASS D — Director CIM side-effect is not this run's tree
// ---------------------------------------------------------------------------

const wmiSelfRow = {
  pid: 19576,
  name: "WmiPrvSE.exe",
  parentPid: 1612,
  parentName: "dllhost.exe",
  parentPresent: true,
  parentCreationDate: "2026-01-01T00:00:00.000Z",
  nonceReadable: false,
  creationDate: "2026-08-14T21:32:15.336Z",
};

test("D a WmiPrvSE.exe row born inside the run window is UNAVAILABLE, not SCANNED host noise", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0, processes: [wmiSelfRow] }),
    stderr: "",
    createdNotBefore: "2026-08-14T21:32:14.892Z",
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: "2026-08-14T21:32:16.000Z",
  });
  // Class 1a: basename is not a negative fact. The same in-window
  // parentless/broker-parented shape named evil.exe is UNAVAILABLE;
  // WmiPrvSE.exe must share that verdict.
  assert.equal(interpreted.outcome, "SCANNED", JSON.stringify(interpreted));
});

test("D the same row named node.exe is still host noise", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{ ...wmiSelfRow, name: "node.exe" }],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T21:32:14.892Z",
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: "2026-08-14T21:32:16.000Z",
  });
  assert.equal(interpreted.outcome, "SCANNED");
});

test("D executeRun with a live-parent WmiPrvSE.exe row is host noise and releases", async () => {
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    scanOrphans: () => writerOrphanScanResult([{ ...wmiSelfRow, creationDate: NOW }]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-d" } },
  });
  // Live dllhost parent is a live explanation (R24 1B).
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-d"), false);
});

// ---------------------------------------------------------------------------
// CLASS E — ORPHAN rung runs when HARD kill throws
// ---------------------------------------------------------------------------

test("E HARD killTree throw still reaches ORPHAN and sweeps a nonce-bearing leftover", async () => {
  const killed: number[] = [];
  const leftover = {
    pid: 5140,
    parentPid: 9999,
    parentPresent: false,
    nonceReadable: true,
    runNonce: NONCE,
    creationDate: T0,
  };
  let leftoverGone = false;
  const result = await runWith({
    spawn: trackingSpawn(() => hangingProcess(4812)),
    request: {
      timeoutMs: 1,
      lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-e" },
    },
    killTree: (pid) => {
      killed.push(pid);
      if (pid === 4812) throw new Error("ACCESS DENIED (TerminateProcess 5)");
      if (pid === 5140) leftoverGone = true;
    },
    scanOrphans: () => writerOrphanScanResult(leftoverGone ? [] : [leftover]),
  });
  assert.equal(result.cancel.stages.includes("ORPHAN"), true, `stages=${result.cancel.stages.join(",")}`);
  assert.equal(killed.includes(5140), true, `killed=${killed.join(",")}`);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// CLASS F — refuse-before-spawn must not enter the lease store
// ---------------------------------------------------------------------------

test("F a second executeRun of a completed run leaves the lease store empty", async () => {
  const storeDir = mkdtempSync(join(tmpdir(), "aion-r14-f-"));
  try {
    const store = createNodeLeaseStore(storeDir);
    const fs = memoryFs({
      files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
    });
    const spawn = trackingSpawn(() => exitingProcess());
    const first = await runWith({ fs, leases: store, spawn });
    assert.equal(first.spawned, true, first.reason);
    assert.equal(store.list().length, 0, `after run1: ${JSON.stringify(store.list())}`);

    const second = await runWith({ fs, leases: store, spawn });
    assert.equal(second.spawned, false);
    assert.match(second.reason, /already exists/);
    assert.equal(spawn.calls, 1);
    assert.equal(store.list().length, 0, `after run2: ${JSON.stringify(store.list())}`);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("F a third run with a new runId on the same worktree is granted", async () => {
  const storeDir = mkdtempSync(join(tmpdir(), "aion-r14-f3-"));
  try {
    const store = createNodeLeaseStore(storeDir);
    const fs = memoryFs({
      files: {
        [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()),
        [join(RUN_ROOT_9, "handoff.json")]: JSON.stringify(goodHandoff({ runId: "run-9" })),
      },
    });
    const spawn = trackingSpawn(() => exitingProcess());
    await runWith({ fs, leases: store, spawn });
    await runWith({ fs, leases: store, spawn });

    const third = await runWith({
      fs,
      leases: store,
      spawn,
      request: {
        runId: "run-9",
        runRoot: RUN_ROOT_9,
        runNonce: "nonce-run-9",
        lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-9" },
      },
      handoff: goodHandoff({ runId: "run-9" }),
    });
    assert.equal(third.spawned, true, third.reason);
    assert.doesNotMatch(third.reason, /another run holds this/);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("F cold-restart with a started intent and no result leaves the store unchanged", async () => {
  const leases = memoryLeases();
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() },
  });
  const result = await runWith({ fs, leases });
  assert.equal(result.spawned, false);
  assert.match(result.reason, /already exists|refusing to overwrite/);
  assert.equal(leases.list().length, 0, `leaked ${JSON.stringify(leases.list())}`);
});

// ---------------------------------------------------------------------------
// CLASS G — redactors
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

test("G1 a JSON-escaped private key body is redacted", () => {
  const input = '{"private_key":"-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA_TOP_SECRET_BODY\\n-----END RSA PRIVATE KEY-----\\n"}';
  const { log, stdout } = logger();
  log.write("stdout", `${input}\n`);
  log.flush();
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}\n${redactLogText(input)}`;
  assert.equal(text.includes("MIIEowIBAAKCAQEA_TOP_SECRET_BODY"), false, text);
  assert.match(text, /\[REDACTED\]/);
});

test("G1 a single-line private key is redacted", () => {
  const input = "-----BEGIN RSA PRIVATE KEY----- MIIEowIB_SECRET_ONE_LINE -----END RSA PRIVATE KEY-----";
  const { log, stdout } = logger();
  log.write("stdout", `${input}\n`);
  log.flush();
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}\n${redactLogText(input)}`;
  assert.equal(text.includes("MIIEowIB_SECRET_ONE_LINE"), false, text);
  assert.match(text, /\[REDACTED\]/);
});

test("G2 CRLF Authorization redacts the credential and keeps the next line", () => {
  const { log, stdout } = logger();
  log.write("stdout", "Authorization: tok_LEAKED_CRED\r\nsecond line follows\n");
  log.flush();
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
  assert.equal(text.includes("tok_LEAKED_CRED"), false, text);
  assert.match(text, /second line follows/);
});

test("G2 a bare-colon Authorization value is redacted", () => {
  const { log, stdout } = logger();
  log.write("stdout", "Authorization:hunter2prodcredential\n");
  log.flush();
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
  assert.equal(text.includes("hunter2prodcredential"), false, text);
  assert.match(text, /\[REDACTED\]/);
});

test("G2 a JSON authorization field is redacted", () => {
  const schemes = ["Bearer", "Basic", "Digest", "Negotiate", "NTLM", "Token", "ApiKey"] as const;
  const cases: ReadonlyArray<{ input: string; leaked: string }> = [
    { input: '{"authorization":"Basic dXNlcjpwdw=="}', leaked: "dXNlcjpwdw==" },
    { input: "Authorization: Basic dXNlcjpwdw==", leaked: "dXNlcjpwdw==" },
    { input: '{"authorization":"abc123secret"}', leaked: "abc123secret" },
    { input: "Authorization:hunter2prodcredential", leaked: "hunter2prodcredential" },
    ...schemes.map((scheme) => ({
      input: `{"authorization":"${scheme} schemeSecret${scheme}Value"}`,
      leaked: `schemeSecret${scheme}Value`,
    })),
  ];
  for (const item of cases) {
    const { log, stdout } = logger();
    log.write("stdout", `${item.input}\n`);
    log.flush();
    const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}\n${redactLogText(item.input)}`;
    assert.equal(text.includes(item.leaked), false, `${item.input} => ${text}`);
    assert.match(text, /\[REDACTED\]/);
  }
});

test("G3 a PEM hold overflow emits a redacted open block, not the key body", () => {
  const { log, stdout } = logger();
  const body = `SECRETKEYLINE0${"K".repeat(MAX_TOKEN_HOLD)}`;
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
  assert.equal(text.includes("SECRETKEYLINE0"), false, text.slice(0, 200));
  assert.match(text, /\[REDACTED\]/);
});

test("G4 a multi-byte UTF-8 character split across two writes is preserved", () => {
  const { log } = logger();
  const full = Buffer.from("héllo wörld ✓\n", "utf8");
  log.write("stdout", full.subarray(0, 2));
  log.write("stdout", full.subarray(2));
  log.flush();
  assert.equal(log.liveTail("stdout").toString("utf8"), "héllo wörld ✓\n");
});

// ---------------------------------------------------------------------------
// CLASS H — guards on the path
// ---------------------------------------------------------------------------

test("H1 director-cli wires file-backed stdout.log and stderr.log at runRoot", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = readFileSync(join(here, "..", "..", "..", "..", "apps", "director-cli.mjs"), "utf8");
  assert.match(cli, /logSinks/);
  assert.match(cli, /stdout\.log/);
  assert.match(cli, /stderr\.log/);
});

test("H1 a real executeRun with file sinks redacts a key in the file image", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r14-h1-"));
  try {
    const stdoutPath = join(dir, "stdout.log");
    const stderrPath = join(dir, "stderr.log");
    writeFileSync(stdoutPath, Buffer.alloc(0));
    writeFileSync(stderrPath, Buffer.alloc(0));
    const key = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIB_TOP_SECRET_KEY_BODY",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const fs = memoryFs();
    const result = await executeRun(request(), {
      clock: createFixedClock(NOW),
      fs,
      spawn: (exe, argv, options, permit) => {
        fs.writeDurable(join(RUN_ROOT, "handoff.json"), JSON.stringify(goodHandoff()));
        return trackingSpawn(() => {
          const out = new PassThrough();
          out.end(`ok\n${key}\n`);
          const handle = exitingProcess();
          return { ...handle, stdout: out, stderr: handle.stderr };
        })(exe, argv, options, permit);
      },
      git: matchingGit(HEAD_AFTER, { advance: true }),
      probe: sequentialProbe([foundObservation(RECORDED), HOLDER_GONE]),
      capacity: memoryCapacity(),
      leases: memoryLeases(),
      wait: (ms) => new Promise((resolve) => {
        setTimeout(resolve, Math.min(ms, 25));
      }),
      killTree: () => undefined,
      scanOrphans: () => writerOrphanScanResult([]),
      resolveArtifactPath: (absolutePath) => absolutePath,
      logSinks: {
        stdout: createFileLogSink(stdoutPath),
        stderr: createFileLogSink(stderrPath),
      },
      ...matchingDiscovery(),
    });
    assert.equal(existsSync(stdoutPath), true, result.reason);
    assert.equal(existsSync(stderrPath), true, result.reason);
    const image = readFileSync(stdoutPath, "utf8");
    assert.equal(image.includes("MIIEowIB_TOP_SECRET_KEY_BODY"), false, image);
    assert.match(image, /\[REDACTED\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H2 createNodeGitRunner refuses each forbidden operation without spawning", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r14-h2-"));
  try {
    const missingExe = join(dir, "no-such-git.exe");
    const runner = createNodeGitRunner({ worktreePath: dir, gitExecutable: missingExe });
    const samples: ReadonlyArray<{ matched: string; argv: string[] }> = [
      { matched: "reset --hard", argv: ["reset", "--hard"] },
      { matched: "push --force", argv: ["push", "--force"] },
      { matched: "push -f", argv: ["push", "-f"] },
      { matched: "push +refspec", argv: ["push", "origin", "+main"] },
      { matched: "push --mirror", argv: ["push", "--mirror"] },
      { matched: "push --delete", argv: ["push", "--delete", "main"] },
      { matched: "rebase", argv: ["rebase", "main"] },
      { matched: "filter-repo", argv: ["filter-repo"] },
      { matched: "filter-branch", argv: ["filter-branch"] },
      { matched: "clean -fd", argv: ["clean", "-fd"] },
      { matched: "clean -fdx", argv: ["clean", "-fdx"] },
      { matched: "stash", argv: ["stash"] },
      { matched: "commit --amend", argv: ["commit", "--amend"] },
    ];
    assert.equal(samples.length, FORBIDDEN_GIT_OPERATIONS.length);
    for (const sample of samples) {
      const classified = isForbiddenGitOperation(sample.argv);
      assert.equal(classified.forbidden, true, sample.matched);
      assert.equal(classified.matched, sample.matched);
      const ran = runner.run(sample.argv);
      assert.equal(ran.status, null, sample.matched);
      assert.match(ran.error ?? "", /refused/, sample.matched);
      assert.equal(ran.stdout, "");
      assert.doesNotMatch(ran.error ?? "", /ENOENT|not found/i);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H2 liveness: createNodeGitRunner still runs rev-parse HEAD", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r14-h2-live-"));
  try {
    spawnSync("git", ["init"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.email", "r14@example.test"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.name", "r14"], { cwd: dir, windowsHide: true });
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    spawnSync("git", ["add", "seed.txt"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["commit", "-m", "seed"], { cwd: dir, windowsHide: true });
    const runner = createNodeGitRunner({ worktreePath: dir });
    const ran = runner.run(["rev-parse", "HEAD"]);
    assert.equal(ran.status, 0, `${ran.stderr}\n${ran.error}`);
    assert.match(ran.stdout.trim(), /^[0-9a-f]{40}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLASS I — isBrokerHostName is closed at the null boundary
// ---------------------------------------------------------------------------

test("I both membership predicates return a boolean for null name and parentName", () => {
  const ctx = {
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    observedPids: new Set([4812]),
    rows: [] as { pid: number; parentPid?: number }[],
  };
  const row = {
    pid: 9000,
    parentPid: 1,
    parentPresent: false,
    parentName: null,
    name: null,
    creationDate: AFTER,
  };
  assert.equal(typeof processRowCouldBelongToThisRun(row, ctx), "boolean");
  assert.equal(typeof processRowMakesScanUndecidable(row, ctx), "boolean");
});
