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
import { mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { writeAtomic } from "./atomic-write.js";
import {
  createBoundedLog,
  createMemoryLogSink,
  type BoundedLogReportV1,
  type ClockV1,
  type LogSinkV1,
} from "./bounded-log.js";
import { buildExecutorLaunch, classifyExecutorExit, executorArgvFor } from "./executor-adapters.js";
import {
  discoverClaudeExecutor,
  discoverGrokExecutor,
  type DiscoveryEnvironment,
  type ExecutorDiscoveryResultV1,
  type FileSystemProbe,
} from "./executor-discovery.js";
import { argvIsSafe, routeRole, type ExecutorNameV1, type ExecutorRoleV1 } from "./executors.js";
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
  conflicts,
  heartbeat,
  LEASE_TTL_MS,
  reclaimStaleLease,
  releaseLease,
  type LeaseKindV1,
  type LeaseV1,
  type ProcessIdentityV1,
} from "./leases.js";
import {
  captureProcessIdentity,
  createWindowsOrphanScanner,
  createdBeforeFloor,
  descendantPidsOf,
  detectOrphan,
  holderLiveness,
  isUsablePid,
  normaliseRunNonce,
  isBrokerHostName,
  processRowCouldBelongToThisRun,
  processRowMakesScanUndecidable,
  placeableInstantMs,
  type ExecutorProcessIdentityV1,
  type HostProcessProbe,
  type OrphanVerdictV1,
  type ProcessObservationV1,
} from "./process-identity.js";
import {
  assertSpawnPermitBinding,
  existingIntentOn,
  isSpawnPermitSpent,
  readRunIntent,
  recordSpawnAttempt,
  recordSpawnObservation,
  spendSpawnPermit,
  withPersistedIntent,
  type IntentStoreV1,
  type RunIntentV1,
  type SpawnPermitV1,
} from "./run-intent.js";
import { CONTROL_BYTES } from "./control-bytes.js";

export const RUN_RESULT_SCHEMA_V1 = "aion.director.run-result.v1" as const;

export const CANCEL_SOFT_MS = 5_000;
export const CANCEL_HARD_MS = 10_000;

const KNOWN_SUCCESS_EXIT_CODES: readonly number[] = [0];

export type SuccessConjunctNameV1 =
  | "processExitedWithKnownSuccessCode"
  | "handoffParsed"
  | "identitiesMatch"
  | "declaredArtifactsInsideRunRoot"
  | "gitAgreesWithHandoff"
  | "spendIsZero"
  | "productionClaimAgrees"
  | "executorTreeIsGone"
  | "runCompletedWithinBudget"
  | "logStayedWithinBudget"
  | "reviewLeftTreeUnchanged"
  | "writeMovedHead";

const WRITE_ROLES: ReadonlySet<ExecutorRoleV1> = new Set([
  "IMPLEMENT",
  "REPAIR",
  "INTEGRATE",
  "DEPLOY",
]);

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
  readonly name?: string;
  readonly creationDate?: string;
  readonly runNonce?: string;
  readonly parentPid?: number;
  readonly nonceReadable?: boolean;
  readonly parentPresent?: boolean;
  readonly parentName?: string;
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
    holderExitedAt?: string;
    observedPids?: readonly number[];
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
  /**
   * Required to verify that `executeRun` is launching the discovered adapter
   * argv. Omitted inputs fail the launch-path check closed.
   */
  readonly discoveryEnv?: DiscoveryEnvironment;
  readonly discoveryFs?: FileSystemProbe;
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
  readonly role?: ExecutorRoleV1;
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
  readonly runId: string;
  readonly ok: boolean;
  readonly spawned: boolean;
  readonly reason: string;
  readonly conjunction: SuccessConjunctionV1;
  readonly exitCode: number | null;
  readonly processIdentity: ExecutorProcessIdentityV1 | null;
  readonly intent: RunIntentV1 | null;
  readonly handoff: ExecutorHandoffV1 | null;
  readonly gitBefore: GitObservationV1 | null;
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
  readonly recordedIdentity: ExecutorProcessIdentityV1 | null;
  /** Observation of `probedPid`. Liveness is computed from this, never taken as input. */
  readonly observation: ProcessObservationV1 | null;
  /** The pid that was actually probed. Must be the recorded holder. */
  readonly probedPid: number | null;
  readonly orphanScanPerformed: boolean;
  readonly orphanSightings: readonly OrphanSightingV1[] | null;
  /**
   * Sightings not proven absent from this run's tree. Required: omitted and
   * `null` are "nobody looked", which is not "the scan found nothing live".
   */
  readonly liveSightings: readonly OrphanSightingV1[] | null;
  /**
   * Optional only because the identity-present branch does not consult it.
   * On the identity-absent branch, `undefined` already denies — it is not a
   * safe default.
   */
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
    if (input.recordedLeaseId === null) return null;
    if (!input.orphanScanPerformed) return null;
    if (input.orphanSightings === null) return null;
    if (input.liveSightings === null || input.liveSightings === undefined) return null;
    if (input.liveSightings.length > 0) return null;

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

