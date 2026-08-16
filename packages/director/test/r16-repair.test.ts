/**
 * Round 16 (D2 repair). Each test below must fail against cf34bc0 and pass
 * against the property repair. Helpers are local; they do not hide a
 * green-on-base assertion.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  type LogSinkV1,
} from "../src/bounded-log.js";
import { GROK_MAX_TURNS } from "../src/executor-adapters.js";
import type { GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import { acquireLease, reclaimStaleLease, type LeaseV1 } from "../src/leases.js";
import {
  holderLiveness,
  normalisedCreationDate,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  writerOrphanScanResult,
} from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import {
  createNodeRunFileSystem,
  createNodeWait,
  executeRun,
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
const LATER = "2026-08-13T12:00:30.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const RUN_ROOT_RETRY = "C:\\AION\\director\\RUNS\\run-1-retry";
const EXE = "C:\\Tools\\grok.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const AFTER = "2026-08-13T12:00:05.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";
const LONG_AGO = "2026-08-13T10:00:00.000Z";

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
  const claude = "C:\\Tools\\claude.exe";
  return {
    discoveryEnv: {
      AION_GROK_PATH: EXE,
      AION_CLAUDE_CODE_PATH: exe === EXE ? claude : exe,
    },
    discoveryFs: {
      isFile: (path) => path === EXE || path === claude || path === exe,
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
  const dirs = new Set(seed.dirs ?? [CWD, RUN_ROOT, RUN_ROOT_RETRY]);
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

function matchingGit(head = HEAD_AFTER, opts: { readonly advance?: boolean; readonly inspectedWorktree?: string } = {}): GitRunner {
  let revParses = 0;
  return {
    inspectedWorktree: opts.inspectedWorktree ?? CWD,
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

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 & { calls: number } {
  const spawnFn = ((_exe, _argv, options, permit) => {
    requireSpawnPermit(permit);
    assert.equal(options.shell, false);
    spawnFn.calls += 1;
    return factory();
  }) as SpawnFnV1 & { calls: number };
  spawnFn.calls = 0;
  return spawnFn;
}

function writerLease(over: {
  pid?: number | null;
  processIdentity?: LeaseV1["processIdentity"];
  leaseId?: string;
} = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: over.leaseId ?? "lease-pw-1",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: "run-1",
    pid: over.pid === undefined ? 4812 : over.pid,
    ...(over.processIdentity !== undefined ? { processIdentity: over.processIdentity } : {
      processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE },
    }),
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

function recordedSpawnIntent(): string {
  return JSON.stringify({
    schema: "aion.director.run-intent.v1",
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: EXE,
    argv: grokImplementerArgv(),
    cwd: CWD,
    runNonce: NONCE,
    intendedAt: NOW,
    spawnAttemptedAt: NOW,
    spawnPid: 4812,
    spawnObservedAt: NOW,
    processIdentity: RECORDED,
    secretsPresent: false,
  });
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
    wait?: (ms: number) => Promise<void>;
    logSinks?: RunManagerDepsV1["logSinks"];
    clock?: RunManagerDepsV1["clock"];
    handoff?: Record<string, unknown> | null;
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
    clock: over.clock ?? createFixedClock(HOLDER_EXIT),
    fs,
    spawn: (executable, argv, options, permit) => {
      if (handoffText !== null) {
        try { fs.writeDurable(handoffPath, handoffText); } catch { /* conjunction records absence */ }
      }
      return (over.spawn ?? trackingSpawn(() => exitingProcess()))(executable, argv, options, permit);
    },
    git: over.git ?? matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: over.request?.worktree ?? CWD }),
    probe: over.probe ?? sequentialProbe([
      foundObservation({ ...RECORDED, executablePath: "C:\\Tools\\claude.exe" }),
      HOLDER_GONE,
    ]),
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? (async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
  };
  return executeRun(request(over.request), deps);
}

