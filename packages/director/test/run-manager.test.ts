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
import {
  createWindowsProcessProbe,
  type ExecutorProcessIdentityV1,
  type HostProcessProbe,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import {
  answersAfterReboot,
  isSpawnPermitSpent,
  persistRunIntent,
  requireSpawnPermit,
  runIntentFrom,
  spendSpawnPermit,
  type SpawnPermitV1,
} from "../src/run-intent.js";
import {
  CANCEL_HARD_MS,
  CANCEL_SOFT_MS,
  createNodeRunFileSystem,
  createNodeSpawner,
  createNodeWait,
  executeRun,
  isWriterExitProof,
  killProcessTreeStandIn,
  proveWriterExit,
  writerReleaseEvidence,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
  type SuccessConjunctNameV1,
  type WriterExitProofInputV1,
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

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited" };

function writerProofInput(over: Partial<WriterExitProofInputV1> = {}): WriterExitProofInputV1 {
  return {
    processStillRunning: false,
    recordedLeaseKind: "PRODUCTION_WRITER",
    recordedLeaseId: "lease-pw-1",
    releasedLeaseId: "lease-pw-1",
    recordedIdentity: RECORDED,
    observation: HOLDER_GONE,
    probedPid: RECORDED.pid,
    orphanScanPerformed: true,
    orphanSightings: [],
    ...over,
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
  const spawn: SpawnFnV1 = (_exe, _argv, options, permit) => {
    requireSpawnPermit(permit);
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
    scanOrphans: over.scanOrphans ?? (() => []),
  };
  return executeRun(request(over.request), deps);
}

function finding(result: Awaited<ReturnType<typeof executeRun>>, name: SuccessConjunctNameV1) {
  const hit = result.conjunction.findings.find((item) => item.name === name);
  assert.ok(hit, `missing conjunct ${name}`);
  return hit;
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error(`timed out waiting for ${label}`);
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

test("UNKNOWN liveness with a landed production-writer release is not an exit proof", async () => {
  // Defect: `if (liveness === "ALIVE") return false` let UNKNOWN and null fall through
  // to true once the lease release had landed.
  const result = await runWith({
    neverWait: true,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "UNAVAILABLE", reason: "access-denied" },
    ]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    scanOrphans: () => [],
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      observation: { outcome: "UNAVAILABLE", reason: "access-denied" },
    }))),
    false,
  );
});

test("a liveness answer about a different identity does not produce an exit proof", async () => {
  // Defect: askWriterLiveness supplied subject OTHER + NOT_FOUND. holderLiveness used
  // the caller subject, identityFromObservation(NOT_FOUND) was null, the guard skipped,
  // and a landed release set the field.
  const result = await runWith({
    neverWait: true,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      foundObservation(RECORDED),
    ]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    scanOrphans: () => [],
    askWriterLiveness: () => ({
      subject: OTHER_IDENTITY,
      observation: { outcome: "NOT_FOUND", reason: "gone" },
    }),
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      observation: { outcome: "NOT_FOUND", reason: "gone" },
      probedPid: OTHER_IDENTITY.pid,
    }))),
    false,
  );
});

