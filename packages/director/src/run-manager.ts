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
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { writeAtomic } from "./atomic-write.js";
import {
  createBoundedLog,
  createMemoryLogSink,
  type BoundedLogReportV1,
  type BoundedLogV1,
  type ClockV1,
  type LogSinkV1,
} from "./bounded-log.js";
import {
  argvGrantsWritePermission,
  buildExecutorLaunch,
  classifyExecutorExit,
  executorArgvFor,
} from "./executor-adapters.js";
import {
  discoverClaudeExecutor,
  discoverGrokExecutor,
  type DiscoveryEnvironment,
  type ExecutorDiscoveryResultV1,
  type FileSystemProbe,
} from "./executor-discovery.js";
import {
  argvIsSafe,
  isExecutorRole,
  LOCAL_ROLES,
  NON_WRITING_ROLES,
  routeRole,
  WRITE_ROLES,
  type ExecutorNameV1,
  type ExecutorRoleV1,
} from "./executors.js";
import {
  collectGitStatusIncludingIgnored,
  collectGitTruth,
  verifyGitTruth,
  type GitObservationV1,
  type GitRunner,
  type GitStatusObservationV1,
  type GitVerdictV1,
  type ListedTreeContentV1,
  REVIEW_TREE_DIGEST_MAX_BYTES,
  REVIEW_TREE_DIGEST_MAX_FILES,
} from "./git-truth.js";
import {
  artifactPathWithinRoot,
  findHandoffContradictions,
  parseHandoff,
  type ExecutorHandoffV1,
  type HandoffParseV1,
} from "./handoff.js";
import { canonicalizeHostPath, isResolvedHostPath } from "./host-path.js";
import { DIRECTOR_ROOT_ENV } from "./contracts.js";
import {
  createNodeLeaseStore,
  isHostWideLeaseKind,
  sandboxDirectorStoreRoot,
} from "./lease-store.js";
import {
  acquireLease,
  canonicalResource,
  conflicts,
  foreignWorktreeOccupiesDirectory,
  heartbeat,
  LEASE_TTL_MS,

  reclaimStaleLease,
  releaseLease,
  type LeaseKindV1,
  type LeaseV1,
  type ProcessIdentityV1,
} from "./leases.js";
import {
  ANCESTRY_SAMPLE_INTERVAL_MS,
  ANCESTRY_SAMPLE_MAX_PER_RUN,
  captureProcessIdentity,
  createWindowsAncestrySampler,
  createWindowsOrphanScanner,
  descendantPidsOf,
  descendantPidsOfPositiveIdentity,
  detectOrphan,
  holderLiveness,
  hostWideTreeEvidenceFromScan,
  identityFromObservation,
  isUsablePid,
  measurementApparatusIdentitiesOfThisProcess,
  normaliseRunNonce,
  normalisedCreationDate,
  nextUndecidablePersistenceDecision,
  observationIsAboutPid,
  OrphanScanUnavailableError,
  processRowPlausibilityContext,
  compareCreationDates,
  nonceMatchesRun,
  processRowCouldBelongToThisRun,
  writerOrphanScanResult,
  type WriterOrphanScanResultV1,
  resolveWindowsSystemExecutable,
  holderExitedAtCeilingIsUsable,
  occupantIsProvenDifferentProcess,
  rememberSampledDescendantPids,
  undecidableMembershipConfirmSteps,
  undecidableRowsOf,
  UNDECIDABLE_MEMBERSHIP_CONFIRM_DELAY_MS,
  placeableInstantMs,
  provenCreatedStrictlyAfter,
  provenCreatedStrictlyBefore,
  type AncestrySampleRowV1,
  type ExecutorProcessIdentityV1,
  type HostProcessProbe,
  type MeasurementApparatusInputV1,
  type OrphanVerdictV1,
  type ProcessObservationV1,
} from "./process-identity.js";
import {
  answersAfterReboot,
  assertSpawnPermitBinding,
  existingIntentOn,
  isSpawnPermitSpent,
  readRunIntent,
  recordSpawnAttempt,
  recordSpawnObservation,
  spendSpawnPermit,
  UNRESOLVABLE_EXISTING_INTENT_REASON,
  withPersistedIntent,
  type IntentStoreV1,
  type RunIntentV1,
  type SpawnPermitV1,
} from "./run-intent.js";
import { CONTROL_BYTES, asUsableToken } from "./control-bytes.js";

export const RUN_RESULT_SCHEMA_V1 = "aion.director.run-result.v1" as const;

export const CANCEL_SOFT_MS = 5_000;
export const CANCEL_HARD_MS = 10_000;

/**
 * What a clean orphan scan actually establishes. ShellExecute and a
 * creation-time Job Object are outside this sentence. D2 CHILD_TREE is
 * unmet until containment happens at creation time.
 */
export const EXECUTOR_TREE_GONE_REASON =
  "no process attributable to this run by nonce, holder chain, or the parentless/broker window remains";

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
  | "writeMovedHead"
  | "writeRoleWasGrantedWritePermission"
  | "ownerNotRequired"
  | "capacityNotExhausted";

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
  /**
   * Bytes written to the child's stdin and then ended. Used so a Claude
   * prompt file reaches the process without appearing on argv.
   */
  readonly stdin?: string;
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
  /**
   * Durable store root used for the run-completion index. Missing or
   * blank is not a licence to invent a second namespace under the run
   * parent; callers without a root share {@link sandboxDirectorStoreRoot}.
   */
  readonly root?: string;
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
  readonly parentCreationDate?: string;
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
    apparatusPids?: readonly MeasurementApparatusInputV1[];
  }) => WriterOrphanScanResultV1;
  /**
   * Optional test hook. When omitted and `scanOrphans` is also omitted,
   * production uses {@link createWindowsAncestrySampler}. A failed sample
   * is ignored: it is not a scan and is never "no descendants".
   */
  readonly sampleAncestry?: (query: {
    readonly holderPid: number;
  }) => readonly AncestrySampleRowV1[];
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
  readonly authorisedProductionMutated?: boolean | null;
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
   * Defaults to `IMPLEMENT` (measured implementer argv). Every role in
   * {@link NON_WRITING_ROLES} receives `plan` and no `--always-approve`.
   * `dontAsk` is not treated as a non-writing launch.
   */
  readonly role?: ExecutorRoleV1;
};

export type RecoverOutcomeV1 = "REFUSED_UNKNOWN" | "REFUSED_ALIVE" | "TERMINAL";

export type ResultPersistedV1 = "written" | "skipped" | "failed";

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
  readonly resultPersisted?: ResultPersistedV1;
  readonly recoverOutcome?: RecoverOutcomeV1;
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
  /**
   * Rows that made membership UNKNOWN. Empty when the scan completed or
   * failed for a reason other than an undecidable occupant. A blocked
   * operator must be able to see which pid blocked them.
   */
  readonly undecidable: readonly OrphanSightingV1[];
  readonly directorSessionId?: number;
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
  /**
   * This run's nonce. Required on the identity-absent sighting loop so
   * that branch can apply the same membership rule as identity-present.
   * Omitted is "no nonce to judge by": any leftover sighting then denies.
   */
  readonly runNonce?: string | null;
  readonly createdNotBefore?: string;
  readonly holderExitedAt?: string;
  readonly observedPids?: ReadonlySet<number>;
  readonly directorSessionId?: number;
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
      // Two allowlisted routes when identity is absent:
      // 1. Capture saw NOT_FOUND for the recorded pid, and the handle this
      //    run owns has since settled as exited.
      // 2. Adopted crash-window lease `{pid, runToken}` with no startedAt:
      //    a NOT_FOUND observation of that pid, scan performed and clean.
      //    Do not invent a creationDate. UNAVAILABLE and FOUND still deny.
      const owned = input.ownedHandleExit;
      const ownedSettled =
        owned !== null
        && owned !== undefined
        && owned.spawnOccurred === true
        && owned.handleExited === true
        && owned.exitSettledWithCode === true
        && owned.identityAbsentBecauseAlreadyExited === true;
      const adoptedSlotGone =
        input.observation !== null
        && input.observation.outcome === "NOT_FOUND"
        && input.probedPid !== null
        && isUsablePid(input.probedPid)
        && observationIsAboutPid(input.observation, input.probedPid);
      if (!ownedSettled && !adoptedSlotGone) return null;
      const nonce = normaliseRunNonce(input.runNonce ?? "");
      // Pass the normalised value through even when it is null. Omitted,
      // "", and null are "no nonce to judge by": any leftover sighting
      // then denies. Guarding `nonce !== null &&` made that deny-check
      // unreachable and minted a proof over a live in-tree process.
      if (sightingsDenyWriterExit(
        input.orphanSightings,
        nonce,
        null,
        input.probedPid,
        "DEAD_CONFIRMED",
        input,
      )) {
        return null;
      }
      return makeWriterExitProof();
    }

    if (input.observation === null) return null;
    if (input.probedPid === null) return null;
    if (!observationIsAboutRecorded(input.recordedIdentity, input.probedPid, input.observation)) {
      return null;
    }

    const liveness = holderLiveness(input.recordedIdentity, input.observation);
    if (liveness !== "DEAD_CONFIRMED") return null;

    if (sightingsDenyWriterExit(
      input.orphanSightings,
      input.recordedIdentity.runNonce,
      input.recordedIdentity,
      input.recordedIdentity.pid,
      liveness,
      input,
    )) {
      return null;
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

/**
 * One sighting loop for both identity branches. A leftover that is not
 * proven absent from this run denies the proof. When identity is present
 * the per-sighting {@link detectOrphan} verdict is read; when it is
 * absent any in-tree sighting denies — there is no recorded holder to
 * compare, and inventing one would be a fabricated identity.
 */
function sightingsDenyWriterExit(
  sightings: readonly OrphanSightingV1[] | null,
  runNonce: string | null,
  recorded: ExecutorProcessIdentityV1 | null,
  holderPid: number | null,
  parentLiveness: "DEAD_CONFIRMED",
  membership?: {
    readonly createdNotBefore?: string;
    readonly holderExitedAt?: string;
    readonly observedPids?: ReadonlySet<number>;
    readonly directorSessionId?: number;
  },
): boolean {
  if (sightings === null) return false;
  if (runNonce === null) return sightings.length > 0;
  for (const sighting of sightings) {
    const inTree = writerSightingNotProvenAbsent(sighting, runNonce, {
      holderPid,
      rows: sightings,
      ...(membership?.createdNotBefore !== undefined ? { createdNotBefore: membership.createdNotBefore } : {}),
      ...(membership?.holderExitedAt !== undefined ? { holderExitedAt: membership.holderExitedAt } : {}),
      ...(membership?.observedPids !== undefined ? { observedPids: membership.observedPids } : {}),
      ...(membership?.directorSessionId !== undefined ? { directorSessionId: membership.directorSessionId } : {}),
    });
    if (!inTree) continue;
    if (recorded === null) return true;
    const verdict: OrphanVerdictV1 = detectOrphan({
      recorded,
      observed: observationFromSighting(sighting),
      parentLiveness,
    });
    if (verdict.orphan) return true;
  }
  return false;
}

function observationIsAboutRecorded(
  recorded: ExecutorProcessIdentityV1,
  probedPid: number,
  observation: ProcessObservationV1,
): boolean {
  // One subject check. Do not write a second observation.pid === …
  if (!observationIsAboutPid(observation, recorded.pid)) return false;
  if (!observationIsAboutPid(observation, probedPid)) return false;
  if (observation.outcome !== "FOUND") return true;
  const observedNonce = normaliseRunNonce(observation.runNonce);
  if (observedNonce !== null && observedNonce !== recorded.runNonce) return false;
  return true;
}

function porcelainLineSet(observation: GitStatusObservationV1): ReadonlySet<string> {
  if (observation.outcome === "CLEAN") return new Set();
  if (observation.outcome === "UNAVAILABLE") return new Set();
  const lines = observation.porcelain.split(/\r?\n/).filter((line) => line.length > 0);
  return new Set(lines);
}

function porcelainLineSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const line of left) {
    if (!right.has(line)) return false;
  }
  return true;
}

function listedContentOf(observation: GitStatusObservationV1): ListedTreeContentV1 | undefined {
  if (observation.outcome === "UNAVAILABLE") return undefined;
  return observation.listedContent;
}

function compareListedTreeContent(
  before: ListedTreeContentV1 | undefined,
  after: ListedTreeContentV1 | undefined,
  role: string,
): { readonly ok: boolean; readonly reason: string } {
  if (before === undefined || after === undefined) {
    return {
      ok: false,
      reason: `${role} listed-tree content digest was not collected before and after; UNKNOWN does not license a review verdict`,
    };
  }
  if (before.outcome === "BUDGET_EXCEEDED" || after.outcome === "BUDGET_EXCEEDED") {
    const which = before.outcome === "BUDGET_EXCEEDED"
      ? before
      : after.outcome === "BUDGET_EXCEEDED" ? after : before;
    const budgetReason = which.outcome === "BUDGET_EXCEEDED" ? which.reason : "budget exceeded";
    return {
      ok: false,
      reason: `${role} listed-tree content digest exceeded budget (${budgetReason}; REVIEW_TREE_DIGEST_MAX_FILES=${REVIEW_TREE_DIGEST_MAX_FILES}, REVIEW_TREE_DIGEST_MAX_BYTES=${REVIEW_TREE_DIGEST_MAX_BYTES})`,
    };
  }
  if (before.outcome === "UNAVAILABLE" || after.outcome === "UNAVAILABLE") {
    const which = before.outcome === "UNAVAILABLE"
      ? before
      : after.outcome === "UNAVAILABLE" ? after : before;
    const unavailableReason = which.outcome === "UNAVAILABLE" ? which.reason : "unavailable";
    return {
      ok: false,
      reason: `${role} listed-tree content digest is UNAVAILABLE (${unavailableReason}); UNKNOWN does not license a review verdict`,
    };
  }
  if (before.digest !== after.digest || before.fileCount !== after.fileCount || before.totalBytes !== after.totalBytes) {
    return {
      ok: false,
      reason: `${role} changed listed-tree content (digest/fileCount/bytes)`,
    };
  }
  return { ok: true, reason: `${role} left the tree unchanged` };
}

