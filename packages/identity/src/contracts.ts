declare const ownerIdBrand: unique symbol;
declare const principalIdBrand: unique symbol;
declare const actorIdBrand: unique symbol;
declare const systemInstanceIdBrand: unique symbol;

export type OwnerIdV1 = string & { readonly [ownerIdBrand]: "OwnerIdV1" };
export type PrincipalIdV1 = string & { readonly [principalIdBrand]: "PrincipalIdV1" };
export type ActorIdV1 = string & { readonly [actorIdBrand]: "ActorIdV1" };
export type SystemInstanceIdV1 = string & { readonly [systemInstanceIdBrand]: "SystemInstanceIdV1" };

export type IdentityKindV1 = "owner" | "principal" | "actor" | "system-instance";
export type IdentityLifecycleStatusV1 = "active" | "disabled";

export interface IdentityProvenanceV1 {
  readonly version: "1";
  readonly source: "explicit-local-bootstrap";
  readonly recordedAt: string;
  readonly generatorProfileVersion: "uuid-v4-rfc9562";
}

export interface IdentityRecordV1 {
  readonly version: "1";
  readonly kind: IdentityKindV1;
  readonly id: OwnerIdV1 | PrincipalIdV1 | ActorIdV1 | SystemInstanceIdV1;
  readonly lifecycleStatus: IdentityLifecycleStatusV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: 1;
}

export type IdentityRelationshipV1 =
  | {
      readonly version: "1";
      readonly kind: "actor-to-principal";
      readonly actorId: ActorIdV1;
      readonly principalId: PrincipalIdV1;
    }
  | {
      readonly version: "1";
      readonly kind: "principal-to-owner";
      readonly principalId: PrincipalIdV1;
      readonly ownerId: OwnerIdV1;
    }
  | {
      readonly version: "1";
      readonly kind: "system-instance-to-owner";
      readonly systemInstanceId: SystemInstanceIdV1;
      readonly ownerId: OwnerIdV1;
    };

export interface LocalIdentityStateV1 {
  readonly schemaVersion: "aion.local-identity-state.v1";
  readonly contractVersion: "identity-contract-v1";
  readonly lifecycleStatus: IdentityLifecycleStatusV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: IdentityProvenanceV1;
  readonly records: readonly IdentityRecordV1[];
  readonly relationships: readonly IdentityRelationshipV1[];
}

export interface IdentityClock {
  now(): string;
}

export interface IdentityIdGenerator {
  generate(kind: IdentityKindV1): string;
}

export interface IdentityStateRepository {
  withExclusiveInitialization<T>(operation: () => Promise<T>): Promise<T>;
  load(): Promise<unknown | null>;
  installNew(state: LocalIdentityStateV1): Promise<void>;
}

export type IdentityErrorCodeV1 =
  | "identity-state-invalid"
  | "identity-state-conflict"
  | "identity-lock-conflict"
  | "identity-persistence-failed"
  | "identity-path-rejected"
  | "identity-export-conflict"
  | "identity-argument-invalid";

