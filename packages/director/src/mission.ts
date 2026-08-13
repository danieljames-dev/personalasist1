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
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export const MISSION_SCHEMA_V1 = "aion.director.mission.v1" as const;

export type MissionStateV1 =
  | "CREATED"
  | "AUTHORIZED"
  | "PLANNING"
  | "EXECUTOR_RUNNING"
  | "EXECUTOR_RESULT_RECEIVED"
  | "VERIFYING"
  | "INDEPENDENT_REVIEW"
  | "READY_FOR_INTEGRATION"
  | "INTEGRATING"
  | "OWNER_GATE_REQUIRED"
  | "WAITING_FOR_OWNER"
  | "WAITING_FOR_CAPACITY"
  | "READY_FOR_DEPLOYMENT"
  | "DEPLOYING"
  | "POST_DEPLOY_VERIFY"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "PAUSED"
  | "INTERRUPTED";

/** States from which nothing further happens without a person. */
export const TERMINAL_STATES: readonly MissionStateV1[] = ["COMPLETED", "FAILED"];

export type MissionEventKindV1 =
  | "MISSION_CREATED"
  | "MISSION_AUTHORIZED"
  | "PLAN_SELECTED"
  | "RUN_CREATED"
  | "EXECUTOR_STARTED"
  | "EXECUTOR_OUTPUT_SUMMARY"
  | "EXECUTOR_COMPLETED"
  | "EXECUTOR_FAILED"
  | "EXECUTOR_CAPACITY_EXHAUSTED"
  | "GIT_VERIFIED"
  | "GIT_MISMATCH"
  | "TEST_STARTED"
  | "TEST_COMPLETED"
  | "TEST_FAILED"
  | "REVIEW_REQUESTED"
  | "REVIEW_COMPLETED"
  | "REVIEW_REJECTED"
  | "OWNER_GATE_OPENED"
  | "OWNER_GATE_RESOLVED"
  | "INTEGRATION_STARTED"
  | "INTEGRATION_COMPLETED"
  | "DEPLOY_STARTED"
  | "DEPLOY_COMPLETED"
  | "POST_DEPLOY_VERIFIED"
  | "MISSION_PAUSED"
  | "MISSION_RESUMED"
  | "MISSION_BLOCKED"
  | "MISSION_INTERRUPTED"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED";

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
  currentRunId: OpaqueId | null;
  currentExecutor: string | null;
  updatedAt: IsoTimestamp;
  /** Monotonic; lets a reader detect a stale copy without comparing timestamps. */
  revision: number;
}

/**
 * The transition table.
 *
 * Read it as: from this state, this event moves you there. Anything absent is refused. Keeping it
 * declarative means the legal shape of a mission can be read in one place rather than reconstructed
 * from branches scattered across a service.
 */
const TRANSITIONS: ReadonlyArray<{
  from: MissionStateV1;
  event: MissionEventKindV1;
  to: MissionStateV1;
}> = [
  { from: "CREATED", event: "MISSION_AUTHORIZED", to: "AUTHORIZED" },
  { from: "AUTHORIZED", event: "PLAN_SELECTED", to: "PLANNING" },
  { from: "PLANNING", event: "RUN_CREATED", to: "PLANNING" },
  { from: "PLANNING", event: "EXECUTOR_STARTED", to: "EXECUTOR_RUNNING" },

  // An executor finishing is never the same as its work being correct.
  { from: "EXECUTOR_RUNNING", event: "EXECUTOR_COMPLETED", to: "EXECUTOR_RESULT_RECEIVED" },
  { from: "EXECUTOR_RUNNING", event: "EXECUTOR_FAILED", to: "VERIFYING" },
  { from: "EXECUTOR_RUNNING", event: "EXECUTOR_CAPACITY_EXHAUSTED", to: "WAITING_FOR_CAPACITY" },
  { from: "EXECUTOR_RUNNING", event: "MISSION_INTERRUPTED", to: "INTERRUPTED" },
  { from: "WAITING_FOR_CAPACITY", event: "EXECUTOR_STARTED", to: "EXECUTOR_RUNNING" },

  // Everything an executor claims passes through verification before it counts.
  { from: "EXECUTOR_RESULT_RECEIVED", event: "GIT_VERIFIED", to: "VERIFYING" },
  { from: "EXECUTOR_RESULT_RECEIVED", event: "GIT_MISMATCH", to: "BLOCKED" },
  { from: "VERIFYING", event: "TEST_STARTED", to: "VERIFYING" },
  { from: "VERIFYING", event: "TEST_COMPLETED", to: "VERIFYING" },
  { from: "VERIFYING", event: "TEST_FAILED", to: "BLOCKED" },
  { from: "VERIFYING", event: "REVIEW_REQUESTED", to: "INDEPENDENT_REVIEW" },
  { from: "VERIFYING", event: "MISSION_BLOCKED", to: "BLOCKED" },
  { from: "VERIFYING", event: "OWNER_GATE_OPENED", to: "OWNER_GATE_REQUIRED" },

  // A rejected review returns to planning so the repair is a new run, not a silent retry.
  { from: "INDEPENDENT_REVIEW", event: "REVIEW_COMPLETED", to: "READY_FOR_INTEGRATION" },
  { from: "INDEPENDENT_REVIEW", event: "REVIEW_REJECTED", to: "PLANNING" },

  { from: "READY_FOR_INTEGRATION", event: "OWNER_GATE_OPENED", to: "OWNER_GATE_REQUIRED" },
  { from: "READY_FOR_INTEGRATION", event: "INTEGRATION_STARTED", to: "INTEGRATING" },
  { from: "INTEGRATING", event: "INTEGRATION_COMPLETED", to: "READY_FOR_DEPLOYMENT" },
  { from: "INTEGRATING", event: "GIT_MISMATCH", to: "BLOCKED" },

  // Deployment always passes a gate. There is no path from integration straight to deploying.
  { from: "READY_FOR_DEPLOYMENT", event: "OWNER_GATE_OPENED", to: "OWNER_GATE_REQUIRED" },
  { from: "READY_FOR_DEPLOYMENT", event: "DEPLOY_STARTED", to: "DEPLOYING" },
  { from: "DEPLOYING", event: "DEPLOY_COMPLETED", to: "POST_DEPLOY_VERIFY" },
  { from: "POST_DEPLOY_VERIFIED" as MissionStateV1, event: "MISSION_COMPLETED", to: "COMPLETED" },
  { from: "POST_DEPLOY_VERIFY", event: "POST_DEPLOY_VERIFIED", to: "POST_DEPLOY_VERIFY" },
  { from: "POST_DEPLOY_VERIFY", event: "MISSION_COMPLETED", to: "COMPLETED" },
  { from: "POST_DEPLOY_VERIFY", event: "MISSION_FAILED", to: "FAILED" },

  // A gate is answered, not replaced by a new mission.
  { from: "OWNER_GATE_REQUIRED", event: "MISSION_PAUSED", to: "WAITING_FOR_OWNER" },
  { from: "OWNER_GATE_REQUIRED", event: "OWNER_GATE_RESOLVED", to: "PLANNING" },
  { from: "WAITING_FOR_OWNER", event: "OWNER_GATE_RESOLVED", to: "PLANNING" },

  { from: "VERIFYING", event: "MISSION_COMPLETED", to: "COMPLETED" },
  { from: "READY_FOR_INTEGRATION", event: "MISSION_COMPLETED", to: "COMPLETED" },

  // Interruption is a question, not a verdict: what actually happened is decided by looking.
  { from: "INTERRUPTED", event: "GIT_VERIFIED", to: "VERIFYING" },
  { from: "INTERRUPTED", event: "GIT_MISMATCH", to: "BLOCKED" },

  { from: "BLOCKED", event: "MISSION_FAILED", to: "FAILED" },
  { from: "BLOCKED", event: "PLAN_SELECTED", to: "PLANNING" },
];

