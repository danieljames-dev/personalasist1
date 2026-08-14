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
 * prove the writer exit (before any release)
 * release the lease only when that proof exists
 * write the durable result
 * ```
 *
 * Spawn, clock, filesystem, Git runner, process probe, capacity, leases, wait, and tree-kill
 * are injected. The module is testable without launching a process. One wiring test launches
 * a real one.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
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
import { argvIsSafe, type ExecutorNameV1, type ExecutorRoleV1 } from "./executors.js";
import {
  collectGitTruth,
  verifyGitTruth,
  type GitObservationV1,
  type GitRunner,
  type GitVerdictV1,
} from "./git-truth.js";
import {
  artifactPathWithinRoot,
  findHandoffContradictions,
  parseHandoff,
  type ExecutorHandoffV1,
  type HandoffParseV1,
} from "./handoff.js";
import { isResolvedHostPath } from "./host-path.js";
import {
  createNodeLeaseStore,
  sandboxDirectorStoreRoot,
} from "./lease-store.js";
import {
  acquireLease,
  heartbeat,
  LEASE_TTL_MS,
  releaseLease,
  type LeaseKindV1,
  type LeaseV1,
} from "./leases.js";
import {
  captureProcessIdentity,
  createWindowsOrphanScanner,
  descendantPidsOf,
  detectOrphan,
  holderLiveness,
  normaliseRunNonce,
  type ExecutorProcessIdentityV1,
  type HostProcessProbe,
  type OrphanVerdictV1,
  type ProcessObservationV1,
} from "./process-identity.js";
import {
  assertSpawnPermitBinding,
  isSpawnPermitSpent,
  recordSpawnAttempt,
  recordSpawnObservation,
  spendSpawnPermit,
  withPersistedIntent,
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
  | "productionClaimAgrees"
  | "executorTreeIsGone";

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
  permit: SpawnPermitV1,
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
  readonly parentPid?: number;
}

/**
 * Optional test hook. Production never reads `subject`. A death certificate
 * about a caller-supplied identity is how a different process used to set
 * `productionWriterLeaseReleasedByThisRun`. Liveness is always
 * `holderLiveness(recorded, observe(recorded.pid))`.
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
  /** When omitted, {@link createNodeLeaseStore} under {@link sandboxDirectorStoreRoot}. */
  readonly leases?: LeaseStoreV1;
  readonly wait: (ms: number) => Promise<void>;
  readonly killTree: (pid: number) => void;
  /**
   * Optional test hook. When omitted, production uses
   * {@link createWindowsOrphanScanner}. A missing implementation used to
   * withhold every production-writer lease forever.
   */
  readonly scanOrphans?: (query: {
    runNonce: string;
    createdNotBefore: string;
    holderPid?: number;
  }) => readonly OrphanSightingV1[];
  readonly logSinks?: { readonly stdout: LogSinkV1; readonly stderr: LogSinkV1 };
  /**
   * Re-check each parsed artifact after resolving junctions. Default is
   * `realpathSync.native`, fail-closed on throw.
   */
  readonly resolveArtifactPath?: (absolutePath: string) => string;
  /**
   * Ignored by the writer-exit proof. Kept so a test can still inject a
   * death certificate for another identity and observe that the field stays
   * false.
   */
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
  /**
   * Defaults to `IMPLEMENT` (measured implementer argv). `ADVERSARIAL_REVIEW`
   * is the only role that must not receive write permission.
   */
  readonly role?: ExecutorRoleV1;
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
  /** Every sighting the scan returned. The proof reads `detectOrphan` on these. */
  readonly sightings: readonly OrphanSightingV1[];
  /**
   * Sightings not proven absent from this run: normalised nonce is null or
   * equals this run's nonce. Independent of `parentLiveness` and not routed
   * through `detectOrphan` — a live grandchild is this run's tree, not an
   * orphan question.
   */
  readonly liveSightings: readonly OrphanSightingV1[];
}

const WRITER_EXIT_PROOF = Symbol("aion.director.writer-exit-proof.v1");

/** Values this module minted. A property read asks "does this look like a proof"; membership asks "did I mint this". */
const MINTED_EXIT_PROOFS = new WeakSet<object>();

/**
 * The only value that makes `productionWriterLeaseReleasedByThisRun` true.
 *
 * Produced solely by {@link proveWriterExit}. There is no public constructor:
 * {@link isWriterExitProof} is set membership, not a property read.
 */
export interface WriterExitProofV1 {
  readonly [WRITER_EXIT_PROOF]: true;
}

/**
 * Exit fact taken from the spawn handle this run owns, used only when identity
 * capture lost the race against a child that had already exited.
 *
 * `handleExited` and `exitSettledWithCode` are facts about this handle after
 * it has settled — never a `child.exited` read taken while a synchronous
 * probe still owns the event loop. `identityAbsentBecauseAlreadyExited` is
 * the capture-time observation: `NOT_FOUND` for the recorded pid, not
 * `UNAVAILABLE` and not `FOUND`.
 */
export interface OwnedHandleExitV1 {
  readonly spawnOccurred: boolean;
  readonly handleExited: boolean;
  readonly exitSettledWithCode: boolean;
  /**
   * Capture-time observation of the recorded pid was `NOT_FOUND`. Combined
   * with `handleExited` at proof time this is "the child was already gone",
   * not "the probe could not answer".
   */
  readonly identityAbsentBecauseAlreadyExited: boolean;
}

export interface WriterExitProofInputV1 {
  /**
   * This module's verdict after the SOFT/HARD ladder (and mustHalt). The first
   * denying conjunct: a handle that has not exited is not a writer exit, even
   * when the probe reports `NOT_FOUND`.
   */
  readonly processStillRunning: boolean;
  readonly recordedLeaseKind: LeaseKindV1 | null;
  readonly recordedLeaseId: string | null;
  readonly releasedLeaseId: string | null;
  readonly recordedIdentity: ExecutorProcessIdentityV1 | null;
  /** Observation of `probedPid`. Liveness is computed from this, never taken as input. */
  readonly observation: ProcessObservationV1 | null;
  /** The pid that was actually probed. Must be the recorded holder. */
  readonly probedPid: number | null;
  readonly orphanScanPerformed: boolean;
  readonly orphanSightings: readonly OrphanSightingV1[] | null;
  /** Sightings not proven absent from this run's tree. Consumed here. */
  readonly liveSightings?: readonly OrphanSightingV1[] | null;
  readonly ownedHandleExit?: OwnedHandleExitV1 | null;
}

/**
 * `productionWriterLeaseReleasedByThisRun` is the presence of an exit proof.
 *
 * There are no conditions here. A bag of fields is not a proof.
 */
export function writerReleaseEvidence(proof: unknown): boolean {
  return isWriterExitProof(proof);
}

export function isWriterExitProof(value: unknown): value is WriterExitProofV1 {
  return typeof value === "object" && value !== null && MINTED_EXIT_PROOFS.has(value);
}

/**
 * The only constructor. Returns a proof only when every conjunct is true at
 * once; otherwise null. A throw in any step is null, not a proof.
 *
 * `processStillRunning !== false` denies first — a handle that has not
 * exited is not a writer exit, even when the probe reports `NOT_FOUND`.
 * Liveness is `holderLiveness(recorded, observation)` and must be exactly
 * `DEAD_CONFIRMED` — a closed allowlist. `UNKNOWN`, `ALIVE`, `null`, and any
 * later member deny. The observation must be about the recorded holder
 * (`probedPid === recorded.pid`). Each orphan sighting is passed to
 * `detectOrphan` and the returned `orphan` flag is read.
 */
export function proveWriterExit(input: WriterExitProofInputV1): WriterExitProofV1 | null {
  try {
    // Fail closed: only an explicit false proceeds. A missing field must not mint a proof.
    if (input.processStillRunning !== false) return null;
    // Kind is a label, not the physical fact. The proof is "the recorded holder
    // of THIS lease is gone". The reported writer-release field stays kind-scoped.
    // A missing kind is "no lease was recorded". Any of the five kinds may mint;
    // the reported writer-release field stays scoped to PRODUCTION_WRITER.
    if (input.recordedLeaseKind === null) return null;
    if (input.recordedLeaseId === null || input.releasedLeaseId === null) return null;
    if (input.releasedLeaseId !== input.recordedLeaseId) return null;
    if (!input.orphanScanPerformed) return null;
    if (input.orphanSightings === null) return null;
    const live = input.liveSightings ?? [];
    if (live.length > 0) return null;

    if (input.recordedIdentity === null) {
      // Two reasons identity can be absent. Only the first may mint:
      // 1. Capture saw NOT_FOUND for the recorded pid, and the handle this
      //    run owns has since settled as exited. The owned handle is
      //    stronger than a CIM sighting of a process that is gone.
      // 2. Any other reason (probe UNAVAILABLE, or NOT_FOUND while the
      //    handle has not settled) must keep denying.
      const owned = input.ownedHandleExit;
      if (owned === null || owned === undefined) return null;
      if (owned.spawnOccurred !== true) return null;
      if (owned.handleExited !== true) return null;
      if (owned.exitSettledWithCode !== true) return null;
      if (owned.identityAbsentBecauseAlreadyExited !== true) return null;
      return makeWriterExitProof();
    }

    if (input.observation === null) return null;
    if (input.probedPid === null) return null;
    if (input.probedPid !== input.recordedIdentity.pid) return null;

    if (!observationIsAboutRecorded(input.recordedIdentity, input.probedPid, input.observation)) {
      return null;
    }

    const liveness = holderLiveness(input.recordedIdentity, input.observation);
    if (liveness !== "DEAD_CONFIRMED") return null;

    for (const sighting of input.orphanSightings) {
      const inTree = writerSightingNotProvenAbsent(sighting, input.recordedIdentity.runNonce, {
        holderPid: input.recordedIdentity.pid,
        rows: input.orphanSightings,
      });
      if (!inTree) continue;
      const verdict: OrphanVerdictV1 = detectOrphan({
        recorded: input.recordedIdentity,
        observed: observationFromSighting(sighting),
        parentLiveness: liveness,
      });
      if (verdict.orphan) return null;
    }

    return makeWriterExitProof();
  } catch {
    return null;
  }
}

function makeWriterExitProof(): WriterExitProofV1 {
  const proof = Object.freeze({ [WRITER_EXIT_PROOF]: true as const });
  MINTED_EXIT_PROOFS.add(proof);
  return proof;
}

function observationIsAboutRecorded(
  recorded: ExecutorProcessIdentityV1,
  probedPid: number,
  observation: ProcessObservationV1,
): boolean {
  if (probedPid !== recorded.pid) return false;
  if (observation.outcome !== "FOUND") return true;
  if (observation.pid !== recorded.pid) return false;
  const observedNonce = normaliseRunNonce(observation.runNonce);
  if (observedNonce !== null && observedNonce !== recorded.runNonce) return false;
  return true;
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
  /** Physical containment after realpath, not "the handoff parsed". */
  readonly artifactsInsideRunRoot: boolean;
  readonly artifactsInsideRunRootReason: string;
  /** Holder gone AND scan performed AND no live sighting remains. */
  readonly executorTreeGone: boolean;
  readonly executorTreeReason: string;
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

  const artifactsOk = input.artifactsInsideRunRoot === true;
  const artifactsReason = input.artifactsInsideRunRootReason;

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
    {
      name: "executorTreeIsGone",
      ok: input.executorTreeGone === true,
      reason: input.executorTreeReason,
    },
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

  const runNonce = normaliseRunNonce(request.runNonce);
  if (runNonce === null) {
    return refusedBeforeSpawn(request, deps, "run nonce is empty or contains control bytes");
  }

  // Default is the implementer list. State it: absent role is IMPLEMENT.
  const role: ExecutorRoleV1 = request.role ?? "IMPLEMENT";
  const adapted = buildExecutorLaunch(request.executor, {
    promptPath: request.promptPath,
    cwd: request.cwd,
    runNonce,
    role,
  });
  if (!adapted.ok || adapted.launch === null) {
    return refusedBeforeSpawn(request, deps, `executor adapter: ${adapted.reason}`);
  }

  return executeRun({
    ...request,
    runNonce,
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
    artifactsInsideRunRoot: false,
    artifactsInsideRunRootReason: "no parsed handoff whose artifacts can be confined to the run root",
    executorTreeGone: true,
    executorTreeReason: "this launch never created a process",
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
  writeResultIfPermitted(deps.fs, request.runRoot, resultPath, result, false);
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
    artifactsInsideRunRoot: false,
    artifactsInsideRunRootReason: "no parsed handoff whose artifacts can be confined to the run root",
    executorTreeGone: true,
    executorTreeReason: "this run never created a process",
    ...(request.knownSuccessExitCodes !== undefined
      ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
      : {}),
  });

  const leaseStore = deps.leases ?? createNodeLeaseStore(sandboxDirectorStoreRoot());

  const finish = (partial: Omit<RunResultV1, "schema" | "resultPath">): RunResultV1 => {
    const result: RunResultV1 = { schema: RUN_RESULT_SCHEMA_V1, resultPath, ...partial };
    writeResultIfPermitted(deps.fs, runRoot, resultPath, result, partial.spawned === true);
    return result;
  };

  let heldLease: LeaseV1 | null = null;
  let releasedLeaseId: string | null = null;
  let capacityHeld = false;
  let stillRunning = false;
  let spawnOccurred = false;
  let orphanScan: WriterOrphanScanV1 = { performed: false, sightings: [], liveSightings: [] };
  let exitProof: WriterExitProofV1 | null = null;
  let captureTimeIdentityNotFound = false;

  const releaseHeld = (): void => {
    if (heldLease !== null && releasedLeaseId === null) {
      // One predicate: withhold only when this run created a process and
      // has not proven that process gone. Kind is not the fact.
      const withhold = spawnOccurred && exitProof === null;
      if (!withhold) {
        try {
          const before = leaseStore.list();
          const remaining = releaseLease(before, heldLease.leaseId);
          leaseStore.save(remaining);
          const observed = leaseStore.list();
          const gone = before.some((item) => item.leaseId === heldLease!.leaseId)
            && observed.every((item) => item.leaseId !== heldLease!.leaseId);
          if (gone) releasedLeaseId = heldLease.leaseId;
        } catch {
          // A failed release must not prevent capacity return.
        }
      }
    }
    if (capacityHeld) {
      try {
        deps.capacity.release(request.executor);
      } catch {
        // Capacity return is best-effort; do not escape executeRun.
      }
      capacityHeld = false;
    }
  };

  try {
    // 1. cwd, then nonce, then argv. Pure input checks — nothing acquired yet.
    let cwdOk = false;
    try {
      cwdOk = isResolvedHostPath(request.cwd) && deps.fs.isDirectory(request.cwd);
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `cwd check failed: ${errorMessage(error)}`,
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
    if (!cwdOk) {
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

    const runNonce = normaliseRunNonce(request.runNonce);
    if (runNonce === null) {
      return finish({
        ok: false,
        spawned: false,
        reason: "run nonce is empty or contains control bytes",
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: null,
        intent: null,
        handoff: null,
        gitAfter: null,
        lease: null,
        productionWriterLeaseReleasedByThisRun: writerReleaseEvidence(null),
        cancel: emptyCancel,
        log: null,
      });
    }

    const argvSafety = argvIsSafe(request.argv);
    if (!argvSafety.safe) {
      return finish({
        ok: false,
        spawned: false,
        reason: `argv is not safe: ${argvSafety.offending ?? "metacharacter"}`,
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

    // 2. Capacity AND the typed lease. Inside try so finally covers them.
    let leaseAttempt;
    try {
      leaseAttempt = acquireLease({
        existing: leaseStore.list(),
        leaseId: request.lease.leaseId,
        kind: request.lease.kind,
        resource: request.lease.resource,
        missionId: request.missionId,
        runId: request.runId,
        now: deps.clock.now(),
      });
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `lease check failed: ${errorMessage(error)}`,
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

    let capacityAttempt;
    try {
      capacityAttempt = deps.capacity.tryAcquire(request.executor);
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `capacity check failed: ${errorMessage(error)}`,
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

    if (capacityAttempt.ok) capacityHeld = true;

    if (!capacityAttempt.ok || !leaseAttempt.ok || leaseAttempt.lease === null) {
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

    heldLease = leaseAttempt.lease;
    if (heldLease === null) {
      return finish({
        ok: false,
        spawned: false,
        reason: "capacity and lease were not both acquired",
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
    try {
      leaseStore.save([
        ...leaseStore.list().filter((item) => item.leaseId !== heldLease!.leaseId),
        heldLease,
      ]);
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `lease persist failed: ${errorMessage(error)}`,
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: null,
        intent: null,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: emptyCancel,
        log: null,
      });
    }
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
      runNonce,
      now: deps.clock.now(),
      ...(request.promptPath !== undefined ? { promptPath: request.promptPath } : {}),
    };
    let permit: SpawnPermitV1 | null = null;
    let child: SpawnHandleV1;
    try {
      const launched = withPersistedIntent(
        persistInput,
        (minted) => {
          permit = spendSpawnPermit(minted, {
            executable: request.executablePath,
            argv: request.argv,
            cwd: request.cwd,
          });
          return deps.spawn(
            request.executablePath,
            request.argv,
            {
              cwd: request.cwd,
              env: {
                ...(request.childEnv ?? {}),
                AION_RUN_NONCE: runNonce,
              },
              shell: false,
              windowsHide: true,
            },
            permit,
          );
        },
        intentStore,
      );
      if (!launched.ok || launched.permit === null || launched.launched === null) {
        return finish({
          ok: false,
          spawned: false,
          reason: launched.reason,
          conjunction: emptyConjunction,
          exitCode: null,
          processIdentity: null,
          intent: null,
          handoff: null,
          gitAfter: null,
          lease: heldLease,
          productionWriterLeaseReleasedByThisRun: writerReleaseEvidence(null),
          cancel: emptyCancel,
          log: null,
        });
      }
      permit = launched.permit;
      child = launched.launched;
      spawnOccurred = true;
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `spawn failed: ${errorMessage(error)}`,
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: null,
        intent: permit !== null ? permit.intent : null,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: emptyCancel,
        log: null,
      });
    }
    if (permit === null) {
      return finish({
        ok: false,
        spawned: false,
        reason: "spawn is refused: no durable run intent permit",
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: null,
        intent: null,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: writerReleaseEvidence(null),
        cancel: emptyCancel,
        log: null,
      });
    }

    // 5. Record that spawn returned, then try to capture identity.
    // An unobservable process (access-denied, elevated executor) still started.
    // processIdentity === null must not mean "never spawned".
    let childPid: number;
    try {
      childPid = child.pid;
    } catch (error) {
      return finish({
        ok: false,
        spawned: true,
        reason: `spawn handle pid is unreadable: ${errorMessage(error)}`,
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: null,
        intent: permit.intent,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: emptyCancel,
        log: null,
      });
    }

    const attempted = recordSpawnAttempt({
      permit,
      pid: childPid,
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
        deps.killTree(childPid);
      } catch {
        // A failed kill is not a confirmed stop.
      }
      let observation: ProcessObservationV1;
      try {
        observation = deps.probe.observe(childPid);
      } catch (error) {
        observation = { outcome: "UNAVAILABLE", reason: `probe threw: ${errorMessage(error)}` };
      }
      const confirmedStopped = observation.outcome === "NOT_FOUND";
      stillRunning = !confirmedStopped;
      try {
        killNonceBearingLeftovers({
          scanOrphans: deps.scanOrphans,
          killTree: deps.killTree,
          childPid,
          recorded: null,
          runNonce,
          parentExited: confirmedStopped,
          holderPid: childPid,
        });
      } catch {
        // A failed leftover kill is not a confirmed absence.
      }
      orphanScan = collectWriterOrphans({
        scanOrphans: deps.scanOrphans,
        recorded: null,
        runNonce,
        holderPid: childPid,
      });
      const reason = confirmedStopped
        ? `spawn returned but the attempt could not be recorded; child was stopped: ${attempted.reason}`
        : `spawn returned but the attempt could not be recorded; stillRunning: true; pid ${child.pid}: ${attempted.reason}`;
      return finish({
        ok: false,
        spawned: true,
        reason,
        conjunction: emptyConjunction,
        exitCode: child.exited ? (await child.exit).code : null,
        processIdentity: null,
        intent: permit.intent,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: emptyCancel,
        log: null,
      });
    }
    permit = attempted.permit;
    heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, null);

    const captured = captureProcessIdentity(deps.probe, { pid: childPid, runNonce });
    // Capture asked about `childPid`. NOT_FOUND is therefore about that pid.
    // Do not read `child.exited` here: a synchronous probe owns the event
    // loop, so the handle cannot have settled even when the OS process is gone.
    captureTimeIdentityNotFound =
      !captured.ok
      && captured.observation !== null
      && captured.observation.outcome === "NOT_FOUND";
    const processIdentity = captured.ok ? captured.identity : null;
    if (processIdentity !== null) {
      const observed = recordSpawnObservation({
        permit,
        identity: processIdentity,
        now: deps.clock.now(),
        store: intentStore,
      });
      if (observed.ok && observed.permit !== null) permit = observed.permit;
      heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, processIdentity);
    } else if (
      captured.observation !== null
      && (
        captured.observation.outcome === "NOT_FOUND"
        || (captured.observation.outcome === "FOUND" && captured.observation.pid === childPid)
      )
    ) {
      heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, {
        pid: childPid,
        ...(captured.observation.outcome === "FOUND" && captured.observation.creationDate !== undefined
          ? { creationDate: captured.observation.creationDate }
          : {}),
        runNonce,
      });
    }

    if (!child.exited) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
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
      const raced = await raceExit(child, request.timeoutMs, deps.wait, () => {
        if (heldLease === null) return;
        const renewed = heartbeat(heldLease, deps.clock.now());
        heldLease = persistLeaseHolder(leaseStore, renewed, renewed.pid, null, renewed);
      });
      if (raced.tag === "exit") {
        exitCode = raced.exit.code;
      } else {
        timedOut = true;
        const cancelled = await cancelLadder(child, deps, processIdentity, runNonce);
        cancelStages.push(...cancelled.stages);
        stillRunning = cancelled.stillRunning;
        exitCode = cancelled.exitCode;
      }
    }

    if (log.report().mustHalt && !child.exited) {
      const cancelled = await cancelLadder(child, deps, processIdentity, runNonce);
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

    // Nonce sweep on every exit path, not only timeout / mustHalt.
    let leftoverSweep: LeftoverSweepV1 = { confirmed: false, remaining: [], killed: false };
    try {
      leftoverSweep = killNonceBearingLeftovers({
        scanOrphans: deps.scanOrphans,
        killTree: deps.killTree,
        childPid,
        recorded: processIdentity,
        runNonce,
        parentExited: child.exited,
        holderPid: processIdentity?.pid ?? childPid,
      });
    } catch {
      leftoverSweep = { confirmed: false, remaining: [], killed: false };
    }

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

    // Writer-release and the eighth conjunct share one observation and one scan.
    const observation = observeRecordedHolder(deps.probe, processIdentity);
    orphanScan = collectWriterOrphans({
      scanOrphans: deps.scanOrphans,
      recorded: processIdentity,
      runNonce,
      holderPid: processIdentity?.pid ?? childPid,
    });

    const tree = describeExecutorTree({
      recorded: processIdentity,
      observation,
      orphanScan,
      leftoverConfirmed: leftoverSweep.confirmed,
      leftoverRemaining: leftoverSweep.remaining,
    });
    const artifactCheck = artifactsConfinedToRunRoot({
      runRoot,
      handoff,
      parsed,
      resolve: deps.resolveArtifactPath ?? defaultResolveArtifactPath,
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
      artifactsInsideRunRoot: artifactCheck.ok,
      artifactsInsideRunRootReason: artifactCheck.reason,
      executorTreeGone: tree.ok,
      executorTreeReason: tree.reason,
      ...(request.knownSuccessExitCodes !== undefined
        ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
        : {}),
    });

    const ownedHandleExit: OwnedHandleExitV1 = {
      spawnOccurred,
      handleExited: child.exited,
      exitSettledWithCode: child.exited && exitCode !== null,
      identityAbsentBecauseAlreadyExited: captureTimeIdentityNotFound && child.exited,
    };

    exitProof = proveWriterExit({
      processStillRunning: stillRunning,
      recordedLeaseKind: heldLease.kind,
      recordedLeaseId: heldLease.leaseId,
      releasedLeaseId: heldLease.leaseId,
      recordedIdentity: processIdentity,
      observation,
      probedPid: processIdentity === null ? null : processIdentity.pid,
      orphanScanPerformed: orphanScan.performed,
      orphanSightings: orphanScan.performed ? orphanScan.sightings : null,
      liveSightings: orphanScan.liveSightings,
      ownedHandleExit,
    });
    releaseHeld();
    if (releasedLeaseId !== heldLease.leaseId) {
      exitProof = null;
    }
    const writerFact = writerReleaseEvidence(exitProof) && heldLease.kind === "PRODUCTION_WRITER";

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
  } catch (error) {
    return finish({
      ok: false,
      spawned: spawnOccurred,
      reason: `run failed: ${errorMessage(error)}`,
      conjunction: emptyConjunction,
      exitCode: null,
      processIdentity: null,
      intent: null,
      handoff: null,
      gitAfter: null,
      lease: heldLease,
      productionWriterLeaseReleasedByThisRun: false,
      cancel: emptyCancel,
      log: null,
    });
  } finally {
    releaseHeld();
  }
}

type PersistableHolderIdentityV1 = {
  readonly pid: number;
  readonly creationDate?: string;
  readonly runNonce?: string;
};

function persistLeaseHolder(
  store: LeaseStoreV1,
  lease: LeaseV1,
  pid: number | null,
  identity: PersistableHolderIdentityV1 | null,
  base: LeaseV1 = lease,
): LeaseV1 {
  const updated: LeaseV1 = {
    ...base,
    pid,
    ...(identity !== null
      ? {
          processIdentity: {
            pid: identity.pid,
            ...(identity.creationDate !== undefined && identity.creationDate !== ""
              ? { startedAt: identity.creationDate }
              : {}),
            ...(identity.runNonce !== undefined && identity.runNonce !== ""
              ? { runToken: identity.runNonce }
              : {}),
          },
        }
      : base.processIdentity !== undefined
        ? { processIdentity: base.processIdentity }
        : {}),
  };
  store.save([...store.list().filter((item) => item.leaseId !== updated.leaseId), updated]);
  return updated;
}

function describeExecutorTree(input: {
  readonly recorded: ExecutorProcessIdentityV1 | null;
  readonly observation: ProcessObservationV1 | null;
  readonly orphanScan: WriterOrphanScanV1;
  readonly leftoverConfirmed: boolean;
  readonly leftoverRemaining: readonly OrphanSightingV1[];
}): { ok: boolean; reason: string } {
  if (input.recorded !== null && input.observation !== null) {
    const liveness = holderLiveness(input.recorded, input.observation);
    if (liveness === "ALIVE") {
      return { ok: false, reason: "the recorded holder is still ALIVE" };
    }
  }
  if (!input.orphanScan.performed) {
    return { ok: false, reason: "the process-tree scan was not performed" };
  }
  if (input.orphanScan.liveSightings.length > 0) {
    return {
      ok: false,
      reason: `live process-tree sightings remain: ${input.orphanScan.liveSightings.map((item) => item.pid).join(", ")}`,
    };
  }
  if (!input.leftoverConfirmed) {
    return { ok: false, reason: "leftover kill could not be confirmed by a re-scan" };
  }
  if (input.leftoverRemaining.length > 0) {
    return {
      ok: false,
      reason: `leftover processes remain after kill: ${input.leftoverRemaining.map((item) => item.pid).join(", ")}`,
    };
  }
  return { ok: true, reason: "the executor process tree is gone" };
}

function artifactsConfinedToRunRoot(input: {
  readonly runRoot: string;
  readonly handoff: ExecutorHandoffV1 | null;
  readonly parsed: HandoffParseV1;
  readonly resolve: (absolutePath: string) => string;
}): { ok: boolean; reason: string } {
  if (input.handoff === null) {
    const artifactProblems = input.parsed.problems.filter((problem) => /artifact/i.test(problem));
    return {
      ok: false,
      reason: artifactProblems[0] ?? "no parsed handoff whose artifacts can be confined to the run root",
    };
  }
  try {
    const rootReal = input.resolve(input.runRoot);
    for (const artifact of input.handoff.artifacts) {
      const candidate = input.resolve(join(input.runRoot, artifact));
      if (!artifactPathWithinRoot(rootReal, candidate)) {
        return { ok: false, reason: `artifact ${artifact} resolves outside the run root` };
      }
    }
    return { ok: true, reason: "every artifact is inside the run root" };
  } catch {
    return { ok: false, reason: "an artifact path could not be resolved" };
  }
}

function defaultResolveArtifactPath(absolutePath: string): string {
  return realpathSync.native(absolutePath);
}

function writeResultIfPermitted(
  fs: RunFileSystemV1,
  runRoot: string,
  resultPath: string,
  result: RunResultV1,
  spawned: boolean,
): void {
  let existing = false;
  try {
    existing = fs.isFile(resultPath);
  } catch {
    existing = false;
  }
  if (existing && !spawned) return;
  try {
    fs.mkdirp(runRoot);
    fs.writeDurable(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  } catch {
    // A failed result write is reported on the in-memory object.
  }
}

function observeRecordedHolder(
  probe: HostProcessProbe,
  recorded: ExecutorProcessIdentityV1 | null,
): ProcessObservationV1 | null {
  if (recorded === null) return null;
  try {
    return probe.observe(recorded.pid);
  } catch {
    return { outcome: "UNAVAILABLE", reason: "probe threw" };
  }
}

function resolveOrphanScanner(
  scanOrphans: RunManagerDepsV1["scanOrphans"],
): NonNullable<RunManagerDepsV1["scanOrphans"]> {
  return scanOrphans ?? createWindowsOrphanScanner();
}

function collectWriterOrphans(input: {
  readonly scanOrphans: RunManagerDepsV1["scanOrphans"];
  readonly recorded: ExecutorProcessIdentityV1 | null;
  readonly runNonce: string;
  readonly holderPid?: number;
}): WriterOrphanScanV1 {
  try {
    const createdNotBefore = input.recorded?.creationDate ?? "";
    const holderPid = input.holderPid ?? input.recorded?.pid;
    const sightings = [...resolveOrphanScanner(input.scanOrphans)({
      runNonce: input.runNonce,
      createdNotBefore,
      ...(holderPid !== undefined ? { holderPid } : {}),
    })];
    const liveSightings = sightings.filter((sighting) => writerSightingNotProvenAbsent(
      sighting,
      input.runNonce,
      { holderPid: holderPid ?? null, rows: sightings },
    ));
    return { performed: true, sightings, liveSightings };
  } catch {
    // A throwing CIM/WMI scan is not a completed scan. Escaping executeRun
    // used to release the writer lease from `finally` with no result.json.
    return { performed: false, sightings: [], liveSightings: [] };
  }
}

/**
 * "Not proven absent" for this run. A sighting is this run's tree if its
 * nonce matches or it is in the recorded holder's ParentProcessId chain.
 * A foreign process with a different nonce and no ancestry is not ours.
 */
export function writerSightingNotProvenAbsent(
  sighting: OrphanSightingV1,
  runNonce: string,
  tree: { readonly holderPid: number | null; readonly rows: readonly OrphanSightingV1[] } = {
    holderPid: null,
    rows: [],
  },
): boolean {
  const nonce = normaliseRunNonce(sighting.runNonce);
  if (nonce === runNonce) return true;
  if (tree.holderPid === null) return false;
  return descendantPidsOf(tree.holderPid, tree.rows).has(sighting.pid);
}

interface LeftoverSweepV1 {
  readonly confirmed: boolean;
  readonly remaining: readonly OrphanSightingV1[];
  readonly killed: boolean;
}

function killNonceBearingLeftovers(input: {
  readonly scanOrphans: RunManagerDepsV1["scanOrphans"];
  readonly killTree: (pid: number) => void;
  readonly childPid: number;
  readonly recorded: ExecutorProcessIdentityV1 | null;
  readonly runNonce: string;
  readonly parentExited: boolean;
  readonly holderPid?: number;
}): LeftoverSweepV1 {
  const createdNotBefore = input.recorded?.creationDate ?? "";
  const holderPid = input.holderPid ?? input.recorded?.pid ?? null;
  const query = {
    runNonce: input.runNonce,
    createdNotBefore,
    ...(holderPid !== null ? { holderPid } : {}),
  };
  let leftovers: readonly OrphanSightingV1[];
  try {
    leftovers = resolveOrphanScanner(input.scanOrphans)(query);
  } catch {
    return { confirmed: false, remaining: [], killed: false };
  }
  const tree = { holderPid, rows: leftovers };
  let killed = false;
  for (const leftover of leftovers) {
    if (leftover.pid === input.childPid) continue;
    if (!writerSightingNotProvenAbsent(leftover, input.runNonce, tree)) continue;
    if (
      createdNotBefore !== ""
      && leftover.creationDate !== undefined
      && leftover.creationDate < createdNotBefore
    ) {
      continue;
    }
    if (input.recorded !== null) {
      const verdict = detectOrphan({
        recorded: input.recorded,
        observed: observationFromSighting(leftover),
        parentLiveness: input.parentExited ? "DEAD_CONFIRMED" : "ALIVE",
      });
      if (verdict.kind === "NONCE_MISMATCH") continue;
    }
    input.killTree(leftover.pid);
    killed = true;
  }
  let remaining: readonly OrphanSightingV1[];
  try {
    const after = resolveOrphanScanner(input.scanOrphans)(query);
    remaining = after.filter((sighting) => writerSightingNotProvenAbsent(
      sighting,
      input.runNonce,
      { holderPid, rows: after },
    ));
  } catch {
    return { confirmed: false, remaining: [], killed };
  }
  return { confirmed: true, remaining, killed };
}

function observationFromSighting(sighting: OrphanSightingV1): ProcessObservationV1 {
  const nonce = normaliseRunNonce(sighting.runNonce);
  return {
    outcome: "FOUND",
    reason: "orphan-scan",
    pid: sighting.pid,
    ...(sighting.creationDate !== undefined ? { creationDate: sighting.creationDate } : {}),
    ...(nonce !== null ? { runNonce: nonce } : {}),
    ...(sighting.parentPid !== undefined ? { parentPid: sighting.parentPid } : {}),
  };
}

async function raceExit(
  child: SpawnHandleV1,
  timeoutMs: number,
  wait: (ms: number) => Promise<void>,
  onHeartbeat?: () => void,
): Promise<{ tag: "exit"; exit: SpawnExitV1 } | { tag: "timeout" }> {
  if (child.exited) return { tag: "exit", exit: await child.exit };
  const chunk = Math.max(1, Math.min(60_000, Math.floor(LEASE_TTL_MS / 2)));
  let waited = 0;
  while (waited < timeoutMs) {
    if (child.exited) return { tag: "exit", exit: await child.exit };
    const slice = Math.min(chunk, timeoutMs - waited);
    try {
      await Promise.race([
        child.exit.then(() => "exit" as const).catch(() => "exit" as const),
        wait(slice).then(() => "tick" as const).catch(() => "tick" as const),
      ]);
    } catch {
      // A rejecting wait must not escape or become an unhandled rejection.
    }
    if (child.exited) return { tag: "exit", exit: await child.exit };
    waited += slice;
    try {
      onHeartbeat?.();
    } catch {
      // A failed heartbeat must not abort the run.
    }
  }
  if (child.exited) return { tag: "exit", exit: await child.exit };
  return { tag: "timeout" };
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
  const leftoverSweep = killNonceBearingLeftovers({
    scanOrphans: deps.scanOrphans,
    killTree: deps.killTree,
    childPid: child.pid,
    recorded,
    runNonce,
    parentExited: child.exited,
    holderPid: recorded?.pid ?? child.pid,
  });
  if (leftoverSweep.killed) stages.push("ORPHAN");

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
  let present = false;
  try {
    present = fs.isFile(handoffPath);
  } catch {
    present = false;
  }
  if (present) {
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

const NODE_SPAWNER_USED = new WeakSet<object>();

export function createNodeSpawner(): SpawnFnV1 {
  return (executable, argv, options, permit) => {
    if (options.shell !== false) {
      throw new Error("shell:true is forbidden");
    }
    const launch = { executable, argv, cwd: options.cwd };
    const bound = assertSpawnPermitBinding(permit, launch);
    if (NODE_SPAWNER_USED.has(bound)) {
      throw new Error("spawn is refused: permit has already been spent");
    }
    if (!isSpawnPermitSpent(bound)) {
      spendSpawnPermit(bound, launch);
    }
    NODE_SPAWNER_USED.add(bound);
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
