import {
  asObjectIdV1,
  asObjectSchemaIdV1,
  asObjectTypeV1,
  isCanonicalObjectTimestampV1,
} from "./object.js";
import {
  ObjectErrorV1,
  type CanonicalValueV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type ObjectSchemaRegistryV1,
  type ObjectTypeRegistrationV1,
} from "./contracts.js";

export const CAREER_SOURCE_OBJECT_V1 = Object.freeze({
  objectType: asObjectTypeV1("aion.career.source"),
  objectProfile: "entity",
  schemaId: asObjectSchemaIdV1("aion.schema.career-source"),
  schemaVersion: 1,
} as const satisfies ObjectTypeRegistrationV1);

export const CAREER_FACT_OBJECT_V1 = Object.freeze({
  objectType: asObjectTypeV1("aion.career.fact"),
  objectProfile: "entity",
  schemaId: asObjectSchemaIdV1("aion.schema.career-fact"),
  schemaVersion: 1,
} as const satisfies ObjectTypeRegistrationV1);

export const CAREER_PROFILE_OBJECT_V1 = Object.freeze({
  objectType: asObjectTypeV1("aion.career.profile"),
  objectProfile: "entity",
  schemaId: asObjectSchemaIdV1("aion.schema.career-profile"),
  schemaVersion: 1,
} as const satisfies ObjectTypeRegistrationV1);

export const JOB_POSTING_OBJECT_V1 = Object.freeze({
  objectType: asObjectTypeV1("aion.career.job-posting"),
  objectProfile: "entity",
  schemaId: asObjectSchemaIdV1("aion.schema.job-posting"),
  schemaVersion: 1,
} as const satisfies ObjectTypeRegistrationV1);

export const JOB_MATCH_REPORT_OBJECT_V1 = Object.freeze({
  objectType: asObjectTypeV1("aion.career.job-match-report"),
  objectProfile: "entity",
  schemaId: asObjectSchemaIdV1("aion.schema.job-match-report"),
  schemaVersion: 1,
} as const satisfies ObjectTypeRegistrationV1);

export const APPLICATION_DRAFT_OBJECT_V1 = Object.freeze({
  objectType: asObjectTypeV1("aion.career.application-draft"),
  objectProfile: "entity",
  schemaId: asObjectSchemaIdV1("aion.schema.application-draft"),
  schemaVersion: 1,
} as const satisfies ObjectTypeRegistrationV1);

export const RELATIONSHIP_OBJECT_V1 = Object.freeze({
  objectType: asObjectTypeV1("aion.object.relationship"),
  objectProfile: "relationship",
  schemaId: asObjectSchemaIdV1("aion.schema.relationship"),
  schemaVersion: 1,
} as const satisfies ObjectTypeRegistrationV1);

export const CAREER_ENTITY_FAMILY_REGISTRATIONS_V1 = Object.freeze([
  CAREER_SOURCE_OBJECT_V1,
  CAREER_FACT_OBJECT_V1,
  CAREER_PROFILE_OBJECT_V1,
  JOB_POSTING_OBJECT_V1,
  JOB_MATCH_REPORT_OBJECT_V1,
  APPLICATION_DRAFT_OBJECT_V1,
] as const);

export const OBJECT_FAMILY_REGISTRATIONS_V1 = Object.freeze([
  ...CAREER_ENTITY_FAMILY_REGISTRATIONS_V1,
  RELATIONSHIP_OBJECT_V1,
] as const);

export type CareerEntityRegistrationV1 = (typeof CAREER_ENTITY_FAMILY_REGISTRATIONS_V1)[number];
export type CareerFamilyDataV1 = Readonly<Record<string, never>>;
type RegisteredEnvelopeV1<
  TRegistration extends ObjectTypeRegistrationV1,
  TData extends CanonicalValueV1,
