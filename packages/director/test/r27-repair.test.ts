/**
 * Round 27 fail-closed repairs. Each case is a proven R27 hostile finding.
 * Helpers are local. R25/R26 cases stay in their own files.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  redactLogText,
} from "../src/bounded-log.js";
import {
  type GitRunner,
} from "../src/git-truth.js";
import { DIRECTOR_ROOT_ENV } from "../src/contracts.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
  releaseDeveloperAgentWorktreeLease,
} from "../src/lease-store.js";
import {
  type LeaseV1,
} from "../src/leases.js";
import {
  descendantPidsOf,
  interpretWindowsOrphanScanOutput,
  parentIsProvenCapableCreator,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  provenCreatedStrictlyAfter,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import {
  createNodeRunFileSystem,
  executeRun,
  recoverAbandonedRun,
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
const SECRET = "eyJhbGciCONTROLTOKEN9911";

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

function exitingProcess(opts: { exitCode?: number; pid?: number; stdout?: Readable } = {}): SpawnHandleV1 {
  return {
    pid: opts.pid ?? 4812,
    stdout: opts.stdout ?? Readable.from([""]),
    stderr: Readable.from([""]),
    kill() {},
    exit: Promise.resolve({ code: opts.exitCode ?? 0, signal: null }),
    get exited() { return true; },
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

function notFoundProbe() {
  return { observe: (pid: number) => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }) };
}

function matchingDiscovery(): Pick<RunManagerDepsV1, "discoveryEnv" | "discoveryFs"> {
  return {
    discoveryEnv: { AION_GROK_PATH: "C:\\Tools\\grok.exe", AION_CLAUDE_CODE_PATH: CLAUDE_EXE },
    discoveryFs: {
      isFile: (path) => path === CLAUDE_EXE || path === "C:\\Tools\\grok.exe" || path === PROMPT,
      readDir: () => [],
    },
  };
}

function recordedIdentity(): ExecutorProcessIdentityV1 {
  return { pid: 4812, creationDate: T0, executablePath: CLAUDE_EXE, runNonce: NONCE };
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
    argv: ["-p", "--permission-mode", "bypassPermissions"],
    cwd: CWD,
    runNonce: NONCE,
    intendedAt: NOW,
    spawnAttemptedAt: T0,
    spawnPid: 4812,
    spawnObservedAt: T0,
    processIdentity: recordedIdentity(),
    secretsPresent: false,
    role: "IMPLEMENT",
    ...over,
  }, null, 2)}\n`;
}

function identityCtx(over: Partial<Parameters<typeof processRowPlausibilityContext>[0]> = {}) {
  return processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: T0,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: new Set([4812]),
    rows: [],
    ...over,
  });
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  omitLeases?: boolean;
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  scanOrphans?: RunManagerDepsV1["scanOrphans"];
  writeHandoff?: boolean;
  killTree?: (pid: number) => void;
  clock?: { now: () => string };
  logSinks?: RunManagerDepsV1["logSinks"];
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs({ dirs: [CWD, runRoot] });
  const headAfter = HEAD_AFTER;
  const handoffText = JSON.stringify(goodHandoff({
    headAfter,
    headBefore: HEAD_BEFORE,
    executor: over.request?.executor ?? "claude",
    runId: over.request?.runId ?? "run-1",
    runNonce: over.request?.runNonce ?? NONCE,
  }));
  const innerSpawn = over.spawn ?? ((_e, _a, _o, _p) => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    if (over.writeHandoff !== false) {
      try { fs.writeDurable(handoffPath, handoffText); } catch { /* still spawn */ }
    }
    return innerSpawn(executable, argv, options, permit);
  };
  const deps: RunManagerDepsV1 = {
    clock: over.clock ?? { now: () => HOLDER_EXIT },
    fs,
    spawn,
    git: matchingGit(headAfter),
    probe: over.probe ?? notFoundProbe(),
    capacity: memoryCapacity(),
    wait: async () => undefined,
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...matchingDiscovery(),
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
    ...(over.omitLeases === true ? {} : { leases: over.leases ?? memoryLeases() }),
  };
  return executeRun(request({
    ...over.request,
    childEnv: { AION_HANDOFF_JSON: handoffText, ...(over.request?.childEnv ?? {}) },
  }), deps);
}

// ---------------------------------------------------------------------------
// persist / identity
// ---------------------------------------------------------------------------

