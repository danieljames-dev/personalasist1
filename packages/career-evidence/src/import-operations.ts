import {
  CAREER_FACT_OBJECT_V1,
  CAREER_SOURCE_OBJECT_V1,
  type CanonicalValueV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  RELATIONSHIP_OBJECT_V1,
  type RelationshipObjectDataV1,
} from "@aion/object";
import {
  CAREER_FACT_PAYLOAD_VERSION_V1,
  CAREER_SOURCE_PAYLOAD_VERSION_V1,
  CareerEvidenceOperationErrorV1,
  validateCareerFactPayloadV1,
  validateCareerSourcePayloadV1,
  type CareerEvidenceDryRunResultV1,
  type CareerEvidenceImportResultV1,
  type CareerFactCandidateV1,
  type CareerFactPayloadV1,
  type CareerSourcePayloadV1,
  type ProcessingOutcomeV1,
} from "./contracts.js";
import { privateObjectReferenceSummaryV1 } from "./ids.js";
import {
  appendDomainRevisionV1,
  canonicalEqualV1,
  createDomainObjectV1,
  ensureExactDomainObjectV1,
  ensureRelationshipV1,
  operationErrorV1,
  requireOwnedRegistrationV1,
  type CareerEvidenceOperationPortsV1,
} from "./object-helpers.js";
import { prepareCareerEvidenceSourceV1, type PreparedCareerEvidenceSourceV1 } from "./source.js";

function outcome(
  state: ProcessingOutcomeV1["state"],
  acceptedFactCount: number,
  relationshipCount: number,
  reasonCodes: readonly string[] = [],
): ProcessingOutcomeV1 {
  return { version: "1", state, acceptedFactCount, relationshipCount, reasonCodes: [...reasonCodes].sort() };
}

function sourcePayload(
  prepared: PreparedCareerEvidenceSourceV1,
  sourceId: ObjectIdV1,
  importedAt: string,
  processingOutcome: ProcessingOutcomeV1,
): CareerSourcePayloadV1 {
  return {
    contractVersion: CAREER_SOURCE_PAYLOAD_VERSION_V1,
    catalogueEntry: {
      version: "1",
      importOperationId: prepared.request.importOperationId,
      sourceObjectId: sourceId,
      originalFilename: prepared.originalFilename,
      approvedRelativePath: prepared.approvedRelativePath,
      sourceType: prepared.request.sourceType,
      importedAt,
      contentDigest: prepared.contentDigest,
      ownerId: prepared.request.ownerId,
      importingActorId: prepared.request.actorId,
      parser: prepared.parser,
      processingOutcome,
      locationIndex: prepared.locationIndex,
    },
  } as CareerSourcePayloadV1;
}

function factPayload(
  candidate: CareerFactCandidateV1,
  factId: ObjectIdV1,
  sourceId: ObjectIdV1,
  createdAt: string,
): CareerFactPayloadV1 {
  return {
    contractVersion: CAREER_FACT_PAYLOAD_VERSION_V1,
    factId,
    factType: candidate.factType,
    normalizedValue: candidate.normalizedValue,
    sourceObjectId: sourceId,
    sourceLocation: candidate.sourceLocation,
    confidence: candidate.confidence,
    ownerConfirmed: candidate.ownerConfirmed,
    status: candidate.status,
    extractionMethod: candidate.extractionMethod,
    createdAt,
    conflict: { version: "1", state: "none" },
    supersession: { version: "1", state: "current" },
  } as CareerFactPayloadV1;
}

function deriveIds(prepared: PreparedCareerEvidenceSourceV1, ports: CareerEvidenceOperationPortsV1) {
  const sourceId = ports.idDeriver.derive(prepared.request.importOperationId, "career-source", "source");
  const facts = prepared.candidates.map((candidate) => {
    const factId = ports.idDeriver.derive(
      prepared.request.importOperationId,
      "career-fact",
      `${candidate.sourceClaimId}\0${candidate.sourceLocation}`,
    );
    return {
      candidate,
      factId,
      relationshipId: ports.idDeriver.derive(
        prepared.request.importOperationId,
        "fact-derived-from-source",
        `${factId}\0${sourceId}`,
      ),
    };
  });
  return { sourceId, facts };
}

function dryRunSummary() {
  return {
    contentReturned: false as const,
    completePathReturned: false as const,
    objectWrites: 0 as const,
    identityWrites: 0 as const,
    sourceCopies: 0 as const,
    networkActions: 0 as const,
  };
}

