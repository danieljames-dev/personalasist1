/**
 * Which of everything AION could safely do next is worth doing.
 *
 * This is a policy, not a model. It is written to be read, argued with and corrected by a person,
 * because a scheduler nobody can interrogate is a scheduler nobody can fix — and the specific
 * failure it exists to prevent is an agent spending forever improving its own scaffolding, which is
 * always available, always tractable, and never what the Owner asked for.
 *
 * The ordering, strongest first:
 *
 *   1. **Value class.** Real business value, then a *proven* capability blocker, then a *measured*
 *      reliability defect, then speculative infrastructure. A step claiming to be proven or measured
 *      without naming its evidence is downgraded to speculative before it is ranked.
 *   2. **Owner priority**, when the Owner stated one. Absent is absent, not zero.
 *   3. **Evidence-weighted value** — `expectedValue × confidence`. This is the line that stops the
 *      scheduler chasing fiction: a large unevidenced number does not beat a smaller evidenced one.
 *   4. **Cheapness to the Owner.** Work that does not need his hours ranks above work that does.
 *   5. **Fewer prior attempts.** Something that has failed twice does not deserve a third go ahead
 *      of untried work.
 *   6. **Step id**, so two readers never disagree.
 *
 * Ineligibility is separate from ranking and comes first: a step whose business is not active, whose
 * objective is blocked or paused, whose dependencies are unmet, whose capabilities are missing, whose
 * retries are exhausted, or whose effect would leave the machine, is not a candidate at all. Being
 * unrankable and being disallowed are different answers and are kept apart.
 */

import {
  entitledValueClass,
  valueRank,
  type AutonomyStepV1,
  type StandingObjectiveV1,
  type ValueClassV1,
} from "./autonomy-contracts.js";
import { SCHEDULABLE_BUSINESS_STATUSES_V1, type BusinessWorkspaceV1 } from "./business-workspace.js";

export const INELIGIBILITY_REASONS_V1 = [
  "BUSINESS_NOT_ACTIVE",
  "OBJECTIVE_NOT_ACTIVE",
  "STEP_NOT_READY",
  "DEPENDENCY_UNMET",
  "CAPABILITY_UNAVAILABLE",
  "RETRIES_EXHAUSTED",
  "OUTWARD_EFFECT_NOT_AUTHORIZED",
  "ALREADY_DONE",
] as const;
export type IneligibilityReasonV1 = (typeof INELIGIBILITY_REASONS_V1)[number];

export interface SchedulerInputV1 {
  readonly businesses: readonly BusinessWorkspaceV1[];
  readonly objectives: readonly StandingObjectiveV1[];
  readonly steps: readonly AutonomyStepV1[];
  /** Capabilities this process can actually execute right now. */
  readonly availableCapabilities: readonly string[];
  /** Effect fingerprints already completed. The duplicate-work guard. */
  readonly completedFingerprints: readonly string[];
  /**
   * Whether outward effects are authorized. Fail-closed: the caller must say yes explicitly, and
   * under every directive to date the answer is no.
   */
  readonly outwardAuthorized?: boolean;
}

export interface CandidateV1 {
  readonly step: AutonomyStepV1;
  readonly effectiveValueClass: ValueClassV1;
  readonly downgraded: boolean;
  readonly evidenceWeightedValue: number;
  readonly reason: string;
}

export interface RejectionV1 {
  readonly stepId: string;
  readonly businessId: string;
  readonly reason: IneligibilityReasonV1;
  readonly detail: string;
}

export interface ScheduleV1 {
  readonly selected: CandidateV1 | null;
  readonly ranked: readonly CandidateV1[];
  readonly rejected: readonly RejectionV1[];
  /** Why the winner won, in one sentence a person can check. */
  readonly selectionReason: string;
}

