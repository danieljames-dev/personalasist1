/**
 * Round 11 property tests. Each case below failed on 2748afec7414de86141d873d2abfbc70ebd00cd2.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
} from "../src/bounded-log.js";
import { argvIsSafe } from "../src/executors.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import {
  acquireLease,
  reclaimStaleLease,
  releaseLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  captureProcessIdentity,
  createWindowsOrphanScanner,
  interpretWindowsOrphanScanOutput,
  type ExecutorProcessIdentityV1,
  type HostProcessProbe,
  type ProcessObservationV1,
  writerOrphanScanResult,
} from "../src/process-identity.js";
import { requireSpawnPermit, type SpawnPermitV1 } from "../src/run-intent.js";
import { GROK_MAX_TURNS } from "../src/executor-adapters.js";
import {
  createNodeRunFileSystem,
  executeRun,
  launchRun,
  writerSightingNotProvenAbsent,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";
import type { GitCommandResultV1, GitRunner } from "../src/git-truth.js";

const NOW = "2026-08-13T12:00:00.000Z";
const LATER = "2026-08-13T12:00:30.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const EXE = "C:\\Tools\\grok.exe";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: "C:\\Tools\\claude.exe",
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited", pid: 4812 };

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

function grokImplementerArgv(promptPath = `${CWD}\\PROMPT.md`, cwd = CWD): string[] {
  return [
    "--prompt-file", promptPath,
    "--cwd", cwd,
    "--permission-mode", "bypassPermissions",
    "--always-approve",
    "--no-plan",
    "--max-turns", String(GROK_MAX_TURNS),
  ];
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
    promptPath: `${CWD}\\PROMPT.md`,
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

function sequentialProbe(observations: readonly ProcessObservationV1[]): HostProcessProbe {
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

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 {
  return (_exe, _argv, options, permit) => {
    requireSpawnPermit(permit);
    assert.equal(options.shell, false);
    return factory();
  };
}

async function runWith(
  over: {
    request?: Partial<ExecuteRunRequestV1>;
    fs?: RunFileSystemV1;
    spawn?: SpawnFnV1;
    git?: GitRunner;
    probe?: HostProcessProbe;
    leases?: LeaseStoreV1;
    killTree?: (pid: number) => void;
    scanOrphans?: RunManagerDepsV1["scanOrphans"];
    handoff?: Record<string, unknown> | null;
    logSinks?: RunManagerDepsV1["logSinks"];
    neverWait?: boolean;
  } = {},
) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs();
  let handoffText: string | null = null;
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
  const innerSpawn = over.spawn ?? trackingSpawn(() => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    if (handoffText !== null) {
      try { fs.writeDurable(handoffPath, handoffText); } catch { /* conjunction records absence */ }
    }
    return innerSpawn(executable, argv, options, permit);
  };
  const deps: RunManagerDepsV1 = {
    clock: createFixedClock(NOW),
    fs,
    spawn,
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
    discoveryEnv: { AION_GROK_PATH: EXE, AION_CLAUDE_CODE_PATH: "C:\\Tools\\claude.exe" },
    discoveryFs: {
      isFile: (path) => (path === EXE || path === "C:\\Tools\\claude.exe") || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
      readDir: () => [],
    },
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
  };
  return executeRun(request(over.request), deps);
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
    argv: request().argv,
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

// ---------------------------------------------------------------------------
// A1
// ---------------------------------------------------------------------------

test("A1 two PRODUCTION_WRITER leases on different tokens are refused at acquire", () => {
  const first = acquireLease({
    existing: [],
    leaseId: "lease-pw-default",
    kind: "PRODUCTION_WRITER",
    resource: "default",
    missionId: "m1",
    runId: "run-A",
    now: NOW,
  });
  assert.equal(first.ok, true, first.reason);
  const second = acquireLease({
    existing: [first.lease!],
    leaseId: "lease-pw-prod",
    kind: "PRODUCTION_WRITER",
    resource: "prod",
    missionId: "m1",
    runId: "run-B",
    now: NOW,
  });
  assert.equal(second.ok, false, "PRODUCTION_WRITER is singular regardless of token");
  assert.match(second.reason, /another run holds this/);
});