export async function dryRunCareerEvidenceImportV1(
  request: unknown,
  ports: Pick<CareerEvidenceOperationPortsV1, "idDeriver">,
): Promise<CareerEvidenceDryRunResultV1> {
  try {
    const prepared = await prepareCareerEvidenceSourceV1(request);
    const sourceId = ports.idDeriver.derive(prepared.request.importOperationId, "career-source", "source");
    return {
      version: "1",
      accepted: true,
      sourceReference: privateObjectReferenceSummaryV1(sourceId),
      sourceType: prepared.request.sourceType,
      contentDigest: prepared.contentDigest,
      proposedFactCount: prepared.candidates.length,
      proposedRelationshipCount: prepared.candidates.length,
      conflictCount: 0,
      warningCodes: prepared.candidates.length === 0 ? ["catalogue-only-source"] : [],
      error: null,
      summary: dryRunSummary(),
    };
  } catch (error) {
    const safe = operationErrorV1(error, "source");
    return {
      version: "1", accepted: false, sourceReference: null, sourceType: null, contentDigest: null,
      proposedFactCount: 0, proposedRelationshipCount: 0, conflictCount: 0, warningCodes: [],
      error: safe.toResult(), summary: dryRunSummary(),
    };
  }
}

function validateExistingSource(
  current: ObjectEnvelopeV1,
  prepared: PreparedCareerEvidenceSourceV1,
  sourceId: ObjectIdV1,
  ports: CareerEvidenceOperationPortsV1,
): CareerSourcePayloadV1 {
  requireOwnedRegistrationV1(current, CAREER_SOURCE_OBJECT_V1, prepared.request.ownerId);
  const actual = validateCareerSourcePayloadV1(current.data);
  const expected = sourcePayload(prepared, sourceId, actual.catalogueEntry.importedAt, actual.catalogueEntry.processingOutcome);
  if (!canonicalEqualV1(actual, expected, ports.canonicalizer)) {
    throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "The import operation identifier is already bound to different source content.");
  }
  return actual;
}

async function verifyCompletedObjects(
  prepared: PreparedCareerEvidenceSourceV1,
  sourceId: ObjectIdV1,
  importedAt: string,
  derived: ReturnType<typeof deriveIds>["facts"],
  ports: CareerEvidenceOperationPortsV1,
): Promise<void> {
  for (const item of derived) {
    const fact = await ports.repository.loadCurrent(item.factId);
    if (fact === null) throw new CareerEvidenceOperationErrorV1("object-invalid", "persistence", "A completed import is missing a CareerFact.");
    requireOwnedRegistrationV1(fact, CAREER_FACT_OBJECT_V1, prepared.request.ownerId);
    const expected = factPayload(item.candidate, item.factId, sourceId, importedAt);
    if (!canonicalEqualV1(validateCareerFactPayloadV1(fact.data), expected, ports.canonicalizer)) {
      throw new CareerEvidenceOperationErrorV1("revision-conflict", "persistence", "A completed deterministic CareerFact has conflicting content.");
    }
    const relationship = await ports.repository.loadCurrent(item.relationshipId);
    if (relationship === null) throw new CareerEvidenceOperationErrorV1("object-invalid", "persistence", "A completed import is missing provenance relationship evidence.");
    requireOwnedRegistrationV1(relationship, RELATIONSHIP_OBJECT_V1, prepared.request.ownerId);
    const relationshipData = relationship.data as unknown as RelationshipObjectDataV1;
    if (relationshipData.relationshipKind !== "aion.relationship.career.fact-derived-from-source.v1"
      || relationshipData.source.objectId !== item.factId
      || relationshipData.target.objectId !== sourceId
      || relationshipData.effectiveUntil !== null) {
      throw new CareerEvidenceOperationErrorV1("object-invalid", "persistence", "A completed import has invalid provenance relationship evidence.");
    }
  }
}

