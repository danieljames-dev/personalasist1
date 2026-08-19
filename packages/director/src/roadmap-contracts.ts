/**
 * The durable unit of work is a milestone, not a chat session.
 *
 * Every milestone so far has been carried by a conversation: a directive is pasted in, a model works
 * until its context or quota ends, and continuity depends on a person noticing and restarting it.
 * These contracts exist so the sequence outlives the worker — the roadmap, the dependencies, the
 * authority decision and the verification plan are files on disk, and a fresh worker of any provider
 * can pick them up without a transcript.
 *
 * ## Why the state list is closed
 *
 * Fourteen states, one legal-transition table, and nothing may invent a fifteenth at runtime. The
 * failure this prevents is the one prose systems always drift into: a milestone described as
 * "basically done" or "waiting on review-ish" that no code can classify, so no gate can hold it.
 * A state that is not in {@link MILESTONE_STATES_V1} does not exist, and a transition that is not in
 * the table is refused rather than logged.
 *
 * ## Why so much policy is on the milestone
 *
 * Verification plan, review policy, retry budget, external-effect class and reversibility are
 * declared on the milestone **before** it runs, not decided afterwards by whoever ran it. A worker
 * that picks its own acceptance criteria after seeing its own output is not being verified; it is
 * being asked to grade itself. Declaring first is what makes "missing evidence fails closed"
 * meaningful rather than aspirational.
 */

import type { ProviderIdV1, SensitivityClassV1 } from "./provider-bridge.js";

export const ROADMAP_SCHEMA_V1 = "aion.director.roadmap.v1" as const;
export const ROADMAP_MILESTONE_SCHEMA_V1 = "aion.director.roadmapMilestone.v1" as const;
export const ROADMAP_EVENT_SCHEMA_V1 = "aion.director.roadmapEvent.v1" as const;
export const ROADMAP_GATE_SCHEMA_V1 = "aion.director.ownerGate.v1" as const;
export const ROADMAP_PACKET_SCHEMA_V1 = "aion.director.takeoverPacket.v1" as const;

/** Where roadmap state lives, relative to the repository root. Local, untracked, no secrets. */
export const ROADMAP_STORE_RELATIVE_PATH = ".aion-local/roadmap";

export const ROADMAP_STATES_V1 = ["ACTIVE", "PAUSED", "COMPLETED", "BLOCKED"] as const;
export type RoadmapStateV1 = (typeof ROADMAP_STATES_V1)[number];

export const MILESTONE_STATES_V1 = [
  "PLANNED",
  "READY",
  "WAITING_DEPENDENCY",
  "WAITING_OWNER_AUTHORIZATION",
  "DISPATCHING",
  "RUNNING",
  "VALIDATING",
  "WAITING_REVIEW",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "SUPERSEDED",
  "CANCELLED",
  "RECOVERY_REQUIRED",
] as const;
export type MilestoneStateV1 = (typeof MILESTONE_STATES_V1)[number];

/**
 * The only legal moves.
 *
 * `COMPLETED`, `CANCELLED` and `SUPERSEDED` are terminal — a completed milestone that can re-enter
 * `RUNNING` is how duplicate external effects happen after a restart. `RECOVERY_REQUIRED` is
 * deliberately a dead end except back to `RECOVERY_REQUIRED` or human-driven `BLOCKED`: ambiguous
 * worker state must not resolve itself by trying again.
 */
