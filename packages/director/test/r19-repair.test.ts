/**
 * Round 19 class repairs. Each case below must fail on 11968c84 and pass
 * after the matching class fix. Helpers are local.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
  redactLogText,
} from "../src/bounded-log.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import { ownerGateFromExecutorRefusal } from "../src/gates.js";
import { createNodeLeaseStore } from "../src/lease-store.js";
import {
  acquireLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  BROKER_HOST_PROCESS_NAMES,
  createWindowsOrphanScanner,
  interpretWindowsOrphanScanOutput,
  orphanRowIsKillable,
  OrphanScanUnavailableError,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  type ProcessRowPlausibilityContextV1,
  writerOrphanScanResult,
} from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import {
  executeRun,
  recoverAbandonedRun,
  writerSightingNotProvenAbsent,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";
import type { GitRunner } from "../src/git-truth.js";

const NOW = "2026-08-13T12:00:00.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const CLAUDE_EXE = "C:\\Tools\\claude.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const FLOOR = "2026-08-13T12:00:00.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";
const AFTER = "2026-08-13T12:00:05.000Z";
const AFTER_CEILING = "2026-08-13T12:00:20.000Z";
const BOOT = "2026-08-01T00:00:00.000Z";
const SECRET = "SUPERSECRETVALUE";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: CLAUDE_EXE,
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited", pid: 4812 };

const CLASS1_ROW = {
  pid: 9911,
  runNonce: null,
  nonceReadable: true,
  parentPid: 7777,
  parentPresent: false,
  creationDate: AFTER_CEILING,
};

function claudeImplementerArgv(): string[] {
  return ["-p", "--permission-mode", "bypassPermissions"];
}

function matchingDiscovery(): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe",
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

function matchingGit(head = HEAD_AFTER, opts: { readonly advance?: boolean } = {}): GitRunner {
  let revParses = 0;
  return {
    inspectedWorktree: CWD,
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
      if (key === "status --porcelain" || key === "status --porcelain --ignored") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
      }
      if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
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

function exitingProcess(opts: { exitCode?: number; pid?: number; stdout?: Readable } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: opts.stdout ?? Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: null }),
    get exited() {
      return true;
    },
  };
}

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 & { calls: number } {
  const spawnFn = ((_exe, _argv, _options, permit) => {
    requireSpawnPermit(permit);
    spawnFn.calls += 1;
    return factory();
  }) as SpawnFnV1 & { calls: number };
  spawnFn.calls = 0;
  return spawnFn;
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

function recordedIntent(over: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    schema: "aion.director.run-intent.v1",
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: CLAUDE_EXE,
    argv: claudeImplementerArgv(),
    cwd: CWD,
    runNonce: NONCE,
    intendedAt: NOW,
    spawnAttemptedAt: T0,
    spawnPid: 4812,
    spawnObservedAt: T0,
    processIdentity: RECORDED,
    secretsPresent: false,
    role: "IMPLEMENT",
    ...over,
  }, null, 2)}\n`;
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  scanOrphans?: NonNullable<RunManagerDepsV1["scanOrphans"]>;
  sampleAncestry?: NonNullable<RunManagerDepsV1["sampleAncestry"]>;
  killTree?: (pid: number) => void;
  clock?: RunManagerDepsV1["clock"];
  wait?: (ms: number) => Promise<void>;
  probe?: RunManagerDepsV1["probe"];
  git?: GitRunner;
  handoff?: Record<string, unknown> | null;
  logSinks?: RunManagerDepsV1["logSinks"];
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs();
  const handoffText = over.handoff === null
    ? null
    : JSON.stringify(over.handoff ?? goodHandoff());
  if ("files" in fs && fs.files instanceof Map) fs.files.delete(handoffPath);
  const innerSpawn = over.spawn ?? trackingSpawn(() => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    if (handoffText !== null) {
      try {
        fs.writeDurable(handoffPath, handoffText);
      } catch {
        // spawn still proceeds; conjunction records a missing handoff
      }
    }
    return innerSpawn(executable, argv, options, permit);
  };
  return executeRun(request({
    ...over.request,
    childEnv: {
      AION_HANDOFF_JSON: handoffText ?? "",
      ...(over.request?.childEnv ?? {}),
    },
  }), {
    clock: over.clock ?? createFixedClock(HOLDER_EXIT),
    fs,
    spawn,
    git: over.git ?? matchingGit(HEAD_AFTER, { advance: true }),
    probe: over.probe ?? { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? (async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
    ...(over.sampleAncestry !== undefined ? { sampleAncestry: over.sampleAncestry } : {}),
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
  });
}

function class1Ctx(): ProcessRowPlausibilityContextV1 {
  return plausibility({
    rows: [{ pid: 4812 }, { pid: 9911, parentPid: 7777 }],
  });
}

// ---------------------------------------------------------------------------
// CLASS 1 + 2 — parentless membership is not the closed interval
// ---------------------------------------------------------------------------

test("T1.1 parentless grandchild above the holder-exit ceiling is UNKNOWN", () => {
  const ctx = class1Ctx();
  // Base HEAD 11968c8: both false (ceiling spent as "proven absent").
  assert.equal(processRowMakesScanUndecidable(CLASS1_ROW, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(CLASS1_ROW, ctx), true);
});

test("T1.2 executeRun withholds the writer lease for the above-ceiling parentless grandchild", async () => {
  const leases = memoryLeases();
  const killed: number[] = [];
  const result = await runWith({
    leases,
    killTree: (pid) => {
      killed.push(pid);
    },
    scanOrphans: () => writerOrphanScanResult([CLASS1_ROW as never]),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-t12" } },
  });
  // Base HEAD released the lease and set executorTreeIsGone.ok = true.
  assert.equal(result.ok, false, result.reason);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false, tree?.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-t12"), true);
  assert.equal(killed.includes(9911), false);
});

test("T1.3 a live temporally-capable services.exe parent is host noise", () => {
  const row = {
    pid: 104604,
    name: "sppsvc.exe",
    parentPid: 1420,
    parentPresent: true,
    parentName: "services.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER,
    runNonce: null,
    nonceReadable: true,
  };
  const ctx = plausibility({
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 1420, creationDate: BOOT },
      { pid: 104604, parentPid: 1420, creationDate: AFTER },
    ],
  });
  // A live services.exe parent is not a negative fact (R23 R7).
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
});

test("T1.4 production scanner on a 0ms window reaches SCANNED", { timeout: 60_000 }, () => {
  const scanner = createWindowsOrphanScanner();
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const floor = new Date().toISOString();
    const nonce = `nonce-r19-t14-0-${process.pid}-${Date.now()}-${attempt}`;
    try {
      const rows = scanner({
        runNonce: nonce,
        createdNotBefore: floor,
        holderPid: process.pid,
        holderExitedAt: new Date().toISOString(),
      });
      assert.ok(Array.isArray(rows.snapshot));
      assert.ok(Array.isArray(rows.killable));
      return;
    } catch (error) {
      lastError = error;
    }
  }
  assert.fail(`0ms window stayed UNAVAILABLE: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
});

test("T1.4 30s and 300s lookback: live capable host parents are not undecidable", { timeout: 180_000 }, () => {
  for (const lookbackMs of [30_000, 300_000]) {
    let lastStdout = "";
    const capture = createWindowsOrphanScanner({
      spawnSync: (cmd, args, opts) => {
        const result = spawnSync(cmd, args, opts);
        lastStdout = String(result.stdout ?? "");
        return result;
      },
      waitSync: () => undefined,
    });
    const floor = new Date(Date.now() - lookbackMs).toISOString();
    const ceiling = new Date().toISOString();
    const nonce = `nonce-r19-t14-${process.pid}-${lookbackMs}-${Date.now()}`;
    try {
      capture({
        runNonce: nonce,
        createdNotBefore: floor,
        holderPid: process.pid,
        holderExitedAt: ceiling,
      });
    } catch {
      // CLASS 1 parentless rows (Git sleep.exe on this host) correctly throw.
    }
    let parsed: { processes?: readonly Record<string, unknown>[]; directorSessionId?: unknown } = {};
    try {
      parsed = JSON.parse(lastStdout) as {
        processes?: readonly Record<string, unknown>[];
        directorSessionId?: unknown;
      };
    } catch {
      parsed = {};
    }
    const procs = parsed.processes ?? [];
    assert.ok(procs.length >= 0);
    const directorSessionId = typeof parsed.directorSessionId === "number" ? parsed.directorSessionId : undefined;
    const ctx = {
      runNonce: nonce,
      createdNotBefore: floor,
      holderPid: process.pid,
      holderExitedAt: ceiling,
      observedPids: new Set([process.pid]),
      rows: procs as { pid: number; parentPid?: number; creationDate?: string }[],
      ...(directorSessionId !== undefined ? { directorSessionId } : {}),
    };
    const class2Blockers = procs.filter((row) => {
      if (row.parentPresent !== true) return false;
      const parentName = typeof row.parentName === "string" ? row.parentName : "";
      if (parentName !== "" && BROKER_HOST_PROCESS_NAMES.some((n) => n.toLowerCase() === parentName.toLowerCase())) {
        return false;
      }
      return processRowMakesScanUndecidable(row, ctx);
    });
    // R23 R7: a live non-broker parent is not a negative fact. CLASS 2
    // rows may be undecidable. Do not require the list to be empty.
    const interpreted = interpretWindowsOrphanScanOutput({
      status: 0,
      stdout: lastStdout,
      stderr: "",
      createdNotBefore: floor,
      runNonce: nonce,
      holderPid: process.pid,
      holderExitedAt: ceiling,
    });
    if (interpreted.outcome === "SCANNED") {
      continue;
    }
    assert.equal(interpreted.outcome, "UNAVAILABLE", `${lookbackMs}ms: ${interpreted.reason}`);
    const blockers = procs.filter((row) => processRowMakesScanUndecidable(row, ctx));
    assert.ok(blockers.length > 0, `${lookbackMs}ms UNAVAILABLE with no undecidable rows`);
    for (const row of blockers) {
      const parentName = typeof row.parentName === "string" ? row.parentName : "";
      const broker = parentName !== ""
        && BROKER_HOST_PROCESS_NAMES.some((n) => n.toLowerCase() === parentName.toLowerCase());
      assert.ok(
        row.parentPresent === false || broker || row.parentPresent === true,
        `${lookbackMs}ms unexpected blocker pid ${String(row.pid)} parentPresent=${String(row.parentPresent)} parent=${parentName}`,
      );
    }
  }
});

test("T1.4 session-0 broker-parented row still ties when the Director is interactive", () => {
  const row = {
    pid: 96636,
    name: "RuntimeBroker.exe",
    parentPid: 1612,
    parentPresent: true,
    parentName: "dllhost.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER,
    nonceReadable: true,
    runNonce: null,
    sessionId: 0,
  };
  const without = plausibility({
    rows: [{ pid: 4812 }, { pid: 1612, creationDate: BOOT }, { pid: 96636, parentPid: 1612 }],
  });
  const withSession = plausibility({
    directorSessionId: 1,
    rows: [{ pid: 4812 }, { pid: 1612, creationDate: BOOT }, { pid: 96636, parentPid: 1612 }],
  });
  // Broker path ties this row. Session 0 is a negative heuristic and
  // must not delete a positive broker tie — those hosts live in session 0.
  assert.equal(processRowCouldBelongToThisRun(row, without), true);
  assert.equal(processRowMakesScanUndecidable(row, without), true);
  assert.equal(processRowCouldBelongToThisRun(row, withSession), true);
  assert.equal(processRowMakesScanUndecidable(row, withSession), true);
});

test("T1.5 live explorer.exe parent inside the holder-alive window stays undecidable", () => {
  assert.equal(
    BROKER_HOST_PROCESS_NAMES.some((name) => name.toLowerCase() === "explorer.exe"),
    true,
  );
  const row = {
    pid: 9002,
    name: "wscript.exe",
    parentPid: 51876,
    parentPresent: true,
    parentName: "explorer.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER,
    nonceReadable: true,
    runNonce: null,
  };
  const ctx = plausibility({
    rows: [{ pid: 4812 }, { pid: 9002, parentPid: 51876 }],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
});

test("T1.6 a settled child.exited path still invokes the ancestry sampler", async () => {
  const samples: number[] = [];
  await runWith({
    spawn: trackingSpawn(() => exitingProcess()),
    sampleAncestry: ({ holderPid }) => {
      samples.push(holderPid);
      return [];
    },
  });
  // Base HEAD skipped sampleAncestryWhileChildAlive when exitWon was true.
  assert.ok(samples.length > 0, `sampler invoked ${samples.length} times`);
});

// ---------------------------------------------------------------------------
// CLASS 6 — adopted-lease scan uses the lease token
// ---------------------------------------------------------------------------

test("C6 adopted lease with a mismatched invocation nonce refuses the writer proof", async () => {
  const leftover = {
    pid: 9911,
    runNonce: "OLD-NONCE",
    nonceReadable: true,
    parentPid: 7777,
    parentPresent: false,
    creationDate: AFTER_CEILING,
  };
  const held = writerLease({
    processIdentity: { pid: 4812, startedAt: T0, runToken: "OLD-NONCE" },
    leaseId: "lease-pw-c6",
  });
  const leases = memoryLeases([held]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    scanOrphans: () => writerOrphanScanResult([leftover as never]),
    request: {
      runNonce: "NEW-NONCE",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-c6" },
    },
  });
  // Base HEAD scanned with NEW-NONCE. The leftover carries OLD-NONCE and
  // sits above the recovery ceiling, so it was treated as absence and the
  // lease was released while that process was still alive.
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-c6"), true);
});

test("C6 a nonce mismatch refuses even when the scan is empty", async () => {
  const held = writerLease({
    processIdentity: { pid: 4812, startedAt: T0, runToken: "OLD-NONCE" },
    leaseId: "lease-pw-c6b",
  });
  const leases = memoryLeases([held]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    scanOrphans: () => writerOrphanScanResult([]),
    request: {
      runNonce: "NEW-NONCE",
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-c6b" },
    },
  });
  // Base HEAD: empty scan + NOT_FOUND → released. Two spellings of the
  // nonce must become one before any scan is trusted.
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-c6b"), true);
});

test("C6 liveness: matching tokens and a clean scan still release the adopted writer", async () => {
  const held = writerLease({
    processIdentity: { pid: 4812, startedAt: T0, runToken: NONCE },
    leaseId: "lease-pw-c6-live",
  });
  const leases = memoryLeases([held]);
  const result = await runWith({
    leases,
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    scanOrphans: () => writerOrphanScanResult([]),
    request: {
      runNonce: NONCE,
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-c6-live" },
    },
  });
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true, result.reason);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-c6-live"), false);
});

// ---------------------------------------------------------------------------
// CLASS 7 — holdback is at least as wide as redactLogText
// ---------------------------------------------------------------------------

const BEARER_WS: readonly { readonly label: string; readonly ws: string }[] = [
  { label: "LF", ws: "\n" },
  { label: "TAB", ws: "\t" },
  { label: "VT", ws: "\u000B" },
  { label: "FF", ws: "\u000C" },
  { label: "CR", ws: "\r" },
  { label: "NBSP", ws: "\u00A0" },
  { label: "OGHAM", ws: "\u1680" },
  { label: "ENQUAD", ws: "\u2000" },
  { label: "LSEP", ws: "\u2028" },
  { label: "IDEO", ws: "\u3000" },
  { label: "TAB+SPACE", ws: "\t " },
];

async function durableStdoutForChunks(chunks: readonly string[]): Promise<string> {
  const stdout = createMemoryLogSink();
  await runWith({
    spawn: trackingSpawn(() => exitingProcess({ stdout: Readable.from([...chunks]) })),
    logSinks: { stdout, stderr: createMemoryLogSink() },
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-c7" } },
  });
  return stdout.contents().toString("utf8");
}

test("C7 executeRun does not leak a Bearer token split on any redactor whitespace", async () => {
  for (const item of BEARER_WS) {
    const file = await durableStdoutForChunks([`Bearer${item.ws}`, `${SECRET}\n`]);
    assert.equal(file.includes(SECRET), false, `${item.label} leaked: ${JSON.stringify(file)}`);
    assert.equal(redactLogText(`Bearer${item.ws}${SECRET}`).includes(SECRET), false, item.label);
  }
});

test("C7 mid-run flush does not end the Bearer hold", async () => {
  for (const item of BEARER_WS) {
    const stdout = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout, stderr: createMemoryLogSink() },
    });
    log.write("stdout", `Bearer${item.ws}`);
    log.flush();
    log.write("stdout", `${SECRET}\n`);
    log.flush();
    const file = stdout.contents().toString("utf8");
    assert.equal(file.includes(SECRET), false, `${item.label} flush leaked: ${JSON.stringify(file)}`);
  }
});

test("C7 a line longer than MAX_TOKEN_HOLD ending in Bearer+whitespace still holds the token", () => {
  for (const item of BEARER_WS) {
    const stdout = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout, stderr: createMemoryLogSink() },
    });
    // Space before Bearer so the redactor lookbehind `(?<![A-Za-z-])` holds.
    log.write("stdout", `${"P".repeat(MAX_TOKEN_HOLD + 64)} Bearer${item.ws}`);
    log.write("stdout", `${SECRET}\n`);
    log.flush();
    const file = stdout.contents().toString("utf8");
    assert.equal(file.includes(SECRET), false, `${item.label} long-line leaked`);
  }
});

test("C7 executeRun >MAX_TOKEN_HOLD Bearer+TAB split does not leak", async () => {
  const file = await durableStdoutForChunks([
    `${"P".repeat(MAX_TOKEN_HOLD + 64)} Bearer\t`,
    `${SECRET}\n`,
  ]);
  assert.equal(file.includes(SECRET), false, file.slice(-80));
});

test("C7 seal emits an incomplete Bearer hold verbatim", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "Bearer ");
  log.seal();
  const file = stdout.contents().toString("utf8");
  assert.match(file, /Bearer /);
  assert.equal(file.includes("[REDACTED]"), false);
});

test("C7 a line ending in the word bearer is not lost at seal", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "the token is not a bearer");
  log.seal();
  const file = stdout.contents().toString("utf8");
  assert.match(file, /the token is not a bearer/);
});

test("C7 holdback is at least as wide as redactLogText over the same corpus", () => {
  const corpus: string[] = [];
  for (const item of BEARER_WS) {
    corpus.push(`Bearer${item.ws}${SECRET}\n`);
    corpus.push(`hello Bearer${item.ws}${SECRET}\n`);
  }
  corpus.push(`Authorization: ${SECRET}\n`);
  corpus.push(`authorization:${SECRET}\n`);
  for (const joined of corpus) {
    const redacted = redactLogText(joined);
    if (redacted === joined) continue;
    const bearerAt = joined.toLowerCase().indexOf("bearer");
    const authAt = joined.toLowerCase().indexOf("authorization");
    const anchors = [bearerAt, authAt].filter((at) => at >= 0);
    const splits = new Set<number>();
    for (const at of anchors) {
      splits.add(at + 6);
      splits.add(at + 7);
      const afterWord = at + (joined.toLowerCase().startsWith("authorization", at) ? 13 : 6);
      splits.add(afterWord);
      splits.add(afterWord + 1);
    }
    for (const split of splits) {
      if (split <= 0 || split >= joined.length) continue;
      const prefix = joined.slice(0, split);
      const suffix = joined.slice(split);
      const stdout = createMemoryLogSink();
      const log = createBoundedLog({
        clock: createFixedClock(NOW),
        sinks: { stdout, stderr: createMemoryLogSink() },
      });
      log.write("stdout", prefix);
      log.flush();
      log.write("stdout", suffix);
      log.seal();
      const file = stdout.contents().toString("utf8");
      assert.equal(
        file.includes(SECRET),
        false,
        `split@${split} of ${JSON.stringify(joined.slice(0, 24))} leaked`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// CLASS 8 — recoverAbandonedRun uses holderLiveness, not pid occupancy
// ---------------------------------------------------------------------------

test("C8 recycled pid occupant is DEAD_CONFIRMED, not still present", async () => {
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: recordedIntent() },
  });
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: {
      observe: () => ({
        outcome: "FOUND",
        reason: "live",
        pid: 4812,
        creationDate: "2026-08-14T09:00:00.000Z",
        executablePath: "C:\\Windows\\System32\\svchost.exe",
      }),
    },
  });
  // Base HEAD: "still present" because it trusted the pid slot.
  assert.match(result.reason, /DEAD_CONFIRMED|terminal result/);
  assert.equal(/still present/.test(result.reason), false, result.reason);
});

test("C8 matching identity still refuses as present", async () => {
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: recordedIntent() },
  });
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: {
      observe: () => ({
        outcome: "FOUND",
        reason: "live",
        pid: 4812,
        creationDate: T0,
        executablePath: CLAUDE_EXE,
        runNonce: NONCE,
      }),
    },
  });
  assert.match(result.reason, /still present/);
});

test("C8 UNAVAILABLE refuses as UNKNOWN", async () => {
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: recordedIntent() },
  });
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: { observe: (pid) => ({ outcome: "UNAVAILABLE", reason: "denied", pid }) },
  });
  assert.match(result.reason, /UNKNOWN/);
});

test("C8 spawnPid null with a usable processIdentity.pid still probes", async () => {
  const probed: number[] = [];
  const fs = memoryFs({
    files: {
      [join(RUN_ROOT, "intent.json")]: recordedIntent({ spawnPid: null }),
    },
  });
  await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: {
      observe: (pid) => {
        probed.push(pid);
        return HOLDER_GONE;
      },
    },
  });
  // Base HEAD declared terminal without observing when spawnPid was null.
  assert.deepEqual(probed, [4812]);
});

// ---------------------------------------------------------------------------
// CLASS 9 — recoverAbandonedRun does not overwrite an existing result.json
// ---------------------------------------------------------------------------

function seededCompletedRun(): RunFileSystemV1 & { files: Map<string, string> } {
  const existing = `${JSON.stringify({ ok: true, reason: "every success conjunct holds" }, null, 2)}\n`;
  return memoryFs({
    files: {
      [join(RUN_ROOT, "intent.json")]: recordedIntent(),
      [join(RUN_ROOT, "result.json")]: existing,
    },
  });
}

test("C9 recover with FOUND / UNAVAILABLE / throwing probe leaves result.json byte-identical", async () => {
  const cases: readonly { readonly label: string; readonly probe: RunManagerDepsV1["probe"] }[] = [
    {
      label: "FOUND-matching",
      probe: {
        observe: () => ({
          outcome: "FOUND",
          reason: "live",
          pid: 4812,
          creationDate: T0,
          executablePath: CLAUDE_EXE,
          runNonce: NONCE,
        }),
      },
    },
    {
      label: "UNAVAILABLE",
      probe: { observe: (pid) => ({ outcome: "UNAVAILABLE", reason: "denied", pid }) },
    },
    {
      label: "throwing",
      probe: {
        observe: () => {
          throw new Error("probe exploded");
        },
      },
    },
  ];
  for (const item of cases) {
    const fs = seededCompletedRun();
    const before = fs.readUtf8(join(RUN_ROOT, "result.json"));
    await recoverAbandonedRun(RUN_ROOT, {
      fs,
      clock: createFixedClock(NOW),
      probe: item.probe,
    });
    const after = fs.readUtf8(join(RUN_ROOT, "result.json"));
    assert.equal(after, before, item.label);
  }
});

// ---------------------------------------------------------------------------
// CLASS 3 + 4 — one scanner contract; named undecidable pids
// ---------------------------------------------------------------------------

test("C3/C4 production scanner keeps an unattributable row visible and does not make it killable", async () => {
  const scanner = createWindowsOrphanScanner({
    spawnSync: () => ({
      status: 0,
      stdout: JSON.stringify({
        ok: true,
        unreadable: 0,
        processes: [CLASS1_ROW],
        directorSessionId: 1,
      }),
      stderr: "",
    }),
    waitSync: () => undefined,
  });
  let thrown: unknown;
  try {
    scanner({
      runNonce: NONCE,
      createdNotBefore: FLOOR,
      holderPid: 4812,
      holderExitedAt: HOLDER_EXIT,
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof OrphanScanUnavailableError, String(thrown));
  assert.ok(
    thrown.undecidable.some((row) => row.pid === 9911),
    JSON.stringify(thrown.undecidable),
  );
  assert.equal(
    orphanRowIsKillable(CLASS1_ROW as never, NONCE, 4812, [CLASS1_ROW as never], FLOOR, HOLDER_EXIT),
    false,
  );

  const leases = memoryLeases();
  const result = await runWith({
    leases,
    scanOrphans: scanner,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-c34" } },
  });
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false, tree?.reason);
  // Base HEAD: "the process-tree scan was not performed" with no pid.
  assert.match(String(tree?.reason), /9911/);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-c34"), true);
});

test("C3 leftover remaining over the host snapshot uses membership, not the leftover catch-alls", async () => {
  // leftover remaining is only consulted when the later collectWriterOrphans
  // scan is SCANNED with no live sightings. The leftover after-scan still
  // holds the mixed snapshot. Membership must keep CLASS 1 (parentless
  // post-floor) and drop host noise (live capable parent outside the chain).
  // The incomplete leftover shape would keep both (null nonce / parentPresent
  // false). Judging only killable would keep neither (CLASS 3).
  const hostNoise = {
    pid: 104604,
    name: "sppsvc.exe",
    parentPid: 1420,
    parentPresent: true,
    parentName: "services.exe",
    parentCreationDate: BOOT,
    creationDate: "2026-08-13T12:00:15.000Z",
    runNonce: null,
    nonceReadable: true,
    sessionId: 0,
  };
  const mixed = [hostNoise, CLASS1_ROW];
  let scans = 0;
  const result = await runWith({
    scanOrphans: () => {
      scans += 1;
      if (scans <= 2) return writerOrphanScanResult(mixed as never, [], { directorSessionId: 1 });
      return writerOrphanScanResult([], [], { directorSessionId: 1 });
    },
  });
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false, tree?.reason);
  assert.match(String(tree?.reason), /leftover processes remain after kill/);
  assert.match(String(tree?.reason), /9911/);
  assert.equal(String(tree?.reason).includes("104604"), false, tree?.reason);
});

test("C3 production scanner snapshot includes a non-killable row the predicate sees", async () => {
  const noise = {
    pid: 104604,
    name: "sppsvc.exe",
    parentPid: 1420,
    parentPresent: true,
    parentName: "services.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER,
    nonceReadable: true,
    runNonce: "FOREIGN-NONCE",
    sessionId: 0,
  };
  const mine = {
    pid: 88002,
    name: "node.exe",
    parentPid: 4812,
    parentPresent: true,
    parentName: "node.exe",
    parentCreationDate: T0,
    nonceReadable: true,
    runNonce: NONCE,
    creationDate: AFTER,
  };
  const envelope = (processes: readonly unknown[]) => ({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0, processes, directorSessionId: 1 }),
    stderr: "",
  });
  const scannerBoth = createWindowsOrphanScanner({
    spawnSync: () => envelope([noise, mine]),
    waitSync: () => undefined,
  });
  const scanned = scannerBoth({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
  });
  assert.deepEqual(scanned.snapshot.map((row) => row.pid).sort((a, b) => a - b), [88002, 104604]);
  const expectedKillable = scanned.snapshot.filter((row) => orphanRowIsKillable(
    row,
    NONCE,
    4812,
    scanned.snapshot,
    FLOOR,
    HOLDER_EXIT,
  ));
  assert.deepEqual(scanned.killable, expectedKillable);
  assert.deepEqual(scanned.killable.map((row) => row.pid), [88002]);
  const membership = {
    holderPid: 4812,
    rows: scanned.snapshot,
    createdNotBefore: FLOOR,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    directorSessionId: 1,
  };
  assert.equal(writerSightingNotProvenAbsent(noise, NONCE, membership), false);
  assert.equal(scanned.snapshot.some((row) => row.pid === 104604), true);
  assert.equal(scanned.killable.some((row) => row.pid === 104604), false);

  const noiseOnly = createWindowsOrphanScanner({
    spawnSync: () => envelope([noise]),
    waitSync: () => undefined,
  });
  const released = await runWith({
    scanOrphans: noiseOnly,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-c3-noise" } },
  });
  assert.equal(released.productionWriterLeaseReleasedByThisRun, true, released.reason);

  const withheld = await runWith({
    scanOrphans: scannerBoth,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-c3-both" } },
  });
  assert.equal(withheld.productionWriterLeaseReleasedByThisRun, false, withheld.reason);
});

test("C5 degenerate holderExitedAt equals floor does not drop the holder-edge in PowerShell", () => {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "" };
    },
  });
  scanner({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: FLOOR,
  });
  assert.match(script, /\$ceilingUsable/);
  assert.match(script, /\$ceilingUsable -and \$chUtc/);
  assert.equal(
    script.includes("$cur -eq $holderPid -and $exitUtc -ne $null -and $chUtc -ne $null -and $chUtc -gt $exitUtc"),
    false,
  );
});

test("C10 every registry bridge refuses while PRODUCTION_WRITER is held, and runs when it is not", async () => {
  const { resolveDeveloperAgentBridges } = await import(
    pathToFileURL(fileURLToPath(new URL("../../../../apps/aion/developer-agent.mjs", import.meta.url))).href
  );
  const repositoryRoot = resolve(process.cwd());
  const stub = process.execPath;
  const heldArb = mkdtempSync(join(tmpdir(), "aion-r19b-c10-held-arb-"));
  const freeArb = mkdtempSync(join(tmpdir(), "aion-r19b-c10-free-arb-"));
  const heldRoot = mkdtempSync(join(tmpdir(), "aion-r19b-c10-held-"));
  const freeRoot = mkdtempSync(join(tmpdir(), "aion-r19b-c10-free-"));
  try {
    const held = createNodeLeaseStore(heldRoot, { hostArbitrationRoot: heldArb });
    const writer = acquireLease({
      existing: [],
      leaseId: "lease-pw-c10",
      kind: "PRODUCTION_WRITER",
      resource: "default",
      missionId: "mission-1",
      runId: "run-c10",
      now: NOW,
    });
    assert.equal(writer.ok, true, writer.reason);
    held.save([writer.lease!]);

    const refused = await resolveDeveloperAgentBridges(repositoryRoot, process.env, {
      claudeCandidates: [stub],
      codexCandidates: [stub],
      store: held,
      now: NOW,
    });
    const refusedBridges = refused.list() as ReadonlyArray<{
      readonly id: string;
      run(
        task: { repositoryRoot: string; instruction: string; mode: "read-only" },
        signal: AbortSignal,
      ): Promise<{ exitCode: number; summary: string }>;
    }>;
    assert.ok(
      refusedBridges.some((bridge) => bridge.id === "claude-code"),
      `missing claude-code in ${refusedBridges.map((bridge) => bridge.id).join(",")}`,
    );
    assert.ok(
      refusedBridges.some((bridge) => bridge.id === "codex"),
      `missing codex in ${refusedBridges.map((bridge) => bridge.id).join(",")}`,
    );
    for (const bridge of refusedBridges) {
      await assert.rejects(
        () => bridge.run(
          { repositoryRoot, instruction: "say ok", mode: "read-only" },
          new AbortController().signal,
        ),
        /developer-agent refused|PRODUCTION_WRITER/,
      );
    }

    const free = createNodeLeaseStore(freeRoot, { hostArbitrationRoot: freeArb });
    const live = await resolveDeveloperAgentBridges(repositoryRoot, process.env, {
      claudeCandidates: [stub],
      codexCandidates: [stub],
      store: free,
      now: NOW,
    });
    const first = live.list()[0];
    assert.ok(first, "liveness registry must return a spawnable bridge");
    const ran = await first.run(
      { repositoryRoot, instruction: "say ok", mode: "read-only" },
      AbortSignal.timeout(15_000),
    );
    assert.equal(typeof ran.exitCode, "number", "the bridge ran; a lease refusal would have thrown");
  } finally {
    rmSync(heldArb, { recursive: true, force: true });
    rmSync(freeArb, { recursive: true, force: true });
    rmSync(heldRoot, { recursive: true, force: true });
    rmSync(freeRoot, { recursive: true, force: true });
  }
});

test("C13 an unrecognised gate name is recorded and is not promoted to production deploy", () => {
  const gate = ownerGateFromExecutorRefusal({
    gateId: "owner-run-c13",
    missionId: "mission-1",
    at: NOW,
    requestedType: "OAUTH_REQUIRED_TYPO",
    executorSummary: "read-only review completed; nothing written to the worktree",
    headAfter: HEAD_AFTER,
    branch: "executor/oracle",
  });
  assert.equal(gate.requestedType, "OAUTH_REQUIRED_TYPO");
  assert.equal(gate.type, "UNRECOGNISED_GATE_TYPE");
  assert.notEqual(gate.type, "PRODUCTION_DEPLOY_APPROVAL_REQUIRED");
  assert.match(gate.why, /^executor testimony:/);
  assert.match(gate.directorReason, /Director/);
  assert.equal(gate.safeFrozenState.headAfter, HEAD_AFTER);
  assert.equal(gate.safeFrozenState.branch, "executor/oracle");
});

test("C13 --resolve-gate against a moved HEAD is SUPERSEDED; against an unmoved HEAD it approves", async () => {
  const { runDirectorCli } = await import(
    pathToFileURL(fileURLToPath(new URL("../../../../apps/director-cli.mjs", import.meta.url))).href
  );
  const { writeFileSync: write, mkdirSync: mkdir } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "aion-r19b-c13-"));
  const worktree = join(dir, "wt");
  const runRoot = join(dir, "run");
  mkdir(worktree);
  mkdir(runRoot);
  spawnSync("git", ["init"], { cwd: worktree, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "c13@example.test"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["config", "user.name", "c13"], { cwd: worktree, windowsHide: true });
  write(join(worktree, "seed.txt"), "seed\n");
  spawnSync("git", ["add", "seed.txt"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["commit", "-m", "seed"], { cwd: worktree, windowsHide: true });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: worktree, windowsHide: true, encoding: "utf8" }).stdout.trim();
  const branch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], {
    cwd: worktree,
    windowsHide: true,
    encoding: "utf8",
  }).stdout.trim() || "master";
  const gate = ownerGateFromExecutorRefusal({
    gateId: "owner-c13",
    missionId: "mission-1",
    at: NOW,
    requestedType: "OAUTH_REQUIRED",
    executorSummary: "need owner",
    headAfter: head,
    branch,
  });
  write(join(runRoot, "owner-gate.json"), `${JSON.stringify(gate, null, 2)}\n`);
  write(join(runRoot, "result.json"), `${JSON.stringify({
    gitAfter: { worktreePath: worktree, head: { outcome: "FOUND", sha: head }, branch: { outcome: "ATTACHED", name: branch } },
  }, null, 2)}\n`);
  try {
    const logs: string[] = [];
    const live = await runDirectorCli(
      ["--resolve-gate", runRoot, "--approved", "true"],
      { log: (m: string) => { logs.push(String(m)); }, error: () => undefined },
    );
    assert.equal(live, 0, logs.join("\n"));
    const approved = JSON.parse(readFileSync(join(runRoot, "owner-gate.json"), "utf8")) as { status: string };
    assert.equal(approved.status, "APPROVED");

    write(join(worktree, "moved.txt"), "moved\n");
    spawnSync("git", ["add", "moved.txt"], { cwd: worktree, windowsHide: true });
    spawnSync("git", ["commit", "-m", "moved"], { cwd: worktree, windowsHide: true });
    write(join(runRoot, "owner-gate.json"), `${JSON.stringify(gate, null, 2)}\n`);
    const staleLogs: string[] = [];
    const stale = await runDirectorCli(
      ["--resolve-gate", runRoot, "--approved", "true"],
      { log: (m: string) => { staleLogs.push(String(m)); }, error: () => undefined },
    );
    assert.equal(stale, 4, staleLogs.join("\n"));
    const parsed = JSON.parse(staleLogs.join("\n") || "{}") as { status?: string; staleFacts?: string[] };
    assert.equal(parsed.status, "SUPERSEDED");
    assert.ok((parsed.staleFacts ?? []).some((fact) => fact.includes("headAfter")), JSON.stringify(parsed));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C9 liveness: NOT_FOUND with no existing result.json still writes a terminal record", async () => {
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: recordedIntent() },
  });
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
  });
  assert.equal(fs.isFile(join(RUN_ROOT, "result.json")), true);
  assert.equal(result.spawned, true);
  assert.match(result.reason, /terminal result|DEAD_CONFIRMED|NOT_FOUND/);
});