function eligibility(
  step: AutonomyStepV1,
  input: SchedulerInputV1,
  byId: ReadonlyMap<string, AutonomyStepV1>,
): RejectionV1 | null {
  const reject = (reason: IneligibilityReasonV1, detail: string): RejectionV1 => ({
    stepId: step.stepId,
    businessId: step.businessId,
    reason,
    detail,
  });

  const business = input.businesses.find((b) => b.businessId === step.businessId);
  if (business === undefined || !SCHEDULABLE_BUSINESS_STATUSES_V1.includes(business.status)) {
    return reject("BUSINESS_NOT_ACTIVE", `business ${step.businessId} is ${business?.status ?? "unknown"}`);
  }

  const objective = input.objectives.find((o) => o.objectiveId === step.objectiveId);
  if (objective === undefined || objective.status !== "ACTIVE") {
    return reject(
      "OBJECTIVE_NOT_ACTIVE",
      objective === null || objective === undefined
        ? `objective ${step.objectiveId} is unknown`
        : `objective ${step.objectiveId} is ${objective.status}${objective.blockedReason ? `: ${objective.blockedReason}` : ""}`,
    );
  }

  if (input.completedFingerprints.includes(step.effectFingerprint)) {
    return reject("ALREADY_DONE", `effect ${step.effectFingerprint} is already recorded as done`);
  }
  if (step.status !== "READY") return reject("STEP_NOT_READY", `step is ${step.status}`);
  if (step.attempts >= step.maxAttempts) {
    return reject("RETRIES_EXHAUSTED", `${step.attempts} of ${step.maxAttempts} attempts used`);
  }

  const unmet = step.dependsOn.filter((id) => byId.get(id)?.status !== "COMPLETED");
  if (unmet.length > 0) return reject("DEPENDENCY_UNMET", `waiting on ${unmet.join(", ")}`);

  const missing = step.requiredCapabilities.filter((c) => !input.availableCapabilities.includes(c));
  if (missing.length > 0) return reject("CAPABILITY_UNAVAILABLE", `missing ${missing.join(", ")}`);

  // Fail-closed. An outward step is a candidate only when someone said so out loud.
  if (step.effectScope !== "LOCAL_SHADOW" && input.outwardAuthorized !== true) {
    return reject("OUTWARD_EFFECT_NOT_AUTHORIZED", `${step.effectScope} effects are not authorized`);
  }
  return null;
}

/** `expectedValue` discounted by how much the estimate is worth. Never negative. */
export function evidenceWeightedValue(step: AutonomyStepV1): number {
  const confidence = Math.min(1, Math.max(0, step.confidence));
  return Math.max(0, step.expectedValue) * confidence;
}

export function scheduleNext(input: SchedulerInputV1): ScheduleV1 {
  const byId = new Map(input.steps.map((s) => [s.stepId, s]));
  const rejected: RejectionV1[] = [];
  const candidates: CandidateV1[] = [];

  for (const step of input.steps) {
    const rejection = eligibility(step, input, byId);
    if (rejection !== null) {
      rejected.push(rejection);
      continue;
    }
    const entitled = entitledValueClass(step);
    candidates.push({
      step,
      effectiveValueClass: entitled.valueClass,
      downgraded: entitled.downgraded,
      evidenceWeightedValue: evidenceWeightedValue(step),
      reason: entitled.reason,
    });
  }

  const objectivePriority = new Map(
    input.objectives.map((o) => [o.objectiveId, o.ownerPriority]),
  );

  const ranked = [...candidates].sort((a, b) => {
    const value = valueRank(a.effectiveValueClass) - valueRank(b.effectiveValueClass);
    if (value !== 0) return value;

    // Owner-stated priority, when stated. An objective the Owner said nothing about does not lose
    // to one he did — it is simply ranked on the evidence instead.
    const pa = objectivePriority.get(a.step.objectiveId) ?? null;
    const pb = objectivePriority.get(b.step.objectiveId) ?? null;
    if (pa !== null && pb !== null && pa !== pb) return pb - pa;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;

    if (a.evidenceWeightedValue !== b.evidenceWeightedValue) {
      return b.evidenceWeightedValue - a.evidenceWeightedValue;
    }
    if (a.step.ownerTimeMinutes !== b.step.ownerTimeMinutes) {
      return a.step.ownerTimeMinutes - b.step.ownerTimeMinutes;
    }
    if (a.step.attempts !== b.step.attempts) return a.step.attempts - b.step.attempts;
    return a.step.stepId.localeCompare(b.step.stepId);
  });

  const selected = ranked[0] ?? null;
  const selectionReason = selected === null
    ? `nothing eligible: ${rejected.length} step(s) rejected`
    : `${selected.step.stepId} for ${selected.step.businessId}: ${selected.effectiveValueClass}`
      + `${selected.downgraded ? " (downgraded — " + selected.reason + ")" : ""}`
      + `, evidence-weighted value ${selected.evidenceWeightedValue.toFixed(2)}`
      + `, ${selected.step.ownerTimeMinutes} Owner minutes`
      + `, attempt ${selected.step.attempts + 1} of ${selected.step.maxAttempts}`;

  return { selected, ranked, rejected, selectionReason };
}
