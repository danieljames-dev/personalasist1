import type { CareerFactKindV1 } from "@aion/career-input";
import {
  asActorIdV1,
  asOwnerIdV1,
  type ActorIdV1,
  type OwnerIdV1,
} from "@aion/identity";
import {
  asObjectIdV1,
  isCanonicalObjectTimestampV1,
  validateCanonicalIdentifierV1,
  validateCanonicalValueV1,
  type CanonicalValueV1,
  type ObjectIdV1,
} from "@aion/object";
import type { ApprovedRootV1, ExplicitInputPathV1 } from "@aion/privacy-boundary";

export const CAREER_SOURCE_PAYLOAD_VERSION_V1 = "aion.career-source-payload.v1" as const;
export const CAREER_FACT_PAYLOAD_VERSION_V1 = "aion.career-fact-payload.v1" as const;
export const CAREER_PROFILE_PAYLOAD_VERSION_V1 = "aion.career-profile-payload.v1" as const;
export const CAREER_EVIDENCE_IMPORT_VERSION_V1 = "aion.career-evidence-import.v1" as const;
export const CAREER_PROFILE_BUILD_VERSION_V1 = "aion.career-profile-build.v1" as const;

export type CareerEvidenceSourceTypeV1 =
  | "career-facts-json"
  | "career-preferences-json"
  | "resume-evidence-markdown"
  | "work-history-evidence-markdown"
  | "plain-text-evidence";

export type ProcessingOutcomeStateV1 = "pending" | "success" | "partial" | "rejected";

export interface ProcessingOutcomeV1 {
  readonly version: "1";
  readonly state: ProcessingOutcomeStateV1;
  readonly acceptedFactCount: number;
  readonly relationshipCount: number;
  readonly reasonCodes: readonly string[];
}

export interface ParserDescriptorV1 {
  readonly version: "1";
  readonly parserId: string;
  readonly parserVersion: "1";
  readonly sourceLocationFormat: "json-pointer-v1" | "line-number-v1";
}

export type SourceLocationIndexV1 =
  | {
      readonly version: "1";
      readonly format: "json-pointer-v1";
      readonly locations: readonly string[];
    }
  | {
      readonly version: "1";
      readonly format: "line-number-v1";
      readonly lineCount: number;
      readonly sectionStartLines: readonly number[];
    };

export interface ContentDigestV1 {
  readonly algorithm: "sha-256";
  readonly digest: string;
}

export interface EvidenceCatalogueEntryV1 {
  readonly version: "1";
  readonly importOperationId: string;
  readonly sourceObjectId: ObjectIdV1;
  readonly originalFilename: string;
  readonly approvedRelativePath: string;
  readonly sourceType: CareerEvidenceSourceTypeV1;
  readonly importedAt: string;
  readonly contentDigest: ContentDigestV1;
  readonly ownerId: OwnerIdV1;
  readonly importingActorId: ActorIdV1;
  readonly parser: ParserDescriptorV1;
  readonly processingOutcome: ProcessingOutcomeV1;
  readonly locationIndex: SourceLocationIndexV1;
}

export interface CareerSourcePayloadV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly contractVersion: typeof CAREER_SOURCE_PAYLOAD_VERSION_V1;
  readonly catalogueEntry: EvidenceCatalogueEntryV1 & CanonicalValueV1;
}

export type CareerFactTypeV1 = CareerFactKindV1 | "start-date" | "end-date";

export type NormalizedCareerFactValueV1 =
  | { readonly state: "unknown" | "explicit-empty" | "not-applicable" }
  | { readonly state: "supplied"; readonly value: string };

export type CareerFactAssertionStateV1 = "owner-confirmed" | "extracted" | "inferred" | "missing";
export type CareerFactVerificationStateV1 = "unverified" | "verified";
export type CareerFactConflictStateV1 = "none" | "conflicting";

export interface CareerFactStatusV1 {
  readonly version: "1";
  readonly verification: CareerFactVerificationStateV1;
  readonly assertion: CareerFactAssertionStateV1;
  readonly conflict: CareerFactConflictStateV1;
}

export type CareerFactConfidenceV1 =
  | "owner-asserted"
  | "deterministic-extraction"
  | "deterministic-inference"
  | "not-assessed";

export interface CareerFactExtractionMethodV1 {
  readonly version: "1";
  readonly method:
    | "structured-owner-input"
    | "deterministic-structured-extraction"
    | "deterministic-rule"
    | "deterministic-missing-state";
  readonly parser: ParserDescriptorV1;
  readonly ruleId: string | null;
}

