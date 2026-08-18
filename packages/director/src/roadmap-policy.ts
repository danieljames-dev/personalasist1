/**
 * Three questions asked before, after and around every milestone: may it run, did it pass, should it stop.
 *
 * ## Authority is read, never derived
 *
 * `resolveMilestoneAuthority` does not decide anything on its own — it reads the same durable
 * `.aion-local/owner-authority` record the PowerShell evaluator reads and applies the same rules to
 * the milestone-level question. That is deliberately a *reader*, not a second authority system: the
 * only way a milestone becomes authorised is a record the Founder authorization script wrote, and
 * agents cannot create one. Every failure path here returns `REQUIRE_FRESH_OWNER_APPROVAL` or `DENY`
 * rather than a permissive default, so a missing, expired, superseded or malformed record blocks
 * work instead of enabling it.
 *
 * ## Verification is declared first and evidence must be present
 *
 * The historical defect this closes is "no FAIL text, therefore PASS". A required step with no
 * recorded result is a failure here, not an omission, and a required step recorded as anything other
 * than an explicit pass is a failure. The plan is declared on the milestone before execution, so a
 * worker cannot choose its own acceptance criteria after seeing its own output.
 *
 * ## Review escalates by risk, not by preference
 *
 * A docs typo does not deserve a second frontier model, and a change to lease semantics does. The
 * level is computed from the milestone's declared risk classes and external-effect class, and can
 * only ever escalate above what the milestone asked for. A worker cannot talk its own review
 * requirement down.
 *
 * ## Runaway control assumes the loop will happen
 *
 * Retry budgets, identical-failure and identical-patch detection, and provider ping-pong detection
 * all exist because an agent that can retry will retry the same thing. Exhaustion produces `BLOCKED`
 * or `RECOVERY_REQUIRED` — never another attempt.
 */

import type { AuthorityOutcomeV1, ProviderIdV1, SensitivityClassV1 } from "./provider-bridge.js";
import {
  ROADMAP_GATE_SCHEMA_V1,
  type MilestoneStateV1,
  type RoadmapOwnerGateV1,
  type ReviewLevelV1,
  type RoadmapMilestoneV1,
  type VerificationPlanV1,
} from "./roadmap-contracts.js";

/* -------------------------------------------------------------------------- */
/* Authority                                                                   */
/* -------------------------------------------------------------------------- */

/** The subset of the durable Owner authority record the roadmap depends on. */
export interface OwnerAuthorityRecordV1 {
  readonly schemaVersion: string;
  readonly ownerAuthorizationId: string;
  readonly milestoneId: string;
  readonly allowedExternalEffects: readonly string[];
  readonly allowedProviders: readonly string[];
  readonly spendingCeilingUsd: number;
  readonly productionWriterPermission: string;
  readonly sensitiveDataPermission: string;
  readonly destructiveActionPermission: string;
  readonly state: string;
  readonly expiresAtUtc: string;
  readonly supersededBy: string;
}

export interface MilestoneAuthorityDecisionV1 {
  readonly outcome: AuthorityOutcomeV1;
  readonly reason: string;
  readonly ownerAuthorizationId: string | null;
}

const SENSITIVE_CLASSES: readonly SensitivityClassV1[] = ["CONFIDENTIAL", "RESTRICTED"];

/**
 * Decide whether one milestone may be dispatched, from durable Owner authority alone.
 *
 * Returns `DENY` only where the record itself forbids the work; everything else that is not clearly
 * covered comes back as `REQUIRE_FRESH_OWNER_APPROVAL`, because the correct response to "we cannot
 * prove this is allowed" is to ask, not to refuse forever.
 */
