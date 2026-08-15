/**
 * Round 15c (D2 repair). C1: a parentless readable-PEB row whose parent
 * was a sampled descendant is this run's. C2: the durable stdout.log
 * carries the holdback truncation marker. Existing R15b liveness
 * controls are kept.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createBoundedLog, createFixedClock, createMemoryLogSink } from "../src/bounded-log.js";
import { GROK_MAX_TURNS } from "../src/executor-adapters.js";
import type { GitRunner } from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import type { LeaseV1 } from "../src/leases.js";
import {
  ANCESTRY_SAMPLE_INTERVAL_MS,
  ANCESTRY_SAMPLE_MAX_PER_RUN,
  createWindowsAncestrySampler,
  interpretWindowsAncestrySampleOutput,
  interpretWindowsOrphanScanOutput,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  rememberSampledDescendantPids,
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
const LAUNCHER_PID = 48968;
const GRANDCHILD_PID = 149572;

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: "C:\\Tools\\claude.exe",
  runNonce: NONCE,
};

const HOLDER_GONE: ProcessObservationV1 = { outcome: "NOT_FOUND", reason: "exited" };

/** Owner-measured C1 shape: PEB readable, nonce absent, parent already gone. */
const SCRUBBED_GRANDCHILD = {
  pid: GRANDCHILD_PID,
  name: "node.exe",
  creationDate: "2026-08-13T12:00:05.0000000Z",
  parentPid: LAUNCHER_PID,
  nonceReadable: true,
  runNonce: null,
  parentPresent: false,
  parentName: null,
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

function lingeringProcess(opts: { pid?: number } = {}): SpawnHandleV1 & { end(): void } {
  let exited = false;
  let resolveExit: ((value: { code: number | null; signal: string | null }) => void) | null = null;
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });
  return {
    pid: opts.pid ?? RECORDED.pid,
    stdout: Readable.from([""]),
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
    end() {
      if (!exited) {
        exited = true;
        resolveExit?.({ code: 0, signal: null });
      }
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
    sampleAncestry?: RunManagerDepsV1["sampleAncestry"];
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
    spawn: over.spawn ?? trackingSpawn(() => lingeringProcess()),
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
    sampleAncestry: over.sampleAncestry ?? (() => []),
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

function interpretRows(
  processes: readonly unknown[],
  over: { observedPids?: readonly number[]; holderExitedAt?: string } = {},
) {
  return interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: cimOk(processes),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: over.observedPids ?? [4812],
    holderExitedAt: over.holderExitedAt === undefined ? HOLDER_EXIT : over.holderExitedAt,
  });
}

// ---------------------------------------------------------------------------
// C1 — sampled descendant parent ties a readable parentless row
// ---------------------------------------------------------------------------

test("C1 parentless nonce-less in-window row with a sampled parent is couldBelong and undecidable", () => {
  // The launcher is gone from this snapshot. It is in observedPids because
  // an ancestry sample walked it while the holder was alive.
  const ctx = plausibility({
    observedPids: new Set([4812, LAUNCHER_PID]),
    rows: [{ pid: 4812 }, { pid: GRANDCHILD_PID, parentPid: LAUNCHER_PID }],
  });
  assert.equal(SCRUBBED_GRANDCHILD.nonceReadable, true);
  assert.equal(processRowCouldBelongToThisRun(SCRUBBED_GRANDCHILD, ctx), true);
  assert.equal(processRowMakesScanUndecidable(SCRUBBED_GRANDCHILD, ctx), true);
  assert.equal(
    interpretRows([SCRUBBED_GRANDCHILD], { observedPids: [4812, LAUNCHER_PID] }).outcome,
    "UNAVAILABLE",
  );
});

test("C1 the same row created after holderExitedAt is UNKNOWN when the parent was never sampled", () => {
  const row = { ...SCRUBBED_GRANDCHILD, creationDate: "2026-08-13T12:00:20.000Z" };
  const ctx = plausibility({
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }, { pid: GRANDCHILD_PID, parentPid: LAUNCHER_PID }],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
  assert.equal(interpretRows([row]).outcome, "UNAVAILABLE");
});

test("C1 the same row created before the floor stays SCANNED when the parent was never sampled", () => {
  const row = { ...SCRUBBED_GRANDCHILD, creationDate: "2026-01-01T00:00:00.000Z" };
  const ctx = plausibility({
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }, { pid: GRANDCHILD_PID, parentPid: LAUNCHER_PID }],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  assert.equal(interpretRows([row]).outcome, "SCANNED");
});

test("C1 the same row with a live parent stays SCANNED", () => {
  const row = { ...SCRUBBED_GRANDCHILD, parentPresent: true };
  const ctx = plausibility({
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }, { pid: GRANDCHILD_PID, parentPid: LAUNCHER_PID }],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), true);
  assert.equal(interpretRows([row]).outcome, "UNAVAILABLE");
});

