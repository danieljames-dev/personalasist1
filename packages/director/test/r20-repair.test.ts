/**
 * Round 20 property repairs. Each case below must fail on 72a61e00 and pass
 * after the matching property fix. Helpers are local.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
} from "../src/bounded-log.js";
import { DEFAULT_DIRECTOR_ROOT, DIRECTOR_ROOT_ENV } from "../src/contracts.js";
import { openGate, resolveGate } from "../src/gates.js";
import { artifactPathWithinRoot } from "../src/handoff.js";
import { pathIsInside } from "../src/host-path.js";
import {
  createNodeLeaseStore,
  inspectHostProductionWriterLock,
  sandboxDirectorStoreRoot,
} from "../src/lease-store.js";
import { acquireLease, type LeaseV1 } from "../src/leases.js";
import {
  captureProcessIdentity,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  undecidableRowsOf,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  type ProcessRowPlausibilityContextV1,
} from "../src/process-identity.js";
import { persistRunIntent, requireSpawnPermit } from "../src/run-intent.js";
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
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
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
const BOOT = "2026-08-01T00:00:00.000Z";
const PARENT_OLD = "2026-08-09T10:43:24.000Z";
const AFTER_CEILING = "2026-08-13T12:00:32.000Z";

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
      isFile: (path) => (path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe") || /(?:^|[\\\\/])PROMPT\.md$/i.test(path),
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
  if (!files.has(PROMPT)) files.set(PROMPT, "prompt\n");
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
      if (argv[0] === "status" && argv.includes("--porcelain")) {
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
  killTree?: (pid: number) => void;
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
        // spawn still proceeds
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
    clock: createFixedClock(HOLDER_EXIT),
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
  });
}

function hostLockNames(arbitrationRoot: string): string[] {
  try {
    return readdirSync(join(arbitrationRoot, "locks")).filter((name) =>
      name.startsWith("production-writer-") && name.endsWith(".lock"),
    );
  } catch {
    return [];
  }
}

function captureThenGone(): RunManagerDepsV1["probe"] {
  let observes = 0;
  return {
    observe: () => {
      observes += 1;
      if (observes === 1) {
        return {
          outcome: "FOUND",
          reason: "injected",
          pid: 4812,
          creationDate: T0,
          executablePath: CLAUDE_EXE,
          runNonce: NONCE,
        };
      }
      return HOLDER_GONE;
    },
  };
}

function powershellHostNoise() {
  return {
    pid: 55001,
    name: "powershell.exe",
    parentPid: 4242,
    parentName: "node.exe",
    parentPresent: true,
    parentCreationDate: BOOT,
    creationDate: AFTER,
    nonceReadable: true,
  };
}

function wmiSessionZeroRow() {
  return {
    pid: 90001,
    name: "WmiPrvSE.exe",
    parentPid: 1612,
    parentName: "dllhost.exe",
    parentPresent: true,
    parentCreationDate: "2026-08-13T09:00:00.000Z",
    creationDate: HOLDER_EXIT,
    sessionId: 0,
    nonceReadable: true,
  };
}

function afterCeilingBrokerRow() {
  return {
    pid: 55040,
    name: "node.exe",
    parentPid: 1220,
    parentName: "dllhost.exe",
    parentPresent: true,
    parentCreationDate: PARENT_OLD,
    creationDate: AFTER_CEILING,
    sessionId: 1,
    runNonce: null,
    nonceReadable: true,
  };
}

// ---------------------------------------------------------------------------
// PROPERTY 1 — one rule, one predicate, one context
// ---------------------------------------------------------------------------

test("P1a benign powershell.exe host noise still releases the PRODUCTION_WRITER lock file", async () => {
  const cases = [
    { label: "empty-snapshot", rows: [] as const },
    { label: "powershell-noise", rows: [powershellHostNoise()] },
  ];
  for (const item of cases) {
    const storeRoot = mkdtempSync(join(tmpdir(), "aion-r20-p1a-store-"));
    const arbRoot = mkdtempSync(join(tmpdir(), "aion-r20-p1a-arb-"));
    const runRoot = join(storeRoot, "run");
    mkdirSync(runRoot, { recursive: true });
    try {
      const store = createNodeLeaseStore(storeRoot, {
        hostArbitrationRoot: arbRoot,
        probe: { observe: (pid: number) => ({ ...HOLDER_GONE, pid }) },
      });
      const runId = `run-p1a-${item.label}`;
      const result = await runWith({
        leases: store,
        probe: captureThenGone(),
        handoff: goodHandoff({ runId }),
        request: {
          runId,
          runRoot,
          lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: `L-PW-${item.label}` },
        },
        scanOrphans: () => writerOrphanScanResult(item.rows as never),
      });
      assert.equal(result.ok, true, `${item.label}: ${result.reason}`);
      const tree = result.conjunction.findings.find((finding) => finding.name === "executorTreeIsGone");
      assert.equal(tree?.ok, true, `${item.label}: ${tree?.reason}`);
      assert.equal(result.productionWriterLeaseReleasedByThisRun, true, item.label);
      assert.equal(
        store.list().some((lease) => lease.leaseId === `L-PW-${item.label}`),
        false,
        `${item.label}: lease row remained`,
      );
      assert.deepEqual(hostLockNames(arbRoot), [], `${item.label}: lock file remained under ${arbRoot}`);
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
      rmSync(arbRoot, { recursive: true, force: true });
    }
  }
});

test("P1a incomplete writer context fails closed rather than releasing over host noise", () => {
  const row = powershellHostNoise();
  const complete = {
    holderPid: 4812,
    rows: [row],
    createdNotBefore: FLOOR,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
  };
  const incomplete = { holderPid: 4812, rows: [row] };
  assert.equal(processRowCouldBelongToThisRun(row, plausibility({
    rows: [{ pid: 4812 }, { pid: row.pid, parentPid: row.parentPid }],
  })), false);
  assert.equal(writerSightingNotProvenAbsent(row, NONCE, complete), false);
  // Missing fields that change the answer must not mint "proven absent".
  assert.equal(writerSightingNotProvenAbsent(row, NONCE, incomplete), true);
});

test("P1b WmiPrvSE.exe session-0 broker tie is not deleted by the session exclude", async () => {
  const row = wmiSessionZeroRow();
  const rows = [
    { pid: 4812, creationDate: T0 },
    { pid: 1612, creationDate: BOOT },
    { pid: 90001, parentPid: 1612, creationDate: HOLDER_EXIT },
  ];
  const scannerCtx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows,
  });
  const runManagerCtx = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows,
  });
  // A live dllhost parent is a live explanation (R24 1B). Session 0
  // does not invent a tie. Both contexts must still agree.
  assert.deepEqual(undecidableRowsOf([row], scannerCtx).map((item) => item.pid), []);
  assert.deepEqual(undecidableRowsOf([row], runManagerCtx).map((item) => item.pid), []);
  assert.deepEqual(scannerCtx, runManagerCtx);

  const result = await runWith({
    probe: captureThenGone(),
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "L-PW-wmi" } },
    scanOrphans: () => ({
      ...writerOrphanScanResult([row as never]),
      directorSessionId: 1,
    }),
  });
  const tree = result.conjunction.findings.find((finding) => finding.name === "executorTreeIsGone");
  assert.equal(tree?.ok, true, tree?.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
});

test("P1c after-ceiling broker row with a live parent is host noise", async () => {
  const row = afterCeilingBrokerRow();
  const ctx = plausibility({
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 1220, creationDate: PARENT_OLD },
      { pid: 55040, parentPid: 1220, creationDate: AFTER_CEILING },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  assert.equal(processRowMakesScanUndecidable(row, ctx), false);

  const killed: number[] = [];
  const result = await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "L-PW-broker" } },
    killTree: (pid) => {
      killed.push(pid);
    },
    scanOrphans: () => writerOrphanScanResult([row as never]),
  });
  const tree = result.conjunction.findings.find((finding) => finding.name === "executorTreeIsGone");
  assert.equal(tree?.ok, true, tree?.reason);
  assert.equal(killed.includes(55040), false);
});

// ---------------------------------------------------------------------------
// PROPERTY 2 — recover answers from a physical fact
// ---------------------------------------------------------------------------

test("P2a unstarted intent plus a live lease pid probes and does not write a terminal spawned:false", async () => {
  const probed: number[] = [];
  const fs = memoryFs({
    files: {
      [join(RUN_ROOT, "intent.json")]: recordedIntent({
        spawnAttemptedAt: null,
        spawnPid: null,
        processIdentity: null,
      }),
    },
  });
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-pw-recover",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: "run-1",
    pid: 4812,
    processIdentity: { pid: 4812, runToken: NONCE },
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  const leases = memoryLeases([attempt.lease]);
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: {
      observe: (pid: number) => {
        probed.push(pid);
        return {
          outcome: "FOUND",
          reason: "live",
          pid,
          creationDate: T0,
          executablePath: CLAUDE_EXE,
          runNonce: NONCE,
        };
      },
    },
    leases,
  } as never);
  assert.deepEqual(probed, [4812], "probe must be called with the lease pid");
  assert.equal(result.ok, false);
  assert.match(result.reason, /still present|ALIVE|REFUSED/i);
  const firstOutcome = (result as { recoverOutcome?: string }).recoverOutcome;
  assert.notEqual(firstOutcome, "TERMINAL");
  const written = fs.files.get(join(RUN_ROOT, "result.json"));
  if (written !== undefined) {
    const parsed = JSON.parse(written) as { spawned?: unknown; recoverOutcome?: unknown };
    assert.notEqual(parsed.recoverOutcome, "TERMINAL");
    assert.notEqual(parsed.spawned === false && parsed.recoverOutcome === undefined, true);
  }
});

test("P2a unstarted intent with no recoverable pid is UNKNOWN and not a completion", async () => {
  const intentPath = join(RUN_ROOT, "intent.json");
  const resultPath = join(RUN_ROOT, "result.json");
  const fs = memoryFs({
    files: {
      [intentPath]: recordedIntent({
        spawnAttemptedAt: null,
        spawnPid: null,
        spawnObservedAt: null,
        processIdentity: null,
      }),
    },
  });
  const persist = persistRunIntent({
    intentPath,
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: CWD,
    branch: "executor/oracle",
    executablePath: CLAUDE_EXE,
    argv: claudeImplementerArgv(),
    cwd: CWD,
    runNonce: NONCE,
    now: NOW,
  }, {
    writeDurable: (path, utf8) => {
      fs.writeDurable(path, utf8);
    },
    readUtf8: (path) => fs.readUtf8(path),
  });
  assert.equal(persist.ok, false);
  const recovered = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: {
      observe: () => {
        throw new Error("probe must not be required when no pid exists");
      },
    },
  });
  assert.equal(recovered.ok, false);
  assert.ok(
    recovered.reason.includes(persist.reason) || persist.reason.includes("unresolvable"),
    `recover=${recovered.reason} persist=${persist.reason}`,
  );
  assert.match(recovered.reason, /unresolvable/);
  assert.notEqual((recovered as { recoverOutcome?: string }).recoverOutcome, "TERMINAL");

  const again = await runWith({ fs, request: { runRoot: RUN_ROOT, runId: "run-1" } });
  assert.equal(again.ok, false);
  assert.equal(/recorded completion already exists/.test(again.reason), false, again.reason);
  assert.match(again.reason, /unresolvable|intent/);

  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-pw-later",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: "run-1",
    pid: 4812,
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  const later = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: { observe: (pid: number) => ({ ...HOLDER_GONE, pid }) },
    leases: memoryLeases([attempt.lease]),
  } as never);
  assert.equal((later as { recoverOutcome?: string }).recoverOutcome, "TERMINAL");
  const bytes = fs.readUtf8(resultPath);
  assert.match(bytes, /DEAD_CONFIRMED|NOT_FOUND|terminal result/);
  assert.equal(later.reason === JSON.parse(bytes).reason, true);
});

test("P2b a REFUSED_UNKNOWN recover record is replaced by a later DEAD_CONFIRMED sweep", async () => {
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: recordedIntent() },
  });
  const first = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: {
      observe: () => {
        throw new Error("wmi denied");
      },
    },
  });
  assert.match(first.reason, /UNKNOWN/);
  assert.equal((first as { recoverOutcome?: string }).recoverOutcome, "REFUSED_UNKNOWN");
  const afterFirst = fs.readUtf8(join(RUN_ROOT, "result.json"));
  assert.match(afterFirst, /UNKNOWN/);

  const second = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: { observe: (pid: number) => ({ ...HOLDER_GONE, pid }) },
  });
  assert.match(second.reason, /DEAD_CONFIRMED|NOT_FOUND|terminal result/);
  assert.equal((second as { recoverOutcome?: string }).recoverOutcome, "TERMINAL");
  const afterSecond = fs.readUtf8(join(RUN_ROOT, "result.json"));
  const parsed = JSON.parse(afterSecond) as { reason?: string; recoverOutcome?: string };
  assert.equal(parsed.reason, second.reason);
  assert.equal(parsed.recoverOutcome, "TERMINAL");
  assert.notEqual(afterSecond, afterFirst);
});

// ---------------------------------------------------------------------------
// PROPERTY 3 — capture refuses a contradicting observed nonce
// ---------------------------------------------------------------------------

test("P3 capture refuses when the occupant carries another run's nonce", () => {
  const captured = captureProcessIdentity({
    observe: () => ({
      outcome: "FOUND",
      reason: "injected",
      pid: 4812,
      creationDate: T0,
      executablePath: CLAUDE_EXE,
      runNonce: "nonce-of-someone-else",
    }),
  }, { pid: 4812, runNonce: NONCE, expectedExecutable: CLAUDE_EXE });
  assert.equal(captured.ok, false);
  assert.equal(captured.identity, null);
  assert.match(captured.reason, /another run's nonce/);
});

test("P3 executeRun does not mint our nonce over a contradicting observation", async () => {
  let observes = 0;
  const fs = memoryFs();
  const leases = memoryLeases();
  const result = await runWith({
    fs,
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "L-PW-p3" } },
    probe: {
      observe: () => {
        observes += 1;
        if (observes === 1) {
          return {
            outcome: "FOUND",
            reason: "injected",
            pid: 4812,
            creationDate: T0,
            executablePath: CLAUDE_EXE,
            runNonce: "nonce-of-someone-else",
          };
        }
        return HOLDER_GONE;
      },
    },
  });
  assert.ok(result.spawned === true || result.ok === false, result.reason);
  const intentRaw = fs.files.get(join(RUN_ROOT, "intent.json"));
  assert.ok(intentRaw !== undefined, "intent.json must exist");
  const intent = JSON.parse(intentRaw) as { processIdentity?: unknown };
  assert.equal(intent.processIdentity, null);
  const lease = leases.list().find((item) => item.leaseId === "L-PW-p3") ?? result.lease;
  assert.equal(lease?.processIdentity?.startedAt, undefined);
});

// ---------------------------------------------------------------------------
// PROPERTY 4 — unmeasured is not a measured value
// ---------------------------------------------------------------------------

test("P4a an incomplete stream drain does not satisfy logStayedWithinBudget", async () => {
  const hanging = new Readable({
    read() {
      // Detached grandchild holds the pipe; bytes after exit are uncounted.
    },
  });
  const result = await runWith({
    spawn: trackingSpawn(() => exitingProcess({ stdout: hanging })),
    wait: async () => undefined,
  });
  const budget = result.conjunction.findings.find((item) => item.name === "logStayedWithinBudget");
  assert.equal(budget?.ok, false, budget?.reason ?? result.reason);
  assert.equal((result.log as { drainComplete?: boolean } | null)?.drainComplete, false);
  assert.equal(result.ok, false);
});

test("P4b a supplied currentFacts object treats an unreadable frozen key as stale", () => {
  const gate = openGate({
    gateId: "g-p4b",
    missionId: "mission-1",
    type: "DESTRUCTIVE_ACTION_APPROVAL_REQUIRED",
    why: "destroy the worktree only if this SHA is still the world you saw",
    requiredInput: "approve the destructive action",
    at: NOW,
    safeFrozenState: { headAfter: HEAD_AFTER, branch: "executor/oracle" },
    resumeState: "VERIFYING",
  });
  const unread = resolveGate({
    gate,
    approved: true,
    at: HOLDER_EXIT,
    currentFacts: {},
  });
  assert.equal(unread.ok, false);
  assert.equal(unread.gate.status, "SUPERSEDED");
  assert.ok(unread.staleFacts.some((item) => /could not be read/.test(item)), String(unread.staleFacts));

  const unchanged = resolveGate({
    gate,
    approved: true,
    at: HOLDER_EXIT,
    currentFacts: { headAfter: HEAD_AFTER, branch: "executor/oracle" },
  });
  assert.equal(unchanged.ok, true, unchanged.reason);
  assert.equal(unchanged.gate.status, "APPROVED");
  assert.deepEqual(unchanged.staleFacts, []);

  const omitted = resolveGate({
    gate,
    approved: true,
    at: HOLDER_EXIT,
  });
  assert.equal(omitted.ok, true, omitted.reason);
});

test("P4c a skipped result write does not advertise the previous record's path", async () => {
  const fs = memoryFs();
  const first = await runWith({ fs });
  assert.equal(first.ok, true, first.reason);
  assert.ok(first.resultPath !== null);
  const firstBytes = fs.readUtf8(join(RUN_ROOT, "result.json"));
  const second = await runWith({ fs });
  assert.equal(second.ok, false);
  assert.match(second.reason, /recorded completion already exists/);
  assert.equal(second.resultPath, null);
  assert.equal((second as { resultPersisted?: string }).resultPersisted, "skipped");
  assert.equal(fs.readUtf8(join(RUN_ROOT, "result.json")), firstBytes);
});

// ---------------------------------------------------------------------------
// PROPERTY 5 — closed set, closed boundary
// ---------------------------------------------------------------------------

test("P5a createNodeLeaseStore refuses hostile roots including DEFAULT_DIRECTOR_ROOT", () => {
  const hostile = [
    DEFAULT_DIRECTOR_ROOT,
    "C:\\AION\\director",
    join(DEFAULT_DIRECTOR_ROOT, "nested"),
    "NUL",
    "\\\\.\\NUL",
    "C:aion",
    "\\aion",
    "C:\\a\\\u0000b",
    "C:/AIE149~1/store",
  ];
  for (const root of hostile) {
    assert.throws(() => createNodeLeaseStore(root), /lease store root|identifiable|reserved|inside/i, root);
  }
  assert.throws(
    () => sandboxDirectorStoreRoot({ [DIRECTOR_ROOT_ENV]: DEFAULT_DIRECTOR_ROOT }),
    /lease store root|inside|AION\\director/i,
  );
  const isolated = mkdtempSync(join(tmpdir(), "aion-r20-p5a-ok-"));
  try {
    const store = createNodeLeaseStore(isolated);
    assert.equal(store.root, isolated);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
  assert.equal(sandboxDirectorStoreRoot({ [DIRECTOR_ROOT_ENV]: "D:/aion-state" }), "D:/aion-state");
  assert.equal(sandboxDirectorStoreRoot({}), join(tmpdir(), "aion-director-d2-store"));
});

test("P5b holdback keeps the Authorization/Bearer anchor across the 64KiB bound", () => {
  const secret = "SECRETTOKEN123456";
  const pads = [MAX_TOKEN_HOLD - 1, MAX_TOKEN_HOLD, 70_000];
  for (const pad of pads) {
    const stdout = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout, stderr: createMemoryLogSink() },
    });
    log.write("stdout", `Authorization: Bearer${"\n".repeat(pad)}`);
    log.write("stdout", `${secret}\n`);
    log.seal();
    const durable = `${stdout.contents().toString("utf8")}\n${log.fileImage("stdout").toString("utf8")}`;
    assert.equal(durable.includes(secret), false, `Bearer pad=${pad} leaked the secret`);
  }

  const spaces = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: spaces, stderr: createMemoryLogSink() },
  });
  log.write("stdout", `Authorization:${" ".repeat(70_000)}`);
  log.write("stdout", `${secret}\n`);
  log.seal();
  const durable = `${spaces.contents().toString("utf8")}\n${log.fileImage("stdout").toString("utf8")}`;
  assert.equal(durable.includes(secret), false, "Authorization + horizontal whitespace leaked the secret");
});

// ---------------------------------------------------------------------------
// PROPERTY 6 — a guard that can fire, a detector that reads code
// ---------------------------------------------------------------------------

test("P6a ProgramData redirection is not a PRODUCTION_WRITER refusal", async () => {
  const { prepareHostArbitrationLocks, derivedHostArbitrationRoot } = await import("../src/lease-store.js");
  const created: string[] = [];
  const prepared = prepareHostArbitrationLocks(
    { SystemDrive: "C:", ProgramData: join(tmpdir(), "aion-r20-p6a-pd") },
    { mkdir: (path) => { created.push(path); }, resolve: (path) => path },
  );
  assert.equal(prepared.ok, true);
  assert.equal(prepared.ok && prepared.root, derivedHostArbitrationRoot({ SystemDrive: "C:" }));
  assert.ok(created.every((path) => !path.toLowerCase().includes("aion-r20-p6a-pd")));
  const cli = readFileSync(fileURLToPath(new URL("../../../../apps/director-cli.mjs", import.meta.url)), "utf8");
  assert.match(cli, /prepareHostArbitrationLocks/);
  assert.doesNotMatch(cli, /hostProgramDataIsHostFixed/);
  assert.doesNotMatch(cli, /ProgramData is not the host-fixed/);
});

test("P6a the created lock directory is observed, not compared to itself", async () => {
  const { prepareHostArbitrationLocks, derivedHostArbitrationRoot } = await import("../src/lease-store.js");
  const identity = (path: string) => path;
  const honest = prepareHostArbitrationLocks(
    { SystemDrive: "D:" },
    { mkdir() { /* created */ }, resolve: identity },
  );
  assert.equal(honest.ok, true);
  assert.equal(honest.ok && honest.root, derivedHostArbitrationRoot({ SystemDrive: "D:" }));

  const redirectedProgramData = prepareHostArbitrationLocks(
    { SystemDrive: "C:", ProgramData: "D:\\ProgramData" },
    { mkdir() { /* created */ }, resolve: identity },
  );
  assert.equal(redirectedProgramData.ok, true);
  assert.equal(
    redirectedProgramData.ok && redirectedProgramData.root,
    derivedHostArbitrationRoot({ SystemDrive: "C:" }),
  );

  const elsewhere = prepareHostArbitrationLocks(
    { SystemDrive: "C:" },
    { mkdir() { /* created */ }, resolve: () => "Z:\\not-the-derived-locks" },
  );
  assert.equal(elsewhere.ok, false);
  assert.match(
    elsewhere.ok ? "" : elsewhere.reason,
    /created lock directory is not the host-fixed arbitration root/,
  );

  const uncreatable = prepareHostArbitrationLocks(
    { SystemDrive: "C:" },
    { mkdir() { throw new Error("injected-mkdir-denied-r20b"); }, resolve: identity },
  );
  assert.equal(uncreatable.ok, false);
  assert.match(
    uncreatable.ok ? "" : uncreatable.reason,
    /host arbitration root is not creatable/,
  );
  assert.match(uncreatable.ok ? "" : uncreatable.reason, /injected-mkdir-denied-r20b/);
});

