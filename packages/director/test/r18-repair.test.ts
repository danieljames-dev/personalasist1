/**
 * Round 18 class repairs. Each case below must fail on a54cb10 and pass after
 * the matching class fix. Helpers are local.
 */
import assert from "node:assert/strict";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createFileLogSink,
  createFixedClock,
  createMemoryLogSink,
  FILE_LOG_BYTES,
} from "../src/bounded-log.js";
import {
  argvGrantsWritePermission,
  executorArgvFor,
  GROK_MAX_TURNS,
} from "../src/executor-adapters.js";
import { LOCAL_ROLES } from "../src/executors.js";
import type { GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1, parseHandoff } from "../src/handoff.js";
import { acquireLease, type LeaseV1 } from "../src/leases.js";
import { RUN_INTENT_SCHEMA_V1 } from "../src/run-intent.js";
import {
  createNodeRunFileSystem,
  createNodeSpawner,
  createNodeWait,
  evaluateSuccessConjunction,
  executeRun,
  killProcessTreeStandIn,
  proveWriterExit,
  wrapChildProcess,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
  type WriterExitProofInputV1,
} from "../src/run-manager.js";
import { persistRunIntent, requireSpawnPermit } from "../src/run-intent.js";
import { writerOrphanScanResult, type ExecutorProcessIdentityV1, type ProcessObservationV1 } from "../src/process-identity.js";

const NOW = "2026-08-13T12:00:00.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const GROK_EXE = "C:\\Tools\\grok.exe";
const CLAUDE_EXE = "C:\\Tools\\claude.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:10.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: GROK_EXE,
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited", pid: 4812 };

function claudeImplementerArgv(): string[] {
  return ["-p", "--permission-mode", "bypassPermissions"];
}

function grokReviewArgv(promptPath = PROMPT, cwd = CWD): string[] {
  return [
    "--prompt-file", promptPath,
    "--cwd", cwd,
    "--permission-mode", "plan",
    "--max-turns", String(GROK_MAX_TURNS),
  ];
}

function matchingDiscovery(): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: GROK_EXE, AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => path === GROK_EXE || path === CLAUDE_EXE,
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
    kill() {
      // unused
    },
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
    kill() {
      // unused
    },
    exit: new Promise(() => {
      // hangs
    }),
    get exited() {
      return false;
    },
  };
}

function trackingSpawn(
  factory: () => SpawnHandleV1,
  onSpawn?: (options: { cwd: string }) => void,
): SpawnFnV1 & { calls: number; probed?: number[] } {
  const spawnFn = ((_exe, _argv, options, permit) => {
    requireSpawnPermit(permit);
    spawnFn.calls += 1;
    onSpawn?.({ cwd: options.cwd });
    return factory();
  }) as SpawnFnV1 & { calls: number };
  spawnFn.calls = 0;
  return spawnFn;
}

