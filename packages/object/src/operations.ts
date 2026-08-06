import type { ActorIdV1, OwnerIdV1 } from "@aion/identity";
import {
  ObjectErrorV1,
  type ObjectConstructionPortsV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type ObjectLifecycleStatusV1,
  type ObjectMetadataV1,
  type ObjectProvenanceV1,
  type ObjectRepository,
} from "./contracts.js";
import {
  CAREER_ENTITY_FAMILY_REGISTRATIONS_V1,
  RELATIONSHIP_OBJECT_V1,
  isCareerEntityRegistrationV1,
  relationshipDescriptorV1,
  relationshipEndpointV1,
  type CareerEntityRegistrationV1,
  type CareerFamilyDataV1,
  type RelationshipKindV1,
  type RelationshipObjectDataV1,
} from "./families.js";
import {
  createObjectV1,
  objectEnvelopeContentV1,
  sealObjectEnvelopeV1,
  validateObjectEnvelopeV1,
} from "./object.js";

type ValidationPorts = Pick<ObjectConstructionPortsV1, "canonicalizer" | "digest" | "schemaRegistry">;

export interface ObjectOperationPortsV1 extends ObjectConstructionPortsV1 {
  readonly repository: ObjectRepository;
}

export interface CreateInitialObjectRequestV1 {
  readonly family: CareerEntityRegistrationV1;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly lifecycleState: "created" | "validated" | "active";
  readonly metadata: ObjectMetadataV1;
  readonly provenance: Omit<ObjectProvenanceV1, "responsibleActorId" | "recordedAt">;
}

export interface AppendObjectRevisionRequestV1 {
  readonly objectId: ObjectIdV1;
  readonly expectedRevision: number;
  readonly actorId: ActorIdV1;
  readonly lifecycleState: Exclude<ObjectLifecycleStatusV1, "deleted" | "destroyed">;
  readonly metadata: ObjectMetadataV1;
  readonly provenance: Omit<ObjectProvenanceV1, "responsibleActorId" | "recordedAt">;
}

export interface CreateRelationshipObjectRequestV1 {
  readonly relationshipKind: RelationshipKindV1;
  readonly sourceObjectId: ObjectIdV1;
  readonly targetObjectId: ObjectIdV1;
  readonly ownerId: OwnerIdV1;
  readonly actorId: ActorIdV1;
  readonly effectiveFrom: string;
  readonly metadata: ObjectMetadataV1;
  readonly provenance: Omit<ObjectProvenanceV1, "responsibleActorId" | "recordedAt">;
}

export interface AppendRelationshipRevisionRequestV1 {
  readonly relationshipObjectId: ObjectIdV1;
  readonly expectedRevision: number;
  readonly actorId: ActorIdV1;
  readonly lifecycleState: Exclude<ObjectLifecycleStatusV1, "deleted" | "destroyed">;
  readonly effectiveUntil: string | null;
  readonly metadata: ObjectMetadataV1;
  readonly provenance: Omit<ObjectProvenanceV1, "responsibleActorId" | "recordedAt">;
}

function registrationOf(object: ObjectEnvelopeV1) {
  return {
    objectType: object.objectType,
    objectProfile: object.objectProfile,
    schemaId: object.schemaId,
    schemaVersion: object.schemaVersion,
  };
}

function ensureKnownFamily(family: CareerEntityRegistrationV1): void {
  if (!CAREER_ENTITY_FAMILY_REGISTRATIONS_V1.some((candidate) =>
    candidate.objectType === family.objectType
    && candidate.objectProfile === family.objectProfile
    && candidate.schemaId === family.schemaId
    && candidate.schemaVersion === family.schemaVersion)) {
    throw new ObjectErrorV1("unknown-object-type", "$.family", "Career Object family is unsupported.");
  }
}