test("P6b pathIsInside is inclusive and artifactPathWithinRoot is strictly inside", () => {
  assert.equal(pathIsInside("C:/AION/director", "C:/AION/director"), true);
  assert.equal(artifactPathWithinRoot("C:/AION/director", "C:/AION/director"), false);
  assert.equal(pathIsInside("C:/AION/director/notes.md", "C:/AION/director"), true);
  assert.equal(artifactPathWithinRoot("C:/AION/director", "C:/AION/director/notes.md"), true);
  const extended = "\\\\?\\C:\\AION\\director\\notes.md";
  const extendedRoot = "\\\\?\\C:\\AION\\director";
  assert.equal(artifactPathWithinRoot(extendedRoot, extended), true);
});

test("P6c inspectHostProductionWriterLock does not parse UNKNOWN out of the lock path", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r20-p6c-"));
  try {
    const locks = join(arb, "locks");
    mkdirSync(locks, { recursive: true });
    writeFileSync(join(locks, "production-writer-UNKNOWN.lock"), `${JSON.stringify({
      pid: 4812,
      identity: { pid: 4812, startedAt: T0, runToken: NONCE },
    }, null, 2)}\n`);
    const inspected = inspectHostProductionWriterLock({
      arbitrationRoot: arb,
      probe: {
        observe: () => ({
          outcome: "FOUND",
          reason: "live",
          pid: 4812,
          creationDate: T0,
          executablePath: "C:\\unobserved-lock-holder",
          runNonce: NONCE,
        }),
      },
    });
    assert.equal(inspected.state, "HELD", JSON.stringify(inspected));
  } finally {
    rmSync(arb, { recursive: true, force: true });
  }
});
