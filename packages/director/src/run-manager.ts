/**
 * The run: the sequence every other D2 module was built for.
 *
 * Discovery finds a binary. Adapters build argv. Intent is the only spawn permit. Identity is
 * more than a PID. Logs are bounded. Git is collected, never taken from a handoff. A lease and
 * a capacity slot are independent gates. This module is the order those facts are applied in,
 * and the conjunction that decides whether the run succeeded.
 *
 * Exit 0 is not success. Four Grok launches in this project exited 0 in 5–16 seconds having
 * written nothing; every one of them looked successful by exit code. The durable Git record is
 * what caught them. Each conjunct below is individually falsifiable so a failure names *which*
 * check failed rather than "run failed".
 *
 * ```
 * validate cwd exists and is a directory
 * acquire capacity AND the typed resource lease   (both; neither substitutes)
 * write the run intent, durably, and read it back → only this yields the spawn permit
 * spawn(absoluteExe, argv, { shell: false, windowsHide, cwd })
 * stream stdout/stderr through the bounded log
 * timeout / cancel ladder
 * collect Git truth after
 * parse the handoff
 * evaluate the success conjunction
 * write the durable result
 * release the lease
 * ```
 *
 * Spawn, clock, filesystem, Git runner, process probe, capacity, leases, wait, and tree-kill
 * are injected. The module is testable without launching a process. One wiring test launches
 * a real one.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  createBoundedLog,
  createMemoryLogSink,
  type BoundedLogReportV1,
  type ClockV1,
  type LogSinkV1,
} from "./bounded-log.js";
import { buildExecutorLaunch, classifyExecutorExit } from "./executor-adapters.js";
import {
  discoverClaudeExecutor,
  discoverGrokExecutor,
  type DiscoveryEnvironment,
  type ExecutorDiscoveryResultV1,
  type FileSystemProbe,
} from "./executor-discovery.js";
import type { ExecutorNameV1 } from "./executors.js";
import {
  collectGitTruth,
  verifyGitTruth,
  type GitObservationV1,
  type GitRunner,
  type GitVerdictV1,
} from "./git-truth.js";
import {
  findHandoffContradictions,
  parseHandoff,
  type ExecutorHandoffV1,
  type HandoffParseV1,
} from "./handoff.js";
import { isResolvedHostPath } from "./host-path.js";
import {
  acquireLease,
  releaseLease,
  type LeaseKindV1,
  type LeaseV1,
  type ProcessLivenessV1,
} from "./leases.js";
import {
  captureProcessIdentity,
  compareProcessIdentity,
  detectOrphan,
  holderLiveness,
  identityFromObservation,
  type ExecutorProcessIdentityV1,
  type HostProcessProbe,
  type ProcessObservationV1,
} from "./process-identity.js";
import {
  persistRunIntent,
  recordSpawnAttempt,
  recordSpawnObservation,
  type IntentStoreV1,
  type RunIntentV1,
  type SpawnPermitV1,
} from "./run-intent.js";

export const RUN_RESULT_SCHEMA_V1 = "aion.director.run-result.v1" as const;

export const CANCEL_SOFT_MS = 5_000;
export const CANCEL_HARD_MS = 10_000;

/** Control bytes, NUL first. Written as escapes so a raw byte never sits in source. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f]/;

const KNOWN_SUCCESS_EXIT_CODES: readonly number[] = [0];

export type SuccessConjunctNameV1 =
  | "processExitedWithKnownSuccessCode"
  | "handoffParsed"
  | "identitiesMatch"
  | "artifactsInsideRunRoot"
  | "gitAgreesWithHandoff"
  | "spendIsZero"
  | "productionClaimAgrees";

export interface ConjunctFindingV1 {
  readonly name: SuccessConjunctNameV1;
  readonly ok: boolean;
  readonly reason: string;
}

export interface SuccessConjunctionV1 {
  readonly ok: boolean;
  readonly findings: readonly ConjunctFindingV1[];
  readonly failedConjuncts: readonly SuccessConjunctNameV1[];
}

export type CancelStageV1 = "SOFT" | "HARD" | "ORPHAN";

export interface CancelReportV1 {
  readonly timedOut: boolean;
  readonly stages: readonly CancelStageV1[];
}

export interface SpawnOptionsV1 {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly windowsHide: true;
}

export interface SpawnExitV1 {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface SpawnHandleV1 {
  readonly pid: number;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(): void;
  readonly exit: Promise<SpawnExitV1>;
  readonly exited: boolean;
}

export type SpawnFnV1 = (
  executable: string,
  argv: readonly string[],
  options: SpawnOptionsV1,
) => SpawnHandleV1;

export interface RunFileSystemV1 {
  isDirectory(absolutePath: string): boolean;
  isFile(absolutePath: string): boolean;
  readUtf8(absolutePath: string): string;
  writeDurable(absolutePath: string, utf8: string): void;
  mkdirp(absolutePath: string): void;
}

export interface CapacityGateV1 {
  tryAcquire(executor: string): { ok: boolean; reason: string };
  release(executor: string): void;
}

export interface LeaseStoreV1 {
  list(): readonly LeaseV1[];
  save(leases: readonly LeaseV1[]): void;
}

export interface OrphanSightingV1 {
  readonly pid: number;
  readonly creationDate?: string;
  readonly runNonce?: string;
}

/**
 * Post-exit liveness question. Production probes the recorded pid and builds the
 * compared identity from what the probe returned. Tests may inject a different
 * observation; they cannot make the compared value be the recorded record.
 */