async function requireCurrent(repository: ObjectRepository, objectId: ObjectIdV1): Promise<ObjectEnvelopeV1> {
  const object = await repository.loadCurrent(objectId);
  if (object === null) throw new ObjectErrorV1("not-found", "$.objectId", "Required Object endpoint was not found.");
  return object;
}

function requireUsableEndpoint(object: ObjectEnvelopeV1): void {
  if (!isCareerEntityRegistrationV1(registrationOf(object))) {
    throw new ObjectErrorV1("invalid-reference", "$.data", "Relationship endpoint family is unsupported.");
  }
  if (object.lifecycleState === "deleted" || object.lifecycleState === "destroyed") {
    throw new ObjectErrorV1("invalid-reference", "$.data", "Relationship endpoint is unavailable.");
  }
}

export async function createInitialObjectV1(
  request: CreateInitialObjectRequestV1,
  ports: ObjectOperationPortsV1,
): Promise<ObjectEnvelopeV1<CareerFamilyDataV1>> {
  ensureKnownFamily(request.family);
  const snapshot = createObjectV1({
    registration: request.family,
    ownerId: request.ownerId,
    actorId: request.actorId,
    lifecycleState: request.lifecycleState,
    metadata: request.metadata,
    provenance: request.provenance,
    data: {},
  }, ports);
  await ports.repository.commit({ expectedRevision: null, snapshot });
  return snapshot;
}

export async function appendObjectRevisionV1(
  request: AppendObjectRevisionRequestV1,
  ports: ObjectOperationPortsV1,
): Promise<ObjectEnvelopeV1<CareerFamilyDataV1>> {
  const current = await requireCurrent(ports.repository, request.objectId);
  if (!isCareerEntityRegistrationV1(registrationOf(current))) {
    throw new ObjectErrorV1("invalid-reference", "$.objectId", "Object is not an approved career entity family.");
  }
  const timestamp = ports.clock.now();
  const next = sealObjectEnvelopeV1({
    ...objectEnvelopeContentV1(current),
    revision: current.revision + 1,
    modifiedBy: request.actorId,
    modifiedAt: timestamp,
    lifecycleState: request.lifecycleState,
    metadata: request.metadata,
    provenanceSummary: {
      ...request.provenance,
      responsibleActorId: request.actorId,
      recordedAt: timestamp,
    },
    data: {},
  }, ports);
  await ports.repository.commit({ expectedRevision: request.expectedRevision, snapshot: next });
  return next as ObjectEnvelopeV1<CareerFamilyDataV1>;
}

export async function createRelationshipObjectV1(
  request: CreateRelationshipObjectRequestV1,
  ports: ObjectOperationPortsV1,
): Promise<ObjectEnvelopeV1<RelationshipObjectDataV1>> {
  const descriptor = relationshipDescriptorV1(request.relationshipKind);
  const [source, target] = await Promise.all([
    requireCurrent(ports.repository, request.sourceObjectId),
    requireCurrent(ports.repository, request.targetObjectId),
  ]);
  requireUsableEndpoint(source);
  requireUsableEndpoint(target);
  if (source.objectId === target.objectId) {
    throw new ObjectErrorV1("invalid-reference", "$.data", "Self-relationships are unsupported.");
  }
  if (source.ownership.ownerId !== request.ownerId || target.ownership.ownerId !== request.ownerId) {
    throw new ObjectErrorV1("owner-mismatch", "$.ownership", "Relationship endpoints must share the requested owner.");
  }
  const sourceRegistration = registrationOf(source);
  const targetRegistration = registrationOf(target);
  if (!isCareerEntityRegistrationV1(sourceRegistration)
    || !isCareerEntityRegistrationV1(targetRegistration)
    || sourceRegistration.objectType !== descriptor.source.objectType
    || sourceRegistration.schemaId !== descriptor.source.schemaId
    || targetRegistration.objectType !== descriptor.target.objectType
    || targetRegistration.schemaId !== descriptor.target.schemaId) {
    throw new ObjectErrorV1("invalid-reference", "$.data", "Relationship endpoint family combination is invalid.");
  }
  const data: RelationshipObjectDataV1 = {
    relationshipContractVersion: "1",
    relationshipKind: request.relationshipKind,
    source: relationshipEndpointV1(source),
    target: relationshipEndpointV1(target),
    effectiveFrom: request.effectiveFrom,
    effectiveUntil: null,
    attributes: {},
  };
  const snapshot = createObjectV1({
    registration: RELATIONSHIP_OBJECT_V1,
    ownerId: request.ownerId,
    actorId: request.actorId,
    lifecycleState: "active",
    metadata: request.metadata,
    provenance: request.provenance,
    data,
  }, ports);
  await ports.repository.commit({ expectedRevision: null, snapshot });
  return snapshot as ObjectEnvelopeV1<RelationshipObjectDataV1>;
}

