import type {
  EmploymentTypeV1,
  JobPostingCompensationV1,
  JobPostingInputV1,
  WorkArrangementV1,
} from "@aion/career-input";
import { asActorIdV1, asOwnerIdV1, type ActorIdV1, type OwnerIdV1 } from "@aion/identity";
import {
  asObjectIdV1,
  isCanonicalObjectTimestampV1,
  validateCanonicalIdentifierV1,
  validateCanonicalValueV1,
  type CanonicalValueV1,
  type ObjectIdV1,
} from "@aion/object";
import type { ApprovedRootV1, ExplicitInputPathV1 } from "@aion/privacy-boundary";

export const JOB_POSTING_PAYLOAD_VERSION_V1 = "aion.job-posting-payload.v1" as const;
export const JOB_POSTING_IMPORT_VERSION_V1 = "aion.job-posting-import.v1" as const;

export type JobPostingSourceTypeV1 = "structured-json" | "markdown" | "text";

export type JobPostingTextValueV1 =
  | { readonly state: "not-supplied" | "unknown" | "explicit-empty" }
  | { readonly state: "supplied"; readonly value: string };

export type JobPostingEnumValueV1<T extends string> =
  | { readonly state: "not-supplied" | "unknown" }
  | { readonly state: "supplied"; readonly value: T };

export type JobPostingListValueV1 =
  | { readonly state: "not-supplied" | "unknown" | "no-preference"; readonly values: readonly [] }
  | { readonly state: "specified"; readonly values: readonly string[] };

export type JobPostingCompensationPayloadV1 =
  | { readonly state: "not-supplied" | "unknown" }
  | {
      readonly state: "supplied";
      readonly currency: string;
      readonly minimumMinorUnits: number | null;
      readonly maximumMinorUnits: number | null;
    };

export type JobPostingDateValueV1 =
  | { readonly state: "not-supplied" | "unknown" | "not-applicable" }
  | { readonly state: "supplied"; readonly value: string };

export interface JobPostingFieldsV1 {
  readonly title: JobPostingTextValueV1;
  readonly company: JobPostingTextValueV1;
  readonly location: JobPostingTextValueV1;
  readonly workArrangement: JobPostingEnumValueV1<WorkArrangementV1>;
  readonly employmentType: JobPostingEnumValueV1<EmploymentTypeV1>;
  readonly compensation: JobPostingCompensationPayloadV1;
  readonly description: JobPostingTextValueV1;
  readonly requiredSkills: JobPostingListValueV1;
  readonly preferredSkills: JobPostingListValueV1;
  readonly requiredExperience: JobPostingTextValueV1;
  readonly educationRequirements: JobPostingListValueV1;
  readonly certificationRequirements: JobPostingListValueV1;
  readonly travel: JobPostingTextValueV1;
  readonly schedule: JobPostingTextValueV1;
  readonly applicationDeadline: JobPostingDateValueV1;
  readonly sourceReference: JobPostingTextValueV1;
}

export interface JobPostingParserDescriptorV1 {
  readonly version: "1";
  readonly parserName:
    | "aion.job-posting.structured-json"
    | "aion.job-posting.markdown-description"
    | "aion.job-posting.text-description";
  readonly parserVersion: "1";
}

export interface JobPostingContentDigestV1 {
  readonly algorithm: "sha-256";
  readonly digest: string;
}

export interface JobPostingSourceProvenanceV1 {
  readonly version: "1";
  readonly importOperationId: string;
  readonly sourceType: JobPostingSourceTypeV1;
  readonly originalFilename: string;
  readonly approvedRelativePath: string;
  readonly contentDigest: JobPostingContentDigestV1;
  readonly parser: JobPostingParserDescriptorV1;
  readonly importedAt: string;
  readonly ownerId: OwnerIdV1;
  readonly importingActorId: ActorIdV1;
}