test("a production-writer lease release is evidence only after a constructed exit proof", async () => {
  // Was: a bag of fields with releasedLeaseId === recordedLeaseId set the boolean.
  // The field is now true only when proveWriterExit returns a branded proof.
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
  const proof = proveWriterExit(writerProofInput());
  assert.ok(proof);
  assert.equal(isWriterExitProof(proof), true);
  assert.equal(writerReleaseEvidence(proof), true);
  assert.equal(writerReleaseEvidence(null), false);
  assert.equal(writerReleaseEvidence(writerProofInput()), false, "a field bag is not a proof");
  const inheritedProof = Object.create(proof) as typeof proof;
  assert.equal(isWriterExitProof(inheritedProof), false, "an inherited brand is not a minted proof");
  assert.equal(writerReleaseEvidence(inheritedProof), false);
  assert.equal(isWriterExitProof(new Proxy({}, { get: () => true })), false);
  assert.equal(
    writerReleaseEvidence(proveWriterExit(writerProofInput({ orphanScanPerformed: false }))),
    false,
  );
  assert.equal(
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      observation: foundObservation(RECORDED),
    }))),
    false,
    "ALIVE is not DEAD_CONFIRMED",
  );
  assert.equal(
    proveWriterExit(writerProofInput({
      recordedIdentity: { ...RECORDED, creationDate: "2026-08-13T12:00:01.0000000" },
      observation: {
        outcome: "FOUND",
        reason: "injected",
        pid: RECORDED.pid,
        creationDate: "2026-08-13T12:00:01.000Z",
        executablePath: RECORDED.executablePath,
        runNonce: RECORDED.runNonce,
      },
    })),
    null,
    "two encodings of one live process must not mint DEAD_CONFIRMED",
  );
  assert.equal(
    proveWriterExit(writerProofInput({
      observation: foundObservation({ ...RECORDED, creationDate: T1 }),
    })),
    null,
    "a date difference that still carries this run's nonce is not an exit proof",
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
    writerReleaseEvidence(proveWriterExit(writerProofInput({ releasedLeaseId: null }))),
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
      scanOrphans: () => [],
    });
    assert.equal(
      result.productionWriterLeaseReleasedByThisRun,
      false,
      `${lease.kind} must not set the production-writer field`,
    );
    assert.equal(
      writerReleaseEvidence(proveWriterExit(writerProofInput({
        recordedLeaseKind: lease.kind,
        recordedLeaseId: lease.leaseId,
        releasedLeaseId: lease.leaseId,
      }))),
      false,
      `${lease.kind} explicit release is not a production-writer release`,
    );
  }
  assert.equal(
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      recordedLeaseKind: null,
      recordedLeaseId: "lease-none",
      releasedLeaseId: "lease-none",
    }))),
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
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      recordedLeaseId: "lease-pw-survive",
      releasedLeaseId: "lease-pw-survive",
      observation: foundObservation(RECORDED),
      orphanSightings: [{ pid: hung.pid, runNonce: NONCE }],
    }))),
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
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      orphanSightings: [{ pid: 7777, runNonce: NONCE, creationDate: T0 }],
    }))),
    false,
  );
});

test("FOUND without executablePath does not produce an exit proof", async () => {
  // Defect: Windows observe(4) is FOUND + creationDate + name "System" and no
  // executablePath → holderLiveness UNKNOWN → the ALIVE denylist fell through to true.
  const result = await runWith({
    neverWait: true,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      {
        outcome: "FOUND",
        reason: "cim",
        pid: RECORDED.pid,
        creationDate: RECORDED.creationDate,
        name: "System",
      },
    ]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    scanOrphans: () => [],
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      observation: {
        outcome: "FOUND",
        reason: "cim",
        pid: RECORDED.pid,
        creationDate: RECORDED.creationDate,
        name: "System",
      },
    }))),
    false,
  );
});