export interface WriterLivenessQuestionV1 {
  readonly subject: ExecutorProcessIdentityV1;
  readonly observation: ProcessObservationV1;
}

export interface RunManagerDepsV1 {
  readonly clock: ClockV1;
  readonly fs: RunFileSystemV1;
  readonly spawn: SpawnFnV1;
  readonly git: GitRunner;
  readonly probe: HostProcessProbe;
  readonly capacity: CapacityGateV1;
  readonly leases: LeaseStoreV1;
  readonly wait: (ms: number) => Promise<void>;
  readonly killTree: (pid: number) => void;
  readonly scanOrphans?: (query: { runNonce: string; createdNotBefore: string }) => readonly OrphanSightingV1[];
  readonly logSinks?: { readonly stdout: LogSinkV1; readonly stderr: LogSinkV1 };
  readonly askWriterLiveness?: (recorded: ExecutorProcessIdentityV1) => WriterLivenessQuestionV1;
}

export interface LaunchRunDepsV1 extends RunManagerDepsV1 {
  readonly discoveryEnv: DiscoveryEnvironment;
  readonly discoveryFs: FileSystemProbe;
}

export interface ExecuteRunRequestV1 {
  readonly runId: string;
  readonly missionId: string;
  readonly workItemId: string;
  readonly executor: ExecutorNameV1;
  readonly worktree: string;
  readonly branch: string | null;
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly runNonce: string;
  readonly runRoot: string;
  readonly promptPath?: string;
  readonly timeoutMs: number;
  readonly lease: {
    readonly kind: LeaseKindV1;
    readonly resource: string;
    readonly leaseId: string;
  };
  readonly authorisedProductionMutated: boolean;
  readonly knownSuccessExitCodes?: readonly number[];
  readonly childEnv?: Readonly<Record<string, string>>;
}

/**
 * A launch request. Discovery and the adapter decide executable and argv; the caller
 * does not supply a pre-built command line.
 */
export type LaunchRunRequestV1 = Omit<ExecuteRunRequestV1, "executablePath" | "argv"> & {
  readonly promptPath: string;
};

export interface RunResultV1 {
  readonly schema: typeof RUN_RESULT_SCHEMA_V1;
  readonly ok: boolean;
  readonly spawned: boolean;
  readonly reason: string;
  readonly conjunction: SuccessConjunctionV1;
  readonly exitCode: number | null;
  readonly processIdentity: ExecutorProcessIdentityV1 | null;
  readonly intent: RunIntentV1 | null;
  readonly handoff: ExecutorHandoffV1 | null;
  readonly gitAfter: GitObservationV1 | null;
  readonly lease: LeaseV1 | null;
  readonly productionWriterLeaseReleasedByThisRun: boolean;
  readonly cancel: CancelReportV1;
  readonly log: BoundedLogReportV1 | null;
  readonly resultPath: string | null;
}

export interface WriterOrphanScanV1 {
  readonly performed: boolean;
  readonly liveSightings: readonly OrphanSightingV1[];
}

export interface WriterReleaseEvidenceInputV1 {
  readonly recordedLeaseKind: LeaseKindV1 | null;
  readonly recordedLeaseId: string | null;
  readonly releasedLeaseId: string | null;
  readonly recordedIdentity: ExecutorProcessIdentityV1 | null;
  readonly liveness: ProcessLivenessV1 | null;
  readonly livenessAskedAbout: ExecutorProcessIdentityV1 | null;
  /** `null` means the run did not establish whether the child is still running. */
  readonly stillRunning: boolean | null;
  /** `null` or `performed: false` means no orphan scan ran. Absence is not emptiness. */
  readonly orphanScan: WriterOrphanScanV1 | null;
}

/**
 * `productionWriterLeaseReleasedByThisRun` is a process fact, not a lease fact.
 *
 * True only when every conjunct holds:
 * - the recorded lease is `PRODUCTION_WRITER`
 * - this run's recorded lease id was explicitly released
 * - the child is confirmed exited (`stillRunning === false`)
 * - an orphan scan for this run's nonce ran and found nothing alive
 * - `recordedIdentity` names the holder this run captured
 * - if the probe named a process, it is this run's recorded holder
 *
 * A released lease, a `DEPLOY_COMPLETED` event, a free lease slot, or
 * `DEAD_CONFIRMED` of the parent is not enough. Unknown or missing ⇒ false.
 */
export function writerReleaseEvidence(input: WriterReleaseEvidenceInputV1): boolean {
  if (input.recordedLeaseKind !== "PRODUCTION_WRITER") return false;
  if (input.recordedLeaseId === null || input.releasedLeaseId === null) return false;
  if (input.releasedLeaseId !== input.recordedLeaseId) return false;
  if (input.stillRunning !== false) return false;
  if (input.orphanScan === null || !input.orphanScan.performed) return false;
  if (input.orphanScan.liveSightings.length > 0) return false;
  if (input.recordedIdentity === null) return false;
  if (input.liveness === "ALIVE") return false;
  if (
    input.livenessAskedAbout !== null
    && !askedAboutThisHolder(input.recordedIdentity, input.livenessAskedAbout)
  ) {
    return false;
  }
  return true;
}

function askedAboutThisHolder(
  recorded: ExecutorProcessIdentityV1,
  askedAbout: ExecutorProcessIdentityV1,
): boolean {
  return compareProcessIdentity(recorded, askedAbout) === "MATCH"
    && recorded.runNonce === askedAbout.runNonce;
}

