/**
 * Round 18b class repairs. Each case below must fail on 5638c55e and pass
 * after the matching class fix. Helpers are local.
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
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
} from "../src/bounded-log.js";
import {
  argvGrantsWritePermission,
  executorArgvFor,
  READ_ONLY_PERMISSION_MODE,
} from "../src/executor-adapters.js";
import type { GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import {
  acquireLease,
  canonicalResource,
  leaseHasExpired,
  reclaimStaleLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
  derivedHostArbitrationRoot,
  hostArbitrationRoot,
  prepareHostArbitrationLocks,
} from "../src/lease-store.js";
import {
  DIRECTOR_STORE_LAYOUT_V1,
  hostLockFileName,
} from "../src/store-contract.js";
import {
  createWindowsOrphanScanner,
  identityFromObservation,
  interpretWindowsOrphanScanOutput,
  isUsablePid,
  parentIsProvenCapableCreator,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  rowHasPositiveRunIdentity,
  rowIsInHolderChain,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  type ProcessRowPlausibilityContextV1,
  writerOrphanScanResult,
} from "../src/process-identity.js";
import {
  existingIntentOn,
  persistRunIntent,
  requireSpawnPermit,
} from "../src/run-intent.js";
import {
  createNodeRunFileSystem,
  EXECUTOR_TREE_GONE_REASON,
  executeRun,
  launchRun,
  recoverAbandonedRun,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LaunchRunDepsV1,
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
const FLOOR = "2026-08-13T12:00:00.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";
const AFTER = "2026-08-13T12:00:05.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: CLAUDE_EXE,
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited", pid: 4812 };

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

function matchingGit(head = HEAD_AFTER, opts: { readonly advance?: boolean; readonly inspectedWorktree?: string } = {}): GitRunner {
  let revParses = 0;
  return {
    inspectedWorktree: opts.inspectedWorktree ?? CWD,
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

function exitingProcess(opts: { exitCode?: number; pid?: number } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: null }),
    get exited() {
      return true;
    },
  };
}

function hangingProcess(pid = 4812): SpawnHandleV1 {
  return {
    pid,
    stdout: Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: new Promise(() => {}),
    get exited() {
      return false;
    },
  };
}

function trackingSpawn(
  factory: () => SpawnHandleV1,
): SpawnFnV1 & { calls: number } {
  const spawnFn = ((_exe, _argv, _options, permit) => {
    requireSpawnPermit(permit);
    spawnFn.calls += 1;
    return factory();
  }) as SpawnFnV1 & { calls: number };
  spawnFn.calls = 0;
  return spawnFn;
}

function leftoverRow(over: Record<string, unknown> = {}) {
  return {
    pid: 5000,
    name: "evil.exe",
    parentPid: 4999,
    parentPresent: false,
    // executeRun's default clock is frozen at HOLDER_EXIT, which is the
    // production spawn floor. 12:00:05 sits before it; membership cannot
    // place that row. leftover remaining used to keep it via catch-alls.
    creationDate: HOLDER_EXIT,
    nonceReadable: true,
    ...over,
  };
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

function interpretRows(rows: readonly unknown[]) {
  return interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0, processes: rows }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [4812],
    holderExitedAt: HOLDER_EXIT,
  });
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  scanOrphans?: NonNullable<RunManagerDepsV1["scanOrphans"]>;
  killTree?: (pid: number) => void;
  clock?: RunManagerDepsV1["clock"];
  wait?: (ms: number) => Promise<void>;
  probe?: RunManagerDepsV1["probe"];
  git?: GitRunner;
  handoff?: Record<string, unknown> | null;
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
    git: over.git ?? matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: over.request?.worktree ?? CWD }),
    probe: over.probe ?? { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? (async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  });
}

// ---------------------------------------------------------------------------
// CLASS 1 — basename and parent-slot occupancy are not provenance
// ---------------------------------------------------------------------------

test("C1 rename-the-leftover: six names share the UNDECIDABLE verdict and keep the writer lease", async () => {
  const names = ["evil.exe", "dllhost.exe", "svchost.exe", "WmiPrvSE.exe", "taskeng.exe", "DLLHOST.EXE"];
  const verdicts: string[] = [];
  for (const name of names) {
    const row = leftoverRow({ name });
    const interpreted = interpretRows([row]);
    verdicts.push(interpreted.outcome);
    const leases = memoryLeases();
    const result = await runWith({
      leases,
      request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-c1" } },
      scanOrphans: () => writerOrphanScanResult([row as never]),
    });
    assert.equal(result.productionWriterLeaseReleasedByThisRun, false, name);
    assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-c1"), true, name);
  }
  assert.deepEqual(verdicts, Array(6).fill("UNAVAILABLE"));
});

test("C1 ShellExecute explorer parent is UNDECIDABLE and retains the writer lease", async () => {
  const row = leftoverRow({
    pid: 9002,
    name: "wscript.exe",
    parentPid: 51876,
    parentPresent: true,
    parentName: "explorer.exe",
  });
  const ctx = plausibility({ rows: [{ pid: 4812 }, { pid: 9002, parentPid: 51876 }] });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
  assert.equal(interpretRows([row]).outcome, "UNAVAILABLE");
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-shell" } },
    scanOrphans: () => writerOrphanScanResult([row as never]),
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false);
});

test("C1 a proven-capable live parent still excludes the ordinary child", () => {
  const row = leftoverRow({
    pid: 5001,
    name: "node.exe",
    parentPid: 4812,
    parentPresent: true,
    parentName: "claude.exe",
    parentCreationDate: T0,
    creationDate: AFTER,
  });
  const ctx = plausibility({
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 5001, parentPid: 4812, creationDate: AFTER },
    ],
  });
  // The holder itself is a capable parent (not only its descendants).
  // That excludes the parentless branch. The same row is still ours
  // via the holder chain — do not assert both rules as one verdict.
  assert.equal(parentIsProvenCapableCreator(row, ctx), true);
  assert.equal(parentlessRowTiedToThisRun(row, ctx), false);
  assert.equal(rowIsInHolderChain(row, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), false);
  assert.equal(interpretRows([row]).outcome, "SCANNED");
});

test("C1 generated orphan-scan script no longer continues on $isSelfBroker", () => {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "" };
    },
  });
  scanner({ runNonce: NONCE, createdNotBefore: FLOOR, holderPid: 4812, holderExitedAt: HOLDER_EXIT });
  assert.equal(/\$isSelfBroker[\s\S]{0,120}continue/.test(script), false);
  assert.match(script, /parentCreationDate/);
  assert.match(script, /holderExitedAt|exitUtc|exitQuoted/);
  assert.match(script, /\$parentProvenCapable/);
  assert.match(script, /\$emit = \$isDesc -or \(\(-not \$provenBeforeFloor\) -and -not \$parentProvenCapable\)/);
  assert.match(script, /\$needsPeb = -not \[bool\]\$c\.isDesc/);
  assert.doesNotMatch(script, /if \(\$pebCapped\) \{ \$unreadable = \[Math\]::Max/);
});

test("C1 liveness: a clean PRODUCTION_WRITER run still releases the lease", async () => {
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-live" } },
    scanOrphans: () => writerOrphanScanResult([]),
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.conjunction.findings.length, 15);
  assert.deepEqual(result.conjunction.failedConjuncts, []);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
  assert.deepEqual(leases.list(), []);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.reason, EXECUTOR_TREE_GONE_REASON);
});

// ---------------------------------------------------------------------------
// CLASS 2 — a PID slot is not identity and must not authorise taskkill
// ---------------------------------------------------------------------------

test("C2 reused holder slot after exit is not in the chain and is not killed", async () => {
  const row = {
    pid: 5000,
    name: "chrome.exe",
    parentPid: 4812,
    parentPresent: true,
    parentName: "chrome.exe",
    creationDate: "2026-08-13T12:00:30.000Z",
    nonceReadable: true,
  };
  const ctx = plausibility({
    rows: [{ pid: 5000, parentPid: 4812, creationDate: "2026-08-13T12:00:30.000Z" }],
  });
  assert.equal(rowIsInHolderChain(row, ctx), false);
  assert.equal(rowHasPositiveRunIdentity(row, ctx), false);
  const killed: number[] = [];
  // A single fixed clock makes spawn floor and holderExitedAt the same
  // instant, which is not a usable ceiling. The row is 20s after exit
  // only when the clock actually advances past spawn.
  let spawned = false;
  const clock = {
    now() {
      return spawned ? HOLDER_EXIT : T0;
    },
  };
  const inner = trackingSpawn(() => exitingProcess());
  await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-c2" } },
    clock,
    spawn: (exe, argv, options, permit) => {
      const handle = inner(exe, argv, options, permit);
      spawned = true;
      return handle;
    },
    scanOrphans: () => writerOrphanScanResult([row]),
    killTree: (pid) => {
      killed.push(pid);
    },
  });
  assert.equal(killed.includes(5000), false, `killTree called with ${killed.join(",")}`);
});

test("C2 a degenerate holderExitedAt on the spawn floor keeps the in-window child", () => {
  const child = { pid: 1238, parentPid: 4812, creationDate: T0 };
  const reused = { pid: 5000, parentPid: 4812, creationDate: "2026-08-13T12:00:30.000Z" };
  const degenerate = plausibility({
    createdNotBefore: FLOOR,
    holderExitedAt: FLOOR,
    rows: [child, reused],
  });
  assert.equal(rowIsInHolderChain(child, degenerate), true);
  assert.equal(rowIsInHolderChain(reused, degenerate), true, "without a usable ceiling the later row stays UNKNOWN-ours");
  const usable = plausibility({
    createdNotBefore: FLOOR,
    holderExitedAt: HOLDER_EXIT,
    rows: [child, reused],
  });
  assert.equal(rowIsInHolderChain(child, usable), true);
  assert.equal(rowIsInHolderChain(reused, usable), false);
});

test("C2 the same row created before holderExitedAt stays in the chain and is killed", async () => {
  const row = {
    pid: 5000,
    name: "chrome.exe",
    parentPid: 4812,
    parentPresent: true,
    creationDate: "2026-08-13T12:00:05.000Z",
    nonceReadable: true,
  };
  const ctx = plausibility({
    rows: [{ pid: 5000, parentPid: 4812, creationDate: "2026-08-13T12:00:05.000Z" }],
  });
  assert.equal(rowIsInHolderChain(row, ctx), true);
  const killed: number[] = [];
  // Spawn floor must precede the leftover; holder exit must follow it.
  // A single fixed clock makes those the same instant and skips the kill.
  let spawned = false;
  const clock = {
    now() {
      return spawned ? HOLDER_EXIT : T0;
    },
  };
  const inner = trackingSpawn(() => exitingProcess());
  await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-c2b" } },
    clock,
    spawn: (exe, argv, options, permit) => {
      const handle = inner(exe, argv, options, permit);
      spawned = true;
      return handle;
    },
    scanOrphans: () => writerOrphanScanResult([row]),
    killTree: (pid) => {
      killed.push(pid);
    },
  });
  assert.equal(killed.includes(5000), true, `killTree called with ${killed.join(",") || "(nothing)"}`);
});

test("C2 missing or unplaceable creationDate keeps the edge (UNKNOWN stays ours)", () => {
  for (const creationDate of [undefined, "2026-02-30T00:00:00Z", "2026-08-13T12:00:30.000"]) {
    const row = {
      pid: 5000,
      parentPid: 4812,
      parentPresent: true,
      ...(creationDate !== undefined ? { creationDate } : {}),
    };
    const ctx = plausibility({
      rows: [{ pid: 5000, parentPid: 4812, ...(creationDate !== undefined ? { creationDate } : {}) }],
    });
    assert.equal(rowIsInHolderChain(row, ctx), true, String(creationDate));
  }
});

test("C2 liveness: grandchild born after holder exit via a live intermediate stays in the chain", () => {
  const ctx = plausibility({
    rows: [
      { pid: 5000, parentPid: 4812, creationDate: "2026-08-13T12:00:05.000Z" },
      { pid: 6000, parentPid: 5000, creationDate: "2026-08-13T12:00:40.000Z" },
    ],
  });
  assert.equal(rowIsInHolderChain({ pid: 6000, parentPid: 5000, creationDate: "2026-08-13T12:00:40.000Z" }, ctx), true);
});

// ---------------------------------------------------------------------------
// CLASS 3 — one rule, one spelling
// ---------------------------------------------------------------------------

test("C3a acquire and reclaim agree on malformed expiresAt, and list() drops unplaceable rows", () => {
  const now = "2026-08-13T12:00:00.000Z";
  const well = acquireLease({
    existing: [],
    leaseId: "lease-well",
    kind: "WORKTREE",
    resource: CWD,
    missionId: "mission-1",
    runId: "run-well",
    now: "2026-08-13T11:00:00.000Z",
  });
  assert.equal(well.ok, true);
  const good = { ...well.lease!, expiresAt: "2026-08-13T11:50:00.000Z" };
  for (const expiresAt of ["not-a-date", "", null, undefined, 12345] as const) {
    const held = { ...good, leaseId: "lease-bad", expiresAt: expiresAt as string };
    const acquire = acquireLease({
      existing: [held],
      leaseId: "lease-next",
      kind: "WORKTREE",
      resource: CWD,
      missionId: "mission-1",
      runId: "run-next",
      now,
    });
    const reclaim = reclaimStaleLease({
      existing: [held],
      kind: "WORKTREE",
      resource: CWD,
      holderLiveness: "DEAD_CONFIRMED",
      holderObservation: isUsablePid(held.pid)
        ? { outcome: "NOT_FOUND", pid: held.pid }
        : { outcome: "NOT_FOUND" },
      now,
    });
    assert.equal(acquire.requiresStalenessCheck, reclaim.ok, String(expiresAt));
    assert.equal(leaseHasExpired(held, now), false, String(expiresAt));
  }
  const root = mkdtempSync(join(tmpdir(), "aion-r18b-lease-"));
  try {
    writeFileSync(join(root, "leases.json"), `${JSON.stringify([{
      schema: "aion.director.lease.v1",
      leaseId: "lease-bad-exp",
      kind: "WORKTREE",
      resource: CWD,
      missionId: "mission-1",
      runId: "run-1",
      pid: 1,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: "not-a-date",
    }], null, 2)}\n`);
    const listed = createNodeLeaseStore(root, { hostArbitrationRoot: join(root, "arb") }).list();
    assert.equal(listed.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("C3a liveness: a well-formed expired lease with NOT_FOUND is still reclaimed", () => {
  const held = acquireLease({
    existing: [],
    leaseId: "lease-exp",
    kind: "WORKTREE",
    resource: CWD,
    missionId: "mission-1",
    runId: "run-old",
    pid: 4812,
    now: "2026-08-13T11:00:00.000Z",
  }).lease!;
  const expired = { ...held, expiresAt: "2026-08-13T11:50:00.000Z" };
  const reclaim = reclaimStaleLease({
    existing: [expired],
    kind: "WORKTREE",
    resource: CWD,
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "NOT_FOUND", pid: 4812 },
    now: "2026-08-13T12:00:00.000Z",
  });
  assert.equal(reclaim.ok, true, reclaim.reason);
});

test("C3b FOUND pid 0 does not produce a lease identity", () => {
  assert.equal(identityFromObservation({
    outcome: "FOUND",
    reason: "cim",
    pid: 0,
    creationDate: "2026-08-15T08:00:00.000Z",
    executablePath: CLAUDE_EXE,
    runNonce: NONCE,
  }), null);
  const here = fileURLToPath(new URL(".", import.meta.url));
  const source = readFileSync(join(here, "..", "..", "src", "run-manager.ts"), "utf8");
  assert.equal(source.includes("function leaseIdentityFromObservation"), false);
  assert.match(source, /identityFromObservation\(/);
  assert.match(source, /leaseIdentityFromPidStartedAt/);
});

test("C3c existingIntentOn uses answersAfterReboot.started", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const source = readFileSync(join(here, "..", "..", "src", "run-intent.ts"), "utf8");
  assert.match(source, /answersAfterReboot\(parsed\.intent\)\.started/);
  const store = {
    writeDurable() {},
    readUtf8() {
      return JSON.stringify({
        schema: "aion.director.run-intent.v1",
        runId: "run-1",
        missionId: "mission-1",
        workItemId: "work-1",
        worktree: CWD,
        branch: null,
        executablePath: CLAUDE_EXE,
        argv: [],
        cwd: CWD,
        runNonce: NONCE,
        intendedAt: NOW,
        spawnAttemptedAt: T0,
        spawnPid: null,
        spawnObservedAt: null,
        processIdentity: null,
        secretsPresent: false,
      });
    },
  };
  assert.equal(existingIntentOn(store, "C:\\intent.json"), "spawned");
});

// ---------------------------------------------------------------------------
// CLASS 4 — budget is wall time
// ---------------------------------------------------------------------------

test("C4 a wait that overruns the requested slice times the run out against the clock", async () => {
  const start = Date.now();
  const clock = {
    now() {
      return new Date(start + (Date.now() - start)).toISOString();
    },
  };
  const result = await runWith({
    request: { timeoutMs: 40 },
    spawn: trackingSpawn(() => hangingProcess()),
    clock,
    wait: (ms) => new Promise((resolve) => {
      // Overrun only the budget-poll slices. Cancel-ladder waits stay short.
      setTimeout(resolve, ms >= 1000 ? 0 : ms * 5);
    }),
  });
  assert.equal(result.cancel.timedOut, true, result.reason);
  const budget = result.conjunction.findings.find((item) => item.name === "runCompletedWithinBudget");
  assert.equal(budget?.ok, false);
  assert.ok(result.cancel.stages.includes("SOFT"));
});

test("C4 liveness: a prompt child under a well-behaved wait still reports timedOut false", async () => {
  const result = await runWith({
    wait: async () => undefined,
  });
  assert.equal(result.cancel.timedOut, false);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.conjunction.findings.length, 15);
});

test("C4 a frozen clock plus an instant wait still times out a child that never exits", async () => {
  const result = await Promise.race([
    runWith({
      request: { timeoutMs: 40 },
      spawn: trackingSpawn(() => hangingProcess()),
      clock: createFixedClock(NOW),
      wait: async () => undefined,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("raceExit did not terminate under a frozen clock")), 5_000);
    }),
  ]);
  assert.equal(result.cancel.timedOut, true, result.reason);
  const budget = result.conjunction.findings.find((item) => item.name === "runCompletedWithinBudget");
  assert.equal(budget?.ok, false);
});

// ---------------------------------------------------------------------------
// CLASS 5 — resultPath names a write that landed
// ---------------------------------------------------------------------------

test("C5 ENOSPC on result.json sets resultPath null and leaves ok/spawned unchanged", async () => {
  const fs = memoryFs();
  const original = fs.writeDurable.bind(fs);
  fs.writeDurable = (path, utf8) => {
    if (path.endsWith("result.json")) {
      const error = new Error("ENOSPC");
      (error as NodeJS.ErrnoException).code = "ENOSPC";
      throw error;
    }
    original(path, utf8);
  };
  const result = await runWith({ fs });
  assert.equal(result.resultPath, null);
  assert.equal(result.spawned, true);
  assert.equal(typeof result.ok, "boolean");
});

// ---------------------------------------------------------------------------
// CLASS 6 — flush does not end holdback; Authorization redacts the credential
// ---------------------------------------------------------------------------

test("C6 flush mid-block does not release the held private-key body", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "-----BEGIN RSA PRIVATE KEY-----\nBODYLINE01xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n");
  log.flush();
  log.write("stdout", "SECRETKEYMATERIAL03xxxxxxxxxxxxxxxxxxxxxxxxxx\n");
  log.write("stdout", "-----END RSA PRIVATE KEY-----\n");
  log.seal();
  const text = stdout.contents().toString("utf8");
  assert.equal(text.includes("SECRETKEYMATERIAL03"), false, text);
  assert.equal(text.includes("BODYLINE01"), false, text);
  assert.match(text, /BEGIN RSA PRIVATE KEY/);
  assert.match(text, /\[REDACTED\]/);
  assert.match(text, /END RSA PRIVATE KEY/);
});

test("C6 flush inside a token does not leak the five families, and later ordinary output survives", () => {
  const cases = [
    { prefix: "ghp_", rest: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd" },
    { prefix: "github_pat_", rest: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd" },
    { prefix: "sk-", rest: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd" },
    { prefix: "Bearer ", rest: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd" },
    { prefix: "Authorization: ", rest: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd" },
  ];
  for (const item of cases) {
    const stdout = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout, stderr: createMemoryLogSink() },
    });
    log.write("stdout", item.prefix);
    log.flush();
    log.write("stdout", `${item.rest}\n`);
    log.write("stdout", "tests: 742 passed\n");
    log.seal();
    const text = stdout.contents().toString("utf8");
    assert.equal(text.includes(item.rest), false, `${item.prefix} leaked: ${text}`);
    assert.match(text, /tests: 742 passed/);
  }
});

test("C6 Authorization redacts the credential and keeps the following innocent token", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  const lines = [
    'req headers: {"authorization": "abc123secret", "accept": "*/*"}',
    "Authorization: ZGFuOnBhc3N3b3Jk status=200",
    "Proxy-Authorization: ZGFuOnBhc3N3b3Jk via=proxy",
  ];
  log.write("stdout", `${lines.join("\n")}\n`);
  log.seal();
  const text = stdout.contents().toString("utf8");
  assert.equal(text.includes("abc123secret"), false, text);
  assert.equal(text.includes("ZGFuOnBhc3N3b3Jk"), false, text);
  assert.match(text, /accept/);
  assert.match(text, /status=200/);
  assert.match(text, /via=proxy/);
});

