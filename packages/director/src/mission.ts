/**
 * What a mission is, and the only ways it may move.
 *
 * The Director exists because a long engineering job outlives any one conversation. Work is handed
 * to an executor, a machine reboots, a session ends, an executor runs out of quota — and the thing
 * that has to survive all of that is not a transcript but a state a later process can read and act
 * on correctly. So a mission is a small durable record with an explicit state, and every change to
 * that state is a named transition in code.
 *
 * ## Why transitions are a table rather than prose
 *
 * The failure this design is built against is an assistant reporting that something succeeded. A
 * model can say "tests passed" whether or not they did; it can say a branch is clean while it is
 * dirty. If mission state could follow prose, every guarantee downstream would rest on the honesty
 * of a sentence. It cannot: `advance()` accepts a state and an event, consults a table, and rejects
 * anything not enumerated. Model output is evidence that a transition *should* be attempted; the
 * transition itself is arithmetic.
 *
 * ## Why so many states
 *
 * Each one exists because a real recovery differs there. `INTERRUPTED` is not `FAILED` — an
 * interrupted run may well have completed its work before the process died, and the correct next
 * move is to look at Git and the artifacts rather than to retry and risk doing it twice.
 * `OWNER_GATE_REQUIRED` is not `BLOCKED` — one is waiting for a person and resumable by an answer,
 * the other needs an engineer. Collapsing them would lose the distinction that tells a restarted
 * Director what to do.
 *
 * ## Why an event is no longer enough on its own
 *
 * A table that only asks "is this move enumerated?" answers a weaker question than the one that
 * matters. `MISSION_COMPLETED` was legal from `VERIFYING`, so a mission could declare itself finished
 * with an owner gate still open and mandatory work untouched; `DEPLOY_STARTED` was legal from
 * `READY_FOR_DEPLOYMENT`, so reaching a state name was the whole of the permission to write
 * production. Naming a state is not the same as having earned it. So the moves whose consequences are
 * irreversible — completing, deploying, declaring integration verified, releasing an owner gate —
 * additionally consult a `MissionContextV1`: a set of facts assembled by the caller from the durable
 * gate records and the work-item board. Anything the caller does not establish counts as not
 * established, because an absent fact is not a satisfied one. The event still says what is being
 * claimed; the context decides whether the claim holds.
 *
 * ## Why an open gate does not stop the mission
 *
 * `OWNER_GATE_REQUIRED` means one or more required gates are unresolved. `WAITING_FOR_OWNER` means
 * that *and* nothing else is runnable. The scheduler in `work-items.ts` already computes readiness
 * per item so that a pending phone test blocks deployment and nothing else; mission state agrees with
 * that computation rather than contradicting it, because an Owner going to sleep must not cost a
 * night of work. Which of the two states holds is therefore derived from the board on every gate
 * event, never asserted by the event itself, and a gate's `resumeState` is classified before it is
 * honoured — an externally supplied string must never select where a mission lands.
 *
 * ## Why both classifications are total, and deny by default
 *
 * Resume targets and interrupted conditions were each decided by a short list of refusals with a
 * fall-through underneath, which meant every state nobody had thought about was pre-approved and
 * "not explicitly forbidden" was quietly doing the work of "allowed". Both are now a
 * `Record<MissionStateV1, ...>` covering the union exactly: a state added to `MISSION_STATES` fails
 * to compile until somebody decides what it is worth, and a value that is not a state at all — a
 * cast, a hand-edited file, an older schema — is refused rather than indexed into.
 *
 * ## Why an interruption remembers what it interrupted
 *
 * An interruption says execution continuity is uncertain. It says nothing about whether a gate was
 * answered, a block cleared, or quota returned. Sending every re-verified interruption to `VERIFYING`
 * turned `MISSION_INTERRUPTED` into a way of laundering a blocker away, so the state held at the
 * moment of the interruption is carried through it and the mission returns to that semantic
 * condition — unless the durable record shows the condition itself has genuinely changed.
 *
 * ## Why an interrupted deployment is never re-verified as if nothing had happened
 *
 * `DEPLOYING` and `POST_DEPLOY_VERIFY` are the two conditions in which production may already have
 * changed. The fall-through sent both to `VERIFYING`, which is a *pre*-deployment state: the mission
 * could then verify, reach `READY_FOR_DEPLOYMENT` again and deploy a second time, having lost the
 * fact that a first write may have landed. The Director dying is not evidence that the deployment
 * failed, so recovery does not retry and does not fail the mission either; it asks the only question
 * that can be answered honestly — what is actually running now — by returning to post-deploy
 * verification, from which `DEPLOY_STARTED` is not a move at all.
 *
 * ## Why a suspension cannot be suspended
 *
 * That rule then has to survive a mission being suspended twice, because `PAUSED` and `INTERRUPTED`
 * hold a condition rather than being one, and there is exactly one slot for what each is holding.
 * Pausing writes the current state over the remembered origin, so pausing an *interrupted* mission
 * overwrote the origin the interruption was carrying, and what was left unwound — resume restores
 * `INTERRUPTED`, recovery preserves the pause, resume finds no origin at all and verifies — into
 * `VERIFYING`, two events from deploying again. Every move in that sequence was legal and no record
 * was forged, which is why it outlived a green suite. So `INTERRUPTED` is neither pausable nor
 * enterable by being named: the origin slot only ever holds a real condition, and an interruption is
 * answered by reading the repository, which is always available from it.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export const MISSION_SCHEMA_V1 = "aion.director.mission.v1" as const;

/**
 * Every mission state, listed once.
 *
 * The union is derived from this list rather than written alongside it. A string that is not a state
 * then cannot be used as one: the transition table previously carried a row keyed on
 * `"POST_DEPLOY_VERIFIED" as MissionStateV1`, which is an event, so the row was unreachable and the
 * cast hid it. Deriving the type from the data makes that cast impossible to write.
 */
export const MISSION_STATES = [
  "CREATED",
  "AUTHORIZED",
  "PLANNING",
  "EXECUTOR_RUNNING",
  "EXECUTOR_RESULT_RECEIVED",
  "VERIFYING",
  "INDEPENDENT_REVIEW",
  "READY_FOR_INTEGRATION",
  "INTEGRATING",
  "OWNER_GATE_REQUIRED",
  "WAITING_FOR_OWNER",
  "WAITING_FOR_CAPACITY",
  "READY_FOR_DEPLOYMENT",
  "DEPLOYING",
  "POST_DEPLOY_VERIFY",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "PAUSED",
  "INTERRUPTED",
] as const;

export type MissionStateV1 = (typeof MISSION_STATES)[number];

/** States from which nothing further happens without a person. */
export const TERMINAL_STATES: readonly MissionStateV1[] = ["COMPLETED", "FAILED"];

/**
 * Every event, listed once.
 *
 * `legalEventsFrom` enumerates this list, so an event missing from it would be silently unreachable
 * rather than merely undocumented.
 */
export const MISSION_EVENT_KINDS = [
  "MISSION_CREATED",
  "MISSION_AUTHORIZED",
  "PLAN_SELECTED",
  "RUN_CREATED",
  "EXECUTOR_STARTED",
  "EXECUTOR_OUTPUT_SUMMARY",
  "EXECUTOR_COMPLETED",
  "EXECUTOR_FAILED",
  "EXECUTOR_CAPACITY_EXHAUSTED",
  "GIT_VERIFIED",
  "GIT_MISMATCH",
  "TEST_STARTED",
  "TEST_COMPLETED",
  "TEST_FAILED",
  "REVIEW_REQUESTED",
  "REVIEW_COMPLETED",
  "REVIEW_REJECTED",
  "OWNER_GATE_OPENED",
  "OWNER_GATE_RESOLVED",
  // The board, not the event, decides whether the machine has genuinely run out of independent work;
  // this is what makes WAITING_FOR_OWNER reachable at all.
  "INDEPENDENT_WORK_EXHAUSTED",
  "INTEGRATION_STARTED",
  "INTEGRATION_COMPLETED",
  "POST_INTEGRATION_VERIFIED",
  "DEPLOY_STARTED",
  "DEPLOY_COMPLETED",
  "POST_DEPLOY_VERIFIED",
  // The only events that may *settle* deployment truth. Each carries an observation *of production
  // itself* — not a process exit code, not an executor's report, not the repository, none of which can
  // say what production contains.
  //
  // Two other events touch the field and neither can settle it: `DEPLOY_STARTED` mints
  // MAY_HAVE_WRITTEN, which only tightens; and `DEPLOY_COMPLETED` may downgrade MAY_HAVE_WRITTEN to
  // WRITER_FINISHED_UNVERIFIED, which is still uncertain and still refuses both deployment and
  // completion — and only when the production writer lease corroborates that the process really let go.
  // `INCONCLUSIVE` is a first-class answer and deliberately leaves the mission uncertain: a probe
  // that failed is not evidence the deployment did not land, and treating it as one is how the
  // second write gets authorised by a network timeout.
  "PRODUCTION_VERIFIED_OLD",
  "PRODUCTION_VERIFIED_TARGET",
  "PRODUCTION_VERIFIED_UNEXPECTED",
  "PRODUCTION_VERIFY_INCONCLUSIVE",
  "MISSION_PAUSED",
  "MISSION_RESUMED",
  "MISSION_BLOCKED",
  "MISSION_INTERRUPTED",
  "MISSION_COMPLETED",
  "MISSION_FAILED",
] as const;

