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
 * event, never asserted by the event itself, and a gate's `resumeState` is checked against an
 * allowlist before it is honoured — an externally supplied string must never select where a mission
 * lands.
 *
 * ## Why an interruption remembers what it interrupted
 *
 * An interruption says execution continuity is uncertain. It says nothing about whether a gate was
 * answered, a block cleared, or quota returned. Sending every re-verified interruption to `VERIFYING`
 * turned `MISSION_INTERRUPTED` into a way of laundering a blocker away, so the state held at the
 * moment of the interruption is carried through it and the mission returns to that semantic
 * condition — unless the durable record shows the condition itself has genuinely changed.
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
  /** The single production-writer lease is free to take. */
  productionWriterLeaseAvailable: boolean;
}

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
};

function establish(supplied: Partial<MissionContextV1> | undefined): MissionContextV1 {
  return { ...NOTHING_PROVEN, ...(supplied ?? {}) };
}

// ---------------------------------------------------------------------------
// Where a suspended mission may be put back
// ---------------------------------------------------------------------------

/**
 * The only states a mission may be resumed *into*.
 *
 * A resume target arrives from outside — a paused record, or a gate's `resumeState`, both of which
 * are files an executor or a stale process may have written. Naming a state must therefore never be
 * enough to occupy it. Everything here re-enters at a point that still has its own checks in front of
 * it; the live-work states are absent because nothing observed them survive the suspension.
 */
export const RESUMABLE_STATES: readonly MissionStateV1[] = [
  "PLANNING",
  "VERIFYING",
  "INDEPENDENT_REVIEW",
  "READY_FOR_INTEGRATION",
  "READY_FOR_DEPLOYMENT",
  "WAITING_FOR_CAPACITY",
  "OWNER_GATE_REQUIRED",
  "WAITING_FOR_OWNER",
  "BLOCKED",
];

/**
 * Targets that are refused outright rather than softened.
 *
 * The terminal two would let a supplied string declare an outcome. The other two sit past a check
 * they would skip: `DEPLOYING` is the far side of the deployment prerequisites, and
 * `POST_DEPLOY_VERIFY` is one event away from `COMPLETED` without a deployment having happened.
 */
const REFUSED_RESUME_TARGETS: readonly MissionStateV1[] = [
  "COMPLETED",
  "FAILED",
  "DEPLOYING",
  "POST_DEPLOY_VERIFY",
];

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
 * Three outcomes, because three situations differ. A target that would select an outcome or skip a
 * check is refused and the attempt fails loudly. A legitimate origin that simply cannot be re-entered
 * — a run whose process is gone, an integration whose lease was dropped — resumes by looking at the
 * repository instead, which is the same answer as having forgotten the origin entirely. Anything on
 * the allowlist is restored as it stands.
 */
function resumeTargetFor(candidate: MissionStateV1 | null): DerivationV1 {
  if (candidate === null) {
    return { to: "VERIFYING", reason: "resumed; origin unknown, so verify first", missing: [] };
  }
  if (REFUSED_RESUME_TARGETS.includes(candidate)) {
    return {
      to: null,
      reason: `${candidate} cannot be entered by being named; it is either an outcome or the far side of a check`,
      missing: [`whatever ${candidate} would have skipped`],
    };
  }
  if (!RESUMABLE_STATES.includes(candidate)) {
    return {
      to: "VERIFYING",
      reason: `${candidate} did not survive the suspension, so the repository is read before anything continues`,
      missing: [],
    };
  }
  return { to: candidate, reason: "resumed where it left off", missing: [] };
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
 * durable gate records, and where the mission continues is the gate's own resume target — checked
 * against the allowlist, because a gate file that says `COMPLETED` must not complete a mission.
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
 * Come back from an interruption to the condition that was true before it.
 *
 * A dead process does not answer a gate, unblock a block or refill quota, so re-verification returns
 * to those conditions rather than to plain verification. The gate case is the one exception worth
 * spelling out: the Owner may genuinely have answered while nothing was running, and the durable gate
 * count — not the interruption — is what says so.
 */
const reVerifyAfterInterruption: TransitionDeriverV1 = ({ context, interruptedFrom }) => {
  if (interruptedFrom === "BLOCKED") {
    return { to: "BLOCKED", reason: "the repository matches, but the block that preceded the interruption stands", missing: [] };
  }
  if (interruptedFrom === "WAITING_FOR_CAPACITY") {
    return { to: "WAITING_FOR_CAPACITY", reason: "a process dying does not return an executor's quota", missing: [] };
  }
  if (interruptedFrom === "PAUSED") {
    return { to: "PAUSED", reason: "the mission was paused before the interruption and is paused still", missing: [] };
  }
  if (interruptedFrom === "OWNER_GATE_REQUIRED" || interruptedFrom === "WAITING_FOR_OWNER") {
    const stillGated = ownerGateCondition(context);
    if (stillGated) {
      return { to: stillGated, reason: "the gate open before the interruption is open still", missing: [] };
    }
    return { to: "VERIFYING", reason: "the gate was answered while nothing was running, so verification continues", missing: [] };
  }
  return { to: "VERIFYING", reason: "the repository matches, so what happened is checked rather than repeated", missing: [] };
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
    over: { resumeState?: MissionStateV1 | null; interruptedFrom?: MissionStateV1 | null; missing?: string[] } = {},
  ): MissionTransitionV1 => ({
    ok,
    from: current,
    to,
    reason,
    resumeState: over.resumeState !== undefined ? over.resumeState : resumeState,
    interruptedFrom: over.interruptedFrom !== undefined ? over.interruptedFrom : interruptedFrom,
    missing: over.missing ?? [],
  });

  if (TERMINAL_STATES.includes(current)) {
    return settle(null, false, `${current} is terminal; a finished mission is not restarted, a new one is created`);
  }

  if (event === "MISSION_PAUSED") {
    if (current === "PAUSED") return settle(null, false, "already paused");
    return settle("PAUSED", true, "paused by request", { resumeState: current });
  }

  if (event === "MISSION_RESUMED") {
    if (current !== "PAUSED") return settle(null, false, "only a paused mission resumes");
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
  if ("to" in row) return settle(row.to, true, "ok");

  const derived = row.derive({ from: current, context, resumeState, interruptedFrom });
  // exactOptionalPropertyTypes: the override is only present when the derivation actually set it.
  const over: { resumeState?: MissionStateV1 | null; missing: string[] } = { missing: derived.missing };
  if (derived.resumeState !== undefined) over.resumeState = derived.resumeState;
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
