import {
  asObjectIdV1,
  CAREER_FACT_OBJECT_V1,
  CAREER_PROFILE_OBJECT_V1,
  RELATIONSHIP_OBJECT_V1,
  validateCanonicalIdentifierV1,
  type CanonicalValueV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type RelationshipObjectDataV1,
} from "@aion/object";
import { asActorIdV1, asOwnerIdV1 } from "@aion/identity";
import {
  CAREER_PROFILE_PAYLOAD_VERSION_V1,
  CareerEvidenceOperationErrorV1,
  isCareerFactTypeV1,
  validateCareerFactPayloadV1,
  validateCareerProfilePayloadV1,
  type CareerFactPayloadV1,
  type CareerFactTypeV1,
  type CareerProfileBuildRequestV1,
  type CareerProfileBuildResultV1,
  type CareerProfileFactStateV1,
  type CareerProfilePayloadV1,
  type ProcessingOutcomeV1,
} from "./contracts.js";
import { privateObjectReferenceSummaryV1 } from "./ids.js";
import {
  appendDomainRevisionV1,
  canonicalEqualV1,
  createDomainObjectV1,
  endRelationshipV1,
  ensureRelationshipV1,
  operationErrorV1,
  registrationMatchesV1,
  requireOwnedRegistrationV1,
  type CareerEvidenceOperationPortsV1,
} from "./object-helpers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sortedUnique(values: unknown, validator: (value: unknown) => boolean): values is readonly string[] {
  if (!Array.isArray(values)) return false;
  let prior: string | undefined;
  for (const item of values) {
    if (!validator(item) || (prior !== undefined && prior >= item)) return false;
    prior = item as string;
  }
  return true;
}

function operationId(value: unknown): value is string {
  try { validateCanonicalIdentifierV1(value, "$.buildOperationId"); return true; } catch { return false; }
}

function validateRequest(value: unknown): CareerProfileBuildRequestV1 {
  if (!isRecord(value) || !exactKeys(value, [
    "actorId", "buildConfigurationVersion", "buildOperationId", "expectedRevision", "factIds",
    "ownerId", "profileObjectId", "requiredFactTypes", "version",
  ]) || value.version !== "1" || value.buildConfigurationVersion !== "1" || !operationId(value.buildOperationId)
    || !sortedUnique(value.factIds, (item) => { try { asObjectIdV1(item); return true; } catch { return false; } })
    || !sortedUnique(value.requiredFactTypes, isCareerFactTypeV1)
    || ((value.profileObjectId === null) !== (value.expectedRevision === null))) {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "A closed deterministic profile-build request is required.");
  }
  try { asOwnerIdV1(value.ownerId); asActorIdV1(value.actorId); } catch {
    throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "Synthetic or approved typed Identity references are required.");
  }
  if (value.profileObjectId !== null) {
    try { asObjectIdV1(value.profileObjectId); } catch {
      throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "The profile Object reference is invalid.");
    }
    if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) {
      throw new CareerEvidenceOperationErrorV1("request-invalid", "request", "A positive expected profile revision is required.");
    }
  }
  return value as unknown as CareerProfileBuildRequestV1;
}

function profileOutcome(state: ProcessingOutcomeV1["state"], factCount: number, relationshipCount: number, reasons: readonly string[] = []): ProcessingOutcomeV1 {
  return { version: "1", state, acceptedFactCount: factCount, relationshipCount, reasonCodes: [...reasons].sort() };
}

function payload(
  request: CareerProfileBuildRequestV1,
  factStates: readonly CareerProfileFactStateV1[],
  missingFactTypes: readonly CareerFactTypeV1[],
  processingOutcome: ProcessingOutcomeV1,
): CareerProfilePayloadV1 {
  return {
    contractVersion: CAREER_PROFILE_PAYLOAD_VERSION_V1,
    buildOperationId: request.buildOperationId,
    buildConfigurationVersion: request.buildConfigurationVersion,
    processingOutcome,
    factStates,
    missingFactTypes,
  } as CareerProfilePayloadV1;
}

async function loadFacts(request: CareerProfileBuildRequestV1, ports: CareerEvidenceOperationPortsV1) {
  const included: { object: ObjectEnvelopeV1; payload: CareerFactPayloadV1 }[] = [];
  for (const factId of request.factIds) {
    const object = await ports.repository.loadCurrent(factId);
    if (object === null) throw new CareerEvidenceOperationErrorV1("not-found", "profile", "A selected CareerFact was not found.");
    requireOwnedRegistrationV1(object, CAREER_FACT_OBJECT_V1, request.ownerId);
    const factPayload = validateCareerFactPayloadV1(object.data);
    if (factPayload.supersession.state === "current") included.push({ object, payload: factPayload });
  }
  return included;
}

