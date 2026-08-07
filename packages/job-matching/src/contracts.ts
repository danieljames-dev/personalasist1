import type { CareerFactPayloadV1, CareerProfilePayloadV1 } from "@aion/career-evidence";
import { asActorIdV1, asOwnerIdV1, type ActorIdV1, type OwnerIdV1 } from "@aion/identity";
import type { JobPostingPayloadV1 } from "@aion/job-posting";
import {
  asObjectIdV1,
  validateCanonicalIdentifierV1,
  validateCanonicalValueV1,
  type CanonicalValueV1,
  type ObjectIdV1,
} from "@aion/object";

export const JOB_MATCH_REPORT_PAYLOAD_VERSION_V1 = "aion.job-match-report-payload.v1" as const;
export const JOB_MATCH_OPERATION_VERSION_V1 = "aion.job-match-operation.v1" as const;
export const MATCHING_CONFIGURATION_VERSION_V1 = "aion.career-match-configuration.v1" as const;
export const SCORE_SCALE_BPS_V1 = 10_000 as const;

export const MATCH_COMPONENT_IDS_V1 = [
  "required-skills", "preferred-skills", "relevant-experience", "role-title-alignment",
  "industry-alignment", "location-compatibility", "work-arrangement", "employment-type",
  "compensation-compatibility", "mandatory-qualifications",
] as const;
export type MatchComponentIdV1 = typeof MATCH_COMPONENT_IDS_V1[number];

export interface MatchingWeightsV1 {
  readonly requiredSkills: number;
  readonly preferredSkills: number;
  readonly relevantExperience: number;
  readonly roleTitleAlignment: number;
  readonly industryAlignment: number;
  readonly locationCompatibility: number;
  readonly workArrangement: number;
  readonly employmentType: number;
  readonly compensationCompatibility: number;
  readonly mandatoryQualifications: number;
}

export const DEFAULT_MATCHING_WEIGHTS_V1: MatchingWeightsV1 = Object.freeze({
  requiredSkills: 2400,
  preferredSkills: 600,
  relevantExperience: 1400,
  roleTitleAlignment: 1000,
  industryAlignment: 700,
  locationCompatibility: 700,
  workArrangement: 700,
  employmentType: 500,
  compensationCompatibility: 800,
  mandatoryQualifications: 1200,
});

export interface MatchingConfigurationV1 {
  readonly contractVersion: typeof MATCHING_CONFIGURATION_VERSION_V1;
  readonly weights: MatchingWeightsV1;
  readonly desiredRoleTitles: readonly string[];
  readonly excludedRoleTitles: readonly string[];
  readonly acceptedLocations: readonly string[];
  readonly acceptedWorkArrangements: readonly ("remote" | "hybrid" | "on-site")[];
  readonly acceptedEmploymentTypes: readonly ("full-time" | "part-time" | "contract" | "temporary" | "internship" | "other")[];
  readonly industriesOfInterest: readonly string[];
  readonly industriesToAvoid: readonly string[];
  readonly minimumCompensation: null | {
    readonly currency: string;
    readonly minimumMinorUnits: number;
  };
}

export interface MatchEvidenceLinkV1 {
  readonly factId: ObjectIdV1;
  readonly factRevision: number;
  readonly factType: string;
  readonly assertion: "owner-confirmed" | "extracted" | "inferred" | "missing";
  readonly verification: "unverified" | "verified";
  readonly conflict: "none" | "conflicting";
  readonly sourceObjectId: ObjectIdV1;
  readonly sourceLocation: string;
}

export type RequirementOutcomeV1 = "matched" | "unmatched" | "unknown" | "conflict";
export interface RequirementAssessmentV1 {
  readonly category: string;
  readonly requirement: string;
  readonly outcome: RequirementOutcomeV1;
  readonly evidence: readonly MatchEvidenceLinkV1[];
  readonly reason: string;
}