// ---------------------------------------------------------------------------
// F1 — re-entry is keyed on the lease holder, not intent.json
// ---------------------------------------------------------------------------

test("F1 a lease holder with no intent.json refuses to spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess({ pid: 9999 }));
  const leases = memoryLeases([writerLease()]);
  const result = await runWith({
    spawn,
    leases,
    fs: memoryFs({ dirs: [CWD, RUN_ROOT_RETRY] }),
    probe: {
      observe: (pid) => {
        if (pid === 4812) return foundObservation(RECORDED);
        return { outcome: "NOT_FOUND", reason: "other", pid: 4812 };
      },
    },
    request: {
      runRoot: RUN_ROOT_RETRY,
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-retry" },
    },
  });
  assert.equal(spawn.calls, 0, result.reason);
  assert.equal(result.spawned, false);
  assert.match(result.reason, /lease/);
  assert.doesNotMatch(result.reason, /intent|recorded spawn already exists/);
  assert.equal(leases.list().some((item) => item.pid === 4812), true);
});

test("F1 an intent with no lease holder still refuses and names the file", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    spawn,
    fs: memoryFs({
      files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() },
    }),
    request: { lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-1" } },
  });
  assert.equal(spawn.calls, 0, result.reason);
  assert.match(result.reason, /recorded spawn already exists|intent/);
});

test("F1 liveness: a lease row with no recorded holder still spawns", async () => {
  const emptyHolder = acquireLease({
    existing: [],
    leaseId: "lease-pw-empty",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: "run-1",
    pid: null,
    now: NOW,
  });
  if (!emptyHolder.ok || emptyHolder.lease === null) throw new Error(emptyHolder.reason);
  assert.equal(emptyHolder.lease.pid, null);
  assert.equal(emptyHolder.lease.processIdentity, undefined);
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    spawn,
    leases: memoryLeases([emptyHolder.lease]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-empty" } },
  });
  assert.equal(spawn.calls, 1, result.reason);
  assert.equal(result.spawned, true, result.reason);
});

// ---------------------------------------------------------------------------
// F2 — adopted path supplies the same ceiling as the live path
// ---------------------------------------------------------------------------

test("F2 adopted path does not release on a nonce-less broker-parented in-window row", async () => {
  const leases = memoryLeases([writerLease()]);
  const brokerRow = {
    pid: 7777,
    name: "node.exe",
    parentPid: 1,
    parentName: "dllhost.exe",
    parentPresent: false,
    nonceReadable: true,
    creationDate: AFTER,
  };
  const result = await runWith({
    leases,
    fs: memoryFs({ dirs: [CWD, RUN_ROOT_RETRY] }),
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    scanOrphans: () => writerOrphanScanResult([brokerRow]),
    request: {
      runRoot: RUN_ROOT_RETRY,
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" },
    },
  });
  assert.equal(result.spawned, false);
  // A live dllhost parent is host noise (R24 1B). The adopted holder is
  // gone; the scan of this leftover does not keep the tree dirty.
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
});

// ---------------------------------------------------------------------------
// F3 — pump attaches before a blocking identity probe
// ---------------------------------------------------------------------------