function factStatesOf(facts: Awaited<ReturnType<typeof loadFacts>>): readonly CareerProfileFactStateV1[] {
  return facts.map(({ object, payload: fact }) => ({
    version: "1" as const,
    factId: object.objectId,
    factRevision: object.revision,
    factType: fact.factType,
    confidence: fact.confidence,
    status: fact.status,
    supersessionState: fact.supersession.state,
  })).sort((left, right) => left.factId.localeCompare(right.factId));
}

function missingTypesOf(required: readonly CareerFactTypeV1[], facts: Awaited<ReturnType<typeof loadFacts>>): readonly CareerFactTypeV1[] {
  const present = new Set(facts.filter(({ payload: fact }) => fact.status.assertion !== "missing").map(({ payload: fact }) => fact.factType));
  return required.filter((type) => !present.has(type));
}

function membershipId(profileId: ObjectIdV1, factId: ObjectIdV1, ports: CareerEvidenceOperationPortsV1): ObjectIdV1 {
  return ports.idDeriver.derive(profileId, "profile-contains-fact", factId);
}

async function verifyActiveMembership(
  relationshipId: ObjectIdV1,
  profileId: ObjectIdV1,
  factId: ObjectIdV1,
  request: CareerProfileBuildRequestV1,
  ports: CareerEvidenceOperationPortsV1,
): Promise<void> {
  const object = await ports.repository.loadCurrent(relationshipId);
  if (object === null) throw new CareerEvidenceOperationErrorV1("object-invalid", "profile", "A completed profile is missing membership evidence.");
  requireOwnedRegistrationV1(object, RELATIONSHIP_OBJECT_V1, request.ownerId);
  const data = object.data as unknown as RelationshipObjectDataV1;
  if (data.relationshipKind !== "aion.relationship.career.profile-contains-fact.v1"
    || data.source.objectId !== profileId || data.target.objectId !== factId || data.effectiveUntil !== null) {
    throw new CareerEvidenceOperationErrorV1("object-invalid", "profile", "A profile membership relationship is invalid.");
  }
}