export function evaluateSuccessConjunction(input: {
  readonly exitCode: number | null;
  readonly stillRunning: boolean;
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
  readonly authorisedProductionMutated?: boolean | null | undefined;
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
  /**
   * False when this conjunction describes a run that never created a process.
   * HEAD conjuncts must then say so rather than borrowing the "role is not a …"
   * wording. Omitted means a process existed (live evaluation).
   */
  readonly processWasCreated?: boolean;
  /**
   * Physical fact: the argv handed to the child contained the adapter's
   * write-permission tokens. A missing role label cannot turn this off.
   */
  readonly argvGrantedWrite?: boolean;
  /**
   * `git status --porcelain --ignored` collected for a review role after
   * the child exits. Compared as a set of lines against
   * {@link treeIncludingIgnoredBefore}. Omitted or UNAVAILABLE is UNKNOWN
   * and does not license "left the tree unchanged".
   */
  readonly treeIncludingIgnored?: GitStatusObservationV1 | null;
  /**
   * The same ignored-inclusive reading collected *before* spawn.
   * A claim about what this run changed requires both ends.
   */
  readonly treeIncludingIgnoredBefore?: GitStatusObservationV1 | null;
  /**
   * This run's Director-minted nonce. A parsed handoff must echo it.
   * Omitted is UNKNOWN: a report cannot bind to an unnamed invocation.
   */
  readonly expectedRunNonce?: string | null;
  /**
   * Director-observed completion instant (handle exit / now after settle).
   * `finishedAt` after this ceiling is not this invocation's report.
   */
  readonly observedCompletedAt?: string | null;
  /**
   * Directory the child was given. Git observations must name this
   * place. Omitted keeps the previous callers' behaviour.
   */
  readonly expectedWorktree?: string;
  /**
   * libuv signal name when the child died of a signal. A signalled
   * exit is not a clean completion, even with code 0.
   */
  readonly exitSignal?: string | null;
}): SuccessConjunctionV1 {
  const known = KNOWN_SUCCESS_EXIT_CODES;
  const classified = input.exitCode === null
    ? null
    : classifyExecutorExit(input.executor, input.exitCode, input.output);
  const signalled = input.exitSignal !== null
    && input.exitSignal !== undefined
    && input.exitSignal !== "";

  const runningUnknown = input.stillRunning !== false;
  const neverCreated = input.processWasCreated === false;
  const exitOk = !neverCreated
    && input.stillRunning === false
    && input.exitCode !== null
    && !signalled
    && known.includes(input.exitCode)
    && (classified === null || classified.kind === "COMPLETED");

  const exitReason = neverCreated
    ? "no process was created; success is not claimed for an invocation that never ran"
    : runningUnknown
    ? "the process is still running"
    : signalled
      ? `process exited on signal ${input.exitSignal}; a signalled exit is not a clean completion`
      : input.exitCode === null
        ? "the process did not produce an exit code"
        : !known.includes(input.exitCode)
          ? `exit code ${input.exitCode} is not a known-success code`
          : classified !== null && classified.kind !== "COMPLETED"
            ? `exit ${input.exitCode} classified as ${classified.kind}, not a completed run`
            : "process exited with a known-success code";

  const parsed = input.parsed;
  const handoff = parsed.ok ? parsed.handoff : null;

  const observedBranch = input.gitAfter !== null && input.gitAfter.branch.outcome === "ATTACHED"
    ? input.gitAfter.branch.name
    : undefined;
  const contradictions = handoff === null
    ? []
    : findHandoffContradictions({
      handoff,
      ...(observedBranch !== undefined ? { observedBranch } : {}),
      ...(input.authorisedProductionMutated !== undefined
        ? { authorisedProductionMutated: input.authorisedProductionMutated }
        : {}),
    });

  const statusContradiction = contradictions.find((item) => item.field === "status");
  const selfTiming = contradictions.find((item) => item.field === "finishedAt");
  const floorMs = input.spawnedAtFloor === undefined || input.spawnedAtFloor === null
    ? null
    : placeableInstantMs(input.spawnedAtFloor);
  const finishedMs = handoff === null ? null : placeableInstantMs(handoff.finishedAt);
  const completedMs = input.observedCompletedAt === undefined || input.observedCompletedAt === null
    ? null
    : placeableInstantMs(input.observedCompletedAt);
  const expectedNonce = input.expectedRunNonce === undefined || input.expectedRunNonce === null
    ? null
    : normaliseRunNonce(input.expectedRunNonce);
  const reportedNonce = handoff === null ? null : normaliseRunNonce(handoff.runNonce);
  const nonceMatches = expectedNonce !== null && reportedNonce !== null && reportedNonce === expectedNonce;
  const processWasCreatedForWindow = input.processWasCreated !== false;
  const handoffInThisRunWindow = handoff === null
    ? false
    : finishedMs !== null
      && floorMs !== null
      && finishedMs >= floorMs
      && (
        !processWasCreatedForWindow
          ? true
          : completedMs !== null && finishedMs <= completedMs
      );
  const handoffParsedOk = handoff !== null
    && handoff.status === "PASS"
    && statusContradiction === undefined
    && selfTiming === undefined
    && nonceMatches
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
  } else if (!nonceMatches) {
    handoffParsedReason = reportedNonce === null
      ? "handoff runNonce is missing or not a usable token; the file is not this invocation's report"
      : expectedNonce === null
        ? "this run's nonce is missing or not a usable token; UNKNOWN does not bind the report to this run"
        : "handoff runNonce does not match this run's nonce; the file is not this invocation's report";
  } else if (!handoffInThisRunWindow) {
    handoffParsedReason = finishedMs === null
      ? "handoff finishedAt is not a placeable instant; UNKNOWN does not bind the report to this run"
      : floorMs === null
        ? "this run's spawn floor is not a placeable instant; UNKNOWN does not bind the report to this run"
        : completedMs === null && processWasCreatedForWindow
          ? "this run's completion instant is not a placeable instant; UNKNOWN does not bind the report to this run"
          : completedMs !== null && finishedMs > completedMs
            ? "handoff finishedAt is after this run's observed completion; the file is not this invocation's report"
            : "handoff finishedAt precedes this run's spawn floor; the file is not this invocation's report";
  } else {
    handoffParsedReason = "handoff parsed";
  }

  const parsedWorkItem = handoff !== null && handoff.workItemId !== undefined
    ? handoff.workItemId
    : null;
  const identitiesOk = handoff !== null
    && handoff.missionId === input.expectedMissionId
    && handoff.runId === input.expectedRunId
    && parsedWorkItem !== null
    && parsedWorkItem === input.expectedWorkItemId;

  let identitiesReason = "mission id, run id and work item match what was dispatched";
  if (handoff === null) {
    identitiesReason = "no parsed handoff to bind to the dispatched ids";
  } else if (handoff.missionId !== input.expectedMissionId) {
    identitiesReason = `missionId ${handoff.missionId} is not the dispatched ${input.expectedMissionId}`;
  } else if (handoff.runId !== input.expectedRunId) {
    identitiesReason = `runId ${handoff.runId} is not the dispatched ${input.expectedRunId}`;
  } else if (parsedWorkItem === null) {
    identitiesReason = "handoff does not name the dispatched work item";
  } else if (parsedWorkItem !== input.expectedWorkItemId) {
    identitiesReason = `workItemId ${parsedWorkItem} is not the dispatched ${input.expectedWorkItemId}`;
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
    const observedHead = observedHeadSha(input.gitAfter);
    if (observedHead === null || observedHead !== handoff.headAfter) {
      gitOk = false;
      gitReason = observedHead === null
        ? "Git HEAD was not observed; absence is not agreement with the handoff"
        : `observed HEAD ${observedHead} is not the handoff headAfter ${handoff.headAfter}`;
    } else {
      gitOk = true;
      gitReason = "Director Git observation agrees with the handoff";
    }
  }
  if (input.expectedWorktree !== undefined) {
    const expected = canonicalizeHostPath(input.expectedWorktree);
    const afterPlace = input.gitAfter === null ? "" : canonicalizeHostPath(input.gitAfter.worktreePath);
    const beforeObs = input.gitBefore;
    const beforePlace = beforeObs === null || beforeObs === undefined
      ? ""
      : canonicalizeHostPath(beforeObs.worktreePath);
    if (expected === "" || afterPlace === "" || afterPlace !== expected || beforePlace === "" || beforePlace !== expected) {
      gitOk = false;
      gitReason = "Git observation does not name the directory the child will run in; a record that names nowhere is not a record";
    }
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
  } else if (typeof input.authorisedProductionMutated !== "boolean") {
    if (handoff.productionMutated === true) {
      productionReason = "authorisation is UNKNOWN; a claimed production mutation is not authorised";
    } else {
      productionOk = true;
      productionReason = "handoff claims production was left alone; authorisation was not a boolean so no comparison was required";
    }
  } else {
    productionOk = true;
    productionReason = "compared the handoff production claim with the authorisation flag; production itself was not observed";
  }

  const beforeSha = observedHeadSha(input.gitBefore ?? null);
  const afterSha = observedHeadSha(input.gitAfter);
  const role = input.role;
  const processWasCreated = input.processWasCreated !== false;
  const argvGrantedWrite = input.argvGrantedWrite === true;
  const isWriteRole = role !== undefined && isExecutorRole(role) && WRITE_ROLES.has(role);
  const isReviewRole = role !== undefined && isExecutorRole(role) && NON_WRITING_ROLES.has(role);
  // Physical fact: write-permission tokens on argv cannot be turned off by omitting a label.
  const mustAdvanceHead = isWriteRole || argvGrantedWrite;
  const mustLeaveTree = isReviewRole && !argvGrantedWrite;
  let reviewOk = true;
  let reviewReason = "role is not a review that must leave the tree unchanged";
  let writeMovedOk = true;
  let writeMovedReason = "role is not a write role that must advance HEAD";

  if (!processWasCreated) {
    const named = role !== undefined ? ` for role ${role}` : "";
    reviewReason = `no process was created, so HEAD movement was not evaluated${named}`;
    writeMovedReason = `no process was created, so HEAD movement was not evaluated${named}`;
  } else if (role !== undefined && !isExecutorRole(role)) {
    reviewOk = false;
    reviewReason = `role ${String(role)} is not an enumerated executor role`;
    writeMovedOk = false;
    writeMovedReason = `role ${String(role)} is not an enumerated executor role`;
  } else if (mustLeaveTree) {
    if (beforeSha === null || afterSha === null) {
      reviewOk = false;
      reviewReason = beforeSha === null
        ? `${role} git-before HEAD is UNAVAILABLE; UNKNOWN does not license a review verdict`
        : `${role} git-after HEAD is UNAVAILABLE; UNKNOWN does not license a review verdict`;
    } else if (beforeSha !== afterSha) {
      reviewOk = false;
      reviewReason = `${role} moved HEAD; a reviewer that writes is not a review`;
    } else {
      const after = input.treeIncludingIgnored;
      const before = input.treeIncludingIgnoredBefore;
      if (after === undefined || after === null || before === undefined || before === null) {
        reviewOk = false;
        reviewReason = `${role} ignored-inclusive worktree status was not collected before and after; UNKNOWN does not license a review verdict`;
      } else if (after.outcome === "UNAVAILABLE" || before.outcome === "UNAVAILABLE") {
        reviewOk = false;
        reviewReason = `${role} ignored-inclusive worktree status is UNAVAILABLE; UNKNOWN does not license a review verdict`;
      } else {
        const beforeLines = porcelainLineSet(before);
        const afterLines = porcelainLineSet(after);
        if (!porcelainLineSetsEqual(beforeLines, afterLines)) {
          reviewOk = false;
          reviewReason = `${role} left the worktree dirty (including ignored files)`;
        } else {
          const beforeContent = listedContentOf(before);
          const afterContent = listedContentOf(after);
          const digestVerdict = compareListedTreeContent(beforeContent, afterContent, role);
          if (!digestVerdict.ok) {
            reviewOk = false;
            reviewReason = digestVerdict.reason;
          } else {
            reviewReason = `${role} left the tree unchanged`;
          }
        }
      }
    }
  }

  if (processWasCreated && mustAdvanceHead) {
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

  let writeGrantOk = true;
  let writeGrantReason = "role is not a write role that must be granted write permission";
  if (processWasCreated && argvGrantedWrite && !isWriteRole) {
    writeGrantOk = false;
    writeGrantReason = "argv granted write permission but the role is not a write role";
  } else if (processWasCreated && isWriteRole) {
    if (!argvGrantedWrite) {
      writeGrantOk = false;
      writeGrantReason = "write role argv does not grant write permission";
    } else {
      writeGrantReason = "write role argv grants write permission";
    }
  }

  let ownerOk = true;
  let ownerReason = "no parsed handoff whose Owner requirement can be checked";
  if (handoff !== null) {
    if (handoff.requiresOwner === true) {
      ownerOk = false;
      ownerReason = "handoff requires an Owner decision; this is not a successful autonomous run";
    } else {
      ownerReason = "handoff does not require an Owner decision";
    }
  }

  let capacityOk = true;
  let capacityReason = "no parsed handoff whose capacity claim can be checked";
  if (handoff !== null) {
    if (handoff.capacityStatus === "CAPACITY_EXHAUSTED") {
      capacityOk = false;
      capacityReason = "handoff reports CAPACITY_EXHAUSTED; this run is not a successful autonomous run";
    } else {
      capacityReason = `handoff capacityStatus is ${handoff.capacityStatus}`;
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
      ok: input.timedOut === false,
      reason: input.timedOut === true
        ? "the Director cancelled the run for exceeding its budget"
        : input.timedOut === false
          ? "the run completed within its budget"
          : "timeout state is UNKNOWN; a missing timedOut is not a completed-within-budget fact",
    },
    {
      name: "logStayedWithinBudget",
      ok: logBudgetOk,
      reason: logBudgetReason,
    },
    { name: "reviewLeftTreeUnchanged", ok: reviewOk, reason: reviewReason },
    { name: "writeMovedHead", ok: writeMovedOk, reason: writeMovedReason },
    { name: "writeRoleWasGrantedWritePermission", ok: writeGrantOk, reason: writeGrantReason },
    { name: "ownerNotRequired", ok: ownerOk, reason: ownerReason },
    { name: "capacityNotExhausted", ok: capacityOk, reason: capacityReason },
  ];

  const failedConjuncts = findings.filter((finding) => !finding.ok).map((finding) => finding.name);
  return {
    ok: failedConjuncts.length === 0,
    findings,
    failedConjuncts,
  };
}

