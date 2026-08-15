/**
 * Round 12 class repairs. Each case below fails on
 * 3d43ffa1f42277cae0d6bb4eb3ab14d233a47014 and must stay failed until the
 * matching class fix is in.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  MAX_TOKEN_HOLD,
} from "../src/bounded-log.js";
import { GROK_MAX_TURNS } from "../src/executor-adapters.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import {
  acquireLease,
  reclaimStaleLease,
  type LeaseV1,
} from "../src/leases.js";
import { createNodeLeaseStore } from "../src/lease-store.js";
import {
  createWindowsOrphanScanner,
  interpretWindowsOrphanScanOutput,
  observedCreationIsStrictlyLater,
  processRowMakesScanUndecidable,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
  writerOrphanScanResult,
} from "../src/process-identity.js";
import { requireSpawnPermit } from "../src/run-intent.js";
import {
  createNodeRunFileSystem,
  executeRun,
  launchRun,
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
const LONG_AGO = "2026-08-13T10:00:00.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const EXE = "C:\\Tools\\grok.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: EXE,
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited", pid: 4812 };

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
  const claude = "C:\\Tools\\claude.exe";
  return {
    discoveryEnv: { AION_GROK_PATH: EXE, AION_CLAUDE_CODE_PATH: claude },
    discoveryFs: {
      isFile: (path) => path === EXE || path === claude || path === exe,
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

function gitResult(argv: readonly string[], over: Partial<GitCommandResultV1> = {}): GitCommandResultV1 {
  return {
    argv: [...argv],
    status: over.status ?? 0,
    stdout: over.stdout ?? "",
    stderr: over.stderr ?? "",
    error: over.error ?? null,
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
    leases?: LeaseStoreV1;
    scanOrphans?: RunManagerDepsV1["scanOrphans"];
    neverWait?: boolean;
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
    clock: over.clock ?? createFixedClock(NOW),
    fs,
    spawn: (executable, argv, options, permit) => {
      if (handoffText !== null) {
        try { fs.writeDurable(handoffPath, handoffText); } catch { /* conjunction records absence */ }
      }
      return (over.spawn ?? trackingSpawn(() => exitingProcess()))(executable, argv, options, permit);
    },
    git: matchingGit(HEAD_AFTER, { advance: true }),
    probe: sequentialProbe([
      foundObservation({ ...RECORDED, executablePath: "C:\\Tools\\claude.exe" }),
      HOLDER_GONE,
    ]),
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.neverWait === true ? (() => new Promise(() => {})) : async () => undefined,
    killTree: () => undefined,
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
  };
  return executeRun(request(over.request), deps);
}

function staleWriter(over: { identity?: LeaseV1["processIdentity"]; pid?: number } = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-stale-pw",
    kind: "PRODUCTION_WRITER",
    resource: "default",
    missionId: "mission-old",
    runId: "run-old",
    pid: over.pid ?? 100,
    now: LONG_AGO,
    ...(over.identity !== undefined ? { processIdentity: over.identity } : {}),
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

// ---------------------------------------------------------------------------
// C1
// ---------------------------------------------------------------------------

test("C1 reclaim of FOUND occupant with an earlier startedAt is IDENTITY_UNVERIFIABLE", () => {
  const recorded = { pid: 100, startedAt: "2026-08-13T10:00:00.000Z", runToken: "run-a" };
  const reclaimed = reclaimStaleLease({
    existing: [staleWriter({ identity: recorded })],
    kind: "PRODUCTION_WRITER",
    resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: "2026-08-13T09:00:00.000Z", runToken: "run-a" },
    now: NOW,
  });
  assert.equal(reclaimed.ok, false);
  assert.equal(reclaimed.refusal, "IDENTITY_UNVERIFIABLE");
});

test("C1 reclaim of FOUND occupant with an unorderable startedAt is IDENTITY_UNVERIFIABLE", () => {
  const recorded = { pid: 100, startedAt: "2026-08-13T10:00:00.000Z", runToken: "run-a" };
  const reclaimed = reclaimStaleLease({
    existing: [staleWriter({ identity: recorded })],
    kind: "PRODUCTION_WRITER",
    resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: "not-a-timestamp", runToken: "run-a" },
    now: NOW,
  });
  assert.equal(reclaimed.ok, false);
  assert.equal(reclaimed.refusal, "IDENTITY_UNVERIFIABLE");
});