export type CareerFactConflictV1 =
  | { readonly version: "1"; readonly state: "none" }
  | {
      readonly version: "1";
      readonly state: "conflicting";
      readonly groupId: string;
      readonly conflictingFactIds: readonly ObjectIdV1[];
      readonly fieldLocations: readonly string[];
    };

export type CareerFactSupersessionStateV1 =
  | { readonly version: "1"; readonly state: "current" }
  | {
      readonly version: "1";
      readonly state: "superseded";
      readonly replacementFactId: ObjectIdV1;
      readonly supersededAt: string;
    };

export interface CareerFactCandidateV1 {
  readonly version: "1";
  readonly sourceClaimId: string;
  readonly factType: CareerFactTypeV1;
  readonly normalizedValue: NormalizedCareerFactValueV1;
  readonly sourceLocation: string;
  readonly confidence: CareerFactConfidenceV1;
  readonly ownerConfirmed: boolean;
  readonly status: CareerFactStatusV1;
  readonly extractionMethod: CareerFactExtractionMethodV1;
}

export interface CareerFactPayloadV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly contractVersion: typeof CAREER_FACT_PAYLOAD_VERSION_V1;
  readonly factId: ObjectIdV1;
  readonly factType: CareerFactTypeV1;
  readonly normalizedValue: NormalizedCareerFactValueV1 & CanonicalValueV1;
  readonly sourceObjectId: ObjectIdV1;
  readonly sourceLocation: string;
  readonly confidence: CareerFactConfidenceV1;
  readonly ownerConfirmed: boolean;
  readonly status: CareerFactStatusV1 & CanonicalValueV1;
  readonly extractionMethod: CareerFactExtractionMethodV1 & CanonicalValueV1;
  readonly createdAt: string;
  readonly conflict: CareerFactConflictV1 & CanonicalValueV1;
  readonly supersession: CareerFactSupersessionStateV1 & CanonicalValueV1;
}

export interface CareerProfileFactStateV1 {
  readonly version: "1";
  readonly factId: ObjectIdV1;
  readonly factRevision: number;
  readonly factType: CareerFactTypeV1;
  readonly confidence: CareerFactConfidenceV1;
  readonly status: CareerFactStatusV1;
  readonly supersessionState: "current" | "superseded";
}

export interface CareerProfilePayloadV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly contractVersion: typeof CAREER_PROFILE_PAYLOAD_VERSION_V1;
  readonly buildOperationId: string;
  readonly buildConfigurationVersion: "1";
  readonly processingOutcome: ProcessingOutcomeV1 & CanonicalValueV1;
  readonly factStates: readonly (CareerProfileFactStateV1 & CanonicalValueV1)[];
  readonly missingFactTypes: readonly CareerFactTypeV1[];
}

export interface CareerEvidenceImportRequestV1 {
  readonly version: "1";
  readonly importOperationId: string;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly approvedInputRoot: ApprovedRootV1;
  readonly sourcePath: ExplicitInputPathV1;
  readonly sourceType: CareerEvidenceSourceTypeV1;
}

export interface CareerEvidenceErrorV1 {
  readonly version: "1";
  readonly code: CareerEvidenceErrorCodeV1;
  readonly stage: "request" | "preflight" | "source" | "contract" | "persistence" | "profile";
  readonly message: string;
}

export type CareerEvidenceErrorCodeV1 =
  | "request-invalid"
  | "preflight-rejected"
  | "unsupported-source"
  | "source-read-failed"
  | "source-changed"
  | "contract-invalid"
  | "object-invalid"
  | "not-found"
  | "owner-mismatch"
  | "revision-conflict"
  | "persistence-failed";

export class CareerEvidenceOperationErrorV1 extends Error {
  constructor(
    readonly code: CareerEvidenceErrorCodeV1,
    readonly stage: CareerEvidenceErrorV1["stage"],
    message: string,
  ) {
    super(message.slice(0, 512));
    this.name = "CareerEvidenceOperationErrorV1";
  }

  toResult(): CareerEvidenceErrorV1 {
    return { version: "1", code: this.code, stage: this.stage, message: this.message };
  }
}

export interface PrivateObjectReferenceSummaryV1 {
  readonly version: "1";
  readonly fingerprint: string;
}

