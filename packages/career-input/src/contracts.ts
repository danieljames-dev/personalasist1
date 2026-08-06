import {
  MAX_SAFE_CANONICAL_INTEGER,
  ObjectErrorV1,
  validateCanonicalIdentifierV1,
  validateCanonicalValueV1,
} from "@aion/object";

export const CAREER_FACTS_INPUT_VERSION_V1 = "aion.career-facts-input.v1" as const;
export const CAREER_PREFERENCES_INPUT_VERSION_V1 = "aion.career-preferences-input.v1" as const;
export const JOB_POSTING_INPUT_VERSION_V1 = "aion.job-posting-input.v1" as const;

export type CareerInputFileKindV1 =
  | "career-facts"
  | "career-preferences"
  | "job-posting"
  | "resume-evidence"
  | "work-history-evidence"
  | "evidence-text";

export type CareerInputValidationErrorCodeV1 =
  | "request-invalid"
  | "path-rejected"
  | "input-not-file"
  | "unsupported-extension"
  | "input-too-large"
  | "invalid-utf8"
  | "bom-rejected"
  | "unsupported-encoding"
  | "nul-byte-rejected"
  | "malformed-json"
  | "unsupported-contract"
  | "contract-invalid"
  | "kind-mismatch"
  | "io-failed";

export type CareerInputValidationStageV1 = "request" | "path" | "bytes" | "encoding" | "contract";

export interface CareerInputValidationErrorV1 {
  readonly version: "1";
  readonly code: CareerInputValidationErrorCodeV1;
  readonly stage: CareerInputValidationStageV1;
  readonly message: string;
}

export class CareerInputErrorV1 extends Error {
  constructor(
    readonly code: CareerInputValidationErrorCodeV1,
    readonly stage: CareerInputValidationStageV1,
    message: string,
  ) {
    super(message.slice(0, 512));
    this.name = "CareerInputErrorV1";
  }

  toValidationError(): CareerInputValidationErrorV1 {
    return { version: "1", code: this.code, stage: this.stage, message: this.message };
  }
}

export type ExplicitTextValueV1 =
  | { readonly state: "unknown" }
  | { readonly state: "explicit-empty" }
  | { readonly state: "supplied"; readonly value: string };

export type ExplicitDateValueV1 =
  | { readonly state: "unknown" }
  | { readonly state: "not-applicable" }
  | { readonly state: "supplied"; readonly value: string };

export type EvidenceDocumentKindV1 = "resume" | "work-history" | "certificate" | "education" | "project" | "other";

export interface EvidenceDocumentDescriptorV1 {
  readonly version: "1";
  readonly documentKind: EvidenceDocumentKindV1;
  readonly reference: string;
  readonly locator: ExplicitTextValueV1;
}

export type CareerFactKindV1 =
  | "role-title"
  | "employer"
  | "responsibility"
  | "accomplishment"
  | "skill"
  | "tool-or-technology"
  | "certification"
  | "education"
  | "license"
  | "industry"
  | "project";

export interface CareerFactInputEntryV1 {
  readonly version: "1";
  readonly factId: string;
  readonly factKind: CareerFactKindV1;
  readonly value: ExplicitTextValueV1;
  readonly startDate: ExplicitDateValueV1;
  readonly endDate: ExplicitDateValueV1;
  readonly responsibilities: readonly string[];
  readonly accomplishments: readonly string[];
  readonly skills: readonly string[];
  readonly toolsAndTechnologies: readonly string[];
  readonly evidenceReferences: readonly EvidenceDocumentDescriptorV1[];
  readonly ownerConfirmed: boolean;
}

export interface CareerFactsInputV1 {
  readonly contractVersion: typeof CAREER_FACTS_INPUT_VERSION_V1;
  readonly entries: readonly CareerFactInputEntryV1[];
}

export type PreferenceStateV1 = "unknown" | "no-preference" | "specified";

export interface PreferenceListV1 {
  readonly state: PreferenceStateV1;
  readonly values: readonly string[];
}

export type WorkArrangementV1 = "remote" | "hybrid" | "on-site";
export type EmploymentTypeV1 = "full-time" | "part-time" | "contract" | "temporary" | "internship" | "other";

export interface WorkArrangementPreferenceV1 {
  readonly state: PreferenceStateV1;
  readonly values: readonly WorkArrangementV1[];
}