export function resolveMilestoneAuthority(
  milestone: RoadmapMilestoneV1,
  authorities: readonly OwnerAuthorityRecordV1[],
  now: string,
): MilestoneAuthorityDecisionV1 {
  if (milestone.ownerAuthorizationId === null) {
    return {
      outcome: "REQUIRE_FRESH_OWNER_APPROVAL",
      reason: "milestone names no Owner authorization",
      ownerAuthorizationId: null,
    };
  }
  const record = authorities.find((row) => row.ownerAuthorizationId === milestone.ownerAuthorizationId);
  if (record === undefined) {
    return {
      outcome: "REQUIRE_FRESH_OWNER_APPROVAL",
      reason: `no durable Owner authority record for ${milestone.ownerAuthorizationId}`,
      ownerAuthorizationId: milestone.ownerAuthorizationId,
    };
  }
  const id = record.ownerAuthorizationId;
  if (record.state === "REVOKED") return { outcome: "DENY", reason: "Owner authority is revoked", ownerAuthorizationId: id };
  if (record.state !== "ACTIVE") {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: `Owner authority is ${record.state}`, ownerAuthorizationId: id };
  }
  if (typeof record.supersededBy === "string" && record.supersededBy.trim() !== "") {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "Owner authority was superseded", ownerAuthorizationId: id };
  }
  if (typeof record.expiresAtUtc === "string" && record.expiresAtUtc.trim() !== "") {
    const expires = Date.parse(record.expiresAtUtc);
    const at = Date.parse(now);
    if (!Number.isNaN(expires) && !Number.isNaN(at) && at >= expires) {
      return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "Owner authority expired", ownerAuthorizationId: id };
    }
  }
  // The binding between a roadmap milestone and Owner authority is `ownerAuthorizationId`, which is
  // how the record was found above — not the record's own `milestoneId`. Those are different
  // namespaces: a roadmap node id names a step in the graph, while the record names the Owner-approved
  // milestone it belongs to, and several roadmap steps can legitimately sit inside one authorization.
  // Comparing them was a category error that gated every step whose node id happened not to match.
  if (milestone.authorityClass === "HIGH_CONSEQUENCE") {
    return {
      outcome: "REQUIRE_FRESH_OWNER_APPROVAL",
      reason: "high-consequence milestones always need a fresh Owner decision",
      ownerAuthorizationId: id,
    };
  }
  if (milestone.spendCapUsd > record.spendingCeilingUsd) {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "milestone spend exceeds the Owner ceiling", ownerAuthorizationId: id };
  }
  if (SENSITIVE_CLASSES.includes(milestone.sensitivityClass) && record.sensitiveDataPermission !== "YES") {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "sensitive-data expansion requires fresh Owner approval", ownerAuthorizationId: id };
  }
  if (
    (milestone.externalEffectClass === "IRREVERSIBLE_EXTERNAL" || milestone.externalEffectClass === "IDEMPOTENT_EXTERNAL") &&
    !record.allowedExternalEffects.includes(milestone.externalEffectClass)
  ) {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "external effect is outside the Owner-approved envelope", ownerAuthorizationId: id };
  }
  if (milestone.externalEffectClass === "CONTROLLED_PUSH" && !record.allowedExternalEffects.includes("CONTROLLED_PUSH")) {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "controlled push is outside the Owner-approved envelope", ownerAuthorizationId: id };
  }
  for (const provider of milestone.allowedProviders) {
    if (!record.allowedProviders.includes(provider)) {
      return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: `provider ${provider} is outside the Owner-approved set`, ownerAuthorizationId: id };
    }
  }
  return { outcome: "ALLOW_STANDING", reason: "milestone is covered by active Owner standing authority", ownerAuthorizationId: id };
}

/**
 * Turn a refusal into a concrete, narrow Owner gate.
 *
 * The scope is the milestone's own declared effects rather than a general request, because a gate
 * that bundles unrelated permissions is how a blanket approval gets granted by accident.
 */