test("A1 two INTEGRATION leases on different tokens are refused at acquire", () => {
  const first = acquireLease({
    existing: [],
    leaseId: "lease-int-x",
    kind: "INTEGRATION",
    resource: "x",
    missionId: "m1",
    runId: "run-C",
    now: NOW,
  });
  assert.equal(first.ok, true, first.reason);
  const second = acquireLease({
    existing: [first.lease!],
    leaseId: "lease-int-y",
    kind: "INTEGRATION",
    resource: "y",
    missionId: "m1",
    runId: "run-D",
    now: NOW,
  });
  assert.equal(second.ok, false);
});

test("A1-liveness two WORKTREE leases on different directories are both granted", () => {
  const a = acquireLease({
    existing: [],
    leaseId: "lease-wt-a",
    kind: "WORKTREE",
    resource: "C:/wt-a",
    missionId: "m1",
    runId: "run-claude",
    now: NOW,
  });
  const b = acquireLease({
    existing: [a.lease!],
    leaseId: "lease-wt-b",
    kind: "WORKTREE",
    resource: "C:/wt-b",
    missionId: "m1",
    runId: "run-grok",
    now: NOW,
  });
  assert.equal(a.ok, true, a.reason);
  assert.equal(b.ok, true, b.reason);
});

test("A1-liveness a WORKTREE lease and a PRODUCTION_WRITER lease coexist", () => {
  const wt = acquireLease({
    existing: [],
    leaseId: "lease-wt-coexist",
    kind: "WORKTREE",
    resource: "C:/wt-a",
    missionId: "m1",
    runId: "run-impl",
    now: NOW,
  });
  const pw = acquireLease({
    existing: [wt.lease!],
    leaseId: "lease-pw-coexist",
    kind: "PRODUCTION_WRITER",
    resource: "default",
    missionId: "m1",
    runId: "run-writer",
    now: NOW,
  });
  assert.equal(wt.ok, true, wt.reason);
  assert.equal(pw.ok, true, pw.reason);
});

test("R2 an expired PRODUCTION_WRITER under one token is found by a reclaim naming another", () => {
  const longAgo = "2026-08-13T10:00:00.000Z";
  const held = acquireLease({
    existing: [],
    leaseId: "lease-pw-token-default",
    kind: "PRODUCTION_WRITER",
    resource: "default",
    missionId: "m1",
    runId: "run-old",
    pid: 12224,
    now: longAgo,
  }).lease!;

  const foundThenJudged = reclaimStaleLease({
    existing: [held],
    kind: "PRODUCTION_WRITER",
    resource: "prod",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 12224 },
    now: NOW,
  });
  assert.equal(foundThenJudged.ok, false, "a singleton under a different token must be found, not missed");
  assert.equal(foundThenJudged.refusal, "IDENTITY_UNVERIFIABLE");
  assert.equal(foundThenJudged.remaining.length, 1);

  const reclaimed = reclaimStaleLease({
    existing: [held],
    kind: "PRODUCTION_WRITER",
    resource: "prod",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "NOT_FOUND", pid: 12224 },
    now: NOW,
  });
  assert.equal(reclaimed.ok, true, "once found, NOT_FOUND of the recorded pid still reclaims");
  assert.deepEqual(reclaimed.remaining, []);
});

// ---------------------------------------------------------------------------
// A2
// ---------------------------------------------------------------------------

test("A2 acquireLease refuses an empty leaseId", () => {
  const attempt = acquireLease({
    existing: [],
    leaseId: "",
    kind: "WORKTREE",
    resource: "C:/wt",
    missionId: "m1",
    runId: "r1",
    now: NOW,
  });
  assert.equal(attempt.ok, false);
  assert.match(attempt.reason, /lease id/);
});