> = ObjectEnvelopeV1<TData> & {
  readonly objectType: TRegistration["objectType"];
  readonly objectProfile: TRegistration["objectProfile"];
  readonly schemaId: TRegistration["schemaId"];
  readonly schemaVersion: TRegistration["schemaVersion"];
};
export type CareerSourceObjectV1 = RegisteredEnvelopeV1<typeof CAREER_SOURCE_OBJECT_V1, CareerFamilyDataV1>;
export type CareerFactObjectV1 = RegisteredEnvelopeV1<typeof CAREER_FACT_OBJECT_V1, CareerFamilyDataV1>;
export type CareerProfileObjectV1 = RegisteredEnvelopeV1<typeof CAREER_PROFILE_OBJECT_V1, CareerFamilyDataV1>;
export type JobPostingObjectV1 = RegisteredEnvelopeV1<typeof JOB_POSTING_OBJECT_V1, CareerFamilyDataV1>;
export type JobMatchReportObjectV1 = RegisteredEnvelopeV1<typeof JOB_MATCH_REPORT_OBJECT_V1, CareerFamilyDataV1>;
export type ApplicationDraftObjectV1 = RegisteredEnvelopeV1<typeof APPLICATION_DRAFT_OBJECT_V1, CareerFamilyDataV1>;

export type RelationshipKindV1 =
  | "aion.relationship.career.fact-derived-from-source.v1"
  | "aion.relationship.career.profile-contains-fact.v1"
  | "aion.relationship.career.profile-references-fact.v1"
  | "aion.relationship.career.match-evaluates-posting.v1"
  | "aion.relationship.career.match-uses-profile.v1"
  | "aion.relationship.career.draft-derived-from-match.v1"
  | "aion.relationship.career.draft-supported-by-fact.v1";

export interface RelationshipEndpointV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly objectId: ObjectIdV1;
  readonly objectType: CareerEntityRegistrationV1["objectType"];
  readonly schemaId: CareerEntityRegistrationV1["schemaId"];
  readonly schemaVersion: 1;
}

export interface RelationshipObjectDataV1 {
  readonly [key: string]: CanonicalValueV1;
  readonly relationshipContractVersion: "1";
  readonly relationshipKind: RelationshipKindV1;
  readonly source: RelationshipEndpointV1;
  readonly target: RelationshipEndpointV1;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly attributes: Readonly<Record<string, never>>;
}

export type RelationshipObjectV1 = RegisteredEnvelopeV1<typeof RELATIONSHIP_OBJECT_V1, RelationshipObjectDataV1>;

export interface RelationshipDescriptorV1 {
  readonly relationshipKind: RelationshipKindV1;
  readonly source: CareerEntityRegistrationV1;
  readonly target: CareerEntityRegistrationV1;
}

function freezeDescriptor<T extends RelationshipDescriptorV1>(descriptor: T): T {
  return Object.freeze(descriptor);
}