export async function buildCareerProfileV1(
  value: unknown,
  ports: CareerEvidenceOperationPortsV1,
): Promise<CareerProfileBuildResultV1> {
  let request: CareerProfileBuildRequestV1;
  try { request = validateRequest(value); } catch (error) {
    const safe = operationErrorV1(error, "request");
    return {
      version: "1", outcome: "rejected", profileReference: null, relationshipReferences: [],
      includedFactCount: 0, missingFactTypes: [], recoveryRequired: false, error: safe.toResult(),
    };
  }
  const profileId = request.profileObjectId
    ?? ports.idDeriver.derive(request.buildOperationId, "career-profile", "profile");
  let profile: ObjectEnvelopeV1 | null = null;
  let operationStarted = false;
  let relationshipsChanged = 0;
  let factStates: readonly CareerProfileFactStateV1[] = [];
  let missingFactTypes: readonly CareerFactTypeV1[] = [];
  let relationshipIds: readonly ObjectIdV1[] = [];
  try {
    const facts = await loadFacts(request, ports);
    factStates = factStatesOf(facts);
    missingFactTypes = missingTypesOf(request.requiredFactTypes, facts);
    relationshipIds = facts.map(({ object }) => membershipId(profileId, object.objectId, ports));
    profile = await ports.repository.loadCurrent(profileId);
    let priorFactIds: readonly ObjectIdV1[] = [];
    const pendingPayload = payload(request, factStates, missingFactTypes, profileOutcome("pending", factStates.length, 0));

    if (profile === null) {
      if (request.profileObjectId !== null) throw new CareerEvidenceOperationErrorV1("not-found", "profile", "The requested CareerProfile was not found.");
      const timestamp = ports.clock.now();
      profile = await createDomainObjectV1(
        CAREER_PROFILE_OBJECT_V1, profileId, request.ownerId, request.actorId, timestamp,
        "derived", request.buildOperationId, pendingPayload as unknown as CanonicalValueV1, ports,
      );
      operationStarted = true;
    } else {
      requireOwnedRegistrationV1(profile, CAREER_PROFILE_OBJECT_V1, request.ownerId);
      const currentPayload = validateCareerProfilePayloadV1(profile.data);
      if (currentPayload.buildOperationId === request.buildOperationId) {
        const expectedSame = payload(request, factStates, missingFactTypes, currentPayload.processingOutcome);
        if (!canonicalEqualV1(currentPayload, expectedSame, ports.canonicalizer)) {
          throw new CareerEvidenceOperationErrorV1("revision-conflict", "profile", "The build operation identifier is bound to a different profile selection.");
        }
        if (currentPayload.processingOutcome.state === "success") {
          for (let index = 0; index < facts.length; index += 1) {
            await verifyActiveMembership(relationshipIds[index]!, profileId, facts[index]!.object.objectId, request, ports);
          }
          return {
            version: "1", outcome: "already-completed", profileReference: privateObjectReferenceSummaryV1(profileId),
            relationshipReferences: relationshipIds.map(privateObjectReferenceSummaryV1), includedFactCount: factStates.length,
            missingFactTypes, recoveryRequired: false, error: null,
          };
        }
        operationStarted = true;
        if (request.expectedRevision !== null) {
          const prior = await ports.repository.loadRevision(profileId, request.expectedRevision);
          if (prior === null) throw new CareerEvidenceOperationErrorV1("revision-conflict", "profile", "The prior profile revision is unavailable for retry.");
          priorFactIds = validateCareerProfilePayloadV1(prior.data).factStates.map((item) => item.factId);
        }
      } else {
        if (request.expectedRevision === null || profile.revision !== request.expectedRevision) {
          throw new CareerEvidenceOperationErrorV1("revision-conflict", "profile", "The CareerProfile changed before the requested build.");
        }
        priorFactIds = currentPayload.factStates.map((item) => item.factId);
        profile = await appendDomainRevisionV1(
          profile, request.expectedRevision, request.actorId, ports.clock.now(), "derived",
          request.buildOperationId, pendingPayload as unknown as CanonicalValueV1, ports,
        );
        operationStarted = true;
      }
    }

    const timestamp = ports.clock.now();
    const desired = new Set(facts.map(({ object }) => object.objectId));
    for (const priorFactId of priorFactIds.filter((factId) => !desired.has(factId))) {
      await endRelationshipV1(
        membershipId(profileId, priorFactId, ports),
        "aion.relationship.career.profile-contains-fact.v1",
        profileId, priorFactId, request.ownerId, request.actorId, timestamp, request.buildOperationId, ports,
      );
      relationshipsChanged += 1;
    }
    for (let index = 0; index < facts.length; index += 1) {
      const ensured = await ensureRelationshipV1(
        relationshipIds[index]!, "aion.relationship.career.profile-contains-fact.v1",
        profileId, facts[index]!.object.objectId, request.ownerId, request.actorId,
        timestamp, request.buildOperationId, ports,
      );
      if (ensured.created) relationshipsChanged += 1;
    }
    profile = await appendDomainRevisionV1(
      profile, profile.revision, request.actorId, ports.clock.now(), "derived", request.buildOperationId,
      payload(request, factStates, missingFactTypes, profileOutcome("success", factStates.length, facts.length)) as unknown as CanonicalValueV1,
      ports,
    );
    return {
      version: "1", outcome: "success", profileReference: privateObjectReferenceSummaryV1(profileId),
      relationshipReferences: relationshipIds.map(privateObjectReferenceSummaryV1), includedFactCount: factStates.length,
      missingFactTypes, recoveryRequired: false, error: null,
    };
  } catch (error) {
    const safe = operationErrorV1(error, "profile");
    if (operationStarted && profile !== null && registrationMatchesV1(profile, CAREER_PROFILE_OBJECT_V1)) {
      try {
        const current = await ports.repository.loadCurrent(profileId);
        if (current !== null) {
          const currentPayload = validateCareerProfilePayloadV1(current.data);
          if (currentPayload.buildOperationId === request.buildOperationId && currentPayload.processingOutcome.state !== "success") {
            await appendDomainRevisionV1(
              current, current.revision, request.actorId, ports.clock.now(), "derived", request.buildOperationId,
              payload(request, factStates, missingFactTypes, profileOutcome(
                "partial", factStates.length, relationshipsChanged, [safe.code],
              )) as unknown as CanonicalValueV1,
              ports,
            );
          }
        }
      } catch { /* preserve the originating failure */ }
    }
    return {
      version: "1", outcome: operationStarted ? "partial" : "rejected",
      profileReference: operationStarted ? privateObjectReferenceSummaryV1(profileId) : null,
      relationshipReferences: relationshipIds.map(privateObjectReferenceSummaryV1), includedFactCount: factStates.length,
      missingFactTypes, recoveryRequired: operationStarted, error: safe.toResult(),
    };
  }
}