export type MissionEventKindV1 = (typeof MISSION_EVENT_KINDS)[number];

export interface MissionV1 {
  schema: typeof MISSION_SCHEMA_V1;
  missionId: OpaqueId;
  kind: string;
  title: string;
  /** The Owner instruction this mission serves. Authority derives from here or nowhere. */
  ownerDirective: string;
  createdAt: IsoTimestamp;
}

export interface MissionStateRecordV1 {
  schema: typeof MISSION_SCHEMA_V1;
  missionId: OpaqueId;
  state: MissionStateV1;
  /** Where to return after a pause or an owner answer. Null when nothing is suspended. */
  resumeState: MissionStateV1 | null;
  /**
   * What was true when the process disappeared. Durable because it is the only thing standing
   * between re-verification and an interruption quietly erasing a gate, a block or exhausted quota.
   */
  interruptedFrom: MissionStateV1 | null;
  /**
   * What is known about production, carried across process death.
   *
   * Durable for exactly the reason `interruptedFrom` above is, and its absence here was worse: the
   * whole point of this field is to survive a Director restart, and with no slot in the record it
   * survived nothing. It lived in one process's memory, a restart re-assembled the context from gates
   * and the work-item board, `NOTHING_PROVEN` supplied the deploy-permitting default, and six ordinary
   * moves later the mission wrote production a second time — nothing forged, no argument omitted.
   *
   * A reader that cannot find this field must not conclude a deployment never happened.
   */
  deploymentTruth: DeploymentTruthV1;
  currentRunId: OpaqueId | null;
  currentExecutor: string | null;
  updatedAt: IsoTimestamp;
  /** Monotonic; lets a reader detect a stale copy without comparing timestamps. */
  revision: number;
}

// ---------------------------------------------------------------------------
// The facts a consequential move is checked against
// ---------------------------------------------------------------------------

/**
 * What the durable records show right now.
 *
 * Assembled by the caller from the gate files and the work-item board — this module deliberately
 * imports neither, so that mission state stays a pure function of stated facts and cannot acquire a
 * second, disagreeing copy of the scheduler. Every field is a fact someone can point at, not a
 * judgement, and none of it is specific to a kind of mission.
 */
export interface MissionContextV1 {
  /** Required gates for this mission still recorded as open. */
  unresolvedRequiredGates: number;
  /** Mandatory work items not yet in a satisfying state. */
  unsatisfiedMandatoryWorkItems: number;
  /** Whether any READY or RUNNING item remains that no unresolved gate blocks. */
  independentWorkRemains: boolean;
  /** A verification run that happened *after* integration landed, not the pre-integration pass. */
  postIntegrationVerificationPassed: boolean;
  /** A verification run that happened after the deployment landed. */
  postDeployVerificationPassed: boolean;
  /** Dependencies of the work item that performs the deployment are satisfied. */
  deploymentDependenciesSatisfied: boolean;
  /** The authority class that permits writing production is held for this mission. */
  deploymentAuthorityPresent: boolean;
  /** The single production-writer lease is free to take. A *launch* precondition. */
  productionWriterLeaseAvailable: boolean;
  /**
   * This mission's own deployment process released the production-writer lease, or was confirmed dead.
   *
   * Deliberately separate from {@link productionWriterLeaseAvailable}, which is the precondition for
   * *starting* a deployment. Conflating the two made the completion check vacuous: `startDeployment`
   * requires the lease to be free before it will launch, so reading the same field afterwards as
   * proof the writer let go was reading back a value the launch had already forced true. A rollout
   * still in flight therefore read as "the writer finished", the old revision settled off it, and the
   * mission redeployed.
   *
   * Established only by the lease layer, from the lease id recorded at `DEPLOY_STARTED`, on an
   * explicit release or a `DEAD_CONFIRMED` liveness probe — never from an event, an exit code or an
   * executor's report. `UNKNOWN` liveness leaves it false, which leaves the mission uncertain.
   */
  productionWriterLeaseReleasedByThisRun: boolean;
  /**
   * What is known about whether production has been written — durable, sticky, and the only fact
   * permitted to open or close a second deployment.
   *
   * See {@link DeploymentTruthV1}. This exists because `interruptedFrom` could not carry the property:
   * it is a breadcrumb consulted at exactly one transition, and the demonstrated bypass simply routed
   * around that transition without ever falsifying it.
   */
  deploymentTruth: DeploymentTruthV1;
}

/**
 * What is actually known about the contents of production.
 *
 * A state rather than a boolean, because "we don't know" and "we know it is unchanged" are different
 * facts with different permissions, and a boolean forces them together — whichever way the flag falls,
 * one of the two gets the other's rights.
 *
 * ## Why this exists at all
 *
 * The previous safety primitive was `interruptedFrom`, a field consulted at exactly one transition:
 * `INTERRUPTED --GIT_VERIFIED-->`. That was enough to make the *reported* path fail closed and not
 * nearly enough to make the property hold, because `INTERRUPTED --GIT_MISMATCH--> BLOCKED` is a fixed
 * table row that never consults it, and from `BLOCKED` an ordinary, fully-legal seven-move sequence
 * reaches `DEPLOYING` again:
 *
 * ```
 * DEPLOYING -MISSION_INTERRUPTED-> INTERRUPTED -GIT_MISMATCH-> BLOCKED -PLAN_SELECTED-> PLANNING
 *   -EXECUTOR_STARTED-> EXECUTOR_RUNNING -EXECUTOR_FAILED-> VERIFYING
 *   -POST_INTEGRATION_VERIFIED-> READY_FOR_DEPLOYMENT -DEPLOY_STARTED-> DEPLOYING
 * ```
 *
 * Nothing there is forged and no argument is omitted; the record still carries
 * `interruptedFrom: "DEPLOYING"` the whole way and nothing looks at it again. A fact that only one
 * transition reads is not an invariant, it is a checkpoint — and a state machine with enough legal
 * edges will always have a way around one checkpoint.
 *
 * So deployment eligibility now consults durable truth directly, from *any* state, and the field is
 * written before the external process launches rather than after it returns.
 */
export type DeploymentTruthV1 =
  /**
   * Nobody recorded anything: the field was absent from the context, or carried a value outside this
   * union. Distinct from every other member, and deliberately inert — it is in no allowlist, settles
   * nothing, and arms nothing.
   *
   * It exists because reusing `MAY_HAVE_WRITTEN` for absence was itself a defect. That looked
   * conservative — absence refused deployment and completion — but `MAY_HAVE_WRITTEN` is *also* the
   * exact value that arms `DEPLOY_COMPLETED` to downgrade to `WRITER_FINISHED_UNVERIFIED`, from which
   * a stale old-revision read settles to a deployable truth. So a mission that had already established
   * `VERIFIED_TARGET_PRODUCTION` — production confirmed written — could have that erased by one call
   * whose context simply lost the field, and deploy a second time. A fail-closed default that is
   * indistinguishable from a real recorded value is not fail-closed; it is a forgery of one.
   */
  | "UNRECORDED"
  /** No deployment has ever been attempted for this mission. The only value that permits a first one. */
  | "NOT_STARTED"
  /**
   * A deployment process was launched, or may have been. Production may or may not have changed and
   * nothing has established which. Set *before* launch, so a crash between marking and spawning
   * leaves false uncertainty — which costs a verification, where the opposite error costs a second
   * production write.
   */
  | "MAY_HAVE_WRITTEN"
  /**
   * The deployment process reported back, but nobody has looked at production yet.
   *
   * Distinct from {@link MAY_HAVE_WRITTEN} because the two differ in one fact that changes what a
   * probe is worth: whether a writer is still running. Reading the old revision while a rollout is
   * in flight is a point-in-time sample, not evidence the write did not land — so that reading may
   * only settle truth from here.
   */
  | "WRITER_FINISHED_UNVERIFIED"
  /** Production was observed still at the pre-deployment SHA: the write did not land. */
  | "VERIFIED_OLD_PRODUCTION"
  /** Production was observed at the intended target SHA: the write landed, and must not be repeated. */
  | "VERIFIED_TARGET_PRODUCTION"
  /** Production was observed at something nobody intended. A person decides; no automatic move. */
  | "VERIFIED_UNEXPECTED";

