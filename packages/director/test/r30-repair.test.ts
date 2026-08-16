/**
 * Round 30 fail-closed repairs. Each case is a proven R30 hostile finding.
 * Helpers are local. R25–R29 cases stay in their own files.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { type GitRunner } from "../src/git-truth.js";
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
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  writerOrphanScanResult,
  type ProcessObservationV1,
} from "../src/process-identity.js";
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

function exitingProcess(opts: { pid?: number } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: 0, signal: null }),
    get exited() { return true; },
  };
}

function liveThenExitProcess(opts: { pid?: number } = {}): SpawnHandleV1 {
  let exited = false;
  queueMicrotask(() => { exited = true; });
  return {
    pid: opts.pid ?? 4812,
    stdout: Readable.from([""]),
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

function leftoverScan(killed: number[], rows: readonly Record<string, unknown>[]) {
  return writerOrphanScanResult(rows.filter((row) => !killed.includes(row.pid as number)) as never);
}

function incrementingThenExitClock(): { now: () => string } {
  let ticks = 0;
  return {
    now() {
      ticks += 1;
      return ticks <= 8 ? T0 : HOLDER_EXIT;
    },
  };
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  scanOrphans?: RunManagerDepsV1["scanOrphans"];
  sampleAncestry?: RunManagerDepsV1["sampleAncestry"];
  killTree?: (pid: number) => void;
  clock?: { now: () => string };
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = memoryFs({ dirs: [CWD, runRoot] });
  const handoffText = JSON.stringify(goodHandoff());
  const innerSpawn = over.spawn ?? ((_e, _a, _o, _p) => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    try { fs.writeDurable(handoffPath, handoffText); } catch { /* still spawn */ }
    return innerSpawn(executable, argv, options, permit);
  };
  const deps: RunManagerDepsV1 = {
    clock: over.clock ?? { now: () => HOLDER_EXIT },
    fs,
    spawn,
    git: matchingGit(),
    probe: over.probe ?? { observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }) },
    capacity: memoryCapacity(),
    wait: async () => undefined,
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe" || path === PROMPT,
      readDir: () => [],
    },
    ...(over.sampleAncestry !== undefined ? { sampleAncestry: over.sampleAncestry } : {}),
    leases: over.leases ?? memoryLeases(),
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

function wiringLeftover(runNonce = NONCE) {
  return {
    pid: 25100,
    parentPid: 18016,
    parentPresent: true,
    parentName: "explorer.exe",
    creationDate: T0,
    runNonce,
    nonceReadable: true,
  };
}

// ---------------------------------------------------------------------------
// persist / identity
// ---------------------------------------------------------------------------

test("R30 capture without creationDate does not treat a recycled holder slot as identity", async () => {
  const killed: number[] = [];
  const holderLater = { pid: 4812, creationDate: "2026-08-13T12:00:20.000400Z" };
  const rows = [holderLater, recycledOccupant, recycledGrandchild];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    spawn: trackingSpawn(() => liveThenExitProcess()),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
    sampleAncestry: () => rows,
    probe: {
      observe: () => asObservation({ outcome: "UNAVAILABLE", reason: "WMI denied", pid: 4812 }),
    },
  });
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok && killed.includes(99007), true, result.reason);
});

test("R30 FOUND capture without creationDate does not establish holder identity", async () => {
  const killed: number[] = [];
  const holderLater = { pid: 4812, creationDate: "2026-08-13T12:00:20.000400Z" };
  const rows = [holderLater, recycledOccupant, recycledGrandchild];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    spawn: trackingSpawn(() => liveThenExitProcess()),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, rows),
    sampleAncestry: () => rows,
    probe: {
      observe: (pid) => asObservation({
        outcome: "FOUND",
        reason: "truncated",
        pid,
        executablePath: CLAUDE_EXE,
      }),
    },
  });
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
});

test("R30 grandchild slot equality without both dates is not proven ancestry", () => {
  const missingWalked = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812, 99006]),
    rows: [recycledOccupant, recycledGrandchild],
  });
  assert.equal(parentlessRowTiedToThisRun(recycledGrandchild, missingWalked), true);
  assert.equal(processRowMakesScanUndecidable(recycledGrandchild, missingWalked), true);

  const missingParentDate = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812, 99006]),
    observedPidIdentities: [[99006, "2026-08-13T12:00:02.000Z"]],
    rows: [{ pid: 99007, parentPid: 99006, creationDate: "2026-08-13T12:00:20.000900Z" }],
  });
  const child = { ...recycledGrandchild };
  delete (child as { parentCreationDate?: string }).parentCreationDate;
  assert.equal(processRowCouldBelongToThisRun(child, missingParentDate), true);
});

test("R30 dateless walked child then recycled grandchild is not kill-then-PASS", async () => {
  const killed: number[] = [];
  const holder = { pid: 4812, creationDate: T0 };
  const genuine = { pid: 99006, parentPid: 4812, parentPresent: true as const };
  let samples = 0;
  let observes = 0;
  const leftover = [recycledOccupant, recycledGrandchild];
  const result = await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-r30" } },
    leases: memoryLeases([writerLease()]),
    clock: incrementingThenExitClock(),
    spawn: trackingSpawn(() => liveThenExitProcess()),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, leftover),
    sampleAncestry: () => {
      samples += 1;
      return samples === 1 ? [holder, genuine] : leftover;
    },
    probe: {
      observe: (pid) => {
        observes += 1;
        if (pid === 4812 && observes === 1) {
          return asObservation({
            outcome: "FOUND",
            reason: "alive",
            pid: 4812,
            creationDate: T0,
            executablePath: CLAUDE_EXE,
          });
        }
        return asObservation({ outcome: "NOT_FOUND", reason: "gone", pid });
      },
    },
  });
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
});