test("C1 strictly-later startedAt still reclaims, and runToken mismatch does not consult instants", () => {
  const recorded = { pid: 100, startedAt: "2026-08-13T10:00:00.000Z", runToken: "run-a" };
  const later = reclaimStaleLease({
    existing: [staleWriter({ identity: recorded })],
    kind: "PRODUCTION_WRITER",
    resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: "2026-08-13T11:00:00.000Z", runToken: "run-b" },
    now: NOW,
  });
  assert.equal(later.ok, true);
  assert.equal(later.refusal, null);

  const tokenOnly = reclaimStaleLease({
    existing: [staleWriter({ identity: recorded })],
    kind: "PRODUCTION_WRITER",
    resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: "2026-08-13T09:00:00.000Z", runToken: "run-other" },
    now: NOW,
  });
  // F2: an earlier instant plus a different token is not different-process
  // proof. The previous assertion encoded that defect.
  assert.equal(tokenOnly.ok, false, "a differing runToken is not a different process without a later instant");
  assert.equal(tokenOnly.refusal, "IDENTITY_UNVERIFIABLE");
});

test("C1 observedCreationIsStrictlyLater is the one ordering rule", () => {
  assert.equal(
    observedCreationIsStrictlyLater("2026-08-13T10:00:00.000Z", "2026-08-13T11:00:00.000Z"),
    true,
  );
  assert.equal(
    observedCreationIsStrictlyLater("2026-08-13T10:00:00.000Z", "2026-08-13T09:00:00.000Z"),
    false,
  );
  assert.equal(
    observedCreationIsStrictlyLater("2026-08-13T10:00:00.000Z", "not-a-timestamp"),
    false,
  );
});

// ---------------------------------------------------------------------------
// C2
// ---------------------------------------------------------------------------

test("C2 a closed CERTIFICATE block does not withhold the FATAL line from sink or live tail", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "-----BEGIN CERTIFICATE-----\nMIICert\n-----END CERTIFICATE-----\n");
  log.write("stdout", "build step 1 ok\n");
  log.write("stdout", "build step 2 ok\n");
  log.write("stdout", "FATAL: everything is on fire\n");
  const sink = stdout.contents().toString("utf8");
  const tail = log.liveTail("stdout").toString("utf8");
  assert.match(sink, /FATAL:/);
  assert.match(tail, /FATAL:/);
});

test("C2 an open RSA PRIVATE KEY begin is still held", () => {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA_SECRET\n");
  log.write("stdout", "FATAL: after the open key\n");
  const sink = stdout.contents().toString("utf8");
  const tail = log.liveTail("stdout").toString("utf8");
  assert.equal(sink.includes("FATAL:"), false);
  assert.equal(tail.includes("FATAL:"), false);
  assert.equal(sink.includes("MIIEowIBAAKCAQEA_SECRET"), false);
});

// ---------------------------------------------------------------------------
// C4
// ---------------------------------------------------------------------------

test("C4 executeRun imported from dist/run-manager.js refuses an arbitrary launch", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const artifact = join(here, "..", "..", "dist", "run-manager.js");
  assert.equal(existsSync(artifact), true, "npm test builds dist first");
  const { executeRun: shippedExecuteRun } = await import(pathToFileURL(artifact).href);
  const result = await shippedExecuteRun(
    request({
      executablePath: EXE,
      argv: ["--totally-unmeasured-flag", "--dangerously-skip-permissions"],
    }),
    {
      clock: createFixedClock(NOW),
      fs: memoryFs(),
      spawn: trackingSpawn(() => exitingProcess()),
      git: matchingGit(HEAD_AFTER, { advance: true }),
      probe: sequentialProbe([foundObservation(RECORDED), HOLDER_GONE]),
      capacity: memoryCapacity(),
      leases: memoryLeases(),
      wait: async () => undefined,
      killTree: () => undefined,
      scanOrphans: () => writerOrphanScanResult([]),
      ...matchingDiscovery(),
    },
  );
  assert.equal(result.spawned, false, result.reason);
  assert.match(result.reason, /launch path refused/);
});

// ---------------------------------------------------------------------------
// B1
// ---------------------------------------------------------------------------

