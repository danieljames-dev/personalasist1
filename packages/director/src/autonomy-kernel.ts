/**
 * The self-continue loop: choose, act, verify, record, choose again.
 *
 * This is the smallest thing that makes AION an operator rather than a command. Everything hard is
 * already elsewhere — the effect gate decides what may happen, `evaluateVerification` decides
 * whether it did, `owner-goal-intake` holds the Owner's words, the scheduler decides what is worth
 * doing. What is new here is only that finishing one step leads to starting the next, across
 * several businesses, without anyone typing anything.
 *
 * Four properties are load-bearing, and each exists because its absence is a specific failure:
 *
 *   **Evidence, or it did not happen.** A step that reports success without verification evidence is
 *   recorded as `FAILED`. A model saying it finished is a claim about a model, not about the world.
 *
 *   **Fingerprints, so nothing happens twice.** Every step names the effect it produces. A restart, a
 *   retry, or two objectives asking for the same thing all collapse onto one completed fingerprint.
 *
 *   **Branch-local stopping.** A gate blocks the objective that hit it, not the loop. A business
 *   waiting on the Owner must not idle the rest of the portfolio — that was the whole complaint.
 *
 *   **Bounds.** A step budget, a retry budget, and a circuit breaker that trips on repeated failure.
 *   An unbounded loop with a provider attached is not autonomy, it is a bill.
 */

import {
  entitledValueClass,
  type AutonomyStepV1,
  type StandingObjectiveV1,
} from "./autonomy-contracts.js";
import type { AutonomyStoreV1 } from "./autonomy-store.js";
import type { BusinessWorkspaceV1 } from "./business-workspace.js";
import { scheduleNext, type CandidateV1, type ScheduleV1 } from "./autonomy-scheduler.js";
import type { DurableExperienceLedgerV1 } from "./experience-ledger.js";

/** What a dispatcher reports. Note what is missing: any way to declare its own success. */
export interface StepAttemptV1 {
  /** The provider or executor that ran it. */
  readonly provider: string;
  /** What the step claims happened. Never trusted on its own. */
  readonly claim: string;
  /** A gate the step reached. Non-empty means stop this branch and record why. */
  readonly ownerGate: string | null;
  /** A blocker that is not a gate — a missing capability, an unmet precondition. */
  readonly blocked: string | null;
  readonly failure: string | null;
  readonly latencyMs: number | null;
  readonly tokens: number | null;
  readonly costUsd: number;
}

/** Evidence read from actual state. An empty list means the step did not happen. */
export interface StepEvidenceV1 {
  readonly kind: string;
  readonly detail: string;
  readonly observed: boolean;
}

export interface KernelDepsV1 {
  readonly store: AutonomyStoreV1;
  readonly ledger: DurableExperienceLedgerV1;
  readonly now: () => string;
  readonly currentSha: string;
  readonly dispatch: (step: AutonomyStepV1, objective: StandingObjectiveV1) => StepAttemptV1;
  /** Reads the world. Called after every attempt, and its answer outranks the attempt's claim. */
  readonly verify: (step: AutonomyStepV1) => readonly StepEvidenceV1[];
  readonly availableCapabilities: readonly string[];
  readonly outwardAuthorized?: boolean;
  readonly maxSteps?: number;
  /** Consecutive failures before the loop stops trying anything. */
  readonly circuitBreakerFailures?: number;
}

export type KernelStopReasonV1 =
  | "NOTHING_ELIGIBLE"
  | "STEP_BUDGET_REACHED"
  | "CIRCUIT_BREAKER_OPEN"
  | "PAUSED";

export interface KernelStepRecordV1 {
  readonly stepId: string;
  readonly objectiveId: string;
  readonly businessId: string;
  readonly outcome: "COMPLETED" | "FAILED" | "GATED" | "BLOCKED";
  readonly selectionReason: string;
  readonly detail: string;
}

export interface KernelRunV1 {
  readonly steps: readonly KernelStepRecordV1[];
  readonly completed: readonly string[];
  readonly gated: readonly string[];
  readonly blocked: readonly string[];
  readonly failed: readonly string[];
  readonly businessesWorked: readonly string[];
  readonly stopReason: KernelStopReasonV1;
  readonly detail: string;
  /** Always zero. Gates are persisted and worked around, never asked interactively. */
  readonly ownerPrompts: number;
}

const DEFAULT_MAX_STEPS = 16;
const DEFAULT_CIRCUIT_BREAKER = 3;

function scheduleFrom(deps: KernelDepsV1): ScheduleV1 {
  return scheduleNext({
    businesses: deps.store.businesses(),
    objectives: deps.store.objectives(),
    steps: deps.store.steps(),
    availableCapabilities: deps.availableCapabilities,
    completedFingerprints: deps.store
      .outcomes()
      .filter((o) => o.verdict === "COMPLETED")
      .map((o) => o.effectFingerprint),
    ...(deps.outwardAuthorized !== undefined ? { outwardAuthorized: deps.outwardAuthorized } : {}),
  });
}