export class IdentityErrorV1 extends Error {
  constructor(readonly code: IdentityErrorCodeV1, message: string) {
    super(message);
    this.name = "IdentityErrorV1";
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXACT_STATE_KEYS = [
  "contractVersion", "createdAt", "lifecycleStatus", "provenance", "records", "relationships",
  "schemaVersion", "updatedAt",
] as const;
const EXACT_RECORD_KEYS = ["createdAt", "id", "kind", "lifecycleStatus", "revision", "updatedAt", "version"] as const;
const EXACT_PROVENANCE_KEYS = ["generatorProfileVersion", "recordedAt", "source", "version"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

export function isIdentityIdV1(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

export function asOwnerIdV1(value: unknown): OwnerIdV1 {
  if (!isIdentityIdV1(value)) throw new IdentityErrorV1("identity-state-invalid", "Invalid OwnerIdV1.");
  return value as OwnerIdV1;
}

export function asPrincipalIdV1(value: unknown): PrincipalIdV1 {
  if (!isIdentityIdV1(value)) throw new IdentityErrorV1("identity-state-invalid", "Invalid PrincipalIdV1.");
  return value as PrincipalIdV1;
}

export function asActorIdV1(value: unknown): ActorIdV1 {
  if (!isIdentityIdV1(value)) throw new IdentityErrorV1("identity-state-invalid", "Invalid ActorIdV1.");
  return value as ActorIdV1;
}

export function asSystemInstanceIdV1(value: unknown): SystemInstanceIdV1 {
  if (!isIdentityIdV1(value)) throw new IdentityErrorV1("identity-state-invalid", "Invalid SystemInstanceIdV1.");
  return value as SystemInstanceIdV1;
}

function failInvalid(): never {
  throw new IdentityErrorV1("identity-state-invalid", "Identity state failed closed validation.");
}

export function validateLocalIdentityStateV1(value: unknown): LocalIdentityStateV1 {
  if (!isObject(value) || !hasExactKeys(value, EXACT_STATE_KEYS)) failInvalid();
  if (value.schemaVersion !== "aion.local-identity-state.v1" || value.contractVersion !== "identity-contract-v1") failInvalid();
  if (value.lifecycleStatus !== "active" && value.lifecycleStatus !== "disabled") failInvalid();
  if (!isCanonicalTimestamp(value.createdAt) || !isCanonicalTimestamp(value.updatedAt)) failInvalid();
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) failInvalid();

  if (!isObject(value.provenance) || !hasExactKeys(value.provenance, EXACT_PROVENANCE_KEYS)) failInvalid();
  if (value.provenance.version !== "1" || value.provenance.source !== "explicit-local-bootstrap") failInvalid();
  if (value.provenance.generatorProfileVersion !== "uuid-v4-rfc9562") failInvalid();
  if (!isCanonicalTimestamp(value.provenance.recordedAt) || value.provenance.recordedAt !== value.createdAt) failInvalid();

  if (!Array.isArray(value.records) || value.records.length !== 4) failInvalid();
  const records = new Map<IdentityKindV1, Record<string, unknown>>();
  const ids = new Set<string>();
  for (const record of value.records) {
    if (!isObject(record) || !hasExactKeys(record, EXACT_RECORD_KEYS)) failInvalid();
    if (record.version !== "1" || record.revision !== 1) failInvalid();
    if (!["owner", "principal", "actor", "system-instance"].includes(record.kind as string)) failInvalid();
    if (record.lifecycleStatus !== "active" && record.lifecycleStatus !== "disabled") failInvalid();
    if (!isCanonicalTimestamp(record.createdAt) || !isCanonicalTimestamp(record.updatedAt)) failInvalid();
    if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) failInvalid();
    if (record.createdAt !== value.createdAt || !isIdentityIdV1(record.id)) failInvalid();
    const kind = record.kind as IdentityKindV1;
    if (records.has(kind) || ids.has(record.id)) failInvalid();
    records.set(kind, record);
    ids.add(record.id);
  }
  if (records.size !== 4) failInvalid();

  if (!Array.isArray(value.relationships) || value.relationships.length !== 3) failInvalid();
  const relationshipKinds = new Set<string>();
  for (const relationship of value.relationships) {
    if (!isObject(relationship) || relationship.version !== "1" || typeof relationship.kind !== "string") failInvalid();
    if (relationshipKinds.has(relationship.kind)) failInvalid();
    relationshipKinds.add(relationship.kind);
    if (relationship.kind === "actor-to-principal") {
      if (!hasExactKeys(relationship, ["actorId", "kind", "principalId", "version"])) failInvalid();
      if (relationship.actorId !== records.get("actor")?.id || relationship.principalId !== records.get("principal")?.id) failInvalid();
    } else if (relationship.kind === "principal-to-owner") {
      if (!hasExactKeys(relationship, ["kind", "ownerId", "principalId", "version"])) failInvalid();
      if (relationship.principalId !== records.get("principal")?.id || relationship.ownerId !== records.get("owner")?.id) failInvalid();
    } else if (relationship.kind === "system-instance-to-owner") {
      if (!hasExactKeys(relationship, ["kind", "ownerId", "systemInstanceId", "version"])) failInvalid();
      if (relationship.systemInstanceId !== records.get("system-instance")?.id || relationship.ownerId !== records.get("owner")?.id) failInvalid();
    } else failInvalid();
  }
  if (relationshipKinds.size !== 3) failInvalid();
  return value as unknown as LocalIdentityStateV1;
}