/** The only caller is {@link proveWriterExit}. Do not mint a proof from any other path. */
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
  // holderLiveness binds FOUND observations to recorded.pid. Do not re-spell it.
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
  readonly gitBefore?: GitObservationV1 | null;
  readonly gitVerdict: GitVerdictV1 | null;
  readonly authorisedProductionMutated: boolean;
  /** Declared artifacts realpath'd inside the run root. Not every file written. */
  readonly declaredArtifactsInsideRunRoot: boolean;
  readonly declaredArtifactsInsideRunRootReason: string;
  /** Holder gone AND scan performed AND no live sighting remains. */
  readonly executorTreeGone: boolean;
  readonly executorTreeReason: string;
  /** The Director cancelled this run for exceeding its budget. */
  readonly timedOut: boolean;
  /** The bounded log did not demand a halt. */
  readonly logStayedWithinBudget: boolean;
  readonly role?: ExecutorRoleV1;
  readonly spawnedAtFloor?: string | null;
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
      authorisedProductionMutation: input.authorisedProductionMutated,
    });

  const statusContradiction = contradictions.find((item) => item.field === "status");
  const selfTiming = contradictions.find((item) => item.field === "finishedAt");
  const floorMs = input.spawnedAtFloor === undefined || input.spawnedAtFloor === null
    ? null
    : placeableInstantMs(input.spawnedAtFloor);
  const finishedMs = handoff === null ? null : placeableInstantMs(handoff.finishedAt);
  const handoffInThisRunWindow = handoff === null
    ? false
    : finishedMs !== null && floorMs !== null && finishedMs >= floorMs;
  const handoffParsedOk = handoff !== null
    && handoff.status === "PASS"
    && statusContradiction === undefined
    && selfTiming === undefined
    && handoffInThisRunWindow;

  let handoffParsedReason: string;
  if (handoff === null) {
    handoffParsedReason = `handoff did not parse: ${parsed.problems.join("; ")}`;
  } else if (handoff.status !== "PASS") {
    handoffParsedReason = `handoff status is ${handoff.status}, not PASS`;
  } else if (statusContradiction !== undefined) {
    handoffParsedReason = statusContradiction.detail;
  } else if (selfTiming !== undefined) {
    handoffParsedReason = selfTiming.detail;
  } else if (!handoffInThisRunWindow) {
    handoffParsedReason = finishedMs === null
      ? "handoff finishedAt is not a placeable instant; UNKNOWN does not bind the report to this run"
      : floorMs === null
        ? "this run's spawn floor is not a placeable instant; UNKNOWN does not bind the report to this run"
        : "handoff finishedAt precedes this run's spawn floor; the file is not this invocation's report";
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

  const artifactsOk = input.declaredArtifactsInsideRunRoot === true;
  const artifactsReason = input.declaredArtifactsInsideRunRootReason;

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
    productionReason = "compared the handoff production claim with the authorisation flag; production itself was not observed";
  }

  const beforeSha = observedHeadSha(input.gitBefore ?? null);
  const afterSha = observedHeadSha(input.gitAfter);
  const role = input.role;
  let reviewOk = true;
  let reviewReason = "role is not a review that must leave the tree unchanged";
  if (role === "ADVERSARIAL_REVIEW") {
    if (beforeSha === null || afterSha === null) {
      reviewOk = false;
      reviewReason = beforeSha === null
        ? "review git-before HEAD is UNAVAILABLE; UNKNOWN does not license a review verdict"
        : "review git-after HEAD is UNAVAILABLE; UNKNOWN does not license a review verdict";
    } else if (beforeSha !== afterSha) {
      reviewOk = false;
      reviewReason = "ADVERSARIAL_REVIEW moved HEAD; a reviewer that writes is not a review";
    } else {
      reviewReason = "ADVERSARIAL_REVIEW left HEAD unchanged";
    }
  }

  let writeMovedOk = true;
  let writeMovedReason = "role is not a write role that must advance HEAD";
  if (role !== undefined && WRITE_ROLES.has(role)) {
    if (beforeSha === null || afterSha === null) {
      writeMovedOk = false;
      writeMovedReason = beforeSha === null
        ? "write-role git-before HEAD is UNAVAILABLE; UNKNOWN is not a written tree"
        : "write-role git-after HEAD is UNAVAILABLE; UNKNOWN is not a written tree";
    } else if (beforeSha === afterSha) {
      writeMovedOk = false;
      writeMovedReason = "write role exited having left HEAD unchanged";
    } else {
      writeMovedReason = "write role advanced HEAD";
    }
  }

  const logBudgetOk = input.logStayedWithinBudget === true;
  const logBudgetReason = input.logStayedWithinBudget === true
    ? "the run log stayed within its byte budget"
    : "the run log exceeded its byte budget; the executor must be halted";

  const findings: ConjunctFindingV1[] = [
    { name: "processExitedWithKnownSuccessCode", ok: exitOk, reason: exitReason },
    {
      name: "handoffParsed",
      ok: handoffParsedOk,
      reason: handoffParsedReason,
    },
    { name: "identitiesMatch", ok: identitiesOk, reason: identitiesReason },
    { name: "declaredArtifactsInsideRunRoot", ok: artifactsOk, reason: artifactsReason },
    { name: "gitAgreesWithHandoff", ok: gitOk, reason: gitReason },
    { name: "spendIsZero", ok: spendOk, reason: spendReason },
    { name: "productionClaimAgrees", ok: productionOk, reason: productionReason },
    {
      name: "executorTreeIsGone",
      ok: input.executorTreeGone === true,
      reason: input.executorTreeReason,
    },
    {
      name: "runCompletedWithinBudget",
      ok: input.timedOut !== true,
      reason: input.timedOut === true
        ? "the Director cancelled the run for exceeding its budget"
        : "the run completed within its budget",
    },
    {
      name: "logStayedWithinBudget",
      ok: logBudgetOk,
      reason: logBudgetReason,
    },
    { name: "reviewLeftTreeUnchanged", ok: reviewOk, reason: reviewReason },
    { name: "writeMovedHead", ok: writeMovedOk, reason: writeMovedReason },
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
  if (routeRole(role) !== request.executor) {
    return refusedBeforeSpawn(
      request,
      deps,
      `role ${role} is routed to ${routeRole(role)}, not ${request.executor}`,
    );
  }
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
    role,
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

function argvEquals(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * One gate at the single spawn point: the request must be exactly what
 * discoverExecutor + the adapter would produce. A file-URL import of
 * executeRun with an arbitrary command is refused before anything is acquired.
 */
function launchPathMatchesDiscoveredAdapter(
  request: ExecuteRunRequestV1,
  deps: RunManagerDepsV1,
  runNonce: string,
): { ok: true } | { ok: false; reason: string } {
  const env = deps.discoveryEnv ?? {};
  const probe = deps.discoveryFs ?? { isFile: () => false, readDir: () => [] };
  const discovery = discoverExecutor(request.executor, env, probe);
  if (discovery.status !== "FOUND") {
    const why = discovery.status === "AMBIGUOUS"
      ? `executor discovery ambiguous: ${discovery.reason}`
      : discovery.reason;
    return { ok: false, reason: `launch path refused: ${why}` };
  }
  if (discovery.executablePath !== request.executablePath) {
    return {
      ok: false,
      reason: "launch path refused: executablePath is not the discovered executor",
    };
  }
  const promptPath = request.promptPath;
  if (promptPath === undefined || promptPath.trim() === "") {
    return {
      ok: false,
      reason: "launch path refused: promptPath is required to verify the adapter argv",
    };
  }
  const expected = executorArgvFor(request.executor, {
    promptPath,
    cwd: request.cwd,
    role: request.role ?? "IMPLEMENT",
  });
  if (expected === null) {
    return { ok: false, reason: "launch path refused: adapter has no argv for this executor" };
  }
  if (!argvEquals(expected, request.argv)) {
    return { ok: false, reason: "launch path refused: argv is not the adapter argv" };
  }
  if (runNonce.trim() === "") {
    return { ok: false, reason: "launch path refused: run nonce is empty" };
  }
  return { ok: true };
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
    declaredArtifactsInsideRunRoot: false,
    declaredArtifactsInsideRunRootReason: "no parsed handoff whose declared artifacts can be confined to the run root",
    executorTreeGone: true,
    executorTreeReason: "this launch never created a process",
    timedOut: false,
    logStayedWithinBudget: true,
    ...(request.knownSuccessExitCodes !== undefined
      ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
      : {}),
  });
  const resultPath = join(request.runRoot, "result.json");
  const result: RunResultV1 = {
    schema: RUN_RESULT_SCHEMA_V1,
    resultPath,
    runId: request.runId,
    ok: false,
    spawned: false,
    reason,
    conjunction,
    exitCode: null,
    processIdentity: null,
    intent: null,
    handoff: null,
    gitBefore: null,
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
  const gitBeforePath = join(runRoot, "git-before.json");
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
    declaredArtifactsInsideRunRoot: false,
    declaredArtifactsInsideRunRootReason: "no parsed handoff whose declared artifacts can be confined to the run root",
    executorTreeGone: true,
    executorTreeReason: "this run never created a process",
    timedOut: false,
    logStayedWithinBudget: true,
    ...(request.knownSuccessExitCodes !== undefined
      ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
      : {}),
  });

  const leaseStore = deps.leases ?? createNodeLeaseStore(sandboxDirectorStoreRoot());

  const finish = (
    partial: Omit<RunResultV1, "schema" | "resultPath" | "runId" | "gitBefore"> & {
      readonly gitBefore?: GitObservationV1 | null;
    },
  ): RunResultV1 => {
    const result: RunResultV1 = {
      ...partial,
      schema: RUN_RESULT_SCHEMA_V1,
      resultPath,
      runId: request.runId,
      gitBefore: partial.gitBefore ?? null,
    };
    writeResultIfPermitted(deps.fs, runRoot, resultPath, result, partial.spawned === true);
    return result;
  };

  let heldLease: LeaseV1 | null = null;
  let releasedLeaseId: string | null = null;
  let adoptedExistingHolder = false;
  let capacityHeld = false;
  let stillRunning = false;
  let spawnOccurred = false;
  let cancelStages: CancelStageV1[] = [];
  let timedOut = false;
  let processIdentity: ExecutorProcessIdentityV1 | null = null;
  let spawnedAtFloor: string | null = null;
  let holderExitedAt: string | null = null;
  let gitBefore: GitObservationV1 | null = null;
  let orphanScan: WriterOrphanScanV1 = { performed: false, sightings: [], liveSightings: [] };
  let exitProof: WriterExitProofV1 | null = null;
  let captureTimeIdentityNotFound = false;
  const seenInTreePids = new Set<number>();

  const interruptedAfterSpawn = (timedOutFlag: boolean): SuccessConjunctionV1 =>
    evaluateSuccessConjunction({
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
      declaredArtifactsInsideRunRoot: false,
      declaredArtifactsInsideRunRootReason: "no parsed handoff whose declared artifacts can be confined to the run root",
      executorTreeGone: false,
      executorTreeReason: "the run threw before the process tree could be observed",
      timedOut: timedOutFlag,
      logStayedWithinBudget: true,
      ...(request.knownSuccessExitCodes !== undefined
        ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
        : {}),
    });

  const releaseHeld = (): void => {
    if (heldLease !== null && releasedLeaseId === null) {
      const withhold = (spawnOccurred || adoptedExistingHolder) && exitProof === null;
      if (!withhold) {
        try {
          const before = leaseStore.list();
          const remaining = releaseLease(before, heldLease);
          leaseStore.save(remaining);
          const observed = leaseStore.list();
          const gone = before.some((item) => leaseIdentityEquals(item, heldLease!))
            && observed.every((item) => !leaseIdentityEquals(item, heldLease!));
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
    // 1. timeout, cwd, nonce, argv, then the launch-path predicate.
    // Pure input checks — nothing acquired yet.
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
      return finish({
        ok: false,
        spawned: false,
        reason: `timeoutMs is not a finite positive duration (${String(request.timeoutMs)})`,
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

    const launchPath = launchPathMatchesDiscoveredAdapter(request, deps, runNonce);
    if (!launchPath.ok) {
      return finish({
        ok: false,
        spawned: false,
        reason: launchPath.reason,
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

    // Refuse-before-acquire: a run that will not spawn must not enter the store.
    const completion = existingCompletionOn(deps.fs, resultPath, request.runId);
    if (completion === "spawned") {
      return finish({
        ok: false,
        spawned: false,
        reason: "a recorded completion already exists; refusing to overwrite it",
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
    if (completion === "unreadable") {
      return finish({
        ok: false,
        spawned: false,
        reason: "an existing result at this path is unreadable; refusing to overwrite it",
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

    const intentState = existingIntentOn(intentStoreFromFs(deps.fs), intentPath);
    const sameRunHeld = leaseStore.list().find((item) =>
      item.runId === request.runId
      && conflicts(item, { kind: request.lease.kind, resource: request.lease.resource }),
    );
    const wouldAdoptExistingHolder = sameRunHeld !== undefined
      && (sameRunHeld.pid !== null || sameRunHeld.processIdentity !== undefined);
    if (intentState !== "none" && !wouldAdoptExistingHolder) {
      const why = intentState === "spawned"
        ? "a recorded spawn already exists; refusing to overwrite it"
        : intentState === "unreadable"
          ? "an existing intent at this path is unreadable; refusing to overwrite it"
          : "an existing intent at this path is unresolvable; refusing to overwrite it";
      return finish({
        ok: false,
        spawned: false,
        reason: why,
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

    // A stale-holder refusal is an instruction to look. Wire the existing
    // reclaim rule; do not invent a second one. Retry acquire once.
    if (!leaseAttempt.ok && leaseAttempt.requiresStalenessCheck === true) {
      try {
        const reclaimed = reclaimExpiredHolder({
          store: leaseStore,
          kind: request.lease.kind,
          resource: request.lease.resource,
          heldBy: leaseAttempt.heldBy,
          probe: deps.probe,
          now: deps.clock.now(),
        });
        if (reclaimed.ok) {
          leaseAttempt = acquireLease({
            existing: leaseStore.list(),
            leaseId: request.lease.leaseId,
            kind: request.lease.kind,
            resource: request.lease.resource,
            missionId: request.missionId,
            runId: request.runId,
            now: deps.clock.now(),
          });
        }
      } catch {
        // A throwing reclaim is not a granted reclaim. The original refusal stands.
      }
    }

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
    adoptedExistingHolder = leaseAttempt.adoptedExistingHolder === true;
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
        ...leaseStore.list().filter((item) => !leaseIdentityEquals(item, heldLease!)),
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

    if (intentState !== "none") {
      const prior = readRunIntent(intentPath, intentStoreFromFs(deps.fs));
      const intentIdentity = prior.ok ? prior.intent.processIdentity : null;
      exitProof = proveAdoptedWriterExit({
        lease: heldLease,
        probe: deps.probe,
        scanOrphans: deps.scanOrphans,
        runNonce,
        intentIdentity,
        observedPids: seenInTreePids,
      });
      releaseHeld();
      const adoptedWriterFact = writerReleaseEvidence(exitProof)
        && releasedLeaseId === heldLease.leaseId
        && heldLease.kind === "PRODUCTION_WRITER";
      const why = intentState === "spawned"
        ? "a recorded spawn already exists; refusing to overwrite it"
        : intentState === "unreadable"
          ? "an existing intent at this path is unreadable; refusing to overwrite it"
          : "an existing intent at this path is unresolvable; refusing to overwrite it";
      return finish({
        ok: false,
        spawned: false,
        reason: why,
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity: intentIdentity,
        intent: prior.ok ? prior.intent : null,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: adoptedWriterFact,
        cancel: emptyCancel,
        log: null,
      });
    }

    const gitBeforePathLocal = gitBeforePath;
    try {
      const collectedBefore = collectGitTruth({
        runner: deps.git,
        worktreePath: request.worktree,
        now: deps.clock.now(),
      });
      gitBefore = collectedBefore.observation;
      deps.fs.writeDurable(gitBeforePathLocal, `${JSON.stringify(gitBefore, null, 2)}\n`);
    } catch {
      gitBefore = gitBefore ?? null;
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
      ...(request.role !== undefined ? { role: request.role } : {}),
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
          spawnedAtFloor = deps.clock.now();
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

    // 5. A process exists only when the handle names a usable OS pid.
    // spawn() returning is not that fact: libuv reports ENOENT/EACCES on the
    // handle after the call, and `pid` is then undefined → 0.
    let childPid: number;
    try {
      childPid = child.pid;
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `spawn handle pid is unreadable: ${errorMessage(error)}`,
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity,
        intent: permit.intent,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: { timedOut, stages: cancelStages },
        log: null,
      });
    }
    spawnOccurred = isUsablePid(childPid);
    if (!spawnOccurred) {
      return finish({
        ok: false,
        spawned: false,
        reason: "spawn returned no operating-system process",
        conjunction: emptyConjunction,
        exitCode: null,
        processIdentity,
        intent: permit.intent,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: emptyCancel,
        log: null,
      });
    }

    // Stamp the holder onto the lease before the durable spawn record so a
    // crash cannot leave intent.spawnPid set while the lease still says
    // pid:null. Must stay after the spawn; must not move any intent write
    // before the spawn.
    heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, null, runNonce);

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
      if (confirmedStopped) holderExitedAt = deps.clock.now();
      try {
        killNonceBearingLeftovers({
          scanOrphans: deps.scanOrphans,
          killTree: deps.killTree,
          childPid,
          recorded: null,
          runNonce,
          parentExited: confirmedStopped,
          holderPid: childPid,
          createdNotBefore: spawnedAtFloor ?? "",
          observedPids: seenInTreePids,
          ...(holderExitedAt !== null ? { holderExitedAt } : {}),
        });
      } catch {
        // A failed leftover kill is not a confirmed absence.
      }
      orphanScan = collectWriterOrphans({
        scanOrphans: deps.scanOrphans,
        recorded: null,
        runNonce,
        holderPid: childPid,
        createdNotBefore: spawnedAtFloor ?? "",
        observedPids: seenInTreePids,
        ...(holderExitedAt !== null ? { holderExitedAt } : {}),
      });
      const reason = confirmedStopped
        ? `spawn returned but the attempt could not be recorded; child was stopped: ${attempted.reason}`
        : `spawn returned but the attempt could not be recorded; stillRunning: true; pid ${child.pid}: ${attempted.reason}`;
      return finish({
        ok: false,
        spawned: true,
        reason,
        conjunction: interruptedAfterSpawn(timedOut),
        exitCode: child.exited ? (await child.exit).code : null,
        processIdentity,
        intent: permit.intent,
        handoff: null,
        gitAfter: null,
        lease: heldLease,
        productionWriterLeaseReleasedByThisRun: false,
        cancel: { timedOut, stages: cancelStages },
        log: null,
      });
    }
    permit = attempted.permit;

    const captured = captureProcessIdentity(deps.probe, {
      pid: childPid,
      runNonce,
      expectedExecutable: request.executablePath,
    });
    // Capture asked about `childPid`. NOT_FOUND is therefore about that pid.
    // Do not read `child.exited` here: a synchronous probe owns the event
    // loop, so the handle cannot have settled even when the OS process is gone.
    captureTimeIdentityNotFound =
      !captured.ok
      && captured.observation !== null
      && captured.observation.outcome === "NOT_FOUND";
    processIdentity = captured.ok ? captured.identity : null;
    if (processIdentity !== null) {
      const observed = recordSpawnObservation({
        permit,
        identity: processIdentity,
        now: deps.clock.now(),
        store: intentStore,
      });
      if (observed.ok && observed.permit !== null) permit = observed.permit;
      heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, processIdentity, runNonce);
    } else if (
      captured.observation !== null
      && (
        captured.observation.outcome === "NOT_FOUND"
        || captured.observation.outcome === "UNAVAILABLE"
        || (captured.observation.outcome === "FOUND" && captured.observation.pid === childPid)
      )
    ) {
      heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, {
        pid: childPid,
        ...(captured.observation.outcome === "FOUND" && captured.observation.creationDate !== undefined
          ? { creationDate: captured.observation.creationDate }
          : {}),
        runNonce,
      }, runNonce);
    } else {
      heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, { pid: childPid, runNonce }, runNonce);
    }

    if (!child.exited) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }

    const sinks = deps.logSinks ?? { stdout: createMemoryLogSink(), stderr: createMemoryLogSink() };
    const log = createBoundedLog({ clock: deps.clock, sinks });
    let haltRequested = false;
    let resolveHalt: (() => void) | null = null;
    const haltSignal = new Promise<void>((resolve) => {
      resolveHalt = resolve;
    });
    const writeAndWatch = (stream: "stdout" | "stderr") => (chunk: Uint8Array): void => {
      const written = log.write(stream, chunk);
      if (written.mustHalt && !haltRequested) {
        haltRequested = true;
        resolveHalt?.();
      }
    };
    const stdoutDone = pumpStream(child.stdout, writeAndWatch("stdout")).catch(() => undefined);
    const stderrDone = pumpStream(child.stderr, writeAndWatch("stderr")).catch(() => undefined);

    // 6. Timeout / cancel ladder. mustHalt resolves the race immediately.
    let exitCode: number | null = null;

    const exitWon = child.exited;
    if (exitWon) {
      const ended = await child.exit;
      exitCode = ended.code;
      holderExitedAt = deps.clock.now();
    } else {
      const raced = await Promise.race([
        raceExit(child, request.timeoutMs, deps.wait, () => {
          if (heldLease === null) return;
          const renewed = heartbeat(heldLease, deps.clock.now());
          heldLease = persistLeaseHolder(leaseStore, renewed, renewed.pid, null, runNonce, renewed);
        }),
        haltSignal.then(() => ({ tag: "halt" as const })),
      ]);
      if (raced.tag === "exit") {
        exitCode = raced.exit.code;
        holderExitedAt = deps.clock.now();
      } else {
        if (raced.tag === "timeout") timedOut = true;
        const cancelled = await cancelLadder(
          child,
          deps,
          processIdentity,
          runNonce,
          cancelStages,
          spawnedAtFloor ?? "",
          holderExitedAt,
          seenInTreePids,
        );
        stillRunning = cancelled.stillRunning;
        exitCode = cancelled.exitCode;
        if (child.exited && holderExitedAt === null) holderExitedAt = deps.clock.now();
      }
    }

    const streamsSettledEarly = await settleStreams(stdoutDone, stderrDone, deps.wait);
    if (!streamsSettledEarly) log.markDrainIncomplete();
    log.flush();
    if (log.report().mustHalt && cancelStages.length === 0) {
      const cancelled = await cancelLadder(
        child,
        deps,
        processIdentity,
        runNonce,
        cancelStages,
        spawnedAtFloor ?? "",
        holderExitedAt,
        seenInTreePids,
      );
      stillRunning = cancelled.stillRunning;
      if (cancelled.exitCode !== null) exitCode = cancelled.exitCode;
      if (child.exited && holderExitedAt === null) holderExitedAt = deps.clock.now();
    }

    const logReport = log.report();
    const output = `${log.liveTail("stdout").toString("utf8")}\n${log.liveTail("stderr").toString("utf8")}`;

    // Nonce sweep on every exit path, not only timeout / mustHalt.
    if (child.exited && holderExitedAt === null) holderExitedAt = deps.clock.now();
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
        createdNotBefore: spawnedAtFloor ?? "",
        observedPids: seenInTreePids,
        ...(holderExitedAt !== null ? { holderExitedAt } : {}),
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

    const beforeHead = observedHeadSha(gitBefore);
    const afterHead = observedHeadSha(gitAfter);
    const descendsFromExpected = beforeHead === null || afterHead === null
      ? null
      : gitHeadDescendsFrom(deps.git, beforeHead, afterHead);
    const gitVerdict = verifyGitTruth(gitAfter, {
      ...(handoff !== null ? { claimedHead: handoff.headAfter } : {}),
      ...(request.branch !== null ? { expectedBranch: request.branch } : {}),
      requireClean: true,
      requireAttachedBranch: request.branch !== null,
      ...(beforeHead !== null
        ? {
          mustDescendFrom: beforeHead,
          descendsFromExpected: descendsFromExpected === true,
        }
        : {}),
    });

    // Writer-release and the eighth conjunct share one observation and one scan.
    const observation = observeRecordedHolder(deps.probe, processIdentity);
    orphanScan = collectWriterOrphans({
      scanOrphans: deps.scanOrphans,
      recorded: processIdentity,
      runNonce,
      holderPid: processIdentity?.pid ?? childPid,
      createdNotBefore: spawnedAtFloor ?? "",
      observedPids: seenInTreePids,
      ...(holderExitedAt !== null ? { holderExitedAt } : {}),
    });

    const ownedHandleExit: OwnedHandleExitV1 = {
      spawnOccurred,
      handleExited: child.exited,
      exitSettledWithCode: child.exited && exitCode !== null,
      identityAbsentBecauseAlreadyExited: captureTimeIdentityNotFound && child.exited,
    };

    const tree = describeExecutorTree({
      recorded: processIdentity,
      observation,
      orphanScan,
      leftoverConfirmed: leftoverSweep.confirmed,
      leftoverRemaining: leftoverSweep.remaining,
      ownedHandleExit,
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
      gitBefore,
      gitVerdict,
      authorisedProductionMutated: request.authorisedProductionMutated,
      declaredArtifactsInsideRunRoot: artifactCheck.ok,
      declaredArtifactsInsideRunRootReason: artifactCheck.reason,
      executorTreeGone: tree.ok,
      executorTreeReason: tree.reason,
      timedOut,
      logStayedWithinBudget: logReport.mustHalt !== true,
      ...(request.role !== undefined ? { role: request.role } : {}),
      spawnedAtFloor,
      ...(request.knownSuccessExitCodes !== undefined
        ? { knownSuccessExitCodes: request.knownSuccessExitCodes }
        : {}),
    });

    exitProof = proveWriterExit({
      processStillRunning: stillRunning,
      recordedLeaseKind: heldLease.kind,
      recordedLeaseId: heldLease.leaseId,
      recordedIdentity: processIdentity,
      observation,
      probedPid: processIdentity === null ? null : processIdentity.pid,
      orphanScanPerformed: orphanScan.performed,
      orphanSightings: orphanScan.performed ? orphanScan.sightings : null,
      liveSightings: orphanScan.liveSightings,
      ownedHandleExit,
    });
    const proofBeforeRelease = exitProof;
    releaseHeld();
    if (releasedLeaseId !== heldLease.leaseId) {
      exitProof = null;
    }
    const writerFact = writerReleaseEvidence(proofBeforeRelease)
      && releasedLeaseId === heldLease.leaseId
      && heldLease.kind === "PRODUCTION_WRITER";

    const reason = conjunction.ok
      ? "every success conjunct holds"
      : `success conjunction failed: ${conjunction.failedConjuncts.join(", ")}`;

    return finish({
      ok: conjunction.ok,
      spawned: spawnOccurred,
      reason,
      conjunction,
      exitCode,
      processIdentity,
      intent: permit.intent,
      handoff,
      gitBefore,
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
      conjunction: spawnOccurred ? interruptedAfterSpawn(timedOut) : emptyConjunction,
      exitCode: null,
      processIdentity,
      intent: null,
      handoff: null,
      gitAfter: null,
      lease: heldLease,
      productionWriterLeaseReleasedByThisRun: false,
      cancel: { timedOut, stages: cancelStages },
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
  runNonce: string,
  base: LeaseV1 = lease,
): LeaseV1 {
  const token = identity !== null && identity.runNonce !== undefined && identity.runNonce !== ""
    ? identity.runNonce
    : base.processIdentity !== undefined
      && base.processIdentity.runToken !== undefined
      && base.processIdentity.runToken !== ""
      ? base.processIdentity.runToken
      : runNonce;
  const startedAt = identity !== null && identity.creationDate !== undefined && identity.creationDate !== ""
    ? identity.creationDate
    : base.processIdentity?.startedAt;
  const identityPid = identity !== null
    ? identity.pid
    : typeof pid === "number"
      ? pid
      : (base.processIdentity?.pid ?? null);
  const updated: LeaseV1 = {
    ...base,
    pid,
    processIdentity: {
      pid: identityPid,
      ...(startedAt !== undefined ? { startedAt } : {}),
      runToken: token,
    },
  };
  store.save([...store.list().filter((item) => !leaseIdentityEquals(item, updated)), updated]);
  return updated;
}

/**
 * The eighth success conjunct: whether this run's executor tree was observed
 * gone enough that the next run may take the writer lease.
 *
 * Proven when the scan is SCANNED: no process carrying this run's nonce
 * remains; no descendant of the recorded holder in the CIM ParentProcessId
 * chain remains; no parentless row created at or after the spawn floor whose
 * nonce is not this run's remains (that row makes the scan UNAVAILABLE, and
 * UNAVAILABLE withholds the writer lease). The recorded holder is
 * DEAD_CONFIRMED or the owned handle settled after a capture-time NOT_FOUND.
 *
 * A parentless nonce-less row from *before* the floor is host noise and is
 * not emitted. An unplaceable floor makes the scan UNAVAILABLE rather than
 * falling back to a narrower emit predicate.
 */
function describeExecutorTree(input: {
  readonly recorded: ExecutorProcessIdentityV1 | null;
  readonly observation: ProcessObservationV1 | null;
  readonly orphanScan: WriterOrphanScanV1;
  readonly leftoverConfirmed: boolean;
  readonly leftoverRemaining: readonly OrphanSightingV1[];
  readonly ownedHandleExit: OwnedHandleExitV1;
}): { ok: boolean; reason: string } {
  if (input.ownedHandleExit.spawnOccurred === true && input.ownedHandleExit.handleExited !== true) {
    return { ok: false, reason: "the owned spawn handle has not exited" };
  }
  if (input.recorded === null) {
    // Same conjunct proveWriterExit requires when identity is absent.
    const owned = input.ownedHandleExit;
    const settledAbsent =
      owned.identityAbsentBecauseAlreadyExited === true
      && owned.exitSettledWithCode === true
      && owned.handleExited === true;
    if (!settledAbsent) {
      return { ok: false, reason: "the executor process tree could not be observed" };
    }
  } else if (input.observation !== null) {
    const liveness = holderLiveness(input.recorded, input.observation);
    if (liveness !== "DEAD_CONFIRMED") {
      return {
        ok: false,
        reason: liveness === "ALIVE"
          ? "the recorded holder is still ALIVE"
          : "the recorded holder is not DEAD_CONFIRMED",
      };
    }
  } else {
    return { ok: false, reason: "the executor process tree could not be observed" };
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
  return { ok: true, reason: "no process of this run's tree was found" };
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
      reason: artifactProblems[0] ?? "no parsed handoff whose declared artifacts can be confined to the run root",
    };
  }
  try {
    const rootReal = input.resolve(input.runRoot);
    for (const artifact of input.handoff.artifacts) {
      const candidate = input.resolve(join(input.runRoot, artifact));
      if (!artifactPathWithinRoot(rootReal, candidate)) {
        return { ok: false, reason: `declared artifact ${artifact} resolves outside the run root` };
      }
    }
    return { ok: true, reason: "every declared artifact is inside the run root" };
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
  readonly createdNotBefore: string;
  readonly holderExitedAt?: string;
  readonly observedPids?: Set<number>;
}): WriterOrphanScanV1 {
  try {
    const createdNotBefore = input.createdNotBefore;
    const holderPid = input.holderPid ?? input.recorded?.pid;
    const holderExitedAt = input.holderExitedAt;
    const observedPids = input.observedPids ?? new Set<number>();
    if (isUsablePid(holderPid)) observedPids.add(holderPid);
    const sightings = [...resolveOrphanScanner(input.scanOrphans)({
      runNonce: input.runNonce,
      createdNotBefore,
      ...(holderPid !== undefined ? { holderPid } : {}),
      ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
      observedPids: [...observedPids],
    })];
    const plausibility = {
      runNonce: input.runNonce,
      createdNotBefore,
      ...(isUsablePid(holderPid) ? { holderPid } : {}),
      ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
      observedPids,
      rows: sightings,
    };
    for (const sighting of sightings) {
      if (processRowMakesScanUndecidable(sighting, plausibility)) {
        return { performed: false, sightings: [], liveSightings: [] };
      }
    }
    rememberInTreePids(observedPids, sightings, input.runNonce, holderPid);
    const liveSightings = sightings.filter((sighting) =>
      processRowCouldBelongToThisRun(sighting, plausibility)
      && writerSightingNotProvenAbsent(
        sighting,
        input.runNonce,
        { holderPid: holderPid ?? null, rows: sightings },
      ),
    );
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
  if (isBrokerHostName(sighting.name)) return false;
  // Ancestry is a fact this Director walked. A nonce the child wrote cannot
  // discharge a descendant of the recorded holder.
  if (tree.holderPid !== null && descendantPidsOf(tree.holderPid, tree.rows).has(sighting.pid)) {
    return true;
  }
  if (sighting.nonceReadable === false) return true;
  const nonce = normaliseRunNonce(sighting.runNonce);
  if (nonce === null) return true;
  return nonce === runNonce;
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
  readonly createdNotBefore: string;
  readonly holderExitedAt?: string;
  readonly observedPids?: Set<number>;
}): LeftoverSweepV1 {
  const createdNotBefore = input.createdNotBefore;
  const holderPid = input.holderPid ?? input.recorded?.pid ?? null;
  const observedPids = input.observedPids ?? new Set<number>();
  if (isUsablePid(holderPid)) observedPids.add(holderPid);
  const query = {
    runNonce: input.runNonce,
    createdNotBefore,
    ...(holderPid !== null ? { holderPid } : {}),
    ...(input.holderExitedAt !== undefined ? { holderExitedAt: input.holderExitedAt } : {}),
    observedPids: [...observedPids],
  };
  let leftovers: readonly OrphanSightingV1[];
  try {
    leftovers = resolveOrphanScanner(input.scanOrphans)(query);
  } catch {
    return { confirmed: false, remaining: [], killed: false };
  }
  rememberInTreePids(observedPids, leftovers, input.runNonce, holderPid ?? undefined);
  const tree = { holderPid, rows: leftovers };
  let killed = false;
  for (const leftover of leftovers) {
    if (leftover.pid === input.childPid) continue;
    if (!writerSightingNotProvenAbsent(leftover, input.runNonce, tree)) continue;
    if (createdBeforeFloor(leftover.creationDate, createdNotBefore)) continue;
    // A leftover is killed only when its normalised nonce equals this run's
    // nonce and it was created at or after the spawn floor. Ancestry alone
    // never authorises a kill: a PID slot is not a process.
    if (normaliseRunNonce(leftover.runNonce) !== input.runNonce) continue;
    input.killTree(leftover.pid);
    killed = true;
  }
  let remaining: readonly OrphanSightingV1[];
  try {
    const after = resolveOrphanScanner(input.scanOrphans)({
      ...query,
      observedPids: [...observedPids],
    });
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
  stages: CancelStageV1[],
  createdNotBefore: string,
  holderExitedAt?: string | null,
  observedPids?: Set<number>,
): Promise<{ stillRunning: boolean; exitCode: number | null }> {
  // SOFT: terminate the tracked root only. child.kill() is TerminateProcess on this PID.
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  if (!stages.includes("SOFT")) stages.push("SOFT");
  await deps.wait(CANCEL_SOFT_MS);
  if (child.exited) {
    const ended = await child.exit;
    return { stillRunning: false, exitCode: ended.code };
  }

  // HARD: record the attempt before the call that may throw.
  if (!stages.includes("HARD")) stages.push("HARD");
  try {
    deps.killTree(child.pid);
  } catch {
    // A failed kill is not a confirmed stop.
  }
  await deps.wait(CANCEL_HARD_MS);
  const stillAfterHard = !child.exited;

  // ORPHAN: after cancel, scan by AION_RUN_NONCE and spawn floor; kill leftovers.
  const leftoverCeiling = child.exited
    ? (holderExitedAt ?? deps.clock.now())
    : holderExitedAt ?? undefined;
  let leftoverSweep: LeftoverSweepV1 = { confirmed: false, remaining: [], killed: false };
  try {
    leftoverSweep = killNonceBearingLeftovers({
      scanOrphans: deps.scanOrphans,
      killTree: deps.killTree,
      childPid: child.pid,
      recorded,
      runNonce,
      parentExited: child.exited,
      holderPid: recorded?.pid ?? child.pid,
      createdNotBefore,
      ...(observedPids !== undefined ? { observedPids } : {}),
      ...(leftoverCeiling ? { holderExitedAt: leftoverCeiling } : {}),
    });
    if (leftoverSweep.killed && !stages.includes("ORPHAN")) stages.push("ORPHAN");
  } catch {
    leftoverSweep = { confirmed: false, remaining: [], killed: false };
  }

  if (child.exited) {
    const ended = await child.exit;
    return { stillRunning: false, exitCode: ended.code };
  }
  return { stillRunning: stillAfterHard, exitCode: null };
}

function pumpStream(stream: Readable | null, write: (chunk: Uint8Array) => void): Promise<void> {
  if (stream === null) return Promise.resolve();
  return new Promise((resolve) => {
    stream.on("data", (chunk: unknown) => {
      write(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)));
    });
    stream.on("end", () => resolve());
    stream.on("error", () => resolve());
    stream.resume();
  });
}

async function settleStreams(
  stdoutDone: Promise<void>,
  stderrDone: Promise<void>,
  wait: (ms: number) => Promise<void>,
): Promise<boolean> {
  let done = false;
  void Promise.all([stdoutDone, stderrDone]).then(() => {
    done = true;
  }, () => {
    done = true;
  });
  if (done) return true;
  await Promise.race([
    Promise.all([stdoutDone, stderrDone]).then(() => {
      done = true;
    }).catch(() => {
      done = true;
    }),
    wait(50),
  ]);
  return done;
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

function observedHeadSha(observation: GitObservationV1 | null | undefined): string | null {
  if (observation === null || observation === undefined) return null;
  if (observation.head.outcome !== "FOUND") return null;
  return observation.head.sha;
}

function gitHeadDescendsFrom(git: GitRunner, ancestor: string, head: string): boolean | null {
  if (ancestor === head) return true;
  try {
    const result = git.run(["merge-base", "--is-ancestor", ancestor, head]);
    if (result.error !== null || result.status === null) return null;
    return result.status === 0;
  } catch {
    return null;
  }
}

function leaseIdentityEquals(
  a: { readonly kind: LeaseKindV1; readonly resource: string; readonly runId: string },
  b: { readonly kind: LeaseKindV1; readonly resource: string; readonly runId: string },
): boolean {
  return a.runId === b.runId && conflicts(a, b);
}

function recordedIdentityFromHeldLease(
  lease: LeaseV1,
  intentIdentity: ExecutorProcessIdentityV1 | null,
): ExecutorProcessIdentityV1 | null {
  if (intentIdentity !== null) return intentIdentity;
  const id = lease.processIdentity;
  if (id === undefined || !isUsablePid(id.pid)) return null;
  const token = normaliseRunNonce(id.runToken ?? "");
  if (token === null) return null;
  const creationDate = id.startedAt;
  if (creationDate === undefined || creationDate === "") return null;
  return {
    pid: id.pid,
    creationDate,
    executablePath: "C:\\adopted-holder",
    runNonce: token,
  };
}

function rememberInTreePids(
  seen: Set<number>,
  sightings: readonly OrphanSightingV1[],
  runNonce: string,
  holderPid: number | undefined,
): void {
  if (isUsablePid(holderPid)) seen.add(holderPid);
  for (const sighting of sightings) {
    const nonce = normaliseRunNonce(sighting.runNonce);
    if (nonce !== null && nonce === runNonce) seen.add(sighting.pid);
    if (isUsablePid(holderPid) && descendantPidsOf(holderPid, sightings).has(sighting.pid)) {
      seen.add(sighting.pid);
    }
    if (sighting.parentPid !== undefined && seen.has(sighting.parentPid)) {
      seen.add(sighting.pid);
    }
  }
}

function proveAdoptedWriterExit(input: {
  readonly lease: LeaseV1;
  readonly probe: HostProcessProbe;
  readonly scanOrphans: RunManagerDepsV1["scanOrphans"];
  readonly runNonce: string;
  readonly intentIdentity: ExecutorProcessIdentityV1 | null;
  readonly observedPids: Set<number>;
}): WriterExitProofV1 | null {
  const identity = recordedIdentityFromHeldLease(input.lease, input.intentIdentity);
  const holderPid = input.lease.pid ?? identity?.pid;
  const floor = identity?.creationDate
    ?? input.lease.processIdentity?.startedAt
    ?? input.lease.acquiredAt;
  const probedPid = identity?.pid ?? (isUsablePid(holderPid) ? holderPid : null);
  let observation: ProcessObservationV1 | null = null;
  if (probedPid !== null) {
    try {
      observation = input.probe.observe(probedPid);
    } catch {
      observation = { outcome: "UNAVAILABLE", reason: "probe threw" };
    }
  }
  const orphanScan = collectWriterOrphans({
    scanOrphans: input.scanOrphans,
    recorded: identity,
    runNonce: input.runNonce,
    createdNotBefore: floor,
    observedPids: input.observedPids,
    ...(isUsablePid(holderPid) ? { holderPid } : {}),
  });
  return proveWriterExit({
    processStillRunning: false,
    recordedLeaseKind: input.lease.kind,
    recordedLeaseId: input.lease.leaseId,
    recordedIdentity: identity,
    observation,
    probedPid,
    orphanScanPerformed: orphanScan.performed,
    orphanSightings: orphanScan.performed ? orphanScan.sightings : null,
    liveSightings: orphanScan.performed ? orphanScan.liveSightings : null,
  });
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function existingCompletionOn(
  fs: RunFileSystemV1,
  resultPath: string,
  runId: string,
): "none" | "spawned" | "unstarted" | "unreadable" {
  let present = false;
  try {
    present = fs.isFile(resultPath);
  } catch {
    return "unreadable";
  }
  if (!present) return "none";
  let raw: string;
  try {
    raw = fs.readUtf8(resultPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "none";
    return "unreadable";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "unreadable";
  }
  if (!isPlainObject(parsed)) return "unreadable";
  if (parsed.spawned === true) {
    const recordedRunId = parsed.runId;
    if (typeof recordedRunId === "string" && recordedRunId !== runId) return "unreadable";
    return "spawned";
  }
  if (parsed.spawned === false) return "unstarted";
  return "unreadable";
}

function reclaimExpiredHolder(input: {
  readonly store: LeaseStoreV1;
  readonly kind: LeaseKindV1;
  readonly resource: string;
  readonly heldBy: {
    readonly pid: number | null;
    readonly processIdentity: ProcessIdentityV1 | null;
  } | null;
  readonly probe: HostProcessProbe;
  readonly now: string;
}): { ok: boolean } {
  const recordedPid = input.heldBy?.pid ?? null;
  let observation: ProcessObservationV1;
  if (isUsablePid(recordedPid)) {
    try {
      observation = input.probe.observe(recordedPid);
    } catch {
      observation = { outcome: "UNAVAILABLE", reason: "probe threw" };
    }
  } else {
    observation = { outcome: "UNAVAILABLE", reason: "recorded holder pid is not observable" };
  }

  // Same mapping holderLiveness uses for these outcomes. FOUND is not death:
  // reclaimStaleLease's FOUND branch decides via occupant identity.
  const liveness = observation.outcome === "UNAVAILABLE" ? "UNKNOWN" : "DEAD_CONFIRMED";

  const observedIdentity = leaseIdentityFromObservation(observation);
  const result = reclaimStaleLease({
    existing: input.store.list(),
    kind: input.kind,
    resource: input.resource,
    holderLiveness: liveness,
    now: input.now,
    ...(isUsablePid(recordedPid)
      ? { holderObservation: { outcome: observation.outcome, pid: recordedPid } }
      : {}),
    ...(observedIdentity !== undefined ? { observedIdentity } : {}),
  });
  if (result.ok) input.store.save(result.remaining);
  return { ok: result.ok };
}

function leaseIdentityFromObservation(observation: ProcessObservationV1): ProcessIdentityV1 | undefined {
  if (observation.outcome !== "FOUND") return undefined;
  const token = normaliseRunNonce(observation.runNonce);
  return {
    pid: observation.pid,
    ...(observation.creationDate !== undefined ? { startedAt: observation.creationDate } : {}),
    ...(token !== null ? { runToken: token } : {}),
  };
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
