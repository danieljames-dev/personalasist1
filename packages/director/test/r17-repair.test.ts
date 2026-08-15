/**
 * Round 17 (D2 repair). Each test below must fail against cb8a00c9 and pass
 * after the property repair. Helpers are local.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
} from "../src/bounded-log.js";
import {
  argvGrantsWritePermission,
  executorArgvFor,
  GROK_MAX_TURNS,
} from "../src/executor-adapters.js";
import type { GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import { acquireLease, reclaimStaleLease, type LeaseV1 } from "../src/leases.js";
import {
  createWindowsOrphanScanner,
  normalisedCreationDate,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  resolveWindowsSystemExecutable,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import { persistRunIntent, requireSpawnPermit } from "../src/run-intent.js";
import {
  createNodeSpawner,
  evaluateSuccessConjunction,
  executeRun,
  proveWriterExit,
  taskkillConfirmedStopped,
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
  executablePath: EXE,
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited" };

const PARENTLESS_CTX = {
  runNonce: NONCE,
  createdNotBefore: T0,
  holderPid: 4812,
  holderExitedAt: HOLDER_EXIT,
  observedPids: new Set([4812]),
  rows: [{ pid: 4812 }, { pid: 7777, parentPid: 4900 }],
};

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

function grokReviewArgv(promptPath = PROMPT, cwd = CWD): string[] {
  return [
    "--prompt-file", promptPath,
    "--cwd", cwd,
    "--permission-mode", "dontAsk",
    "--no-plan",
    "--max-turns", String(GROK_MAX_TURNS),
  ];
}

function matchingDiscovery(exe = EXE): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: exe, AION_CLAUDE_CODE_PATH: "C:\\Tools\\claude.exe" },
    discoveryFs: {
      isFile: (path) => path === exe || path === "C:\\Tools\\claude.exe",
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
    argv: grokImplementerArgv(),
    cwd: CWD,
    runNonce: NONCE,
    runRoot: RUN_ROOT,
    promptPath: PROMPT,
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

function matchingGit(head = HEAD_AFTER, opts: { readonly advance?: boolean; readonly ignored?: string } = {}): GitRunner {
  let revParses = 0;
  return {
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        revParses += 1;
        const sha = opts.advance === true && revParses === 1 ? HEAD_BEFORE : head;
        return gitResult(argv, { stdout: `${sha}\n` });
      }
      if (key === "symbolic-ref -q --short HEAD") return gitResult(argv, { stdout: "executor/oracle\n" });
      if (key === "status --porcelain") return gitResult(argv, { stdout: "" });
      if (key === "status --porcelain --ignored") {
        return gitResult(argv, { stdout: opts.ignored ?? "" });
      }
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return gitResult(argv, { status: 128, stderr: "fatal: no upstream configured\n" });
      }
      if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
        return gitResult(argv, { status: 0 });
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

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 & { calls: number; lastEnv: Record<string, string> | null } {
  const spawnFn = ((_exe, _argv, options, permit) => {
    requireSpawnPermit(permit);
    assert.equal(options.shell, false);
    spawnFn.calls += 1;
    spawnFn.lastEnv = { ...options.env };
    return factory();
  }) as SpawnFnV1 & { calls: number; lastEnv: Record<string, string> | null };
  spawnFn.calls = 0;
  spawnFn.lastEnv = null;
  return spawnFn;
}

function writerLease(over: {
  pid?: number | null;
  processIdentity?: LeaseV1["processIdentity"];
  leaseId?: string;
  runId?: string;
  now?: string;
} = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: over.leaseId ?? "lease-pw-1",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: over.runId ?? "run-1",
    pid: over.pid === undefined ? 4812 : over.pid,
    ...(over.processIdentity !== undefined ? { processIdentity: over.processIdentity } : {
      processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE },
    }),
    now: over.now ?? NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
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
  const fs = over.fs ?? memoryFs({
    files: over.handoff === null
      ? {}
      : { [join(over.request?.runRoot ?? RUN_ROOT, "handoff.json")]: JSON.stringify(over.handoff ?? goodHandoff()) },
  });
  const deps: RunManagerDepsV1 = {
    clock: over.clock ?? createFixedClock(HOLDER_EXIT),
    fs,
    spawn: over.spawn ?? trackingSpawn(() => exitingProcess()),
    git: over.git ?? matchingGit(HEAD_AFTER, { advance: true }),
    probe: over.probe ?? sequentialProbe([foundObservation(RECORDED), HOLDER_GONE]),
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? ((ms) => new Promise((resolve) => {
      setTimeout(resolve, Math.min(ms, 30));
    })),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => []),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
  };
  return executeRun(request(over.request), deps);
}

function parentlessInWindow(over: {
  runNonce?: string;
  nonceReadable?: boolean;
  creationDate?: string;
  parentPresent?: boolean;
  name?: string;
  parentName?: string;
} = {}) {
  return {
    pid: 7777,
    name: over.name ?? "node.exe",
    parentPid: 4900,
    parentPresent: over.parentPresent ?? false,
    nonceReadable: over.nonceReadable ?? true,
    ...(over.runNonce !== undefined ? { runNonce: over.runNonce } : {}),
    creationDate: over.creationDate ?? AFTER,
    ...(over.parentName !== undefined ? { parentName: over.parentName } : {}),
  };
}

function ownedHandleGone() {
  return {
    spawnOccurred: true,
    handleExited: true,
    exitSettledWithCode: true,
    identityAbsentBecauseAlreadyExited: true,
  };
}

// ---------------------------------------------------------------------------
// F1 — foreign / unreadable nonce is UNKNOWN, not "not ours"
// ---------------------------------------------------------------------------

test("F1 processRowCouldBelongToThisRun is true for a readable foreign-nonce parentless in-window row", () => {
  const row = parentlessInWindow({ nonceReadable: true, runNonce: "not-your-nonce" });
  assert.equal(processRowCouldBelongToThisRun(row, PARENTLESS_CTX), true);
  assert.equal(processRowMakesScanUndecidable(row, PARENTLESS_CTX), true);
});

test("F1 processRowCouldBelongToThisRun is true for an unreadable CommandLine-scraped foreign nonce", () => {
  const row = parentlessInWindow({ nonceReadable: false, runNonce: "AION-BOGUS" });
  assert.equal(processRowCouldBelongToThisRun(row, PARENTLESS_CTX), true);
  assert.equal(processRowMakesScanUndecidable(row, PARENTLESS_CTX), true);
});

test("F1 executeRun withholds the writer lease for a live foreign-nonce parentless leftover", async () => {
  const killed: number[] = [];
  const leases = memoryLeases();
  const row = parentlessInWindow({ nonceReadable: true, runNonce: "not-your-nonce" });
  const result = await runWith({
    leases,
    killTree: (pid) => {
      killed.push(pid);
    },
    scanOrphans: () => [row],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-f1" } },
  });
  assert.equal(result.ok, false, result.reason);
  assert.ok(result.conjunction.failedConjuncts.includes("executorTreeIsGone"), String(result.conjunction.failedConjuncts));
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-f1"), true);
  assert.equal(killed.includes(7777), false);
});

test("F1 identity-absent and identity-present proveWriterExit agree on an unreadable foreign-nonce sighting", () => {
  const sightings = [parentlessInWindow({ nonceReadable: false, runNonce: "AION-BOGUS" })];
  const live = sightings.filter((row) => processRowCouldBelongToThisRun(row, PARENTLESS_CTX));
  const base = {
    processStillRunning: false,
    recordedLeaseKind: "PRODUCTION_WRITER" as const,
    recordedLeaseId: "lease-pw-1",
    observation: HOLDER_GONE,
    probedPid: RECORDED.pid,
    orphanScanPerformed: true,
    orphanSightings: sightings,
    liveSightings: live,
    runNonce: NONCE,
  };
  const absent = proveWriterExit({
    ...base,
    recordedIdentity: null,
    ownedHandleExit: ownedHandleGone(),
  });
  const present = proveWriterExit({
    ...base,
    recordedIdentity: RECORDED,
  });
  assert.equal(absent, null);
  assert.equal(present, null);
});

test("F1 the orphan-scan script emits a foreign-nonce parentless in-window row", () => {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "" };
    },
  });
  scanner({ runNonce: NONCE, createdNotBefore: T0, holderPid: 4812 });
  assert.match(script, /\$n -ne \$target/);
  assert.match(script, /-not \$nonceReadable/);
  assert.equal(script.includes("(-not $n -and $atOrAfterFloor"), false);
});

test("F1 liveness: foreign-nonce rows before the floor, after exit, with a live parent, or a broker name stay SCANNED", () => {
  const beforeFloor = parentlessInWindow({
    nonceReadable: true,
    runNonce: "not-your-nonce",
    creationDate: LONG_AGO,
  });
  const afterExit = parentlessInWindow({
    nonceReadable: true,
    runNonce: "not-your-nonce",
    creationDate: "2026-08-13T12:00:20.000Z",
  });
  const liveParent = parentlessInWindow({
    nonceReadable: true,
    runNonce: "not-your-nonce",
    parentPresent: true,
  });
  const brokerNamed = parentlessInWindow({
    nonceReadable: true,
    runNonce: "not-your-nonce",
    name: "svchost.exe",
  });
  assert.equal(processRowMakesScanUndecidable(beforeFloor, PARENTLESS_CTX), false);
  assert.equal(processRowMakesScanUndecidable(afterExit, PARENTLESS_CTX), false);
  assert.equal(processRowMakesScanUndecidable(liveParent, PARENTLESS_CTX), false);
  assert.equal(processRowMakesScanUndecidable(brokerNamed, PARENTLESS_CTX), false);
});

test("F1 liveness: a clean empty scan still releases the PRODUCTION_WRITER lease", async () => {
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    scanOrphans: () => [],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-clean" } },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-clean"), false);
});

// ---------------------------------------------------------------------------
// F2 — token mismatch is not a different-process proof without a later instant
// ---------------------------------------------------------------------------

test("F2 reclaim refuses a crash-window {pid, runToken} lease when the occupant only differs by token", () => {
  const held = writerLease({
    processIdentity: { pid: 4812, runToken: "nonce-run-0" },
    runId: "run-0",
    leaseId: "lease-pw-0",
    now: LONG_AGO,
  });
  const refused = reclaimStaleLease({
    existing: [held],
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 4812 },
    observedIdentity: {
      pid: 4812,
      startedAt: "2026-08-13T11:05:00.000Z",
      runToken: "scraped-other",
    },
    now: NOW,
  });
  assert.equal(refused.ok, false, refused.reason);
  assert.equal(refused.refusal, "IDENTITY_UNVERIFIABLE");
  assert.equal(refused.remaining.length, 1);
});

test("F2 executeRun does not spawn a second writer over a crash-window lease with only a token mismatch", async () => {
  const held = writerLease({
    processIdentity: { pid: 4812, runToken: "nonce-run-0" },
    runId: "run-0",
    leaseId: "lease-pw-0",
    now: LONG_AGO,
  });
  const spawn = trackingSpawn(() => exitingProcess({ pid: 5555 }));
  const result = await runWith({
    spawn,
    leases: memoryLeases([held]),
    clock: createFixedClock(NOW),
    probe: {
      observe: () => ({
        outcome: "FOUND",
        reason: "live",
        pid: 4812,
        creationDate: "2026-08-13T11:05:00.000Z",
        runNonce: "scraped-other",
      }),
    },
    request: {
      runId: "run-1",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" },
    },
  });
  assert.equal(spawn.calls, 0, result.reason);
  assert.equal(result.spawned, false);
  assert.match(result.reason, /lease refused|confirm the process is gone/);
});

test("F2 liveness: a strictly later observed instant still reclaims", () => {
  const held = writerLease({
    processIdentity: { pid: 4812, startedAt: T0, runToken: "nonce-run-0" },
    runId: "run-0",
    leaseId: "lease-pw-0",
    now: LONG_AGO,
  });
  const granted = reclaimStaleLease({
    existing: [held],
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 4812 },
    observedIdentity: {
      pid: 4812,
      startedAt: "2026-08-13T12:30:00.000Z",
      runToken: "scraped-other",
    },
    now: NOW,
  });
  assert.equal(granted.ok, true, granted.reason);
  assert.deepEqual(granted.remaining, []);
});

// ---------------------------------------------------------------------------
// F3 — crash-window adopted lease can mint a writer-exit proof
// ---------------------------------------------------------------------------

test("F3 adopted {pid, runToken} lease plus NOT_FOUND and a clean scan releases the writer", async () => {
  const held = writerLease({
    processIdentity: { pid: 4812, runToken: NONCE },
    leaseId: "lease-pw-adopt",
  });
  const leases = memoryLeases([held]);
  const result = await runWith({
    leases,
    fs: memoryFs({ dirs: [CWD, RUN_ROOT] }),
    probe: { observe: () => HOLDER_GONE },
    scanOrphans: () => [],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-adopt" } },
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-adopt"), false);
});

test("F3 adopted crash-window safety: UNAVAILABLE, FOUND, missing scan, and live leftover still withhold", async () => {
  const make = async (
    probe: ProcessObservationV1,
    scan: (() => ReturnType<NonNullable<RunManagerDepsV1["scanOrphans"]>>) | "throw",
  ) => {
    const held = writerLease({
      processIdentity: { pid: 4812, runToken: NONCE },
      leaseId: "lease-pw-adopt-s",
    });
    const leases = memoryLeases([held]);
    const result = await runWith({
      leases,
      fs: memoryFs({ dirs: [CWD, RUN_ROOT] }),
      probe: { observe: () => probe },
      scanOrphans: scan === "throw"
        ? () => {
          throw new Error("CIM down");
        }
        : scan,
      request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-adopt-s" } },
    });
    return { released: result.productionWriterLeaseReleasedByThisRun, left: leases.list().length };
  };
  assert.deepEqual(await make({ outcome: "UNAVAILABLE", reason: "denied" }, () => []), { released: false, left: 1 });
  assert.deepEqual(await make(foundObservation(RECORDED), () => []), { released: false, left: 1 });
  assert.deepEqual(await make(HOLDER_GONE, "throw"), { released: false, left: 1 });
  assert.deepEqual(await make(HOLDER_GONE, () => [parentlessInWindow({ nonceReadable: true, runNonce: "x" })]), {
    released: false,
    left: 1,
  });
});

// ---------------------------------------------------------------------------
// F4 — holdback uses the redactor's Authorization anchor
// ---------------------------------------------------------------------------

test("F4 a >MAX_TOKEN_HOLD line ending in an Authorization-class header holds the credential", () => {
  const headers = [
    "authorization:",
    "Authorization :",
    "Authorization\":",
    "proxy-authorization:",
    "PROXY-AUTHORIZATION:",
  ];
  for (const header of headers) {
    const stdout = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout, stderr: createMemoryLogSink() },
    });
    log.write("stdout", `${"P".repeat(MAX_TOKEN_HOLD + 4096)}${header}`);
    log.write("stdout", "SUPERSECRETVALUE\n");
    log.flush();
    const file = stdout.contents().toString("utf8");
    const tail = log.liveTail("stdout").toString("utf8");
    assert.equal(file.includes("SUPERSECRETVALUE"), false, header);
    assert.equal(tail.includes("SUPERSECRETVALUE"), false, header);
  }
});

test("F4 liveness: Authorization: and Bearer still hold, and ordinary long lines still emit", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  log.write("stdout", `${"P".repeat(MAX_TOKEN_HOLD + 100)}Authorization:`);
  log.write("stdout", "held-cred\n");
  log.write("stdout", `${"Q".repeat(MAX_TOKEN_HOLD + 100)}Bearer `);
  log.write("stdout", "held-bearer\n");
  log.write("stdout", `${"R".repeat(MAX_TOKEN_HOLD + 100)}ordinary-long-line\n`);
  log.flush();
  const file = stdout.contents().toString("utf8");
  assert.equal(file.includes("held-cred"), false);
  assert.equal(file.includes("held-bearer"), false);
  assert.equal(file.includes("ordinary-long-line"), true);
});

// ---------------------------------------------------------------------------
// F5 — pemOverflow never emits known key body
// ---------------------------------------------------------------------------

/** Last 64-column line sits inside the retained SECRET_TAIL_BYTES (4 KiB). */
const PEM_TAIL_SENTINEL = "TAILSECRETMATERIAL";