// ---------------------------------------------------------------------------
// CLASS 7 — permission-mode closed at the read-only allowlist
// ---------------------------------------------------------------------------

test("C7 every permission-mode except plan (and absence) grants write", () => {
  const modes = ["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan"];
  for (const mode of modes) {
    const granted = argvGrantsWritePermission(["--permission-mode", mode]);
    assert.equal(granted, mode !== READ_ONLY_PERMISSION_MODE, mode);
  }
  assert.equal(argvGrantsWritePermission(["--permission-mode", "someNewMode"]), true);
  assert.equal(argvGrantsWritePermission(["-p"]), false);
  const grokWrite = executorArgvFor("grok", { promptPath: PROMPT, cwd: CWD, role: "IMPLEMENT" });
  const grokReview = executorArgvFor("grok", { promptPath: PROMPT, cwd: CWD, role: "ADVERSARIAL_REVIEW" });
  const claudeWrite = executorArgvFor("claude", { promptPath: PROMPT, cwd: CWD, role: "IMPLEMENT" });
  const claudeReview = executorArgvFor("claude", { promptPath: PROMPT, cwd: CWD, role: "ADVERSARIAL_REVIEW" });
  assert.equal(grokWrite, null, "grok has no IMPLEMENT route");
  assert.equal(claudeReview, null, "claude has no ADVERSARIAL_REVIEW route");
  assert.ok(Array.isArray(grokReview));
  assert.ok(Array.isArray(claudeWrite));
  assert.equal(argvGrantsWritePermission(grokReview), false);
  assert.equal(argvGrantsWritePermission(claudeWrite), true);
  assert.equal(grokReview[grokReview.indexOf("--permission-mode") + 1], "plan");
  assert.equal(grokReview.includes("--no-plan"), false);
});