test("B1 crash window with pid-null lease and recorded spawnPid keeps the lock file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r12-b1-"));
  try {
    const store = createNodeLeaseStore(join(dir, "store"));
    const worktree = join(dir, "wt");
    mkdirSync(worktree);
    const acquired = acquireLease({
      existing: [],
      leaseId: "lease-wt-crash",
      kind: "WORKTREE",
      resource: worktree,
      missionId: "mission-1",
      runId: "run-1",
      now: NOW,
    });
    assert.equal(acquired.ok, true, acquired.reason);
    store.save([acquired.lease!]);
    assert.equal(readdirSync(store.locksDir).length, 1);

    const runRoot = join(dir, "run");
    mkdirSync(runRoot);
    const intent = {
      schema: "aion.director.run-intent.v1",
      runId: "run-1",
      missionId: "mission-1",
      workItemId: "work-1",
      worktree,
      branch: "executor/oracle",
      executablePath: EXE,
      argv: grokImplementerArgv(join(worktree, "PROMPT.md"), worktree),
      cwd: worktree,
      runNonce: NONCE,
      intendedAt: NOW,
      spawnAttemptedAt: NOW,
      spawnPid: 4812,
      spawnObservedAt: null,
      processIdentity: null,
      secretsPresent: false,
    };
    const hostFs = createNodeRunFileSystem();
    hostFs.writeDurable(join(runRoot, "intent.json"), `${JSON.stringify(intent, null, 2)}\n`);

    const result = await executeRun(
      request({
        cwd: worktree,
        worktree,
        runRoot,
        promptPath: join(worktree, "PROMPT.md"),
        argv: ["-p", "--permission-mode", "bypassPermissions"],
        executablePath: "C:\\Tools\\claude.exe",
        lease: { kind: "WORKTREE", resource: worktree, leaseId: "lease-wt-crash" },
      }),
      {
        clock: createFixedClock(NOW),
        fs: hostFs,
        spawn: trackingSpawn(() => exitingProcess()),
        git: matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: worktree }),
        probe: sequentialProbe([foundObservation(RECORDED), HOLDER_GONE]),
        capacity: memoryCapacity(),
        leases: store,
        wait: async () => undefined,
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        ...matchingDiscovery(),
      },
    );
    assert.equal(result.spawned, false, result.reason);
    assert.match(result.reason, /already exists|refusing to overwrite/);
    assert.equal(store.list().some((item) => item.leaseId === "lease-wt-crash"), true);
    assert.equal(readdirSync(store.locksDir).length, 1, "the OS lock file must still be present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B2 / D1
// ---------------------------------------------------------------------------

test("B2 a broker-parented no-nonce row after the floor makes the scan UNAVAILABLE", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{
        pid: 22540,
        parentPid: 36320,
        parentPresent: true,
        parentName: "WmiPrvSE.exe",
        nonceReadable: true,
        runNonce: null,
        creationDate: "2026-08-14T14:00:05.000Z",
      }],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T14:00:00.000Z",
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: "2026-08-14T14:00:10.000Z",
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
  assert.match(interpreted.reason, /undecidable/);
});

test("D1 a parentless post-floor row whose dead parent is the holder is in the holder chain", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{
        pid: 14436,
        parentPid: 4812,
        parentPresent: false,
        nonceReadable: true,
        runNonce: null,
        creationDate: "2026-08-14T14:00:05.000Z",
      }],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T14:00:00.000Z",
    runNonce: NONCE,
    holderPid: 4812,
  });
  // ParentProcessId still names the holder, so the row is classified as ours
  // (a live sighting), not as an undecidable scan.
  assert.equal(interpreted.outcome, "SCANNED");
});

test("D1 a parentless post-floor row whose dead parent was never observed is UNKNOWN", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{
        pid: 5140,
        parentPid: 7360,
        parentPresent: false,
        nonceReadable: true,
        runNonce: null,
        creationDate: "2026-08-14T14:00:05.000Z",
      }],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T14:00:00.000Z",
    runNonce: NONCE,
    holderPid: 4812,
  });
  // An absent parent is no explanation. The previous SCANNED verdict
  // spent that UNKNOWN as "proven absent".
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

test("D1 the real Windows orphan scanner with a 5-minute floor and unused nonce does not throw", () => {
  const scanner = createWindowsOrphanScanner();
  // Floor in the future: a lookback window would include live-parent
  // in-window host rows and correctly stay UNAVAILABLE. This test
  // checks the scanner is callable on a clean window.
  const floor = new Date(Date.now() + 60 * 60_000).toISOString();
  const nonce = `nonce-r12-unused-${process.pid}-${Date.now()}`;
  const rows = scanner({ runNonce: nonce, createdNotBefore: floor, holderPid: 0 });
  assert.ok(Array.isArray(rows.snapshot));
  assert.ok(Array.isArray(rows.killable));
});

