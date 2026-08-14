/**
 * The run manager's job is the conjunction, not the spawn.
 *
 * Each test below is the defect it would miss: exit 0 treated as success; a missing handoff
 * ignored; ids from another run accepted; an artifact outside the run root waved through;
 * the executor's headAfter believed; spend ignored; an unauthorised production claim
 * recorded as authorised; a timeout that never escalates; persist failure that still
 * launches; writer-release inferred from UNKNOWN or from someone else's death.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createFixedClock } from "../src/bounded-log.js";
import type { GitCommandResultV1, GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import {
  acquireLease,
  type LeaseKindV1,
  type LeaseV1,
} from "../src/leases.js";
import type { ExecutorProcessIdentityV1, HostProcessProbe, ProcessObservationV1 } from "../src/process-identity.js";
import { answersAfterReboot, runIntentFrom } from "../src/run-intent.js";
import {
  CANCEL_HARD_MS,
  CANCEL_SOFT_MS,
  createNodeRunFileSystem,
  createNodeSpawner,
  createNodeWait,
  executeRun,
  killProcessTreeStandIn,
  writerReleaseEvidence,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
  type SuccessConjunctNameV1,
} from "../src/run-manager.js";

const NOW = "2026-08-13T12:00:00.000Z";
const LATER = "2026-08-13T12:00:30.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const OTHER_HEAD = "c".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const EXE = "C:\\Tools\\grok.exe";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const T1 = "2026-08-13T13:00:00.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: EXE,
  runNonce: NONCE,
};

const OTHER_IDENTITY: ExecutorProcessIdentityV1 = {
  pid: 9999,
  creationDate: T1,
  executablePath: "C:\\Tools\\other.exe",
  runNonce: "nonce-other",
};

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
    finishedAt: LATER,
    capacityStatus: "AVAILABLE",
    summary: "ok",
    ...over,
  };
}

function request(over: Partial<ExecuteRunRequestV1> = {}): ExecuteRunRequestV1 {
  return {
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    executor: "grok",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: EXE,
    argv: ["--prompt-file", `${CWD}\\PROMPT.md`, "--cwd", CWD, "--no-plan"],
    cwd: CWD,
    runNonce: NONCE,
    runRoot: RUN_ROOT,
    timeoutMs: 30_000,
    lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-1" },
    authorisedProductionMutated: false,
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
      if (value === undefined) throw new Error(`ENOENT ${path}`);
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

function memoryCapacity(opts: { max?: number; used?: number } = {}): CapacityGateV1 & { used: number } {
  const gate = { used: opts.used ?? 0 };
  const max = opts.max ?? 1;
  return {
    get used() {
      return gate.used;
    },
    tryAcquire() {
      if (gate.used >= max) return { ok: false, reason: "capacity-exhausted" };
      gate.used += 1;
      return { ok: true, reason: "capacity-acquired" };
    },
    release() {
      gate.used = Math.max(0, gate.used - 1);
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

function heldWorktree(): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-other",
    kind: "WORKTREE",
    resource: CWD,
    missionId: "mission-other",
    runId: "run-other",
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
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

function matchingGit(head = HEAD_AFTER): GitRunner {
  return {
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") return gitResult(argv, { stdout: `${head}\n` });
      if (key === "symbolic-ref -q --short HEAD") return gitResult(argv, { stdout: "executor/oracle\n" });
      if (key === "status --porcelain") return gitResult(argv, { stdout: "" });
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return gitResult(argv, { status: 128, stderr: "fatal: no upstream configured\n" });
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
    executablePath: identity.executablePath,
    runNonce: identity.runNonce,
  };
}

function probeFound(identity: ExecutorProcessIdentityV1): HostProcessProbe {
  return { observe: () => foundObservation(identity) };
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

function exitingProcess(opts: {
  exitCode?: number;
  pid?: number;
  stdout?: string;
  onKill?: () => void;
} = {}): SpawnHandleV1 {
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
      opts.onKill?.();
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

function hangingProcess(opts: { pid?: number; dieOnSoft?: boolean } = {}): SpawnHandleV1 & {
  forceExit(code?: number | null): void;
  softKills: number;
} {
  let exited = false;
  let softKills = 0;
  let resolveExit: ((value: { code: number | null; signal: string | null }) => void) | null = null;
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });
  const handle: SpawnHandleV1 & { forceExit(code?: number | null): void; softKills: number } = {
    pid: opts.pid ?? RECORDED.pid,
    stdout: Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {
      softKills += 1;
      handle.softKills = softKills;
      if (opts.dieOnSoft && !exited) {
        exited = true;
        resolveExit?.({ code: null, signal: "SIGTERM" });
      }
    },
    exit,
    get exited() {
      return exited;
    },
    forceExit(code = 1) {
      if (exited) return;
      exited = true;
      resolveExit?.({ code, signal: null });
    },
    softKills: 0,
  };
  return handle;
}

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 & { calls: number; lastShell: boolean | null } {
  const tracked = { calls: 0, lastShell: null as boolean | null };
  const spawn: SpawnFnV1 = (_exe, _argv, options) => {
    tracked.calls += 1;
    tracked.lastShell = options.shell;
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.env.AION_RUN_NONCE, NONCE);
    return factory();
  };
  Object.defineProperties(spawn, {
    calls: { get: () => tracked.calls },
    lastShell: { get: () => tracked.lastShell },
  });
  return spawn as SpawnFnV1 & { calls: number; lastShell: boolean | null };
}

async function runWith(
  over: {
    request?: Partial<ExecuteRunRequestV1>;
    fs?: RunFileSystemV1;
    spawn?: SpawnFnV1;
    git?: GitRunner;
    probe?: HostProcessProbe;
    capacity?: CapacityGateV1;
    leases?: LeaseStoreV1;
    wait?: (ms: number) => Promise<void>;
    killTree?: (pid: number) => void;
    askWriterLiveness?: RunManagerDepsV1["askWriterLiveness"];
    scanOrphans?: RunManagerDepsV1["scanOrphans"];
    handoff?: Record<string, unknown> | null;
    neverWait?: boolean;
  } = {},
) {
  const fs = over.fs ?? memoryFs({
    files: over.handoff === null
      ? {}
      : { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(over.handoff ?? goodHandoff()) },
  });
  const spawn = over.spawn ?? trackingSpawn(() => exitingProcess());
  const deps: RunManagerDepsV1 = {
    clock: createFixedClock(NOW),
    fs,
    spawn,
    git: over.git ?? matchingGit(),
    probe: over.probe ?? probeFound(RECORDED),
    capacity: over.capacity ?? memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? (over.neverWait ? (() => new Promise(() => {})) : async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    ...(over.askWriterLiveness !== undefined ? { askWriterLiveness: over.askWriterLiveness } : {}),
    ...(over.scanOrphans !== undefined ? { scanOrphans: over.scanOrphans } : {}),
  };
  return executeRun(request(over.request), deps);
}

function finding(result: Awaited<ReturnType<typeof executeRun>>, name: SuccessConjunctNameV1) {
  const hit = result.conjunction.findings.find((item) => item.name === name);
  assert.ok(hit, `missing conjunct ${name}`);
  return hit;
}

// ---------------------------------------------------------------------------
// Happy path: the conjunction can be true
// ---------------------------------------------------------------------------

test("a run succeeds only when every conjunct holds, and the result names none as failed", async () => {
  const result = await runWith({ neverWait: true });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.conjunction.failedConjuncts, []);
  assert.equal(result.exitCode, 0);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
});

// ---------------------------------------------------------------------------
// Each conjunct, failing on its own
// ---------------------------------------------------------------------------

test("exit non-zero fails the exit conjunct and is not success", async () => {
  // Defect: exit 0 was the whole of success; a non-zero would be the only thing anyone checked.
  const result = await runWith({
    neverWait: true,
    spawn: trackingSpawn(() => exitingProcess({ exitCode: 1 })),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.conjunction.failedConjuncts, ["processExitedWithKnownSuccessCode"]);
  assert.equal(finding(result, "processExitedWithKnownSuccessCode").ok, false);
  assert.match(finding(result, "processExitedWithKnownSuccessCode").reason, /1/);
  assert.equal(finding(result, "handoffParsed").ok, true);
  assert.equal(finding(result, "gitAgreesWithHandoff").ok, true);
});

test("no handoff fails the handoff-parsed conjunct even when the process exits 0", async () => {
  // Defect: four Grok launches exited 0 having written nothing and looked successful.
  const result = await runWith({ neverWait: true, handoff: null });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.conjunction.failedConjuncts.includes("handoffParsed"),
    String(result.conjunction.failedConjuncts),
  );
  assert.equal(finding(result, "handoffParsed").ok, false);
  assert.match(finding(result, "handoffParsed").reason, /handoff/i);
});

test("mismatched ids fail the identities conjunct on their own", async () => {
  // Defect: a stale handoff from another run is indistinguishable from the one that was awaited.
  const result = await runWith({
    neverWait: true,
    handoff: goodHandoff({ missionId: "mission-other", runId: "run-other", workItemId: "work-other" }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.conjunction.failedConjuncts, ["identitiesMatch"]);
  assert.equal(finding(result, "identitiesMatch").ok, false);
  assert.match(finding(result, "identitiesMatch").reason, /missionId|runId|workItemId/);
  assert.equal(finding(result, "handoffParsed").ok, true);
});

test("an artifact outside the run root fails the artifacts conjunct", async () => {
  // One parse, with artifactRoot. The real parser rejects C:\\Windows\\...; a second
  // route that stripped artifacts used to leave handoffParsed true and could report SUCCESS
  // for a reserved-device path the parser itself would refuse.
  const result = await runWith({
    neverWait: true,
    handoff: goodHandoff({ artifacts: ["C:\\Windows\\System32\\cmd.exe"] }),
  });
  assert.equal(result.ok, false);
  assert.equal(finding(result, "artifactsInsideRunRoot").ok, false);
  assert.match(finding(result, "artifactsInsideRunRoot").reason, /outside|artifact/i);
  assert.ok(
    result.conjunction.failedConjuncts.includes("artifactsInsideRunRoot")
      || result.conjunction.failedConjuncts.includes("handoffParsed"),
    String(result.conjunction.failedConjuncts),
  );
});

test("Git disagreeing with the handoff headAfter fails the git conjunct", async () => {
  // Defect: the executor's claimed SHA was believed. The Director's observation is the check.
  const result = await runWith({
    neverWait: true,
    git: matchingGit(OTHER_HEAD),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.conjunction.failedConjuncts, ["gitAgreesWithHandoff"]);
  assert.equal(finding(result, "gitAgreesWithHandoff").ok, false);
  assert.match(finding(result, "gitAgreesWithHandoff").reason, /claimed|shows/);
  assert.equal(finding(result, "handoffParsed").ok, true);
});

test("non-zero spend fails the spend conjunct", async () => {
  // Defect: spendUsd > 0 walked through because exit 0 was the only check.
  const result = await runWith({
    neverWait: true,
    handoff: goodHandoff({ spendUsd: 12 }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.conjunction.failedConjuncts, ["spendIsZero"]);
  assert.equal(finding(result, "spendIsZero").ok, false);
  assert.match(finding(result, "spendIsZero").reason, /12/);
});

test("an unauthorised production claim fails the production conjunct", async () => {
  // Defect: productionMutated: true accepted because the report parsed.
  const result = await runWith({
    neverWait: true,
    handoff: goodHandoff({ productionMutated: true }),
    request: { authorisedProductionMutated: false },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.conjunction.failedConjuncts, ["productionClaimAgrees"]);
  assert.equal(finding(result, "productionClaimAgrees").ok, false);
  assert.match(finding(result, "productionClaimAgrees").reason, /not authorised/);
});

// ---------------------------------------------------------------------------
// Cancel ladder
// ---------------------------------------------------------------------------

test("a timeout escalates soft terminate of the root to a hard tree kill", async () => {
  // Defect: child.kill() was the whole cancel; the tree stayed up on Windows.
  const hung = hangingProcess();
  const waits: number[] = [];
  const killed: number[] = [];
  const spawn = trackingSpawn(() => hung);
  const result = await runWith({
    spawn,
    wait: async (ms) => {
      waits.push(ms);
    },
    killTree: (pid) => {
      killed.push(pid);
      hung.forceExit(1);
    },
    request: { timeoutMs: 1_000 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.cancel.timedOut, true);
  assert.ok(result.cancel.stages.includes("SOFT"), String(result.cancel.stages));
  assert.ok(result.cancel.stages.includes("HARD"), String(result.cancel.stages));
  assert.ok(hung.softKills >= 1, "SOFT must terminate the tracked root");
  assert.deepEqual(killed, [RECORDED.pid]);
  assert.ok(waits.includes(CANCEL_SOFT_MS), `soft wait missing: ${waits.join(",")}`);
  assert.ok(waits.includes(CANCEL_HARD_MS), `hard wait missing: ${waits.join(",")}`);
  const softAt = result.cancel.stages.indexOf("SOFT");
  const hardAt = result.cancel.stages.indexOf("HARD");
  assert.ok(softAt >= 0 && hardAt > softAt, "HARD must follow SOFT");
});

// ---------------------------------------------------------------------------
// Persist before spawn
// ---------------------------------------------------------------------------

test("a failed persist means no spawn happened at all", async () => {
  // Defect: persist failure logged, spawn proceeds on the in-memory record.
  const fs = memoryFs();
  const original = fs.writeDurable.bind(fs);
  fs.writeDurable = (path, utf8) => {
    if (path.endsWith("intent.json")) throw new Error("disk full");
    original(path, utf8);
  };
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({ fs, spawn, neverWait: true, handoff: goodHandoff() });
  assert.equal(result.spawned, false);
  assert.equal(result.ok, false);
  assert.equal(spawn.calls, 0, "launch must be unreachable when persist fails");
  assert.match(result.reason, /persist failed|spawn is refused|disk full/);
});

test("a missing cwd is refused before spawn and is not an executable ENOENT", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    neverWait: true,
    spawn,
    fs: memoryFs({ dirs: [RUN_ROOT] }),
    request: { cwd: "C:\\missing-cwd" },
  });
  assert.equal(result.spawned, false);
  assert.equal(spawn.calls, 0);
  assert.match(result.reason, /cwd does not name an existing directory/);
  assert.match(result.reason, /not reported as an executable ENOENT/);
});

test("capacity exhausted with a free lease does not spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    neverWait: true,
    spawn,
    capacity: memoryCapacity({ max: 1, used: 1 }),
  });
  assert.equal(result.spawned, false);
  assert.equal(spawn.calls, 0);
  assert.match(result.reason, /capacity/);
});

test("a held lease with free capacity does not spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    neverWait: true,
    spawn,
    leases: memoryLeases([heldWorktree()]),
  });
  assert.equal(result.spawned, false);
  assert.equal(spawn.calls, 0);
  assert.match(result.reason, /lease/);
});

// ---------------------------------------------------------------------------
// Entry criterion 3 — writer release evidence
// ---------------------------------------------------------------------------

test("UNKNOWN liveness does not set the writer-release fact", async () => {
  // Defect: a failed probe, or "we could not see a writer", recorded as the writer finished.
  const result = await runWith({
    neverWait: true,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "UNAVAILABLE", reason: "access-denied" },
    ]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    leases: {
      list: () => [],
      save() {
        // Release does not land. The fact must not be inferred from UNKNOWN instead.
      },
    },
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(
    writerReleaseEvidence({
      recordedLeaseKind: "PRODUCTION_WRITER",
      recordedLeaseId: "lease-pw-1",
      releasedLeaseId: null,
      recordedIdentity: RECORDED,
      liveness: "UNKNOWN",
      livenessAskedAbout: RECORDED,
      stillRunning: false,
      orphanScan: { performed: true, liveSightings: [] },
    }),
    false,
  );
});

test("DEAD_CONFIRMED for a different identity does not set the writer-release fact", async () => {
  // Defect: any DEAD_CONFIRMED — including death of a different pid/nonce — set the fact.
  const result = await runWith({
    neverWait: true,
    probe: probeFound(RECORDED),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    leases: {
      list: () => [],
      save() {
        // No explicit release of this run's recorded lease id.
      },
    },
    askWriterLiveness: () => ({
      subject: OTHER_IDENTITY,
      observation: { outcome: "NOT_FOUND", reason: "gone" },
    }),
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(
    writerReleaseEvidence({
      recordedLeaseKind: "PRODUCTION_WRITER",
      recordedLeaseId: "lease-pw-1",
      releasedLeaseId: "lease-pw-1",
      recordedIdentity: RECORDED,
      liveness: "DEAD_CONFIRMED",
      livenessAskedAbout: OTHER_IDENTITY,
      stillRunning: false,
      orphanScan: { performed: true, liveSightings: [] },
    }),
    false,
  );
});

test("a production-writer lease release is evidence only after confirmed exit and an empty orphan scan", async () => {
  // Was: "an explicit release of this run's recorded production-writer lease id is the fact itself".
  // That encoded the defect: releasedLeaseId === heldLease.leaseId with no process observation.
  const result = await runWith({
    neverWait: true,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "NOT_FOUND", reason: "exited" },
    ]),
    scanOrphans: () => [],
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
  const proven = {
    recordedLeaseKind: "PRODUCTION_WRITER" as const,
    recordedLeaseId: "lease-pw-1",
    releasedLeaseId: "lease-pw-1",
    recordedIdentity: RECORDED,
    liveness: "DEAD_CONFIRMED" as const,
    livenessAskedAbout: null,
    stillRunning: false,
    orphanScan: { performed: true, liveSightings: [] as const },
  };
  assert.equal(writerReleaseEvidence(proven), true);
  assert.equal(writerReleaseEvidence({ ...proven, stillRunning: null }), false);
  assert.equal(
    writerReleaseEvidence({ ...proven, orphanScan: { performed: false, liveSightings: [] } }),
    false,
  );
});

test("DEAD_CONFIRMED of this run's identity is not writer-release evidence", async () => {
  // Defect: a launcher shim that exits 0 while its grandchild is still writing set the field
  // because the parent was DEAD_CONFIRMED. A dead parent is not a dead tree.
  const result = await runWith({
    neverWait: true,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "NOT_FOUND", reason: "parent gone" },
    ]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    leases: {
      list: () => [],
      save() {
        // No explicit release. Death of the recorded holder must not substitute.
      },
    },
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(
    writerReleaseEvidence({
      recordedLeaseKind: "PRODUCTION_WRITER",
      recordedLeaseId: "lease-pw-1",
      releasedLeaseId: null,
      recordedIdentity: RECORDED,
      liveness: "DEAD_CONFIRMED",
      livenessAskedAbout: RECORDED,
      stillRunning: false,
      orphanScan: { performed: true, liveSightings: [] },
    }),
    false,
  );
});

test("DEAD_CONFIRMED does not set the writer-release fact for a non-writer lease", async () => {
  // Defect: the DEAD_CONFIRMED branch never checked lease kind. A WORKTREE run that
  // never held a production writer lease still persisted the field as true.
  const kinds: ReadonlyArray<{ kind: LeaseKindV1; resource: string; leaseId: string }> = [
    { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-dead" },
    { kind: "BRANCH", resource: "executor/oracle", leaseId: "lease-br-dead" },
    { kind: "INTEGRATION", resource: "default", leaseId: "lease-in-dead" },
    { kind: "PREVIEW", resource: "default", leaseId: "lease-pr-dead" },
  ];
  for (const lease of kinds) {
    const result = await runWith({
      neverWait: true,
      probe: sequentialProbe([
        foundObservation(RECORDED),
        { outcome: "NOT_FOUND", reason: "gone" },
      ]),
      request: { lease },
    });
    assert.equal(
      result.productionWriterLeaseReleasedByThisRun,
      false,
      `${lease.kind} must not set the production-writer field`,
    );
    assert.equal(
      writerReleaseEvidence({
        recordedLeaseKind: lease.kind,
        recordedLeaseId: lease.leaseId,
        releasedLeaseId: lease.leaseId,
        recordedIdentity: RECORDED,
        liveness: "DEAD_CONFIRMED",
        livenessAskedAbout: RECORDED,
        stillRunning: false,
        orphanScan: { performed: true, liveSightings: [] },
      }),
      false,
      `${lease.kind} explicit release is not a production-writer release`,
    );
  }
  assert.equal(
    writerReleaseEvidence({
      recordedLeaseKind: null,
      recordedLeaseId: "lease-none",
      releasedLeaseId: "lease-none",
      recordedIdentity: RECORDED,
      liveness: "DEAD_CONFIRMED",
      livenessAskedAbout: RECORDED,
      stillRunning: false,
      orphanScan: { performed: true, liveSightings: [] },
    }),
    false,
  );
});

test("a probe that returns a different pid does not set the writer-release fact", async () => {
  // Defect: resolveWriterLiveness compared the recorded identity to itself whenever
  // askWriterLiveness was not injected, so a reused pid still granted the field.
  const result = await runWith({
    neverWait: true,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      {
        outcome: "FOUND",
        reason: "reused-slot",
        pid: OTHER_IDENTITY.pid,
        creationDate: OTHER_IDENTITY.creationDate,
        executablePath: OTHER_IDENTITY.executablePath,
        runNonce: OTHER_IDENTITY.runNonce,
      },
    ]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    leases: {
      list: () => [],
      save() {
        // No explicit release and no injected askWriterLiveness.
      },
    },
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
});

test("an unobservable spawn is recorded as attempted, not as never started", async () => {
  // Defect: captureProcessIdentity failure left processIdentity null and never
  // recorded a spawn, so answersAfterReboot().started was false and recovery relaunched.
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await runWith({
    neverWait: true,
    fs,
    spawn,
    probe: { observe: () => ({ outcome: "UNAVAILABLE", reason: "access-denied" }) },
  });
  assert.equal(spawn.calls, 1, result.reason);
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.processIdentity, null);

  const raw = fs.files.get(join(RUN_ROOT, "intent.json"));
  assert.ok(raw, "intent.json must exist after spawn");
  const parsed = runIntentFrom(JSON.parse(raw) as unknown);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.reason);
  if (!parsed.ok) return;
  assert.equal(parsed.intent.spawnAttemptedAt, NOW);
  assert.equal(parsed.intent.spawnPid, RECORDED.pid);
  assert.equal(parsed.intent.processIdentity, null);
  assert.equal(parsed.intent.spawnObservedAt, null);

  const answers = answersAfterReboot(parsed.intent);
  assert.equal(answers.started, true, "a spawn that returned must not look like it never started");
  assert.equal(answers.spawnPid, RECORDED.pid);
  assert.equal(answers.spawnAttemptedAt, NOW);
});

test("a production writer that ignores kill and survives killTree does not release the lease or set the field", async () => {
  // Defect: releasedLeaseId === heldLease.leaseId set the field while the child was still running.
  const hung = hangingProcess();
  const leases = memoryLeases();
  const result = await runWith({
    spawn: trackingSpawn(() => hung),
    leases,
    request: {
      lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-survive" },
      timeoutMs: 1,
    },
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => [{ pid: hung.pid, runNonce: NONCE, creationDate: T0 }],
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(result.cancel.timedOut, true);
  assert.ok(
    leases.list().some((item) => item.leaseId === "lease-pw-survive"),
    "PRODUCTION_WRITER must stay held while the child is alive",
  );
  assert.equal(
    writerReleaseEvidence({
      recordedLeaseKind: "PRODUCTION_WRITER",
      recordedLeaseId: "lease-pw-survive",
      releasedLeaseId: "lease-pw-survive",
      recordedIdentity: RECORDED,
      liveness: "ALIVE",
      livenessAskedAbout: RECORDED,
      stillRunning: true,
      orphanScan: { performed: true, liveSightings: [{ pid: hung.pid, runNonce: NONCE }] },
    }),
    false,
  );
});

test("a clean parent exit with a live nonce-bearing child is not writer-release evidence", async () => {
  // Defect: detectOrphan had no callers. A parent exit 0 plus NOT_FOUND for the parent
  // set the field while scanOrphans reported live pid 7777 carrying this run's nonce.
  const leases = memoryLeases();
  const result = await runWith({
    neverWait: true,
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "NOT_FOUND", reason: "parent gone" },
    ]),
    scanOrphans: () => [{ pid: 7777, runNonce: NONCE, creationDate: T0 }],
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.list().some((item) => item.leaseId === "lease-pw-1"),
    "a live child carrying the nonce must leave the production-writer lease held",
  );
  assert.equal(
    writerReleaseEvidence({
      recordedLeaseKind: "PRODUCTION_WRITER",
      recordedLeaseId: "lease-pw-1",
      releasedLeaseId: "lease-pw-1",
      recordedIdentity: RECORDED,
      liveness: "DEAD_CONFIRMED",
      livenessAskedAbout: null,
      stillRunning: false,
      orphanScan: { performed: true, liveSightings: [{ pid: 7777, runNonce: NONCE, creationDate: T0 }] },
    }),
    false,
  );
});

test("a failed spawn-attempt record after a live spawn kills the child and fails the run", async () => {
  // Defect: the second intent.json write failed ENOSPC after spawn; the child stayed up
  // and answersAfterReboot().started was false, so recovery relaunched a second writer.
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const original = fs.writeDurable.bind(fs);
  let intentWrites = 0;
  fs.writeDurable = (path, utf8) => {
    if (path.endsWith("intent.json")) {
      intentWrites += 1;
      if (intentWrites >= 2) {
        const error = new Error("ENOSPC");
        (error as NodeJS.ErrnoException).code = "ENOSPC";
        throw error;
      }
    }
    original(path, utf8);
  };
  const hung = hangingProcess();
  const killed: number[] = [];
  const spawn = trackingSpawn(() => hung);
  const result = await runWith({
    neverWait: true,
    fs,
    spawn,
    killTree: (pid) => {
      killed.push(pid);
      hung.forceExit(1);
    },
  });
  assert.equal(spawn.calls, 1, result.reason);
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.ok, false);
  assert.match(result.reason, /could not be recorded|ENOSPC/);
  assert.ok(hung.softKills >= 1 || killed.includes(hung.pid), "the unrecorded child must be stopped");
  assert.ok(killed.includes(hung.pid), "killTree must run after a failed spawn record");

  const raw = fs.files.get(join(RUN_ROOT, "intent.json"));
  assert.ok(raw, "the pre-spawn intent must still exist");
  const parsed = runIntentFrom(JSON.parse(raw) as unknown);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.reason);
  if (!parsed.ok) return;
  assert.equal(answersAfterReboot(parsed.intent).started, false);
});

// ---------------------------------------------------------------------------
// Real wiring
// ---------------------------------------------------------------------------

test("a real node process is spawned with shell false and its exit is collected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-run-mgr-"));
  try {
    const spawn = createNodeSpawner();
    let seenShell: boolean | null = null;
    const wrapped: SpawnFnV1 = (exe, argv, options) => {
      seenShell = options.shell;
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      return spawn(exe, argv, options);
    };
    const result = await executeRun(
      request({
        cwd: dir,
        worktree: dir,
        runRoot: join(dir, "run"),
        executablePath: process.execPath,
        argv: ["-e", "process.exit(0)"],
        runNonce: "nonce-real-node",
        timeoutMs: 15_000,
        lease: { kind: "WORKTREE", resource: dir, leaseId: "lease-real-1" },
      }),
      {
        clock: createFixedClock(NOW),
        fs: createNodeRunFileSystem(),
        spawn: wrapped,
        git: matchingGit(),
        probe: {
          observe: () => ({ outcome: "NOT_FOUND", reason: "exited before probe" }),
        },
        capacity: memoryCapacity(),
        leases: memoryLeases(),
        wait: createNodeWait(),
        killTree: killProcessTreeStandIn,
      },
    );
    assert.equal(seenShell, false);
    assert.equal(result.spawned, true, result.reason);
    assert.equal(result.exitCode, 0);
    assert.equal(result.conjunction.findings[0]?.name, "processExitedWithKnownSuccessCode");
    assert.equal(finding(result, "processExitedWithKnownSuccessCode").ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