test("F3 a real child that prints and exits during a blocking probe keeps its stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r16-f3-"));
  try {
    const promptPath = join(dir, "PROMPT.md");
    writeFileSync(promptPath, "go\n");
    const stdout = createMemoryLogSink();
    const stderr = createMemoryLogSink();
    const result = await executeRun(
      request({
        cwd: dir,
        worktree: dir,
        runRoot: join(dir, "run"),
        executablePath: process.execPath,
        promptPath,
        argv: ["-p", "--permission-mode", "bypassPermissions"],
        runNonce: "nonce-f3-bytes",
        timeoutMs: 15_000,
        lease: { kind: "WORKTREE", resource: dir, leaseId: "lease-f3" },
      }),
      {
        clock: createFixedClock(HOLDER_EXIT),
        fs: createNodeRunFileSystem(),
        spawn: (_exe, _argv, options, permit) => {
          requireSpawnPermit(permit);
          return wrapChildProcess(spawn(process.execPath, ["-e", "process.stdout.write('X'.repeat(200)); process.exit(0)"], {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true,
          }));
        },
        git: matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: dir }),
        probe: {
          observe() {
            const end = Date.now() + 200;
            while (Date.now() < end) {
              // Blocking CIM stand-in. The child exits inside this window.
            }
            return { outcome: "NOT_FOUND", reason: "exited during probe", pid: 4812 };
          },
        },
        capacity: memoryCapacity(),
        leases: memoryLeases(),
        wait: createNodeWait(),
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        logSinks: { stdout, stderr },
        ...matchingDiscovery(process.execPath),
      },
    );
    assert.equal(result.spawned, true, result.reason);
    assert.ok(result.log, "a spawned run must report a log");
    assert.equal(result.log.runBytesIn, 200, `runBytesIn=${result.log.runBytesIn}`);
    const image = stdout.contents().toString("utf8");
    assert.equal(image.includes("X".repeat(200)), true, image.slice(0, 120));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F4 — absent role is IMPLEMENT for argv and for writeMovedHead
// ---------------------------------------------------------------------------

test("F4 omitted role plus implementer argv fails writeMovedHead when HEAD is unchanged", async () => {
  const result = await runWith({
    git: matchingGit(HEAD_AFTER),
    request: {},
  });
  assert.equal(result.ok, false, result.reason);
  assert.ok(
    result.conjunction.failedConjuncts.includes("writeMovedHead"),
    String(result.conjunction.failedConjuncts),
  );
});

// ---------------------------------------------------------------------------
// F5 — impossible calendar dates are refused, not invented
// ---------------------------------------------------------------------------

test("F5 normalisedCreationDate refuses days that Date.UTC would invent", () => {
  assert.equal(normalisedCreationDate("2026-02-31T00:00:00Z"), null);
  assert.equal(normalisedCreationDate("2026-04-31T00:00:00Z"), null);
  assert.equal(normalisedCreationDate("2025-02-29T00:00:00Z"), null);
  assert.equal(normalisedCreationDate("0001-01-01T00:00:00Z"), null);
  assert.equal(normalisedCreationDate("20260231000000.000000+000"), null);
});

test("F5 holderLiveness on a recorded Feb 31 start is UNKNOWN, not DEAD_CONFIRMED", () => {
  const recorded: ExecutorProcessIdentityV1 = {
    pid: 4812,
    creationDate: "2026-02-31T00:00:00Z",
    executablePath: EXE,
    runNonce: NONCE,
  };
  const observed: ProcessObservationV1 = {
    outcome: "FOUND",
    reason: "live",
    pid: 4812,
    creationDate: "2026-08-15T04:07:17.596Z",
    executablePath: EXE,
  };
  assert.equal(holderLiveness(recorded, observed), "UNKNOWN");
});

// ---------------------------------------------------------------------------
// F6 — readable PEB without the nonce is UNKNOWN
// ---------------------------------------------------------------------------