function writerLease(over: {
  pid?: number | null;
  processIdentity?: LeaseV1["processIdentity"];
  leaseId?: string;
  runId?: string;
} = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: over.leaseId ?? "lease-pw-1",
    kind: "PRODUCTION_WRITER",
    resource: "aion-production",
    missionId: "mission-1",
    runId: over.runId ?? "run-1",
    pid: over.pid === undefined ? 4812 : over.pid,
    processIdentity: over.processIdentity ?? { pid: 4812, startedAt: T0, runToken: NONCE },
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

function recordedSpawnIntent(identity: ExecutorProcessIdentityV1): string {
  return JSON.stringify({
    schema: RUN_INTENT_SCHEMA_V1,
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
    spawnPid: identity.pid,
    spawnObservedAt: T0,
    processIdentity: identity,
    secretsPresent: false,
    role: "IMPLEMENT",
  });
}

async function runAdopted(over: {
  intentIdentity: ExecutorProcessIdentityV1;
  probe?: ProcessObservationV1;
  scanOrphans?: NonNullable<RunManagerDepsV1["scanOrphans"]>;
  observePids?: number[];
}): Promise<{
  released: boolean;
  rows: number;
  probed: number[];
  createdNotBefore: string | null;
}> {
  const probed: number[] = [];
  let createdNotBefore: string | null = null;
  const leases = memoryLeases([writerLease()]);
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "intent.json")]: recordedSpawnIntent(over.intentIdentity) },
  });
  const result = await executeRun(
    request({ lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1" } }),
    {
      clock: createFixedClock(HOLDER_EXIT),
      fs,
      spawn: trackingSpawn(() => exitingProcess()),
      git: matchingGit(),
      probe: {
        observe(pid) {
          probed.push(pid);
          return over.probe ?? {
            outcome: "FOUND",
            reason: "live",
            pid: 4812,
            creationDate: T0,
            executablePath: GROK_EXE,
            runNonce: NONCE,
          };
        },
      },
      capacity: memoryCapacity(),
      leases,
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: (query) => {
        createdNotBefore = query.createdNotBefore;
        return over.scanOrphans === undefined ? writerOrphanScanResult([]) : over.scanOrphans(query);
      },
      resolveArtifactPath: (absolutePath) => absolutePath,
      ...matchingDiscovery(),
    },
  );
  return {
    released: result.productionWriterLeaseReleasedByThisRun,
    rows: leases.list().length,
    probed,
    createdNotBefore,
  };
}

function greenConjunctionInput(
  over: Partial<Parameters<typeof evaluateSuccessConjunction>[0]> = {},
): Parameters<typeof evaluateSuccessConjunction>[0] {
  const parsed = parseHandoff(goodHandoff(over.parsed === undefined ? {} : {}));
  return {
    exitCode: 0,
    stillRunning: false,
    executor: "claude" as const,
    output: "",
    parsed: parsed.ok
      ? parsed
      : { ok: false as const, handoff: null, problems: parsed.problems },
    reportedWorkItemId: "work-1",
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: {
      schema: "aion.director.git-observation.v1" as const,
      worktreePath: CWD,
      collectedAt: HOLDER_EXIT,
      head: { outcome: "FOUND" as const, sha: HEAD_AFTER },
      branch: { outcome: "ATTACHED" as const, name: "executor/oracle" },
      upstream: { outcome: "NO_UPSTREAM" as const },
      status: { outcome: "CLEAN" as const, porcelain: "" as const },
    },
    gitBefore: {
      schema: "aion.director.git-observation.v1" as const,
      worktreePath: CWD,
      collectedAt: NOW,
      head: { outcome: "FOUND" as const, sha: HEAD_BEFORE },
      branch: { outcome: "ATTACHED" as const, name: "executor/oracle" },
      upstream: { outcome: "NO_UPSTREAM" as const },
      status: { outcome: "CLEAN" as const, porcelain: "" as const },
    },
    gitVerdict: {
      schema: "aion.director.git-truth.v1" as const,
      ok: true,
      findings: [],
      snapshot: {
        worktreePath: CWD,
        attachedBranch: "executor/oracle",
        head: HEAD_AFTER,
        localBranchHead: HEAD_AFTER,
        remoteBranchHead: null,
        originMainHead: null,
        dirtyPaths: [],
        largeTrackedFiles: [],
        readAt: HOLDER_EXIT,
      },
    },
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "every declared artifact is inside the run root",
    executorTreeGone: true,
    executorTreeReason: "no process attributable to this run by nonce, holder chain, or the parentless/broker window remains",
    timedOut: false,
    logStayedWithinBudget: true,
    role: "IMPLEMENT" as const,
    argvGrantedWrite: true,
    spawnedAtFloor: NOW,
    observedCompletedAt: HOLDER_EXIT,
    expectedRunNonce: NONCE,
    processWasCreated: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1a — intent.json cannot replace the Director-owned holder identity
// ---------------------------------------------------------------------------

test("1a forged intent pid does not release a live holder and the probe uses the row pid", async () => {
  const out = await runAdopted({
    intentIdentity: { ...RECORDED, pid: 777 },
  });
  assert.equal(out.released, false);
  assert.equal(out.rows, 1);
  assert.ok(out.probed.includes(4812), `probed ${out.probed.join(",")}`);
  assert.equal(out.probed.includes(777), false);
});

test("1a forged intent runToken with the row pid still withholds", async () => {
  const out = await runAdopted({
    intentIdentity: { ...RECORDED, runNonce: "forged-token" },
  });
  assert.equal(out.released, false);
  assert.equal(out.rows, 1);
  assert.ok(out.probed.includes(4812), `probed ${out.probed.join(",")}`);
});

test("1a forged intent startedAt does not become the orphan scan floor", async () => {
  const out = await runAdopted({
    intentIdentity: { ...RECORDED, creationDate: "2099-01-01T00:00:00.000Z" },
    probe: HOLDER_GONE,
    scanOrphans: () => writerOrphanScanResult([]),
  });
  assert.notEqual(out.createdNotBefore, "2099-01-01T00:00:00.000Z");
  assert.equal(out.createdNotBefore, T0);
});

test("1a liveness: honest intent plus NOT_FOUND releases the writer", async () => {
  const out = await runAdopted({
    intentIdentity: RECORDED,
    probe: HOLDER_GONE,
    scanOrphans: () => writerOrphanScanResult([]),
  });
  assert.equal(out.released, true);
  assert.equal(out.rows, 0);
});

// ---------------------------------------------------------------------------
// 1b — handoff is bound by a minted nonce, a ceiling, and pre-spawn absence
// ---------------------------------------------------------------------------

test("1b a future finishedAt with a foreign runNonce fails naming the nonce, not the timestamp", () => {
  const parsed = parseHandoff(goodHandoff({
    runNonce: "foreign-nonce",
    finishedAt: "2099-01-01T00:00:00.000Z",
  }));
  const conjunction = evaluateSuccessConjunction(greenConjunctionInput({
    parsed,
    expectedRunNonce: NONCE,
    spawnedAtFloor: NOW,
    observedCompletedAt: HOLDER_EXIT,
  }));
  assert.equal(conjunction.ok, false);
  assert.ok(conjunction.failedConjuncts.includes("handoffParsed"));
  const finding = conjunction.findings.find((item) => item.name === "handoffParsed");
  assert.ok(finding);
  assert.match(finding.reason, /nonce/i);
  assert.doesNotMatch(finding.reason, /timestamp|precedes|after this run's observed completion/i);
});

test("1b missing runNonce on a future-dated handoff fails naming the nonce", () => {
  const parsed = parseHandoff(goodHandoff({
    runNonce: undefined,
    finishedAt: "2099-01-01T00:00:00.000Z",
  }));
  assert.equal(parsed.ok, false);
  const conjunction = evaluateSuccessConjunction(greenConjunctionInput({ parsed }));
  assert.equal(conjunction.ok, false);
  const finding = conjunction.findings.find((item) => item.name === "handoffParsed");
  assert.ok(finding);
  assert.match(finding.reason, /nonce/i);
});

test("1b correct nonce with finishedAt after the Director-observed completion is refused", () => {
  const parsed = parseHandoff(goodHandoff({
    runNonce: NONCE,
    finishedAt: "2026-08-13T12:00:30.000Z",
  }));
  const conjunction = evaluateSuccessConjunction(greenConjunctionInput({
    parsed,
    expectedRunNonce: NONCE,
    spawnedAtFloor: NOW,
    observedCompletedAt: HOLDER_EXIT,
  }));
  assert.equal(conjunction.ok, false);
  const finding = conjunction.findings.find((item) => item.name === "handoffParsed");
  assert.ok(finding);
  assert.match(finding.reason, /after this run's observed completion/i);
});

test("1b a pre-existing handoff.json is refused before spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const fs = memoryFs({
    files: { [join(RUN_ROOT, "handoff.json")]: JSON.stringify(goodHandoff()) },
  });
  const result = await executeRun(request(), {
    clock: createFixedClock(HOLDER_EXIT),
    fs,
    spawn,
    git: matchingGit(),
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    capacity: memoryCapacity(),
    leases: memoryLeases(),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([]),
    ...matchingDiscovery(),
  });
  assert.equal(result.spawned, false, result.reason);
  assert.equal(spawn.calls, 0);
  assert.match(result.reason, /already exists|pre-existing/i);
});

test("1b liveness: a stub that echoes AION_RUN_NONCE with an in-window finishedAt succeeds", async () => {
  const fs = memoryFs();
  const spawn = trackingSpawn(() => exitingProcess(), () => {
    fs.writeDurable(join(RUN_ROOT, "handoff.json"), JSON.stringify(goodHandoff()));
  });
  const result = await executeRun(request(), {
    clock: createFixedClock(HOLDER_EXIT),
    fs,
    spawn,
    git: matchingGit(HEAD_AFTER, { advance: true }),
    probe: {
      observe: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n === 1
            ? {
              outcome: "FOUND" as const,
              reason: "live",
              pid: 4812,
              creationDate: T0,
              executablePath: CLAUDE_EXE,
              runNonce: NONCE,
            }
            : HOLDER_GONE;
        };
      })(),
    },
    capacity: memoryCapacity(),
    leases: memoryLeases(),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([]),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.conjunction.failedConjuncts.length, 0);
  assert.equal(result.conjunction.findings.every((item) => item.ok), true);
});

