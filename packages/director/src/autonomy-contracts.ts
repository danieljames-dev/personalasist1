/**
 * What the autonomy kernel holds: standing objectives, and the bounded steps that advance them.
 *
 * A standing objective is not a re-statement of the Owner's goal. `owner-goal-intake.ts` already
 * captures the Owner's exact wording, the domain, the urgency **only when stated**, the success
 * criteria **only when stated**, the constraints and the provenance — and that distinction between
 * stated and absent is the thing most worth preserving. So a standing objective *references* the
 * intent by id and adds only what intake has no opinion about: which business it belongs to, where
 * it is in its life, what it is doing next, and what stopped it.
 */

import type { OwnerGoalIntentV1 } from "./owner-goal-intake.js";

export const STANDING_OBJECTIVE_SCHEMA_V1 = "aion.director.standingObjective.v1" as const;
export const AUTONOMY_STEP_SCHEMA_V1 = "aion.director.autonomyStep.v1" as const;
export const AUTONOMY_STORE_RELATIVE_PATH = ".aion-local/autonomy";

export const OBJECTIVE_STATUSES_V1 = ["ACTIVE", "PAUSED", "COMPLETED", "BLOCKED"] as const;
export type ObjectiveStatusV1 = (typeof OBJECTIVE_STATUSES_V1)[number];

/**
 * The product priority rule, as a type.
 *
 * Ordered strongest to weakest, and the order is the policy: real value outranks a proven blocker,
 * which outranks a measured defect, which outranks infrastructure nobody has shown a need for. The
 * failure mode this exists to prevent is an agent improving its own scaffolding forever because
 * scaffolding is the thing it is best at.
 */
export const VALUE_CLASSES_V1 = [
  "REAL_USER_OR_BUSINESS_VALUE",
  "PROVEN_CAPABILITY_BLOCKER",
  "MEASURED_RELIABILITY_DEFECT",
  "SPECULATIVE_INFRASTRUCTURE",
] as const;
export type ValueClassV1 = (typeof VALUE_CLASSES_V1)[number];

/** Lower is better. Used directly by the scheduler so the ordering is the declaration. */
export function valueRank(value: ValueClassV1): number {
  return VALUE_CLASSES_V1.indexOf(value);
}

/**
 * Classes that may only be claimed with evidence.
 *
 * "Proven" and "measured" are not adjectives a step gets to apply to itself. Without a named
 * artifact — a discovery-campaign finding, a failing case, a recorded defect — the claim collapses
 * to `SPECULATIVE_INFRASTRUCTURE`, which is where unevidenced infrastructure work belongs.
 */
export const EVIDENCE_BACKED_CLASSES_V1: readonly ValueClassV1[] = [
  "PROVEN_CAPABILITY_BLOCKER",
  "MEASURED_RELIABILITY_DEFECT",
];

export const EFFECT_SCOPES_V1 = ["LOCAL_SHADOW", "OUTWARD", "PRODUCTION"] as const;
export type EffectScopeV1 = (typeof EFFECT_SCOPES_V1)[number];

export const STEP_STATUSES_V1 = ["READY", "RUNNING", "COMPLETED", "FAILED", "GATED", "BLOCKED"] as const;
export type StepStatusV1 = (typeof STEP_STATUSES_V1)[number];