export interface MatchComponentScoreV1 {
  readonly component: MatchComponentIdV1;
  readonly weightBps: number;
  readonly applied: boolean;
  readonly scoreBps: number | null;
  readonly status: "matched" | "partial" | "unmatched" | "unknown" | "conflict" | "not-applicable";
  readonly evidence: readonly MatchEvidenceLinkV1[];
  readonly reasons: readonly string[];
}

export interface JobMatchReportPayloadV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly contractVersion: typeof JOB_MATCH_REPORT_PAYLOAD_VERSION_V1;
  readonly matchOperationId: string;
  readonly matchingConfiguration: MatchingConfigurationV1 & CanonicalValueV1;
  readonly scoreScale: { readonly unit: "basis-points"; readonly maximum: 10000; readonly rounding: "floor" } & CanonicalValueV1;
  readonly overallScoreBps: number;
  readonly appliedWeightBps: number;
  readonly componentScores: readonly (MatchComponentScoreV1 & CanonicalValueV1)[];
  readonly matchedRequirements: readonly (RequirementAssessmentV1 & CanonicalValueV1)[];
  readonly unmatchedRequirements: readonly (RequirementAssessmentV1 & CanonicalValueV1)[];
  readonly unknownRequirements: readonly (RequirementAssessmentV1 & CanonicalValueV1)[];
  readonly conflicts: readonly string[];
  readonly unsupportedRequirements: readonly string[];
  readonly careerProfile: { readonly objectId: ObjectIdV1; readonly revision: number; readonly payloadVersion: string } & CanonicalValueV1;
  readonly jobPosting: { readonly objectId: ObjectIdV1; readonly revision: number; readonly payloadVersion: string } & CanonicalValueV1;
  readonly limitations: readonly string[];
}

export interface JobMatchRequestV1 {
  readonly version: "1";
  readonly matchOperationId: string;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly careerProfileObjectId: ObjectIdV1;
  readonly careerProfileRevision: number;
  readonly jobPostingObjectId: ObjectIdV1;
  readonly jobPostingRevision: number;
  readonly configuration: MatchingConfigurationV1;
}

export interface JobMatchEvaluationInputV1 {
  readonly request: JobMatchRequestV1;
  readonly careerProfile: CareerProfilePayloadV1;
  readonly jobPosting: JobPostingPayloadV1;
  readonly facts: readonly { readonly revision: number; readonly payload: CareerFactPayloadV1 }[];
}

export interface JobMatchResultV1 {
  readonly version: "1";
  readonly outcome: "success" | "already-completed" | "rejected";
  readonly matchReference: { readonly version: "1"; readonly fingerprint: string } | null;
  readonly relationshipReferences: readonly { readonly version: "1"; readonly fingerprint: string }[];
  readonly overallScoreBps: number | null;
  readonly createdObjectCount: 0 | 1;
  readonly createdRelationshipCount: number;
  readonly error: null | {
    readonly version: "1";
    readonly code: "request-invalid" | "not-found" | "owner-mismatch" | "revision-conflict" | "object-invalid" | "persistence-failed";
    readonly stage: "request" | "load" | "evaluation" | "persistence";
    readonly message: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function identifier(value: unknown): value is string {
  try { validateCanonicalIdentifierV1(value, "$.identifier"); return true; } catch { return false; }
}
function sortedUniqueStrings(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  let prior: string | undefined;
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.trim() !== item || (prior !== undefined && prior >= item)) return false;
    prior = item;
  }
  return true;
}
function score(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= SCORE_SCALE_BPS_V1;
}

export function defaultMatchingConfigurationV1(): MatchingConfigurationV1 {
  return {
    contractVersion: MATCHING_CONFIGURATION_VERSION_V1,
    weights: { ...DEFAULT_MATCHING_WEIGHTS_V1 },
    desiredRoleTitles: [], excludedRoleTitles: [], acceptedLocations: [], acceptedWorkArrangements: [],
    acceptedEmploymentTypes: [], industriesOfInterest: [], industriesToAvoid: [], minimumCompensation: null,
  };
}