export interface CareerEvidenceDryRunResultV1 {
  readonly version: "1";
  readonly accepted: boolean;
  readonly sourceReference: PrivateObjectReferenceSummaryV1 | null;
  readonly sourceType: CareerEvidenceSourceTypeV1 | null;
  readonly contentDigest: ContentDigestV1 | null;
  readonly proposedFactCount: number;
  readonly proposedRelationshipCount: number;
  readonly conflictCount: number;
  readonly warningCodes: readonly string[];
  readonly error: CareerEvidenceErrorV1 | null;
  readonly summary: {
    readonly contentReturned: false;
    readonly completePathReturned: false;
    readonly objectWrites: 0;
    readonly identityWrites: 0;
    readonly sourceCopies: 0;
    readonly networkActions: 0;
  };
}

export interface CareerEvidenceImportResultV1 {
  readonly version: "1";
  readonly outcome: "success" | "already-completed" | "partial" | "rejected";
  readonly sourceReference: PrivateObjectReferenceSummaryV1 | null;
  readonly factReferences: readonly PrivateObjectReferenceSummaryV1[];
  readonly relationshipReferences: readonly PrivateObjectReferenceSummaryV1[];
  readonly createdFacts: number;
  readonly reusedFacts: number;
  readonly createdRelationships: number;
  readonly reusedRelationships: number;
  readonly recoveryRequired: boolean;
  readonly error: CareerEvidenceErrorV1 | null;
}

export interface CareerFactConflictRequestV1 {
  readonly version: "1";
  readonly conflictOperationId: string;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly factIds: readonly ObjectIdV1[];
  readonly expectedRevisions: readonly number[];
  readonly fieldLocations: readonly string[];
}

export interface CareerFactSupersessionRequestV1 {
  readonly version: "1";
  readonly supersessionOperationId: string;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly priorFactId: ObjectIdV1;
  readonly replacementFactId: ObjectIdV1;
  readonly expectedPriorRevision: number;
}

export interface CareerFactOperationResultV1 {
  readonly version: "1";
  readonly outcome: "success" | "already-completed" | "partial" | "rejected";
  readonly factReferences: readonly PrivateObjectReferenceSummaryV1[];
  readonly recoveryRequired: boolean;
  readonly error: CareerEvidenceErrorV1 | null;
}

export interface CareerProfileBuildRequestV1 {
  readonly version: "1";
  readonly buildOperationId: string;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly profileObjectId: ObjectIdV1 | null;
  readonly expectedRevision: number | null;
  readonly factIds: readonly ObjectIdV1[];
  readonly requiredFactTypes: readonly CareerFactTypeV1[];
  readonly buildConfigurationVersion: "1";
}

export interface CareerProfileBuildResultV1 {
  readonly version: "1";
  readonly outcome: "success" | "already-completed" | "partial" | "rejected";
  readonly profileReference: PrivateObjectReferenceSummaryV1 | null;
  readonly relationshipReferences: readonly PrivateObjectReferenceSummaryV1[];
  readonly includedFactCount: number;
  readonly missingFactTypes: readonly CareerFactTypeV1[];
  readonly recoveryRequired: boolean;
  readonly error: CareerEvidenceErrorV1 | null;
}

const FACT_TYPES = new Set<string>([
  "role-title", "employer", "responsibility", "accomplishment", "skill", "tool-or-technology",
  "certification", "education", "license", "industry", "project", "start-date", "end-date",
]);
const SOURCE_TYPES = new Set<string>([
  "career-facts-json", "career-preferences-json", "resume-evidence-markdown",
  "work-history-evidence-markdown", "plain-text-evidence",
]);
const DIGEST = /^[0-9a-f]{64}$/;
const JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)+$/;
const LINE_LOCATION = /^line:[1-9][0-9]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function fail(message = "Career evidence contract validation failed."): never {
  throw new CareerEvidenceOperationErrorV1("contract-invalid", "contract", message);
}

function canonical(value: unknown): void {
  try { validateCanonicalValueV1(value); } catch { fail(); }
}

function identifier(value: unknown): value is string {
  try { validateCanonicalIdentifierV1(value, "$.identifier"); return true; } catch { return false; }
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function sortedUniqueStrings(value: unknown, validator: (item: string) => boolean = () => true): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  let prior: string | undefined;
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.trim() !== item || !validator(item)
      || (prior !== undefined && prior >= item)) return false;
    prior = item;
  }
  return true;
}

function factType(value: unknown): value is CareerFactTypeV1 {
  return typeof value === "string" && FACT_TYPES.has(value);
}