export interface StandingObjectiveV1 {
  readonly schema: typeof STANDING_OBJECTIVE_SCHEMA_V1;
  readonly objectiveId: string;
  /** The business this objective belongs to. Every objective has exactly one. */
  readonly businessId: string;
  /** The `OwnerGoalIntentV1` this came from. The Owner's words live there, not here. */
  readonly goalId: string;
  /** Exactly what the Owner typed, carried for display. Never rewritten. */
  readonly ownerText: string;
  readonly status: ObjectiveStatusV1;
  /**
   * Owner-stated priority and urgency, or `null`.
   *
   * `null` means the Owner did not say, and the scheduler treats it as absent rather than as zero.
   * Inventing a priority is inventing an instruction.
   */
  readonly ownerPriority: number | null;
  readonly urgency: string | null;
  /** Only what the Owner stated. Empty is a legitimate and common answer. */
  readonly successCriteria: readonly string[];
  readonly constraints: readonly string[];
  /** Step id currently in flight or next up, or `null`. */
  readonly currentStepId: string | null;
  /** The last step whose completion was backed by verification evidence. */
  readonly lastVerifiedStepId: string | null;
  readonly lastVerifiedAt: string | null;
  readonly blockedReason: string | null;
  readonly provenance: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutonomyStepV1 {
  readonly schema: typeof AUTONOMY_STEP_SCHEMA_V1;
  readonly stepId: string;
  readonly objectiveId: string;
  readonly businessId: string;
  readonly title: string;
  readonly valueClass: ValueClassV1;
  /**
   * What makes `PROVEN_CAPABILITY_BLOCKER` or `MEASURED_RELIABILITY_DEFECT` true.
   *
   * Empty is fine for the other two classes. Empty for those two is a downgrade, not an error:
   * the step still runs, it just stops outranking real work on a claim it cannot support.
   */
  readonly evidenceRefs: readonly string[];
  readonly effectScope: EffectScopeV1;
  readonly status: StepStatusV1;
  readonly dependsOn: readonly string[];
  /** Rough expected value, and how much that estimate is worth. Both are inputs, neither is a fact. */
  readonly expectedValue: number;
  /** 0..1. An unevidenced large number must not beat an evidenced small one. */
  readonly confidence: number;
  /** Owner minutes this step is expected to consume. Cheap for the Owner ranks higher. */
  readonly ownerTimeMinutes: number;
  readonly requiredCapabilities: readonly string[];
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly blockedReason: string | null;
  /**
   * Stable identity of the *effect* this step produces.
   *
   * Two steps with the same fingerprint are the same work. This is what stops a restart, a retry or
   * a duplicated objective from doing the same thing twice.
   */
  readonly effectFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The value class a step is actually entitled to.
 *
 * A step claiming to fix a proven blocker without naming the proof is doing speculative
 * infrastructure work under a better name, so that is what it gets called.
 */
export function entitledValueClass(step: Pick<AutonomyStepV1, "valueClass" | "evidenceRefs">): {
  readonly valueClass: ValueClassV1;
  readonly downgraded: boolean;
  readonly reason: string;
} {
  if (!EVIDENCE_BACKED_CLASSES_V1.includes(step.valueClass)) {
    return { valueClass: step.valueClass, downgraded: false, reason: "class needs no evidence" };
  }
  if (step.evidenceRefs.length > 0) {
    return {
      valueClass: step.valueClass,
      downgraded: false,
      reason: `evidence: ${step.evidenceRefs.join(", ")}`,
    };
  }
  return {
    valueClass: "SPECULATIVE_INFRASTRUCTURE",
    downgraded: true,
    reason: `${step.valueClass} claimed with no evidence; treated as speculative infrastructure`,
  };
}

/**
 * Build a standing objective from an intake intent.
 *
 * Every Owner-stated field is copied through unchanged, and nothing absent is filled in. If the
 * Owner did not state success criteria, this objective has none, and no later stage may add them.
 */
export function buildStandingObjective(input: {
  intent: OwnerGoalIntentV1;
  businessId: string;
  now: string;
  ownerPriority?: number | null;
}): StandingObjectiveV1 {
  if (String(input.businessId).trim() === "") {
    throw new Error("a standing objective must belong to a business");
  }
  return {
    schema: STANDING_OBJECTIVE_SCHEMA_V1,
    objectiveId: `${input.businessId}:${input.intent.goalId}`,
    businessId: input.businessId,
    goalId: input.intent.goalId,
    ownerText: input.intent.originalText,
    status: "ACTIVE",
    ownerPriority: input.ownerPriority ?? null,
    urgency: input.intent.urgency,
    successCriteria: input.intent.successCriteria,
    constraints: input.intent.constraints,
    currentStepId: null,
    lastVerifiedStepId: null,
    lastVerifiedAt: null,
    blockedReason: null,
    provenance: input.intent.provenance,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