export function validateMatchingConfigurationV1(value: unknown): MatchingConfigurationV1 {
  try { validateCanonicalValueV1(value); } catch { throw new Error("Matching configuration is outside the canonical value domain."); }
  if (!isRecord(value) || !exactKeys(value, [
    "acceptedEmploymentTypes", "acceptedLocations", "acceptedWorkArrangements", "contractVersion",
    "desiredRoleTitles", "excludedRoleTitles", "industriesOfInterest", "industriesToAvoid",
    "minimumCompensation", "weights",
  ]) || value.contractVersion !== MATCHING_CONFIGURATION_VERSION_V1) throw new Error("Matching configuration is invalid.");
  for (const key of ["desiredRoleTitles", "excludedRoleTitles", "acceptedLocations", "industriesOfInterest", "industriesToAvoid"] as const) {
    if (!sortedUniqueStrings(value[key])) throw new Error("Matching configuration lists must be sorted and unique.");
  }
  if (!Array.isArray(value.acceptedWorkArrangements)
    || value.acceptedWorkArrangements.some((item) => !["remote", "hybrid", "on-site"].includes(item as string))
    || !Array.isArray(value.acceptedEmploymentTypes)
    || value.acceptedEmploymentTypes.some((item) => !["full-time", "part-time", "contract", "temporary", "internship", "other"].includes(item as string))) {
    throw new Error("Matching configuration enumerations are invalid.");
  }
  if (!isRecord(value.weights) || !exactKeys(value.weights, Object.keys(DEFAULT_MATCHING_WEIGHTS_V1))) throw new Error("Matching weights are invalid.");
  const weightValues = Object.values(value.weights) as unknown[];
  if (weightValues.some((item) => typeof item !== "number" || !Number.isSafeInteger(item) || item < 0)
    || weightValues.reduce<number>((sum, item) => sum + (item as number), 0) !== SCORE_SCALE_BPS_V1) throw new Error("Matching weights must total 10000 basis points.");
  if (value.minimumCompensation !== null) {
    if (!isRecord(value.minimumCompensation) || !exactKeys(value.minimumCompensation, ["currency", "minimumMinorUnits"])
      || typeof value.minimumCompensation.currency !== "string" || !/^[A-Z]{3}$/.test(value.minimumCompensation.currency)
      || typeof value.minimumCompensation.minimumMinorUnits !== "number"
      || !Number.isSafeInteger(value.minimumCompensation.minimumMinorUnits)
      || value.minimumCompensation.minimumMinorUnits < 0) throw new Error("Minimum compensation is invalid.");
  }
  return value as unknown as MatchingConfigurationV1;
}

export function validateJobMatchRequestV1(value: unknown): JobMatchRequestV1 {
  if (!isRecord(value) || !exactKeys(value, [
    "actorId", "careerProfileObjectId", "careerProfileRevision", "configuration", "jobPostingObjectId",
    "jobPostingRevision", "matchOperationId", "ownerId", "version",
  ]) || value.version !== "1" || !identifier(value.matchOperationId)
    || !Number.isSafeInteger(value.careerProfileRevision) || (value.careerProfileRevision as number) < 1
    || !Number.isSafeInteger(value.jobPostingRevision) || (value.jobPostingRevision as number) < 1) throw new Error("A closed version-1 match request is required.");
  try {
    asOwnerIdV1(value.ownerId); asActorIdV1(value.actorId);
    asObjectIdV1(value.careerProfileObjectId); asObjectIdV1(value.jobPostingObjectId);
    validateMatchingConfigurationV1(value.configuration);
  } catch { throw new Error("Typed references and a valid configuration are required."); }
  return value as unknown as JobMatchRequestV1;
}