export type ListingCurrentnessEvidenceV1 =
  | { readonly version: "1"; readonly state: "unknown" }
  | {
      readonly version: "1";
      readonly state: "owner-observed-current" | "owner-observed-not-current";
      readonly basis: "explicit-owner-observation";
      readonly observedAt: string;
      readonly ownerConfirmed: true;
    };

export interface JobPostingPayloadV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly contractVersion: typeof JOB_POSTING_PAYLOAD_VERSION_V1;
  readonly sourceProvenance: JobPostingSourceProvenanceV1 & CanonicalValueV1;
  readonly fields: JobPostingFieldsV1 & CanonicalValueV1;
  readonly listingCurrentness: ListingCurrentnessEvidenceV1 & CanonicalValueV1;
}

export type JobPostingImportTargetV1 =
  | { readonly mode: "create" }
  | { readonly mode: "revision"; readonly jobPostingObjectId: ObjectIdV1; readonly expectedRevision: number };

export interface JobPostingImportRequestV1 {
  readonly version: "1";
  readonly importOperationId: string;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly approvedInputRoot: ApprovedRootV1;
  readonly sourcePath: ExplicitInputPathV1;
  readonly sourceType: JobPostingSourceTypeV1;
  readonly target: JobPostingImportTargetV1;
  readonly listingCurrentness: ListingCurrentnessEvidenceV1;
}

export type JobPostingErrorCodeV1 =
  | "request-invalid"
  | "preflight-rejected"
  | "unsupported-source"
  | "source-read-failed"
  | "source-changed"
  | "contract-invalid"
  | "currentness-invalid"
  | "object-invalid"
  | "not-found"
  | "owner-mismatch"
  | "revision-conflict"
  | "persistence-failed";

export interface JobPostingErrorV1 {
  readonly version: "1";
  readonly code: JobPostingErrorCodeV1;
  readonly stage: "request" | "preflight" | "source" | "contract" | "currentness" | "persistence";
  readonly message: string;
}

export class JobPostingOperationErrorV1 extends Error {
  constructor(
    readonly code: JobPostingErrorCodeV1,
    readonly stage: JobPostingErrorV1["stage"],
    message: string,
  ) {
    super(message.slice(0, 512));
    this.name = "JobPostingOperationErrorV1";
  }

  toResult(): JobPostingErrorV1 {
    return { version: "1", code: this.code, stage: this.stage, message: this.message };
  }
}

export interface PrivateJobPostingReferenceV1 {
  readonly version: "1";
  readonly fingerprint: string;
}

export interface JobPostingDryRunResultV1 {
  readonly version: "1";
  readonly accepted: boolean;
  readonly proposedOperation: "create" | "revision" | null;
  readonly proposedObjectReference: PrivateJobPostingReferenceV1 | null;
  readonly sourceType: JobPostingSourceTypeV1 | null;
  readonly contentDigest: JobPostingContentDigestV1 | null;
  readonly unknownFields: readonly string[];
  readonly notSuppliedFields: readonly string[];
  readonly currentnessState: ListingCurrentnessEvidenceV1["state"] | null;
  readonly warningCodes: readonly string[];
  readonly error: JobPostingErrorV1 | null;
  readonly summary: {
    readonly contentReturned: false;
    readonly completePathReturned: false;
    readonly objectWrites: 0;
    readonly relationshipWrites: 0;
    readonly identityWrites: 0;
    readonly sourceCopies: 0;
    readonly networkActions: 0;
  };
}

export interface JobPostingImportResultV1 {
  readonly version: "1";
  readonly outcome: "success" | "already-completed" | "rejected";
  readonly objectReference: PrivateJobPostingReferenceV1 | null;
  readonly revision: number | null;
  readonly createdObjectCount: 0 | 1;
  readonly relationshipWrites: 0;
  readonly identityWrites: 0;
  readonly sourceCopies: 0;
  readonly networkActions: 0;
  readonly error: JobPostingErrorV1 | null;
}