export interface TransitionResultV1 {
  ok: boolean;
  from: MissionStateV1;
  to: MissionStateV1 | null;
  reason: string;
}

/**
 * Move a mission, or explain why it may not move.
 *
 * Pause is handled outside the table because it is legal from almost anywhere and must remember
 * where it came from — a pause that forgot its origin would turn into a restart.
 */
export function advance(
  current: MissionStateV1,
  event: MissionEventKindV1,
  resumeState: MissionStateV1 | null = null,
): TransitionResultV1 & { resumeState: MissionStateV1 | null } {
  if (TERMINAL_STATES.includes(current)) {
    return {
      ok: false, from: current, to: null, resumeState,
      reason: `${current} is terminal; a finished mission is not restarted, a new one is created`,
    };
  }

  if (event === "MISSION_PAUSED") {
    if (current === "PAUSED") {
      return { ok: false, from: current, to: null, resumeState, reason: "already paused" };
    }
    return { ok: true, from: current, to: "PAUSED", resumeState: current, reason: "paused by request" };
  }

  if (event === "MISSION_RESUMED") {
    if (current !== "PAUSED") {
      return { ok: false, from: current, to: null, resumeState, reason: "only a paused mission resumes" };
    }
    if (!resumeState) {
      // Without a remembered origin, verification is the only safe destination: it looks before
      // acting rather than assuming the interrupted step needs repeating.
      return { ok: true, from: current, to: "VERIFYING", resumeState: null, reason: "resumed; origin unknown, so verify first" };
    }
    return { ok: true, from: current, to: resumeState, resumeState: null, reason: "resumed where it left off" };
  }

  // Interruption may strike at any live moment, including while paused.
  if (event === "MISSION_INTERRUPTED") {
    return { ok: true, from: current, to: "INTERRUPTED", resumeState, reason: "process disappeared; what happened is unknown until checked" };
  }

  const match = TRANSITIONS.find((t) => t.from === current && t.event === event);
  if (!match) {
    return {
      ok: false, from: current, to: null, resumeState,
      reason: `${event} is not a legal move from ${current}`,
    };
  }
  return { ok: true, from: current, to: match.to, resumeState, reason: "ok" };
}

/** Every state reachable from here in one step, for a dashboard or a test to enumerate. */
export function legalEventsFrom(state: MissionStateV1): MissionEventKindV1[] {
  if (TERMINAL_STATES.includes(state)) return [];
  const named = TRANSITIONS.filter((t) => t.from === state).map((t) => t.event);
  const universal: MissionEventKindV1[] = state === "PAUSED"
    ? ["MISSION_RESUMED", "MISSION_INTERRUPTED"]
    : ["MISSION_PAUSED", "MISSION_INTERRUPTED"];
  return [...new Set([...named, ...universal])];
}

/** True when a mission is waiting on a person rather than on a machine. */
export function awaitsOwner(state: MissionStateV1): boolean {
  return state === "OWNER_GATE_REQUIRED" || state === "WAITING_FOR_OWNER";
}

/** True when nothing will progress without an engineer looking at it. */
export function needsEngineer(state: MissionStateV1): boolean {
  return state === "BLOCKED" || state === "FAILED";
}