export function evaluateSuccessConjunction(input: {
  readonly exitCode: number | null;
  readonly stillRunning: boolean;
  readonly knownSuccessExitCodes?: readonly number[];
  readonly executor: ExecutorNameV1;
  readonly output: string;
  readonly parsed: HandoffParseV1;
  readonly reportedWorkItemId: string | null;
  readonly expectedMissionId: string;
  readonly expectedRunId: string;
  readonly expectedWorkItemId: string;
  readonly runRoot: string;
  readonly gitAfter: GitObservationV1 | null;
  readonly gitVerdict: GitVerdictV1 | null;
  readonly authorisedProductionMutated: boolean;
}): SuccessConjunctionV1 {
  const known = input.knownSuccessExitCodes ?? KNOWN_SUCCESS_EXIT_CODES;
  const classified = input.exitCode === null
    ? null
    : classifyExecutorExit(input.executor, input.exitCode, input.output);

  const exitOk = !input.stillRunning
    && input.exitCode !== null
    && known.includes(input.exitCode)
    && (classified === null || classified.kind === "COMPLETED");

  const exitReason = input.stillRunning
    ? "the process is still running"
    : input.exitCode === null
      ? "the process did not produce an exit code"
      : !known.includes(input.exitCode)
        ? `exit code ${input.exitCode} is not a known-success code`
        : classified !== null && classified.kind !== "COMPLETED"
          ? `exit ${input.exitCode} classified as ${classified.kind}, not a completed run`
          : "process exited with a known-success code";

  const parsed = input.parsed;
  const handoff = parsed.ok ? parsed.handoff : null;
  const reportedWorkItem = input.reportedWorkItemId;

  const observedBranch = input.gitAfter !== null && input.gitAfter.branch.outcome === "ATTACHED"
    ? input.gitAfter.branch.name
    : undefined;
  const contradictions = handoff === null
    ? []
    : findHandoffContradictions({
      handoff,
      ...(observedBranch !== undefined ? { observedBranch } : {}),
      productionActuallyMutated: input.authorisedProductionMutated,
    });

  const statusContradiction = contradictions.find((item) => item.field === "status");
  const selfTiming = contradictions.find((item) => item.field === "finishedAt");
  const handoffParsedOk = handoff !== null
    && handoff.status === "PASS"
    && statusContradiction === undefined
    && selfTiming === undefined;

  let handoffParsedReason: string;
  if (handoff === null) {
    handoffParsedReason = `handoff did not parse: ${parsed.problems.join("; ")}`;
  } else if (handoff.status !== "PASS") {
    handoffParsedReason = `handoff status is ${handoff.status}, not PASS`;
  } else if (statusContradiction !== undefined) {
    handoffParsedReason = statusContradiction.detail;
  } else if (selfTiming !== undefined) {
    handoffParsedReason = selfTiming.detail;
  } else {
    handoffParsedReason = "handoff parsed";
  }

  const identitiesOk = handoff !== null
    && handoff.missionId === input.expectedMissionId
    && handoff.runId === input.expectedRunId
    && reportedWorkItem !== null
    && reportedWorkItem === input.expectedWorkItemId;

  let identitiesReason = "mission id, run id and work item match what was dispatched";
  if (handoff === null) {
    identitiesReason = "no parsed handoff to bind to the dispatched ids";
  } else if (handoff.missionId !== input.expectedMissionId) {
    identitiesReason = `missionId ${handoff.missionId} is not the dispatched ${input.expectedMissionId}`;
  } else if (handoff.runId !== input.expectedRunId) {
    identitiesReason = `runId ${handoff.runId} is not the dispatched ${input.expectedRunId}`;
  } else if (reportedWorkItem === null) {
    identitiesReason = "handoff does not name the dispatched work item";
  } else if (reportedWorkItem !== input.expectedWorkItemId) {
    identitiesReason = `workItemId ${reportedWorkItem} is not the dispatched ${input.expectedWorkItemId}`;
  }

  const artifactProblems = parsed.problems.filter((problem) => /artifact/i.test(problem));
  let artifactsOk = false;
  let artifactsReason: string;
  if (handoff !== null) {
    artifactsOk = true;
    artifactsReason = "every artifact is inside the run root";
  } else if (artifactProblems.length > 0) {
    artifactsReason = artifactProblems[0]!;
  } else {
    artifactsReason = "no parsed handoff whose artifacts can be confined to the run root";
  }

  const gitContradiction = contradictions.find((item) => item.field === "headAfter" || item.field === "branch");
  let gitOk = false;
  let gitReason: string;
  if (handoff === null) {
    gitReason = "no parsed handoff whose headAfter can be compared to Git";
  } else if (input.gitAfter === null || input.gitVerdict === null) {
    gitReason = "Git was not observed; absence is not agreement with the handoff";
  } else if (!input.gitVerdict.ok) {
    gitReason = input.gitVerdict.findings.filter((finding) => finding.blocking).map((finding) => finding.detail).join("; ")
      || "Git verdict failed";
  } else if (gitContradiction !== undefined) {
    gitReason = gitContradiction.detail;
  } else {
    gitOk = true;
    gitReason = "Director Git observation agrees with the handoff";
  }

  const spendContradiction = contradictions.find((item) => item.field === "spendUsd");
  let spendOk = false;
  let spendReason: string;
  if (handoff === null) {
    spendReason = "no parsed handoff whose spend can be checked";
  } else if (spendContradiction !== undefined) {
    spendReason = `spendUsd is ${handoff.spendUsd}; the envelope permits 0`;
  } else {
    spendOk = true;
    spendReason = "spend is 0";
  }

  const productionContradiction = contradictions.find((item) => item.field === "productionMutated");
  let productionOk = false;
  let productionReason: string;
  if (handoff === null) {
    productionReason = "no parsed handoff whose production claim can be checked";
  } else if (productionContradiction !== undefined) {
    productionReason = handoff.productionMutated
      ? "handoff claims production was mutated; that was not authorised"
      : "handoff claims production was left alone; mutation was authorised and the claims disagree";
  } else {
    productionOk = true;
    productionReason = "production-mutation claim agrees with what was authorised";
  }

  const findings: ConjunctFindingV1[] = [
    { name: "processExitedWithKnownSuccessCode", ok: exitOk, reason: exitReason },
    {
      name: "handoffParsed",
      ok: handoffParsedOk,
      reason: handoffParsedReason,
    },
    { name: "identitiesMatch", ok: identitiesOk, reason: identitiesReason },
    { name: "artifactsInsideRunRoot", ok: artifactsOk, reason: artifactsReason },
    { name: "gitAgreesWithHandoff", ok: gitOk, reason: gitReason },
    { name: "spendIsZero", ok: spendOk, reason: spendReason },
    { name: "productionClaimAgrees", ok: productionOk, reason: productionReason },
  ];

  const failedConjuncts = findings.filter((finding) => !finding.ok).map((finding) => finding.name);
  return {
    ok: failedConjuncts.length === 0,
    findings,
    failedConjuncts,
  };
}

