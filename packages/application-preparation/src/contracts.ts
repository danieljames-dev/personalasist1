import { asActorIdV1, asOwnerIdV1, type ActorIdV1, type OwnerIdV1 } from "@aion/identity";
import {
  asObjectIdV1,
  validateCanonicalIdentifierV1,
  validateCanonicalValueV1,
  type CanonicalValueV1,
  type ObjectIdV1,
} from "@aion/object";

export const APPLICATION_DRAFT_PAYLOAD_VERSION_V1 = "aion.application-draft-payload.v1" as const;
export const APPLICATION_PREPARATION_OPERATION_VERSION_V1 = "aion.application-preparation-operation.v1" as const;
export const OWNER_REVIEW_LABEL_V1 = "Draft — Owner Review Required" as const;

export interface DraftFactCitationV1 {
  readonly factId: ObjectIdV1;
  readonly factRevision: number;
  readonly factType: string;
  readonly sourceObjectId: ObjectIdV1;
  readonly sourceLocation: string;
}
export interface EvidenceBackedClaimV1 {
  readonly text: string;
  readonly citations: readonly (DraftFactCitationV1 & CanonicalValueV1)[];
}
export interface ApplicationDraftPayloadV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly contractVersion: typeof APPLICATION_DRAFT_PAYLOAD_VERSION_V1;
  readonly preparationOperationId: string;
  readonly reviewStatus: typeof OWNER_REVIEW_LABEL_V1;
  readonly jobMatch: { readonly objectId: ObjectIdV1; readonly revision: number; readonly payloadVersion: string } & CanonicalValueV1;
  readonly jobMatchJson: CanonicalValueV1;
  readonly jobMatchMarkdown: string;
  readonly resumeRecommendations: readonly (EvidenceBackedClaimV1 & CanonicalValueV1)[];
  readonly coverLetterDraft: string;
  readonly coverLetterClaims: readonly (EvidenceBackedClaimV1 & CanonicalValueV1)[];
  readonly applicationQuestionPreparation: readonly string[];
  readonly missingInformationChecklist: readonly string[];
  readonly evidenceAppendix: readonly (DraftFactCitationV1 & CanonicalValueV1)[];
  readonly limitations: readonly string[];
}
export interface ApplicationPreparationRequestV1 {
  readonly version: "1";
  readonly preparationOperationId: string;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly jobMatchObjectId: ObjectIdV1;
  readonly jobMatchRevision: number;
}
export interface ApplicationPreparationResultV1 {
  readonly version: "1";
  readonly outcome: "success" | "already-completed" | "rejected";
  readonly draftReference: { readonly version: "1"; readonly fingerprint: string } | null;
  readonly relationshipReferences: readonly { readonly version: "1"; readonly fingerprint: string }[];
  readonly usedFactCount: number;
  readonly createdObjectCount: 0 | 1;
  readonly createdRelationshipCount: number;
  readonly error: null | {
    readonly version: "1";
    readonly code: "request-invalid" | "not-found" | "owner-mismatch" | "revision-conflict" | "object-invalid" | "persistence-failed";
    readonly stage: "request" | "load" | "preparation" | "persistence";
    readonly message: string;
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function identifier(value: unknown): value is string {
  try { validateCanonicalIdentifierV1(value, "$.identifier"); return true; } catch { return false; }
}
function sortedUnique(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  return value.every((item, index) => typeof item === "string" && item.length > 0 && item.trim() === item
    && (index === 0 || (value[index - 1] as string) < item));
}
function citation(value: unknown): value is DraftFactCitationV1 {
  if (!record(value) || !exact(value, ["factId", "factRevision", "factType", "sourceLocation", "sourceObjectId"])
    || !Number.isSafeInteger(value.factRevision) || (value.factRevision as number) < 1
    || typeof value.factType !== "string" || typeof value.sourceLocation !== "string") return false;
  try { asObjectIdV1(value.factId); asObjectIdV1(value.sourceObjectId); return true; } catch { return false; }
}
function claim(value: unknown): value is EvidenceBackedClaimV1 {
  return record(value) && exact(value, ["citations", "text"]) && typeof value.text === "string"
    && value.text.length > 0 && Array.isArray(value.citations) && value.citations.length > 0
    && value.citations.every(citation);
}

export function validateApplicationPreparationRequestV1(value: unknown): ApplicationPreparationRequestV1 {
  if (!record(value) || !exact(value, ["actorId", "jobMatchObjectId", "jobMatchRevision", "ownerId", "preparationOperationId", "version"])
    || value.version !== "1" || !identifier(value.preparationOperationId)
    || !Number.isSafeInteger(value.jobMatchRevision) || (value.jobMatchRevision as number) < 1) throw new Error("A closed version-1 application preparation request is required.");
  try { asOwnerIdV1(value.ownerId); asActorIdV1(value.actorId); asObjectIdV1(value.jobMatchObjectId); }
  catch { throw new Error("Typed Identity and Object references are required."); }
  return value as unknown as ApplicationPreparationRequestV1;
}

export function validateApplicationDraftPayloadV1(value: unknown): ApplicationDraftPayloadV1 {
  try { validateCanonicalValueV1(value); } catch { throw new Error("Application Draft is outside the canonical value domain."); }
  if (!record(value) || !exact(value, [
    "applicationQuestionPreparation", "contractVersion", "coverLetterClaims", "coverLetterDraft",
    "evidenceAppendix", "jobMatch", "jobMatchJson", "jobMatchMarkdown", "limitations",
    "missingInformationChecklist", "preparationOperationId", "resumeRecommendations", "reviewStatus",
  ]) || value.contractVersion !== APPLICATION_DRAFT_PAYLOAD_VERSION_V1 || value.reviewStatus !== OWNER_REVIEW_LABEL_V1
    || !identifier(value.preparationOperationId) || typeof value.jobMatchMarkdown !== "string"
    || !value.jobMatchMarkdown.startsWith(`# ${OWNER_REVIEW_LABEL_V1}`)
    || typeof value.coverLetterDraft !== "string" || !value.coverLetterDraft.startsWith(OWNER_REVIEW_LABEL_V1)) throw new Error("Application Draft is invalid.");
  if (!record(value.jobMatch) || !exact(value.jobMatch, ["objectId", "payloadVersion", "revision"])
    || !Number.isSafeInteger(value.jobMatch.revision) || (value.jobMatch.revision as number) < 1
    || value.jobMatch.payloadVersion !== "aion.job-match-report-payload.v1") throw new Error("Job Match reference is invalid.");
  try { asObjectIdV1(value.jobMatch.objectId); } catch { throw new Error("Job Match reference is invalid."); }
  if (!Array.isArray(value.resumeRecommendations) || !value.resumeRecommendations.every(claim)
    || !Array.isArray(value.coverLetterClaims) || !value.coverLetterClaims.every(claim)
    || !Array.isArray(value.evidenceAppendix) || !value.evidenceAppendix.every(citation)
    || !sortedUnique(value.applicationQuestionPreparation) || !sortedUnique(value.missingInformationChecklist)
    || !sortedUnique(value.limitations)) throw new Error("Draft sections are invalid.");
  const allowed = new Set((value.evidenceAppendix as DraftFactCitationV1[]).map((item) => `${item.factId}:${item.factRevision}`));
  for (const item of [...value.resumeRecommendations as unknown as EvidenceBackedClaimV1[], ...value.coverLetterClaims as unknown as EvidenceBackedClaimV1[]]) {
    if (item.citations.some((entry) => !allowed.has(`${entry.factId}:${entry.factRevision}`))) throw new Error("Every claim citation must appear in the evidence appendix.");
  }
  return value as unknown as ApplicationDraftPayloadV1;
}