test("R27 same-ms post-exit child of recycled holder slot is not a descendant", async () => {
  const leftover = {
    pid: 99006,
    parentPid: 4812,
    parentPresent: true as const,
    parentCreationDate: "2026-08-13T12:00:20.000400Z",
    creationDate: "2026-08-13T12:00:20.000800Z",
    nonceReadable: false,
  };
  const ctx = identityCtx({ rows: [leftover] });
  assert.equal(provenCreatedStrictlyAfter(leftover.creationDate, HOLDER_EXIT), true);
  assert.equal(parentlessRowTiedToThisRun(leftover, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), false);
  assert.equal(
    descendantPidsOf(4812, [leftover], { createdNotBefore: T0, holderExitedAt: HOLDER_EXIT }).has(99006),
    false,
  );

  const killed: number[] = [];
  const result = await runWith({
    clock: { now: () => T0 },
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => writerOrphanScanResult(killed.includes(99006) ? [] : [leftover]),
  });
  assert.equal(killed.includes(99006), false, JSON.stringify(killed));
  assert.notEqual(result.reason, undefined);
});

test("R27 same-ms later parent is not a capable creator", async () => {
  const leftover = {
    pid: 25100,
    parentPid: 18016,
    parentPresent: true as const,
    parentName: "powershell.exe",
    parentCreationDate: "2026-08-13T12:00:20.000800Z",
    creationDate: "2026-08-13T12:00:20.000100Z",
    nonceReadable: false,
  };
  const ctx = identityCtx();
  assert.equal(parentIsProvenCapableCreator(leftover, ctx), false);
  assert.equal(parentlessRowTiedToThisRun(leftover, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), true);
  assert.equal(processRowMakesScanUndecidable(leftover, ctx), true);

  const result = await runWith({
    scanOrphans: () => writerOrphanScanResult([leftover]),
  });
  assert.equal(result.ok, false, result.reason);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false, tree?.reason);
});

test("R27 same-ms spawn/exit still applies the recycle ceiling", async () => {
  const leftover = {
    pid: 99005,
    parentPid: 4812,
    parentPresent: true as const,
    parentCreationDate: "2026-08-13T12:00:25.000Z",
    creationDate: "2026-08-13T12:00:21.000Z",
    nonceReadable: false,
  };
  const ctx = identityCtx({ createdNotBefore: HOLDER_EXIT, holderExitedAt: HOLDER_EXIT });
  assert.equal(parentlessRowTiedToThisRun(leftover, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), false);

  const killed: number[] = [];
  const result = await runWith({
    clock: { now: () => HOLDER_EXIT },
    killTree: (pid) => { killed.push(pid); },
    scanOrphans: () => writerOrphanScanResult(killed.includes(99005) ? [] : [leftover]),
  });
  assert.equal(killed.includes(99005), false, JSON.stringify(killed));
  assert.notEqual(result.ok && killed.includes(99005), true);
});

test("R27 developer-agent persist does not stamp a foreign FOUND creationDate", () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r27-dev-id-"));
  try {
    const store = createNodeLeaseStore(join(dir, "store"), { hostArbitrationRoot: join(dir, "arb") });
    const first = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: "2026-08-13T10:00:00.000Z",
      store,
      probe: {
        observe: () => asObservation({
          outcome: "FOUND",
          pid: 99999,
          creationDate: "2020-01-01T00:00:00.000Z",
        }),
      },
    });
    assert.equal(first.ok, true, first.ok ? "" : first.reason);
    if (!first.ok) return;
    assert.notEqual(first.lease.processIdentity?.startedAt, "2020-01-01T00:00:00.000Z");

    const second = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: "2026-08-13T12:00:30.000Z",
      store,
      probe: {
        observe: (pid) => asObservation({
          outcome: "FOUND",
          pid,
          creationDate: "2026-08-13T12:00:01.000Z",
        }),
      },
    });
    assert.equal(second.ok, false, second.ok ? "second acquire must not reclaim a live holder" : second.reason);
    assert.equal(store.list().some((row) => row.leaseId === first.lease.leaseId), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// crash / recovery / logs
// ---------------------------------------------------------------------------

test("R27 split autBearer newline holdback does not leak the token", async () => {
  const sink = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout: sink, stderr: createMemoryLogSink() },
  });
  log.write("stdout", "autBearer\n");
  log.write("stdout", `${SECRET}\n`);
  log.seal();
  const image = sink.contents().toString("utf8");
  assert.equal(image.includes(SECRET), false, image);

  const executeSink = createMemoryLogSink();
  await runWith({
    spawn: trackingSpawn(() => exitingProcess({
      stdout: Readable.from(["autBearer\n", `${SECRET}\n`]),
    })),
    logSinks: { stdout: executeSink, stderr: createMemoryLogSink() },
  });
  const durable = executeSink.contents().toString("utf8");
  assert.equal(durable.includes(SECRET), false, durable);
});

