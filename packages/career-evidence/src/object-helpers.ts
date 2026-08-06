import type { ActorIdV1, OwnerIdV1 } from "@aion/identity";
import {
  appendRelationshipRevisionV1,
  createObjectV1,
  createRelationshipObjectV1,
  objectEnvelopeContentV1,
  ObjectErrorV1,
  RELATIONSHIP_OBJECT_V1,
  sealObjectEnvelopeV1,
  type CanonicalValueV1,
  type ObjectCanonicalSerializerV1,
  type ObjectClock,
  type ObjectConstructionPortsV1,
  type ObjectDigestV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type ObjectMetadataV1,
  type ObjectOperationPortsV1,
  type ObjectRepository,
  type ObjectSchemaRegistryV1,
  type ObjectTypeRegistrationV1,
  type RelationshipKindV1,
  type RelationshipObjectDataV1,
} from "@aion/object";
import {
  CareerEvidenceOperationErrorV1,
  type CareerEvidenceErrorV1,
} from "./contracts.js";
import type { CareerEvidenceIdDeriverV1 } from "./ids.js";

export interface CareerEvidenceOperationPortsV1 {
  readonly repository: ObjectRepository;
  readonly clock: ObjectClock;
  readonly canonicalizer: ObjectCanonicalSerializerV1;
  readonly digest: ObjectDigestV1;
  readonly schemaRegistry: ObjectSchemaRegistryV1;
  readonly idDeriver: CareerEvidenceIdDeriverV1;
}

export const EMPTY_METADATA_V1: ObjectMetadataV1 = Object.freeze({ labels: [], extensions: {} });
const DERIVATION_METHOD_ID_V1 = "aion.career-evidence.deterministic.v1";

export function operationErrorV1(
  error: unknown,
  stage: CareerEvidenceErrorV1["stage"],
): CareerEvidenceOperationErrorV1 {
  if (error instanceof CareerEvidenceOperationErrorV1) return error;
  if (error instanceof ObjectErrorV1) {
    if (error.code === "not-found") return new CareerEvidenceOperationErrorV1("not-found", stage, "A required private Object was not found.");
    if (error.code === "owner-mismatch") return new CareerEvidenceOperationErrorV1("owner-mismatch", stage, "Private Object ownership does not match the request.");
    if (error.code === "revision-conflict") return new CareerEvidenceOperationErrorV1("revision-conflict", stage, "The expected private Object revision changed.");
    if (error.code === "commit-failed") return new CareerEvidenceOperationErrorV1("persistence-failed", "persistence", "Private Object persistence failed.");
    return new CareerEvidenceOperationErrorV1("object-invalid", stage, "A private Object failed validation.");
  }
  return new CareerEvidenceOperationErrorV1("persistence-failed", "persistence", "Private Object persistence failed.");
}

export function constructionPortsAtV1(
  ports: CareerEvidenceOperationPortsV1,
  objectId: ObjectIdV1,
  timestamp: string,
): ObjectConstructionPortsV1 {
  return {
    clock: { now: () => timestamp },
    idGenerator: { generate: () => objectId },
    canonicalizer: ports.canonicalizer,
    digest: ports.digest,
    schemaRegistry: ports.schemaRegistry,
  };
}

function operationPortsAtV1(
  ports: CareerEvidenceOperationPortsV1,
  objectId: ObjectIdV1,
  timestamp: string,
): ObjectOperationPortsV1 {
  return { ...constructionPortsAtV1(ports, objectId, timestamp), repository: ports.repository };
}

export function canonicalEqualV1(
  left: unknown,
  right: unknown,
  canonicalizer: ObjectCanonicalSerializerV1,
): boolean {
  const leftBytes = canonicalizer.canonicalize(left);
  const rightBytes = canonicalizer.canonicalize(right);
  return leftBytes.length === rightBytes.length && leftBytes.every((byte, index) => byte === rightBytes[index]);
}

export function registrationMatchesV1(object: ObjectEnvelopeV1, registration: ObjectTypeRegistrationV1): boolean {
  return object.objectType === registration.objectType
    && object.objectProfile === registration.objectProfile
    && object.schemaId === registration.schemaId
    && object.schemaVersion === registration.schemaVersion;
}