export interface EmploymentTypePreferenceV1 {
  readonly state: PreferenceStateV1;
  readonly values: readonly EmploymentTypeV1[];
}

export type MinimumCompensationPreferenceV1 =
  | { readonly state: "unknown" | "no-preference" }
  | { readonly state: "specified"; readonly currency: string; readonly minimumMinorUnits: number };

export interface CareerPreferencesInputV1 {
  readonly contractVersion: typeof CAREER_PREFERENCES_INPUT_VERSION_V1;
  readonly desiredRoles: PreferenceListV1;
  readonly excludedRoles: PreferenceListV1;
  readonly locations: PreferenceListV1;
  readonly workArrangements: WorkArrangementPreferenceV1;
  readonly employmentTypes: EmploymentTypePreferenceV1;
  readonly minimumCompensation: MinimumCompensationPreferenceV1;
  readonly scheduleConstraints: PreferenceListV1;
  readonly travelPreference: PreferenceListV1;
  readonly industriesOfInterest: PreferenceListV1;
  readonly industriesToAvoid: PreferenceListV1;
  readonly physicalOrOtherWorkConstraints?: PreferenceListV1;
}

export type PostingEnumValueV1<T extends string> =
  | { readonly state: "unknown" }
  | { readonly state: "supplied"; readonly value: T };

export type JobPostingCompensationV1 =
  | { readonly state: "unknown" }
  | {
      readonly state: "supplied";
      readonly currency: string;
      readonly minimumMinorUnits: number | null;
      readonly maximumMinorUnits: number | null;
    };

export interface JobPostingInputV1 {
  readonly contractVersion: typeof JOB_POSTING_INPUT_VERSION_V1;
  readonly title: ExplicitTextValueV1;
  readonly company: ExplicitTextValueV1;
  readonly location: ExplicitTextValueV1;
  readonly workArrangement: PostingEnumValueV1<WorkArrangementV1>;
  readonly employmentType: PostingEnumValueV1<EmploymentTypeV1>;
  readonly compensation: JobPostingCompensationV1;
  readonly description: ExplicitTextValueV1;
  readonly requiredSkills: PreferenceListV1;
  readonly preferredSkills: PreferenceListV1;
  readonly requiredExperience: ExplicitTextValueV1;
  readonly educationRequirements: PreferenceListV1;
  readonly certificationRequirements: PreferenceListV1;
  readonly travel: ExplicitTextValueV1;
  readonly schedule: ExplicitTextValueV1;
  readonly applicationDeadline: ExplicitDateValueV1;
  readonly sourceReference: ExplicitTextValueV1;
}

function fail(message = "Career input contract validation failed."): never {
  throw new CareerInputErrorV1("contract-invalid", "contract", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key))
    && keys.length >= required.length;
}

function canonicalGuard(value: unknown): void {
  try {
    validateCanonicalValueV1(value);
  } catch (error) {
    if (error instanceof ObjectErrorV1) fail();
    fail();
  }
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !value.includes("\0");
}

function validateTextValue(value: unknown): asserts value is ExplicitTextValueV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (value.state === "unknown" || value.state === "explicit-empty") {
    if (!hasExactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !hasExactKeys(value, ["state", "value"]) || !validText(value.value)) fail();
}

const DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

function dateOrder(value: string, endBound: boolean): number | null {
  const match = DATE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const dayText = match[3];
  const day = dayText === undefined ? (endBound ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 1) : Number(dayText);
  const instant = Date.UTC(year, month - 1, day);
  const parsed = new Date(instant);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return instant;
}

function validateDateValue(value: unknown): asserts value is ExplicitDateValueV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (value.state === "unknown" || value.state === "not-applicable") {
    if (!hasExactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !hasExactKeys(value, ["state", "value"])
    || typeof value.value !== "string" || dateOrder(value.value, false) === null) fail();
}

function validateStringArray(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value)) fail();
  for (const item of value) if (!validText(item)) fail();
}

export function validateEvidenceDocumentDescriptorV1(value: unknown): EvidenceDocumentDescriptorV1 {
  canonicalGuard(value);
  if (!isRecord(value) || !hasExactKeys(value, ["documentKind", "locator", "reference", "version"])) fail();
  if (value.version !== "1" || !["resume", "work-history", "certificate", "education", "project", "other"].includes(value.documentKind as string)) fail();
  if (!validText(value.reference)) fail();
  validateTextValue(value.locator);
  return value as unknown as EvidenceDocumentDescriptorV1;
}