test("D1 a 1800s window WmiPrvSE/svchost host row does not block the production interpreter", () => {
  const floor = "2026-08-15T10:00:00.000Z";
  const exit = "2026-08-15T10:30:00.000Z";
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      directorSessionId: 1,
      unreadable: 0,
      processes: [{
        pid: 151452,
        name: "WmiPrvSE.exe",
        parentPid: 888,
        parentName: "svchost.exe",
        parentPresent: true,
        parentCreationDate: "2026-08-01T00:00:00.000Z",
        creationDate: "2026-08-15T10:10:00.000Z",
        sessionId: 0,
        nonceReadable: true,
      }],
    }),
    stderr: "",
    createdNotBefore: floor,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: exit,
    observedPids: [4812],
  });
  assert.equal(interpreted.outcome, "SCANNED", interpreted.reason);
});

test("D1 executeRun with the production scanner rather than an empty stub still settles", async () => {
  // Live clock so the spawn floor is this instant, not the 2026-08-13
  // fixture NOW. A two-day lookback would emit every live-parent host
  // row, hit the PEB cap, and can stall the isolated test process.
  const result = await runWith({
    neverWait: true,
    clock: { now: () => new Date().toISOString() },
    scanOrphans: createWindowsOrphanScanner(),
  });
  assert.equal(typeof result.ok, "boolean");
  assert.equal(result.spawned, true, result.reason);
});

test("B2/D1 processRowMakesScanUndecidable is the one plausibility gate", () => {
  const ctx = {
    runNonce: NONCE,
    createdNotBefore: "2026-08-14T14:00:00.000Z",
    holderPid: 4812,
    holderExitedAt: "2026-08-14T14:00:10.000Z",
    observedPids: new Set([4812]),
    rows: [] as { pid: number; parentPid?: number }[],
  };
  assert.equal(
    processRowMakesScanUndecidable({
      pid: 9,
      parentPresent: false,
      parentPid: 4812,
      creationDate: "2026-08-14T14:00:05.000Z",
    }, ctx),
    true,
  );
  // Parent 1 was never observed. The F2 occupant is an *unreadable*
  // parentless in-window row. F10: a missing or readable PEB is not this
  // closed-interval UNKNOWN, so the row must carry nonceReadable:false.
  assert.equal(
    processRowMakesScanUndecidable({
      pid: 9,
      parentPresent: false,
      parentPid: 1,
      nonceReadable: false,
      creationDate: "2026-08-14T14:00:05.000Z",
    }, ctx),
    true,
  );
  assert.equal(
    processRowMakesScanUndecidable({
      pid: 9,
      parentPresent: true,
      parentName: "WmiPrvSE.exe",
      creationDate: "2026-08-14T14:00:05.000Z",
    }, ctx),
    true,
  );
});

// ---------------------------------------------------------------------------
// B3 / B4 / A3 via CLI
// ---------------------------------------------------------------------------

test("B3 director-cli no longer documents or accepts --orphan-scan", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  const { runDirectorCli } = await import(pathToFileURL(cli).href);
  const lines: string[] = [];
  const code = await runDirectorCli(["--help"], { log: (msg: string) => lines.push(String(msg)), error() { /* unused */ } });
  assert.equal(code, 0);
  assert.equal(lines.join("\n").includes("orphan-scan"), false);
});

test("A3 CLI refuses a non-integer --timeout-ms with a distinct non-zero exit", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  const { runDirectorCli } = await import(pathToFileURL(cli).href);
  const errors: string[] = [];
  const code = await runDirectorCli([
    "--run-id", "r",
    "--mission-id", "m",
    "--work-item-id", "w",
    "--executor", "grok",
    "--role", "IMPLEMENT",
    "--worktree", "C:\\wt",
    "--cwd", "C:\\wt",
    "--run-root", "C:\\run",
    "--prompt-path", "C:\\wt\\PROMPT.md",
    "--lease-kind", "WORKTREE",
    "--lease-resource", "C:\\wt",
    "--lease-id", "l1",
    "--run-nonce", "n1",
    "--timeout-ms", "1e400",
  ], {
    log() { /* unused */ },
    error: (msg: string) => errors.push(String(msg)),
  });
  assert.equal(code, 2);
  assert.match(errors.join("\n"), /--timeout-ms/);
});