// ---------------------------------------------------------------------------
// 1c — WORKTREE lease resource is the directory the child runs in
// ---------------------------------------------------------------------------

test("1c two overlapping executeRun calls with the same cwd and divergent WORKTREE resources spawn once", async () => {
  const spawn = trackingSpawn(() => hangingProcess());
  const sharedLeases = memoryLeases();
  const deps = (): RunManagerDepsV1 => ({
    clock: createFixedClock(NOW),
    fs: memoryFs(),
    spawn,
    git: matchingGit(),
    probe: { observe: () => ({ outcome: "FOUND", reason: "live", pid: 4812, creationDate: T0, runNonce: NONCE }) },
    capacity: {
      tryAcquire() {
        return { ok: true, reason: "ok" };
      },
      release() {
        // unused
      },
    },
    leases: sharedLeases,
    wait: (ms) => new Promise((resolve) => {
      setTimeout(resolve, Math.min(ms, 20));
    }),
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([]),
    ...matchingDiscovery(),
  });
  const firstP = executeRun(
    request({
      runId: "run-1",
      timeoutMs: 200,
      lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-a" },
    }),
    deps(),
  );
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  const second = await executeRun(
    request({
      runId: "run-2",
      timeoutMs: 200,
      lease: { kind: "WORKTREE", resource: "C:\\some-other-place", leaseId: "lease-b" },
    }),
    deps(),
  );
  assert.equal(second.spawned, false, second.reason);
  assert.equal(spawn.calls, 1);
  assert.match(second.reason, /WORKTREE lease resource is not the directory/i);
  await firstP;
});

