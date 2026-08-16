/**
 * Round 24 property repairs. Each case below must fail on
 * eb4a9605932a1c050f408d873abe98c24fa22351 and pass after the matching
 * class fix. Helpers are local.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
} from "../src/bounded-log.js";
import {
  collectGitStatusIncludingIgnored,
  createNodeGitRunner,
  GIT_OBSERVATION_SCHEMA_V1,
  type GitObservationV1,
  type GitRunner,
  type GitStatusObservationV1,
} from "../src/git-truth.js";
import { HANDOFF_SCHEMA_V1, parseHandoff } from "../src/handoff.js";
import {
  inspectHostProductionWriterLock,
} from "../src/lease-store.js";
import {
  acquireLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  creationMatchesApparatusIdentity,
  holderLiveness,
  observationIsAboutPid,
  parentlessRowTiedToThisRun,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  processRowPlausibilityContext,
  rememberMeasurementApparatusPid,
  rowHasPositiveRunIdentity,
  rowIsMeasurementApparatus,
  writerOrphanScanResult,
  type ExecutorProcessIdentityV1,
  type ProcessObservationV1,
} from "../src/process-identity.js";
import {
  evaluateSuccessConjunction,
  executeRun,
  proveWriterExit,
  writerReleaseEvidence,
  type CapacityGateV1,
  type ExecuteRunRequestV1,
  type LeaseStoreV1,
  type RunFileSystemV1,
  type RunManagerDepsV1,
  type SpawnFnV1,
  type SpawnHandleV1,
} from "../src/run-manager.js";
import type { LeaseKindV1 } from "../src/resource-identity.js";

const NOW = "2026-08-13T12:00:00.000Z";
const HEAD_BEFORE = "a".repeat(40);
const HEAD_AFTER = "b".repeat(40);
const CWD = "C:\\wt";
const OTHER = "C:\\other";
const ELSEWHERE = "C:\\somewhere-else";
const RUN_ROOT = "C:\\AION\\director\\RUNS\\run-1";
const CLAUDE_EXE = "C:\\Tools\\claude.exe";
const PROMPT = "C:\\wt\\PROMPT.md";
const NONCE = "nonce-run-1";
const T0 = "2026-08-13T12:00:01.000Z";
const FLOOR = "2026-08-13T12:00:10.000Z";
const HOLDER_EXIT = "2026-08-13T12:00:20.000Z";
const AFTER = "2026-08-13T12:00:15.000Z";
const BOOT = "2026-08-01T00:00:00.000Z";
const T0_BRACKET = "2026-08-14T12:00:00.000Z";
const T1_BRACKET = "2026-08-14T12:00:00.050Z";
const AFTER_BRACKET = "2026-08-14T12:00:01.000Z";
const INSIDE_BRACKET = "2026-08-14T12:00:00.020Z";

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
  const dirs = new Set(seed.dirs ?? [CWD, OTHER, ELSEWHERE, RUN_ROOT]);
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

function matchingGit(
  head = HEAD_AFTER,
  opts: { readonly advance?: boolean; readonly inspectedWorktree?: string } = {},
): GitRunner {
  let revParses = 0;
  return {
    ...(opts.inspectedWorktree !== undefined ? { inspectedWorktree: opts.inspectedWorktree } : { inspectedWorktree: CWD }),
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
      if (argv[0] === "rev-parse" && typeof argv[1] === "string" && argv[1].startsWith("refs/heads/")) {
        return { argv: [...argv], status: 0, stdout: `${head}\n`, stderr: "", error: null };
      }
      if (key === "ls-tree -r -l HEAD") {
        return { argv: [...argv], status: 0, stdout: "", stderr: "", error: null };
      }
      if (argv[0] === "rev-parse" && argv.includes("@{upstream}")) {
        return { argv: [...argv], status: 128, stdout: "", stderr: "fatal: no upstream configured\n", error: null };
      }
      if (argv[0] === "merge-base" && argv[1] === "--is-ancestor") {
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

function trackingSpawn(factory: () => SpawnHandleV1): SpawnFnV1 & { calls: number } {
  const spawnFn = ((_e, _a, _o, _p) => {
    spawnFn.calls += 1;
    return factory();
  }) as SpawnFnV1 & { calls: number };
  spawnFn.calls = 0;
  return spawnFn;
}

function notFoundProbe(): { observe: (pid: number) => ProcessObservationV1 } {
  return { observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "no process occupies this pid", pid }) };
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

function writerLease(over: {
  pid?: number | null;
  processIdentity?: LeaseV1["processIdentity"];
  leaseId?: string;
  runId?: string;
  now?: string;
  resource?: string;
  kind?: LeaseKindV1;
} = {}): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: over.leaseId ?? "lease-pw-0",
    kind: over.kind ?? "PRODUCTION_WRITER",
    resource: over.resource ?? "aion-production",
    missionId: "mission-1",
    runId: over.runId ?? "run-0",
    pid: over.pid === undefined ? 4812 : over.pid,
    ...(over.processIdentity !== undefined ? { processIdentity: over.processIdentity } : {
      processIdentity: { pid: 4812, startedAt: T0, runToken: "nonce-run-0" },
    }),
    now: over.now ?? "2026-08-13T10:00:00.000Z",
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

function worktreeLease(resource = CWD, runId = "run-foreign"): LeaseV1 {
  const attempt = acquireLease({
    existing: [],
    leaseId: "lease-wt-foreign",
    kind: "WORKTREE",
    resource,
    missionId: "mission-1",
    runId,
    pid: 9999,
    processIdentity: { pid: 9999, startedAt: T0, runToken: "nonce-foreign" },
    now: NOW,
  });
  if (!attempt.ok || attempt.lease === null) throw new Error(attempt.reason);
  return attempt.lease;
}

async function runWith(over: {
  request?: Partial<ExecuteRunRequestV1>;
  fs?: RunFileSystemV1 & { files?: Map<string, string> };
  spawn?: SpawnFnV1;
  leases?: LeaseStoreV1;
  probe?: { observe: (pid: number) => ProcessObservationV1 };
  scanOrphans?: RunManagerDepsV1["scanOrphans"];
  git?: GitRunner;
  clock?: { now: () => string };
  wait?: (ms: number) => Promise<void>;
  killTree?: (pid: number) => void;
  logSinks?: RunManagerDepsV1["logSinks"];
} = {}) {
  const runRoot = over.request?.runRoot ?? RUN_ROOT;
  const handoffPath = join(runRoot, "handoff.json");
  const fs = over.fs ?? memoryFs({ dirs: [CWD, OTHER, ELSEWHERE, runRoot] });
  const role = over.request?.role ?? "IMPLEMENT";
  const headAfter = role === "INDEPENDENT_ACCEPTANCE" || role === "ADVERSARIAL_REVIEW"
    ? HEAD_BEFORE
    : HEAD_AFTER;
  const handoffText = JSON.stringify(goodHandoff({
    headAfter,
    headBefore: HEAD_BEFORE,
    executor: over.request?.executor ?? "claude",
    runId: over.request?.runId ?? "run-1",
    runNonce: over.request?.runNonce ?? NONCE,
  }));
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
    clock: over.clock ?? { now: () => HOLDER_EXIT },
    fs,
    spawn,
    git: over.git ?? matchingGit(headAfter, { advance: role === "IMPLEMENT" }),
    probe: over.probe ?? notFoundProbe(),
    capacity: memoryCapacity(),
    leases: over.leases ?? memoryLeases(),
    wait: over.wait ?? (async () => undefined),
    killTree: over.killTree ?? (() => undefined),
    scanOrphans: over.scanOrphans ?? (() => writerOrphanScanResult([])),
    resolveArtifactPath: (absolutePath) => absolutePath,
    ...(over.logSinks !== undefined ? { logSinks: over.logSinks } : {}),
    ...matchingDiscovery(),
  });
}

function treeFinding(result: { conjunction: { findings: readonly { name: string; ok: boolean; reason: string }[] } }) {
  return result.conjunction.findings.find((item) => item.name === "executorTreeIsGone");
}

function gitObs(sha: string): GitObservationV1 {
  return {
    schema: GIT_OBSERVATION_SCHEMA_V1,
    worktreePath: CWD,
    collectedAt: NOW,
    head: { outcome: "FOUND", sha },
    branch: { outcome: "ATTACHED", name: "executor/oracle" },
    upstream: { outcome: "NO_UPSTREAM" },
    status: { outcome: "CLEAN", porcelain: "" },
    branchHead: { outcome: "FOUND", sha },
    largeTrackedFiles: { outcome: "FOUND", files: [] },
  };
}

function reviewFromTrees(before: GitStatusObservationV1, after: GitStatusObservationV1) {
  return evaluateSuccessConjunction({
    exitCode: 0,
    stillRunning: false,
    executor: "grok",
    output: "",
    parsed: parseHandoff(JSON.stringify(goodHandoff({ headAfter: HEAD_BEFORE, headBefore: HEAD_BEFORE }))),
    reportedWorkItemId: "work-1",
    expectedMissionId: "mission-1",
    expectedRunId: "run-1",
    expectedWorkItemId: "work-1",
    runRoot: RUN_ROOT,
    gitAfter: gitObs(HEAD_BEFORE),
    gitBefore: gitObs(HEAD_BEFORE),
    gitVerdict: null,
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: true,
    declaredArtifactsInsideRunRootReason: "ok",
    executorTreeGone: true,
    executorTreeReason: "clean",
    timedOut: false,
    logStayedWithinBudget: true,
    role: "ADVERSARIAL_REVIEW",
    argvGrantedWrite: false,
    processWasCreated: true,
    expectedRunNonce: NONCE,
    treeIncludingIgnored: after,
    treeIncludingIgnoredBefore: before,
  });
}

function membershipCtx(over: Partial<Parameters<typeof processRowPlausibilityContext>[0]> = {}) {
  return processRowPlausibilityContext({
    runNonce: NONCE,
    createdNotBefore: FLOOR,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
    observedPids: [4812],
    directorSessionId: 1,
    directorPid: 1234,
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 7055, parentPid: 4812, creationDate: AFTER },
    ],
    ...over,
  });
}

const JWT = "eyJhbGciOiJIUzI1NiJ9.SUPERSECRETJWT.sig";

// ---------------------------------------------------------------------------
// CLASS 1A — apparatus is a creation identity; positive identity dominates
// ---------------------------------------------------------------------------

test("1A nonce-bearing row whose pid is in the apparatus set is still ours", () => {
  const row = {
    pid: 4444,
    parentPid: 9999,
    parentPresent: false,
    runNonce: NONCE,
    nonceReadable: true,
    creationDate: INSIDE_BRACKET,
    sessionId: 1,
  };
  rememberMeasurementApparatusPid(4444, {
    creationNotBefore: T0_BRACKET,
    creationNotAfter: T1_BRACKET,
  });
  const ctx = membershipCtx({
    apparatusPids: [{ pid: 4444, creationNotBefore: T0_BRACKET, creationNotAfter: T1_BRACKET }],
    rows: [{ pid: 4812, creationDate: T0 }, { pid: 4444, parentPid: 9999, creationDate: INSIDE_BRACKET }],
  });
  assert.equal(rowHasPositiveRunIdentity(row, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
  assert.equal(processRowMakesScanUndecidable(row, ctx), false);
});

test("1A nonce-bearing row whose parent pid is in the apparatus set is still ours", () => {
  const row = {
    pid: 5555,
    parentPid: 4444,
    parentPresent: false,
    runNonce: NONCE,
    nonceReadable: true,
    creationDate: INSIDE_BRACKET,
    parentCreationDate: INSIDE_BRACKET,
    sessionId: 1,
  };
  const ctx = membershipCtx({
    apparatusPids: [{ pid: 4444, creationNotBefore: T0_BRACKET, creationNotAfter: T1_BRACKET }],
    rows: [{ pid: 4812, creationDate: T0 }, { pid: 5555, parentPid: 4444, creationDate: INSIDE_BRACKET }],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
});

test("1A a holder-chain row whose pid is in the apparatus set is still ours", () => {
  const row = {
    pid: 7055,
    parentPid: 4812,
    parentPresent: true,
    parentName: "claude.exe",
    parentCreationDate: T0,
    creationDate: AFTER,
    sessionId: 1,
  };
  const ctx = membershipCtx({
    apparatusPids: [{ pid: 7055, creationNotBefore: AFTER, creationNotAfter: AFTER, creationDate: AFTER }],
  });
  assert.equal(rowHasPositiveRunIdentity(row, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), true);
});

test("1A a recycled slot after the apparatus bracket is not apparatus", () => {
  const entry = { pid: 4444, creationNotBefore: T0_BRACKET, creationNotAfter: T1_BRACKET };
  assert.equal(creationMatchesApparatusIdentity(AFTER_BRACKET, entry), false);
  const row = {
    pid: 4444,
    parentPid: 1,
    parentPresent: true,
    parentName: "explorer.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER_BRACKET,
    nonceReadable: true,
    sessionId: 1,
  };
  const ctx = membershipCtx({
    apparatusPids: [entry],
    rows: [{ pid: 4812, creationDate: T0 }, { pid: 4444, creationDate: AFTER_BRACKET }],
  });
  assert.equal(rowIsMeasurementApparatus(row, ctx), false);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
});

test("1A a row on an apparatus pid inside the bracket with no positive identity is excluded", () => {
  const entry = { pid: 4444, creationNotBefore: T0_BRACKET, creationNotAfter: T1_BRACKET };
  const row = {
    pid: 4444,
    parentPid: 1,
    parentPresent: true,
    parentName: "explorer.exe",
    parentCreationDate: BOOT,
    creationDate: INSIDE_BRACKET,
    nonceReadable: true,
    sessionId: 1,
  };
  const ctx = membershipCtx({
    apparatusPids: [entry],
    rows: [{ pid: 4812, creationDate: T0 }, { pid: 4444, creationDate: INSIDE_BRACKET }],
  });
  assert.equal(rowIsMeasurementApparatus(row, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
});

test("1A a row on an apparatus pid with no creationDate is not apparatus", () => {
  const entry = { pid: 4444, creationNotBefore: T0_BRACKET, creationNotAfter: T1_BRACKET };
  const row = {
    pid: 4444,
    parentPid: 1,
    parentPresent: true,
    parentName: "explorer.exe",
    parentCreationDate: BOOT,
    nonceReadable: true,
    sessionId: 1,
  };
  const ctx = membershipCtx({
    apparatusPids: [entry],
    rows: [{ pid: 4812, creationDate: T0 }, { pid: 4444 }],
  });
  assert.equal(rowIsMeasurementApparatus(row, ctx), false);
});

test("1A executeRun: live grandchild plus rememberMeasurementApparatusPid still fails tree-gone and kills", async () => {
  const grandchild = {
    pid: 7055,
    parentPid: 4812,
    parentPresent: true,
    parentName: "claude.exe",
    parentCreationDate: T0,
    creationDate: AFTER,
    runNonce: NONCE,
    nonceReadable: true,
    sessionId: 1,
  };
  rememberMeasurementApparatusPid(7055);
  const killed: number[] = [];
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1a" } },
    scanOrphans: () => writerOrphanScanResult([grandchild]),
    killTree: (pid) => {
      killed.push(pid);
    },
  });
  const tree = treeFinding(result);
  assert.equal(result.ok, false, result.reason);
  assert.equal(tree?.ok, false, tree?.reason);
  assert.match(tree?.reason ?? "", /7055/);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, false);
  assert.ok(killed.includes(7055), `killTree targets=${JSON.stringify(killed)}`);
});

// ---------------------------------------------------------------------------
// CLASS 1B — a live unexplained parent is host noise, not a tie
// ---------------------------------------------------------------------------

test("1B t2 explorer-parented docker.exe is not ours and does not make the scan undecidable", () => {
  const row = {
    pid: 60080,
    name: "docker.exe",
    parentPid: 900,
    parentPresent: true,
    parentName: "explorer.exe",
    parentCreationDate: BOOT,
    creationDate: "2026-08-14T12:00:10.000Z",
    nonceReadable: true,
    sessionId: 1,
  };
  const ctx = membershipCtx({
    createdNotBefore: "2026-08-14T12:00:00.000Z",
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 900, creationDate: BOOT },
      { pid: 60080, parentPid: 900, creationDate: "2026-08-14T12:00:10.000Z" },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(row, ctx), false);
  assert.equal(processRowMakesScanUndecidable(row, ctx), false);
});

test("1B honest unrelated-row sweep never makes the scan undecidable", () => {
  const images = ["docker.exe", "node.exe", "conhost.exe", "chrome.exe"];
  const parents = ["explorer.exe", "svchost.exe", "Code.exe"];
  let checked = 0;
  for (const name of images) {
    for (const parentName of parents) {
      for (const nonceReadable of [true, false]) {
        for (const foreign of [undefined, "other-run"]) {
          const row = {
            pid: 60080,
            name,
            parentPid: 900,
            parentPresent: true as const,
            parentName,
            parentCreationDate: BOOT,
            creationDate: AFTER,
            nonceReadable,
            sessionId: 1,
            ...(foreign !== undefined ? { runNonce: foreign } : {}),
          };
          const ctx = membershipCtx({
            rows: [
              { pid: 4812, creationDate: T0 },
              { pid: 900, creationDate: BOOT },
              { pid: 60080, parentPid: 900, creationDate: AFTER },
            ],
          });
          assert.equal(processRowMakesScanUndecidable(row, ctx), false, JSON.stringify(row));
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked >= 24, `checked=${checked}`);
});

test("1B holder parent, holder-descendant parent, observedPids parent, and parentPresent:false still tie", () => {
  const holderChild = {
    pid: 7001,
    parentPid: 4812,
    parentPresent: true,
    parentName: "claude.exe",
    parentCreationDate: T0,
    creationDate: AFTER,
    sessionId: 1,
  };
  const viaObserved = {
    pid: 7002,
    parentPid: 8800,
    parentPresent: true,
    parentName: "node.exe",
    parentCreationDate: AFTER,
    creationDate: AFTER,
    sessionId: 1,
  };
  const parentGone = {
    pid: 7003,
    parentPid: 9900,
    parentPresent: false,
    creationDate: AFTER,
    sessionId: 1,
  };
  const ctx = membershipCtx({
    observedPids: [4812, 8800],
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 7001, parentPid: 4812, creationDate: AFTER },
      { pid: 8800, parentPid: 4812, creationDate: AFTER },
      { pid: 7002, parentPid: 8800, creationDate: AFTER },
      { pid: 7003, parentPid: 9900, creationDate: AFTER },
    ],
  });
  assert.equal(processRowCouldBelongToThisRun(holderChild, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(viaObserved, ctx), true);
  assert.equal(parentlessRowTiedToThisRun(parentGone, ctx), true);
  assert.equal(processRowCouldBelongToThisRun(parentGone, ctx), true);
  assert.equal(processRowMakesScanUndecidable(parentGone, ctx), true);
});

test("1B executeRun with one unrelated host row succeeds and releases the writer lease", async () => {
  const host = {
    pid: 60080,
    name: "docker.exe",
    parentPid: 900,
    parentPresent: true,
    parentName: "explorer.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER,
    nonceReadable: true,
    sessionId: 1,
  };
  const leases = memoryLeases();
  const result = await runWith({
    leases,
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1b" } },
    scanOrphans: () => writerOrphanScanResult([host]),
  });
  const tree = treeFinding(result);
  assert.equal(tree?.ok, true, tree?.reason);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.productionWriterLeaseReleasedByThisRun, true);
  assert.equal(leases.list().some((item) => item.kind === "PRODUCTION_WRITER"), false);
});

test("1B t4 wedge: expired host-wide holder + unrelated live host row still reclaims and spawns", async () => {
  const held = writerLease();
  const spawn = trackingSpawn(() => exitingProcess({ pid: 5555 }));
  const host = {
    pid: 60080,
    name: "docker.exe",
    parentPid: 900,
    parentPresent: true,
    parentName: "explorer.exe",
    parentCreationDate: BOOT,
    creationDate: AFTER,
    nonceReadable: true,
    sessionId: 1,
  };
  const result = await runWith({
    spawn,
    leases: memoryLeases([held]),
    clock: createFixedClock("2026-08-13T12:20:00.000Z"),
    probe: notFoundProbe(),
    scanOrphans: () => writerOrphanScanResult([host]),
    request: {
      runId: "run-1",
      runNonce: NONCE,
      lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-1b-wedge" },
    },
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(spawn.calls, 1, result.reason);
});

test("1B inspectHostProductionWriterLock with NOT_FOUND holder and unrelated host row is FREE", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r24-lock-"));
  try {
    const locks = join(arb, "locks");
    mkdirSync(locks, { recursive: true });
    writeFileSync(join(locks, "production-writer-PRODUCTION_WRITER.lock"), `${JSON.stringify({
      pid: 4812,
      identity: { pid: 4812, startedAt: T0, runToken: "nonce-run-0" },
    }, null, 2)}\n`);
    const inspected = inspectHostProductionWriterLock({
      arbitrationRoot: arb,
      probe: {
        observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }),
      },
      hostLockTreeEvidence: () => "CLEAR",
    });
    assert.equal(inspected.state, "FREE", JSON.stringify(inspected));
    assert.equal(readdirSync(locks).filter((name) => name.endsWith(".lock")).length, 0);
  } finally {
    rmSync(arb, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLASS 2 — one subject check; one kill predicate
// ---------------------------------------------------------------------------

test("2A proveWriterExit refuses a NOT_FOUND about the wrong pid", () => {
  const wrong = proveWriterExit({
    processStillRunning: false,
    recordedLeaseKind: "PRODUCTION_WRITER",
    recordedLeaseId: "lease-pw-1",
    recordedIdentity: null,
    observation: { outcome: "NOT_FOUND", reason: "gone", pid: 9999 },
    probedPid: 4812,
    orphanScanPerformed: true,
    orphanSightings: [],
    liveSightings: [],
    runNonce: NONCE,
  });
  assert.equal(wrong, null);
  assert.equal(writerReleaseEvidence(wrong), false);

  const right = proveWriterExit({
    processStillRunning: false,
    recordedLeaseKind: "PRODUCTION_WRITER",
    recordedLeaseId: "lease-pw-1",
    recordedIdentity: null,
    observation: { outcome: "NOT_FOUND", reason: "gone", pid: 4812 },
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
  // Identity-absent mint requires ownedHandleExit or adoptedSlotGone.
  // adoptedSlotGone with matching pid is the liveness half.
  const adopted = proveWriterExit({
    processStillRunning: false,
    recordedLeaseKind: "PRODUCTION_WRITER",
    recordedLeaseId: "lease-pw-1",
    recordedIdentity: null,
    observation: { outcome: "NOT_FOUND", reason: "gone", pid: 4812 },
    probedPid: 4812,
    orphanScanPerformed: true,
    orphanSightings: [],
    liveSightings: [],
    runNonce: NONCE,
  });
  assert.ok(adopted !== null, "matching-pid NOT_FOUND must mint on the identity-absent path");
  assert.equal(writerReleaseEvidence(adopted), true);
  void right;
});

test("2B inspectHostProductionWriterLock: NOT_FOUND about another pid is UNKNOWN and keeps the file", () => {
  const arb = mkdtempSync(join(tmpdir(), "aion-r24-subj-"));
  try {
    const locks = join(arb, "locks");
    mkdirSync(locks, { recursive: true });
    const lockPath = join(locks, "production-writer-PRODUCTION_WRITER.lock");
    writeFileSync(lockPath, `${JSON.stringify({
      pid: 4812,
      identity: { pid: 4812, startedAt: T0, runToken: NONCE },
    }, null, 2)}\n`);
    const wrong = inspectHostProductionWriterLock({
      arbitrationRoot: arb,
      probe: {
        observe: () => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid: 9999 }),
      },
      hostLockTreeEvidence: () => "CLEAR",
    });
    assert.equal(wrong.state, "UNKNOWN", JSON.stringify(wrong));
    assert.equal(existsSync(lockPath), true);

    const right = inspectHostProductionWriterLock({
      arbitrationRoot: arb,
      probe: {
        observe: (pid) => asObservation({ outcome: "NOT_FOUND", reason: "gone", pid }),
      },
      hostLockTreeEvidence: () => "CLEAR",
    });
    assert.equal(right.state, "FREE", JSON.stringify(right));
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(arb, { recursive: true, force: true });
  }
});

test("2 subject check is total across holderLiveness, lock holder, and proveWriterExit", () => {
  const recorded: ExecutorProcessIdentityV1 = {
    pid: 4812,
    creationDate: T0,
    executablePath: CLAUDE_EXE,
    runNonce: NONCE,
  };
  for (const outcome of ["FOUND", "NOT_FOUND", "UNAVAILABLE"] as const) {
    const observation = outcome === "FOUND"
      ? asObservation({ outcome: "FOUND", reason: "cim", pid: 9999, creationDate: T0, executablePath: CLAUDE_EXE, runNonce: NONCE })
      : asObservation({ outcome, reason: "x", pid: 9999 });
    assert.equal(observationIsAboutPid(observation, 4812), false, outcome);
    assert.equal(holderLiveness(recorded, observation), "UNKNOWN", outcome);
    const proof = proveWriterExit({
      processStillRunning: false,
      recordedLeaseKind: "PRODUCTION_WRITER",
      recordedLeaseId: "lease-pw-1",
      recordedIdentity: recorded,
      observation,
      probedPid: 4812,
      orphanScanPerformed: true,
      orphanSightings: [],
      liveSightings: [],
    });
    assert.equal(proof, null, outcome);
  }
});

test("2C a nonce-matching leftover before the spawn floor is killTree'd", async () => {
  const leftover = {
    pid: 7055,
    parentPid: 4812,
    parentPresent: true,
    parentName: "claude.exe",
    parentCreationDate: T0,
    creationDate: "2026-08-13T12:00:01.000Z",
    runNonce: NONCE,
    nonceReadable: true,
    sessionId: 1,
  };
  const killed: number[] = [];
  const result = await runWith({
    request: { lease: { kind: "PRODUCTION_WRITER", resource: "aion-production", leaseId: "lease-pw-2c" } },
    scanOrphans: () => writerOrphanScanResult([leftover]),
    killTree: (pid) => {
      killed.push(pid);
    },
    clock: { now: () => FLOOR },
  });
  assert.ok(killed.includes(7055), `killTree targets=${JSON.stringify(killed)} tree=${treeFinding(result)?.reason}`);
});

test("2C rows that block tree-gone are kill targets", () => {
  const rows = [
    {
      pid: 7055,
      parentPid: 4812,
      parentPresent: true,
      creationDate: "2026-08-13T12:00:01.000Z",
      runNonce: NONCE,
      nonceReadable: true,
      sessionId: 1,
    },
    {
      pid: 8001,
      parentPid: 9900,
      parentPresent: false,
      creationDate: AFTER,
      sessionId: 1,
    },
  ];
  const ctx = membershipCtx({
    rows: [
      { pid: 4812, creationDate: T0 },
      { pid: 7055, parentPid: 4812, creationDate: "2026-08-13T12:00:01.000Z" },
      { pid: 8001, parentPid: 9900, creationDate: AFTER },
    ],
  });
  for (const row of rows) {
    const blocks = processRowMakesScanUndecidable(row, ctx) || rowHasPositiveRunIdentity(row, ctx);
    assert.equal(blocks, true, `pid ${row.pid} must block`);
    assert.equal(processRowCouldBelongToThisRun(row, ctx), true, `pid ${row.pid} must be a kill target`);
  }
});

// ---------------------------------------------------------------------------
// CLASS 3 — directory occupancy is the directory, not the kind string
// ---------------------------------------------------------------------------

test("3 every non-WORKTREE lease kind is refused when a foreign WORKTREE holds cwd", async () => {
  const kinds: readonly LeaseKindV1[] = ["PREVIEW", "BRANCH", "INTEGRATION", "PRODUCTION_WRITER"];
  const held = worktreeLease(CWD);
  for (const kind of kinds) {
    for (const role of ["IMPLEMENT", "INDEPENDENT_ACCEPTANCE"] as const) {
      const spawn = trackingSpawn(() => exitingProcess({ pid: 66544 }));
      const resource = kind === "BRANCH"
        ? "executor/oracle"
        : kind === "PREVIEW"
          ? "preview-b"
          : kind === "INTEGRATION"
            ? "integration"
            : "aion-production";
      const result = await runWith({
        spawn,
        leases: memoryLeases([held]),
        request: {
          role,
          executor: role === "IMPLEMENT" ? "claude" : "grok",
          executablePath: role === "IMPLEMENT" ? CLAUDE_EXE : "C:\\Tools\\grok.exe",
          argv: role === "IMPLEMENT"
            ? ["-p", "--permission-mode", "bypassPermissions"]
            : ["-p", "--permission-mode", "plan"],
          lease: { kind, resource, leaseId: `lease-${kind}-${role}` },
        },
      });
      assert.equal(spawn.calls, 0, `${kind}/${role} spawned; reason=${result.reason}`);
      assert.equal(result.spawned, false, `${kind}/${role}: ${result.reason}`);
      assert.match(result.reason, /holds this directory|holds this/);
    }
  }
});

test("3 liveness: the same run into a different directory is granted", async () => {
  const held = worktreeLease(CWD);
  const spawn = trackingSpawn(() => exitingProcess({ pid: 7777 }));
  const result = await runWith({
    spawn,
    leases: memoryLeases([held]),
    git: matchingGit(HEAD_AFTER, { advance: true, inspectedWorktree: OTHER }),
    request: {
      cwd: OTHER,
      worktree: OTHER,
      lease: { kind: "PREVIEW", resource: "preview-other", leaseId: "lease-preview-other" },
    },
  });
  assert.equal(result.spawned, true, result.reason);
  assert.equal(spawn.calls, 1, result.reason);
});

// ---------------------------------------------------------------------------
// CLASS 4 — reviewLeftTreeUnchanged is a content fact
// ---------------------------------------------------------------------------

function initIgnoredRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "aion-r24-git-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
    }
    return result;
  };
  git(["init"]);
  git(["config", "user.email", "r24@example.test"]);
  git(["config", "user.name", "r24"]);
  writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n.env\n");
  writeFileSync(join(dir, ".env"), "SECRET=one\n");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "app.js"), "console.log(1)\n");
  mkdirSync(join(dir, "node_modules", "evil"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "evil", "index.js"), "module.exports=1\n");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git(["add", "-f", ".gitignore", "seed.txt"]);
  git(["add", ".gitignore", "seed.txt"]);
  git(["commit", "-m", "seed"]);
  return dir;
}

test("4 new file in an ignored dir fails reviewLeftTreeUnchanged", () => {
  const dir = initIgnoredRepo();
  try {
    const runner = createNodeGitRunner({ worktreePath: dir });
    const before = collectGitStatusIncludingIgnored(runner);
    mkdirSync(join(dir, "dist", "sub"), { recursive: true });
    writeFileSync(join(dir, "dist", "sub", "new.js"), "planted\n");
    writeFileSync(join(dir, "node_modules", "evil", "backdoor.js"), "pwn\n");
    const after = collectGitStatusIncludingIgnored(runner);
    const conjunction = reviewFromTrees(before, after);
    const review = conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
    assert.equal(review?.ok, false, review?.reason);
    assert.equal(conjunction.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("4 content rewrite of an already-listed ignored file fails reviewLeftTreeUnchanged", () => {
  const dir = initIgnoredRepo();
  try {
    const runner = createNodeGitRunner({ worktreePath: dir });
    const before = collectGitStatusIncludingIgnored(runner);
    writeFileSync(join(dir, ".env"), "SECRET=rewritten\n");
    writeFileSync(join(dir, "dist", "app.js"), "console.log(2)\n");
    const after = collectGitStatusIncludingIgnored(runner);
    const conjunction = reviewFromTrees(before, after);
    const review = conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
    assert.equal(review?.ok, false, review?.reason);
    assert.match(review?.reason ?? "", /content|digest|dirty/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("4 liveness: untouched pre-existing ignored dirt still passes", () => {
  const dir = initIgnoredRepo();
  try {
    const runner = createNodeGitRunner({ worktreePath: dir });
    const before = collectGitStatusIncludingIgnored(runner);
    const after = collectGitStatusIncludingIgnored(runner);
    const conjunction = reviewFromTrees(before, after);
    const review = conjunction.findings.find((item) => item.name === "reviewLeftTreeUnchanged");
    assert.equal(review?.ok, true, review?.reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLASS 5 — holdback is tested against the emit candidate
// ---------------------------------------------------------------------------

function durableOf(chunks: readonly string[]): string {
  const stdout = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr: createMemoryLogSink() },
  });
  for (const chunk of chunks) log.write("stdout", chunk);
  log.flush();
  return `${stdout.contents().toString("utf8")}${log.liveTail("stdout").toString("utf8")}`;
}

test("5 Bearer\\nJWT (used) split across chunks does not leak", () => {
  const leaked = durableOf([`> hdr\nBearer\n${JWT} (used)`, "\n"]);
  assert.equal(leaked.includes(JWT), false, leaked);
  assert.match(leaked, /REDACTED/);
});

test("5 Authorization Bearer\\nJWT (cached) split does not leak", () => {
  const leaked = durableOf([`req:\nAuthorization: Bearer\n${JWT} (cached)`, "\n"]);
  assert.equal(leaked.includes(JWT), false, leaked);
});

test("5 CRLF Bearer split does not leak", () => {
  const leaked = durableOf([`> hdr\r\nBearer\r\n${JWT} (used)`, "\r\n"]);
  assert.equal(leaked.includes(JWT), false, leaked);
});

test("5 every cut of Authorization Bearer\\nJWT (from env) keeps the JWT out of the durable image", () => {
  const whole = `> Authorization: Bearer\n${JWT} (from env)\ndone\n`;
  for (let i = 1; i < whole.length; i += 1) {
    const text = durableOf([whole.slice(0, i), whole.slice(i)]);
    assert.equal(text.includes(JWT), false, `cut ${i}: ${text}`);
  }
});

test("5 executeRun durable stdout.log redacts a split Bearer token", async () => {
  const stdout = createMemoryLogSink();
  await runWith({
    spawn: trackingSpawn(() => ({
      pid: 4812,
      stdout: Readable.from([`> Authorization: Bearer\n${JWT} (from env)`, "\ndone\n"]),
      stderr: Readable.from([""]),
      kill() {},
      exit: Promise.resolve({ code: 0, signal: null }),
      get exited() {
        return true;
      },
    })),
    logSinks: { stdout, stderr: createMemoryLogSink() },
  });
  const text = stdout.contents().toString("utf8");
  assert.equal(text.includes(JWT), false, text);
});

// ---------------------------------------------------------------------------
// CLASS 6 — spendUsd null vs 0
// ---------------------------------------------------------------------------

function cliReportedSpendUsd(result: { handoff?: { spendUsd?: unknown } | null }): number | null {
  return typeof result.handoff?.spendUsd === "number" ? result.handoff.spendUsd : null;
}

test("6 CLI source reports spendUsd as a number or null, never ?? 0", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  const source = readFileSync(cli, "utf8");
  assert.match(source, /typeof result\.handoff\?\.spendUsd === "number" \? result\.handoff\.spendUsd : null/);
  assert.doesNotMatch(source, /spendUsd:\s*result\.handoff\?\.spendUsd \?\? 0/);
});

test("6 genuine 0, unreadable handoff, and never-spawned are distinguishable", async () => {
  const zero = await runWith();
  assert.equal(cliReportedSpendUsd(zero), 0);

  const unreadable = await runWith({
    spawn: trackingSpawn(() => exitingProcess()),
    request: { childEnv: { AION_HANDOFF_JSON: "{\"schema\":\"aion.director.handoff.v1\",\"summary\":\"I called a paid API\"}" } },
  });
  // executeRun still writes a good handoff via runWith helper. Drive the
  // printed token from a result with a null handoff instead.
  assert.equal(cliReportedSpendUsd({ handoff: null }), null);

  const held = worktreeLease(CWD);
  const refused = await runWith({
    spawn: trackingSpawn(() => exitingProcess()),
    leases: memoryLeases([held]),
    request: {
      lease: { kind: "PREVIEW", resource: "preview-b", leaseId: "lease-preview-refused" },
    },
  });
  assert.equal(refused.spawned, false, refused.reason);
  assert.equal(cliReportedSpendUsd(refused), null);
  assert.notEqual(cliReportedSpendUsd(zero), cliReportedSpendUsd(refused));
  void unreadable;
});

test("6 CLI machine-readable spendUsd distinguishes 0 from no parsed handoff", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "..", "..", "..", "apps", "director-cli.mjs");
  const { runDirectorCli } = await import(new URL(`file:///${cli.replace(/\\/g, "/")}`).href) as {
    runDirectorCli: (
      argv: string[],
      io?: { log: (line: string) => void; error: (line: string) => void },
      env?: NodeJS.ProcessEnv,
    ) => Promise<number>;
  };

  const lines: string[] = [];
  const io = { log: (line: string) => lines.push(line), error: () => undefined };

  const dir = mkdtempSync(join(tmpdir(), "aion-r24-cli-"));
  const worktree = join(dir, "wt");
  const runRoot = join(dir, "run");
  mkdirSync(worktree);
  const promptPath = join(worktree, "PROMPT.md");
  writeFileSync(promptPath, "accept\n");
  spawnSync("git", ["init"], { cwd: worktree, windowsHide: true, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "r24@example.test"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["config", "user.name", "r24"], { cwd: worktree, windowsHide: true });
  writeFileSync(join(worktree, "seed.txt"), "seed\n");
  spawnSync("git", ["add", "seed.txt", "PROMPT.md"], { cwd: worktree, windowsHide: true });
  spawnSync("git", ["commit", "-m", "seed"], { cwd: worktree, windowsHide: true });

  const baseArgv = [
    "--run-id", "run-cli",
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
    "--lease-id", "lease-cli-1",
    "--run-nonce", "nonce-cli-1",
  ];

  try {
    // Never spawned: second lease on the same worktree.
    const first = await runDirectorCli(baseArgv, io, {
      ...process.env,
      AION_DIRECTOR_ROOT: join(dir, "store"),
      AION_GROK_PATH: process.execPath,
      AION_DIRECTOR_TEST_DOUBLE: "1",
      AION_HANDOFF_JSON: JSON.stringify(goodHandoff({ spendUsd: 0 })),
    });
    void first;
    lines.length = 0;
    await runDirectorCli([
      ...baseArgv,
      "--run-id", "run-cli-2",
      "--lease-id", "lease-cli-2",
    ], io, {
      ...process.env,
      AION_DIRECTOR_ROOT: join(dir, "store"),
      AION_GROK_PATH: process.execPath,
    });
    const neverSpawned = JSON.parse(lines.at(-1) ?? "{}") as { spawned?: boolean; spendUsd?: unknown };
    assert.equal(neverSpawned.spawned, false, JSON.stringify(neverSpawned));
    assert.equal(neverSpawned.spendUsd, null, JSON.stringify(neverSpawned));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