test("R30 missing leftover parentCreationDate cannot mint TREE_GONE or writer release", async () => {
  const killed: number[] = [];
  const holder = { pid: 4812, creationDate: T0 };
  const genuine = {
    pid: 99006,
    parentPid: 4812,
    parentPresent: true as const,
    creationDate: "2026-08-13T12:00:02.000Z",
  };
  const grandchildNoPcd = {
    pid: 99007,
    parentPid: 99006,
    parentPresent: true as const,
    creationDate: "2026-08-13T12:00:20.000900Z",
  };
  let samples = 0;
  let observes = 0;
  const leftover = [recycledOccupant, grandchildNoPcd];
  const result = await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-r30b" } },
    leases: memoryLeases([writerLease()]),
    clock: incrementingThenExitClock(),
    spawn: trackingSpawn(() => liveThenExitProcess()),
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => leftoverScan(killed, leftover),
    sampleAncestry: () => {
      samples += 1;
      return samples === 1 ? [holder, genuine] : leftover;
    },
    probe: {
      observe: (pid) => {
        observes += 1;
        if (pid === 4812 && observes === 1) {
          return asObservation({
            outcome: "FOUND",
            reason: "alive",
            pid: 4812,
            creationDate: T0,
            executablePath: CLAUDE_EXE,
          });
        }
        return asObservation({ outcome: "NOT_FOUND", reason: "gone", pid });
      },
    },
  });
  assert.equal(killed.includes(99007), false, JSON.stringify(killed));
  assert.notEqual(result.ok, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
});

// ---------------------------------------------------------------------------
// wiring / liveness
// ---------------------------------------------------------------------------

function acquireAndRelease(scan: unknown): { ok: boolean; reason: string; remaining: number } {
  const dir = mkdtempSync(join(tmpdir(), "d2-r30-rel-"));
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
    if (acquired.ok !== true) {
      return { ok: false, reason: "acquire failed", remaining: store.list().length };
    }
    const leftover = wiringLeftover(acquired.lease.processIdentity?.runToken ?? NONCE);
    const released = releaseDeveloperAgentWorktreeLease(store, acquired.lease, {
      scanOrphans: () => {
        const raw = scan as Record<string, unknown>;
        const patch = (value: unknown): unknown => {
          if (value === "LEFTOVER") return leftover;
          if (Array.isArray(value)) return value.map((item) => (item === "LEFTOVER" ? leftover : item));
          return value;
        };
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) out[key] = patch(value);
        if (raw.snapshot === "LYING_ARRAY") {
          out.snapshot = new Proxy([leftover], {
            get(target, prop, receiver) {
              if (prop === "length") return 0;
              return Reflect.get(target, prop, receiver);
            },
          });
        }
        if (raw.snapshot === "NONENUM_INDEX") {
          const snapshot = {};
          Object.defineProperty(snapshot, "1", { value: leftover, enumerable: false });
          out.snapshot = snapshot;
        }
        if (raw.snapshot === "FUNCTION") {
          const snapshot = function snap(_x: unknown) { return _x; };
          (snapshot as unknown as Record<number, unknown>)[0] = leftover;
          out.snapshot = snapshot;
        }
        return out as never;
      },
    });
    return { ok: released.ok, reason: released.reason, remaining: store.list().length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("R30 lying-length Array snapshot cannot be treated as empty", () => {
  const released = acquireAndRelease({
    snapshot: "LYING_ARRAY",
    liveSightings: [],
    killable: [],
    undecidable: [],
  });
  assert.equal(released.ok, false, released.reason);
  assert.equal(released.remaining > 0, true);
});

test("R30 non-enumerable indexed leftover retains the lease", () => {
  const released = acquireAndRelease({
    snapshot: "NONENUM_INDEX",
    liveSightings: [],
    killable: [],
    undecidable: [],
  });
  assert.equal(released.ok, false, released.reason);
  assert.equal(released.remaining > 0, true);
});

test("R30 function-valued snapshot fails closed", () => {
  const released = acquireAndRelease({
    snapshot: "FUNCTION",
    liveSightings: [],
    killable: [],
    undecidable: [],
  });
  assert.equal(released.ok, false, released.reason);
  assert.equal(released.remaining > 0, true);
});

test("R30 unexpected snapshot type fails closed", () => {
  const leftover = wiringLeftover();
  const fn = function snap() {};
  (fn as unknown as Record<number, unknown>)[0] = leftover;
  const released = acquireAndRelease({
    snapshot: "FUNCTION",
    liveSightings: [],
    killable: [],
    undecidable: [],
  });
  assert.equal(released.ok, false, released.reason);
});

test("R30 executeRun does not drop a lying-length snapshot before the safety gate", async () => {
  const leftover = wiringLeftover();
  const lying = new Proxy([leftover], {
    get(target, prop, receiver) {
      if (prop === "length") return 0;
      return Reflect.get(target, prop, receiver);
    },
  });
  const result = await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-snap" } },
    leases: memoryLeases([writerLease()]),
    scanOrphans: () => ({ snapshot: lying, killable: [] }) as never,
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
  assert.notEqual(result.ok && result.productionWriterLeaseReleasedByThisRun, true, result.reason);
});

test("R30 representation uncertainty retains the developer-agent lease", () => {
  for (const snapshot of ["LYING_ARRAY", "NONENUM_INDEX", "FUNCTION"] as const) {
    const released = acquireAndRelease({
      snapshot,
      liveSightings: [],
      killable: [],
      undecidable: [],
    });
    assert.equal(released.ok, false, `${snapshot} => ${released.reason}`);
    assert.equal(released.remaining > 0, true, snapshot);
  }
});
