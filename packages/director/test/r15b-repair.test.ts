/**
 * Round 15b (D2 repair). F10: a readable PEB without this run's nonce is a
 * fact, not UNKNOWN. F11: an undecidable row may force UNAVAILABLE only if
 * it is still there on a later snapshot. Each new test below must fail
 * against the unmodified predicates at 26ffdf4.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createFixedClock } from "../src/bounded-log.js";
import { GROK_MAX_TURNS } from "../src/executor-adapters.js";
import { GIT_OBSERVATION_SCHEMA_V1, type GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import type { LeaseV1 } from "../src/leases.js";
import {
  BROKER_HOST_PROCESS_NAMES,
  createWindowsOrphanScanner,
  interpretWindowsOrphanScanOutput,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  type ProcessRowPlausibilityContextV1,
} from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import {
  executeRun,
  writerSightingNotProvenAbsent,
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
const FLOOR = "2026-08-13T12:00:00.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: "C:\\Tools\\claude.exe",
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited" };

/** R14 F2 / R15 F2 hostile row. Unreadable PEB, parentless, in-window. */
const DETACHED_GRANDCHILD = {
  pid: 7777,
  name: "node.exe",
  creationDate: "2026-08-13T12:00:05.0000000Z",
  parentPid: 6666,
  nonceReadable: false,
  parentPresent: false,
};

/** Owner-measured F10 shape: PEB was read, no nonce, parent already gone. */
const READABLE_PARENTLESS_CMD = {
  pid: 88912,
  name: "cmd.exe",
  creationDate: "2026-08-13T12:00:05.0000000Z",
  parentPid: 1,
  nonceReadable: true,
  runNonce: null,
  parentPresent: false,
  parentName: null,
};

/** Owner-measured F11 shape: broker-parented console host, PEB unreadable. */
const OPEN_CONSOLE = {
  pid: 6124,
  name: "OpenConsole.exe",
  creationDate: "2026-08-13T12:00:05.0000000Z",
  parentPid: 1612,
  nonceReadable: false,
  runNonce: null,
  parentPresent: true,
  parentName: "svchost.exe",
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

function matchingGit(head = HEAD_AFTER, opts: { readonly advance?: boolean } = {}): GitRunner {
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
      if (key === "status --porcelain" || key === "status --porcelain --ignored") return gitResult(argv, { stdout: "" });
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
    wait?: (ms: number) => Promise<void>;
    handoff?: Record<string, unknown> | null;
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
    clock: over.clock ?? createFixedClock(AFTER),
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
    wait: over.wait ?? (async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => []),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  };
  return executeRun(request(over.request), deps);
}

function plausibility(over: Partial<ProcessRowPlausibilityContextV1> = {}): ProcessRowPlausibilityContextV1 {
  return {
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }],
    ...over,
  };
}

function cimOk(processes: readonly unknown[]): string {
  return JSON.stringify({ ok: true, unreadable: 0, processes });
}

function interpretRows(processes: readonly unknown[]) {
  return interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: cimOk(processes),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [4812],
    holderExitedAt: HOLDER_EXIT,
  });
}

function sequentialHost(envelopes: readonly string[], waits: number[]) {
  let index = 0;
  const host = {
    waitSync(ms: number) {
      waits.push(ms);
    },
    spawnSync() {
      const stdout = envelopes[Math.min(index, envelopes.length - 1)] ?? cimOk([]);
      index += 1;
      return { status: 0, stdout, stderr: "" };
    },
  };
  return { host, spawned: () => index };
}

function scanQuery() {
  return {
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
  };
}

// ---------------------------------------------------------------------------
// F10 — readable PEB without this run's nonce is a fact
// ---------------------------------------------------------------------------

test("F10 readable parentless in-window row is undecidable, not proven absent", () => {
  // R16 F6: a readable PEB without the nonce is UNKNOWN, not "not ours".
  // The previous assertion (couldBelong=false, SCANNED) treated an
  // executor-controllable negative as a positive fact about absence.
  const hostNoise = plausibility({
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }, { pid: 88912, parentPid: 1 }],
  });
  assert.equal(processRowCouldBelongToThisRun(READABLE_PARENTLESS_CMD, hostNoise), true);
  assert.equal(processRowMakesScanUndecidable(READABLE_PARENTLESS_CMD, hostNoise), true);
  assert.equal(interpretRows([READABLE_PARENTLESS_CMD]).outcome, "UNAVAILABLE");

  // Corrected rule: the same readable row whose parentPid was sampled.
  const sampled = plausibility({
    observedPids: new Set([4812, 1]),
    rows: [{ pid: 4812 }, { pid: 88912, parentPid: 1 }],
  });
  assert.equal(READABLE_PARENTLESS_CMD.nonceReadable, true);
  assert.equal(processRowCouldBelongToThisRun(READABLE_PARENTLESS_CMD, sampled), true);
  assert.equal(processRowMakesScanUndecidable(READABLE_PARENTLESS_CMD, sampled), true);
});