/**
 * The reachable launch path: discovery → adapters → executeRun (intent, spawn, log, Git, conjunction).
 *
 * Callers that already have an executable and argv use {@link executeRun}. Everything that
 * still has to find a binary and build argv comes through here, so the fail-closed ladder
 * and the measured adapters are the ones that decide.
 */
export async function launchRun(
  request: LaunchRunRequestV1,
  deps: LaunchRunDepsV1,
): Promise<RunResultV1> {
  const discovery = discoverExecutor(request.executor, deps.discoveryEnv, deps.discoveryFs);
  if (discovery.status !== "FOUND") {
    const reason = discovery.status === "AMBIGUOUS"
      ? `executor discovery ambiguous: ${discovery.reason}`
      : `executor discovery: ${discovery.reason}`;
    return refusedBeforeSpawn(request, deps, reason);
  }

  const adapted = buildExecutorLaunch(request.executor, {
    promptPath: request.promptPath,
    cwd: request.cwd,
    runNonce: request.runNonce,
  });
  if (!adapted.ok || adapted.launch === null) {
    return refusedBeforeSpawn(request, deps, `executor adapter: ${adapted.reason}`);
  }

  return executeRun({
    ...request,
    executablePath: discovery.executablePath,
    argv: adapted.launch.argv,
    childEnv: { ...adapted.launch.env, ...(request.childEnv ?? {}) },
    promptPath: adapted.launch.promptPath,
  }, deps);
}

function discoverExecutor(
  name: ExecutorNameV1,
  env: DiscoveryEnvironment,
  probe: FileSystemProbe,
): ExecutorDiscoveryResultV1 {
  if (name === "claude") return discoverClaudeExecutor(env, probe);
  if (name === "grok") return discoverGrokExecutor(env, probe);
  return { status: "UNAVAILABLE", reason: "the local in-process executor is not implemented and will not pretend to run" };
}