test("A2 acquireLease refuses a leaseId already held under a different kind+resource", () => {
  const first = acquireLease({
    existing: [],
    leaseId: "L-DUP",
    kind: "WORKTREE",
    resource: "C:/wt",
    missionId: "m1",
    runId: "rA",
    now: NOW,
  });
  assert.equal(first.ok, true, first.reason);
  const second = acquireLease({
    existing: [first.lease!],
    leaseId: "L-DUP",
    kind: "WORKTREE",
    resource: "C:/wt2",
    missionId: "m1",
    runId: "rB",
    now: NOW,
  });
  assert.equal(second.ok, false);
  assert.match(second.reason, /already identifies a different resource/);
});

test("A2 executeRun with a colliding leaseId leaves run A's live lease in the store", async () => {
  const heldA = acquireLease({
    existing: [],
    leaseId: "L-DUP",
    kind: "WORKTREE",
    resource: "C:/wt",
    missionId: "m1",
    runId: "rA",
    pid: 4001,
    now: NOW,
  });
  assert.equal(heldA.ok, true, heldA.reason);
  const leases = memoryLeases([heldA.lease!]);
  const result = await runWith({
    leases,
    fs: memoryFs({
      dirs: [CWD, "C:\\wt2", RUN_ROOT, "C:\\AION\\director\\RUNS\\run-B"],
      files: { [join("C:\\AION\\director\\RUNS\\run-B", "handoff.json")]: JSON.stringify(goodHandoff()) },
    }),
    request: {
      runId: "rB",
      cwd: "C:\\wt2",
      worktree: "C:\\wt2",
      runRoot: "C:\\AION\\director\\RUNS\\run-B",
      lease: { kind: "WORKTREE", resource: "C:\\wt2", leaseId: "L-DUP" },
    },
  });
  assert.equal(result.spawned, false, result.reason);
  assert.equal(leases.list().some((item) => item.runId === "rA" && item.leaseId === "L-DUP"), true);
});

test("A2-liveness acquire then release then acquire again succeeds", () => {
  const first = acquireLease({
    existing: [],
    leaseId: "lease-cycle-1",
    kind: "WORKTREE",
    resource: "C:/wt",
    missionId: "m1",
    runId: "r1",
    now: NOW,
  });
  assert.equal(first.ok, true, first.reason);
  const remaining = releaseLease([first.lease!], first.lease!);
  assert.equal(remaining.length, 0);
  const second = acquireLease({
    existing: remaining,
    leaseId: "lease-cycle-2",
    kind: "WORKTREE",
    resource: "C:/wt",
    missionId: "m1",
    runId: "r1",
    now: NOW,
  });
  assert.equal(second.ok, true, second.reason);
});

// ---------------------------------------------------------------------------
// A3
// ---------------------------------------------------------------------------

test("A3 finish() writes runId and existingCompletionOn distinguishes a foreign completion", async () => {
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const first = await runWith({ fs });
  assert.equal(first.spawned, true, first.reason);
  assert.equal(first.runId, "run-1");
  const persisted = JSON.parse(fs.files.get(join(RUN_ROOT, "result.json")) ?? "null") as {
    runId?: string;
    spawned?: boolean;
  };
  assert.equal(persisted.runId, "run-1");

  const foreign = await runWith({
    fs,
    request: { runId: "run-other", runRoot: RUN_ROOT },
  });
  assert.equal(foreign.spawned, false);
  assert.match(foreign.reason, /unreadable|already exists/);

  const same = await runWith({ fs, request: { runId: "run-1", runRoot: RUN_ROOT } });
  assert.equal(same.spawned, false);
  assert.match(same.reason, /already exists/);
});

// ---------------------------------------------------------------------------
// B1
// ---------------------------------------------------------------------------

function crashedWriterLease(): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-pw-CRASHED",
    kind: "PRODUCTION_WRITER",
    resource: "default",
    missionId: "mission-1",
    runId: "run-1",
    pid: 4812,
    processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE },
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