/**
 * The values from which a deployment may be started.
 *
 * A closed allowlist, so a value added to {@link DeploymentTruthV1} without a decision here denies
 * deployment rather than inheriting permission. `VERIFIED_OLD_PRODUCTION` is included because a write
 * that provably did not land leaves the mission where it began; every other prerequisite still stands
 * in front of `DEPLOY_STARTED` independently.
 */
export const DEPLOYABLE_TRUTHS: readonly DeploymentTruthV1[] = ["NOT_STARTED", "VERIFIED_OLD_PRODUCTION"];

/**
 * Whether durable truth permits starting a deployment, independent of mission state.
 *
 * Consulted from every route to `DEPLOY_STARTED` rather than from one transition row — that was the
 * defect. Unknown values fail closed.
 */
export function deploymentPermittedByTruth(truth: DeploymentTruthV1): boolean {
  return DEPLOYABLE_TRUTHS.includes(truth);
}

/**
 * Whether a mission may be declared finished, as far as production is concerned.
 *
 * Uncertainty and an unexpected production SHA both block completion: a mission that cannot say what
 * it did to production has not finished, it has stopped.
 *
 * A closed allowlist, matching {@link DEPLOYABLE_TRUTHS} twenty lines above. It was written as a
 * denylist of three values while its sibling was an allowlist documented as "a value added without a
 * decision here denies rather than inheriting permission" — the correct pattern applied to one of the
 * two functions. Everything the denylist had not enumerated completed: `null`, `"UNKNOWN"`,
 * `"may_have_written"`, `"MAY_HAVE_WRITTEN "`, `0`, `{}`.
 */
export const COMPLETABLE_TRUTHS: readonly DeploymentTruthV1[] = [
  "NOT_STARTED", "VERIFIED_OLD_PRODUCTION", "VERIFIED_TARGET_PRODUCTION",
];

export function completionPermittedByTruth(truth: DeploymentTruthV1): boolean {
  return COMPLETABLE_TRUTHS.includes(truth);
}

/**
 * Whether an observation of the old revision may settle anything yet.
 *
 * Only from {@link WRITER_FINISHED_UNVERIFIED}: this is the one observation that *unlocks* another
 * deployment, so it needs the strongest precondition of the three. The precondition is carried by the
 * durable truth field rather than inferred from the mission's state name — the previous version
 * tested `current === "DEPLOYING"`, and `MISSION_INTERRUPTED` and `MISSION_PAUSED` both change the
 * state name without the writer reporting anything. One move after the guard, the same probe settled
 * truth and a second production write followed seven moves later. A state label is erased by every
 * state-changing event; the fact it stood for — a process is running somewhere — outlives all of them.
 */
export function oldRevisionMaySettle(truth: DeploymentTruthV1): boolean {
  return truth === "WRITER_FINISHED_UNVERIFIED";
}

/**
 * Name a rejected value in a refusal message without trusting it to be nameable.
 *
 * A Symbol throws when interpolated into a template literal, so the refusal path that reported the
 * offending value crashed on precisely the input it existed to refuse. A guard that turns a rejection
 * into an exception is not a guard: the caller sees a thrown error instead of `ok: false`, and every
 * `if (!result.ok)` branch downstream is skipped.
 */
function describeValue(value: unknown): string {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "string") return value === "" ? "an empty event name" : value;
  return Object.prototype.toString.call(value);
}

/**
 * What each production observation establishes. `null` means "nothing was established".
 *
 * Total over the four observation events, and the *only* mapping that writes deployment truth. Every
 * other event in the machine leaves it exactly as it was — which is the property, stated as data
 * rather than as a promise spread across transitions: `INTERRUPTED`, `BLOCKED`, `PAUSED`, a gate
 * answer, an executor failure, a fresh plan, `GIT_VERIFIED` and `GIT_MISMATCH` all fall through this
 * map untouched and therefore cannot clear uncertainty.
 */
const PRODUCTION_OBSERVATIONS = {
  PRODUCTION_VERIFIED_OLD: "VERIFIED_OLD_PRODUCTION",
  PRODUCTION_VERIFIED_TARGET: "VERIFIED_TARGET_PRODUCTION",
  PRODUCTION_VERIFIED_UNEXPECTED: "VERIFIED_UNEXPECTED",
  PRODUCTION_VERIFY_INCONCLUSIVE: null,
} as const satisfies Readonly<Record<string, DeploymentTruthV1 | null>>;

/** Only the three settling observations need a sentence; the rest are never returned from here. */
type SettlingTruthV1 = Exclude<
  DeploymentTruthV1,
  "UNRECORDED" | "NOT_STARTED" | "MAY_HAVE_WRITTEN" | "WRITER_FINISHED_UNVERIFIED"
>;

const PRODUCTION_OBSERVATION_REASONS: Readonly<Record<SettlingTruthV1, string>> = {
  VERIFIED_OLD_PRODUCTION: "production is still at the pre-deployment revision, so the write did not land",
  VERIFIED_TARGET_PRODUCTION: "production is at the intended revision; the write landed and is not repeated",
  VERIFIED_UNEXPECTED: "production is at a revision nobody intended, which a person resolves",
};

/**
 * The starting point every supplied context is merged onto.
 *
 * Unproven is refused, which is why the gate and work-item counts start at one rather than zero: a
 * caller that forgets to pass the board must not thereby complete or deploy a mission. The single
 * exception is `independentWorkRemains`, where the safe default runs the other way — claiming the
 * machine has nothing left to do is what puts a mission into `WAITING_FOR_OWNER` and tells the Owner
 * he is the bottleneck, so that claim also has to be earned.
 */
export const NOTHING_PROVEN: MissionContextV1 = {
  unresolvedRequiredGates: 1,
  unsatisfiedMandatoryWorkItems: 1,
  independentWorkRemains: true,
  postIntegrationVerificationPassed: false,
  postDeployVerificationPassed: false,
  deploymentDependenciesSatisfied: false,
  deploymentAuthorityPresent: false,
  productionWriterLeaseAvailable: false,
  productionWriterLeaseReleasedByThisRun: false,
  // Absence is its own value, and it is inert. Defaulting to NOT_STARTED failed open — omitting this
  // one field from an otherwise complete board granted a deployment while omitting any other fact
  // refused. Defaulting to MAY_HAVE_WRITTEN then failed a subtler way: it refused deployment, but it
  // is also the value `DEPLOY_COMPLETED` requires, so absence could still drive a settled truth
  // backwards into a deployable one. UNRECORDED does neither.
  deploymentTruth: "UNRECORDED",
};

/** Every value the union admits, for the membership test below. */
const DEPLOYMENT_TRUTHS: readonly DeploymentTruthV1[] = [
  "UNRECORDED", "NOT_STARTED", "MAY_HAVE_WRITTEN", "WRITER_FINISHED_UNVERIFIED",
  "VERIFIED_OLD_PRODUCTION", "VERIFIED_TARGET_PRODUCTION", "VERIFIED_UNEXPECTED",
];