function refusedBeforeSpawn(
  request: LaunchRunRequestV1,
  deps: LaunchRunDepsV1,
  reason: string,
): RunResultV1 {
  const emptyParsed: HandoffParseV1 = { ok: false, handoff: null, problems: ["no handoff text"] };
  const conjunction = evaluateSuccessConjunction({
    exitCode: null,
    stillRunning: false,
    executor: request.executor,
    output: "",
    parsed: emptyParsed,
    reportedWorkItemId: null,
    expectedMissionId: request.missionId,
    expectedRunId: request.runId,
    expectedWorkItemId: request.workItemId,
    runRoot: request.runRoot,
    gitAfter: null,
    gitVerdict: null,
    authorisedProductionMutated: request.authorisedProductionMutated,
    ...(request.knownSuccessExitCodes !== undefined
      ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
      : {}),
  });
  const resultPath = join(request.runRoot, "result.json");
  const result: RunResultV1 = {
    schema: RUN_RESULT_SCHEMA_V1,
    resultPath,
    ok: false,
    spawned: false,
    reason,
    conjunction,
    exitCode: null,
    processIdentity: null,
    intent: null,
    handoff: null,
    gitAfter: null,
    lease: null,
    productionWriterLeaseReleasedByThisRun: false,
    cancel: { timedOut: false, stages: [] },
    log: null,
  };
  try {
    deps.fs.mkdirp(request.runRoot);
    deps.fs.writeDurable(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  } catch {
    // In-memory result is authoritative if the write fails.
  }
  return result;
}

export async function executeRun(
  request: ExecuteRunRequestV1,
  deps: RunManagerDepsV1,
): Promise<RunResultV1> {
  const runRoot = request.runRoot;
  const intentPath = join(runRoot, "intent.json");
  const resultPath = join(runRoot, "result.json");
  const handoffPath = join(runRoot, "handoff.json");
  const gitAfterPath = join(runRoot, "git-after.json");

  const emptyCancel: CancelReportV1 = { timedOut: false, stages: [] };
  const emptyParsed: HandoffParseV1 = { ok: false, handoff: null, problems: ["no handoff text"] };
  const emptyConjunction = evaluateSuccessConjunction({
    exitCode: null,
    stillRunning: false,
    executor: request.executor,
    output: "",
    parsed: emptyParsed,
    reportedWorkItemId: null,
    expectedMissionId: request.missionId,
    expectedRunId: request.runId,
    expectedWorkItemId: request.workItemId,
    runRoot,
    gitAfter: null,
    gitVerdict: null,
    authorisedProductionMutated: request.authorisedProductionMutated,
    ...(request.knownSuccessExitCodes !== undefined
      ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
      : {}),
  });

  const finish = (partial: Omit<RunResultV1, "schema" | "resultPath">): RunResultV1 => {
    const result: RunResultV1 = { schema: RUN_RESULT_SCHEMA_V1, resultPath, ...partial };
    try {
      deps.fs.mkdirp(runRoot);
      deps.fs.writeDurable(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    } catch {
      // A failed result write is reported on the in-memory object; it must not hide the run outcome.
    }
    return result;
  };

  // 1. A missing cwd is a spawn ENOENT that reads as an executable problem. Refuse it first.
  if (!isResolvedHostPath(request.cwd) || !deps.fs.isDirectory(request.cwd)) {
    return finish({
      ok: false,
      spawned: false,
      reason: "cwd does not name an existing directory; validating before spawn so a missing cwd is not reported as an executable ENOENT",
      conjunction: emptyConjunction,
      exitCode: null,
      processIdentity: null,
      intent: null,
      handoff: null,
      gitAfter: null,
      lease: null,
      productionWriterLeaseReleasedByThisRun: false,
      cancel: emptyCancel,
      log: null,
    });
  }

  // 2. Capacity AND the typed lease. Evaluate both; neither substitutes for the other.
  const leaseAttempt = acquireLease({
    existing: deps.leases.list(),
    leaseId: request.lease.leaseId,
    kind: request.lease.kind,
    resource: request.lease.resource,
    missionId: request.missionId,
    runId: request.runId,
    now: deps.clock.now(),
  });
  const capacityAttempt = deps.capacity.tryAcquire(request.executor);

  if (!capacityAttempt.ok || !leaseAttempt.ok || leaseAttempt.lease === null) {
    if (capacityAttempt.ok) deps.capacity.release(request.executor);
    const why = [
      capacityAttempt.ok ? null : `capacity refused: ${capacityAttempt.reason}`,
      leaseAttempt.ok ? null : `lease refused: ${leaseAttempt.reason}`,
    ].filter((part): part is string => part !== null).join("; ");
    return finish({
      ok: false,
      spawned: false,
      reason: why || "capacity and lease were not both acquired",
      conjunction: emptyConjunction,
      exitCode: null,
      processIdentity: null,
      intent: null,
      handoff: null,
      gitAfter: null,
      lease: null,
      productionWriterLeaseReleasedByThisRun: false,
      cancel: emptyCancel,
      log: null,
    });
  }

  const heldLease = leaseAttempt.lease;
  deps.leases.save([...deps.leases.list().filter((item) => item.leaseId !== heldLease.leaseId), heldLease]);
  let releasedLeaseId: string | null = null;
  let capacityHeld = true;
  let stillRunning = false;
  let orphanScan: WriterOrphanScanV1 = { performed: false, liveSightings: [] };

  const releaseHeld = (): void => {
    if (releasedLeaseId === null) {
      const withholdProductionWriter = heldLease.kind === "PRODUCTION_WRITER"
        && (stillRunning || (orphanScan.performed && orphanScan.liveSightings.length > 0));
      if (!withholdProductionWriter) {
        const before = deps.leases.list();
        const remaining = releaseLease(before, heldLease.leaseId);
        deps.leases.save(remaining);
        const gone = before.some((item) => item.leaseId === heldLease.leaseId)
          && remaining.every((item) => item.leaseId !== heldLease.leaseId);
        if (gone) releasedLeaseId = heldLease.leaseId;
      }
    }
    if (capacityHeld) {
      deps.capacity.release(request.executor);
      capacityHeld = false;
    }
  };

  try {
    // 3. Persist the intent. The only value that permits a spawn is returned after write-and-read-back.
    const intentStore = intentStoreFromFs(deps.fs);
    const persistInput = {
      intentPath,
      runId: request.runId,
      missionId: request.missionId,
      workItemId: request.workItemId,
      worktree: request.worktree,
      branch: request.branch,
      executablePath: request.executablePath,
      argv: request.argv,
      cwd: request.cwd,
      runNonce: request.runNonce,
      now: deps.clock.now(),
      ...(request.promptPath !== undefined ? { promptPath: request.promptPath } : {}),
    };
    const persisted = persistRunIntent(persistInput, intentStore);
    if (!persisted.ok || persisted.permit === null) {
      return finish({
        ok: false,
        spawned: false,
        reason: persisted.reason,
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: null,
        intent: null,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: writerReleaseEvidence({
          recordedLeaseKind: heldLease.kind,
          recordedLeaseId: heldLease.leaseId,
          releasedLeaseId: null,
          recordedIdentity: null,
          liveness: null,
          livenessAskedAbout: null,
          stillRunning: false,
          orphanScan: { performed: false, liveSightings: [] },
        }),
        cancel: emptyCancel,
        log: null,
      });
    }

    let permit: SpawnPermitV1 = persisted.permit;

    // 4. Spawn only under the permit. shell is false. windowsHide is true. cwd is the validated one.
    let child: SpawnHandleV1;
    try {
      child = deps.spawn(request.executablePath, request.argv, {
        cwd: request.cwd,
        env: {
          ...(request.childEnv ?? {}),
          AION_RUN_NONCE: request.runNonce,
        },
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `spawn failed: ${errorMessage(error)}`,
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: null,
        intent: persisted.intent,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: emptyCancel,
        log: null,
      });
    }

    // 5. Record that spawn returned, then try to capture identity.
    // An unobservable process (access-denied, elevated executor) still started.
    // processIdentity === null must not mean "never spawned".
    const attempted = recordSpawnAttempt({
      permit,
      pid: child.pid,
      now: deps.clock.now(),
      store: intentStore,
    });
    if (!attempted.ok || attempted.permit === null) {
      try {
        child.kill();
      } catch {
        // Best effort. killTree is the follow-up.
      }
      try {
        deps.killTree(child.pid);
      } catch {
        // A failed kill must not leave the run looking successful.
      }
      stillRunning = !child.exited;
      orphanScan = collectWriterOrphans({
        scanOrphans: deps.scanOrphans,
        recorded: null,
        runNonce: request.runNonce,
        parentStillRunning: stillRunning,
        parentLiveness: stillRunning ? "ALIVE" : "DEAD_CONFIRMED",
      });
      return finish({
        ok: false,
        spawned: true,
        reason: `spawn returned but the attempt could not be recorded; child was stopped: ${attempted.reason}`,
        conjunction: emptyConjunction,
        exitCode: child.exited ? (await child.exit).code : null,
        processIdentity: null,
        intent: persisted.intent,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: emptyCancel,
        log: null,
      });
    }
    permit = attempted.permit;

    const captured = captureProcessIdentity(deps.probe, { pid: child.pid, runNonce: request.runNonce });
    const processIdentity = captured.ok ? captured.identity : null;
    if (processIdentity !== null) {
      const observed = recordSpawnObservation({
        permit,
        identity: processIdentity,
        now: deps.clock.now(),
        store: intentStore,
      });
      if (observed.ok && observed.permit !== null) permit = observed.permit;
    }

    const sinks = deps.logSinks ?? { stdout: createMemoryLogSink(), stderr: createMemoryLogSink() };
    const log = createBoundedLog({ clock: deps.clock, sinks });
    const stdoutDone = pumpStream(child.stdout, (chunk) => log.write("stdout", chunk));
    const stderrDone = pumpStream(child.stderr, (chunk) => log.write("stderr", chunk));

    // 6. Timeout / cancel ladder.
    const cancelStages: CancelStageV1[] = [];
    let timedOut = false;
    let exitCode: number | null = null;

    const exitWon = child.exited;
    if (exitWon) {
      const ended = await child.exit;
      exitCode = ended.code;
    } else {
      const raced = await raceExit(child, request.timeoutMs, deps.wait);
      if (raced.tag === "exit") {
        exitCode = raced.exit.code;
      } else {
        timedOut = true;
        const cancelled = await cancelLadder(child, deps, processIdentity, request.runNonce);
        cancelStages.push(...cancelled.stages);
        stillRunning = cancelled.stillRunning;
        exitCode = cancelled.exitCode;
      }
    }

    if (log.report().mustHalt && !child.exited) {
      const cancelled = await cancelLadder(child, deps, processIdentity, request.runNonce);
      for (const stage of cancelled.stages) {
        if (!cancelStages.includes(stage)) cancelStages.push(stage);
      }
      stillRunning = cancelled.stillRunning;
      if (cancelled.exitCode !== null) exitCode = cancelled.exitCode;
    }

    await settleStreams(stdoutDone, stderrDone, deps.wait);
    log.flush();
    const logReport = log.report();
    const output = `${log.liveTail("stdout").toString("utf8")}\n${log.liveTail("stderr").toString("utf8")}`;

    // 7. Independent Git after. Never taken from the handoff.
    const gitCollected = collectGitTruth({
      runner: deps.git,
      worktreePath: request.worktree,
      now: deps.clock.now(),
    });
    const gitAfter = gitCollected.observation;
    try {
      deps.fs.writeDurable(gitAfterPath, `${JSON.stringify(gitAfter, null, 2)}\n`);
    } catch {
      // Git was still observed in memory. A write failure does not invent agreement.
    }

    // 8. One parse. The file the executor was told to write, else the stdout tail.
    // artifactRoot is the run root so a path the real parser rejects cannot become SUCCESS.
    const handoffRaw = readHandoffText(deps.fs, handoffPath, log.liveTail("stdout").toString("utf8"));
    const parsed: HandoffParseV1 = handoffRaw === null
      ? { ok: false, handoff: null, problems: ["no handoff text"] }
      : parseHandoff(handoffRaw, { artifactRoot: runRoot });
    const handoff = parsed.ok ? parsed.handoff : null;
    const reportedWorkItemId = workItemIdFrom(handoffRaw === null ? null : extractJsonObject(handoffRaw));

    const gitVerdict = verifyGitTruth(gitAfter, {
      ...(handoff !== null ? { claimedHead: handoff.headAfter } : {}),
      ...(request.branch !== null ? { expectedBranch: request.branch } : {}),
      requireClean: true,
      requireAttachedBranch: request.branch !== null,
    });

    // 9. The conjunction. Each finding is kept so a failure names the conjunct.
    const conjunction = evaluateSuccessConjunction({
      exitCode,
      stillRunning,
      executor: request.executor,
      output,
      parsed,
      reportedWorkItemId,
      expectedMissionId: request.missionId,
      expectedRunId: request.runId,
      expectedWorkItemId: request.workItemId,
      runRoot,
      gitAfter,
      gitVerdict,
      authorisedProductionMutated: request.authorisedProductionMutated,
      ...(request.knownSuccessExitCodes !== undefined
        ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
        : {}),
    });

    // Writer-release evidence is a process observation: confirmed exit plus an
    // orphan scan that found nothing alive. A released lease is not enough.
    const livenessQuestion = resolveWriterLiveness(deps, processIdentity);
    if (processIdentity !== null && livenessQuestion.observation !== null) {
      detectOrphan({
        recorded: processIdentity,
        observed: livenessQuestion.observation,
        parentLiveness: livenessQuestion.liveness ?? (stillRunning ? "ALIVE" : "DEAD_CONFIRMED"),
      });
    }
    orphanScan = collectWriterOrphans({
      scanOrphans: deps.scanOrphans,
      recorded: processIdentity,
      runNonce: request.runNonce,
      parentStillRunning: stillRunning,
      parentLiveness: livenessQuestion.liveness,
    });

    releaseHeld();
    const writerFact = writerReleaseEvidence({
      recordedLeaseKind: heldLease.kind,
      recordedLeaseId: heldLease.leaseId,
      releasedLeaseId,
      recordedIdentity: processIdentity,
      liveness: livenessQuestion.liveness,
      livenessAskedAbout: livenessQuestion.askedAbout,
      stillRunning,
      orphanScan,
    });

    const reason = conjunction.ok
      ? "every success conjunct holds"
      : `success conjunction failed: ${conjunction.failedConjuncts.join(", ")}`;

    return finish({
      ok: conjunction.ok,
      spawned: true,
      reason,
      conjunction,
      exitCode,
      processIdentity,
      intent: permit.intent,
      handoff,
      gitAfter,
      lease: heldLease,
      productionWriterLeaseReleasedByThisRun: writerFact,
      cancel: { timedOut, stages: cancelStages },
      log: logReport,
    });
  } finally {
    releaseHeld();
  }
}

function resolveWriterLiveness(
  deps: RunManagerDepsV1,
  recorded: ExecutorProcessIdentityV1 | null,
): {
  liveness: ProcessLivenessV1 | null;
  askedAbout: ExecutorProcessIdentityV1 | null;
  observation: ProcessObservationV1 | null;
} {
  if (recorded === null) return { liveness: null, askedAbout: null, observation: null };
  const asked = deps.askWriterLiveness !== undefined
    ? deps.askWriterLiveness(recorded)
    : { subject: recorded, observation: deps.probe.observe(recorded.pid) };
  return {
    liveness: holderLiveness(asked.subject, asked.observation),
    askedAbout: identityFromObservation(asked.observation),
    observation: asked.observation,
  };
}

function collectWriterOrphans(input: {
  readonly scanOrphans: RunManagerDepsV1["scanOrphans"];
  readonly recorded: ExecutorProcessIdentityV1 | null;
  readonly runNonce: string;
  readonly parentStillRunning: boolean;
  readonly parentLiveness: ProcessLivenessV1 | null;
}): WriterOrphanScanV1 {
  if (input.scanOrphans === undefined) {
    return { performed: false, liveSightings: [] };
  }
  const createdNotBefore = input.recorded?.creationDate ?? "";
  const sightings = input.scanOrphans({ runNonce: input.runNonce, createdNotBefore });
  const parentLiveness: ProcessLivenessV1 = input.parentStillRunning
    ? "ALIVE"
    : (input.parentLiveness ?? "DEAD_CONFIRMED");
  const liveSightings: OrphanSightingV1[] = [];
  for (const sighting of sightings) {
    const observed = observationFromSighting(sighting);
    if (input.recorded !== null) {
      detectOrphan({
        recorded: input.recorded,
        observed,
        parentLiveness,
      });
    }
    const nonceOk = sighting.runNonce === undefined || sighting.runNonce === input.runNonce;
    if (nonceOk && observed.outcome === "FOUND") {
      liveSightings.push(sighting);
    }
  }
  return { performed: true, liveSightings };
}

function observationFromSighting(sighting: OrphanSightingV1): ProcessObservationV1 {
  return {
    outcome: "FOUND",
    reason: "orphan-scan",
    pid: sighting.pid,
    ...(sighting.creationDate !== undefined ? { creationDate: sighting.creationDate } : {}),
    ...(sighting.runNonce !== undefined ? { runNonce: sighting.runNonce } : {}),
  };
}

async function raceExit(
  child: SpawnHandleV1,
  timeoutMs: number,
  wait: (ms: number) => Promise<void>,
): Promise<{ tag: "exit"; exit: SpawnExitV1 } | { tag: "timeout" }> {
  if (child.exited) return { tag: "exit", exit: await child.exit };
  let settled = false;
  return new Promise((resolve) => {
    void child.exit.then((exit) => {
      if (settled) return;
      settled = true;
      resolve({ tag: "exit", exit });
    });
    void wait(timeoutMs).then(() => {
      if (settled) return;
      if (child.exited) return;
      settled = true;
      resolve({ tag: "timeout" });
    });
  });
}

async function cancelLadder(
  child: SpawnHandleV1,
  deps: RunManagerDepsV1,
  recorded: ExecutorProcessIdentityV1 | null,
  runNonce: string,
): Promise<{ stages: CancelStageV1[]; stillRunning: boolean; exitCode: number | null }> {
  const stages: CancelStageV1[] = [];

  // SOFT: terminate the tracked root only. child.kill() is TerminateProcess on this PID.
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  stages.push("SOFT");
  await deps.wait(CANCEL_SOFT_MS);
  if (child.exited) {
    const ended = await child.exit;
    return { stages, stillRunning: false, exitCode: ended.code };
  }

  // HARD: kill the tree. child.kill() does not reach grandchildren on Windows.
  deps.killTree(child.pid);
  stages.push("HARD");
  await deps.wait(CANCEL_HARD_MS);
  const stillAfterHard = !child.exited;

  // ORPHAN: after cancel, scan by AION_RUN_NONCE and recorded creation time; kill leftovers.
  const createdNotBefore = recorded?.creationDate ?? "";
  const leftovers = deps.scanOrphans !== undefined
    ? deps.scanOrphans({ runNonce, createdNotBefore })
    : [];
  let killedOrphan = false;
  for (const leftover of leftovers) {
    if (leftover.pid === child.pid) continue;
    if (leftover.runNonce !== undefined && leftover.runNonce !== runNonce) continue;
    if (
      createdNotBefore !== ""
      && leftover.creationDate !== undefined
      && leftover.creationDate < createdNotBefore
    ) {
      continue;
    }
    if (recorded !== null) {
      detectOrphan({
        recorded,
        observed: observationFromSighting(leftover),
        parentLiveness: child.exited ? "DEAD_CONFIRMED" : "ALIVE",
      });
    }
    deps.killTree(leftover.pid);
    killedOrphan = true;
  }
  if (killedOrphan) stages.push("ORPHAN");

  if (child.exited) {
    const ended = await child.exit;
    return { stages, stillRunning: false, exitCode: ended.code };
  }
  return { stages, stillRunning: stillAfterHard, exitCode: null };
}

function pumpStream(stream: Readable | null, write: (chunk: Uint8Array) => void): Promise<void> {
  if (stream === null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: unknown) => {
      write(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)));
    });
    stream.on("end", () => resolve());
    stream.on("error", (error: unknown) => reject(error));
    stream.resume();
  });
}