function emptyRefusalConjunction(runRoot: string, reason: string): SuccessConjunctionV1 {
  const emptyParsed: HandoffParseV1 = { ok: false, handoff: null, problems: ["no handoff text"] };
  return evaluateSuccessConjunction({
    exitCode: null,
    stillRunning: false,
    executor: "local",
    output: "",
    parsed: emptyParsed,
    reportedWorkItemId: null,
    expectedMissionId: "",
    expectedRunId: "",
    expectedWorkItemId: "",
    runRoot,
    gitAfter: null,
    gitVerdict: null,
    authorisedProductionMutated: false,
    declaredArtifactsInsideRunRoot: false,
    declaredArtifactsInsideRunRootReason: reason,
    executorTreeGone: true,
    executorTreeReason: "this launch never created a process",
    timedOut: false,
    logStayedWithinBudget: true,
    processWasCreated: false,
  });
}

function invalidLaunchOrExecuteRequest(
  request: unknown,
  opts: { readonly requireArgv: boolean },
): RunResultV1 | null {
  if (request === null || typeof request !== "object") {
    return namedRequestRefusal("request is not an object", request);
  }
  const row = request as Partial<ExecuteRunRequestV1>;
  if (typeof row.runRoot !== "string") {
    return namedRequestRefusal("runRoot is not a string", request);
  }
  if (!isResolvedHostPath(row.runRoot)) {
    return namedRequestRefusal("runRoot is not an identifiable absolute path", request);
  }
  if (opts.requireArgv) {
    if (!Array.isArray(row.argv) || !row.argv.every((item) => typeof item === "string")) {
      return namedRequestRefusal("argv is not an array of strings", request);
    }
  }
  return null;
}

function namedRequestRefusal(reason: string, request: unknown): RunResultV1 {
  const runId = request !== null && typeof request === "object" && typeof (request as { runId?: unknown }).runId === "string"
    ? (request as { runId: string }).runId
    : "";
  return {
    schema: RUN_RESULT_SCHEMA_V1,
    resultPath: null,
    runId,
    ok: false,
    spawned: false,
    reason,
    conjunction: emptyRefusalConjunction("", reason),
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
    resultPersisted: "skipped",
  };
}

/**
 * Reboot recovery entry point. Reads the durable intent and either records
 * a terminal result or refuses with the holder named. Does not spawn.
 *
 * D2 CHILD_TREE remains unmet: this path does not claim the process tree
 * is gone unless a later scan proves it.
 */
export async function recoverAbandonedRun(
  runRoot: string,
  deps: {
    readonly fs: RunFileSystemV1;
    readonly probe: HostProcessProbe;
    readonly clock: ClockV1;
    readonly leases?: LeaseStoreV1;
  },
): Promise<RunResultV1> {
  if (typeof runRoot !== "string") {
    return namedRequestRefusal("runRoot is not a string", { runRoot, runId: "" });
  }
  const intentPath = join(runRoot, "intent.json");
  const resultPath = join(runRoot, "result.json");
  const parsed = readRunIntent(intentPath, intentStoreFromFs(deps.fs));
  const answers = answersAfterReboot(parsed.ok ? parsed.intent : null);
  const runId = parsed.ok ? parsed.intent.runId : "";
  const leaseStore = deps.leases ?? createNodeLeaseStore(sandboxDirectorStoreRoot());
  // `answers.started` is a workflow flag written after spawn returns. It
  // is not the physical fact "a process exists". A missing spawn record
  // is UNKNOWN. Recover refusals are not executeRun completions.
  const finish = (
    reason: string,
    outcome: RecoverOutcomeV1,
    spawned: boolean,
  ): RunResultV1 => {
    const spawnRecorded = spawned || answers.started;
    const result: RunResultV1 = {
      schema: RUN_RESULT_SCHEMA_V1,
      resultPath,
      runId,
      ok: false,
      spawned: spawnRecorded,
      reason,
      recoverOutcome: outcome,
      conjunction: emptyRefusalConjunction(runRoot, reason),
      exitCode: null,
      processIdentity: parsed.ok ? parsed.intent.processIdentity : null,
      intent: parsed.ok ? parsed.intent : null,
      handoff: null,
      gitBefore: null,
      gitAfter: null,
      lease: null,
      productionWriterLeaseReleasedByThisRun: false,
      cancel: { timedOut: false, stages: [] },
      log: null,
    };
    const write = writeResultIfPermitted(deps.fs, runRoot, resultPath, result, false);
    const indexOk = !spawnRecorded
      || recordIndexedRunCompletion(deps.fs, leaseStore, runId, runRoot);
    if (write === "failed" || !indexOk) {
      return { ...result, resultPath: write === "failed" ? null : result.resultPath, resultPersisted: "failed" };
    }
    if (write === "skipped") return { ...result, resultPath: null, resultPersisted: "skipped" };
    return { ...result, resultPersisted: "written" };
  };
  try {
    if (!parsed.ok) {
      return finish("recover refused: intent is unreadable or absent", "REFUSED_UNKNOWN", false);
    }
    const recorded = parsed.intent.processIdentity;
    let leasePid: number | null = null;
    try {
      leasePid = holderPidFromLeases(leaseStore, parsed.intent.runId);
    } catch (error) {
      return finish(
        `recover refused: lease store unreadable; holder pid is UNKNOWN (${errorMessage(error)})`,
        "REFUSED_UNKNOWN",
        false,
      );
    }
    const spawnPid = answers.spawnPid;
    const probePid = recorded !== null && isUsablePid(recorded.pid)
      ? recorded.pid
      : (isUsablePid(spawnPid) ? spawnPid : leasePid);
    if (!answers.started && probePid === null) {
      return finish(UNRESOLVABLE_EXISTING_INTENT_REASON, "REFUSED_UNKNOWN", false);
    }
    if (recorded !== null && probePid !== null && probePid !== recorded.pid) {
      return finish(
        `recover refused: probe pid ${probePid} is not the recorded holder ${recorded.pid}`,
        "REFUSED_UNKNOWN",
        false,
      );
    }
    if (probePid !== null) {
      let observation: ProcessObservationV1;
      try {
        observation = deps.probe.observe(probePid);
      } catch {
        return finish(
          `recover refused: holder pid ${probePid} liveness is UNKNOWN`,
          "REFUSED_UNKNOWN",
          false,
        );
      }
      if (recorded !== null) {
        const liveness = holderLiveness(recorded, observation);
        if (liveness === "ALIVE") {
          return finish(
            `recover refused: holder pid ${probePid} is still present`,
            "REFUSED_ALIVE",
            true,
          );
        }
        if (liveness === "UNKNOWN") {
          return finish(
            `recover refused: holder pid ${probePid} liveness is UNKNOWN`,
            "REFUSED_UNKNOWN",
            false,
          );
        }
        return finish(
          `recover recorded a terminal result; holder pid ${probePid} is DEAD_CONFIRMED. D2 CHILD_TREE remains unmet.`,
          "TERMINAL",
          true,
        );
      }
      if (!observationIsAboutPid(observation, probePid)) {
        return finish(
          `recover refused: holder pid ${probePid} liveness is UNKNOWN`,
          "REFUSED_UNKNOWN",
          false,
        );
      }
      if (observation.outcome === "FOUND") {
        return finish(
          `recover refused: holder pid ${probePid} is still present`,
          "REFUSED_ALIVE",
          true,
        );
      }
      if (observation.outcome === "UNAVAILABLE") {
        return finish(
          `recover refused: holder pid ${probePid} liveness is UNKNOWN`,
          "REFUSED_UNKNOWN",
          false,
        );
      }
      if (observation.outcome === "NOT_FOUND") {
        return finish(
          `recover recorded a terminal result; holder pid ${probePid} is NOT_FOUND. D2 CHILD_TREE remains unmet.`,
          "TERMINAL",
          true,
        );
      }
      return finish(
        `recover refused: holder pid ${probePid} liveness is UNKNOWN`,
        "REFUSED_UNKNOWN",
        false,
      );
    }
    // Started (a spawn was recorded) but no holder pid is known. That is
    // UNKNOWN, not a terminal observation. A later sweep that can probe
    // must still be able to promote this record.
    return finish(
      "recover refused: a spawn was recorded but no holder pid was; liveness is UNKNOWN",
      "REFUSED_UNKNOWN",
      false,
    );
  } catch (error) {
    return finish(
      `recover refused: recovery observation failed (${errorMessage(error)})`,
      "REFUSED_UNKNOWN",
      false,
    );
  }
}