function establish(supplied: Partial<MissionContextV1> | undefined): MissionContextV1 {
  const merged = { ...NOTHING_PROVEN, ...(supplied ?? {}) };
  // The field reaches this module from a durable record written by an older schema, a hand edit or a
  // JSON parse, so a value outside the union arrives as a cast. Checked before anything consults it,
  // and an unrecognised value is read as uncertainty rather than as whatever it happens to spell —
  // `null`, `"UNKNOWN"`, `"may_have_written"` and `0` all previously satisfied the completion check.
  if (!(DEPLOYMENT_TRUTHS as readonly unknown[]).includes(merged.deploymentTruth)) {
    return { ...merged, deploymentTruth: "UNRECORDED" };
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Where a suspended mission may be put back
// ---------------------------------------------------------------------------

/**
 * What naming a state as a resume target is worth.
 *
 * Three answers, because three situations differ. `RESTORE` re-enters the state as it stands, which
 * is safe only where the state still has its own checks in front of it. `REVERIFY` is a deliberate
 * downgrade for an origin nothing observed survive the suspension — a run whose process is gone, a
 * merge whose lease was dropped — and reads the repository instead. `REFUSE` fails the move loudly.
 * Collapsing the last two would either strand recoverable missions or soften a target that exists to
 * be refused, which is the mistake being undone here.
 */
export type ResumeDispositionV1 = "RESTORE" | "REVERIFY" | "REFUSE";

/**
 * Every state, classified exactly once.
 *
 * A resume target arrives from outside — a paused record, or a gate's `resumeState`, both files an
 * executor or a stale process may have written — so naming a state must never be enough to occupy
 * it. This was a pair of lists with a fall-through to `VERIFYING` underneath, so any state not named
 * in either list was granted the fall-through by default. Being total over `MissionStateV1`, a new
 * state now breaks the build here rather than arriving pre-approved.
 */
const RESUME_DISPOSITION: Readonly<Record<MissionStateV1, ResumeDispositionV1>> = {
  // Nothing is in flight before a plan runs, and restoring these is what stops a mission escaping its
  // own authorization: under the fall-through, pausing at CREATED and resuming landed in VERIFYING,
  // which is past MISSION_AUTHORIZED and past PLAN_SELECTED.
  CREATED: "RESTORE",
  AUTHORIZED: "RESTORE",
  PLANNING: "RESTORE",
  // A live run, a result nobody checked, and a half-finished merge all died with their process or
  // dropped their lease. What is actually in the repository decides, not what the record claims.
  EXECUTOR_RUNNING: "REVERIFY",
  EXECUTOR_RESULT_RECEIVED: "REVERIFY",
  INTEGRATING: "REVERIFY",
  VERIFYING: "RESTORE",
  INDEPENDENT_REVIEW: "RESTORE",
  READY_FOR_INTEGRATION: "RESTORE",
  OWNER_GATE_REQUIRED: "RESTORE",
  WAITING_FOR_OWNER: "RESTORE",
  WAITING_FOR_CAPACITY: "RESTORE",
  // The five deployment prerequisites are still in front of DEPLOY_STARTED, so arriving back at the
  // name grants nothing on its own.
  READY_FOR_DEPLOYMENT: "RESTORE",
  // The far side of those prerequisites, and one event short of COMPLETED with no deployment having
  // happened. A string in a file must never stand where a check belongs.
  DEPLOYING: "REFUSE",
  POST_DEPLOY_VERIFY: "REFUSE",
  // An outcome is reached by satisfying it, never by being named it.
  COMPLETED: "REFUSE",
  FAILED: "REFUSE",
  BLOCKED: "RESTORE",
  // Pause refuses to pause an already-paused mission, so PAUSED is never recorded as an origin; a
  // record naming it is corrupt, and resuming into a pause is not a resume.
  PAUSED: "REFUSE",
  // Pause is refused from INTERRUPTED, so no record this machine writes can name it as a target; one
  // that does has had its real origin overwritten. Restoring it was the last route by which a
  // deployment laundered itself: pausing an interrupted mission replaced the paused origin with
  // INTERRUPTED, and resuming that target unwound through an unrecorded origin into VERIFYING.
  INTERRUPTED: "REFUSE",
};

/**
 * The only states a mission may be resumed *into*.
 *
 * Derived from the classification rather than written beside it, so the exported list and the rule
 * that actually decides cannot drift apart.
 */
export const RESUMABLE_STATES: readonly MissionStateV1[] = MISSION_STATES.filter(
  (state) => RESUME_DISPOSITION[state] === "RESTORE",
);

/**
 * What a candidate resume target is worth, failing closed.
 *
 * The candidate is typed as a state but reaches this module as a string somebody else wrote, so a
 * value outside the union arrives here as a cast. It is checked against the canonical list before the
 * map is indexed: an unclassified target is refused rather than looked up, and no inherited property
 * name can answer for a state.
 */
export function resumeDispositionOf(candidate: MissionStateV1): ResumeDispositionV1 {
  if (!(MISSION_STATES as readonly string[]).includes(candidate)) return "REFUSE";
  // Typed as total and read as though it might not be: a map that ever loses a key must deny rather
  // than hand `undefined` to a comparison, where every `=== "REFUSE"` test would quietly pass.
  const disposition: ResumeDispositionV1 | undefined = RESUME_DISPOSITION[candidate];
  return disposition ?? "REFUSE";
}

interface DerivationV1 {
  to: MissionStateV1 | null;
  reason: string;
  missing: string[];
  /** Set when the move consumes or replaces the remembered target. */
  resumeState?: MissionStateV1 | null;
}

/**
 * Decide where a named resume target actually lands.
 *
 * The classification decides; this only turns its answer into a move. A forgotten origin verifies,
 * because having no target and having an unusable one are the same situation. Everything else is
 * whatever `RESUME_DISPOSITION` says it is, and anything it does not classify — a state nobody
 * assigned a disposition, or a value that is not a state — falls to the refusal at the end.
 */
function resumeTargetFor(candidate: MissionStateV1 | null): DerivationV1 {
  if (candidate === null) {
    return { to: "VERIFYING", reason: "resumed; origin unknown, so verify first", missing: [] };
  }
  const disposition = resumeDispositionOf(candidate);
  if (disposition === "RESTORE") {
    return { to: candidate, reason: "resumed where it left off", missing: [] };
  }
  if (disposition === "REVERIFY") {
    return {
      to: "VERIFYING",
      reason: `${candidate} did not survive the suspension, so the repository is read before anything continues`,
      missing: [],
    };
  }
  return {
    to: null,
    reason: `${candidate} cannot be entered by being named; it is an outcome, the far side of a check, or not a state this machine recognises`,
    missing: [`whatever ${candidate} would have skipped`],
  };
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

type TransitionDeriverV1 = (input: {
  from: MissionStateV1;
  context: MissionContextV1;
  resumeState: MissionStateV1 | null;
  interruptedFrom: MissionStateV1 | null;
}) => DerivationV1;

/**
 * Which owner-gate state the board is actually in, or null when no required gate is open.
 *
 * This is the whole of the distinction the Owner asked for, in one place so the two states cannot
 * drift apart: an unresolved gate means `OWNER_GATE_REQUIRED`, and only the additional fact that
 * nothing else is runnable turns it into `WAITING_FOR_OWNER`.
 */
function ownerGateCondition(context: MissionContextV1): MissionStateV1 | null {
  if (context.unresolvedRequiredGates <= 0) return null;
  return context.independentWorkRemains ? "OWNER_GATE_REQUIRED" : "WAITING_FOR_OWNER";
}

/** Opening a gate is itself the record that one is open, so only the board's busyness is consulted. */
const gateOpened: TransitionDeriverV1 = ({ context }) => {
  const to: MissionStateV1 = context.independentWorkRemains ? "OWNER_GATE_REQUIRED" : "WAITING_FOR_OWNER";
  return {
    to,
    reason: to === "OWNER_GATE_REQUIRED"
      ? "a gate is open; work it does not block continues"
      : "a gate is open and nothing else is runnable",
    missing: [],
  };
};

/**
 * Re-read the board while a gate is open.
 *
 * Nothing here trusts the event: `INDEPENDENT_WORK_EXHAUSTED` from a busy board leaves the mission
 * where it was, and work reappearing takes it back out of `WAITING_FOR_OWNER`. Without this the
 * `OWNER_GATE_REQUIRED` to `WAITING_FOR_OWNER` edge had no event that could reach it at all, because
 * the pause it was keyed on is intercepted before the table is consulted.
 */
const ownerGateReassessed: TransitionDeriverV1 = ({ context }) => {
  const condition = ownerGateCondition(context);
  if (!condition) {
    return {
      to: null,
      reason: "no required gate is unresolved, so record the resolution rather than re-assessing around it",
      missing: [],
    };
  }
  return {
    to: condition,
    reason: condition === "WAITING_FOR_OWNER"
      ? "the gate is the last thing in the way"
      : "the gate is open but the machine still has work",
    missing: [],
  };
};

/**
 * Answering a gate does not by itself release the mission.
 *
 * The event says one gate was answered. Whether *any* required gate remains open is a fact about the
 * durable gate records, and where the mission continues is the gate's own resume target — put through
 * the same classification, because a gate file that says `COMPLETED` must not complete a mission.
 */
const gateResolved: TransitionDeriverV1 = ({ context, resumeState }) => {
  const stillGated = ownerGateCondition(context);
  // The move succeeds — the answer is recorded — but it lands back in the gate condition rather than
  // releasing the mission. Nothing is listed as outstanding because nothing was refused; the state it
  // lands in is itself the statement that a gate is still open.
  if (stillGated) return { to: stillGated, reason: "another required gate is still unresolved", missing: [] };
  const target = resumeTargetFor(resumeState);
  if (!target.to) return target;
  return { to: target.to, reason: `gate answered; ${target.reason}`, missing: [], resumeState: null };
};

/**
 * What returning from an interruption is allowed to conclude, per condition that was interrupted.
 *
 * `PRESERVE` returns to the same condition, because a dead process does not clear it. `RECHECK_GATE`
 * re-reads the durable gate count, since the Owner may genuinely have answered while nothing was
 * running. `PRODUCTION_TRUTH` sends the mission to post-deploy verification, because production may
 * already have changed and the only honest next question is what is running now. `REVERIFY` reads the
 * repository, which is the right answer for every condition where nothing outside the process was at
 * stake. `REFUSE` is for records that cannot honestly have been produced.
 */
export type InterruptionRecoveryV1 = "PRESERVE" | "RECHECK_GATE" | "PRODUCTION_TRUTH" | "REVERIFY" | "REFUSE";

/**
 * Every state, classified exactly once as a condition to come back from.
 *
 * Total for the same reason the resume map is: the previous shape named five conditions and let
 * everything else fall through to `VERIFYING`, so `DEPLOYING` and `POST_DEPLOY_VERIFY` — the two
 * states in which production may already have been written — were laundered into a pre-deployment
 * state by an interruption, and the mission could deploy a second time. A state added to the union
 * has to be classified here before this file compiles.
 */
const INTERRUPTION_RECOVERY: Readonly<Record<MissionStateV1, InterruptionRecoveryV1>> = {
  // Nothing outside the Director's own process was at stake in any of these, so the repository is a
  // complete answer: the work may well have finished before the process died, and looking is cheaper
  // and safer than repeating.
  CREATED: "REVERIFY",
  AUTHORIZED: "REVERIFY",
  PLANNING: "REVERIFY",
  EXECUTOR_RUNNING: "REVERIFY",
  EXECUTOR_RESULT_RECEIVED: "REVERIFY",
  VERIFYING: "REVERIFY",
  INDEPENDENT_REVIEW: "REVERIFY",
  READY_FOR_INTEGRATION: "REVERIFY",
  INTEGRATING: "REVERIFY",
  // A downgrade, not a restore: deployment readiness is re-earned through POST_INTEGRATION_VERIFIED
  // rather than survived, so an interruption cannot hand back a deploy-ready mission for free.
  READY_FOR_DEPLOYMENT: "REVERIFY",
  OWNER_GATE_REQUIRED: "RECHECK_GATE",
  WAITING_FOR_OWNER: "RECHECK_GATE",
  // A process dying does not return an executor's quota, repair a block, or unpause a mission.
  WAITING_FOR_CAPACITY: "PRESERVE",
  BLOCKED: "PRESERVE",
  PAUSED: "PRESERVE",
  // The two conditions in which production may already have changed. Neither may conclude that the
  // deployment failed — the Director dying is not evidence about production — and neither may return
  // to a state from which DEPLOY_STARTED is a move.
  DEPLOYING: "PRODUCTION_TRUTH",
  POST_DEPLOY_VERIFY: "PRODUCTION_TRUTH",
  // `advance` refuses to interrupt a terminal mission and never records INTERRUPTED as the condition
  // it interrupted, so all three can only arrive from a corrupt or forged record. Restoring COMPLETED
  // would let a hand-edited field finish a mission; a self-referential record has lost whatever
  // condition it was hiding, which may have been a deployment, so neither is guessed at.
  COMPLETED: "REFUSE",
  FAILED: "REFUSE",
  INTERRUPTED: "REFUSE",
};

/**
 * What a recorded interrupted-from condition is worth, failing closed.
 *
 * Checked against the canonical list before the map is indexed, for the same reason resume targets
 * are: the value is read back from a durable record that outlived the process which wrote it.
 */
export function interruptionRecoveryOf(interruptedFrom: MissionStateV1): InterruptionRecoveryV1 {
  if (!(MISSION_STATES as readonly string[]).includes(interruptedFrom)) return "REFUSE";
  const recovery: InterruptionRecoveryV1 | undefined = INTERRUPTION_RECOVERY[interruptedFrom];
  return recovery ?? "REFUSE";
}

/**
 * The states in the union that no classification map has a row for.
 *
 * Exported so totality is a runtime assertion and not only a compiler one. The test that claimed to
 * cover this fed `"ROLLING_BACK" as MissionStateV1` — a value deliberately *not* in `MISSION_STATES`
 * — so it exited at the membership guard and never reached the map index or the `?? "REFUSE"`
 * fallback. Adding a real state to the union and leaving both maps unclassified therefore kept the
 * suite green, which is the one case the test existed to catch.
 *
 * The safety property itself always held — `tsc` fails with TS2741 on an incomplete `Record`, and
 * both lookups fall closed at runtime. What was missing was a test that fails, so this returns the
 * gap rather than a boolean: a name in this list is a state whose permission nobody has decided.
 */
export function unclassifiedMissionStates(): MissionStateV1[] {
  const has = (map: object, state: string): boolean => Object.prototype.hasOwnProperty.call(map, state);
  return MISSION_STATES.filter(
    (state) => !has(RESUME_DISPOSITION, state) || !has(INTERRUPTION_RECOVERY, state),
  );
}

/**
 * Come back from an interruption to the condition that was true before it.
 *
 * The classification decides where; the sentences below only explain the decision to whoever reads
 * the result. Note what this never does: it does not treat the interruption as a failure, and it does
 * not treat a matching repository as permission to carry on as though nothing had been in flight.
 */
const reVerifyAfterInterruption: TransitionDeriverV1 = ({ context, interruptedFrom }) => {
  // A missing origin is the unsafe value, not the neutral one. This used to return VERIFYING, from
  // which POST_INTEGRATION_VERIFIED -> READY_FOR_DEPLOYMENT -> DEPLOY_STARTED -> DEPLOYING all succeed
  // on the same context that was true when the first deploy began: production written a second time,
  // which is the exact incident the classification above exists to prevent. It was reachable without
  // forging anything — any caller omitting the optional field, or a record persisted before the field
  // existed, since the store is generic and nothing makes `interruptedFrom` round-trip.
  //
  // `advance` never produces INTERRUPTED without an origin, so nothing legitimate is stranded, and
  // GIT_MISMATCH -> BLOCKED stays available. This is the same refusal the map already makes for a
  // self-referential INTERRUPTED record, for the same reason: a lost origin may have been a
  // deployment, and NOTHING_PROVEN means an unsupplied fact is never read as a safe one.
  if (interruptedFrom === null) {
    return {
      to: null,
      reason: "nothing records what this mission was doing when the process died, and a deployment is one of the things it may have been",
      missing: ["the condition the interruption interrupted"],
    };
  }
  const recovery = interruptionRecoveryOf(interruptedFrom);
  if (recovery === "PRESERVE") {
    // The map decided; these only explain it. The last arm is not dead code — it is what a condition
    // classified PRESERVE later says before anybody writes it a sentence of its own.
    const why = interruptedFrom === "BLOCKED"
      ? "the repository matches, but the block that preceded the interruption stands"
      : interruptedFrom === "WAITING_FOR_CAPACITY"
        ? "a process dying does not return an executor's quota"
        : interruptedFrom === "PAUSED"
          ? "the mission was paused before the interruption and is paused still"
          : `an interruption did not change the condition ${interruptedFrom} describes`;
    return { to: interruptedFrom, reason: why, missing: [] };
  }
  if (recovery === "RECHECK_GATE") {
    const stillGated = ownerGateCondition(context);
    if (stillGated) {
      return { to: stillGated, reason: "the gate open before the interruption is open still", missing: [] };
    }
    return { to: "VERIFYING", reason: "the gate was answered while nothing was running, so verification continues", missing: [] };
  }
  if (recovery === "PRODUCTION_TRUTH") {
    // POST_DEPLOY_VERIFY has no DEPLOY_STARTED row, and completing out of it requires the post-deploy
    // fact, so this lands the mission where production has to be established before anything else.
    const why = interruptedFrom === "DEPLOYING"
      ? "a deployment was in flight when the process died, so what production actually contains is now the question, not whether to deploy again"
      : "the deployment had already landed, so verifying what it did is still what is outstanding";
    return { to: "POST_DEPLOY_VERIFY", reason: why, missing: [] };
  }
  if (recovery === "REVERIFY") {
    return { to: "VERIFYING", reason: "the repository matches, so what happened is checked rather than repeated", missing: [] };
  }
  return {
    to: null,
    reason: `an interruption cannot have come from ${interruptedFrom}, so the record is not trusted to place this mission`,
    missing: ["a person to say what state this mission is really in"],
  };
};

/**
 * Completion is a claim about everything, not about the current state.
 *
 * `VERIFYING` and `READY_FOR_INTEGRATION` both used to complete a mission outright, which meant a
 * mission could finish with the Owner's question unanswered and mandatory work never started. The
 * check is deliberately expressed in counts rather than in mission kinds, so no future kind of work
 * gets an exemption by being unlisted.
 */
const completeMission: TransitionDeriverV1 = ({ from, context }) => {
  const missing: string[] = [];
  if (context.unresolvedRequiredGates > 0) missing.push("an approval that has not been given yet");
  if (context.unsatisfiedMandatoryWorkItems > 0) missing.push("work that has not finished");
  // Checked from every state, not only from POST_DEPLOY_VERIFY: the bypass reached COMPLETED through
  // VERIFYING, where the post-deploy check below does not apply, and declared success while nobody
  // knew what production contained. A mission that cannot say what it did to production has not
  // finished — it has stopped.
  if (!completionPermittedByTruth(context.deploymentTruth)) {
    missing.push(
      context.deploymentTruth === "MAY_HAVE_WRITTEN"
        ? "a production observation; a deployment was started and nothing established what it did"
        : "a person's decision about production, which is at a state nobody intended",
    );
  }
  // Only meaningful once something was deployed; a mission that never deploys is not held to it.
  if (from === "POST_DEPLOY_VERIFY" && !context.postDeployVerificationPassed) {
    missing.push("the check that the deployment is actually healthy");
  }
  if (missing.length > 0) {
    return { to: null, reason: "a mission is not finished while something it required is outstanding", missing };
  }
  return { to: "COMPLETED", reason: "every required gate and every mandatory work item is settled", missing: [] };
};

/**
 * The five things a production write needs, all of them facts.
 *
 * Reaching `READY_FOR_DEPLOYMENT` used to be the entire permission, so a mission that arrived at the
 * state name could deploy with the phone test unanswered and someone else holding the writer.
 */
const startDeployment: TransitionDeriverV1 = ({ context }) => {
  // Durable truth first, and separately from the prerequisite list: the others are things that have
  // not been established yet and can become true by ordinary work, whereas this one is a statement
  // about production that only a production observation may change. Folding it into `missing` would
  // read as "one more box to tick".
  if (!deploymentPermittedByTruth(context.deploymentTruth)) {
    return {
      to: null,
      // One sentence per situation. The last arm used to answer for UNRECORDED too, so a mission
      // whose record simply never said anything was told production was "at a state nobody intended"
      // — a different and much more alarming claim than the truth, which is that nobody looked.
      reason: context.deploymentTruth === "UNRECORDED"
        ? "nothing on record says what this mission has done to production, so a deployment is not authorised by it"
        : context.deploymentTruth === "MAY_HAVE_WRITTEN"
          ? "a deployment was already started for this mission and nothing has established what it did to production"
          : context.deploymentTruth === "WRITER_FINISHED_UNVERIFIED"
            ? "the deployment process finished but nobody has looked at production yet"
            : context.deploymentTruth === "VERIFIED_TARGET_PRODUCTION"
              ? "production is already at the intended target; deploying it again would write it twice"
              : "production is at a state nobody intended, which a person resolves rather than another deployment",
      missing: ["a production observation that says what production actually contains"],
    };
  }
  const missing: string[] = [];
  if (context.unresolvedRequiredGates > 0) missing.push("the approval this deployment waits on");
  if (!context.postIntegrationVerificationPassed) missing.push("a passing verification of the integrated code");
  if (!context.deploymentDependenciesSatisfied) missing.push("earlier work this deployment depends on");
  if (!context.deploymentAuthorityPresent) missing.push("authority to write production");
  if (!context.productionWriterLeaseAvailable) missing.push("the production writer, which something else is holding");
  if (missing.length > 0) {
    return { to: null, reason: "deployment is not permitted by having reached a state, only by these being true", missing };
  }
  return { to: "DEPLOYING", reason: "every deployment prerequisite is established", missing: [] };
};

/** Integration verification is proved by the board, not announced by the event that claims it. */
const postIntegrationVerified: TransitionDeriverV1 = ({ context }) => {
  if (!context.postIntegrationVerificationPassed) {
    return {
      to: null,
      reason: "nothing records a verification run after integration",
      missing: ["a passing verification of the integrated code"],
    };
  }
  return { to: "READY_FOR_DEPLOYMENT", reason: "the integrated code verified", missing: [] };
};

// ---------------------------------------------------------------------------
// The transition table
// ---------------------------------------------------------------------------

/**
 * The transition table.
 *
 * Read it as: from this state, this event moves you there. Anything absent is refused. A row either
 * names a fixed destination, or derives one from the facts — and a derived row may refuse, because
 * some moves are legal in shape and unearned in substance. Keeping it declarative means the legal
 * shape of a mission can be read in one place rather than reconstructed from branches scattered
 * across a service.
 *
 * `MISSION_PAUSED`, `MISSION_RESUMED` and `MISSION_INTERRUPTED` are absent by design: they are legal
 * from almost anywhere and are handled before the lookup. Rows for them here would be dead, which is
 * exactly how the `OWNER_GATE_REQUIRED` to `WAITING_FOR_OWNER` edge came to be unreachable.
 */
type TransitionRowV1 =
  | { from: MissionStateV1; event: MissionEventKindV1; to: MissionStateV1 }
  | { from: MissionStateV1; event: MissionEventKindV1; derive: TransitionDeriverV1 };

const TRANSITIONS: readonly TransitionRowV1[] = [
  { from: "CREATED", event: "MISSION_AUTHORIZED", to: "AUTHORIZED" },
  { from: "AUTHORIZED", event: "PLAN_SELECTED", to: "PLANNING" },
  { from: "PLANNING", event: "RUN_CREATED", to: "PLANNING" },
  { from: "PLANNING", event: "EXECUTOR_STARTED", to: "EXECUTOR_RUNNING" },

  // An executor finishing is never the same as its work being correct.
  { from: "EXECUTOR_RUNNING", event: "EXECUTOR_COMPLETED", to: "EXECUTOR_RESULT_RECEIVED" },
  { from: "EXECUTOR_RUNNING", event: "EXECUTOR_FAILED", to: "VERIFYING" },
  { from: "EXECUTOR_RUNNING", event: "EXECUTOR_CAPACITY_EXHAUSTED", to: "WAITING_FOR_CAPACITY" },
  { from: "WAITING_FOR_CAPACITY", event: "EXECUTOR_STARTED", to: "EXECUTOR_RUNNING" },

  // Everything an executor claims passes through verification before it counts.
  { from: "EXECUTOR_RESULT_RECEIVED", event: "GIT_VERIFIED", to: "VERIFYING" },
  { from: "EXECUTOR_RESULT_RECEIVED", event: "GIT_MISMATCH", to: "BLOCKED" },
  { from: "VERIFYING", event: "TEST_STARTED", to: "VERIFYING" },
  { from: "VERIFYING", event: "TEST_COMPLETED", to: "VERIFYING" },
  { from: "VERIFYING", event: "TEST_FAILED", to: "BLOCKED" },
  { from: "VERIFYING", event: "REVIEW_REQUESTED", to: "INDEPENDENT_REVIEW" },
  { from: "VERIFYING", event: "MISSION_BLOCKED", to: "BLOCKED" },
  { from: "VERIFYING", event: "OWNER_GATE_OPENED", derive: gateOpened },

  // A rejected review returns to planning so the repair is a new run, not a silent retry.
  { from: "INDEPENDENT_REVIEW", event: "REVIEW_COMPLETED", to: "READY_FOR_INTEGRATION" },
  { from: "INDEPENDENT_REVIEW", event: "REVIEW_REJECTED", to: "PLANNING" },

  { from: "READY_FOR_INTEGRATION", event: "OWNER_GATE_OPENED", derive: gateOpened },
  { from: "READY_FOR_INTEGRATION", event: "INTEGRATION_STARTED", to: "INTEGRATING" },

  // Integrated code is code nobody has verified in its integrated form. Going straight to deployment
  // readiness meant merge results were the one thing never checked.
  { from: "INTEGRATING", event: "INTEGRATION_COMPLETED", to: "VERIFYING" },
  { from: "INTEGRATING", event: "GIT_MISMATCH", to: "BLOCKED" },
  { from: "VERIFYING", event: "POST_INTEGRATION_VERIFIED", derive: postIntegrationVerified },

  // Deployment always passes a gate. There is no path from integration straight to deploying.
  { from: "READY_FOR_DEPLOYMENT", event: "OWNER_GATE_OPENED", derive: gateOpened },
  { from: "READY_FOR_DEPLOYMENT", event: "DEPLOY_STARTED", derive: startDeployment },
  { from: "DEPLOYING", event: "DEPLOY_COMPLETED", to: "POST_DEPLOY_VERIFY" },
  // The event records evidence; whether it amounts to a healthy deployment is a fact the completion
  // check reads, so this does not move the mission on its own.
  { from: "POST_DEPLOY_VERIFY", event: "POST_DEPLOY_VERIFIED", to: "POST_DEPLOY_VERIFY" },
  { from: "POST_DEPLOY_VERIFY", event: "MISSION_COMPLETED", derive: completeMission },
  { from: "POST_DEPLOY_VERIFY", event: "MISSION_FAILED", to: "FAILED" },

  // A gate is answered, not replaced by a new mission.
  { from: "OWNER_GATE_REQUIRED", event: "OWNER_GATE_RESOLVED", derive: gateResolved },
  { from: "OWNER_GATE_REQUIRED", event: "INDEPENDENT_WORK_EXHAUSTED", derive: ownerGateReassessed },
  { from: "WAITING_FOR_OWNER", event: "OWNER_GATE_RESOLVED", derive: gateResolved },
  { from: "WAITING_FOR_OWNER", event: "RUN_CREATED", derive: ownerGateReassessed },

  { from: "VERIFYING", event: "MISSION_COMPLETED", derive: completeMission },
  { from: "READY_FOR_INTEGRATION", event: "MISSION_COMPLETED", derive: completeMission },

  // Interruption is a question, not a verdict: what actually happened is decided by looking.
  { from: "INTERRUPTED", event: "GIT_VERIFIED", derive: reVerifyAfterInterruption },
  { from: "INTERRUPTED", event: "GIT_MISMATCH", to: "BLOCKED" },

  { from: "BLOCKED", event: "MISSION_FAILED", to: "FAILED" },
  { from: "BLOCKED", event: "PLAN_SELECTED", to: "PLANNING" },
];

/** The fixed destination the table declares for a move, or null when the move derives one. */
export function declaredTarget(from: MissionStateV1, event: MissionEventKindV1): MissionStateV1 | null {
  const row = TRANSITIONS.find((candidate) => candidate.from === from && candidate.event === event);
  return row && "to" in row ? row.to : null;
}

export interface TransitionResultV1 {
  ok: boolean;
  from: MissionStateV1;
  to: MissionStateV1 | null;
  reason: string;
}

export interface MissionTransitionV1 extends TransitionResultV1 {
  resumeState: MissionStateV1 | null;
  interruptedFrom: MissionStateV1 | null;
  /**
   * What the caller must persist as the mission's deployment truth *before* acting on this move.
   *
   * Non-null only where the move changes it. `DEPLOY_STARTED` returns `MAY_HAVE_WRITTEN`, and the
   * ordering is the point: the caller writes this, and only then launches the deployment process. A
   * crash in between leaves false uncertainty, which costs one production observation; the opposite
   * ordering costs a second production write, which is the thing this whole mechanism exists to
   * prevent. `null` means "unchanged", never "clear it".
   */
  deploymentTruth: DeploymentTruthV1 | null;
  /**
   * What is still outstanding, in plain words. Empty on every move that succeeded — a refusal is the
   * only thing that can leave a mission short of something.
   */
  missing: string[];
}

export interface MissionAdvanceOptionsV1 {
  /** What the durable records show. Anything not supplied counts as not established. */
  context?: Partial<MissionContextV1>;
  /** The state held when the process disappeared, carried out of the interruption that recorded it. */
  interruptedFrom?: MissionStateV1 | null;
}

/**
 * Move a mission, or explain why it may not move.
 *
 * Pause, resume and interruption are handled before the table because they are legal from almost
 * anywhere and each has to remember something: pause remembers where it came from, or it becomes a
 * restart; interruption remembers what it interrupted, or it becomes a way of clearing a blocker.
 */
export function advance(
  current: MissionStateV1,
  event: MissionEventKindV1,
  resumeState: MissionStateV1 | null = null,
  options: MissionAdvanceOptionsV1 = {},
): MissionTransitionV1 {
  const context = establish(options.context);
  const interruptedFrom = options.interruptedFrom ?? null;

  const settle = (
    to: MissionStateV1 | null,
    ok: boolean,
    reason: string,
    over: {
      resumeState?: MissionStateV1 | null;
      interruptedFrom?: MissionStateV1 | null;
      missing?: string[];
      deploymentTruth?: DeploymentTruthV1 | null;
    } = {},
  ): MissionTransitionV1 => ({
    ok,
    from: current,
    to,
    reason,
    deploymentTruth: over.deploymentTruth ?? null,
    resumeState: over.resumeState !== undefined ? over.resumeState : resumeState,
    interruptedFrom: over.interruptedFrom !== undefined ? over.interruptedFrom : interruptedFrom,
    missing: over.missing ?? [],
  });

  // The event is checked against the canonical list before anything indexes a map with it, for the
  // same reason states are (see `resumeDispositionOf`). It reaches this module as a string somebody
  // else wrote — an HTTP body, a recovered journal line — so a value outside the union arrives as a
  // cast. Without this, `PRODUCTION_OBSERVATIONS[event]` was a bare index into an object literal and
  // every inherited `Object.prototype` key answered for a production observation: `advance(state,
  // "toString")` returned `ok:true` with `deploymentTruth` set to a *function*. A faithful caller
  // persists that field before acting, `JSON.stringify` drops a function silently, the record reloads
  // with the key missing, and `establish` defaults it to `NOT_STARTED` — uncertainty erased by an
  // event that is not one of the four, and a second deployment permitted.
  // `String(value)` rather than a template literal: a Symbol throws inside interpolation, so a
  // refusal path that named the offending value would crash on exactly the input it exists to
  // refuse — a guard that turns a rejection into an exception is not a guard.
  if (!(MISSION_EVENT_KINDS as readonly string[]).includes(event)) {
    return settle(null, false, `${describeValue(event)} is not a mission event`);
  }

  if (!(MISSION_STATES as readonly string[]).includes(current)) {
    return settle(null, false, `${describeValue(current)} is not a mission state`);
  }

  // Both optional origins are checked here, before any code path builds a sentence naming them.
  // `resumeDispositionOf` and `interruptionRecoveryOf` already refuse an unknown value correctly, but
  // the refusal *message* interpolated it — so a Symbol threw out of the function instead of coming
  // back as `ok: false`, skipping every caller's failure branch.
  if (resumeState !== null && !(MISSION_STATES as readonly string[]).includes(resumeState)) {
    return settle(null, false, `${describeValue(resumeState)} is not a state a mission can be resumed to`);
  }
  if (interruptedFrom !== null && !(MISSION_STATES as readonly string[]).includes(interruptedFrom)) {
    return settle(null, false, `${describeValue(interruptedFrom)} is not a state an interruption can have come from`);
  }

  if (TERMINAL_STATES.includes(current)) {
    return settle(null, false, `${current} is terminal; a finished mission is not restarted, a new one is created`);
  }

  // A production observation is legal from anywhere and changes truth without moving the mission,
  // because what production contains is not a function of where the mission is. Handled before the
  // table for the same reason as pause and interruption: it is legal from almost everywhere, and a
  // table row per state would be the fragile shape this whole repair exists to remove.
  const observed = Object.prototype.hasOwnProperty.call(PRODUCTION_OBSERVATIONS, event)
    ? PRODUCTION_OBSERVATIONS[event as keyof typeof PRODUCTION_OBSERVATIONS]
    : undefined;
  if (observed !== undefined) {
    // An observation taken while the writer is unaccounted for establishes nothing, and "unaccounted
    // for" is read from durable truth rather than from the state name. Keyed on the state
    // (`current === "DEPLOYING"`) this was bypassed in one move: MISSION_INTERRUPTED and
    // MISSION_PAUSED both change the name without the writer reporting, and the same probe then
    // settled a deployable truth, with a second production write seven moves later.
    //
    // Only the old-revision reading is gated. Observing the target revision or an unexpected one is
    // positive evidence of a write and both *tighten* the mission's permissions, so neither can be
    // used to manufacture a second deployment and neither needs the precondition.
    if (observed === "VERIFIED_OLD_PRODUCTION" && !oldRevisionMaySettle(context.deploymentTruth)) {
      return settle(current, true, "the deployment process has not reported back, so reading the old revision does not establish that it did not write", {
        deploymentTruth: null,
      });
    }
    if (observed === null) {
      // Inconclusive. Truth is unchanged on purpose — an observation that failed is not an
      // observation that production is untouched, and the mission stays uncertain until one succeeds.
      return settle(current, true, "the production check did not establish anything; the mission stays uncertain", {
        deploymentTruth: null,
      });
    }
    // An unexpected production SHA is not something another deployment resolves.
    const to: MissionStateV1 = observed === "VERIFIED_UNEXPECTED" ? "BLOCKED" : current;
    return settle(to, true, PRODUCTION_OBSERVATION_REASONS[observed], { deploymentTruth: observed });
  }

  if (event === "MISSION_PAUSED") {
    if (current === "PAUSED") return settle(null, false, "already paused");
    // Pausing writes the current state over the remembered origin, and INTERRUPTED is not a condition
    // — it stands in for one nobody has established yet. Suspending it destroyed the origin the
    // interruption was still carrying: a paused post-deploy mission, interrupted and paused again,
    // kept nothing saying production may have changed and unwound through an unrecorded origin into
    // VERIFYING, two events from writing production a second time. GIT_VERIFIED and GIT_MISMATCH are
    // always available from here, so resolving the interruption first costs nothing.
    if (current === "INTERRUPTED") {
      return settle(null, false, "an interrupted mission has no established condition to suspend; read the repository first", {
        missing: ["a look at the repository, which is the only thing an interruption is waiting for"],
      });
    }
    return settle("PAUSED", true, "paused by request", { resumeState: current });
  }

  if (event === "MISSION_RESUMED") {
    if (current !== "PAUSED") return settle(null, false, "only a paused mission resumes");
    // Refused here rather than inside `resumeTargetFor`, because `null` is the *normal* input on the
    // gate path — `gateOpened` records no origin — and refusing it there would strand every gate
    // answer. Pause is different: it always writes the state it suspended, so a paused mission with no
    // origin has lost it, and `resumeTargetFor(null)` returning VERIFYING put a mission paused
    // mid-deploy two events from writing production again. Same fail-open as the interruption path.
    if (resumeState === null) {
      return settle(null, false, "a paused mission with no recorded origin is not resumed by guessing", {
        missing: ["the state the pause suspended"],
      });
    }
    const target = resumeTargetFor(resumeState);
    if (!target.to) return settle(null, false, target.reason, { missing: target.missing });
    return settle(target.to, true, target.reason, { resumeState: null });
  }

  // Interruption may strike at any live moment, including while paused.
  if (event === "MISSION_INTERRUPTED") {
    // A second interruption must not overwrite the first with `INTERRUPTED` itself, which would erase
    // the very block or gate the record exists to preserve.
    const held = current === "INTERRUPTED" ? interruptedFrom : current;
    return settle("INTERRUPTED", true, "process disappeared; what happened is unknown until checked", {
      interruptedFrom: held,
    });
  }

  const row = TRANSITIONS.find((candidate) => candidate.from === current && candidate.event === event);
  if (!row) return settle(null, false, `${event} is not a legal move from ${current}`);

  // Deployment eligibility is decided from durable truth alone — not inside the READY_FOR_DEPLOYMENT
  // deriver, and not from the current state. Gating it in one row is what failed before:
  // `interruptedFrom` was consulted at exactly one transition and the bypass took a different edge.
  // Placed after the row lookup only so that an event which is not a move at all is reported as such
  // rather than as a production problem; the safety property is unchanged, because a state with no
  // DEPLOY_STARTED row cannot deploy regardless. Any row — fixed or derived, present or added later —
  // must pass this before it executes.
  if (event === "DEPLOY_STARTED" && !deploymentPermittedByTruth(context.deploymentTruth)) {
    return settle(null, false, startDeployment({ from: current, context, resumeState, interruptedFrom }).reason, {
      missing: ["a production observation that says what production actually contains"],
    });
  }
  if ("to" in row) {
    // "The writer has finished" is a fact about a process, so it is read from the durable record of
    // that process — not from the event that claims it, and not from a field the launch already
    // forced true. This branch has now been wrong three ways, each time by finding something that
    // *correlates* with "no writer is running" instead of recording it:
    //
    //   1. `current === "DEPLOYING"` — a state name, which MISSION_INTERRUPTED and MISSION_PAUSED
    //      both erase without the writer reporting anything.
    //   2. the bare `DEPLOY_COMPLETED` event — an assertion by the thing being checked.
    //   3. `productionWriterLeaseAvailable` — vacuous, because `startDeployment` requires it true
    //      before it will launch, so the check read back its own precondition.
    //
    // The fourth attempt records the fact itself. `NOTHING_PROVEN` defaults it false, so an exit
    // nobody established leaves the mission uncertain — the conservative direction, because an
    // unresolved uncertainty costs one production observation and a wrong resolution costs a second
    // production write. Until D2's lease layer can establish it, this edge simply never fires, and
    // `VERIFIED_OLD_PRODUCTION` is unreachable: a mission that cannot prove what happened to
    // production does not get to retry, which is the correct answer rather than a gap.
    if (
      event === "DEPLOY_COMPLETED"
      // Exactly MAY_HAVE_WRITTEN, which only a real DEPLOY_STARTED writes. UNRECORDED does not
      // qualify: a context that lost the field must not be able to drive a settled truth backwards.
      && context.deploymentTruth === "MAY_HAVE_WRITTEN"
      && context.productionWriterLeaseReleasedByThisRun
    ) {
      return settle(row.to, true, "ok", { deploymentTruth: "WRITER_FINISHED_UNVERIFIED" });
    }
    return settle(row.to, true, "ok");
  }

  const derived = row.derive({ from: current, context, resumeState, interruptedFrom });
  // exactOptionalPropertyTypes: the override is only present when the derivation actually set it.
  const over: {
    resumeState?: MissionStateV1 | null;
    missing: string[];
    deploymentTruth?: DeploymentTruthV1 | null;
  } = { missing: derived.missing };
  if (derived.resumeState !== undefined) over.resumeState = derived.resumeState;
  // A permitted deployment makes production uncertain from this moment, and the caller is told so on
  // the same object that grants the move — so persisting the uncertainty and launching the process
  // cannot drift apart into two decisions made in two places.
  if (derived.to === "DEPLOYING") over.deploymentTruth = "MAY_HAVE_WRITTEN";
  if (!derived.to) return settle(null, false, derived.reason, over);
  return settle(derived.to, true, derived.reason, over);
}

/**
 * Every event that would actually succeed from here, for a dashboard or a test to enumerate.
 *
 * Derived by asking `advance` rather than by reading the table, so the two cannot disagree. A
 * separate list was how a move refused by its prerequisites still got advertised as available:
 * whatever context is passed here is the context the answer is true for.
 */
export function legalEventsFrom(
  state: MissionStateV1,
  resumeState: MissionStateV1 | null = null,
  options: MissionAdvanceOptionsV1 = {},
): MissionEventKindV1[] {
  return MISSION_EVENT_KINDS.filter((event) => advance(state, event, resumeState, options).ok);
}

/** True when a mission is waiting on a person rather than on a machine. */
export function awaitsOwner(state: MissionStateV1): boolean {
  return state === "OWNER_GATE_REQUIRED" || state === "WAITING_FOR_OWNER";
}

/** True when nothing will progress without an engineer looking at it. */
export function needsEngineer(state: MissionStateV1): boolean {
  return state === "BLOCKED" || state === "FAILED";
}