const DIGEST = /^[0-9a-f]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const WORK = new Set(["remote", "hybrid", "on-site"]);
const EMPLOYMENT = new Set(["full-time", "part-time", "contract", "temporary", "internship", "other"]);
const FIELD_KEYS = [
  "applicationDeadline", "certificationRequirements", "company", "compensation", "description",
  "educationRequirements", "employmentType", "location", "preferredSkills", "requiredExperience",
  "requiredSkills", "schedule", "sourceReference", "title", "travel", "workArrangement",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function fail(message = "Job Posting contract validation failed."): never {
  throw new JobPostingOperationErrorV1("contract-invalid", "contract", message);
}

function identifier(value: unknown): value is string {
  try { validateCanonicalIdentifierV1(value, "$.identifier"); return true; } catch { return false; }
}

function canonical(value: unknown): void {
  try { validateCanonicalValueV1(value); } catch { fail(); }
}

function relativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\\")
    || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function textValue(value: unknown, allowNotSupplied = true): asserts value is JobPostingTextValueV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  const noValueStates = allowNotSupplied
    ? ["not-supplied", "unknown", "explicit-empty"]
    : ["unknown", "explicit-empty"];
  if (noValueStates.includes(value.state)) {
    if (!exactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !exactKeys(value, ["state", "value"])
    || typeof value.value !== "string" || value.value.length === 0) fail();
}

function enumValue(value: unknown, allowed: ReadonlySet<string>): void {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (value.state === "not-supplied" || value.state === "unknown") {
    if (!exactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !exactKeys(value, ["state", "value"])
    || typeof value.value !== "string" || !allowed.has(value.value)) fail();
}

function listValue(value: unknown): asserts value is JobPostingListValueV1 {
  if (!isRecord(value) || typeof value.state !== "string" || !Array.isArray(value.values)
    || !exactKeys(value, ["state", "values"])) fail();
  if (["not-supplied", "unknown", "no-preference"].includes(value.state)) {
    if (value.values.length !== 0) fail();
    return;
  }
  if (value.state !== "specified" || value.values.length === 0) fail();
  const seen = new Set<string>();
  for (const item of value.values) {
    if (typeof item !== "string" || item.length === 0 || item.trim() !== item
      || seen.has(item)) fail();
    seen.add(item);
  }
}

function compensation(value: unknown): asserts value is JobPostingCompensationPayloadV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (value.state === "not-supplied" || value.state === "unknown") {
    if (!exactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !exactKeys(value, ["currency", "maximumMinorUnits", "minimumMinorUnits", "state"])
    || typeof value.currency !== "string" || !CURRENCY.test(value.currency)) fail();
  const minimum = value.minimumMinorUnits;
  const maximum = value.maximumMinorUnits;
  const valid = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if ((minimum !== null && !valid(minimum)) || (maximum !== null && !valid(maximum))
    || (minimum === null && maximum === null)
    || (minimum !== null && maximum !== null && maximum < minimum)) fail();
}

function dateValue(value: unknown): asserts value is JobPostingDateValueV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (["not-supplied", "unknown", "not-applicable"].includes(value.state)) {
    if (!exactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !exactKeys(value, ["state", "value"])
    || typeof value.value !== "string" || !DATE.test(value.value)
    || Number.isNaN(Date.parse(`${value.value}T00:00:00.000Z`))) fail();
}

export function validateListingCurrentnessEvidenceV1(value: unknown): ListingCurrentnessEvidenceV1 {
  if (!isRecord(value) || value.version !== "1" || typeof value.state !== "string") fail();
  if (value.state === "unknown") {
    if (!exactKeys(value, ["state", "version"])) fail();
    return value as unknown as ListingCurrentnessEvidenceV1;
  }
  if (!["owner-observed-current", "owner-observed-not-current"].includes(value.state)
    || !exactKeys(value, ["basis", "observedAt", "ownerConfirmed", "state", "version"])
    || value.basis !== "explicit-owner-observation" || value.ownerConfirmed !== true
    || !isCanonicalObjectTimestampV1(value.observedAt)) fail();
  return value as unknown as ListingCurrentnessEvidenceV1;
}

export function validateJobPostingFieldsV1(value: unknown): JobPostingFieldsV1 {
  if (!isRecord(value) || !exactKeys(value, FIELD_KEYS)) fail();
  for (const key of ["title", "company", "location", "description", "requiredExperience", "travel", "schedule", "sourceReference"] as const) {
    textValue(value[key]);
  }
  enumValue(value.workArrangement, WORK);
  enumValue(value.employmentType, EMPLOYMENT);
  compensation(value.compensation);
  for (const key of ["requiredSkills", "preferredSkills", "educationRequirements", "certificationRequirements"] as const) {
    listValue(value[key]);
  }
  dateValue(value.applicationDeadline);
  return value as unknown as JobPostingFieldsV1;
}

export function validateJobPostingPayloadV1(value: unknown): JobPostingPayloadV1 {
  canonical(value);
  if (!isRecord(value) || !exactKeys(value, ["contractVersion", "fields", "listingCurrentness", "sourceProvenance"])
    || value.contractVersion !== JOB_POSTING_PAYLOAD_VERSION_V1) fail();
  const fields = validateJobPostingFieldsV1(value.fields);
  const currentness = validateListingCurrentnessEvidenceV1(value.listingCurrentness);
  const source = value.sourceProvenance;
  if (!isRecord(source) || !exactKeys(source, [
    "approvedRelativePath", "contentDigest", "importedAt", "importingActorId", "importOperationId",
    "originalFilename", "ownerId", "parser", "sourceType", "version",
  ]) || source.version !== "1" || !identifier(source.importOperationId)
    || !["structured-json", "markdown", "text"].includes(source.sourceType as string)
    || !relativePath(source.approvedRelativePath) || typeof source.originalFilename !== "string"
    || source.originalFilename !== source.approvedRelativePath.split("/").at(-1)
    || !isCanonicalObjectTimestampV1(source.importedAt)) fail();
  try { asOwnerIdV1(source.ownerId); asActorIdV1(source.importingActorId); } catch { fail(); }
  if (!isRecord(source.contentDigest) || !exactKeys(source.contentDigest, ["algorithm", "digest"])
    || source.contentDigest.algorithm !== "sha-256" || typeof source.contentDigest.digest !== "string"
    || !DIGEST.test(source.contentDigest.digest)) fail();
  if (!isRecord(source.parser) || !exactKeys(source.parser, ["parserName", "parserVersion", "version"])
    || source.parser.version !== "1" || source.parser.parserVersion !== "1") fail();
  const expectedParser = source.sourceType === "structured-json" ? "aion.job-posting.structured-json"
    : source.sourceType === "markdown" ? "aion.job-posting.markdown-description"
      : "aion.job-posting.text-description";
  if (source.parser.parserName !== expectedParser) fail();
  const extension = source.originalFilename.toLocaleLowerCase("en-US");
  if ((source.sourceType === "structured-json" && !extension.endsWith(".json"))
    || (source.sourceType === "markdown" && !extension.endsWith(".md"))
    || (source.sourceType === "text" && !extension.endsWith(".txt"))) fail();
  if (currentness.state !== "unknown" && currentness.observedAt > source.importedAt) {
    throw new JobPostingOperationErrorV1("currentness-invalid", "currentness", "Owner observation time cannot be later than the import time.");
  }
  if (source.sourceType !== "structured-json") {
    for (const [key, field] of Object.entries(fields)) {
      if (key === "description") {
        if (!["explicit-empty", "supplied"].includes(field.state)) fail();
      } else if (field.state !== "not-supplied") fail();
    }
  }
  return value as unknown as JobPostingPayloadV1;
}

export function validateJobPostingImportRequestV1(value: unknown): JobPostingImportRequestV1 {
  if (!isRecord(value) || !exactKeys(value, [
    "actorId", "approvedInputRoot", "importOperationId", "listingCurrentness", "ownerId",
    "sourcePath", "sourceType", "target", "version",
  ]) || value.version !== "1" || !identifier(value.importOperationId)
    || !["structured-json", "markdown", "text"].includes(value.sourceType as string)) {
    throw new JobPostingOperationErrorV1("request-invalid", "request", "A closed version-1 Job Posting import request is required.");
  }
  try { asOwnerIdV1(value.ownerId); asActorIdV1(value.actorId); } catch {
    throw new JobPostingOperationErrorV1("request-invalid", "request", "Typed Owner and Actor references are required.");
  }
  if (!isRecord(value.approvedInputRoot) || !exactKeys(value.approvedInputRoot, ["absolutePath", "reference", "version"])
    || value.approvedInputRoot.version !== "1" || typeof value.approvedInputRoot.absolutePath !== "string"
    || typeof value.approvedInputRoot.reference !== "string" || !isRecord(value.sourcePath)
    || !exactKeys(value.sourcePath, ["absolutePath", "version"]) || value.sourcePath.version !== "1"
    || typeof value.sourcePath.absolutePath !== "string" || !isRecord(value.target)) {
    throw new JobPostingOperationErrorV1("request-invalid", "request", "Explicit approved-root, source-path, and target values are required.");
  }
  if (value.target.mode === "create") {
    if (!exactKeys(value.target, ["mode"])) throw new JobPostingOperationErrorV1("request-invalid", "request", "Create target is invalid.");
  } else if (value.target.mode === "revision") {
    if (!exactKeys(value.target, ["expectedRevision", "jobPostingObjectId", "mode"])
      || !Number.isSafeInteger(value.target.expectedRevision) || (value.target.expectedRevision as number) < 1) {
      throw new JobPostingOperationErrorV1("request-invalid", "request", "Revision target is invalid.");
    }
    try { asObjectIdV1(value.target.jobPostingObjectId); } catch {
      throw new JobPostingOperationErrorV1("request-invalid", "request", "Revision target Object identifier is invalid.");
    }
  } else {
    throw new JobPostingOperationErrorV1("request-invalid", "request", "Import target mode is unsupported.");
  }
  try { validateListingCurrentnessEvidenceV1(value.listingCurrentness); } catch {
    throw new JobPostingOperationErrorV1("request-invalid", "request", "Listing currentness evidence is invalid.");
  }
  return value as unknown as JobPostingImportRequestV1;
}

export function fieldsFromStructuredInputV1(input: JobPostingInputV1): JobPostingFieldsV1 {
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    title: copy(input.title),
    company: copy(input.company),
    location: copy(input.location),
    workArrangement: copy(input.workArrangement),
    employmentType: copy(input.employmentType),
    compensation: copy(input.compensation as JobPostingCompensationV1),
    description: copy(input.description),
    requiredSkills: copy(input.requiredSkills),
    preferredSkills: copy(input.preferredSkills),
    requiredExperience: copy(input.requiredExperience),
    educationRequirements: copy(input.educationRequirements),
    certificationRequirements: copy(input.certificationRequirements),
    travel: copy(input.travel),
    schedule: copy(input.schedule),
    applicationDeadline: copy(input.applicationDeadline),
    sourceReference: copy(input.sourceReference),
  } as JobPostingFieldsV1;
}

export function descriptionOnlyFieldsV1(text: string): JobPostingFieldsV1 {
  const absent = { state: "not-supplied" } as const;
  const listAbsent = { state: "not-supplied", values: [] } as const;
  return {
    title: absent,
    company: absent,
    location: absent,
    workArrangement: absent,
    employmentType: absent,
    compensation: absent,
    description: text.length === 0 ? { state: "explicit-empty" } : { state: "supplied", value: text },
    requiredSkills: listAbsent,
    preferredSkills: listAbsent,
    requiredExperience: absent,
    educationRequirements: listAbsent,
    certificationRequirements: listAbsent,
    travel: absent,
    schedule: absent,
    applicationDeadline: absent,
    sourceReference: absent,
  };
}