function validateOutcome(value: unknown): asserts value is ProcessingOutcomeV1 {
  if (!isRecord(value) || !exactKeys(value, ["acceptedFactCount", "reasonCodes", "relationshipCount", "state", "version"])
    || value.version !== "1" || !["pending", "success", "partial", "rejected"].includes(value.state as string)
    || !nonnegative(value.acceptedFactCount) || !nonnegative(value.relationshipCount)
    || !sortedUniqueStrings(value.reasonCodes, identifier)) fail();
}

export function validateParserDescriptorV1(value: unknown): ParserDescriptorV1 {
  canonical(value);
  if (!isRecord(value) || !exactKeys(value, ["parserId", "parserVersion", "sourceLocationFormat", "version"])
    || value.version !== "1" || value.parserVersion !== "1" || !identifier(value.parserId)
    || !["json-pointer-v1", "line-number-v1"].includes(value.sourceLocationFormat as string)) fail();
  return value as unknown as ParserDescriptorV1;
}

function validateLocationIndex(value: unknown, format: ParserDescriptorV1["sourceLocationFormat"]): asserts value is SourceLocationIndexV1 {
  if (!isRecord(value) || value.version !== "1" || value.format !== format) fail();
  if (format === "json-pointer-v1") {
    if (!exactKeys(value, ["format", "locations", "version"])
      || !sortedUniqueStrings(value.locations, (item) => JSON_POINTER.test(item))) fail();
    return;
  }
  if (!exactKeys(value, ["format", "lineCount", "sectionStartLines", "version"])
    || !nonnegative(value.lineCount) || !Array.isArray(value.sectionStartLines)) fail();
  let prior = 0;
  for (const line of value.sectionStartLines) {
    if (!positive(line) || line > (value.lineCount as number) || line <= prior) fail();
    prior = line;
  }
}

function validateRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function validateEvidenceCatalogueEntryV1(value: unknown): EvidenceCatalogueEntryV1 {
  canonical(value);
  if (!isRecord(value) || !exactKeys(value, [
    "approvedRelativePath", "contentDigest", "importedAt", "importingActorId", "importOperationId", "locationIndex",
    "originalFilename", "ownerId", "parser", "processingOutcome", "sourceObjectId", "sourceType", "version",
  ]) || value.version !== "1") fail();
  try { asObjectIdV1(value.sourceObjectId); asOwnerIdV1(value.ownerId); asActorIdV1(value.importingActorId); } catch { fail(); }
  if (!identifier(value.importOperationId) || !SOURCE_TYPES.has(value.sourceType as string) || !isCanonicalObjectTimestampV1(value.importedAt)
    || !validateRelativePath(value.approvedRelativePath) || typeof value.originalFilename !== "string"
    || value.originalFilename !== value.approvedRelativePath.split("/").at(-1)) fail();
  if (!isRecord(value.contentDigest) || !exactKeys(value.contentDigest, ["algorithm", "digest"])
    || value.contentDigest.algorithm !== "sha-256" || typeof value.contentDigest.digest !== "string"
    || !DIGEST.test(value.contentDigest.digest)) fail();
  const parser = validateParserDescriptorV1(value.parser);
  validateOutcome(value.processingOutcome);
  validateLocationIndex(value.locationIndex, parser.sourceLocationFormat);
  return value as unknown as EvidenceCatalogueEntryV1;
}

export function validateCareerSourcePayloadV1(value: unknown): CareerSourcePayloadV1 {
  canonical(value);
  if (!isRecord(value) || !exactKeys(value, ["catalogueEntry", "contractVersion"])
    || value.contractVersion !== CAREER_SOURCE_PAYLOAD_VERSION_V1) fail();
  validateEvidenceCatalogueEntryV1(value.catalogueEntry);
  return value as unknown as CareerSourcePayloadV1;
}

function validateNormalizedValue(value: unknown): asserts value is NormalizedCareerFactValueV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (["unknown", "explicit-empty", "not-applicable"].includes(value.state)) {
    if (!exactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !exactKeys(value, ["state", "value"])
    || typeof value.value !== "string" || value.value.length === 0 || value.value.trim() !== value.value) fail();
}

function validateStatus(value: unknown): asserts value is CareerFactStatusV1 {
  if (!isRecord(value) || !exactKeys(value, ["assertion", "conflict", "verification", "version"])
    || value.version !== "1" || !["unverified", "verified"].includes(value.verification as string)
    || !["owner-confirmed", "extracted", "inferred", "missing"].includes(value.assertion as string)
    || !["none", "conflicting"].includes(value.conflict as string)) fail();
}