test("B4 two launchRun writers with AION_DIRECTOR_STORE unset share the host store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-r12-b4-"));
  const arbitration = mkdtempSync(join(tmpdir(), "aion-r12-b4-arb-"));
  const previousStore = process.env.AION_DIRECTOR_STORE;
  const previousRoot = process.env.AION_DIRECTOR_ROOT;
  delete process.env.AION_DIRECTOR_STORE;
  process.env.AION_DIRECTOR_ROOT = join(dir, "host-store");
  const liveProbe = {
    observe: (pid: number) => ({
      outcome: "FOUND" as const,
      reason: "test-live",
      pid,
      creationDate: NOW,
      executablePath: EXE,
    }),
  };
  const sharedStore = createNodeLeaseStore(join(dir, "host-store"), {
    hostArbitrationRoot: arbitration,
    probe: liveProbe,
    hostLockTreeEvidence: () => "LIVE" as const,
  });
  let first: ReturnType<typeof launchRun> | undefined;
  let hanging: SpawnHandleV1 | undefined;
  try {
    const promptPath = join(dir, "PROMPT.md");
    writeFileSync(promptPath, "accept\n");
    let firstSpawned = false;
    let hangingExited = false;
    let resolveHang: ((value: { code: number | null; signal: string | null }) => void) | null = null;
    hanging = {
      pid: 4812,
      stdout: Readable.from([""]),
      stderr: Readable.from([""]),
      kill() {
        if (hangingExited) return;
        hangingExited = true;
        resolveHang?.({ code: null, signal: "SIGTERM" });
      },
      exit: new Promise((resolve) => {
        resolveHang = resolve;
      }),
      get exited() {
        return hangingExited;
      },
    };
    first = launchRun(
      {
        runId: "run-a",
        missionId: "mission-1",
        workItemId: "work-1",
        executor: "grok",
        worktree: dir,
        branch: "executor/oracle",
        cwd: dir,
        runNonce: "nonce-a",
        runRoot: join(dir, "run-a"),
        promptPath,
        timeoutMs: 30_000,
        lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-a" },
        authorisedProductionMutated: false,
        role: "INDEPENDENT_ACCEPTANCE",
      },
      {
        clock: createFixedClock(NOW),
        fs: createNodeRunFileSystem(),
        spawn: (_exe, _argv, _options, permit) => {
          requireSpawnPermit(permit);
          firstSpawned = true;
          return hanging!;
        },
        git: matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: dir }),
        probe: sequentialProbe([foundObservation(RECORDED)]),
        capacity: memoryCapacity(),
        leases: sharedStore,
        wait: () => new Promise(() => {}),
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        discoveryEnv: { AION_GROK_PATH: EXE },
        discoveryFs: { isFile: (path) => path === EXE, readDir: () => [] },
      },
    );

    // first settles without spawning when the host lock cannot be taken.
    // An unbounded setImmediate poll then hangs the file (and the glob).
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (firstSpawned) resolve();
          else if (Date.now() - started > 10_000) {
            reject(new Error("first writer did not spawn within 10s"));
          } else setImmediate(tick);
        };
        tick();
      }),
      first.then((result) => {
        if (!firstSpawned) {
          throw new Error(`first writer settled without spawning: ${result.reason}`);
        }
      }),
    ]);

    const second = await launchRun(
      {
        runId: "run-b",
        missionId: "mission-1",
        workItemId: "work-1",
        executor: "grok",
        worktree: dir,
        branch: "executor/oracle",
        cwd: dir,
        runNonce: "nonce-b",
        runRoot: join(dir, "run-b"),
        promptPath,
        timeoutMs: 30_000,
        lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-b" },
        authorisedProductionMutated: false,
        role: "INDEPENDENT_ACCEPTANCE",
      },
      {
        clock: createFixedClock(NOW),
        fs: createNodeRunFileSystem(),
        spawn: trackingSpawn(() => exitingProcess({ pid: 9999 })),
        git: matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: dir }),
        probe: sequentialProbe([foundObservation({ ...RECORDED, pid: 9999 }), HOLDER_GONE]),
        capacity: memoryCapacity(),
        leases: sharedStore,
        wait: async () => undefined,
        killTree: () => undefined,
        scanOrphans: () => writerOrphanScanResult([]),
        discoveryEnv: { AION_GROK_PATH: EXE },
        discoveryFs: { isFile: (path) => path === EXE, readDir: () => [] },
      },
    );
    assert.equal(second.spawned, false, second.reason);
    assert.match(second.reason, /another run holds this|lease refused/);
  } finally {
    hanging?.kill();
    await first?.catch(() => undefined);
    if (previousStore === undefined) delete process.env.AION_DIRECTOR_STORE;
    else process.env.AION_DIRECTOR_STORE = previousStore;
    if (previousRoot === undefined) delete process.env.AION_DIRECTOR_ROOT;
    else process.env.AION_DIRECTOR_ROOT = previousRoot;
    rmSync(dir, { recursive: true, force: true });
    rmSync(arbitration, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A1
// ---------------------------------------------------------------------------

test("A1 a non-number unreadable field is UNAVAILABLE, not an empty scan", () => {
  for (const unreadable of ["3", true, [2]]) {
    const interpreted = interpretWindowsOrphanScanOutput({
      status: 0,
      stdout: JSON.stringify({ ok: true, processes: [], unreadable }),
      stderr: "",
    });
    assert.equal(interpreted.outcome, "UNAVAILABLE", `unreadable=${JSON.stringify(unreadable)}`);
  }
});

test("A1 an absent or null processes key is UNAVAILABLE, not an empty list", () => {
  const absent = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, unreadable: 0 }),
    stderr: "",
  });
  assert.equal(absent.outcome, "UNAVAILABLE");
  const nulled = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({ ok: true, processes: null, unreadable: 0 }),
    stderr: "",
  });
  assert.equal(nulled.outcome, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// A2
// ---------------------------------------------------------------------------

test("A2 a secret starter split across a 64 KiB overflow is redacted on the sink", () => {
  const cases: ReadonlyArray<{ head: string; tail: string; leaked: string }> = [
    {
      head: `${"z".repeat(70_000)} -----BEGI`,
      tail: "N RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA_PRIVATE_BITS\n-----END RSA PRIVATE KEY-----\n",
      leaked: "MIIEowIBAAKCAQEA_PRIVATE_BITS",
    },
    {
      head: `${"x".repeat(70_000)} Authorization`,
      tail: ": Basic ZGFuOmh1bnRlcjIK\n",
      leaked: "ZGFuOmh1bnRlcjIK",
    },
    {
      head: `${"y".repeat(70_000)} Bearer`,
      tail: " eyJhbGciOiJIUzI1NiJ9.SECRETJWT\n",
      leaked: "eyJhbGciOiJIUzI1NiJ9.SECRETJWT",
    },
    {
      head: `${"w".repeat(70_000)} ghp`,
      tail: "_deadbeefcafebabe0123\n",
      leaked: "ghp_deadbeefcafebabe0123",
    },
  ];
  for (const item of cases) {
    assert.ok(item.head.length > MAX_TOKEN_HOLD);
    const stdout = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout, stderr: createMemoryLogSink() },
    });
    log.write("stdout", item.head);
    log.write("stdout", item.tail);
    log.flush();
    const text = stdout.contents().toString("utf8");
    assert.equal(text.includes(item.leaked), false, item.leaked);
    assert.match(text, /REDACTED/);
  }
});