function holderPidFromLeases(store: LeaseStoreV1 | undefined, runId: string): number | null {
  if (store === undefined) return null;
  for (const lease of store.list()) {
    if (lease.runId !== runId) continue;
    if (isUsablePid(lease.pid)) return lease.pid;
    if (isUsablePid(lease.processIdentity?.pid)) return lease.processIdentity.pid;
  }
  return null;
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
  const invalid = invalidLaunchOrExecuteRequest(request, { requireArgv: false });
  if (invalid !== null) return invalid;
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
  if (!isExecutorRole(role)) {
    return refusedBeforeSpawn(request, deps, "role is not an enumerated executor role");
  }
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
function promptPathReadableNonempty(read: () => string): boolean {
  try {
    return read().trim() !== "";
  } catch {
    return false;
  }
}

/**
 * Prompt existence is a host/run-fs fact. Discovery `isFile` answers
 * "is this the executor binary?" and must not authorize a prompt path.
 * An empty or unreadable file is not a prompt.
 */
function promptPathExistsOnLaunch(promptPath: string, deps: RunManagerDepsV1): boolean {
  try {
    if (deps.fs.isFile(promptPath)) {
      return promptPathReadableNonempty(() => deps.fs.readUtf8(promptPath));
    }
  } catch {
    // continue to host stat
  }
  try {
    if (!statSync(promptPath).isFile()) return false;
    return promptPathReadableNonempty(() => readFileSync(promptPath, "utf8"));
  } catch {
    return false;
  }
}

function launchPathMatchesDiscoveredAdapter(
  request: ExecuteRunRequestV1,
  deps: RunManagerDepsV1,
  runNonce: string,
  role: ExecutorRoleV1,
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
  if (!promptPathExistsOnLaunch(promptPath, deps)) {
    return { ok: false, reason: "executor adapter: prompt path does not name an existing file" };
  }
  const expected = executorArgvFor(request.executor, {
    promptPath,
    cwd: request.cwd,
    role,
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
  const refusedRole = request.role === undefined
    ? "IMPLEMENT"
    : isExecutorRole(request.role) ? request.role : undefined;
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
    processWasCreated: false,
    ...(refusedRole !== undefined ? { role: refusedRole } : {}),
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
  const write = writeResultIfPermitted(deps.fs, request.runRoot, resultPath, result, false);
  if (write === "failed") return { ...result, resultPath: null, resultPersisted: "failed" };
  if (write === "skipped") return { ...result, resultPath: null, resultPersisted: "skipped" };
  return { ...result, resultPersisted: "written" };
}

export async function executeRun(
  request: ExecuteRunRequestV1,
  deps: RunManagerDepsV1,
): Promise<RunResultV1> {
  const invalid = invalidLaunchOrExecuteRequest(request, { requireArgv: true });
  if (invalid !== null) return invalid;
  const runRoot = request.runRoot;
  const intentPath = join(runRoot, "intent.json");
  const resultPath = join(runRoot, "result.json");
  const handoffPath = join(runRoot, "handoff.json");
  const gitBeforePath = join(runRoot, "git-before.json");
  const gitAfterPath = join(runRoot, "git-after.json");

  const emptyCancel: CancelReportV1 = { timedOut: false, stages: [] };
  const emptyParsed: HandoffParseV1 = { ok: false, handoff: null, problems: ["no handoff text"] };
  // Validity is checked on the raw field. Everything else in this function
  // uses the single resolved `role` below.
  const roleIsEnumerated = request.role === undefined || isExecutorRole(request.role);
  const role: ExecutorRoleV1 = roleIsEnumerated ? (request.role ?? "IMPLEMENT") : "IMPLEMENT";
  const argvGrantedWrite = argvGrantsWritePermission(request.argv);
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
    processWasCreated: false,
    ...(role !== undefined ? { role } : {}),
    argvGrantedWrite,
  });

  const leaseStore = deps.leases ?? createNodeLeaseStore(sandboxDirectorStoreRoot());

  const finish = (
    partial: Omit<RunResultV1, "schema" | "resultPath" | "runId" | "gitBefore"> & {
      readonly gitBefore?: GitObservationV1 | null;
    },
  ): RunResultV1 => {
    const drafted: RunResultV1 = {
      ...partial,
      schema: RUN_RESULT_SCHEMA_V1,
      resultPath,
      runId: request.runId,
      gitBefore: partial.gitBefore ?? null,
    };
    const write = writeResultIfPermitted(deps.fs, runRoot, resultPath, drafted, partial.spawned === true);
    const indexOk = partial.spawned !== true
      || recordIndexedRunCompletion(deps.fs, leaseStore, request.runId, runRoot);
    if (write === "failed" || !indexOk) {
      return { ...drafted, resultPath: write === "failed" ? null : drafted.resultPath, resultPersisted: "failed" };
    }
    if (write === "skipped") {
      return { ...drafted, resultPath: null, resultPersisted: "skipped" };
    }
    return { ...drafted, resultPersisted: "written" };
  };

  let heldLease: LeaseV1 | null = null;
  let releasedLeaseId: string | null = null;
  let adoptedExistingHolder = false;
  let capacityHeld = false;
  let stillRunning = false;
  let spawnOccurred = false;
  let spawnedChild: SpawnHandleV1 | null = null;
  let boundedLog: BoundedLogV1 | null = null;
  let cancelStages: CancelStageV1[] = [];
  let timedOut = false;
  let processIdentity: ExecutorProcessIdentityV1 | null = null;
  let spawnedAtFloor: string | null = null;
  let holderExitedAt: string | null = null;
  let gitBefore: GitObservationV1 | null = null;
  let orphanScan: WriterOrphanScanV1 = { performed: false, sightings: [], liveSightings: [], undecidable: [] };
  let exitProof: WriterExitProofV1 | null = null;
  let captureTimeIdentityNotFound = false;
  const seenInTreePids = new Set<number>();
  const seenInTreeIdentities = new Map<number, string>();

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
      ...(role !== undefined && isExecutorRole(role) ? { role } : {}),
      argvGrantedWrite,
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
    if (!roleIsEnumerated) {
      return finish({
        ok: false,
        spawned: false,
        reason: "role is not an enumerated executor role",
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

    const cwdPlace = canonicalizeHostPath(request.cwd);
    const worktreePlace = canonicalizeHostPath(request.worktree);
    // Every Git conjunct observes the directory the child was given.
    // Binding this for one kind and not the others left the boundary open.
    if (cwdPlace === "" || worktreePlace === "" || worktreePlace !== cwdPlace) {
      return finish({
        ok: false,
        spawned: false,
        reason: request.lease.kind === "WORKTREE"
          ? "WORKTREE worktree is not the directory the child will run in"
          : "worktree is not the directory the child will run in",
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
    if (request.lease.kind === "WORKTREE") {
      const leasePlace = canonicalResource("WORKTREE", request.lease.resource);
      if (leasePlace === "" || leasePlace !== cwdPlace) {
        return finish({
          ok: false,
          spawned: false,
          reason: "WORKTREE lease resource is not the directory the child will run in",
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
    }

    // Directory occupancy is the directory, not the kind string this
    // run declared. Check before argv/adapter so a PREVIEW label cannot
    // walk past a live WORKTREE holder.
    try {
      const listedEarly = leaseStore.list();
      const occupiedEarly = foreignWorktreeOccupiesDirectory({
        existing: listedEarly,
        cwd: request.cwd,
        runId: request.runId,
        now: deps.clock.now(),
      });
      if (occupiedEarly !== undefined) {
        return finish({
          ok: false,
          spawned: false,
          reason: "lease refused: another run holds this directory",
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
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `lease store unreadable: ${errorMessage(error)}`,
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

    if (LOCAL_ROLES.has(role)) {
      return finish({
        ok: false,
        spawned: false,
        reason: `role ${role} is a local role and is not launched through an executor`,
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
    if (routeRole(role) !== request.executor) {
      return finish({
        ok: false,
        spawned: false,
        reason: `role ${role} is routed to ${routeRole(role)}, not ${request.executor}`,
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

    let handoffAlreadyPresent = false;
    try {
      handoffAlreadyPresent = deps.fs.isFile(handoffPath);
    } catch {
      return finish({
        ok: false,
        spawned: false,
        reason: "handoff path could not be stat'd before spawn; UNKNOWN is not absence",
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
    if (handoffAlreadyPresent) {
      return finish({
        ok: false,
        spawned: false,
        reason: "handoff.json already exists at the path the child is told to write; refusing to spawn over a pre-existing report",
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

    const launchPath = launchPathMatchesDiscoveredAdapter(request, deps, runNonce, role);
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
    if (NON_WRITING_ROLES.has(role) && argvGrantedWrite) {
      return finish({
        ok: false,
        spawned: false,
        reason: "role and argv disagree about write permission",
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
    const indexed = existingIndexedRunCompletion(deps.fs, leaseStore, request.runId, runRoot);
    if (indexed === "spawned") {
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
    if (indexed === "unreadable") {
      return finish({
        ok: false,
        spawned: false,
        reason: "an existing run-id completion record is unreadable; refusing to overwrite it",
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
    let listedLeases: readonly LeaseV1[];
    try {
      listedLeases = leaseStore.list();
    } catch (error) {
      return finish({
        ok: false,
        spawned: false,
        reason: `lease store unreadable: ${errorMessage(error)}`,
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
    const occupiedByForeignWorktree = foreignWorktreeOccupiesDirectory({
      existing: listedLeases,
      cwd: request.cwd,
      runId: request.runId,
      now: deps.clock.now(),
    });
    if (occupiedByForeignWorktree !== undefined) {
      return finish({
        ok: false,
        spawned: false,
        reason: "lease refused: another run holds this directory",
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
    const sameRunHeld = listedLeases.find((item) =>
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
        const reclaimed = await reclaimExpiredHolder({
          store: leaseStore,
          kind: request.lease.kind,
          resource: request.lease.resource,
          heldBy: leaseAttempt.heldBy,
          probe: deps.probe,
          now: deps.clock.now(),
          scanOrphans: deps.scanOrphans,
          wait: deps.wait,
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
        } else if (reclaimed.reason !== undefined) {
          leaseAttempt = { ...leaseAttempt, reason: reclaimed.reason };
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

    if (intentState !== "none" || adoptedExistingHolder) {
      const prior = intentState !== "none"
        ? readRunIntent(intentPath, intentStoreFromFs(deps.fs))
        : { ok: false as const, intent: null };
      const intentIdentity = prior.ok ? prior.intent.processIdentity : null;
      exitProof = await proveAdoptedWriterExit({
        lease: heldLease,
        probe: deps.probe,
        scanOrphans: deps.scanOrphans,
        runNonce,
        intentIdentity,
        observedPids: seenInTreePids,
        wait: deps.wait,
        clock: deps.clock,
      });
      releaseHeld();
      const adoptedWriterFact = writerReleaseEvidence(exitProof)
        && releasedLeaseId === heldLease.leaseId
        && heldLease.kind === "PRODUCTION_WRITER";
      const why = adoptedExistingHolder
        ? "a lease row for this run already records a holder; refusing to overwrite it"
        : intentState === "spawned"
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
    if (!gitObservationNamesGivenWorktree(gitBefore, request.worktree)) {
      return finish({
        ok: false,
        spawned: false,
        reason: "Git observation does not name the directory the child will run in; a record that names nowhere is not a record",
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

    const collectIgnoredDelta = isExecutorRole(role) && NON_WRITING_ROLES.has(role) && !argvGrantedWrite;
    let treeIncludingIgnoredBefore: GitStatusObservationV1 | null = null;
    if (collectIgnoredDelta) {
      try {
        treeIncludingIgnoredBefore = collectGitStatusIncludingIgnored(deps.git);
      } catch {
        treeIncludingIgnoredBefore = {
          outcome: "UNAVAILABLE",
          reason: "ignored-inclusive status threw before spawn",
          command: { argv: ["status", "--porcelain", "--ignored"], status: null, stdout: "", stderr: "", error: "threw" },
        };
      }
    }

    // 3. Persist the intent. The only value that permits a spawn is returned after write-and-read-back.
    // Build the child environment once. childEnvKeys is derived from this
    // object — the durable record of what the child is actually handed.
    const childEnv = deliveredChildEnv(request.childEnv, runNonce);
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
      role,
      childEnvKeys: Object.freeze(Object.keys(childEnv).sort()),
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
          const promptStdin = readClaudePromptStdin(request, deps.fs);
          return deps.spawn(
            request.executablePath,
            request.argv,
            {
              cwd: request.cwd,
              env: childEnv,
              shell: false,
              windowsHide: true,
              ...(promptStdin !== undefined ? { stdin: promptStdin } : {}),
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
      spawnedChild = child;
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

    // Attach the pump before the event loop can turn. captureProcessIdentity
    // is a blocking CIM call; if the child exits inside it, Node's
    // flushStdio resumes un-listened streams and drops the bytes. pause()
    // does not help — flushStdio resumes unconditionally.
    const sinks = deps.logSinks ?? { stdout: createMemoryLogSink(), stderr: createMemoryLogSink() };
    const log = createBoundedLog({ clock: deps.clock, sinks });
    boundedLog = log;
    let sinkFailed = false;
    let haltRequested = false;
    let resolveHalt: (() => void) | null = null;
    const haltSignal = new Promise<void>((resolve) => {
      resolveHalt = resolve;
    });
    const writeAndWatch = (stream: "stdout" | "stderr") => (chunk: Uint8Array): void => {
      try {
        const written = log.write(stream, chunk);
        if (written.mustHalt && !haltRequested) {
          haltRequested = true;
          resolveHalt?.();
        }
      } catch {
        sinkFailed = true;
      }
    };
    let stdoutDrainAborted = false;
    let stderrDrainAborted = false;
    const stdoutDone = pumpStream(child.stdout, writeAndWatch("stdout"), () => {
      stdoutDrainAborted = true;
    }).catch(() => undefined);
    const stderrDone = pumpStream(child.stderr, writeAndWatch("stderr"), () => {
      stderrDrainAborted = true;
    }).catch(() => undefined);

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
      const attemptCeiling = holderExitedAt ?? deps.clock.now();
      try {
        const cancelled = await cancelLadder(
          child,
          deps,
          processIdentity,
          runNonce,
          cancelStages,
          spawnedAtFloor ?? deps.clock.now(),
          attemptCeiling,
          seenInTreePids,
          seenInTreeIdentities,
        );
        stillRunning = cancelled.stillRunning;
        if (!cancelled.stillRunning) holderExitedAt = deps.clock.now();
      } catch {
        stillRunning = true;
      }
      orphanScan = await collectWriterOrphans({
        scanOrphans: deps.scanOrphans,
        recorded: null,
        runNonce,
        holderPid: childPid,
        createdNotBefore: spawnedAtFloor ?? "",
        observedPids: seenInTreePids,
        observedPidIdentities: seenInTreeIdentities,
        wait: deps.wait,
        holderExitedAt: attemptCeiling,
      });
      const streamsSettledAttempt = await settleStreams(stdoutDone, stderrDone, deps.wait);
      markLogDrain(log, {
        settled: streamsSettledAttempt,
        sinkFailed,
        stdoutAborted: stdoutDrainAborted,
        stderrAborted: stderrDrainAborted,
      });
      log.flush();
      const reason = !stillRunning
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
        log: { ...log.report(), sinkFailed: sinkFailed || log.report().sinkFailed },
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
      && captured.observation.outcome === "NOT_FOUND"
      && observationIsAboutPid(captured.observation, childPid);
    processIdentity = captured.ok ? captured.identity : null;
    if (captured.reason === "the occupant of this pid carries another run's nonce") {
      const withoutIdentity: LeaseV1 = { ...heldLease, pid: childPid };
      delete (withoutIdentity as { processIdentity?: unknown }).processIdentity;
      leaseStore.save([
        ...leaseStore.list().filter((item) => !leaseIdentityEquals(item, withoutIdentity)),
        withoutIdentity,
      ]);
      heldLease = withoutIdentity;
    } else if (processIdentity !== null) {
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
      // Capture failed. Do not stamp the occupant's startedAt plus our
      // nonce — that is a durable record of a holder that was never
      // identified. Pid + run token is the crash-window shape.
      heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, {
        pid: childPid,
        runNonce,
      }, runNonce);
    } else {
      heldLease = persistLeaseHolder(leaseStore, heldLease, childPid, { pid: childPid, runNonce }, runNonce);
    }

    // 6. Timeout / cancel ladder. mustHalt resolves the race immediately.
    let exitCode: number | null = null;
    let exitSignal: string | null = null;

    const exitWon = child.exited;
    if (exitWon) {
      // The child has already settled. Stamp the exit ceiling before the
      // ancestry sample so a post-exit occupant of this pid slot and its
      // children are not copied into observedPids.
      if (holderExitedAt === null) holderExitedAt = deps.clock.now();
      if (deps.sampleAncestry !== undefined || deps.scanOrphans === undefined) {
        try {
          const rows = resolveAncestrySampler(deps)({ holderPid: childPid });
          rememberSampledDescendantPids(seenInTreePids, childPid, rows, {
            ...(spawnedAtFloor !== null ? { createdNotBefore: spawnedAtFloor } : {}),
            ...(holderExitedAt !== null ? { holderExitedAt } : {}),
          }, seenInTreeIdentities);
        } catch {
          // A failed sample is not a scan.
        }
      }
      const ended = await child.exit;
      exitCode = ended.code;
      exitSignal = ended.signal;
    } else {
      // First sample is synchronous so a short-lived launcher can still
      // land in observedPids before the exit race. Failures are ignored.
      // Tests that inject scanOrphans get a no-op sampler; do not start
      // the wait loop or a hanging mock child keeps the process alive
      // for ANCESTRY_SAMPLE_MAX_PER_RUN intervals after the run ends.
      if (deps.sampleAncestry !== undefined || deps.scanOrphans === undefined) {
        void sampleAncestryWhileChildAlive({
          child,
          holderPid: childPid,
          observedPids: seenInTreePids,
          observedPidIdentities: seenInTreeIdentities,
          wait: deps.wait,
          sampleAncestry: resolveAncestrySampler(deps),
          clock: deps.clock,
          createdNotBefore: spawnedAtFloor,
          holderCreationDate: processIdentity?.creationDate ?? null,
          holderExitedAt,
          holderAlreadyGone: captureTimeIdentityNotFound,
        });
      }
      const raced = await Promise.race([
        raceExit(child, request.timeoutMs, deps.wait, () => {
          if (heldLease === null) return;
          const renewed = heartbeat(heldLease, deps.clock.now());
          heldLease = persistLeaseHolder(leaseStore, renewed, renewed.pid, null, runNonce, renewed);
        }, deps.clock),
        haltSignal.then(() => ({ tag: "halt" as const })),
      ]);
      if (raced.tag === "exit") {
        exitCode = raced.exit.code;
        exitSignal = raced.exit.signal;
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
          seenInTreeIdentities,
        );
        stillRunning = cancelled.stillRunning;
        exitCode = cancelled.exitCode;
        if (cancelled.exitSignal !== undefined) exitSignal = cancelled.exitSignal;
        if (child.exited && holderExitedAt === null) holderExitedAt = deps.clock.now();
      }
    }

    const streamsSettledEarly = await settleStreams(stdoutDone, stderrDone, deps.wait);
    markLogDrain(log, {
      settled: streamsSettledEarly,
      sinkFailed: sinkFailed || log.report().sinkFailed,
      stdoutAborted: stdoutDrainAborted,
      stderrAborted: stderrDrainAborted,
    });
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
        seenInTreeIdentities,
      );
      stillRunning = cancelled.stillRunning;
      if (cancelled.exitCode !== null) exitCode = cancelled.exitCode;
      if (cancelled.exitSignal !== undefined) exitSignal = cancelled.exitSignal;
      if (child.exited && holderExitedAt === null) holderExitedAt = deps.clock.now();
    }

    const logReport = { ...log.report(), sinkFailed: sinkFailed || log.report().sinkFailed };
    const output = `${log.liveTail("stdout").toString("utf8")}\n${log.liveTail("stderr").toString("utf8")}`;

    // Nonce sweep on every exit path, not only timeout / mustHalt.
    if (child.exited && holderExitedAt === null) holderExitedAt = deps.clock.now();
    // Sound ceiling: known exit, or now if the holder has not been observed
    // to exit. Omitting it would treat in-window rows as "not ours".
    const sweepCeiling = holderExitedAt ?? deps.clock.now();
    let leftoverSweep: LeftoverSweepV1 = { confirmed: false, remaining: [], killed: false };
    try {
      leftoverSweep = killNonceBearingLeftovers({
        scanOrphans: deps.scanOrphans,
        killTree: deps.killTree,
        childPid,
        recorded: processIdentity,
        runNonce,
        holderPid: processIdentity?.pid ?? childPid,
        createdNotBefore: spawnedAtFloor ?? "",
        observedPids: seenInTreePids,
        observedPidIdentities: seenInTreeIdentities,
        holderExitedAt: sweepCeiling,
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
    const reportedWorkItemId = handoff !== null && handoff.workItemId !== undefined
      ? handoff.workItemId
      : null;

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
    orphanScan = await collectWriterOrphans({
      scanOrphans: deps.scanOrphans,
      recorded: processIdentity,
      runNonce,
      holderPid: processIdentity?.pid ?? childPid,
      createdNotBefore: spawnedAtFloor ?? "",
      observedPids: seenInTreePids,
      observedPidIdentities: seenInTreeIdentities,
      wait: deps.wait,
      // Same sound ceiling as the leftover sweep. The live path must
      // answer "is this row ours?" identically to the adopted path.
      holderExitedAt: sweepCeiling,
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

    const isReviewRole = isExecutorRole(role) && NON_WRITING_ROLES.has(role);
    const treeIncludingIgnored: GitStatusObservationV1 | null = isReviewRole && !argvGrantedWrite
      ? collectGitStatusIncludingIgnored(deps.git)
      : null;

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
      logStayedWithinBudget: logReport.mustHalt !== true && !logReport.sinkFailed && logReport.drainComplete === true,
      role,
      argvGrantedWrite,
      spawnedAtFloor,
      expectedRunNonce: runNonce,
      observedCompletedAt: holderExitedAt ?? deps.clock.now(),
      expectedWorktree: request.worktree,
      exitSignal,
      ...(treeIncludingIgnored !== undefined ? { treeIncludingIgnored } : {}),
      ...(treeIncludingIgnoredBefore !== undefined ? { treeIncludingIgnoredBefore } : {}),
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
      runNonce,
      createdNotBefore: spawnedAtFloor ?? "",
      ...(holderExitedAt !== null ? { holderExitedAt } : {}),
      observedPids: seenInTreePids,
      ...(orphanScan.directorSessionId !== undefined ? { directorSessionId: orphanScan.directorSessionId } : {}),
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
    if (spawnOccurred && spawnedChild !== null) {
      try {
        const cancelled = await cancelLadder(
          spawnedChild,
          deps,
          processIdentity,
          request.runNonce,
          cancelStages,
          spawnedAtFloor ?? deps.clock.now(),
          holderExitedAt,
          seenInTreePids,
          seenInTreeIdentities,
        );
        stillRunning = cancelled.stillRunning;
      } catch {
        stillRunning = true;
      }
    }
    return finish({
      ok: false,
      spawned: spawnOccurred,
      reason: `run failed: ${errorMessage(error)}`,
      conjunction: spawnOccurred ? interruptedAfterSpawn(timedOut) : emptyConjunction,
      exitCode: spawnedChild !== null && spawnedChild.exited ? (await spawnedChild.exit).code : null,
      processIdentity,
      intent: null,
      handoff: null,
      gitAfter: null,
      lease: heldLease,
      productionWriterLeaseReleasedByThisRun: false,
      cancel: { timedOut, stages: cancelStages },
      log: boundedLog === null ? null : boundedLog.report(),
    });
  } finally {
    releaseHeld();
    releaseChildStreams(spawnedChild, boundedLog);
  }
}

function releaseChildStreams(child: SpawnHandleV1 | null, log: BoundedLogV1 | null): void {
  for (const stream of [child?.stdout, child?.stderr]) {
    if (stream == null) continue;
    try {
      if (!stream.destroyed) stream.destroy();
    } catch {
      // Destroy errors must not escape executeRun.
    }
  }
  try {
    log?.seal();
  } catch {
    // Seal errors must not escape executeRun.
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
  const rawStartedAt = identity !== null && identity.creationDate !== undefined && identity.creationDate !== ""
    ? identity.creationDate
    : base.processIdentity?.startedAt;
  const startedAt = rawStartedAt === undefined ? undefined : (normalisedCreationDate(rawStartedAt) ?? undefined);
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
 * chain remains. A parentless (absent-parent) row born after the spawn
 * floor makes the scan UNAVAILABLE: an absent parent is no explanation,
 * so the holder-exit ceiling does not bound the child's birth. A row
 * whose parent is still in the snapshot and proven created at or before
 * the row, and is not in this run's chain, is host noise. Broker-host
 * re-parents stay tied through the broker predicate. The recorded holder
 * is DEAD_CONFIRMED or the owned handle settled after a capture-time
 * NOT_FOUND.
 *
 * An unplaceable floor makes the scan UNAVAILABLE rather than falling back
 * to a narrower emit predicate.
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
    const undecidable = input.orphanScan.undecidable;
    if (undecidable.length > 0) {
      const named = undecidable
        .map((row) => `pid ${row.pid}${row.name !== undefined ? ` (${row.name})` : ""}`)
        .join(", ");
      return {
        ok: false,
        reason: `membership undecidable for ${named}; the process-tree scan was not performed`,
      };
    }
    return { ok: false, reason: "the process-tree scan was not performed" };
  }
  if (input.orphanScan.liveSightings.length > 0) {
    return {
      ok: false,
      reason: `live process-tree sightings remain: ${input.orphanScan.liveSightings.map((item) => item.pid).join(", ")}`,
    };
  }
  // leftoverConfirmed is a reporting conjunct, not a release conjunct.
  // We are already on a completed SCANNED snapshot with zero live
  // sightings — that is the release fact. A leftover-sweep re-scan
  // throw must not un-mint it. leftoverRemaining still names leftovers
  // a successful sweep actually saw.
  if (input.leftoverRemaining.length > 0) {
    return {
      ok: false,
      reason: `leftover processes remain after kill: ${input.leftoverRemaining.map((item) => item.pid).join(", ")}`,
    };
  }
  return { ok: true, reason: EXECUTOR_TREE_GONE_REASON };
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
): "written" | "skipped" | "failed" {
  let existing = false;
  try {
    existing = fs.isFile(resultPath);
  } catch {
    // Unreadable presence is not absence. Do not invent a first write over a
    // record we could not stat, unless this run already spawned (the result
    // must be persisted).
    if (!spawned) return "skipped";
    existing = false;
  }
  if (existing && !spawned) {
    if (!mayPromoteRecoverRecord(fs, resultPath, result)) return "skipped";
  }
  try {
    fs.mkdirp(runRoot);
    fs.writeDurable(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    return "written";
  } catch {
    // Bytes did not land. Callers must not label resultPath as if they did.
    return "failed";
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
    return { outcome: "UNAVAILABLE", reason: "probe threw", pid: recorded.pid };
  }
}

function resolveOrphanScanner(
  scanOrphans: RunManagerDepsV1["scanOrphans"],
): NonNullable<RunManagerDepsV1["scanOrphans"]> {
  return scanOrphans ?? createWindowsOrphanScanner();
}

function resolveAncestrySampler(
  deps: Pick<RunManagerDepsV1, "sampleAncestry" | "scanOrphans">,
): NonNullable<RunManagerDepsV1["sampleAncestry"]> {
  if (deps.sampleAncestry !== undefined) return deps.sampleAncestry;
  // Tests that inject scanOrphans are not on the production host. A no-op
  // wait plus a hanging child would otherwise launch hundreds of CIM listings.
  if (deps.scanOrphans !== undefined) return () => [];
  return createWindowsAncestrySampler();
}

/**
 * Ancestry-only samples while the spawned child is alive. Never kills,
 * never mints a proof, never marks a scan UNAVAILABLE. A failed sample
 * is ignored.
 *
 * Limit: an intermediate that is born and dies entirely between two
 * samples is missed. That is the Job Object Owner decision, not a
 * predicate this loop can close.
 */
async function sampleAncestryWhileChildAlive(input: {
  readonly child: SpawnHandleV1;
  readonly holderPid: number;
  readonly observedPids: Set<number>;
  readonly observedPidIdentities: Map<number, string>;
  readonly wait: (ms: number) => Promise<void>;
  readonly sampleAncestry: NonNullable<RunManagerDepsV1["sampleAncestry"]>;
  readonly clock: ClockV1;
  readonly createdNotBefore: string | null;
  readonly holderCreationDate?: string | null;
  readonly holderExitedAt?: string | null;
  readonly holderAlreadyGone?: boolean;
}): Promise<void> {
  let samples = 0;
  while (!input.child.exited && samples < ANCESTRY_SAMPLE_MAX_PER_RUN) {
    try {
      const rows = input.sampleAncestry({ holderPid: input.holderPid });
      const holderRow = rows.find((row) => row.pid === input.holderPid);
      const recordedHolderDate = typeof input.holderCreationDate === "string"
        ? input.holderCreationDate
        : null;
      const holderRecycled = holderRow !== undefined
        && recordedHolderDate !== null
        && occupantIsProvenDifferentProcess(
          { pid: input.holderPid, creationDate: recordedHolderDate },
          holderRow,
        );
      // A holder row without a recorded creationDate is a slot number, not
      // identity. Capture UNAVAILABLE / FOUND-without-date must not treat a
      // later occupant as the original process (R30 persist F1).
      const holderConfirmablyPresent = holderRow !== undefined
        && recordedHolderDate !== null
        && !holderRecycled;
      // Capture is a blocking CIM probe: child.exited can stay false after
      // the OS process is gone. Do not copy a post-exit recycled tree into
      // observedPids just because the handle has not settled (R29 persist F1).
      const holderGone = input.holderAlreadyGone === true
        || input.child.exited
        || !holderConfirmablyPresent;
      if (isUsablePid(input.holderPid)) input.observedPids.add(input.holderPid);
      if (!holderGone) {
        rememberSampledDescendantPids(input.observedPids, input.holderPid, rows, {
          ...(input.createdNotBefore !== null ? { createdNotBefore: input.createdNotBefore } : {}),
          ...(input.holderExitedAt !== null && input.holderExitedAt !== undefined
            ? { holderExitedAt: input.holderExitedAt }
            : {}),
        }, input.observedPidIdentities);
      }
    } catch {
      // A failed sample is not a scan. Do not treat it as "no descendants".
    }
    samples += 1;
    if (input.child.exited) break;
    try {
      await input.wait(ANCESTRY_SAMPLE_INTERVAL_MS);
    } catch {
      // A rejecting wait must not become a scan or stop the run.
    }
  }
}

function sightingsAsOrphans(
  rows: readonly { readonly pid?: number; readonly name?: string | null; readonly parentPid?: number; readonly parentPresent?: boolean; readonly parentName?: string | null; readonly runNonce?: string | null; readonly creationDate?: string; readonly nonceReadable?: boolean }[],
): OrphanSightingV1[] {
  const out: OrphanSightingV1[] = [];
  for (const row of rows) {
    if (!isUsablePid(row.pid)) continue;
    out.push({
      pid: row.pid,
      ...(row.name !== undefined && row.name !== null ? { name: row.name } : {}),
      ...(row.parentPid !== undefined ? { parentPid: row.parentPid } : {}),
      ...(row.parentPresent !== undefined ? { parentPresent: row.parentPresent } : {}),
      ...(row.parentName !== undefined && row.parentName !== null ? { parentName: row.parentName } : {}),
      ...(row.runNonce !== undefined && row.runNonce !== null ? { runNonce: row.runNonce } : {}),
      ...(row.creationDate !== undefined ? { creationDate: row.creationDate } : {}),
      ...(row.nonceReadable !== undefined ? { nonceReadable: row.nonceReadable } : {}),
    });
  }
  return out;
}

/** Resolves when `wait` does, or after `ms`, whichever is first. A hung wait cannot stall the run. */
function waitWithCeiling(wait: (ms: number) => Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void Promise.resolve(wait(ms)).then(() => {
      clearTimeout(timer);
      resolve();
    }, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Copy scan rows without `[...array]`, which honors a lying `length` and
 * drops indexed leftovers (R30 wiring F4). Functions and unexpected
 * callables are not empty evidence.
 */
function materializeIndexedScanRows<T extends object>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "function") {
    throw new Error("orphan scan snapshot is not a usable array");
  }
  if (typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const out: T[] = [];
  const seen = new Set<number>();
  const take = (index: number): void => {
    if (seen.has(index)) return;
    let item: unknown;
    try {
      item = rec[index];
    } catch {
      throw new Error("orphan scan snapshot is unreadable");
    }
    if (item === undefined || item === null || typeof item !== "object") return;
    seen.add(index);
    out.push(item as T);
  };
  let names: string[] = [];
  try {
    names = Object.getOwnPropertyNames(rec);
  } catch {
    throw new Error("orphan scan snapshot is unreadable");
  }
  for (const key of names) {
    if (/^\d+$/.test(key)) take(Number(key));
  }
  let reported = 0;
  try {
    const length = rec.length;
    if (typeof length === "number" && Number.isFinite(length) && length > 0) {
      reported = Math.min(Math.floor(length), 64);
    }
  } catch {
    reported = 0;
  }
  const maxProbe = Math.max(reported, 8);
  for (let index = 0; index < maxProbe; index += 1) {
    try {
      if (index in rec) take(index);
    } catch {
      throw new Error("orphan scan snapshot is unreadable");
    }
  }
  return out;
}

async function collectWriterOrphans(input: {
  readonly scanOrphans: RunManagerDepsV1["scanOrphans"];
  readonly recorded: ExecutorProcessIdentityV1 | null;
  readonly runNonce: string;
  readonly holderPid?: number;
  readonly createdNotBefore: string;
  readonly holderExitedAt?: string;
  readonly observedPids?: Set<number>;
  readonly observedPidIdentities?: Map<number, string>;
  readonly wait?: (ms: number) => Promise<void>;
}): Promise<WriterOrphanScanV1> {
  try {
    const createdNotBefore = input.createdNotBefore;
    const holderPid = input.holderPid ?? input.recorded?.pid;
    const holderExitedAt = input.holderExitedAt;
    const observedPids = input.observedPids ?? new Set<number>();
    if (isUsablePid(holderPid)) observedPids.add(holderPid);
    const query = {
      runNonce: input.runNonce,
      createdNotBefore,
      ...(holderPid !== undefined ? { holderPid } : {}),
      ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
      observedPids: [...observedPids],
      apparatusPids: [...measurementApparatusIdentitiesOfThisProcess()],
    };
    const scanOnce = (): WriterOrphanScanResultV1 => {
      const scanned = resolveOrphanScanner(input.scanOrphans)(query);
      return writerOrphanScanResult(
        materializeIndexedScanRows(scanned.snapshot),
        materializeIndexedScanRows(scanned.killable),
        scanned.directorSessionId !== undefined ? { directorSessionId: scanned.directorSessionId } : undefined,
      );
    };
    const ctxFor = (rows: readonly OrphanSightingV1[], sessionId?: number) => processRowPlausibilityContext({
      runNonce: input.runNonce,
      createdNotBefore,
      ...(isUsablePid(holderPid) ? { holderPid } : {}),
      ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
      ...(sessionId !== undefined ? { directorSessionId: sessionId } : {}),
      observedPids,
      ...(input.observedPidIdentities !== undefined
        ? { observedPidIdentities: [...input.observedPidIdentities.entries()] }
        : {}),
      apparatusPids: measurementApparatusIdentitiesOfThisProcess(),
      rows,
    });
    let scanned = scanOnce();
    let sightings = [...scanned.snapshot];
    let directorSessionId = scanned.directorSessionId;
    let plausibility = ctxFor(sightings, directorSessionId);
    let undecidable = undecidableRowsOf(sightings, plausibility);
    if (undecidable.length > 0) {
      const wait = input.wait ?? (async () => undefined);
      let clean: readonly OrphanSightingV1[] | null = null;
      const confirmSteps = undecidableMembershipConfirmSteps();
      for (let step = 0; step < confirmSteps; step++) {
        await waitWithCeiling(wait, UNDECIDABLE_MEMBERSHIP_CONFIRM_DELAY_MS);
        let next: WriterOrphanScanResultV1;
        try {
          next = scanOnce();
        } catch {
          return {
            performed: false,
            sightings,
            liveSightings: [],
            undecidable: sightingsAsOrphans(undecidable),
          };
        }
        const nextRows = [...next.snapshot];
        if (next.directorSessionId !== undefined) directorSessionId = next.directorSessionId;
        const decision = nextUndecidablePersistenceDecision(undecidable, nextRows, ctxFor(nextRows, directorSessionId));
        if (decision.action === "unavailable") {
          return {
            performed: false,
            sightings: nextRows,
            liveSightings: [],
            undecidable: sightingsAsOrphans(undecidableRowsOf(nextRows, ctxFor(nextRows, directorSessionId))),
            ...(directorSessionId !== undefined ? { directorSessionId } : {}),
          };
        }
        if (decision.action === "scan-clean") {
          clean = nextRows;
          undecidable = [];
          continue;
        }
        clean = null;
        undecidable = decision.undecidable;
        sightings = nextRows;
        plausibility = ctxFor(nextRows, directorSessionId);
      }
      if (clean === null) {
        return {
          performed: false,
          sightings,
          liveSightings: [],
          undecidable: sightingsAsOrphans(undecidable),
          ...(directorSessionId !== undefined ? { directorSessionId } : {}),
        };
      }
      sightings = [...clean];
      plausibility = ctxFor(sightings, directorSessionId);
    }
    rememberInTreePids(
      observedPids,
      sightings,
      input.runNonce,
      holderPid,
      holderExitedAt,
      createdNotBefore,
      input.observedPidIdentities,
    );
    const membershipTree = {
      holderPid: holderPid ?? null,
      rows: sightings,
      createdNotBefore,
      ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
      observedPids,
      ...(input.observedPidIdentities !== undefined
        ? { observedPidIdentities: input.observedPidIdentities }
        : {}),
      ...(directorSessionId !== undefined ? { directorSessionId } : {}),
      apparatusPids: measurementApparatusIdentitiesOfThisProcess(),
    };
    const liveSightings = sightings.filter((sighting) =>
      processRowCouldBelongToThisRun(sighting, plausibility)
      && writerSightingNotProvenAbsent(sighting, input.runNonce, membershipTree),
    );
    return {
      performed: true,
      sightings,
      liveSightings,
      undecidable: [],
      ...(directorSessionId !== undefined ? { directorSessionId } : {}),
    };
  } catch (error) {
    // A throwing CIM/WMI scan is not a completed scan. Escaping executeRun
    // used to release the writer lease from `finally` with no result.json.
    // Persisted undecidable membership carries the blocking rows so
    // describeExecutorTree can name the pid.
    if (error instanceof OrphanScanUnavailableError) {
      return {
        performed: false,
        sightings: sightingsAsOrphans(error.sightings),
        liveSightings: [],
        undecidable: sightingsAsOrphans(error.undecidable),
      };
    }
    return { performed: false, sightings: [], liveSightings: [], undecidable: [] };
  }
}

/**
 * "Not proven absent" for this run. When the caller supplies the same
 * membership context {@link processRowCouldBelongToThisRun} uses
 * (`createdNotBefore` and `observedPids`), this is that function — the
 * two cannot disagree by construction. leftover remaining always
 * supplies that context (same fields as {@link collectWriterOrphans}
 * liveSightings). The incomplete shape (those fields omitted) keeps the
 * older null-nonce / unreadable catch-alls for callers that do not
 * carry a scan context.
 */
export function writerSightingNotProvenAbsent(
  sighting: OrphanSightingV1,
  runNonce: string,
  tree: {
    readonly holderPid: number | null;
    readonly rows: readonly OrphanSightingV1[];
    readonly createdNotBefore?: string;
    readonly holderExitedAt?: string;
    readonly observedPids?: ReadonlySet<number>;
    readonly observedPidIdentities?: ReadonlyMap<number, string>;
    readonly directorSessionId?: number;
    readonly apparatusPids?: Iterable<MeasurementApparatusInputV1>;
  } = {
    holderPid: null,
    rows: [],
  },
): boolean {
  // A missing field that changes the answer is UNKNOWN, not "proven absent".
  // The incomplete shape must fail closed (deny the exit proof), never open.
  if (tree.createdNotBefore === undefined || tree.observedPids === undefined) {
    return true;
  }
  const ctx = processRowPlausibilityContext({
    runNonce,
    createdNotBefore: tree.createdNotBefore,
    ...(tree.holderPid !== null && isUsablePid(tree.holderPid) ? { holderPid: tree.holderPid } : {}),
    ...(tree.holderExitedAt !== undefined ? { holderExitedAt: tree.holderExitedAt } : {}),
    ...(tree.directorSessionId !== undefined ? { directorSessionId: tree.directorSessionId } : {}),
    observedPids: tree.observedPids,
    ...(tree.observedPidIdentities !== undefined
      ? { observedPidIdentities: [...tree.observedPidIdentities.entries()] }
      : {}),
    apparatusPids: tree.apparatusPids ?? measurementApparatusIdentitiesOfThisProcess(),
    rows: tree.rows,
  });
  return processRowCouldBelongToThisRun(sighting, ctx);
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
  readonly holderPid?: number;
  readonly createdNotBefore: string;
  readonly holderExitedAt?: string;
  readonly observedPids?: Set<number>;
  readonly observedPidIdentities?: Map<number, string>;
}): LeftoverSweepV1 {
  const createdNotBefore = input.createdNotBefore;
  const holderPid = input.holderPid ?? input.recorded?.pid ?? null;
  const observedPids = input.observedPids ?? new Set<number>();
  const observedPidIdentities = input.observedPidIdentities ?? new Map<number, string>();
  if (isUsablePid(holderPid)) observedPids.add(holderPid);
  const query = {
    runNonce: input.runNonce,
    createdNotBefore,
    ...(holderPid !== null ? { holderPid } : {}),
    ...(input.holderExitedAt !== undefined ? { holderExitedAt: input.holderExitedAt } : {}),
    observedPids: [...observedPids],
    apparatusPids: [...measurementApparatusIdentitiesOfThisProcess()],
  };
  let scanned: WriterOrphanScanResultV1;
  try {
    scanned = resolveOrphanScanner(input.scanOrphans)(query);
  } catch (error) {
    // UNKNOWN never authorises a kill. Surface the blocking rows so
    // leftoverRemaining can see what the kill list deleted.
    if (error instanceof OrphanScanUnavailableError) {
      return {
        confirmed: false,
        // An incomplete scan is UNKNOWN, not leftover remaining.
        // The later collectWriterOrphans snapshot is the membership fact.
        remaining: [],
        killed: false,
      };
    }
    return { confirmed: false, remaining: [], killed: false };
  }
  const snapshot = materializeIndexedScanRows<OrphanSightingV1>(scanned.snapshot);
  rememberInTreePids(
    observedPids,
    snapshot,
    input.runNonce,
    holderPid ?? undefined,
    input.holderExitedAt,
    createdNotBefore,
    observedPidIdentities,
  );
  const membershipTree = {
    holderPid,
    rows: snapshot,
    createdNotBefore,
    ...(input.holderExitedAt !== undefined ? { holderExitedAt: input.holderExitedAt } : {}),
    observedPids,
    observedPidIdentities,
    apparatusPids: measurementApparatusIdentitiesOfThisProcess(),
  };
  let killed = false;
  const leftoverCtx = processRowPlausibilityContext({
    runNonce: input.runNonce,
    createdNotBefore,
    ...(isUsablePid(holderPid) ? { holderPid } : {}),
    ...(input.holderExitedAt !== undefined ? { holderExitedAt: input.holderExitedAt } : {}),
    observedPids,
    observedPidIdentities: [...observedPidIdentities.entries()],
    apparatusPids: measurementApparatusIdentitiesOfThisProcess(),
    rows: snapshot,
  });
  const chainBounds = {
    createdNotBefore,
    ...(input.holderExitedAt !== undefined ? { holderExitedAt: input.holderExitedAt } : {}),
  };
  const leftovers = snapshot.filter((sighting) => {
    if (!processRowCouldBelongToThisRun(sighting, leftoverCtx)) return false;
    if (nonceMatchesRun(sighting, leftoverCtx.runNonce)) return true;
    if (
      isUsablePid(holderPid)
      && descendantPidsOf(holderPid, snapshot, chainBounds).has(sighting.pid)
      && !descendantPidsOfPositiveIdentity(holderPid, snapshot, chainBounds).has(sighting.pid)
    ) {
      return false;
    }
    if (
      sighting.parentPid !== undefined
      && leftoverCtx.holderPid !== sighting.parentPid
      && leftoverCtx.observedPids.has(sighting.parentPid)
      && !(isUsablePid(holderPid) && descendantPidsOf(holderPid, snapshot, chainBounds).has(sighting.pid))
    ) {
      const walked = leftoverCtx.observedPidIdentities?.get(sighting.parentPid);
      const sameOccupant = walked !== undefined
        && sighting.parentCreationDate !== undefined
        && compareCreationDates(walked, sighting.parentCreationDate) === "SAME";
      if (!sameOccupant) return false;
    }
    return true;
  });
  for (const leftover of leftovers) {
    if (leftover.pid === input.childPid) continue;
    try {
      input.killTree(leftover.pid);
    } catch {
      // A failed kill is not a confirmed stop. The re-scan below is
      // the physical leftover fact.
    }
    killed = true;
  }
  let remaining: readonly OrphanSightingV1[];
  try {
    const after = resolveOrphanScanner(input.scanOrphans)({
      ...query,
      observedPids: [...observedPids],
    });
    // Same question, same rows, same context as liveSightings.
    // "Is this a leftover of this run?" is processRowCouldBelongToThisRun.
    // The incomplete leftover shape (floor / observedPids omitted) is
    // the pre-filtered-kill-list catch-all and must not see the host
    // snapshot. killable is nonceMatch || descendant and is not this
    // filter — UNKNOWN stays visible and never authorises a kill.
    remaining = materializeIndexedScanRows<OrphanSightingV1>(after.snapshot).filter((sighting) => writerSightingNotProvenAbsent(
      sighting,
      input.runNonce,
      {
        holderPid,
        rows: after.snapshot,
        createdNotBefore,
        observedPids,
        ...(input.holderExitedAt !== undefined ? { holderExitedAt: input.holderExitedAt } : {}),
        ...(after.directorSessionId !== undefined ? { directorSessionId: after.directorSessionId } : {}),
        observedPidIdentities,
      },
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
  clock?: ClockV1,
): Promise<{ tag: "exit"; exit: SpawnExitV1 } | { tag: "timeout" }> {
  if (child.exited) return { tag: "exit", exit: await child.exit };
  const chunk = Math.max(1, Math.min(60_000, Math.floor(LEASE_TTL_MS / 2)));
  const startMs = clock === undefined ? null : placeableInstantMs(clock.now());
  let waited = 0;
  while (true) {
    if (child.exited) return { tag: "exit", exit: await child.exit };
    // Slice bound always fires, including when the clock is frozen or unplaceable.
    if (waited >= timeoutMs) break;
    let remaining = timeoutMs - waited;
    // Clock bound still times out a wait that overruns the requested slice.
    if (clock !== undefined && startMs !== null) {
      const nowMs = placeableInstantMs(clock.now());
      if (nowMs !== null) {
        const elapsed = nowMs - startMs;
        if (elapsed >= timeoutMs) break;
        remaining = Math.min(remaining, timeoutMs - elapsed);
      }
    }
    const slice = Math.min(chunk, Math.max(1, remaining));
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
  observedPidIdentities?: Map<number, string>,
): Promise<{ stillRunning: boolean; exitCode: number | null; exitSignal?: string | null }> {
  // HARD first: taskkill /T while the root is still the CIM parent.
  // TerminateProcess of the root first is what creates orphans on Windows.
  if (!stages.includes("HARD")) stages.push("HARD");
  try {
    deps.killTree(child.pid);
  } catch {
    // A failed kill is not a confirmed stop.
  }
  // The owned handle reporting exited is not tree termination.
  await deps.wait(CANCEL_HARD_MS);

  if (!child.exited) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    if (!stages.includes("SOFT")) stages.push("SOFT");
    await deps.wait(CANCEL_SOFT_MS);
  }

  const stillAfterHard = !child.exited;

  // ORPHAN: after cancel, scan by AION_RUN_NONCE and spawn floor; kill leftovers.
  // Always a sound ceiling: known exit, or now if the holder is still
  // running. An absent ceiling is the F2 defect (in-window → "not ours").
  const leftoverCeiling = holderExitedAt ?? deps.clock.now();
  let leftoverSweep: LeftoverSweepV1 = { confirmed: false, remaining: [], killed: false };
  try {
    leftoverSweep = killNonceBearingLeftovers({
      scanOrphans: deps.scanOrphans,
      killTree: deps.killTree,
      childPid: child.pid,
      recorded,
      runNonce,
      holderPid: recorded?.pid ?? child.pid,
      createdNotBefore,
      ...(observedPids !== undefined ? { observedPids } : {}),
      ...(observedPidIdentities !== undefined ? { observedPidIdentities } : {}),
      holderExitedAt: leftoverCeiling,
    });
    if (leftoverSweep.killed && !stages.includes("ORPHAN")) stages.push("ORPHAN");
  } catch {
    leftoverSweep = { confirmed: false, remaining: [], killed: false };
  }

  if (child.exited) {
    const ended = await child.exit;
    return { stillRunning: false, exitCode: ended.code, exitSignal: ended.signal };
  }
  return { stillRunning: stillAfterHard, exitCode: null, exitSignal: null };
}

function pumpStream(
  stream: Readable | null,
  write: (chunk: Uint8Array) => void,
  onAborted?: () => void,
): Promise<void> {
  if (stream === null) return Promise.resolve();
  return new Promise((resolve) => {
    stream.on("data", (chunk: unknown) => {
      // A synchronous throw here is not a promise rejection; the pump
      // `.catch` cannot see it. writeAndWatch and the sink already
      // swallow; this is the last guard so an injected write cannot
      // kill the Director process.
      try {
        write(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)));
      } catch {
        // Lost bytes are a drain failure, not an uncaught exception.
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", () => {
      onAborted?.();
      resolve();
    });
    stream.resume();
  });
}

function markLogDrain(
  log: BoundedLogV1,
  input: {
    readonly settled: boolean;
    readonly sinkFailed: boolean;
    readonly stdoutAborted: boolean;
    readonly stderrAborted: boolean;
  },
): void {
  if (input.stdoutAborted) log.markDrainIncomplete("stdout");
  if (input.stderrAborted) log.markDrainIncomplete("stderr");
  if ((input.settled && !input.sinkFailed) || input.stdoutAborted || input.stderrAborted) return;
  log.markDrainIncomplete("stdout");
  log.markDrainIncomplete("stderr");
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
  // Instant test waits can win the race before an already-ended
  // Readable.from buffer fires `end`. One event-loop turn is enough
  // for that; a grandchild still holding the pipe stays unsettled.
  if (!done) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  return done;
}

function readHandoffText(fs: RunFileSystemV1, handoffPath: string, stdout: string): string | null {
  let present = false;
  try {
    present = fs.isFile(handoffPath);
  } catch {
    // Unreadable presence is not absence. Do not invent a handoff from stdout
    // over a file we could not stat.
    return null;
  }
  if (present) {
    try {
      const text = fs.readUtf8(handoffPath);
      if (text.trim() === "") return null;
      return text;
    } catch {
      // A present unreadable file is UNKNOWN, not a licence to parse stdout.
      return null;
    }
  }
  // Missing durable handoff is not a licence to parse stdout into PASS.
  return null;
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
  const id = lease.processIdentity;
  const rowPid = id?.pid ?? lease.pid;
  const rowToken = normaliseRunNonce(id?.runToken ?? "");
  const rowStartedAt = id?.startedAt !== undefined ? normalisedCreationDate(id.startedAt) : null;
  if (intentIdentity !== null) {
    // Intent under runRoot is testimony. It may corroborate the Director-owned
    // row; it may never replace it. Disagreement on any field the proof or
    // the scan consumes is a refusal of the file, not a substitution.
    if (rowPid !== undefined && rowPid !== null && intentIdentity.pid !== rowPid) return null;
    if (rowToken !== null && intentIdentity.runNonce !== rowToken) return null;
    if (rowStartedAt !== null && intentIdentity.creationDate !== rowStartedAt) return null;
  }
  if (id === undefined || !isUsablePid(id.pid)) return null;
  if (rowToken === null) return null;
  // Same door as processIdentityFrom: an un-normalisable startedAt is
  // missing, not an invented instant. Feb 31 must not mint death.
  const creationDate = normalisedCreationDate(id.startedAt);
  if (creationDate === null) return null;
  return {
    pid: id.pid,
    creationDate,
    runNonce: rowToken,
  };
}

function recordWalkedPidIdentity(
  identities: Map<number, string> | undefined,
  pid: number,
  creationDate: string | undefined,
): void {
  if (identities === undefined || !isUsablePid(pid) || identities.has(pid)) return;
  const date = normalisedCreationDate(creationDate);
  if (date === null) return;
  identities.set(pid, date);
}

function rememberInTreePids(
  seen: Set<number>,
  sightings: readonly OrphanSightingV1[],
  runNonce: string,
  holderPid: number | undefined,
  holderExitedAt?: string,
  createdNotBefore?: string,
  identities?: Map<number, string>,
): void {
  if (isUsablePid(holderPid)) seen.add(holderPid);
  const bounds = {
    ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
    ...(createdNotBefore !== undefined ? { createdNotBefore } : {}),
  };
  const ceilingUsable = holderExitedAtCeilingIsUsable(bounds);
  for (const sighting of sightings) {
    const nonce = normaliseRunNonce(sighting.runNonce);
    if (nonce !== null && nonce === runNonce) {
      seen.add(sighting.pid);
      recordWalkedPidIdentity(identities, sighting.pid, sighting.creationDate);
    }
    if (
      isUsablePid(holderPid)
      && descendantPidsOfPositiveIdentity(holderPid, sightings, bounds).has(sighting.pid)
    ) {
      seen.add(sighting.pid);
      recordWalkedPidIdentity(identities, sighting.pid, sighting.creationDate);
    }
    if (sighting.parentPid !== undefined && seen.has(sighting.parentPid)) {
      const parentIsHolder = isUsablePid(holderPid) && sighting.parentPid === holderPid;
      if (
        parentIsHolder
        && ceilingUsable
        && provenCreatedStrictlyAfter(sighting.creationDate, holderExitedAt)
      ) {
        continue;
      }
      const parentRow = sightings.find((row) => row.pid === sighting.parentPid);
      if (
        parentRow !== undefined
        && provenCreatedStrictlyBefore(sighting.creationDate, parentRow.creationDate)
      ) {
        continue;
      }
      const walkedParent = identities?.get(sighting.parentPid);
      if (
        walkedParent !== undefined
        && occupantIsProvenDifferentProcess(
          { pid: sighting.parentPid, creationDate: walkedParent },
          {
            pid: sighting.parentPid,
            ...(sighting.parentCreationDate !== undefined
              ? { creationDate: sighting.parentCreationDate }
              : {}),
          },
        )
      ) {
        continue;
      }
      seen.add(sighting.pid);
      recordWalkedPidIdentity(identities, sighting.pid, sighting.creationDate);
    }
  }
}

async function proveAdoptedWriterExit(input: {
  readonly lease: LeaseV1;
  readonly probe: HostProcessProbe;
  readonly scanOrphans: RunManagerDepsV1["scanOrphans"];
  readonly runNonce: string;
  readonly intentIdentity: ExecutorProcessIdentityV1 | null;
  readonly observedPids: Set<number>;
  readonly wait?: (ms: number) => Promise<void>;
  readonly clock: ClockV1;
}): Promise<WriterExitProofV1 | null> {
  const identity = recordedIdentityFromHeldLease(input.lease, input.intentIdentity);
  const holderPid = input.lease.pid ?? identity?.pid;
  // One spelling of "this run's nonce". The lease records the token the
  // adopted holder was launched with. The caller may supply a different
  // invocation nonce. Scanning with the invocation nonce while leftovers
  // carry the lease token is a second, drifting predicate: a live process
  // with the recorded token is then "not ours".
  const leaseToken = identity?.runNonce
    ?? normaliseRunNonce(input.lease.processIdentity?.runToken ?? "");
  const callerToken = normaliseRunNonce(input.runNonce);
  if (leaseToken !== null && callerToken !== null && leaseToken !== callerToken) {
    return null;
  }
  const scanNonce = leaseToken ?? callerToken ?? input.runNonce;
  // The scan floor is a Director-owned instant. An executor-written
  // creationDate in intent.json must not move the emit predicate.
  const floor = input.lease.processIdentity?.startedAt !== undefined
    ? (normalisedCreationDate(input.lease.processIdentity.startedAt) ?? input.lease.acquiredAt)
    : input.lease.acquiredAt;
  const probedPid = identity?.pid ?? (isUsablePid(holderPid) ? holderPid : null);
  let observation: ProcessObservationV1 | null = null;
  if (probedPid !== null) {
    try {
      observation = input.probe.observe(probedPid);
    } catch {
      observation = { outcome: "UNAVAILABLE", reason: "probe threw", pid: probedPid };
    }
  }
  // The holder exited at or before this instant (or we just failed to see)
  // it). [floor, now] is the maximally-uncertain but sound window. A
  // missing ceiling would answer the opposite of the live path.
  const holderExitedAt = input.clock.now();
  const orphanScan = await collectWriterOrphans({
    scanOrphans: input.scanOrphans,
    recorded: identity,
    runNonce: scanNonce,
    createdNotBefore: floor,
    observedPids: input.observedPids,
    ...(input.wait !== undefined ? { wait: input.wait } : {}),
    ...(isUsablePid(holderPid) ? { holderPid } : {}),
    holderExitedAt,
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
    runNonce: scanNonce,
    createdNotBefore: floor,
    holderExitedAt,
    observedPids: input.observedPids,
    ...(orphanScan.directorSessionId !== undefined ? { directorSessionId: orphanScan.directorSessionId } : {}),
  });
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function deliveredChildEnv(
  requestEnv: Readonly<Record<string, string>> | undefined,
  runNonce: string,
): Record<string, string> {
  const delivered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") delivered[key] = value;
  }
  if (requestEnv !== undefined) {
    for (const [key, value] of Object.entries(requestEnv)) {
      delivered[key] = value;
    }
  }
  delivered.AION_RUN_NONCE = runNonce;
  return delivered;
}

function readClaudePromptStdin(
  request: ExecuteRunRequestV1,
  fs: RunFileSystemV1,
): string | undefined {
  if (request.executor !== "claude") return undefined;
  const promptPath = request.promptPath;
  if (promptPath === undefined) return undefined;
  try {
    return fs.readUtf8(promptPath);
  } catch {
    try {
      return readFileSync(promptPath, "utf8");
    } catch {
      return undefined;
    }
  }
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
  if (resultRecordsSpawn(parsed)) {
    const recordedRunId = parsed.runId;
    if (typeof recordedRunId === "string" && recordedRunId !== runId) return "unreadable";
    return "spawned";
  }
  if (parsed.spawned === true) {
    const recordedRunId = parsed.runId;
    if (typeof recordedRunId === "string" && recordedRunId !== runId) return "unreadable";
    return "spawned";
  }
  if (parsed.spawned === false) return "unstarted";
  return "unreadable";
}

function resultRecordsSpawn(parsed: Record<string, unknown>): boolean {
  if (parsed.processIdentity !== undefined && parsed.processIdentity !== null) return true;
  const intent = parsed.intent;
  if (!isPlainObject(intent)) return false;
  if (intent.spawnPid !== undefined && intent.spawnPid !== null) return true;
  if (typeof intent.spawnAttemptedAt === "string" && intent.spawnAttemptedAt.trim() !== "") return true;
  if (typeof intent.spawnObservedAt === "string" && intent.spawnObservedAt.trim() !== "") return true;
  if (intent.processIdentity !== undefined && intent.processIdentity !== null) return true;
  return false;
}

const NO_ROOT_COMPLETION_MARKER = ".run-completions-bound";
const noRootStoreCompletionDirs = new WeakMap<object, string>();

function storeHasUsableRoot(leases: LeaseStoreV1 | undefined): boolean {
  if (leases === undefined || !("root" in leases)) return false;
  const root = (leases as { readonly root?: unknown }).root;
  return typeof root === "string" && root.trim() !== "";
}

function directorRootEnvIsSet(): boolean {
  const override = process.env[DIRECTOR_ROOT_ENV];
  return typeof override === "string" && override.trim() !== "";
}

function noRootCompletionMarkerPath(): string | null {
  const fallback = sandboxDirectorStoreRoot();
  if (typeof fallback !== "string" || fallback.trim() === "") return null;
  return join(fallback, NO_ROOT_COMPLETION_MARKER);
}

function runCompletionDir(leases: LeaseStoreV1 | undefined, _runRoot: string): string | null {
  if (storeHasUsableRoot(leases)) {
    const root = (leases as { readonly root?: unknown }).root;
    return join(String(root).trim(), "run-completions");
  }
  const fallback = sandboxDirectorStoreRoot();
  if (typeof fallback !== "string" || fallback.trim() === "") return null;
  if (leases === undefined || directorRootEnvIsSet()) {
    return join(fallback, "run-completions");
  }
  const existing = noRootStoreCompletionDirs.get(leases);
  if (existing !== undefined) return existing;
  const dir = join(fallback, "unowned-store-completions", randomUUID(), "run-completions");
  noRootStoreCompletionDirs.set(leases, dir);
  return dir;
}

function runCompletionPath(dir: string, runId: string): string {
  const token = asUsableToken(runId);
  const name = token === null ? "invalid-run-id" : encodeURIComponent(token);
  return join(dir, `${name}.json`);
}

function existingIndexedRunCompletion(
  fs: RunFileSystemV1,
  leases: LeaseStoreV1 | undefined,
  runId: string,
  runRoot: string,
): "none" | "spawned" | "unreadable" {
  const dir = runCompletionDir(leases, runRoot);
  if (dir === null) return "unreadable";
  let dirPresent = false;
  try {
    dirPresent = fs.isDirectory(dir);
  } catch {
    return "unreadable";
  }
  if (!dirPresent && !storeHasUsableRoot(leases) && directorRootEnvIsSet()) {
    const marker = noRootCompletionMarkerPath();
    if (marker !== null) {
      try {
        if (fs.isFile(marker)) return "unreadable";
      } catch {
        return "unreadable";
      }
    }
  }
  const path = runCompletionPath(dir, runId);
  let present = false;
  try {
    present = fs.isFile(path);
  } catch {
    return "unreadable";
  }
  if (!present) return "none";
  let raw: string;
  try {
    raw = fs.readUtf8(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "none";
    return "unreadable";
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return "unreadable";
    if (parsed.runId === runId && parsed.spawned === true) return "spawned";
    return "unreadable";
  } catch {
    return "unreadable";
  }
}

function recordIndexedRunCompletion(
  fs: RunFileSystemV1,
  leases: LeaseStoreV1 | undefined,
  runId: string,
  runRoot: string,
): boolean {
  const dir = runCompletionDir(leases, runRoot);
  if (dir === null) return false;
  try {
    fs.mkdirp(dir);
    fs.writeDurable(runCompletionPath(dir, runId), `${JSON.stringify({
      runId,
      spawned: true,
      runRoot,
    })}\n`);
    if (!storeHasUsableRoot(leases) && directorRootEnvIsSet()) {
      const marker = noRootCompletionMarkerPath();
      if (marker !== null) fs.writeDurable(marker, "bound\n");
    }
    return true;
  } catch {
    return false;
  }
}

export function createInProcessCapacityGate(limit = 1): CapacityGateV1 {
  const held = new Map<string, number>();
  return {
    tryAcquire(executor: string) {
      const n = held.get(executor) ?? 0;
      if (n >= limit) return { ok: false, reason: "executor capacity exhausted" };
      held.set(executor, n + 1);
      return { ok: true, reason: "capacity-acquired" };
    },
    release(executor: string) {
      const n = held.get(executor) ?? 0;
      if (n <= 1) held.delete(executor);
      else held.set(executor, n - 1);
    },
  };
}

function mayPromoteRecoverRecord(
  fs: RunFileSystemV1,
  resultPath: string,
  incoming: RunResultV1,
): boolean {
  let raw: string;
  try {
    raw = fs.readUtf8(resultPath);
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) return false;
  const prior = parsed.recoverOutcome;
  const next = incoming.recoverOutcome;
  if (prior === "REFUSED_UNKNOWN" && (next === "TERMINAL" || next === "REFUSED_ALIVE" || next === "REFUSED_UNKNOWN")) {
    return true;
  }
  if (prior === "REFUSED_ALIVE" && next === "TERMINAL") {
    return true;
  }
  return false;
}

const HOST_WIDE_TREE_NOT_CLEAR =
  "the previous holder's process tree could not be shown clear; an empty pid slot is not a dead run";

async function reclaimExpiredHolder(input: {
  readonly store: LeaseStoreV1;
  readonly kind: LeaseKindV1;
  readonly resource: string;
  readonly heldBy: {
    readonly pid: number | null;
    readonly processIdentity: ProcessIdentityV1 | null;
  } | null;
  readonly probe: HostProcessProbe;
  readonly now: string;
  readonly scanOrphans: RunManagerDepsV1["scanOrphans"];
  readonly wait?: (ms: number) => Promise<void>;
}): Promise<{ ok: boolean; reason?: string }> {
  const recordedPid = input.heldBy?.pid ?? null;
  if (!isUsablePid(recordedPid)) {
    return { ok: false };
  }

  // For a host-wide kind, "the previous holder's run is gone" is a
  // completed process-tree scan of that run with zero live sightings.
  // The holder pid slot being empty is a correlate, not the fact.
  if (isHostWideLeaseKind(input.kind)) {
    const held = input.store.list().find((lease) => conflicts(lease, {
      kind: input.kind,
      resource: input.resource,
    }));
    if (held !== undefined) {
      const runToken = normaliseRunNonce(held.processIdentity?.runToken ?? "");
      if (runToken === null) {
        return { ok: false, reason: HOST_WIDE_TREE_NOT_CLEAR };
      }
      let scan;
      try {
        scan = await collectWriterOrphans({
          scanOrphans: input.scanOrphans,
          recorded: null,
          runNonce: runToken,
          holderPid: isUsablePid(held.pid) ? held.pid : recordedPid,
          createdNotBefore: held.processIdentity?.startedAt ?? held.acquiredAt,
          holderExitedAt: input.now,
          ...(input.wait !== undefined ? { wait: input.wait } : {}),
        });
      } catch {
        return { ok: false, reason: HOST_WIDE_TREE_NOT_CLEAR };
      }
      if (hostWideTreeEvidenceFromScan(scan) !== "CLEAR") {
        return { ok: false, reason: HOST_WIDE_TREE_NOT_CLEAR };
      }
    }
  }

  let observation: ProcessObservationV1;
  try {
    observation = input.probe.observe(recordedPid);
  } catch {
    observation = { outcome: "UNAVAILABLE", reason: "probe threw", pid: recordedPid };
  }

  const heldIdentity = input.heldBy?.processIdentity;
  const recordedIdentity: ExecutorProcessIdentityV1 = {
    pid: recordedPid,
    creationDate: heldIdentity?.startedAt ?? "",
    runNonce: heldIdentity?.runToken ?? "",
  };
  const liveness = holderLiveness(recordedIdentity, observation);

  const observedIdentity = leaseIdentityFromProbe(observation);
  const result = reclaimStaleLease({
    existing: input.store.list(),
    kind: input.kind,
    resource: input.resource,
    holderLiveness: liveness,
    now: input.now,
    holderObservation: { outcome: observation.outcome, pid: observation.pid },
    ...(observedIdentity !== undefined ? { observedIdentity } : {}),
  });
  if (result.ok) input.store.save(result.remaining);
  return { ok: result.ok };
}

function gitObservationNamesGivenWorktree(
  observation: GitObservationV1 | null | undefined,
  worktree: string,
): boolean {
  if (observation === null || observation === undefined) return false;
  const observed = canonicalizeHostPath(observation.worktreePath);
  const expected = canonicalizeHostPath(worktree);
  return observed !== "" && expected !== "" && observed === expected;
}

/**
 * Build the lease-layer identity from the same probe the rest of the
 * package uses. {@link identityFromObservation} is the strict form
 * (usable pid + placeable start + resolved path + nonce). The lease
 * layer genuinely accepts a weaker pid+startedAt pair, so when the
 * strict form refuses we degrade through
 * {@link leaseIdentityFromPidStartedAt} — and only that far.
 */
function leaseIdentityFromProbe(observation: ProcessObservationV1): ProcessIdentityV1 | undefined {
  const strict = identityFromObservation(observation);
  if (strict !== null) {
    return {
      pid: strict.pid,
      startedAt: strict.creationDate,
      runToken: strict.runNonce,
    };
  }
  return leaseIdentityFromPidStartedAt(observation);
}

/**
 * Deliberate lease-layer degradation of {@link identityFromObservation}.
 * A lease may record pid+startedAt without a nonce or executable path.
 * It still refuses a non-usable pid (`0`, NaN, negative). That is the
 * only weakening. Do not add a third spelling.
 */
function leaseIdentityFromPidStartedAt(observation: ProcessObservationV1): ProcessIdentityV1 | undefined {
  if (observation.outcome !== "FOUND") return undefined;
  if (!isUsablePid(observation.pid)) return undefined;
  const token = normaliseRunNonce(observation.runNonce);
  return {
    pid: observation.pid,
    ...(observation.creationDate !== undefined ? { startedAt: observation.creationDate } : {}),
    ...(token !== null ? { runToken: token } : {}),
  };
}

/** ENOENT/ENOTDIR are absence. Every other stat failure is unreadability. */
export function statErrorMeansAbsent(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

export function createNodeRunFileSystem(): RunFileSystemV1 {
  return {
    isDirectory(absolutePath) {
      try {
        return statSync(absolutePath).isDirectory();
      } catch (error) {
        if (statErrorMeansAbsent(error)) return false;
        throw error;
      }
    },
    isFile(absolutePath) {
      try {
        return statSync(absolutePath).isFile();
      } catch (error) {
        if (statErrorMeansAbsent(error)) return false;
        throw error;
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
    const stdinPayload = options.stdin;
    const child = spawn(executable, argv.slice(), {
      cwd: options.cwd,
      env: { ...options.env },
      windowsHide: true,
      shell: false,
      stdio: [stdinPayload !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    if (stdinPayload !== undefined && child.stdin !== null) {
      // Child closed its input (startup crash, CLAUDE_NOT_LOGGED_IN, early
      // exit). The exit code and conjunction decide; an unhandled 'error'
      // on stdin kills the Director and voids the cancel ladder.
      child.stdin.on("error", () => {});
      child.stdin.end(stdinPayload);
    }
    return wrapChildProcess(child);
  };
}

export function wrapChildProcess(child: ChildProcess): SpawnHandleV1 {
  // Attach before any pump so an early stream error cannot become an
  // unhandled 'error' that exits the Director process.
  if (child.stdout !== null) child.stdout.on("error", () => {});
  if (child.stderr !== null) child.stderr.on("error", () => {});
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
      // Post-spawn 'error' is a failed kill (EPERM), not an exit.
      // Only a process that never started (no pid) settles here.
      if (child.pid === undefined) {
        exited = true;
        resolve({ code: null, signal: null });
      }
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
 * stand-in. It is not a Job Object.
 *
 * The complete closure — not in scope this round; an Owner decision — is a
 * Job Object on the holder: kill-on-close, breakaway denied, membership
 * queried with `JOBOBJECT_BASIC_PROCESS_ID_LIST`. No image name, environment
 * block, or dead intermediate can evade that. Ancestry sampling plus the
 * parentless predicates cannot close the same gap. D2 CHILD_TREE is unmet
 * until containment happens at creation time. Do not treat a green suite as
 * proof that the D2 CHILD_TREE requirement is met in production.
 */
/**
 * Whether a taskkill spawnSync result confirmed the tree stopped.
 * A discarded return value used to treat access-denied as success.
 */
export function taskkillConfirmedStopped(result: {
  readonly status: number | null;
  readonly error?: Error | null;
  readonly stdout?: string | Buffer | null;
  readonly stderr?: string | Buffer | null;
}): boolean {
  if (result.error !== undefined && result.error !== null) return false;
  if (result.status === 0) return true;
  const text = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  // "The process ... not found" is the slot empty — the process is gone.
  return /not found/i.test(text);
}

export function killProcessTreeStandIn(pid: number): void {
  const taskkill = resolveWindowsSystemExecutable("taskkill.exe");
  const result = spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    shell: false,
    timeout: 10_000,
    encoding: "utf8",
  });
  if (!taskkillConfirmedStopped({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error !== undefined && result.error !== null ? { error: result.error } : {}),
  })) {
    const detail = result.error !== undefined && result.error !== null
      ? result.error.message
      : `exit ${String(result.status)}`;
    throw new Error(`taskkill not confirmed stopped: ${detail}`);
  }
}