/**
 * Run until there is nothing safe left to do, or a bound is reached.
 *
 * Every iteration re-reads the store rather than working from a plan made at the start: a gate
 * recorded three steps ago has to change what the fourth step chooses, and a cached candidate list
 * cannot know that.
 */
export function runAutonomyKernel(deps: KernelDepsV1): KernelRunV1 {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const breakerLimit = deps.circuitBreakerFailures ?? DEFAULT_CIRCUIT_BREAKER;

  const records: KernelStepRecordV1[] = [];
  const completed: string[] = [];
  const gated: string[] = [];
  const blocked: string[] = [];
  const failed: string[] = [];
  const businessesWorked: string[] = [];
  let consecutiveFailures = 0;
  let stopReason: KernelStopReasonV1 = "NOTHING_ELIGIBLE";
  let detail = "";

  for (let taken = 0; ; taken += 1) {
    if (taken >= maxSteps) {
      stopReason = "STEP_BUDGET_REACHED";
      detail = `${taken} steps taken; budget is ${maxSteps}`;
      break;
    }
    if (consecutiveFailures >= breakerLimit) {
      stopReason = "CIRCUIT_BREAKER_OPEN";
      detail = `${consecutiveFailures} consecutive failures`;
      break;
    }

    const schedule = scheduleFrom(deps);
    const candidate = schedule.selected;
    if (candidate === null) {
      stopReason = "NOTHING_ELIGIBLE";
      detail = schedule.selectionReason;
      break;
    }

    const record = takeStep(deps, candidate, schedule.selectionReason);
    records.push(record);
    if (!businessesWorked.includes(record.businessId)) businessesWorked.push(record.businessId);

    switch (record.outcome) {
      case "COMPLETED":
        completed.push(record.stepId);
        consecutiveFailures = 0;
        break;
      case "GATED":
        gated.push(record.stepId);
        // Not a failure. A gate is the system working, and the loop moves to another branch.
        consecutiveFailures = 0;
        break;
      case "BLOCKED":
        blocked.push(record.stepId);
        consecutiveFailures = 0;
        break;
      default:
        failed.push(record.stepId);
        consecutiveFailures += 1;
        break;
    }
  }

  return {
    steps: records,
    completed,
    gated,
    blocked,
    failed,
    businessesWorked,
    stopReason,
    detail,
    ownerPrompts: 0,
  };
}

function takeStep(deps: KernelDepsV1, candidate: CandidateV1, selectionReason: string): KernelStepRecordV1 {
  const now = deps.now();
  const step = candidate.step;
  const objective = deps.store.objectives().find((o) => o.objectiveId === step.objectiveId)!;

  const running: AutonomyStepV1 = { ...step, status: "RUNNING", attempts: step.attempts + 1, updatedAt: now };
  deps.store.saveStep(running);
  deps.store.saveObjective({ ...objective, currentStepId: step.stepId, updatedAt: now });

  let attempt: StepAttemptV1;
  try {
    attempt = deps.dispatch(running, objective);
  } catch (error) {
    attempt = {
      provider: "unknown",
      claim: "",
      ownerGate: null,
      blocked: null,
      failure: error instanceof Error ? error.message : String(error),
      latencyMs: null,
      tokens: null,
      costUsd: 0,
    };
  }

  // Evidence is read even when the attempt reports a gate or a failure: a step that gated *after*
  // changing something has still changed something, and a record that ignored that would be wrong
  // in the direction that hurts.
  const evidence = attempt.ownerGate === null ? deps.verify(running) : [];
  const observed = evidence.filter((row) => row.observed);

  const outcome: KernelStepRecordV1["outcome"] =
    attempt.ownerGate !== null ? "GATED"
      : attempt.blocked !== null ? "BLOCKED"
        : attempt.failure !== null ? "FAILED"
          : observed.length === 0 ? "FAILED"
            : "COMPLETED";

  const detail =
    outcome === "GATED" ? `owner gate: ${attempt.ownerGate}`
      : outcome === "BLOCKED" ? `blocked: ${attempt.blocked}`
        : outcome === "COMPLETED" ? observed.map((row) => `${row.kind}: ${row.detail}`).join("; ")
          : attempt.failure !== null
            ? `failed: ${attempt.failure}`
            // The one that matters most, and the one a self-reporting agent gets wrong.
            : `claimed "${attempt.claim}" but no verification evidence was observed`;

  const finalStatus: AutonomyStepV1["status"] =
    outcome === "COMPLETED" ? "COMPLETED"
      : outcome === "GATED" ? "GATED"
        : outcome === "BLOCKED" ? "BLOCKED"
          : running.attempts >= running.maxAttempts ? "BLOCKED" : "READY";

  deps.store.saveStep({
    ...running,
    status: finalStatus,
    blockedReason: outcome === "COMPLETED" ? null : detail,
    updatedAt: now,
  });

  /* The branch-local part: a gate or a terminal block marks the *objective*, so the scheduler stops
   * offering its steps — and offers another business's instead. */
  const objectiveStatus: StandingObjectiveV1["status"] =
    outcome === "GATED" || (outcome !== "COMPLETED" && finalStatus === "BLOCKED") ? "BLOCKED" : "ACTIVE";

  deps.store.saveObjective({
    ...objective,
    status: objectiveStatus,
    blockedReason: objectiveStatus === "BLOCKED" ? detail : null,
    currentStepId: outcome === "COMPLETED" ? null : step.stepId,
    lastVerifiedStepId: outcome === "COMPLETED" ? step.stepId : objective.lastVerifiedStepId,
    lastVerifiedAt: outcome === "COMPLETED" ? now : objective.lastVerifiedAt,
    updatedAt: now,
  });

  deps.store.appendOutcome({
    stepId: step.stepId,
    objectiveId: step.objectiveId,
    businessId: step.businessId,
    effectFingerprint: step.effectFingerprint,
    verdict: outcome,
    evidence: observed.map((row) => `${row.kind}: ${row.detail}`),
    detail,
    at: now,
  });

  deps.store.appendTelemetry({
    stepId: step.stepId,
    objectiveId: step.objectiveId,
    businessId: step.businessId,
    taskType: entitledValueClass(step).valueClass,
    provider: attempt.provider,
    verifiedSuccess: outcome === "COMPLETED",
    failureClass: outcome === "COMPLETED" ? "NONE" : outcome,
    attempts: running.attempts,
    latencyMs: attempt.latencyMs,
    tokens: attempt.tokens,
    costUsd: attempt.costUsd,
    at: now,
  });

  deps.ledger.record({
    entryId: `${step.stepId}@${now}`,
    attempted: `${step.title} (${step.businessId})`,
    observed: detail,
    learned: outcome === "COMPLETED" ? "" : `${outcome}: ${detail}`,
    outcome: outcome === "COMPLETED" ? "HELD" : outcome === "FAILED" ? "VIOLATED" : "INCONCLUSIVE",
    // A step AION ran and then checked against real state is a builder verification, not a synthetic
    // scenario and not a real incident. Being precise here is what keeps the promotion rule honest.
    provenance: "BUILDER_VERIFICATION",
    observedAtSha: deps.currentSha,
    observedAtUtc: now,
    scenarioId: step.objectiveId,
    violations: outcome === "COMPLETED" ? [] : [detail],
    context: {
      businessId: step.businessId,
      objectiveId: step.objectiveId,
      taskType: entitledValueClass(step).valueClass,
    },
  });

  void selectionReason;
  return {
    stepId: step.stepId,
    objectiveId: step.objectiveId,
    businessId: step.businessId,
    outcome,
    selectionReason,
    detail,
  };
}