// ---------------------------------------------------------------------------
// A3
// ---------------------------------------------------------------------------

test("A3 executeRun with timeoutMs Infinity refuses before acquiring a lease", async () => {
  const leases = memoryLeases();
  const result = await runWith({
    neverWait: true,
    leases,
    request: { timeoutMs: Number.POSITIVE_INFINITY },
  });
  assert.equal(result.spawned, false);
  assert.match(result.reason, /timeoutMs/);
  assert.doesNotMatch(result.reason, /exceeding its budget/);
  assert.equal(leases.list().length, 0);
});

// ---------------------------------------------------------------------------
// A4
// ---------------------------------------------------------------------------

test("A4 write to __proto__ does not mutate Object.prototype", () => {
  const before = Object.hasOwn(Object.prototype, "pending");
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: createMemoryLogSink(), stderr: createMemoryLogSink() },
  });
  assert.throws(() => {
    (log.write as (stream: string, chunk: string) => unknown)("__proto__", "payload\n");
  });
  assert.equal(Object.hasOwn(Object.prototype, "pending"), before);
  assert.equal(({} as { pending?: unknown }).pending, undefined);
});

// ---------------------------------------------------------------------------
// E1
// ---------------------------------------------------------------------------

test("E1 dead exports are absent from the public surface", async () => {
  const director = await import("../src/index.js");
  assert.equal("reclaimNodeLeaseStore" in director, false);
  assert.equal("leasesForRun" in director, false);
  assert.equal("DIRECTOR_BIND_PORT" in director, false);
});