test("1c WORKTREE resource forms that host-path already normalises are accepted", async () => {
  const cases: ReadonlyArray<{ resource: string; leaseId: string }> = [
    { resource: "C:\\wt", leaseId: "lease-bs" },
    { resource: "C:/wt", leaseId: "lease-fs" },
    { resource: "c:\\wt\\", leaseId: "lease-trail" },
  ];
  for (const { resource, leaseId } of cases) {
    const spawn = trackingSpawn(() => exitingProcess());
    const fs = memoryFs();
    const result = await executeRun(
      request({ lease: { kind: "WORKTREE", resource, leaseId } }),
      {
        clock: createFixedClock(HOLDER_EXIT),
        fs,
        spawn: (exe, argv, options, permit) => {
          fs.writeDurable(join(RUN_ROOT, "handoff.json"), JSON.stringify(goodHandoff()));
          return spawn(exe, argv, options, permit);
        },
        git: matchingGit(HEAD_AFTER, { advance: true }),
        probe: {
          observe: (() => {
            let n = 0;
            return () => {
              n += 1;
              return n === 1
                ? {
                  outcome: "FOUND" as const,
                  reason: "live",
                  pid: 4812,
                  creationDate: T0,
                  executablePath: CLAUDE_EXE,
                  runNonce: NONCE,
                }
                : HOLDER_GONE;
            };
          })(),
        },
        capacity: memoryCapacity(),
        leases: memoryLeases(),
        wait: async () => undefined,
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        resolveArtifactPath: (absolutePath) => absolutePath,
        ...matchingDiscovery(),
      },
    );
    assert.equal(result.spawned, true, `${resource}: ${result.reason}`);
  }
});

// ---------------------------------------------------------------------------
// 2 — one routing predicate, both entry points, all three partitions
// ---------------------------------------------------------------------------

test("2 executeRun with claude + INDEPENDENT_ACCEPTANCE is refused before spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await executeRun(
    request({
      executor: "claude",
      executablePath: CLAUDE_EXE,
      role: "INDEPENDENT_ACCEPTANCE",
      argv: claudeImplementerArgv(),
    }),
    {
      clock: createFixedClock(NOW),
      fs: memoryFs(),
      spawn,
      git: matchingGit(),
      probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
      capacity: memoryCapacity(),
      leases: memoryLeases(),
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: () => writerOrphanScanResult([]),
      ...matchingDiscovery(),
    },
  );
  assert.equal(result.spawned, false, result.reason);
  assert.equal(spawn.calls, 0);
  assert.match(result.reason, /routed to grok/i);
});

test("2 executeRun with grok + IMPLEMENT is refused before spawn", async () => {
  const spawn = trackingSpawn(() => exitingProcess());
  const result = await executeRun(
    request({
      executor: "grok",
      executablePath: GROK_EXE,
      role: "IMPLEMENT",
      argv: grokReviewArgv(),
    }),
    {
      clock: createFixedClock(NOW),
      fs: memoryFs(),
      spawn,
      git: matchingGit(),
      probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
      capacity: memoryCapacity(),
      leases: memoryLeases(),
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: () => writerOrphanScanResult([]),
      ...matchingDiscovery(),
    },
  );
  assert.equal(result.spawned, false, result.reason);
  assert.equal(spawn.calls, 0);
  assert.match(result.reason, /routed to claude/i);
});

test("2 executeRun with each LOCAL role is refused before spawn", async () => {
  for (const role of LOCAL_ROLES) {
    const spawn = trackingSpawn(() => exitingProcess());
    const result = await executeRun(
      request({ role, executor: "claude", executablePath: CLAUDE_EXE, argv: claudeImplementerArgv() }),
      {
        clock: createFixedClock(NOW),
        fs: memoryFs(),
        spawn,
        git: matchingGit(),
        probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
        capacity: memoryCapacity(),
        leases: memoryLeases(),
        wait: async () => undefined,
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        ...matchingDiscovery(),
      },
    );
    assert.equal(result.spawned, false, `${role}: ${result.reason}`);
    assert.equal(spawn.calls, 0, role);
    assert.match(result.reason, /local role|routed to local/i);
  }
});