test("C1 cancel-time scans with no holderExitedAt stay UNKNOWN for an unsampled parent", () => {
  const ctx: ProcessRowPlausibilityContextV1 = {
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    observedPids: new Set([4812]),
    rows: [{ pid: 4812 }, { pid: GRANDCHILD_PID, parentPid: LAUNCHER_PID }],
  };
  // A missing ceiling is not a proof of absence. The floor still holds.
  assert.equal(processRowCouldBelongToThisRun(SCRUBBED_GRANDCHILD, ctx), true);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: cimOk([SCRUBBED_GRANDCHILD]),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    observedPids: [4812],
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

test("C1 a readable parentless in-window row whose parent was never a descendant is UNAVAILABLE", () => {
  const hostNoise = {
    pid: 88912,
    name: "cmd.exe",
    creationDate: "2026-08-13T12:00:05.0000000Z",
    parentPid: 1,
    nonceReadable: true,
    runNonce: null,
    parentPresent: false,
    parentName: null,
  };
  const ctx = plausibility({
    observedPids: new Set([4812, LAUNCHER_PID]),
    rows: [{ pid: 4812 }, { pid: LAUNCHER_PID, parentPid: 4812 }, { pid: 88912, parentPid: 1 }],
  });
  // R16 F6: readable PEB without the nonce is UNKNOWN. The previous
  // SCANNED assertion spent that UNKNOWN as "not ours".
  assert.equal(processRowCouldBelongToThisRun(hostNoise, ctx), true);
  assert.equal(processRowMakesScanUndecidable(hostNoise, ctx), true);
  assert.equal(interpretRows([hostNoise], { observedPids: [4812, LAUNCHER_PID] }).outcome, "UNAVAILABLE");
});

test("C1 executeRun with a sampled-parent scrubbed grandchild holds the PRODUCTION_WRITER lease", async () => {
  const leases = memoryLeases();
  const killed: number[] = [];
  const waits: number[] = [];
  const samples: number[] = [];
  const child = lingeringProcess();
  const result = await runWith({
    leases,
    spawn: trackingSpawn(() => child),
    wait: async (ms) => {
      waits.push(ms);
      if (ms === ANCESTRY_SAMPLE_INTERVAL_MS) child.end();
    },
    killTree: (pid) => {
      killed.push(pid);
    },
    sampleAncestry: ({ holderPid }) => {
      samples.push(holderPid);
      return [
        { pid: holderPid },
        { pid: LAUNCHER_PID, parentPid: holderPid },
      ];
    },
    scanOrphans: () => [{
      pid: SCRUBBED_GRANDCHILD.pid,
      name: SCRUBBED_GRANDCHILD.name,
      creationDate: SCRUBBED_GRANDCHILD.creationDate,
      parentPid: SCRUBBED_GRANDCHILD.parentPid,
      nonceReadable: SCRUBBED_GRANDCHILD.nonceReadable,
      parentPresent: SCRUBBED_GRANDCHILD.parentPresent,
    }],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-c1" } },
  });
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.equal(leases.list().some((item) => item.leaseId === "lease-pw-c1"), true);
  assert.ok(samples.length >= 1, "the Director must sample ancestry while the child is alive");
  assert.ok(
    waits.includes(ANCESTRY_SAMPLE_INTERVAL_MS),
    `ancestry interval must be ${ANCESTRY_SAMPLE_INTERVAL_MS}ms; waits=${waits.join(",")}`,
  );
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.ok(tree);
  assert.match(
    tree.reason,
    /not performed|undecidable|unavailable/i,
    `tree reason must stay the UNAVAILABLE scan: ${tree.reason}`,
  );
  assert.equal(killed.includes(GRANDCHILD_PID), false);
});

test("C1 a failed ancestry sample is not a scan and must not force UNAVAILABLE", async () => {
  const leases = memoryLeases();
  const child = lingeringProcess();
  const result = await runWith({
    leases,
    spawn: trackingSpawn(() => child),
    wait: async (ms) => {
      if (ms === ANCESTRY_SAMPLE_INTERVAL_MS) child.end();
    },
    sampleAncestry: () => {
      throw new Error("cim-error");
    },
    scanOrphans: () => [],
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "default", leaseId: "lease-pw-c1-fail" } },
  });
  assert.equal(result.spawned, true, result.reason);
  const tree = result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
  assert.ok(tree);
  assert.equal(
    /not performed|undecidable|unavailable|cim-error/i.test(tree.reason),
    false,
    `a failed sample must not become a scan: ${tree.reason}`,
  );
  assert.equal(tree.ok, true, tree.reason);
});