export async function importCareerEvidenceV1(
  request: unknown,
  ports: CareerEvidenceOperationPortsV1,
): Promise<CareerEvidenceImportResultV1> {
  let sourceId: ObjectIdV1 | null = null;
  let source: ObjectEnvelopeV1 | null = null;
  let operationStarted = false;
  let prepared: PreparedCareerEvidenceSourceV1 | null = null;
  const factReferences: ReturnType<typeof privateObjectReferenceSummaryV1>[] = [];
  const relationshipReferences: ReturnType<typeof privateObjectReferenceSummaryV1>[] = [];
  let createdFacts = 0;
  let reusedFacts = 0;
  let createdRelationships = 0;
  let reusedRelationships = 0;
  try {
    prepared = await prepareCareerEvidenceSourceV1(request);
    const derived = deriveIds(prepared, ports);
    sourceId = derived.sourceId;
    source = await ports.repository.loadCurrent(sourceId);
    let importedAt: string;
    if (source === null) {
      importedAt = ports.clock.now();
      source = await createDomainObjectV1(
        CAREER_SOURCE_OBJECT_V1,
        sourceId,
        prepared.request.ownerId,
        prepared.request.actorId,
        importedAt,
        "imported",
        prepared.request.importOperationId,
        sourcePayload(prepared, sourceId, importedAt, outcome("pending", 0, 0)) as unknown as CanonicalValueV1,
        ports,
      );
      operationStarted = true;
    } else {
      const actual = validateExistingSource(source, prepared, sourceId, ports);
      importedAt = actual.catalogueEntry.importedAt;
      if (actual.catalogueEntry.processingOutcome.state === "success") {
        await verifyCompletedObjects(prepared, sourceId, importedAt, derived.facts, ports);
        return {
          version: "1", outcome: "already-completed", sourceReference: privateObjectReferenceSummaryV1(sourceId),
          factReferences: derived.facts.map((item) => privateObjectReferenceSummaryV1(item.factId)),
          relationshipReferences: derived.facts.map((item) => privateObjectReferenceSummaryV1(item.relationshipId)),
          createdFacts: 0, reusedFacts: derived.facts.length, createdRelationships: 0,
          reusedRelationships: derived.facts.length, recoveryRequired: false, error: null,
        };
      }
      operationStarted = true;
    }

    for (const item of derived.facts) {
      const fact = await ensureExactDomainObjectV1(
        CAREER_FACT_OBJECT_V1,
        item.factId,
        prepared.request.ownerId,
        prepared.request.actorId,
        importedAt,
        "derived",
        prepared.request.importOperationId,
        factPayload(item.candidate, item.factId, sourceId, importedAt) as unknown as CanonicalValueV1,
        ports,
        sourceId,
      );
      if (fact.created) createdFacts += 1; else reusedFacts += 1;
      factReferences.push(privateObjectReferenceSummaryV1(item.factId));
      const relationship = await ensureRelationshipV1(
        item.relationshipId,
        "aion.relationship.career.fact-derived-from-source.v1",
        item.factId,
        sourceId,
        prepared.request.ownerId,
        prepared.request.actorId,
        importedAt,
        prepared.request.importOperationId,
        ports,
      );
      if (relationship.created) createdRelationships += 1; else reusedRelationships += 1;
      relationshipReferences.push(privateObjectReferenceSummaryV1(item.relationshipId));
    }
    const completedAt = ports.clock.now();
    source = await appendDomainRevisionV1(
      source,
      source.revision,
      prepared.request.actorId,
      completedAt,
      "imported",
      prepared.request.importOperationId,
      sourcePayload(prepared, sourceId, importedAt, outcome("success", derived.facts.length, derived.facts.length)) as unknown as CanonicalValueV1,
      ports,
    );
    return {
      version: "1", outcome: "success", sourceReference: privateObjectReferenceSummaryV1(sourceId),
      factReferences, relationshipReferences, createdFacts, reusedFacts, createdRelationships,
      reusedRelationships, recoveryRequired: false, error: null,
    };
  } catch (error) {
    const safe = operationErrorV1(error, source === null ? "source" : "persistence");
    if (operationStarted && source !== null && prepared !== null && sourceId !== null) {
      try {
        const current = await ports.repository.loadCurrent(sourceId);
        if (current !== null) {
          const actual = validateExistingSource(current, prepared, sourceId, ports);
          if (actual.catalogueEntry.processingOutcome.state !== "success") {
            await appendDomainRevisionV1(
              current,
              current.revision,
              prepared.request.actorId,
              ports.clock.now(),
              "imported",
              prepared.request.importOperationId,
              sourcePayload(prepared, sourceId, actual.catalogueEntry.importedAt, outcome(
                "partial", createdFacts + reusedFacts, createdRelationships + reusedRelationships, [safe.code],
              )) as unknown as CanonicalValueV1,
              ports,
            );
          }
        }
      } catch { /* the original failure remains the truthful result */ }
    }
    return {
      version: "1",
      outcome: operationStarted ? "partial" : "rejected",
      sourceReference: sourceId === null ? null : privateObjectReferenceSummaryV1(sourceId),
      factReferences,
      relationshipReferences,
      createdFacts,
      reusedFacts,
      createdRelationships,
      reusedRelationships,
      recoveryRequired: operationStarted,
      error: safe.toResult(),
    };
  }
}