export function requireOwnedRegistrationV1(
  object: ObjectEnvelopeV1,
  registration: ObjectTypeRegistrationV1,
  ownerId: OwnerIdV1,
): void {
  if (!registrationMatchesV1(object, registration)) {
    throw new CareerEvidenceOperationErrorV1("object-invalid", "persistence", "A private Object has an unexpected family.");
  }
  if (object.ownership.ownerId !== ownerId) {
    throw new CareerEvidenceOperationErrorV1("owner-mismatch", "persistence", "Private Object ownership does not match the request.");
  }
}

export async function createDomainObjectV1(
  registration: ObjectTypeRegistrationV1,
  objectId: ObjectIdV1,
  ownerId: OwnerIdV1,
  actorId: ActorIdV1,
  timestamp: string,
  originCategory: "owner-authored" | "imported" | "derived",
  correlationId: string,
  data: CanonicalValueV1,
  ports: CareerEvidenceOperationPortsV1,
  sourceObjectId?: ObjectIdV1,
): Promise<ObjectEnvelopeV1> {
  const snapshot = createObjectV1({
    registration,
    ownerId,
    actorId,
    lifecycleState: "active",
    metadata: EMPTY_METADATA_V1,
    provenance: {
      version: "1",
      originCategory,
      observedAt: timestamp,
      correlationId,
      ...(originCategory === "derived" ? { derivationMethodId: DERIVATION_METHOD_ID_V1 } : {}),
      ...(sourceObjectId === undefined ? {} : { sourceObjectId }),
    },
    data,
  }, constructionPortsAtV1(ports, objectId, timestamp));
  await ports.repository.commit({ expectedRevision: null, snapshot });
  return snapshot;
}

export async function appendDomainRevisionV1(
  current: ObjectEnvelopeV1,
  expectedRevision: number,
  actorId: ActorIdV1,
  timestamp: string,
  originCategory: "owner-authored" | "imported" | "derived",
  correlationId: string,
  data: CanonicalValueV1,
  ports: CareerEvidenceOperationPortsV1,
  sourceObjectId?: ObjectIdV1,
): Promise<ObjectEnvelopeV1> {
  const snapshot = sealObjectEnvelopeV1({
    ...objectEnvelopeContentV1(current),
    revision: current.revision + 1,
    modifiedBy: actorId,
    modifiedAt: timestamp,
    lifecycleState: "active",
    metadata: EMPTY_METADATA_V1,
    provenanceSummary: {
      version: "1",
      originCategory,
      responsibleActorId: actorId,
      observedAt: timestamp,
      recordedAt: timestamp,
      correlationId,
      ...(originCategory === "derived" ? { derivationMethodId: DERIVATION_METHOD_ID_V1 } : {}),
      ...(sourceObjectId === undefined ? {} : { sourceObjectId }),
    },
    data,
  }, ports);
  await ports.repository.commit({ expectedRevision, snapshot });
  return snapshot;
}

export async function ensureExactDomainObjectV1(
  registration: ObjectTypeRegistrationV1,
  objectId: ObjectIdV1,
  ownerId: OwnerIdV1,
  actorId: ActorIdV1,
  timestamp: string,
  originCategory: "owner-authored" | "imported" | "derived",
  correlationId: string,
  data: CanonicalValueV1,
  ports: CareerEvidenceOperationPortsV1,
  sourceObjectId?: ObjectIdV1,
): Promise<{ readonly object: ObjectEnvelopeV1; readonly created: boolean }> {
  let current = await ports.repository.loadCurrent(objectId);
  if (current === null) {
    try {
      return {
        object: await createDomainObjectV1(
          registration, objectId, ownerId, actorId, timestamp, originCategory,
          correlationId, data, ports, sourceObjectId,
        ),
        created: true,
      };
    } catch (error) {
      if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error;
      current = await ports.repository.loadCurrent(objectId);
      if (current === null) throw error;
    }
  }
  requireOwnedRegistrationV1(current, registration, ownerId);
  if (!canonicalEqualV1(current.data, data, ports.canonicalizer)) {
    throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "Deterministic Object identity conflicts with different content.");
  }
  return { object: current, created: false };
}