test("F10 the R14 F2 unreadable parentless row stays couldBelong, undecidable, UNAVAILABLE", () => {
  const ctx = plausibility({
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }, { pid: 7777, parentPid: 6666 }],
  });
  assert.equal(processRowCouldBelongToThisRun(DETACHED_GRANDCHILD, ctx), true);
  assert.equal(processRowMakesScanUndecidable(DETACHED_GRANDCHILD, ctx), true);
  assert.equal(interpretRows([DETACHED_GRANDCHILD]).outcome, "UNAVAILABLE");
});

test("F10 writerSighting does not treat a readable parentless fact as this run", () => {
  type AgreementRow = {
    readonly pid: number;
    readonly name?: string;
    readonly creationDate?: string;
    readonly parentPid?: number;
    readonly nonceReadable?: boolean;
    readonly runNonce?: string | null;
    readonly parentPresent?: boolean;
    readonly parentName?: string | null;
  };
  const table: ReadonlyArray<{
    readonly label: string;
    readonly row: AgreementRow;
    readonly observedPids: ReadonlySet<number>;
    readonly extraRows?: ReadonlyArray<{ readonly pid: number; readonly parentPid?: number }>;
    readonly holderExitedAt?: string;
    readonly omitHolderExitedAt?: boolean;
  }> = [
    {
      label: "readable-parentless-unsampled",
      row: READABLE_PARENTLESS_CMD,
      observedPids: new Set([4812]),
    },
    {
      label: "readable-parentless-sampled-parent",
      row: READABLE_PARENTLESS_CMD,
      observedPids: new Set([4812, 1]),
    },
    {
      label: "unreadable-f2",
      row: DETACHED_GRANDCHILD,
      observedPids: new Set([4812]),
    },
    {
      label: "readable-after-exit",
      row: { ...READABLE_PARENTLESS_CMD, creationDate: "2026-08-13T12:00:20.000Z" },
      observedPids: new Set([4812]),
    },
    {
      label: "readable-before-floor",
      row: { ...READABLE_PARENTLESS_CMD, creationDate: "2026-01-01T00:00:00.000Z" },
      observedPids: new Set([4812]),
    },
    {
      label: "readable-live-parent",
      row: { ...READABLE_PARENTLESS_CMD, parentPresent: true },
      observedPids: new Set([4812]),
    },
    {
      label: "readable-cancel-time-no-ceiling",
      row: READABLE_PARENTLESS_CMD,
      observedPids: new Set([4812]),
      omitHolderExitedAt: true,
    },
  ];

  for (const item of table) {
    const extra = item.extraRows ?? (
      item.row.parentPid === undefined
        ? [{ pid: item.row.pid }]
        : [{ pid: item.row.pid, parentPid: item.row.parentPid }]
    );
    const ctxForRow: ProcessRowPlausibilityContextV1 = item.omitHolderExitedAt === true
      ? {
        runNonce: NONCE,
        createdNotBefore: FLOOR,
        holderPid: 4812,
        observedPids: item.observedPids,
        rows: [{ pid: 4812 }, ...extra],
      }
      : plausibility({
        observedPids: item.observedPids,
        rows: [{ pid: 4812 }, ...extra],
        ...(item.holderExitedAt !== undefined ? { holderExitedAt: item.holderExitedAt } : {}),
      });
    const could = processRowCouldBelongToThisRun(item.row, ctxForRow);
    const sighting = {
      pid: item.row.pid,
      ...(item.row.name !== undefined ? { name: item.row.name } : {}),
      ...(item.row.creationDate !== undefined ? { creationDate: item.row.creationDate } : {}),
      ...(item.row.parentPid !== undefined ? { parentPid: item.row.parentPid } : {}),
      ...(item.row.nonceReadable !== undefined ? { nonceReadable: item.row.nonceReadable } : {}),
      ...(item.row.parentPresent !== undefined ? { parentPresent: item.row.parentPresent } : {}),
      ...(item.row.parentName !== undefined && item.row.parentName !== null
        ? { parentName: item.row.parentName }
        : {}),
      ...(item.row.runNonce !== undefined && item.row.runNonce !== null
        ? { runNonce: item.row.runNonce }
        : {}),
    };
    const notAbsent = writerSightingNotProvenAbsent(sighting, NONCE, {
      holderPid: 4812,
      rows: ctxForRow.rows,
      createdNotBefore: FLOOR,
      ...(ctxForRow.holderExitedAt !== undefined ? { holderExitedAt: ctxForRow.holderExitedAt } : {}),
      observedPids: ctxForRow.observedPids,
    });
    assert.equal(
      could && !notAbsent,
      false,
      `${item.label}: couldBelong=${could} notProvenAbsent=${notAbsent}`,
    );
    assert.equal(
      !could && notAbsent,
      false,
      `${item.label}: couldBelong=${could} notProvenAbsent=${notAbsent}`,
    );
  }
});

// ---------------------------------------------------------------------------
// F11 — undecidable only if the occupant is still there
// ---------------------------------------------------------------------------