function validateEvidence(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["assertion", "conflict", "factId", "factRevision", "factType", "sourceLocation", "sourceObjectId", "verification"])) return false;
  try { asObjectIdV1(value.factId); asObjectIdV1(value.sourceObjectId); } catch { return false; }
  return Number.isSafeInteger(value.factRevision) && (value.factRevision as number) >= 1
    && typeof value.factType === "string" && typeof value.sourceLocation === "string"
    && ["owner-confirmed", "extracted", "inferred", "missing"].includes(value.assertion as string)
    && ["unverified", "verified"].includes(value.verification as string)
    && ["none", "conflicting"].includes(value.conflict as string);
}

export function validateJobMatchReportPayloadV1(value: unknown): JobMatchReportPayloadV1 {
  try { validateCanonicalValueV1(value); } catch { throw new Error("Job Match Report is outside the canonical value domain."); }
  if (!isRecord(value) || !exactKeys(value, [
    "appliedWeightBps", "careerProfile", "componentScores", "conflicts", "contractVersion", "jobPosting",
    "limitations", "matchOperationId", "matchedRequirements", "matchingConfiguration", "overallScoreBps",
    "scoreScale", "unknownRequirements", "unmatchedRequirements", "unsupportedRequirements",
  ]) || value.contractVersion !== JOB_MATCH_REPORT_PAYLOAD_VERSION_V1 || !identifier(value.matchOperationId)
    || !score(value.overallScoreBps) || !score(value.appliedWeightBps)) throw new Error("Job Match Report is invalid.");
  validateMatchingConfigurationV1(value.matchingConfiguration);
  if (!isRecord(value.scoreScale) || !exactKeys(value.scoreScale, ["maximum", "rounding", "unit"])
    || value.scoreScale.unit !== "basis-points" || value.scoreScale.maximum !== 10000 || value.scoreScale.rounding !== "floor") throw new Error("Score scale is invalid.");
  const ref = (item: unknown, payloadVersion: string) => isRecord(item)
    && exactKeys(item, ["objectId", "payloadVersion", "revision"])
    && (() => { try { asObjectIdV1(item.objectId); return true; } catch { return false; } })()
    && Number.isSafeInteger(item.revision) && (item.revision as number) >= 1 && item.payloadVersion === payloadVersion;
  if (!ref(value.careerProfile, "aion.career-profile-payload.v1") || !ref(value.jobPosting, "aion.job-posting-payload.v1")) throw new Error("Report input references are invalid.");
  if (!Array.isArray(value.componentScores) || value.componentScores.length !== MATCH_COMPONENT_IDS_V1.length) throw new Error("Component scores are invalid.");
  for (const [index, component] of value.componentScores.entries()) {
    if (!isRecord(component) || !exactKeys(component, ["applied", "component", "evidence", "reasons", "scoreBps", "status", "weightBps"])
      || component.component !== MATCH_COMPONENT_IDS_V1[index] || typeof component.applied !== "boolean"
      || !score(component.weightBps) || (component.scoreBps !== null && !score(component.scoreBps))
      || !Array.isArray(component.evidence) || component.evidence.some((item) => !validateEvidence(item))
      || !sortedUniqueStrings(component.reasons)) throw new Error("Component score is invalid.");
  }
  const requirementArray = (input: unknown, outcome: RequirementOutcomeV1) => Array.isArray(input) && input.every((item) =>
    isRecord(item) && exactKeys(item, ["category", "evidence", "outcome", "reason", "requirement"])
    && item.outcome === outcome && typeof item.category === "string" && typeof item.requirement === "string"
    && typeof item.reason === "string" && Array.isArray(item.evidence) && item.evidence.every(validateEvidence));
  if (!requirementArray(value.matchedRequirements, "matched") || !requirementArray(value.unmatchedRequirements, "unmatched")
    || !Array.isArray(value.unknownRequirements) || value.unknownRequirements.some((item) => !isRecord(item) || !["unknown", "conflict"].includes(item.outcome as string))
    || !sortedUniqueStrings(value.conflicts) || !sortedUniqueStrings(value.unsupportedRequirements)
    || !sortedUniqueStrings(value.limitations)) throw new Error("Report explanations are invalid.");
  return value as unknown as JobMatchReportPayloadV1;
}