test("a mismatched runNonce does not produce an exit proof", async () => {
  // Defect: identityFromObservation is null on real CIM output (nonce lives in
  // the environment, never argv), so the identity guard never ran. A FOUND
  // occupant with a different nonce is UNKNOWN, and UNKNOWN plus a landed
  // release used to set the field.
  const result = await runWith({
    neverWait: true,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      {
        outcome: "FOUND",
        reason: "injected",
        pid: RECORDED.pid,
        creationDate: RECORDED.creationDate,
        executablePath: RECORDED.executablePath,
        runNonce: "a-totally-different-run",
      },
    ]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    scanOrphans: () => [],
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(
    writerReleaseEvidence(proveWriterExit(writerProofInput({
      observation: {
        outcome: "FOUND",
        reason: "injected",
        pid: RECORDED.pid,
        creationDate: RECORDED.creationDate,
        executablePath: RECORDED.executablePath,
        runNonce: "a-totally-different-run",
      },
    }))),
    false,
  );
});

test("a throwing liveness probe denies the field and still writes a durable result", async () => {
  // Defect: resolveWriterLiveness did not wrap probe.observe. A WMI-down throw
  // rejected executeRun after finally had already released the PRODUCTION_WRITER
  // lease, and no result.json was written.
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  let observes = 0;
  const result = await runWith({
    neverWait: true,
    fs,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    probe: {
      observe() {
        observes += 1;
        if (observes === 1) return foundObservation(RECORDED);
        throw new Error("RPC server unavailable");
      },
    },
    scanOrphans: () => [],
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  const raw = fs.files.get(join(RUN_ROOT, "result.json"));
  assert.ok(raw, "a throwing probe must still write result.json");
  const parsed = JSON.parse(raw) as { productionWriterLeaseReleasedByThisRun: boolean };
  assert.equal(parsed.productionWriterLeaseReleasedByThisRun, false);
});

test("a padded request nonce still identifies a live grandchild as an orphan", async () => {
  // Defect: persist trimmed the nonce, the env and scan query used the raw
  // request string, and the inline compare never matched the recorded token.
  const leases = memoryLeases();
  const result = await runWith({
    neverWait: true,
    leases,
    request: {
      lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" },
      runNonce: `  ${NONCE}  `,
    },
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "NOT_FOUND", reason: "parent gone" },
    ]),
    scanOrphans: () => [{ pid: 7777, runNonce: NONCE, creationDate: T0 }],
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.list().some((item) => item.leaseId === "lease-pw-1"),
    "a live grandchild of the normalised nonce must leave the writer lease held",
  );
});

test("a failed spawn-attempt record after a live spawn kills the child and fails the run", async () => {
  // Defect: the second intent.json write failed ENOSPC after spawn; the child stayed up
  // and answersAfterReboot().started was false, so recovery relaunched a second writer.
  //
  // Changed: this test used to assert started === false as the success condition.
  // That pinned the lie "child was stopped" without observing the child. The
  // record write still fails, so the file has no spawnPid; "stopped" is now
  // allowed only after probe.observe returns NOT_FOUND.
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
    probe: { observe: () => ({ outcome: "NOT_FOUND", reason: "killed after failed record" }) },
    killTree: (pid) => {
      killed.push(pid);
      hung.forceExit(1);
    },
  });
  assert.equal(spawn.calls, 1, result.reason);
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.ok, false);
  assert.match(result.reason, /could not be recorded|ENOSPC/);
  assert.match(result.reason, /child was stopped/);
  assert.ok(hung.softKills >= 1 || killed.includes(hung.pid), "the unrecorded child must be stopped");
  assert.ok(killed.includes(hung.pid), "killTree must run after a failed spawn record");

  const raw = fs.files.get(join(RUN_ROOT, "intent.json"));
  assert.ok(raw, "the pre-spawn intent must still exist");
  const parsed = runIntentFrom(JSON.parse(raw) as unknown);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.reason);
  if (!parsed.ok) return;
  assert.equal(parsed.intent.spawnPid, null, "the failed record write left no spawnPid");
});