export function ownerGateFor(
  milestone: RoadmapMilestoneV1,
  decision: MilestoneAuthorityDecisionV1,
  relatedDirectiveId: string | null,
  now: string,
): RoadmapOwnerGateV1 {
  return {
    schema: ROADMAP_GATE_SCHEMA_V1,
    gateId: `gate-${milestone.milestoneId}`,
    milestoneId: milestone.milestoneId,
    reason: decision.reason,
    authorityRequested: milestone.ownerAuthorizationId ?? "a new Owner-authorized directive",
    exactScope: [
      `objective: ${milestone.objective}`,
      `external effect: ${milestone.externalEffectClass}`,
      `reversibility: ${milestone.reversibilityClass}`,
      `sensitivity: ${milestone.sensitivityClass}`,
      `spend ceiling: ${milestone.spendCapUsd}`,
    ],
    riskClasses: milestone.riskClasses,
    relatedDirectiveId,
    status: "OPEN",
    createdAt: now,
  };
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

export type VerificationResultV1 = "PASS" | "FAIL";

export interface VerificationEvidenceV1 {
  readonly step: string;
  readonly result: VerificationResultV1;
  readonly detail: string;
}

export interface VerificationOutcomeV1 {
  readonly passed: boolean;
  /** Required steps with no recorded result. Never treated as incidental. */
  readonly missing: readonly string[];
  readonly failed: readonly string[];
  readonly reason: string;
}

/**
 * A milestone passes only when every required step has explicit passing evidence.
 *
 * Absence is failure. That is the whole rule, and it is written this way because the historical
 * defect was a verifier that concluded success from the absence of the word FAIL.
 */
export function evaluateVerification(
  plan: VerificationPlanV1,
  evidence: readonly VerificationEvidenceV1[],
): VerificationOutcomeV1 {
  const byStep = new Map(evidence.map((row) => [row.step, row]));
  const missing: string[] = [];
  const failed: string[] = [];
  for (const step of plan.steps) {
    const row = byStep.get(step.name);
    if (row === undefined) {
      if (step.required) missing.push(step.name);
      continue;
    }
    if (row.result !== "PASS") failed.push(step.name);
  }
  if (missing.length > 0) {
    return { passed: false, missing, failed, reason: `required verification evidence is missing: ${missing.join(", ")}` };
  }
  if (failed.length > 0) {
    return { passed: false, missing, failed, reason: `verification failed: ${failed.join(", ")}` };
  }
  return { passed: true, missing, failed, reason: "every required verification step recorded an explicit pass" };
}

const REVIEW_ORDER: readonly ReviewLevelV1[] = ["NONE", "FOCUSED", "INDEPENDENT", "ADVERSARIAL"];

/** Risk classes that mean a worker must not be the only judge of its own work. */
const INDEPENDENT_RISKS = new Set([
  "AUTHORITY_OR_GOVERNANCE",
  "SECURITY_OR_PRIVACY",
  "PROCESS_LIFECYCLE",
  "PERSISTENCE_OR_RECOVERY",
  "ONE_WRITER_SEMANTICS",
  "SENSITIVE_DATA",
  "MONEY",
  "MAJOR_ARCHITECTURE",
  "WEAK_DETERMINISTIC_COVERAGE",
  "REPEATED_FAILURE_HISTORY",
  "LOW_CONFIDENCE",
]);

/**
 * The review level a milestone actually needs, which can only be at or above what it asked for.
 *
 * Escalation is one-directional on purpose. A milestone that declares `NONE` and touches production
 * gets `ADVERSARIAL` anyway; there is no path by which declaring a low level lowers the bar.
 */
export function requiredReviewLevel(milestone: RoadmapMilestoneV1): ReviewLevelV1 {
  let level: ReviewLevelV1 = milestone.independentReviewPolicy;
  const raise = (candidate: ReviewLevelV1): void => {
    if (REVIEW_ORDER.indexOf(candidate) > REVIEW_ORDER.indexOf(level)) level = candidate;
  };
  if (milestone.riskClasses.some((risk) => INDEPENDENT_RISKS.has(risk))) raise("INDEPENDENT");
  if (milestone.riskClasses.includes("PRODUCTION_OR_EXTERNAL")) raise("ADVERSARIAL");
  if (milestone.externalEffectClass === "IRREVERSIBLE_EXTERNAL") raise("ADVERSARIAL");
  if (milestone.reversibilityClass === "IRREVERSIBLE") raise("ADVERSARIAL");
  return level;
}

export interface ReviewVerdictV1 {
  readonly level: ReviewLevelV1;
  readonly reviewer: string;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * Whether the recorded review satisfies the required level.
 *
 * A missing verdict is not a pass. A verdict from a weaker review than required is not a pass
 * either — otherwise `ADVERSARIAL` could be satisfied by a glance.
 */
export function reviewSatisfied(required: ReviewLevelV1, verdict: ReviewVerdictV1 | null): { satisfied: boolean; reason: string } {
  if (required === "NONE") return { satisfied: true, reason: "no independent review required" };
  if (verdict === null) return { satisfied: false, reason: `review level ${required} required and no verdict was recorded` };
  if (REVIEW_ORDER.indexOf(verdict.level) < REVIEW_ORDER.indexOf(required)) {
    return { satisfied: false, reason: `review level ${verdict.level} is weaker than the required ${required}` };
  }
  if (!verdict.passed) return { satisfied: false, reason: `reviewer ${verdict.reviewer} did not pass the milestone` };
  return { satisfied: true, reason: `reviewer ${verdict.reviewer} passed at level ${verdict.level}` };
}

/* -------------------------------------------------------------------------- */
/* Runaway control                                                             */
/* -------------------------------------------------------------------------- */

export interface AttemptHistoryV1 {
  readonly attempts: number;
  /** One signature per failed attempt — the same string twice means the same failure twice. */
  readonly failureSignatures: readonly string[];
  readonly patchSignatures: readonly string[];
  readonly providerTrail: readonly ProviderIdV1[];
  /** A signature of observable progress. Repeats mean nothing changed. */
  readonly progressSignatures: readonly string[];
  /** True when an external effect may or may not have landed. */
  readonly ambiguousExternalEffect: boolean;
}

export interface RunawayAssessmentV1 {
  readonly stop: boolean;
  readonly nextState: MilestoneStateV1 | null;
  readonly reason: string;
}

function maxRepeat(values: readonly string[]): number {
  const counts = new Map<string, number>();
  let highest = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > highest) highest = next;
  }
  return highest;
}