function overflowingPemBodyWithTailSentinel(sentinel: string): string {
  const line = `MIIEow${"K".repeat(58)}`;
  const last = `${sentinel}${"K".repeat(64 - sentinel.length)}`;
  return `${`${line}\n`.repeat(1299)}${last}\n`;
}

function assertPemTailNotEmitted(
  log: ReturnType<typeof createBoundedLog>,
  stdout: ReturnType<typeof createMemoryLogSink>,
  sentinel: string,
): void {
  const file = stdout.contents().toString("utf8");
  const tail = log.liveTail("stdout").toString("utf8");
  assert.equal(file.includes(sentinel), false, `file sink leaked retained PEM tail: ${file.slice(-240)}`);
  assert.equal(tail.includes(sentinel), false, `liveTail leaked retained PEM tail: ${tail.slice(-240)}`);
  assert.ok(log.report().stdout.droppedLiveBytes > 0);
}

test("F5 overflowing PEM with END and no trailing newline drops the body", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  const body = overflowingPemBodyWithTailSentinel(PEM_TAIL_SENTINEL);
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  log.write("stdout", "-----END RSA PRIVATE KEY-----");
  log.flush();
  assertPemTailNotEmitted(log, stdout, PEM_TAIL_SENTINEL);
});

test("F5 overflowing PEM followed by a second BEGIN drops the first key body", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  const body = overflowingPemBodyWithTailSentinel(PEM_TAIL_SENTINEL);
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  log.write("stdout", "-----BEGIN EC PRIVATE KEY-----\nsecond-body\n-----END EC PRIVATE KEY-----\n");
  log.flush();
  assertPemTailNotEmitted(log, stdout, PEM_TAIL_SENTINEL);
});