export async function ensureRelationshipV1(
  relationshipObjectId: ObjectIdV1,
  relationshipKind: RelationshipKindV1,
  sourceObjectId: ObjectIdV1,
  targetObjectId: ObjectIdV1,
  ownerId: OwnerIdV1,
  actorId: ActorIdV1,
  timestamp: string,
  correlationId: string,
  ports: CareerEvidenceOperationPortsV1,
): Promise<{ readonly object: ObjectEnvelopeV1; readonly created: boolean }> {
  let current = await ports.repository.loadCurrent(relationshipObjectId);
  if (current === null) {
    try {
      const object = await createRelationshipObjectV1({
        relationshipKind,
        sourceObjectId,
        targetObjectId,
        ownerId,
        actorId,
        effectiveFrom: timestamp,
        metadata: EMPTY_METADATA_V1,
        provenance: {
          version: "1",
          originCategory: "derived",
          observedAt: timestamp,
          correlationId,
          sourceObjectId,
          derivationMethodId: DERIVATION_METHOD_ID_V1,
        },
      }, operationPortsAtV1(ports, relationshipObjectId, timestamp));
      return { object, created: true };
    } catch (error) {
      if (!(error instanceof ObjectErrorV1) || error.code !== "revision-conflict") throw error;
      current = await ports.repository.loadCurrent(relationshipObjectId);
      if (current === null) throw error;
    }
  }
  requireOwnedRegistrationV1(current, RELATIONSHIP_OBJECT_V1, ownerId);
  const data = current.data as unknown as RelationshipObjectDataV1;
  if (data.relationshipKind !== relationshipKind
    || data.source.objectId !== sourceObjectId
    || data.target.objectId !== targetObjectId) {
    throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "Deterministic relationship identity conflicts with different endpoints.");
  }
  if (data.effectiveUntil !== null) {
    const object = await appendRelationshipRevisionV1({
      relationshipObjectId,
      expectedRevision: current.revision,
      actorId,
      lifecycleState: "active",
      effectiveUntil: null,
      metadata: EMPTY_METADATA_V1,
      provenance: {
        version: "1",
        originCategory: "derived",
        observedAt: timestamp,
        correlationId,
        sourceObjectId,
        derivationMethodId: DERIVATION_METHOD_ID_V1,
      },
    }, operationPortsAtV1(ports, relationshipObjectId, timestamp));
    return { object, created: true };
  }
  return { object: current, created: false };
}

export async function endRelationshipV1(
  relationshipObjectId: ObjectIdV1,
  relationshipKind: RelationshipKindV1,
  sourceObjectId: ObjectIdV1,
  targetObjectId: ObjectIdV1,
  ownerId: OwnerIdV1,
  actorId: ActorIdV1,
  timestamp: string,
  correlationId: string,
  ports: CareerEvidenceOperationPortsV1,
): Promise<{ readonly object: ObjectEnvelopeV1; readonly changed: boolean }> {
  const current = await ports.repository.loadCurrent(relationshipObjectId);
  if (current === null) {
    throw new CareerEvidenceOperationErrorV1("not-found", "profile", "A prior profile membership relationship was not found.");
  }
  requireOwnedRegistrationV1(current, RELATIONSHIP_OBJECT_V1, ownerId);
  const data = current.data as unknown as RelationshipObjectDataV1;
  if (data.relationshipKind !== relationshipKind || data.source.objectId !== sourceObjectId || data.target.objectId !== targetObjectId) {
    throw new CareerEvidenceOperationErrorV1("revision-conflict", "profile", "A profile relationship has conflicting endpoints.");
  }
  if (data.effectiveUntil !== null) return { object: current, changed: false };
  const object = await appendRelationshipRevisionV1({
    relationshipObjectId,
    expectedRevision: current.revision,
    actorId,
    lifecycleState: "active",
    effectiveUntil: timestamp,
    metadata: EMPTY_METADATA_V1,
    provenance: {
      version: "1",
      originCategory: "derived",
      observedAt: timestamp,
      correlationId,
      sourceObjectId,
      derivationMethodId: DERIVATION_METHOD_ID_V1,
    },
  }, operationPortsAtV1(ports, relationshipObjectId, timestamp));
  return { object, changed: true };
}