test("B1 adopted FOUND holder is retained and the probe is called", async () => {
  const leases = memoryLeases([crashedWriterLease()]);
  let observes = 0;
  const probe: HostProcessProbe = {
    observe(pid) {
      observes += 1;
      assert.equal(pid, 4812);
      return foundObservation(RECORDED);
    },
  };
  const result = await runWith({
    leases,
    probe,
    fs: memoryFs({ files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() } }),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-CRASHED" } },
  });
  assert.equal(result.spawned, false);
  // R16 F1: the physical fact is the lease holder, not the intent file.
  // Both exist here; the reason must name the lease (or still be a refusal).
  assert.match(result.reason, /lease|already exists|refusing to overwrite/);
  assert.ok(observes >= 1, `probe.observe called ${observes} times`);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-CRASHED"), true);
});

test("B1 adopted NOT_FOUND holder is released on the same re-entry path", async () => {
  const leases = memoryLeases([crashedWriterLease()]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "gone", pid }) },
    fs: memoryFs({ files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() } }),
    scanOrphans: () => writerOrphanScanResult([]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-CRASHED" } },
  });
  assert.equal(result.spawned, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-CRASHED"), false);
});

test("B1 adopted UNAVAILABLE holder is retained", async () => {
  const leases = memoryLeases([crashedWriterLease()]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ outcome: "UNAVAILABLE", reason: "access denied", pid }) },
    fs: memoryFs({ files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent() } }),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-CRASHED" } },
  });
  assert.equal(result.spawned, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-CRASHED"), true);
});

// ---------------------------------------------------------------------------
// C1 / C2
// ---------------------------------------------------------------------------

test("C1 captureProcessIdentity fails when the occupant is not the launched executable", () => {
  const captured = captureProcessIdentity(
    {
      observe: () => ({
        outcome: "FOUND",
        reason: "cim",
        pid: 4812,
        creationDate: T0,
        executablePath: "C:\\Windows\\System32\\svchost.exe",
        runNonce: NONCE,
      }),
    },
    { pid: 4812, runNonce: NONCE, expectedExecutable: EXE },
  );
  assert.equal(captured.ok, false);
  assert.equal(captured.identity, null);
});

test("C2 an ancestry-only leftover older than the recorded holder is not killed", async () => {
  const killed: number[] = [];
  const leftover = {
    pid: 5501,
    parentPid: 4812,
    parentPresent: true,
    nonceReadable: true,
    runNonce: "foreign-nonce",
    creationDate: "2026-08-13T11:00:00.000Z",
  };
  await runWith({
    scanOrphans: () => writerOrphanScanResult([leftover]),
    killTree: (pid) => {
      killed.push(pid);
    },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-c2" } },
  });
  assert.equal(killed.includes(5501), false, `killed ${killed.join(",")}`);
});

test("C2-liveness a nonce-bearing detached grandchild is still killed", async () => {
  const killed: number[] = [];
  let gone = false;
  const grandchild = {
    pid: 7172,
    parentPid: 9999,
    parentPresent: false,
    nonceReadable: true,
    runNonce: NONCE,
    creationDate: T0,
  };
  await runWith({
    scanOrphans: () => writerOrphanScanResult(gone ? [] : [grandchild]),
    killTree: (pid) => {
      killed.push(pid);
      if (pid === 7172) gone = true;
    },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-c2-live" } },
  });
  assert.equal(killed.includes(7172), true, `killed ${killed.join(",")}`);
});

// ---------------------------------------------------------------------------
// D1 / D2
// ---------------------------------------------------------------------------

test("D1 the generated scan script emit predicate includes the floor-bounded parentless disjunct", () => {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "" };
    },
  });
  scanner({ runNonce: NONCE, createdNotBefore: "2026-08-14T14:00:00.000Z", holderPid: 4812 });
  assert.match(script, /\$provenBeforeFloor/);
  assert.match(script, /\$isBroker/);
  assert.match(script, /\$parentProvenCapable/);
  assert.match(script, /\$emit = \$isDesc -or \(\(-not \$provenBeforeFloor\) -and -not \$parentProvenCapable\)/);
});

