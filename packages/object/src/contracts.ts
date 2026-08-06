import type { ActorIdV1, OwnerIdV1 } from "@aion/identity";

declare const objectIdBrand: unique symbol;
declare const objectTypeBrand: unique symbol;
declare const schemaIdBrand: unique symbol;
declare const validatedValueBrand: unique symbol;

export type ObjectIdV1 = string & { readonly [objectIdBrand]: "ObjectIdV1" };
export type ObjectTypeV1 = string & { readonly [objectTypeBrand]: "ObjectTypeV1" };
export type ObjectSchemaIdV1 = string & { readonly [schemaIdBrand]: "ObjectSchemaIdV1" };
export type ObjectProfileV1 = "entity" | "relationship";
export type ObjectLifecycleStatusV1 =
  | "created"
  | "validated"
  | "active"
  | "archived"
  | "deprecated"
  | "deleted"
  | "destroyed";
export type ObjectProvenanceOriginV1 =
  | "owner-authored"
  | "imported"
  | "derived"
  | "observed"
  | "system-produced";

export type CanonicalValueV1 =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValueV1[]
  | { readonly [key: string]: CanonicalValueV1 };

export type ValidatedCanonicalValueV1 = CanonicalValueV1 & {
  readonly [validatedValueBrand]: "ValidatedCanonicalValueV1";
};

export interface ObjectOwnershipV1 {
  readonly ownerId: OwnerIdV1;
}

export interface ObjectMetadataV1 {
  readonly labels: readonly string[];
  readonly extensions: Readonly<Record<string, CanonicalValueV1>>;
}

export interface ObjectProvenanceV1 {
  readonly version: "1";
  readonly originCategory: ObjectProvenanceOriginV1;
  readonly responsibleActorId: ActorIdV1;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly correlationId: string;
  readonly sourceObjectId?: ObjectIdV1;
  readonly externalSourceRef?: string;
  readonly derivationMethodId?: string;
}

export interface ObjectIntegrityDescriptorV1 {
  readonly frameVersion: "1";
  readonly purpose: "aion.object.integrity";
  readonly canonicalizationProfile: "acj-1";
  readonly algorithm: "sha-256";
  readonly digest: string;
  readonly contractFamily: "aion.object";
  readonly contractVersion: "1";
  readonly schemaId: ObjectSchemaIdV1;
  readonly schemaVersion: number;
  readonly context: string;
}

export interface ObjectEnvelopeContentV1<TData extends CanonicalValueV1 = CanonicalValueV1> {
  readonly objectId: ObjectIdV1;
  readonly objectType: ObjectTypeV1;
  readonly objectProfile: ObjectProfileV1;
  readonly objectContractVersion: "1";
  readonly schemaId: ObjectSchemaIdV1;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly ownership: ObjectOwnershipV1;
  readonly createdBy: ActorIdV1;
  readonly createdAt: string;
  readonly modifiedBy: ActorIdV1;
  readonly modifiedAt: string;
  readonly lifecycleState: ObjectLifecycleStatusV1;
  readonly metadata: ObjectMetadataV1;
  readonly provenanceSummary: ObjectProvenanceV1;
  readonly permissionSetRef?: ObjectIdV1;
  readonly auditStreamRef?: ObjectIdV1;
  readonly data: TData;
}

export interface ObjectEnvelopeV1<TData extends CanonicalValueV1 = CanonicalValueV1>
  extends ObjectEnvelopeContentV1<TData> {
  readonly integrity: ObjectIntegrityDescriptorV1;
}

export interface ObjectTypeRegistrationV1 {
  readonly objectType: ObjectTypeV1;
  readonly objectProfile: ObjectProfileV1;
  readonly schemaId: ObjectSchemaIdV1;
  readonly schemaVersion: number;
}

export interface ObjectSchemaRegistryV1 {
  isRegistered(registration: ObjectTypeRegistrationV1): boolean;
  isExtensionNamespaceRegistered(namespace: string): boolean;
  validateData(registration: ObjectTypeRegistrationV1, data: CanonicalValueV1): boolean;
}

export interface ObjectClock {
  now(): string;
}

export interface ObjectIdGenerator {
  generate(): string;
}

export interface ObjectCanonicalSerializerV1 {
  canonicalize(value: unknown): Uint8Array;
}

export interface ObjectDigestV1 {
  digest(algorithm: "sha-256", framedBytes: Uint8Array): string;
}

export interface ObjectCreateInputV1<TData extends CanonicalValueV1 = CanonicalValueV1> {
  readonly registration: ObjectTypeRegistrationV1;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly lifecycleState: "created" | "validated" | "active";
  readonly metadata: ObjectMetadataV1;
  readonly provenance: Omit<ObjectProvenanceV1, "responsibleActorId" | "recordedAt">;
  readonly data: TData;
}

export interface ObjectConstructionPortsV1 {
  readonly clock: ObjectClock;
  readonly idGenerator: ObjectIdGenerator;
  readonly canonicalizer: ObjectCanonicalSerializerV1;
  readonly digest: ObjectDigestV1;
  readonly schemaRegistry: ObjectSchemaRegistryV1;
}

export interface ObjectCommitRequestV1 {
  readonly expectedRevision: number | null;
  readonly snapshot: ObjectEnvelopeV1;
}

export interface ObjectRepository {
  loadCurrent(objectId: ObjectIdV1): Promise<ObjectEnvelopeV1 | null>;
  loadRevision(objectId: ObjectIdV1, revision: number): Promise<ObjectEnvelopeV1 | null>;
  commit(request: ObjectCommitRequestV1): Promise<void>;
}

export type ObjectErrorCodeV1 =
  | "unsupported-value-kind"
  | "integer-out-of-range"
  | "invalid-string"
  | "duplicate-member"
  | "invalid-key"
  | "limit-exceeded"
  | "invalid-timestamp"
  | "invalid-identifier"
  | "unvalidated-input"
  | "missing-frame"
  | "unknown-frame-version"
  | "frame-truncated"
  | "frame-length-overflow"
  | "frame-trailing-bytes"
  | "unregistered-purpose"
  | "invalid-object"
  | "unknown-object-type"
  | "unsupported-contract"
  | "unsupported-schema"
  | "invalid-domain-data"
  | "invalid-lifecycle-transition"
  | "invalid-reference"
  | "owner-mismatch"
  | "not-found"
  | "revision-conflict"
  | "integrity-mismatch"
  | "commit-failed";

export class ObjectErrorV1 extends Error {
  constructor(
    readonly code: ObjectErrorCodeV1,
    readonly location: string,
    message: string,
    readonly limitId?: string,
  ) {
    super(message.slice(0, 512));
    this.name = "ObjectErrorV1";
  }
}