async function settleStreams(
  stdoutDone: Promise<void>,
  stderrDone: Promise<void>,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  let done = false;
  void Promise.all([stdoutDone, stderrDone]).then(() => {
    done = true;
  }, () => {
    done = true;
  });
  if (done) return;
  await Promise.race([
    Promise.all([stdoutDone, stderrDone]).catch(() => undefined),
    wait(50),
  ]);
}

function readHandoffText(fs: RunFileSystemV1, handoffPath: string, stdout: string): string | null {
  if (fs.isFile(handoffPath)) {
    try {
      const text = fs.readUtf8(handoffPath);
      if (text.trim() !== "") return text;
    } catch {
      // Fall through to stdout.
    }
  }
  if (stdout.trim() === "") return null;
  return stdout;
}

function intentStoreFromFs(fs: RunFileSystemV1): IntentStoreV1 {
  return {
    writeDurable(absolutePath, utf8) {
      fs.mkdirp(dirname(absolutePath));
      fs.writeDurable(absolutePath, utf8);
    },
    readUtf8(absolutePath) {
      return fs.readUtf8(absolutePath);
    },
  };
}

function extractJsonObject(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function workItemIdFrom(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const raw = value.workItemId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || CONTROL_BYTES.test(trimmed)) return null;
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createNodeRunFileSystem(): RunFileSystemV1 {
  return {
    isDirectory(absolutePath) {
      try {
        return statSync(absolutePath).isDirectory();
      } catch {
        return false;
      }
    },
    isFile(absolutePath) {
      try {
        return statSync(absolutePath).isFile();
      } catch {
        return false;
      }
    },
    readUtf8(absolutePath) {
      return readFileSync(absolutePath, "utf8");
    },
    writeDurable(absolutePath, utf8) {
      writeAtomic(absolutePath, utf8);
    },
    mkdirp(absolutePath) {
      mkdirSync(absolutePath, { recursive: true });
    },
  };
}

function writeAtomic(target: string, contents: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, target);
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EEXIST" || code === "EPERM") {
      unlinkSync(target);
      renameSync(tmp, target);
      return;
    }
    try {
      unlinkSync(tmp);
    } catch {
      // Leave the temp file. Deleting evidence of a failed persist is worse than leaving it.
    }
    throw error;
  }
}