export async function appendRelationshipRevisionV1(
  request: AppendRelationshipRevisionRequestV1,
  ports: ObjectOperationPortsV1,
): Promise<ObjectEnvelopeV1<RelationshipObjectDataV1>> {
  const current = await requireCurrent(ports.repository, request.relationshipObjectId);
  if (current.objectType !== RELATIONSHIP_OBJECT_V1.objectType
    || current.objectProfile !== RELATIONSHIP_OBJECT_V1.objectProfile
    || current.schemaId !== RELATIONSHIP_OBJECT_V1.schemaId
    || current.schemaVersion !== RELATIONSHIP_OBJECT_V1.schemaVersion) {
    throw new ObjectErrorV1("invalid-reference", "$.relationshipObjectId", "Object is not a RelationshipObject.");
  }
  const currentData = current.data as unknown as RelationshipObjectDataV1;
  const [source, target] = await Promise.all([
    requireCurrent(ports.repository, currentData.source.objectId),
    requireCurrent(ports.repository, currentData.target.objectId),
  ]);
  requireUsableEndpoint(source);
  requireUsableEndpoint(target);
  if (source.ownership.ownerId !== current.ownership.ownerId
    || target.ownership.ownerId !== current.ownership.ownerId
    || source.objectType !== currentData.source.objectType
    || source.schemaId !== currentData.source.schemaId
    || target.objectType !== currentData.target.objectType
    || target.schemaId !== currentData.target.schemaId) {
    throw new ObjectErrorV1("invalid-reference", "$.data", "Relationship endpoint state no longer matches the stored references.");
  }
  const timestamp = ports.clock.now();
  const next = sealObjectEnvelopeV1({
    ...objectEnvelopeContentV1(current),
    revision: current.revision + 1,
    modifiedBy: request.actorId,
    modifiedAt: timestamp,
    lifecycleState: request.lifecycleState,
    metadata: request.metadata,
    provenanceSummary: {
      ...request.provenance,
      responsibleActorId: request.actorId,
      recordedAt: timestamp,
    },
    data: { ...currentData, effectiveUntil: request.effectiveUntil },
  }, ports);
  await ports.repository.commit({ expectedRevision: request.expectedRevision, snapshot: next });
  return next as ObjectEnvelopeV1<RelationshipObjectDataV1>;
}

export async function loadCurrentObjectV1(
  objectId: ObjectIdV1,
  repository: ObjectRepository,
  ports: ValidationPorts,
): Promise<ObjectEnvelopeV1 | null> {
  const snapshot = await repository.loadCurrent(objectId);
  return snapshot === null ? null : validateObjectEnvelopeV1(snapshot, ports);
}

export async function loadObjectRevisionV1(
  objectId: ObjectIdV1,
  revision: number,
  repository: ObjectRepository,
  ports: ValidationPorts,
): Promise<ObjectEnvelopeV1 | null> {
  const snapshot = await repository.loadRevision(objectId, revision);
  return snapshot === null ? null : validateObjectEnvelopeV1(snapshot, ports);
}