test("F11 a transient OpenConsole row is gone on the re-scan so the scanner returns empty", () => {
  const waits: number[] = [];
  const { host, spawned } = sequentialHost([cimOk([OPEN_CONSOLE]), cimOk([])], waits);
  const scanner = createWindowsOrphanScanner(host);
  const hits = scanner(scanQuery());
  assert.deepEqual(hits, []);
  assert.ok(spawned() >= 2, `expected a re-scan, spawned=${spawned()}`);
  assert.ok(waits.length >= 1, `expected a bounded wait, waits=${waits.length}`);
});

test("F11 the F2 hostile row that persists across re-scans stays UNAVAILABLE", () => {
  const waits: number[] = [];
  const { host, spawned } = sequentialHost([
    cimOk([DETACHED_GRANDCHILD]),
    cimOk([DETACHED_GRANDCHILD]),
    cimOk([DETACHED_GRANDCHILD]),
  ], waits);
  const scanner = createWindowsOrphanScanner(host);
  assert.throws(() => scanner(scanQuery()), /undecidable|unavailable/i);
  assert.ok(spawned() >= 2, `persistence must re-scan; spawned=${spawned()}`);
  assert.ok(waits.length >= 1, `persistence must wait; waits=${waits.length}`);
});

test("F11 the same F2 row that is gone on the re-scan is not a live process", () => {
  const waits: number[] = [];
  const { host, spawned } = sequentialHost([cimOk([DETACHED_GRANDCHILD]), cimOk([])], waits);
  const scanner = createWindowsOrphanScanner(host);
  const hits = scanner(scanQuery());
  assert.deepEqual(hits, []);
  assert.ok(spawned() >= 2, `expected a re-scan, spawned=${spawned()}`);
});

test("F11 a re-scan hard failure stays UNAVAILABLE", () => {
  const waits: number[] = [];
  let index = 0;
  const host = {
    waitSync(ms: number) {
      waits.push(ms);
    },
    spawnSync() {
      index += 1;
      if (index === 1) {
        return { status: 0, stdout: cimOk([OPEN_CONSOLE]), stderr: "" };
      }
      return { status: 1, stdout: "{\"ok\":false,\"reason\":\"cim-error\"}", stderr: "" };
    },
  };
  const scanner = createWindowsOrphanScanner(host);
  assert.throws(() => scanner(scanQuery()), /unavailable/i);
  assert.equal(index, 2);
  assert.ok(waits.length >= 1);
});

test("F11 a leftover that respawns under a new pid stays UNAVAILABLE", () => {
  const waits: number[] = [];
  const envelopes = [101, 102, 103].map((pid) => cimOk([{ ...OPEN_CONSOLE, pid }]));
  const { host, spawned } = sequentialHost(envelopes, waits);
  const scanner = createWindowsOrphanScanner(host);
  assert.throws(() => scanner(scanQuery()), /undecidable|unavailable/i);
  assert.ok(spawned() >= 2, `respawn must consume the budget; spawned=${spawned()}`);
  assert.ok(waits.length >= 1);
});

test("F11 executeRun with a persisting F2 row withholds the PRODUCTION_WRITER lease", async () => {
  const waits: number[] = [];
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    wait: async (ms) => {
      waits.push(ms);
    },
    scanOrphans: () => [DETACHED_GRANDCHILD],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-f11" } },
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-f11"), true);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.ok(tree);
  assert.match(
    tree.reason,
    /not performed|undecidable|unavailable/i,
    `tree reason must stay the UNAVAILABLE scan: ${tree.reason}`,
  );
  assert.ok(
    waits.includes(300),
    `collectWriterOrphans must persist via the 300ms confirm delay; waits=${waits.join(",")}`,
  );
});

test("F11 executeRun with the production scanner still withholds a persisting F2 row", async () => {
  const waits: number[] = [];
  const { host, spawned } = sequentialHost([
    cimOk([DETACHED_GRANDCHILD]),
    cimOk([DETACHED_GRANDCHILD]),
    cimOk([DETACHED_GRANDCHILD]),
  ], waits);
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    scanOrphans: createWindowsOrphanScanner(host),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-f11-scan" } },
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-f11-scan"), true);
  assert.ok(spawned() >= 2, `scanner persistence must re-scan; spawned=${spawned()}`);
  assert.ok(waits.length >= 1);
});

// ---------------------------------------------------------------------------
// F1 must not regress: nonce-bearing / in-chain leftovers stay ours
// ---------------------------------------------------------------------------

test("F1 executeRun with a broker-named nonce-bearing leftover still withholds the lease", async () => {
  const killed: number[] = [];
  const leases = memoryLeases();
  const leftover = {
    pid: 12080,
    name: BROKER_HOST_PROCESS_NAMES[0],
    parentPid: 4812,
    parentPresent: true,
    nonceReadable: true,
    runNonce: NONCE,
    creationDate: AFTER,
  };
  const result = await runWith({
    leases,
    killTree: (pid) => {
      killed.push(pid);
    },
    scanOrphans: () => [leftover],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-f1b" } },
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-f1b"), true);
  assert.equal(killed.includes(12080), true);
});