test("D1 the measured double-fork leaf row makes interpret UNAVAILABLE", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{
        pid: 31676,
        parentPid: 29496,
        parentPresent: false,
        nonceReadable: true,
        runNonce: null,
        creationDate: "2026-08-14T14:04:49.085-04:00",
      }],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T14:00:00.000Z",
    runNonce: NONCE,
    observedPids: [29496],
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

test("D1 end-to-end the double-fork leaf withholds the PRODUCTION_WRITER lease", async () => {
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    scanOrphans: () => writerOrphanScanResult([{
      pid: 20328,
      parentPid: 19990,
      parentPresent: false,
      nonceReadable: true,
      creationDate: "2026-08-13T12:00:05.000Z",
    }]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-d1" } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.conjunction.failedConjuncts.includes("executorTreeIsGone"), String(result.conjunction.failedConjuncts));
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-d1"), true);
});

test("D1-liveness a parentless nonce-less row before the floor leaves the scan SCANNED", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{
        pid: 4,
        parentPresent: false,
        nonceReadable: true,
        runNonce: null,
        creationDate: "2020-01-01T00:00:00.000Z",
      }],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T14:00:00.000Z",
    runNonce: NONCE,
  });
  assert.equal(interpreted.outcome, "SCANNED");
});

test("D2 writerSightingNotProvenAbsent is true for a null nonce and for nonceReadable false", () => {
  assert.equal(
    writerSightingNotProvenAbsent(
      { pid: 7777, parentPid: 6666, nonceReadable: false, parentPresent: true },
      NONCE,
      { holderPid: 4812, rows: [] },
    ),
    true,
  );
  assert.equal(
    writerSightingNotProvenAbsent(
      { pid: 4242 },
      NONCE,
      { holderPid: 999, rows: [] },
    ),
    true,
  );
});

test("D2 end-to-end an unreadable-nonce sighting withholds the writer lease", async () => {
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    scanOrphans: () => writerOrphanScanResult([{
      pid: 7777,
      parentPid: 6666,
      nonceReadable: false,
      parentPresent: false,
      creationDate: T0,
    }]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-d2" } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-d2"), true);
});

// ---------------------------------------------------------------------------
// E1 / E2 / E3
// ---------------------------------------------------------------------------

test("E1 a write role that commits nothing is not success", async () => {
  const result = await runWith({
    request: {
      role: "IMPLEMENT",
      executor: "claude",
      executablePath: "C:\\Tools\\claude.exe",
      argv: ["-p", "--permission-mode", "bypassPermissions"],
      promptPath: `${CWD}\\PROMPT.md`,
    },
    git: matchingGit(HEAD_AFTER),
    handoff: goodHandoff({ executor: "claude", headAfter: HEAD_AFTER, headBefore: HEAD_AFTER }),
  });
  assert.equal(result.ok, false, result.reason);
  assert.ok(result.conjunction.failedConjuncts.includes("writeMovedHead"), String(result.conjunction.failedConjuncts));
});

test("E1-liveness a review role that commits nothing can still succeed", async () => {
  const result = await runWith({
    neverWait: true,
    request: {
      executor: "grok",
      executablePath: EXE,
      role: "INDEPENDENT_ACCEPTANCE",
      argv: [
        "--prompt-file", `${CWD}\\PROMPT.md`,
        "--cwd", CWD,
        "--permission-mode", "plan",
        "--max-turns", String(GROK_MAX_TURNS),
      ],
    },
    git: matchingGit(HEAD_AFTER),
    probe: sequentialProbe([foundObservation({ ...RECORDED, executablePath: EXE }), HOLDER_GONE]),
  });
  assert.equal(result.ok, true, result.reason);
});