export function validateCareerFactsInputV1(value: unknown): CareerFactsInputV1 {
  canonicalGuard(value);
  if (!isRecord(value) || !hasExactKeys(value, ["contractVersion", "entries"])) fail();
  if (value.contractVersion !== CAREER_FACTS_INPUT_VERSION_V1 || !Array.isArray(value.entries)) fail();
  const factIds = new Set<string>();
  const kinds: readonly CareerFactKindV1[] = [
    "role-title", "employer", "responsibility", "accomplishment", "skill", "tool-or-technology",
    "certification", "education", "license", "industry", "project",
  ];
  for (const entry of value.entries) {
    if (!isRecord(entry) || !hasExactKeys(entry, [
      "accomplishments", "endDate", "evidenceReferences", "factId", "factKind", "ownerConfirmed",
      "responsibilities", "skills", "startDate", "toolsAndTechnologies", "value", "version",
    ])) fail();
    if (entry.version !== "1" || !kinds.includes(entry.factKind as CareerFactKindV1) || typeof entry.ownerConfirmed !== "boolean") fail();
    try { validateCanonicalIdentifierV1(entry.factId, "$.entries.*.factId"); } catch { fail(); }
    if (factIds.has(entry.factId as string)) fail();
    factIds.add(entry.factId as string);
    validateTextValue(entry.value);
    validateDateValue(entry.startDate);
    validateDateValue(entry.endDate);
    if (entry.startDate.state === "supplied" && entry.endDate.state === "supplied") {
      const start = dateOrder(entry.startDate.value as string, false);
      const end = dateOrder(entry.endDate.value as string, true);
      if (start === null || end === null || end < start) fail();
    }
    validateStringArray(entry.responsibilities);
    validateStringArray(entry.accomplishments);
    validateStringArray(entry.skills);
    validateStringArray(entry.toolsAndTechnologies);
    if (!Array.isArray(entry.evidenceReferences)) fail();
    for (const descriptor of entry.evidenceReferences) validateEvidenceDocumentDescriptorV1(descriptor);
  }
  return value as unknown as CareerFactsInputV1;
}

function validatePreferenceList(value: unknown, allowed?: ReadonlySet<string>): asserts value is PreferenceListV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["state", "values"]) || !Array.isArray(value.values)
    || !["unknown", "no-preference", "specified"].includes(value.state as string)) fail();
  if (value.state !== "specified" && value.values.length !== 0) fail();
  if (value.state === "specified" && value.values.length === 0) fail();
  const seen = new Set<string>();
  for (const item of value.values) {
    if (!validText(item) || (allowed !== undefined && !allowed.has(item)) || seen.has(item)) fail();
    seen.add(item);
  }
}

const WORK_ARRANGEMENTS = new Set<string>(["remote", "hybrid", "on-site"]);
const EMPLOYMENT_TYPES = new Set<string>(["full-time", "part-time", "contract", "temporary", "internship", "other"]);
const CURRENCY = /^[A-Z]{3}$/;

function validMinorUnits(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAFE_CANONICAL_INTEGER;
}

function validateMinimumCompensation(value: unknown): asserts value is MinimumCompensationPreferenceV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (value.state === "unknown" || value.state === "no-preference") {
    if (!hasExactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "specified" || !hasExactKeys(value, ["currency", "minimumMinorUnits", "state"])
    || typeof value.currency !== "string" || !CURRENCY.test(value.currency) || !validMinorUnits(value.minimumMinorUnits)) fail();
}