function validateExtraction(value: unknown): asserts value is CareerFactExtractionMethodV1 {
  if (!isRecord(value) || !exactKeys(value, ["method", "parser", "ruleId", "version"])
    || value.version !== "1" || ![
      "structured-owner-input", "deterministic-structured-extraction", "deterministic-rule",
      "deterministic-missing-state",
    ].includes(value.method as string)) fail();
  validateParserDescriptorV1(value.parser);
  if (value.method === "deterministic-rule") {
    if (!identifier(value.ruleId)) fail();
  } else if (value.ruleId !== null) fail();
}

function validateConflict(value: unknown, factId: ObjectIdV1): asserts value is CareerFactConflictV1 {
  if (!isRecord(value) || value.version !== "1" || typeof value.state !== "string") fail();
  if (value.state === "none") {
    if (!exactKeys(value, ["state", "version"])) fail();
    return;
  }
  if (value.state !== "conflicting" || !exactKeys(value, ["conflictingFactIds", "fieldLocations", "groupId", "state", "version"])
    || !identifier(value.groupId) || !Array.isArray(value.conflictingFactIds) || value.conflictingFactIds.length < 1
    || !sortedUniqueStrings(value.conflictingFactIds, (item) => { try { asObjectIdV1(item); return item !== factId; } catch { return false; } })
    || !sortedUniqueStrings(value.fieldLocations, (item) => JSON_POINTER.test(item) || LINE_LOCATION.test(item))) fail();
}

function validateSupersession(value: unknown): asserts value is CareerFactSupersessionStateV1 {
  if (!isRecord(value) || value.version !== "1" || typeof value.state !== "string") fail();
  if (value.state === "current") {
    if (!exactKeys(value, ["state", "version"])) fail();
    return;
  }
  if (value.state !== "superseded" || !exactKeys(value, ["replacementFactId", "state", "supersededAt", "version"])) fail();
  try { asObjectIdV1(value.replacementFactId); } catch { fail(); }
  if (!isCanonicalObjectTimestampV1(value.supersededAt)) fail();
}

function validateFactSemantics(value: {
  normalizedValue: NormalizedCareerFactValueV1;
  confidence: CareerFactConfidenceV1;
  ownerConfirmed: boolean;
  status: CareerFactStatusV1;
  extractionMethod: CareerFactExtractionMethodV1;
}): void {
  const { assertion } = value.status;
  if (value.ownerConfirmed !== (assertion === "owner-confirmed")) fail();
  if (assertion === "owner-confirmed" && (value.extractionMethod.method !== "structured-owner-input" || value.confidence !== "owner-asserted")) fail();
  if (assertion === "extracted" && (value.extractionMethod.method !== "deterministic-structured-extraction" || value.confidence !== "deterministic-extraction")) fail();
  if (assertion === "inferred" && (value.extractionMethod.method !== "deterministic-rule" || value.confidence !== "deterministic-inference")) fail();
  if (assertion === "missing" && (value.extractionMethod.method !== "deterministic-missing-state" || value.confidence !== "not-assessed"
    || !["unknown", "not-applicable"].includes(value.normalizedValue.state))) fail();
  if (assertion !== "missing" && value.normalizedValue.state === "unknown") fail();
}

export function validateCareerFactCandidateV1(value: unknown): CareerFactCandidateV1 {
  canonical(value);
  if (!isRecord(value) || !exactKeys(value, [
    "confidence", "extractionMethod", "factType", "normalizedValue", "ownerConfirmed",
    "sourceClaimId", "sourceLocation", "status", "version",
  ]) || value.version !== "1" || !identifier(value.sourceClaimId) || !factType(value.factType)
    || typeof value.ownerConfirmed !== "boolean" || typeof value.sourceLocation !== "string"
    || !(JSON_POINTER.test(value.sourceLocation) || LINE_LOCATION.test(value.sourceLocation))
    || !["owner-asserted", "deterministic-extraction", "deterministic-inference", "not-assessed"].includes(value.confidence as string)) fail();
  validateNormalizedValue(value.normalizedValue);
  validateStatus(value.status);
  validateExtraction(value.extractionMethod);
  validateFactSemantics(value as unknown as Parameters<typeof validateFactSemantics>[0]);
  return value as unknown as CareerFactCandidateV1;
}