/**
 * Decide whether this milestone has stopped making progress and must stop trying.
 *
 * Ambiguity is checked first and routes to `RECOVERY_REQUIRED` rather than `BLOCKED`, because an
 * external effect that may or may not have landed must never be retried automatically — the retry is
 * how a single push becomes two.
 */
export function assessRunaway(milestone: RoadmapMilestoneV1, history: AttemptHistoryV1): RunawayAssessmentV1 {
  const policy = milestone.retryPolicy;
  if (history.ambiguousExternalEffect) {
    return {
      stop: true,
      nextState: "RECOVERY_REQUIRED",
      reason: "an external effect may have landed; automatic retry could duplicate it",
    };
  }
  if (history.attempts >= policy.maxAttempts) {
    return { stop: true, nextState: "BLOCKED", reason: `retry budget exhausted after ${history.attempts} attempts` };
  }
  if (maxRepeat(history.failureSignatures) >= policy.maxIdenticalFailures) {
    return { stop: true, nextState: "BLOCKED", reason: "the same failure repeated; retrying will not change it" };
  }
  if (maxRepeat(history.patchSignatures) >= policy.maxIdenticalPatches) {
    return { stop: true, nextState: "BLOCKED", reason: "the same patch was proposed repeatedly" };
  }
  if (history.providerTrail.length >= policy.maxProviderSwitches && new Set(history.providerTrail).size < history.providerTrail.length) {
    return { stop: true, nextState: "BLOCKED", reason: "providers are ping-ponging without progress" };
  }
  if (history.progressSignatures.length >= 2 && new Set(history.progressSignatures).size === 1) {
    return { stop: true, nextState: "BLOCKED", reason: "no observable progress between attempts" };
  }
  return { stop: false, nextState: null, reason: "within retry budget and still making progress" };
}