export function createNodeSpawner(): SpawnFnV1 {
  return (executable, argv, options) => {
    if (options.shell !== false) {
      throw new Error("shell:true is forbidden");
    }
    const child = spawn(executable, argv.slice(), {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return wrapChildProcess(child);
  };
}

export function wrapChildProcess(child: ChildProcess): SpawnHandleV1 {
  let exited = child.exitCode !== null || child.signalCode !== null;
  const exit = new Promise<SpawnExitV1>((resolve) => {
    if (exited) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
    child.once("error", () => {
      exited = true;
      resolve({ code: null, signal: null });
    });
  });
  return {
    get pid() {
      return child.pid ?? 0;
    },
    stdout: child.stdout,
    stderr: child.stderr,
    kill() {
      child.kill();
    },
    exit,
    get exited() {
      return exited;
    },
  };
}

export function createNodeWait(): (ms: number) => Promise<void> {
  return (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Stand-in for assigning the executor tree to a kill-on-close Job Object and later
 * calling TerminateJobObject.
 *
 * Node cannot create a Windows Job Object without a native addon: CreateJobObject and
 * AssignProcessToJobObject are not exposed by libuv or child_process. This module is
 * forbidden from adding a native dependency. `child.kill()` is TerminateProcess on the
 * root PID only and does not reach grandchildren. `taskkill /PID <pid> /T /F` is the
 * stand-in. It is not a Job Object. Do not treat a green suite as proof that the D2
 * CHILD_TREE requirement is met in production.
 */
export function killProcessTreeStandIn(pid: number): void {
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    shell: false,
    timeout: 10_000,
  });
}