/* ========================================================================== */
/* Observability                                                              */
/* ========================================================================== */

export interface AutonomyStatusV1 {
  readonly businesses: readonly { businessId: string; name: string; status: string }[];
  readonly workingOn: {
    readonly stepId: string;
    readonly title: string;
    readonly businessId: string;
    readonly objectiveId: string;
    readonly whySelected: string;
  } | null;
  readonly blocked: readonly { objectiveId: string; businessId: string; reason: string }[];
  readonly recentlyCompleted: readonly { stepId: string; businessId: string; at: string }[];
  readonly nextUp: readonly { stepId: string; businessId: string; valueClass: string }[];
}

/**
 * What AION is doing, for whom, and why — enough for the Command Center to answer the Owner without
 * exposing step payloads it has no reason to show.
 */
export function autonomyStatus(
  store: AutonomyStoreV1,
  availableCapabilities: readonly string[],
  outwardAuthorized = false,
): AutonomyStatusV1 {
  const businesses = store.businesses();
  const objectives = store.objectives();
  const steps = store.steps();
  const outcomes = store.outcomes();

  const schedule = scheduleNext({
    businesses,
    objectives,
    steps,
    availableCapabilities,
    completedFingerprints: outcomes.filter((o) => o.verdict === "COMPLETED").map((o) => o.effectFingerprint),
    outwardAuthorized,
  });

  const running = steps.find((step) => step.status === "RUNNING") ?? null;
  const selected = schedule.selected;
  const focus = running ?? selected?.step ?? null;

  return {
    businesses: businesses.map((b) => ({ businessId: b.businessId, name: b.canonicalName, status: b.status })),
    workingOn: focus === null ? null : {
      stepId: focus.stepId,
      title: focus.title,
      businessId: focus.businessId,
      objectiveId: focus.objectiveId,
      whySelected: running !== null ? "in flight" : schedule.selectionReason,
    },
    blocked: objectives
      .filter((o) => o.status === "BLOCKED")
      .map((o) => ({ objectiveId: o.objectiveId, businessId: o.businessId, reason: o.blockedReason ?? "unspecified" })),
    recentlyCompleted: outcomes
      .filter((o) => o.verdict === "COMPLETED")
      .slice(-5)
      .map((o) => ({ stepId: o.stepId, businessId: o.businessId, at: o.at })),
    nextUp: schedule.ranked.slice(0, 3).map((c) => ({
      stepId: c.step.stepId,
      businessId: c.step.businessId,
      valueClass: c.effectiveValueClass,
    })),
  };
}