export function validateCareerPreferencesInputV1(value: unknown): CareerPreferencesInputV1 {
  canonicalGuard(value);
  if (!isRecord(value) || !hasExactKeys(value, [
    "contractVersion", "desiredRoles", "employmentTypes", "excludedRoles", "industriesOfInterest",
    "industriesToAvoid", "locations", "minimumCompensation", "scheduleConstraints", "travelPreference",
    "workArrangements",
  ], ["physicalOrOtherWorkConstraints"])) fail();
  if (value.contractVersion !== CAREER_PREFERENCES_INPUT_VERSION_V1) fail();
  validatePreferenceList(value.desiredRoles);
  validatePreferenceList(value.excludedRoles);
  validatePreferenceList(value.locations);
  validatePreferenceList(value.workArrangements, WORK_ARRANGEMENTS);
  validatePreferenceList(value.employmentTypes, EMPLOYMENT_TYPES);
  validateMinimumCompensation(value.minimumCompensation);
  validatePreferenceList(value.scheduleConstraints);
  validatePreferenceList(value.travelPreference);
  validatePreferenceList(value.industriesOfInterest);
  validatePreferenceList(value.industriesToAvoid);
  if (value.physicalOrOtherWorkConstraints !== undefined) validatePreferenceList(value.physicalOrOtherWorkConstraints);
  return value as unknown as CareerPreferencesInputV1;
}

function validatePostingEnum(value: unknown, allowed: ReadonlySet<string>): void {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (value.state === "unknown") {
    if (!hasExactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !hasExactKeys(value, ["state", "value"])
    || typeof value.value !== "string" || !allowed.has(value.value)) fail();
}

function validatePostingCompensation(value: unknown): asserts value is JobPostingCompensationV1 {
  if (!isRecord(value) || typeof value.state !== "string") fail();
  if (value.state === "unknown") {
    if (!hasExactKeys(value, ["state"])) fail();
    return;
  }
  if (value.state !== "supplied" || !hasExactKeys(value, ["currency", "maximumMinorUnits", "minimumMinorUnits", "state"])
    || typeof value.currency !== "string" || !CURRENCY.test(value.currency)) fail();
  const minimum = value.minimumMinorUnits;
  const maximum = value.maximumMinorUnits;
  if ((minimum !== null && !validMinorUnits(minimum)) || (maximum !== null && !validMinorUnits(maximum))) fail();
  if (minimum === null && maximum === null) fail();
  if (minimum !== null && maximum !== null && maximum < minimum) fail();
}

export function validateJobPostingInputV1(value: unknown): JobPostingInputV1 {
  canonicalGuard(value);
  if (!isRecord(value) || !hasExactKeys(value, [
    "applicationDeadline", "certificationRequirements", "company", "compensation", "contractVersion",
    "description", "educationRequirements", "employmentType", "location", "preferredSkills",
    "requiredExperience", "requiredSkills", "schedule", "sourceReference", "title", "travel", "workArrangement",
  ])) fail();
  if (value.contractVersion !== JOB_POSTING_INPUT_VERSION_V1) fail();
  for (const key of ["title", "company", "location", "description", "requiredExperience", "travel", "schedule", "sourceReference"] as const) {
    validateTextValue(value[key]);
  }
  validatePostingEnum(value.workArrangement, WORK_ARRANGEMENTS);
  validatePostingEnum(value.employmentType, EMPLOYMENT_TYPES);
  validatePostingCompensation(value.compensation);
  validatePreferenceList(value.requiredSkills);
  validatePreferenceList(value.preferredSkills);
  validatePreferenceList(value.educationRequirements);
  validatePreferenceList(value.certificationRequirements);
  validateDateValue(value.applicationDeadline);
  return value as unknown as JobPostingInputV1;
}

export function validateCareerInputContractV1(value: unknown): {
  readonly kind: Extract<CareerInputFileKindV1, "career-facts" | "career-preferences" | "job-posting">;
  readonly contractVersion: string;
} {
  if (!isRecord(value) || typeof value.contractVersion !== "string") {
    throw new CareerInputErrorV1("unsupported-contract", "contract", "A supported contract version is required.");
  }
  if (value.contractVersion === CAREER_FACTS_INPUT_VERSION_V1) {
    validateCareerFactsInputV1(value);
    return { kind: "career-facts", contractVersion: value.contractVersion };
  }
  if (value.contractVersion === CAREER_PREFERENCES_INPUT_VERSION_V1) {
    validateCareerPreferencesInputV1(value);
    return { kind: "career-preferences", contractVersion: value.contractVersion };
  }
  if (value.contractVersion === JOB_POSTING_INPUT_VERSION_V1) {
    validateJobPostingInputV1(value);
    return { kind: "job-posting", contractVersion: value.contractVersion };
  }
  throw new CareerInputErrorV1("unsupported-contract", "contract", "The contract version is unsupported.");
}