test("C1 ancestry sampler projects pid/parent/creation only and never reads the PEB", () => {
  let script = "";
  let hide: boolean | undefined;
  const sampler = createWindowsAncestrySampler({
    spawnSync: (_cmd, args, options) => {
      script = String(args[3] ?? "");
      hide = options.windowsHide;
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          processes: [
            { pid: 4812, parentPid: 1, creationDate: T0 },
            { pid: LAUNCHER_PID, parentPid: 4812, creationDate: AFTER },
          ],
        }),
        stderr: "",
      };
    },
  });
  const rows = sampler({ holderPid: 4812 });
  assert.equal(hide, true);
  assert.match(script, /Win32_Process/);
  assert.match(script, /ProcessId/);
  assert.match(script, /ParentProcessId/);
  assert.match(script, /CreationDate/);
  assert.equal(/GetNonce|AionPebEnv|OpenProcess|ReadProcessMemory|NtQueryInformationProcess/.test(script), false);
  assert.deepEqual(rows.map((row) => row.pid), [4812, LAUNCHER_PID]);
});

test("C1 a failed ancestry sample throws rather than returning an empty scan", () => {
  assert.throws(() => interpretWindowsAncestrySampleOutput({
    status: 1,
    stdout: "{\"ok\":false,\"reason\":\"cim-error\"}",
    stderr: "",
  }), /cim-error|exited 1/);
  const sampler = createWindowsAncestrySampler({
    spawnSync: () => ({ status: 1, stdout: "{\"ok\":false,\"reason\":\"cim-error\"}", stderr: "" }),
  });
  assert.throws(() => sampler({ holderPid: 4812 }), /cim-error|exited 1/);
});

test("C1 ancestry sample bounds are a 500ms floor and a hard cap", () => {
  assert.ok(ANCESTRY_SAMPLE_INTERVAL_MS >= 500);
  assert.ok(ANCESTRY_SAMPLE_MAX_PER_RUN >= 1);
  assert.ok(ANCESTRY_SAMPLE_MAX_PER_RUN * ANCESTRY_SAMPLE_INTERVAL_MS >= 500);
});

test("C1 rememberSampledDescendantPids walks from the holder only", () => {
  const seen = new Set<number>();
  rememberSampledDescendantPids(seen, 4812, [
    { pid: 4812, parentPid: 1 },
    { pid: LAUNCHER_PID, parentPid: 4812 },
    { pid: 99, parentPid: 4 },
  ]);
  assert.equal(seen.has(4812), true);
  assert.equal(seen.has(LAUNCHER_PID), true);
  assert.equal(seen.has(99), false);
});

test("C1 writerSighting agrees with couldBelong on the scrubbed sampled-parent row", () => {
  const ctx = plausibility({
    observedPids: new Set([4812, LAUNCHER_PID]),
    rows: [{ pid: 4812 }, { pid: GRANDCHILD_PID, parentPid: LAUNCHER_PID }],
  });
  const could = processRowCouldBelongToThisRun(SCRUBBED_GRANDCHILD, ctx);
  const notAbsent = writerSightingNotProvenAbsent({
    pid: SCRUBBED_GRANDCHILD.pid,
    name: SCRUBBED_GRANDCHILD.name,
    creationDate: SCRUBBED_GRANDCHILD.creationDate,
    parentPid: SCRUBBED_GRANDCHILD.parentPid,
    nonceReadable: SCRUBBED_GRANDCHILD.nonceReadable,
    parentPresent: SCRUBBED_GRANDCHILD.parentPresent,
  }, NONCE, {
    holderPid: 4812,
    rows: ctx.rows,
    createdNotBefore: FLOOR,
    holderExitedAt: HOLDER_EXIT,
    observedPids: ctx.observedPids,
  });
  assert.equal(could, true);
  assert.equal(notAbsent, true);
  assert.equal(could && !notAbsent, false);
  assert.equal(!could && notAbsent, false);
});

// ---------------------------------------------------------------------------
// C2 — durable sink carries the holdback truncation marker
// ---------------------------------------------------------------------------

test("C2 holdback drop re-images the sink so stdout.log carries the truncation marker", () => {
  const stdout = createMemoryLogSink();
  const stderr = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr },
  });
  const evidence = Array.from({ length: 50 }, (_, i) => `AION-EVIDENCE step ${i}: mutated production, spendUsd=9.99\n`).join("");
  log.write("stdout", `starting work\n-----BEGIN PRIVATE KEY-----\n${evidence}`);
  log.flush();
  const disk = stdout.contents().toString("utf8");
  const report = log.report().stdout;
  assert.equal(report.fileTruncated, true);
  assert.ok(report.droppedFileBytes > 0);
  assert.match(disk, /\[AION_LOG_TRUNCATED dropped=\d+\]/);
  assert.equal(disk.includes("AION-EVIDENCE"), false);
  assert.equal(disk.includes("spendUsd=9.99"), false);
});