export const RELATIONSHIP_DESCRIPTORS_V1: readonly RelationshipDescriptorV1[] = Object.freeze([
  freezeDescriptor({ relationshipKind: "aion.relationship.career.fact-derived-from-source.v1", source: CAREER_FACT_OBJECT_V1, target: CAREER_SOURCE_OBJECT_V1 }),
  freezeDescriptor({ relationshipKind: "aion.relationship.career.profile-contains-fact.v1", source: CAREER_PROFILE_OBJECT_V1, target: CAREER_FACT_OBJECT_V1 }),
  freezeDescriptor({ relationshipKind: "aion.relationship.career.profile-references-fact.v1", source: CAREER_PROFILE_OBJECT_V1, target: CAREER_FACT_OBJECT_V1 }),
  freezeDescriptor({ relationshipKind: "aion.relationship.career.match-evaluates-posting.v1", source: JOB_MATCH_REPORT_OBJECT_V1, target: JOB_POSTING_OBJECT_V1 }),
  freezeDescriptor({ relationshipKind: "aion.relationship.career.match-uses-profile.v1", source: JOB_MATCH_REPORT_OBJECT_V1, target: CAREER_PROFILE_OBJECT_V1 }),
  freezeDescriptor({ relationshipKind: "aion.relationship.career.draft-derived-from-match.v1", source: APPLICATION_DRAFT_OBJECT_V1, target: JOB_MATCH_REPORT_OBJECT_V1 }),
  freezeDescriptor({ relationshipKind: "aion.relationship.career.draft-supported-by-fact.v1", source: APPLICATION_DRAFT_OBJECT_V1, target: CAREER_FACT_OBJECT_V1 }),
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function registrationsEqual(left: ObjectTypeRegistrationV1, right: ObjectTypeRegistrationV1): boolean {
  return left.objectType === right.objectType
    && left.objectProfile === right.objectProfile
    && left.schemaId === right.schemaId
    && left.schemaVersion === right.schemaVersion;
}

export function isCareerEntityRegistrationV1(value: ObjectTypeRegistrationV1): value is CareerEntityRegistrationV1 {
  return CAREER_ENTITY_FAMILY_REGISTRATIONS_V1.some((registration) => registrationsEqual(registration, value));
}

export function relationshipDescriptorV1(kind: unknown): RelationshipDescriptorV1 {
  const descriptor = RELATIONSHIP_DESCRIPTORS_V1.find((candidate) => candidate.relationshipKind === kind);
  if (descriptor === undefined) {
    throw new ObjectErrorV1("invalid-domain-data", "$.data.relationshipKind", "Relationship kind is unsupported.");
  }
  return descriptor;
}

function validEndpoint(value: unknown, expected: CareerEntityRegistrationV1): value is RelationshipEndpointV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["objectId", "objectType", "schemaId", "schemaVersion"])) return false;
  try { asObjectIdV1(value.objectId); } catch { return false; }
  return value.objectType === expected.objectType
    && value.schemaId === expected.schemaId
    && value.schemaVersion === expected.schemaVersion;
}

export function validateRelationshipObjectDataV1(value: unknown): value is RelationshipObjectDataV1 {
  if (!isRecord(value) || !hasExactKeys(value, [
    "attributes", "effectiveFrom", "effectiveUntil", "relationshipContractVersion",
    "relationshipKind", "source", "target",
  ])) return false;
  if (value.relationshipContractVersion !== "1") return false;
  let descriptor: RelationshipDescriptorV1;
  try { descriptor = relationshipDescriptorV1(value.relationshipKind); } catch { return false; }
  if (!validEndpoint(value.source, descriptor.source) || !validEndpoint(value.target, descriptor.target)) return false;
  if (value.source.objectId === value.target.objectId) return false;
  if (!isCanonicalObjectTimestampV1(value.effectiveFrom)) return false;
  if (value.effectiveUntil !== null) {
    if (!isCanonicalObjectTimestampV1(value.effectiveUntil)) return false;
    if (Date.parse(value.effectiveUntil) < Date.parse(value.effectiveFrom)) return false;
  }
  return isRecord(value.attributes) && Object.keys(value.attributes).length === 0;
}

export function relationshipEndpointV1(object: ObjectEnvelopeV1): RelationshipEndpointV1 {
  const registration: ObjectTypeRegistrationV1 = {
    objectType: object.objectType,
    objectProfile: object.objectProfile,
    schemaId: object.schemaId,
    schemaVersion: object.schemaVersion,
  };
  if (!isCareerEntityRegistrationV1(registration)) {
    throw new ObjectErrorV1("invalid-reference", "$.data", "Relationship endpoint is not an approved career Object family.");
  }
  return Object.freeze({
    objectId: object.objectId,
    objectType: registration.objectType,
    schemaId: registration.schemaId,
    schemaVersion: 1,
  });
}

export class CareerObjectSchemaRegistryV1 implements ObjectSchemaRegistryV1 {
  isRegistered(registration: ObjectTypeRegistrationV1): boolean {
    return OBJECT_FAMILY_REGISTRATIONS_V1.some((candidate) => registrationsEqual(candidate, registration));
  }

  isExtensionNamespaceRegistered(_namespace: string): boolean {
    return false;
  }

  validateData(registration: ObjectTypeRegistrationV1, data: CanonicalValueV1): boolean {
    if (isCareerEntityRegistrationV1(registration)) {
      return isRecord(data) && Object.keys(data).length === 0;
    }
    return registrationsEqual(registration, RELATIONSHIP_OBJECT_V1)
      && validateRelationshipObjectDataV1(data);
  }
}