test("F6 a readable parentless in-window row makes the scan undecidable and withholds the writer lease", async () => {
  const ctx = {
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }, { pid: 88912, parentPid: 1 }],
  };
  const emptyNonce = {
    pid: 88912,
    name: "cmd.exe",
    parentPid: 1,
    parentPresent: false,
    nonceReadable: true,
    creationDate: HOLDER_EXIT,
  };
  const foreignNonce = { ...emptyNonce, runNonce: "not-your-nonce" };
  assert.equal(processRowCouldBelongToThisRun(emptyNonce, ctx), true);
  assert.equal(processRowMakesScanUndecidable(emptyNonce, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(foreignNonce, ctx), true);
  assert.equal(processRowMakesScanUndecidable(foreignNonce, ctx), true);

  const leases = memoryLeases();
  const result = await runWith({
    leases,
    scanOrphans: () => writerOrphanScanResult([emptyNonce]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-f6" } },
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-f6"), true);
});

// ---------------------------------------------------------------------------
// F7 — a row with positive run identity is killed, not only a nonce match
// ---------------------------------------------------------------------------

test("F7 a clean-exit descendant with parentPid === holderPid is killed", async () => {
  const killed: number[] = [];
  const leftover = {
    pid: 12080,
    name: "node.exe",
    parentPid: 4812,
    parentPresent: true,
    creationDate: HOLDER_EXIT,
  };
  const result = await runWith({
    killTree: (pid) => {
      killed.push(pid);
    },
    scanOrphans: () => writerOrphanScanResult([leftover]),
  });
  assert.ok(killed.includes(12080), `killed=${JSON.stringify(killed)} reason=${result.reason}`);
});

// ---------------------------------------------------------------------------
// F8 — a throwing sink is a drain failure, not an uncaught exception
// ---------------------------------------------------------------------------

test("F8 a throwing stdout sink does not escape executeRun and still writes result.json", async () => {
  const throwingSink: LogSinkV1 = {
    append() {
      const error = new Error("ENOSPC: no space left on device, write");
      (error as NodeJS.ErrnoException).code = "ENOSPC";
      throw error;
    },
    replace() {
      const error = new Error("ENOSPC: no space left on device, write");
      (error as NodeJS.ErrnoException).code = "ENOSPC";
      throw error;
    },
  };
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const leases = memoryLeases();
  let thrown: unknown = null;
  let result: Awaited<ReturnType<typeof executeRun>> | null = null;
  try {
    result = await runWith({
      fs,
      leases,
      logSinks: { stdout: throwingSink, stderr: createMemoryLogSink() },
      spawn: trackingSpawn(() => exitingProcess({ stdout: "hello from executor\n" })),
      request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-f8" } },
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown, null, thrown instanceof Error ? thrown.message : String(thrown));
  assert.ok(result);
  assert.equal(fs.isFile(join(RUN_ROOT, "result.json")), true);
  assert.ok(result.log);
  assert.equal(result.log.sinkFailed, true);
  assert.equal(result.ok, false, "a lost durable log must not report success");
});

// ---------------------------------------------------------------------------
// F9 — same startedAt + different runToken is not a reclaim grant
// ---------------------------------------------------------------------------

test("F9 reclaimStaleLease does not grant on identical startedAt and differing runToken", () => {
  const held = acquireLease({
    existing: [],
    leaseId: "l1",
    kind: "WORKTREE",
    resource: "C:/wt-a",
    missionId: "m1",
    runId: "r1",
    pid: 100,
    processIdentity: { pid: 100, startedAt: T0, runToken: "token-a" },
    now: LONG_AGO,
  }).lease!;
  const reclaimed = reclaimStaleLease({
    existing: [held],
    kind: "WORKTREE",
    resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: T0, runToken: "token-b" },
    now: NOW,
  });
  assert.equal(reclaimed.ok, false, reclaimed.reason);
});

// ---------------------------------------------------------------------------
// F10 — pemOverflow must not emit the held key body
// ---------------------------------------------------------------------------

test("F10 a complete RSA key split on internal newlines does not leak the body", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  const line = `${"A".repeat(64)}\n`;
  const body = line.repeat(1200);
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body.slice(0, 80_000)}`);
  log.write("stdout", body.slice(80_000));
  log.write("stdout", "-----END RSA PRIVATE KEY-----\nordinary after the key\n");
  const tail = log.liveTail("stdout").toString("utf8");
  const image = stdout.contents().toString("utf8");
  assert.equal(tail.includes("A".repeat(64)), false, tail.slice(0, 200));
  assert.equal(image.includes("A".repeat(64)), false, image.slice(0, 200));
  assert.match(tail, /ordinary after the key/);
  assert.match(image, /ordinary after the key/);
});