test("C7 liveness: a review-role stand-in still writes handoff.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r18b-review-"));
  const runRoot = join(dir, "run");
  const promptPath = join(dir, "PROMPT.md");
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(promptPath, "review\n");
  const stub = join(dir, "stub.mjs");
  writeFileSync(stub, [
    "import { writeFileSync } from \"node:fs\";",
    "const path = process.env.AION_HANDOFF_PATH;",
    "const raw = process.env.AION_HANDOFF_JSON;",
    "if (!path || !raw) process.exit(2);",
    "const json = JSON.parse(raw);",
    "const now = new Date().toISOString();",
    "json.startedAt = now;",
    "json.finishedAt = now;",
    "writeFileSync(path, JSON.stringify(json));",
    "",
  ].join("\n"));
  const handoff = goodHandoff({
    executor: "grok",
    headBefore: HEAD_BEFORE,
    headAfter: HEAD_BEFORE,
    artifacts: [],
  });
  try {
    const result = await launchRun({
      runId: "run-1",
      missionId: "mission-1",
      workItemId: "work-1",
      executor: "grok",
      worktree: dir,
      branch: "executor/oracle",
      cwd: dir,
      runNonce: NONCE,
      runRoot,
      promptPath,
      timeoutMs: 30_000,
      lease: { kind: "WORKTREE", resource: dir, leaseId: "lease-review-live" },
      authorisedProductionMutated: false,
      role: "ADVERSARIAL_REVIEW",
      childEnv: {
        AION_HANDOFF_PATH: join(runRoot, "handoff.json"),
        AION_HANDOFF_JSON: JSON.stringify(handoff),
      },
    }, {
      clock: { now: () => new Date().toISOString() },
      fs: createNodeRunFileSystem(),
      spawn: (_exe, argv, options, permit) => {
        requireSpawnPermit(permit);
        assert.equal(argv[argv.indexOf("--permission-mode") + 1], "plan");
        assert.equal(argv.includes("--no-plan"), false);
        const ran = spawnSync(process.execPath, [stub], {
          cwd: options.cwd,
          env: options.env,
          windowsHide: true,
          encoding: "utf8",
        });
        assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
        return exitingProcess();
      },
      git: matchingGit(HEAD_BEFORE, { inspectedWorktree: dir }),
      probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
      capacity: memoryCapacity(),
      leases: memoryLeases(),
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: () => writerOrphanScanResult([]),
      discoveryEnv: { AION_GROK_PATH: process.execPath, AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
      discoveryFs: {
        isFile: (path) => path === process.execPath || path === CLAUDE_EXE,
        readDir: () => [],
      },
    });
    assert.equal(result.spawned, true, result.reason);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.conjunction.findings.find((item) => item.name === "handoffParsed")?.ok, true);
    assert.equal(result.handoff?.runNonce, NONCE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLASS 8 — host-wide kinds lock under a host-fixed root
// ---------------------------------------------------------------------------

test("C8 two stores with different TEMP roots refuse a second PRODUCTION_WRITER", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r18b-arb-"));
  const rootA = mkdtempSync(join(tmpdir(), "aion-r18b-sa-"));
  const rootB = mkdtempSync(join(tmpdir(), "aion-r18b-sb-"));
  try {
    const a = createNodeLeaseStore(rootA, { hostArbitrationRoot: arb });
    const b = createNodeLeaseStore(rootB, { hostArbitrationRoot: arb });
    const first = acquireLease({
      existing: [],
      leaseId: "lease-pw-a",
      kind: "PRODUCTION_WRITER",
      resource: "default",
      missionId: "mission-1",
      runId: "run-a",
      now: NOW,
    });
    assert.equal(first.ok, true);
    a.save([first.lease!]);
    const second = acquireLease({
      existing: b.list(),
      leaseId: "lease-pw-b",
      kind: "PRODUCTION_WRITER",
      resource: "default",
      missionId: "mission-1",
      runId: "run-b",
      now: NOW,
    });
    assert.equal(second.ok, true, "in-memory acquire on an empty book is not the host lock");
    assert.throws(() => b.save([second.lease!]), /already held|EEXIST|host-wide/);
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test("C8 hostArbitrationRoot ignores TEMP, TMP and AION_DIRECTOR_ROOT", () => {
  const root = hostArbitrationRoot({
    TEMP: "C:\\tmp-a",
    TMP: "C:\\tmp-b",
    AION_DIRECTOR_ROOT: "C:\\moved-store",
    ProgramData: "C:\\ProgramData",
    SystemDrive: "C:",
  });
  assert.equal(root, join("C:\\ProgramData", "AION", "director-d2-host-locks"));
  assert.equal(root.includes("tmp-a"), false);
  assert.equal(root.includes("moved-store"), false);
});

test("C11 a redirected ProgramData is ignored; two ProgramData values share one derived root", () => {
  const derived = derivedHostArbitrationRoot({ SystemDrive: "C:" });
  const pdA = "C:\\scratch\\pdA-r19b";
  const pdB = "C:\\scratch\\pdB-r19b";
  const fromA = hostArbitrationRoot({ SystemDrive: "C:", ProgramData: pdA });
  const fromB = hostArbitrationRoot({ SystemDrive: "C:", ProgramData: pdB });
  assert.equal(fromA, derived);
  assert.equal(fromB, derived);
  assert.equal(fromA.includes("pdA-r19b"), false);
  assert.equal(fromB.includes("pdB-r19b"), false);
  const created: string[] = [];
  const redirected = prepareHostArbitrationLocks(
    { SystemDrive: "C:", ProgramData: pdA },
    { mkdir: (path) => { created.push(path); }, resolve: (path) => path },
  );
  assert.equal(redirected.ok, true, "ProgramData is not the lock directory");
  assert.equal(redirected.ok && redirected.root, derived);
  assert.ok(created.every((path) => path.toLowerCase().includes("c:\\programdata\\aion\\director-d2-host-locks")));
  assert.ok(created.every((path) => !path.includes("pdA-r19b")));
});

test("C11 the CLI guard verifies the created lock directory, not ProgramData", async () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const cliPath = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  const cli = readFileSync(cliPath, "utf8");
  assert.match(cli, /prepareHostArbitrationLocks/);
  assert.doesNotMatch(cli, /hostProgramDataIsHostFixed/);
  assert.doesNotMatch(cli, /ProgramData is not the host-fixed/);

  const { runDirectorCli } = await import(pathToFileURL(cliPath).href);
  const runRoot = mkdtempSync(join(tmpdir(), "aion-r20b-c11-"));
  writeFileSync(join(runRoot, "handoff.json"), "{}\n");
  const argv = [
    "--run-id", "run-c11",
    "--mission-id", "mission-1",
    "--work-item-id", "work-1",
    "--executor", "grok",
    "--role", "INDEPENDENT_ACCEPTANCE",
    "--worktree", "C:\\wt",
    "--cwd", "C:\\wt",
    "--run-root", runRoot,
    "--prompt-path", "C:\\wt\\PROMPT.md",
    "--lease-kind", "PRODUCTION_WRITER",
    "--lease-resource", "default",
    "--lease-id", "lease-c11",
    "--run-nonce", "nonce-c11",
  ];
  try {
    const liveErrors: string[] = [];
    await runDirectorCli(argv, {
      log() { /* unused */ },
      error(message: string) { liveErrors.push(String(message)); },
    }, {
      ...process.env,
      SystemDrive: "D:",
      ProgramData: "C:\\ProgramData",
    }, {
      mkdir() { /* created */ },
      resolve(path: string) { return path; },
    });
    assert.doesNotMatch(liveErrors.join("\n"), /ProgramData is not the host-fixed/);
    assert.equal(
      liveErrors.some((row) => row.includes("PRODUCTION_WRITER refused")),
      false,
      liveErrors.join("\n"),
    );

    const safeErrors: string[] = [];
    const safeCode = await runDirectorCli(argv, {
      log() { /* unused */ },
      error(message: string) { safeErrors.push(String(message)); },
    }, {
      ...process.env,
      SystemDrive: "C:",
      ProgramData: "C:\\ProgramData",
    }, {
      mkdir() { throw new Error("injected-mkdir-denied-r20b"); },
      resolve(path: string) { return path; },
    });
    assert.equal(safeCode, 2);
    assert.match(safeErrors.join("\n"), /host arbitration root is not creatable/);
    assert.match(safeErrors.join("\n"), /injected-mkdir-denied-r20b/);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

function plantHostWriterLock(
  arb: string,
  record: string | Record<string, unknown>,
): string {
  const named = hostLockFileName({ kind: "PRODUCTION_WRITER", resourceKey: "PRODUCTION_WRITER" });
  assert.equal(named.ok, true);
  const lockDir = join(arb, DIRECTOR_STORE_LAYOUT_V1.locksDir);
  mkdirSync(lockDir, { recursive: true });
  const lockPath = join(lockDir, named.fileName!);
  writeFileSync(
    lockPath,
    typeof record === "string" ? record : `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  return lockPath;
}

function acquireAndSaveWriter(
  storeRoot: string,
  arb: string,
  probe: { observe: (pid: number) => ProcessObservationV1 },
  leaseId: string,
  treeEvidence?: () => "CLEAR" | "LIVE" | "UNKNOWN",
): void {
  const store = createNodeLeaseStore(storeRoot, {
    hostArbitrationRoot: arb,
    probe,
    ...(treeEvidence !== undefined ? { hostLockTreeEvidence: treeEvidence } : {}),
  });
  const attempt = acquireLease({
    existing: store.list(),
    leaseId,
    kind: "PRODUCTION_WRITER",
    resource: "default",
    missionId: "mission-1",
    runId: `run-${leaseId}`,
    now: NOW,
  });
  assert.equal(attempt.ok, true, attempt.reason);
  store.save([attempt.lease!]);
}

test("C8 a host lock whose recorded holder is NOT_FOUND is reclaimed", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r18b-reclaim-"));
  const root = mkdtempSync(join(tmpdir(), "aion-r18b-reclaim-s-"));
  try {
    const lockPath = plantHostWriterLock(arb, {
      leaseId: "stale-dead",
      kind: "PRODUCTION_WRITER",
      resource: "default",
      resourceKey: canonicalResource("PRODUCTION_WRITER", "default"),
      missionId: "mission-stale",
      runId: "run-stale",
      pid: 424242,
      identity: { pid: 424242, startedAt: NOW, runToken: "nonce-stale" },
      acquiredAt: NOW,
      heartbeatAt: NOW,
      expiresAt: "2026-08-13T12:10:00.000Z",
    });
    assert.equal(existsSync(lockPath), true);
    acquireAndSaveWriter(root, arb, {
      observe: (pid) => ({ outcome: "NOT_FOUND", reason: "no process occupies this pid", pid }),
    }, "lease-pw-reclaim", () => "CLEAR");
    assert.equal(existsSync(lockPath), true, "the next holder must replace the lock, not leave the slot empty");
    const raw = readFileSync(lockPath, "utf8");
    assert.match(raw, /lease-pw-reclaim/);
    assert.doesNotMatch(raw, /stale-dead/);
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("C8 a host lock whose holder probe is UNAVAILABLE is refused and names the path", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r18b-unk-"));
  const root = mkdtempSync(join(tmpdir(), "aion-r18b-unk-s-"));
  try {
    const lockPath = plantHostWriterLock(arb, {
      leaseId: "stale-unknown",
      kind: "PRODUCTION_WRITER",
      resource: "default",
      resourceKey: canonicalResource("PRODUCTION_WRITER", "default"),
      missionId: "mission-stale",
      runId: "run-stale",
      pid: 424243,
      acquiredAt: NOW,
      heartbeatAt: NOW,
      expiresAt: "2026-08-13T12:10:00.000Z",
    });
    let message = "";
    try {
      acquireAndSaveWriter(root, arb, {
        observe: (pid) => ({ outcome: "UNAVAILABLE", reason: "access-denied", pid }),
      }, "lease-pw-unk");
      assert.fail("expected save to refuse");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /UNKNOWN|unproven|could not|unanswered|UNAVAILABLE/i);
    assert.equal(message.includes(lockPath), true, message);
    assert.equal(existsSync(lockPath), true, "UNKNOWN must not delete the lock");
    assert.match(readFileSync(lockPath, "utf8"), /stale-unknown/);
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("C8 an unparseable host lock is refused, names the path, and is not deleted", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r18b-bad-"));
  const root = mkdtempSync(join(tmpdir(), "aion-r18b-bad-s-"));
  try {
    const lockPath = plantHostWriterLock(arb, "{not-json");
    let message = "";
    try {
      acquireAndSaveWriter(root, arb, {
        observe: (pid) => ({ outcome: "NOT_FOUND", reason: "must not be consulted for garbage", pid }),
      }, "lease-pw-bad");
      assert.fail("expected save to refuse");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /UNKNOWN|unreadable|unparseable/i);
    assert.equal(message.includes(lockPath), true, message);
    assert.equal(existsSync(lockPath), true, "an unparseable lock must not be silently deleted");
    assert.equal(readFileSync(lockPath, "utf8"), "{not-json");
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("C8 liveness: two WORKTREE resources still both persist", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r18b-arbw-"));
  const rootA = mkdtempSync(join(tmpdir(), "aion-r18b-wa-"));
  const rootB = mkdtempSync(join(tmpdir(), "aion-r18b-wb-"));
  try {
    const a = createNodeLeaseStore(rootA, { hostArbitrationRoot: arb });
    const b = createNodeLeaseStore(rootB, { hostArbitrationRoot: arb });
    const left = acquireLease({
      existing: [],
      leaseId: "lease-wt-a",
      kind: "WORKTREE",
      resource: "C:\\wt-a",
      missionId: "mission-1",
      runId: "run-a",
      now: NOW,
    });
    const right = acquireLease({
      existing: [],
      leaseId: "lease-wt-b",
      kind: "WORKTREE",
      resource: "C:\\wt-b",
      missionId: "mission-1",
      runId: "run-b",
      now: NOW,
    });
    a.save([left.lease!]);
    b.save([right.lease!]);
    assert.equal(a.list().length, 1);
    assert.equal(b.list().length, 1);
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLASS 9 — developer-agent spawn is leased
// ---------------------------------------------------------------------------

test("C9 the developer-agent lease refuses while PRODUCTION_WRITER is held", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r18b-dev-"));
  const root = mkdtempSync(join(tmpdir(), "aion-r18b-devs-"));
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
    const writer = acquireLease({
      existing: [],
      leaseId: "lease-pw-held",
      kind: "PRODUCTION_WRITER",
      resource: "default",
      missionId: "mission-1",
      runId: "run-held",
      now: NOW,
    });
    store.save([writer.lease!]);
    const attempt = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
    });
    assert.equal(attempt.ok, false);
    if (!attempt.ok) assert.match(attempt.reason, /PRODUCTION_WRITER/);
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("C12 a stale host writer lock whose holder is DEAD_CONFIRMED lets the developer-agent proceed", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r19b-c12-stale-"));
  const root = mkdtempSync(join(tmpdir(), "aion-r19b-c12-stale-s-"));
  try {
    plantHostWriterLock(arb, {
      leaseId: "stale-dead",
      kind: "PRODUCTION_WRITER",
      resource: "default",
      resourceKey: canonicalResource("PRODUCTION_WRITER", "default"),
      missionId: "mission-stale",
      runId: "run-stale",
      pid: 424242,
      identity: { pid: 424242, startedAt: NOW, runToken: "nonce-stale" },
      acquiredAt: NOW,
      heartbeatAt: NOW,
      expiresAt: "2026-08-13T12:10:00.000Z",
    });
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
    const attempt = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
      probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "no process occupies this pid", pid }) },
      hostLockTreeEvidence: () => "CLEAR",
    });
    assert.equal(attempt.ok, true, !attempt.ok ? attempt.reason : "");
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("C12 an unlistable host locks directory refuses the developer-agent", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r19b-c12-unlist-"));
  const root = mkdtempSync(join(tmpdir(), "aion-r19b-c12-unlist-s-"));
  try {
    writeFileSync(join(arb, DIRECTOR_STORE_LAYOUT_V1.locksDir), "not-a-directory\n");
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
    const attempt = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
      probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "must not be consulted", pid }) },
    });
    assert.equal(attempt.ok, false);
    if (!attempt.ok) assert.match(attempt.reason, /UNKNOWN|unlistable/i);
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("C12 an empty host locks directory lets the developer-agent proceed", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r19b-c12-empty-"));
  const root = mkdtempSync(join(tmpdir(), "aion-r19b-c12-empty-s-"));
  try {
    mkdirSync(join(arb, DIRECTOR_STORE_LAYOUT_V1.locksDir), { recursive: true });
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: arb });
    const attempt = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
    });
    assert.equal(attempt.ok, true, !attempt.ok ? attempt.reason : "");
  } finally {
    rmSync(arb, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLASS 10 — malformed requests refuse, they do not reject
// ---------------------------------------------------------------------------

test("C10 executeRun and launchRun return RunResultV1 for hostile runRoot and argv", async () => {
  const discovery = matchingDiscovery();
  const deps: LaunchRunDepsV1 = {
    clock: createFixedClock(NOW),
    fs: memoryFs(),
    spawn: trackingSpawn(() => exitingProcess()),
    git: matchingGit(),
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    capacity: memoryCapacity(),
    leases: memoryLeases(),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([]),
    discoveryEnv: discovery.discoveryEnv ?? {},
    discoveryFs: discovery.discoveryFs ?? { isFile: () => false, readDir: () => [] },
  };
  const hostileRoots = [undefined, null, 123, {}, [], true, Symbol("x")];
  for (const runRoot of hostileRoots) {
    const executed = await executeRun({ ...request(), runRoot: runRoot as never }, deps);
    assert.equal(executed.ok, false, String(runRoot));
    assert.match(executed.reason, /runRoot|request/);
    assert.equal(executed.spawned, false);
    const launched = await launchRun({
      runId: "run-1",
      missionId: "mission-1",
      workItemId: "work-1",
      executor: "claude",
      worktree: CWD,
      branch: "executor/oracle",
      cwd: CWD,
      runNonce: NONCE,
      runRoot: runRoot as never,
      promptPath: PROMPT,
      timeoutMs: 30_000,
      lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-1" },
      authorisedProductionMutated: false,
      role: "IMPLEMENT",
    }, deps);
    assert.equal(launched.ok, false, String(runRoot));
    assert.equal(launched.spawned, false);
  }
  const hostileArgv = [undefined, null, 123, {}, true, Symbol("y")];
  for (const argv of hostileArgv) {
    const executed = await executeRun({ ...request(), argv: argv as never }, deps);
    assert.equal(executed.ok, false, String(argv));
    assert.match(executed.reason, /argv/);
    assert.equal(executed.spawned, false);
  }
});

test("C10 persistRunIntent refuses non-string ids instead of throwing", () => {
  const store = {
    writeDurable() {
      throw new Error("must not write");
    },
    readUtf8() {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  };
  const base = {
    intentPath: "C:\\wt\\intent.json",
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: null,
    executablePath: CLAUDE_EXE,
    argv: ["-p"],
    cwd: CWD,
    runNonce: NONCE,
    now: NOW,
  };
  for (const key of ["runId", "missionId", "workItemId"] as const) {
    for (const value of [123, null, undefined, {}, true] as const) {
      const result = persistRunIntent({ ...base, [key]: value } as never, store);
      assert.equal(result.ok, false, `${key}=${String(value)}`);
      assert.equal(result.permit, null);
    }
  }
});

// ---------------------------------------------------------------------------
// CLASS 11 — reboot recovery has an entry point
// ---------------------------------------------------------------------------

test("C11 recoverAbandonedRun records a terminal result when the holder is gone", async () => {
  const intent = {
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
    spawnPid: 110960,
    spawnObservedAt: T0,
    processIdentity: RECORDED,
    secretsPresent: false,
    role: "IMPLEMENT",
  };
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: `${JSON.stringify(intent, null, 2)}\n` },
  });
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.spawned, true);
  assert.match(result.reason, /NOT_FOUND|terminal result/);
  assert.match(result.reason, /110960|holder/);
  assert.equal(fs.isFile(join(RUN_ROOT, "result.json")), true);
});

test("C11 recoverAbandonedRun refuses while the holder is still present", async () => {
  const intent = {
    schema: "aion.director.run-intent.v1",
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: null,
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
  };
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: `${JSON.stringify(intent, null, 2)}\n` },
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
  assert.equal(result.ok, false);
  assert.match(result.reason, /still present/);
});

test("C11 CLI source has a --recover path that calls recoverAbandonedRun", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const cli = readFileSync(join(here, "..", "..", "..", "..", "apps", "director-cli.mjs"), "utf8");
  assert.match(cli, /--recover/);
  assert.match(cli, /recoverAbandonedRun/);
});