test("F5 liveness: overflowing PEM with END and a trailing newline redacts and does not leak", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  const body = overflowingPemBodyWithTailSentinel(PEM_TAIL_SENTINEL);
  log.write("stdout", `-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  log.write("stdout", "-----END RSA PRIVATE KEY-----\n");
  log.flush();
  const file = stdout.contents().toString("utf8");
  const tail = log.liveTail("stdout").toString("utf8");
  assert.equal(file.includes(PEM_TAIL_SENTINEL), false);
  assert.equal(tail.includes(PEM_TAIL_SENTINEL), false);
  assert.match(file, /\[REDACTED\]/);
  assert.match(tail, /\[REDACTED\]/);
  assert.match(file, /-----END RSA PRIVATE KEY-----/);
  assert.match(tail, /-----END RSA PRIVATE KEY-----/);
  assert.ok(log.report().stdout.droppedLiveBytes > 0);
});

// ---------------------------------------------------------------------------
// F6 — a pipe error is not a clean drain
// ---------------------------------------------------------------------------

function erroringStream(which: "stdout" | "stderr"): { handle: SpawnHandleV1; sinkStdout: ReturnType<typeof createMemoryLogSink>; sinkStderr: ReturnType<typeof createMemoryLogSink> } {
  const broken = new PassThrough();
  broken.on("error", () => undefined);
  let exited = false;
  let resolveExit: ((value: { code: number | null; signal: string | null }) => void) | null = null;
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });
  const handle: SpawnHandleV1 = {
    pid: RECORDED.pid,
    stdout: which === "stdout" ? broken : Readable.from(["ok\n"]),
    stderr: which === "stderr" ? broken : Readable.from([""]),
    kill() {
      if (!exited) {
        exited = true;
        resolveExit?.({ code: 0, signal: null });
      }
    },
    exit,
    get exited() {
      return exited;
    },
  };
  queueMicrotask(() => {
    broken.destroy(Object.assign(new Error("read EPIPE"), { code: "EPIPE" }));
  });
  queueMicrotask(() => {
    if (!exited) {
      exited = true;
      resolveExit?.({ code: 0, signal: null });
    }
  });
  return { handle, sinkStdout: createMemoryLogSink(), sinkStderr: createMemoryLogSink() };
}

test("F6 a stdout stream error mid-stream records a truncation marker on stdout.log", async () => {
  const { handle, sinkStdout, sinkStderr } = erroringStream("stdout");
  const result = await runWith({
    spawn: trackingSpawn(() => handle),
    logSinks: { stdout: sinkStdout, stderr: sinkStderr },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-out" } },
  });
  const stdoutText = sinkStdout.contents().toString("utf8");
  const stderrText = sinkStderr.contents().toString("utf8");
  assert.match(stdoutText, /\[AION_LOG_TRUNCATED dropped=unknown reason=stream-drain-timeout\]/);
  assert.equal(stderrText.includes("stream-drain-timeout"), false);
  assert.ok(result.log !== null);
});

test("F6 a stderr stream error mid-stream records the marker on stderr.log, not stdout.log", async () => {
  const { handle, sinkStdout, sinkStderr } = erroringStream("stderr");
  await runWith({
    spawn: trackingSpawn(() => handle),
    logSinks: { stdout: sinkStdout, stderr: sinkStderr },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-err" } },
  });
  const stdoutText = sinkStdout.contents().toString("utf8");
  const stderrText = sinkStderr.contents().toString("utf8");
  assert.match(stderrText, /\[AION_LOG_TRUNCATED dropped=unknown reason=stream-drain-timeout\]/);
  assert.equal(stdoutText.includes("stream-drain-timeout"), false);
});

test("F6 liveness: a clean drain writes no truncation marker", async () => {
  const stdout = createMemoryLogSink();
  const stderr = createMemoryLogSink();
  const result = await runWith({
    spawn: trackingSpawn(() => exitingProcess({ stdout: "OUT-FULL\n" })),
    logSinks: { stdout, stderr },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-clean-log" } },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(stdout.contents().toString("utf8").includes("AION_LOG_TRUNCATED"), false);
  assert.equal(stderr.contents().toString("utf8").includes("AION_LOG_TRUNCATED"), false);
});

// ---------------------------------------------------------------------------
// F7 — write-role argv must grant write permission
// ---------------------------------------------------------------------------

test("F7 claude write roles grant write permission and differ from ADVERSARIAL_REVIEW", () => {
  for (const role of ["IMPLEMENT", "REPAIR", "INTEGRATE", "DEPLOY"] as const) {
    const argv = executorArgvFor("claude", { promptPath: PROMPT, cwd: CWD, role });
    assert.ok(argv, role);
    assert.equal(argvGrantsWritePermission(argv!), true, role);
    assert.equal(argv!.includes(PROMPT), false, role);
    const review = executorArgvFor("claude", { promptPath: PROMPT, cwd: CWD, role: "ADVERSARIAL_REVIEW" });
    assert.ok(review);
    assert.notDeepEqual(argv, review, role);
    assert.equal(argvGrantsWritePermission(review!), false, role);
  }
});

test("F7 a claude write run whose argv lacks write-permission tokens fails the new conjunct", () => {
  const conjunction = evaluateSuccessConjunction({
    exitCode: 0,
    stillRunning: false,
    executor: "claude",
    output: "",
    parsed: { ok: false, handoff: null, problems: ["no handoff text"] },
    reportedWorkItemId: null,
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: null,
    gitVerdict: null,
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: false,
    declaredArtifactsInsideRunRootReason: "none",
    executorTreeGone: true,
    executorTreeReason: "injected",
    timedOut: false,
    logStayedWithinBudget: true,
    role: "IMPLEMENT",
    argvGrantedWrite: false,
  });
  assert.equal(conjunction.ok, false);
  assert.ok(conjunction.failedConjuncts.includes("writeRoleWasGrantedWritePermission"));
});

// ---------------------------------------------------------------------------
// F8 — reviewLeftTreeUnchanged reads ignored-inclusive porcelain
// ---------------------------------------------------------------------------

test("F8 ADVERSARIAL_REVIEW that writes a git-ignored file fails the tree conjunct", async () => {
  const result = await runWith({
    git: matchingGit(HEAD_AFTER, { ignored: "!! build/evil.txt\n" }),
    handoff: goodHandoff({ headAfter: HEAD_AFTER, headBefore: HEAD_AFTER }),
    request: {
      role: "ADVERSARIAL_REVIEW",
      argv: grokReviewArgv(),
    },
  });
  assert.equal(result.ok, false, result.reason);
  assert.ok(
    result.conjunction.failedConjuncts.includes("reviewLeftTreeUnchanged"),
    String(result.conjunction.failedConjuncts),
  );
});

test("F8 ADVERSARIAL_REVIEW that writes an untracked file with no handoff fails the tree conjunct", async () => {
  const result = await runWith({
    git: matchingGit(HEAD_AFTER, { ignored: "?? plain.txt\n" }),
    handoff: null,
    request: {
      role: "ADVERSARIAL_REVIEW",
      argv: grokReviewArgv(),
    },
  });
  assert.equal(result.ok, false, result.reason);
  assert.ok(
    result.conjunction.failedConjuncts.includes("reviewLeftTreeUnchanged"),
    String(result.conjunction.failedConjuncts),
  );
});

test("F8 liveness: a review that writes nothing still passes", async () => {
  const result = await runWith({
    git: matchingGit(HEAD_AFTER),
    request: {
      role: "INDEPENDENT_ACCEPTANCE",
      argv: grokReviewArgv(),
    },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.conjunction.failedConjuncts.includes("reviewLeftTreeUnchanged"), false);
});

// ---------------------------------------------------------------------------
// F9 — SystemRoot-absolute powershell and taskkill
// ---------------------------------------------------------------------------

test("F9 resolveWindowsSystemExecutable returns a SystemRoot-anchored path and is not a basename", () => {
  const root = process.env.SystemRoot ?? process.env.WINDIR;
  assert.ok(root && root.length > 0);
  const powershell = resolveWindowsSystemExecutable("powershell.exe");
  const taskkill = resolveWindowsSystemExecutable("taskkill.exe");
  assert.notEqual(powershell, "powershell.exe");
  assert.notEqual(taskkill, "taskkill.exe");
  assert.ok(powershell.toLowerCase().startsWith(root.toLowerCase()));
  assert.ok(taskkill.toLowerCase().startsWith(root.toLowerCase()));
  assert.match(powershell, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.match(taskkill, /System32\\taskkill\.exe$/i);
});

test("F9 taskkillConfirmedStopped is false for a non-zero or error spawnSync result", () => {
  assert.equal(taskkillConfirmedStopped({ status: 0 }), true);
  assert.equal(taskkillConfirmedStopped({ status: 1 }), false);
  assert.equal(taskkillConfirmedStopped({ status: null }), false);
  assert.equal(taskkillConfirmedStopped({ status: 0, error: new Error("access denied") }), false);
});

test("F9 no src spawn/spawnSync call site passes a bare powershell.exe or taskkill.exe", () => {
  // Compiled tests live in dist-test/test/; TypeScript src/ is two levels up.
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
  assert.ok(existsSync(srcRoot), `TypeScript src/ is missing at ${srcRoot}`);
  const files = readdirSync(srcRoot).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length >= 15, `src scan was vacuous: ${files.length} .ts files under ${srcRoot}`);
  assert.ok(files.includes("process-identity.ts"), `process-identity.ts not among ${files.join(",")}`);
  const identity = readFileSync(join(srcRoot, "process-identity.ts"), "utf8");
  assert.match(identity, /resolveWindowsSystemExecutable\(/);
  const bare = /spawn(?:Sync)?\(\s*["'](?:powershell|taskkill)\.exe["']/;
  const hits: string[] = [];
  for (const name of files) {
    const text = readFileSync(join(srcRoot, name), "utf8");
    if (bare.test(text)) hits.push(name);
  }
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------
// F10 — childEnvKeys is the delivered environment
// ---------------------------------------------------------------------------

test("F10 recorded childEnvKeys equals the env object handed to the child", async () => {
  const prev = process.env.AION_PROBE_SECRET;
  process.env.AION_PROBE_SECRET = "PLAIN-SENTINEL-VALUE-r17";
  try {
    const spawn = trackingSpawn(() => exitingProcess());
    const result = await runWith({
      spawn,
      request: {
        childEnv: { AION_HANDOFF_JSON: "{}" },
      },
    });
    assert.ok(result.intent, result.reason);
    const recorded = new Set(result.intent!.childEnvKeys ?? []);
    const delivered = new Set(Object.keys(spawn.lastEnv ?? {}));
    assert.deepEqual([...recorded].sort(), [...delivered].sort());
    assert.equal(recorded.has("AION_PROBE_SECRET"), true);
    assert.equal(spawn.lastEnv?.AION_PROBE_SECRET, "PLAIN-SENTINEL-VALUE-r17");
  } finally {
    if (prev === undefined) delete process.env.AION_PROBE_SECRET;
    else process.env.AION_PROBE_SECRET = prev;
  }
});

test("F10 createNodeSpawner does not add process.env keys that were absent from options.env", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r17-env-"));
  const prev = process.env.AION_PROBE_SECRET;
  process.env.AION_PROBE_SECRET = "PLAIN-SENTINEL-VALUE-r17";
  try {
    const argv = ["-e", "process.stdout.write(process.env.AION_PROBE_SECRET === undefined ? 'absent' : 'present')"];
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
      runNonce: "nonce-env",
      now: NOW,
    });
    assert.equal(persisted.ok, true);
    if (!persisted.ok) return;
    const spawn = createNodeSpawner();
    const child = spawn(
      process.execPath,
      argv,
      { cwd: dir, env: { AION_RUN_NONCE: "nonce-env" }, shell: false, windowsHide: true },
      persisted.permit,
    );
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    const ended = await child.exit;
    assert.equal(ended.code, 0);
    assert.equal(out, "absent");
  } finally {
    if (prev === undefined) delete process.env.AION_PROBE_SECRET;
    else process.env.AION_PROBE_SECRET = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Hygiene — DMTF offset range
// ---------------------------------------------------------------------------

test("hygiene DMTF UTC offsets greater than 720 minutes are not placeable", () => {
  assert.equal(normalisedCreationDate("20260813120001.000000+999"), null);
  assert.equal(normalisedCreationDate("20260813120001.000000+720"), "2026-08-13T00:00:01.000Z");
});