test("R27 x/pro/- Bearer split prefixes are held", () => {
  for (const prefix of ["xBearer\n", "-Bearer\n", "proBearer\n"]) {
    const sink = createMemoryLogSink();
    const log = createBoundedLog({
      clock: createFixedClock(NOW),
      sinks: { stdout: sink, stderr: createMemoryLogSink() },
    });
    log.write("stdout", prefix);
    log.write("stdout", `${SECRET} leftover=1\n`);
    log.seal();
    const image = sink.contents().toString("utf8");
    assert.equal(image.includes(SECRET), false, `${prefix}: ${image}`);
  }
});

test("R27 folded Authorization redacts every continuation line", () => {
  const folded = `Authorization:\n\tBearer\n\t${SECRET}`;
  const out = redactLogText(folded);
  assert.equal(out.includes(SECRET), false, out);
  assert.match(out, /Authorization:\[REDACTED\]/i);
});

test("R27 recover without store root blocks relocated executeRun", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r27-idx-"));
  const previousRoot = process.env[DIRECTOR_ROOT_ENV];
  process.env[DIRECTOR_ROOT_ENV] = join(dir, "store");
  try {
    mkdirSync(join(dir, "store"), { recursive: true });
    const rootA = join(dir, "A", "run");
    const rootB = join(dir, "B", "run");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const promptB = join(rootB, "PROMPT.md");
    writeFileSync(promptB, "prompt\n");
    const shared = memoryFs({
      dirs: [CWD, rootA, rootB],
      files: { [promptB]: "prompt\n" },
    });
    shared.writeDurable(join(rootA, "intent.json"), recordedIntent({ runId: "run-reloc" }));
    const first = await recoverAbandonedRun(rootA, {
      fs: shared,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
    });
    assert.equal(first.spawned, true, first.reason);
    const spawn = trackingSpawn(() => exitingProcess());
    const relocated = await runWith({
      request: { runRoot: rootB, runId: "run-reloc", promptPath: promptB },
      omitLeases: true,
      fs: shared,
      spawn,
    });
    assert.equal(spawn.calls, 0, relocated.reason);
    assert.match(relocated.reason, /recorded completion already exists/i);
  } finally {
    if (previousRoot === undefined) delete process.env[DIRECTOR_ROOT_ENV];
    else process.env[DIRECTOR_ROOT_ENV] = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R27 default recover store matches default executeRun store across parents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r27-default-idx-"));
  const previousRoot = process.env[DIRECTOR_ROOT_ENV];
  process.env[DIRECTOR_ROOT_ENV] = join(dir, "store");
  try {
    mkdirSync(join(dir, "store"), { recursive: true });
    const rootA = join(dir, "A", "run");
    const rootB = join(dir, "B", "run");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const promptB = join(rootB, "PROMPT.md");
    writeFileSync(join(rootA, "intent.json"), recordedIntent({ runId: "run-default-idx" }));
    writeFileSync(promptB, "prompt\n");
    const realFs = createNodeRunFileSystem();
    const first = await recoverAbandonedRun(rootA, {
      fs: realFs,
      clock: createFixedClock(HOLDER_EXIT),
      probe: { observe: () => { throw new Error("WMI denied"); } },
    });
    assert.equal(first.spawned, true, first.reason);
    const spawn = trackingSpawn(() => exitingProcess());
    const relocated = await runWith({
      request: {
        runRoot: rootB,
        runId: "run-default-idx",
        promptPath: promptB,
        cwd: rootB,
        worktree: rootB,
        lease: { kind: "WORKTREE", resource: rootB, leaseId: "lease-wt-reloc" },
      },
      omitLeases: true,
      fs: realFs,
      spawn,
    });
    assert.equal(spawn.calls, 0, relocated.reason);
    assert.match(relocated.reason, /recorded completion already exists/i);
  } finally {
    if (previousRoot === undefined) delete process.env[DIRECTOR_ROOT_ENV];
    else process.env[DIRECTOR_ROOT_ENV] = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// wiring / liveness
// ---------------------------------------------------------------------------

test("R27 empty snapshot cannot shadow killable or liveSightings", () => {
  const dir = mkdtempSync(join(tmpdir(), "d2-r27-mix-"));
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
    if (!acquired.ok) return;

    const mixed = releaseDeveloperAgentWorktreeLease(store, acquired.lease, {
      scanOrphans: () => ({
        snapshot: [],
        killable: [{ pid: 25100 }],
        liveSightings: [{ pid: 25100 }],
        undecidable: [],
      }),
    });
    assert.equal(mixed.ok, false, mixed.reason);
    assert.equal(store.list().length, 1);

    const emptySnapshotKillable = releaseDeveloperAgentWorktreeLease(store, acquired.lease, {
      scanOrphans: () => ({
        snapshot: [],
        killable: [{ pid: 25100 }],
      }),
    });
    assert.equal(emptySnapshotKillable.ok, false, emptySnapshotKillable.reason);
    assert.equal(store.list().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R27 developer-agent spawn delivers AION_RUN_NONCE", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const url = pathToFileURL(join(here, "..", "..", "..", "local-assistant", "dist", "developer-bridge.js")).href;
  const mod = await import(url) as {
    CodexCliDeveloperAgentBridgeV1: new (root: string, executable?: string) => {
      run(
        task: {
          repositoryRoot: string;
          instruction: string;
          mode: "read-only" | "workspace-write";
          runNonce?: string;
        },
        signal: AbortSignal,
      ): Promise<{ exitCode: number; summary: string }>;
    };
  };
  class EchoNonce extends (mod.CodexCliDeveloperAgentBridgeV1 as unknown as new (root: string, exe?: string) => {
    run(...args: never[]): Promise<{ exitCode: number; summary: string }>;
  }) {
    protected taskArgs(): readonly string[] {
      return ["-e", "process.stdout.write(process.env.AION_RUN_NONCE || 'MISSING')"];
    }
  }
  const root = mkdtempSync(join(tmpdir(), "d2-r27-nonce-"));
  try {
    const bridge = new (EchoNonce as unknown as new (root: string, exe?: string) => {
      run(
        task: {
          repositoryRoot: string;
          instruction: string;
          mode: "read-only";
          runNonce?: string;
        },
        signal: AbortSignal,
      ): Promise<{ exitCode: number; summary: string }>;
    })(root, process.execPath);
    const missing = await bridge.run({
      repositoryRoot: root,
      instruction: "echo",
      mode: "read-only",
    }, new AbortController().signal);
    assert.equal(missing.summary, "MISSING");
    const delivered = await bridge.run({
      repositoryRoot: root,
      instruction: "echo",
      mode: "read-only",
      runNonce: "dev-agent-r27-token",
    }, new AbortController().signal);
    assert.equal(delivered.summary, "dev-agent-r27-token");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R27 guard refuses a missing minted nonce and otherwise forwards it", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const agentUrl = pathToFileURL(join(here, "..", "..", "..", "..", "apps", "aion", "developer-agent.mjs")).href;
  const { guardBridgeWithDirectorLease } = await import(agentUrl) as {
    guardBridgeWithDirectorLease: (
      bridge: { run: Function },
      repositoryRoot: string,
      options?: Record<string, unknown>,
    ) => { run: Function };
  };
  const dir = mkdtempSync(join(tmpdir(), "d2-r27-guard-"));
  try {
    const store = createNodeLeaseStore(join(dir, "store"), { hostArbitrationRoot: join(dir, "arb") });
    const seen: unknown[] = [];
    const raw = {
      async run(task: unknown) {
        seen.push(task);
        return { exitCode: 0, summary: "ok" };
      },
    };
    const guarded = guardBridgeWithDirectorLease(raw, CWD, {
      store,
      now: NOW,
      scanOrphans: () => writerOrphanScanResult([]),
    });
    const result = await guarded.run({
      repositoryRoot: CWD,
      instruction: "list the repository",
      mode: "read-only",
    }, new AbortController().signal);
    assert.equal(result.exitCode, 0);
    const forwarded = seen[0] as { runNonce?: string };
    assert.equal(typeof forwarded.runNonce, "string");
    assert.match(String(forwarded.runNonce), /^dev-agent-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// conjunction / cancel
// ---------------------------------------------------------------------------

test("R27 omitted parentPresent is UNKNOWN, not host noise", async () => {
  const leftover = {
    pid: 99008,
    parentPid: 18016,
    parentName: "powershell.exe",
    creationDate: "2026-08-13T12:00:05.000Z",
    nonceReadable: false,
  };
  const ctx = identityCtx();
  assert.equal(parentlessRowTiedToThisRun(leftover, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(leftover, ctx), true);
  assert.equal(processRowMakesScanUndecidable(leftover, ctx), true);

  const result = await runWith({
    clock: { now: () => T0 },
    scanOrphans: () => writerOrphanScanResult([leftover]),
  });
  assert.equal(result.ok, false, result.reason);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.equal(tree?.ok, false, tree?.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
});

test("R27 non-boolean parentPresent is unreadable, not field-absent", () => {
  const envelope = {
    ok: true,
    processes: [{
      pid: 99008,
      parentPid: 18016,
      parentPresent: "True",
      parentName: "powershell.exe",
      creationDate: "2026-08-13T12:00:05.000Z",
      nonceReadable: false,
    }],
  };
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify(envelope),
    stderr: "",
    createdNotBefore: T0,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});