export function validateCareerFactPayloadV1(value: unknown): CareerFactPayloadV1 {
  canonical(value);
  if (!isRecord(value) || !exactKeys(value, [
    "confidence", "conflict", "contractVersion", "createdAt", "extractionMethod", "factId",
    "factType", "normalizedValue", "ownerConfirmed", "sourceLocation", "sourceObjectId", "status", "supersession",
  ]) || value.contractVersion !== CAREER_FACT_PAYLOAD_VERSION_V1 || !factType(value.factType)
    || typeof value.ownerConfirmed !== "boolean" || !isCanonicalObjectTimestampV1(value.createdAt)
    || typeof value.sourceLocation !== "string" || !(JSON_POINTER.test(value.sourceLocation) || LINE_LOCATION.test(value.sourceLocation))
    || !["owner-asserted", "deterministic-extraction", "deterministic-inference", "not-assessed"].includes(value.confidence as string)) fail();
  let factId: ObjectIdV1;
  try { factId = asObjectIdV1(value.factId); asObjectIdV1(value.sourceObjectId); } catch { fail(); }
  validateNormalizedValue(value.normalizedValue);
  validateStatus(value.status);
  validateExtraction(value.extractionMethod);
  validateConflict(value.conflict, factId!);
  validateSupersession(value.supersession);
  if ((value.status as CareerFactStatusV1).conflict !== (value.conflict as CareerFactConflictV1).state) fail();
  validateFactSemantics(value as unknown as Parameters<typeof validateFactSemantics>[0]);
  return value as unknown as CareerFactPayloadV1;
}

function validateProfileFactState(value: unknown): asserts value is CareerProfileFactStateV1 {
  if (!isRecord(value) || !exactKeys(value, ["confidence", "factId", "factRevision", "factType", "status", "supersessionState", "version"])
    || value.version !== "1" || !positive(value.factRevision) || !factType(value.factType)
    || !["owner-asserted", "deterministic-extraction", "deterministic-inference", "not-assessed"].includes(value.confidence as string)
    || !["current", "superseded"].includes(value.supersessionState as string)) fail();
  try { asObjectIdV1(value.factId); } catch { fail(); }
  validateStatus(value.status);
}

export function validateCareerProfilePayloadV1(value: unknown): CareerProfilePayloadV1 {
  canonical(value);
  if (!isRecord(value) || !exactKeys(value, [
    "buildConfigurationVersion", "buildOperationId", "contractVersion", "factStates",
    "missingFactTypes", "processingOutcome",
  ]) || value.contractVersion !== CAREER_PROFILE_PAYLOAD_VERSION_V1 || value.buildConfigurationVersion !== "1"
    || !identifier(value.buildOperationId) || !Array.isArray(value.factStates) || !Array.isArray(value.missingFactTypes)) fail();
  validateOutcome(value.processingOutcome);
  let priorId: string | undefined;
  for (const state of value.factStates) {
    validateProfileFactState(state);
    if (priorId !== undefined && priorId >= state.factId) fail();
    priorId = state.factId;
  }
  let priorType: string | undefined;
  for (const item of value.missingFactTypes) {
    if (!factType(item) || (priorType !== undefined && priorType >= item)) fail();
    priorType = item;
  }
  return value as unknown as CareerProfilePayloadV1;
}

export function validateCareerEvidenceImportRequestV1(value: unknown): CareerEvidenceImportRequestV1 {
  if (!isRecord(value) || !exactKeys(value, ["actorId", "approvedInputRoot", "importOperationId", "ownerId", "sourcePath", "sourceType", "version"])
    || value.version !== "1" || !identifier(value.importOperationId) || !SOURCE_TYPES.has(value.sourceType as string)) {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "A closed version-1 import request is required.");
  }
  try { asOwnerIdV1(value.ownerId); asActorIdV1(value.actorId); } catch {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "Synthetic or approved typed Identity references are required.");
  }
  if (!isRecord(value.approvedInputRoot) || !exactKeys(value.approvedInputRoot, ["absolutePath", "reference", "version"])
    || value.approvedInputRoot.version !== "1" || typeof value.approvedInputRoot.absolutePath !== "string"
    || typeof value.approvedInputRoot.reference !== "string" || !isRecord(value.sourcePath)
    || !exactKeys(value.sourcePath, ["absolutePath", "version"]) || value.sourcePath.version !== "1"
    || typeof value.sourcePath.absolutePath !== "string") {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "Explicit approved-root and source-path values are required.");
  }
  return value as unknown as CareerEvidenceImportRequestV1;
}

export function isCareerFactTypeV1(value: unknown): value is CareerFactTypeV1 {
  return factType(value);
}