test("a child that survives kill and killTree after a failed record is still running, not stopped", async () => {
  // Defect: kill() and killTree() failures were swallowed; the result said
  // "child was stopped" while the child was alive and intent.json read started: false.
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
  const result = await runWith({
    neverWait: true,
    fs,
    spawn: trackingSpawn(() => hung),
    probe: { observe: () => foundObservation(RECORDED) },
    killTree: () => {
      throw new Error("Access is denied");
    },
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.ok, false);
  assert.match(result.reason, /stillRunning: true/);
  assert.match(result.reason, new RegExp(String(hung.pid)));
  assert.doesNotMatch(result.reason, /child was stopped/);
  assert.equal(hung.exited, false, "the child must still be alive");
});

test("a process death between spawn and its record refuses a same-runId restart", async () => {
  // Defect: spawnAttemptedAt was written only after deps.spawn returned.
  // Director death in that window left spawnAttemptedAt=null / spawnPid=null.
  // persist treated "unstarted" as resumable, minted a fresh permit, and
  // acquireLease returned ok for the same runId. Two executors in one worktree.
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const filesAtCrash = new Map<string, string>();
  const original = fs.writeDurable.bind(fs);
  fs.writeDurable = (path, utf8) => {
    original(path, utf8);
    if (path.endsWith("intent.json") && filesAtCrash.size === 0) {
      for (const [key, value] of fs.files) filesAtCrash.set(key, value);
    }
  };

  const hung = hangingProcess();
  const firstSpawn = trackingSpawn(() => hung);
  const leases = memoryLeases();
  const first = executeRun(request(), {
    clock: createFixedClock(NOW),
    fs,
    spawn: firstSpawn,
    git: matchingGit(),
    probe: probeFound(RECORDED),
    capacity: memoryCapacity(),
    leases,
    wait: () => new Promise(() => {}),
    killTree: () => undefined,
    scanOrphans: () => [],
  });

  await until(() => firstSpawn.calls === 1 && filesAtCrash.size > 0, "first persist and spawn");

  const crashIntent = filesAtCrash.get(join(RUN_ROOT, "intent.json"));
  assert.ok(crashIntent, "persist must have landed before spawn returned");
  const crashParsed = runIntentFrom(JSON.parse(crashIntent) as unknown);
  assert.equal(crashParsed.ok, true, crashParsed.ok ? "" : crashParsed.reason);
  if (!crashParsed.ok) return;
  assert.equal(crashParsed.intent.spawnAttemptedAt, null);
  assert.equal(crashParsed.intent.spawnPid, null);
  assert.equal(crashParsed.intent.processIdentity, null);
  const crashAnswers = answersAfterReboot(crashParsed.intent);
  assert.equal(crashAnswers.supposedToRun, true);
  assert.equal(crashAnswers.started, false);

  const secondSpawn = trackingSpawn(() => exitingProcess());
  const second = await executeRun(request(), {
    clock: createFixedClock(NOW),
    fs: memoryFs({
      files: Object.fromEntries(filesAtCrash),
      dirs: [CWD, RUN_ROOT],
    }),
    spawn: secondSpawn,
    git: matchingGit(),
    probe: probeFound(RECORDED),
    capacity: memoryCapacity(),
    leases: memoryLeases(leases.list()),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => [],
  });

  assert.equal(secondSpawn.calls, 0, second.reason);
  assert.equal(second.spawned, false, second.reason);
  assert.match(second.reason, /unresolvable|existing intent|refusing to overwrite/);
  assert.equal(hung.exited, false, "the first child must still be alive");
  assert.equal(firstSpawn.calls, 1);

  hung.forceExit(1);
  await first;
});

// ---------------------------------------------------------------------------
// Real wiring
// ---------------------------------------------------------------------------

test("createNodeSpawner refuses a forged permit before creating a process", () => {
  const spawn = createNodeSpawner();
  assert.throws(
    () => spawn(
      process.execPath,
      ["-e", "process.exit(0)"],
      { cwd: process.cwd(), env: {}, shell: false, windowsHide: true },
      { intentPath: "C:\\tmp\\intent.json" } as never,
    ),
    /spawn is refused/,
  );
});

test("a real node process is spawned with shell false and its exit is collected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-run-mgr-"));
  try {
    const spawn = createNodeSpawner();
    let seenShell: boolean | null = null;
    const wrapped: SpawnFnV1 = (exe, argv, options, permit) => {
      requireSpawnPermit(permit);
      seenShell = options.shell;
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      return spawn(exe, argv, options, permit);
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
        scanOrphans: () => [],
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

test("a real child exit, NOT_FOUND, empty orphan scan, and an explicit release produce the proof", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-writer-exit-"));
  try {
    const hostProbe = createWindowsProcessProbe();
    let captureDone = false;
    const probe: HostProcessProbe = {
      observe(pid) {
        if (!captureDone) {
          captureDone = true;
          return hostProbe.observe(pid);
        }
        return { outcome: "NOT_FOUND", reason: "exited" };
      },
    };
    const leases = memoryLeases();
    const result = await executeRun(
      request({
        cwd: dir,
        worktree: dir,
        runRoot: join(dir, "run"),
        executablePath: process.execPath,
        argv: ["-e", "setTimeout(() => process.exit(0), 8000)"],
        runNonce: "nonce-real-exit-proof",
        timeoutMs: 15_000,
        lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-real" },
      }),
      {
        clock: createFixedClock(NOW),
        fs: createNodeRunFileSystem(),
        spawn: createNodeSpawner(),
        git: matchingGit(),
        probe,
        capacity: memoryCapacity(),
        leases,
        wait: createNodeWait(),
        killTree: killProcessTreeStandIn,
        scanOrphans: () => [],
      },
    );
    assert.equal(result.spawned, true, result.reason);
    assert.equal(result.exitCode, 0, result.reason);
    assert.ok(result.processIdentity, "identity must be captured while the child is alive");
    assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
    assert.equal(
      leases.list().some((item) => item.leaseId === "lease-pw-real"),
      false,
      "the production-writer lease must have been released",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createNodeSpawner refuses a permit used for a different executable", () => {
  // Defect: requireSpawnPermit proved "some intent was persisted in this
  // process", not "this launch was persisted". A grok.exe permit drove
  // createNodeSpawner to launch a different executable.
  const dir = mkdtempSync(join(tmpdir(), "aion-permit-mismatch-"));
  try {
    const persisted = persistRunIntent({
      intentPath: join(dir, "intent.json"),
      runId: "run-1",
      missionId: "mission-1",
      workItemId: "work-1",
      worktree: dir,
      branch: "executor/oracle",
      executablePath: EXE,
      argv: ["--prompt-file", join(dir, "PROMPT.md"), "--cwd", dir],
      cwd: dir,
      runNonce: NONCE,
      now: NOW,
    });
    assert.equal(persisted.ok, true, persisted.ok ? "" : persisted.reason);
    if (!persisted.ok) return;
    assert.equal(persisted.permit.authorised.executable, EXE);
    assert.deepEqual([...persisted.permit.authorised.argv], ["--prompt-file", join(dir, "PROMPT.md"), "--cwd", dir]);
    assert.equal(persisted.permit.authorised.cwd, dir);
    assert.equal(persisted.permit.authorised.runId, "run-1");
    assert.equal(persisted.permit.authorised.runNonce, NONCE);

    const spawn = createNodeSpawner();
    assert.throws(
      () => spawn(
        process.execPath,
        ["-e", "process.exit(0)"],
        { cwd: dir, env: {}, shell: false, windowsHide: true },
        persisted.permit,
      ),
      /does not match|persisted intent/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createNodeSpawner refuses a permit after it has been spent", async () => {
  // Defect: the permit never expired. After the authorised run completed it
  // was reused for further launches.
  const dir = mkdtempSync(join(tmpdir(), "aion-permit-reuse-"));
  try {
    const argv = ["-e", "process.exit(0)"];
    const persisted = persistRunIntent({
      intentPath: join(dir, "intent.json"),
      runId: "run-1",
      missionId: "mission-1",
      workItemId: "work-1",
      worktree: dir,
      branch: "executor/oracle",
      executablePath: process.execPath,
      argv,
      cwd: dir,
      runNonce: "nonce-spend-once",
      now: NOW,
    });
    assert.equal(persisted.ok, true, persisted.ok ? "" : persisted.reason);
    if (!persisted.ok) return;

    const spawn = createNodeSpawner();
    const options = { cwd: dir, env: {}, shell: false as const, windowsHide: true as const };
    const first = spawn(process.execPath, argv, options, persisted.permit);
    const ended = await first.exit;
    assert.equal(ended.code, 0, "the authorised launch must run once");

    assert.throws(
      () => spawn(process.execPath, argv, options, persisted.permit),
      /already been spent/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a live same-nonce grandchild with parent UNAVAILABLE withholds the writer lease", async () => {
  // Defect: withholdProductionWriter read detectOrphan via liveSightings.
  // detectOrphan answers "is this an orphan?" and returns orphan:false for a
  // matching-nonce grandchild unless parentLiveness is DEAD_CONFIRMED.
  // UNAVAILABLE is access-denied — the ordinary elevated-executor outcome —
  // so the lease released while a live writer remained in the worktree.
  // The nonce sweep also ran only on cancel, not on a clean exit 0.
  const leases = memoryLeases();
  const killed: number[] = [];
  const result = await runWith({
    neverWait: true,
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "UNAVAILABLE", reason: "access-denied" },
    ]),
    scanOrphans: () => [{ pid: 7777, runNonce: NONCE, creationDate: T0 }],
    killTree: (pid) => {
      killed.push(pid);
    },
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.list().some((item) => item.leaseId === "lease-pw-1"),
    "a live same-nonce grandchild must leave the production-writer lease held when the parent probe is UNAVAILABLE",
  );
  assert.ok(
    killed.includes(7777),
    "the nonce sweep must run on a clean exit, not only on cancellation",
  );
});

test("an ALIVE probe of the recorded holder leaves the production-writer lease held", async () => {
  // Defect: releaseHeld withheld only on stillRunning || liveSightings.
  // child.once("exit") made stillRunning false, the scan was empty, and the
  // lease was released while holderLiveness of the recorded identity was ALIVE.
  // proveWriterExit ran after the act and could only relabel it.
  const leases = memoryLeases();
  const result = await runWith({
    neverWait: true,
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    probe: sequentialProbe([
      foundObservation(RECORDED),
      foundObservation(RECORDED),
    ]),
    scanOrphans: () => [],
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.list().some((item) => item.leaseId === "lease-pw-1"),
    "ALIVE is not a writer-exit proof; the production-writer lease must stay held",
  );
});

test("a throwing orphan scan leaves the writer lease held and still writes a durable result", async () => {
  // Defect: collectWriterOrphans called scanOrphans unguarded. A CIM/WMI
  // throw escaped executeRun after finally released the PRODUCTION_WRITER
  // lease, and no result.json was written.
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const leases = memoryLeases();
  const result = await runWith({
    neverWait: true,
    fs,
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "NOT_FOUND", reason: "exited" },
    ]),
    scanOrphans: () => {
      throw new Error("CIM/WMI error");
    },
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  const raw = fs.files.get(join(RUN_ROOT, "result.json"));
  assert.ok(raw, "a throwing scanOrphans must still write result.json");
  const parsed = JSON.parse(raw) as { productionWriterLeaseReleasedByThisRun: boolean };
  assert.equal(parsed.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.list().some((item) => item.leaseId === "lease-pw-1"),
    "a scan that could not finish must leave the production-writer lease held",
  );
});

test("a dropped lease save is not a released lease and does not mint an exit proof", async () => {
  // Defect: releasedLeaseId was derived from releaseLease(before, id)'s
  // arguments and return value. A save that silently dropped the write left
  // the lease in the store and still set releasedLeaseId, so proveWriterExit
  // minted a proof.
  let stored: LeaseV1[] = [];
  const leases: LeaseStoreV1 = {
    list: () => [...stored],
    save(next) {
      if (next.some((item) => item.leaseId === "lease-pw-1")) {
        stored = [...next];
      }
    },
  };
  const result = await runWith({
    neverWait: true,
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" } },
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "NOT_FOUND", reason: "exited" },
    ]),
    scanOrphans: () => [],
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    stored.some((item) => item.leaseId === "lease-pw-1"),
    "a save that dropped the release must leave the lease in the store",
  );
});

test("proveWriterExit denies when the handle is still running, even if the probe says NOT_FOUND", () => {
  // Defect: WriterExitProofInputV1 had no processStillRunning field. The probe
  // won, so a hanging handle plus NOT_FOUND minted a proof and freed the lease.
  assert.equal(
    proveWriterExit(writerProofInput({ processStillRunning: true })),
    null,
  );
  assert.ok(proveWriterExit(writerProofInput({ processStillRunning: false })));
});

test("a hanging handle plus a NOT_FOUND probe does not release the production-writer lease", async () => {
  // Defect: stillRunning was this module's verdict after the SOFT/HARD ladder,
  // but proveWriterExit never saw it. Every existing writer-release test used a
  // handle that had already exited, so the probe alone decided death.
  const hung = hangingProcess();
  const leases = memoryLeases();
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const result = await runWith({
    fs,
    spawn: trackingSpawn(() => hung),
    leases,
    request: {
      lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-1" },
      timeoutMs: 1,
    },
    wait: async () => undefined,
    killTree: () => undefined,
    probe: sequentialProbe([
      foundObservation(RECORDED),
      { outcome: "NOT_FOUND", reason: "gone after ladder" },
    ]),
    scanOrphans: () => [],
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.exitCode, null);
  assert.equal(finding(result, "processExitedWithKnownSuccessCode").ok, false);
  assert.match(finding(result, "processExitedWithKnownSuccessCode").reason, /still running/);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(
    leases.list().some((item) => item.leaseId === "lease-pw-1"),
    "the module's still-running verdict must deny the writer-exit proof",
  );
  const raw = fs.files.get(join(RUN_ROOT, "result.json"));
  assert.ok(raw, "result.json must exist");
  const persisted = JSON.parse(raw) as {
    productionWriterLeaseReleasedByThisRun: boolean;
    exitCode: number | null;
    conjunction: { findings: { name: string; ok: boolean; reason: string }[] };
  };
  assert.equal(persisted.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(persisted.exitCode, null);
  const exitFinding = persisted.conjunction.findings.find((item) => item.name === "processExitedWithKnownSuccessCode");
  assert.equal(exitFinding?.ok, false);
  assert.match(exitFinding?.reason ?? "", /still running/);
});

test("executeRun spends the permit before the injected spawner runs", async () => {
  // Defect: requireSpawnPermit at the gate checked membership only. A SpawnFn
  // that accepted the permit and ignored it completed a launch, and the permit
  // was still spendable afterwards.
  let seen: SpawnPermitV1 | null = null;
  const spawn: SpawnFnV1 = (_exe, _argv, _options, permit) => {
    requireSpawnPermit(permit);
    seen = permit;
    return exitingProcess();
  };
  const result = await runWith({ spawn, neverWait: true });
  assert.equal(result.spawned, true, result.reason);
  assert.ok(seen, "the injected spawner must receive the permit");
  assert.equal(isSpawnPermitSpent(seen), true);
  assert.throws(
    () => spendSpawnPermit(seen, {
      executable: EXE,
      argv: request().argv,
      cwd: CWD,
    }),
    /already been spent/,
  );
});

test("a swapped intent.json between spawn and its record does not adopt the swapped command", async () => {
  // Defect: permitMatchesIntent compared runId and runNonce only. Swapping
  // executable/argv/cwd after spawn returned was accepted, so the durable
  // record described a launch that never ran.
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const spawn: SpawnFnV1 = (_exe, _argv, _options, permit) => {
    requireSpawnPermit(permit);
    const path = join(RUN_ROOT, "intent.json");
    const current = JSON.parse(fs.readUtf8(path)) as Record<string, unknown>;
    fs.writeDurable(path, `${JSON.stringify({
      ...current,
      executablePath: "C:\\Tools\\evil.exe",
      argv: ["--exfiltrate"],
      worktree: "C:\\somewhere-else",
      cwd: "C:\\somewhere-else",
    }, null, 2)}\n`);
    return exitingProcess();
  };
  const result = await runWith({ fs, spawn, neverWait: true });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(result.ok, false, "a swapped command must not be recorded as a successful run");
  assert.equal(result.intent?.executablePath, EXE);
  assert.deepEqual(result.intent ? [...result.intent.argv] : [], [...request().argv]);
  assert.equal(result.intent?.cwd, CWD);
  const raw = fs.files.get(join(RUN_ROOT, "intent.json"));
  assert.ok(raw, "intent.json must still exist");
  const parsed = runIntentFrom(JSON.parse(raw) as unknown);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.reason);
  if (!parsed.ok) return;
  assert.equal(parsed.intent.spawnPid, null, "the swapped file must not receive a spawn record");
  assert.equal(parsed.intent.executablePath, "C:\\Tools\\evil.exe");
  assert.equal(answersAfterReboot(parsed.intent).started, false);
});

test("a real child exit, a real orphan scan, and an explicit release free the writer lease for the next run", async () => {
  // Defect: scanOrphans was optional and only tests supplied it. Production
  // therefore never performed a scan, never minted a proof, and every
  // production-writer run permanently blocked the next one.
  const dir = mkdtempSync(join(tmpdir(), "aion-writer-liveness-"));
  const nonce = `nonce-live-scan-${process.pid}-${Date.now()}`;
  try {
    const leases = memoryLeases();
    const first = await executeRun(
      request({
        cwd: dir,
        worktree: dir,
        runRoot: join(dir, "run-a"),
        executablePath: process.execPath,
        argv: ["-e", "setTimeout(() => process.exit(0), 2000)"],
        runNonce: nonce,
        timeoutMs: 15_000,
        lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-live-1" },
      }),
      {
        clock: createFixedClock(NOW),
        fs: createNodeRunFileSystem(),
        spawn: createNodeSpawner(),
        git: matchingGit(),
        probe: createWindowsProcessProbe(),
        capacity: memoryCapacity(),
        leases,
        wait: createNodeWait(),
        killTree: killProcessTreeStandIn,
      },
    );
    assert.equal(first.spawned, true, first.reason);
    assert.equal(first.exitCode, 0, first.reason);
    assert.ok(first.processIdentity, "identity must be captured while the child is alive");
    assert.equal(first.productionWriterLeaseReleasedByThisRun, true, first.reason);
    assert.equal(
      leases.list().some((item) => item.leaseId === "lease-pw-live-1"),
      false,
      "a completed scan that found nothing must release the production-writer lease",
    );

    const second = await executeRun(
      request({
        runId: "run-2",
        cwd: dir,
        worktree: dir,
        runRoot: join(dir, "run-b"),
        executablePath: process.execPath,
        argv: ["-e", "process.exit(0)"],
        runNonce: `${nonce}-b`,
        timeoutMs: 15_000,
        lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-live-2" },
      }),
      {
        clock: createFixedClock(NOW),
        fs: createNodeRunFileSystem(),
        spawn: createNodeSpawner(),
        git: matchingGit(),
        probe: createWindowsProcessProbe(),
        capacity: memoryCapacity(),
        leases,
        wait: createNodeWait(),
        killTree: killProcessTreeStandIn,
      },
    );
    assert.equal(second.spawned, true, second.reason);
    assert.doesNotMatch(second.reason, /another run holds this/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