test("E2 ADVERSARIAL_REVIEW that actually commits fails reviewLeftTreeUnchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r11-e2-"));
  const runRoot = join(dir, "run");
  const promptPath = join(dir, "PROMPT.md");
  writeFileSync(promptPath, "review\n");
  spawnSync("git", ["init"], { cwd: dir, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "r11@example.test"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "user.name", "r11"], { cwd: dir, windowsHide: true });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  spawnSync("git", ["add", "seed.txt"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["commit", "-m", "seed"], { cwd: dir, windowsHide: true });
  const before = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, windowsHide: true, encoding: "utf8" });
  const headBefore = before.stdout.trim();
  const branchName = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], {
    cwd: dir,
    windowsHide: true,
    encoding: "utf8",
  }).stdout.trim() || "master";
  try {
    const spawn: SpawnFnV1 = (_exe, _argv, _options, permit: SpawnPermitV1) => {
      requireSpawnPermit(permit);
      spawnSync("git", ["commit", "--allow-empty", "-m", "executor shim work"], {
        cwd: dir,
        windowsHide: true,
      });
      const after = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, windowsHide: true, encoding: "utf8" });
      mkdirSync(runRoot, { recursive: true });
      writeFileSync(join(runRoot, "handoff.json"), `${JSON.stringify(goodHandoff({
        runId: "run-review",
        branch: branchName,
        headBefore,
        headAfter: after.stdout.trim(),
        finishedAt: "2026-08-13T12:00:30.000Z",
      }))}\n`);
      return exitingProcess();
    };
    const { createNodeGitRunner } = await import("../src/git-truth.js");
    const result = await launchRun(
      {
        runId: "run-review",
        missionId: "mission-1",
        workItemId: "work-1",
        executor: "grok",
        worktree: dir,
        branch: null,
        cwd: dir,
        runNonce: NONCE,
        runRoot,
        promptPath,
        timeoutMs: 30_000,
        lease: { kind: "WORKTREE", resource: dir, leaseId: "lease-review-e2" },
        authorisedProductionMutated: false,
        role: "ADVERSARIAL_REVIEW",
      },
      {
        clock: createFixedClock(NOW),
        fs: createNodeRunFileSystem(),
        spawn,
        git: createNodeGitRunner({ worktreePath: dir }),
        probe: sequentialProbe([
          foundObservation({ ...RECORDED, executablePath: EXE }),
          HOLDER_GONE,
        ]),
        capacity: memoryCapacity(),
        leases: memoryLeases(),
        wait: async () => undefined,
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        discoveryEnv: { AION_GROK_PATH: EXE },
        discoveryFs: { isFile: (path) => (path === EXE) || /(?:^|[\\\\/])PROMPT\.md$/i.test(path), readDir: () => [] },
      },
    );
    assert.equal(result.ok, false, result.reason);
    assert.ok(
      result.conjunction.failedConjuncts.includes("reviewLeftTreeUnchanged"),
      String(result.conjunction.failedConjuncts),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("E3 a handoff whose finishedAt precedes the spawn floor is denied", async () => {
  const result = await runWith({
    handoff: goodHandoff({
      startedAt: "2020-01-01T00:00:00.000Z",
      finishedAt: "2020-01-01T00:05:00.000Z",
    }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.conjunction.failedConjuncts.includes("handoffParsed"), String(result.conjunction.failedConjuncts));
});

test("E3-liveness a normal fast run's handoff still parses", async () => {
  const result = await runWith({
    neverWait: true,
    handoff: goodHandoff({ startedAt: NOW, finishedAt: NOW }),
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.conjunction.findings.find((item) => item.name === "handoffParsed")?.ok, true);
});

// ---------------------------------------------------------------------------
// F / G
// ---------------------------------------------------------------------------

test("F argvIsSafe refuses NUL, SOH and DEL", () => {
  assert.equal(argvIsSafe(["a\u0000b"]).safe, false);
  assert.equal(argvIsSafe(["a\u0001b"]).safe, false);
  assert.equal(argvIsSafe(["a\u007fb"]).safe, false);
});

test("F-liveness Windows paths with R&D, UNC C$, and => still pass", () => {
  assert.equal(argvIsSafe(["C:\\Program Files\\R&D\\grok.exe"]).safe, true);
  assert.equal(argvIsSafe(["\\\\host\\C$\\x"]).safe, true);
  assert.equal(argvIsSafe(["-e", "setTimeout(() => process.exit(0), 1)"]).safe, true);
});

test("G1 executeRun flush of an unterminated private key does not write key material", async () => {
  const stdout = createMemoryLogSink();
  const stderr = createMemoryLogSink();
  await runWith({
    neverWait: true,
    spawn: trackingSpawn(() => exitingProcess({
      stdout: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA_REAL_KEY_MATERIAL_0001\nMIIEowIBAAKCAQEA_REAL_KEY_MATERIAL_0002\n",
    })),
    logSinks: { stdout, stderr },
  });
  const text = stdout.contents().toString("utf8");
  assert.equal(text.includes("KEY_MATERIAL"), false, text);
  assert.match(text, /REDACTED/);
});

test("G2 a 64 KiB line with ghp_ straddling the hold overflow is redacted", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  const token = "ghp_AAAABBBBCCCCDDDDEEEE";
  const starter = "ghp_";
  const head = `${"x".repeat(MAX_TOKEN_HOLD + 1 - 2)}${starter.slice(0, 2)}`;
  log.write("stdout", head);
  log.write("stdout", `${starter.slice(2)}${token.slice(4)}"}\n`);
  log.flush();
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
  assert.equal(text.includes(token), false, text.slice(-80));
  assert.match(text, /REDACTED/);
});

// ---------------------------------------------------------------------------
// H
// ---------------------------------------------------------------------------

test("H the package entry still withholds executeRun", async () => {
  const director = await import("../src/index.js");
  assert.equal(typeof director.launchRun, "function");
  assert.equal(typeof (director as { executeRun?: unknown }).executeRun, "undefined");
});

test("H director-cli launches at USD 0 against a local stub and returns ok:true", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  assert.equal(existsSync(cli), true, `missing ${cli}`);

  const dir = mkdtempSync(join(tmpdir(), "aion-r11-h-"));
  const worktree = join(dir, "wt");
  const runRoot = join(dir, "run");
  mkdirSync(worktree);
  const promptPath = join(worktree, "PROMPT.md");
  writeFileSync(promptPath, "accept\n");
  spawnSync("git", ["init"], { cwd: worktree, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "r11@example.test"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["config", "user.name", "r11"], { cwd: worktree, windowsHide: true });
  writeFileSync(join(worktree, "seed.txt"), "seed\n");
  spawnSync("git", ["add", "seed.txt", "PROMPT.md"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["commit", "-m", "seed"], { cwd: worktree, windowsHide: true });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: worktree, windowsHide: true, encoding: "utf8" }).stdout.trim();
  const branch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], {
    cwd: worktree,
    windowsHide: true,
    encoding: "utf8",
  }).stdout.trim() || "master";

  const stubDir = mkdtempSync(join(tmpdir(), "aion-r11-stub-"));
  const stub = compileHandoffStub(stubDir);
  const handoff = JSON.stringify(goodHandoff({
    runId: "run-cli",
    branch,
    headBefore: head,
    headAfter: head,
    artifacts: [],
    finishedAt: new Date(Date.now() + 2_000).toISOString(),
    startedAt: new Date().toISOString(),
  }));

  try {
    const launched = spawnSync(process.execPath, [
      cli,
      "--run-id", "run-cli",
      "--mission-id", "mission-1",
      "--work-item-id", "work-1",
      "--executor", "grok",
      "--role", "INDEPENDENT_ACCEPTANCE",
      "--worktree", worktree,
      "--cwd", worktree,
      "--run-root", runRoot,
      "--prompt-path", promptPath,
      "--lease-kind", "WORKTREE",
      "--lease-resource", worktree,
      "--lease-id", "lease-cli-1",
      "--run-nonce", "nonce-cli-1",
    ], {
      cwd: join(here, "..", "..", "..", ".."),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        AION_GROK_PATH: stub,
        AION_DIRECTOR_TEST_DOUBLE: "1",
        AION_HANDOFF_JSON: handoff,
        AION_DIRECTOR_ROOT: join(dir, "store"),
      },
      timeout: 60_000,
    });
    const result = JSON.parse(readFileSync(join(runRoot, "result.json"), "utf8")) as {
      ok: boolean;
      reason: string;
      spawned?: boolean;
      handoff?: { spendUsd?: unknown } | null;
      conjunction?: {
        findings?: ReadonlyArray<{ name: string; ok: boolean; reason: string }>;
      };
    };
    const spend = result.conjunction?.findings?.find((item) => item.name === "spendIsZero");
    assert.equal(result.spawned, true, result.reason);
    assert.equal(result.handoff?.spendUsd, 0, `handoff.spendUsd=${String(result.handoff?.spendUsd)}`);
    assert.equal(spend?.ok, true, spend?.reason ?? "spendIsZero missing");
    const treeReason = result.conjunction?.findings?.find((item) => item.name === "executorTreeIsGone")?.reason ?? "";
    assert.equal(result.ok, true, `${result.reason} tree=${treeReason}${launched.stdout}\n${launched.stderr}`);
    assert.equal(launched.status, 0, `${launched.stdout}\n${launched.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

function compileHandoffStub(dir: string): string {
  const src = join(dir, "stub.cs");
  const exe = join(dir, "grok-stub.exe");
  writeFileSync(src, [
    "using System;",
    "using System.IO;",
    "class P {",
    "  static string SetJsonString(string json, string key, string value) {",
    "    var needle = \"\\\"\" + key + \"\\\"\";",
    "    var i = json.IndexOf(needle, StringComparison.Ordinal);",
    "    if (i < 0) {",
    "      var close = json.LastIndexOf('}');",
    "      if (close < 0) return json;",
    "      return json.Substring(0, close) + \",\\\"\" + key + \"\\\":\\\"\" + value + \"\\\"}\";",
    "    }",
    "    var colon = json.IndexOf(':', i);",
    "    var q1 = json.IndexOf('\"', colon + 1);",
    "    if (q1 < 0) return json;",
    "    var q2 = json.IndexOf('\"', q1 + 1);",
    "    if (q2 < 0) return json;",
    "    return json.Substring(0, q1 + 1) + value + json.Substring(q2);",
    "  }",
    "  static int Main() {",
    "    var path = Environment.GetEnvironmentVariable(\"AION_HANDOFF_PATH\");",
    "    var json = Environment.GetEnvironmentVariable(\"AION_HANDOFF_JSON\");",
    "    var nonce = Environment.GetEnvironmentVariable(\"AION_RUN_NONCE\") ?? \"\";",
    "    if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(json)) return 2;",
    "    var now = DateTime.UtcNow.ToString(\"yyyy-MM-ddTHH:mm:ss.fffZ\");",
    "    json = SetJsonString(json, \"runNonce\", nonce);",
    "    json = SetJsonString(json, \"finishedAt\", now);",
    "    json = SetJsonString(json, \"startedAt\", now);",
    "    var folder = Path.GetDirectoryName(path);",
    "    if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);",
    "    File.WriteAllText(path, json);",
    "    return 0;",
    "  }",
    "}",
    "",
  ].join("\n"));
  const cscCandidates = [
    join("C:", "Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join("C:", "Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  for (const csc of cscCandidates) {
    if (!existsSync(csc)) continue;
    const compiled = spawnSync(csc, ["/nologo", `/out:${exe}`, src], { encoding: "utf8", windowsHide: true });
    if (compiled.status === 0 && existsSync(exe)) return exe;
  }
  const ps = [
    `$src = Get-Content -Raw ${JSON.stringify(src)};`,
    `Add-Type -OutputAssembly ${JSON.stringify(exe)} -OutputType ConsoleApplication -TypeDefinition $src;`,
  ].join(" ");
  const added = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (!existsSync(exe)) {
    throw new Error(`stub compile failed: ${added.stdout} ${added.stderr}`);
  }
  return exe;
}