test("2 evaluateSuccessConjunction fails when argv granted write to a non-write role", () => {
  const conjunction = evaluateSuccessConjunction(greenConjunctionInput({
    role: "INDEPENDENT_ACCEPTANCE",
    argvGrantedWrite: true,
    executor: "grok",
  }));
  assert.equal(conjunction.ok, false);
  assert.ok(conjunction.failedConjuncts.includes("writeRoleWasGrantedWritePermission"));
  const finding = conjunction.findings.find((item) => item.name === "writeRoleWasGrantedWritePermission");
  assert.ok(finding);
  assert.match(finding.reason, /argv granted write/i);
});

test("2 liveness: honest claude IMPLEMENT and grok INDEPENDENT_ACCEPTANCE still reach ok", async () => {
  assert.ok(executorArgvFor("claude", { promptPath: PROMPT, cwd: CWD, role: "IMPLEMENT" }));
  assert.ok(executorArgvFor("grok", { promptPath: PROMPT, cwd: CWD, role: "INDEPENDENT_ACCEPTANCE" }));
  const write = evaluateSuccessConjunction(greenConjunctionInput({
    role: "IMPLEMENT",
    argvGrantedWrite: true,
    executor: "claude",
  }));
  assert.equal(write.ok, true, write.failedConjuncts.join(","));
  const reviewHandoff = parseHandoff(goodHandoff({ headAfter: HEAD_BEFORE }));
  const review = evaluateSuccessConjunction(greenConjunctionInput({
    role: "INDEPENDENT_ACCEPTANCE",
    argvGrantedWrite: false,
    executor: "grok",
    parsed: reviewHandoff,
    gitAfter: {
      schema: "aion.director.git-observation.v1",
      worktreePath: CWD,
      collectedAt: HOLDER_EXIT,
      head: { outcome: "FOUND", sha: HEAD_BEFORE },
      branch: { outcome: "ATTACHED", name: "executor/oracle" },
      upstream: { outcome: "NO_UPSTREAM" },
      status: { outcome: "CLEAN" as const, porcelain: "" as const },
    },
    gitBefore: {
      schema: "aion.director.git-observation.v1",
      worktreePath: CWD,
      collectedAt: NOW,
      head: { outcome: "FOUND", sha: HEAD_BEFORE },
      branch: { outcome: "ATTACHED", name: "executor/oracle" },
      upstream: { outcome: "NO_UPSTREAM" },
      status: { outcome: "CLEAN" as const, porcelain: "" as const },
    },
    treeIncludingIgnored: { outcome: "CLEAN" as const, porcelain: "" as const },
    treeIncludingIgnoredBefore: { outcome: "CLEAN" as const, porcelain: "" as const },
  }));
  assert.equal(review.ok, true, review.failedConjuncts.join(","));
});

// ---------------------------------------------------------------------------
// 3 — omitted / empty / null nonce denies on the identity-absent branch
// ---------------------------------------------------------------------------

test("3 proveWriterExit identity-absent denies when runNonce is omitted, empty, or null", () => {
  const sightings = [{
    pid: 7777,
    name: "node.exe",
    parentPid: 4900,
    parentPresent: false,
    nonceReadable: true,
    runNonce: NONCE,
    creationDate: T0,
  }];
  const base: WriterExitProofInputV1 = {
    processStillRunning: false,
    recordedLeaseKind: "PRODUCTION_WRITER",
    recordedLeaseId: "lease-pw-1",
    recordedIdentity: null,
    observation: HOLDER_GONE,
    probedPid: 4812,
    orphanScanPerformed: true,
    orphanSightings: sightings,
    liveSightings: [],
    ownedHandleExit: {
      spawnOccurred: true,
      handleExited: true,
      exitSettledWithCode: true,
      identityAbsentBecauseAlreadyExited: true,
    },
  };
  assert.equal(proveWriterExit(base), null);
  assert.equal(proveWriterExit({ ...base, runNonce: "" }), null);
  assert.equal(proveWriterExit({ ...base, runNonce: null }), null);
});

test("3 liveness: a correct nonce and empty sightings still mints the identity-absent proof", () => {
  const proof = proveWriterExit({
    processStillRunning: false,
    recordedLeaseKind: "PRODUCTION_WRITER",
    recordedLeaseId: "lease-pw-1",
    recordedIdentity: null,
    observation: HOLDER_GONE,
    probedPid: 4812,
    orphanScanPerformed: true,
    orphanSightings: [],
    liveSightings: [],
    runNonce: NONCE,
    ownedHandleExit: {
      spawnOccurred: true,
      handleExited: true,
      exitSettledWithCode: true,
      identityAbsentBecauseAlreadyExited: true,
    },
  });
  assert.notEqual(proof, null);
});

