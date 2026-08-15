/**
 * Round 21 property repairs. Each case below must fail on
 * aa84866310478fbdd4bf253a1c8d376dc07b40ca and pass after the matching
 * property fix. Helpers are local.
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  redactLogText,
} from "../src/bounded-log.js";
import { argvGrantsWritePermission, executorArgvFor } from "../src/executor-adapters.js";
import {
  ownerGateFromExecutorRefusal,
  resolveGate,
} from "../src/gates.js";
import { HANDOFF_SCHEMA_V1 } from "../src/handoff.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
  releaseDeveloperAgentWorktreeLease,
} from "../src/lease-store.js";
import {
  acquireLease,
  reclaimStaleLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  BROKER_HOST_PROCESS_NAMES,
  interpretWindowsOrphanScanOutput,
  ORPHAN_SCAN_PEB_READ_CAP,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  undecidableRowsOf,
  writerOrphanScanResult,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import { canonicalResource } from "../src/resource-identity.js";
import {
  answersAfterReboot,
  persistRunIntent,
  recordSpawnAttempt,
} from "../src/run-intent.js";
import {
  executeRun,
  recoverAbandonedRun,
  RUN_RESULT_SCHEMA_V1,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";
import { assessReadiness, type BoardV1, type WorkItemV1 } from "../src/work-items.js";
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
const EXPIRED = "2026-08-13T12:20:00.000Z";

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

function matchingGit(head = HEAD_AFTER): GitRunner {
  return {
    inspectedWorktree: CWD,
    run(argv) {
      const key = argv.join(" ");
      if (key === "rev-parse HEAD") {
        return { argv: [...argv], status: 0, stdout: `${head}\n`, stderr: "", error: null };
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

function intentStoreOf(fs: RunFileSystemV1) {
  return {
    writeDurable(path: string, utf8: string) {
      fs.writeDurable(path, utf8);
    },
    readUtf8(path: string) {
      return fs.readUtf8(path);
    },
  };
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  logSinks?: NonNullable<RunManagerDepsV1["logSinks"]>;
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs();
  const handoffText = JSON.stringify(goodHandoff());
  if ("files" in fs && fs.files instanceof Map) fs.files.delete(handoffPath);
  const innerSpawn = over.spawn ?? ((_e, _a, _o, _p) => exitingProcess());
  const spawn: SpawnFnV1 = (executable, argv, options, permit) => {
    try {
      fs.writeDurable(handoffPath, handoffText);
    } catch {
      // spawn still proceeds
    }
    return innerSpawn(executable, argv, options, permit);
  };
  return executeRun(request({
    ...over.request,
    childEnv: {
      AION_HANDOFF_JSON: handoffText,
      ...(over.request?.childEnv ?? {}),
    },
  }), {
    clock: createFixedClock(HOLDER_EXIT),
    fs,
    spawn,
    git: matchingGit(),
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: async () => undefined,
    killTree: () => undefined,
    scanOrphans: () => writerOrphanScanResult([]),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
    ...matchingDiscovery(),
  });
}

function persistFreshIntent(fs: RunFileSystemV1) {
  return persistRunIntent({
    intentPath: join(RUN_ROOT, "intent.json"),
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
  }, intentStoreOf(fs));
}

// ---------------------------------------------------------------------------
// PROPERTY 1a — started-but-unobservable recover is UNKNOWN, never TERMINAL
// ---------------------------------------------------------------------------

test("P1a recoverAbandonedRun on spawnAttemptedAt with pid 0 is REFUSED_UNKNOWN, not TERMINAL", async () => {
  const fs = memoryFs();
  const persisted = persistFreshIntent(fs);
  assert.equal(persisted.ok, true, persisted.reason);
  assert.ok(persisted.permit);
  const recorded = recordSpawnAttempt({
    permit: persisted.permit,
    pid: 0,
    now: NOW,
    store: intentStoreOf(fs),
  });
  assert.equal(recorded.ok, true, recorded.reason);
  assert.equal(recorded.intent?.spawnPid, null);
  assert.equal(recorded.intent?.spawnAttemptedAt, NOW);
  const answers = answersAfterReboot(recorded.intent);
  assert.equal(answers.started, true);
  assert.equal(answers.spawnPid, null);

  let probeCalls = 0;
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: {
      observe: (pid: number) => {
        probeCalls += 1;
        return {
          outcome: "FOUND",
          reason: "alive for any pid",
          pid,
          creationDate: T0,
          executablePath: CLAUDE_EXE,
          runNonce: NONCE,
        };
      },
    },
  });
  assert.equal((result as { recoverOutcome?: string }).recoverOutcome, "REFUSED_UNKNOWN");
  assert.equal(result.spawned, false);
  assert.notEqual((result as { recoverOutcome?: string }).recoverOutcome, "TERMINAL");
  const onDisk = JSON.parse(fs.readUtf8(join(RUN_ROOT, "result.json"))) as {
    recoverOutcome?: string;
    spawned?: boolean;
  };
  assert.notEqual(onDisk.recoverOutcome, "TERMINAL");
  assert.equal(onDisk.spawned, false);
  assert.equal(result.schema, RUN_RESULT_SCHEMA_V1);
  void probeCalls;
});

test("P1a answersAfterReboot treats spawnObservedAt as started", () => {
  const fs = memoryFs();
  const persisted = persistFreshIntent(fs);
  assert.equal(persisted.ok, true);
  const raw = JSON.parse(fs.readUtf8(join(RUN_ROOT, "intent.json"))) as Record<string, unknown>;
  raw.spawnObservedAt = NOW;
  raw.spawnAttemptedAt = null;
  raw.spawnPid = null;
  raw.processIdentity = null;
  fs.writeDurable(join(RUN_ROOT, "intent.json"), `${JSON.stringify(raw, null, 2)}\n`);
  const parsed = JSON.parse(fs.readUtf8(join(RUN_ROOT, "intent.json"))) as {
    spawnObservedAt: string | null;
    spawnAttemptedAt: string | null;
    spawnPid: number | null;
    processIdentity: null;
  };
  const answers = answersAfterReboot(parsed as never);
  assert.equal(answers.spawnObservedAt, NOW);
  assert.equal(answers.started, true, "spawnObservedAt is evidence the spawn was observed");
});

// ---------------------------------------------------------------------------
// PROPERTY 1b — unreadable leases.json is not an empty list
// ---------------------------------------------------------------------------

test("P1b an unreadable leases.json is distinguishable from a genuinely empty store", () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), "aion-r21-p1b-empty-"));
  const unreadRoot = mkdtempSync(join(tmpdir(), "aion-r21-p1b-eisdir-"));
  const tornRoot = mkdtempSync(join(tmpdir(), "aion-r21-p1b-torn-"));
  try {
    const empty = createNodeLeaseStore(emptyRoot, { hostArbitrationRoot: join(emptyRoot, "arb") });
    const emptyRows = empty.list();
    assert.equal(Array.isArray(emptyRows) ? emptyRows.length : -1, 0);

    mkdirSync(join(unreadRoot, "leases.json"));
    const unread = createNodeLeaseStore(unreadRoot, { hostArbitrationRoot: join(unreadRoot, "arb") });
    let unreadableLooksEmpty = false;
    try {
      const rows = unread.list();
      unreadableLooksEmpty = Array.isArray(rows) && rows.length === 0;
    } catch {
      unreadableLooksEmpty = false;
    }
    assert.equal(
      unreadableLooksEmpty,
      false,
      "EISDIR leases.json must not be the same answer as a missing file",
    );

    writeFileSync(join(tornRoot, "leases.json"), "{ this is not json");
    const torn = createNodeLeaseStore(tornRoot, { hostArbitrationRoot: join(tornRoot, "arb") });
    let tornLooksEmpty = false;
    try {
      const rows = torn.list();
      tornLooksEmpty = Array.isArray(rows) && rows.length === 0;
    } catch {
      tornLooksEmpty = false;
    }
    assert.equal(tornLooksEmpty, false, "torn leases.json must not be the same answer as a missing file");
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
    rmSync(unreadRoot, { recursive: true, force: true });
    rmSync(tornRoot, { recursive: true, force: true });
  }
});

test("P1b a wiped run root with a live lease row still refuses a second spawn", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "aion-r21-p1b-store-"));
  try {
    const store = createNodeLeaseStore(storeRoot, { hostArbitrationRoot: join(storeRoot, "arb") });
    const planted = acquireLease({
      existing: [],
      leaseId: "lease-wt-1",
      kind: "WORKTREE",
      resource: CWD,
      missionId: "mission-1",
      runId: "run-1",
      pid: 4812,
      processIdentity: { pid: 4812, startedAt: NOW },
      now: NOW,
    });
    assert.equal(planted.ok, true, planted.reason);
    store.save([planted.lease!]);

    const honest = await runWith({
      leases: store,
      request: {
        runId: "run-1",
        runRoot: "C:\\AION\\director\\RUNS\\run-honest",
        lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-new" },
      },
    });
    assert.equal(honest.ok, false, honest.reason);
    assert.match(honest.reason, /lease row|already records a holder|unreadable/i);

    rmSync(join(storeRoot, "leases.json"), { force: true });
    mkdirSync(join(storeRoot, "leases.json"));
    const blinded = await runWith({
      leases: store,
      fs: memoryFs({ dirs: [CWD, "C:\\AION\\director\\RUNS\\run-blind"] }),
      request: {
        runId: "run-1",
        runRoot: "C:\\AION\\director\\RUNS\\run-blind",
        lease: { kind: "WORKTREE", resource: CWD, leaseId: "lease-wt-blind" },
      },
    });
    assert.equal(blinded.ok, false, blinded.reason);
    assert.equal(blinded.spawned, false, "an unreadable lease store must not grant a second spawn");
    assert.match(blinded.reason, /unreadable|UNKNOWN|lease/i);
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PROPERTY 1c — a gate that never recorded the world cannot be approved
// ---------------------------------------------------------------------------

test("P1c a gate opened with unobservable git facts cannot be approved into a moved world", () => {
  const gate = ownerGateFromExecutorRefusal({
    gateId: "owner-p1c",
    missionId: "mission-1",
    at: NOW,
    requestedType: "PRODUCTION_DEPLOY_APPROVAL_REQUIRED",
    executorSummary: "need owner; git was unreadable",
  });
  assert.equal(gate.safeFrozenState.headAfter, "UNOBSERVED");
  assert.equal(gate.safeFrozenState.branch, "UNOBSERVED");

  const moved = resolveGate({
    gate,
    approved: true,
    at: HOLDER_EXIT,
    currentFacts: {
      headAfter: "167d3d5f167d3d5f167d3d5f167d3d5f167d3d5f",
      branch: "some/other-branch",
    },
  });
  assert.equal(moved.ok, false);
  assert.notEqual(moved.gate.status, "APPROVED");
  assert.ok(moved.staleFacts.some((item) => item.includes("headAfter")), String(moved.staleFacts));
  assert.ok(moved.staleFacts.some((item) => item.includes("branch")), String(moved.staleFacts));
});

test("P1c resolveGate refuses approval when the frozen set is empty and the gate needs consent", () => {
  const gate = ownerGateFromExecutorRefusal({
    gateId: "owner-p1c-empty",
    missionId: "mission-1",
    at: NOW,
    requestedType: "DESTRUCTIVE_ACTION_APPROVAL_REQUIRED",
    executorSummary: "need owner",
  });
  const emptied = { ...gate, safeFrozenState: {} };
  const approved = resolveGate({
    gate: emptied,
    approved: true,
    at: HOLDER_EXIT,
    currentFacts: { headAfter: HEAD_AFTER, branch: "executor/oracle" },
  });
  assert.equal(approved.ok, false);
  assert.notEqual(approved.gate.status, "APPROVED");
});

// ---------------------------------------------------------------------------
// PROPERTY 2 — positive broker tie outranks session-0 exclusion
// ---------------------------------------------------------------------------

test("P2a a broker-parented in-window session-0 row is not excluded when directorSessionId is supplied", () => {
  const row = {
    pid: 9100,
    name: "WmiPrvSE.exe",
    parentPid: 1500,
    parentPresent: true,
    parentName: "dllhost.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER,
    nonceReadable: true,
    sessionId: 0,
  };
  const rows = [
    { pid: 4812, creationDate: T0 },
    { pid: 1500, creationDate: BOOT },
    { pid: 9100, parentPid: 1500, creationDate: AFTER },
  ];
  const without = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    rows,
  });
  const withSession = processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    rows,
  });
  assert.equal(processRowCouldBelongToThisRun(row, without), true);
  assert.equal(processRowCouldBelongToThisRun(row, withSession), true);
  assert.equal(processRowMakesScanUndecidable(row, withSession), true);
  assert.ok(undecidableRowsOf([row], withSession).length > 0);

  for (const host of BROKER_HOST_PROCESS_NAMES) {
    const named = { ...row, parentName: host };
    assert.equal(
      processRowCouldBelongToThisRun(named, withSession),
      true,
      `${host} session-0 row must still tie when directorSessionId=1`,
    );
  }
});

test("P2a interpretWindowsOrphanScanOutput does not flip to SCANNED when directorSessionId is supplied", () => {
  const envelope = {
    ok: true,
    processes: [{
      pid: 9100,
      name: "WmiPrvSE.exe",
      parentPid: 1500,
      parentPresent: true,
      parentName: "dllhost.exe",
      parentCreationDate: BOOT,
      creationDate: AFTER,
      nonceReadable: true,
      sessionId: 0,
    }],
    unreadable: 0,
    directorSessionId: 1,
  };
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify(envelope),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
  assert.match(interpreted.reason, /undecidable process-tree membership/);
});

// ---------------------------------------------------------------------------
// PROPERTY 3 — PEB cap degrades per-row, not per-scan
// ---------------------------------------------------------------------------

test("P3a an envelope with cap+1 decidable rows is SCANNED, not unreadable descendants", () => {
  const processes: Record<string, unknown>[] = [];
  for (let i = 0; i <= ORPHAN_SCAN_PEB_READ_CAP; i += 1) {
    const pid = 5000 + i;
    processes.push({
      pid,
      name: "child.exe",
      parentPid: i === 0 ? 4812 : 5000 + i - 1,
      parentPresent: true,
      creationDate: AFTER,
      runNonce: NONCE,
      nonceReadable: true,
    });
  }
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      processes,
      unreadable: 1,
    }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
  });
  assert.notEqual(interpreted.reason, "unreadable descendants");
  assert.equal(interpreted.outcome, "SCANNED", interpreted.reason);
});

test("P3a a genuinely undecidable in-window row still refuses", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      processes: [{
        pid: 9100,
        name: "mystery.exe",
        parentPid: 1,
        parentPresent: false,
        creationDate: AFTER,
        nonceReadable: true,
      }],
      unreadable: 0,
    }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
  assert.match(interpreted.reason, /undecidable process-tree membership/);
});

// ---------------------------------------------------------------------------
// PROPERTY 4a/4b — one redaction rule, including folded Bearer
// ---------------------------------------------------------------------------

test("P4a redactLogText redacts the token, not the scheme, on folded Authorization headers", () => {
  const token = "zQ7SECRETPAYLOAD9911xY";
  const shapes = [
    `Authorization: Bearer\n${token}\n`,
    `Proxy-Authorization: Bearer\n${token}\n`,
    `Authorization: Basic\n${token}\n`,
    `Authorization: Token\n${token}\n`,
  ];
  for (const input of shapes) {
    const out = redactLogText(input);
    assert.equal(out.includes(token), false, `leaked on ${JSON.stringify(input)}`);
    assert.match(out, /\[REDACTED\]/);
    assert.match(out, /Bearer|Basic|Token/);
  }
  const bare = redactLogText(`Bearer\n${token}\n`);
  assert.equal(bare.includes(token), false);
});

test("P4b folded Bearer shapes do not leak at any chunk cut through the holdback", () => {
  const token = "sekretTOKENvalue123";
  const shapes = [
    `hdr Bearer\n${token}\n`,
    `hdr Bearer\r\n${token}\r\n`,
    `hdr Bearer \n ${token}\n`,
    `Authorization: Bearer\n${token}\n`,
  ];
  for (const shape of shapes) {
    for (let cut = 0; cut <= shape.length; cut += 1) {
      const stdout = createMemoryLogSink();
      const log = createBoundedLog({
        clock: createFixedClock(NOW),
        sinks: { stdout, stderr: createMemoryLogSink() },
      });
      log.write("stdout", shape.slice(0, cut));
      log.write("stdout", shape.slice(cut));
      log.flush();
      const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
      assert.equal(
        text.includes(token),
        false,
        `token leaked at cut=${cut} for ${JSON.stringify(shape)}: ${text}`,
      );
    }
  }
});

test("P4b executeRun two-chunk Bearer\\n token does not land on the sink", async () => {
  const token = "eyJhbGciSECRETsig9911";
  const stdoutSink = createMemoryLogSink();
  const stream = new PassThrough();
  const fs = memoryFs();
  const running = runWith({
    fs,
    spawn: () => exitingProcess({ stdout: stream }),
    logSinks: { stdout: stdoutSink, stderr: createMemoryLogSink() },
  });
  stream.write("http 401; retrying with Bearer\n");
  stream.write(`${token}\n`);
  stream.end();
  await running;
  const onSink = stdoutSink.contents().toString("utf8");
  assert.equal(onSink.includes(token), false, `leaked on sink: ${onSink}`);
});

// ---------------------------------------------------------------------------
// PROPERTY 4c — local-assistant write authority uses the Director predicate
// ---------------------------------------------------------------------------

test("P4c developer-bridge does not invent a write permission mode the Director does not own", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const url = pathToFileURL(join(here, "..", "..", "..", "local-assistant", "dist", "developer-bridge.js")).href;
  const { ClaudeCodeCliDeveloperAgentBridgeV1 } = await import(url) as {
    ClaudeCodeCliDeveloperAgentBridgeV1: new (root: string, exe?: string) => {
      argvForMode(mode: "read-only" | "workspace-write"): readonly string[];
    };
  };
  const root = mkdtempSync(join(tmpdir(), "aion-r21-p4c-"));
  try {
    const bridge = new ClaudeCodeCliDeveloperAgentBridgeV1(root, join(root, "claude.exe"));
    const readOnly = bridge.argvForMode("read-only");
    const write = bridge.argvForMode("workspace-write");
    assert.equal(argvGrantsWritePermission(readOnly), false);
    const adapterWrite = executorArgvFor("claude", {
      promptPath: join(root, "PROMPT.md"),
      cwd: root,
      role: "IMPLEMENT",
    });
    assert.ok(adapterWrite !== null);
    assert.equal(
      write[write.indexOf("--permission-mode") + 1],
      adapterWrite[adapterWrite.indexOf("--permission-mode") + 1],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PROPERTY 4d — one resource canonicaliser
// ---------------------------------------------------------------------------

test("P4d assessReadiness agrees with canonicalResource on separator-only path aliases", () => {
  const item: WorkItemV1 = {
    schema: "aion.director.work-item.v1",
    workItemId: "w-held",
    missionId: "m1",
    kind: "implement",
    status: "PENDING",
    dependsOn: [],
    blockedByGateIds: [],
    executorRole: "IMPLEMENT",
    authorityClass: "ROUTINE_LOCAL",
    requiresLease: { kind: "WORKTREE", resource: "C:/repos/wt-a" },
    attemptCount: 0,
    currentRunId: null,
    resultRef: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.notEqual(canonicalResource("WORKTREE", "C:\\repos\\wt-a"), "");
  assert.equal(
    canonicalResource("WORKTREE", "C:\\repos\\wt-a"),
    canonicalResource("WORKTREE", "C:/repos/wt-a"),
  );
  const board: BoardV1 = {
    items: [item],
    gates: [],
    heldResources: ["WORKTREE:C:\\repos\\wt-a"],
    availableExecutors: ["claude"],
    missionHalted: false,
  };
  const readiness = assessReadiness(item, board);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "RESOURCE_HELD");
});

// ---------------------------------------------------------------------------
// PROPERTY 5 — per-invocation lease identity and an observable holder
// ---------------------------------------------------------------------------

test("P5a the second concurrent developer-agent acquire on one worktree is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-r21-p5a-"));
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: join(root, "arb") });
    const first = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
    });
    assert.equal(first.ok, true, !first.ok ? first.reason : "");
    const second = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
    });
    assert.equal(second.ok, false, "second concurrent acquire must not adopt the first run's row");
    if (!second.ok) assert.match(second.reason, /another run holds this|already/i);
    assert.ok(first.ok && first.lease.leaseId !== "devagent1");
    assert.ok(first.ok && first.lease.runId !== "dev-agent-run");
    assert.ok(first.ok && first.lease.pid !== null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P5a releasing A does not delete B's row", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-r21-p5a-rel-"));
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: join(root, "arb") });
    const a = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: "C:\\repos\\wt-a",
      now: NOW,
      store,
    });
    const b = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: "C:\\repos\\wt-b",
      now: NOW,
      store,
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    releaseDeveloperAgentWorktreeLease(store, a.lease);
    const left = store.list();
    assert.equal(left.some((row) => row.leaseId === b.lease.leaseId), true);
    assert.equal(left.some((row) => row.leaseId === a.lease.leaseId), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P5b an expired developer-agent lease whose holder is NOT_FOUND is reclaimable", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-r21-p5b-"));
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: join(root, "arb") });
    const acquired = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    assert.notEqual(acquired.lease.pid, null);
    const reclaimed = reclaimStaleLease({
      existing: store.list(),
      kind: "WORKTREE",
      resource: CWD,
      holderLiveness: "DEAD_CONFIRMED",
      holderObservation: acquired.lease.pid !== null
        ? { outcome: "NOT_FOUND", pid: acquired.lease.pid }
        : { outcome: "NOT_FOUND" },
      now: EXPIRED,
    });
    assert.equal(reclaimed.ok, true, reclaimed.reason);
    assert.notEqual(reclaimed.refusal, "HOLDER_UNOBSERVABLE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PROPERTY 6 — recoverAbandonedRun never throws
// ---------------------------------------------------------------------------

test("P6 recoverAbandonedRun returns RunResultV1 when leases.list throws", async () => {
  const fs = memoryFs();
  const persisted = persistFreshIntent(fs);
  assert.equal(persisted.ok, true);
  const recorded = recordSpawnAttempt({
    permit: persisted.permit!,
    pid: 0,
    now: NOW,
    store: intentStoreOf(fs),
  });
  assert.equal(recorded.ok, true);

  const throwingStore: LeaseStoreV1 = {
    list() {
      const error = new Error("lease store unreadable");
      (error as NodeJS.ErrnoException).code = "EBUSY";
      throw error;
    },
    save() {
      throw new Error("save must not be required");
    },
  };
  const result = await recoverAbandonedRun(RUN_ROOT, {
    fs,
    clock: createFixedClock(NOW),
    probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
    leases: throwingStore,
  });
  assert.equal(result.schema, RUN_RESULT_SCHEMA_V1);
  assert.equal((result as { recoverOutcome?: string }).recoverOutcome, "REFUSED_UNKNOWN");
  assert.notEqual((result as { recoverOutcome?: string }).recoverOutcome, "TERMINAL");
  assert.equal(result.spawned, false);
  assert.ok(fs.isFile(join(RUN_ROOT, "result.json")));
});

test("P6 recoverAbandonedRun returns RunResultV1 for each throwing dependency", async () => {
  const fs = memoryFs();
  persistFreshIntent(fs);
  const cases: Array<{ name: string; deps: Parameters<typeof recoverAbandonedRun>[1] }> = [
    {
      name: "probe",
      deps: {
        fs,
        clock: createFixedClock(NOW),
        probe: {
          observe: () => {
            throw new Error("probe boom");
          },
        },
      },
    },
    {
      name: "leases.list EACCES",
      deps: {
        fs,
        clock: createFixedClock(NOW),
        probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
        leases: {
          list() {
            const error = new Error("lease store unreadable");
            (error as NodeJS.ErrnoException).code = "EACCES";
            throw error;
          },
          save() {},
        },
      },
    },
    {
      name: "leases.list EMFILE",
      deps: {
        fs,
        clock: createFixedClock(NOW),
        probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
        leases: {
          list() {
            const error = new Error("lease store unreadable");
            (error as NodeJS.ErrnoException).code = "EMFILE";
            throw error;
          },
          save() {},
        },
      },
    },
    {
      name: "leases.list no code",
      deps: {
        fs,
        clock: createFixedClock(NOW),
        probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
        leases: {
          list() {
            throw new Error("lease store unreadable");
          },
          save() {},
        },
      },
    },
    {
      name: "fs.readUtf8",
      deps: {
        fs: {
          ...fs,
          readUtf8() {
            throw new Error("fs.readUtf8 boom");
          },
        },
        clock: createFixedClock(NOW),
        probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
      },
    },
    {
      name: "clock.now",
      deps: {
        fs,
        clock: {
          now() {
            throw new Error("clock boom");
          },
        },
        probe: { observe: (pid) => ({ ...HOLDER_GONE, pid }) },
      },
    },
  ];
  for (const item of cases) {
    const result = await recoverAbandonedRun(RUN_ROOT, item.deps);
    assert.equal(result.schema, RUN_RESULT_SCHEMA_V1, item.name);
    assert.notEqual((result as { recoverOutcome?: string }).recoverOutcome, "TERMINAL", item.name);
  }
});