const LEGAL_TRANSITIONS: Readonly<Record<MilestoneStateV1, readonly MilestoneStateV1[]>> = {
  PLANNED: ["READY", "WAITING_DEPENDENCY", "WAITING_OWNER_AUTHORIZATION", "BLOCKED", "CANCELLED", "SUPERSEDED"],
  WAITING_DEPENDENCY: ["READY", "BLOCKED", "CANCELLED", "SUPERSEDED", "WAITING_DEPENDENCY"],
  READY: ["DISPATCHING", "WAITING_OWNER_AUTHORIZATION", "WAITING_DEPENDENCY", "BLOCKED", "CANCELLED", "SUPERSEDED"],
  WAITING_OWNER_AUTHORIZATION: ["READY", "BLOCKED", "CANCELLED", "SUPERSEDED", "WAITING_OWNER_AUTHORIZATION"],
  DISPATCHING: ["RUNNING", "FAILED", "BLOCKED", "RECOVERY_REQUIRED", "READY"],
  RUNNING: ["VALIDATING", "FAILED", "BLOCKED", "RECOVERY_REQUIRED"],
  VALIDATING: ["WAITING_REVIEW", "COMPLETED", "FAILED", "BLOCKED", "RECOVERY_REQUIRED"],
  WAITING_REVIEW: ["COMPLETED", "FAILED", "BLOCKED", "RECOVERY_REQUIRED", "WAITING_REVIEW"],
  FAILED: ["READY", "BLOCKED", "CANCELLED", "SUPERSEDED", "RECOVERY_REQUIRED"],
  BLOCKED: ["READY", "CANCELLED", "SUPERSEDED", "RECOVERY_REQUIRED"],
  RECOVERY_REQUIRED: ["BLOCKED", "CANCELLED", "SUPERSEDED", "RECOVERY_REQUIRED"],
  COMPLETED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

/** Whether one milestone state may become another. Anything not in the table is refused. */
export function legalMilestoneTransition(from: MilestoneStateV1, to: MilestoneStateV1): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

/** States that mean the milestone will never run again. */
export const TERMINAL_MILESTONE_STATES_V1: readonly MilestoneStateV1[] = ["COMPLETED", "CANCELLED", "SUPERSEDED"];

export const AUTHORITY_CLASSES_V1 = ["ROUTINE", "MILESTONE_AUTHORIZED", "HIGH_CONSEQUENCE"] as const;
export type AuthorityClassV1 = (typeof AUTHORITY_CLASSES_V1)[number];

export const EXTERNAL_EFFECT_CLASSES_V1 = [
  "NONE",
  "REPOSITORY_REVERSIBLE",
  "CONTROLLED_PUSH",
  "IDEMPOTENT_EXTERNAL",
  "IRREVERSIBLE_EXTERNAL",
] as const;
export type ExternalEffectClassV1 = (typeof EXTERNAL_EFFECT_CLASSES_V1)[number];

export const REVERSIBILITY_CLASSES_V1 = ["REVERSIBLE", "PARTIALLY_REVERSIBLE", "IRREVERSIBLE"] as const;
export type ReversibilityClassV1 = (typeof REVERSIBILITY_CLASSES_V1)[number];

/**
 * How much independent scrutiny a milestone's result needs before it counts.
 *
 * Not every edit deserves a second frontier model. `NONE` is legitimate for a docs typo and a lie for
 * a lease-semantics change, which is why the level is derived from risk rather than chosen by the
 * worker that just finished.
 */
export const REVIEW_LEVELS_V1 = ["NONE", "FOCUSED", "INDEPENDENT", "ADVERSARIAL"] as const;
export type ReviewLevelV1 = (typeof REVIEW_LEVELS_V1)[number];

/** Risk dimensions that pull a milestone toward independent review. */
export const RISK_CLASSES_V1 = [
  "AUTHORITY_OR_GOVERNANCE",
  "SECURITY_OR_PRIVACY",
  "PROCESS_LIFECYCLE",
  "PERSISTENCE_OR_RECOVERY",
  "ONE_WRITER_SEMANTICS",
  "SENSITIVE_DATA",
  "MONEY",
  "PRODUCTION_OR_EXTERNAL",
  "MAJOR_ARCHITECTURE",
  "WEAK_DETERMINISTIC_COVERAGE",
  "REPEATED_FAILURE_HISTORY",
  "LOW_CONFIDENCE",
] as const;
export type RiskClassV1 = (typeof RISK_CLASSES_V1)[number];

export const VERIFICATION_KINDS_V1 = [
  "DETERMINISTIC_CHECK",
  "FOCUSED_TESTS",
  "INTEGRATION_TESTS",
  "FROZEN_ACCEPTANCE",
  "RELEVANT_SUITE",
  "FULL_REPOSITORY_VERIFY",
  "BOUNDED_REAL_ACCEPTANCE",
] as const;
export type VerificationKindV1 = (typeof VERIFICATION_KINDS_V1)[number];

export interface VerificationStepV1 {
  readonly kind: VerificationKindV1;
  readonly name: string;
  /** A required step with no recorded result fails the milestone. Optional steps only inform. */
  readonly required: boolean;
}

export interface VerificationPlanV1 {
  readonly steps: readonly VerificationStepV1[];
  /** Declared before execution. A plan written after seeing the output is not a plan. */
  readonly declaredAt: string;
}

export interface RetryPolicyV1 {
  readonly maxAttempts: number;
  readonly maxIdenticalFailures: number;
  readonly maxIdenticalPatches: number;
  readonly maxProviderSwitches: number;
}

export interface RoadmapMilestoneV1 {
  readonly schema: typeof ROADMAP_MILESTONE_SCHEMA_V1;
  readonly milestoneId: string;
  readonly title: string;
  readonly objective: string;
  readonly status: MilestoneStateV1;
  /** Higher runs first among ready milestones. Ties break deterministically on id. */
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly requiredContextCategories: readonly string[];
  readonly authorityClass: AuthorityClassV1;
  /**
   * The Owner-approved envelope this milestone claims to be derived from, if any.
   *
   * A claim, not a grant. The inheritance evaluator checks it against the durable Owner authority
   * record and refuses when the envelope does not exist, is not ACTIVE, or does not list the parent
   * objective below. A milestone naming an envelope it does not belong to gates, exactly as one
   * naming no authority at all does.
   */
  readonly authorityEnvelopeId?: string | null;
  /**
   * The approved parent **milestone** this milestone is a bounded step of.
   *
   * This is the lineage that counts. An earlier version proved lineage by matching an objective
   * *string*, which a planner could stamp onto any sentence — and did: an independent review drove
   * "delete the production backups" through intake and it came back covered. A milestone id is a
   * reference to something that already exists in the roadmap and is named in the envelope, so it
   * cannot be conjured from the text of a new request.
   */
  readonly derivedFromMilestoneId?: string | null;
  /** The approved parent objective, kept for display and cross-checking. Never lineage on its own. */
  readonly derivedFromObjective?: string | null;
  /** Repository domains this milestone expects to write. Must be a subset of the envelope's. */
  readonly writeDomains?: readonly string[];
  readonly ownerAuthorizationId: string | null;
  readonly sensitivityClass: SensitivityClassV1;
  readonly allowedProviders: readonly ProviderIdV1[];
  readonly spendCapUsd: number;
  readonly externalEffectClass: ExternalEffectClassV1;
  readonly reversibilityClass: ReversibilityClassV1;
  readonly riskClasses: readonly RiskClassV1[];
  readonly verificationPlan: VerificationPlanV1;
  readonly independentReviewPolicy: ReviewLevelV1;
  readonly retryPolicy: RetryPolicyV1;
  readonly leaseTtlMs: number;
  readonly expectedArtifacts: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly attempts: number;
  readonly blockedReason: string | null;
  readonly provenance: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoadmapV1 {
  readonly schema: typeof ROADMAP_SCHEMA_V1;
  readonly roadmapId: string;
  readonly ownerGoalSet: readonly string[];
  readonly version: number;
  readonly state: RoadmapStateV1;
  readonly currentMilestoneId: string | null;
  readonly milestoneIds: readonly string[];
  readonly pendingOwnerGateIds: readonly string[];
  readonly roadmapFingerprint: string;
  readonly provenance: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const ROADMAP_GATE_STATUSES_V1 = ["OPEN", "SATISFIED", "WITHDRAWN"] as const;
export type RoadmapGateStatusV1 = (typeof ROADMAP_GATE_STATUSES_V1)[number];

export interface RoadmapOwnerGateV1 {
  readonly schema: typeof ROADMAP_GATE_SCHEMA_V1;
  readonly gateId: string;
  readonly milestoneId: string;
  readonly reason: string;
  readonly authorityRequested: string;
  /** Exactly what is being asked for. Never a bundle of unrelated permissions. */
  readonly exactScope: readonly string[];
  readonly riskClasses: readonly RiskClassV1[];
  readonly relatedDirectiveId: string | null;
  readonly status: RoadmapGateStatusV1;
  readonly createdAt: string;
}

export const ROADMAP_EVENT_TYPES_V1 = [
  "ROADMAP_CREATED",
  "MILESTONE_CREATED",
  "DEPENDENCY_SATISFIED",
  "MILESTONE_READY",
  "AUTHORITY_ALLOWED",
  "OWNER_GATE_REQUIRED",
  "AUTHORITY_DENIED",
  "DISPATCH_REQUESTED",
  "PROVIDER_SELECTED",
  "WORKER_STARTED",
  "WORKER_HEARTBEAT",
  "PROVIDER_FAILED",
  "RETRY_SCHEDULED",
  "VALIDATION_STARTED",
  "VALIDATION_PASSED",
  "VALIDATION_FAILED",
  "REVIEW_REQUIRED",
  "REVIEW_PASSED",
  "REVIEW_FAILED",
  "COMMIT_RECORDED",
  "PUSH_RECORDED",
  "MILESTONE_COMPLETED",
  "MILESTONE_BLOCKED",
  "MILESTONE_FAILED",
  "RECOVERY_STARTED",
  "RECOVERY_COMPLETED",
  "ROADMAP_COMPLETED",
] as const;
export type RoadmapEventTypeV1 = (typeof ROADMAP_EVENT_TYPES_V1)[number];

export interface RoadmapEventV1 {
  readonly schema: typeof ROADMAP_EVENT_SCHEMA_V1;
  readonly sequence: number;
  readonly type: RoadmapEventTypeV1;
  readonly roadmapId: string;
  readonly milestoneId: string | null;
  readonly detail: string;
  readonly at: string;
}

export interface TakeoverPacketV1 {
  readonly schema: typeof ROADMAP_PACKET_SCHEMA_V1;
  readonly roadmapId: string;
  readonly roadmapVersion: number;
  readonly milestoneId: string;
  readonly objective: string;
  readonly baselineSha: string;
  readonly currentHead: string;
  readonly currentDirectiveId: string;
  readonly ownerAuthorizationId: string | null;
  readonly dependenciesSatisfied: readonly string[];
  readonly allowedScope: readonly string[];
  readonly expectedArtifacts: readonly string[];
  readonly knownDefects: readonly string[];
  readonly verificationRequirements: readonly string[];
  readonly reviewRequirement: ReviewLevelV1;
  readonly providerRestrictions: readonly ProviderIdV1[];
  readonly sensitivityCeiling: SensitivityClassV1;
  readonly nextExactAction: string;
  readonly createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Validation — malformed durable state fails closed                           */
/* -------------------------------------------------------------------------- */

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** `null` when the milestone is usable, otherwise the first reason it is not. */
export function validateMilestone(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "milestone is not an object";
  const m = candidate as Partial<RoadmapMilestoneV1>;
  if (m.schema !== ROADMAP_MILESTONE_SCHEMA_V1) return "milestone schema mismatch";
  if (typeof m.milestoneId !== "string" || !SAFE_ID.test(m.milestoneId)) return "milestoneId is not a safe identifier";
  if (typeof m.title !== "string" || m.title.trim() === "") return "title is empty";
  if (typeof m.objective !== "string" || m.objective.trim() === "") return "objective is empty";
  if (typeof m.status !== "string" || !MILESTONE_STATES_V1.includes(m.status as MilestoneStateV1)) {
    return `status is not a supported milestone state: ${String(m.status)}`;
  }
  if (typeof m.priority !== "number" || !Number.isFinite(m.priority)) return "priority is not a number";
  if (!isStringList(m.dependencies)) return "dependencies is not a string list";
  if (m.dependencies.includes(m.milestoneId)) return "milestone depends on itself";
  if (new Set(m.dependencies).size !== m.dependencies.length) return "dependencies contain duplicates";
  if (!isStringList(m.requiredCapabilities)) return "requiredCapabilities is not a string list";
  if (!isStringList(m.requiredContextCategories)) return "requiredContextCategories is not a string list";
  if (typeof m.authorityClass !== "string" || !AUTHORITY_CLASSES_V1.includes(m.authorityClass as AuthorityClassV1)) {
    return "authorityClass is not supported";
  }
  if (m.ownerAuthorizationId !== null && typeof m.ownerAuthorizationId !== "string") {
    return "ownerAuthorizationId must be a string or null";
  }
  // Optional inheritance fields. Absent is the normal case and means "no envelope claimed"; present
  // and malformed is a defect, because a milestone that half-declares lineage would otherwise be
  // evaluated against a claim nobody can read.
  if (m.authorityEnvelopeId !== undefined && m.authorityEnvelopeId !== null && typeof m.authorityEnvelopeId !== "string") {
    return "authorityEnvelopeId must be a string, null or absent";
  }
  if (m.derivedFromObjective !== undefined && m.derivedFromObjective !== null && typeof m.derivedFromObjective !== "string") {
    return "derivedFromObjective must be a string, null or absent";
  }
  if (m.derivedFromMilestoneId !== undefined && m.derivedFromMilestoneId !== null && typeof m.derivedFromMilestoneId !== "string") {
    return "derivedFromMilestoneId must be a string, null or absent";
  }
  if (m.writeDomains !== undefined && !isStringList(m.writeDomains)) return "writeDomains is not a string list";
  if (typeof m.sensitivityClass !== "string") return "sensitivityClass is missing";
  if (!Array.isArray(m.allowedProviders)) return "allowedProviders is not a list";
  if (typeof m.spendCapUsd !== "number" || m.spendCapUsd < 0) return "spendCapUsd is not a non-negative number";
  if (typeof m.externalEffectClass !== "string" || !EXTERNAL_EFFECT_CLASSES_V1.includes(m.externalEffectClass as ExternalEffectClassV1)) {
    return "externalEffectClass is not supported";
  }
  if (typeof m.reversibilityClass !== "string" || !REVERSIBILITY_CLASSES_V1.includes(m.reversibilityClass as ReversibilityClassV1)) {
    return "reversibilityClass is not supported";
  }
  if (!Array.isArray(m.riskClasses)) return "riskClasses is not a list";
  for (const risk of m.riskClasses) {
    if (typeof risk !== "string" || !RISK_CLASSES_V1.includes(risk as RiskClassV1)) return `unsupported risk class: ${String(risk)}`;
  }
  const plan = m.verificationPlan;
  if (plan === undefined || plan === null || typeof plan !== "object") return "verificationPlan is missing";
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return "verificationPlan has no steps";
  for (const step of plan.steps) {
    if (step === null || typeof step !== "object") return "verification step is not an object";
    if (!VERIFICATION_KINDS_V1.includes(step.kind)) return `unsupported verification kind: ${String(step.kind)}`;
    if (typeof step.name !== "string" || step.name.trim() === "") return "verification step name is empty";
    if (typeof step.required !== "boolean") return "verification step required flag is not boolean";
  }
  if (typeof plan.declaredAt !== "string" || plan.declaredAt.trim() === "") return "verificationPlan was not declared";
  if (typeof m.independentReviewPolicy !== "string" || !REVIEW_LEVELS_V1.includes(m.independentReviewPolicy as ReviewLevelV1)) {
    return "independentReviewPolicy is not supported";
  }
  const retry = m.retryPolicy;
  if (retry === undefined || retry === null || typeof retry !== "object") return "retryPolicy is missing";
  for (const field of ["maxAttempts", "maxIdenticalFailures", "maxIdenticalPatches", "maxProviderSwitches"] as const) {
    const value = retry[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return `retryPolicy.${field} must be at least 1`;
  }
  if (typeof m.leaseTtlMs !== "number" || m.leaseTtlMs <= 0) return "leaseTtlMs must be positive";
  if (!isStringList(m.expectedArtifacts)) return "expectedArtifacts is not a string list";
  if (!isStringList(m.completionCriteria) || m.completionCriteria.length === 0) return "completionCriteria is empty";
  if (typeof m.attempts !== "number" || m.attempts < 0) return "attempts is not a non-negative number";
  if (m.blockedReason !== null && typeof m.blockedReason !== "string") return "blockedReason must be a string or null";
  if (typeof m.provenance !== "string" || m.provenance.trim() === "") return "provenance is empty";
  if (typeof m.createdAt !== "string" || typeof m.updatedAt !== "string") return "milestone timestamps are missing";
  return null;
}

/** `null` when the roadmap is usable, otherwise the first reason it is not. */
export function validateRoadmap(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "roadmap is not an object";
  const r = candidate as Partial<RoadmapV1>;
  if (r.schema !== ROADMAP_SCHEMA_V1) return "roadmap schema mismatch";
  if (typeof r.roadmapId !== "string" || !SAFE_ID.test(r.roadmapId)) return "roadmapId is not a safe identifier";
  if (!isStringList(r.ownerGoalSet)) return "ownerGoalSet is not a string list";
  if (typeof r.version !== "number" || r.version < 1) return "version must be at least 1";
  if (typeof r.state !== "string" || !ROADMAP_STATES_V1.includes(r.state as RoadmapStateV1)) return "roadmap state is not supported";
  if (r.currentMilestoneId !== null && typeof r.currentMilestoneId !== "string") return "currentMilestoneId must be a string or null";
  if (!isStringList(r.milestoneIds)) return "milestoneIds is not a string list";
  if (new Set(r.milestoneIds).size !== r.milestoneIds.length) return "milestoneIds contain duplicates";
  if (!isStringList(r.pendingOwnerGateIds)) return "pendingOwnerGateIds is not a string list";
  if (typeof r.roadmapFingerprint !== "string" || r.roadmapFingerprint.trim() === "") return "roadmapFingerprint is empty";
  if (typeof r.provenance !== "string" || r.provenance.trim() === "") return "provenance is empty";
  if (typeof r.createdAt !== "string" || typeof r.updatedAt !== "string") return "roadmap timestamps are missing";
  return null;
}

/** `null` when the gate is usable, otherwise the first reason it is not. */
export function validateOwnerGate(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "gate is not an object";
  const g = candidate as Partial<RoadmapOwnerGateV1>;
  if (g.schema !== ROADMAP_GATE_SCHEMA_V1) return "gate schema mismatch";
  if (typeof g.gateId !== "string" || !SAFE_ID.test(g.gateId)) return "gateId is not a safe identifier";
  if (typeof g.milestoneId !== "string" || g.milestoneId.trim() === "") return "gate milestoneId is empty";
  if (typeof g.reason !== "string" || g.reason.trim() === "") return "gate reason is empty";
  if (typeof g.authorityRequested !== "string" || g.authorityRequested.trim() === "") return "authorityRequested is empty";
  if (!isStringList(g.exactScope) || g.exactScope.length === 0) return "gate exactScope is empty";
  if (typeof g.status !== "string" || !ROADMAP_GATE_STATUSES_V1.includes(g.status as RoadmapGateStatusV1)) return "gate status is not supported";
  if (typeof g.createdAt !== "string") return "gate createdAt is missing";
  return null;
}

/**
 * Identity of a roadmap's shape, so a reader can tell whether it changed underneath them.
 *
 * Derived from milestone ids, statuses and dependency edges rather than from the whole record,
 * because timestamps churn on every write and would make the fingerprint useless as a change signal.
 */
export function roadmapFingerprint(milestones: readonly RoadmapMilestoneV1[]): string {
  const parts = [...milestones]
    .map((m) => `${m.milestoneId}:${m.status}:${[...m.dependencies].sort().join(",")}`)
    .sort();
  let hash = 0x811c9dc5;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