// ---------------------------------------------------------------------------
// 4 — a stdin EOF cannot kill the Director
// ---------------------------------------------------------------------------

test("4 createNodeSpawner with a >128 KiB stdin payload to an instant-exit child returns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r18-stdin-"));
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => {
    uncaught.push(error);
  };
  process.on("uncaughtException", onUncaught);
  try {
    const persisted = persistRunIntent({
      intentPath: join(dir, "intent.json"),
      runId: "run-stdin",
      missionId: "mission-1",
      workItemId: "work-1",
      worktree: dir,
      branch: "executor/oracle",
      executablePath: process.execPath,
      argv: ["-e", "process.exit(0)"],
      cwd: dir,
      runNonce: "nonce-stdin",
      now: NOW,
    });
    assert.equal(persisted.ok, true);
    if (!persisted.ok) return;
    const spawn = createNodeSpawner();
    const payload = "P".repeat(200 * 1024);
    const handle = spawn(
      process.execPath,
      ["-e", "process.exit(0)"],
      { cwd: dir, env: { AION_RUN_NONCE: "nonce-stdin" }, shell: false, windowsHide: true, stdin: payload },
      persisted.permit,
    );
    const ended = await handle.exit;
    assert.equal(typeof ended.code === "number" || ended.code === null, true);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", onUncaught);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("4 executeRun with the real node spawner and a large Claude stdin still writes result.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r18-stdin-e2e-"));
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => {
    uncaught.push(error);
  };
  process.on("uncaughtException", onUncaught);
  const promptPath = join(dir, "PROMPT.md");
  writeFileSync(promptPath, `${"P".repeat(200 * 1024)}\n`);
  const runRoot = join(dir, "run");
  const fs = createNodeRunFileSystem();
  fs.mkdirp(runRoot);
  const leases = memoryLeases();
  try {
    const result = await executeRun(
      {
        runId: "run-stdin-e2e",
        missionId: "mission-1",
        workItemId: "work-1",
        executor: "claude",
        worktree: dir,
        branch: null,
        executablePath: process.execPath,
        argv: claudeImplementerArgv(),
        cwd: dir,
        runNonce: "nonce-stdin-e2e",
        runRoot,
        promptPath,
        timeoutMs: 15_000,
        lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-stdin-e2e" },
        authorisedProductionMutated: false,
        role: "IMPLEMENT",
      },
      {
        clock: { now: () => new Date().toISOString() },
        fs,
        spawn: createNodeSpawner(),
        git: matchingGit(HEAD_AFTER, { inspectedWorktree: dir }),
        probe: { observe: (pid) => ({ outcome: "NOT_FOUND", reason: "gone", pid }) },
        capacity: memoryCapacity(),
        leases,
        wait: createNodeWait(),
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        resolveArtifactPath: (absolutePath) => absolutePath,
        discoveryEnv: { AION_CLAUDE_CODE_PATH: process.execPath },
        discoveryFs: {
          isFile: (path) => path === process.execPath || existsSync(path),
          readDir: () => [],
        },
      },
    );
    assert.equal(result.spawned, true, result.reason);
    assert.equal(existsSync(join(runRoot, "result.json")), true);
    assert.equal(typeof result.productionWriterLeaseReleasedByThisRun, "boolean");
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", onUncaught);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5 — constructing a log sink does not destroy previous evidence
// ---------------------------------------------------------------------------

test("5 createFileLogSink over an existing file, never written, leaves the bytes unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r18-sink-"));
  const filePath = join(dir, "stderr.log");
  writeFileSync(filePath, "already-here");
  try {
    createFileLogSink(filePath);
    assert.equal(readFileSync(filePath, "utf8"), "already-here");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("5 a refused second CLI invocation leaves stdout.log and stderr.log byte-identical", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  assert.equal(existsSync(cli), true);
  const dir = mkdtempSync(join(tmpdir(), "aion-r18-cli-logs-"));
  const worktree = join(dir, "wt");
  const runRoot = join(dir, "run");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(worktree);
  mkdirSync(runRoot);
  const promptPath = join(worktree, "PROMPT.md");
  writeFileSync(promptPath, "accept\n");
  spawnSync("git", ["init"], { cwd: worktree, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "r18@example.test"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["config", "user.name", "r18"], { cwd: worktree, windowsHide: true });
  writeFileSync(join(worktree, "seed.txt"), "seed\n");
  spawnSync("git", ["add", "seed.txt", "PROMPT.md"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["commit", "-m", "seed"], { cwd: worktree, windowsHide: true });
  const args = [
    cli,
    "--run-id", "run-cli-logs",
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
    "--lease-id", "lease-cli-logs",
    "--run-nonce", "nonce-cli-logs",
  ];
  const env = {
    ...process.env,
    AION_GROK_PATH: process.execPath,
    AION_DIRECTOR_ROOT: join(dir, "store"),
  };
  try {
    spawnSync(process.execPath, args, {
      cwd: join(here, "..", "..", "..", ".."),
      encoding: "utf8",
      windowsHide: true,
      env,
      timeout: 60_000,
    });
    const stdoutPath = join(runRoot, "stdout.log");
    const stderrPath = join(runRoot, "stderr.log");
    const resultPath = join(runRoot, "result.json");
    assert.equal(existsSync(resultPath), true);
    const stdoutBefore = existsSync(stdoutPath) ? readFileSync(stdoutPath) : Buffer.alloc(0);
    const stderrBefore = existsSync(stderrPath) ? readFileSync(stderrPath) : Buffer.alloc(0);
    const resultBefore = readFileSync(resultPath);
    const second = spawnSync(process.execPath, args, {
      cwd: join(here, "..", "..", "..", ".."),
      encoding: "utf8",
      windowsHide: true,
      env,
      timeout: 60_000,
    });
    assert.notEqual(second.status, 0);
    const stdoutAfter = existsSync(stdoutPath) ? readFileSync(stdoutPath) : Buffer.alloc(0);
    const stderrAfter = existsSync(stderrPath) ? readFileSync(stderrPath) : Buffer.alloc(0);
    assert.deepEqual(stdoutAfter, stdoutBefore);
    assert.deepEqual(stderrAfter, stderrBefore);
    assert.deepEqual(readFileSync(resultPath), resultBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("5 liveness: first append still creates the file and an 8 MiB flood still tails", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r18-sink-live-"));
  const filePath = join(dir, "stdout.log");
  try {
    const sink = createFileLogSink(filePath);
    assert.equal(existsSync(filePath), false);
    sink.append(Buffer.from("hello\n"));
    assert.equal(existsSync(filePath), true);
    assert.equal(readFileSync(filePath, "utf8"), "hello\n");
    const flood = Buffer.alloc(FILE_LOG_BYTES + 100, 0x41);
    sink.replace(flood);
    assert.equal(statSync(filePath).size, flood.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6 — undecidable rows are diagnosable
// ---------------------------------------------------------------------------

test("6 an undecidable parentless row names pid and name in the tree reason", async () => {
  const fs = memoryFs();
  const result = await executeRun(request({
    lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-undec" },
  }), {
    clock: createFixedClock(HOLDER_EXIT),
    fs,
    spawn: (exe, argv, options, permit) => {
      fs.writeDurable(join(RUN_ROOT, "handoff.json"), JSON.stringify(goodHandoff()));
      requireSpawnPermit(permit);
      return exitingProcess();
    },
    git: matchingGit(HEAD_AFTER, { advance: true }),
    probe: {
      observe: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n === 1
            ? {
              outcome: "FOUND" as const,
              reason: "live",
              pid: 4812,
              creationDate: T0,
              executablePath: CLAUDE_EXE,
              runNonce: NONCE,
            }
            : HOLDER_GONE;
        };
      })(),
    },
    capacity: memoryCapacity(),
    leases: memoryLeases(),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([{
      pid: 37420,
      name: "head.exe",
      parentPid: 1,
      parentPresent: false,
      nonceReadable: true,
      creationDate: HOLDER_EXIT,
    }]),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  });
  assert.equal(result.ok, false, result.reason);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.ok(tree);
  assert.match(tree.reason, /37420/);
  assert.match(tree.reason, /head\.exe/);
  assert.match(result.reason, /37420|executorTreeIsGone/);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
});

test("6 liveness: a clean scan still reports the tree gone and still releases the writer", async () => {
  const fs = memoryFs();
  const leases = memoryLeases();
  const result = await executeRun(request({
    lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-clean" },
  }), {
    clock: createFixedClock(HOLDER_EXIT),
    fs,
    spawn: (exe, argv, options, permit) => {
      fs.writeDurable(join(RUN_ROOT, "handoff.json"), JSON.stringify(goodHandoff()));
      requireSpawnPermit(permit);
      return exitingProcess();
    },
    git: matchingGit(HEAD_AFTER, { advance: true }),
    probe: {
      observe: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n === 1
            ? {
              outcome: "FOUND" as const,
              reason: "live",
              pid: 4812,
              creationDate: T0,
              executablePath: CLAUDE_EXE,
              runNonce: NONCE,
            }
            : HOLDER_GONE;
        };
      })(),
    },
    capacity: memoryCapacity(),
    leases,
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([]),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  });
  assert.equal(result.ok, true, result.reason);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.ok(tree);
  assert.equal(tree.ok, true);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
  assert.equal(leases.list().length, 0);
});

// ---------------------------------------------------------------------------
// 7 — Owner / capacity conjuncts, distinct CLI exit, kill-tree test
// ---------------------------------------------------------------------------

test("7 a parsed handoff with requiresOwner true is not autonomous success", () => {
  const parsed = parseHandoff(goodHandoff({ requiresOwner: true }));
  const conjunction = evaluateSuccessConjunction(greenConjunctionInput({ parsed }));
  assert.equal(conjunction.ok, false);
  assert.ok(conjunction.failedConjuncts.includes("ownerNotRequired"));
  const finding = conjunction.findings.find((item) => item.name === "ownerNotRequired");
  assert.ok(finding);
  assert.match(finding.reason, /Owner/i);
});

test("7 CAPACITY_EXHAUSTED is not autonomous success", () => {
  const parsed = parseHandoff(goodHandoff({ capacityStatus: "CAPACITY_EXHAUSTED" }));
  const conjunction = evaluateSuccessConjunction(greenConjunctionInput({ parsed }));
  assert.equal(conjunction.ok, false);
  assert.ok(conjunction.failedConjuncts.includes("capacityNotExhausted"));
});

test("7 liveness: requiresOwner false and AVAILABLE still reach ok", () => {
  const parsed = parseHandoff(goodHandoff({ requiresOwner: false, capacityStatus: "AVAILABLE" }));
  const conjunction = evaluateSuccessConjunction(greenConjunctionInput({ parsed }));
  assert.equal(conjunction.ok, true, conjunction.failedConjuncts.join(","));
});

test("7 CLI Owner-required exit is distinct from 0 and from ordinary failure", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  const dir = mkdtempSync(join(tmpdir(), "aion-r18-owner-exit-"));
  const worktree = join(dir, "wt");
  const runRoot = join(dir, "run");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(worktree);
  const promptPath = join(worktree, "PROMPT.md");
  writeFileSync(promptPath, "need owner\n");
  spawnSync("git", ["init"], { cwd: worktree, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "r18@example.test"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["config", "user.name", "r18"], { cwd: worktree, windowsHide: true });
  writeFileSync(join(worktree, "seed.txt"), "seed\n");
  spawnSync("git", ["add", "seed.txt", "PROMPT.md"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["commit", "-m", "seed"], { cwd: worktree, windowsHide: true });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: worktree, windowsHide: true, encoding: "utf8" }).stdout.trim();
  const branch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], {
    cwd: worktree,
    windowsHide: true,
    encoding: "utf8",
  }).stdout.trim() || "master";
  const stubDir = mkdtempSync(join(tmpdir(), "aion-r18-owner-stub-"));
  const stub = compileEchoStub(stubDir);
  const handoff = JSON.stringify(goodHandoff({
    runId: "run-owner",
    branch,
    headBefore: head,
    headAfter: head,
    artifacts: [],
    requiresOwner: true,
    nextRecommendedGate: "PRODUCTION_DEPLOY_APPROVAL_REQUIRED",
    summary: "I need the Owner to approve a production deploy before this is safe.",
  }));
  try {
    const launched = spawnSync(process.execPath, [
      cli,
      "--run-id", "run-owner",
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
      "--lease-id", "lease-owner-1",
      "--run-nonce", "nonce-owner-1",
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
    assert.notEqual(launched.status, 0);
    assert.notEqual(launched.status, 1);
    assert.equal(launched.status, 3, `${launched.stdout}\n${launched.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("7 killProcessTreeStandIn stops a real three-deep process tree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r18-tree-"));
  const script = join(dir, "tree.mjs");
  writeFileSync(script, `
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 10000)"], { detached: false, stdio: "ignore", windowsHide: true });
process.stdout.write(String(child.pid));
setInterval(() => {}, 10000);
`);
  const root = nodeSpawn(process.execPath, [script], {
    cwd: dir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const midPid = await new Promise<number>((resolve, reject) => {
    let buf = "";
    root.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const n = Number(buf.trim());
      if (Number.isInteger(n) && n > 0) resolve(n);
    });
    root.on("error", reject);
    setTimeout(() => reject(new Error("tree did not report a child pid")), 5_000);
  });
  assert.ok(root.pid && root.pid > 0);
  try {
    killProcessTreeStandIn(root.pid);
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    const stillRoot = spawnSync("tasklist", ["/FI", `PID eq ${root.pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const stillMid = spawnSync("tasklist", ["/FI", `PID eq ${midPid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(/node\.exe/i.test(stillRoot.stdout), false, stillRoot.stdout);
    assert.equal(/node\.exe/i.test(stillMid.stdout), false, stillMid.stdout);
  } finally {
    try { root.kill(); } catch { /* already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

function compileEchoStub(dir: string): string {
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
  throw new Error("csc.exe not available to compile the echo stub");
}
